import sharp from 'sharp';
import { COLOR_PALETTE, type Report } from '@astrolens/schema';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the SVG overlay (circles + numbered badges) for a report. */
export function buildOverlaySvg(report: Report): string {
  const { width, height } = report.image;
  const strokeW = Math.max(2, Math.round(Math.min(width, height) / 500));
  const parts: string[] = [];

  for (const f of report.features) {
    const color = COLOR_PALETTE[f.color_key];
    const { cx, cy, r } = f.circle;
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color.stroke}" stroke-width="${strokeW}"/>`,
    );

    // Badge anchored just outside the circle's upper-right, then offset.
    const bx = cx + r * 0.7071 + f.badge.offset_x;
    const by = cy - r * 0.7071 + f.badge.offset_y;
    const br = f.badge.bubble_r;
    const fontSize = Math.round(br * 1.1);
    parts.push(
      `<circle cx="${bx}" cy="${by}" r="${br}" fill="${color.badge}" stroke="#0b0e14" stroke-width="${Math.max(1, Math.round(strokeW / 2))}"/>`,
    );
    parts.push(
      `<text x="${bx}" y="${by}" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#0b0e14" text-anchor="middle" dominant-baseline="central">${escapeXml(f.badge.num)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

type ImageFormat = 'jpeg' | 'png';

function annotatedPipeline(
  imagePath: string,
  svgOverlay: string,
  format: ImageFormat,
  quality: number,
): sharp.Sharp {
  const pipeline = sharp(imagePath).composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }]);
  return format === 'png' ? pipeline.png() : pipeline.jpeg({ quality });
}

export interface RenderAnnotatedOptions {
  report: Report;
  imagePath: string; // absolute path to the source image
  outPath: string; // absolute output path (.jpg/.jpeg or .png)
  quality?: number; // JPEG quality, default 92
}

/** Composite the overlay onto the source image and write annotated output. */
export async function renderAnnotated(opts: RenderAnnotatedOptions): Promise<void> {
  const format: ImageFormat = opts.outPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  await annotatedPipeline(opts.imagePath, buildOverlaySvg(opts.report), format, opts.quality ?? 92).toFile(
    opts.outPath,
  );
}

export interface RenderAnnotatedBufferOptions {
  report: Report;
  imagePath: string;
  format?: ImageFormat; // default jpeg
  quality?: number;
}

/** Same as renderAnnotated but returns the encoded image bytes instead of writing. */
export async function renderAnnotatedBuffer(opts: RenderAnnotatedBufferOptions): Promise<Buffer> {
  return annotatedPipeline(
    opts.imagePath,
    buildOverlaySvg(opts.report),
    opts.format ?? 'jpeg',
    opts.quality ?? 92,
  ).toBuffer();
}
