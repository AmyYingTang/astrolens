import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join, extname } from 'node:path';
import { Report } from '@astrolens/schema';
import { renderAnnotated, generateEmbedHtml, renderPoster } from '@astrolens/renderer';

const FORMATS = ['annotated', 'embed', 'poster', 'all'] as const;
type Format = (typeof FORMATS)[number];

export interface RenderArgs {
  report: string;
  format: string;
  out?: string;
}

async function imageToDataUri(path: string): Promise<string> {
  const mime = extname(path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const buf = await readFile(path);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function renderReport(args: RenderArgs): Promise<void> {
  if (!FORMATS.includes(args.format as Format)) {
    throw new Error(`Unknown --format "${args.format}" (expected: ${FORMATS.join(' | ')})`);
  }
  const fmt = args.format as Format;
  const want = (f: Format): boolean => fmt === 'all' || fmt === f;

  const reportPath = resolve(args.report);
  const report = Report.parse(JSON.parse(await readFile(reportPath, 'utf8')));
  const reportDir = dirname(reportPath);
  const imagePath = resolve(reportDir, report.image.src);
  const outDir = args.out ? resolve(args.out) : reportDir;
  await mkdir(outDir, { recursive: true });

  const written: string[] = [];

  if (want('annotated')) {
    const out = join(outDir, 'annotated.jpg');
    await renderAnnotated({ report, imagePath, outPath: out });
    written.push(out);
  }

  const dataUri = want('embed') || want('poster') ? await imageToDataUri(imagePath) : '';

  if (want('embed')) {
    const out = join(outDir, 'embed.html');
    await writeFile(out, generateEmbedHtml(report, { imageDataUri: dataUri }), 'utf8');
    written.push(out);
  }

  if (want('poster')) {
    written.push(...(await renderPoster({ report, imageDataUri: dataUri, outDir })));
  }

  for (const w of written) console.log(`Wrote ${w}`);
}
