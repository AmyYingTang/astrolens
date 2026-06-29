import sharp from 'sharp';

/**
 * Class-B morphology detector — deterministic CV (no ML), ported from Amy's
 * validated reference `bclass_morphology.py` (BCLASS_HANDOFF.md). Reads a single
 * processed optical frame and extracts morphological features:
 *  - pillars (象鼻): elongated dark columns whose edge hugs an illuminated rim;
 *  - the bright-ridge layer (Sato/Hessian tubeness) is the rim *superset*.
 *
 * It emits GEOMETRY + a geometric category only — never a semantic identity.
 * "This is a pillar / shock / WR shell" is decided downstream by the type-anchor
 * stage (plate-solve → catalog type + 朝星 prior). Every feature is therefore a
 * `suggestion` with `label_semantic` left null, never a hard box.
 *
 * Validated against the Python oracle: reproduces its pillar counts within ±2 and
 * footprint fraction to 3 decimals (Carina/Pencil/NGC6357/NGC3576), ~5× faster.
 *
 * Pipeline (all on a 2× downsampled intensity = max(R,G,B)):
 *   destar (grey opening) → footprint mask (Otsu, loose dilate) →
 *     ├ bright-ridge layer (Sato, global %ile ∩ footprint)
 *     └ dark-column layer (local darkening, global %ile ∩ footprint)
 *           └ pair: elongated dark column edged by a bright rim → pillar + 迎光向量
 *
 * ⚠ The percentile thresholds are tuned on STRETCHED jpgs — a B-visual visual
 * approximation, not a surface-brightness measurement (no linear/per-channel data
 * in a finished frame). WCS-dependent steps (footprint seed, angular size, 朝星
 * filter) are a later phase; this module is the no-WCS core.
 */

// ---------------------------------------------------------------------------
// Tunables (PoC values from the reference, tuned on stretched DS2 jpgs).
// ---------------------------------------------------------------------------
export interface MorphParams {
  downsample: number;
  star_disk: number;
  sigma_neb: number;
  neb_min_size: number;
  neb_dilate: number;
  sigma_bg: number;
  p_rim: number;
  p_dark: number;
  p_bgmin: number;
  pair_dist: number;
  frac_min: number;
  elong_min: number;
  area_min: number;
  area_max: number;
}

export const DEFAULT_MORPH_PARAMS: MorphParams = {
  downsample: 2,
  star_disk: 6,
  sigma_neb: 30,
  neb_min_size: 8000,
  neb_dilate: 18,
  sigma_bg: 40,
  p_rim: 92,
  p_dark: 88,
  p_bgmin: 50,
  pair_dist: 7,
  frac_min: 0.18,
  elong_min: 1.9,
  area_min: 180,
  area_max: 9000,
};

/** Outreach selection — detection ≠ display. A poster wants a few tellable
 * subjects, so salience-rank → talkability gate → spatial spread → top-N. The
 * full detection set still lives in the result; only `selected_for_outreach`
 * flips. See BCLASS_HANDOFF.md §6.5. */
export interface SelectParams {
  top_n: number;
  w_scale: number;
  w_rim: number;
  w_isolation: number;
  /** Weight on centeredness — photographers frame the subject centrally, and an
   * edge feature reads as a stray. Full credit within 50% of frame-half, fading
   * to 0 by 75%. */
  w_center: number;
  /** Weight on solidity (a regular, filled shape over a ragged blob). */
  w_solidity: number;
  /** Weight on elongation (a clean finger-shaped pillar over a round clump). */
  w_elong: number;
  min_length_px: number;
  /** Drop pillars smaller than this (downsampled px²) — too small to read clearly. */
  min_area_px: number;
  /** Drop pillars more ragged than this solidity. */
  min_solidity: number;
  /** Hard exclude a feature whose centroid is past this fraction of the way to a
   * frame edge (0 = centre, 1 = edge) — keeps far strays out of the subject set. */
  max_edge_frac: number;
  grid: [number, number];
  per_cell: number;
}

