// These run against the real wowsims item database and the demo profile, so
// they exercise the same data the app uses rather than a toy fixture.

import { describe, expect, it } from 'vitest';

import { GemColor, ItemSlot, Stat } from '../shared/wow.js';
import { Config, suggestGems } from '../server/config.js';
import { applyGemPolicy, gearHitRating, metaGemActive } from '../server/gearing.js';
import { countGemColors, isMetaGemActive } from '../server/metaGems.js';
import { baseConfig, db, profile } from './fixture.js';

const RELENTLESS_EARTHSTORM = 32409; // requires 2 red, 2 yellow, 2 blue
const RIGID_LIONSEYE = 32206; // yellow, +10 melee hit
const BOLD_CRIMSON_SPINEL = 32193; // red, +10 strength
const MELEE_HIT = Stat.MeleeHitRating;


describe('meta gem conditions', () => {
	it('counts a purple gem as both red and blue', () => {
		const counts = countGemColors([GemColor.Purple, GemColor.Purple]);
		expect(counts).toEqual({ red: 2, yellow: 0, blue: 2 });
	});

	it('activates Relentless Earthstorm Diamond only at 2 red / 2 yellow / 2 blue', () => {
		const twoOfEach = [GemColor.Red, GemColor.Red, GemColor.Yellow, GemColor.Yellow, GemColor.Blue, GemColor.Blue];
		expect(isMetaGemActive(RELENTLESS_EARTHSTORM, twoOfEach)).toBe(true);
		expect(isMetaGemActive(RELENTLESS_EARTHSTORM, twoOfEach.slice(0, 5))).toBe(false);
	});

	it('treats an unknown meta gem as always active', () => {
		expect(isMetaGemActive(999999, [])).toBe(true);
	});
});

describe('hit solver', () => {
	it('gears up to the target when the gear is short of it', () => {
		const start = gearHitRating(db, profile.equipment, MELEE_HIT);
		const target = start + 20;
		const result = applyGemPolicy(db, profile.equipment, baseConfig, MELEE_HIT, target);

		expect(result.hitRating).toBeGreaterThanOrEqual(target);
		expect(result.changes.length).toBeGreaterThan(0);
	});

	it('reclaims surplus hit gems but never drops below the target', () => {
		const start = gearHitRating(db, profile.equipment, MELEE_HIT);
		const geared = applyGemPolicy(db, profile.equipment, baseConfig, MELEE_HIT, start + 20);
		expect(geared.hitRating).toBeGreaterThanOrEqual(start + 20);

		// Feed the over-gemmed set back in with the original, lower target.
		const reclaimed = applyGemPolicy(db, geared.gear, baseConfig, MELEE_HIT, start);
		expect(reclaimed.hitRating).toBeGreaterThanOrEqual(start);
		expect(reclaimed.hitRating).toBeLessThan(geared.hitRating);
	});

	it('leaves gear alone when it is already exactly on target', () => {
		const start = gearHitRating(db, profile.equipment, MELEE_HIT);
		const result = applyGemPolicy(db, profile.equipment, baseConfig, MELEE_HIT, start);
		expect(result.hitRating).toBe(start);
		expect(result.changes).toHaveLength(0);
	});

	it('never deactivates an active meta gem, even when it cannot reach the target', () => {
		// The demo gear sits on exactly 2 blue (two purple gems). Offering a yellow
		// hit gem for blue sockets tempts the solver into breaking the meta.
		const config: Config = {
			...baseConfig,
			gems: { ...baseConfig.gems, hit: { ...baseConfig.gems.hit, blue: RIGID_LIONSEYE, red: RIGID_LIONSEYE } },
		};
		expect(metaGemActive(db, profile.equipment).active).toBe(true);

		const result = applyGemPolicy(db, profile.equipment, config, MELEE_HIT, 10_000);
		const after = metaGemActive(db, result.gear);

		expect(after.metaGemId).toBe(RELENTLESS_EARTHSTORM);
		expect(after.active).toBe(true);
		expect(result.notes.join(' ')).toMatch(/short of target/);
	});

	it('fills the sockets of a freshly equipped item', () => {
		// Onslaught Breastplate has three empty sockets when it arrives.
		const gear = profile.equipment.map(item => (item ? { ...item } : null));
		gear[4] = { id: 30975, gems: [0, 0, 0] };
		const result = applyGemPolicy(db, gear, baseConfig, MELEE_HIT, 0);
		expect(result.gear[4]!.gems!.every(id => id > 0)).toBe(true);
	});
});

