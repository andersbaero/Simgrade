import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';

import Fastify from 'fastify';

import { GEM_COLOR_NAMES, Profession, STAT_NAMES } from '../shared/wow.js';
import { Config, loadConfig, saveConfig, resolveHitStat, resolveMetric, hitStatIndex, withSuggestions } from './config.js';
import { describeStats, loadItemDatabase } from './itemDb.js';
import { ensureRuntime } from './bootstrap.js';
import { benchPath, lastRunPath, RELEASE_PATH, selectionPath, STATE_DIR, STATE_DIR_IS_FALLBACK, uiBinary } from './paths.js';
import * as profiles from './profiles.js';
import { loadWebAssets, resolveAsset } from './staticAssets.js';
import { ParsedProfile, ProfileError, parseProfile } from './profile.js';
import { RunManager, resolveTargetHitRating } from './run.js';
import { gearHitRating } from './gearing.js';
import { setsInGear } from './sets.js';
import { appVersion, checkForUpdate, downloadUpdate, UpdateInfo } from './updates.js';
import { IS_PACKAGED } from './paths.js';

const PORT = Number(process.env.PORT ?? 5174);
const WOWSIMS_PORT = Number(process.env.WOWSIMS_PORT ?? 3333);

const runs = new RunManager();

/** Checked once at startup and kept for the session; downloads report progress here. */
let update: UpdateInfo | null = null;
let downloadState: { state: 'idle' | 'running' | 'done' | 'error'; received: number; total: number; file?: string; message?: string } = {
	state: 'idle',
	received: 0,
	total: 0,
};

function readJson<T>(path: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(path, 'utf8')) as T;
	} catch {
		return fallback;
	}
}

/**
 * Reads a saved id list, drops anything the current character cannot use, and
 * rewrites the file when it changed. Selections outlive a profile import, so a
 * warrior's plate must not linger in a warlock's list.
 */
function usableIds(path: string, profile: ParsedProfile | null): { ids: number[]; dropped: { id: number; name: string }[] } {
	const stored = readJson<number[]>(path, []);
	if (!profile || stored.length === 0) return { ids: stored, dropped: [] };

	const { kept, dropped } = loadItemDatabase().partitionUsable(stored, profile.wowClass);
	if (dropped.length) fs.writeFileSync(path, JSON.stringify(kept));
	return { ids: kept, dropped };
}

const currentProfile = (): ParsedProfile | null => profiles.activeProfile();

function effectiveConfig(profile: ParsedProfile | null): Config {
	const config = loadConfig(loadItemDatabase(), profiles.activeId());
	return profile ? withSuggestions(config, loadItemDatabase(), profile) : config;
}

const app = Fastify({ logger: false });

app.get('/api/state', async () => {
	const profile = currentProfile();
	const config = effectiveConfig(profile);
	const release = readJson(RELEASE_PATH, { version: 'unknown' });
	const id = profiles.activeId();
	const selection = usableIds(id ? selectionPath(id) : '', profile);
	const bench = usableIds(id ? benchPath(id) : '', profile);

	let summary = null;
	if (profile) {
		const db = loadItemDatabase();
		const hitStat = resolveHitStat(config, profile);
		const hitIdx = hitStatIndex(hitStat);
		summary = {
			name: profile.playerName,
			className: profile.className,
			spec: profile.spec.label,
			metric: resolveMetric(config, profile),
			hitStat,
			hitStatName: STAT_NAMES[hitIdx],
			gearHit: gearHitRating(db, profile.equipment, hitIdx),
			targetHit: resolveTargetHitRating(db, profile, config),
			equipped: profile.equipment.map((spec, slot) => ({
				slot,
				id: spec?.id ?? 0,
				name: spec ? (db.item(spec.id)?.name ?? `item ${spec.id}`) : '',
				enchant: spec?.enchant ? (db.enchant(spec.enchant)?.name ?? `enchant ${spec.enchant}`) : '',
				gems: (spec?.gems ?? []).filter(Boolean).map(id => db.gem(id)?.name ?? `gem ${id}`),
			})),
			sets: [...setsInGear(db, profile.equipment).values()],
		};
	}

	const dropped = [...selection.dropped, ...bench.dropped];
	return {
		profile: summary,
		config,
		release,
		selection: selection.ids,
		bench: bench.ids,
		version: appVersion(),
		profiles: profiles.list().map(entry => ({ id: entry.id, label: entry.label, className: entry.className, spec: entry.spec })),
		activeProfileId: profiles.activeId(),
		update: update && { latest: update.latest, url: update.url, downloadable: !!update.asset },
		// Surfaced so a vanishing item is explained rather than just gone.
		dropped: dropped.map(item => item.name),
		running: runs.isRunning(),
	};
});

