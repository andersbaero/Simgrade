// Reads the "Export -> CLI" blob from the wowsims UI: a protojson RaidSimRequest
// with the player's race, class, spec, talents, APL rotation, consumables, raid
// buffs/debuffs, encounter and equipment. wowsimcli is built with the item
// database compiled in (--tags=with_db), which is why the UI strips the
// `database` field on export and why we never have to rebuild it.

import { CLASS_NAMES, CLASS_PROTO_NAMES, EquipmentSpec, ItemSpec, parseEnum, WowClass } from '../shared/wow.js';

export interface RaidSimRequest {
	raid?: { parties?: { players?: PlayerProto[] }[] };
	encounter?: unknown;
	simOptions?: { iterations?: number; randomSeed?: number | string };
	[key: string]: unknown;
}

export interface PlayerProto {
	name?: string;
	race?: number | string;
	class?: number | string;
	equipment?: EquipmentSpec;
	talentsString?: string;
	[key: string]: unknown;
}

export type Metric = 'dps' | 'hps' | 'tps';

export interface SpecInfo {
	key: string;
	label: string;
	hitStat: 'spell' | 'melee';
	metric: Metric;
}

// Keys are the JSON names of Player's `spec` oneof members (proto/api.proto).
const SPECS: Record<string, Omit<SpecInfo, 'key'>> = {
	balanceDruid: { label: 'Balance Druid', hitStat: 'spell', metric: 'dps' },
	feralCatDruid: { label: 'Feral Cat Druid', hitStat: 'melee', metric: 'dps' },
	feralBearDruid: { label: 'Feral Bear Druid', hitStat: 'melee', metric: 'dps' },
	restorationDruid: { label: 'Restoration Druid', hitStat: 'spell', metric: 'hps' },
	hunter: { label: 'Hunter', hitStat: 'melee', metric: 'dps' },
	mage: { label: 'Mage', hitStat: 'spell', metric: 'dps' },
	holyPaladin: { label: 'Holy Paladin', hitStat: 'spell', metric: 'hps' },
	protectionPaladin: { label: 'Protection Paladin', hitStat: 'melee', metric: 'dps' },
	retributionPaladin: { label: 'Retribution Paladin', hitStat: 'melee', metric: 'dps' },
	priest: { label: 'Priest', hitStat: 'spell', metric: 'dps' },
	rogue: { label: 'Rogue', hitStat: 'melee', metric: 'dps' },
	elementalShaman: { label: 'Elemental Shaman', hitStat: 'spell', metric: 'dps' },
	enhancementShaman: { label: 'Enhancement Shaman', hitStat: 'melee', metric: 'dps' },
	restorationShaman: { label: 'Restoration Shaman', hitStat: 'spell', metric: 'hps' },
	warlock: { label: 'Warlock', hitStat: 'spell', metric: 'dps' },
	dpsWarrior: { label: 'DPS Warrior', hitStat: 'melee', metric: 'dps' },
	protectionWarrior: { label: 'Protection Warrior', hitStat: 'melee', metric: 'dps' },
};

export interface ParsedProfile {
	request: RaidSimRequest;
	player: PlayerProto;
	playerName: string;
	wowClass: WowClass;
	className: string;
	spec: SpecInfo;
	equipment: (ItemSpec | null)[];
}

export class ProfileError extends Error {}

/** Locates the single player in the request; individual sims always have exactly one. */
function findPlayer(request: RaidSimRequest): PlayerProto {
	const players = request.raid?.parties?.flatMap(party => party.players ?? []) ?? [];
	const real = players.filter(p => p && (p.class !== undefined || p.equipment));
	if (real.length === 0) throw new ProfileError('No player found in the profile. Use the wowsims "Export → CLI" button.');
	if (real.length > 1) throw new ProfileError(`Expected 1 player in the profile but found ${real.length}. Export from an individual sim, not a raid sim.`);
	return real[0]!;
}

function findSpec(player: PlayerProto): SpecInfo {
	for (const [key, info] of Object.entries(SPECS)) {
		if (player[key] !== undefined) return { key, ...info };
	}
	throw new ProfileError('Could not determine the spec from the profile — no known spec field was present.');
}

/** Equipment as a fixed 17-slot array, with null for empty slots. */
export function parseEquipment(equipment: EquipmentSpec | undefined): (ItemSpec | null)[] {
	const slots: (ItemSpec | null)[] = Array.from({ length: 17 }, () => null);
	(equipment?.items ?? []).forEach((item, idx) => {
		if (idx < 17 && item && item.id) slots[idx] = { ...item };
	});
	return slots;
}

export function parseProfile(raw: unknown): ParsedProfile {
	if (!raw || typeof raw !== 'object') throw new ProfileError('Profile is not a JSON object.');
	const request = raw as RaidSimRequest;

	if (!request.raid) throw new ProfileError('Profile has no "raid" field — this does not look like a wowsims CLI export.');
	if (!request.encounter) throw new ProfileError('Profile has no "encounter" field. Export again from the wowsims UI.');

	const player = findPlayer(request);
	const wowClass = parseEnum(player.class, CLASS_PROTO_NAMES) as WowClass;
	if (!wowClass) throw new ProfileError(`Unrecognised class in profile: ${JSON.stringify(player.class)}`);

	const equipment = parseEquipment(player.equipment);
	if (equipment.every(item => item === null)) throw new ProfileError('Profile has no equipped items.');

	return {
		request,
		player,
		playerName: player.name || 'Player',
		wowClass,
		className: CLASS_NAMES[wowClass] ?? 'Unknown',
		spec: findSpec(player),
		equipment,
	};
}

/**
 * Rebuilds the request with new equipment and sim options. Everything else —
 * talents, rotation, buffs, encounter — is carried through untouched, so the
 * only difference between baseline and candidate is the gear.
 */
export function withEquipment(
	profile: ParsedProfile,
	equipment: (ItemSpec | null)[],
	simOptions: { iterations: number; randomSeed: number },
): RaidSimRequest {
	const request = structuredClone(profile.request) as RaidSimRequest;
	const player = findPlayer(request);
	player.equipment = { items: equipment.map(item => (item ? { ...item } : {})) as ItemSpec[] };
	request.simOptions = {
		...(request.simOptions ?? {}),
		iterations: simOptions.iterations,
		// protojson accepts int64 as a string; keep it a string to dodge precision surprises.
		randomSeed: String(simOptions.randomSeed),
	};
	return request;
}
