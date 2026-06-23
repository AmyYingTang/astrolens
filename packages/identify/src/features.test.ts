import { describe, it, expect } from 'vitest';
import { deriveBClassFeatures, type DerivableObject } from './features.js';

const obj = (over: Partial<DerivableObject>): DerivableObject => ({
  id: 'x',
  category: 'star',
  type: { otype: '*', zh: '恒星', en: 'Star' },
  coord: { ra_deg: 103.54, dec_deg: -23.94, pixel: [100, 100] },
  names: [],
  ...over,
});

describe('deriveBClassFeatures', () => {
  it('derives a wind-blown shell for a WR star inside an emission nebula', () => {
    const nebula = obj({
      id: 'obj1',
      category: 'emission_nebula',
      type: { otype: 'HII', zh: '发射星云', en: 'Emission nebula' },
      coord: { ra_deg: 103.54, dec_deg: -23.94, pixel: [3000, 1400] },
      size_arcmin: [60, 60],
      names: ['Sh 2-308'],
    });
    const wr = obj({
      id: 'obj2',
      category: 'star',
      type: { otype: 'WR*', zh: '沃尔夫–拉叶星', en: 'Wolf–Rayet star' },
      coord: { ra_deg: 103.554, dec_deg: -23.928, pixel: [3010, 1390] },
      names: ['HD 50896'],
    });
    const feats = deriveBClassFeatures([nebula, wr]);
    const shell = feats.find((f) => f.feature_type === 'bubble_shell');
    expect(shell).toBeTruthy();
    expect(shell!.tier).toBe('B');
    expect(shell!.parent_object_id).toBe('obj1');
    expect(shell!.localization.anchor_ref).toBe('obj2');
    expect(shell!.needs_human_review).toBe(true);
  });

  it('derives an ionization front for a dark cloud in an HII region with a WR star', () => {
    const nebula = obj({
      id: 'obj1',
      category: 'emission_nebula',
      type: { otype: 'HII', zh: '发射星云', en: 'Emission nebula' },
      size_arcmin: [60, 60],
      names: ['Sh 2-308'],
    });
    const wr = obj({
      id: 'obj2',
      category: 'star',
      type: { otype: 'WR*', zh: '沃尔夫–拉叶星', en: 'WR star' },
      coord: { ra_deg: 103.56, dec_deg: -23.92, pixel: [3010, 1390] },
      names: ['HD 50896'],
    });
    const cloud = obj({
      id: 'obj3',
      category: 'dark_nebula',
      type: { otype: 'MoC', zh: '暗星云', en: 'Dark nebula' },
      coord: { ra_deg: 103.52, dec_deg: -23.95, pixel: [2980, 1420] },
      size_arcmin: [10, 10],
      names: [],
    });
    const front = deriveBClassFeatures([nebula, wr, cloud]).find(
      (f) => f.feature_type === 'ionization_front',
    );
    expect(front).toBeTruthy();
    expect(front!.parent_object_id).toBe('obj3');
    expect(front!.localization.direction).toMatch(/bright rim faces/);
  });

  it('emits nothing without an exciting star', () => {
    const nebula = obj({
      id: 'obj1',
      category: 'emission_nebula',
      type: { otype: 'HII', zh: '发射星云', en: 'Emission nebula' },
      size_arcmin: [60, 60],
    });
    expect(deriveBClassFeatures([nebula])).toEqual([]);
  });
});
