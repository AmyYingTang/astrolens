import type { ObjectCategory } from '@astrolens/schema';
import type { CatalogCandidate, Wcs } from './types.js';
import { worldToPixel } from './wcs.js';
import { isOptical, objectCategory } from './otype.js';
import { sampleMedian, type LuminanceSampler } from './luminance.js';

/** A candidate that passed the annotation gate, with its projected pixel + category. */
export interface GatedCandidate {
  candidate: CatalogCandidate;
  pixel: [number, number];
  category: ObjectCategory;
}

export interface SelectOptions {
  starMagMax: number;
  nebulaMinArcmin: number;
  galaxyMinArcmin: number;
  /** Per-category caps so bright stars / clusters aren't crowded out by big nebulae. */
  maxStars: number;
  maxClusters: number;
  maxNebulae: number;
  maxGalaxies: number;
  /** Optional overall hard cap (applied after balancing). */
  topN?: number;
  /** Image luminance — when present, a candidate must also be *visible* (bright
   * structure, or a dark silhouette for dark nebulae) to be kept. */
  sampler?: LuminanceSampler;
  backgroundLum?: number;
  visWindow?: number;
}

/** Catalogs whose membership counts as a "recognizable" DSO designation. */
const NAMED_CATALOGS = [
  'messier',
  'ngc',
  'ic',
  'sharpless',
  'rcw',
  'vdb',
  'cederblad',
  'barnard',
  'ldn',
];
/** Survey / anonymous designations that are NOT a human-recognizable name. */
const SURVEY_NAME =
  /^(\[|2MASX|LEDA|PGCC|PGC\b|TGU|GSC|UCAC|Gaia |TYC |SAO |IRAS|WISE|2MASS|UGC|MCG|HVC|MGr|HDC|GRG)/i;

/** A DSO is "recognizable" if it has a known catalog id or a non-survey name. */
function hasRecognizableName(c: CatalogCandidate): boolean {
  if (NAMED_CATALOGS.some((k) => c.catalog_ids[k])) return true;
  return [c.main_id, ...c.names].some((n) => n.trim() !== '' && !SURVEY_NAME.test(n.trim()));
}

type Kind = 'star' | 'cluster' | 'nebula' | 'galaxy';

function kindOf(cat: ObjectCategory): Kind {
  if (cat === 'star') return 'star';
  if (cat === 'globular_cluster' || cat === 'open_cluster') return 'cluster';
  if (cat === 'galaxy') return 'galaxy';
  return 'nebula';
}

/** Catalogue significance, higher = more prominent. Messier ≫ NGC/IC ≫ other; + size + brightness. */
export function significance(c: CatalogCandidate): number {
  let score = 0;
  if (c.catalog_ids.messier) score += 1000;
  else if (c.catalog_ids.ngc || c.catalog_ids.ic) score += 500;
  else if (Object.keys(c.catalog_ids).length > 0) score += 100;
  if (c.size_arcmin) score += c.size_arcmin[0]; // angular size (major axis, arcmin)
  if (typeof c.mag === 'number') score += Math.max(0, 15 - c.mag); // brighter → larger bonus
  return score;
}

/**
 * Annotation gate: keep candidates with a visible optical counterpart we can
 * classify into a category, that project inside the frame. Non-optical
 * (radio/X-ray/IR) and unknown otypes are dropped.
 */
export function gateCandidates(candidates: CatalogCandidate[], wcs: Wcs): GatedCandidate[] {
  const margin = 0.05 * Math.max(wcs.width, wcs.height);
  const out: GatedCandidate[] = [];
  for (const c of candidates) {
    if (!isOptical(c.otype)) continue;
    const category = objectCategory(c.otype);
    if (!category) continue; // unknown otype — don't annotate
    const p = worldToPixel(wcs, c.ra_deg, c.dec_deg);
    if (!p) continue;
    if (p[0] < -margin || p[0] > wcs.width + margin) continue;
    if (p[1] < -margin || p[1] > wcs.height + margin) continue;

    // Drop extended objects that fall mostly outside the frame (e.g. a big dark
    // cloud whose centre is near an edge). Exempt a large object centred on the
    // frame — that's a legitimate main subject bigger than the field of view.
    if (c.size_arcmin) {
      const rPx = c.size_arcmin[0] / 2 / (wcs.scale_deg * 60); // arcmin → px radius
      if (rPx > 1) {
        const ix = Math.max(0, Math.min(p[0] + rPx, wcs.width) - Math.max(p[0] - rPx, 0));
        const iy = Math.max(0, Math.min(p[1] + rPx, wcs.height) - Math.max(p[1] - rPx, 0));
        const coverage = (ix * iy) / (4 * rPx * rPx);
        const coversCenter =
          Math.abs(p[0] - wcs.width / 2) <= rPx && Math.abs(p[1] - wcs.height / 2) <= rPx;
        if (coverage < 0.5 && !coversCenter) continue;
      }
    }
    out.push({ candidate: c, pixel: p, category });
  }
  return out;
}

/** Prominence filter — "the main bodies + main structures", not every faint catalogued thing. */
function isProminent(g: GatedCandidate, opts: SelectOptions): boolean {
  const c = g.candidate;
  const major = c.size_arcmin?.[0] ?? 0;
  const hasPrestige = !!(c.catalog_ids.messier || c.catalog_ids.ngc || c.catalog_ids.ic);
  switch (g.category) {
    case 'star': {
      // Exciting stars (Wolf–Rayet) are the source of a bubble/HII region — keep
      // them even when fainter than the naked-eye cutoff.
      const exciting = c.otype === 'WR*' || c.otype === 'WR?';
      return exciting || (typeof c.mag === 'number' && c.mag < opts.starMagMax);
    }
    case 'globular_cluster':
    case 'open_cluster':
      return hasPrestige; // named clusters only (M / NGC / IC)
    case 'galaxy':
      return hasPrestige && major >= opts.galaxyMinArcmin; // drop faint survey galaxies
    default:
      // nebulae / clouds — must be a recognizable named object AND large enough.
      // Drops survey-only clumps (e.g. PGCC Planck cold clumps) that aren't the
      // image's subject.
      return hasRecognizableName(c) && major >= opts.nebulaMinArcmin;
  }
}

/**
 * Visibility gate: with an image sampler, a candidate must actually be visible
 * in THIS frame — bright structure for emission/reflection/cluster/galaxy, or a
 * dark silhouette for dark nebulae. Stars are gated by magnitude already.
 */
function isVisible(g: GatedCandidate, opts: SelectOptions): boolean {
  const s = opts.sampler;
  const bg = opts.backgroundLum;
  if (!s || bg == null || !Number.isFinite(bg)) return true; // no image → don't gate
  if (g.category === 'star') return true;
  const v = sampleMedian(s, g.pixel[0], g.pixel[1], opts.visWindow ?? 40);
  if (!Number.isFinite(v)) return true;
  if (g.category === 'dark_nebula') return v < bg * 0.92; // darker than background
  return v > bg * 1.12; // brighter than background
}

/**
 * Select the prominent objects with per-category caps (so the bright stars and
 * clusters survive alongside the big nebulae), then order by significance so the
 * most prominent (e.g. a Messier object) becomes primary.
 */
export function selectObjects(gated: GatedCandidate[], opts: SelectOptions): GatedCandidate[] {
  const caps: Record<Kind, number> = {
    star: opts.maxStars,
    cluster: opts.maxClusters,
    nebula: opts.maxNebulae,
    galaxy: opts.maxGalaxies,
  };
  const groups: Record<Kind, GatedCandidate[]> = { star: [], cluster: [], nebula: [], galaxy: [] };
  for (const g of gated) {
    if (isProminent(g, opts) && isVisible(g, opts)) groups[kindOf(g.category)].push(g);
  }

  const kept: GatedCandidate[] = [];
  for (const kind of ['star', 'cluster', 'nebula', 'galaxy'] as Kind[]) {
    const exciting = (g: GatedCandidate): number =>
      g.candidate.otype === 'WR*' || g.candidate.otype === 'WR?' ? 0 : 1;
    const list = groups[kind].sort((a, b) =>
      kind === 'star'
        ? exciting(a) - exciting(b) || // exciting stars first, then brightest
          (a.candidate.mag ?? 99) - (b.candidate.mag ?? 99)
        : significance(b.candidate) - significance(a.candidate),
    );
    kept.push(...list.slice(0, caps[kind]));
  }

  // Always keep the single most-significant gated object — the image's subject
  // is shown even if it somehow failed the named/visible filters.
  const top = [...gated].sort((a, b) => significance(b.candidate) - significance(a.candidate))[0];
  if (top && !kept.includes(top)) kept.push(top);

  kept.sort((a, b) => significance(b.candidate) - significance(a.candidate));
  return opts.topN ? kept.slice(0, opts.topN) : kept;
}
