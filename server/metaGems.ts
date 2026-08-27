// Port of the meta gem activation rules from ui/core/proto_utils/gems.ts.
// These are hardcoded upstream too (they aren't in db.json), so this table is
// the one piece of wowsims logic we carry rather than read.

import { GemColor, gemMatchesSocket } from '../shared/wow.js';

interface MetaGemCondition {
	description: string;
	minRed: number;
	minYellow: number;
	minBlue: number;
	compareGreater: GemColor;
	compareLesser: GemColor;
}

function minColors(minRed: number, minYellow: number, minBlue: number, description: string): MetaGemCondition {
	return { description, minRed, minYellow, minBlue, compareGreater: GemColor.Unknown, compareLesser: GemColor.Unknown };
}

function compareColors(greater: GemColor, lesser: GemColor, description: string): MetaGemCondition {
	return { description, minRed: 0, minYellow: 0, minBlue: 0, compareGreater: greater, compareLesser: lesser };
}

const TWO_OF_EACH = 'Requires at least 2 Red Gems, at least 2 Yellow Gems, and at least 2 Blue Gems.';

export const META_GEM_CONDITIONS: Record<number, MetaGemCondition> = {
	25890: minColors(2, 2, 2, TWO_OF_EACH), // Destructive Skyfire Diamond
	25893: compareColors(GemColor.Blue, GemColor.Yellow, 'Requires more Blue Gems than Yellow Gems.'), // Mystical Skyfire
	25894: minColors(1, 2, 0, 'Requires at least 2 Yellow Gems and at least 1 Red Gem.'), // Swift Skyfire Diamond
	25895: compareColors(GemColor.Red, GemColor.Yellow, 'Requires more Red Gems than Yellow Gems.'), // Enigmatic Skyfire
	25896: minColors(0, 0, 3, 'Requires at least 3 Blue Gems.'), // Powerful Earthstorm Diamond
	25897: compareColors(GemColor.Red, GemColor.Blue, 'Requires more Red Gems than Blue Gems.'), // Bracing Earthstorm
	25898: minColors(0, 0, 5, 'Requires at least 5 Blue Gems.'), // Tenacious Earthstorm Diamond
	25899: minColors(2, 2, 2, TWO_OF_EACH), // Brutal Earthstorm Diamond
	25901: minColors(2, 2, 2, TWO_OF_EACH), // Insightful Earthstorm Diamond
	28556: minColors(1, 2, 0, 'Requires at least 2 Yellow Gems and at least 1 Red Gem.'), // Swift Windfire Diamond
	28557: minColors(1, 2, 0, 'Requires at least 2 Yellow Gems and at least 1 Red Gem.'), // Swift Starfire Diamond
	32409: minColors(2, 2, 2, TWO_OF_EACH), // Relentless Earthstorm Diamond
	32410: minColors(2, 2, 2, TWO_OF_EACH), // Thundering Skyfire Diamond
	32640: compareColors(GemColor.Blue, GemColor.Yellow, 'Requires more Blue Gems than Yellow Gems.'), // Potent Unstable
	32641: minColors(0, 3, 0, 'Requires at least 3 Yellow Gems.'), // Imbued Unstable Diamond
	34220: minColors(0, 0, 2, 'Requires at least 2 Blue Gems.'), // Chaotic Skyfire Diamond
	35501: minColors(0, 1, 2, 'Requires at least 2 Blue Gems and at least 1 Yellow Gem.'), // Eternal Earthstorm
	35503: minColors(3, 0, 0, 'Requires at least 3 Red Gems.'), // Ember Skyfire Diamond
};

export function metaGemConditionDescription(metaGemId: number): string {
	return META_GEM_CONDITIONS[metaGemId]?.description ?? '';
}

/** Counts a gem toward red/yellow/blue the way the sim does: purple counts as red AND blue. */
export function countGemColors(gemColors: GemColor[]): { red: number; yellow: number; blue: number } {
	return {
		red: gemColors.filter(c => gemMatchesSocket(c, GemColor.Red)).length,
		yellow: gemColors.filter(c => gemMatchesSocket(c, GemColor.Yellow)).length,
		blue: gemColors.filter(c => gemMatchesSocket(c, GemColor.Blue)).length,
	};
}

/**
 * Whether the meta gem is activated by the rest of the gem layout. Unknown meta
 * gems are treated as always-active, matching wowsims' fallback.
 */
export function isMetaGemActive(metaGemId: number, gemColors: GemColor[]): boolean {
	const cond = META_GEM_CONDITIONS[metaGemId];
	if (!cond) return true;

	const { red, yellow, blue } = countGemColors(gemColors);
	if (red < cond.minRed || yellow < cond.minYellow || blue < cond.minBlue) return false;
	if (cond.compareGreater === GemColor.Unknown) return true;

	const inCategory = (color: GemColor) => (color === GemColor.Red ? red : color === GemColor.Yellow ? yellow : blue);
	return inCategory(cond.compareGreater) > inCategory(cond.compareLesser);
}
