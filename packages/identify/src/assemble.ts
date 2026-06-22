import { FactSheet } from '@astrolens/schema';
import type { CatalogCandidate, Wcs } from './types.js';
import type { GatedCandidate } from './select.js';
import { objectTypeLabel } from './otype.js';
import { fieldRadiusDeg } from './wcs.js';

function objConfidence(c: CatalogCandidate): number {
  if (c.catalog_ids.messier) return 0.97;
  if (c.catalog_ids.ngc || c.catalog_ids.ic) return 0.9;
  if (Object.keys(c.catalog_ids).length > 0) return 0.82;
  if (typeof c.mag === 'number') return 0.85; // a catalogued bright star
  return 0.7;
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

  const objects = args.selected.map((g, i) => {
    const c = g.candidate;
    const cat = g.category;
    return {
      id: `obj${i + 1}`,
      role: i === 0 ? ('primary' as const) : ('secondary' as const),
      names: c.names.length ? c.names : [c.main_id],
      category: cat,
      type: { otype: c.otype, ...objectTypeLabel(c.otype, cat) },
      coord: { ra_deg: c.ra_deg, dec_deg: c.dec_deg, pixel: g.pixel },
      ...(c.size_arcmin ? { size_arcmin: c.size_arcmin } : {}),
      catalog_ids: c.catalog_ids,
      confidence: objConfidence(c),
      features: [],
    };
  });

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
    objects,
    warnings,
    provenance: {
      queries: args.queries,
      solver: 'nova.astrometry.net',
      timestamp: args.timestamp,
    },
  });
}
