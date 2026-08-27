// Turns the user's ticked items into concrete gear sets to sim: one per item
// (both variants for rings/trinkets), plus multi-piece bundles that reach a
// tier set threshold.

import { eligibleItemSlots, HandType, ItemSlot, ItemSpec, ItemType, TIER_SLOTS, WeaponType } from '../shared/wow.js';
import type { Config } from './config.js';
import { chooseEnchant, cloneGear, Gear, slotLabel } from './gearing.js';
import { ItemDatabase, RawItem } from './itemDb.js';
import { setsInGear, SET_BONUS_THRESHOLDS } from './sets.js';

export interface Placement {
	slot: ItemSlot;
	itemId: number;
}

export interface Candidate {
	key: string;
	kind: 'single' | 'bundle';
	itemIds: number[];
	placements: Placement[];
	label: string;
	slotLabel: string;
	replaces: string;
	/** Ring/trinket variants share a group; only the best-simming one is reported. */
	group: string;
	warnings: string[];
}

export interface CandidateBuild {
	candidates: Candidate[];
	skipped: { itemId: number; name: string; reason: string }[];
	bundlesTruncated: number;
}

const MAX_BUNDLES = 60;

/** Slots a candidate item may go into, given what the character currently wears. */
function targetSlots(db: ItemDatabase, item: RawItem, gear: Gear): ItemSlot[] {
	const slots = eligibleItemSlots({ type: item.type ?? 0, handType: item.handType });

	if (item.type !== ItemType.Weapon) return slots;

	if (item.handType === HandType.TwoHand) return [ItemSlot.MainHand];
	if (item.handType === HandType.OffHand || item.weaponType === WeaponType.OffHand || item.weaponType === WeaponType.Shield) {
		return [ItemSlot.OffHand];
	}
	// A one-hander only makes sense in the off hand if something is already worn there.
	return gear[ItemSlot.OffHand] ? [ItemSlot.MainHand, ItemSlot.OffHand] : [ItemSlot.MainHand];
}

function describeReplaced(db: ItemDatabase, gear: Gear, slots: ItemSlot[]): string {
	const names = slots.map(slot => {
		const spec = gear[slot];
		const name = spec ? (db.item(spec.id)?.name ?? `item ${spec.id}`) : '(empty)';
		return `${slotLabel(slot)}: ${name}`;
	});
	return names.join(', ');
}

/** Places items into a copy of the gear, carrying enchants over where they still fit. */
export function placeItems(db: ItemDatabase, baseGear: Gear, placements: Placement[], config: Config): { gear: Gear; warnings: string[] } {
	const gear = cloneGear(baseGear);
	const warnings: string[] = [];

	for (const { slot, itemId } of placements) {
		const item = db.item(itemId);
		if (!item) {
			warnings.push(`Item ${itemId} is not in the database.`);
			continue;
		}

		const replaced = gear[slot] ?? null;
		const spec: ItemSpec = { id: itemId };
		const enchant = chooseEnchant(db, item, replaced, config, slot);
		if (enchant) spec.enchant = enchant;
		else if (replaced?.enchant) warnings.push(`${item.name}: the ${slotLabel(slot)} enchant does not fit the new item, so it is unenchanted.`);

		// Sockets are filled by the gem policy; start them empty.
		const sockets = db.sockets(item);
		if (sockets.length) spec.gems = sockets.map(() => 0);
		gear[slot] = spec;

		// A two-hander clears the off hand.
		if (slot === ItemSlot.MainHand && item.handType === HandType.TwoHand && gear[ItemSlot.OffHand]) {
			const dropped = db.item(gear[ItemSlot.OffHand]!.id)?.name ?? 'off-hand';
			gear[ItemSlot.OffHand] = null;
			warnings.push(`Two-handed: unequips ${dropped}.`);
		}
		// Equipping a one-hander over a two-hander leaves the off hand bare.
		if (slot === ItemSlot.MainHand && item.handType !== HandType.TwoHand) {
			const wasTwoHand = replaced && db.item(replaced.id)?.handType === HandType.TwoHand;
			if (wasTwoHand && !gear[ItemSlot.OffHand]) warnings.push('Replaces a two-hander, leaving the off hand empty.');
		}
	}

	return { gear, warnings };
}

function combinations<T>(items: T[], size: number): T[][] {
	if (size === 0) return [[]];
	if (items.length < size) return [];
	const [head, ...rest] = items;
	return [...combinations(rest, size - 1).map(combo => [head as T, ...combo]), ...combinations(rest, size)];
}