export const DEFAULT_SELECT_PARAMS: SelectParams = {
  top_n: 3,
  w_scale: 0.3,
  w_rim: 0.1,
  w_isolation: 0.05,
  w_center: 0.35,
  w_solidity: 0.25,
  w_elong: 0.2,
  min_length_px: 40,
  min_area_px: 600,
  min_solidity: 0.55,
  max_edge_frac: 0.8,
  grid: [3, 3],
  per_cell: 2,
};

/** One detected morphological feature, in the downsampled grid's pixel space.
 * `label_semantic`/`display` are fixed by contract: geometry only, suggestion only. */
export interface MorphFeature {
  type: 'pillar';
  centroid_px: [number, number];
  contour_px: [number, number][];
  length_px: number;
  orientation_deg: number;
  elongation: number;
  area_px: number;
  /** Solidity = area / convex-hull area ∈ (0,1]. High = a clean filled shape; low
   * = a ragged / squiggly blob. Used to prefer regular pillars for outreach. */
  solidity: number;
  rim_coverage_frac: number;
  /** Direction (deg, image frame) from the column toward the bright rim ⇒ toward
   * the ionizing source. Verified against the exciting-star prior in the WCS phase. */
  illumination_vector_deg: number | null;
  /** The lit edge: the column's rim-side boundary points (grid px), ordered along
   * its major axis and subsampled — an outreach 示意 of the illuminated rim, not a
   * full rim map. Empty when no rim hugs the column. */
  rim_px: [number, number][];
  /** Photoevaporation prior (WCS phase): does the lit rim face an exciting star?
   * null = no prior applied (no exciting star / no WCS); true = consistent. Under
   * the hard filter only consistent pillars are emitted, so survivors are true. */
  consistent_with_prior: boolean | null;
  confidence: number;
  salience: number | null;
  selected_for_outreach: boolean;
  label_semantic: null;
  display: 'suggestion';
}

export interface MorphResult {
  features: MorphFeature[];
  /** Grid the `*_px` coords live in. Multiply by `downsample` for full-image px. */
  width: number;
  height: number;
  downsample: number;
  footprint_frac: number;
}

// ---------------------------------------------------------------------------
// Small numeric helpers (reflect-padded, matching scipy 'reflect').
// ---------------------------------------------------------------------------
const reflect = (p: number, n: number): number => {
  const q = p < 0 ? -p - 1 : p;
  return q >= n ? 2 * n - q - 1 : q;
};

function gaussianKernel(sigma: number): { r: number; k: Float64Array } {
  const r = Math.max(1, Math.round(4 * sigma));
  const s2 = sigma * sigma;
  const k = new Float64Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * s2));
    k[i + r] = v;
    s += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { r, k };
}

/** Separable convolution with possibly-different x/y kernels. */
function sepConv(
  src: Float32Array,
  w: number,
  h: number,
  kx: Float64Array,
  ky: Float64Array,
  r: number,
): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let k = -r; k <= r; k++) a += src[row + reflect(x + k, w)]! * kx[k + r]!;
      tmp[row + x] = a;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let a = 0;
      for (let k = -r; k <= r; k++) a += tmp[reflect(y + k, h) * w + x]! * ky[k + r]!;
      out[y * w + x] = a;
    }
  }
  return out;
}

function gaussian(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const { r, k } = gaussianKernel(sigma);
  return sepConv(src, w, h, k, k, r);
}

/** Gaussian + its 1st/2nd derivatives, for the Hessian (Sato). */
function derivKernels(sigma: number): {
  r: number;
  g: Float64Array;
  g1: Float64Array;
  g2: Float64Array;
} {
  const r = Math.round(4 * sigma);
  const s2 = sigma * sigma;
  const g = new Float64Array(2 * r + 1);
  const g1 = new Float64Array(2 * r + 1);
  const g2 = new Float64Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * s2));
    g[i + r] = v;
    s += v;
  }
  for (let i = 0; i < g.length; i++) g[i]! /= s;
  for (let i = -r; i <= r; i++) {
    g1[i + r] = (-i / s2) * g[i + r]!;
    g2[i + r] = ((i * i - s2) / (s2 * s2)) * g[i + r]!;
  }
  return { r, g, g1, g2 };
}

