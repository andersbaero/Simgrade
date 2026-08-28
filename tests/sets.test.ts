import { describe, expect, it } from 'vitest';

import { ItemSlot, WowClass } from '../shared/wow.js';
import { buildCandidates, placeItems } from '../server/candidates.js';
import type { Gear } from '../server/gearing.js';
import { describeEnchants, enchantApplies } from '../server/gearing.js';
import { breaksSetBonus, describeSetChanges, setsInGear } from '../server/sets.js';
import { baseConfig as config, db, profile } from './fixture.js';

// Warrior tier 6, "Onslaught Battlegear" (set 672).
const HELM = 30972;
const CHEST = 30975;
const GLOVES = 30969;
const LEGS = 30977;
const SHOULDERS = 30979; // already worn by the demo profile
const RING = 32526;
const TWO_HANDER = 30902; // Cataclysm's Edge (two-handed sword)


const place = (gear: Gear, placements: { slot: ItemSlot; itemId: number }[]) => placeItems(db, gear, placements, config).gear;

describe('set detection', () => {
	it('counts the tier pieces the character already wears', () => {
		const sets = setsInGear(db, profile.equipment);
		expect(sets.get(672)).toMatchObject({ setName: 'Onslaught Battlegear', pieces: 1 });
	});

	it('reports the bonuses gained when a swap crosses a threshold', () => {
		const after = place(profile.equipment, [
			{ slot: ItemSlot.Head, itemId: HELM },
			{ slot: ItemSlot.Chest, itemId: CHEST },
			{ slot: ItemSlot.Hands, itemId: GLOVES },
		]);
		expect(describeSetChanges(db, profile.equipment, after).join(' ')).toContain('1pc → 4pc');
		expect(describeSetChanges(db, profile.equipment, after).join(' ')).toContain('gains 2pc + 4pc');
	});

	it('flags a swap that drops a bonus the character currently has', () => {
		const fourPiece = place(profile.equipment, [
			{ slot: ItemSlot.Head, itemId: HELM },
			{ slot: ItemSlot.Chest, itemId: CHEST },
			{ slot: ItemSlot.Hands, itemId: GLOVES },
		]);
		// Swapping the shoulders back out for a non-tier piece drops 4pc to 3pc.
		const broken = place(fourPiece, [{ slot: ItemSlot.Shoulder, itemId: 32235 }]);
		expect(breaksSetBonus(db, fourPiece, broken)).toBe(true);
		expect(describeSetChanges(db, fourPiece, broken).join(' ')).toContain('LOSES 4pc');
	});
});

describe('candidate building', () => {
	it('skips an item the character already wears', () => {
		const { skipped } = buildCandidates(db, profile.equipment, [SHOULDERS], config);
		expect(skipped[0]).toMatchObject({ itemId: SHOULDERS, reason: 'already equipped' });
	});

	it('offers a ring in both ring slots as separate variants of one item', () => {
		const { candidates } = buildCandidates(db, profile.equipment, [RING], config);
		const slots = candidates.map(candidate => candidate.placements[0]!.slot).sort();
		expect(slots).toEqual([ItemSlot.Finger1, ItemSlot.Finger2]);
		expect(new Set(candidates.map(candidate => candidate.group)).size).toBe(1);
	});

	it('builds bundles that land exactly on a set bonus threshold', () => {
		// One piece worn, so only three-piece bundles reach 4pc.
		const { candidates } = buildCandidates(db, profile.equipment, [HELM, CHEST, GLOVES, LEGS], config);
		const bundles = candidates.filter(candidate => candidate.kind === 'bundle');
		expect(bundles.length).toBe(4); // choose 3 of 4
		expect(bundles.every(bundle => bundle.itemIds.length === 3)).toBe(true);
		expect(bundles[0]!.warnings.join(' ')).toContain('Completes 4pc');
	});

	it('unequips the off hand when a two-hander goes into the main hand', () => {
		expect(profile.equipment[ItemSlot.OffHand]).not.toBeNull();
		const { gear, warnings } = placeItems(db, profile.equipment, [{ slot: ItemSlot.MainHand, itemId: TWO_HANDER }], config);
		expect(gear[ItemSlot.OffHand]).toBeNull();
		expect(warnings.join(' ')).toContain('unequips');
	});

	it('starts a new item with empty sockets for the gem policy to fill', () => {
		const { gear } = placeItems(db, profile.equipment, [{ slot: ItemSlot.Chest, itemId: CHEST }], config);
		expect(gear[ItemSlot.Chest]!.gems).toEqual([0, 0, 0]);
	});
});

