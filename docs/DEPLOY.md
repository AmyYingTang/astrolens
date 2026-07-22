# astrolens — configuration & self-deploy

How to run astrolens on your own machine, choose a plate-solver, and extend the
feature atlas with your own annotations. For everyday use the two commands in the
[README](../README.md) are enough — reach for this when you want offline solving,
want to add targets the shipped atlas doesn't cover, or are deploying for others.

Two roles show up below:

- **Consumer** — run astrolens on images to get readings + B-class feature
  annotations. Needs a plate-solver; needs nothing else.
- **Atlas author** — draw baseline B-class annotations (pillars, rims, dust
  lanes…) for a target so every future image of it gets them projected on
  automatically. Uses the feature-atlas tool.

---

## 1. Plate-solving

Every image astrolens reads is plate-solved to get its WCS (sky ↔ pixel), which
is what lets it place catalog objects and project atlas annotations. The solver
is pluggable — pick one:

### Option A — nova.astrometry.net (default)

Robust blind solver, no local data. Needs a network connection and a free API
key (it goes through a shared remote queue, so solve time varies — seconds to a
few minutes).

```bash
# get a free key at https://nova.astrometry.net (Profile → API key)
echo 'ASTROMETRY_API_KEY=xxxxxxxx' >> .env    # in the repo root
```

That's it — nova is the default. Good for casual/online use.

### Option B — local astrometry.net (offline)

The **same** blind-solve engine as nova, run locally: no queue, no network, a
few seconds per solve. Recommended for live/field use (star parties, no wifi) and
for anyone who wants deterministic solve times. Costs a one-time index-file
download (a few hundred MB to a few GB, sized to your field of view).

> ASTAP is **not** a good substitute here: it's fast but fails to solve heavily
> processed / star-reduced finished astrophotos that nova and local
> astrometry.net handle fine.

**Install (macOS example):**

```bash
brew install astrometry-net          # solve-field + wcsinfo
```

**Index files** — the star catalog, chosen by field-of-view. Rule of thumb: pick
scales from roughly your field width down to ~1/4 of it. The 4200-series
(Tycho-2) scale → angular size:

| scale | field size | | scale | field size |
|---|---|---|---|---|
| 4206 | 16′–22′ | | 4210 | 60′–85′ |
| 4207 | 22′–30′ | | 4211 | 85′–120′ |
| 4208 | 30′–42′ | | 4212 | 120′–170′ |
| 4209 | 42′–60′ | | 4213 | 170′–240′ |

For ~0.5°–3° wide-field DSLR frames, `4206`–`4213` (~650 MB) is a good set:

```bash
mkdir -p ~/astrometry-indexes && cd ~/astrometry-indexes
for s in 4206 4207; do for h in $(seq -w 0 11); do
  curl -fLO "http://data.astrometry.net/4200/index-$s-$h.fits"; done; done
for s in 4208 4209 4210 4211 4212 4213; do
  curl -fLO "http://data.astrometry.net/4200/index-$s.fits"; done
# point the solver at them:
echo "add_path $HOME/astrometry-indexes" >> "$(brew --prefix)/etc/astrometry.cfg"
```

For richer/deeper fields, use the Gaia-based 5200 series instead
(`http://data.astrometry.net/5200/`).

**Turn it on** — set the env, optionally hint the field width (degrees) to speed
solving a lot:

```bash
export ASTROLENS_SOLVER=local
export ASTROLENS_FOV_LOW=2 ASTROLENS_FOV_HIGH=3.5   # optional but recommended
ASTROLENS_SOLVER=local ./quickastrolens read my_image.jpg "NGC 3372"
```

`ASTROLENS_SOLVER=local` works everywhere — CLI, studio, and the atlas tool.
Successful solves are cached (`~/.cache/astrolens/solve`), so re-solving the same
image is instant regardless of solver.

**Solver env reference:** `ASTROLENS_SOLVER` (`local`|`nova`), `ASTROMETRY_CFG`,
`SOLVE_FIELD`, `WCSINFO` (binary/config paths), `ASTROLENS_FOV_LOW` /
`ASTROLENS_FOV_HIGH` (field-width degree bounds).

---

## 2. The feature atlas — baseline + your own overlay

B-class morphology features (pillars, ionization fronts, filaments, dust lanes,
shells…) are **not** auto-detected. They come from a human-drawn **atlas**: you
annotate a target once, in ICRS sky coordinates, and every future image of that
target gets those annotations projected on via its own WCS. Deterministic, no ML.

astrolens reads the atlas as **two layers, merged**:

| layer | file | who owns it |
|---|---|---|
| **shipped baseline** | `packages/atlas/data/registry.json` (or `$ATLAS_REGISTRY`) | the astrolens project (curated, updated by pulling a new release) |
| **your overlay** | `~/.astrolens/atlas/registry.json` (or `$ATLAS_USER_REGISTRY`) | you, locally |

At apply time they're merged by object identity: your overlay **extends** the
baseline — add annotations to an existing target, or add targets the baseline
doesn't cover — without ever touching the shipped file. No merge conflicts.

### Add your own annotations

```bash
astrolens atlas          # opens the atlas tool at http://localhost:3100
                         # (data dir defaults to ~/.astrolens/atlas)
```

1. **Upload a reference image** of the target → it's plate-solved + identified
   (identity auto-filled).
2. **Draw** the features (pick a type, Start drawing, click the outline, Finish).
3. Set each annotation's **status** to *approved* when you're happy (approve
   stamps the reviewer from the top-bar "current user" field).
4. **Export registry** — writes `~/.astrolens/atlas/registry.json` (approved only).

Next time you read an image of that target, your annotations project onto it.

Your data, and where it lives:

- **Reference images** (`~/.astrolens/atlas/refimg/`) — big binaries, only needed
  for editing/reviewing. Local to you; never shared unless you contribute back.
- **`atlas.json`** (`~/.astrolens/atlas/`) — your working annotations (all
  statuses). Yours to version however you like.
- **`registry.json`** — the approved-only export the consumer side reads. Merged
  with the baseline automatically.

### Contribute back to the shipped atlas

Coverage is the whole value, so contributions are welcome. Open a PR adding your
approved entries to `packages/atlas/data/registry.json` (and, if useful,
reference images). Maintainers review and merge; your targets then ship to
everyone in the next release.

---

## 3. Curating the shipped seed (maintainers)

`./quickastrolens atlas` is the seed-curation entry point — it points the atlas
tool at the committed `packages/atlas/data/` instead of the per-user dir. Draw +
approve there, Export registry, and commit `packages/atlas/data/registry.json`.

`atlas.json` and the reference images under `packages/atlas/data/` are working
data; `registry.json` (approved-only) is the shipped artifact.

---

## 4. Open-source notes

- **No hardcoded storage.** Reference images go through a storage adapter — local
  filesystem by default; an R2/S3 backend is pluggable for a shared/hosted
  instance. Credentials (if any) stay server-side env, never `VITE_`-prefixed.
- **Consumers need zero storage.** The apply side only reads the bundled
  `registry.json` (sky coordinates); it never touches reference images.
- **Plate-solving is replaceable** — nova, local astrometry.net, or your own
  `SolveClient`. See `packages/identify/src/solveClient.ts`.
