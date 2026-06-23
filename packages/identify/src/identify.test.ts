import { describe, expect, it } from 'vitest';
import { identify } from './identify.js';
import { pixelToWorld } from './wcs.js';
import type { SolveClient, CatalogClient, CatalogCandidate, Wcs } from './index.js';

const wcs: Wcs = {
  ra0_deg: 246.1878,
  dec0_deg: -26.2672,
  crpix_x: 2000,
  crpix_y: 1500,
  scale_deg: 2.33 / 3600,
  orientation_deg: 171.3,
  parity: 1,
  width: 4000,
  height: 3000,
};

/** Build a candidate that projects to a given pixel via the inverse WCS. */
function at(x: number, y: number, over: Partial<CatalogCandidate>): CatalogCandidate {
  const [ra, dec] = pixelToWorld(wcs, x, y);
  return {
    main_id: 'X',
    names: [],
    otype: 'GlC',
    ra_deg: ra,
    dec_deg: dec,
    catalog_ids: {},
    source: 'SIMBAD',
    ...over,
  };
}

const solved: SolveClient = { solve: async () => ({ status: 'solved', wcs, nova_job_id: 'job1' }) };
const failed: SolveClient = { solve: async () => ({ status: 'failed', error: 'login rejected' }) };

const candidates: CatalogCandidate[] = [
  at(2000, 1500, { main_id: 'M 4', names: ['M 4'], otype: 'GlC', size_arcmin: [26, 26], catalog_ids: { messier: 'M4' } }),
  at(1200, 1000, { main_id: 'NGC 6144', names: ['NGC 6144'], otype: 'GlC', size_arcmin: [9, 9], catalog_ids: { ngc: 'NGC 6144' } }),
  at(3000, 2000, { main_id: '* alf Sco', names: ['Antares', '* alf Sco'], otype: 's*r', mag: 0.9 }), // bright star → kept
  at(2500, 1800, { main_id: 'faint star', otype: '*', mag: 8.5 }), // mag > 4 → dropped
  at(1500, 1200, { main_id: 'big cloud', otype: 'MoC', size_arcmin: [13, 13] }), // ≥8' nebula → kept (no prestige)
  at(1800, 900, { main_id: 'tiny dark', otype: 'DNe', size_arcmin: [3, 3] }), // < 8' → dropped
  at(900, 2400, { main_id: 'faint gal', otype: 'G', size_arcmin: [0.5, 0.4] }), // no prestige → dropped
  at(700, 600, { main_id: 'radio src', otype: 'Rad' }), // non-optical → dropped
  at(500000, 500000, { main_id: 'off frame', otype: 'GlC', catalog_ids: { ngc: 'NGC 9999' } }), // out of frame
];

const catalog: CatalogClient = { region: async () => candidates };

const baseInput = {
  imagePath: '/tmp/x.jpg',
  width: 4000,
  height: 3000,
  hash: 'sha256:test',
  imageSrc: 'image.jpg',
};

describe('identify (solved path, prominence selection)', () => {
  it('keeps the prominent main bodies + structures, drops the rest', async () => {
    const fs = await identify(baseInput, { solve: solved, catalog });
    const ids = fs.objects.map((o) => o.names[0]);
    expect(ids).toContain('M 4');
    expect(ids).toContain('NGC 6144');
    expect(ids).toContain('Antares'); // bright star kept
    expect(ids).toContain('big cloud'); // large cloud kept
    // dropped:
    expect(ids).not.toContain('faint star');
    expect(ids).not.toContain('tiny dark');
    expect(ids).not.toContain('faint gal');
    expect(ids.join(' ')).not.toContain('radio');
    expect(fs.objects.some((o) => o.catalog_ids.ngc === 'NGC 9999')).toBe(false);
  });

  it('ranks the Messier globular as primary and classifies the star', async () => {
    const fs = await identify(baseInput, { solve: solved, catalog });
    expect(fs.objects[0]!.names[0]).toBe('M 4');
    expect(fs.objects[0]!.role).toBe('primary');
    const antares = fs.objects.find((o) => o.names[0] === 'Antares')!;
    expect(antares.category).toBe('star');
    expect(antares.coord.pixel![0]).toBeCloseTo(3000, 2);
    expect(antares.tier).toBe('A'); // catalog-grounded; no Class-B in the wide-field MVP
    expect(antares.parent_object_id).toBeNull();
  });

  it('warns when nothing prominent is found', async () => {
    const empty: CatalogClient = { region: async () => [] };
    const fs = await identify(baseInput, { solve: solved, catalog: empty });
    expect(fs.objects).toEqual([]);
    expect(fs.warnings.length).toBeGreaterThan(0);
  });
});

describe('identify (fallback paths — never fabricate)', () => {
  it('fails honestly and surfaces the solve reason', async () => {
    const fs = await identify(baseInput, { solve: failed, catalog });
    expect(fs.solve.status).toBe('failed');
    expect(fs.objects).toEqual([]);
    expect(fs.warnings.join(' ')).toContain('login rejected');
  });

  it('marks user_provided when a target name is given but unsolved', async () => {
    const fs = await identify({ ...baseInput, targetName: 'M4' }, { solve: failed, catalog });
    expect(fs.solve.status).toBe('user_provided');
    expect(fs.objects).toEqual([]);
  });
});
