// Fetches what the app needs to run: the wowsims release binaries and the item
// database. A packaged executable has no npm, so it has to do this itself on
// first launch; scripts/setup.mjs is a thin CLI over the same code.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BIN_DIR, cliBinary, DATA_DIR, DB_PATH, IS_PACKAGED, RELEASE_PATH, uiBinary } from './paths.js';

/** Pinned wowsims release, baked in at build time for packaged builds. */
declare const __PINNED_VERSION__: string | undefined;

const REPO = 'wowsims/tbc-new';

export class BootstrapError extends Error {}

/** Release asset naming: wowsimcli-arm64-darwin, wowsimcli-windows.exe, etc. */
export function assetSuffix(): string {
	const platform = os.platform();
	const arch = os.arch();
	if (platform === 'darwin') return arch === 'arm64' ? 'arm64-darwin' : 'amd64-darwin';
	if (platform === 'linux') return 'amd64-linux';
	if (platform === 'win32') return 'windows.exe';
	throw new BootstrapError(`Unsupported platform: ${platform}/${arch}`);
}

/**
 * The version to install. A packaged build carries its pin as a constant; a
 * source checkout reads data/release.json, which is committed.
 */
export function pinnedVersion(): string | null {
	if (typeof __PINNED_VERSION__ !== 'undefined' && __PINNED_VERSION__) return __PINNED_VERSION__;
	try {
		return (JSON.parse(fs.readFileSync(RELEASE_PATH, 'utf8')) as { version?: string }).version ?? null;
	} catch {
		return null;
	}
}

export async function latestVersion(): Promise<string> {
	const resp = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
	if (!resp.ok) throw new BootstrapError(`GitHub returned ${resp.status} looking up the latest wowsims release.`);
	return (await resp.json()).tag_name as string;
}

async function download(url: string, dest: string): Promise<void> {
	const resp = await fetch(url, { redirect: 'follow' });
	if (!resp.ok) throw new BootstrapError(`${resp.status} ${resp.statusText} for ${url}`);
	await fs.promises.writeFile(dest, Buffer.from(await resp.arrayBuffer()));
}

/**
 * Extracts a zip with whatever the platform ships. Windows has no `unzip`, but
 * Windows 10 1803+ has bsdtar as `tar`, which reads zips; PowerShell's
 * Expand-Archive is the fallback for anything older.
 */
function extractZip(zip: string, dir: string): void {
	if (os.platform() === 'win32') {
		try {
			execFileSync('tar', ['-xf', zip, '-C', dir], { stdio: 'ignore' });
			return;
		} catch {
			execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${dir}" -Force`], {
				stdio: 'ignore',
			});
			return;
		}
	}
	execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
}

// The zips contain a single bare executable named after the asset.
async function fetchBinary(version: string, name: string, suffix: string, onProgress: (message: string) => void): Promise<void> {
	const asset = suffix === 'windows.exe' ? `${name}-windows.exe` : `${name}-${suffix}`;
	const target = path.join(BIN_DIR, suffix === 'windows.exe' ? `${name}.exe` : name);
	const zip = path.join(BIN_DIR, `${asset}.zip`);

	onProgress(`Downloading ${asset}…`);
	await download(`https://github.com/${REPO}/releases/download/${version}/${asset}.zip`, zip);
	extractZip(zip, BIN_DIR);
	await fs.promises.rename(path.join(BIN_DIR, asset), target);
	await fs.promises.rm(zip);
	await fs.promises.chmod(target, 0o755);

	// Gatekeeper quarantines anything downloaded; without this macOS refuses to exec it.
	if (os.platform() === 'darwin') {
		try {
			execFileSync('xattr', ['-d', 'com.apple.quarantine', target], { stdio: 'ignore' });
		} catch {
			/* attribute not present */
		}
	}
}

export interface BootstrapOptions {
	/** Install this version instead of the pin, and record it as the new pin. */
	version?: string;
	/** Re-download even when the files are already present. */
	force?: boolean;
	onProgress?: (message: string) => void;
}

export interface BootstrapResult {
	version: string;
	installed: boolean;
}

/**
 * Ensures the sim binaries and item database are present, downloading them if
 * not. Returns without touching the network when everything is already there.
 */
export async function ensureRuntime(options: BootstrapOptions = {}): Promise<BootstrapResult> {
	const onProgress = options.onProgress ?? (() => undefined);
	const suffix = assetSuffix();

	fs.mkdirSync(BIN_DIR, { recursive: true });
	fs.mkdirSync(DATA_DIR, { recursive: true });

	const complete = fs.existsSync(cliBinary()) && fs.existsSync(uiBinary()) && fs.existsSync(DB_PATH);
	const pin = options.version ?? pinnedVersion();

	if (complete && !options.force && !options.version) {
		return { version: pin ?? 'unknown', installed: false };
	}

	const version = pin ?? (await latestVersion());
	onProgress(`Setting up wowsims ${version} (${suffix}). This happens once and takes about 56 MB.`);

	await fetchBinary(version, 'wowsimcli', suffix, onProgress);
	await fetchBinary(version, 'wowsimtbc', suffix, onProgress);

	onProgress('Downloading the item database…');
	await download(`https://raw.githubusercontent.com/${REPO}/${version}/assets/database/db.json`, DB_PATH);

	// A source checkout keeps the pin in the repo; a packaged build carries it
	// as a constant, so writing it back would be meaningless.
	if (!IS_PACKAGED) {
		await fs.promises.writeFile(RELEASE_PATH, `${JSON.stringify({ version }, null, 2)}\n`);
	}

	onProgress('Ready.');
	return { version, installed: true };
}
