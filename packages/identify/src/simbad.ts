import { ofetch } from 'ofetch';
import type { CatalogClient, CatalogCandidate, RegionQuery } from './types.js';
import { NICKNAMES } from './nicknames.js';

/**
 * SIMBAD TAP region query (ADQL). post-0.4.8 lowercase columns.
 *
 * Three queries, merged:
 *  1. extended objects (have an angular size), ordered by size — clusters,
 *     nebulae, clouds, galaxies. A plain `TOP N` over `basic` is ~all faint
 *     stars and buries the real targets, so we require a size.
 *  2. bright stars (basic ⨝ allfluxes, V brighter than `starMagMax`) — the
 *     naked-eye stars (Antares, σ Sco …); stars have no angular size so they're
 *     invisible to query 1.
 *  3. proper names (ident table, `NAME …`) for the merged set — so we can show
 *     "Antares" instead of "* alf Sco".
 *
 * ⚠ NOT exercised in CI. catalog_ids derived from main_id patterns.
 */
export interface SimbadOptions {
  baseUrl?: string;
  objectLimit?: number; // extended objects, default 100
  starLimit?: number; // bright stars, default 30
  /** Broad V cutoff for the star query; final selection trims further. Default 6. */
  starMagMax?: number;
}

interface TapResponse {
  metadata: { name: string }[];
  data: unknown[][];
}

const log = (m: string): void => console.error(`[simbad] ${m}`);

/** Derive coarse catalog ids from a SIMBAD main_id like "M  42" / "NGC 1976" / "IC 434". */
function catalogIdsFromMainId(mainId: string): Record<string, string> {
  const ids: Record<string, string> = {};
  const norm = mainId.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = norm.match(/^M\s*(\d+)$/i))) ids.messier = `M${m[1]}`;
  else if ((m = norm.match(/^NGC\s*([0-9A-Z]+)$/i))) ids.ngc = `NGC ${m[1]}`;
  else if ((m = norm.match(/^IC\s*([0-9A-Z]+)$/i))) ids.ic = `IC ${m[1]}`;
  return ids;
}

