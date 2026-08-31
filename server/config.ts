// Run configuration. Gem and enchant defaults are derived from the imported
// profile the first time it is loaded, so a fresh install needs no setup, and
// every derived value stays user-overridable.

import fs from 'node:fs';
import path from 'node:path';

import { GemColor, gemMatchesSocket, ItemSlot, MELEE_HIT_RATING_PER_PERCENT, SPELL_HIT_RATING_PER_PERCENT, Stat } from '../shared/wow.js';
import { ItemDatabase } from './itemDb.js';
import { profileConfigPath, SETTINGS_PATH } from './paths.js';
import type { ParsedProfile } from './profile.js';

/** The three colours a meta gem can demand. */
export type MetaColorKey = 'red' | 'yellow' | 'blue';

export const META_COLOR_KEYS: MetaColorKey[] = ['red', 'yellow', 'blue'];

export const META_COLOR_OF: Record<MetaColorKey, GemColor> = {
	red: GemColor.Red,
	yellow: GemColor.Yellow,
	blue: GemColor.Blue,
};

export interface HitTarget {
	/**
	 * keepCurrent  - never drop below the hit rating the current gear already has
	 * gearRating   - an explicit gear hit rating to reach
	 * totalPercent - a total hit percentage, minus what talents/buffs already give
	 */
	mode: 'keepCurrent' | 'gearRating' | 'totalPercent';
	gearRating: number;
	totalPercent: number;
	externalPercent: number;
}

export interface Config {
	iterations: number;
	refineIterations: number;
	refineTop: number;
	/** Also sim each socketed candidate gemmed to earn its socket bonus. */
	trySocketBonuses: boolean;
	/** Look for a newer Simgrade release at startup. */
	checkForUpdates: boolean;
	/** Reuse this seed on every run instead of drawing a fresh one. */
	pinSeed: boolean;
	randomSeed: number;
	metric: 'auto' | 'dps' | 'hps' | 'tps';
	hitStat: 'auto' | 'spell' | 'melee';
	hitTarget: HitTarget;
	gems: {
		meta: number;
		/** Goes in every socket, whatever colour it is. */
		base: number;
		/** Swapped in over `base`, only until the hit target is reached. */
		hit: number;
		/** Used solely to satisfy a meta gem's colour requirement. */
		metaFix: Record<MetaColorKey, number>;
	};
	/** Enchant effect IDs applied to a slot when the replaced item's enchant does not fit. */
	defaultEnchants: Partial<Record<ItemSlot, number>>;
	/** How close to the hit target counts as "on target", in rating. */
	hitTolerance: number;
	/** Bench swaps simmed per candidate when gems alone miss the target. */
	maxBenchVariants: number;
	/** Compare against the gem-policy-tuned baseline rather than gear exactly as equipped. */
	deltaBasis: 'tuned' | 'raw';
}

export const DEFAULT_CONFIG: Config = {
	iterations: 30000,
	refineIterations: 100000,
	refineTop: 15,
	trySocketBonuses: true,
	checkForUpdates: true,
	pinSeed: false,
	randomSeed: 19700101,
	metric: 'auto',
	hitStat: 'auto',
	hitTarget: { mode: 'keepCurrent', gearRating: 0, totalPercent: 16, externalPercent: 0 },
	gems: { meta: 0, base: 0, hit: 0, metaFix: { red: 0, yellow: 0, blue: 0 } },
	defaultEnchants: {},
	hitTolerance: 10,
	maxBenchVariants: 2,
	deltaBasis: 'tuned',
};

export function ratingPerPercent(hitStat: 'spell' | 'melee'): number {
	return hitStat === 'spell' ? SPELL_HIT_RATING_PER_PERCENT : MELEE_HIT_RATING_PER_PERCENT;
}

export function hitStatIndex(hitStat: 'spell' | 'melee'): Stat {
	return hitStat === 'spell' ? Stat.SpellHitRating : Stat.MeleeHitRating;
}

export function resolveHitStat(config: Config, profile: ParsedProfile): 'spell' | 'melee' {
	return config.hitStat === 'auto' ? profile.spec.hitStat : config.hitStat;
}

export function resolveMetric(config: Config, profile: ParsedProfile): 'dps' | 'hps' | 'tps' {
	return config.metric === 'auto' ? profile.spec.metric : config.metric;
}

