import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, PROFILE_CONFIG_KEYS } from '../server/config.js';
import { defaultLabel, profileId } from '../server/profiles.js';
import type { ParsedProfile } from '../server/profile.js';

const fake = (playerName: string, specKey: string, specLabel: string) =>
	({ playerName, spec: { key: specKey, label: specLabel } } as unknown as ParsedProfile);

describe('profile identity', () => {
	it('separates two characters that both export the name "Player"', () => {
		// The CLI export usually carries no real name, which is why the spec key
		// is part of the id — keying on name alone would merge these two.
		const hunter = fake('Player', 'hunter', 'Hunter');
		const warlock = fake('Player', 'warlock', 'Warlock');
		expect(profileId(hunter)).toBe('player-hunter');
		expect(profileId(warlock)).toBe('player-warlock');
		expect(profileId(hunter)).not.toBe(profileId(warlock));
	});

	it('is stable, so re-importing the same character updates rather than duplicates', () => {
		expect(profileId(fake('Player', 'hunter', 'Hunter'))).toBe(profileId(fake('Player', 'hunter', 'Hunter')));
	});

	it('separates two specs of the same character', () => {
		expect(profileId(fake('Grognak', 'dpsWarrior', 'DPS Warrior'))).not.toBe(profileId(fake('Grognak', 'protectionWarrior', 'Protection Warrior')));
	});

	it('survives names that are not url-safe', () => {
		expect(profileId(fake('Bærø the Bold!', 'mage', 'Mage'))).toBe('b-r-the-bold-mage');
		expect(profileId(fake('', '', ''))).toBe('character');
	});

	it('labels readably', () => {
		expect(defaultLabel(fake('Player', 'hunter', 'Hunter'))).toBe('Player — Hunter');
	});
});

describe('which settings follow the character', () => {
	it('keeps gear-dependent choices with the character', () => {
		for (const key of ['gems', 'defaultEnchants', 'hitTarget', 'hitStat', 'metric']) {
			expect(PROFILE_CONFIG_KEYS).toContain(key);
		}
	});

	it('leaves methodology shared, so it is set once', () => {
		for (const key of ['iterations', 'refineIterations', 'randomSeed', 'pinSeed', 'trySocketBonuses', 'checkForUpdates', 'deltaBasis']) {
			expect(PROFILE_CONFIG_KEYS).not.toContain(key);
		}
	});

	it('accounts for every setting exactly once', () => {
		// A key belonging to neither file would be silently unsaveable.
		const all = Object.keys(DEFAULT_CONFIG);
		for (const key of PROFILE_CONFIG_KEYS) expect(all).toContain(key);
		expect(new Set(PROFILE_CONFIG_KEYS).size).toBe(PROFILE_CONFIG_KEYS.length);
	});
});
