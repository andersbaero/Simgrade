// Orchestrates a full upgrade run:
//   1. sim the gear exactly as equipped
//   2. sim it again under the gem policy (plus any bench swap that lands it
//      closer to the hit target) - this is what candidates are compared
//      against, so an item is never credited with a fix you could have made
//      without it
//   3. sim every candidate at the fast iteration count, including the bench
//      swaps that fix a hit overshoot or shortfall the gems could not
//   4. re-sim the best ones (and every tier bundle) at the high iteration count
//
// Every sim in a run shares one random seed. Correlated random streams make a
// small delta measurable instead of drowning in per-run noise.

import { CandidateResult, RunFailure, RunProgress } from '../shared/wow.js';
import { hitFixVariants } from './bench.js';
import { buildCandidates, Candidate, Placement, placeItems } from './candidates.js';
import { Config, hitStatIndex, ratingPerPercent, resolveHitStat, resolveMetric } from './config.js';
import { applyGemPolicy, describeEnchants, describeGemChanges, Gear, gearHitRating } from './gearing.js';
import { ItemDatabase } from './itemDb.js';
import type { ParsedProfile } from './profile.js';
import { withEquipment } from './profile.js';
import { breaksSetBonus, describeSetChanges } from './sets.js';
import { deltaConfidenceInterval, SimAbortedError, SimResult, SimRunner } from './simRunner.js';

export interface RunInputs {
	db: ItemDatabase;
	profile: ParsedProfile;
	config: Config;
	selectedIds: number[];
	benchIds: number[];
	/** Called once when a run finishes, so persistence stays out of the engine. */
	onFinished?: (progress: RunProgress) => void;
}

/** One gear layout to sim. Several variants can share a candidate; the best wins. */
interface Variant {
	key: string;
	candidate: Candidate;
	placements: Placement[];
	benchNote?: string;
}

interface BuiltVariant {
	gear: Gear;
	hitRating: number;
	setNotes: string[];
	gemNotes: string[];
	warnings: string[];
}

interface Evaluated {
	variant: Variant;
	built: BuiltVariant;
	result: SimResult;
}

export function resolveTargetHitRating(db: ItemDatabase, profile: ParsedProfile, config: Config): number {
	const hitStat = resolveHitStat(config, profile);
	const hitIdx = hitStatIndex(hitStat);
	switch (config.hitTarget.mode) {
		case 'gearRating':
			return config.hitTarget.gearRating;
		case 'totalPercent': {
			const fromGear = Math.max(0, config.hitTarget.totalPercent - config.hitTarget.externalPercent);
			return fromGear * ratingPerPercent(hitStat);
		}
		default:
			return gearHitRating(db, profile.equipment, hitIdx);
	}
}

export class RunManager {
	private runner = new SimRunner();
	private progress: RunProgress = { state: 'idle', completed: 0, total: 0, current: '', results: [], failures: [] };

	getProgress(): RunProgress {
		return this.progress;
	}

	abort(): void {
		this.runner.abort();
		if (this.progress.state === 'running') {
			this.progress = { ...this.progress, state: 'idle', current: '', message: 'Run aborted.' };
		}
	}

	isRunning(): boolean {
		return this.progress.state === 'running';
	}

	start(inputs: RunInputs): void {
		if (this.isRunning()) throw new Error('A run is already in progress.');
		this.runner.resume();
		this.progress = {
			state: 'running',
			completed: 0,
			total: 0,
			current: 'Preparing…',
			results: [],
			failures: [],
			startedAt: new Date().toISOString(),
		};
		void this.execute(inputs).catch((err: unknown) => {
			this.progress = {
				...this.progress,
				state: 'error',
				current: '',
				message: err instanceof Error ? err.message : String(err),
				finishedAt: new Date().toISOString(),
			};
		});
	}

	private step(current: string): void {
		this.progress = { ...this.progress, current };
	}

	private advance(): void {
		this.progress = { ...this.progress, completed: this.progress.completed + 1 };
	}

	private recordFailure(label: string, slotLabel: string, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		const failure: RunFailure = { label, slotLabel, error: message.split('\nStack Trace:')[0]!.trim() };
		this.progress = { ...this.progress, failures: [...this.progress.failures, failure] };
	}