/**
 * Picks starting gem choices from the character's own gear: the gem they use
 * most often in each socket colour becomes the "normal" gem, and the strongest
 * available pure-hit gem of that colour becomes the "hit" gem.
 */
export function suggestGems(db: ItemDatabase, profile: ParsedProfile, hitStat: 'spell' | 'melee'): Config['gems'] {
	const hitIdx = hitStatIndex(hitStat);

	// What the character actually socketed, ignoring socket colour — the same
	// gem in every hole is how gemming really works.
	const usage = new Map<number, number>();
	let meta = 0;

	for (const spec of profile.equipment) {
		const item = spec ? db.item(spec.id) : undefined;
		if (!spec || !item) continue;

		db.sockets(item).forEach((socketColor, socketIndex) => {
			const gemId = spec.gems?.[socketIndex] ?? 0;
			if (!gemId) return;
			if (socketColor === GemColor.Meta) meta ||= gemId;
			else usage.set(gemId, (usage.get(gemId) ?? 0) + 1);
		});
	}

	const mostUsed = (predicate: (gemId: number) => boolean): number => {
		let bestId = 0;
		let bestCount = 0;
		for (const [gemId, count] of usage) {
			if (count > bestCount && predicate(gemId)) {
				bestCount = count;
				bestId = gemId;
			}
		}
		return bestId;
	};

	const countsAs = (gemId: number, key: MetaColorKey) =>
		gemMatchesSocket((db.gem(gemId)?.color ?? GemColor.Unknown) as GemColor, META_COLOR_OF[key]);

	/** The strongest gem carrying the relevant hit stat, colour irrelevant. */
	const bestHit = (): number => {
		let bestId = 0;
		let bestScore = 0;
		for (const gem of db.gems.values()) {
			if (gem.unique || gem.requiredProfession || (gem.quality ?? 0) < 3) continue;
			if ((gem.color ?? 0) === GemColor.Meta) continue;

			const stats = db.gemStats(gem.id);
			const hit = stats[hitIdx] ?? 0;
			if (!hit) continue;

			// Most hit first, then the purest gem so the swap gives up least.
			const score = hit * 100 - Object.keys(stats).length;
			if (score > bestScore) {
				bestScore = score;
				bestId = gem.id;
			}
		}
		return bestId;
	};

	/** A gem that counts as the colour: one already worn, else the best epic one. */
	const bestFor = (key: MetaColorKey): number => {
		const worn = mostUsed(gemId => countsAs(gemId, key));
		if (worn) return worn;

		let bestId = 0;
		let bestQuality = -1;
		for (const gem of db.gems.values()) {
			if (gem.unique || gem.requiredProfession) continue;
			if (!countsAs(gem.id, key)) continue;
			const quality = (gem.quality ?? 0) * 100 + (gem.phase ?? 0);
			if (quality > bestQuality) {
				bestQuality = quality;
				bestId = gem.id;
			}
		}
		return bestId;
	};

	return {
		meta,
		base: mostUsed(() => true),
		hit: bestHit(),
		metaFix: { red: bestFor('red'), yellow: bestFor('yellow'), blue: bestFor('blue') },
	};
}

/** Carries the character's existing enchants forward as the per-slot defaults. */
export function suggestEnchants(profile: ParsedProfile): Partial<Record<ItemSlot, number>> {
	const out: Partial<Record<ItemSlot, number>> = {};
	profile.equipment.forEach((item, slot) => {
		if (item?.enchant) out[slot as ItemSlot] = item.enchant;
	});
	return out;
}

/** The nine-gem, per-socket-colour shape this used to store. */
interface LegacyGems {
	meta?: number;
	normal?: Record<string, number>;
	hit?: Record<string, number>;
}

const mostCommon = (values: number[]): number => {
	const counts = new Map<number, number>();
	for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};

/**
 * Collapses the old per-socket-colour gems into the flat shape. In practice
 * those nine fields already held one gem repeated, plus whatever was set aside
 * for the meta requirement, so this loses nothing.
 */
