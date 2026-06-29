import { FactSheet, FEATURE_TAXONOMY, pixelToWorld } from '@astrolens/schema';
import type { ObjectCategory } from '@astrolens/schema';
import type { CatalogCandidate, Wcs } from './types.js';
import type { GatedCandidate } from './select.js';
import { objectTypeLabel } from './otype.js';
import { deriveBClassFeatures } from './features.js';
import { estimateBackground, type LuminanceSampler } from './luminance.js';
import type { CometFactObject } from './comet.js';
import type { MorphResult, MorphFeature } from './morph.js';
import { fieldRadiusDeg } from './wcs.js';

/** Drop Class-B inferences weaker than this — a low-confidence morphological
 * guess (e.g. the geometric ionization front at 0.4) is noise, not signal. */
const MIN_B_CONFIDENCE = 0.5;

/** Identity confidence — *which* catalogue object this is. */
function objConfidence(c: CatalogCandidate): number {
  if (c.catalog_ids.messier) return 0.97;
  if (c.catalog_ids.ngc || c.catalog_ids.ic) return 0.9;
  if (Object.keys(c.catalog_ids).length > 0) return 0.82;
  if (typeof c.mag === 'number') return 0.85; // a catalogued bright star
  return 0.7;
}

/** All catalogue designations to display, e.g. ["NGC 2736", "RCW 37"]. */
function designationsOf(c: CatalogCandidate): string[] {
  const ids = [...new Set(Object.values(c.catalog_ids))];
  if (ids.length) return ids;
  const d = c.main_id.replace(/^\*\s+/, '').replace(/\s+/g, ' ').trim();
  return d ? [d] : [];
}

interface ResolvedType {
  type: { otype: string; zh: string; en: string; source: string };
  category: ObjectCategory;
  type_confidence: number;
  type_needs_review: boolean;
}

/**
 * Resolve the object's *type* + its trustworthiness, separate from identity.
 * Survey catalogs type by emission, not mechanism (an SNR filament reads as
 * "emission nebula"), so a catalogue emission type is low-confidence; Wikidata
 * (P31), when available, is authoritative enough to override it.
 */
function resolveType(c: CatalogCandidate, gateCat: ObjectCategory): ResolvedType {
  if (c.wiki_type) {
    const category = c.wiki_type.category ?? gateCat;
    const base = objectTypeLabel(c.otype, category);
    return {
      type: {
        otype: c.otype,
        zh: c.wiki_type.zh ?? base.zh,
        en: c.wiki_type.en ?? base.en,
        source: 'wiki',
      },
      category,
      type_confidence: 0.7,
      type_needs_review: false,
    };
  }
  const base = objectTypeLabel(c.otype, gateCat);
  const source = c.source.startsWith('VizieR') ? 'vizier' : 'simbad';
  // Emission/HII typed only from a catalogue is the unreliable bucket.
  const weak = gateCat === 'emission_nebula';
  return {
    type: { otype: c.otype, zh: base.zh, en: base.en, source },
    category: gateCat,
    type_confidence: weak ? 0.4 : 0.7,
    type_needs_review: weak,
  };
}

export interface AssembleArgs {
  image: {
    src: string;
    width: number;
    height: number;
    hash: string;
    band: 'broadband' | 'narrowband' | 'unknown';
    starless: boolean;
  };
  wcs: Wcs;
  novaJobId?: string;
  /** Already gated, prominence-filtered and ranked (see selectObjects). */
  selected: GatedCandidate[];
  queries: string[];
  timestamp: string;
  /** Image luminance, for snapping Class-B markers onto bright structure. */
  sampler?: LuminanceSampler;
  /** Image-detected comet (head + nucleus/coma/tails), no catalog. When present
   * the comet is the primary and the catalog objects become secondaries. */
  cometObjects?: CometFactObject[];
  /** Image-detected morphology (pillars …), outreach-selected. Mapped to Class-B
   * suggestion features — contour polygon + 迎光 arrow — linked to the host nebula. */
  morphology?: { result: MorphResult; selected: MorphFeature[] };
}

/**
 * Map outreach-selected pillars (in the detector's downsampled grid) into
 * Class-B FactObjects: scale to full pixels, project to sky, link to the nearest
 * emission nebula, and carry the contour polygon + 迎光 arrow. Geometry only —
 * the semantic name is left to the type-anchor stage, `display` stays a suggestion.
 */
