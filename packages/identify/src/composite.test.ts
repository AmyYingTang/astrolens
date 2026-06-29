import { describe, it, expect } from 'vitest';
import { mergeCandidates } from './composite.js';
import type { CatalogCandidate } from './types.js';

function cand(over: Partial<CatalogCandidate>): CatalogCandidate {
  return {
    main_id: 'X',
    names: ['X'],
    otype: 'HII',
    ra_deg: 161.27,
    dec_deg: -59.66,
    catalog_ids: {},
    source: 'SIMBAD',
    ...over,
  };
}

describe('mergeCandidates — same-complex cross-category merge', () => {
  it('folds a comparable concentric Cederblad reflection entry into the HII region', () => {
    // Carina: NGC 3372 (HII, 210′) and Ced 109 (Cederblad blanket-typed RNe, 120′)
    // at the same centre — the same complex, listed twice.
    const ngc = cand({
      main_id: 'NGC 3372',
      names: ['NGC 3372'],
      otype: 'HII',
      size_arcmin: [210, 210],
      catalog_ids: { ngc: 'NGC 3372' },
      source: 'VizieR:VII/216/rcw',
    });
    const ced = cand({
      main_id: 'Ced 109',
      names: ['Ced 109'],
      otype: 'RNe',
      size_arcmin: [120, 120],
      catalog_ids: { cederblad: 'Ced 109' },
      source: 'VizieR:VII/231/catalog',
    });
    const merged = mergeCandidates([[ngc], [ced]]);
    expect(merged).toHaveLength(1);
    // NGC (higher prestige) survives; it stays the emission nebula, not RNe.
    expect(merged[0]!.otype).toBe('HII');
    expect(merged[0]!.catalog_ids.ngc).toBe('NGC 3372');
    expect(merged[0]!.cross_match?.some((x) => x.id === 'Ced 109')).toBe(true);
  });

  it('does NOT swallow a genuine small reflection nebula inside a big HII region', () => {
    const hii = cand({ otype: 'HII', size_arcmin: [210, 210], catalog_ids: { ngc: 'NGC 3372' } });
    const smallRfn = cand({
      main_id: 'vdB X',
      otype: 'RNe',
      size_arcmin: [8, 8], // tiny vs 210′ → a real sub-object, not the same complex
      catalog_ids: { vdb: 'vdB X' },
    });
    expect(mergeCandidates([[hii], [smallRfn]])).toHaveLength(2);
  });

  it('does NOT merge comparable nebulae that are far apart', () => {
    const a = cand({ otype: 'HII', size_arcmin: [120, 120], catalog_ids: { ngc: 'NGC A' } });
    const b = cand({
      otype: 'RNe',
      ra_deg: 161.27 + 1.5, // ~45′ away → not concentric
      size_arcmin: [120, 120],
      catalog_ids: { cederblad: 'Ced B' },
    });
    expect(mergeCandidates([[a], [b]])).toHaveLength(2);
  });
});
