import type { Report } from '@astrolens/schema';

/** GET /api/report response. The image is served separately at /image. */
export interface ReportResponse {
  report: Report;
  /** Basename of the source image, for display in the header. */
  imageName: string;
}

/** POST /api/save request body. */
export interface SaveRequest {
  report: Report;
}

export interface SaveResponse {
  ok: boolean;
  error?: string;
}