	private async execute({ db, profile, config, selectedIds, benchIds, onFinished }: RunInputs): Promise<void> {
		const metric = resolveMetric(config, profile);
		const hitIdx = hitStatIndex(resolveHitStat(config, profile));
		// One seed for the whole run keeps baseline and candidates on the same
		// random stream, which is what makes small deltas measurable. Drawing a
		// fresh one per run means clicking Run actually re-runs — and gives an
		// independent sample rather than replaying the cache.
		const seed = config.pinSeed ? config.randomSeed : Date.now() % 2_000_000_000;
		const target = resolveTargetHitRating(db, profile, config);
		const rawGear = profile.equipment;

		// --- plan every gear layout before simming anything -------------------
		const tuned = applyGemPolicy(db, rawGear, config, hitIdx, target);
		const baselineFixes = hitFixVariants(db, rawGear, [], benchIds, config, hitIdx, target);
		const { candidates, skipped, bundlesTruncated } = buildCandidates(db, rawGear, selectedIds, config);

		const variants: Variant[] = candidates.flatMap(candidate => {
			const fixes = hitFixVariants(db, rawGear, candidate.placements, benchIds, config, hitIdx, target);
			return [
				{ key: candidate.key, candidate, placements: candidate.placements },
				...fixes.map((fix, index) => ({
					key: `${candidate.key}#bench${index}`,
					candidate,
					placements: fix.placements,
					benchNote: fix.note,
				})),
			];
		});

		this.progress = {
			...this.progress,
			total: 2 + baselineFixes.length + variants.length + 1 + Math.min(config.refineTop, variants.length),
		};

		// --- baselines --------------------------------------------------------
		this.step('Simming current gear as equipped…');
		const rawResult = await this.sim(profile, rawGear, config.iterations, seed, metric);
		this.advance();

		const regemmed = JSON.stringify(tuned.gear) !== JSON.stringify(rawGear);
		this.step(regemmed ? 'Simming current gear under the gem policy…' : 'Gem policy leaves current gear unchanged.');
		const tunedResult = regemmed ? await this.sim(profile, tuned.gear, config.iterations, seed, metric) : rawResult;
		this.advance();

		// A bench swap is allowed to improve the baseline too, so candidates are
		// never credited with a hit fix that was available without them.
		let bestBaseline = { gear: tuned.gear, result: tunedResult, note: '' };
		for (const fix of baselineFixes) {
			this.step('Trying a bench swap on your current gear…');
			const gear = applyGemPolicy(db, placeItems(db, rawGear, fix.placements, config).gear, config, hitIdx, target).gear;
			try {
				const result = await this.sim(profile, gear, config.iterations, seed, metric);
				if (result.value > bestBaseline.result.value) bestBaseline = { gear, result, note: fix.note };
			} catch (err) {
				if (err instanceof SimAbortedError) throw err;
				this.recordFailure('Baseline bench swap', '', err);
			}
			this.advance();
		}

		const basisGear = config.deltaBasis === 'tuned' ? bestBaseline.gear : rawGear;
		const basisFast = config.deltaBasis === 'tuned' ? bestBaseline.result : rawResult;
		const basisHit = gearHitRating(db, basisGear, hitIdx);

		const messages: string[] = [];
		if (config.deltaBasis === 'tuned' && bestBaseline.result.value !== rawResult.value) {
			const gain = bestBaseline.result.value - rawResult.value;
			messages.push(
				`Tuning your current gear alone is worth ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} ${metric.toUpperCase()} ` +
					`(${rawResult.value.toFixed(1)} as equipped → ${bestBaseline.result.value.toFixed(1)}). Deltas below are measured from the tuned set.`,
			);
			if (bestBaseline.note) messages.push(bestBaseline.note);
		}
		for (const item of skipped) messages.push(`Skipped ${item.name}: ${item.reason}.`);
		if (bundlesTruncated) messages.push(`${bundlesTruncated} tier bundle(s) were not simmed — the bundle cap was reached.`);

		this.progress = { ...this.progress, baselineDps: basisFast.value, baselineHit: basisHit, message: messages.join('\n') || undefined };

		// --- pass 1: rank every variant ---------------------------------------
		const evaluated: Evaluated[] = [];
		for (const variant of variants) {
			this.step(`Simming ${variant.candidate.label}${variant.benchNote ? ' (bench swap)' : ''}…`);
			const built = this.build(db, rawGear, basisGear, variant, config, hitIdx, target);
			try {
				const result = await this.sim(profile, built.gear, config.iterations, seed, metric);
				evaluated.push({ variant, built, result });
			} catch (err) {
				// A single item the sim engine chokes on must not end the run.
				if (err instanceof SimAbortedError) throw err;
				this.recordFailure(variant.candidate.label, variant.candidate.slotLabel, err);
			}
			this.progress = { ...this.progress, results: this.collect(evaluated, basisFast, basisHit) };
			this.advance();
		}

		// --- pass 2: refine the leaders and every bundle -----------------------
		const winners = this.pickGroupWinners(evaluated);
		const refineKeys = new Set<string>();
		for (const entry of winners.filter(entry => entry.variant.candidate.kind === 'bundle')) refineKeys.add(entry.variant.key);
		for (const entry of winners
			.filter(entry => entry.variant.candidate.kind === 'single')
			.sort((a, b) => b.result.value - a.result.value)
			.slice(0, config.refineTop)) {
			refineKeys.add(entry.variant.key);
		}

		if (refineKeys.size && config.refineIterations > config.iterations) {
			this.step(`Refining the top ${refineKeys.size} at ${config.refineIterations.toLocaleString()} iterations…`);
			const basisSlow = await this.sim(profile, basisGear, config.refineIterations, seed, metric);
			this.advance();

			for (const entry of evaluated) {
				if (!refineKeys.has(entry.variant.key)) continue;
				this.step(`Refining ${entry.variant.candidate.label}…`);
				try {
					entry.result = await this.sim(profile, entry.built.gear, config.refineIterations, seed, metric);
				} catch (err) {
					if (err instanceof SimAbortedError) throw err;
					this.recordFailure(entry.variant.candidate.label, entry.variant.candidate.slotLabel, err);
					refineKeys.delete(entry.variant.key);
				}
				this.advance();
			}

			this.progress = {
				...this.progress,
				results: this.collect(evaluated, basisFast, basisHit, { refined: refineKeys, basisSlow }),
				baselineDps: basisSlow.value,
			};
		}

		this.progress = {
			...this.progress,
			state: 'done',
			current: '',
			completed: this.progress.total,
			finishedAt: new Date().toISOString(),
		};
		onFinished?.(this.progress);
	}

