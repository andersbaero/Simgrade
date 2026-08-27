import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN_DIR = path.join(ROOT, 'bin');
export const DATA_DIR = path.join(ROOT, 'data');
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
