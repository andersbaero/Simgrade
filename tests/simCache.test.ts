// The sim cache is keyed on the wowsims release as well as the request. Without
// that, bumping the pin keeps serving numbers the old engine produced, and a
// single ranked table can mix results from two engines with nothing to show for
// it — the cached file records only value, stdev and iterations.

import { describe, expect, it } from 'vitest';

import { cacheKey } from '../server/simRunner.js';
import { withEquipment } from '../server/profile.js';
import { profile } from './fixture.js';

const request = withEquipment(profile, profile.equipment, { iterations: 30000, randomSeed: 19700101 });
const OLD = 'v0.0.121';
const NEW = 'v0.0.126';

describe('sim cache key', () => {
	it('is stable for the same request, metric and engine', () => {
		expect(cacheKey(request, 'dps', OLD)).toBe(cacheKey(request, 'dps', OLD));
	});

	it('changes when the wowsims pin moves', () => {
		// The whole point: a pin bump must miss the cache rather than serve a
		// number the new engine would not produce.
		expect(cacheKey(request, 'dps', NEW)).not.toBe(cacheKey(request, 'dps', OLD));
	});

	it('still separates metrics and requests', () => {
		const other = withEquipment(profile, profile.equipment, { iterations: 100000, randomSeed: 19700101 });
		expect(cacheKey(request, 'hps', OLD)).not.toBe(cacheKey(request, 'dps', OLD));
		expect(cacheKey(other, 'dps', OLD)).not.toBe(cacheKey(request, 'dps', OLD));
	});

	it('is a 32-character hex name, safe as a filename', () => {
		expect(cacheKey(request, 'dps', OLD)).toMatch(/^[0-9a-f]{32}$/);
	});
});