describe('class weapon proficiency', () => {
	it('keeps two-handers out of a rogue catalogue but leaves them for a warrior', () => {
		const rogue = db.catalog({ wowClass: WowClass.Rogue, equippedIds: new Set() });
		const warrior = db.catalog({ wowClass: WowClass.Warrior, equippedIds: new Set() });
		expect(rogue.some(item => item.id === TWO_HANDER)).toBe(false);
		expect(warrior.some(item => item.id === TWO_HANDER)).toBe(true);
	});

	it('only offers a relic type to the class that can hold it', () => {
		const idols = db.catalog({ wowClass: WowClass.Druid, equippedIds: new Set() }).filter(item => item.rangedWeaponType === 6);
		expect(idols.length).toBeGreaterThan(0);
		const warriorIdols = db.catalog({ wowClass: WowClass.Warrior, equippedIds: new Set() }).filter(item => item.rangedWeaponType === 6);
		expect(warriorIdols).toHaveLength(0);
	});

	it('never offers armour heavier or lighter than the class wears', () => {
		const mage = db.catalog({ wowClass: WowClass.Mage, equippedIds: new Set() });
		expect(mage.every(item => item.armorType === 0 || item.armorType === 1)).toBe(true);
	});
});

describe('bundle sizes reach every threshold', () => {
	it('builds a four-piece bundle when no piece of the set is worn', () => {
		// Shoulders removed, so the character wears 0 Onslaught pieces and only a
		// four-piece bundle can reach 4pc.
		const bare = profile.equipment.map((item, slot) => (slot === ItemSlot.Shoulder ? null : item));
		const { candidates } = buildCandidates(db, bare, [HELM, CHEST, GLOVES, LEGS], config);
		const bundles = candidates.filter(candidate => candidate.kind === 'bundle');
		const sizes = [...new Set(bundles.map(bundle => bundle.itemIds.length))].sort();

		expect(sizes).toEqual([2, 4]); // 2pc and 4pc thresholds, nothing in between
		expect(bundles.filter(bundle => bundle.itemIds.length === 4)).toHaveLength(1);
		expect(bundles.filter(bundle => bundle.itemIds.length === 2)).toHaveLength(6); // choose 2 of 4
		expect(bundles.find(bundle => bundle.itemIds.length === 4)!.warnings.join(' ')).toContain('Completes 4pc');
	});

	it('needs only three more pieces when one is already worn', () => {
		const { candidates } = buildCandidates(db, profile.equipment, [HELM, CHEST, GLOVES, LEGS], config);
		const bundles = candidates.filter(candidate => candidate.kind === 'bundle');
		expect([...new Set(bundles.map(bundle => bundle.itemIds.length))]).toEqual([3]);
	});
});

