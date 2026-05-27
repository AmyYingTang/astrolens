import { ofetch } from 'ofetch';

export interface SimbadFacts {
  distance_ly?: number;
  size_arcmin?: number;
}

const PC_TO_LY = 3.26156;
const UNIT_TO_PC: Record<string, number> = { pc: 1, kpc: 1000, Mpc: 1_000_000 };

/** Best-effort parse of SIMBAD's ASCII object page. Never throws. */
export function parseSimbadAscii(text: string): SimbadFacts {
  const facts: SimbadFacts = {};

  const size = text.match(/Angular size:\s*([\d.]+)/i);
  if (size) {
    const v = Number(size[1]);
    if (Number.isFinite(v) && v > 0) facts.size_arcmin = v;
  }

  const distIdx = text.search(/Distance/i);
  if (distIdx !== -1) {
    const window = text.slice(distIdx, distIdx + 400);
    const dist = window.match(/([\d.]+)\s*(kpc|Mpc|pc)\b/);
    if (dist) {
      const v = Number(dist[1]);
      const factor = UNIT_TO_PC[dist[2]!];
      if (Number.isFinite(v) && v > 0 && factor) {
        facts.distance_ly = Math.round(v * factor * PC_TO_LY);
      }
    }
  }

  return facts;
}

/**
 * Optional distance/size lookup. Returns {} on any failure (network, parse,
 * unknown object) — it must never block a `read`.
 */
export async function lookupSimbad(name: string): Promise<SimbadFacts> {
  try {
    const text = await ofetch<string, 'text'>('https://simbad.cds.unistra.fr/simbad/sim-id', {
      query: { Ident: name, 'output.format': 'ASCII' },
      responseType: 'text',
      timeout: 8000,
    });
    return parseSimbadAscii(text);
  } catch {
    return {};
  }
}