export function buildCandidates(db: ItemDatabase, gear: Gear, selectedIds: number[], config: Config): CandidateBuild {
	const candidates: Candidate[] = [];
	const skipped: CandidateBuild['skipped'] = [];
	const equippedIds = new Set(gear.filter(Boolean).map(spec => spec!.id));

	// --- singles -----------------------------------------------------------
	for (const itemId of selectedIds) {
		const item = db.item(itemId);
		if (!item) {
			skipped.push({ itemId, name: `Item ${itemId}`, reason: 'not found in the item database' });
			continue;
		}
		if (equippedIds.has(itemId)) {
			skipped.push({ itemId, name: item.name, reason: 'already equipped' });
			continue;
		}

		const slots = targetSlots(db, item, gear);
		if (!slots.length) {
			skipped.push({ itemId, name: item.name, reason: 'no slot this item could go into' });
			continue;
		}

		for (const slot of slots) {
			candidates.push({
				key: `single:${itemId}:${slot}`,
				kind: 'single',
				itemIds: [itemId],
				placements: [{ slot, itemId }],
				label: item.name,
				slotLabel: slotLabel(slot),
				replaces: describeReplaced(db, gear, [slot]),
				group: `single:${itemId}`,
				warnings: [],
			});
		}
	}

	// --- tier bundles ------------------------------------------------------
	const currentSets = setsInGear(db, gear);
	const bySet = new Map<number, { slot: ItemSlot; itemId: number; name: string }[]>();

	for (const itemId of selectedIds) {
		const item = db.item(itemId);
		if (!item?.setId || equippedIds.has(itemId)) continue;
		const slots = eligibleItemSlots({ type: item.type ?? 0, handType: item.handType }).filter(slot => TIER_SLOTS.includes(slot));
		const slot = slots[0];
		if (slot === undefined) continue;

		// Swapping a set piece into a slot that already holds one of the same set
		// changes nothing about the piece count.
		const occupant = gear[slot];
		if (occupant && db.item(occupant.id)?.setId === item.setId) continue;

		const list = bySet.get(item.setId) ?? [];
		list.push({ slot, itemId, name: item.name });
		bySet.set(item.setId, list);
	}

	let bundlesTruncated = 0;
	for (const [setId, pieces] of bySet) {
		const setName = db.item(pieces[0]!.itemId)?.setName ?? `set ${setId}`;
		const current = currentSets.get(setId)?.pieces ?? 0;

		// One option per slot, so a bundle never tries to fill the same slot twice.
		const bySlot = new Map<ItemSlot, typeof pieces>();
		for (const piece of pieces) bySlot.set(piece.slot, [...(bySlot.get(piece.slot) ?? []), piece]);
		const slots = [...bySlot.keys()];

		// Every bundle size that lands on a bonus threshold. Going from no pieces
		// to 4pc needs a four-piece bundle, so the size must not be capped below
		// the largest threshold.
		for (let size = 2; size <= slots.length; size++) {
			if (!SET_BONUS_THRESHOLDS.includes(current + size)) continue;

			for (const slotCombo of combinations(slots, size)) {
				// Expand each slot's alternatives into concrete piece choices.
				let choices: { slot: ItemSlot; itemId: number; name: string }[][] = [[]];
				for (const slot of slotCombo) {
					choices = choices.flatMap(prefix => bySlot.get(slot)!.map(piece => [...prefix, piece]));
				}

				for (const combo of choices) {
					if (candidates.filter(c => c.kind === 'bundle').length >= MAX_BUNDLES) {
						bundlesTruncated++;
						continue;
					}
					const itemIds = combo.map(piece => piece.itemId);
					candidates.push({
						key: `bundle:${setId}:${itemIds.join('-')}`,
						kind: 'bundle',
						itemIds,
						placements: combo.map(piece => ({ slot: piece.slot, itemId: piece.itemId })),
						label: `${combo.map(piece => piece.name).join(' + ')}`,
						slotLabel: combo.map(piece => slotLabel(piece.slot)).join(' + '),
						replaces: describeReplaced(db, gear, combo.map(piece => piece.slot)),
						group: `bundle:${setId}:${itemIds.join('-')}`,
						warnings: [`Completes ${current + size}pc ${setName}.`],
					});
				}
			}
		}
	}

	return { candidates, skipped, bundlesTruncated };
}