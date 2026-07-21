import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import sharp from 'sharp';
import {
  identify,
  createNovaSolveClient,
  createCachedSolveClient,
  createSimbadCatalogClient,
  defaultRegistryPath,
} from '@astrolens/identify';
import { generateReading, ReaderError } from '@astrolens/reader';
import { TOOL_VERSION } from '../version.js';

export interface ReadArgs {
  image: string;
  hint?: string;
  lang: string;
  out: string;
  model?: string;
  style?: string;
  apiKey?: string;
  cache?: boolean;
}

/** Full pipeline: Stage 1 identify → factsheet.json, then Stage 2 reader → reading.json. */
export async function readReport(args: ReadArgs): Promise<void> {
  const lang = args.lang === 'en' ? 'en' : 'zh';
  const apiKey = args.apiKey ?? process.env.ASTROMETRY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No nova API key. Put ASTROMETRY_API_KEY in a .env file (cwd), export it, or pass --api-key. Free key from nova.astrometry.net.',
    );
  }

  const imagePath = resolve(args.image);
  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) throw new Error(`Could not read image dimensions: ${imagePath}`);

  const outDir = resolve(args.out);
  await mkdir(outDir, { recursive: true });
  const imageName = `image${(extname(imagePath) || '.jpg').toLowerCase()}`;

  const nova = createNovaSolveClient({ apiKey });
  const solve = args.cache === false ? nova : createCachedSolveClient(nova);

  console.log('Plate-solving (nova — this can take 30s to a few minutes; cached after the first solve)…');
  const factsheet = await identify(
    {
      imagePath,
      width: meta.width,
      height: meta.height,
      imageSrc: imageName,
      targetName: args.hint,
      registryPath: defaultRegistryPath(),
    },
    { solve, catalog: createSimbadCatalogClient() },
  );

  await copyFile(imagePath, join(outDir, imageName));
  const factsheetPath = join(outDir, 'factsheet.json');
  await writeFile(factsheetPath, JSON.stringify(factsheet, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${factsheetPath} (solve=${factsheet.solve.status}, objects=${factsheet.objects.length})`);

  if (factsheet.objects.length === 0) {
    for (const w of factsheet.warnings) console.log(`  ⚠ ${w}`);
    console.log('No grounded objects — skipping reading (identity is never fabricated).');
    return;
  }

  try {
    const reading = await generateReading(factsheet, {
      toolVersion: TOOL_VERSION,
      tone: args.style,
      model: args.model,
      displayLanguage: lang,
      imagePath,
      imageSrc: imageName,
    });
    const readingPath = join(outDir, 'reading.json');
    await writeFile(readingPath, JSON.stringify(reading, null, 2) + '\n', 'utf8');
    console.log(`Wrote ${readingPath}`);
    console.log(`Identified: ${reading.object.name.en} (${reading.object.type.en})`);
  } catch (err) {
    if (err instanceof ReaderError && err.raw) {
      const rawPath = join(outDir, 'raw_llm_output.txt');
      await writeFile(rawPath, err.raw, 'utf8');
      throw new Error(`${err.message}\nRaw claude output saved to ${rawPath}`);
    }
    throw err;
  }
}
