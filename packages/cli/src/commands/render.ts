import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { Report } from '@astrolens/schema';
import { renderAnnotated } from '@astrolens/renderer';

export interface RenderArgs {
  report: string;
  format: string;
  out?: string;
}

export async function renderReport(args: RenderArgs): Promise<void> {
  if (args.format !== 'annotated') {
    throw new Error(`Only --format annotated is supported in this version (got "${args.format}")`);
  }

  const reportPath = resolve(args.report);
  const report = Report.parse(JSON.parse(await readFile(reportPath, 'utf8')));

  const reportDir = dirname(reportPath);
  const imagePath = resolve(reportDir, report.image.src);
  const outPath = args.out ? resolve(args.out) : join(reportDir, 'annotated.jpg');

  await renderAnnotated({ report, imagePath, outPath });
  console.log(`Wrote ${outPath}`);
}
