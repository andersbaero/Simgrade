import { useCallback } from 'react';

import { QUALITY_CLASS, SLOT_NAMES } from './labels';
import { searchAll } from './search';
import type { CandidateItem } from './types';
import { useCombobox } from './useCombobox';

const MAX_RESULTS = 60;

export const slotsOf = (item: CandidateItem) => item.slots.map(slot => SLOT_NAMES[slot as keyof typeof SLOT_NAMES] ?? '').join(' / ');

interface Props {
	items: CandidateItem[];
	selected: Set<number>;
	placeholder: string;
	onToggle: (itemId: number) => void;
	onAddMany: (itemIds: number[]) => void;
}

/**
 * Search-to-add box shared by the sim list and the bench. Adding keeps the
 * dropdown open so several items can be added in a row; clicking something
 * already on the list removes it.
 */
export default function ItemSearch({ items, selected, placeholder, onToggle, onAddMany }: Props) {
	const computeMatches = useCallback(
		(query: string) =>
			searchAll(
				items,
				item => ({ name: item.name, extras: [item.setName, item.source, item.zone, slotsOf(item)] }),
				query,
				(a, b) => b.ilvl - a.ilvl || a.name.localeCompare(b.name),
			),
		[items],
	);

	const search = useCombobox<CandidateItem>(computeMatches, item => onToggle(item.id), { closeOnCommit: false });
	const shown = search.matches.slice(0, MAX_RESULTS);

	return (
		<>
			<div className="combo" ref={search.rootRef} style={{ flex: '1 1 340px', minWidth: 260 }}>
				<input value={search.query} placeholder={placeholder} {...search.inputProps} />
				{search.open && (
					<div className="combo-list" ref={search.listRef}>
						{shown.length === 0 && (
							<div className="combo-empty">
								{search.query.trim() ? `No item matches “${search.query}” in this phase/slot.` : 'No items match the current filters.'}
							</div>
						)}
						{shown.map((item, index) => (
							<div
								key={item.id}
								className="combo-option"
								data-active={index === search.highlight}
								onMouseEnter={() => search.setHighlight(index)}
								onMouseDown={event => event.preventDefault()}
								onClick={() => search.choose(item)}>
								<span className={QUALITY_CLASS[item.quality]}>{item.name}</span>
								<span className="muted small">
									{' '}
									· {slotsOf(item)} · ilvl {item.ilvl} · P{item.phase}
									{item.source ? ` · ${item.source}` : ''}
								</span>
								{item.setName && <span className="tag set">{item.setName}</span>}
								{selected.has(item.id) && <span className="tag added">✓ added</span>}
							</div>
						))}
						{search.matches.length > shown.length && (
							<div className="combo-empty">…and {search.matches.length - shown.length} more. Narrow the search or use “Add all”.</div>
						)}
					</div>
				)}
			</div>
			<button className="ghost" onClick={() => onAddMany(search.matches.map(item => item.id))} disabled={search.matches.length === 0}>
				Add all {search.matches.length}
			</button>
		</>
	);
}
