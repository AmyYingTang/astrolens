import express from 'express';
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Reading, FactSheet } from '@astrolens/schema';
import {
  identify,
  createConfiguredSolveClient,
  isLocalSolver,
  createSimbadCatalogClient,
  createVizierCatalogClient,
  createOpenNgcCatalogClient,
  createCompositeCatalogClient,
  defaultRegistryPath,
} from '@astrolens/identify';
import { readingFromFactsheet, tailorReading, ReaderError } from '@astrolens/reader';
import { renderAnnotatedBuffer, generateEmbedHtml, renderPosterBuffers } from '@astrolens/renderer';
import type {
  CreateProjectRequest,
  ExportFile,
  ExportFormat,
  ExportRequest,
  FactsheetResponse,
  JobStatus,
  ProjectSummary,
  ReportResponse,
  SaveRequest,
} from './shared.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, 'client');
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

export interface StudioServerOptions {
  workspace: string;
  port?: number;
  toolVersion?: string;
}

export interface StudioServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Filesystem-safe stem from an object name for export filenames: drop spaces
 * (so "NGC 3372" → "NGC3372"), keep hyphens ("Sh2-308" stays intact),
 * neutralize unsafe chars. Falls back to "report". */
function objectStem(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '')
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned || 'report';
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function uniqueSlug(workspace: string, base: string): Promise<string> {
  const root = base || 'reading';
  let slug = root;
  let n = 2;
  while (await exists(join(workspace, slug))) {
    slug = `${root}-${n}`;
    n += 1;
  }
  return slug;
}