app.post<{ Body: { json: string } }>('/api/profile', async (request, reply) => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(request.body.json);
	} catch (err) {
		return reply.code(400).send({ error: `That is not valid JSON: ${(err as Error).message}` });
	}

	try {
		const profile = parseProfile(parsed);
		const result = profiles.createOrUpdate(parsed, profile);

		// A new character starts from gems and enchants read off its own gear.
		if (result.created) saveConfig(withSuggestions(loadConfig(loadItemDatabase(), result.id), loadItemDatabase(), profile), result.id);

		const dropped = [...usableIds(selectionPath(result.id), profile).dropped, ...usableIds(benchPath(result.id), profile).dropped];
		return {
			ok: true,
			className: profile.className,
			spec: profile.spec.label,
			created: result.created,
			label: result.label,
			kept: result.kept,
			dropped: dropped.map(item => item.name),
		};
	} catch (err) {
		if (err instanceof ProfileError) return reply.code(400).send({ error: err.message });
		throw err;
	}
});

app.get('/api/catalog', async (_request, reply) => {
	const profile = currentProfile();
	if (!profile) return reply.code(400).send({ error: 'Import a profile first.' });

	const db = loadItemDatabase();
	const equippedIds = new Set(profile.equipment.filter(Boolean).map(spec => spec!.id));
	return { items: db.catalog({ wowClass: profile.wowClass, equippedIds }) };
});

app.post<{ Body: { ids: number[] } }>('/api/selection', async request => {
	const ids = [...new Set((request.body.ids ?? []).map(Number).filter(Boolean))];
	const id = profiles.activeId();
	if (!id) return { ok: false, count: 0 };
	fs.writeFileSync(selectionPath(id), JSON.stringify(ids));
	return { ok: true, count: ids.length };
});

app.post<{ Body: { ids: number[] } }>('/api/bench', async request => {
	const ids = [...new Set((request.body.ids ?? []).map(Number).filter(Boolean))];
	const id = profiles.activeId();
	if (!id) return { ok: false, count: 0 };
	fs.writeFileSync(benchPath(id), JSON.stringify(ids));
	return { ok: true, count: ids.length };
});

app.post<{ Body: Partial<Config> }>('/api/config', async request => {
	const id = profiles.activeId();
	saveConfig({ ...loadConfig(loadItemDatabase(), id), ...request.body } as Config, id);
	return { ok: true, config: effectiveConfig(currentProfile()) };
});

app.post<{ Body: { id: string } }>('/api/profiles/activate', async (request, reply) => {
	// Swapping state under a running sim would leave the results attributed to
	// the wrong character.
	if (runs.isRunning()) return reply.code(409).send({ error: 'A run is in progress — stop it before switching character.' });
	if (!profiles.activate(request.body.id)) return reply.code(404).send({ error: 'No such profile.' });
	return { ok: true };
});

app.post<{ Body: { id: string; label: string } }>('/api/profiles/rename', async (request, reply) => {
	if (!profiles.rename(request.body.id, request.body.label ?? '')) return reply.code(400).send({ error: 'Could not rename that profile.' });
	return { ok: true };
});

app.post<{ Body: { id: string } }>('/api/profiles/delete', async (request, reply) => {
	if (runs.isRunning()) return reply.code(409).send({ error: 'A run is in progress — stop it first.' });
	if (!profiles.remove(request.body.id)) return reply.code(404).send({ error: 'No such profile.' });
	return { ok: true };
});

