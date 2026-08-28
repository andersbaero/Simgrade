# Simgrade

Ranks gear upgrades for your TBC Anniversary character by actually simming them, so the
one-item-at-a-time loop you were doing by hand in wowsims + Excel runs itself.

You tick the items you care about; it sims each one against your current gear and gives you a
ranked list of DPS gains — handling the two things hand-simming usually gets wrong:

- **Tier set thresholds.** A single tier piece can be a DPS *loss* because it drops you under
  4pc, while two of them together are a large gain. Both are simmed and reported.
- **Hit-cap gemming.** A new item changes your hit. The tool re-gems around it to stay on your
  hit target — including *reclaiming* surplus hit back into normal gems, which is usually the
  biggest hidden gain in a swap — and never breaks your meta gem doing it.

Every number is reproducible: same seed, same gear, same DPS, and the tool tells you exactly
which gems and enchant it assumed.

## Install

Download the file for your platform from the
[latest release](https://github.com/andersbaero/Simgrade/releases/latest) and run it.
No Node, no terminal, no install.

| | |
|---|---|
| Windows | `Simgrade-windows-x64.exe` |
| macOS (Apple Silicon) | `Simgrade-macos-arm64.zip` |

On first launch it downloads the wowsims sim engine and item database (~56 MB) into a `bin/` and
`data/` folder beside itself, then opens your browser. That folder is where your profile and
results live, so keep the exe somewhere you don't mind it writing — a folder in Documents is
ideal. If the location isn't writable, it uses `%LOCALAPPDATA%\Simgrade` instead and says so.

Two prompts on first run, both expected:

- **Windows SmartScreen** will say the publisher is unknown — the binary is unsigned. Choose
  *More info → Run anyway*. (Removing this warning means buying a code-signing certificate,
  which isn't worth it for a raid tool.)
- **Windows Firewall** will ask to allow `wowsimtbc.exe`. Private networks is enough; nothing
  listens outside localhost.

On macOS, unzip it — Safari does that on download — and run `Simgrade`. The zip is what carries
the executable bit through; GitHub strips it from bare release assets. If macOS says the developer
cannot be verified, right-click → *Open*, or clear the flag with
`xattr -d com.apple.quarantine Simgrade`.

Both servers are local only. Stop it by closing the console window, or `Ctrl-C`.

When a newer release exists, a banner appears at the top of the app. **Download it** fetches the
right file for your platform next to the one you are running and opens that folder — close
Simgrade, swap the file, start it again. It never replaces the running program, so a failed
download cannot break your install. Turn the check off in Settings if you sim offline.

## Running from source

```bash
npm install
npm start
```

Needs **Node 20.12+**. `npm start` builds the UI if needed and starts the server, which
bootstraps the sim binaries itself.

| | |
|---|---|
| **Simgrade** | http://localhost:5174 |
| **wowsims UI** | http://localhost:3333/tbc/ |

### Building the executable

```bash
npm run build:exe      # -> dist/Simgrade[.exe]
```

Bundles the server with esbuild, embeds the UI as Node SEA assets and injects the blob into a
copy of the node binary. **It does not cross-compile** — run it on the platform you're targeting.
`.github/workflows/release.yml` does that on Windows and macOS runners, smoke-tests each binary
by launching it and waiting for `/api/state`, and attaches both to a GitHub Release on a `v*` tag.

## Weekly workflow

1. **Configure your character in the wowsims UI** at :3333, exactly as you do today — import
   from the WowSimsExport addon, set your consumables, buffs, rotation and encounter.
2. Hit **Export → CLI** and paste the JSON into the *Profile* tab of the Upgrade Simmer.
   That single blob carries your talents, rotation, consumables, raid buffs, debuffs, encounter
   and gear, so every sim differs from your baseline **by gear alone**.
3. Optionally, list your **bag/bench items** at the bottom of the Profile tab (see below).
4. In the **Items** tab, **search for the items you want** and add them to the list. Search
   matches names, set names, bosses, raids and slots, with partial words in any order
   (`onslaught`, `illidan`, `band`) and tolerance for dropped letters (`mlefc hood` → Hood of
   the Malefic). Enter adds, and the dropdown stays open so you can add several in a row;
   *Add all N* adds every current match. The list below is exactly what will be simmed — nothing
   else. Your selection is remembered between runs.
5. Hit **Run upgrade sim** and read the **Results** tab.

Next week: re-export your profile (your gear changed), keep the same ticks, run again. Sims are
cached, so unaffected items are not re-run.

## How the numbers are produced

- Sims run through the official **`wowsimcli`** binary from the same wowsims release you already
  use. It has the item database compiled in, which is why the CLI export doesn't need one.
- **One random seed for the whole run, drawn fresh each time.** Sharing a seed within a run means
  correlated random streams, which shrink the noise on a *difference* far below the noise on
  either sim alone — that is what makes a 15 DPS delta meaningful. Drawing a new one per run means
  clicking **Run** gives an independent sample rather than replaying the last one; pin it in
  settings if you want an exactly reproducible number.
- **Armour proficiency is cumulative.** A class is offered its own armour type and everything
  lighter, so a mail-wearing caster sees cloth and leather pieces. Heavier armour is filtered out.
- **Two passes.** Everything is ranked at 30,000 iterations, then the top 15 plus every tier
  bundle are re-simmed at 100,000. Both counts are configurable.
- **Confidence intervals.** Each row shows ±95% CI. Rows where the CI straddles zero are labelled
  **within noise** — treat them as sideways, not as upgrades.
- **Two baselines.** Your gear is simmed as-equipped *and* re-gemmed under your gem policy.
  Deltas are measured from the re-gemmed one, so an item that brings its own hit isn't credited
  with a regem you could have done anyway. If re-gemming alone is worth something, it says so.

## Gemming policy

Configured in the **Settings** tab. Three decisions, not nine:

- **Default gem** — goes in *every* socket, whatever colour that socket is. In TBC the raw gem
  beats the socket bonus almost every time, so matching colours is usually the wrong instinct.
- **When short on hit** — swapped in over the default, one socket at a time, and only until the
  hit target is reached. Never further; hit past the cap is dead weight.
- **Meta gem**, plus a **red / yellow / blue gem for meta requirements** — used *only* when the
  meta's colour requirement can't be met otherwise. Chaotic Skyfire Diamond wants two blue gems
  and you may own no blue sockets, so enough of these are forced in to switch it on, preferring
  sockets where they cost nothing. An inactive meta loses its whole stat line, which dwarfs any
  socket bonus.

Everything is searchable by name or stat, partial words in any order. Defaults are read from what
you already have socketed, so a fresh import needs no setup.

Socket bonuses are not chased by default, but they are not assumed away either: with **Also try
matching socket colours** on, every socketed candidate is *also* simmed gemmed to match, and
whichever layout actually wins is the one reported. It is not a foregone conclusion — on a sample
of seven socketed phase-3 pieces, matching won on three. Costs one extra sim per candidate that
has a bonus to win. Rows where matching won say so, and forfeited bonuses are still reported. Any swap that would deactivate your meta gem is refused, and if the hit target
can't be reached without breaking it, the row says how far short it fell and why.

**Hit target** has three modes:

| Mode | Meaning |
|---|---|
| `keepCurrent` (default) | Never drop below the gear hit rating you already have. No setup needed. |
| `gearRating` | An explicit gear hit rating, e.g. `202`. |
| `totalPercent` | A total hit %, minus the % you already get from talents/buffs. |

## Verifying it against wowsims

Do this once so you trust the output:

1. Run the tool and pick a row.
2. In the wowsims UI, equip that item with **exactly the gems and enchant the row reports**
   (expand *gems & enchant assumed*).
3. Set the same iteration count and the same fixed RNG seed, and sim.

The DPS must match. It does — the gearing layer was checked this way against a hand-built gear
set and agreed to four decimal places.

## Layout

```
scripts/setup.ts      CLI over server/bootstrap.ts
scripts/start.mjs     dev launcher: build the UI if needed, run the server
scripts/build-exe.mjs bundle + embed + inject -> a single executable
server/
  bootstrap.ts        fetches the sim binaries and item database on first run
  paths.ts            resolves install vs. writable state directory
  staticAssets.ts     serves the UI from disk (dev) or from the exe (packaged)
  itemDb.ts           indexes wowsims' db.json (items, gems, enchants, bosses, zones)
  bench.ts            bag items offered only as hit-target levers
  profile.ts          parses the Export → CLI blob; rebuilds it with new gear
  gearing.ts          stat accounting, gem policy, hit solver
  metaGems.ts         meta gem activation rules ported from wowsims
  candidates.ts       item → gear sets to sim, including tier bundles
  sets.ts             tier piece counting and threshold changes
  simRunner.ts        runs wowsimcli, caches by request hash
  run.ts              run orchestration and confidence intervals
web/                  React UI (profile, items, settings, results)
data/                 your profile, selection, config, sim cache  (gitignored)
```

`data/profile.example.json` is a demo Fury Warrior so the tool has something to show before you
paste your own profile.

## Commands

| | |
|---|---|
| `npm start` | Build the UI if needed, then run everything |
| `npm run build:exe` | Build a single-file executable into `dist/` |
| `npm run setup` | Re-download the sim binaries + database for the pinned release |
| `npm run setup -- --latest` | Move to the newest wowsims release |
| `npm test` | Unit tests plus integration tests against the real `wowsimcli` |
| `npm run dev:server` / `npm run dev:web` | Watch mode |

## Known limits

- **Some items crash the wowsims engine** for the wrong class (e.g. a warrior equipping a bow
  that carries a hunter set effect). Those are listed separately under *Could not be simmed*;
  the rest of the run is unaffected. That is an upstream bug, not a bug here.
- **No contested/competition scoring** — deliberately out of scope for this build.
- **No greedy multi-week path.** Each run ranks against your *current* gear. Re-export and re-run
  after a drop to get the next step.
- Enchants are carried over from the item being replaced, or taken from a per-slot default, and
  every result row names the enchant it applied. They are not optimised. When one genuinely cannot
  transfer — a weapon enchant onto a shield, say — the row says the item went in unenchanted.
