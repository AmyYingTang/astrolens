import type {
  EntryResponse,
  ObjectsResponse,
  SaveEntryRequest,
  SaveEntryResponse,
  SolveJob,
  UploadRequest,
  UploadResponse,
} from '../shared.js';
import type { FeatureType } from '../featureTypes.js';

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: url.includes('/object/') ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
}

export async function fetchFeatureTypes(): Promise<FeatureType[]> {
  const r = await fetch('/api/feature-types');
  const { featureTypes } = (await r.json()) as { featureTypes: FeatureType[] };
  return featureTypes;
}

export function uploadImage(body: UploadRequest): Promise<UploadResponse> {
  return jsonPost<UploadResponse>('/api/upload', body);
}

export async function getJob(id: string): Promise<SolveJob> {
  const r = await fetch(`/api/job/${id}`);
  return (await r.json()) as SolveJob;
}

export async function listObjects(): Promise<ObjectsResponse> {
  const r = await fetch('/api/objects');
  return (await r.json()) as ObjectsResponse;
}

export async function getObject(id: string): Promise<EntryResponse> {
  const r = await fetch(`/api/object/${encodeURIComponent(id)}`);
  return (await r.json()) as EntryResponse;
}

export function saveObject(id: string, body: SaveEntryRequest): Promise<SaveEntryResponse> {
  return jsonPost<SaveEntryResponse>(`/api/object/${encodeURIComponent(id)}`, body);
}

/** Poll a solve job until done/failed. */
export async function pollJob(id: string, onTick?: (j: SolveJob) => void): Promise<SolveJob> {
  for (;;) {
    const j = await getJob(id);
    onTick?.(j);
    if (j.state !== 'running') return j;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
