import { useMemo } from 'react';

import ItemSearch from './ItemSearch';
import ItemTable from './ItemTable';
import { useCatalog, useScope } from './ItemPicker';
import type { CandidateItem, ProfileSummary } from './types';

interface Props {
	bench: number[];
	profile: ProfileSummary | null;
	onBenchChange: (ids: number[]) => void;
}

/**
 * Items you own but don't wear, offered to the solver only as a way to land on
 * the hit target — never as upgrades in their own right.
 */
export default function BenchPanel({ bench, profile, onBenchChange }: Props) {
	const { items, error } = useCatalog();
	const scope = useScope('all');

	const selected = useMemo(() => new Set(bench), [bench]);
	const byId = useMemo(() => new Map((items ?? []).map(item => [item.id, item])), [items]);

	const toggle = (id: number) => {
		const next = new Set(bench);
		next.has(id) ? next.delete(id) : next.add(id);
		onBenchChange([...next]);
	};

	const chosen = useMemo(
		() =>
			bench
				.map(id => byId.get(id))
				.filter((item): item is CandidateItem => !!item)
				.sort((a, b) => (a.slots[0] ?? 0) - (b.slots[0] ?? 0) || b.ilvl - a.ilvl),
		[bench, byId],
	);

	if (error) return null;

	return (
		<div className="panel">
			<div className="row" style={{ justifyContent: 'space-between' }}>
				<h2 style={{ margin: 0 }}>Bag / bench items ({chosen.length})</h2>
				{chosen.length > 0 && (
					<button className="ghost" onClick={() => onBenchChange([])}>
						Clear all
					</button>
				)}
			</div>
			<p className="muted small" style={{ marginTop: 10 }}>
				Gear you own but aren't wearing — the spare ring without hit, the off-set helm you kept. These never compete as upgrades. They are only
				swapped in when a candidate item leaves you off your hit target and gems alone can't fix it: the run then sims both the gem-only fix and
				the bench swap, and reports whichever is better.
				{profile && ` Hit target: ${Math.round(profile.targetHit)} ${profile.hitStatName} rating.`}
			</p>

			{items && (
				<div className="row" style={{ alignItems: 'flex-end' }}>
					<ItemSearch
						items={scope.apply(items)}
						selected={selected}
						placeholder="Search the gear in your bags — e.g. “band”, “ring of”"
						onToggle={toggle}
						onAddMany={ids => onBenchChange([...new Set([...bench, ...ids])])}
					/>
					{scope.controls}
				</div>
			)}

			{chosen.length > 0 && <ItemTable items={chosen} onRemove={toggle} />}
		</div>
	);
}
