import type { Report } from '@astrolens/schema';

export interface ProjectSummary {
  slug: string;
  name: string;
  type: string;
  stage?: number;
  imageName: string;
  features: number;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

/** POST /api/projects — create a new reading from an uploaded image. */
export interface CreateProjectRequest {
  /** base64 (optionally a data: URI) of the image bytes. */
  imageBase64: string;
  filename: string;
  hint?: string;
  lang?: 'zh' | 'en';
  /** Extra instructions (tone/audience/focus) appended to the read prompt. */
  style?: string;
}

export interface CreateProjectResponse {
  ok: boolean;
  slug?: string;
  error?: string;
}

/** GET /api/projects/:slug/report */
export interface ReportResponse {
  report: Report;
  imageName: string;
}

/** POST /api/projects/:slug/report */
export interface SaveRequest {
  report: Report;
}

export interface SaveResponse {
  ok: boolean;
  error?: string;
}

export type ExportFormat = 'annotated' | 'embed' | 'poster' | 'all';

export interface ExportRequest {
  format: ExportFormat;
}

export interface ExportFile {
  name: string;
  /** base64-encoded file bytes. */
  base64: string;
  /** MIME type. */
  contentType: string;
}

export interface ExportResponse {
  ok: boolean;
  files?: ExportFile[];
  error?: string;
}
