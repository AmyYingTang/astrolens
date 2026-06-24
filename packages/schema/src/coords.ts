/**
 * Sexagesimal formatting for the human-facing display layer. Astronomers read
 * RA in HMS and Dec in DMS; internal matching/geometry stays decimal degrees.
 * These are presentation-only.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** Decimal RA degrees → "09h00m21s". */
export function formatRaHms(raDeg: number): string {
  const hours = (((raDeg % 360) + 360) % 360) / 15;
  let h = Math.floor(hours);
  let m = Math.floor((hours - h) * 60);
  let s = Math.round(((hours - h) * 60 - m) * 60);
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    h += 1;
  }
  if (h >= 24) h -= 24;
  return `${pad(h)}h${pad(m)}m${pad(s)}s`;
}

/** Decimal Dec degrees → "−45°56′58″" (U+2212 minus). */
export function formatDecDms(decDeg: number): string {
  const sign = decDeg < 0 ? '−' : '+';
  const a = Math.abs(decDeg);
  let deg = Math.floor(a);
  let m = Math.floor((a - deg) * 60);
  let s = Math.round(((a - deg) * 60 - m) * 60);
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    deg += 1;
  }
  return `${sign}${deg}°${pad(m)}′${pad(s)}″`;
}

/** "RA 09h00m21s · Dec −45°56′58″" for a coordinate pair. */
export function formatCoord(raDeg: number, decDeg: number): string {
  return `RA ${formatRaHms(raDeg)} · Dec ${formatDecDms(decDeg)}`;
}
