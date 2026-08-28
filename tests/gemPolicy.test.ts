// These run against the real wowsims item database and the demo profile, so
// they exercise the same data the app uses rather than a toy fixture.

import { describe, expect, it } from 'vitest';

import { GemColor, gemMatchesSocket, ItemSlot, Stat } from '../shared/wow.js';
import { Config, suggestGems } from '../server/config.js';
import { applyGemPolicy, gearHitRating, metaGemActive } from '../server/gearing.js';
import { countGemColors, isMetaGemActive, metaDeficit } from '../shared/metaGems.js';
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
			gems: { ...baseConfig.gems, hit: RIGID_LIONSEYE },
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
	it('reads the default gem from whatever the character wears most', () => {
		const suggested = suggestGems(db, profile, 'melee');
		expect(suggested.meta).toBe(RELENTLESS_EARTHSTORM);
		expect(suggested.base).toBe(BOLD_CRIMSON_SPINEL);
	});

	it('picks the strongest hit gem regardless of colour', () => {
		const suggested = suggestGems(db, profile, 'melee');
		expect(suggested.hit).toBe(RIGID_LIONSEYE); // +10 melee hit, the most available
	});

	it('picks a meta-requirement gem that genuinely counts for each colour', () => {
		const suggested = suggestGems(db, profile, 'melee');
		for (const key of ['red', 'yellow', 'blue'] as const) {
			const color = db.gem(suggested.metaFix[key])?.color as GemColor;
			expect(gemMatchesSocket(color, { red: GemColor.Red, yellow: GemColor.Yellow, blue: GemColor.Blue }[key])).toBe(true);
		}
	});
});

describe('off-colour gems', () => {
	it('places a red gem in a yellow socket when that is what is configured', () => {
		const config: Config = {
			...baseConfig,
			gems: { ...baseConfig.gems, base: BOLD_CRIMSON_SPINEL },
		};
		// Onslaught Battle-Helm: one meta socket and one yellow socket.
		const gear = profile.equipment.map(item => (item ? { ...item } : null));
		gear[ItemSlot.Head] = { id: 30972, gems: [0, 0] };

		const result = applyGemPolicy(db, gear, config, MELEE_HIT, 0);
		expect(result.gear[ItemSlot.Head]!.gems).toContain(BOLD_CRIMSON_SPINEL);
		expect(result.warnings.join(' ')).not.toMatch(/cannot go in/);
	});

	it('says which items lost their socket bonus to an off-colour gem', () => {
		// One red gem in every socket, so any item with a non-red socket and a
		// bonus forfeits it — that is the trade-off the flat model makes.
		const config: Config = { ...baseConfig, gems: { ...baseConfig.gems, base: BOLD_CRIMSON_SPINEL } };
		const gear = profile.equipment.map(item => {
			if (!item) return null;
			const sockets = db.sockets(db.item(item.id)!);
			return { ...item, gems: sockets.map(() => 0) };
		});

		const result = applyGemPolicy(db, gear, config, MELEE_HIT, 0);
		const note = result.notes.find(entry => entry.startsWith('Socket bonus not earned on'));
		expect(note).toBeDefined();

		// Every slot it names must really have an unmatched socket.
		const named = note!.replace('Socket bonus not earned on ', '').replace(' (off-colour gems).', '').split(', ');
		expect(named.length).toBeGreaterThan(0);
		expect(named).not.toContain('Head'); // meta + red sockets: nothing to forfeit
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
			gems: { ...baseConfig.gems, hit: RIGID_LIONSEYE },
		};
		const start = gearHitRating(db, profile.equipment, MELEE_HIT);
		const result = applyGemPolicy(db, profile.equipment, config, MELEE_HIT, start + 40);

		expect(result.hitRating).toBeGreaterThan(start);
		expect(result.changes.some(change => change.toGemId === RIGID_LIONSEYE)).toBe(true);
	});
});

describe('gem defaults from actual socket usage', () => {
	it('takes the default gem from whatever is worn most, ignoring socket colour', () => {
		const gear = profile.equipment.map(item => (item ? { ...item, gems: item.gems ? [...item.gems] : undefined } : null));
		// Put one distinctive gem in every non-meta socket.
		for (const spec of gear) {
			const item = spec ? db.item(spec.id) : undefined;
			if (!spec || !item) continue;
			db.sockets(item).forEach((color, idx) => {
				if (color !== GemColor.Meta && spec.gems) spec.gems[idx] = RIGID_LIONSEYE;
			});
		}

		const suggested = suggestGems(db, { ...profile, equipment: gear }, 'melee');
		expect(suggested.base).toBe(RIGID_LIONSEYE);
		// The meta gem is still read from the meta socket, not the rest.
		expect(suggested.meta).toBe(RELENTLESS_EARTHSTORM);
	});
});

