import { ofetch } from 'ofetch';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { SolveClient, SolveInput, SolveResult, Wcs } from './types.js';

/**
 * nova.astrometry.net plate-solver. Async submit → poll → calibration.
 *
 * ⚠ NOT exercised in CI (needs an API key + network). Verify live against real
 * images via identify-eval's star self-check before trusting placement — in
 * particular the orientation/parity → Wcs mapping (see wcs.ts).
 *
 * Logs each step to stderr (prefixed `[nova]`) so failures are diagnosable; the
 * failure reason is also returned in SolveResult.error.
 */
export interface NovaOptions {
  apiKey: string;
  baseUrl?: string; // default https://nova.astrometry.net
  pollIntervalMs?: number; // default 5000
  timeoutMs?: number; // default 300000 (5 min)
}

interface Calibration {
  ra: number;
  dec: number;
  radius: number;
  pixscale: number; // arcsec/pixel
  orientation: number; // degrees
  parity: number; // ±1
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (m: string): void => console.error(`[nova] ${m}`);

/** Extract a readable message (incl. HTTP status) from an ofetch/Error. */
function errMsg(e: unknown): string {
  const any = e as { message?: string; status?: number; response?: { status?: number } };
  const status = any?.status ?? any?.response?.status;
  const base = any?.message ?? String(e);
  return status ? `HTTP ${status}: ${base}` : base;
}

export function createNovaSolveClient(opts: NovaOptions): SolveClient {
  const base = opts.baseUrl ?? 'https://nova.astrometry.net';
  // Poll every 2s (was 5s): nova often solves in seconds, and the poll interval
  // is pure added latency for a fast solve. Requests are light; 2s is a good
  // balance for live use. Override via pollIntervalMs.
  const pollMs = opts.pollIntervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 300_000;

  // NOTE: nova serves JSON with a text content-type, so ofetch would return a
  // raw string by default — every call forces responseType:'json' to parse it.
  async function login(): Promise<string> {
    const res = await ofetch<{ status?: string; session?: string; errormessage?: string }>(
      `${base}/api/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        responseType: 'json',
        body: `request-json=${encodeURIComponent(JSON.stringify({ apikey: opts.apiKey }))}`,
      },
    );
    if (!res || res.status !== 'success' || !res.session) {
      throw new Error(`login rejected: ${res?.errormessage ?? JSON.stringify(res).slice(0, 300)}`);
    }
    return res.session;
  }

  async function upload(session: string, input: SolveInput): Promise<number> {
    const buf = await readFile(input.imagePath);
    const fd = new FormData();
    fd.append(
      'request-json',
      JSON.stringify({ session, publicly_visible: 'n', allow_modifications: 'd', allow_commercial_use: 'd' }),
    );
    fd.append('file', new Blob([new Uint8Array(buf)]), basename(input.imagePath));
    const res = await ofetch<{ status: string; subid?: number; errormessage?: string }>(
      `${base}/api/upload`,
      { method: 'POST', responseType: 'json', body: fd },
    );
    if (res.status !== 'success' || res.subid == null) {
      throw new Error(`upload rejected: ${res.errormessage ?? res.status}`);
    }
    return res.subid;
  }

  async function solve(input: SolveInput): Promise<SolveResult> {
    const t0 = Date.now();
    const secs = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    try {
      log(`api key length ${opts.apiKey.length}`);
      log('logging in…');
      const session = await login();

      log(`uploading ${basename(input.imagePath)} (${(input.width)}×${input.height})…`);
      const subid = await upload(session, input);
      log(`submission ${subid} created (${secs()}); waiting for a job to spawn…`);

      const deadline = Date.now() + timeoutMs;

      let jobId: number | null = null;
      while (Date.now() < deadline && jobId == null) {
        await sleep(pollMs);
        const sub = await ofetch<{ jobs: (number | null)[] }>(`${base}/api/submissions/${subid}`, {
          responseType: 'json',
        });
        jobId = sub.jobs.find((j): j is number => j != null) ?? null;
      }
      if (jobId == null) {
        return { status: 'failed', error: `timed out after ${timeoutMs / 1000}s waiting for a job (subid ${subid})`, elapsed_ms: Date.now() - t0 };
      }
      log(`job ${jobId} spawned (${secs()}); solving…`);

      let solved = false;
      while (Date.now() < deadline) {
        const job = await ofetch<{ status: string }>(`${base}/api/jobs/${jobId}`, {
          responseType: 'json',
        });
        if (job.status === 'success') {
          solved = true;
          break;
        }
        if (job.status === 'failure') {
          return { status: 'failed', nova_job_id: String(jobId), error: `job ${jobId} failed: nova could not solve this image (too few stars / not a star field?)`, elapsed_ms: Date.now() - t0 };
        }
        log(`job ${jobId} status=${job.status}…`);
        await sleep(pollMs);
      }
      if (!solved) {
        return { status: 'failed', nova_job_id: String(jobId), error: `timed out after ${timeoutMs / 1000}s waiting for job ${jobId} to finish`, elapsed_ms: Date.now() - t0 };
      }

      const cal = await ofetch<Calibration>(`${base}/api/jobs/${jobId}/calibration`, {
        responseType: 'json',
      });
      log(`✔ solved in ${secs()}: ra=${cal.ra.toFixed(4)} dec=${cal.dec.toFixed(4)} pixscale=${cal.pixscale.toFixed(2)}″/px orient=${cal.orientation.toFixed(1)} parity=${cal.parity}`);
      const wcs: Wcs = {
        ra0_deg: cal.ra,
        dec0_deg: cal.dec,
        crpix_x: input.width / 2,
        crpix_y: input.height / 2,
        scale_deg: cal.pixscale / 3600,
        orientation_deg: cal.orientation,
        // nova's parity is inverted relative to our CD convention (our diag(parity,1)
        // X-flips). Validated 2026-06-22 against M4 / Antares / NGC 6144 placement:
        // nova parity=+1 needs our parity=-1, else everything mirrors left↔right.
        parity: cal.parity < 0 ? 1 : -1,
        width: input.width,
        height: input.height,
      };
      return { status: 'solved', wcs, nova_job_id: String(jobId), elapsed_ms: Date.now() - t0 };
    } catch (e) {
      const msg = errMsg(e);
      log(`failed in ${secs()}: ${msg}`);
      return { status: 'failed', error: msg, elapsed_ms: Date.now() - t0 };
    }
  }

  return { solve };
}
