// Reads the WowSimsExport in-game addon blob: the gear, talents and professions
// the character has right now. Unlike the "Export -> CLI" request this carries
// no rotation, consumables, buffs or encounter, so it can only ever be overlaid
// onto a profile that already has them - never used to create one.
//
// Format notes, every one of which bites if ignored. Verified against the
// addon's own Lua (wowsims/exporter, ExportStructures/) and the importer in the
// pinned wowsims release (individual_addon_importer.tsx):
//   - gear.items is NOT 17 entries. Empty slots in the middle come through as
//     null, but trailing empty slots are dropped, so the array is usually short.
//   - items carry the proto's snake_case random_suffix, not randomSuffix.
//   - gear has its own "version" key, which is not part of EquipmentSpec and
//     once broke the upstream importer outright.
//   - gems is truncated after the last filled socket, and holds 0 for a gap.

import { CLASS_NAMES, eligibleItemSlots, ItemSlot, ItemSpec, Profession, WowClass } from '../shared/wow.js';
import { ItemDatabase, RawItem } from './itemDb.js';
import { findPlayer, ParsedProfile, ProfileError, RaidSimRequest } from './profile.js';

/** An item the export named but that could not be equipped, and why. */
export interface SkippedItem {
	id: number;
	/** The slot left as it was, when the position told us which one that is. */
	slot: ItemSlot | null;
	reason: string;
}

export interface AddonImport {
	wowClass: WowClass;
	className: string;
	/** Fixed 17 slots, null where nothing is worn. */
	equipment: (ItemSpec | null)[];
	/** Empty when the addon sent nothing usable, so the overlay leaves talents alone. */
	talents: string;
	professions: Profession[];
	level: number;
	skipped: SkippedItem[];
}

/** Proto enum names, which is how both the addon and a CLI export spell professions. */
export const PROFESSION_NAMES: Record<number, string> = Object.fromEntries(
	Object.entries(Profession)
		.filter(([, value]) => typeof value === 'number')
		.map(([name, value]) => [value as number, name]),
);

/** Case-insensitive lookup of an enum by name. The addon lower-cases its classes. */
function byName(names: Record<number, string>, value: unknown): number {
	if (typeof value !== 'string') return 0;
	const needle = value.trim().toLowerCase();
	for (const [num, name] of Object.entries(names)) {
		if (name.toLowerCase() === needle) return Number(num);
	}
	return 0;
}

interface RawAddonItem {
	id?: number;
	enchant?: number;
	gems?: (number | null)[];
	random_suffix?: number;
	randomSuffix?: number;
}

// The order gear.items arrives in. Numerically the same as ItemSlot, which is
// why assigning by item type alone still lands the rings in the right order -
// but it is named here because the coincidence is load-bearing below.
const ADDON_SLOT_ORDER: ItemSlot[] = [
	ItemSlot.Head,
	ItemSlot.Neck,
	ItemSlot.Shoulder,
	ItemSlot.Back,
	ItemSlot.Chest,
	ItemSlot.Wrist,
	ItemSlot.Hands,
	ItemSlot.Waist,
	ItemSlot.Legs,
	ItemSlot.Feet,
	ItemSlot.Finger1,
	ItemSlot.Finger2,
	ItemSlot.Trinket1,
	ItemSlot.Trinket2,
	ItemSlot.MainHand,
	ItemSlot.OffHand,
	ItemSlot.Ranged,
];

function toItemSpec(db: ItemDatabase, item: RawItem, entry: RawAddonItem, id: number): ItemSpec {
	const spec: ItemSpec = { id };
	if (entry.enchant) spec.enchant = entry.enchant;

	const randomSuffix = entry.random_suffix ?? entry.randomSuffix;
	if (randomSuffix) spec.randomSuffix = randomSuffix;

	// The addon truncates the gem list after the last filled socket, so pad it
	// back out: the gem policy only fills a socket it can see is empty.
	const sockets = db.sockets(item).length;
	if (sockets) spec.gems = Array.from({ length: sockets }, (_unused, index) => Number(entry.gems?.[index] ?? 0) || 0);

	return spec;
}

/**
 * Places the exported items into a 17-slot array, over the gear the character
 * already has. Which slot an item lands in comes from the item's own type and
 * not from where it sat in the array, exactly as wowsims' own
 * Database.lookupEquipmentSpec does; array order is what keeps ring 1 and ring
 * 2 - and the trinkets - as the addon listed them.
 *
 * The exception is an item the pinned database has never heard of. It has no
 * type, so nothing but its position says where it sits, and that slot has to be
 * held: otherwise the next known item claims it and the piece that was really
 * there disappears without ever being mentioned.
 */
function placeAddonItems(
	db: ItemDatabase,
	entries: (RawAddonItem | null)[],
	previous: (ItemSpec | null)[],
): { equipment: (ItemSpec | null)[]; skipped: SkippedItem[]; placed: number } {
	const equipment: (ItemSpec | null)[] = Array.from({ length: 17 }, () => null);
	const reserved = new Set<ItemSlot>();
	const skipped: SkippedItem[] = [];
	let placed = 0;

	// Pass 1: hold a slot for every item we cannot identify, keeping whatever
	// the character is already wearing there.
	entries.forEach((entry, index) => {
		const id = entry?.id;
		if (!id || db.item(id)) return;

		const slot = ADDON_SLOT_ORDER[index];
		if (slot === undefined) {
			skipped.push({ id, slot: null, reason: 'not in the item database' });
			return;
		}
		reserved.add(slot);
		equipment[slot] = previous[slot] ?? null;
		skipped.push({ id, slot, reason: 'not in the item database' });
	});

	// Pass 2: everything we can identify, into the first slot its type allows
	// that is neither taken nor being held.
	for (const entry of entries) {
		const id = entry?.id;
		if (!id) continue;

		const item = db.item(id);
		if (!item) continue;

		const slot = eligibleItemSlots({ type: item.type ?? 0, handType: item.handType }).find(
			candidate => !equipment[candidate] && !reserved.has(candidate),
		);
		if (slot === undefined) {
			skipped.push({ id, slot: null, reason: 'no free slot it could go into' });
			continue;
		}

		equipment[slot] = toItemSpec(db, item, entry!, id);
		placed += 1;
	}

	return { equipment, skipped, placed };
}

