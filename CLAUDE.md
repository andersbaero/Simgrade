# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Simgrade ranks WoW TBC gear upgrades by actually simming them through the official wowsims engine.
`README.md` is the user-facing design and methodology doc; `TODO.md` carries the open design
questions. Read both before changing behaviour — several apparent bugs are documented decisions.

## Setup and commands

```bash
npm install
npm run setup            # downloads bin/wowsimcli, bin/wowsimtbc and data/db.json (~56 MB)
```

`npm run setup` is **required before tests** — `tests/sim.test.ts` runs real sims through
`wowsimcli`, and every other test reads the real item database. Neither is in the repo; both are
pinned by `data/release.json`. `npm run setup -- --latest` re-pins to the newest wowsims release,
`-- v0.0.121` pins to a tag, `-- --force` re-downloads.

| | |
|---|---|
| `npm start` | Build the UI if needed, run the server on :5174, spawn the wowsims UI on :3333 |
| `npm run dev:server` | `tsx watch server/index.ts` (no UI build, no browser) |
| `npm run dev:web` | Vite on :5175, proxying `/api` to :5174 — run alongside `dev:server` |
| `npm test` | `vitest run` over `tests/**/*.test.ts` |
| `npm run typecheck` | `tsc --noEmit` — CI runs this; there is no linter or formatter |
| `npm run build:exe` | Single-file executable into `dist/`. Does **not** cross-compile |

Single test file: `npx vitest run tests/gemPolicy.test.ts`. Single case: add `-t "substring"`.

Releases: `npm version X.Y.Z --no-git-tag-version`, commit, then push a `vX.Y.Z` tag — the tag is
the only thing that triggers `release.yml`; pushing to `main` publishes nothing. Never hand-edit
the version in `package-lock.json`; it reformats the whole file.

## The invariant everything rests on

Between baseline and candidate, **only the gear differs**. `profile.ts` parses the wowsims
`Export → CLI` blob — a protojson `RaidSimRequest` carrying talents, rotation, consumables, buffs,
debuffs and encounter — and `withEquipment()` deep-clones it, replacing only `player.equipment`
and `simOptions`. Anything that touches the request outside those two fields breaks the guarantee
that makes a 15 DPS delta meaningful. `tests/sim.test.ts` asserts this directly.

There are exactly **two** sanctioned writers of a request, and both follow the same
clone-then-re-find-then-mutate-only-these-fields shape:

- `withEquipment()` (`server/profile.ts`) — gear and `simOptions`, used for every sim.
- `withAddonImport()` (`server/addonProfile.ts`) — gear, `talentsString` and professions, used only
  by the addon refresh. It never writes the spec oneof, the name or the race, which is what keeps
  the profile id stable and lets `profiles.createOrUpdate` be reused unchanged.

A third writer should not exist. `ParsedProfile.player` is a live reference into
`ParsedProfile.request`, so mutating in place corrupts the cached profile — always clone first.

A second guarantee sits under it: **one random seed for the whole run** (`run.ts`), so baseline and
candidates share a random stream and the noise on the *difference* is far below the noise on either
sim alone.

## Architecture

Three source roots, all TypeScript ESM with `.js` extensions on relative imports:
`server/` (Fastify API + sim orchestration), `web/src/` (React SPA, no router, four tabs),
`shared/` (proto enums and the wire types both sides use).

**Run pipeline** — `server/run.ts` is the spine, and its header comment is the authority:

1. sim gear exactly as equipped;
2. sim it again under the gem policy (plus any bench swap that helps) — this is the **basis** for
   deltas, so an item is never credited with a regem that was available without it;
3. sim every candidate *variant* at `config.iterations`;
4. re-sim the leaders and every tier bundle at `config.refineIterations`.

**Candidates vs. variants.** `candidates.ts` turns ticked item ids into `Candidate`s: one per
eligible slot (rings and trinkets produce two) plus multi-piece tier bundles that land on a 2pc/4pc
threshold. `run.ts` then expands each into `Variant`s — the plain placement, up to
`maxBenchVariants` bench hit-fixes from `bench.ts`, and a socket-matched gemming when
`trySocketBonuses` is on. Every variant of a candidate shares a `group`, and only the best-simming
one becomes a result row.

