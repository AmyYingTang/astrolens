import { describe, it, expect } from 'vitest';
import { detectComet } from './comet.js';
import type { ImageRaster } from './luminance.js';

const W = 200;
const H = 150;

/** Build a synthetic raster from a luminance + rgb function over the grid. */
function raster(
  lum: (gx: number, gy: number) => number,
  rgb?: (gx: number, gy: number) => [number, number, number],
): ImageRaster {
  const L = (gx: number, gy: number): number =>
    gx < 0 || gy < 0 || gx >= W || gy >= H ? 0 : lum(gx, gy);
  return {
    gw: W,
    gh: H,
    fullW: W * 4,
    fullH: H * 4,
    lum: L,
    rgb: rgb ?? ((gx, gy) => [L(gx, gy), L(gx, gy), L(gx, gy)]),
    toGrid: (x, y) => [Math.floor((x / (W * 4)) * W), Math.floor((y / (H * 4)) * H)],
    toFull: (gx, gy) => [((gx + 0.5) / W) * (W * 4), ((gy + 0.5) / H) * (H * 4)],
  };
}

// A bright compact coma at (60,75) + a faint blue tail extending toward +x.
const cometLum = (gx: number, gy: number): number => {
  const dc = Math.hypot(gx - 60, gy - 75);
  if (dc < 8) return 240 - dc * 8; // bright coma
  if (gx > 68 && gx < 160 && Math.abs(gy - 75) < 3) return 48; // faint tail
  return 20; // background
};
const cometRgb = (gx: number, gy: number): [number, number, number] => {
  if (gx > 68 && gx < 160 && Math.abs(gy - 75) < 3) return [20, 30, 80]; // blue tail (ion)
  const l = cometLum(gx, gy);
  return [l, l, l];
};

describe('detectComet', () => {
  it('detects head + tail and classifies a blue tail as ion', () => {
    const res = detectComet(raster(cometLum, cometRgb), undefined, 2);
    expect(res).toBeTruthy();
    // nucleus near grid (60,75) → full pixel ≈ (242, 302)
    expect(res!.nucleusPixel[0]).toBeGreaterThan(220);
    expect(res!.nucleusPixel[0]).toBeLessThan(260);
    expect(res!.tails.length).toBeGreaterThanOrEqual(1);
    expect(res!.tails[0]!.kind).toBe('ion');
    // tail tip is to the +x side of the nucleus
    expect(res!.tails[0]!.tipPixel[0]).toBeGreaterThan(res!.nucleusPixel[0]);
  });

  it('returns null for a bright blob with no tail (a galaxy/cluster)', () => {
    const blob = (gx: number, gy: number): number => {
      const d = Math.hypot(gx - 100, gy - 75);
      return d < 8 ? 240 - d * 8 : 20;
    };
    expect(detectComet(raster(blob), undefined, 2)).toBeNull();
  });

  it('returns null for a uniform bright field (a nebula)', () => {
    expect(detectComet(raster(() => 120), undefined, 2)).toBeNull();
  });
});
