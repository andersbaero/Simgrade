import { Fragment, useEffect, useState } from 'react';

import { metaGemConditionDescription } from '../../shared/metaGems';
import { GemColor } from '../../shared/wow';
import { api } from './api';
import GemSelect from './GemSelect';
import { SOCKET_CSS } from './labels';
import type { AppConfig, GemOption, ProfileSummary } from './types';

interface Props {
	config: AppConfig;
	profile: ProfileSummary | null;
	onSaved: () => void;
}

const META_COLORS = [
	{ key: 'red', color: GemColor.Red, label: 'red', hint: 'Purple and orange gems count as red too.' },
	{ key: 'yellow', color: GemColor.Yellow, label: 'yellow', hint: 'Orange and green gems count as yellow too.' },
	{ key: 'blue', color: GemColor.Blue, label: 'blue', hint: 'Purple and green gems count as blue too.' },
] as const;

export default function ConfigPanel({ config, profile, onSaved }: Props) {
	const [draft, setDraft] = useState<AppConfig>(config);
	const [gems, setGems] = useState<GemOption[]>([]);
	const [saved, setSaved] = useState(false);
	const metaRequirement = metaGemConditionDescription(draft.gems.meta);

	useEffect(() => setDraft(config), [config]);
	useEffect(() => {
		api.gems().then(res => setGems(res.gems)).catch(() => undefined);
	}, []);

	const patch = (changes: Partial<AppConfig>) => setDraft(current => ({ ...current, ...changes }));

	const save = async () => {
		await api.saveConfig(draft);
		setSaved(true);
		setTimeout(() => setSaved(false), 1800);
		onSaved();
	};

	return (
		<>
			<div className="panel">
				<h2>Hit target</h2>
				<p className="muted small" style={{ marginTop: 0 }}>
					When a new item changes your hit, the gem policy trades gems between your normal and hit choices to land back on target. Going{' '}
					<em>over</em> the target matters as much as going under: surplus hit is reclaimed into normal gems, which is usually the largest hidden
					gain in a swap.
				</p>
				<div className="row">
					<label className="field">
						Mode
						<select
							value={draft.hitTarget.mode}
							onChange={event => patch({ hitTarget: { ...draft.hitTarget, mode: event.target.value as AppConfig['hitTarget']['mode'] } })}>
							<option value="keepCurrent">Keep at least my current gear hit</option>
							<option value="gearRating">Explicit gear hit rating</option>
							<option value="totalPercent">Total hit percentage</option>
						</select>
					</label>

					{draft.hitTarget.mode === 'gearRating' && (
						<label className="field">
							Gear hit rating
							<input
								type="number"
								value={draft.hitTarget.gearRating}
								onChange={event => patch({ hitTarget: { ...draft.hitTarget, gearRating: Number(event.target.value) } })}
							/>
						</label>
					)}

					{draft.hitTarget.mode === 'totalPercent' && (
						<>
							<label className="field">
								Total hit %
								<input
									type="number"
									step="0.1"
									value={draft.hitTarget.totalPercent}
									onChange={event => patch({ hitTarget: { ...draft.hitTarget, totalPercent: Number(event.target.value) } })}
								/>
							</label>
							<label className="field">
								Hit % from talents/buffs
								<input
									type="number"
									step="0.1"
									value={draft.hitTarget.externalPercent}
									onChange={event => patch({ hitTarget: { ...draft.hitTarget, externalPercent: Number(event.target.value) } })}
								/>
							</label>
						</>
					)}

					<label className="field">
						Hit stat
						<select value={draft.hitStat} onChange={event => patch({ hitStat: event.target.value })}>
							<option value="auto">Auto ({profile?.hitStat ?? 'from spec'})</option>
							<option value="melee">Melee/ranged hit</option>
							<option value="spell">Spell hit</option>
						</select>
					</label>
				</div>
				{profile && (
					<p className="small muted" style={{ marginBottom: 0 }}>
						Your gear currently has <strong style={{ color: 'var(--text)' }}>{Math.round(profile.gearHit)}</strong> {profile.hitStatName} rating;
						this run will target <strong style={{ color: 'var(--text)' }}>{Math.round(profile.targetHit)}</strong>.
					</p>
				)}
			</div>

			<div className="panel">
				<h2>Gems</h2>
				<p className="muted small" style={{ marginTop: 0 }}>
					One gem goes in every socket, whatever colour the socket is — that is how gemming actually works in TBC, where the raw gem beats the
					socket bonus almost every time. Any socket bonus given up is reported on each result row. Type in a picker to search every gem by name
					or stat; partial words are fine (“runed ruby”, “spell hit”). Defaults are read from what you already have socketed.
				</p>
				<div className="grid" style={{ gridTemplateColumns: 'minmax(150px, auto) 1fr 2fr', alignItems: 'start', rowGap: 14 }}>
					<div className="row" style={{ gap: 6, paddingTop: 7 }}>
						<span className="socket" style={{ background: SOCKET_CSS[GemColor.Red] }} />
						Default gem
					</div>
					<GemSelect value={draft.gems.base} gems={gems} socketColor={GemColor.Prismatic} onChange={id => patch({ gems: { ...draft.gems, base: id } })} />
					<div className="small muted" style={{ paddingTop: 7 }}>Goes in every socket unless something below overrides it.</div>

					<div className="row" style={{ gap: 6, paddingTop: 7 }}>
						<span className="socket" style={{ background: SOCKET_CSS[GemColor.Yellow] }} />
						When short on hit
					</div>
					<GemSelect value={draft.gems.hit} gems={gems} socketColor={GemColor.Prismatic} onChange={id => patch({ gems: { ...draft.gems, hit: id } })} />
					<div className="small muted" style={{ paddingTop: 7 }}>
						Swapped in over the default, one socket at a time, only until the hit target is reached — never further.
					</div>

					<div className="row" style={{ gap: 6, paddingTop: 7 }}>
						<span className="socket" style={{ background: SOCKET_CSS[GemColor.Meta] }} />
						Meta gem
					</div>
					<GemSelect value={draft.gems.meta} gems={gems} socketColor={GemColor.Meta} onChange={id => patch({ gems: { ...draft.gems, meta: id } })} />
					<div className="small muted" style={{ paddingTop: 7 }}>Only meta gems fit the meta socket.</div>
				</div>
			</div>

			<div className="panel">
				<h2>Meta gem requirements</h2>
				<p className="muted small" style={{ marginTop: 0 }}>
					Used only when your meta gem’s colour requirement can’t be met otherwise — Chaotic Skyfire Diamond wants two blue gems, for instance,
					and you may own no blue sockets. Enough of these are forced in to switch the meta on, preferring sockets where they cost nothing. An
					inactive meta loses its whole stat line, which dwarfs a socket bonus.
					{metaRequirement && <> Yours: <strong style={{ color: 'var(--text)' }}>{metaRequirement}</strong></>}
				</p>
				<div className="grid" style={{ gridTemplateColumns: 'minmax(150px, auto) 1fr 2fr', alignItems: 'start', rowGap: 14 }}>
					{META_COLORS.map(entry => (
						<Fragment key={entry.key}>
							<div className="row" style={{ gap: 6, paddingTop: 7 }}>
								<span className="socket" style={{ background: SOCKET_CSS[entry.color] }} />
								Counts as {entry.label}
							</div>
							<GemSelect
								value={draft.gems.metaFix[entry.key] ?? 0}
								gems={gems}
								socketColor={entry.color}
								onChange={id => patch({ gems: { ...draft.gems, metaFix: { ...draft.gems.metaFix, [entry.key]: id } } })}
							/>
							<div className="small muted" style={{ paddingTop: 7 }}>
								{entry.hint}
							</div>
						</Fragment>
					))}
				</div>
			</div>

			<div className="panel">
				<h2>Sim settings</h2>
				<div className="row">
					<label className="field">
						Iterations (ranking pass)
						<input type="number" value={draft.iterations} onChange={event => patch({ iterations: Number(event.target.value) })} />
					</label>
					<label className="field">
						Iterations (refine pass)
						<input type="number" value={draft.refineIterations} onChange={event => patch({ refineIterations: Number(event.target.value) })} />
					</label>
					<label className="field">
						Refine top N
						<input type="number" value={draft.refineTop} onChange={event => patch({ refineTop: Number(event.target.value) })} />
					</label>
					<label className="field">
						Random seed
						<input type="number" value={draft.randomSeed} onChange={event => patch({ randomSeed: Number(event.target.value) })} />
					</label>
					<label className="field">
						Compare against
						<select value={draft.deltaBasis} onChange={event => patch({ deltaBasis: event.target.value as 'tuned' | 'raw' })}>
							<option value="tuned">Current gear, re-gemmed to policy</option>
							<option value="raw">Current gear exactly as equipped</option>
						</select>
					</label>
				</div>
				<div className="row" style={{ marginTop: 12 }}>
					<button className="primary" onClick={save}>
						Save settings
					</button>
					{saved && <span className="small" style={{ color: 'var(--good)' }}>Saved.</span>}
				</div>
			</div>
		</>
	);
}
