import { describe, expect, it } from 'vitest';

import { ItemSlot, Stat } from '../shared/wow.js';
import { hitDistance, hitFixVariants } from '../server/bench.js';
import type { Config } from '../server/config.js';
import { applyGemPolicy, gearHitRating } from '../server/gearing.js';
import { placeItems } from '../server/candidates.js';
import { RunManager } from '../server/run.js';
import { baseConfig, db, profile } from './fixture.js';

const MELEE_HIT = Stat.MeleeHitRating;

// Two phase-3 rings the demo warrior does not wear: one carries hit, one doesn't.
const RING_WITH_HIT = 32266; // Ring of Deceitful Intent (+19 hit)
const RING_NO_HIT = 32526; // Band of Devastation (AP/haste, no hit)
const BAND_OF_THE_ABYSSAL_LORD = 32261; // +21 hit

const target = gearHitRating(db, profile.equipment, MELEE_HIT);
const settle = (placements: { slot: ItemSlot; itemId: number }[], config: Config = baseConfig, hitTarget = target) =>
	applyGemPolicy(db, placeItems(db, profile.equipment, placements, config).gear, config, MELEE_HIT, hitTarget).hitRating;

describe('bench hit fixes', () => {
	it('offers nothing when there is no bench', () => {
		expect(hitFixVariants(db, profile.equipment, [], [], baseConfig, MELEE_HIT, target)).toEqual([]);
	});

	it('offers nothing when gems already land within tolerance of the target', () => {
		// The demo gear is exactly on its own hit rating by definition.
		expect(hitFixVariants(db, profile.equipment, [], [RING_NO_HIT, RING_WITH_HIT], baseConfig, MELEE_HIT, target)).toEqual([]);
	});

	it('offers a bench swap when the target is out of reach with gems alone', () => {
		// Demand far more hit than the gear and its sockets can supply.
		const stretch = target + 300;
		const variants = hitFixVariants(db, profile.equipment, [], [RING_WITH_HIT, RING_NO_HIT], baseConfig, MELEE_HIT, stretch);

		expect(variants.length).toBeGreaterThan(0);
		// Every offered swap must actually get closer to the target than doing nothing.
		const baseDistance = hitDistance(settle([], baseConfig, stretch), stretch);
		for (const variant of variants) {
			expect(hitDistance(variant.hitRating, stretch)).toBeLessThan(baseDistance);
		}
	});

	it('adds hit when short and describes the direction', () => {
		const stretch = target + 300;
		const [best] = hitFixVariants(db, profile.equipment, [], [RING_WITH_HIT, RING_NO_HIT], baseConfig, MELEE_HIT, stretch);
		expect(best!.note).toMatch(/adds hit/);
		expect(best!.hitRating).toBeGreaterThan(settle([], baseConfig, stretch));
	});

	it('sheds hit when over target, without dropping under it', () => {
		// Aim well below what the gear carries so the surplus must come off.
		const low = Math.max(0, target - 60);
		const variants = hitFixVariants(db, profile.equipment, [], [RING_NO_HIT, RING_WITH_HIT], baseConfig, MELEE_HIT, low);

		for (const variant of variants) {
			expect(variant.note).toMatch(/sheds hit/);
			expect(variant.hitRating).toBeGreaterThanOrEqual(low);
		}
	});

	it('never places a bench item in a slot the candidate is taking', () => {
		const candidate = [{ slot: ItemSlot.Finger1, itemId: RING_WITH_HIT }];
		const variants = hitFixVariants(db, profile.equipment, candidate, [RING_NO_HIT], baseConfig, MELEE_HIT, target + 300);
		for (const variant of variants) {
			const benchPlacement = variant.placements.at(-1)!;
			expect(benchPlacement.slot).not.toBe(ItemSlot.Finger1);
		}
	});

	it('leaves the off hand alone when the candidate is a two-hander', () => {
		const twoHander = [{ slot: ItemSlot.MainHand, itemId: 30902 }]; // Cataclysm's Edge
		const offHandBench = 32837; // Warglaive of Azzinoth (main hand of the pair)
		const variants = hitFixVariants(db, profile.equipment, twoHander, [offHandBench], baseConfig, MELEE_HIT, target + 300);
		for (const variant of variants) {
			expect(variant.placements.some(placement => placement.slot === ItemSlot.OffHand)).toBe(false);
		}
	});

	it('respects the configured cap on how many swaps are simmed', () => {
		const config: Config = { ...baseConfig, maxBenchVariants: 1 };
		const manyRings = [RING_WITH_HIT, RING_NO_HIT, 32527, 29301];
		const variants = hitFixVariants(db, profile.equipment, [], manyRings, config, MELEE_HIT, target + 300);
		expect(variants.length).toBeLessThanOrEqual(1);
	});
});

describe('bench swaps end to end', () => {
	it('sims the bench swap alongside the gem-only fix and reports which won', async () => {
		// Second ring slot emptied, so the bench ring filling it is unambiguously
		// better — and the hit target is set beyond what gems alone can reach.
		const stripped = { ...profile, equipment: profile.equipment.map((item, slot) => (slot === ItemSlot.Finger2 ? null : item)) };
		const config: Config = {
			...baseConfig,
			iterations: 3000,
			refineIterations: 3000,
			hitTarget: { mode: 'gearRating', gearRating: 320, totalPercent: 16, externalPercent: 0 },
		};

		const runs = new RunManager();
		runs.start({
			db,
			profile: stripped,
			config,
			selectedIds: [30969], // Onslaught Gauntlets
			benchIds: [BAND_OF_THE_ABYSSAL_LORD],
		});
		while (runs.getProgress().state === 'running') await new Promise(resolve => setTimeout(resolve, 200));

		const progress = runs.getProgress();
		expect(progress.state).toBe('done');
		expect(progress.failures).toEqual([]);

		const [row] = progress.results;
		expect(row!.benchNote).toMatch(/Band of the Abyssal Lord/);
		expect(row!.benchNote).toMatch(/adds hit/);
		// The winning layout must be the one the note describes.
		expect(row!.gearHit).toBeGreaterThan(baseConfig.hitTolerance);
	}, 120_000);

	it('leaves the bench out of it when gems already reach the target', async () => {
		const config: Config = {
			...baseConfig,
			iterations: 3000,
			refineIterations: 3000,
			hitTarget: { mode: 'keepCurrent', gearRating: 0, totalPercent: 16, externalPercent: 0 },
		};

		const runs = new RunManager();
		runs.start({ db, profile, config, selectedIds: [30977], benchIds: [BAND_OF_THE_ABYSSAL_LORD, RING_NO_HIT] });
		while (runs.getProgress().state === 'running') await new Promise(resolve => setTimeout(resolve, 200));

		const progress = runs.getProgress();
		expect(progress.state).toBe('done');
		expect(progress.results.every(row => !row.benchNote)).toBe(true);
	}, 120_000);
});
