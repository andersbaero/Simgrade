#!/usr/bin/env node
// Development launcher: build the UI if needed, then run the server, which
// bootstraps the sim binaries itself and opens the browser.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Local tools are invoked as `node <package entry>` rather than through npx.
// On Windows npx is a .cmd, which spawn cannot launch without a shell.
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

if (!fs.existsSync(VITE) || !fs.existsSync(TSX)) {
	console.error("Dependencies are missing. Run 'npm install' first.");
	process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, 'web/dist/index.html'))) {
	console.log('Building the UI…');
	const build = spawnSync(process.execPath, [VITE, 'build'], { cwd: ROOT, stdio: 'inherit' });
	if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, [TSX, 'server/index.ts'], {
	cwd: ROOT,
	stdio: 'inherit',
	env: { ...process.env, SIMGRADE_OPEN_BROWSER: '1' },
});

const stop = () => {
	server.kill();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', code => process.exit(code ?? 0));
