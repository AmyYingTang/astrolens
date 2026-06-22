import { z } from 'zod';

/**
 * A simplified TAN (gnomonic) WCS — enough to project catalog coordinates onto
 * the display image. Shared by the identification stage (placement) and the
 * editor (debug grid) so both use identical math.
 *
 * ⚠ orientation/parity sign conventions are calibrated against real nova output;
 * the math here is internally consistent (worldToPixel ∘ pixelToWorld == id).
 */
export interface Wcs {
  ra0_deg: number; // CRVAL1 — center RA
  dec0_deg: number; // CRVAL2 — center Dec
  crpix_x: number; // reference pixel x (0-based)
  crpix_y: number; // reference pixel y (0-based)
  scale_deg: number; // degrees per pixel
  orientation_deg: number; // rotation of +Y axis, E of N
  parity: 1 | -1; // image parity
  width: number;
  height: number;
}

export const Wcs = z.object({
  ra0_deg: z.number(),
  dec0_deg: z.number(),
  crpix_x: z.number(),
  crpix_y: z.number(),
  scale_deg: z.number(),
  orientation_deg: z.number(),
  parity: z.union([z.literal(1), z.literal(-1)]),
  width: z.number(),
  height: z.number(),
});

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function gnomonic(ra0: number, dec0: number, ra: number, dec: number): [number, number] | null {
  const cosc =
    Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
  if (cosc <= 0) return null;
  const xi = (Math.cos(dec) * Math.sin(ra - ra0)) / cosc;
  const eta =
    (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosc;
  return [xi, eta];
}

function invGnomonic(ra0: number, dec0: number, xi: number, eta: number): [number, number] {
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return [ra0, dec0];
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(dec0) + (eta * Math.sin(c) * Math.cos(dec0)) / rho);
  const ra =
    ra0 +
    Math.atan2(
      xi * Math.sin(c),
      rho * Math.cos(dec0) * Math.cos(c) - eta * Math.sin(dec0) * Math.sin(c),
    );
  return [ra, dec];
}

function cd(w: Wcs): { a: number; b: number; c: number; d: number; s: number } {
  const th = w.orientation_deg * D2R;
  const s = w.scale_deg * D2R;
  return {
    a: w.parity * Math.cos(th),
    b: -Math.sin(th),
    c: w.parity * Math.sin(th),
    d: Math.cos(th),
    s,
  };
}

/** Project sky → pixel. Returns null if the point is behind the tangent plane.
 *  Image pixel y runs DOWN from the top, while the WCS/standard coords run with
 *  north up, so the y component is flipped about the reference pixel. */
export function worldToPixel(w: Wcs, ra_deg: number, dec_deg: number): [number, number] | null {
  const g = gnomonic(w.ra0_deg * D2R, w.dec0_deg * D2R, ra_deg * D2R, dec_deg * D2R);
  if (!g) return null;
  const [xi, eta] = g;
  const { a, b, c, d, s } = cd(w);
  const det = a * d - b * c;
  const u = xi / s;
  const v = eta / s;
  const dx = (d * u - b * v) / det;
  const dy = (-c * u + a * v) / det;
  return [w.crpix_x + dx, w.crpix_y - dy];
}

/** Project pixel → sky (degrees). Inverse of worldToPixel. */
export function pixelToWorld(w: Wcs, x: number, y: number): [number, number] {
  const { a, b, c, d, s } = cd(w);
  const dx = x - w.crpix_x;
  const dy = w.crpix_y - y;
  const xi = s * (a * dx + b * dy);
  const eta = s * (c * dx + d * dy);
  const [ra, dec] = invGnomonic(w.ra0_deg * D2R, w.dec0_deg * D2R, xi, eta);
  let raDeg = ra * R2D;
  raDeg = ((raDeg % 360) + 360) % 360;
  return [raDeg, dec * R2D];
}

/** Field radius (deg) from image center to a corner. */
export function fieldRadiusDeg(w: Wcs): number {
  return (Math.hypot(w.width, w.height) / 2) * w.scale_deg;
}
