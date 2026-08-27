/**
 * Ranks a candidate against a search query. Lower is better, null means no match.
 *
 * Every whitespace-separated token must appear somewhere in the name or the
 * extra searchable fields, so tokens can be partial and in any order ("bold
 * spin", "hit yellow", "band champion").
 *
 * `loose` additionally allows each token to be a subsequence of the name, which
 * catches dropped or mistyped letters ("vld pyre" → Veiled Pyrestone, "mlefc
 * hood" → Hood of the Malefic). It is only used as a fallback by searchAll(),
 * because on its own it is far too eager — "void" is a subsequence of
 * "Vengeful Gladiator's Quickblade".
 */
export function rank(name: string, extras: string[], query: string, loose = false): number | null {
	const needle = query.trim().toLowerCase();
	if (!needle) return 0;

	const lowerName = name.toLowerCase();
	const haystack = [lowerName, ...extras.map(extra => extra.toLowerCase())].join(' ');
	const tokens = needle.split(/\s+/);

	if (tokens.every(token => haystack.includes(token))) {
		if (lowerName.startsWith(needle)) return 0;
		if (lowerName.includes(needle)) return 1;
		if (tokens.every(token => lowerName.includes(token))) return 2;
		return 3;
	}

	// Per token, so a fuzzy query still works with the words in any order:
	// "mlefc hood" finds "Hood of the Malefic".
	return loose && tokens.every(token => isSubsequence(lowerName, token)) ? 4 : null;
}

export interface Searchable {
	name: string;
	extras: string[];
}

/**
 * Ranks a list against a query, falling back to fuzzy matching only when
 * nothing matched properly. Results are ordered best-first; `tieBreak` decides
 * the order within an equal rank.
 */
export function searchAll<T>(items: T[], fields: (item: T) => Searchable, query: string, tieBreak: (a: T, b: T) => number): T[] {
	const run = (loose: boolean) =>
		items
			.map(item => {
				const { name, extras } = fields(item);
				return { item, score: rank(name, extras, query, loose) };
			})
			.filter((entry): entry is { item: T; score: number } => entry.score !== null);

	const strict = run(false);
	const ranked = strict.length > 0 || !query.trim() ? strict : run(true);
	return ranked.sort((a, b) => a.score - b.score || tieBreak(a.item, b.item)).map(entry => entry.item);
}

/** Characters of the query appear in order in the target, e.g. "bldcrim" → "Bold Crimson…". */
function isSubsequence(target: string, query: string): boolean {
	if (!query) return true;
	let index = 0;
	for (const char of target) {
		if (char === query[index]) index++;
		if (index === query.length) return true;
	}
	return false;
}