function morphToObjects(
  morphology: { result: MorphResult; selected: MorphFeature[] },
  wcs: Wcs,
  objects: Array<{
    id: string;
    category: ObjectCategory;
    type: { otype: string };
    coord: { pixel: [number, number] | null };
  }>,
): Array<Record<string, unknown>> {
  const { result, selected } = morphology;
  const ds = result.downsample;
  const tax = FEATURE_TAXONOMY.pillar;
  const nebulae = objects.filter((o) => o.category === 'emission_nebula' && o.coord.pixel);
  const isExciting = (ot: string): boolean => /^(WR|O)/.test(ot) || ot === 's*b';
  const excitingStars = objects.filter(
    (o) => o.category === 'star' && isExciting(o.type.otype) && o.coord.pixel,
  );
  const armPx = Math.min(Math.max(0.04 * Math.min(wcs.width, wcs.height), 40), 200);
  return selected.flatMap((f, k) => {
    const cx = f.centroid_px[0] * ds;
    const cy = f.centroid_px[1] * ds;
    const world = pixelToWorld(wcs, cx, cy);
    const polygon = f.contour_px.map(([x, y]) => [x * ds, y * ds] as [number, number]);
    let parent: string | null = null;
    let bestD = Infinity;
    for (const n of nebulae) {
      const d = Math.hypot(n.coord.pixel![0] - cx, n.coord.pixel![1] - cy);
      if (d < bestD) {
        bestD = d;
        parent = n.id;
      }
    }
    // A pillar consistent with the photoevaporation prior is anchored on the
    // exciting star it points at (nearest one) → upgrade B-visual to B-anchor.
    const anchored = f.consistent_with_prior === true;
    let anchorRef: string | undefined;
    let bestS = Infinity;
    for (const s of excitingStars) {
      const d = Math.hypot(s.coord.pixel![0] - cx, s.coord.pixel![1] - cy);
      if (d < bestS) {
        bestS = d;
        anchorRef = s.id;
      }
    }
    let arrow_to: { ra_deg: number; dec_deg: number; pixel: [number, number] } | undefined;
    if (f.illumination_vector_deg != null) {
      const a = (f.illumination_vector_deg * Math.PI) / 180;
      const tx = cx + armPx * Math.cos(a);
      const ty = cy + armPx * Math.sin(a);
      const tw = pixelToWorld(wcs, tx, ty);
      arrow_to = {
        ra_deg: tw ? tw[0] : world ? world[0] : 0,
        dec_deg: tw ? tw[1] : world ? world[1] : 0,
        pixel: [Math.round(tx), Math.round(ty)],
      };
    }
    const pillar: Record<string, unknown> = {
      id: `pillar${k + 1}`,
      role: 'context',
      tier: 'B',
      parent_object_id: parent,
      feature_type: 'pillar',
      feature_class: anchored ? 'B-anchor' : 'B-visual',
      names: [`${tax.zh} / ${tax.en}`],
      designations: [],
      category: 'emission_nebula',
      type: { otype: '', zh: tax.zh, en: tax.en, source: 'image' },
      coord: { ra_deg: world ? world[0] : 0, dec_deg: world ? world[1] : 0, pixel: [Math.round(cx), Math.round(cy)] },
      ...(arrow_to ? { arrow_to } : {}),
      polygon,
      catalog_ids: {},
      confidence: anchored ? Math.min(1, f.confidence + 0.1) : f.confidence,
      localization: {
        method: anchored ? 'anchor' : 'world_to_pixel',
        confidence: anchored ? 0.6 : 0.5,
        ...(anchored && anchorRef ? { anchor_ref: anchorRef } : {}),
      },
      detection_source: 'cv',
      needs_human_review: true,
    };
    // The lit edge becomes its OWN Class-B feature (a bright rim / 电离锋面) — its
    // own colour + label + badge — anchored on the pillar, drawn as a thin line.
    const out: Array<Record<string, unknown>> = [pillar];
    if (f.rim_px.length > 1) {
      const rimPts = f.rim_px.map(([x, y]) => [x * ds, y * ds] as [number, number]);
      const mx = Math.round(rimPts.reduce((a, p) => a + p[0], 0) / rimPts.length);
      const my = Math.round(rimPts.reduce((a, p) => a + p[1], 0) / rimPts.length);
      const rw = pixelToWorld(wcs, mx, my);
      const rtax = FEATURE_TAXONOMY.ionization_front;
      out.push({
        id: `rim${k + 1}`,
        role: 'context',
        tier: 'B',
        parent_object_id: `pillar${k + 1}`,
        feature_type: 'ionization_front',
        feature_class: anchored ? 'B-anchor' : 'B-visual',
        names: [`${rtax.zh} / ${rtax.en}`],
        designations: [],
        category: 'emission_nebula',
        type: { otype: '', zh: rtax.zh, en: rtax.en, source: 'image' },
        coord: { ra_deg: rw ? rw[0] : 0, dec_deg: rw ? rw[1] : 0, pixel: [mx, my] },
        polygon: rimPts,
        catalog_ids: {},
        confidence: f.confidence,
        localization: { method: 'world_to_pixel', confidence: anchored ? 0.6 : 0.5 },
        detection_source: 'cv',
        needs_human_review: true,
      });
    }
    return out;
  });
}

