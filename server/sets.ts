// Tier set awareness. Set bonuses in TBC come from the five armour slots
// (sim/core/item_sets.go DefaultItemSetSlots) at 2 and 4 pieces, so a single
// tier swap can be a DPS *loss* by dropping you under a threshold while two
// swaps together are a large gain. Bundles exist to surface that.

import { ItemSlot, TIER_SLOTS } from '../shared/wow.js';
import type { Gear } from './gearing.js';
import { ItemDatabase } from './itemDb.js';

export const SET_BONUS_THRESHOLDS = [2, 4];

export interface SetState {
	setId: number;
	setName: string;
	pieces: number;
	slots: ItemSlot[];
}

/** How many pieces of each set the gear currently wears, counting tier slots only. */
export function setsInGear(db: ItemDatabase, gear: Gear): Map<number, SetState> {
	const out = new Map<number, SetState>();
	for (const slot of TIER_SLOTS) {
		const spec = gear[slot];
		if (!spec) continue;
		const item = db.item(spec.id);
		if (!item?.setId || !item.setName) continue;

		const existing = out.get(item.setId);
		if (existing) {
			existing.pieces += 1;
			existing.slots.push(slot);
		} else {
			out.set(item.setId, { setId: item.setId, setName: item.setName, pieces: 1, slots: [slot] });
		}
	}
	return out;
}

export const activeBonuses = (pieces: number): number[] => SET_BONUS_THRESHOLDS.filter(threshold => pieces >= threshold);

/**
 * Describes how a gear change moved every set's piece count, e.g.
 * "4pc Lightbringer Battlegear → 2pc (lost 4pc bonus)".
 */
export function describeSetChanges(db: ItemDatabase, before: Gear, after: Gear): string[] {
	const beforeSets = setsInGear(db, before);
	const afterSets = setsInGear(db, after);
	const notes: string[] = [];

	for (const setId of new Set([...beforeSets.keys(), ...afterSets.keys()])) {
		const was = beforeSets.get(setId)?.pieces ?? 0;
		const now = afterSets.get(setId)?.pieces ?? 0;
		if (was === now) continue;

		const name = afterSets.get(setId)?.setName ?? beforeSets.get(setId)?.setName ?? `set ${setId}`;
		const lost = activeBonuses(was).filter(threshold => !activeBonuses(now).includes(threshold));
		const gained = activeBonuses(now).filter(threshold => !activeBonuses(was).includes(threshold));

		let note = `${name}: ${was}pc → ${now}pc`;
		if (gained.length) note += ` (gains ${gained.map(t => `${t}pc`).join(' + ')})`;
		if (lost.length) note += ` (LOSES ${lost.map(t => `${t}pc`).join(' + ')})`;
		notes.push(note);
	}
	return notes;
}

/** True when the change drops a set bonus the character currently benefits from. */
export function breaksSetBonus(db: ItemDatabase, before: Gear, after: Gear): boolean {
	const beforeSets = setsInGear(db, before);
	const afterSets = setsInGear(db, after);
	for (const [setId, state] of beforeSets) {
		const now = afterSets.get(setId)?.pieces ?? 0;
		if (activeBonuses(state.pieces).some(threshold => !activeBonuses(now).includes(threshold))) return true;
	}
	return false;
}
