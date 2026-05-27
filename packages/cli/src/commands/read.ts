import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import sharp from 'sharp';
import { generateReport, ReaderError } from '@astrolens/reader';
import { TOOL_VERSION } from '../version.js';

export interface ReadArgs {
  image: string;
  hint?: string;
  lang: string;
  out: string;
  model?: string;
  simbad: boolean;
}

export async function readReport(args: ReadArgs): Promise<void> {
  const lang = args.lang === 'en' ? 'en' : 'zh';
  const imagePath = resolve(args.image);

  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read image dimensions: ${imagePath}`);
  }

  const outDir = resolve(args.out);
  await mkdir(outDir, { recursive: true });
  const imageName = `image${(extname(imagePath) || '.jpg').toLowerCase()}`;

  try {
    const report = await generateReport({
      imagePath,
      width: meta.width,
      height: meta.height,
      hint: args.hint,
      lang,
      toolVersion: TOOL_VERSION,
      model: args.model,
      imageSrc: imageName,
      simbad: args.simbad,
    });

    await copyFile(imagePath, join(outDir, imageName));
    const reportPath = join(outDir, 'report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

    console.log(`Wrote ${reportPath}`);
    console.log(`Wrote ${join(outDir, imageName)}`);
    console.log(`Identified: ${report.object.name} (${report.object.type})`);
  } catch (err) {
    if (err instanceof ReaderError && err.raw) {
      const rawPath = join(outDir, 'raw_llm_output.txt');
      await writeFile(rawPath, err.raw, 'utf8');
      throw new Error(`${err.message}\nRaw claude output saved to ${rawPath}`);
    }
    throw err;
  }
}
