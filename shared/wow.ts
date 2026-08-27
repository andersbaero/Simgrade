// Enums, lookup tables and shared types mirrored from wowsims' protos
// (proto/common.proto, proto/ui.proto). The item database encodes enums as
// numbers; protojson profiles encode them as names, so everything that reads a
// profile goes through parseEnum().

export enum ItemSlot {
	Head = 0,
	Neck = 1,
	Shoulder = 2,
	Back = 3,
	Chest = 4,
	Wrist = 5,
	Hands = 6,
	Waist = 7,
	Legs = 8,
	Feet = 9,
	Finger1 = 10,
	Finger2 = 11,
	Trinket1 = 12,
	Trinket2 = 13,
	MainHand = 14,
	OffHand = 15,
	Ranged = 16,
}

export const SLOT_NAMES: Record<ItemSlot, string> = {
	[ItemSlot.Head]: 'Head',
	[ItemSlot.Neck]: 'Neck',
	[ItemSlot.Shoulder]: 'Shoulder',
	[ItemSlot.Back]: 'Back',
	[ItemSlot.Chest]: 'Chest',
	[ItemSlot.Wrist]: 'Wrist',
	[ItemSlot.Hands]: 'Hands',
	[ItemSlot.Waist]: 'Waist',
	[ItemSlot.Legs]: 'Legs',
	[ItemSlot.Feet]: 'Feet',
	[ItemSlot.Finger1]: 'Ring 1',
	[ItemSlot.Finger2]: 'Ring 2',
	[ItemSlot.Trinket1]: 'Trinket 1',
	[ItemSlot.Trinket2]: 'Trinket 2',
	[ItemSlot.MainHand]: 'Main Hand',
	[ItemSlot.OffHand]: 'Off Hand',
	[ItemSlot.Ranged]: 'Ranged',
};

export enum ItemType {
	Unknown = 0,
	Head = 1,
	Neck = 2,
	Shoulder = 3,
	Back = 4,
	Chest = 5,
	Wrist = 6,
	Hands = 7,
	Waist = 8,
	Legs = 9,
	Feet = 10,
	Finger = 11,
	Trinket = 12,
	Weapon = 13,
	Ranged = 14,
}

export enum ArmorType {
	Unknown = 0,
	Cloth = 1,
	Leather = 2,
	Mail = 3,
	Plate = 4,
}

