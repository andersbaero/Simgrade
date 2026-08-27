#!/usr/bin/env node
// Downloads the wowsims release binaries (wowsimcli + wowsimtbc) and the item
// database for the pinned release, into bin/ and data/.
//
//   node scripts/setup.mjs            # use pinned version in data/release.json, or latest
//   node scripts/setup.mjs --latest   # re-pin to the newest release and download it
//   node scripts/setup.mjs v0.0.121   # pin to a specific tag

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin');
const DATA = path.join(ROOT, 'data');
const RELEASE_FILE = path.join(DATA, 'release.json');
const REPO = 'wowsims/tbc-new';

// Release assets are named per platform; wowsimtbc has no arm64-linux build.
function assetSuffix() {
	const platform = os.platform();
	const arch = os.arch();
	if (platform === 'darwin') return arch === 'arm64' ? 'arm64-darwin' : 'amd64-darwin';
	if (platform === 'linux') return 'amd64-linux';
	if (platform === 'win32') return 'windows.exe';
	throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

async function resolveVersion(argv) {
	const explicit = argv.find(a => /^v?\d+\.\d+\.\d+$/.test(a));
	if (explicit) return explicit.startsWith('v') ? explicit : `v${explicit}`;

	if (!argv.includes('--latest')) {
		try {
			const pinned = JSON.parse(await fs.readFile(RELEASE_FILE, 'utf8'));
			if (pinned.version) return pinned.version;
		} catch {
			/* no pin yet - fall through to latest */
		}
	}

	const resp = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
	if (!resp.ok) throw new Error(`GitHub API returned ${resp.status} fetching latest release`);
	return (await resp.json()).tag_name;
}

async function download(url, dest) {
	const resp = await fetch(url, { redirect: 'follow' });
	if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} for ${url}`);
	await fs.writeFile(dest, Buffer.from(await resp.arrayBuffer()));
}

// The zips contain a single bare executable named after the asset.
async function fetchBinary(version, name, suffix) {
	const exe = suffix === 'windows.exe' ? `${name}-windows.exe` : `${name}-${suffix}`;
	const target = path.join(BIN, suffix === 'windows.exe' ? `${name}.exe` : name);
	const zip = path.join(BIN, `${exe}.zip`);

	process.stdout.write(`  ${exe} ... `);
	await download(`https://github.com/${REPO}/releases/download/${version}/${exe}.zip`, zip);
	execFileSync('unzip', ['-o', '-q', zip, '-d', BIN]);
	await fs.rename(path.join(BIN, exe), target);
	await fs.rm(zip);
	await fs.chmod(target, 0o755);
	// Gatekeeper quarantines anything downloaded; without this macOS refuses to exec it.
	if (os.platform() === 'darwin') {
		try {
			execFileSync('xattr', ['-d', 'com.apple.quarantine', target], { stdio: 'ignore' });
		} catch {
			/* attribute not present */
		}
	}
	console.log('ok');
}

async function main() {
	const argv = process.argv.slice(2);
	const version = await resolveVersion(argv);
	const suffix = assetSuffix();

	console.log(`wowsims release ${version} (${suffix})`);
	await fs.mkdir(BIN, { recursive: true });
	await fs.mkdir(DATA, { recursive: true });

	await fetchBinary(version, 'wowsimcli', suffix);
	await fetchBinary(version, 'wowsimtbc', suffix);

	process.stdout.write('  db.json ... ');
	await download(`https://raw.githubusercontent.com/${REPO}/${version}/assets/database/db.json`, path.join(DATA, 'db.json'));
	const size = (await fs.stat(path.join(DATA, 'db.json'))).size;
	console.log(`ok (${(size / 1e6).toFixed(1)} MB)`);

	await fs.writeFile(RELEASE_FILE, `${JSON.stringify({ version, suffix, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
	console.log(`\nPinned to ${version}. Run 'npm start' to launch.`);
}

main().catch(err => {
	console.error(`\nsetup failed: ${err.message}`);
	process.exit(1);
});