const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export function createSimbadCatalogClient(opts: SimbadOptions = {}): CatalogClient {
  const base = opts.baseUrl ?? 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
  const objectLimit = opts.objectLimit ?? 100;
  const starLimit = opts.starLimit ?? 30;
  const starMagMax = opts.starMagMax ?? 6;

  async function tap(adql: string): Promise<TapResponse> {
    return ofetch<TapResponse>(base, {
      method: 'GET',
      responseType: 'json',
      query: { request: 'doQuery', lang: 'ADQL', format: 'json', query: adql },
      timeout: 30_000,
    });
  }

  function rows(res: TapResponse, withMag: boolean): CatalogCandidate[] {
    const col = (name: string): number => res.metadata.findIndex((m) => m.name === name);
    const iMain = col('main_id');
    const iRa = col('ra');
    const iDec = col('dec');
    const iOtype = col('otype');
    const iMaj = col('galdim_majaxis');
    const iMin = col('galdim_minaxis');
    const iV = withMag ? col('vmag') : -1;

    // SIMBAD null cells come back as JSON null; Number(null) === 0, so guard.
    const cell = (row: unknown[], i: number): number => {
      if (i < 0) return NaN;
      const v = row[i];
      return v == null ? NaN : Number(v);
    };

    const out: CatalogCandidate[] = [];
    for (const row of res.data) {
      const ra = cell(row, iRa);
      const dec = cell(row, iDec);
      if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
      const mainId = String(row[iMain] ?? '').trim();
      const maj = cell(row, iMaj);
      const min = cell(row, iMin);
      const v = cell(row, iV);
      out.push({
        main_id: mainId,
        names: mainId ? [mainId] : [],
        otype: String(row[iOtype] ?? '').trim(),
        ra_deg: ra,
        dec_deg: dec,
        size_arcmin: Number.isFinite(maj) ? [maj, Number.isFinite(min) ? min : maj] : undefined,
        mag: Number.isFinite(v) ? v : undefined,
        catalog_ids: catalogIdsFromMainId(mainId),
        source: 'SIMBAD',
      });
    }
    return out;
  }

  /** Fetch proper names ("NAME …") for the given main_ids → main_id → friendly name. */
  async function properNames(mainIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (mainIds.length === 0) return map;
    const inList = mainIds.map(sqlStr).join(', ');
    const adql = `SELECT b.main_id, i.id
FROM ident AS i JOIN basic AS b ON i.oidref = b.oid
WHERE b.main_id IN (${inList}) AND i.id LIKE 'NAME %'`;
    try {
      const res = await tap(adql);
      const c = res.metadata.map((m) => m.name);
      const im = c.indexOf('main_id');
      const ii = c.indexOf('id');
      for (const row of res.data) {
        const mid = String(row[im] ?? '').trim();
        const name = String(row[ii] ?? '').replace(/^NAME\s+/, '').trim();
        if (mid && name && !map.has(mid)) map.set(mid, name);
      }
    } catch {
      // names are a nicety — never fatal
    }
    return map;
  }

  async function region(q: RegionQuery): Promise<CatalogCandidate[]> {
    const circle = `CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${q.ra_deg}, ${q.dec_deg}, ${q.radius_deg})) = 1`;
    const circleB = `CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', ${q.ra_deg}, ${q.dec_deg}, ${q.radius_deg})) = 1`;
    const cols = 'main_id, ra, dec, otype, galdim_majaxis, galdim_minaxis';

    const objectsAdql = `SELECT TOP ${objectLimit} ${cols}
FROM basic
WHERE ${circle} AND ra IS NOT NULL AND galdim_majaxis IS NOT NULL
ORDER BY galdim_majaxis DESC`;

    const starsAdql = `SELECT TOP ${starLimit} b.main_id, b.ra, b.dec, b.otype, b.galdim_majaxis, b.galdim_minaxis, f."V" AS vmag
FROM basic AS b JOIN allfluxes AS f ON b.oid = f.oidref
WHERE ${circleB} AND b.ra IS NOT NULL AND f."V" < ${starMagMax}`;

    // Exciting stars (Wolf–Rayet …) — the central star of a wind bubble / HII
    // region. They're point sources (no galdim) and often fainter than the
    // bright-star cutoff, so neither query above catches them; fetch by otype
    // with no magnitude limit. LEFT JOIN so a missing V doesn't drop them.
    const excitingAdql = `SELECT TOP 10 b.main_id, b.ra, b.dec, b.otype, b.galdim_majaxis, b.galdim_minaxis, f."V" AS vmag
FROM basic AS b LEFT JOIN allfluxes AS f ON b.oid = f.oidref
WHERE ${circleB} AND b.ra IS NOT NULL AND b.otype IN ('WR*', 'WR?')`;

    // Curated landmarks (nickname overlay) — famous objects that the magnitude /
    // otype filters above miss (e.g. η Carinae at V≈6.5, beyond the bright-star
    // cutoff). Fetch by identifier within the cone, no mag/otype limit, so they
    // become candidates; selection force-keeps them. No-op if none in the field.
    const curatedIds = Object.keys(NICKNAMES)
      .map((k) => `'${k.replace(/'/g, "''")}'`)
      .join(', ');
    const curatedAdql = curatedIds
      ? `SELECT TOP 20 b.main_id, b.ra, b.dec, b.otype, b.galdim_majaxis, b.galdim_minaxis, f."V" AS vmag
FROM basic AS b LEFT JOIN allfluxes AS f ON b.oid = f.oidref JOIN ident AS i ON i.oidref = b.oid
WHERE ${circleB} AND b.ra IS NOT NULL AND i.id IN (${curatedIds})`
      : null;

    const [objRes, starRes, exRes, curRes] = await Promise.all([
      tap(objectsAdql),
      tap(starsAdql),
      tap(excitingAdql),
      curatedAdql ? tap(curatedAdql) : Promise.resolve(null),
    ]);
    const objects = rows(objRes, false);
    const stars = rows(starRes, true);
    const exciting = rows(exRes, true);
    const curated = curRes ? rows(curRes, true) : [];
    log(
      `region r=${q.radius_deg.toFixed(3)}° → ${objects.length} sized objects, ${stars.length} bright stars, ${exciting.length} exciting stars, ${curated.length} curated`,
    );

    // Merge, dedup by main_id (extended objects win on collision).
    const seen = new Set<string>();
    const merged: CatalogCandidate[] = [];
    for (const c of [...objects, ...stars, ...exciting, ...curated]) {
      const key = c.main_id || `${c.ra_deg},${c.dec_deg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }

    // Enrich with proper names (Antares, Pencil Nebula, …). The SIMBAD `NAME`
    // pseudo-catalog is the common name — keep it both as names[0] and as the
    // explicit `common_name.en` (main_id is the M/NGC designation, not the name).
    const names = await properNames(merged.map((c) => c.main_id).filter(Boolean));
    for (const c of merged) {
      const proper = names.get(c.main_id);
      if (proper) {
        if (!c.names.includes(proper)) c.names = [proper, ...c.names];
        c.common_name = { en: proper };
      }
    }
    return merged;
  }

  return { region };
}
