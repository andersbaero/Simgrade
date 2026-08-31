import { useState } from 'react';

import { api } from './api';
import BenchPanel from './BenchPanel';
import { SLOT_NAMES } from './labels';
import type { StateResponse } from './types';

interface Props {
	state: StateResponse;
	bench: number[];
	onImported: () => void;
	onBenchChange: (ids: number[]) => void;
}

export default function ProfilePanel({ state, bench, onImported, onBenchChange }: Props) {
	const profile = state.profile;
	const [text, setText] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<string | null>(null);

	const submit = async () => {
		setBusy(true);
		setError(null);
		setResult(null);
		try {
			const response = await api.importProfile(text);
			setText('');
			setResult(
				response.created
					? `Created a new profile: ${response.label}.`
					: `Updated ${response.label} — gear refreshed, keeping ${response.kept.selection} item(s) and ${response.kept.bench} bench item(s).`,
			);
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
				<p className="muted small" style={{ marginTop: 0 }}>
					In the wowsims UI, set up your character as you normally would, then use <strong>Export → CLI</strong> and paste the JSON here. It
					carries your talents, rotation, consumables, raid buffs, debuffs and encounter, so every sim differs from your baseline by gear alone.
					A character you have imported before is recognised and has only its gear refreshed — the item list, bench and gems stay put.
				</p>
				<textarea
					value={text}
					onChange={event => setText(event.target.value)}
					placeholder='{ "raid": { "parties": [ ... ] }, "encounter": { ... }, "simOptions": { ... } }'
					spellCheck={false}
				/>
				<div className="row" style={{ marginTop: 10 }}>
					<button className="primary" onClick={submit} disabled={!text.trim() || busy}>
						{busy ? 'Importing…' : profile ? 'Replace profile' : 'Import profile'}
					</button>
					{error && <span style={{ color: 'var(--bad)' }}>{error}</span>}
					{result && <span className="small" style={{ color: 'var(--good)' }}>{result}</span>}
				</div>
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
