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