app.get('/api/gems', async () => {
	const db = loadItemDatabase();
	const config = effectiveConfig(currentProfile());
	// Gem ids the config already points at must survive de-duplication, or the
	// picker would show an empty box for a perfectly valid choice.
	const inUse = new Set([config.gems.meta, config.gems.base, config.gems.hit, ...Object.values(config.gems.metaFix)]);
	// A handful of TBC gems exist under two ids with identical stats; show one.
	const seen = new Set<string>();

	return {
		gems: [...db.gems.values()]
			.filter(gem => (gem.quality ?? 0) >= 2)
			.filter(gem => {
				const signature = `${gem.name}|${gem.color}|${describeStats(db.gemStats(gem.id))}`;
				if (inUse.has(gem.id)) return true;
				if (seen.has(signature)) return false;
				seen.add(signature);
				return true;
			})
			.map(gem => ({
				id: gem.id,
				name: gem.name,
				color: gem.color ?? 0,
				colorName: GEM_COLOR_NAMES[gem.color ?? 0] ?? '',
				phase: gem.phase ?? 0,
				quality: gem.quality ?? 0,
				unique: gem.unique ?? false,
				jewelcrafting: gem.requiredProfession === Profession.Jewelcrafting,
				stats: describeStats(db.gemStats(gem.id)),
			}))
			.sort((a, b) => a.color - b.color || b.quality - a.quality || b.phase - a.phase || a.name.localeCompare(b.name)),
	};
});

app.post('/api/update/download', async (_request, reply) => {
	if (!update?.asset) return reply.code(400).send({ error: 'Nothing to download for this platform — use the release page.' });
	if (downloadState.state === 'running') return { ok: true };

	downloadState = { state: 'running', received: 0, total: update.asset.size };
	void downloadUpdate(update, (received, total) => {
		downloadState = { ...downloadState, received, total: total || downloadState.total };
	})
		.then(result => {
			downloadState = { ...downloadState, state: 'done', file: result.file };
			openPath(result.directory);
		})
		.catch((err: unknown) => {
			downloadState = { ...downloadState, state: 'error', message: err instanceof Error ? err.message : String(err) };
		});

	return { ok: true };
});

app.get('/api/update/progress', async () => downloadState);

app.post('/api/run', async (_request, reply) => {
	const profile = currentProfile();
	if (!profile) return reply.code(400).send({ error: 'Import a profile first.' });

	const id = profiles.activeId()!;
	const selection = usableIds(selectionPath(id), profile).ids;
	if (!selection.length) return reply.code(400).send({ error: 'Add at least one item to sim.' });

	try {
		runs.start({
			db: loadItemDatabase(),
			profile,
			config: effectiveConfig(profile),
			selectedIds: selection,
			benchIds: usableIds(benchPath(id), profile).ids,
			onFinished: progress => fs.writeFileSync(lastRunPath(id), `${JSON.stringify(progress, null, 2)}\n`),
		});
		return { ok: true };
	} catch (err) {
		return reply.code(409).send({ error: (err as Error).message });
	}
});

app.post('/api/run/abort', async () => {
	runs.abort();
	return { ok: true };
});

app.get('/api/progress', async () => {
	const live = runs.getProgress();
	if (live.state !== 'idle' || live.results.length) return live;

	// Idle: show this character's last run rather than an empty table.
	const id = profiles.activeId();
	return id ? readJson(lastRunPath(id), live) : live;
});

app.get('/api/results.csv', async (_request, reply) => {
	const { results } = runs.getProgress();
	const header = ['Item', 'Slot', 'Kind', 'Delta', 'CI', 'Value', 'Iterations', 'WithinNoise', 'HitDelta', 'Replaces', 'SetNotes', 'Warnings'];
	const rows = results.map(r =>
		[
			r.label,
			r.slotLabel,
			r.kind,
			r.delta.toFixed(2),
			r.deltaCI.toFixed(2),
			r.dps.toFixed(2),
			r.iterations,
			r.withinNoise ? 'yes' : 'no',
			r.hitDelta.toFixed(0),
			r.replaces,
			r.setNotes.join('; '),
			r.warnings.join('; '),
		]
			.map(cell => `"${String(cell).replaceAll('"', '""')}"`)
			.join(','),
	);
	reply.header('Content-Type', 'text/csv');
	reply.header('Content-Disposition', 'attachment; filename="upgrades.csv"');
	return [header.join(','), ...rows].join('\n');
});

