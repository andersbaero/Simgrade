import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True when running as a Node single executable. The esbuild `--define` in
 * scripts/build-exe.mjs sets this at build time; the `node:sea` check is the
 * runtime fallback, and both are guarded so a plain `tsx` run just says false.
 */
declare const __PACKAGED__: boolean | undefined;

function detectSea(): boolean {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return (require('node:sea') as { isSea(): boolean }).isSea();
	} catch {
		return false;
	}
}

// Written this way on purpose: with `--define:__PACKAGED__=true` esbuild folds
// this to a constant and eliminates the source-run branch below, which is what
// keeps `import.meta.url` out of the packaged CommonJS bundle.
export const IS_PACKAGED = typeof __PACKAGED__ !== 'undefined' ? __PACKAGED__ : detectSea();

/** Where the code lives: next to the executable when packaged, the repo otherwise. */
const INSTALL_DIR = IS_PACKAGED
	? path.dirname(process.execPath)
	: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function isWritableDir(dir: string): boolean {
	try {
		fs.mkdirSync(dir, { recursive: true });
		const probe = path.join(dir, `.write-probe-${process.pid}`);
		fs.writeFileSync(probe, '');
		fs.rmSync(probe);
		return true;
	} catch {
		return false;
	}
}

/** Per-user application data, for when the install directory is read-only. */
function userDataDir(): string {
	if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || os.homedir(), 'Simgrade');
	if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Simgrade');
	return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Simgrade');
}

/**
 * Writable base for everything the app downloads or saves. Prefers sitting next
 * to the executable so a copied folder carries its own state, and falls back to
 * the OS app-data directory when that isn't writable (Program Files, a DMG).
 */
function resolveStateDir(): { dir: string; fallback: boolean } {
	if (isWritableDir(INSTALL_DIR)) return { dir: INSTALL_DIR, fallback: false };
	return { dir: userDataDir(), fallback: true };
}

const state = resolveStateDir();

export const ROOT = INSTALL_DIR;
export const STATE_DIR = state.dir;
/** True when state had to go to the OS app-data directory; worth telling the user. */
export const STATE_DIR_IS_FALLBACK = state.fallback;

export const BIN_DIR = path.join(STATE_DIR, 'bin');
export const DATA_DIR = path.join(STATE_DIR, 'data');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');

export const DB_PATH = path.join(DATA_DIR, 'db.json');
export const PROFILE_PATH = path.join(DATA_DIR, 'profile.json');
export const SELECTION_PATH = path.join(DATA_DIR, 'selection.json');
export const BENCH_PATH = path.join(DATA_DIR, 'bench.json');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const RELEASE_PATH = path.join(DATA_DIR, 'release.json');
export const LAST_RUN_PATH = path.join(DATA_DIR, 'last-run.json');

export const cliBinary = () => path.join(BIN_DIR, process.platform === 'win32' ? 'wowsimcli.exe' : 'wowsimcli');
export const uiBinary = () => path.join(BIN_DIR, process.platform === 'win32' ? 'wowsimtbc.exe' : 'wowsimtbc');