export function migrateGems(legacy: LegacyGems, db?: ItemDatabase): Config['gems'] {
	const normal = legacy.normal ?? {};
	const countsAs = (gemId: number, key: MetaColorKey) =>
		!!gemId && !!db && gemMatchesSocket((db.gem(gemId)?.color ?? GemColor.Unknown) as GemColor, META_COLOR_OF[key]);

	return {
		meta: legacy.meta ?? 0,
		base: mostCommon(Object.values(normal)),
		hit: mostCommon(Object.values(legacy.hit ?? {})),
		// The old per-colour gem is the natural meta-fix gem, but only when it
		// genuinely counts as that colour — a red gem chosen for the yellow
		// socket never could.
		metaFix: {
			red: countsAs(normal.red ?? 0, 'red') ? normal.red! : 0,
			yellow: countsAs(normal.yellow ?? 0, 'yellow') ? normal.yellow! : 0,
			blue: countsAs(normal.blue ?? 0, 'blue') ? normal.blue! : 0,
		},
	};
}

/**
 * Settings that belong to a character rather than to the app. Everything else —
 * iteration counts, seed, methodology — is shared. One list drives both load
 * and save, so the split cannot drift.
 */
export const PROFILE_CONFIG_KEYS = ['metric', 'hitStat', 'hitTarget', 'gems', 'defaultEnchants'] as const;

type ProfileConfigKey = (typeof PROFILE_CONFIG_KEYS)[number];

const readJson = (file: string): Record<string, unknown> => {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
	} catch {
		return {};
	}
};

export function loadConfig(db?: ItemDatabase, profileId?: string | null): Config {
	const shared = readJson(SETTINGS_PATH);
	const forProfile = profileId ? readJson(profileConfigPath(profileId)) : {};
	const stored = { ...shared, ...forProfile } as Partial<Config> & { gems?: LegacyGems };

	if (Object.keys(stored).length === 0) return structuredClone(DEFAULT_CONFIG);

	const legacy = stored.gems && typeof (stored.gems as LegacyGems).normal === 'object';
	const gems = legacy
		? migrateGems(stored.gems as LegacyGems, db)
		: {
				meta: stored.gems?.meta ?? 0,
				base: (stored.gems as Config['gems'])?.base ?? 0,
				hit: (stored.gems as Config['gems'])?.hit ?? 0,
				metaFix: { ...DEFAULT_CONFIG.gems.metaFix, ...((stored.gems as Config['gems'])?.metaFix ?? {}) },
			};

	const merged = {
		...structuredClone(DEFAULT_CONFIG),
		...stored,
		hitTarget: { ...DEFAULT_CONFIG.hitTarget, ...(stored.hitTarget ?? {}) },
		gems,
		defaultEnchants: stored.defaultEnchants ?? {},
	};

	// Settings that no longer exist would otherwise ride along forever via the
	// spread above and be written straight back out on the next save.
	for (const dead of ['hitSwapPriority', 'maxBundleSize']) delete (merged as Record<string, unknown>)[dead];
	return merged as Config;
}

/** Splits a config back into the shared file and the character's own. */
export function saveConfig(config: Config, profileId?: string | null): void {
	const shared: Record<string, unknown> = {};
	const forProfile: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(config)) {
		(PROFILE_CONFIG_KEYS.includes(key as ProfileConfigKey) ? forProfile : shared)[key] = value;
	}

	fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(shared, null, 2)}\n`);
	if (profileId) {
		fs.mkdirSync(path.dirname(profileConfigPath(profileId)), { recursive: true });
		fs.writeFileSync(profileConfigPath(profileId), `${JSON.stringify(forProfile, null, 2)}\n`);
	}
}

/** Fills in any gem/enchant slots the user has not chosen yet from the profile. */
export function withSuggestions(config: Config, db: ItemDatabase, profile: ParsedProfile): Config {
	const hitStat = resolveHitStat(config, profile);
	const suggested = suggestGems(db, profile, hitStat);
	const merged = structuredClone(config);

	merged.gems.meta ||= suggested.meta;
	merged.gems.base ||= suggested.base;
	merged.gems.hit ||= suggested.hit;
	for (const key of META_COLOR_KEYS) merged.gems.metaFix[key] ||= suggested.metaFix[key];
	if (Object.keys(merged.defaultEnchants).length === 0) merged.defaultEnchants = suggestEnchants(profile);
	return merged;
}
