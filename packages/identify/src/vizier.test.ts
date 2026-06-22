import { describe, it, expect } from 'vitest';
import { parseAsuTsv } from './vizier.js';
import { mergeCandidates } from './composite.js';
import type { CatalogCandidate } from './types.js';

describe('parseAsuTsv', () => {
  it('parses an ASU-TSV body (header, units, dashed separator, spaced cells)', () => {
    const body = [
      '#comment line',
      '#another',
      '_RAJ2000\t_DEJ2000\tSh2\tDiam',
      'deg\tdeg\t \tarcmin',
      '------\t------\t------\t------',
      '103.507476\t-22.425061\t 303\t  90',
      '103.540528\t-23.942122\t 308\t  35',
    ].join('\n');
    const rows = parseAsuTsv(body);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ Sh2: '308', Diam: '35', _RAJ2000: '103.540528' });
  });

  it('returns [] for an empty/no-data body', () => {
    expect(parseAsuTsv('#no rows\n')).toEqual([]);
  });
});

const neb = (over: Partial<CatalogCandidate>): CatalogCandidate => ({
  main_id: 'x',
  names: ['x'],
  otype: 'HII',
  ra_deg: 103.5,
  dec_deg: -23.9,
  size_arcmin: [35, 35],
  catalog_ids: {},
  source: 'VizieR:test',
  ...over,
});

describe('mergeCandidates', () => {
  it('collapses the same nebula from two catalogs (Sh 2-308 ≡ RCW 11)', () => {
    const sharpless = neb({
      main_id: 'Sh 2-308',
      names: ['Sh 2-308'],
      ra_deg: 103.5405,
      dec_deg: -23.9421,
      catalog_ids: { sharpless: 'Sh 2-308' },
    });
    const rcw = neb({
      main_id: 'RCW 11',
      names: ['RCW 11'],
      ra_deg: 103.5221,
      dec_deg: -23.6472,
      catalog_ids: { rcw: 'RCW 11' },
    });
    const merged = mergeCandidates([[sharpless], [rcw]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.catalog_ids).toMatchObject({ sharpless: 'Sh 2-308', rcw: 'RCW 11' });
    expect(merged[0]!.names).toContain('RCW 11');
  });

  it('keeps a star and a nebula at the same spot (different kinds)', () => {
    const star = neb({
      main_id: 'HD 50896',
      names: ['HD 50896'],
      otype: 'WR*',
      size_arcmin: undefined,
      catalog_ids: {},
      source: 'SIMBAD',
    });
    const nebula = neb({ main_id: 'Sh 2-308', names: ['Sh 2-308'] });
    const merged = mergeCandidates([[star], [nebula]]);
    expect(merged).toHaveLength(2);
  });

  it('does not merge distinct, well-separated nebulae', () => {
    const a = neb({ main_id: 'A', names: ['A'], dec_deg: -23.9 });
    const b = neb({ main_id: 'B', names: ['B'], dec_deg: -22.4 }); // ~1.5° away
    expect(mergeCandidates([[a], [b]])).toHaveLength(2);
  });

  it('keeps the brighter star when collapsing a close binary (α Sco A/B)', () => {
    const a = neb({
      main_id: '* alf Sco',
      names: ['Antares', '* alf Sco'],
      otype: 's*r',
      size_arcmin: undefined,
      mag: 0.91,
      source: 'SIMBAD',
    });
    const b = neb({
      main_id: '* alf Sco B',
      names: ['* alf Sco B'],
      otype: 'Em*',
      size_arcmin: undefined,
      mag: 5.2,
      source: 'SIMBAD',
      ra_deg: 103.5 + 0.0007, // ~2.5″ away
    });
    const merged = mergeCandidates([[b], [a]]); // faint one listed first
    expect(merged).toHaveLength(1);
    expect(merged[0]!.names).toContain('Antares');
    expect(merged[0]!.mag).toBe(0.91);
  });

  it('prefers the prestigious designation as the survivor', () => {
    const survey = neb({ main_id: 'Sh 2-308', names: ['Sh 2-308'], catalog_ids: { sharpless: 'Sh 2-308' } });
    const messier = neb({
      main_id: 'M 1',
      names: ['M 1'],
      ra_deg: 103.5405,
      dec_deg: -23.9421,
      catalog_ids: { messier: 'M1' },
    });
    const merged = mergeCandidates([[survey], [messier]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.names[0]).toBe('M 1');
  });
});
