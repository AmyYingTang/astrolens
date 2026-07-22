import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { FactSheet } from '@astrolens/schema';
import type { IdentifyInput, IdentifyDeps } from './types.js';
import { fieldRadiusDeg } from './wcs.js';
import { gateCandidates, selectObjects, hasRecognizableName } from './select.js';
import { assembleFactSheet } from './assemble.js';
import { loadRegistries } from './atlasApply.js';
import {
  createLuminanceSampler,
  createImageRaster,
  estimateBackground,
  type LuminanceSampler,
} from './luminance.js';
import { detectComet, cometToObjects, type CometFactObject } from './comet.js';
import {
  detectMorphology,
  selectForOutreach,
  applyIlluminationPrior,
  type MorphResult,
  type MorphFeature,
} from './morph.js';
import { visibleRadiusPx } from './features.js';
import { createWikidataClient } from './wikidata.js';
import { lookupNickname } from './nicknames.js';

async function fileHash(path: string): Promise<string> {
  const buf = await readFile(path);
  return 'sha256:' + createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/** Brightness-weighted centroid of the glow within radius `r` of (cx,cy) — a
 * proxy for the ionizing region (the embedded OB cluster). HII regions are
 * ionized by a whole hot-star cluster, not the single WR star we happen to
 * catalogue, so the bright core is the truer "toward the source" target for the
 * photoevaporation prior. Falls back to the catalog centre if no glow is sampled. */
function brightCentroid(
  cx: number,
  cy: number,
  r: number,
  s: LuminanceSampler,
  bg: number,
  w: number,
  h: number,
): [number, number] {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  const step = Math.max(6, Math.round(r / 40));
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y += step) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x += step) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const v = s(x, y);
      if (!Number.isFinite(v)) continue;
      const wt = v - bg;
      if (wt > 0) {
        sx += x * wt;
        sy += y * wt;
        sw += wt;
      }
    }
  }
  return sw > 0 ? [sx / sw, sy / sw] : [cx, cy];
}

/**
 * Stage 1: plate-solve + region catalog query → grounded FactSheet.
 * Solver and catalog are injected (nova / SIMBAD in production; mocks in tests).
 * Never fabricates identity: on solve failure it returns an honest empty sheet.
 */
