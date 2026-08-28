import { describe, expect, it } from 'vitest';

import { assetForPlatform, checkForUpdate, isNewer, type ReleaseAsset } from '../server/updates.js';

const asset = (name: string): ReleaseAsset => ({ name, url: `https://example/${name}`, size: 1 });

// The real v1.2.0 release assets.
const RELEASE = [asset('Simgrade-macos-arm64.zip'), asset('Simgrade-windows-x64.exe')];

describe('version comparison', () => {
	it('spots a newer release', () => {
		expect(isNewer('1.2.0', 'v1.3.0')).toBe(true);
		expect(isNewer('1.2.0', 'v2.0.0')).toBe(true);
		expect(isNewer('1.2.0', 'v1.2.1')).toBe(true);
	});

	it('ignores the same or an older release', () => {
		expect(isNewer('1.2.0', 'v1.2.0')).toBe(false);
		expect(isNewer('1.2.0', '1.2.0')).toBe(false);
		expect(isNewer('1.2.0', 'v1.1.9')).toBe(false);
		expect(isNewer('2.0.0', 'v1.9.9')).toBe(false);
	});

	it('compares numerically, not as text', () => {
		// "10" sorts before "9" as a string; it must not here.
		expect(isNewer('1.9.0', 'v1.10.0')).toBe(true);
		expect(isNewer('1.10.0', 'v1.9.0')).toBe(false);
	});

	it('never nags a source build', () => {
		expect(isNewer('development', 'v9.9.9')).toBe(false);
	});

	it('says no rather than guessing at a tag it cannot parse', () => {
		expect(isNewer('1.2.0', 'nightly')).toBe(false);
		expect(isNewer('1.2.0', '')).toBe(false);
		expect(isNewer('', 'v1.3.0')).toBe(false);
	});
});

describe('picking the right asset', () => {
	it('takes the exe on Windows', () => {
		expect(assetForPlatform(RELEASE, 'win32', 'x64')?.name).toBe('Simgrade-windows-x64.exe');
	});

	it('takes the matching-architecture zip on macOS', () => {
		expect(assetForPlatform(RELEASE, 'darwin', 'arm64')?.name).toBe('Simgrade-macos-arm64.zip');
		// No Intel build is published, so it must decline rather than hand over the arm64 one.
		expect(assetForPlatform(RELEASE, 'darwin', 'x64')).toBeNull();
	});

	it('returns null when nothing matches, so the UI can fall back to the release page', () => {
		expect(assetForPlatform(RELEASE, 'linux', 'x64')).toBeNull();
		expect(assetForPlatform([], 'win32', 'x64')).toBeNull();
		expect(assetForPlatform([asset('checksums.txt')], 'win32', 'x64')).toBeNull();
	});
});

describe('failure paths return null instead of throwing', () => {
	it('really does reach the network for a published version', async () => {
		let called = false;
		const original = globalThis.fetch;
		globalThis.fetch = (() => {
			called = true;
			return Promise.reject(new Error('boom'));
		}) as unknown as typeof fetch;
		await checkForUpdate('1.2.0');
		globalThis.fetch = original;
		expect(called).toBe(true);
	});

	const withFetch = async (impl: typeof fetch, run: () => Promise<unknown>) => {
		const original = globalThis.fetch;
		globalThis.fetch = impl;
		try {
			return await run();
		} finally {
			globalThis.fetch = original;
		}
	};

	// A source build short-circuits before any request, so pass a real version
	// in — otherwise these would assert nothing at all.
	const check = () => checkForUpdate('1.2.0');

	it('survives being offline', async () => {
		const result = await withFetch((() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as unknown as typeof fetch, check);
		expect(result).toBeNull();
	});

	it('skips the request entirely on a source build', async () => {
		let called = false;
		const original = globalThis.fetch;
		globalThis.fetch = (() => {
			called = true;
			return Promise.reject(new Error('should not happen'));
		}) as unknown as typeof fetch;
		const result = await checkForUpdate('development');
		globalThis.fetch = original;
		expect(result).toBeNull();
		expect(called).toBe(false);
	});

	it('survives a rate-limit response', async () => {
		const result = await withFetch(
			(() => Promise.resolve(new Response('{"message":"API rate limit exceeded"}', { status: 403 }))) as unknown as typeof fetch,
			check,
		);
		expect(result).toBeNull();
	});

	it('survives a malformed body', async () => {
		const result = await withFetch((() => Promise.resolve(new Response('not json', { status: 200 }))) as unknown as typeof fetch, check);
		expect(result).toBeNull();
	});
});
