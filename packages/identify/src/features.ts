import { FEATURE_TAXONOMY, type ObjectCategory } from '@astrolens/schema';

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

export type FeatureTypeB = 'bubble_shell' | 'ionization_front';

/** A derived B-class feature, in the FactObject literal shape (pre-parse). */
export interface DerivedFeature {
  id: string;
  role: 'context';
  tier: 'B';
  parent_object_id: string;
  feature_type: FeatureTypeB;
  feature_class: 'B-anchor';
  names: string[];
  category: ObjectCategory;
  type: { otype: string; zh: string; en: string };
  coord: { ra_deg: number; dec_deg: number; pixel: [number, number] | null };
  size_arcmin?: [number, number];
  catalog_ids: Record<string, string>;
  confidence: number;
  localization: { method: 'anchor'; anchor_ref: string; direction: string; confidence: number };
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
    needs_human_review: true,
  };
}

export function deriveBClassFeatures(objects: DerivableObject[]): DerivedFeature[] {
  const nebulae = objects.filter((o) => o.category === 'emission_nebula');
  const stars = objects.filter(isExcitingStar);
  const clouds = objects.filter((o) => o.category === 'dark_nebula');
  const out: DerivedFeature[] = [];
  let n = 0;

  // 1. wind-blown shell — a WR star inside an emission nebula.
  for (const star of stars) {
    const host = containingNebula(nebulae, star);
    if (!host) continue;
    out.push(
      make(`bshell${++n}`, 'bubble_shell', host, star, {
        coord: star.coord, // the shell is centred on the wind source
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
