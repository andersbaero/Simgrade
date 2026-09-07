// The addon export is a hand-rolled JSON blob from an in-game addon, not a
// protojson message, and nearly every case below is a shape it really emits
// rather than a hypothetical one. Ids are real, so slot assignment is exercised
// against the same item types the app sees.

import { describe, expect, it } from 'vitest';

import { ItemSlot, ItemSpec, Profession, WowClass } from '../shared/wow.js';
import { parseAddonExport, specFromTalents, talentPointsByTree, withAddonImport } from '../server/addonProfile.js';
import { ProfileError } from '../server/profile.js';
import { db, profile } from './fixture.js';

const HEAD = 32235; // Cursed Vision of Sargeras — meta + blue socket
const CHEST = 30905; // Midnight Chestguard — 3 sockets
const GLOVES = 30969; // Onslaught Gauntlets — 1 socket
const RING_A = 32266; // Ring of Deceitful Intent
const RING_B = 32526; // Band of Devastation
const TRINKET_A = 32483; // The Skull of Gul'dan
const TRINKET_B = 32485; // Ashtongue Talisman of Valor
const TWO_HANDER = 30902; // Cataclysm's Edge
const ONE_HANDER = 30865; // Tracker's Blade
const SHIELD = 1168; // Skullflame Shield
const NOT_AN_ITEM = 99_999_999;

/** The demo warrior's real talents: 21 points Arms, 40 Fury. */
const FURY_TALENTS = '3400502130201-05050005505012050115';

const blob = (items: unknown[], extra: Record<string, unknown> = {}) => ({
	class: 'warrior',
	race: 'Orc',
	level: 70,
	talents: FURY_TALENTS,
	professions: [],
	gear: { items, version: 'v3.2.0' },
	...extra,
});

const parse = (items: unknown[], extra: Record<string, unknown> = {}) => parseAddonExport(blob(items, extra), db);

describe('addon gear parsing', () => {
	it('leaves the slots the addon never sent alone', () => {
		// Trailing empty slots are dropped by the addon, so the array is short.
		const parsed = parse([{ id: HEAD }]);
		expect(parsed.equipment[ItemSlot.Head]?.id).toBe(HEAD);
		expect(parsed.equipment.slice(1).every(spec => spec === null)).toBe(true);
	});

	it('does not let an interior null shift the items after it', () => {
		// Head, then nothing in neck/shoulder/back, then the chest.
		const parsed = parse([{ id: HEAD }, null, null, null, { id: CHEST }]);
		expect(parsed.equipment[ItemSlot.Head]?.id).toBe(HEAD);
		expect(parsed.equipment[ItemSlot.Chest]?.id).toBe(CHEST);
		expect(parsed.equipment[ItemSlot.Neck]).toBeNull();
	});

	it('ignores the version key nested inside gear', () => {
		// A duplicate "version" in here broke the upstream wowsims importer.
		expect(() => parse([{ id: HEAD }])).not.toThrow();
	});

	it('carries a random suffix through under either spelling', () => {
		expect(parse([{ id: HEAD, random_suffix: 1875 }]).equipment[ItemSlot.Head]?.randomSuffix).toBe(1875);
		expect(parse([{ id: HEAD, randomSuffix: 1875 }]).equipment[ItemSlot.Head]?.randomSuffix).toBe(1875);
	});

	it('leaves randomSuffix off an item that has none', () => {
		expect(parse([{ id: HEAD }]).equipment[ItemSlot.Head]).toEqual({ id: HEAD, gems: [0, 0] });
	});

	it('keeps the enchant when there is one', () => {
		expect(parse([{ id: HEAD, enchant: 3003 }]).equipment[ItemSlot.Head]?.enchant).toBe(3003);
	});
});

describe('gem normalisation', () => {
	it('pads a truncated gem list out to the real socket count', () => {
		// The addon stops emitting gems after the last filled socket; the gem
		// policy only fills a socket it can see is empty.
		const parsed = parse([null, null, null, null, { id: CHEST, gems: [32193] }]);
		expect(parsed.equipment[ItemSlot.Chest]?.gems).toEqual([32193, 0, 0]);
	});

	it('preserves a zero standing for a gap before a filled socket', () => {
		const parsed = parse([null, null, null, null, { id: CHEST, gems: [0, 32193] }]);
		expect(parsed.equipment[ItemSlot.Chest]?.gems).toEqual([0, 32193, 0]);
	});

	it('gives an unsocketed item no gems array', () => {
		expect(parse([{ id: RING_A }]).equipment[ItemSlot.Finger1]?.gems).toBeUndefined();
	});

	it('turns a null gem into an empty socket', () => {
		expect(parse([null, null, null, null, null, null, { id: GLOVES, gems: [null] }]).equipment[ItemSlot.Hands]?.gems).toEqual([0]);
	});
});