describe('stale selections from another character', () => {
	it('keeps items the class can use and drops the rest', () => {
		// Warrior plate and a bow, saved while a warrior profile was loaded.
		const stale = [HELM, CHEST, 32336];
		const warrior = db.partitionUsable(stale, WowClass.Warrior);
		expect(warrior.kept).toEqual(stale);
		expect(warrior.dropped).toEqual([]);

		const warlock = db.partitionUsable(stale, WowClass.Warlock);
		expect(warlock.kept).toEqual([]);
		expect(warlock.dropped.map(item => item.name)).toEqual([
			'Onslaught Battle-Helm',
			'Onslaught Breastplate',
			'Black Bow of the Betrayer',
		]);
	});

	it('reports an unknown item id rather than silently dropping it', () => {
		const { kept, dropped } = db.partitionUsable([999999], WowClass.Warrior);
		expect(kept).toEqual([]);
		expect(dropped).toEqual([{ id: 999999, name: 'item 999999' }]);
	});

	it('keeps a shared item that both classes can wear', () => {
		const ring = 32526; // Band of Devastation, no class restriction
		expect(db.partitionUsable([ring], WowClass.Warlock).kept).toEqual([ring]);
		expect(db.partitionUsable([ring], WowClass.Warrior).kept).toEqual([ring]);
	});
});

describe('armour proficiency is cumulative', () => {
	const INSIDIOUS_BANDS = 32324; // leather wrists, physical DPS stats

	it('lets a class wear its own armour type and everything lighter', () => {
		const bands = db.item(INSIDIOUS_BANDS)!;
		expect(bands.armorType).toBe(2); // leather
		expect(db.usableBy(WowClass.Rogue, bands)).toBe(true); // own type
		expect(db.usableBy(WowClass.Shaman, bands)).toBe(true); // mail wearer, leather is lighter
		expect(db.usableBy(WowClass.Warrior, bands)).toBe(true); // plate wearer
		expect(db.usableBy(WowClass.Warlock, bands)).toBe(false); // cloth cannot wear leather
	});

	it('offers cloth caster pieces to a mail wearer', () => {
		// Shamans routinely take cloth and leather caster gear for the stats.
		const cloth = db.catalog({ wowClass: WowClass.Shaman, equippedIds: new Set() }).filter(item => item.armorType === 1);
		expect(cloth.length).toBeGreaterThan(0);
	});

	it('still refuses armour heavier than the class can wear', () => {
		const plate = db.catalog({ wowClass: WowClass.Rogue, equippedIds: new Set() }).filter(item => item.armorType > 2);
		expect(plate).toHaveLength(0);
	});
});

describe('enchants on swapped-in items', () => {
	it('carries the replaced slot enchant onto every candidate that accepts it', () => {
		const enchanted = profile.equipment
			.map((spec, slot) => ({ spec, slot: slot as ItemSlot }))
			.filter(entry => entry.spec?.enchant);
		expect(enchanted.length).toBeGreaterThan(5);

		let checked = 0;
		for (const { spec, slot } of enchanted) {
			const candidate = db
				.catalog({ wowClass: profile.wowClass, equippedIds: new Set() })
				.find(item => item.slots.includes(slot) && item.phase === 3 && item.quality === 4);
			if (!candidate) continue;

			const { gear } = placeItems(db, profile.equipment, [{ slot, itemId: candidate.id }], config);
			if (enchantApplies(db, spec!.enchant!, db.item(candidate.id)!)) {
				expect(gear[slot]!.enchant).toBe(spec!.enchant);
				checked++;
			} else {
				// e.g. a weapon enchant onto a shield — genuinely cannot transfer,
				// and the row has to say so rather than look silently unenchanted.
				expect(gear[slot]!.enchant).toBeUndefined();
				expect(describeEnchants(db, [{ slot, itemId: candidate.id }], gear)[0]).toMatch(/left unenchanted/);
			}
		}
		expect(checked).toBeGreaterThan(5);
	});

	it('reports the enchant it applied, so a row never looks unenchanted', () => {
		const { gear } = placeItems(db, profile.equipment, [{ slot: ItemSlot.Head, itemId: HELM }], config);
		const notes = describeEnchants(db, [{ slot: ItemSlot.Head, itemId: HELM }], gear);
		expect(notes[0]).toMatch(/Head: Onslaught Battle-Helm (enchanted with|left unenchanted)/);
	});
});
