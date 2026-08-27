// Run configuration. Gem and enchant defaults are derived from the imported
// profile the first time it is loaded, so a fresh install needs no setup, and
// every derived value stays user-overridable.

import fs from 'node:fs';

import { GemColor, gemMatchesSocket, ItemSlot, MELEE_HIT_RATING_PER_PERCENT, SPELL_HIT_RATING_PER_PERCENT, Stat } from '../shared/wow.js';
import { ItemDatabase } from './itemDb.js';
import { CONFIG_PATH } from './paths.js';
import type { ParsedProfile } from './profile.js';

export type SocketKey = 'red' | 'yellow' | 'blue' | 'prismatic';

export const SOCKET_KEYS: SocketKey[] = ['red', 'yellow', 'blue', 'prismatic'];

export const SOCKET_COLOR_OF: Record<SocketKey, GemColor> = {
	red: GemColor.Red,
	yellow: GemColor.Yellow,
	blue: GemColor.Blue,
	prismatic: GemColor.Prismatic,
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
	randomSeed: number;
	metric: 'auto' | 'dps' | 'hps' | 'tps';
	hitStat: 'auto' | 'spell' | 'melee';
	hitTarget: HitTarget;
	/** Order in which sockets are considered when adding or removing hit gems. */
	hitSwapPriority: SocketKey[];
	gems: {
		meta: number;
		normal: Record<SocketKey, number>;
		hit: Record<SocketKey, number>;
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
	randomSeed: 19700101,
	metric: 'auto',
	hitStat: 'auto',
	hitTarget: { mode: 'keepCurrent', gearRating: 0, totalPercent: 16, externalPercent: 0 },
	// Yellow first: TBC's pure hit gems are yellow, so a yellow socket keeps its bonus.
	hitSwapPriority: ['yellow', 'prismatic', 'red', 'blue'],
	gems: { meta: 0, normal: { red: 0, yellow: 0, blue: 0, prismatic: 0 }, hit: { red: 0, yellow: 0, blue: 0, prismatic: 0 } },
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

	// Count what the character actually puts in each socket colour, not what the
	// gem's own colour is — someone who already runs red gems in yellow sockets
	// should get that back as their default, not a "correct" yellow gem.
	const usageBySocket = new Map<SocketKey, Map<number, number>>(SOCKET_KEYS.map(key => [key, new Map()]));
	let meta = 0;

	for (const spec of profile.equipment) {
		const item = spec ? db.item(spec.id) : undefined;
		if (!spec || !item) continue;

		db.sockets(item).forEach((socketColor, socketIndex) => {
			const gemId = spec.gems?.[socketIndex] ?? 0;
			if (!gemId) return;
			if (socketColor === GemColor.Meta) {
				meta ||= gemId;
				return;
			}
			const key = SOCKET_KEYS.find(candidate => SOCKET_COLOR_OF[candidate] === socketColor);
			if (!key) return;
			const counts = usageBySocket.get(key)!;
			counts.set(gemId, (counts.get(gemId) ?? 0) + 1);
		});
	}

	const mostUsedIn = (key: SocketKey): number => {
		let bestId = 0;
		let bestCount = 0;
		for (const [gemId, count] of usageBySocket.get(key) ?? []) {
			if (count > bestCount) {
				bestCount = count;
				bestId = gemId;
			}
		}
		return bestId;
	};

	/**
	 * The strongest hit gem that still matches the socket. TBC only has pure hit
	 * gems in yellow, so red and blue sockets fall back to a hybrid that carries
	 * hit (e.g. Glinting Pyrestone) rather than nothing at all. This is only the
	 * starting suggestion — any gem of any colour can be chosen instead.
	 */
	const bestHitFor = (key: SocketKey): number => {
		const socketColor = SOCKET_COLOR_OF[key];
		let bestId = 0;
		let bestScore = 0;
		for (const gem of db.gems.values()) {
			if (gem.unique || gem.requiredProfession) continue;
			if ((gem.quality ?? 0) < 3) continue;
			const color = (gem.color ?? 0) as GemColor;
			if (!gemMatchesSocket(color, socketColor)) continue;

			const stats = db.gemStats(gem.id);
			const hit = stats[hitIdx] ?? 0;
			if (!hit) continue;

			// Rank by hit first, then prefer the purest gem so the swap gives up least.
			const score = hit * 100 - Object.keys(stats).length;
			if (score > bestScore) {
				bestScore = score;
				bestId = gem.id;
			}
		}
		return bestId;
	};

	const normal = {} as Record<SocketKey, number>;
	const hit = {} as Record<SocketKey, number>;
	for (const key of SOCKET_KEYS) {
		normal[key] = mostUsedIn(key);
		hit[key] = bestHitFor(key);
	}
	return { meta, normal, hit };
}

/** Carries the character's existing enchants forward as the per-slot defaults. */
export function suggestEnchants(profile: ParsedProfile): Partial<Record<ItemSlot, number>> {
	const out: Partial<Record<ItemSlot, number>> = {};
	profile.equipment.forEach((item, slot) => {
		if (item?.enchant) out[slot as ItemSlot] = item.enchant;
	});
	return out;
}

export function loadConfig(): Config {
	if (!fs.existsSync(CONFIG_PATH)) return structuredClone(DEFAULT_CONFIG);
	const stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<Config>;
	return {
		...structuredClone(DEFAULT_CONFIG),
		...stored,
		hitTarget: { ...DEFAULT_CONFIG.hitTarget, ...(stored.hitTarget ?? {}) },
		gems: {
			meta: stored.gems?.meta ?? 0,
			normal: { ...DEFAULT_CONFIG.gems.normal, ...(stored.gems?.normal ?? {}) },
			hit: { ...DEFAULT_CONFIG.gems.hit, ...(stored.gems?.hit ?? {}) },
		},
		defaultEnchants: stored.defaultEnchants ?? {},
	};
}

export function saveConfig(config: Config): void {
	fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

/** Fills in any gem/enchant slots the user has not chosen yet from the profile. */
export function withSuggestions(config: Config, db: ItemDatabase, profile: ParsedProfile): Config {
	const hitStat = resolveHitStat(config, profile);
	const suggested = suggestGems(db, profile, hitStat);
	const merged = structuredClone(config);

	merged.gems.meta ||= suggested.meta;
	for (const key of SOCKET_KEYS) {
		merged.gems.normal[key] ||= suggested.normal[key];
		merged.gems.hit[key] ||= suggested.hit[key];
	}
	if (Object.keys(merged.defaultEnchants).length === 0) merged.defaultEnchants = suggestEnchants(profile);
	return merged;
}
