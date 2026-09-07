// Is the pinned wowsims release still the newest one?
//
// Deliberately has no shebang. tests/checkWowsims.test.ts imports this module
// to hold isNewerVersion() against the app's own isNewer(), and a leading '#!'
// is not valid JavaScript — whether it is stripped before parsing depends on
// which loader gets the file, which is why it parsed everywhere except Windows
// CI. Both callers already run it as `node scripts/check-wowsims.mjs`, and the
// file is not executable, so the shebang was never doing anything.
//
// Written to be safe to run automatically at the start of a session, which
// means three rules: it never exits non-zero, it prints nothing when there is
// nothing to say, and it gives up quickly when the network is slow or absent.
// A stale pin is worth knowing about; it is never worth blocking on.
//
//   node scripts/check-wowsims.mjs             quiet: prints only when behind
//   node scripts/check-wowsims.mjs --verbose   also says when up to date
//   node scripts/check-wowsims.mjs --force     ignore the poll interval
//
// Deliberately dependency-free rather than importing server/bootstrap.ts and
// server/updates.ts through tsx: this runs before anything else and must work
// in a checkout with no node_modules. tests/checkWowsims.test.ts pins the
// version comparison against the isNewer() the app itself uses, so the small
// duplication cannot quietly drift.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'wowsims/tbc-new';
const RELEASE_PATH = path.join(ROOT, 'data', 'release.json');
const REPORT_DIR = path.join(ROOT, '.claude', 'wowsims');
const STAMP_PATH = path.join(REPORT_DIR, 'last-check.json');

/** Long enough that opening the repo repeatedly costs nothing, short enough to notice a release the same day. */
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const force = argv.includes('--force');

/** Same rule as isNewer() in server/updates.ts: numeric per part, never guess. */
export function isNewerVersion(current, latest) {
	if (!current || !latest) return false;
	const parse = value => String(value).trim().replace(/^v/i, '').split('.').map(Number);
	const [a, b] = [parse(current), parse(latest)];
	if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (b[i] ?? 0) - (a[i] ?? 0);
		if (diff !== 0) return diff > 0;
	}
	return false;
}

function readJson(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

/** True when the last look was recent enough that another one would tell us nothing new. */
function checkedRecently() {
	if (force) return false;
	const stamp = readJson(STAMP_PATH, null);
	return !!stamp?.at && Date.now() - Date.parse(stamp.at) < POLL_INTERVAL_MS;
}

function recordCheck(latest) {
	try {
		fs.mkdirSync(REPORT_DIR, { recursive: true });
		fs.writeFileSync(STAMP_PATH, `${JSON.stringify({ at: new Date().toISOString(), latest }, null, 2)}\n`);
	} catch {
		/* the check is advisory; failing to remember it is not worth reporting */
	}
}

async function main() {
	const pinned = readJson(RELEASE_PATH, {}).version;
	if (!pinned) {
		if (verbose) console.log('No wowsims pin found in data/release.json.');
		return;
	}

	if (checkedRecently()) {
		if (verbose) console.log(`Checked within the last ${POLL_INTERVAL_MS / 3600000}h; skipping. Use --force to look anyway.`);
		return;
	}

	let latest;
	try {
		const resp = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: 'application/vnd.github+json' },
		});
		if (!resp.ok) throw new Error(`GitHub returned ${resp.status}`);
		latest = (await resp.json()).tag_name;
	} catch (err) {
		// Offline, rate-limited or slow. Say nothing unless asked: a session must
		// not open with an error about a check nobody requested.
		if (verbose) console.log(`Could not reach GitHub: ${err.message}`);
		return;
	}

	recordCheck(latest);

	if (!isNewerVersion(pinned, latest)) {
		if (verbose) console.log(`wowsims pin ${pinned} is current (latest is ${latest}).`);
		return;
	}

	const report = path.join(REPORT_DIR, `${latest}.md`);
	const relative = path.relative(ROOT, report);
	const compare = `https://github.com/${REPO}/compare/${pinned}...${latest}`;

	if (fs.existsSync(report)) {
		console.log(
			`wowsims ${latest} is out; Simgrade pins ${pinned}. An upgrade report for ${latest} already exists at ${relative} — ` +
				'read it if the pin comes up, and do not redo the research.',
		);
		return;
	}

	console.log(
		`wowsims ${latest} is out; Simgrade pins ${pinned} (data/release.json).\n` +
			`No upgrade report exists for ${latest} yet. Research what changed between the two tags and write one to ${relative}, ` +
			'judging whether the new release can be taken on without code changes.\n' +
			`Start from ${compare} — the GitHub compare API gives commits, changed files and per-file patches, and the paths that matter ` +
			'are proto/, sim/core/database.go, sim/core/item_sets.go, sim/core/stats/, ui/core/proto_utils/, assets/database/db.json and ' +
			'anything under sim/ that moves DPS. Report it to the user when done rather than only writing the file.',
	);
}

// Only when run as a command. Importing this module - which the tests do, to
// hold isNewerVersion against the app's own isNewer - must not hit the network.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	// Never let this be the reason a session fails to start.
	main().catch(err => {
		if (verbose) console.log(`wowsims check failed: ${err.message}`);
	});
}