/** Sato bright-ridge tubeness, max over scales. Hessian via separable Gaussian
 * derivatives → 2×2 eigenvalues → |λ_max| where the largest-magnitude eigenvalue
 * is negative (a bright tube). Validated to IoU 0.91 vs skimage.filters.sato. */
function sato(d: Float32Array, w: number, h: number, sigmas: number[]): Float32Array {
  const n = w * h;
  const rim = new Float32Array(n);
  for (const sigma of sigmas) {
    const { r, g, g1, g2 } = derivKernels(sigma);
    const lxx = sepConv(d, w, h, g2, g, r);
    const lyy = sepConv(d, w, h, g, g2, r);
    const lxy = sepConv(d, w, h, g1, g1, r);
    const s2 = sigma * sigma;
    for (let i = 0; i < n; i++) {
      const a = lxx[i]!;
      const b = lxy[i]!;
      const c = lyy[i]!;
      const m = (a + c) / 2;
      const t = Math.sqrt(((a - c) / 2) ** 2 + b * b);
      const l1 = m + t;
      const l2 = m - t;
      const lhi = Math.abs(l1) >= Math.abs(l2) ? l1 : l2;
      const resp = lhi < 0 ? s2 * -lhi : 0;
      if (resp > rim[i]!) rim[i] = resp;
    }
  }
  return rim;
}

/** Linear-interpolated percentile, ~np.percentile. */
function percentile(arr: Float32Array, p: number): number {
  const a = Float32Array.from(arr);
  a.sort();
  const idxf = (p / 100) * (a.length - 1);
  const lo = Math.floor(idxf);
  const hi = Math.ceil(idxf);
  return a[lo]! + (a[hi]! - a[lo]!) * (idxf - lo);
}

/** Otsu threshold over the data range (256 bins), ~skimage.threshold_otsu. */
function otsu(arr: Float32Array): number {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of arr) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const bins = 256;
  const hist = new Float64Array(bins);
  const sc = (bins - 1) / (mx - mn || 1);
  for (const v of arr) hist[Math.round((v - mn) * sc)]!++;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 0;
  const tot = arr.length;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]!;
    if (!wB) continue;
    const wF = tot - wB;
    if (!wF) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = i;
    }
  }
  return mn + thr / sc;
}

// ---------------------------------------------------------------------------
// Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher),
// used for disk dilate/erode/closing — O(N), and a Euclidean disk matches the
// reference's disk structuring element closely.
// ---------------------------------------------------------------------------
function edt1d(f: Float64Array, n: number): Float64Array {
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
  return d;
}

/** Squared distance to the nearest pixel equal to `target`. */
function edt2(mask: Uint8Array, w: number, h: number, target: number): Float64Array {
  const INF = 1e12;
  const n = w * h;
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = mask[i] === target ? 0 : INF;
  const col = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = f[y * w + x]!;
    const d = edt1d(col, h);
    for (let y = 0; y < h; y++) f[y * w + x] = d[y]!;
  }
  const row = new Float64Array(w);
  const out = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = f[y * w + x]!;
    const d = edt1d(row, w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x]!;
  }
  return out;
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d = edt2(mask, w, h, 1);
  const r2 = r * r;
  const o = new Uint8Array(w * h);
  for (let i = 0; i < o.length; i++) o[i] = d[i]! <= r2 ? 1 : 0;
  return o;
}

function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d = edt2(mask, w, h, 0);
  const r2 = r * r;
  const o = new Uint8Array(w * h);
  for (let i = 0; i < o.length; i++) o[i] = d[i]! > r2 ? 1 : 0;
  return o;
}

const closing = (m: Uint8Array, w: number, h: number, r: number): Uint8Array =>
  erode(dilate(m, w, h, r), w, h, r);

// ---------------------------------------------------------------------------
// Grayscale opening (disk) for star removal: opening = dilate(erode), which
// strips bright blobs smaller than the disk (stars). NB the reference's
// `inten - white_tophat(inten)` reduces algebraically to exactly this opening.
// ---------------------------------------------------------------------------
function diskOffsets(r: number): Array<[number, number]> {
  const o: Array<[number, number]> = [];
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) o.push([i, j]);
  return o;
}

