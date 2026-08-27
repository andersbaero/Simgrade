// Tests load the bundled demo profile, never data/profile.json — that file is
// live app state and changes the moment someone imports their own character.

import fs from 'node:fs';
import path from 'node:path';

import { Config, DEFAULT_CONFIG, withSuggestions } from '../server/config.js';
import { loadItemDatabase } from '../server/itemDb.js';
import { DATA_DIR } from '../server/paths.js';
import { parseProfile } from '../server/profile.js';

export const EXAMPLE_PROFILE_PATH = path.join(DATA_DIR, 'profile.example.json');

export const db = loadItemDatabase();
export const profile = parseProfile(JSON.parse(fs.readFileSync(EXAMPLE_PROFILE_PATH, 'utf8')));
export const baseConfig: Config = withSuggestions(structuredClone(DEFAULT_CONFIG), db, profile);
