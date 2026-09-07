import { useState } from 'react';

import { api } from './api';
import BenchPanel from './BenchPanel';
import { ItemSlot, SLOT_NAMES } from './labels';
import type { AddonImportResult, StateResponse } from './types';

/** Where the pasted text came from. The two are read very differently. */
type ImportSource = 'cli' | 'addon';

interface Props {
	state: StateResponse;
	bench: number[];
	onImported: () => void;
	onBenchChange: (ids: number[]) => void;
}

export default function ProfilePanel({ state, bench, onImported, onBenchChange }: Props) {
	const profile = state.profile;
	// An addon export carries no rotation or encounter, so it can only ever
	// update a character that already exists.
	const canUseAddon = state.profiles.length > 0;
	const [source, setSource] = useState<ImportSource>(canUseAddon ? 'addon' : 'cli');
	const [text, setText] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<string | null>(null);
	const [refreshed, setRefreshed] = useState<AddonImportResult | null>(null);

	// Deleting the last character while the addon source is chosen must not leave
	// the panel pointing at an import that cannot work.
	const active: ImportSource = canUseAddon ? source : 'cli';

	const clear = () => {
		setError(null);
		setResult(null);
		setRefreshed(null);
	};

	const submit = async () => {
		setBusy(true);
		clear();
		try {
			if (active === 'addon') {
				setRefreshed(await api.importAddon(text));
			} else {
				const response = await api.importProfile(text);
				setResult(
					response.created
						? `Created a new profile: ${response.label}.`
						: `Updated ${response.label} — gear refreshed, keeping ${response.kept.selection} item(s) and ${response.kept.bench} bench item(s).`,
				);
			}
			setText('');
			onImported();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const act = async (fn: () => Promise<unknown>) => {
		setError(null);
		try {
			await fn();
			onImported();
		} catch (err) {
			setError((err as Error).message);
		}
	};

	return (
		<>
			{state.profiles.length > 0 && (
				<div className="panel">
					<h2>Characters ({state.profiles.length})</h2>
					<p className="muted small" style={{ marginTop: 0 }}>
						Each character keeps its own item list, bench and gem settings. Switch between them from the dropdown in the header.
					</p>
					<table>
						<tbody>
							{state.profiles.map(entry => (
								<tr key={entry.id}>
									<td>
										{entry.id === state.activeProfileId ? <strong>{entry.label}</strong> : entry.label}
										{entry.id === state.activeProfileId && <span className="tag" style={{ marginLeft: 8 }}>active</span>}
									</td>
									<td className="muted small">
										{entry.className} · {entry.spec}
									</td>
									<td style={{ width: 220, textAlign: 'right' }}>
										{entry.id !== state.activeProfileId && (
											<button className="ghost" onClick={() => void act(() => api.activateProfile(entry.id))}>
												Switch to
											</button>
										)}{' '}
										<button
											className="ghost"
											onClick={() => {
												const label = window.prompt('Name for this profile', entry.label);
												if (label) void act(() => api.renameProfile(entry.id, label));
											}}>
											Rename
										</button>{' '}
										<button
											className="remove"
											title="Delete this profile"
											onClick={() => {
												if (window.confirm(`Delete ${entry.label}? Its item list, bench and gem settings go with it.`)) {
													void act(() => api.deleteProfile(entry.id));
												}
											}}>
											×
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<div className="panel">
				<h2>Import a character</h2>
				<div className="row" style={{ marginBottom: 10 }}>
					<label className="small muted" htmlFor="import-source">
						Paste from
					</label>
					<select
						id="import-source"
						value={active}
						onChange={event => {
							setSource(event.target.value as ImportSource);
							clear();
						}}>
						<option value="addon" disabled={!canUseAddon}>
							The in-game addon — gear and talents
						</option>
						<option value="cli">wowsims Export → CLI — the whole character</option>
					</select>
				</div>

				{active === 'addon' ? (
					<p className="muted small" style={{ marginTop: 0 }}>
						In game, run <strong>WowSimsExporter</strong> and copy what it gives you. This refreshes the gear, talents and professions of the
						character selected in the header — your rotation, consumables, raid buffs, debuffs and encounter are left exactly as they are, so
						results stay comparable with the sims you have already run.
					</p>
				) : (
					<p className="muted small" style={{ marginTop: 0 }}>
						In the wowsims UI, set up your character as you normally would, then use <strong>Export → CLI</strong> and paste the JSON here. It
						carries your talents, rotation, consumables, raid buffs, debuffs and encounter, so every sim differs from your baseline by gear alone.
						A character you have imported before is recognised and has only its gear refreshed — the item list, bench and gems stay put.
					</p>
				)}

				{!canUseAddon && (
					<p className="muted small" style={{ marginTop: 0 }}>
						The addon export is only available once a character exists — it carries no rotation or encounter of its own, so there would be
						nothing to attach it to. Import with <strong>Export → CLI</strong> once, then refresh from the addon every week after that.
					</p>
				)}

				<textarea
					value={text}
					onChange={event => setText(event.target.value)}
					placeholder={
						active === 'addon'
							? '{ "class": "warlock", "talents": "...", "gear": { "items": [ ... ] }, ... }'
							: '{ "raid": { "parties": [ ... ] }, "encounter": { ... }, "simOptions": { ... } }'
					}
					spellCheck={false}
				/>
				<div className="row" style={{ marginTop: 10 }}>
					<button className="primary" onClick={submit} disabled={!text.trim() || busy}>
						{busy
							? active === 'addon'
								? 'Refreshing…'
								: 'Importing…'
							: active === 'addon'
								? 'Refresh gear'
								: profile
									? 'Replace profile'
									: 'Import profile'}
					</button>
					{error && <span style={{ color: 'var(--bad)' }}>{error}</span>}
					{result && (
						<span className="small" style={{ color: 'var(--good)' }}>
							{result}
						</span>
					)}
				</div>

				{refreshed && (
					<div className="notice" style={{ marginTop: 10 }}>
						{refreshed.changed.length === 0
							? 'Nothing changed — the gear on this character already matches your export.'
							: `Refreshed ${refreshed.changed.length} slot${refreshed.changed.length === 1 ? '' : 's'}, leaving ${refreshed.unchangedCount} as ${refreshed.unchangedCount === 1 ? 'it was' : 'they were'}.`}
						{refreshed.changed.map(entry => (
							<div key={entry.slot} className={entry.kind === 'tuned' ? 'small muted' : 'small'} style={{ marginTop: 4 }}>
								<strong>{SLOT_NAMES[entry.slot as ItemSlot]}</strong>:{' '}
								{entry.kind === 'tuned' ? `${entry.to} — different gems or enchant` : `${entry.from} → ${entry.to}`}
							</div>
						))}
						<div className="small muted" style={{ marginTop: 6 }}>
							Gear hit {Math.round(refreshed.gearHit)} against a target of {Math.round(refreshed.targetHit)}.
							{refreshed.talentsChanged ? ' Talents updated too.' : ''}
						</div>
						{refreshed.removedFromWishlist.length > 0 && (
							<div className="small" style={{ marginTop: 6 }}>
								Removed {refreshed.removedFromWishlist.length} item
								{refreshed.removedFromWishlist.length === 1 ? '' : 's'} from your list that you now have equipped:{' '}
								{refreshed.removedFromWishlist.join(', ')}.
							</div>
						)}
						{refreshed.skipped.length > 0 && (
							<div className="small" style={{ marginTop: 6 }}>
								Left {refreshed.skipped.length} slot{refreshed.skipped.length === 1 ? '' : 's'} as {refreshed.skipped.length === 1 ? 'it was' : 'they were'}:{' '}
								{refreshed.skipped
									.map(item => `${item.slot === null ? 'item' : SLOT_NAMES[item.slot as ItemSlot]} ${item.id} (${item.reason})`)
									.join(', ')}
								. An item Simgrade does not know cannot be simmed, so your current one is kept instead.
							</div>
						)}
						{refreshed.specWarning && (
							<div className="small" style={{ marginTop: 6, color: 'var(--bad)' }}>
								{refreshed.specWarning}
							</div>
						)}
						{refreshed.levelWarning && (
							<div className="small" style={{ marginTop: 6, color: 'var(--bad)' }}>
								{refreshed.levelWarning}
							</div>
						)}
					</div>
				)}
			</div>

			{profile && (
				<div className="panel">
					<h2>
						{profile.name} — {profile.spec}
					</h2>
					<div className="row small muted" style={{ marginBottom: 12 }}>
						<span>
							Optimising <strong style={{ color: 'var(--text)' }}>{profile.metric.toUpperCase()}</strong>
						</span>
						<span>
							Gear {profile.hitStatName}:{' '}
							<strong style={{ color: 'var(--text)' }}>{Math.round(profile.gearHit)}</strong> (target {Math.round(profile.targetHit)})
						</span>
						{profile.sets.map(set => (
							<span className="tag set" key={set.setId}>
								{set.pieces}pc {set.setName}
							</span>
						))}
					</div>
					<div className="scroll" style={{ maxHeight: '40vh' }}>
						<table>
							<thead>
								<tr>
									<th>Slot</th>
									<th>Item</th>
									<th>Enchant</th>
									<th>Gems</th>
								</tr>
							</thead>
							<tbody>
								{profile.equipped
									.filter(slot => slot.id)
									.map(slot => (
										<tr key={slot.slot}>
											<td className="muted">{SLOT_NAMES[slot.slot as keyof typeof SLOT_NAMES]}</td>
											<td>{slot.name}</td>
											<td className="muted small">{slot.enchant || '—'}</td>
											<td className="muted small">{slot.gems.join(', ') || '—'}</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{profile && <BenchPanel bench={bench} profile={profile} onBenchChange={onBenchChange} />}
		</>
	);
}