function greyErode(src: Float32Array, w: number, h: number, off: Array<[number, number]>): Float32Array {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let mn = Infinity;
      for (const [di, dj] of off) {
        const v = src[reflect(y + dj, h) * w + reflect(x + di, w)]!;
        if (v < mn) mn = v;
      }
      o[y * w + x] = mn;
    }
  return o;
}

function greyDilate(src: Float32Array, w: number, h: number, off: Array<[number, number]>): Float32Array {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let mx = -Infinity;
      for (const [di, dj] of off) {
        const v = src[reflect(y + dj, h) * w + reflect(x + di, w)]!;
        if (v > mx) mx = v;
      }
      o[y * w + x] = mx;
    }
  return o;
}

// ---------------------------------------------------------------------------
// Binary connected components (4-connectivity) + hole ops.
// ---------------------------------------------------------------------------
interface Labels {
  lab: Int32Array;
  sizes: number[];
  n: number;
}

function label4(mask: Uint8Array, w: number, h: number): Labels {
  const lab = new Int32Array(w * h);
  const sizes: number[] = [0];
  const st = new Int32Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] && !lab[i]) {
      n++;
      let sp = 0;
      st[sp++] = i;
      lab[i] = n;
      let cnt = 0;
      while (sp) {
        const p = st[--sp]!;
        cnt++;
        const x = p % w;
        const y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) {
          lab[p - 1] = n;
          st[sp++] = p - 1;
        }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) {
          lab[p + 1] = n;
          st[sp++] = p + 1;
        }
        if (y > 0 && mask[p - w] && !lab[p - w]) {
          lab[p - w] = n;
          st[sp++] = p - w;
        }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) {
          lab[p + w] = n;
          st[sp++] = p + w;
        }
      }
      sizes.push(cnt);
    }
  }
  return { lab, sizes, n };
}

function removeSmallObjects(mask: Uint8Array, w: number, h: number, min: number): Uint8Array {
  const { lab, sizes } = label4(mask, w, h);
  const o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = lab[i] && sizes[lab[i]!]! >= min ? 1 : 0;
  return o;
}

/** Fill regions of background not connected to the image border. */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const reached = new Uint8Array(w * h);
  const st: number[] = [];
  const push = (p: number): void => {
    if (!mask[p] && !reached[p]) {
      reached[p] = 1;
      st.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (st.length) {
    const p = st.pop()!;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = mask[i] || !reached[i] ? 1 : 0;
  return o;
}

function removeSmallHoles(mask: Uint8Array, w: number, h: number, area: number): Uint8Array {
  const filled = fillHoles(mask, w, h);
  const holes = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) holes[i] = filled[i] && !mask[i] ? 1 : 0;
  const { lab, sizes } = label4(holes, w, h);
  const o = Uint8Array.from(mask);
  for (let i = 0; i < w * h; i++) if (holes[i] && sizes[lab[i]!]! < area) o[i] = 1;
  return o;
}

// ---------------------------------------------------------------------------
// Moore-neighbor boundary tracing → an ordered (closed) contour polygon for a
// labeled region, subsampled every 3rd vertex (matching the reference overlay).
// ---------------------------------------------------------------------------
const MOORE: Array<[number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function traceContour(lab: Int32Array, l: number, w: number, h: number): Array<[number, number]> {
  const inRegion = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === l;
  // Start at the first region pixel in raster order.
  let sx = -1;
  let sy = -1;
  for (let i = 0; i < w * h && sx < 0; i++) {
    if (lab[i] === l) {
      sx = i % w;
      sy = (i / w) | 0;
    }
  }
  if (sx < 0) return [];
  const pts: Array<[number, number]> = [];
  let cx = sx;
  let cy = sy;
  let dir = 6; // came from the left → start searching upward
  const maxSteps = 8 * (w + h) + 16;
  for (let step = 0; step < maxSteps; step++) {
    pts.push([cx, cy]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (dir + 1 + k) % 8;
      const nx = cx + MOORE[nd]![0];
      const ny = cy + MOORE[nd]![1];
      if (inRegion(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = (nd + 4) % 8; // backtrack direction
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    if (cx === sx && cy === sy && pts.length > 2) break;
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i += 3) out.push(pts[i]!);
  return out;
}

/** Convex-hull area of a point set (Andrew's monotone chain) — for solidity. */
function convexHullArea(pts: Array<[number, number]>): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Array<[number, number]> = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, pt) <= 0) upper.pop();
    upper.push(pt);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    a += hull[i]![0] * hull[j]![1] - hull[j]![0] * hull[i]![1];
  }
  return Math.abs(a) / 2;
}

// ---------------------------------------------------------------------------
// Load: intensity = max(R,G,B) on a 2× box-averaged frame (matches PIL reduce).
// ---------------------------------------------------------------------------
async function loadIntensity(
  imagePath: string,
  ds: number,
): Promise<{ inten: Float32Array; w: number; h: number }> {
  const { data, info } = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const fw = info.width;
  const fh = info.height;
  const ch = info.channels;
  const w = Math.floor(fw / ds);
  const h = Math.floor(fh / ds);
  const inten = new Float32Array(w * h);
  const n = ds * ds;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < ds; j++)
        for (let i = 0; i < ds; i++) {
          const p = ((y * ds + j) * fw + (x * ds + i)) * ch;
          r += data[p]!;
          g += data[p + 1]!;
          b += data[p + 2]!;
        }
      inten[y * w + x] = Math.max(r, g, b) / n / 255;
    }
  return { inten, w, h };
}

