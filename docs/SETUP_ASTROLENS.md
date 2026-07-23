# Setting up astrolens (the reading tool)

From a fresh `git clone` to a running studio. This covers the **main app** — upload
a deep-sky photo, get an identified, annotated, bilingual reading.

For the **feature-atlas annotation tool**, see [SETUP_ATLAS.md](SETUP_ATLAS.md).
For deeper configuration (offline solving, the atlas data model), see
[DEPLOY.md](DEPLOY.md).

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

You need **one** of these. Nothing works without it — no WCS means no object
placement and no atlas features.

**Option A — nova.astrometry.net (easiest).** Free API key, needs internet.
Get a key at <https://nova.astrometry.net> (Profile → API key), then:

```bash
echo 'ASTROMETRY_API_KEY=your-key-here' >> .env      # repo root; .env is gitignored
```

**Option B — local astrometry.net (offline, seconds per solve).** Better for
live/field use or flaky networks. Requires installing the engine plus star-index
files sized to your field of view — full instructions in
[DEPLOY.md §1](DEPLOY.md#1-plate-solving). Short version:

```bash
brew install astrometry-net
# download index files, point astrometry.cfg at them (see DEPLOY.md)
echo 'ASTROLENS_SOLVER=local' >> .env
```

Solves are cached in `~/.cache/astrolens/solve`, so re-running the same image is
instant either way.

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
