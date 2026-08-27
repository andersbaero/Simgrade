// Thin CLI over server/bootstrap.ts, so `npm run setup` and the packaged
// executable's first-run bootstrap share one implementation.
//
//   npm run setup                 # install the version pinned in data/release.json
//   npm run setup -- --latest     # re-pin to the newest wowsims release
//   npm run setup -- v0.0.121     # pin to a specific tag
//   npm run setup -- --force      # re-download what is already there

import { ensureRuntime, latestVersion } from '../server/bootstrap.js';

const argv = process.argv.slice(2);
const explicit = argv.find(arg => /^v?\d+\.\d+\.\d+$/.test(arg));

const version = explicit
	? explicit.startsWith('v')
		? explicit
		: `v${explicit}`
	: argv.includes('--latest')
		? await latestVersion()
		: undefined;

try {
	const result = await ensureRuntime({
		version,
		force: argv.includes('--force'),
		onProgress: message => console.log(`  ${message}`),
	});
	console.log(result.installed ? `\nPinned to ${result.version}. Run 'npm start' to launch.` : `\nAlready set up (${result.version}).`);
} catch (err) {
	console.error(`\nsetup failed: ${(err as Error).message}`);
	process.exit(1);
}