// ---------------------------------------------------------------------------
// Detection pipeline.
// ---------------------------------------------------------------------------
export async function detectMorphology(
  imagePath: string,
  params: MorphParams = DEFAULT_MORPH_PARAMS,
): Promise<MorphResult> {
  const p = params;
  const { inten, w, h } = await loadIntensity(imagePath, p.downsample);

  // destar: grey opening (removes star points) + a touch of blur.
  const off = diskOffsets(p.star_disk);
  const d = gaussian(greyDilate(greyErode(inten, w, h, off), w, h, off), w, h, 0.8);

  // footprint: a loose spatial mask that only excludes sky/star field. Global
  // Otsu, then close + fill + drop small + dilate to include faint outer glow.
  const sm = gaussian(d, w, h, p.sigma_neb);
  const t = otsu(sm);
  let neb: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) neb[i] = sm[i]! > t ? 1 : 0;
  neb = closing(neb, w, h, 8);
  neb = fillHoles(neb, w, h);
  neb = removeSmallObjects(neb, w, h, p.neb_min_size);
  neb = dilate(neb, w, h, p.neb_dilate);

  // bright-ridge layer (rim superset). Global percentile, then ∩ footprint —
  // never recompute the threshold inside the mask (it would drop the faint rim).
  const rim = sato(d, w, h, [1, 2, 3, 4]);
  let mn = Infinity;
  for (const v of rim) if (v < mn) mn = v;
  const den = percentile(rim, 99.9) - mn || 1e-9;
  const rimNorm = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) rimNorm[i] = (rim[i]! - mn) / den;
  const rimThr = percentile(rimNorm, p.p_rim);
  const rimMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) rimMask[i] = rimNorm[i]! > rimThr && neb[i] ? 1 : 0;

  // dark-column layer (silhouette dust). Local darkening vs a smooth background.
  const bg = gaussian(d, w, h, p.sigma_bg);
  const dk = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dk[i] = Math.max(bg[i]! - d[i]!, 0);
  const pDark = percentile(dk, p.p_dark);
  const pBg = percentile(d, p.p_bgmin);
  let darkMask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) darkMask[i] = dk[i]! > pDark && bg[i]! > pBg && neb[i] ? 1 : 0;
  darkMask = closing(darkMask, w, h, 2);
  darkMask = removeSmallHoles(darkMask, w, h, 80);
  darkMask = removeSmallObjects(darkMask, w, h, 120);

  // pair: a dark column hugging a bright rim ⇒ pillar (#1 geometric prior + #4 CV).
  const rimDil = dilate(rimMask, w, h, p.pair_dist);
  const { lab, sizes, n } = label4(darkMask, w, h);
  const px: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < w * h; i++) if (lab[i]) px[lab[i]!]!.push(i);

  const features: MorphFeature[] = [];
  for (let l = 1; l <= n; l++) {
    const area = sizes[l]!;
    if (area < p.area_min || area > p.area_max) continue;
    const pts = px[l]!;
    let sx = 0;
    let sy = 0;
    for (const i of pts) {
      sx += i % w;
      sy += (i / w) | 0;
    }
    const cx = sx / area;
    const cy = sy / area;
    let m20 = 0;
    let m02 = 0;
    let m11 = 0;
    for (const i of pts) {
      const x = (i % w) - cx;
      const y = ((i / w) | 0) - cy;
      m20 += x * x;
      m02 += y * y;
      m11 += x * y;
    }
    m20 /= area;
    m02 /= area;
    m11 /= area;
    const com = Math.sqrt((m20 - m02) ** 2 + 4 * m11 * m11);
    const l1 = (m20 + m02) / 2 + com / 2;
    const l2 = (m20 + m02) / 2 - com / 2;
    const major = 4 * Math.sqrt(Math.max(l1, 0));
    const minor = 4 * Math.sqrt(Math.max(l2, 1e-9));
    const elong = major / minor;

    // edge pixels of the column, and how much of that edge touches the rim.
    const region = new Set(pts);
    let edge = 0;
    let edgeHit = 0;
    const exs: number[] = [];
    const eys: number[] = [];
    for (const i of pts) {
      const x = i % w;
      const y = (i / w) | 0;
      let isEdge = false;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as Array<[number, number]>) {
        const nx = x + di;
        const ny = y + dj;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!region.has(j)) {
          isEdge = true;
          if (rimDil[j]) {
            edgeHit++;
            exs.push(nx);
            eys.push(ny);
          }
          break;
        }
      }
      if (isEdge) edge++;
    }
    const frac = edgeHit / Math.max(edge, 1);
    if (frac < p.frac_min || elong < p.elong_min) continue;

    let illum: number | null = null;
    let rim_px: [number, number][] = [];
    if (exs.length) {
      const mx = exs.reduce((a, b) => a + b, 0) / exs.length;
      const my = eys.reduce((a, b) => a + b, 0) / eys.length;
      illum = (Math.atan2(my - cy, mx - cx) * 180) / Math.PI;
      // Order the lit-edge points along the column's major axis + subsample, so
      // they draw as a short rim segment rather than a scatter.
      const ang = 0.5 * Math.atan2(2 * m11, m20 - m02);
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      const ordered = exs
        .map((x, idx) => ({ x, y: eys[idx]!, t: x * ux + eys[idx]! * uy }))
        .sort((a, b) => a.t - b.t);
      const step = Math.max(1, Math.floor(ordered.length / 12));
      rim_px = ordered.filter((_, idx) => idx % step === 0).map((q) => [q.x, q.y] as [number, number]);
    }
    const contour = traceContour(lab, l, w, h);
    const hullA = convexHullArea(contour);
    features.push({
      type: 'pillar',
      centroid_px: [cx, cy],
      contour_px: contour,
      length_px: major,
      orientation_deg: (0.5 * Math.atan2(2 * m11, m20 - m02) * 180) / Math.PI,
      elongation: elong,
      area_px: area,
      solidity: hullA > 0 ? Math.min(1, area / hullA) : 0,
      rim_coverage_frac: frac,
      illumination_vector_deg: illum,
      rim_px,
      consistent_with_prior: null,
      confidence: Math.min(1, 0.4 + 0.6 * frac),
      salience: null,
      selected_for_outreach: false,
      label_semantic: null,
      display: 'suggestion',
    });
  }

  const footprint_frac = neb.reduce((a, b) => a + b, 0) / (w * h);
  return { features, width: w, height: h, downsample: p.downsample, footprint_frac };
}

