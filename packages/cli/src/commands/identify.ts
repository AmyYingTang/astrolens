import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import sharp from 'sharp';
import {
  identify,
  createNovaSolveClient,
  createCachedSolveClient,
  createSimbadCatalogClient,
  createVizierCatalogClient,
  createOpenNgcCatalogClient,
  createCompositeCatalogClient,
} from '@astrolens/identify';

export interface IdentifyArgs {
  image: string;
  target?: string;
  out: string;
  band?: string;
  starless?: boolean;
  topN?: number;
  apiKey?: string;
  cache?: boolean;
}

/** Stage 1 only: plate-solve + catalog → factsheet.json (no LLM). */
export async function identifyImage(args: IdentifyArgs): Promise<void> {
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

  const band =
    args.band === 'broadband' || args.band === 'narrowband' ? args.band : ('unknown' as const);

  const nova = createNovaSolveClient({ apiKey });
  const solve = args.cache === false ? nova : createCachedSolveClient(nova);

  console.log('Plate-solving (nova — this can take 30s to a few minutes; cached after the first solve)…');
  const factsheet = await identify(
    {
      imagePath,
      width: meta.width,
      height: meta.height,
      imageSrc: imageName,
      targetName: args.target,
      band,
      starless: args.starless,
      topN: args.topN,
    },
    {
      solve,
      catalog: createCompositeCatalogClient([
        createSimbadCatalogClient(),
        createVizierCatalogClient(),
        createOpenNgcCatalogClient(),
      ]),
    },
  );

  await copyFile(imagePath, join(outDir, imageName));
  const factsheetPath = join(outDir, 'factsheet.json');
  await writeFile(factsheetPath, JSON.stringify(factsheet, null, 2) + '\n', 'utf8');

  console.log(`Wrote ${factsheetPath}`);
  console.log(`Solve: ${factsheet.solve.status} (frame=${factsheet.solve.frame})`);
  console.log(`Objects: ${factsheet.objects.length}`);
  for (const o of factsheet.objects) {
    const flags = [o.tier === 'B' ? 'B-class' : null, o.needs_human_review ? 'needs review' : null]
      .filter(Boolean)
      .join(', ');
    console.log(`  [${o.role}] ${o.names[0]} — ${o.type.en}${flags ? ` · ${flags}` : ''}`);
  }
  for (const w of factsheet.warnings) console.log(`  ⚠ ${w}`);
}
