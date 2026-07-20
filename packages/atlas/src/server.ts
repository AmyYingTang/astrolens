import express from 'express';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createNovaSolveClient, createCachedSolveClient } from '@astrolens/identify';
import { AtlasEntry, AtlasFile, normalizeId } from './atlas.js';
import { LocalAtlasStore, type AtlasStore } from './store.js';
import { FEATURE_TYPES } from './featureTypes.js';
import type {
  ObjectsResponse,
  ObjectSummary,
  EntryResponse,
  SaveEntryRequest,
  SaveEntryResponse,
  SolveJob,
  StatusCounts,
  UploadRequest,
  UploadResponse,
} from './shared.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, 'client');
const KEY_RE = /^[A-Za-z0-9._-]+$/;

export interface AtlasServerOptions {
  /** Data dir for the local store (atlas.json + refimg/). */
  dataDir: string;
  port?: number;
  store?: AtlasStore; // inject an alternative adapter (r2/s3) later
}

export interface AtlasServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function statusCounts(entry: AtlasEntry): StatusCounts {
  const c: StatusCounts = { draft: 0, in_review: 0, approved: 0 };
  for (const a of entry.annotations) c[a.status] += 1;
  return c;
}

function contentType(key: string): string {
  return extname(key).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
}

export async function startAtlasServer(opts: AtlasServerOptions): Promise<AtlasServerHandle> {
  const port = opts.port ?? 3100;
  const store: AtlasStore = opts.store ?? new LocalAtlasStore({ dataDir: opts.dataDir });

  // In-memory solve jobs (nova is slow; upload returns a jobId the client polls).
  const jobs = new Map<string, SolveJob>();
  let jobSeq = 0;

  const requireApiKey = (): string => {
    const apiKey = process.env.ASTROMETRY_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Plate-solving needs a nova API key. Put ASTROMETRY_API_KEY in a .env file (where you run the atlas server) or export it, then restart. Free key from nova.astrometry.net.',
      );
    }
    return apiKey;
  };

  const app = express();
  app.use(express.json({ limit: '64mb' }));

  // Static feature-type vocabulary — one source for client + server.
  app.get('/api/feature-types', (_req, res) => res.json({ featureTypes: FEATURE_TYPES }));

  // Upload a reference image → store it → plate-solve in the background.
  app.post('/api/upload', async (req, res) => {
    try {
      const body = req.body as UploadRequest;
      const apiKey = requireApiKey();
      const ext = (extname(body.filename ?? '') || '.jpg').toLowerCase();
      const jobId = `${Date.now().toString(36)}-${(jobSeq++).toString(36)}`;
      const imageRef = `upload_${jobId}${ext === '.png' ? '.png' : '.jpg'}`;

      const b64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      await store.putRefImage(imageRef, buf);

      jobs.set(jobId, { state: 'running', stage: 'storing' });
      res.json({ ok: true, jobId } satisfies UploadResponse);

      // Background: read dims + solve. A temp file on disk is needed because the
      // nova client reads an image path.
      void (async () => {
        try {
          const meta = await sharp(buf).metadata();
          if (!meta.width || !meta.height) throw new Error('Could not read image dimensions');
          const dir = join(tmpdir(), 'astrolens-atlas');
          await mkdir(dir, { recursive: true });
          const tmpPath = join(dir, imageRef);
          await writeFile(tmpPath, buf);

          jobs.set(jobId, { state: 'running', stage: 'solving' });
          const solve = createCachedSolveClient(createNovaSolveClient({ apiKey }));
          const result = await solve.solve({ imagePath: tmpPath, width: meta.width, height: meta.height });
          if (result.status !== 'solved' || !result.wcs) {
            jobs.set(jobId, { state: 'failed', error: result.error ?? 'Plate-solve failed' });
            return;
          }
          jobs.set(jobId, {
            state: 'done',
            wcs: result.wcs,
            imageRef,
            width: meta.width,
            height: meta.height,
          });
        } catch (e) {
          jobs.set(jobId, { state: 'failed', error: (e as Error).message });
        }
      })();
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message } satisfies UploadResponse);
    }
  });

  app.get('/api/job/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ state: 'failed', error: 'no such job' } satisfies SolveJob);
      return;
    }
    res.json(job satisfies SolveJob);
  });

  // Serve a stored reference image.
  app.get('/refimg/:key', async (req, res) => {
    const key = req.params.key;
    if (!KEY_RE.test(key)) {
      res.status(400).end();
      return;
    }
    try {
      const buf = await store.getRefImage(key);
      res.setHeader('Content-Type', contentType(key));
      res.send(buf);
    } catch (e) {
      res.status(404).send((e as Error).message);
    }
  });

  app.get('/api/objects', async (_req, res) => {
    const atlas = await store.loadAtlas();
    const objects: ObjectSummary[] = atlas.objects.map((o) => ({
      primary_id: o.primary_id,
      aliases: o.aliases,
      annotations: o.annotations.length,
      status: statusCounts(o),
    }));
    res.json({ objects } satisfies ObjectsResponse);
  });

  app.get('/api/object/:id', async (req, res) => {
    const atlas = await store.loadAtlas();
    const key = normalizeId(req.params.id);
    const entry =
      atlas.objects.find(
        (o) => normalizeId(o.primary_id) === key || o.aliases.some((a) => normalizeId(a) === key),
      ) ?? null;
    res.json({ entry } satisfies EntryResponse);
  });

  // Upsert an entry (matched by normalised primary_id). Read-modify-write on the
  // single atlas data file — fine for the single-editor internal tool.
  app.put('/api/object/:id', async (req, res) => {
    try {
      const entry = AtlasEntry.parse((req.body as SaveEntryRequest).entry);
      const atlas = await store.loadAtlas();
      const key = normalizeId(entry.primary_id);
      const idx = atlas.objects.findIndex((o) => normalizeId(o.primary_id) === key);
      if (idx >= 0) atlas.objects[idx] = entry;
      else atlas.objects.push(entry);
      await store.saveAtlas(AtlasFile.parse(atlas));
      res.json({ ok: true } satisfies SaveEntryResponse);
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message } satisfies SaveEntryResponse);
    }
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
