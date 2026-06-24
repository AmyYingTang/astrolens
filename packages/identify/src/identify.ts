import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { FactSheet } from '@astrolens/schema';
import type { IdentifyInput, IdentifyDeps } from './types.js';
import { fieldRadiusDeg } from './wcs.js';
import { gateCandidates, selectObjects } from './select.js';
import { assembleFactSheet } from './assemble.js';
import { createLuminanceSampler, estimateBackground, type LuminanceSampler } from './luminance.js';

async function fileHash(path: string): Promise<string> {
  const buf = await readFile(path);
  return 'sha256:' + createHash('sha256').update(buf).digest('hex').slice(0, 16);
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
  const queries = [
    `SIMBAD region r=${radius.toFixed(3)}deg @ (${wcs.ra0_deg.toFixed(3)}, ${wcs.dec0_deg.toFixed(3)})`,
  ];

  return assembleFactSheet({
    image,
    wcs,
    novaJobId: solveRes.nova_job_id,
    selected,
    queries,
    timestamp,
    sampler,
  });
}
