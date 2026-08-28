import { useEffect, useState } from 'react';

import { api } from './api';
import type { StateResponse, UpdateProgress } from './types';

const IDLE: UpdateProgress = { state: 'idle', received: 0, total: 0 };
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(0)} MB`;

/**
 * Shown when a newer release exists. It downloads the right file for this
 * platform beside the current one and opens the folder — it never replaces the
 * running executable, so a failed download cannot break the install.
 */
export default function UpdateBanner({ state }: { state: StateResponse }) {
	const [progress, setProgress] = useState<UpdateProgress>(IDLE);

	useEffect(() => {
		if (progress.state !== 'running') return;
		const timer = setInterval(() => {
			api.updateProgress().then(setProgress).catch(() => undefined);
		}, 500);
		return () => clearInterval(timer);
	}, [progress.state]);

	if (!state.update) return null;
	const { latest, url, downloadable } = state.update;

	const start = async () => {
		setProgress({ state: 'running', received: 0, total: 0 });
		await api.downloadUpdate().catch(() => undefined);
	};

	return (
		<div className="panel notice">
			<div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
				<div>
					<strong>Simgrade {latest} is available</strong> <span className="muted">— you have {state.version}.</span>
					{progress.state === 'done' && (
						<div className="small" style={{ marginTop: 6 }}>
							Downloaded to <code>{progress.file}</code>. Close Simgrade, swap it for the one you are running, and start it again.
						</div>
					)}
					{progress.state === 'error' && (
						<div className="small" style={{ marginTop: 6, color: 'var(--bad)' }}>
							{progress.message} — you can still download it from the release notes.
						</div>
					)}
					{progress.state === 'running' && (
						<div className="small muted" style={{ marginTop: 6 }}>
							Downloading… {mb(progress.received)}
							{progress.total > 0 && ` of ${mb(progress.total)}`}
						</div>
					)}
					{!downloadable && progress.state === 'idle' && (
						<div className="small muted" style={{ marginTop: 6 }}>
							No download for this platform in that release — grab it from the release notes.
						</div>
					)}
				</div>
				<div className="row" style={{ gap: 8 }}>
					{downloadable && progress.state !== 'done' && (
						<button className="primary" onClick={start} disabled={progress.state === 'running'}>
							{progress.state === 'running' ? 'Downloading…' : 'Download it'}
						</button>
					)}
					<a className="ghost" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
						Release notes
					</a>
				</div>
			</div>
			{progress.state === 'running' && progress.total > 0 && (
				<div className="progress" style={{ marginTop: 10 }}>
					<div style={{ width: `${Math.round((progress.received / progress.total) * 100)}%` }} />
				</div>
			)}
		</div>
	);
}