describe('slot assignment', () => {
	it('fills ring and trinket pairs in the order the addon listed them', () => {
		const parsed = parse([{ id: RING_A }, { id: RING_B }, { id: TRINKET_A }, { id: TRINKET_B }]);
		expect(parsed.equipment[ItemSlot.Finger1]?.id).toBe(RING_A);
		expect(parsed.equipment[ItemSlot.Finger2]?.id).toBe(RING_B);
		expect(parsed.equipment[ItemSlot.Trinket1]?.id).toBe(TRINKET_A);
		expect(parsed.equipment[ItemSlot.Trinket2]?.id).toBe(TRINKET_B);
	});

	it('puts a two-hander in the main hand and leaves the off hand empty', () => {
		const parsed = parse([{ id: TWO_HANDER }]);
		expect(parsed.equipment[ItemSlot.MainHand]?.id).toBe(TWO_HANDER);
		expect(parsed.equipment[ItemSlot.OffHand]).toBeNull();
	});

	it('splits a one-hander and an off-hand across both weapon slots', () => {
		const parsed = parse([{ id: ONE_HANDER }, { id: SHIELD }]);
		expect(parsed.equipment[ItemSlot.MainHand]?.id).toBe(ONE_HANDER);
		expect(parsed.equipment[ItemSlot.OffHand]?.id).toBe(SHIELD);
	});

	it('holds the slot of an item it cannot identify, so the next one cannot take it', () => {
		// The bug this guards: without holding Ring 1, the known ring below would
		// claim it and the ring really worn there would vanish unmentioned.
		const previous: (ItemSpec | null)[] = Array.from({ length: 17 }, () => null);
		previous[ItemSlot.Finger1] = { id: RING_A };

		const items: unknown[] = Array.from({ length: 12 }, () => null);
		items[ItemSlot.Finger1] = { id: NOT_AN_ITEM };
		items[ItemSlot.Finger2] = { id: RING_B };

		const parsed = parseAddonExport(blob(items), db, previous);
		expect(parsed.equipment[ItemSlot.Finger1]).toEqual({ id: RING_A });
		expect(parsed.equipment[ItemSlot.Finger2]?.id).toBe(RING_B);
		expect(parsed.skipped).toEqual([{ id: NOT_AN_ITEM, slot: ItemSlot.Finger1, reason: 'not in the item database' }]);
	});

	it('leaves an unidentifiable slot empty when nothing was worn there', () => {
		const parsed = parse([{ id: NOT_AN_ITEM }, { id: RING_A }]);
		expect(parsed.equipment[ItemSlot.Head]).toBeNull();
		expect(parsed.equipment[ItemSlot.Finger1]?.id).toBe(RING_A);
	});
});

describe('rejecting a blob that is not usable', () => {
	it('refuses anything without gear', () => {
		expect(() => parseAddonExport({ class: 'warrior' }, db)).toThrow(ProfileError);
	});

	it('refuses an unrecognised class', () => {
		expect(() => parseAddonExport(blob([{ id: HEAD }], { class: 'necromancer' }), db)).toThrow(/Unrecognised class/);
	});

	it('refuses a blob whose every item is unknown', () => {
		expect(() => parse([{ id: NOT_AN_ITEM }])).toThrow(/nothing to import/);
	});

	it('accepts a lower-case class name, which is what the addon sends', () => {
		expect(parse([{ id: HEAD }]).wowClass).toBe(WowClass.Warrior);
	});
});

