// Serves the built UI. In development the files are read off disk from
// web/dist; in a packaged executable they are embedded as Node SEA assets,
// because there is no web/dist next to a single file. Both end up in the same
// in-memory map, so there is one serving path either way.

import fs from 'node:fs';
import path from 'node:path';

import { IS_PACKAGED, WEB_DIST } from './paths.js';

/** Asset keys baked in by scripts/build-exe.mjs; empty in a source run. */
declare const __WEB_ASSET_KEYS__: string[] | undefined;

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
};

export const mimeFor = (key: string) => MIME_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream';

export interface WebAsset {
	mime: string;
	body: Buffer;
}

let cache: Map<string, WebAsset> | null = null;

function loadFromDisk(): Map<string, WebAsset> {
	const assets = new Map<string, WebAsset>();
	if (!fs.existsSync(WEB_DIST)) return assets;

	const walk = (dir: string, prefix: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			const key = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(full, key);
			else assets.set(key, { mime: mimeFor(key), body: fs.readFileSync(full) });
		}
	};
	walk(WEB_DIST, '');
	return assets;
}

function loadFromExecutable(): Map<string, WebAsset> {
	const assets = new Map<string, WebAsset>();
	const keys = typeof __WEB_ASSET_KEYS__ === 'undefined' ? [] : __WEB_ASSET_KEYS__;
	if (!keys.length) return assets;

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const sea = require('node:sea') as { getAsset(key: string): ArrayBuffer };
	for (const key of keys) {
		assets.set(key, { mime: mimeFor(key), body: Buffer.from(sea.getAsset(key)) });
	}
	return assets;
}

export function loadWebAssets(): Map<string, WebAsset> {
	if (!cache) cache = IS_PACKAGED ? loadFromExecutable() : loadFromDisk();
	return cache;
}

/**
 * Resolves a request path to an asset, falling back to index.html so client-side
 * routes and a bare "/" both work.
 */
export function resolveAsset(urlPath: string): WebAsset | null {
	const assets = loadWebAssets();
	if (!assets.size) return null;

	const key = urlPath.replace(/^\/+/, '').split('?')[0] || 'index.html';
	return assets.get(key) ?? assets.get('index.html') ?? null;
}
