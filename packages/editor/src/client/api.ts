import type { Report } from '@astrolens/schema';
import type { ReportResponse, SaveResponse } from '../shared.js';

export async function fetchReport(): Promise<ReportResponse> {
  const res = await fetch('/api/report');
  if (!res.ok) {
    throw new Error(`Failed to load report (${res.status})`);
  }
  return (await res.json()) as ReportResponse;
}

export async function saveReport(report: Report): Promise<void> {
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  const body = (await res.json()) as SaveResponse;
  if (!body.ok) {
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }
}
