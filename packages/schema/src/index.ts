import { z } from 'zod';

export const ColorKey = z.enum([
  // Hot stars / ionizing sources
  'hot', // bright stars, WR, OB
  'star', // generic star/cluster
  // Front matter
  'front', // ionization front
  'shock', // shock wave (SNR)
  'shell', // bubble shell
  // Inner structure
  'cavity', // central cavity
  'pillar', // pillar / evaporating gas
  // Surroundings
  'dark', // dark cloud / dust band
  'bg', // untouched background / molecular cloud
]);
export type ColorKey = z.infer<typeof ColorKey>;

export const Circle = z.object({
  cx: z.number(),
  cy: z.number(),
  r: z.number(),
});
export type Circle = z.infer<typeof Circle>;

export const Badge = z.object({
  num: z.string(), // "1", "2", "①" etc
  offset_x: z.number().default(0),
  offset_y: z.number().default(0),
  bubble_r: z.number().default(30),
});
export type Badge = z.infer<typeof Badge>;

export const Feature = z.object({
  id: z.string(), // stable id, used for editor sync
  label: z.string(), // short name e.g. "中央 WR 星 EZ CMa"
  color_key: ColorKey,
  circle: Circle,
  badge: Badge,
  explanation: z.string(), // 2-3 sentences, plain language
  physics: z.string().optional(), // mechanism / formation
  interesting: z.string().optional(), // trivia, cross-references
});
export type Feature = z.infer<typeof Feature>;

export const ObjectInfo = z.object({
  name: z.string(), // primary identifier
  aliases: z.array(z.string()).default([]),
  type: z.string(), // "WR bubble", "Dark nebula" etc
  stage: z.number().min(1).max(7).optional(), // Amy's lifecycle 1-7
  distance_ly: z.number().optional(),
  size_arcmin: z.number().optional(),
  constellation: z.string().optional(),
});
export type ObjectInfo = z.infer<typeof ObjectInfo>;

export const Report = z.object({
  version: z.literal('1.0'),
  image: z.object({
    src: z.string(), // relative path, e.g. "image.jpg"
    width: z.number(),
    height: z.number(),
  }),
  language: z.enum(['zh', 'en']).default('zh'),
  object: ObjectInfo,
  narrative: z.string(), // overall intro paragraph
  features: z.array(Feature),
  extra_facts: z.array(z.string()).default([]),
  created_at: z.string().datetime(),
  edited_at: z.string().datetime().optional(),
  generator: z.object({
    tool: z.literal('astrolens'),
    tool_version: z.string(),
    llm: z.string(), // "claude-sonnet-4-x" etc
  }),
});
export type Report = z.infer<typeof Report>;

export const SCHEMA_VERSION = '1.0' as const;

export { COLOR_PALETTE } from './colorKeys.js';
export type { PaletteEntry } from './colorKeys.js';
