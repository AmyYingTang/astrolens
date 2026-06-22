import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FactSheet,
  FeatureType,
  FeatureClass,
  ColorKey,
  COLOR_PALETTE,
  FEATURE_TAXONOMY,
  featureColorKey,
} from './index.js';

const example = JSON.parse(
  readFileSync(new URL('../fixtures/factsheet.example.json', import.meta.url), 'utf8'),
);

describe('FactSheet schema', () => {
  it('parses the example fixture', () => {
    const fs = FactSheet.parse(example);
    expect(fs.objects[0]!.names).toContain('M42');
    expect(fs.objects[0]!.features[0]!.feature_type).toBe('embedded_cluster');
    expect(fs.solve.frame).toBe('display');
  });

  it('round-trips through JSON without loss', () => {
    const parsed = FactSheet.parse(example);
    const reparsed = FactSheet.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it('applies defaults for optional fields', () => {
    const bare = structuredClone(example);
    delete bare.warnings;
    delete bare.objects[0].catalog_ids;
    delete bare.objects[0].features[0].localization.pixel;
    const fs = FactSheet.parse(bare);
    expect(fs.warnings).toEqual([]);
    expect(fs.objects[0]!.catalog_ids).toEqual({});
    expect(fs.objects[0]!.features[0]!.localization.pixel).toBeNull();
  });

  it('rejects an unknown feature_type', () => {
    const bad = structuredClone(example);
    bad.objects[0].features[0].feature_type = 'not_a_feature';
    expect(() => FactSheet.parse(bad)).toThrow();
  });

  it('rejects a bad solve status', () => {
    const bad = structuredClone(example);
    bad.solve.status = 'maybe';
    expect(() => FactSheet.parse(bad)).toThrow();
  });

  it('rejects confidence outside 0–1', () => {
    const bad = structuredClone(example);
    bad.objects[0].confidence = 1.5;
    expect(() => FactSheet.parse(bad)).toThrow();
  });
});

describe('feature taxonomy', () => {
  it('FeatureType enum exactly matches registry keys', () => {
    expect([...FeatureType.options].sort()).toEqual(Object.keys(FEATURE_TAXONOMY).sort());
  });

  it('every default_color_key is a valid palette key', () => {
    for (const ft of FeatureType.options) {
      const ck = featureColorKey(ft);
      expect(ColorKey.options).toContain(ck);
      expect(COLOR_PALETTE[ck]).toBeDefined();
    }
  });

  it('every default_class is a valid FeatureClass', () => {
    for (const ft of FeatureType.options) {
      expect(FeatureClass.options).toContain(FEATURE_TAXONOMY[ft].default_class);
    }
  });
});
