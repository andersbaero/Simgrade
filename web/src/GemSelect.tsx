import { useCallback } from 'react';

import { GemColor, gemMatchesSocket } from '../../shared/wow';
import { SOCKET_CSS } from './labels';
import { searchAll } from './search';
import type { GemOption } from './types';
import { useCombobox } from './useCombobox';

const COLOUR_ORDER = [GemColor.Red, GemColor.Yellow, GemColor.Blue, GemColor.Orange, GemColor.Purple, GemColor.Green, GemColor.Prismatic];

interface Props {
	value: number;
	gems: GemOption[];
	socketColor: GemColor;
	onChange: (gemId: number) => void;
}

export default function GemSelect({ value, gems, socketColor, onChange }: Props) {
	const wantsMeta = socketColor === GemColor.Meta;
	const selected = gems.find(gem => gem.id === value);
	const losesBonus = !wantsMeta && selected && !gemMatchesSocket(selected.color as GemColor, socketColor);

	const computeMatches = useCallback(
		(query: string) => {
			// Meta gems and meta sockets go together; every other colour fits anywhere.
			const pool = gems.filter(gem => (gem.color === GemColor.Meta) === wantsMeta);

			// With no query the list keeps its colour grouping; while searching, the
			// best matches come first regardless of colour.
			const byColour = (a: GemOption, b: GemOption) =>
				COLOUR_ORDER.indexOf(a.color) - COLOUR_ORDER.indexOf(b.color) || b.quality - a.quality || a.name.localeCompare(b.name);
			const byQuality = (a: GemOption, b: GemOption) => b.quality - a.quality || a.name.localeCompare(b.name);

			return searchAll(pool, gem => ({ name: gem.name, extras: [gem.stats, gem.colorName] }), query, query.trim() ? byQuality : byColour);
		},
		[gems, wantsMeta],
	);

	const nav = useCombobox<GemOption>(computeMatches, gem => onChange(gem.id));
	const matches = nav.matches;
	const grouped = !nav.query.trim();
	let lastColour: number | null = null;

	return (
		<div className="combo" ref={nav.rootRef}>
			<input
				value={nav.open ? nav.query : (selected?.name ?? '')}
				placeholder={selected ? selected.name : '— none — (type to search)'}
				{...nav.inputProps}
			/>
			{selected && !nav.open && <div className="small muted combo-sub">{selected.stats}</div>}
			{losesBonus && !nav.open && (
				<div className="small combo-sub" style={{ color: 'var(--warn)' }}>
					off-colour — forfeits the socket bonus
				</div>
			)}

			{nav.open && (
				<div className="combo-list" ref={nav.listRef}>
					<div
						className="combo-option"
						onMouseDown={event => event.preventDefault()}
						onClick={() => {
							onChange(0);
							nav.close();
						}}>
						<span className="muted">— none —</span>
					</div>
					{matches.length === 0 && <div className="combo-empty">No gem matches “{nav.query}”.</div>}
					{matches.map((gem, index) => {
						const header = grouped && gem.color !== lastColour ? gem.colorName : null;
						lastColour = gem.color;
						return (
							<div key={gem.id}>
								{header && <div className="combo-group">{header}</div>}
								<div
									className="combo-option"
									data-active={index === nav.highlight}
									onMouseEnter={() => nav.setHighlight(index)}
									onMouseDown={event => event.preventDefault()}
									onClick={() => nav.choose(gem)}>
									<span className="socket" style={{ background: SOCKET_CSS[gem.color] ?? '#8a7fbf' }} />
									<span className={gem.id === value ? 'combo-chosen' : undefined}>{gem.name}</span>
									<span className="muted small"> {gem.stats}</span>
									{gem.jewelcrafting && <span className="tag">JC</span>}
									{gem.unique && <span className="tag">unique</span>}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
