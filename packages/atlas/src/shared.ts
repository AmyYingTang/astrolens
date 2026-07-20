import type { Wcs } from '@astrolens/schema';
import type { AtlasEntry } from './atlas.js';

// Wire contracts shared by the atlas server and its React client.

export interface UploadRequest {
  filename: string;
  /** data: URI or bare base64 of the reference image. */
  imageBase64: string;
}
export interface UploadResponse {
  ok: boolean;
  jobId?: string;
  error?: string;
}

export type JobState = 'running' | 'done' | 'failed';

/** A plate-solve job. nova is slow, so upload returns a jobId the client polls. */
export interface SolveJob {
  state: JobState;
  stage?: 'storing' | 'solving';
  error?: string;
  // Present once state === 'done':
  wcs?: Wcs;
  imageRef?: string;
  width?: number;
  height?: number;
}

export interface StatusCounts {
  draft: number;
  in_review: number;
  approved: number;
}
export interface ObjectSummary {
  primary_id: string;
  aliases: string[];
  annotations: number;
  status: StatusCounts;
}
export interface ObjectsResponse {
  objects: ObjectSummary[];
}

export interface EntryResponse {
  entry: AtlasEntry | null;
}

export interface SaveEntryRequest {
  entry: AtlasEntry;
}
export interface SaveEntryResponse {
  ok: boolean;
  error?: string;
}