describe('talents', () => {
	it('sums the points in each tree', () => {
		expect(talentPointsByTree(FURY_TALENTS)).toEqual([21, 40]);
	});

	it('reads the demo warrior as a DPS warrior', () => {
		// 21 Arms / 40 Fury — and the demo profile really is dpsWarrior.
		expect(specFromTalents(WowClass.Warrior, FURY_TALENTS)).toEqual(['dpsWarrior']);
		expect(profile.spec.key).toBe('dpsWarrior');
	});

	it('reads a protection-weighted spread as a protection warrior', () => {
		expect(specFromTalents(WowClass.Warrior, '11-11-55555')).toEqual(['protectionWarrior']);
	});

	it('accepts either feral sim for a feral druid', () => {
		expect(specFromTalents(WowClass.Druid, '1-99-1')).toEqual(['feralCatDruid', 'feralBearDruid']);
	});

	it('has no opinion about a class with only one spec', () => {
		expect(specFromTalents(WowClass.Warlock, '55-11-11')).toBeNull();
	});

	it('has no opinion about an even split, which is no evidence of a respec', () => {
		expect(specFromTalents(WowClass.Druid, '30-30-1')).toBeNull();
	});

	it('has no opinion when there is nothing to go on', () => {
		expect(specFromTalents(WowClass.Warrior, '000-000-000')).toBeNull();
		expect(specFromTalents(WowClass.Warrior, '')).toBeNull();
	});

	it('treats an empty or all-zero talent string as nothing sent', () => {
		// Overlaying it would quietly wipe a real spec.
		expect(parse([{ id: HEAD }], { talents: '--' }).talents).toBe('');
		expect(parse([{ id: HEAD }], { talents: '000-000-000' }).talents).toBe('');
		expect(parse([{ id: HEAD }], { talents: FURY_TALENTS }).talents).toBe(FURY_TALENTS);
	});
});

describe('professions', () => {
	it('reads them by name', () => {
		const parsed = parse([{ id: HEAD }], {
			professions: [
				{ name: 'Engineering', level: 375 },
				{ name: 'Jewelcrafting', level: 375 },
			],
		});
		expect(parsed.professions).toEqual([Profession.Engineering, Profession.Jewelcrafting]);
	});

	it('skips one it does not recognise rather than failing the import', () => {
		const parsed = parse([{ id: HEAD }], { professions: [{ name: 'Basketweaving', level: 1 }, { name: 'Mining', level: 375 }] });
		expect(parsed.professions).toEqual([Profession.Mining]);
	});
});

describe('overlaying onto a profile', () => {
	const addon = parse([{ id: HEAD }, null, null, null, { id: CHEST }], {
		professions: [
			{ name: 'Engineering', level: 375 },
			{ name: 'Mining', level: 375 },
		],
	});
	const request = withAddonImport(profile, addon);
	const player = request.raid!.parties![0]!.players![0]!;

	it('replaces the equipment', () => {
		expect(player.equipment!.items[ItemSlot.Head]).toMatchObject({ id: HEAD });
		expect(player.equipment!.items[ItemSlot.Chest]).toMatchObject({ id: CHEST });
		// An empty slot goes out as {}, the same shape withEquipment sends.
		expect(player.equipment!.items[ItemSlot.Neck]).toEqual({});
	});

	it('writes the talents and professions', () => {
		expect(player.talentsString).toBe(FURY_TALENTS);
		expect(player.profession1).toBe('Engineering');
		expect(player.profession2).toBe('Mining');
	});

	it('leaves the rotation, consumables, encounter and spec untouched', () => {
		// This is the guarantee the whole tool rests on: between one sim and the
		// next, only the gear differs.
		expect(player.rotation).toEqual(profile.player.rotation);
		expect(player.consumables).toEqual(profile.player.consumables);
		expect(player.dpsWarrior).toEqual(profile.player.dpsWarrior);
		expect(request.encounter).toEqual(profile.request.encounter);
		expect(request.simOptions).toEqual(profile.request.simOptions);
	});

	it('does not mutate the stored profile', () => {
		const before = JSON.stringify(profile.request);
		withAddonImport(profile, addon);
		expect(JSON.stringify(profile.request)).toBe(before);
	});

	it('leaves talents alone when the addon sent none', () => {
		const noTalents = parse([{ id: HEAD }], { talents: '--' });
		const overlaid = withAddonImport(profile, noTalents);
		expect(overlaid.raid!.parties![0]!.players![0]!.talentsString).toBe(profile.player.talentsString);
	});

	it('leaves professions alone when the addon sent none', () => {
		const overlaid = withAddonImport(profile, parse([{ id: HEAD }], { professions: [] }));
		const player2 = overlaid.raid!.parties![0]!.players![0]!;
		expect(player2.profession1).toBe(profile.player.profession1);
		expect(player2.profession2).toBe(profile.player.profession2);
	});
});
