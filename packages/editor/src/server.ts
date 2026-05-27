import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Report } from '@astrolens/schema';
import type { ReportResponse, SaveRequest, SaveResponse } from './shared.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, 'client');

export interface EditorServerOptions {
  reportPath: string;
  port?: number;
}

export interface EditorServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startEditorServer(opts: EditorServerOptions): Promise<EditorServerHandle> {
  const reportPath = resolve(opts.reportPath);
  const reportDir = dirname(reportPath);
  const port = opts.port ?? 3000;

  const loadReport = async (): Promise<Report> =>
    Report.parse(JSON.parse(await readFile(reportPath, 'utf8')));

  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/report', async (_req, res) => {
    try {
      const report = await loadReport();
      const body: ReportResponse = { report, imageName: basename(report.image.src) };
      res.json(body);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/save', async (req, res) => {
    try {
      const report = Report.parse((req.body as SaveRequest).report);
      report.edited_at = new Date().toISOString();
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
      res.json({ ok: true } satisfies SaveResponse);
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message } satisfies SaveResponse);
    }
  });

  app.get('/image', async (_req, res) => {
    try {
      const report = await loadReport();
      res.sendFile(resolve(reportDir, report.image.src));
    } catch (e) {
      res.status(500).send((e as Error).message);
    }
  });

  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(resolve(clientDist, 'index.html'));
  });

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
