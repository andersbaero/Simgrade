import { useState } from 'react';

import { api } from './api';
import BenchPanel from './BenchPanel';
import { SLOT_NAMES } from './labels';
import type { ProfileSummary } from './types';

interface Props {
	profile: ProfileSummary | null;
	bench: number[];
	onImported: () => void;
	onBenchChange: (ids: number[]) => void;
}

export default function ProfilePanel({ profile, bench, onImported, onBenchChange }: Props) {
	const [text, setText] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			await api.importProfile(text);
			setText('');
			onImported();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<div className="panel">
				<h2>Character profile</h2>
				<p className="muted small" style={{ marginTop: 0 }}>
					In the wowsims UI, set up your character as you normally would, then use <strong>Export → CLI</strong> and paste the JSON here. It
					carries your talents, rotation, consumables, raid buffs, debuffs and encounter, so every sim differs from your baseline by gear alone.
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
