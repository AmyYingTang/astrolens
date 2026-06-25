import sharp from 'sharp';

/** Returns mean luminance (0–255) at an ORIGINAL-image pixel, NaN if off-frame. */
export type LuminanceSampler = (x: number, y: number) => number;

/**
 * Build a fast luminance sampler from an image: greyscale + downsampled to a
 * small grid so per-pixel lookups are cheap. Used to verify that a derived
 * Class-B marker actually lands on the bright structure (not empty sky).
 */
export async function createLuminanceSampler(
  imagePath: string,
  fullW: number,
  fullH: number,
  maxDim = 1024,
): Promise<LuminanceSampler> {
  const scale = Math.min(1, maxDim / Math.max(fullW, fullH));
  const w = Math.max(1, Math.round(fullW * scale));
  const h = Math.max(1, Math.round(fullH * scale));
  const { data, info } = await sharp(imagePath)
    .greyscale()
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const gw = info.width;
  const gh = info.height;
  return (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= fullW || y >= fullH) return NaN;
    const dx = Math.min(gw - 1, Math.floor((x / fullW) * gw));
    const dy = Math.min(gh - 1, Math.floor((y / fullH) * gh));
    return data[(dy * gw + dx) * ch] ?? NaN;
  };
}

/** Median luminance in a window around (x,y). Median (not mean) is robust to a
 * few bright point stars — it reflects the diffuse background/structure. */
export function sampleMedian(s: LuminanceSampler, x: number, y: number, win: number): number {
  const vals: number[] = [];
  const step = win / 3;
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      const v = s(x + i * step, y + j * step);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  if (!vals.length) return NaN;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)]!;
}

/**
 * A coarse downsampled RGB raster with direct grid access + coordinate mapping —
 * for image-morphology detectors (the comet detector) that scan/trace the whole
 * frame (find the brightest extended blob, follow a tail), which a point sampler
 * can't do. Colour is kept so dust (yellow) vs ion (blue) tails can be told apart.
 */
export interface ImageRaster {
  gw: number;
  gh: number;
  fullW: number;
  fullH: number;
  /** Luminance 0–255 at a grid cell. */
  lum(gx: number, gy: number): number;
  /** [r,g,b] 0–255 at a grid cell. */
  rgb(gx: number, gy: number): [number, number, number];
  /** Full-image pixel → grid cell. */
  toGrid(x: number, y: number): [number, number];
  /** Grid cell → full-image pixel (cell centre). */
  toFull(gx: number, gy: number): [number, number];
}

export async function createImageRaster(
  imagePath: string,
  fullW: number,
  fullH: number,
  maxDim = 400,
): Promise<ImageRaster> {
  const scale = Math.min(1, maxDim / Math.max(fullW, fullH));
  const w = Math.max(1, Math.round(fullW * scale));
  const h = Math.max(1, Math.round(fullH * scale));
  const { data, info } = await sharp(imagePath)
    .removeAlpha()
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const gw = info.width;
  const gh = info.height;
  const clampG = (v: number, hi: number): number => Math.min(hi - 1, Math.max(0, v));
  const rgb = (gx: number, gy: number): [number, number, number] => {
    const i = (clampG(gy, gh) * gw + clampG(gx, gw)) * ch;
    const r = data[i] ?? 0;
    return [r, ch > 1 ? (data[i + 1] ?? r) : r, ch > 2 ? (data[i + 2] ?? r) : r];
  };
  return {
    gw,
    gh,
    fullW,
    fullH,
    rgb,
    lum: (gx, gy) => {
      const [r, g, b] = rgb(gx, gy);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    },
    toGrid: (x, y) => [clampG(Math.floor((x / fullW) * gw), gw), clampG(Math.floor((y / fullH) * gh), gh)],
    toFull: (gx, gy) => [((gx + 0.5) / gw) * fullW, ((gy + 0.5) / gh) * fullH],
  };
}

/** Field background luminance — median over a coarse grid across the frame. */
export function estimateBackground(s: LuminanceSampler, w: number, h: number): number {
  const vals: number[] = [];
  const N = 24;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const v = s((i / N) * w, (j / N) * h);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  if (!vals.length) return NaN;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)]!;
}