	/**
	 * Keeps only the best-simming variant of each candidate — the ring/trinket
	 * slot alternatives and the bench hit-fixes all compete within one group, so
	 * a row shows the best way to wear the item rather than every permutation.
	 */
	private pickGroupWinners(entries: Evaluated[]): Evaluated[] {
		const best = new Map<string, Evaluated>();
		for (const entry of entries) {
			const current = best.get(entry.variant.candidate.group);
			if (!current || entry.result.value > current.result.value) best.set(entry.variant.candidate.group, entry);
		}
		return [...best.values()];
	}

	private collect(
		entries: Evaluated[],
		basisFast: SimResult,
		basisHit: number,
		refine?: { refined: Set<string>; basisSlow: SimResult },
	): CandidateResult[] {
		return this.pickGroupWinners(entries)
			.map(({ variant, built, result }) => {
				const basis = refine?.refined.has(variant.key) ? refine.basisSlow : basisFast;
				const delta = result.value - basis.value;
				const deltaCI = deltaConfidenceInterval(result, basis);
				return {
					key: variant.key,
					kind: variant.candidate.kind,
					itemIds: variant.candidate.itemIds,
					label: variant.candidate.label,
					slotLabel: variant.candidate.slotLabel,
					replaces: variant.candidate.replaces,
					dps: result.value,
					stdev: result.stdev,
					iterations: result.iterations,
					delta,
					deltaCI,
					withinNoise: Math.abs(delta) <= deltaCI,
					gearHit: built.hitRating,
					hitDelta: built.hitRating - basisHit,
					setNotes: built.setNotes,
					gemNotes: built.gemNotes,
					warnings: [...variant.candidate.warnings, ...built.warnings],
					benchNote: variant.benchNote,
				} satisfies CandidateResult;
			})
			.sort((a, b) => b.delta - a.delta);
	}

	private build(
		db: ItemDatabase,
		rawGear: Gear,
		basisGear: Gear,
		variant: Variant,
		config: Config,
		hitIdx: number,
		target: number,
	): BuiltVariant {
		const placed = placeItems(db, rawGear, variant.placements, config);
		const policy = applyGemPolicy(db, placed.gear, config, hitIdx, target);
		const setNotes = describeSetChanges(db, basisGear, policy.gear);
		if (breaksSetBonus(db, basisGear, policy.gear)) setNotes.unshift('Breaks a set bonus you currently have.');

		return {
			gear: policy.gear,
			hitRating: policy.hitRating,
			setNotes,
			gemNotes: [...describeEnchants(db, variant.placements, policy.gear), ...describeGemChanges(policy.changes), ...policy.notes],
			warnings: [...placed.warnings, ...policy.warnings],
		};
	}

	private sim(profile: ParsedProfile, gear: Gear, iterations: number, seed: number, metric: 'dps' | 'hps' | 'tps') {
		return this.runner.run(withEquipment(profile, gear, { iterations, randomSeed: seed }), metric);
	}
}