/**
 * Build a validated FactSheet (solved path). Each selected catalogue entry — a
 * cluster, bright star, nebula/cloud or galaxy — becomes an object the reader
 * will annotate as one circle. Sub-features (pillars/fronts/…) are out of scope
 * for the wide-field MVP, so objects carry no features yet.
 */
export function assembleFactSheet(args: AssembleArgs): FactSheet {
  const { wcs } = args;
  const warnings: string[] = [];
  if (args.selected.length === 0) {
    warnings.push('No prominent catalogued object with an optical counterpart in the field.');
  }

  const hasComet = (args.cometObjects?.length ?? 0) > 0;
  const objects = args.selected.map((g, i) => {
    const c = g.candidate;
    const rt = resolveType(c, g.category);
    const common =
      c.common_name && (c.common_name.en || c.common_name.zh) ? c.common_name : undefined;
    return {
      id: `obj${i + 1}`,
      role: !hasComet && i === 0 ? ('primary' as const) : ('secondary' as const),
      names: c.names.length ? c.names : [c.main_id],
      ...(common ? { common_name: common } : {}),
      designations: designationsOf(c),
      category: rt.category, // may be corrected by Wikidata (e.g. SNR vs HII)
      type: rt.type,
      coord: { ra_deg: c.ra_deg, dec_deg: c.dec_deg, pixel: g.pixel },
      ...(c.size_arcmin ? { size_arcmin: c.size_arcmin } : {}),
      catalog_ids: c.catalog_ids,
      confidence: objConfidence(c),
      type_confidence: rt.type_confidence,
      type_needs_review: rt.type_needs_review,
      ...(c.cross_match?.length ? { cross_match: c.cross_match } : {}),
      // tier 'A' (catalog-grounded), parent_object_id null, needs_human_review
      // false all come from schema defaults.
    };
  });

  // Class-B geometric priors anchored on A objects (features.ts), appended after
  // the A-class objects so the primary stays objects[0]. The standalone CV
  // bright-rim detector (cv.ts) was dropped in favour of pillar-anchored rims
  // (morph.ts) — a lone rim arc was noisier and less accurate than a rim tied to
  // a detected pillar.
  const bg = args.sampler ? estimateBackground(args.sampler, wcs.width, wcs.height) : undefined;
  const bFeatures = deriveBClassFeatures(objects, {
    wcs,
    sampler: args.sampler,
    backgroundLum: bg,
  }).filter((f) => f.confidence >= MIN_B_CONFIDENCE);

  // Image-detected morphology (pillars), outreach-selected — appended as Class-B
  // suggestion features linked to the host nebula.
  const morphObjects = args.morphology
    ? morphToObjects(args.morphology, wcs, objects).filter(
        (o) => (o.confidence as number) >= MIN_B_CONFIDENCE,
      )
    : [];

  return FactSheet.parse({
    version: '1.0',
    image: args.image,
    solve: {
      status: 'solved',
      ra_deg: wcs.ra0_deg,
      dec_deg: wcs.dec0_deg,
      radius_deg: fieldRadiusDeg(wcs),
      pixscale_arcsec: wcs.scale_deg * 3600,
      orientation_deg: wcs.orientation_deg,
      nova_job_id: args.novaJobId,
      wcs,
      frame: 'display',
    },
    objects: [...(args.cometObjects ?? []), ...objects, ...bFeatures, ...morphObjects],
    warnings,
    provenance: {
      queries: args.queries,
      solver: 'nova.astrometry.net',
      timestamp: args.timestamp,
    },
  });
}
