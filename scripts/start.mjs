#!/usr/bin/env node
// One command for the whole thing: fetches the wowsims binaries on first run,
// builds the UI if needed, then starts this app and the wowsims UI together.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = process.env.PORT ?? '5174';

function run(command, args) {
	const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const exe = process.platform === 'win32' ? '.exe' : '';
const needsSetup = [`bin/wowsimcli${exe}`, `bin/wowsimtbc${exe}`, 'data/db.json'].some(rel => !fs.existsSync(path.join(ROOT, rel)));
if (needsSetup) {
	console.log('First run — downloading the wowsims binaries and item database.\n');
	run(process.execPath, ['scripts/setup.mjs']);
}

if (!fs.existsSync(path.join(ROOT, 'web/dist/index.html'))) {
	console.log('Building the UI…');
	run('npx', ['vite', 'build']);
}

const server = spawn('npx', ['tsx', 'server/index.ts'], { cwd: ROOT, stdio: 'inherit' });

// Give the server a moment to bind before pointing a browser at it.
setTimeout(() => {
	const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
	spawn(opener, [`http://localhost:${APP_PORT}`], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}, 1500);

const stop = () => {
	server.kill();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', code => process.exit(code ?? 0));
