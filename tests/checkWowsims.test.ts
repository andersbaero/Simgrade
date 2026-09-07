// The session-start check duplicates a few lines of version comparison so it can
// run in a checkout with no node_modules. These tests are what stop that copy
// drifting away from the isNewer() the app itself uses.

import { describe, expect, it } from 'vitest';

import { isNewer } from '../server/updates.js';
// @ts-expect-error - a plain .mjs script with no type declarations, by design.
import { isNewerVersion } from '../scripts/check-wowsims.mjs';

const CASES: [string, string][] = [
	['v0.0.121', 'v0.0.126'], // the case that prompted this
	['0.0.121', '0.0.121'],
	['v0.0.126', 'v0.0.121'],
	['v0.0.9', 'v0.0.10'], // numeric, not lexicographic
	['v0.0.10', 'v0.0.9'],
	['v1.0.0', 'v0.9.9'],
	['v0.9.9', 'v1.0.0'],
	['', 'v0.0.126'],
	['v0.0.121', ''],
	['v0.0.121', 'nightly'],
];

describe('the session-start version check', () => {
	it('agrees with the app version comparison on every case', () => {
		for (const [current, latest] of CASES) {
			expect([current, latest, isNewerVersion(current, latest)]).toEqual([current, latest, isNewer(current, latest)]);
		}
	});

	it('spots the pin being behind', () => {
		expect(isNewerVersion('v0.0.121', 'v0.0.126')).toBe(true);
	});

	it('does not nag when the pin is current or ahead', () => {
		expect(isNewerVersion('v0.0.126', 'v0.0.126')).toBe(false);
		expect(isNewerVersion('v0.0.126', 'v0.0.121')).toBe(false);
	});

	it('refuses to guess at a tag it cannot parse, rather than crying wolf', () => {
		expect(isNewerVersion('v0.0.121', 'nightly')).toBe(false);
		expect(isNewerVersion('v0.0.121', undefined)).toBe(false);
	});

	it('importing the script does not run it', () => {
		// It is imported at the top of this file; if the guard were missing this
		// suite would make a network call on every run.
		expect(typeof isNewerVersion).toBe('function');
	});
});
