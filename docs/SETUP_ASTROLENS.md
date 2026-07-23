# Setting up astrolens (the reading tool)

From a fresh `git clone` to a running studio. This covers the **main app** — upload
a deep-sky photo, get an identified, annotated, bilingual reading.

For the **feature-atlas annotation tool** — annotating, hosting it for a
reviewer, extending the atlas — see [SETUP_ATLAS.md](SETUP_ATLAS.md).

---

## 1. Prerequisites

| Needed | Why | Check |
|---|---|---|
| **Node ≥ 18** | runtime | `node -v` |
| **pnpm 9** | workspace package manager | `pnpm -v` (get it with `corepack enable pnpm`) |
| **A plate-solver** | every image must be plate-solved to place anything | see §3 |
| `claude` CLI *(optional)* | only for AI-written readings | `which claude` |

Notes:

- **`sharp`** (image processing) and **`puppeteer`** (poster export) install
  automatically with `pnpm install`. Puppeteer downloads its own Chromium, so the
  first install pulls a few hundred MB — that's expected.
- Without the `claude` CLI everything still works **except** generating the AI
  reading text; identification, annotation and export are unaffected.
- Poster/embed export uses a browser folder picker — use a Chromium-based
  browser (Chrome / Edge / Arc) for that step.

## 2. Install

```bash
git clone git@github.com:AmyYingTang/astrolens.git
cd astrolens
./quickastrolens setup        # pnpm install + build everything
```

## 3. Pick a plate-solver

Every image is plate-solved to get its WCS (sky ↔ pixel) — that's what places
catalog objects and projects atlas annotations. You need **one** of these;
nothing works without it. The solver is pluggable.

### Option A — nova.astrometry.net (easiest)

Robust blind solver, no local data. Needs internet and a free API key; it goes
through a shared remote queue, so solve time varies (seconds to a few minutes).
Get a key at <https://nova.astrometry.net> (Profile → API key), then:

```bash
echo 'ASTROMETRY_API_KEY=your-key-here' >> .env    # repo root; .env is gitignored
```

That's the default — nothing else to do.

### Option B — local astrometry.net (offline, seconds per solve)

The **same** blind-solve engine as nova, run locally: no queue, no network.
Recommended for live/field use (star parties, no wifi) and anyone who wants
predictable solve times. Costs a one-time index-file download sized to your field
of view.

> ASTAP is **not** a good substitute: it's fast but fails on heavily processed /
> star-reduced finished astrophotos that nova and local astrometry.net handle.

```bash
brew install astrometry-net          # solve-field + wcsinfo
```

**Index files** — the star catalog, chosen by field of view. Rule of thumb: scales
from roughly your field width down to ~1/4 of it. The 4200-series (Tycho-2):

| scale | field size | scale | field size |
|---|---|---|---|
| 4206 | 16′–22′ | 4210 | 60′–85′ |
| 4207 | 22′–30′ | 4211 | 85′–120′ |
| 4208 | 30′–42′ | 4212 | 120′–170′ |
| 4209 | 42′–60′ | 4213 | 170′–240′ |

For ~0.5°–3° wide-field frames, `4206`–`4213` (~650 MB) is a good set:

```bash
mkdir -p ~/astrometry-indexes && cd ~/astrometry-indexes
for s in 4206 4207; do for h in $(seq -w 0 11); do
  curl -fLO "http://data.astrometry.net/4200/index-$s-$h.fits"; done; done
for s in 4208 4209 4210 4211 4212 4213; do
  curl -fLO "http://data.astrometry.net/4200/index-$s.fits"; done
# point the solver at them:
echo "add_path $HOME/astrometry-indexes" >> "$(brew --prefix)/etc/astrometry.cfg"
```

For richer/deeper fields use the Gaia-based 5200 series
(`http://data.astrometry.net/5200/`) instead.

Turn it on, optionally hinting the field width (degrees) — the hint speeds
solving a lot:

```bash
# .env
ASTROLENS_SOLVER=local
ASTROLENS_FOV_LOW=2
ASTROLENS_FOV_HIGH=3.5
```

**Env reference:** `ASTROLENS_SOLVER` (`local`|`nova`), `ASTROMETRY_CFG`,
`SOLVE_FIELD`, `WCSINFO` (binary/config paths), `ASTROLENS_FOV_LOW` /
`ASTROLENS_FOV_HIGH` (field-width degree bounds).

### Switching, and checking which one is active

Put the choice in `.env` so every entry point picks it up (`ASTROLENS_SOLVER=local`,
or omit the line for nova), or override per run:
`ASTROLENS_SOLVER=nova ./quickastrolens read img.jpg`.

`ASTROLENS_SOLVER=local` works everywhere — CLI, studio and the atlas tool.
Successful solves are cached in `~/.cache/astrolens/solve`, so re-solving the same
image is instant regardless of solver.

Three places tell you which solver a run used — worth a glance before a live
session:

1. **Startup log** — `Plate-solver: …` from studio/atlas; `Plate-solving (…)` from `read`.
2. **In the UI** — a badge on the studio home and the atlas top bar, **green when
   it's the offline local one**.
3. **After the fact** — `factsheet.solve.solver` records it per reading. (On a
   cache hit, that's the solver that *originally* solved the image.)

Timing is logged too — `Plate-solved in 12.3s` or `cache (instant)`, plus
`factsheet.solve.solve_ms` / `solve_cached` — so a live session's cost is visible
up front.

## 4. Run it

```bash
./quickastrolens
```

Opens the studio at **<http://localhost:3000>** and co-launches the feature-atlas
tool at **<http://localhost:3100>** (reachable from the studio home's *Feature
Atlas* link).

In the studio: **New reading** → pick an image (+ optional object-name hint and
style presets) → it plate-solves, identifies, and annotates → the editor opens
for tweaking → **Export** an annotated JPG, an interactive `embed.html`, or a
poster. Edits auto-save. `Ctrl+C` stops both servers.

Everything lands in `out/<name>/` — `factsheet.json` (what was identified),
`reading.json` (the annotated reading), the source image and exports.

## 5. Without a browser (CLI)

The studio wraps these; reach for them to script or automate.

```bash
./quickastrolens identify <image> ["Object Name"]   # plate-solve + catalog → factsheet.json
./quickastrolens read <image> ["Object Name"] [zh|en]  # identify + AI reading + render
./quickastrolens render <reading.json> [annotated|embed|poster|all]
./quickastrolens edit <reading.json> [port]        # editor for one existing reading
./quickastrolens help
```

## 6. Checking and troubleshooting

**Which solver am I using?** The startup log prints `Plate-solver: …`, the studio
home shows a badge (green = offline local), and `factsheet.solve.solver` records
it per reading. Timing is logged too (`Plate-solved in 12.3s` / `cache (instant)`).

| Symptom | Cause / fix |
|---|---|
| `Plate-solving needs a nova API key` | no `ASTROMETRY_API_KEY` and not using the local solver — do §3 |
| Solve times out or hangs for minutes | nova's shared queue is busy; retry, or switch to the local solver (§3 B) |
| `claude` errors when generating a reading | the CLI isn't installed/authenticated — identification still works without it |
| "No baseline annotations for X yet" | that object isn't in the feature atlas — expected, not an error. Add it with the atlas tool ([SETUP_ATLAS.md](SETUP_ATLAS.md)) |
| Export folder picker missing | use Chrome / Edge / Arc, or choose the browser-download option |
| Port already in use | `./quickastrolens` uses 3000 + 3100; stop the other instance or pass `--port` via the CLI |
