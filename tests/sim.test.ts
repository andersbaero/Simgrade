// Integration tests against the real wowsimcli binary. They are cheap (a few
// thousand iterations each) and they are what prove the ranking is meaningful:
// if a fixed seed were not reproducible, small deltas would be meaningless.

import { describe, expect, it } from 'vitest';

import { ItemSlot } from '../shared/wow.js';
import { cliBinary } from '../server/paths.js';
import { withEquipment } from '../server/profile.js';
import { deltaConfidenceInterval, SimRunner } from '../server/simRunner.js';
import { profile } from './fixture.js';

const ITERATIONS = 3000;
const SEED = 19700101;

const runner = new SimRunner(cliBinary(), /* useCache */ false);
const sim = (seed: number, iterations = ITERATIONS) =>
	runner.run(withEquipment(profile, profile.equipment, { iterations, randomSeed: seed }), 'dps');

describe('sim runner', () => {
	it('is reproducible for a fixed seed', async () => {
		const [first, second] = [await sim(SEED), await sim(SEED)];
		expect(first.value).toBe(second.value);
		expect(first.iterations).toBe(ITERATIONS);
	}, 60_000);

	it('agrees across seeds to within the reported confidence interval', async () => {
		const [a, b] = [await sim(SEED), await sim(SEED + 1)];
		expect(Math.abs(a.value - b.value)).toBeLessThanOrEqual(deltaConfidenceInterval(a, b) * 2);
	}, 60_000);

	it('narrows the confidence interval as iterations rise', async () => {
		const [few, many] = [await sim(SEED, 2000), await sim(SEED, 20000)];
		expect(deltaConfidenceInterval(many, many)).toBeLessThan(deltaConfidenceInterval(few, few));
	}, 60_000);

	it('measures a real difference when gear changes', async () => {
		const stripped = profile.equipment.map((item, slot) => (slot === ItemSlot.MainHand ? null : item));
		const [base, noWeapon] = [await sim(SEED), await runner.run(withEquipment(profile, stripped, { iterations: ITERATIONS, randomSeed: SEED }), 'dps')];
		expect(noWeapon.value).toBeLessThan(base.value);
	}, 60_000);
});

describe('request construction', () => {
	it('changes only the equipment and sim options', () => {
		const swapped = profile.equipment.map((item, slot) => (slot === ItemSlot.Hands ? { id: 30969 } : item));
		const request = withEquipment(profile, swapped, { iterations: 123, randomSeed: 7 });
		const player = request.raid!.parties![0]!.players![0]!;

		expect(request.simOptions).toMatchObject({ iterations: 123, randomSeed: '7' });
		expect(player.equipment!.items[ItemSlot.Hands]).toEqual({ id: 30969 });
		// Talents, rotation and encounter must survive untouched.
		expect(player.talentsString).toBe(profile.player.talentsString);
		expect(request.encounter).toEqual(profile.request.encounter);
		expect(player.rotation).toEqual(profile.player.rotation);
	});

	it('does not mutate the stored profile', () => {
		const before = JSON.stringify(profile.request);
		withEquipment(profile, [], { iterations: 1, randomSeed: 1 });
		expect(JSON.stringify(profile.request)).toBe(before);
	});
});