/** Outreach top-N: salience rank → talkability gate → grid spread. Mutates the
 * features' `salience` / `selected_for_outreach` and returns the chosen subset. */
export function selectForOutreach(
  res: MorphResult,
  s: SelectParams = DEFAULT_SELECT_PARAMS,
): MorphFeature[] {
  const feats = res.features;
  if (!feats.length) return [];
  const amax = Math.max(...feats.map((f) => f.area_px)) || 1;
  const maxDim = Math.max(res.width, res.height);
  const cxF = res.width / 2;
  const cyF = res.height / 2;
  const scored: MorphFeature[] = [];
  for (const f of feats) {
    // Talkability gates: large + regular enough to read clearly as a pillar.
    if (f.length_px < s.min_length_px) continue;
    if (f.area_px < s.min_area_px) continue;
    if (f.solidity < s.min_solidity) continue;
    // Edge fraction: 0 at the frame centre, 1 at an edge. Drop far strays.
    const edge = Math.max(Math.abs(f.centroid_px[0] - cxF) / cxF, Math.abs(f.centroid_px[1] - cyF) / cyF);
    if (edge > s.max_edge_frac) continue;
    const center = edge <= 0.5 ? 1 : Math.max(0, (0.75 - edge) / 0.25);
    let nearest = Infinity;
    for (const g of feats) {
      if (g === f) continue;
      const dd = Math.hypot(g.centroid_px[0] - f.centroid_px[0], g.centroid_px[1] - f.centroid_px[1]);
      if (dd < nearest) nearest = dd;
    }
    const iso = Number.isFinite(nearest) ? Math.min((nearest / maxDim) ** 0.5, 1) : 1;
    // Elongation credit: 0 at elong 2 (round), 1 by elong 4+ (a clean finger).
    const elongScore = Math.min(1, Math.max(0, (f.elongation - 2) / 2));
    f.salience =
      s.w_scale * (f.area_px / amax) +
      s.w_rim * f.rim_coverage_frac +
      s.w_isolation * iso +
      s.w_center * center +
      s.w_solidity * f.solidity +
      s.w_elong * elongScore;
    scored.push(f);
  }
  scored.sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));
  const [gh, gw] = s.grid;
  const cell = new Map<string, number>();
  const picked: MorphFeature[] = [];
  for (const f of scored) {
    const k = `${Math.floor((f.centroid_px[1] / res.height) * gh)},${Math.floor((f.centroid_px[0] / res.width) * gw)}`;
    const c = cell.get(k) ?? 0;
    if (c >= s.per_cell) continue;
    cell.set(k, c + 1);
    f.selected_for_outreach = true;
    picked.push(f);
    if (picked.length >= s.top_n) break;
  }
  return picked;
}

