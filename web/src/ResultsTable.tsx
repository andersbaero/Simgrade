import { formatDelta, wowheadUrl } from './labels';
import type { CandidateResult, RunProgress } from './types';

interface Props {
	progress: RunProgress;
	metric: string;
}

export default function ResultsTable({ progress, metric }: Props) {
	const { results } = progress;

	if (progress.state === 'error') {
		return <div className="panel notice error">{progress.message}</div>;
	}

	if (!results.length) {
		return (
			<>
				<div className="panel muted">
					{progress.state === 'running' ? 'Simming…' : 'No results yet. Tick some items, then hit “Run upgrade sim”.'}
				</div>
				<Failures progress={progress} />
			</>
		);
	}

	return (
		<>
			{progress.message && <div className="panel notice">{progress.message}</div>}
			<div className="panel">
				<h2>
					Ranked upgrades — baseline {progress.baselineDps?.toFixed(1)} {metric.toUpperCase()}
				</h2>
				<div className="scroll" style={{ maxHeight: '70vh' }}>
					<table>
						<thead>
							<tr>
								<th>#</th>
								<th>Item</th>
								<th>Slot</th>
								<th>{metric.toUpperCase()} gain</th>
								<th>Result</th>
								<th>Hit</th>
								<th>Replaces</th>
								<th>Notes</th>
							</tr>
						</thead>
						<tbody>
							{results.map((row, index) => (
								<ResultRow key={row.key} row={row} index={index} metric={metric} />
							))}
						</tbody>
					</table>
				</div>
				<p className="small muted" style={{ marginBottom: 0 }}>
					Gains are shown ± a 95% confidence interval. Rows marked <em>within noise</em> are not distinguishable from your current gear at the
					iteration count used — treat them as sideways, not as upgrades.
				</p>
			</div>
			<Failures progress={progress} />
		</>
	);
}

/** Items the sim engine itself refused or crashed on; the rest of the run is unaffected. */
function Failures({ progress }: { progress: RunProgress }) {
	if (!progress.failures.length) return null;
	return (
		<div className="panel">
			<h2>Could not be simmed ({progress.failures.length})</h2>
			<table>
				<tbody>
					{progress.failures.map(failure => (
						<tr key={`${failure.label}-${failure.slotLabel}`}>
							<td>{failure.label}</td>
							<td className="muted small">{failure.slotLabel}</td>
							<td className="small" style={{ color: 'var(--warn)' }}>{failure.error}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="small muted" style={{ marginBottom: 0 }}>
				These come from the wowsims engine, not from this tool — usually an item whose effect assumes a different class. The rest of the run is
				unaffected.
			</p>
		</div>
	);
}

function ResultRow({ row, index, metric }: { row: CandidateResult; index: number; metric: string }) {
	const klass = row.withinNoise ? 'noise' : row.delta >= 0 ? 'gain' : 'loss';
	const hasNotes = row.setNotes.length > 0 || row.gemNotes.length > 0 || row.warnings.length > 0;

	return (
		<tr>
			<td className="muted">{index + 1}</td>
			<td>
				{row.itemIds.length === 1 ? (
					<a href={wowheadUrl(row.itemIds[0]!)} target="_blank" rel="noreferrer">
						{row.label}
					</a>
				) : (
					row.label
				)}
				{row.kind === 'bundle' && <span className="tag bundle">bundle</span>}
			</td>
			<td className="muted small">{row.slotLabel}</td>
			<td className={klass}>
				{formatDelta(row.delta)}
				<div className="small muted">± {row.deltaCI.toFixed(1)}</div>
				{row.withinNoise && <div className="tag">within noise</div>}
			</td>
			<td className="muted small">
				{row.dps.toFixed(1)} {metric.toUpperCase()}
				<div>{row.iterations.toLocaleString()} iters</div>
			</td>
			<td className="muted small">
				{Math.round(row.gearHit)}
				<div className={row.hitDelta === 0 ? 'muted' : row.hitDelta > 0 ? 'gain' : 'loss'}>
					{row.hitDelta === 0 ? '—' : formatDelta(row.hitDelta)}
				</div>
			</td>
			<td className="muted small">{row.replaces}</td>
			<td>
				{row.benchNote && <div className="tag bench">{row.benchNote}</div>}
				{row.setNotes.map(note => (
					<div key={note} className="tag set">
						{note}
					</div>
				))}
				{row.warnings.map(note => (
					<div key={note} className="tag warn">
						{note}
					</div>
				))}
				{hasNotes && row.gemNotes.length > 0 && (
					<details className="notes">
						<summary>gems &amp; enchant assumed</summary>
						{row.gemNotes.map(note => (
							<div key={note} className="small muted">
								{note}
							</div>
						))}
					</details>
				)}
			</td>
		</tr>
	);
}
