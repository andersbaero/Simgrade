// Loads and indexes wowsims' assets/database/db.json (a protojson UIDatabase).
// Item stats live under scalingOptions["0"].stats as a {statIndex: value} map;
// gem/enchant stats are plain 42-length arrays. Everything here normalises both
// shapes into a Record<number, number>.

import fs from 'node:fs';

import {
	ArmorType,
	CatalogItem,
	CLASS_ARMOR_TYPE,
	classCanUseWeapon,
	eligibleItemSlots,
	GemColor,
	ItemSlot,
	STAT_NAMES,
} from '../shared/wow.js';
import { DB_PATH } from './paths.js';

export interface RawScaling {
	ilvl?: number;
	randPropPoints?: number;
	weaponDamageMin?: number;
	weaponDamageMax?: number;
	stats?: Record<string, number>;
}

export interface RawItem {
	id: number;
	name: string;
	icon?: string;
	type?: number;
	armorType?: number;
	weaponType?: number;
	handType?: number;
	rangedWeaponType?: number;
	gemSockets?: number[];
	socketBonus?: number[];
	phase?: number;
	quality?: number;
	unique?: boolean;
	limitCategory?: number;
	nameDescription?: string;
	classAllowlist?: number[];
	requiredProfession?: number;
	setName?: string;
	setId?: number;
	factionRestriction?: number | string;
	sources?: RawSource[];
	scalingOptions?: Record<string, RawScaling>;
	weaponSpeed?: number;
}

interface RawSource {
	drop?: { difficulty?: number; npcId?: number; zoneId?: number; otherName?: string; category?: string };
	quest?: { id?: number; name?: string };
	soldBy?: { npcId?: number; npcName?: string; zoneId?: number };
	crafted?: { profession?: number | string; spellId?: number };
	rep?: { repFactionId?: number | string; repLevel?: number | string };
}

export interface RawGem {
	id: number;
	name: string;
	icon?: string;
	color?: number;
	stats?: number[];
	phase?: number;
	quality?: number;
	unique?: boolean;
	requiredProfession?: number;
}

export interface RawEnchant {
	effectId: number;
	itemId?: number;
	spellId?: number;
	name: string;
	type?: number;
	extraTypes?: number[];
	enchantType?: number;
	stats?: number[];
}

interface RawDatabase {
	items: RawItem[];
	gems: RawGem[];
	enchants: RawEnchant[];
	randomSuffixes?: { id: number; name: string; stats?: number[] }[];
	zones?: { id: number; name: string }[];
	npcs?: { id: number; name: string; zoneId?: number }[];
}

export type StatMap = Record<number, number>;

let db: ItemDatabase | null = null;

export class ItemDatabase {
	readonly items = new Map<number, RawItem>();
	readonly gems = new Map<number, RawGem>();
	readonly enchants = new Map<number, RawEnchant>();
	readonly randomSuffixes = new Map<number, { id: number; name: string; stats?: number[] }>();
	private readonly zones = new Map<number, string>();
	private readonly npcs = new Map<number, { name: string; zoneId?: number }>();

	constructor(raw: RawDatabase) {
		for (const item of raw.items) this.items.set(item.id, item);
		for (const gem of raw.gems) this.gems.set(gem.id, gem);
		// Enchants are keyed by effect ID, which is what ItemSpec.enchant holds.
		for (const enchant of raw.enchants) if (!this.enchants.has(enchant.effectId)) this.enchants.set(enchant.effectId, enchant);
		for (const suffix of raw.randomSuffixes ?? []) this.randomSuffixes.set(suffix.id, suffix);
		for (const zone of raw.zones ?? []) this.zones.set(zone.id, zone.name);
		for (const npc of raw.npcs ?? []) this.npcs.set(npc.id, { name: npc.name, zoneId: npc.zoneId });
	}

	item(id: number): RawItem | undefined {
		return this.items.get(id);
	}

	gem(id: number): RawGem | undefined {
		return this.gems.get(id);
	}

	enchant(effectId: number): RawEnchant | undefined {
		return this.enchants.get(effectId);
	}

	scaling(item: RawItem): RawScaling {
		return item.scalingOptions?.['0'] ?? {};
	}

	itemStats(item: RawItem): StatMap {
		const out: StatMap = {};
		for (const [idx, value] of Object.entries(this.scaling(item).stats ?? {})) out[Number(idx)] = value;
		return out;
	}

	itemIlvl(item: RawItem): number {
		return this.scaling(item).ilvl ?? 0;
	}

	gemStats(id: number): StatMap {
		return arrayToStatMap(this.gems.get(id)?.stats);
	}

	enchantStats(effectId: number): StatMap {
		return arrayToStatMap(this.enchants.get(effectId)?.stats);
	}

	randomSuffixStats(id: number): StatMap {
		return arrayToStatMap(this.randomSuffixes.get(id)?.stats);
	}

	socketBonusStats(item: RawItem): StatMap {
		return arrayToStatMap(item.socketBonus);
	}

	sockets(item: RawItem): GemColor[] {
		return (item.gemSockets ?? []).map(c => c as GemColor);
	}

