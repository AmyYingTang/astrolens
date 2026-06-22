import { z } from 'zod';
import { LocalizedString } from './i18n.js';
import { FeatureType, FeatureClass, ObjectCategory } from './taxonomy.js';
import { Wcs } from './wcs.js';

/** Plate-solve outcome; drives downstream trust. */
export const SolveStatus = z.enum(['solved', 'user_provided', 'failed']);
export type SolveStatus = z.infer<typeof SolveStatus>;

export const FactFeature = z.object({
  id: z.string(),
  name: LocalizedString,
  feature_type: FeatureType, // controlled vocabulary, see taxonomy.ts
  class: FeatureClass, // this instance's real tier (may differ from taxonomy default)
  source: z.string(), // 'SIMBAD' | 'taxonomy' | 'BRC' | ...
  localization: z.object({
    method: z.enum(['world_to_pixel', 'anchor', 'none']),
    pixel: z.tuple([z.number(), z.number()]).nullable().default(null),
    anchor_ref: z.string().optional(),
    direction: z.string().optional(),
    confidence: z.number().min(0).max(1),
  }),
  needs_human_review: z.boolean(),
});
export type FactFeature = z.infer<typeof FactFeature>;

export const FactObject = z.object({
  id: z.string(),
  role: z.enum(['primary', 'secondary', 'context']),
  names: z.array(z.string()),
  category: ObjectCategory, // which feature set applies
  type: LocalizedString.extend({ otype: z.string() }), // SIMBAD otype + bilingual name
  coord: z.object({
    ra_deg: z.number(),
    dec_deg: z.number(),
    pixel: z.tuple([z.number(), z.number()]).nullable(),
  }),
  size_arcmin: z.tuple([z.number(), z.number()]).optional(), // [major, minor]
  distance: z.object({ value: z.number(), unit: z.string(), source: z.string() }).optional(),
  catalog_ids: z.record(z.string(), z.string()).default({}), // { messier:'M42', ngc:'NGC 1976' }
  confidence: z.number().min(0).max(1),
  features: z.array(FactFeature),
});
export type FactObject = z.infer<typeof FactObject>;

/**
 * The grounded fact sheet — the single interface from the identification stage
 * (Stage 1) to the LLM reader (Stage 2). Facts only; no interpretation.
 */
export const FactSheet = z.object({
  version: z.literal('1.0'),
  image: z.object({
    src: z.string(),
    width: z.number(),
    height: z.number(),
    hash: z.string(), // cache key
    band: z.enum(['broadband', 'narrowband', 'unknown']).default('unknown'),
    starless: z.boolean().default(false),
  }),
  solve: z.object({
    status: SolveStatus,
    ra_deg: z.number().optional(),
    dec_deg: z.number().optional(),
    radius_deg: z.number().optional(),
    pixscale_arcsec: z.number().optional(),
    orientation_deg: z.number().optional(),
    nova_job_id: z.string().optional(),
    /** Full WCS used to project sky → pixel (for re-projection / debug grid). */
    wcs: Wcs.optional(),
    frame: z.enum(['display', 'co-registered', 'none']), // which pixel grid the WCS applies to
    co_registration: z
      .object({
        method: z.string(),
        rms_px: z.number().optional(),
        confidence: z.number().optional(),
      })
      .optional(),
  }),
  objects: z.array(FactObject),
  warnings: z.array(z.string()).default([]),
  provenance: z.object({
    queries: z.array(z.string()),
    solver: z.string(), // 'nova.astrometry.net'
    timestamp: z.string().datetime(),
  }),
});
export type FactSheet = z.infer<typeof FactSheet>;

export const FACTSHEET_VERSION = '1.0' as const;