export const ARMOR_TYPE_NAMES: Record<number, string> = { 0: '', 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate' };

export enum WeaponType {
	Unknown = 0,
	Axe = 1,
	Dagger = 2,
	Fist = 3,
	Mace = 4,
	OffHand = 5,
	Polearm = 6,
	Shield = 7,
	Staff = 8,
	Sword = 9,
}

export enum HandType {
	Unknown = 0,
	MainHand = 1,
	OneHand = 2,
	OffHand = 3,
	TwoHand = 4,
}

export enum RangedWeaponType {
	Unknown = 0,
	Bow = 1,
	Crossbow = 2,
	Gun = 3,
	Thrown = 4,
	Wand = 5,
	Idol = 6,
	Libram = 7,
	Totem = 8,
	Sigil = 9,
}

export enum GemColor {
	Unknown = 0,
	Meta = 1,
	Red = 2,
	Blue = 3,
	Yellow = 4,
	Green = 5,
	Orange = 6,
	Purple = 7,
	Prismatic = 8,
}

export const GEM_COLOR_NAMES: Record<number, string> = {
	0: 'Unknown',
	1: 'Meta',
	2: 'Red',
	3: 'Blue',
	4: 'Yellow',
	5: 'Green',
	6: 'Orange',
	7: 'Purple',
	8: 'Prismatic',
};

// Which gem colours count as "matching" a socket, for socket bonuses.
// Ported from ui/core/proto_utils/gems.ts; the sim applies the bonus only when
// every socket on the item is matched (sim/core/database.go).
export const socketToMatchingColors: Record<GemColor, GemColor[]> = {
	[GemColor.Unknown]: [],
	[GemColor.Meta]: [GemColor.Meta],
	[GemColor.Red]: [GemColor.Red, GemColor.Purple, GemColor.Orange, GemColor.Prismatic],
	[GemColor.Blue]: [GemColor.Blue, GemColor.Purple, GemColor.Green, GemColor.Prismatic],
	[GemColor.Yellow]: [GemColor.Yellow, GemColor.Orange, GemColor.Green, GemColor.Prismatic],
	[GemColor.Green]: [],
	[GemColor.Orange]: [],
	[GemColor.Purple]: [],
	[GemColor.Prismatic]: [
		GemColor.Red,
		GemColor.Orange,
		GemColor.Yellow,
		GemColor.Green,
		GemColor.Blue,
		GemColor.Purple,
		GemColor.Prismatic,
	],
};

/** Whether a gem of this colour earns the socket bonus for this socket. */
export function gemMatchesSocket(gemColor: GemColor, socketColor: GemColor): boolean {
	return gemColor === socketColor || (socketToMatchingColors[socketColor] ?? []).includes(gemColor);
}

/**
 * Whether a gem can physically go in the socket. Only meta gems fit meta
 * sockets and vice versa; every other colour fits every other socket, which is
 * what makes a red gem in a yellow socket a legal (if bonus-forfeiting) choice.
 */
export function gemEligibleForSocket(gemColor: GemColor, socketColor: GemColor): boolean {
	return socketColor === GemColor.Meta ? gemColor === GemColor.Meta : gemColor !== GemColor.Meta;
}

export enum WowClass {
	Unknown = 0,
	Warrior = 1,
	Paladin = 2,
	Hunter = 3,
	Rogue = 4,
	Priest = 5,
	Shaman = 7,
	Mage = 8,
	Warlock = 9,
	Druid = 11,
}

export const CLASS_NAMES: Record<number, string> = {
	1: 'Warrior',
	2: 'Paladin',
	3: 'Hunter',
	4: 'Rogue',
	5: 'Priest',
	7: 'Shaman',
	8: 'Mage',
	9: 'Warlock',
	11: 'Druid',
};

// Which armor type a class is expected to wear at level 70. Items of a lighter
// type are legal but never an upgrade, so they are filtered out of the catalogue.
export const CLASS_ARMOR_TYPE: Record<number, ArmorType> = {
	[WowClass.Warrior]: ArmorType.Plate,
	[WowClass.Paladin]: ArmorType.Plate,
	[WowClass.Hunter]: ArmorType.Mail,
	[WowClass.Rogue]: ArmorType.Leather,
	[WowClass.Priest]: ArmorType.Cloth,
	[WowClass.Shaman]: ArmorType.Mail,
	[WowClass.Mage]: ArmorType.Cloth,
	[WowClass.Warlock]: ArmorType.Cloth,
	[WowClass.Druid]: ArmorType.Leather,
};

export enum Profession {
	Unknown = 0,
	Alchemy = 1,
	Blacksmithing = 2,
	Enchanting = 3,
	Engineering = 4,
	Herbalism = 5,
	Inscription = 6,
	Jewelcrafting = 7,
	Leatherworking = 8,
	Mining = 9,
	Skinning = 10,
	Tailoring = 11,
}

export enum Stat {
	Strength = 0,
	Agility = 1,
	Stamina = 2,
	Intellect = 3,
	HealingPower = 4,
	SpellDamage = 5,
	SpellHitRating = 12,
	SpellCritRating = 13,
	SpellHasteRating = 14,
	Spirit = 16,
	AttackPower = 17,
	RangedAttackPower = 18,
	FeralAttackPower = 19,
	MeleeHitRating = 20,
	MeleeCritRating = 21,
	MeleeHasteRating = 22,
	ArmorPenetration = 23,
	ExpertiseRating = 24,
	Resilience = 30,
	Armor = 31,
	MP5 = 35,
}

export const STAT_NAMES: Record<number, string> = {
	0: 'Strength',
	1: 'Agility',
	2: 'Stamina',
	3: 'Intellect',
	4: 'Healing Power',
	5: 'Spell Damage',
	6: 'Arcane Damage',
	7: 'Fire Damage',
	8: 'Frost Damage',
	9: 'Holy Damage',
	10: 'Nature Damage',
	11: 'Shadow Damage',
	12: 'Spell Hit',
	13: 'Spell Crit',
	14: 'Spell Haste',
	15: 'Spell Penetration',
	16: 'Spirit',
	17: 'Attack Power',
	18: 'Ranged AP',
	19: 'Feral AP',
	20: 'Hit',
	21: 'Crit',
	22: 'Haste',
	23: 'Armor Pen',
	24: 'Expertise',
	25: 'Defense',
	26: 'Block Rating',
	27: 'Block Value',
	28: 'Dodge',
	29: 'Parry',
	30: 'Resilience',
	31: 'Armor',
	32: 'Bonus Armor',
	33: 'Health',
	34: 'Mana',
	35: 'MP5',
};

// Rating required for 1% at level 70.
export const SPELL_HIT_RATING_PER_PERCENT = 12.6;
export const MELEE_HIT_RATING_PER_PERCENT = 15.77;

// proto/common.proto: ItemType -> the slots an item of that type can occupy.
const ITEM_TYPE_TO_SLOTS: Partial<Record<ItemType, ItemSlot[]>> = {
	[ItemType.Head]: [ItemSlot.Head],
	[ItemType.Neck]: [ItemSlot.Neck],
	[ItemType.Shoulder]: [ItemSlot.Shoulder],
	[ItemType.Back]: [ItemSlot.Back],
	[ItemType.Chest]: [ItemSlot.Chest],
	[ItemType.Wrist]: [ItemSlot.Wrist],
	[ItemType.Hands]: [ItemSlot.Hands],
	[ItemType.Waist]: [ItemSlot.Waist],
	[ItemType.Legs]: [ItemSlot.Legs],
	[ItemType.Feet]: [ItemSlot.Feet],
	[ItemType.Finger]: [ItemSlot.Finger1, ItemSlot.Finger2],
	[ItemType.Trinket]: [ItemSlot.Trinket1, ItemSlot.Trinket2],
	[ItemType.Ranged]: [ItemSlot.Ranged],
};

/** Port of getEligibleItemSlots() from ui/core/proto_utils/utils.ts. */
export function eligibleItemSlots(item: { type: number; handType?: number }): ItemSlot[] {
	const mapped = ITEM_TYPE_TO_SLOTS[item.type as ItemType];
	if (mapped) return mapped;
	if (item.type === ItemType.Weapon) {
		if (item.handType === HandType.MainHand) return [ItemSlot.MainHand];
		if (item.handType === HandType.OffHand) return [ItemSlot.OffHand];
		return [ItemSlot.MainHand, ItemSlot.OffHand];
	}
	return [];
}

// Weapon and relic proficiencies at level 70. Without these the catalogue shows
// a rogue two-handed axes and a mage polearms.
export interface ClassWeapons {
	oneHand: WeaponType[];
	twoHand: WeaponType[];
	offHand: boolean;
	ranged: RangedWeaponType[];
}

export const CLASS_WEAPONS: Record<number, ClassWeapons> = {
	[WowClass.Warrior]: {
		oneHand: [WeaponType.Axe, WeaponType.Mace, WeaponType.Sword, WeaponType.Dagger, WeaponType.Fist],
		twoHand: [WeaponType.Axe, WeaponType.Mace, WeaponType.Sword, WeaponType.Polearm, WeaponType.Staff],
		offHand: true,
		ranged: [RangedWeaponType.Bow, RangedWeaponType.Crossbow, RangedWeaponType.Gun, RangedWeaponType.Thrown],
	},
	[WowClass.Paladin]: {
		oneHand: [WeaponType.Axe, WeaponType.Mace, WeaponType.Sword],
		twoHand: [WeaponType.Axe, WeaponType.Mace, WeaponType.Sword, WeaponType.Polearm],
		offHand: true,
		ranged: [RangedWeaponType.Libram],
	},
	[WowClass.Hunter]: {
		oneHand: [WeaponType.Axe, WeaponType.Sword, WeaponType.Dagger, WeaponType.Fist],
		twoHand: [WeaponType.Axe, WeaponType.Sword, WeaponType.Polearm, WeaponType.Staff],
		offHand: true,
		ranged: [RangedWeaponType.Bow, RangedWeaponType.Crossbow, RangedWeaponType.Gun],
	},
	[WowClass.Rogue]: {
		oneHand: [WeaponType.Dagger, WeaponType.Fist, WeaponType.Mace, WeaponType.Sword],
		twoHand: [],
		offHand: true,
		ranged: [RangedWeaponType.Bow, RangedWeaponType.Crossbow, RangedWeaponType.Gun, RangedWeaponType.Thrown],
	},
	[WowClass.Priest]: {
		oneHand: [WeaponType.Dagger, WeaponType.Mace],
		twoHand: [WeaponType.Staff],
		offHand: true,
		ranged: [RangedWeaponType.Wand],
	},
	[WowClass.Shaman]: {
		oneHand: [WeaponType.Axe, WeaponType.Mace, WeaponType.Dagger, WeaponType.Fist],
		twoHand: [WeaponType.Axe, WeaponType.Mace, WeaponType.Staff],
		offHand: true,
		ranged: [RangedWeaponType.Totem],
	},
	[WowClass.Mage]: {
		oneHand: [WeaponType.Dagger, WeaponType.Sword],
		twoHand: [WeaponType.Staff],
		offHand: true,
		ranged: [RangedWeaponType.Wand],
	},
	[WowClass.Warlock]: {
		oneHand: [WeaponType.Dagger, WeaponType.Sword],
		twoHand: [WeaponType.Staff],
		offHand: true,
		ranged: [RangedWeaponType.Wand],
	},
	[WowClass.Druid]: {
		oneHand: [WeaponType.Dagger, WeaponType.Fist, WeaponType.Mace],
		twoHand: [WeaponType.Mace, WeaponType.Polearm, WeaponType.Staff],
		offHand: true,
		ranged: [RangedWeaponType.Idol],
	},
};

/** Whether the class can equip this weapon/relic at all. */
export function classCanUseWeapon(
	wowClass: number,
	item: { type: number; weaponType?: number; handType?: number; rangedWeaponType?: number },
): boolean {
	const proficiency = CLASS_WEAPONS[wowClass];
	if (!proficiency) return true;

	if (item.type === ItemType.Ranged) {
		return !item.rangedWeaponType || proficiency.ranged.includes(item.rangedWeaponType as RangedWeaponType);
	}
	if (item.type !== ItemType.Weapon) return true;

	const weaponType = (item.weaponType ?? 0) as WeaponType;
	// Shields and off-hand holdables are not weapon skills.
	if (weaponType === WeaponType.Shield || weaponType === WeaponType.OffHand) return proficiency.offHand;
	if (item.handType === HandType.TwoHand) return proficiency.twoHand.includes(weaponType);
	return proficiency.oneHand.includes(weaponType);
}

// Tier set bonuses count only these slots (sim/core/item_sets.go DefaultItemSetSlots).
export const TIER_SLOTS: ItemSlot[] = [ItemSlot.Head, ItemSlot.Shoulder, ItemSlot.Chest, ItemSlot.Hands, ItemSlot.Legs];

/** Reads an enum that may be serialised as a number or as its proto name. */
export function parseEnum(value: unknown, names: Record<number, string>): number {
	if (typeof value === 'number') return value;
	if (typeof value !== 'string') return 0;
	for (const [num, name] of Object.entries(names)) {
		if (name === value) return Number(num);
	}
	return 0;
}

// protojson emits enums by their full proto name, e.g. "ClassWarrior".
export const CLASS_PROTO_NAMES: Record<number, string> = Object.fromEntries(
	Object.entries(CLASS_NAMES).map(([num, name]) => [num, `Class${name}`]),
);

// ---------------------------------------------------------------------------
// Wire types shared between server and web.
// ---------------------------------------------------------------------------

export interface ItemSpec {
	id: number;
	randomSuffix?: number;
	enchant?: number;
	gems?: number[];
}

export interface EquipmentSpec {
	items: ItemSpec[];
}

export interface CatalogItem {
	id: number;
	name: string;
	icon: string;
	ilvl: number;
	phase: number;
	quality: number;
	slots: ItemSlot[];
	type: number;
	armorType: number;
	weaponType: number;
	handType: number;
	rangedWeaponType: number;
	sockets: GemColor[];
	socketBonus: string;
	setName: string;
	setId: number;
	unique: boolean;
	source: string;
	zone: string;
	stats: { stat: number; value: number }[];
	equipped: boolean;
}

export interface CandidateResult {
	key: string;
	kind: 'single' | 'bundle';
	itemIds: number[];
	label: string;
	slotLabel: string;
	replaces: string;
	dps: number;
	stdev: number;
	iterations: number;
	delta: number;
	deltaCI: number;
	withinNoise: boolean;
	gearHit: number;
	hitDelta: number;
	setNotes: string[];
	gemNotes: string[];
	warnings: string[];
	/** Set when the best way to wear this item involved a bench swap for hit. */
	benchNote?: string;
}

export interface RunFailure {
	label: string;
	slotLabel: string;
	error: string;
}

export interface RunProgress {
	state: 'idle' | 'running' | 'done' | 'error';
	completed: number;
	total: number;
	current: string;
	message?: string;
	baselineDps?: number;
	baselineHit?: number;
	results: CandidateResult[];
	failures: RunFailure[];
	startedAt?: string;
	finishedAt?: string;
}
