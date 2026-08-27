// "Bench" items: gear you own but do not wear, offered to the solver purely as
// a lever for hitting the hit target. They never compete as upgrades — a bench
// variant is only kept when it lands the gear closer to target than gems alone
// managed, and the sim then decides whether that trade is actually worth DPS.

import { eligibleItemSlots, HandType, ItemSlot } from '../shared/wow.js';
import { Placement, placeItems } from './candidates.js';
import type { Config } from './config.js';
import { applyGemPolicy, Gear } from './gearing.js';
import { ItemDatabase } from './itemDb.js';

export interface HitVariant {
	placements: Placement[];
	note: string;
	hitRating: number;
}

/** How far the gear sits from the hit target. Zero means exactly on it. */
export const hitDistance = (hit: number, target: number) => Math.abs(hit - target);

/**
 * Evaluates one gear layout: place the items, run the gem policy, report the
 * hit it settles on. No sim is involved, so this is cheap enough to run over
 * every bench option before deciding which are worth simming.
 */
function settleHit(db: ItemDatabase, baseGear: Gear, placements: Placement[], config: Config, hitIdx: number, target: number): number {
	const placed = placeItems(db, baseGear, placements, config);
	return applyGemPolicy(db, placed.gear, config, hitIdx, target).hitRating;
}

/**
 * Bench swaps worth simming alongside a candidate. Returns nothing when gems
 * alone already land within tolerance of the target, which is the common case.
 */
export function hitFixVariants(
	db: ItemDatabase,
	baseGear: Gear,
	candidatePlacements: Placement[],
	benchIds: number[],
	config: Config,
	hitIdx: number,
	target: number,
): HitVariant[] {
	if (!benchIds.length) return [];

	const baseHit = settleHit(db, baseGear, candidatePlacements, config, hitIdx, target);
	const baseDistance = hitDistance(baseHit, target);
	if (baseDistance <= config.hitTolerance) return [];

	const candidateGear = placeItems(db, baseGear, candidatePlacements, config).gear;
	const takenSlots = new Set(candidatePlacements.map(placement => placement.slot));
	// A two-hander in the main hand rules the off hand out entirely.
	const mainHand = candidateGear[ItemSlot.MainHand];
	if (mainHand && db.item(mainHand.id)?.handType === HandType.TwoHand) takenSlots.add(ItemSlot.OffHand);

	const equippedIds = new Set(candidateGear.filter(Boolean).map(spec => spec!.id));
	const options: HitVariant[] = [];

	for (const benchId of benchIds) {
		const benchItem = db.item(benchId);
		if (!benchItem || equippedIds.has(benchId)) continue;

		for (const slot of eligibleItemSlots({ type: benchItem.type ?? 0, handType: benchItem.handType })) {
			if (takenSlots.has(slot)) continue;

			const replaced = candidateGear[slot];
			if (replaced?.id === benchId) continue;

			const placements = [...candidatePlacements, { slot, itemId: benchId }];
			const hit = settleHit(db, baseGear, placements, config, hitIdx, target);
			const distance = hitDistance(hit, target);

			// Must genuinely close the gap, and must not solve an overshoot by
			// dropping under the target.
			if (distance >= baseDistance) continue;
			if (hit < target && baseHit >= target) continue;

			const replacedName = replaced ? (db.item(replaced.id)?.name ?? 'the equipped item') : 'an empty slot';
			const direction = baseHit > target ? 'sheds' : 'adds';
			options.push({
				placements,
				note: `Bench: ${benchItem.name} in for ${replacedName} — ${direction} hit (${Math.round(baseHit)} → ${Math.round(hit)}, target ${Math.round(target)}).`,
				hitRating: hit,
			});
		}
	}

	// Closest to target first, then keep only a couple so the sim count stays sane.
	return options
		.sort((a, b) => hitDistance(a.hitRating, target) - hitDistance(b.hitRating, target))
		.filter((option, index, all) => all.findIndex(other => other.note === option.note) === index)
		.slice(0, config.maxBenchVariants);
}