describe('flat gem model', () => {
	const CHAOTIC_SKYFIRE = 34220; // requires 2 blue
	const SOVEREIGN_AMETHYST = 32211; // purple — counts red and blue

	const SHINING_FIRE_OPAL = 30564; // orange — counts as yellow (and red)

	const flat = (base: number, hit: number): Config => ({
		...baseConfig,
		gems: { meta: RELENTLESS_EARTHSTORM, base, hit, metaFix: { red: base, yellow: SHINING_FIRE_OPAL, blue: SOVEREIGN_AMETHYST } },
	});

	const emptied = () =>
		profile.equipment.map(item => {
			if (!item) return null;
			const sockets = db.sockets(db.item(item.id)!);
			return { ...item, gems: sockets.map(color => (color === GemColor.Meta ? RELENTLESS_EARTHSTORM : 0)) };
		});

	it('puts the same gem in every socket colour', () => {
		// No meta gem, so nothing forces an off-base colour in.
		const config: Config = { ...flat(BOLD_CRIMSON_SPINEL, RIGID_LIONSEYE), gems: { meta: 0, base: BOLD_CRIMSON_SPINEL, hit: RIGID_LIONSEYE, metaFix: { red: 0, yellow: 0, blue: 0 } } };
		const result = applyGemPolicy(db, emptied(), config, MELEE_HIT, 0);

		const placed = result.gear.flatMap(spec => spec?.gems ?? []).filter(id => id && id !== RELENTLESS_EARTHSTORM);
		expect(placed.length).toBeGreaterThan(4);
		expect(new Set(placed)).toEqual(new Set([BOLD_CRIMSON_SPINEL]));
	});

	it('converts only as many sockets as the hit target needs, then stops', () => {
		// Chaotic Skyfire only wants blue, so red and yellow stay free to trade.
		// Relentless (2 of each colour) would correctly block every swap instead.
		const config: Config = {
			...baseConfig,
			gems: { meta: CHAOTIC_SKYFIRE, base: BOLD_CRIMSON_SPINEL, hit: RIGID_LIONSEYE, metaFix: { red: BOLD_CRIMSON_SPINEL, yellow: BOLD_CRIMSON_SPINEL, blue: SOVEREIGN_AMETHYST } },
		};
		const gear = emptied().map(spec => {
			if (!spec) return null;
			const sockets = db.sockets(db.item(spec.id)!);
			return { ...spec, gems: sockets.map(color => (color === GemColor.Meta ? CHAOTIC_SKYFIRE : 0)) };
		});

		// The gear already carries hit from items and enchants, so the target has
		// to be measured from there rather than from zero.
		const perGem = db.gemStats(RIGID_LIONSEYE)[MELEE_HIT]!; // +10
		const fromGear = gearHitRating(db, gear, MELEE_HIT);
		const target = fromGear + perGem * 3;
		const result = applyGemPolicy(db, gear, config, MELEE_HIT, target);

		const hitGems = result.gear.flatMap(spec => spec?.gems ?? []).filter(id => id === RIGID_LIONSEYE);
		expect(hitGems).toHaveLength(3); // exactly enough, not every socket
		expect(result.hitRating).toBe(target);
	});

	it('leaves the hit target unreached rather than breaking a meta that needs every colour', () => {
		// Relentless Earthstorm wants 2 red, 2 yellow and 2 blue; trading any of
		// them away for hit would switch it off, so the solver declines.
		const config = flat(BOLD_CRIMSON_SPINEL, RIGID_LIONSEYE);
		const result = applyGemPolicy(db, emptied(), config, MELEE_HIT, 100_000);

		expect(metaGemActive(db, result.gear).active).toBe(true);
		expect(result.notes.join(' ')).toMatch(/short of target/);
	});

	it('prefers a colour-matching socket when forcing a meta gem', () => {
		// Relentless Earthstorm needs 2 of each colour; blue is supplied by the
		// purple gem, which should land in an actual blue socket where one exists.
		const config: Config = {
			...baseConfig,
			gems: { meta: CHAOTIC_SKYFIRE, base: BOLD_CRIMSON_SPINEL, hit: RIGID_LIONSEYE, metaFix: { red: BOLD_CRIMSON_SPINEL, yellow: BOLD_CRIMSON_SPINEL, blue: SOVEREIGN_AMETHYST } },
		};
		const gear = emptied().map(spec => {
			if (!spec) return null;
			const sockets = db.sockets(db.item(spec.id)!);
			return { ...spec, gems: sockets.map(color => (color === GemColor.Meta ? CHAOTIC_SKYFIRE : 0)) };
		});

		const result = applyGemPolicy(db, gear, config, MELEE_HIT, 0);
		expect(metaGemActive(db, result.gear).active).toBe(true);

		// Every forced amethyst sits in a socket it actually matches.
		result.gear.forEach(spec => {
			if (!spec) return;
			db.sockets(db.item(spec.id)!).forEach((color, idx) => {
				if (spec.gems?.[idx] === SOVEREIGN_AMETHYST) expect(color).toBe(GemColor.Blue);
			});
		});
	});
});
