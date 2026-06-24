import { FEATURE_TAXONOMY, pixelToWorld, type ObjectCategory, type Wcs } from '@astrolens/schema';
import type { LuminanceSampler } from './luminance.js';

/**
 * Class-B geometric priors — deterministic, no CV/AI. Derives morphological
 * features whose location can be constrained from already-identified A-class
 * anchors (the "borrow the coordinates back" idea, method 1 in the Notion
 * B-class plan). Each derived feature is *anchored* (a direction relative to an
 * A object, not a precise box) and flagged needs_human_review — the editor /
 * human places the final shape.
 *
 * First slice:
 *  - a WR exciting star inside an emission nebula → a wind-blown shell
 *    (`bubble_shell`) centred on the star (e.g. SH2-308 around HD 50896);
 *  - a dark cloud inside such an HII region → an `ionization_front` whose bright
 *    rim faces the exciting star.
 */

/** Minimal shape of an assembled A-class object (pre-parse) we read here. */
export interface DerivableObject {
  id: string;
  category: ObjectCategory;
  type: { otype: string; zh: string; en: string };
  coord: { ra_deg: number; dec_deg: number; pixel: [number, number] | null };
  size_arcmin?: [number, number];
  names: string[];
}

const DEG = Math.PI / 180;

/** Angular separation between two sky points, in degrees. */
function sepDeg(a: DerivableObject, b: DerivableObject): number {
  const d1 = a.coord.dec_deg * DEG;
  const d2 = b.coord.dec_deg * DEG;
  const dRa = (a.coord.ra_deg - b.coord.ra_deg) * DEG;
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dRa);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

/** Position angle (deg E of N) + cardinal direction from `from` toward `to`. */
function bearing(from: DerivableObject, to: DerivableObject): { pa: number; cardinal: string } {
  const d1 = from.coord.dec_deg * DEG;
  const d2 = to.coord.dec_deg * DEG;
  const dRa = (to.coord.ra_deg - from.coord.ra_deg) * DEG;
  const y = Math.sin(dRa) * Math.cos(d2);
  const x = Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(dRa);
  const pa = (Math.atan2(y, x) / DEG + 360) % 360;
  const cardinal = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(pa / 45) % 8]!;
  return { pa: Math.round(pa), cardinal };
}

function isExcitingStar(o: DerivableObject): boolean {
  return o.category === 'star' && (o.type.otype === 'WR*' || o.type.otype === 'WR?');
}

function radiusDeg(o: DerivableObject): number {
  return o.size_arcmin ? o.size_arcmin[0] / 2 / 60 : 0;
}

/** Smallest emission nebula whose footprint contains `o`'s centre. */
function containingNebula(nebulae: DerivableObject[], o: DerivableObject): DerivableObject | null {
  let best: DerivableObject | null = null;
  let bestR = Infinity;
  for (const n of nebulae) {
    const r = radiusDeg(n);
    if (r > 0 && sepDeg(n, o) <= r && r < bestR) {
      best = n;
      bestR = r;
    }
  }
  return best;
}

function label(o: DerivableObject): string {
  return o.names[0] ?? o.type.en;
}

export interface DeriveOpts {
  /** WCS of the solved frame — needed to size the shell rim + project back to sky. */
  wcs?: Wcs;
  /** Image luminance, so a marker can be snapped onto the bright structure. */
  sampler?: LuminanceSampler;
}

/** Median luminance in a window around (x,y). Median (not mean) so a bright
 * point star can't win — we want diffuse nebula brightness, not a stellar spike. */
export function localMedian(s: LuminanceSampler, x: number, y: number, win: number): number {
  const vals: number[] = [];
  const step = win / 3;
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      const v = s(x + i * step, y + j * step);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  if (!vals.length) return NaN;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)]!;
}

/** A point on the shell rim toward the frame centre (so it stays on-frame). */
function rimTowardCentre(sp: [number, number], R: number, w: number, h: number): [number, number] {
  let ux = 0;
  let uy = -1;
  const dx = w / 2 - sp[0];
  const dy = h / 2 - sp[1];
  const m = Math.hypot(dx, dy);
  if (m >= 1) {
    ux = dx / m;
    uy = dy / m;
  }
  return [Math.round(sp[0] + R * ux), Math.round(sp[1] + R * uy)];
}

/** Brightest point in the shell annulus, so the marker lands on the actual
 * (bright) shell material — the catalog radius often overestimates the visible
 * bubble, so we search a range of radii, not just the nominal rim. Candidates
 * too close to another labeled object (a bright star, cloud …) are skipped so
 * the shell marker doesn't pile onto an existing badge. */
export function rimBrightest(
  sp: [number, number],
  R: number,
  s: LuminanceSampler,
  w: number,
  h: number,
  win: number,
  avoid: [number, number][],
): { pixel: [number, number]; lum: number } | null {
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  const N = 48;
  const fracs = [0.55, 0.65, 0.75, 0.85, 0.95, 1.0];
  const avoidR = win * 1.6;
  const near = (x: number, y: number): boolean =>
    avoid.some((p) => Math.hypot(p[0] - x, p[1] - y) < avoidR);
  for (let k = 0; k < N; k++) {
    const ca = Math.cos((k / N) * 2 * Math.PI);
    const sa = Math.sin((k / N) * 2 * Math.PI);
    for (const fr of fracs) {
      const x = sp[0] + R * fr * ca;
      const y = sp[1] + R * fr * sa;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (near(x, y)) continue;
      const m = localMedian(s, x, y, win);
      if (Number.isFinite(m) && m > bestScore) {
        bestScore = m;
        best = [Math.round(x), Math.round(y)];
      }
    }
  }
  return best ? { pixel: best, lum: bestScore } : null;
}

