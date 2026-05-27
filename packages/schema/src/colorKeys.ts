import type { ColorKey } from './index.js';

export interface PaletteEntry {
  stroke: string;
  badge: string;
}

/**
 * The 9 color keys map to a consistent palette across all renderings.
 * Defined here once, consumed by renderer (and later viewer).
 */
export const COLOR_PALETTE: Record<ColorKey, PaletteEntry> = {
  hot: { stroke: '#ffd84a', badge: '#ffd84a' }, // gold
  star: { stroke: '#ffb84a', badge: '#ffb84a' }, // orange
  front: { stroke: '#ff8a65', badge: '#ff8a65' }, // coral
  shock: { stroke: '#4ec3e0', badge: '#4ec3e0' }, // cyan
  shell: { stroke: '#c5cbdb', badge: '#c5cbdb' }, // light grey
  cavity: { stroke: '#d3d3e8', badge: '#d3d3e8' }, // pale lavender
  pillar: { stroke: '#bb9af7', badge: '#bb9af7' }, // purple
  dark: { stroke: '#9aa5b8', badge: '#9aa5b8' }, // grey
  bg: { stroke: '#7dcfa6', badge: '#7dcfa6' }, // mint
};
