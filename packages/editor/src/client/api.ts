import type { Reading } from '@astrolens/schema';
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  ExportFile,
  ExportFormat,
  ExportResponse,
  FactsheetResponse,
  JobStatus,
  ProjectsResponse,
  ProjectSummary,
  ReportResponse,
  SaveResponse,
} from '../shared.js';

// GETs that read regeneratable files (report/factsheet/job/list) must never be
// served from the HTTP cache, or a re-identify / generate won't show up after
// location.reload() — the file on disk is fresh but the browser reuses the old
// response.
const NO_STORE: RequestInit = { cache: 'no-store' };

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/projects', NO_STORE);
  if (!res.ok) throw new Error(`Failed to list projects (${res.status})`);
  return ((await res.json()) as ProjectsResponse).projects;
}

export async function createProject(req: CreateProjectRequest): Promise<string> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  const body = (await res.json()) as CreateProjectResponse;
  if (!body.ok || !body.slug) throw new Error(body.error ?? `Create failed (${res.status})`);
  return body.slug;
}

export async function reidentify(slug: string, opts: { starMagMax?: number } = {}): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/reidentify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `Re-identify failed (${res.status})`);
}

/** EXPERIMENT: run the AI Class-B feature pass; folds 'ai' features into the
 * factsheet + regenerates the reading. Synchronous (the claude call is ~30s). */
export async function identifyAi(slug: string, model?: string): Promise<number> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/identify-ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(model ? { model } : {}),
  });
  const body = (await res.json()) as { ok: boolean; count?: number; error?: string };
  if (!body.ok) throw new Error(body.error ?? `AI feature pass failed (${res.status})`);
  return body.count ?? 0;
}

export async function generateReading(slug: string, tone?: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/reading`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tone }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `Generate reading failed (${res.status})`);
}

export async function fetchJob(slug: string): Promise<JobStatus> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/job`, NO_STORE);
  return (await res.json()) as JobStatus;
}

export async function fetchFactsheet(slug: string): Promise<FactsheetResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/factsheet`, NO_STORE);
  if (!res.ok) throw new Error(`Failed to load fact sheet (${res.status})`);
  return (await res.json()) as FactsheetResponse;
}

export async function fetchReport(slug: string): Promise<ReportResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/report`, NO_STORE);
  if (!res.ok) throw new Error(`Failed to load report (${res.status})`);
  return (await res.json()) as ReportResponse;
}

export async function saveReport(slug: string, report: Reading): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  const body = (await res.json()) as SaveResponse;
  if (!body.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
}

export async function exportProject(slug: string, format: ExportFormat): Promise<ExportFile[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format }),
  });
  const body = (await res.json()) as ExportResponse;
  if (!body.ok) throw new Error(body.error ?? `Export failed (${res.status})`);
  return body.files ?? [];
}

export const imageUrl = (slug: string): string => `/api/projects/${encodeURIComponent(slug)}/image`;
export const fileUrl = (slug: string, name: string): string =>
  `/api/projects/${encodeURIComponent(slug)}/files/${encodeURIComponent(name)}`;
