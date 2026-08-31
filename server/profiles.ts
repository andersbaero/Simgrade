// One profile per character. Importing a CLI export creates a profile or
// refreshes an existing one's gear, so switching characters restores that
// character's item list, bench and gem choices instead of overwriting them.

import fs from 'node:fs';
import path from 'node:path';

import { PROFILE_CONFIG_KEYS } from './config.js';
import {
	benchPath,
	LEGACY,
	lastRunPath,
	PROFILES_DIR,
	PROFILES_PATH,
	profileConfigPath,
	profileDir,
	profilePath,
	selectionPath,
	SETTINGS_PATH,
} from './paths.js';
import { ParsedProfile, parseProfile } from './profile.js';

export interface ProfileEntry {
	id: string;
	label: string;
	name: string;
	className: string;
	spec: string;
	importedAt: string;
}

interface ProfileIndex {
	active: string | null;
	profiles: ProfileEntry[];
}

const EMPTY: ProfileIndex = { active: null, profiles: [] };

function readIndex(): ProfileIndex {
	try {
		const stored = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')) as ProfileIndex;
		return { active: stored.active ?? null, profiles: stored.profiles ?? [] };
	} catch {
		return structuredClone(EMPTY);
	}
}

function writeIndex(index: ProfileIndex): void {
	fs.mkdirSync(PROFILES_DIR, { recursive: true });
	fs.writeFileSync(PROFILES_PATH, `${JSON.stringify(index, null, 2)}\n`);
}

/**
 * Identity for a character. The CLI export usually carries no real name — both
 * of a player's characters can come through as "Player" — so the spec key is
 * part of the id, which also implies the class.
 */
export function profileId(profile: ParsedProfile): string {
	const slug = `${profile.playerName}-${profile.spec.key}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'character';
}

export const defaultLabel = (profile: ParsedProfile) => `${profile.playerName} — ${profile.spec.label}`;

export function list(): ProfileEntry[] {
	return readIndex().profiles;
}

/** The active profile id, falling back to the first one if the pointer is stale. */
export function activeId(): string | null {
	const index = readIndex();
	if (index.active && index.profiles.some(entry => entry.id === index.active)) return index.active;
	return index.profiles[0]?.id ?? null;
}

export function activeProfile(): ParsedProfile | null {
	const id = activeId();
	if (!id) return null;
	try {
		return parseProfile(JSON.parse(fs.readFileSync(profilePath(id), 'utf8')));
	} catch {
		return null;
	}
}

export interface SaveResult {
	id: string;
	label: string;
	created: boolean;
	/** What an update preserved, so a re-import visibly does not clobber. */
	kept: { selection: number; bench: number };
}

/**
 * Creates a profile for this character, or refreshes an existing one's gear.
 * An update rewrites only profile.json — the item list, bench and gem choices
 * are left exactly as they were.
 */
export function createOrUpdate(raw: unknown, profile: ParsedProfile): SaveResult {
	const id = profileId(profile);
	const index = readIndex();
	const existing = index.profiles.find(entry => entry.id === id);

	fs.mkdirSync(profileDir(id), { recursive: true });
	fs.writeFileSync(profilePath(id), JSON.stringify(raw, null, 1));

	const count = (file: string) => {
		try {
			return (JSON.parse(fs.readFileSync(file, 'utf8')) as number[]).length;
		} catch {
			return 0;
		}
	};

	if (!existing) {
		index.profiles.push({
			id,
			label: defaultLabel(profile),
			name: profile.playerName,
			className: profile.className,
			spec: profile.spec.label,
			importedAt: new Date().toISOString(),
		});
	}
	index.active = id;
	writeIndex(index);

	return {
		id,
		label: existing?.label ?? defaultLabel(profile),
		created: !existing,
		kept: { selection: count(selectionPath(id)), bench: count(benchPath(id)) },
	};
}

export function activate(id: string): boolean {
	const index = readIndex();
	if (!index.profiles.some(entry => entry.id === id)) return false;
	index.active = id;
	writeIndex(index);
	return true;
}

export function rename(id: string, label: string): boolean {
	const index = readIndex();
	const entry = index.profiles.find(candidate => candidate.id === id);
	if (!entry || !label.trim()) return false;
	entry.label = label.trim().slice(0, 60);
	writeIndex(index);
	return true;
}

export function remove(id: string): boolean {
	const index = readIndex();
	if (!index.profiles.some(entry => entry.id === id)) return false;

	index.profiles = index.profiles.filter(entry => entry.id !== id);
	if (index.active === id) index.active = index.profiles[0]?.id ?? null;
	writeIndex(index);
	fs.rmSync(profileDir(id), { recursive: true, force: true });
	return true;
}

/**
 * Moves the old single-character layout into the first profile. Copies, writes
 * the index, and only then deletes the originals, so a failure part-way leaves
 * the existing setup intact and reachable.
 */
export function migrateIfNeeded(): { migrated: boolean; label?: string } {
	if (fs.existsSync(PROFILES_PATH)) return { migrated: false };

	if (!fs.existsSync(LEGACY.profile)) {
		writeIndex(structuredClone(EMPTY));
		return { migrated: false };
	}

	let profile: ParsedProfile;
	try {
		profile = parseProfile(JSON.parse(fs.readFileSync(LEGACY.profile, 'utf8')));
	} catch {
		// Unreadable legacy profile: start clean rather than lose the file.
		writeIndex(structuredClone(EMPTY));
		return { migrated: false };
	}

	const id = profileId(profile);
	fs.mkdirSync(profileDir(id), { recursive: true });

	const copy = (from: string, to: string) => {
		if (fs.existsSync(from)) fs.copyFileSync(from, to);
	};
	copy(LEGACY.profile, profilePath(id));
	copy(LEGACY.selection, selectionPath(id));
	copy(LEGACY.bench, benchPath(id));
	copy(LEGACY.lastRun, lastRunPath(id));

	// The old config held both kinds of setting; split it by the same key list
	// the loader uses, so nothing is lost and nothing lands in the wrong file.
	if (fs.existsSync(LEGACY.config)) {
		const stored = JSON.parse(fs.readFileSync(LEGACY.config, 'utf8')) as Record<string, unknown>;
		const forProfile: Record<string, unknown> = {};
		const shared: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(stored)) {
			(PROFILE_CONFIG_KEYS.includes(key as never) ? forProfile : shared)[key] = value;
		}
		fs.writeFileSync(profileConfigPath(id), `${JSON.stringify(forProfile, null, 2)}\n`);
		if (!fs.existsSync(SETTINGS_PATH)) fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(shared, null, 2)}\n`);
	}

	writeIndex({
		active: id,
		profiles: [
			{
				id,
				label: defaultLabel(profile),
				name: profile.playerName,
				className: profile.className,
				spec: profile.spec.label,
				importedAt: new Date().toISOString(),
			},
		],
	});

	// Only now that everything is in place.
	for (const file of Object.values(LEGACY)) fs.rmSync(file, { force: true });
	return { migrated: true, label: defaultLabel(profile) };
}

export const profileFiles = { profilePath, selectionPath, benchPath, profileConfigPath, lastRunPath, dir: profileDir, indexPath: PROFILES_PATH, root: path.dirname(PROFILES_PATH) };