/**
 * Photoevaporation prior — a real pillar's illuminated rim faces the ionizing
 * source, so its lit edge should point roughly at an exciting star. HARD filter:
 * drop pillars whose illumination vector misses the nearest exciting star by more
 * than `toleranceDeg`; survivors are flagged `consistent_with_prior`. This is also
 * what suppresses non-pillar dark features (e.g. the Keyhole) whose geometry
 * doesn't obey the prior. With no exciting star (no WCS / none in the field) the
 * prior can't be applied, so the set passes through unchanged — the honest
 * no-anchor fallback. `stars` are full-image pixels; centroids scale by downsample.
 */
export function applyIlluminationPrior(
  res: MorphResult,
  stars: Array<[number, number]>,
  toleranceDeg = 55,
): MorphResult {
  if (!stars.length) return res;
  const ds = res.downsample;
  const kept = res.features.filter((f) => {
    if (f.illumination_vector_deg == null) {
      f.consistent_with_prior = false;
      return false;
    }
    const cx = f.centroid_px[0] * ds;
    const cy = f.centroid_px[1] * ds;
    let best = Infinity;
    let star = stars[0]!;
    for (const s of stars) {
      const d = Math.hypot(s[0] - cx, s[1] - cy);
      if (d < best) {
        best = d;
        star = s;
      }
    }
    const starAngle = (Math.atan2(star[1] - cy, star[0] - cx) * 180) / Math.PI;
    const diff = Math.abs(((f.illumination_vector_deg - starAngle + 540) % 360) - 180);
    f.consistent_with_prior = diff <= toleranceDeg;
    return f.consistent_with_prior;
  });
  return { ...res, features: kept };
}
