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
