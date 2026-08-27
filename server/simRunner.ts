// Runs sims by shelling out to wowsimcli, which takes a protojson RaidSimRequest
// and prints a protojson RaidSimResult. wowsimcli already parallelises a single
// sim across every core, so sims are run one at a time.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { CACHE_DIR, cliBinary } from './paths.js';
import type { Metric } from './profile.js';
import type { RaidSimRequest } from './profile.js';

const execFileAsync = promisify(execFile);

export interface SimResult {
	value: number;
	stdev: number;
	iterations: number;
	cached: boolean;
}

export class SimError extends Error {}

/** Thrown when the user stops a run, so callers can tell it apart from a bad item. */
export class SimAbortedError extends SimError {}

function cacheKey(request: RaidSimRequest, metric: Metric): string {
	return crypto.createHash('sha256').update(`${metric}\n${JSON.stringify(request)}`).digest('hex').slice(0, 32);
}

function readMetric(result: Record<string, any>, metric: Metric): { value: number; stdev: number } {
	const player = result?.raidMetrics?.parties?.[0]?.players?.[0];
	if (!player) throw new SimError('Sim returned no player metrics.');

	// TPS is reported as threat per second on the same distribution shape as DPS.
	const key = metric === 'hps' ? 'hps' : metric === 'tps' ? 'threat' : 'dps';
	const dist = player[key];
	if (!dist) throw new SimError(`Sim result has no "${key}" metrics.`);
	return { value: dist.avg ?? 0, stdev: dist.stdev ?? 0 };
}

export class SimRunner {
	private queue: Promise<unknown> = Promise.resolve();
	private aborted = false;

	constructor(
		private readonly binary = cliBinary(),
		private readonly useCache = true,
	) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}

	abort(): void {
		this.aborted = true;
	}

	resume(): void {
		this.aborted = false;
	}

	/** Serialises runs so a single sim gets the whole machine. */
	run(request: RaidSimRequest, metric: Metric): Promise<SimResult> {
		const next = this.queue.then(() => this.runNow(request, metric));
		this.queue = next.catch(() => undefined);
		return next;
	}

	private async runNow(request: RaidSimRequest, metric: Metric): Promise<SimResult> {
		if (this.aborted) throw new SimAbortedError('Run aborted.');

		const key = cacheKey(request, metric);
		const cachePath = path.join(CACHE_DIR, `${key}.json`);
		if (this.useCache && fs.existsSync(cachePath)) {
			try {
				const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as SimResult;
				return { ...cached, cached: true };
			} catch {
				fs.rmSync(cachePath, { force: true });
			}
		}

		if (!fs.existsSync(this.binary)) {
			throw new SimError(`wowsimcli not found at ${this.binary}. Run 'npm run setup'.`);
		}

		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbcsim-'));
		const infile = path.join(dir, 'in.json');
		const outfile = path.join(dir, 'out.json');
		try {
			fs.writeFileSync(infile, JSON.stringify(request));
			await execFileAsync(this.binary, ['sim', '--infile', infile, '--outfile', outfile], {
				maxBuffer: 64 * 1024 * 1024,
			});

			const raw = JSON.parse(fs.readFileSync(outfile, 'utf8')) as Record<string, any>;
			const error = raw?.error?.message;
			if (error) throw new SimError(`wowsimcli rejected the request: ${error}`);

			const { value, stdev } = readMetric(raw, metric);
			const result: SimResult = { value, stdev, iterations: raw.iterationsDone ?? request.simOptions?.iterations ?? 0, cached: false };
			if (this.useCache) fs.writeFileSync(cachePath, JSON.stringify({ value, stdev, iterations: result.iterations }));
			return result;
		} catch (err) {
			if (err instanceof SimError) throw err;
			const message = err instanceof Error ? err.message : String(err);
			throw new SimError(`wowsimcli failed: ${message.split('\n').slice(0, 3).join(' ')}`);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
}

/**
 * 95% confidence interval on the difference of two independent sim means.
 * Both sims share a random seed, so this is a conservative upper bound: the
 * correlated streams make the true delta variance smaller than this.
 */
export function deltaConfidenceInterval(a: SimResult, b: SimResult): number {
	const varA = a.iterations ? (a.stdev * a.stdev) / a.iterations : 0;
	const varB = b.iterations ? (b.stdev * b.stdev) / b.iterations : 0;
	return 1.96 * Math.sqrt(varA + varB);
}