// Everything that isn't an API route is a UI asset. Unknown paths fall back to
// index.html so a bare "/" and any client-side route both work.
app.setNotFoundHandler((request, reply) => {
	if (request.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });

	const asset = resolveAsset(request.url);
	if (!asset) {
		return reply.code(503).type('text/plain').send("The UI is not built. Run 'npm run build:web'.");
	}
	return reply.type(asset.mime).send(asset.body);
});

/** True if something is already listening, so we don't fight over the port. */
function portInUse(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const socket = net.connect({ port, host: '127.0.0.1' });
		socket.setTimeout(400);
		socket.on('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.on('error', () => resolve(false));
		socket.on('timeout', () => {
			socket.destroy();
			resolve(false);
		});
	});
}

/** Starts the wowsims UI alongside this app so one command gives you both. */
async function startWowsimsUI(): Promise<void> {
	if (await portInUse(WOWSIMS_PORT)) {
		console.log(`  wowsims UI already running on :${WOWSIMS_PORT} — leaving it alone.`);
		return;
	}

	const binary = uiBinary();
	if (!fs.existsSync(binary)) {
		console.log(`  wowsims UI not found at ${binary}.`);
		return;
	}
	const child = spawn(binary, ['--launch=false', '--nvc', `--host=localhost:${WOWSIMS_PORT}`], { stdio: 'ignore' });
	child.on('error', err => console.log(`  wowsims UI failed to start: ${err.message}`));
	const stop = () => child.kill();
	process.on('exit', stop);
	process.on('SIGINT', () => {
		stop();
		process.exit(0);
	});
	process.on('SIGTERM', () => {
		stop();
		process.exit(0);
	});
}

/** Hands a URL or folder to the OS — the browser for the app, Finder/Explorer for a download. */
function openPath(target: string): void {
	const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
	try {
		spawn(opener, [target], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
	} catch {
		/* the path is printed either way */
	}
}

async function main(): Promise<void> {
	console.log(`\n  Simgrade`);

	const migration = profiles.migrateIfNeeded();
	if (migration.migrated) console.log(`  Moved your existing setup into a profile: ${migration.label}`);
	if (STATE_DIR_IS_FALLBACK) console.log(`  Saving data to ${STATE_DIR} (the install folder is not writable).`);

	// A packaged build has no npm, so it fetches its own sim binaries here.
	try {
		await ensureRuntime({ onProgress: message => console.log(`  ${message}`) });
	} catch (err) {
		console.error(`\n  Setup failed: ${(err as Error).message}`);
		console.error('  Check your internet connection and start Simgrade again.\n');
		process.exit(1);
	}

	if (loadWebAssets().size === 0) {
		console.log("  UI not built — run 'npm run build:web' (or 'npm start', which builds it for you).");
	}

	// Never blocks startup, and any failure leaves `update` null.
	if (loadConfig().checkForUpdates) {
		void checkForUpdate().then(found => {
			update = found;
			if (found) console.log(`\n  Simgrade ${found.latest} is available (you have ${found.current}) — ${found.url}`);
		});
	}

	await startWowsimsUI();
	await app.listen({ port: PORT, host: '127.0.0.1' });

	console.log(`\n  Simgrade         http://localhost:${PORT}`);
	console.log(`  wowsims UI       http://localhost:${WOWSIMS_PORT}/tbc/\n`);

	if (IS_PACKAGED || process.env.SIMGRADE_OPEN_BROWSER === '1') openPath(`http://localhost:${PORT}`);
}

main().catch((err: unknown) => {
	console.error(`\n  Simgrade failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
