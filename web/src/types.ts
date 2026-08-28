// Wire types are defined once in shared/wow.ts and re-exported here so the UI
// and the server can never drift apart.
export type { CandidateResult, CatalogItem as CandidateItem, RunFailure, RunProgress } from '../../shared/wow';

export interface UpdateProgress {
	state: 'idle' | 'running' | 'done' | 'error';
	received: number;
	total: number;
	file?: string;
	message?: string;
}

export interface GemOption {
	id: number;
	name: string;
	color: number;
	colorName: string;
	phase: number;
	quality: number;
	unique: boolean;
	jewelcrafting: boolean;
	stats: string;
}

export interface ProfileSummary {
	name: string;
	className: string;
	spec: string;
	metric: string;
	hitStat: string;
	hitStatName: string;
	gearHit: number;
	targetHit: number;
	equipped: { slot: number; id: number; name: string; enchant: string; gems: string[] }[];
	sets: { setId: number; setName: string; pieces: number }[];
}

export interface AppConfig {
	iterations: number;
	refineIterations: number;
	refineTop: number;
	trySocketBonuses: boolean;
	checkForUpdates: boolean;
	pinSeed: boolean;
	randomSeed: number;
	metric: string;
	hitStat: string;
	hitTarget: { mode: 'keepCurrent' | 'gearRating' | 'totalPercent'; gearRating: number; totalPercent: number; externalPercent: number };
	gems: { meta: number; base: number; hit: number; metaFix: Record<string, number> };
	deltaBasis: 'tuned' | 'raw';
}

export interface StateResponse {
	profile: ProfileSummary | null;
	config: AppConfig;
	release: { version: string };
	selection: number[];
	bench: number[];
	dropped: string[];
	version: string;
	update: { latest: string; url: string; downloadable: boolean } | null;
	running: boolean;
}
