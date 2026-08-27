import { describe, expect, it } from 'vitest';

import { rank, searchAll } from '../web/src/search';
import type { GemOption } from '../web/src/types';

const gem = (name: string, stats: string, colorName = 'Red', color = 2): GemOption => ({
	id: Math.abs([...name].reduce((hash, char) => hash * 31 + char.charCodeAt(0), 7)) % 100000,
	name,
	color,
	colorName,
	phase: 3,
	quality: 4,
	unique: false,
	jewelcrafting: false,
	stats,
});

const rankGem = (candidate: GemOption, query: string) => rank(candidate.name, [candidate.stats, candidate.colorName], query, true);

const BOLD = gem('Bold Crimson Spinel', '+10 Strength');
const RIGID = gem('Rigid Lionseye', '+10 Hit', 'Yellow', 4);
const GREAT = gem('Great Lionseye', '+10 Spell Hit', 'Yellow', 4);
const RUNED = gem('Runed Living Ruby', '+9 Spell Damage');

const best = (gems: GemOption[], query: string) =>
	searchAll(gems, candidate => ({ name: candidate.name, extras: [candidate.stats, candidate.colorName] }), query, (a, b) =>
		a.name.localeCompare(b.name),
	).map(candidate => candidate.name);

describe('gem search', () => {
	it('matches everything on an empty query', () => {
		expect(rankGem(BOLD, '')).toBe(0);
		expect(rankGem(BOLD, '   ')).toBe(0);
	});

	it('matches a partial word without the full name', () => {
		expect(best([BOLD, RIGID, RUNED], 'spin')).toEqual(['Bold Crimson Spinel']);
	});

	it('matches several partial words in any order', () => {
		expect(best([BOLD, RIGID, RUNED], 'spin bold')).toEqual(['Bold Crimson Spinel']);
		expect(best([BOLD, RIGID, RUNED], 'crim spinel')).toEqual(['Bold Crimson Spinel']);
	});

	it('is case-insensitive', () => {
		expect(rankGem(BOLD, 'BOLD CRIMSON')).not.toBeNull();
	});

	it('searches stats as well as names', () => {
		expect(best([BOLD, RIGID, RUNED], 'strength')).toEqual(['Bold Crimson Spinel']);
		expect(best([BOLD, RIGID, GREAT], 'spell hit')).toEqual(['Great Lionseye']);
	});

	it('searches by colour name', () => {
		expect(best([BOLD, RIGID], 'yellow')).toEqual(['Rigid Lionseye']);
	});

	it('still finds a gem from a typo or dropped letters', () => {
		expect(best([BOLD, RIGID, RUNED], 'bldcrim')).toEqual(['Bold Crimson Spinel']);
		expect(best([BOLD, RIGID, RUNED], 'rgdlion')).toEqual(['Rigid Lionseye']);
	});

	it('ranks a name-prefix match above a mid-name match', () => {
		const midName = gem('Bold Rigid Curio', '+1 Strength');
		expect(best([midName, RIGID], 'rigid')).toEqual(['Rigid Lionseye', 'Bold Rigid Curio']);
	});

	it('ranks a name match above a stats-only match', () => {
		// RIGID only matches "hit" through its stats; the other gem matches by name.
		const named = gem('Hit Stone', '+3 Strength');
		expect(best([RIGID, named], 'hit')).toEqual(['Hit Stone', 'Rigid Lionseye']);
	});

	it('returns nothing when the query matches no gem', () => {
		expect(rankGem(BOLD, 'zzzzq')).toBeNull();
		expect(best([BOLD, RIGID, RUNED], 'thunderfury')).toEqual([]);
	});

	it('only falls back to fuzzy matching when nothing matched properly', () => {
		// "void" is a subsequence of "Vengeful Gladiator's Quickblade", so a
		// per-item fuzzy match would surface it next to a genuine hit.
		const voidCloak = gem('Nethervoid Cloak', '+20 Shadow Damage');
		const quickblade = gem("Vengeful Gladiator's Quickblade", '+30 Attack Power');
		expect(best([voidCloak, quickblade], 'void')).toEqual(['Nethervoid Cloak']);

		// With no real match, the fuzzy pass still rescues a mistyped name.
		expect(best([quickblade], 'vngflquick')).toEqual(["Vengeful Gladiator's Quickblade"]);
	});

	it('handles a fuzzy query with the words in any order', () => {
		const hood = gem('Hood of the Malefic', '+35 Spell Damage');
		expect(best([hood, BOLD], 'mlefc hood')).toEqual(['Hood of the Malefic']);
		expect(best([hood, BOLD], 'hood mlefc')).toEqual(['Hood of the Malefic']);
	});
});

describe('item search', () => {
	// Items search their name plus set, boss, zone and slot.
	const extras = (setName: string, source: string, zone: string, slot: string) => [setName, source, zone, slot];
	const gauntlets = () => rank('Onslaught Gauntlets', extras('Onslaught Battlegear', 'Tier token', '', 'Hands'), '');
	const score = (query: string) => rank('Onslaught Gauntlets', extras('Onslaught Battlegear', 'Tier token', '', 'Hands'), query);
	const bow = (query: string) => rank('Black Bow of the Betrayer', extras('', 'Illidan Stormrage', 'Black Temple', 'Ranged'), query);

	it('matches on a partial item name', () => {
		expect(gauntlets()).toBe(0);
		expect(score('onsl')).toBe(0);
		expect(score('gaunt')).toBe(1);
	});

	it('finds every item from a boss or a raid name', () => {
		expect(bow('illidan')).not.toBeNull();
		expect(bow('black temple')).not.toBeNull();
	});

	it('finds tier pieces by their set name', () => {
		expect(score('battlegear')).not.toBeNull();
	});

	it('matches on the slot name', () => {
		expect(score('hands')).not.toBeNull();
	});

	it('survives dropped letters in the item name when nothing else matches', () => {
		expect(rank('Onslaught Gauntlets', [], 'onslght')).toBeNull();
		expect(rank('Onslaught Gauntlets', [], 'onslght', true)).not.toBeNull();
	});

	it('rejects a query that matches nothing', () => {
		expect(score('frostmourne')).toBeNull();
	});
});