**`gearing.ts` is the stat model** and must mirror `sim/core/database.go` exactly — item stats +
random suffix (floored) + enchant + gems + socket bonus (only when *every* socket matches). If it
drifts, the hit solver solves against a hit rating the sim will never see. `applyGemPolicy()` fills
every socket with the one configured base gem regardless of socket colour, forces the meta gem's
colour requirement to be satisfied (an inactive meta loses its whole stat line), then trades base
gems for hit gems until the target is reached and no further.

**`simRunner.ts`** shells out to `wowsimcli sim --infile --outfile`. Sims are serialised through a
promise queue because wowsims already parallelises one sim across every core. Results are cached in
`data/cache/` keyed by sha256 of the pinned wowsims version + metric + the full request, which is
why re-running only re-sims what changed — and why moving the pin misses the cache wholesale
instead of mixing numbers from two engines in one ranked table. `SimAbortedError` is distinguished from a bad item: one item the engine chokes on is
recorded as a failure and the run continues.

**Two import formats, one overlay rule.** `profile.ts` reads the full `Export → CLI` request;
`addonProfile.ts` reads the in-game WowSimsExport blob, which carries only gear, talents and
professions. Per `TODO.md` §2b, anything that is not a full `RaidSimRequest` *overlays* an existing
profile rather than creating one. The addon format has sharp edges worth knowing before touching
that parser: `gear.items` omits trailing empty slots (so it is often shorter than 17) while interior
gaps are `null`; items use snake_case `random_suffix`; `gear` carries its own `version` key that is
not part of `EquipmentSpec`; and `gems` is truncated after the last filled socket. Slot assignment
comes from each item's own type, not its index — except for an item missing from `db.json`, whose
index is the only thing identifying the slot to leave alone.

**Ported from wowsims, not invented here.** `shared/wow.ts` (slot/type/gem enums, `eligibleItemSlots`,
`gemMatchesSocket`, class armour and weapon proficiency), `shared/metaGems.ts` (activation
conditions, hardcoded upstream too) and `gearing.enchantApplies`. When one of these looks wrong,
check the upstream wowsims source named in the comment rather than reasoning from first principles.

**Config is split by one list.** `PROFILE_CONFIG_KEYS` in `config.ts` decides what belongs to a
character (`data/profiles/<id>/config.json`) versus what is shared (`data/settings.json`). The same
constant drives load, save and the legacy migration, so the split cannot drift. Gem and enchant
defaults are *derived* from the imported profile by `withSuggestions()` when unset, so a fresh
install needs no setup — always merge suggestions rather than persisting them eagerly.

**Profiles.** One directory per character under `data/profiles/<id>/`. Identity is name + spec key
(`profiles.profileId`) because the CLI export usually reports the name as `Player`. Re-importing a
known character rewrites only `profile.json` — item list, bench and gem choices survive.

## Packaging: paths and build-time constants

`paths.ts` separates `ROOT` (where the code lives) from `STATE_DIR` (where anything writable goes,
falling back to the OS app-data directory when the install folder is read-only). Never build a
writable path from `__dirname`/`import.meta.url`; add it to `paths.ts`.

`scripts/build-exe.mjs` injects constants through esbuild `--define`: `__PACKAGED__`,
`__WEB_ASSET_KEYS__`, `__PINNED_VERSION__`, `__APP_VERSION__`. Each is `declare const … | undefined`
in the module that reads it and guarded with `typeof … !== 'undefined'` so a `tsx` source run still
works. Adding one means touching both the build script and the declaring module. The same mechanism
is why the packaged build serves the UI from Node SEA assets while a source run reads `web/dist`
(`staticAssets.ts`).

## Tests

`tests/fixture.ts` loads `data/profile.example.json` (a demo Fury Warrior, committed on purpose) —
never `data/profiles/`, which is live user state. Tests run against the real item database and, in
`sim.test.ts`, the real `wowsimcli`, so they exercise the same data the app does. Item ids in tests
are named constants with a comment saying what they are.

## Conventions

- Tabs, single quotes, wide lines. No Prettier or ESLint config — match the surrounding file.
- `strict` plus `noUncheckedIndexedAccess`; non-null assertions are used where an index is provably
  populated.
- Comments explain *why*, and module headers state the module's contract. The density is high and
  deliberate; match it rather than adding restating comments.
- User-facing strings (warnings, notes, run messages) are full sentences aimed at a raider, not a
  developer — several guildmates using this are not technical.
- `data/` is gitignored apart from `profile.example.json` and `release.json`.
