// Checks whether a newer Simgrade release exists and, on request, downloads the
// right file for this platform next to the running executable. It never
// replaces the running binary: a half-finished swap would leave someone with no
// working app, and the awkward part for a non-technical user is finding the
// release page and picking the right asset, which this removes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { download, extractZip } from './bootstrap.js';
import { IS_PACKAGED, isWritableDir, ROOT, STATE_DIR } from './paths.js';

/** Simgrade's own version, compiled in by scripts/build-exe.mjs. */
declare const __APP_VERSION__: string | undefined;

const REPO = 'andersbaero/Simgrade';
const DEV_VERSION = 'development';

export function appVersion(): string {
	return typeof __APP_VERSION__ === 'undefined' || !__APP_VERSION__ ? DEV_VERSION : __APP_VERSION__;
}

export interface ReleaseAsset {
	name: string;
	url: string;
	size: number;
}

export interface UpdateInfo {
	current: string;
	latest: string;
	url: string;
	asset: ReleaseAsset | null;
}

const normalise = (tag: string) => tag.trim().replace(/^v/i, '');

/**
 * Whether `latest` is a different release from `current`. Deliberately an
 * inequality rather than a comparison: a tag that does not parse as a version
 * should not be guessed at, and being *behind* is the only case worth flagging
 * to someone running a published build.
 */
export function isNewer(current: string, latest: string): boolean {
	if (!current || !latest || current === DEV_VERSION) return false;

	const parse = (value: string) => normalise(value).split('.').map(Number);
	const [a, b] = [parse(current), parse(latest)];
	if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;

	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (b[i] ?? 0) - (a[i] ?? 0);
		if (diff !== 0) return diff > 0;
	}
	return false;
}

/**
 * The release asset for this platform, matched by shape rather than exact name
 * so a renamed asset degrades to "open the release page" instead of downloading
 * the wrong file.
 */
export function assetForPlatform(assets: ReleaseAsset[], platform = os.platform(), arch = os.arch()): ReleaseAsset | null {
	const match = (predicate: (name: string) => boolean) => assets.find(asset => predicate(asset.name.toLowerCase())) ?? null;

	if (platform === 'win32') return match(name => name.endsWith('.exe'));
	if (platform === 'darwin') return match(name => name.includes(arch === 'arm64' ? 'macos-arm64' : 'macos-amd64') && name.endsWith('.zip'));
	if (platform === 'linux') return match(name => name.includes('linux'));
	return null;
}

/**
 * Looks for a newer release. Every failure — offline, rate limited, a malformed
 * tag — returns null: an update check must never be able to break startup.
 */
export async function checkForUpdate(current = appVersion()): Promise<UpdateInfo | null> {
	if (current === DEV_VERSION) return null;

	try {
		const resp = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
			headers: { Accept: 'application/vnd.github+json' },
			signal: AbortSignal.timeout(10_000),
		});
		if (!resp.ok) return null;

		const body = (await resp.json()) as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string; size: number }[] };
		if (!body.tag_name || !isNewer(current, body.tag_name)) return null;

		const assets = (body.assets ?? []).map(asset => ({ name: asset.name, url: asset.browser_download_url, size: asset.size }));
		return {
			current,
			latest: normalise(body.tag_name),
			url: body.html_url ?? `https://github.com/${REPO}/releases/latest`,
			asset: assetForPlatform(assets),
		};
	} catch {
		return null;
	}
}

export interface DownloadResult {
	/** The downloaded file, ready to swap in. */
	file: string;
	/** Folder to reveal, so the user can find it. */
	directory: string;
}

/**
 * Fetches the update beside the running executable, falling back to the state
 * directory when the install folder is read-only. Named with its version so it
 * can never collide with the copy that is currently running.
 */
export async function downloadUpdate(update: UpdateInfo, onProgress?: (received: number, total: number) => void): Promise<DownloadResult> {
	if (!update.asset) throw new Error('No download for this platform in that release — use the release page.');

	const directory = IS_PACKAGED && isWritableDir(ROOT) ? ROOT : STATE_DIR;
	fs.mkdirSync(directory, { recursive: true });

	const suffix = process.platform === 'win32' ? '.exe' : '';
	const target = path.join(directory, `Simgrade-${update.latest}${suffix}`);

	if (update.asset.name.toLowerCase().endsWith('.zip')) {
		// The macOS asset is zipped so its executable bit survives the download.
		const zip = path.join(directory, `${update.asset.name}.part`);
		await download(update.asset.url, zip, onProgress);
		const staging = fs.mkdtempSync(path.join(directory, 'simgrade-update-'));
		try {
			extractZip(zip, staging);
			const [extracted] = fs.readdirSync(staging);
			if (!extracted) throw new Error('The downloaded archive was empty.');
			fs.copyFileSync(path.join(staging, extracted), target);
			fs.chmodSync(target, 0o755);
		} finally {
			fs.rmSync(staging, { recursive: true, force: true });
			fs.rmSync(zip, { force: true });
		}
	} else {
		await download(update.asset.url, target, onProgress);
		if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
	}

	return { file: target, directory };
}
