import { useEffect, useMemo, useState } from 'react';

import { api } from './api';
import ItemSearch from './ItemSearch';
import ItemTable from './ItemTable';
import { SLOT_NAMES } from './labels';
import type { CandidateItem, ProfileSummary } from './types';

interface Props {
	selection: number[];
	profile: ProfileSummary | null;
	onSelectionChange: (ids: number[]) => void;
}

export function useCatalog() {
	const [items, setItems] = useState<CandidateItem[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api
			.catalog()
			.then(response => setItems(response.items))
			.catch(err => setError((err as Error).message));
	}, []);

	return { items, error };
}

/** Phase and slot selects that scope what the search box looks at. */
export function useScope(defaultPhase = '3') {
	const [phase, setPhase] = useState(defaultPhase);
	const [slot, setSlot] = useState('all');

	const apply = (items: CandidateItem[]) =>
		items.filter(item => {
			if (item.equipped || item.quality < 3) return false;
			if (phase !== 'all' && item.phase !== Number(phase)) return false;
			if (slot !== 'all' && !item.slots.includes(Number(slot))) return false;
			return true;
		});

	const controls = (
		<>
			<label className="field">
				Phase
				<select value={phase} onChange={event => setPhase(event.target.value)}>
					<option value="all">All</option>
					{[1, 2, 3, 4, 5].map(value => (
						<option key={value} value={value}>
							Phase {value}
						</option>
					))}
				</select>
			</label>
			<label className="field">
				Slot
				<select value={slot} onChange={event => setSlot(event.target.value)}>
					<option value="all">All</option>
					{Object.entries(SLOT_NAMES).map(([id, name]) => (
						<option key={id} value={id}>
							{name}
						</option>
					))}
				</select>
			</label>
		</>
	);

	return { apply, controls };
}

export default function ItemPicker({ selection, profile, onSelectionChange }: Props) {
	const { items, error } = useCatalog();
	const scope = useScope('3');

	const selected = useMemo(() => new Set(selection), [selection]);
	const byId = useMemo(() => new Map((items ?? []).map(item => [item.id, item])), [items]);

	const toggle = (id: number) => {
		const next = new Set(selection);
		next.has(id) ? next.delete(id) : next.add(id);
		onSelectionChange([...next]);
	};

	const chosen = useMemo(
		() =>
			selection
				.map(id => byId.get(id))
				.filter((item): item is CandidateItem => !!item)
				.sort((a, b) => (a.slots[0] ?? 0) - (b.slots[0] ?? 0) || b.ilvl - a.ilvl),
		[selection, byId],
	);

	// Bundles are only generated for sets, so show what the current picks add up to.
	const setSummaries = useMemo(() => {
		const worn = new Map((profile?.sets ?? []).map(set => [set.setId, set]));
		const counts = new Map<number, { name: string; picked: number }>();
		for (const item of chosen) {
			if (!item.setId) continue;
			const entry = counts.get(item.setId) ?? { name: item.setName, picked: 0 };
			entry.picked += 1;
			counts.set(item.setId, entry);
		}
		return [...counts.entries()].map(([setId, entry]) => ({
			setId,
			name: entry.name,
			picked: entry.picked,
			wornPieces: worn.get(setId)?.pieces ?? 0,
		}));
	}, [chosen, profile]);

	if (error) return <div className="panel notice error">{error}</div>;
	if (!items) return <div className="panel muted">Loading item database…</div>;

	return (
		<>
			<div className="panel">
				<h2>Add items to sim</h2>
				<div className="row" style={{ alignItems: 'flex-end' }}>
					<ItemSearch
						items={scope.apply(items)}
						selected={selected}
						placeholder="Search items by name, set or boss — e.g. “onslaught”, “illidan”, “band”"
						onToggle={toggle}
						onAddMany={ids => onSelectionChange([...new Set([...selection, ...ids])])}
					/>
					{scope.controls}
				</div>
				<p className="small muted" style={{ marginBottom: 0, marginTop: 10 }}>
					Type to search, ↑↓ to move, Enter to add. The list stays open so you can add several in a row. Clicking an item already on the list
					removes it.
				</p>
			</div>

			<div className="panel">
				<div className="row" style={{ justifyContent: 'space-between' }}>
					<h2 style={{ margin: 0 }}>Items to sim ({chosen.length})</h2>
					{chosen.length > 0 && (
						<button className="ghost" onClick={() => onSelectionChange([])}>
							Clear all
						</button>
					)}
				</div>

				{setSummaries.length > 0 && (
					<div className="small muted" style={{ marginTop: 10 }}>
						{setSummaries.map(summary => (
							<div key={summary.setId}>
								<span className="tag set">{summary.name}</span>
								{summary.wornPieces} worn + {summary.picked} selected — bundles that reach a 2pc or 4pc bonus will be simmed alongside the
								single swaps.
							</div>
						))}
					</div>
				)}

				{chosen.length === 0 ? (
					<p className="muted" style={{ marginBottom: 0 }}>
						Nothing selected yet. Search above to add the items you want compared against your current gear.
					</p>
				) : (
					<ItemTable items={chosen} onRemove={toggle} />
				)}
			</div>
		</>
	);
}
