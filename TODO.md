# TODO

## 1. Distribution — mostly done, loose ends left

`npm run build:exe` produces a single-file executable (Node SEA: esbuild bundle + UI embedded as
SEA assets + injected into a copy of the node binary), and
`.github/workflows/release.yml` builds and smoke-tests one per platform on a `v*` tag.

Verified on macOS: runs from an arbitrary directory, bootstraps its own 56 MB of sim binaries,
serves the UI, completes a sim, and falls back to the OS app-data directory when its own folder
is read-only.

Still open:

- **Run it on Windows.** The build has never executed on a Windows runner. Tag a release, let CI
  build it, and try the artifact on a real machine.
- **Intel Macs** would need a `macos-13` matrix entry. Skip until someone asks.
- **Code signing** would remove the SmartScreen warning (~$100–400/yr). Probably never worth it.
- **A console window opens** on double-click. It is where first-run progress and errors appear,
  so this is deliberate — but if it ever grates, a Windows GUI-subsystem shim is the fix.
- **Linux** is unbuilt. `assetSuffix()` already handles it; just add a matrix entry if wanted.

## 2. Import gear from more than the wowsims CLI export

There are **two separate destinations**, and they must not be conflated:

### 2a. The wishlist — import gear only *(the priority)*

Populating the item list to sim. BIS lists get shared as Sixty Upgrades or
wowsims links, and retyping them into the search box is the tedious part.

An import here must take **item IDs and nothing else**. No race, no class, no
talents, no gems, no enchants, no buffs — those all come from your profile and
must not be touched. A shared BIS list is somebody else's character; only the
list of items is meaningful. Anything else it carries gets discarded on the way in.

| Source | Format | Notes |
|---|---|---|
| **Sixty Upgrades** | JSON from the site's *export* option, pasted in | `{ character: {...}, talents: [...], items: [{ id, enchant, gems }] }` — take `items[].id`, drop the rest. wowsims parses the same blob in `individual_60u_importer.tsx`. A paste, **not** a URL fetch: no scraping, no CORS, no auth. |
| **wowsims link** | `https://wowsims.com/tbc/...#...` | **`wowsimcli decodelink <url>` already ships in `bin/`** — shell out to it and read the equipment out of the result. Likely no codec work at all. |
| Wowhead gear planner | URL | `individual_wowhead_gear_planner_importer.tsx` |

Behaviour worth getting right: report what came in and what was skipped —
items already equipped, items this class can't use (the same
`partitionUsable` check that prunes stale selections), and IDs missing from the
database. Adding to the wishlist should merge with what's already ticked rather
than replace it.

### 2b. The profile — the full character

Only the wowsims `Export → CLI` blob carries a whole `RaidSimRequest` (talents,
rotation, consumables, buffs, debuffs, encounter *and* gear), which is why it is
the profile source today. Two things could make that step less manual:

| Source | wowsims importer | Note |
|---|---|---|
| WowSimsExport addon string | `individual_addon_importer.tsx` | Paste the addon output straight in and skip the wowsims UI entirely — but it is gear-only, so it has to overlay an existing profile, not replace it |
| Bags and bank JSON | `bulk_gear_json_importer.tsx` | Would auto-populate the **bench** from what you actually own, instead of searching for each spare item by hand |

The rule that holds for all of these: anything that is not a full
`RaidSimRequest` overlays gear onto an existing profile and leaves everything
else alone. That is what keeps the guarantee the tool rests on — between
baseline and candidate, only the gear differs.

