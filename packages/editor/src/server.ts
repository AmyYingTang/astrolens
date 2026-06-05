import express from 'express';
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Report } from '@astrolens/schema';
import { generateReport } from '@astrolens/reader';
import { renderAnnotatedBuffer, generateEmbedHtml, renderPosterBuffers } from '@astrolens/renderer';
import type {
  CreateProjectRequest,
  ExportFile,
  ExportFormat,
  ExportRequest,
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
  const loadReport = async (slug: string): Promise<Report> =>
    Report.parse(JSON.parse(await readFile(join(projectDir(slug), 'report.json'), 'utf8')));

  const app = express();
  app.use(express.json({ limit: '48mb' }));

  app.get('/api/projects', async (_req, res) => {
    const entries = await readdir(workspace, { withFileTypes: true });
    const projects: ProjectSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const r = await loadReport(e.name);
        projects.push({
          slug: e.name,
          name: r.object.name,
          type: r.object.type,
          stage: r.object.stage,
          imageName: basename(r.image.src),
          features: r.features.length,
        });
      } catch {
        // not a project dir — skip
      }
    }
    res.json({ projects });
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const body = req.body as CreateProjectRequest;
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

      const report = await generateReport({
        imagePath,
        width: meta.width,
        height: meta.height,
        hint: body.hint || undefined,
        lang: body.lang === 'en' ? 'en' : 'zh',
        style: body.style || undefined,
        toolVersion,
        imageSrc: imageName,
      });
      await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
      res.json({ ok: true, slug });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
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
      const report = Report.parse((req.body as SaveRequest).report);
      report.edited_at = new Date().toISOString();
      await writeFile(
        join(projectDir(req.params.slug), 'report.json'),
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
      const stem = objectStem(report.object.name);
      const files: ExportFile[] = [];

      // Always carry the full report.json so the gallery site has the
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
