import { describe, expect, it } from 'vitest';
import { Report, COLOR_PALETTE, ColorKey } from './index.js';

const validReport = {
  version: '1.0',
  image: { src: 'image.jpg', width: 4144, height: 2822 },
  object: { name: 'Sh2-308', type: 'WR bubble' },
  narrative: '一个由沃尔夫-拉叶星吹出的蓝色气泡。',
  features: [
    {
      id: 'f1',
      label: '中央 WR 星',
      color_key: 'hot',
      circle: { cx: 100, cy: 200, r: 50 },
      badge: { num: '1' },
      explanation: '这是一颗即将爆发的大质量恒星。',
    },
  ],
  created_at: '2026-05-27T00:00:00.000Z',
  generator: { tool: 'astrolens', tool_version: '0.1.0', llm: 'claude-opus-4-x' },
};

describe('Report schema', () => {
  it('parses a valid report and applies defaults', () => {
    const parsed = Report.parse(validReport);
    expect(parsed.language).toBe('zh');
    expect(parsed.object.aliases).toEqual([]);
    expect(parsed.extra_facts).toEqual([]);
    expect(parsed.features[0]!.badge.offset_x).toBe(0);
    expect(parsed.features[0]!.badge.bubble_r).toBe(30);
  });

  it('round-trips through JSON without loss', () => {
    const parsed = Report.parse(validReport);
    const reparsed = Report.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it('rejects an unknown color_key', () => {
    const bad = structuredClone(validReport);
    bad.features[0]!.color_key = 'rainbow';
    expect(() => Report.parse(bad)).toThrow();
  });

  it('rejects a stage outside 1-7', () => {
    const bad = structuredClone(validReport) as typeof validReport & {
      object: { stage?: number };
    };
    bad.object.stage = 9;
    expect(() => Report.parse(bad)).toThrow();
  });

  it('rejects a wrong version literal', () => {
    const bad = structuredClone(validReport) as typeof validReport & { version: string };
    bad.version = '2.0';
    expect(() => Report.parse(bad)).toThrow();
  });
});

describe('color palette', () => {
  it('has an entry for every color key', () => {
    for (const key of ColorKey.options) {
      expect(COLOR_PALETTE[key]).toBeDefined();
      expect(COLOR_PALETTE[key].stroke).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
