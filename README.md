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
| macOS (Apple Silicon) | `Simgrade-macos-arm64` |

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

On macOS, right-click → *Open* the first time, since the binary isn't notarised.

Both servers are local only. Stop it by closing the console window, or `Ctrl-C`.

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
- **One random seed for the whole run.** Correlated random streams shrink the noise on a
  *difference* far below the noise on either sim alone, which is what makes a 15 DPS delta
  meaningful at all.
- **Two passes.** Everything is ranked at 30,000 iterations, then the top 15 plus every tier
  bundle are re-simmed at 100,000. Both counts are configurable.
- **Confidence intervals.** Each row shows ±95% CI. Rows where the CI straddles zero are labelled
  **within noise** — treat them as sideways, not as upgrades.
- **Two baselines.** Your gear is simmed as-equipped *and* re-gemmed under your gem policy.
  Deltas are measured from the re-gemmed one, so an item that brings its own hit isn't credited
  with a regem you could have done anyway. If re-gemming alone is worth something, it says so.

## Gemming policy

Configured in the **Settings** tab.

- Each socket colour has a **normal gem** and a **hit gem**, and **any gem colour can be chosen
  for any socket** — a red gem in a yellow socket is a normal thing to want, so nothing stops
  you. The only hard rule is the game's own: meta gems go in meta sockets and nothing else does.
- **The pickers are searchable.** Type to filter all 200-odd gems by name, stat or colour.
  Partial words in any order work (`bold spin`, `spell hit`, `meta crit`), and dropped letters
  still find it (`vld pyre` → Veiled Pyrestone). Arrow keys and Enter to pick, Escape to close.
- When a chosen gem doesn't match the socket, the picker says *off-colour — forfeits the socket
  bonus*, and each result row lists which items lost a bonus that way. It's your call; it just
  isn't silent.
- **Defaults are read from what you actually have socketed**, per socket colour — not from what
  "should" go there. If you already run red gems in your yellow sockets, that's what comes back
  as your yellow default.
- New items are socketed with the normal gem.
- If total gear hit is **below** the target, normal gems are traded up to hit gems, cheapest
  socket first (yellow before prismatic before red before blue by default, since TBC's pure hit
  gems are yellow).
- If it is **above** the target, hit gems are traded back down for normal ones while staying on
  target.
- Any swap that would deactivate your meta gem is rejected. If the target can't be reached
  without breaking it, the row says how far short it fell and why.
- A socket colour you have no gem configured for borrows another colour's gem rather than being
  left empty, and says so.

### Tier sets

Set bonuses come from the five armour slots at 2 and 4 pieces, so a single tier swap can be a
DPS *loss* by dropping you under a threshold while two together are a large gain. Alongside the
single swaps, the run sims every **bundle** of your selected pieces that lands exactly on a
threshold — if you wear none of a set and select four pieces, that is the six two-piece bundles
*and* the four-piece one.

### Switching characters

Your item list and bench are saved per install, not per character. Importing a different profile
prunes both lists to what the new character can actually wear — armour type, class restrictions
and weapon skills — and tells you what it dropped, rather than quietly simming a warrior's plate
on a warlock.

### Bag / bench items

Gear you own but don't wear — the spare ring without hit, the off-set helm you kept — can be
listed at the bottom of the **Profile** tab. Bench items **never compete as upgrades**. They are
only ever swapped in to land you on the hit target, and only when gems alone can't:

- A candidate pushes you **over** the cap and there are no hit gems left to reclaim → the run
  tries bench items that shed hit.
- A candidate leaves you **under** the cap and the sockets are exhausted → it tries bench items
  that add hit.
- Gems already land within `hitTolerance` (default 10 rating) of target → the bench is not
  touched at all, and no extra sims are run.

Both layouts are simmed — the gem-only fix and the bench swap — and the row shows whichever
actually wins, with a note naming the swap:

> *Bench: Band of the Abyssal Lord in for an empty slot — adds hit (240 → 261, target 320).*

The same treatment is applied to your **baseline**, so a candidate is never credited with a hit
fix that was available to you without it. At most `maxBenchVariants` (default 2) swaps are simmed
per candidate, and a swap is only considered if it gets strictly closer to target — and never by
dropping below it. A bench item is assumed to be enchanted and gemmed by the same policy as any
other new item.

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
- Enchants are carried over from the item being replaced, or taken from a per-slot default. They
  are not optimised.