/** Points spent per talent tree. A class whose last tree is empty sends fewer segments. */
export function talentPointsByTree(talents: string): number[] {
	return talents.split('-').map(tree => [...tree].reduce((total, char) => total + (Number(char) || 0), 0));
}

// Talent tree order per class, mapped to the spec keys in profile.ts's SPECS.
// Only the classes with more than one spec are listed; for everyone else a
// respec can never mean a different sim.
const SPEC_BY_TREE: Partial<Record<WowClass, string[][]>> = {
	[WowClass.Warrior]: [['dpsWarrior'], ['dpsWarrior'], ['protectionWarrior']],
	[WowClass.Paladin]: [['holyPaladin'], ['protectionPaladin'], ['retributionPaladin']],
	// Feral is one tree but two sims, so either cat or bear is a fair reading of it.
	[WowClass.Druid]: [['balanceDruid'], ['feralCatDruid', 'feralBearDruid'], ['restorationDruid']],
	[WowClass.Shaman]: [['elementalShaman'], ['enhancementShaman'], ['restorationShaman']],
};

/**
 * The spec key(s) a talent spread implies, by whichever tree has the most points
 * in it - the same rule the addon itself uses. Null when the class has only one
 * spec, or when there is nothing to go on.
 */
export function specFromTalents(wowClass: WowClass, talents: string): string[] | null {
	const trees = SPEC_BY_TREE[wowClass];
	if (!trees || !talents) return null;

	const points = talentPointsByTree(talents);
	const most = Math.max(...points, 0);
	if (most === 0) return null;

	// A tie means a hybrid build, which is no evidence of a respec either way.
	const leaders = points.filter(total => total === most).length;
	if (leaders > 1) return null;

	return trees[points.indexOf(most)] ?? null;
}

const NOTHING_EQUIPPED: (ItemSpec | null)[] = Array.from({ length: 17 }, () => null);

/**
 * `previous` is the gear being refreshed. It is needed because a slot holding
 * an item the database does not know has to be left exactly as it was.
 */
export function parseAddonExport(raw: unknown, db: ItemDatabase, previous: (ItemSpec | null)[] = NOTHING_EQUIPPED): AddonImport {
	if (!raw || typeof raw !== 'object') throw new ProfileError('That is not a JSON object.');
	const blob = raw as Record<string, unknown>;

	const gear = blob.gear as { items?: unknown } | undefined;
	if (!gear || typeof gear !== 'object' || !Array.isArray(gear.items)) {
		throw new ProfileError('This does not look like a WowSimsExport addon export — it carries no gear. Copy the whole string the addon gave you.');
	}

	const wowClass = byName(CLASS_NAMES, blob.class) as WowClass;
	if (!wowClass) throw new ProfileError(`Unrecognised class in the addon export: ${JSON.stringify(blob.class)}.`);

	// Interior gaps arrive as null and are kept, because an entry's position is
	// the only thing that identifies a slot holding an unknown item.
	const { equipment, skipped, placed } = placeAddonItems(db, gear.items as (RawAddonItem | null)[], previous);
	if (!placed) {
		throw new ProfileError('None of the items in that export are in the item database, so there is nothing to import.');
	}

	// An all-zero string means the addon could not read the talents. Overlaying
	// it would quietly wipe a real spec, so it is treated as "nothing sent".
	const sent = typeof blob.talents === 'string' ? blob.talents : '';
	const talents = sent && sent !== '--' && talentPointsByTree(sent).some(total => total > 0) ? sent : '';

	// An unrecognised profession is skipped rather than fatal: it must not cost
	// someone their gear refresh.
	const professions: Profession[] = [];
	for (const entry of Array.isArray(blob.professions) ? (blob.professions as { name?: unknown }[]) : []) {
		const value = byName(PROFESSION_NAMES, entry?.name) as Profession;
		if (value) professions.push(value);
	}

	return {
		wowClass,
		className: CLASS_NAMES[wowClass] ?? 'Unknown',
		equipment,
		talents,
		professions,
		level: Number(blob.level) || 0,
		skipped,
	};
}

/**
 * Overlays an addon export onto a stored profile. Gear, talents and professions
 * change; rotation, consumables, buffs, debuffs, encounter and the spec itself
 * ride through untouched, which is what keeps a refreshed profile comparable
 * with the sims that came before it.
 */
export function withAddonImport(profile: ParsedProfile, addon: AddonImport): RaidSimRequest {
	const request = structuredClone(profile.request) as RaidSimRequest;
	const player = findPlayer(request);

	player.equipment = { items: addon.equipment.map(item => (item ? { ...item } : {})) as ItemSpec[] };
	if (addon.talents) player.talentsString = addon.talents;

	// An empty profession list means the addon sent none, not that the character
	// has none — same call wowsims makes.
	if (addon.professions.length) {
		const [first, second] = addon.professions;
		player.profession1 = first ? PROFESSION_NAMES[first] : undefined;
		player.profession2 = second ? PROFESSION_NAMES[second] : undefined;
	}

	return request;
}