export async function startStudioServer(opts: StudioServerOptions): Promise<StudioServerHandle> {
  const workspace = resolve(opts.workspace);
  await mkdir(workspace, { recursive: true });
  const port = opts.port ?? 3000;
  const toolVersion = opts.toolVersion ?? '0.1.0';

  const projectDir = (slug: string): string => {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid project id: ${slug}`);
    return join(workspace, slug);
  };
  const loadReport = async (slug: string): Promise<Reading> =>
    Reading.parse(JSON.parse(await readFile(join(projectDir(slug), 'reading.json'), 'utf8')));
  const loadFactsheet = async (slug: string): Promise<FactSheet> =>
    FactSheet.parse(JSON.parse(await readFile(join(projectDir(slug), 'factsheet.json'), 'utf8')));

  // In-memory create-job status, mirrored to job.json for durability/visibility.
  const jobs = new Map<string, JobStatus>();
  const setJob = async (slug: string, status: JobStatus): Promise<void> => {
    jobs.set(slug, status);
    try {
      await writeFile(join(projectDir(slug), 'job.json'), JSON.stringify(status, null, 2) + '\n', 'utf8');
    } catch {
      // project dir may not exist yet / was removed — in-memory status still holds
    }
  };

  const app = express();
  app.use(express.json({ limit: '48mb' }));

  app.get('/api/projects', async (_req, res) => {
    const entries = await readdir(workspace, { withFileTypes: true });
    const projects: ProjectSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const r = await loadReport(e.name);
        const summary: ProjectSummary = {
          slug: e.name,
          name: r.object.name[r.display_language],
          type: r.object.type[r.display_language],
          stage: r.object.stage,
          imageName: basename(r.image.src),
          features: r.features.length,
        };
        try {
          const fs = await loadFactsheet(e.name);
          summary.solveStatus = fs.solve.status;
          summary.needsReview = fs.objects.filter((o) => o.needs_human_review).length;
        } catch {
          // pre-Stage-1 project without a fact sheet — leave chips unset
        }
        projects.push(summary);
      } catch {
        // not a project dir — skip
      }
    }
    res.json({ projects });
  });

  // The nova key is only needed for the nova solver; the local astrometry.net
  // solver (ASTROLENS_SOLVER=local) needs no key.
  const requireApiKey = (): string | undefined => {
    const apiKey = process.env.ASTROMETRY_API_KEY;
    if (!apiKey && !isLocalSolver()) {
      throw new Error(
        'Plate-solving needs a nova API key. Put ASTROMETRY_API_KEY in a .env file (where you run the studio) or export it, then restart — or set ASTROLENS_SOLVER=local for offline solving. Free key from nova.astrometry.net.',
      );
    }
    return apiKey;
  };

  /** Stage 1 background job: identify → factsheet.json + a stub reading.json (no LLM). */
  const runIdentify = async (
    slug: string,
    dir: string,
    imagePath: string,
    imageName: string,
    width: number,
    height: number,
    opts: { apiKey?: string; hint?: string; lang: 'zh' | 'en'; starMagMax?: number },
  ): Promise<void> => {
    try {
      const factsheet = await identify(
        {
          imagePath,
          width,
          height,
          imageSrc: imageName,
          targetName: opts.hint,
          starMagMax: opts.starMagMax,
          registryPath: defaultRegistryPath(),
        },
        {
          solve: createConfiguredSolveClient({ apiKey: opts.apiKey }),
          catalog: createCompositeCatalogClient([
            createSimbadCatalogClient(),
            createVizierCatalogClient(),
            createOpenNgcCatalogClient(),
          ]),
        },
      );
      await writeFile(join(dir, 'factsheet.json'), JSON.stringify(factsheet, null, 2) + '\n', 'utf8');

      if (factsheet.objects.length === 0) {
        await setJob(slug, {
          state: 'failed',
          error: `No object identified (solve=${factsheet.solve.status}). ${factsheet.warnings.join(' ')}`.trim(),
          warnings: factsheet.warnings,
        });
        return;
      }

      // Stub reading: grounded annotations, no explanations. AI text is generated
      // later from the editor (after the user reviews the annotations).
      const reading = readingFromFactsheet(factsheet, {
        toolVersion,
        displayLanguage: opts.lang,
        imageSrc: imageName,
      });
      await writeFile(join(dir, 'reading.json'), JSON.stringify(reading, null, 2) + '\n', 'utf8');
      await setJob(slug, { state: 'done', stage: 'done', warnings: factsheet.warnings });
    } catch (e) {
      await setJob(slug, { state: 'failed', error: (e as Error).message });
    }
  };

  app.post('/api/projects', async (req, res) => {
    try {
      const body = req.body as CreateProjectRequest;
      const apiKey = requireApiKey();

      const ext = (extname(body.filename ?? '') || '.jpg').toLowerCase();
      const base = slugify(basename(body.filename ?? 'reading', ext));
      const slug = await uniqueSlug(workspace, base);
      const dir = join(workspace, slug);
      await mkdir(dir, { recursive: true });

      const imageName = `image${ext}`;
      const b64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');
      const imagePath = join(dir, imageName);
      await writeFile(imagePath, Buffer.from(b64, 'base64'));

      const meta = await sharp(imagePath).metadata();
      if (!meta.width || !meta.height) throw new Error('Could not read image dimensions');

      // nova is slow: run identify as a background job; client polls /job.
      await setJob(slug, { state: 'running', stage: 'solving' });
      res.json({ ok: true, slug });
      void runIdentify(slug, dir, imagePath, imageName, meta.width, meta.height, {
        apiKey,
        hint: body.hint || undefined,
        lang: body.lang === 'en' ? 'en' : 'zh',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Generate the AI reading on demand (LLM only) — tailors text onto the
  // already-reviewed annotations, preserving their circles/labels.
  app.post('/api/projects/:slug/reading', async (req, res) => {
    try {
      const slug = req.params.slug;
      const dir = projectDir(slug);
      const tone = ((req.body ?? {}) as { tone?: string }).tone || undefined;
      const reading = await loadReport(slug);
      const files = await readdir(dir);
      const imageName = files.find((f) => /^image\.(jpe?g|png)$/i.test(f));
      const imagePath = imageName ? join(dir, imageName) : undefined;

      await setJob(slug, { state: 'running', stage: 'reading' });
      res.json({ ok: true, slug });
      void (async () => {
        try {
          const tailored = await tailorReading(reading, { imagePath, tone });
          await writeFile(join(dir, 'reading.json'), JSON.stringify(tailored, null, 2) + '\n', 'utf8');
          await setJob(slug, { state: 'done', stage: 'done' });
        } catch (e) {
          // On parse failure, save the raw LLM output so it can be inspected.
          let error = (e as Error).message;
          if (e instanceof ReaderError && e.raw) {
            try {
              await writeFile(join(dir, 'raw_llm_output.txt'), e.raw, 'utf8');
              error += ` (raw output saved to ${slug}/raw_llm_output.txt)`;
            } catch {
              // best-effort
            }
          }
          await setJob(slug, { state: 'failed', error });
        }
      })();
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Re-run identification on an existing project's stored image (no re-upload).
  app.post('/api/projects/:slug/reidentify', async (req, res) => {
    try {
      const slug = req.params.slug;
      const dir = projectDir(slug);
      const apiKey = requireApiKey();
      const starMagMax = ((req.body ?? {}) as { starMagMax?: number }).starMagMax;

      const files = await readdir(dir);
      const imageName = files.find((f) => /^image\.(jpe?g|png)$/i.test(f));
      if (!imageName) throw new Error('No source image found in this project');
      const imagePath = join(dir, imageName);
      const meta = await sharp(imagePath).metadata();
      if (!meta.width || !meta.height) throw new Error('Could not read image dimensions');

      let lang: 'zh' | 'en' = 'zh';
      try {
        lang = (await loadReport(slug)).display_language;
      } catch {
        // no prior reading — default zh
      }

      await setJob(slug, { state: 'running', stage: 'solving' });
      res.json({ ok: true, slug });
      void runIdentify(slug, dir, imagePath, imageName, meta.width, meta.height, {
        apiKey,
        lang,
        starMagMax: typeof starMagMax === 'number' ? starMagMax : undefined,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // RETIRED: the AI (VLM) Class-B feature pass. B-class features now come solely
  // from the approved feature atlas (Atlas Apply); the automatic detectors are
  // no longer wired to user-visible rendering. `runAiFeaturePass` stays in
  // @astrolens/identify but is not exposed here. Kept as a 410 so any stale
  // client gets a clear signal instead of a 404.
  app.post('/api/projects/:slug/identify-ai', (_req, res) => {
    res.status(410).json({ ok: false, error: 'The AI feature pass is retired — B-class features come from the atlas.' });
  });

  app.get('/api/projects/:slug/job', async (req, res) => {
    const slug = req.params.slug;
    const inMem = jobs.get(slug);
    if (inMem) {
      res.json(inMem satisfies JobStatus);
      return;
    }
    try {
      const raw = await readFile(join(projectDir(slug), 'job.json'), 'utf8');
      res.json(JSON.parse(raw) as JobStatus);
    } catch {
      try {
        await access(join(projectDir(slug), 'reading.json'));
        res.json({ state: 'done', stage: 'done' } satisfies JobStatus);
      } catch {
        res.status(404).json({ state: 'failed', error: 'no such job' } satisfies JobStatus);
      }
    }
  });

  app.get('/api/projects/:slug/factsheet', async (req, res) => {
    try {
      const factsheet = await loadFactsheet(req.params.slug);
      res.json({ factsheet } satisfies FactsheetResponse);
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  app.get('/api/projects/:slug/report', async (req, res) => {
    try {
      const report = await loadReport(req.params.slug);
      res.json({ report, imageName: basename(report.image.src) } satisfies ReportResponse);
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  app.post('/api/projects/:slug/report', async (req, res) => {
    try {
      const report = Reading.parse((req.body as SaveRequest).report);
      report.edited_at = new Date().toISOString();
      await writeFile(
        join(projectDir(req.params.slug), 'reading.json'),
        JSON.stringify(report, null, 2) + '\n',
        'utf8',
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.get('/api/projects/:slug/image', async (req, res) => {
    try {
      const report = await loadReport(req.params.slug);
      res.sendFile(join(projectDir(req.params.slug), report.image.src));
    } catch (e) {
      res.status(404).send((e as Error).message);
    }
  });

  app.post('/api/projects/:slug/export', async (req, res) => {
    try {
      const slug = req.params.slug;
      const format = (req.body as ExportRequest).format;
      const report = await loadReport(slug);
      const dir = projectDir(slug);
      const imagePath = join(dir, report.image.src);
      const want = (f: ExportFormat): boolean => format === 'all' || format === f;
      const stem = objectStem(report.object.name.en || report.object.name.zh);
      const files: ExportFile[] = [];

      // Always carry the full reading.json so the gallery site has the
      // structured metadata (color_key per feature, object info, labels)
      // alongside the rendered image instead of guessing from pixels.
      files.push({
        name: `${stem}.json`,
        base64: Buffer.from(JSON.stringify(report, null, 2), 'utf8').toString('base64'),
        contentType: 'application/json',
      });

      if (want('annotated')) {
        const buf = await renderAnnotatedBuffer({ report, imagePath, format: 'jpeg' });
        files.push({
          name: `${stem}_annotated.jpg`,
          base64: buf.toString('base64'),
          contentType: 'image/jpeg',
        });
      }
      let dataUri = '';
      if (want('embed') || want('poster')) {
        const mime = extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
        dataUri = `data:${mime};base64,${(await readFile(imagePath)).toString('base64')}`;
      }
      if (want('embed')) {
        const html = generateEmbedHtml(report, { imageDataUri: dataUri });
        files.push({
          name: `${stem}_embed.html`,
          base64: Buffer.from(html, 'utf8').toString('base64'),
          contentType: 'text/html',
        });
      }
      if (want('poster')) {
        const posters = await renderPosterBuffers({ report, imageDataUri: dataUri });
        for (const p of posters) {
          files.push({
            name: `${stem}_${p.name}`,
            base64: p.buffer.toString('base64'),
            contentType: 'image/png',
          });
        }
      }
      res.json({ ok: true, files });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  app.get('/api/projects/:slug/files/:name', (req, res) => {
    const { slug, name } = req.params;
    if (!SLUG_RE.test(slug) || !SLUG_RE.test(name)) {
      res.status(400).end();
      return;
    }
    res.sendFile(join(workspace, slug, name));
  });

  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));

  const server = app.listen(port);
  await new Promise<void>((res, rej) => {
    server.once('listening', () => res());
    server.once('error', rej);
  });

  return {
    url: `http://localhost:${port}`,
    port,
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}
