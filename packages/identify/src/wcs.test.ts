import { describe, expect, it } from 'vitest';
import { worldToPixel, pixelToWorld, fieldRadiusDeg } from './wcs.js';
import type { Wcs } from './types.js';

const wcs: Wcs = {
  ra0_deg: 83.82,
  dec0_deg: -5.39,
  crpix_x: 3000,
  crpix_y: 2000,
  scale_deg: 1.8 / 3600,
  orientation_deg: 30,
  parity: -1,
  width: 6000,
  height: 4000,
};

describe('wcs projection', () => {
  it('maps the center sky coordinate to the reference pixel', () => {
    const p = worldToPixel(wcs, wcs.ra0_deg, wcs.dec0_deg)!;
    expect(p[0]).toBeCloseTo(3000, 6);
    expect(p[1]).toBeCloseTo(2000, 6);
  });

  it('round-trips pixel → world → pixel', () => {
    for (const [x, y] of [
      [100, 100],
      [5900, 3900],
      [3000, 2000],
      [4200, 1500],
    ]) {
      const [ra, dec] = pixelToWorld(wcs, x!, y!);
      const p = worldToPixel(wcs, ra, dec)!;
      expect(p[0]).toBeCloseTo(x!, 4);
      expect(p[1]).toBeCloseTo(y!, 4);
    }
  });

  it('round-trips for both parities and a flipped orientation', () => {
    const flipped: Wcs = { ...wcs, parity: 1, orientation_deg: -110 };
    const [ra, dec] = pixelToWorld(flipped, 1234, 2345);
    const p = worldToPixel(flipped, ra, dec)!;
    expect(p[0]).toBeCloseTo(1234, 4);
    expect(p[1]).toBeCloseTo(2345, 4);
  });

  it('returns null for a point behind the tangent plane', () => {
    expect(worldToPixel(wcs, wcs.ra0_deg + 180, -wcs.dec0_deg)).toBeNull();
  });

  it('reports a positive field radius', () => {
    expect(fieldRadiusDeg(wcs)).toBeGreaterThan(0);
  });
});
