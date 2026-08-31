import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';
import ItemPicker from './ItemPicker';
import ConfigPanel from './ConfigPanel';
import ProfilePanel from './ProfilePanel';
import ResultsTable from './ResultsTable';
import UpdateBanner from './UpdateBanner';
import type { RunProgress, StateResponse } from './types';

type Tab = 'setup' | 'items' | 'settings' | 'results';

const IDLE: RunProgress = { state: 'idle', completed: 0, total: 0, current: '', results: [], failures: [] };

export default function App() {
	const [state, setState] = useState<StateResponse | null>(null);
	const [tab, setTab] = useState<Tab>('setup');
	const [progress, setProgress] = useState<RunProgress>(IDLE);
	const [selection, setSelection] = useState<number[]>([]);
	const [bench, setBench] = useState<number[]>([]);
	const [error, setError] = useState<string | null>(null);
	const saveTimer = useRef<number | null>(null);

	const refresh = useCallback(async () => {
		const next = await api.state();
		setState(next);
		// Not "keep what we have" — switching character must adopt that
		// character's lists rather than carrying the previous one's across.
		setSelection(next.selection);
		setBench(next.bench);
	}, []);

	useEffect(() => {
		refresh().catch(err => setError((err as Error).message));
		api.progress().then(setProgress).catch(() => undefined);
	}, []);

	// Poll while a run is in flight so the table fills in as sims land.
	useEffect(() => {
		if (progress.state !== 'running') return;
		const timer = setInterval(() => {
			api.progress().then(setProgress).catch(() => undefined);
		}, 700);
		return () => clearInterval(timer);
	}, [progress.state]);

	// Selection is persisted after a short pause so ticking many boxes is not chatty.
	const changeSelection = (ids: number[]) => {
		setSelection(ids);
		if (saveTimer.current) window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(() => void api.saveSelection(ids).catch(() => undefined), 400);
	};

	const changeBench = (ids: number[]) => {
		setBench(ids);
		void api.saveBench(ids).catch(() => undefined);
	};

	const run = async () => {
		setError(null);
		try {
			await api.saveSelection(selection);
			await api.startRun();
			setTab('results');
			setProgress({ ...IDLE, state: 'running' });
		} catch (err) {
			setError((err as Error).message);
		}
	};

	const metric = state?.profile?.metric ?? 'dps';
	const pct = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;

	return (
		<div className="app">
			<header className="top">
				<h1>Simgrade</h1>
				{state && state.profiles.length > 0 && (
					<select
						value={state.activeProfileId ?? ''}
						onChange={async event => {
							setError(null);
							try {
								await api.activateProfile(event.target.value);
								setSelection([]);
								setBench([]);
								await refresh();
								setProgress(await api.progress());
							} catch (err) {
								setError((err as Error).message);
							}
						}}>
						{state.profiles.map(entry => (
							<option key={entry.id} value={entry.id}>
								{entry.label}
							</option>
						))}
					</select>
				)}
				<div className="spacer" />
				<span className="muted small">wowsims {state?.release.version}</span>
				<a className="small" href="http://localhost:3333/tbc/" target="_blank" rel="noreferrer">
					open wowsims UI ↗
				</a>
			</header>

			<div className="tabs">
				<button className={tab === 'setup' ? 'active' : ''} onClick={() => setTab('setup')}>
					Profile
				</button>
				<button className={tab === 'items' ? 'active' : ''} onClick={() => setTab('items')} disabled={!state?.profile}>
					Items {selection.length ? `(${selection.length})` : ''}
				</button>
				<button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')} disabled={!state?.profile}>
					Settings
				</button>
				<button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>
					Results
				</button>
				<div className="spacer" />
				{progress.state === 'running' ? (
					<button className="ghost" onClick={() => void api.abortRun()}>
						Stop
					</button>
				) : (
					<button className="primary" onClick={run} disabled={!state?.profile || selection.length === 0}>
						Run upgrade sim
					</button>
				)}
			</div>

			{state && <UpdateBanner state={state} />}

			{error && <div className="panel notice error">{error}</div>}

			{!!state?.dropped.length && (
				<div className="panel notice">
					Dropped {state.dropped.length} saved item{state.dropped.length === 1 ? '' : 's'} that this character cannot use:{' '}
					{state.dropped.join(', ')}. They were left over from a previously imported profile.
				</div>
			)}

			{progress.state === 'running' && (
				<div className="panel">
					<div className="row small" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
						<span>{progress.current}</span>
						<span className="muted">
							{progress.completed} / {progress.total}
						</span>
					</div>
					<div className="progress">
						<div style={{ width: `${pct}%` }} />
					</div>
				</div>
			)}

			{tab === 'setup' && state && <ProfilePanel state={state} bench={bench} onImported={() => void refresh()} onBenchChange={changeBench} />}
			{tab === 'items' && <ItemPicker selection={selection} profile={state?.profile ?? null} onSelectionChange={changeSelection} />}
			{tab === 'settings' && state && <ConfigPanel config={state.config} profile={state.profile} onSaved={() => void refresh()} />}
			{tab === 'results' && (
				<>
					<ResultsTable progress={progress} metric={metric} />
					{progress.results.length > 0 && (
						<div className="row">
							<a className="ghost" href="/api/results.csv" style={{ textDecoration: 'none' }}>
								Download CSV
							</a>
						</div>
					)}
				</>
			)}
		</div>
	);
}
