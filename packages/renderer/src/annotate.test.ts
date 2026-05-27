import { describe, expect, it } from 'vitest';
import type { Report } from '@astrolens/schema';
import { buildOverlaySvg } from './annotate.js';

const report = {
  version: '1.0',
  image: { src: 'image.jpg', width: 1000, height: 800 },
  language: 'zh',
  object: { name: 'Sh2-308', aliases: [], type: 'WR bubble' },
  narrative: 'test',
  features: [
    {
      id: 'f1',
      label: 'a',
      color_key: 'hot',
      circle: { cx: 500, cy: 400, r: 100 },
      badge: { num: '1', offset_x: 0, offset_y: 0, bubble_r: 30 },
      explanation: 'x',
    },
    {
      id: 'f2',
      label: 'b',
      color_key: 'shock',
      circle: { cx: 200, cy: 200, r: 50 },
      badge: { num: '2', offset_x: 10, offset_y: -10, bubble_r: 30 },
      explanation: 'y',
    },
  ],
  extra_facts: [],
  created_at: '2026-05-27T00:00:00.000Z',
  generator: { tool: 'astrolens', tool_version: '0.1.0', llm: 'claude' },
} satisfies Report;

describe('buildOverlaySvg', () => {
  it('sizes the svg to the image', () => {
    const svg = buildOverlaySvg(report);
    expect(svg).toContain('width="1000" height="800"');
    expect(svg).toContain('viewBox="0 0 1000 800"');
  });

  it('draws an outline circle + badge bubble + number per feature', () => {
    const svg = buildOverlaySvg(report);
    // 2 outline circles + 2 badge bubbles = 4 <circle>, 2 <text>
    expect(svg.match(/<circle/g)).toHaveLength(4);
    expect(svg.match(/<text/g)).toHaveLength(2);
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('>2</text>');
  });

  it('colors strokes from the palette', () => {
    const svg = buildOverlaySvg(report);
    expect(svg).toContain('stroke="#ffd84a"'); // hot
    expect(svg).toContain('stroke="#4ec3e0"'); // shock
  });

  it('matches snapshot', () => {
    expect(buildOverlaySvg(report)).toMatchSnapshot();
  });
});