export async function identify(input: IdentifyInput, deps: IdentifyDeps): Promise<FactSheet> {
  const hash = input.hash ?? (await fileHash(input.imagePath));
  const timestamp = new Date().toISOString();
  const image = {
    src: input.imageSrc ?? basename(input.imagePath),
    width: input.width,
    height: input.height,
    hash,
    band: input.band ?? ('unknown' as const),
    starless: input.starless ?? false,
  };
  // "Main objects only" — focus on the subject + the standout companions of each
  // type, not every catalogued thing. Per-type caps adapt: a single-target field
  // stays at ~3-4; a genuine multi-target field (e.g. the Antares region: two
  // clusters + bright stars + nebulae) shows its handful of real main objects. A
  // single hard cap was dropping iconic objects (Antares), so it's only a safety.
  const selectOpts = {
    starMagMax: input.starMagMax ?? 4,
    nebulaMinArcmin: input.nebulaMinArcmin ?? 8,
    galaxyMinArcmin: input.galaxyMinArcmin ?? 3,
    maxStars: 2,
    maxClusters: 2,
    maxNebulae: 2,
    maxGalaxies: 1,
    topN: input.topN ?? 6, // safety ceiling only; per-type caps do the focusing
  };

  const solveRes = await deps.solve.solve({
    imagePath: input.imagePath,
    width: input.width,
    height: input.height,
  });

  if (solveRes.status !== 'solved' || !solveRes.wcs) {
    const status = input.targetName ? ('user_provided' as const) : ('failed' as const);
    const reason = solveRes.error ? ` Reason: ${solveRes.error}.` : '';
    const warnings =
      status === 'user_provided'
        ? [
            `Plate-solve failed.${reason} target_name "${input.targetName}" given, but name-only catalog resolution is not yet implemented (Phase 1c). No grounded objects produced — identity is never fabricated.`,
          ]
        : [
            `Plate-solve failed and no target_name provided.${reason} No objects — identity is never fabricated.`,
          ];
    return FactSheet.parse({
      version: '1.0',
      image,
      solve: { status, frame: 'none', nova_job_id: solveRes.nova_job_id },
      objects: [],
      warnings,
      provenance: { queries: [], solver: 'nova.astrometry.net', timestamp },
    });
  }

  const wcs = solveRes.wcs;
  const radius = fieldRadiusDeg(wcs);
  const candidates = await deps.catalog.region({
    ra_deg: wcs.ra0_deg,
    dec_deg: wcs.dec0_deg,
    radius_deg: radius,
  });
  const gated = gateCandidates(candidates, wcs);

  // Curated nickname overlay (amateur names absent from SIMBAD/Wikidata/OpenNGC,
  // e.g. Dark Doodad / Statue of Liberty), applied BEFORE selection so a famous
  // but survey-only object is recognized, fame-boosted, and kept — not just
  // labelled after the fact. See nicknames.ts.
  for (const g of gated) {
    const c = g.candidate;
    const nn = lookupNickname([...Object.values(c.catalog_ids), ...c.names, c.main_id]);
    if (nn) c.common_name = { en: nn.en, zh: nn.zh ?? c.common_name?.zh };
  }

  // Image luminance — gate candidates on actual visibility + snap Class-B
  // markers onto bright structure. Best effort: never fail if unreadable (tests).
  let sampler: LuminanceSampler | undefined;
  try {
    sampler = await createLuminanceSampler(input.imagePath, input.width, input.height);
  } catch {
    sampler = undefined;
  }
  const backgroundLum = sampler ? estimateBackground(sampler, wcs.width, wcs.height) : undefined;
  const visWindow = Math.max(8, Math.round(Math.min(wcs.width, wcs.height) / 50));

  // Comet detection — a comet is a moving object (no catalog), so it's read from
  // the image morphology: head/nucleus/coma + dust/ion tails. When found it's the
  // primary; the catalog objects (incidental background galaxies/stars) stay.
  let cometObjects: CometFactObject[] | undefined;
  try {
    const raster = await createImageRaster(input.imagePath, input.width, input.height);
    const comet = detectComet(raster, wcs, wcs.scale_deg * 3600);
    // A comet is a transient — it has NO catalog object at its position. If a
    // catalogued object sits at the detected head, it's that object (e.g. the
    // Pencil filament = NGC 2736), not a comet — a thin nebula can otherwise mimic
    // the head-plus-tail shape.
    if (comet) {
      const [nx, ny] = comet.nucleusPixel;
      const guard = Math.max(comet.comaRadiusPx * 3, 80);
      // Only a RECOGNIZABLE extended object (a real named nebula/galaxy, e.g. the
      // Pencil = NGC 2736) at the head vetoes. A background point star, or a faint
      // survey clump the comet is merely superimposed on (a Planck PGCC), must not.
      const onCatalogObject = gated.some(
        (g) =>
          g.candidate.size_arcmin &&
          hasRecognizableName(g.candidate) &&
          Math.hypot(g.pixel[0] - nx, g.pixel[1] - ny) < guard,
      );
      if (!onCatalogObject) cometObjects = cometToObjects(comet);
    }
  } catch {
    cometObjects = undefined; // best-effort
  }

  const selected = selectObjects(gated, {
    ...selectOpts,
    sampler,
    backgroundLum,
    visWindow,
    imageW: wcs.width,
    imageH: wcs.height,
  });
  console.error(
    `[identify] candidates=${candidates.length} → in-frame/known=${gated.length} → selected=${selected.length} (prominence filter, cap ${selectOpts.topN}): ${selected.map((g) => g.candidate.names[0] ?? g.candidate.main_id).join(', ')}`,
  );

  // Class-B morphology (pillars) — deterministic CV on the image (no AI). Run only
  // when an emission nebula is in the selected set (the morphology targets HII
  // pillars; skip galaxy/cluster/star fields to save the work). Best-effort: a
  // read/decode failure never breaks identification.
  let morphology: { result: MorphResult; selected: MorphFeature[] } | undefined;
  if (selected.some((g) => g.category === 'emission_nebula')) {
    try {
      const detected = await detectMorphology(input.imagePath);
      // Confine pillars to a selected emission nebula's VISIBLE glow — otherwise
      // the detector finds dark-column structure in unrelated foreground dust
      // (e.g. the Rho Oph clouds around M4) and mis-attributes it to a far, faint
      // nebula. Use the image-measured glow extent (the catalog size is often an
      // inflated footprint), falling back to the catalog radius.
      const ds = detected.downsample;
      const win = Math.max(8, Math.round(Math.min(wcs.width, wcs.height) / 50));
      const nebFoot = selected
        .filter((g) => g.category === 'emission_nebula' && g.candidate.size_arcmin)
        .map((g) => {
          const catR = (g.candidate.size_arcmin![0] * 60) / (wcs.scale_deg * 3600) / 2;
          let r = catR;
          let anchor: [number, number] = [g.pixel[0], g.pixel[1]];
          if (sampler && backgroundLum != null) {
            const vis = visibleRadiusPx(g.pixel, catR, sampler, backgroundLum, wcs.width, wcs.height, win);
            if (vis > win) r = vis;
            // Anchor the prior on the glow's bright centroid (the ionizing
            // cluster), not a single off-centre WR star.
            anchor = brightCentroid(g.pixel[0], g.pixel[1], r, sampler, backgroundLum, wcs.width, wcs.height);
          }
          return { x: g.pixel[0], y: g.pixel[1], r: r * 1.15, anchor };
        });
      const confined: MorphResult = {
        ...detected,
        features: nebFoot.length
          ? detected.features.filter((f) =>
              nebFoot.some(
                (n) => Math.hypot(f.centroid_px[0] * ds - n.x, f.centroid_px[1] * ds - n.y) <= n.r,
              ),
            )
          : [],
      };
      // Illumination prior: hard-filter pillars whose lit rim doesn't face the
      // nebula's bright ionizing centre (the embedded OB cluster — anchored on the
      // glow's bright centroid, not a single off-centre WR star). Also drops
      // non-pillar dark features (the Keyhole) whose geometry doesn't obey it. No
      // nebula glow ⇒ no prior (the set passes through as un-anchored B-visual).
      const anchors = nebFoot.map((n) => n.anchor);
      const result = applyIlluminationPrior(confined, anchors);
      const sel = selectForOutreach(result);
      if (sel.length) {
        morphology = { result, selected: sel };
        console.error(
          `[identify] morphology: ${detected.features.length} → ${confined.features.length} in-nebula → ${result.features.length} after illumination prior → ${sel.length} selected`,
        );
      }
    } catch {
      morphology = undefined;
    }
  }
  const queries = [
    `SIMBAD region r=${radius.toFixed(3)}deg @ (${wcs.ra0_deg.toFixed(3)}, ${wcs.dec0_deg.toFixed(3)})`,
  ];

  // Wikidata enrichment (Tier 1): for selected objects that have a common name
  // (⇒ famous), fetch a zh name + a mechanism-specific type. Best-effort, in
  // parallel; failures are swallowed inside the client.
  const wiki = createWikidataClient();
  await Promise.all(
    selected.map(async (g) => {
      const en = g.candidate.common_name?.en;
      if (!en) return;
      const info = await wiki.lookup(en);
      if (!info) return;
      // Don't overwrite a zh name the overlay already provided.
      if (info.name_zh && !g.candidate.common_name?.zh) {
        g.candidate.common_name = { ...g.candidate.common_name, zh: info.name_zh };
      }
      if (info.category) g.candidate.wiki_type = { category: info.category };
    }),
  );

  // Atlas Apply: B-class features are projected from the approved registry
  // (baseline + any user overlay, merged).
  const registry = input.registryPaths?.length ? await loadRegistries(input.registryPaths) : null;

  return assembleFactSheet({
    image,
    wcs,
    novaJobId: solveRes.nova_job_id,
    solveMs: solveRes.elapsed_ms,
    solveCached: solveRes.cached,
    selected,
    queries,
    timestamp,
    sampler,
    cometObjects,
    morphology,
    registry,
  });
}
