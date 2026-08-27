#!/usr/bin/env node
// Builds a single-file executable using Node's Single Executable Application
// support: bundle the server to one CommonJS file, embed the built UI as SEA
// assets, then inject the blob into a copy of the node binary.
//
// Run this on the platform you are targeting — this does not cross-compile.
// CI (.github/workflows/release.yml) runs it on a Windows and a macOS runner.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build as esbuild } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const WEB_DIST = path.join(ROOT, 'web', 'dist');

const IS_WINDOWS = process.platform === 'win32';
const EXE_NAME = IS_WINDOWS ? 'Simgrade.exe' : 'Simgrade';
// vite and postject are plain JS, so they run through `node`. esbuild ships a
// native binary at bin/esbuild on unix and a shim on Windows, so it goes
// through its JS API instead of being exec'd.
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const POSTJECT = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');

function run(command, args, label) {
	const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
	if (result.status !== 0) {
		console.error(`\n${label} failed.`);
		process.exit(result.status ?? 1);
	}
}

// Node 20.12 introduced sea.getAsset(), which the embedded UI depends on.
function checkNode() {
	const [major, minor] = process.versions.node.split('.').map(Number);
	if (major < 20 || (major === 20 && minor < 12)) {
		console.error(`Node 20.12 or newer is required to build (running ${process.versions.node}).`);
		process.exit(1);
	}
}

/** Every file under web/dist, keyed by its URL path. */
function collectWebAssets() {
	const assets = {};
	const walk = (dir, prefix) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			const key = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(full, key);
			else assets[key] = full;
		}
	};
	walk(WEB_DIST, '');
	return assets;
}

function pinnedVersion() {
	const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'release.json'), 'utf8'));
	if (!pin.version) throw new Error('data/release.json has no "version" — cannot pin the wowsims release.');
	return pin.version;
}

checkNode();
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

console.log('1/5  Building the UI…');
run(process.execPath, [VITE, 'build'], 'vite build');

const assets = collectWebAssets();
const version = pinnedVersion();
console.log(`     ${Object.keys(assets).length} UI assets, wowsims pinned to ${version}`);

console.log('2/5  Bundling the server…');
const bundle = path.join(BUILD, 'server.cjs');
try {
	await esbuild({
		entryPoints: [path.join(ROOT, 'server', 'index.ts')],
		outfile: bundle,
		bundle: true,
		platform: 'node',
		target: 'node20',
		format: 'cjs',
		logLevel: 'warning',
		// Each value is a JS expression, so strings need their quotes.
		define: {
			__PACKAGED__: 'true',
			__WEB_ASSET_KEYS__: JSON.stringify(Object.keys(assets)),
			__PINNED_VERSION__: JSON.stringify(version),
			// The source-run branch in paths.ts is dead here, but CommonJS has no
			// import.meta; defining it keeps esbuild quiet about the reference.
			'import.meta.url': '""',
		},
	});
} catch (err) {
	console.error(`\nesbuild failed: ${err.message}`);
	process.exit(1);
}
console.log(`     ${(fs.statSync(bundle).size / 1e6).toFixed(1)} MB bundle`);

console.log('3/5  Generating the SEA blob…');
const seaConfig = path.join(BUILD, 'sea-config.json');
const blob = path.join(BUILD, 'simgrade.blob');
fs.writeFileSync(
	seaConfig,
	`${JSON.stringify(
		{
			main: path.relative(ROOT, bundle),
			output: path.relative(ROOT, blob),
			disableExperimentalSEAWarning: true,
			useSnapshot: false,
			useCodeCache: false,
			assets: Object.fromEntries(Object.entries(assets).map(([key, file]) => [key, path.relative(ROOT, file)])),
		},
		null,
		2,
	)}\n`,
);
run(process.execPath, ['--experimental-sea-config', path.relative(ROOT, seaConfig)], 'sea-config');

console.log('4/5  Injecting into the node binary…');
const output = path.join(DIST, EXE_NAME);
fs.copyFileSync(process.execPath, output);
fs.chmodSync(output, 0o755);

// Injection invalidates any existing signature, so strip it first where that matters.
if (process.platform === 'darwin') {
	try {
		execFileSync('codesign', ['--remove-signature', output], { stdio: 'ignore' });
	} catch {
		/* unsigned already */
	}
}

const postjectArgs = [POSTJECT, output, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
run(process.execPath, postjectArgs, 'postject');

// macOS refuses to run a modified binary without at least an ad-hoc signature.
if (process.platform === 'darwin') {
	console.log('5/5  Ad-hoc signing…');
	run('codesign', ['--sign', '-', output], 'codesign');
} else {
	console.log('5/5  Done.');
}

const size = (fs.statSync(output).size / 1e6).toFixed(0);
console.log(`\n  ${path.relative(ROOT, output)}  (${size} MB, ${os.platform()}/${os.arch()})`);
console.log('  It downloads the wowsims binaries and item database on first run.\n');