	/** Human-readable drop source, e.g. "Illidan Stormrage" + "Black Temple". */
	sourceOf(item: RawItem): { source: string; zone: string } {
		for (const src of item.sources ?? []) {
			if (src.drop) {
				const npc = src.drop.npcId ? this.npcs.get(src.drop.npcId) : undefined;
				const zoneId = src.drop.zoneId ?? npc?.zoneId;
				const zone = zoneId ? (this.zones.get(zoneId) ?? '') : '';
				const name = npc?.name ?? src.drop.otherName ?? src.drop.category ?? 'Drop';
				return { source: name, zone };
			}
			if (src.quest) return { source: `Quest: ${src.quest.name ?? src.quest.id}`, zone: '' };
			if (src.soldBy) {
				const zone = src.soldBy.zoneId ? (this.zones.get(src.soldBy.zoneId) ?? '') : '';
				return { source: `Vendor: ${src.soldBy.npcName ?? ''}`.trim(), zone };
			}
			if (src.crafted) return { source: 'Crafted', zone: '' };
			if (src.rep) return { source: 'Reputation', zone: '' };
		}
		// Tier pieces have no direct source: they are bought with a boss-drop token.
		if (item.setName) return { source: 'Tier token', zone: '' };
		return { source: '', zone: '' };
	}

	statSummary(stats: StatMap): { stat: number; value: number }[] {
		return Object.entries(stats)
			.filter(([, value]) => value !== 0)
			.map(([stat, value]) => ({ stat: Number(stat), value }))
			.filter(({ stat }) => STAT_NAMES[stat] !== undefined)
			.sort((a, b) => b.value - a.value);
	}

	/**
	 * Whether this character could actually wear the item. Armour lighter than
	 * the class's own type is legal in game but never an upgrade at 70, so it
	 * counts as unusable here.
	 */
	usableBy(wowClass: number, item: RawItem): boolean {
		if (item.classAllowlist?.length && !item.classAllowlist.includes(wowClass)) return false;

		const armorType = item.armorType ?? ArmorType.Unknown;
		if (armorType !== ArmorType.Unknown && armorType !== (CLASS_ARMOR_TYPE[wowClass] ?? ArmorType.Unknown)) return false;

		if (!eligibleItemSlots({ type: item.type ?? 0, handType: item.handType }).length) return false;

		// Weapon skills and relic types: a rogue has no business with polearms.
		return classCanUseWeapon(wowClass, {
			type: item.type ?? 0,
			weaponType: item.weaponType,
			handType: item.handType,
			rangedWeaponType: item.rangedWeaponType,
		});
	}

	/**
	 * Splits stored item ids into those the character can use and those it
	 * can't — a saved list survives importing a different character, so stale
	 * ids from the previous one have to be dropped rather than silently simmed.
	 */
	partitionUsable(ids: number[], wowClass: number): { kept: number[]; dropped: { id: number; name: string }[] } {
		const kept: number[] = [];
		const dropped: { id: number; name: string }[] = [];
		for (const id of ids) {
			const item = this.item(id);
			if (item && this.usableBy(wowClass, item)) kept.push(id);
			else dropped.push({ id, name: item?.name ?? `item ${id}` });
		}
		return { kept, dropped };
	}

	catalog(opts: { wowClass: number; equippedIds: Set<number> }): CatalogItem[] {
		const out: CatalogItem[] = [];

		for (const item of this.items.values()) {
			if (!this.usableBy(opts.wowClass, item)) continue;

			const armorType = item.armorType ?? ArmorType.Unknown;
			const slots = eligibleItemSlots({ type: item.type ?? 0, handType: item.handType });
			const scaling = this.scaling(item);
			const { source, zone } = this.sourceOf(item);
			out.push({
				id: item.id,
				name: item.name,
				icon: item.icon ?? '',
				ilvl: scaling.ilvl ?? 0,
				phase: item.phase ?? 0,
				quality: item.quality ?? 0,
				slots,
				type: item.type ?? 0,
				armorType,
				weaponType: item.weaponType ?? 0,
				handType: item.handType ?? 0,
				rangedWeaponType: item.rangedWeaponType ?? 0,
				sockets: this.sockets(item),
				socketBonus: describeStats(this.socketBonusStats(item)),
				setName: item.setName ?? '',
				setId: item.setId ?? 0,
				unique: item.unique ?? false,
				source,
				zone,
				stats: this.statSummary(this.itemStats(item)),
				equipped: opts.equippedIds.has(item.id),
			});
		}

		return out.sort((a, b) => b.ilvl - a.ilvl || a.name.localeCompare(b.name));
	}
}

function arrayToStatMap(values: number[] | undefined): StatMap {
	const out: StatMap = {};
	values?.forEach((value, idx) => {
		if (value) out[idx] = value;
	});
	return out;
}

export function describeStats(stats: StatMap): string {
	return Object.entries(stats)
		.filter(([, value]) => value !== 0)
		.map(([stat, value]) => `+${value} ${STAT_NAMES[Number(stat)] ?? `stat${stat}`}`)
		.join(', ');
}

export function addStats(target: StatMap, source: StatMap, sign = 1): StatMap {
	for (const [stat, value] of Object.entries(source)) {
		const idx = Number(stat);
		target[idx] = (target[idx] ?? 0) + sign * value;
	}
	return target;
}

export function loadItemDatabase(): ItemDatabase {
	if (db) return db;
	if (!fs.existsSync(DB_PATH)) {
		throw new Error(`Item database not found at ${DB_PATH}. Run 'npm run setup' first.`);
	}
	db = new ItemDatabase(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as RawDatabase);
	return db;
}