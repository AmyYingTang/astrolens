import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  detectMorphology,
  selectForOutreach,
  applyIlluminationPrior,
  DEFAULT_SELECT_PARAMS,
  type MorphFeature,
  type MorphResult,
} from './morph.js';

function feature(over: Partial<MorphFeature>): MorphFeature {
  return {
    type: 'pillar',
    centroid_px: [10, 10],
    contour_px: Array.from({ length: 12 }, (_, i) => [i, i] as [number, number]),
    length_px: 100,
    orientation_deg: 0,
    elongation: 3,
    area_px: 500,
    solidity: 0.7,
    rim_coverage_frac: 0.5,
    illumination_vector_deg: 45,
    rim_px: [],
    consistent_with_prior: null,
    confidence: 0.7,
    salience: null,
    selected_for_outreach: false,
    label_semantic: null,
    display: 'suggestion',
    ...over,
  };
}

describe('selectForOutreach', () => {
  it('keeps at most top_n, flags them, and scores salience', () => {
    // Eight features spread across the grid so the per-cell cap doesn't bind.
    const features: MorphFeature[] = Array.from({ length: 8 }, (_, i) =>
      feature({ centroid_px: [10 + i * 40, 10 + i * 40], area_px: 100 * (i + 1) }),
    );
    const res: MorphResult = { features, width: 400, height: 400, downsample: 2, footprint_frac: 0.3 };
    const picked = selectForOutreach(res, { ...DEFAULT_SELECT_PARAMS, top_n: 3 });
    expect(picked).toHaveLength(3);
    expect(picked.every((f) => f.selected_for_outreach)).toBe(true);
    expect(picked.every((f) => typeof f.salience === 'number')).toBe(true);
    // The unpicked stay unflagged.
    expect(features.filter((f) => f.selected_for_outreach)).toHaveLength(3);
  });

  it('drops features below the talkability length gate', () => {
    const features: MorphFeature[] = [
      feature({ centroid_px: [20, 20], length_px: 8, area_px: 800 }), // too short to be tellable
      feature({ centroid_px: [200, 200], length_px: 120, area_px: 800 }),
    ];
    const res: MorphResult = { features, width: 400, height: 400, downsample: 2, footprint_frac: 0.3 };
    const picked = selectForOutreach(res, { ...DEFAULT_SELECT_PARAMS, min_length_px: 30 });
    expect(picked).toHaveLength(1);
    expect(picked[0]!.length_px).toBe(120);
  });

  it('returns nothing for an empty detection set', () => {
    const res: MorphResult = { features: [], width: 100, height: 100, downsample: 2, footprint_frac: 0 };
    expect(selectForOutreach(res)).toEqual([]);
  });
});

describe('applyIlluminationPrior', () => {
  it('keeps pillars whose lit rim faces the exciting star, drops the rest', () => {
    // Centroids at grid [50,50] → full px [100,100]; star to the right ⇒ 0°.
    const toward = feature({ centroid_px: [50, 50], illumination_vector_deg: 0 });
    const away = feature({ centroid_px: [50, 50], illumination_vector_deg: 180 });
    const res: MorphResult = {
      features: [toward, away],
      width: 400,
      height: 400,
      downsample: 2,
      footprint_frac: 0.3,
    };
    const out = applyIlluminationPrior(res, [[300, 100]], 55);
    expect(out.features).toHaveLength(1);
    expect(out.features[0]!.illumination_vector_deg).toBe(0);
    expect(out.features[0]!.consistent_with_prior).toBe(true);
    expect(away.consistent_with_prior).toBe(false);
  });

  it('passes everything through when there is no exciting star (no anchor)', () => {
    const res: MorphResult = {
      features: [feature({}), feature({})],
      width: 400,
      height: 400,
      downsample: 2,
      footprint_frac: 0.3,
    };
    expect(applyIlluminationPrior(res, []).features).toHaveLength(2);
  });
});

describe('detectMorphology', () => {
  let dir: string;
  let imgPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'morph-'));
    imgPath = join(dir, 'synthetic.png');
    // A bright central "nebula" with a dark elongated column edged by a bright
    // rim — enough to exercise footprint → ridge → dark → pairing end to end.
    // Large enough that the downsampled nebula footprint clears neb_min_size.
    const w = 400;
    const h = 400;
    const buf = Buffer.alloc(w * h * 3, 8);
    const set = (x: number, y: number, v: number): void => {
      const p = (y * w + x) * 3;
      buf[p] = v;
      buf[p + 1] = v;
      buf[p + 2] = v;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if ((x - 200) ** 2 + (y - 200) ** 2 < 150 * 150) set(x, y, 160); // nebula glow
      }
    for (let y = 100; y < 300; y++) {
      for (let x = 188; x < 216; x++) set(x, y, 20); // dark column
      for (let x = 176; x < 188; x++) set(x, y, 245); // bright rim on its edge
    }
    await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(imgPath);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs end to end and returns a well-formed result', async () => {
    const res = await detectMorphology(imgPath);
    expect(res.downsample).toBe(2);
    expect(res.width).toBe(200);
    expect(res.height).toBe(200);
    expect(res.footprint_frac).toBeGreaterThan(0);
    expect(res.footprint_frac).toBeLessThanOrEqual(1);
    expect(Array.isArray(res.features)).toBe(true);
    // Whatever is detected must honour the geometry-only / suggestion contract.
    for (const f of res.features) {
      expect(f.label_semantic).toBeNull();
      expect(f.display).toBe('suggestion');
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });
});
