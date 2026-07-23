# Setting up the feature-atlas tool

The atlas is where B-class morphology features (pillars, ionization fronts,
filaments, dust lanes, shells…) come from. You draw them **once** on a reference
image, in sky coordinates; astrolens then projects them onto **any** future image
of that target via that image's WCS. No ML, no image matching — deterministic.

This doc gets the annotation tool running locally, and (optionally) hosted so a
collaborator can review in a browser with nothing installed on their side.

Base install is shared with the main app — do
[SETUP_ASTROLENS.md §1–3](SETUP_ASTROLENS.md) first (Node, pnpm, `./quickastrolens
setup`, and a plate-solver). The atlas tool needs **no extra dependencies**.

---

## 1. Run it

```bash
./quickastrolens atlas          # only the atlas tool → http://localhost:3100
```

or just `./quickastrolens`, which starts the studio **and** the atlas tool, with a
*Feature Atlas* link on the studio home.

A plate-solver is required here too — uploading a reference image solves and
identifies it so the target's identity is filled in for you.

## 2. Where your data lives

| File | What | In git? |
|---|---|---|
| `atlas.json` | your annotations + review status + each entry's reference WCS | yes (small, text) |
| `refimg/` | the reference images | **no** (gitignored — large binaries) |
| `registry.json` | approved-only export; **this is what astrolens reads** | yes (the shipped artifact) |

Two layers, merged at apply time, so you can extend coverage without touching
curated data:

| layer | registry file | who owns it |
|---|---|---|
| **shipped baseline** | `packages/atlas/data/registry.json` (or `$ATLAS_REGISTRY`) | the project — curated; you get updates by pulling a new release |
| **your overlay** | `~/.astrolens/atlas/registry.json` (or `$ATLAS_USER_REGISTRY`) | you, locally |

They're merged by object identity: your overlay **extends** the baseline — add
annotations to an existing target, or add targets it doesn't cover — without ever
touching the shipped file. No merge conflicts.

`./quickastrolens atlas` deliberately points at the **shipped seed**
(`packages/atlas/data`) because this repo's launcher is the curator's entry point.
If you're extending the atlas for yourself, use the bare CLI (`astrolens atlas`,
which defaults to `~/.astrolens/atlas`) or pass `--data-dir <your dir>`.

## 3. Annotate

1. **Upload a reference image** — it's plate-solved + identified, so the target
   identity (primary ID + aliases) is filled in automatically. Big images are
   downscaled in the browser before upload; JPG/PNG only.
2. **Draw** — pick a feature type, optionally give the feature a proper name
   ("Mystic Mountain"), hit **Start drawing**, click the outline point by point,
   then **Finish & save this shape**. When not drawing, drag to pan and scroll to
   zoom. Rough outlines are the intent — readers interpret them.
3. **Review** — set each annotation's status: *draft* → *in review* → *approved*.
   Approving stamps `reviewed_by` from the top-bar **current user** field, so set
   that to your own name.
4. **Save to atlas**, then **Export registry (approved only)** → writes
   `registry.json`. Only approved annotations ever reach readers.

Re-open an entry from **In the atlas** to get a read-only preview; **Edit
canonical** to change it, or **Verify on another image** to load a different photo
of the same target and check the annotations still land correctly.

## 4. Hosting it for a reviewer (optional)

If a collaborator should review or annotate but won't install anything, host the
tool and send them a URL. They then need no git, no copy of the reference images,
and no plate-solver — all of that stays on your machine.

```bash
# .env (gitignored)
ATLAS_PASSWORD=pick-something-long
```

```bash
caffeinate -s ./quickastrolens atlas
```

- **`ATLAS_PASSWORD`** puts HTTP Basic auth over the whole tool — pages, API and
  reference images. **Set it before exposing anything to a network.** Any username.
- **`caffeinate -s`** stops the machine sleeping while the server runs. Locking the
  screen is fine; a *system* sleep kills the server and the tunnel. Check your
  timer with `pmset -g | grep " sleep"` — if it's low, this matters.

Expose it with a tunnel (no public IP or port forwarding needed):

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3100     # prints an https://…trycloudflare.com URL
```

That URL changes on every restart. For a stable address plus email-based access
control, use a named tunnel on your own Cloudflare domain (`cloudflared tunnel
login` → `create` → `route dns` → `run`) and add Cloudflare Access (Zero Trust →
Access → Applications) restricted to your and your reviewer's emails.

> ⚠️ Only expose **port 3100** (the atlas tool). The studio on **3000 has no
> authentication** — never tunnel it.

**Before sending the link:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/   # expect 401
pmset -g assertions | grep -i caffeinate                          # expect a match
```
…then open the tunnel URL on mobile data (not your wifi) and confirm it prompts
for the password.

## 5. Two people, one instance

- Each person sets the top-bar **current user** to their own name so `author` and
  `reviewed_by` are truthful.
- Saves are serialized, and each entry carries a revision. Saving an entry that
  changed since you loaded it is **rejected** with a "reload before saving"
  message rather than silently overwriting — so nobody's approvals get clobbered
  by a stale tab. If you see it: reload, redo that edit.
- Only whoever runs the host needs git; the data lives on that machine, so they
  commit `atlas.json` / `registry.json` when checkpointing or shipping.
- There's no in-tool commenting — discuss elsewhere; the tool carries status and
  who approved.

## 6. Contributing back to the shipped atlas

Coverage is the whole point, so contributions are welcome. Open a PR adding your
approved entries to `packages/atlas/data/registry.json` (and reference images if
useful). Maintainers review and merge; your targets then ship to everyone in the
next release.

## 7. Curating the shipped seed (maintainers)

`./quickastrolens atlas` is the seed-curation entry point — it points the tool at
the committed `packages/atlas/data/` instead of the per-user dir. Draw, approve,
**Export registry**, then commit `packages/atlas/data/registry.json`.

Under `packages/atlas/data/`, `atlas.json` and the reference images are working
data; `registry.json` (approved-only) is the shipped artifact.

## 8. Notes for self-deployers

- **No hardcoded storage.** Reference images go through a storage adapter — local
  filesystem by default; an R2/S3 backend is pluggable for a shared/hosted
  instance. Credentials stay server-side env, never `VITE_`-prefixed.
- **Readers need zero storage.** The apply side only reads `registry.json` (sky
  coordinates); it never touches reference images.
- **Plate-solving is replaceable** — nova, local astrometry.net, or your own
  `SolveClient` (`packages/identify/src/solveClient.ts`).

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Shapes render but the image is blank | the reference image is missing from `refimg/` (it's gitignored, so it doesn't travel with a clone). Host one instance, or copy the folder across |
| "Save to atlas" stays greyed out | the **primary ID** is required — fill it in |
| "Someone else changed this entry" | expected concurrency guard — reload and redo that edit |
| Upload fails / "could not decode image" | JPG/PNG only (no FITS/XISF yet) |
| Plate-solve fails on upload | same solver setup as the main app — see [SETUP_ASTROLENS.md §3](SETUP_ASTROLENS.md) |
| Annotations don't show on a user's image | only **approved** ones are exported; re-run **Export registry** and confirm `registry.json` isn't empty |
