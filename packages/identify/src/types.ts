// The WCS type + projection live in @astrolens/schema (shared with the editor).
import type { Wcs, ObjectCategory } from '@astrolens/schema';
export type { Wcs };

export interface SolveInput {
  imagePath: string;
  width: number;
  height: number;
}

export interface SolveResult {
  status: 'solved' | 'failed';
  wcs?: Wcs;
  nova_job_id?: string;
  /** Human-readable reason when status is 'failed' (auth / timeout / no-solve / …). */
  error?: string;
  /** Wall-clock time this solve() call took, ms. ~0 on a cache hit. */
  elapsed_ms?: number;
  /** True when served from the on-disk solve cache (instant, no nova). */
  cached?: boolean;
}

/** Pluggable plate-solver (nova in production; mock in tests). */
export interface SolveClient {
  solve(input: SolveInput): Promise<SolveResult>;
}

/** A raw catalog match from a region query, before gating/ranking. */
export interface CatalogCandidate {
  main_id: string;
  names: string[];
  otype: string; // SIMBAD otype code, e.g. "HII", "WR*", "GlC"
  ra_deg: number;
  dec_deg: number;
  size_arcmin?: [number, number]; // [major, minor]
  /** Apparent magnitude if known (smaller = brighter); used for ranking. */
  mag?: number;
  catalog_ids: Record<string, string>; // { messier:'M42', ngc:'NGC 1976' }
  source: string; // 'SIMBAD'
  /** Friendly common name (en from SIMBAD `NAME`, zh filled later from Wikidata). */
  common_name?: { zh?: string; en?: string };
  /** Designations folded in by cross-source dedup + their separation (arcmin). */
  cross_match?: { id: string; sep_arcmin: number }[];
  /** Type resolved from Wikidata (P31), overriding a generic catalogue type. */
  wiki_type?: { category?: ObjectCategory; en?: string; zh?: string };
}

export interface RegionQuery {
  ra_deg: number;
  dec_deg: number;
  radius_deg: number;
}

/** Pluggable catalog (SIMBAD TAP in production; mock in tests). */
export interface CatalogClient {
  region(query: RegionQuery): Promise<CatalogCandidate[]>;
}

export interface IdentifyInput {
  imagePath: string;
  width: number;
  height: number;
  /** Relative path stored in factsheet.image.src. Defaults to basename of imagePath. */
  imageSrc?: string;
  /** Precomputed image hash; if omitted, computed from the file (sha256). */
  hash?: string;
  /** Path to the atlas registry.json (approved B-class annotations). When set,
   * B-class features are projected from it; absent/missing file → no B-class. */
  registryPath?: string;
  targetName?: string;
  band?: 'broadband' | 'narrowband' | 'unknown';
  starless?: boolean;
  /** Max annotated objects to keep (others dropped). Default 8. */
  topN?: number;
  /** Selection thresholds (configurable later; sensible defaults for now). */
  starMagMax?: number; // keep stars brighter than this V mag. Default 4.
  nebulaMinArcmin?: number; // keep nebulae/clouds at least this big. Default 8.
  galaxyMinArcmin?: number; // keep galaxies at least this big (and catalogued). Default 3.
}

export interface IdentifyDeps {
  solve: SolveClient;
  catalog: CatalogClient;
}