/** Mark a wind shell with a small sample point on its rim — snapped to the
 * brightest part (verified against the image) when a sampler is available. */
function shellRimCoord(
  star: DerivableObject,
  host: DerivableObject,
  opts: DeriveOpts,
  avoid: [number, number][],
): DerivableObject['coord'] {
  const sp = star.coord.pixel;
  const wcs = opts.wcs;
  if (!sp || !wcs || !host.size_arcmin) return star.coord;
  const pixscale = wcs.scale_deg * 3600; // arcsec/px
  const R = (host.size_arcmin[0] * 60) / pixscale / 2; // rim radius, px
  const win = Math.max(8, Math.round(Math.min(wcs.width, wcs.height) / 35));
  const hit = opts.sampler ? rimBrightest(sp, R, opts.sampler, wcs.width, wcs.height, win, avoid) : null;
  const rim = hit ? hit.pixel : rimTowardCentre(sp, R, wcs.width, wcs.height);
  const world = pixelToWorld(wcs, rim[0], rim[1]);
  return {
    ra_deg: world ? world[0] : star.coord.ra_deg,
    dec_deg: world ? world[1] : star.coord.dec_deg,
    pixel: rim,
  };
}

export type FeatureTypeB = 'bubble_shell' | 'ionization_front';

/** A derived B-class feature, in the FactObject literal shape (pre-parse). */
export interface DerivedFeature {
  id: string;
  role: 'context';
  tier: 'B';
  parent_object_id: string;
  feature_type: FeatureTypeB;
  feature_class: 'B-anchor' | 'B-visual';
  names: string[];
  category: ObjectCategory;
  type: { otype: string; zh: string; en: string };
  coord: { ra_deg: number; dec_deg: number; pixel: [number, number] | null };
  size_arcmin?: [number, number];
  catalog_ids: Record<string, string>;
  confidence: number;
  localization: {
    method: 'anchor' | 'world_to_pixel';
    anchor_ref?: string;
    direction?: string;
    confidence: number;
  };
  detection_source: 'geometric' | 'cv' | 'ai';
  needs_human_review: true;
}

interface MakeOpts {
  coord: DerivableObject['coord'];
  size?: [number, number];
  confidence: number;
  direction: string;
}

function make(
  id: string,
  ft: FeatureTypeB,
  host: DerivableObject,
  anchor: DerivableObject,
  opts: MakeOpts,
): DerivedFeature {
  const tax = FEATURE_TAXONOMY[ft];
  return {
    id,
    role: 'context',
    tier: 'B',
    parent_object_id: host.id,
    feature_type: ft,
    feature_class: 'B-anchor',
    names: [`${tax.zh} / ${tax.en}`],
    category: host.category,
    type: { otype: '', zh: tax.zh, en: tax.en },
    coord: opts.coord,
    ...(opts.size ? { size_arcmin: opts.size } : {}),
    catalog_ids: {},
    confidence: opts.confidence,
    localization: {
      method: 'anchor',
      anchor_ref: anchor.id,
      direction: opts.direction,
      confidence: opts.confidence,
    },
    detection_source: 'geometric',
    needs_human_review: true,
  };
}

export function deriveBClassFeatures(
  objects: DerivableObject[],
  opts: DeriveOpts = {},
): DerivedFeature[] {
  const nebulae = objects.filter((o) => o.category === 'emission_nebula');
  const stars = objects.filter(isExcitingStar);
  const clouds = objects.filter((o) => o.category === 'dark_nebula');
  const out: DerivedFeature[] = [];
  let n = 0;
  // Pixels of all labeled objects — the shell marker steers clear of these so
  // it doesn't land on an existing badge (e.g. a bright star on the rim).
  const avoid = objects
    .map((o) => o.coord.pixel)
    .filter((p): p is [number, number] => p != null);

  // 1. wind-blown shell — a WR star inside an emission nebula. Marked with a
  //    small sample point on the (brightest) rim, not a ring around the whole.
  for (const star of stars) {
    const host = containingNebula(nebulae, star);
    if (!host) continue;
    out.push(
      make(`bshell${++n}`, 'bubble_shell', host, star, {
        coord: shellRimCoord(star, host, opts, avoid),
        size: host.size_arcmin,
        confidence: 0.5,
        direction: `centred on the exciting star ${label(star)}`,
      }),
    );
  }

  // 2. ionization front — a dark cloud inside an HII region that has a WR star;
  //    the bright rim faces the star.
  for (const cloud of clouds) {
    const host = containingNebula(nebulae, cloud);
    if (!host) continue;
    const star = stars.find((s) => containingNebula([host], s));
    if (!star) continue;
    const dir = bearing(cloud, star);
    out.push(
      make(`bfront${++n}`, 'ionization_front', cloud, star, {
        coord: cloud.coord,
        confidence: 0.4,
        direction: `bright rim faces ${label(star)} (toward ${dir.cardinal}, PA ${dir.pa}°)`,
      }),
    );
  }

  return out;
}
