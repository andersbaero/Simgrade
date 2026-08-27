import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import { GEM_COLOR_NAMES, Profession, STAT_NAMES } from '../shared/wow.js';
import { Config, loadConfig, saveConfig, resolveHitStat, resolveMetric, hitStatIndex, withSuggestions } from './config.js';
import { describeStats, loadItemDatabase } from './itemDb.js';
import { BENCH_PATH, CONFIG_PATH, LAST_RUN_PATH, PROFILE_PATH, RELEASE_PATH, SELECTION_PATH, uiBinary, WEB_DIST } from './paths.js';
import { ParsedProfile, ProfileError, parseProfile } from './profile.js';
import { RunManager, resolveTargetHitRating } from './run.js';
import { gearHitRating } from './gearing.js';
import { setsInGear } from './sets.js';

const PORT = Number(process.env.PORT ?? 5174);
const WOWSIMS_PORT = Number(process.env.WOWSIMS_PORT ?? 3333);

const runs = new RunManager();

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

function currentProfile(): ParsedProfile | null {
	if (!fs.existsSync(PROFILE_PATH)) return null;
	try {
		return parseProfile(readJson(PROFILE_PATH, null));
	} catch {
		return null;
	}
}

function effectiveConfig(profile: ParsedProfile | null): Config {
	const config = loadConfig();
	return profile ? withSuggestions(config, loadItemDatabase(), profile) : config;
}

const app = Fastify({ logger: false });

app.get('/api/state', async () => {
	const profile = currentProfile();
	const config = effectiveConfig(profile);
	const release = readJson(RELEASE_PATH, { version: 'unknown' });
	const selection = usableIds(SELECTION_PATH, profile);
	const bench = usableIds(BENCH_PATH, profile);

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
		fs.writeFileSync(PROFILE_PATH, JSON.stringify(parsed, null, 1));
		// Re-derive gem/enchant defaults for the new character, keeping explicit choices.
		if (!fs.existsSync(CONFIG_PATH)) saveConfig(withSuggestions(loadConfig(), loadItemDatabase(), profile));

		const dropped = [...usableIds(SELECTION_PATH, profile).dropped, ...usableIds(BENCH_PATH, profile).dropped];
		return { ok: true, className: profile.className, spec: profile.spec.label, dropped: dropped.map(item => item.name) };
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
	fs.writeFileSync(SELECTION_PATH, JSON.stringify(ids));
	return { ok: true, count: ids.length };
});

app.post<{ Body: { ids: number[] } }>('/api/bench', async request => {
	const ids = [...new Set((request.body.ids ?? []).map(Number).filter(Boolean))];
	fs.writeFileSync(BENCH_PATH, JSON.stringify(ids));
	return { ok: true, count: ids.length };
});

app.post<{ Body: Partial<Config> }>('/api/config', async request => {
	saveConfig({ ...loadConfig(), ...request.body } as Config);
	return { ok: true, config: effectiveConfig(currentProfile()) };
});

app.get('/api/gems', async () => {
	const db = loadItemDatabase();
	const config = effectiveConfig(currentProfile());
	// Gem ids the config already points at must survive de-duplication, or the
	// picker would show an empty box for a perfectly valid choice.
	const inUse = new Set([config.gems.meta, ...Object.values(config.gems.normal), ...Object.values(config.gems.hit)]);
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

app.post('/api/run', async (_request, reply) => {
	const profile = currentProfile();
	if (!profile) return reply.code(400).send({ error: 'Import a profile first.' });

	const selection = usableIds(SELECTION_PATH, profile).ids;
	if (!selection.length) return reply.code(400).send({ error: 'Add at least one item to sim.' });

	try {
		runs.start({
			db: loadItemDatabase(),
			profile,
			config: effectiveConfig(profile),
			selectedIds: selection,
			benchIds: usableIds(BENCH_PATH, profile).ids,
			onFinished: progress => fs.writeFileSync(LAST_RUN_PATH, `${JSON.stringify(progress, null, 2)}\n`),
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

app.get('/api/progress', async () => runs.getProgress());

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

// Serve the built UI when it exists; in dev the Vite server proxies /api here.
if (fs.existsSync(WEB_DIST)) {
	await app.register(fastifyStatic, { root: WEB_DIST });
	app.setNotFoundHandler((request, reply) => {
		if (request.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
		return reply.sendFile('index.html');
	});
} else {
	console.log("  UI not built — run 'npm run build:web' (or use 'npm start', which builds it for you).");
}

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
		console.log(`  wowsims UI not found at ${binary} — run 'npm run setup'.`);
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

await startWowsimsUI();
await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`\n  Simgrade         http://localhost:${PORT}`);
console.log(`  wowsims UI       http://localhost:${WOWSIMS_PORT}/tbc/\n`);
