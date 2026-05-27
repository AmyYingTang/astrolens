import type { Report } from '@astrolens/schema';
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  ExportFormat,
  ExportResponse,
  ProjectsResponse,
  ProjectSummary,
  ReportResponse,
  SaveResponse,
} from '../shared.js';

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/projects');
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

export async function fetchReport(slug: string): Promise<ReportResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/report`);
  if (!res.ok) throw new Error(`Failed to load report (${res.status})`);
  return (await res.json()) as ReportResponse;
}

export async function saveReport(slug: string, report: Report): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  const body = (await res.json()) as SaveResponse;
  if (!body.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
}

export async function exportProject(slug: string, format: ExportFormat): Promise<string[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format }),
  });
  const body = (await res.json()) as ExportResponse;
  if (!body.ok) throw new Error(body.error ?? `Export failed (${res.status})`);
  return body.written ?? [];
}

export const imageUrl = (slug: string): string => `/api/projects/${encodeURIComponent(slug)}/image`;
export const fileUrl = (slug: string, name: string): string =>
  `/api/projects/${encodeURIComponent(slug)}/files/${encodeURIComponent(name)}`;