describe('gem suggestions', () => {
	it('reads the normal gems from what the character already wears', () => {
		const suggested = suggestGems(db, profile, 'melee');
		expect(suggested.meta).toBe(RELENTLESS_EARTHSTORM);
		expect(db.gem(suggested.normal.red)?.color).toBe(GemColor.Red);
	});

	it('picks a hit gem that matches the socket colour', () => {
		const suggested = suggestGems(db, profile, 'melee');
		expect(suggested.hit.yellow).toBe(RIGID_LIONSEYE);
		// No pure melee-hit blue gem exists in TBC, so blue must stay unset.
		expect(suggested.hit.blue).toBe(0);
	});
});

describe('off-colour gems', () => {
	it('places a red gem in a yellow socket when that is what is configured', () => {
		const config: Config = {
			...baseConfig,
			gems: { ...baseConfig.gems, normal: { ...baseConfig.gems.normal, yellow: BOLD_CRIMSON_SPINEL } },
		};
		// Onslaught Battle-Helm: one meta socket and one yellow socket.
		const gear = profile.equipment.map(item => (item ? { ...item } : null));
		gear[ItemSlot.Head] = { id: 30972, gems: [0, 0] };

		const result = applyGemPolicy(db, gear, config, MELEE_HIT, 0);
		expect(result.gear[ItemSlot.Head]!.gems).toContain(BOLD_CRIMSON_SPINEL);
		expect(result.warnings.join(' ')).not.toMatch(/cannot go in/);
	});

	it('says which items lost their socket bonus to an off-colour gem', () => {
		// Onslaught Shoulderblades has a yellow socket and a socket bonus, so a
		// red gem there is exactly the trade-off that should be reported.
		const config: Config = {
			...baseConfig,
			gems: { ...baseConfig.gems, normal: { ...baseConfig.gems.normal, yellow: BOLD_CRIMSON_SPINEL } },
		};
		const gear = profile.equipment.map(item => (item ? { ...item, gems: [0, 0] } : null));

		const result = applyGemPolicy(db, gear, config, MELEE_HIT, 0);
		expect(result.notes.join(' ')).toMatch(/Socket bonus not earned on .*Shoulder/);
	});

	it('refuses to put a non-meta gem in a meta socket', () => {
		const config: Config = { ...baseConfig, gems: { ...baseConfig.gems, meta: BOLD_CRIMSON_SPINEL } };
		const gear = profile.equipment.map(item => (item ? { ...item } : null));
		gear[ItemSlot.Head] = { id: 30972, gems: [0, 0] };

		const result = applyGemPolicy(db, gear, config, MELEE_HIT, 0);
		expect(result.gear[ItemSlot.Head]!.gems![0]).toBe(0);
		expect(result.warnings.join(' ')).toMatch(/is not a meta gem/);
	});

	it('lets an off-colour hit gem count toward the hit target', () => {
		// Rigid Lionseye is yellow; offering it for red sockets must still work.
		const config: Config = {
			...baseConfig,
			gems: { ...baseConfig.gems, hit: { ...baseConfig.gems.hit, red: RIGID_LIONSEYE } },
		};
		const start = gearHitRating(db, profile.equipment, MELEE_HIT);
		const result = applyGemPolicy(db, profile.equipment, config, MELEE_HIT, start + 40);

		expect(result.hitRating).toBeGreaterThan(start);
		expect(result.changes.some(change => change.toGemId === RIGID_LIONSEYE)).toBe(true);
	});
});

describe('gem defaults from actual socket usage', () => {
	it('reads the default for a socket colour from what sits in those sockets', () => {
		const gear = profile.equipment.map(item => (item ? { ...item, gems: item.gems ? [...item.gems] : undefined } : null));
		// Force a red gem into every yellow socket, then re-derive the defaults.
		for (const spec of gear) {
			const item = spec ? db.item(spec.id) : undefined;
			if (!spec || !item) continue;
			db.sockets(item).forEach((color, idx) => {
				if (color === GemColor.Yellow && spec.gems) spec.gems[idx] = BOLD_CRIMSON_SPINEL;
			});
		}

		const suggested = suggestGems(db, { ...profile, equipment: gear }, 'melee');
		expect(suggested.normal.yellow).toBe(BOLD_CRIMSON_SPINEL);
	});
});
