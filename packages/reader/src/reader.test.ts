import { describe, expect, it, vi } from 'vitest';
import { extractJson, parseReading } from './parseJson.js';
import { parseSimbadAscii } from './simbad.js';
import { generateReport, ReaderError } from './index.js';

const readingJson = JSON.stringify({
  language: 'zh',
  object: { name: 'Sh2-308', type: 'WR bubble' },
  narrative: '一个蓝色气泡。',
  features: [
    {
      id: 'f1',
      label: '中央 WR 星',
      color_key: 'hot',
      circle: { cx: 100, cy: 100, r: 40 },
      badge: { num: '1' },
      explanation: '一颗大质量恒星。',
    },
  ],
});

describe('extractJson', () => {
  it('unwraps a ```json fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('strips a prose preamble', () => {
    expect(extractJson('Here is the JSON:\n{"a":1}\nThanks!')).toBe('{"a":1}');
  });
});

describe('parseReading', () => {
  it('accepts a valid reading', () => {
    const r = parseReading(readingJson);
    expect(r.ok).toBe(true);
  });
  it('rejects an invalid color_key', () => {
    const r = parseReading(readingJson.replace('"hot"', '"rainbow"'));
    expect(r.ok).toBe(false);
  });
});

describe('parseSimbadAscii', () => {
  it('extracts angular size and distance', () => {
    const sample = [
      'Object Sh 2-308  ---  HII (ionized) region',
      'Angular size: 40.0 40.0 0 (Opt) D ~',
      'Distance results: 1.5 kpc (statistical)',
    ].join('\n');
    const facts = parseSimbadAscii(sample);
    expect(facts.size_arcmin).toBe(40);
    expect(facts.distance_ly).toBe(Math.round(1.5 * 1000 * 3.26156));
  });
  it('returns empty when nothing matches', () => {
    expect(parseSimbadAscii('no useful data here')).toEqual({});
  });
});

describe('generateReport', () => {
  const base = {
    imagePath: '/abs/image.jpg',
    width: 800,
    height: 600,
    lang: 'zh' as const,
    toolVersion: '0.1.0',
    simbad: false,
  };

  it('assembles a full Report and fills tool-owned fields', async () => {
    const runner = vi.fn().mockResolvedValue(readingJson);
    const report = await generateReport({ ...base, runner });
    expect(report.version).toBe('1.0');
    expect(report.image).toEqual({ src: 'image.jpg', width: 800, height: 600 });
    expect(report.generator.tool).toBe('astrolens');
    expect(report.object.name).toBe('Sh2-308');
    expect(runner).toHaveBeenCalledOnce();
  });

  it('retries once on unparseable output then succeeds', async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce('sorry, here is no json')
      .mockResolvedValueOnce(readingJson);
    const report = await generateReport({ ...base, runner });
    expect(report.object.name).toBe('Sh2-308');
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('throws ReaderError with raw output after a failed retry', async () => {
    const runner = vi.fn().mockResolvedValue('never json');
    await expect(generateReport({ ...base, runner })).rejects.toMatchObject({
      name: 'ReaderError',
      raw: 'never json',
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('enriches empty object facts from SIMBAD', async () => {
    const runner = vi.fn().mockResolvedValue(readingJson);
    const simbadLookup = vi.fn().mockResolvedValue({ distance_ly: 5000, size_arcmin: 40 });
    const report = await generateReport({ ...base, simbad: true, runner, simbadLookup });
    expect(report.object.distance_ly).toBe(5000);
    expect(report.object.size_arcmin).toBe(40);
  });
});

it('ReaderError carries raw', () => {
  expect(new ReaderError('x', 'raw').raw).toBe('raw');
});
