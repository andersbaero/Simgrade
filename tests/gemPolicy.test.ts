// These run against the real wowsims item database and the demo profile, so
// they exercise the same data the app uses rather than a toy fixture.

import { describe, expect, it } from 'vitest';

import { GemColor, ItemSlot, Stat } from '../shared/wow.js';
import { Config, suggestGems } from '../server/config.js';
import { applyGemPolicy, gearHitRating, metaGemActive } from '../server/gearing.js';
import { countGemColors, isMetaGemActive, metaDeficit } from '../server/metaGems.js';
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

describe('forcing an unmet meta gem', () => {
	const CHAOTIC_SKYFIRE = 34220; // requires at least 2 blue gems
	const SOVEREIGN_AMETHYST = 32211; // purple — counts as both red and blue
	const BRILLIANT_LIONSEYE = 32204; // yellow

	/**
	 * Gear with no blue socket anywhere and every other socket emptied — the case
	 * where a blue-hungry meta gem cannot be satisfied by normal socketing.
	 */
	const gearWithoutBlueSockets = () =>
		profile.equipment.map(item => {
			if (!item) return null;
			const dbItem = db.item(item.id);
			const sockets = dbItem ? db.sockets(dbItem) : [];
			if (sockets.includes(GemColor.Blue)) return null; // drop the item, not just its gems
			return { ...item, gems: sockets.map(color => (color === GemColor.Meta ? CHAOTIC_SKYFIRE : 0)) };
		});

	const configWith = (blueGem: number): Config => ({
		...baseConfig,
		gems: {
			meta: CHAOTIC_SKYFIRE,
			// Red gems in every socket colour, the way someone actually gems.
			normal: { red: BOLD_CRIMSON_SPINEL, yellow: BOLD_CRIMSON_SPINEL, blue: blueGem, prismatic: BOLD_CRIMSON_SPINEL },
			hit: { ...baseConfig.gems.hit },
		},
	});

	it('reports how many gems of each colour a meta gem still needs', () => {
		expect(metaDeficit(CHAOTIC_SKYFIRE, [GemColor.Red, GemColor.Red])).toEqual({ red: 0, yellow: 0, blue: 2 });
		expect(metaDeficit(CHAOTIC_SKYFIRE, [GemColor.Blue, GemColor.Purple])).toEqual({ red: 0, yellow: 0, blue: 0 });
	});

	it('handles "more X than Y" conditions too', () => {
		// Mystical Skyfire Diamond: more blue gems than yellow.
		expect(metaDeficit(25893, [GemColor.Yellow, GemColor.Yellow])).toEqual({ red: 0, yellow: 0, blue: 3 });
		expect(metaDeficit(25893, [GemColor.Blue])).toEqual({ red: 0, yellow: 0, blue: 0 });
	});

	it('forces the configured blue gem into other sockets until the meta activates', () => {
		const config = configWith(SOVEREIGN_AMETHYST);
		const gear = gearWithoutBlueSockets();
		// Precondition: nothing here would ever be socketed blue on its own.
		const socketColors = gear.flatMap(spec => (spec ? db.sockets(db.item(spec.id)!) : []));
		expect(socketColors).not.toContain(GemColor.Blue);

		const result = applyGemPolicy(db, gear, config, MELEE_HIT, 0);

		expect(metaGemActive(db, result.gear).active).toBe(true);
		expect(result.changes.some(change => change.description.includes('forced blue'))).toBe(true);
		expect(result.changes.some(change => change.toGemId === SOVEREIGN_AMETHYST)).toBe(true);
	});

	it('uses exactly the gem chosen in settings for the missing colour', () => {
		const config = configWith(SOVEREIGN_AMETHYST);
		const forced = applyGemPolicy(db, gearWithoutBlueSockets(), config, MELEE_HIT, 0).changes.filter(change =>
			change.description.includes('forced blue'),
		);
		expect(forced.length).toBeGreaterThan(0);
		expect(forced.every(change => change.toGemId === SOVEREIGN_AMETHYST)).toBe(true);
	});

	it('says so rather than guessing when the configured gem cannot satisfy the colour', () => {
		// A yellow gem chosen for the blue socket can never count as blue.
		const config = configWith(BRILLIANT_LIONSEYE);
		const result = applyGemPolicy(db, gearWithoutBlueSockets(), config, MELEE_HIT, 0);

		expect(metaGemActive(db, result.gear).active).toBe(false);
		expect(result.warnings.join(' ')).toMatch(/does not count as blue/);
	});

	it('leaves an already-satisfied meta gem alone', () => {
		const result = applyGemPolicy(db, profile.equipment, baseConfig, MELEE_HIT, 0);
		expect(result.changes.some(change => change.description.includes('forced'))).toBe(false);
	});
});
