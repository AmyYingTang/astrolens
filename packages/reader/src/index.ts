import { Reading, categoryColorKey, featureColorKey, otypeLabel } from '@astrolens/schema';
import type { FactSheet, FactObject, LocalizedString } from '@astrolens/schema';
import { buildTailorPrompt } from './prompt.js';
import { runClaude, type RunClaudeOptions } from './claudeCli.js';
import { parseTailoring, type LlmTailoring } from './parseJson.js';

export { buildTailorPrompt } from './prompt.js';
export { runClaude } from './claudeCli.js';
export { parseTailoring, extractJson, LlmTailoring } from './parseJson.js';
export { lookupSimbad, parseSimbadAscii, type SimbadFacts } from './simbad.js';

export class ReaderError extends Error {
  /** Raw claude output, attached when parsing failed, for debugging. */
  readonly raw?: string;
  constructor(message: string, raw?: string) {
    super(message);
    this.name = 'ReaderError';
    this.raw = raw;
  }
}

export interface GenerateReadingOptions {
  toolVersion: string;
  tone?: string;
  model?: string;
  displayLanguage?: 'zh' | 'en';
  imagePath?: string;
  imageSrc?: string;
  runner?: (opts: RunClaudeOptions) => Promise<string>;
}

const PC_TO_LY = 3.26156;
const UNIT_TO_LY: Record<string, number> = {
  pc: PC_TO_LY,
  kpc: PC_TO_LY * 1000,
  Mpc: PC_TO_LY * 1_000_000,
  ly: 1,
};

function distanceToLy(d?: { value: number; unit: string }): number | undefined {
  if (!d) return undefined;
  const k = UNIT_TO_LY[d.unit];
  return k ? Math.round(d.value * k) : undefined;
}

/** Survey designations that aren't human-friendly labels. */
const JUNK_NAME = /^(\[|2MASX\b|LEDA\b|PGCC\b|TGU\b|GSC\b|UCAC|Gaia |TYC |HD |HIP |SAO |\* )/;

/** Pick a display label: common name → proper name → designation → type. */
function displayLabel(obj: FactObject): LocalizedString {
  // 0. the common name wins (Pencil Nebula / 铅笔星云) — the whole point of the
  //    cross-ID work. en from SIMBAD NAME, zh from Wikidata (may be one-sided).
  const cn = obj.common_name;
  if (cn && (cn.en || cn.zh)) {
    return { zh: cn.zh ?? cn.en!, en: cn.en ?? cn.zh! };
  }
  // 1. a friendly proper name (Antares, Sh 2-308 …)
  const n = obj.names[0] ?? '';
  if (n && !JUNK_NAME.test(n)) return { zh: n, en: n };
  // 2. a canonical catalogue designation
  const id =
    (obj.designations ?? [])[0] ??
    obj.catalog_ids.messier ??
    obj.catalog_ids.ngc ??
    obj.catalog_ids.ic;
  if (id) return { zh: id, en: id };
  // 3. a star's designation still says *which* star (HD 50896, alf Sco) — better
  //    than a bare type; drop SIMBAD's leading "* " and collapse double spaces.
  if (obj.category === 'star' && n) {
    const desig = n.replace(/^\*\s+/, '').replace(/\s+/g, ' ').trim();
    if (desig) return { zh: desig, en: desig };
  }
  // 4. last resort: the specific type gloss for stars, else the category label
  const gloss = obj.category === 'star' ? otypeLabel(obj.type.otype) : null;
  return gloss ?? { zh: obj.type.zh, en: obj.type.en };
}

interface TailoredText {
  explanation: LocalizedString;
  physics?: LocalizedString;
  interesting?: LocalizedString;
}

interface BuildOptions {
  toolVersion: string;
  tone?: string;
  displayLanguage?: 'zh' | 'en';
  imageSrc?: string;
  llm: string;
}

const BADGE_ANCHOR = 0.7071;

interface Spreadable {
  circle: { cx: number; cy: number; r: number };
  badge: { offset_x: number; offset_y: number; bubble_r: number };
}

/** Push overlapping badge anchors apart (so labels don't pile up), writing the
 * delta into each badge's offset. The badge anchor mirrors the renderer's. */
function spreadBadges(features: Spreadable[], width: number, height: number): void {
  const pts = features.map((f) => {
    const ax = f.circle.cx + (f.circle.r + f.badge.bubble_r) * BADGE_ANCHOR;
    const ay = f.circle.cy - (f.circle.r + f.badge.bubble_r) * BADGE_ANCHOR;
    return { x: ax, y: ay, r: f.badge.bubble_r, ax, ay };
  });
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = (a.r + b.r) * 1.35;
        if (d < min) {
          if (d < 1) {
            dx = Math.cos(i + j);
            dy = Math.sin(i + j);
            d = 1;
          }
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
  }
  features.forEach((f, i) => {
    const p = pts[i]!;
    const bx = Math.max(p.r, Math.min(width - p.r, p.x));
    const by = Math.max(p.r, Math.min(height - p.r, p.y));
    f.badge.offset_x = Math.round(bx - p.ax);
    f.badge.offset_y = Math.round(by - p.ay);
  });
}

/**
 * Deterministic factsheet → Reading. Each catalogued object becomes one
 * annotation: a circle sized by its angular diameter (stars get a small fixed
 * marker), placed by its grounded pixel, colored by category, labeled by a
 * friendly name. Explanatory text comes from `byId`/`narrative` (LLM, or empty
 * for a facts-only stub).
 */
function buildReading(
  factsheet: FactSheet,
  narrative: LocalizedString,
  byId: Map<string, TailoredText>,
  opts: BuildOptions,
): Reading {
  const { width, height } = factsheet.image;
  const pixscale = factsheet.solve.pixscale_arcsec; // arcsec/px
  const bubbleR = Math.max(24, Math.round(Math.min(width, height) / 40));
  const starR = Math.max(20, Math.round(Math.min(width, height) / 60));

  const maxR = Math.min(width, height) * 0.2; // a circle shouldn't dominate the frame
  const radiusFor = (obj: FactObject): number => {
    if (obj.size_arcmin && pixscale) {
      const r = (obj.size_arcmin[0] * 60) / pixscale / 2; // arcmin → arcsec → px → radius
      return Math.max(starR, Math.min(maxR, Math.round(r)));
    }
    return starR;
  };

  // A-class objects → solid circles. Class-B: a *shell* is marked with a small
  // dashed sample circle placed on a point of its rim (not a ring around the
  // whole thing); a *front* is a direction arrow toward the A anchor.
  const maxArrow = Math.min(width, height) * 0.15;
  const sampleR = Math.max(starR, Math.round(Math.min(width, height) / 30));
  const byObjId = new Map(factsheet.objects.map((o) => [o.id, o]));
  const aObjects = factsheet.objects.filter((o) => o.tier !== 'B');
  const primary = aObjects[0]!;

  const features = factsheet.objects.map((obj, i) => {
    const t = byId.get(obj.id);
    const base = obj.coord.pixel ?? [Math.round(width / 2), Math.round(height / 2)];
    const isB = obj.tier === 'B';
    const shape: 'circle' | 'shell' | 'arrow' = !isB
      ? 'circle'
      : obj.feature_type === 'bubble_shell'
        ? 'shell'
        : 'arrow';
    const cx = base[0]!;
    const cy = base[1]!;
    // A shell is a small sample circle; its coord.pixel was already snapped onto
    // the (bright) rim in Stage 1, so just draw a small circle there.
    let r = shape === 'shell' ? sampleR : radiusFor(obj);
    let arrow_to: [number, number] | undefined;
    if (shape === 'arrow') {
      r = starR;
      const ap = obj.localization?.anchor_ref
        ? byObjId.get(obj.localization.anchor_ref)?.coord.pixel
        : null;
      if (ap) {
        const dx = ap[0] - cx;
        const dy = ap[1] - cy;
        const d = Math.hypot(dx, dy) || 1;
        const len = Math.min(d, maxArrow);
        arrow_to = [Math.round(cx + (dx / d) * len), Math.round(cy + (dy / d) * len)];
      }
    }
    return {
      id: obj.id,
      fact_ref: { object_id: obj.id, feature_id: obj.id },
      label: isB ? { zh: obj.type.zh, en: obj.type.en } : displayLabel(obj),
      color_key: obj.feature_type ? featureColorKey(obj.feature_type) : categoryColorKey(obj.category),
      circle: { cx, cy, r },
      shape,
      ...(arrow_to ? { arrow_to } : {}),
      badge: { num: String(i + 1), offset_x: 0, offset_y: 0, bubble_r: bubbleR },
      explanation: t?.explanation ?? { zh: '', en: '' },
      physics: t?.physics,
      interesting: t?.interesting,
      needs_human_review: isB ? obj.needs_human_review : obj.coord.pixel == null,
    };
  });

  // Spread badges so they don't pile up when objects cluster near frame centre.
  // Each badge starts just outside its circle (up-right); push overlapping ones
  // apart, then store the delta as the badge offset (the user can still nudge).
  spreadBadges(features, width, height);

  return Reading.parse({
    version: '2.0',
    source_factsheet: { hash: factsheet.image.hash },
    image: { src: opts.imageSrc ?? factsheet.image.src, width, height },
    display_language: opts.displayLanguage ?? 'zh',
    tone: opts.tone,
    object: {
      name: displayLabel(primary),
      aliases: primary.names.slice(1),
      type: { zh: primary.type.zh, en: primary.type.en },
      distance_ly: distanceToLy(primary.distance),
      size_arcmin: primary.size_arcmin?.[0],
    },
    narrative,
    features,
    extra_facts: [],
    created_at: new Date().toISOString(),
    generator: { tool: 'astrolens', tool_version: opts.toolVersion, llm: opts.llm },
  });
}

/**
 * Facts-only stub: a Reading built straight from the FactSheet with NO LLM —
 * grounded circles/colors/labels but empty explanations. Lets the studio show
 * the identification result (placement + Facts panel) without calling claude.
 */
export function readingFromFactsheet(
  factsheet: FactSheet,
  opts: { toolVersion: string; displayLanguage?: 'zh' | 'en'; imageSrc?: string },
): Reading {
  if (!factsheet.objects.some((o) => o.tier !== 'B')) {
    throw new ReaderError(
      `FactSheet has no grounded objects (solve=${factsheet.solve.status}); nothing to show.`,
    );
  }
  return buildReading(factsheet, { zh: '', en: '' }, new Map(), {
    toolVersion: opts.toolVersion,
    displayLanguage: opts.displayLanguage,
    imageSrc: opts.imageSrc,
    llm: 'none (facts-only)',
  });
}

/** Run the LLM and parse its JSON, retrying with the parse error fed back (up to 3 attempts). */
async function runTailoring(
  runner: (o: RunClaudeOptions) => Promise<string>,
  basePrompt: string,
  model: string | undefined,
): Promise<{ data?: LlmTailoring; raw: string; error: string }> {
  let raw = '';
  let error = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\n上一次输出无法解析为合法 JSON,错误:\n${error}\n请只输出修正后的、严格合法的 JSON(转义字符串内的引号与换行,不要任何多余文字)。`;
    raw = await runner({ prompt, model });
    const parsed = parseTailoring(raw);
    if (parsed.ok) return { data: parsed.data, raw, error: '' };
    error = parsed.error;
  }
  return { raw, error };
}

/**
 * Stage 2 on an EXISTING reading: ask the LLM to write bilingual explanatory
 * text for the annotations that are already there (preserving the human-reviewed
 * circles, labels and colors). Used by the editor's "generate reading" action.
 */
export async function tailorReading(
  reading: Reading,
  opts: { model?: string; imagePath?: string; tone?: string; runner?: (o: RunClaudeOptions) => Promise<string> },
): Promise<Reading> {
  if (reading.features.length === 0) {
    throw new ReaderError('Reading has no annotations to explain.');
  }
  const runner = opts.runner ?? runClaude;
  const prompt = buildTailorPrompt({
    headline: `${reading.object.name.zh} / ${reading.object.name.en}`,
    items: reading.features.map((f) => ({
      id: f.id,
      name: `${f.label.zh} / ${f.label.en}`,
      type: f.color_key,
    })),
    imagePath: opts.imagePath,
    tone: opts.tone,
  });

  const { data, raw, error } = await runTailoring(runner, prompt, opts.model);
  if (!data) {
    throw new ReaderError(`Failed to parse tailoring after retries: ${error}`, raw);
  }

  const byId = new Map(data.features.map((f) => [f.id, f]));
  return Reading.parse({
    ...reading,
    tone: opts.tone ?? reading.tone,
    narrative: data.narrative,
    features: reading.features.map((f) => {
      const t = byId.get(f.id);
      return {
        ...f,
        explanation: t?.explanation ?? f.explanation,
        physics: t?.physics ?? f.physics,
        interesting: t?.interesting ?? f.interesting,
      };
    }),
    edited_at: new Date().toISOString(),
  });
}

/**
 * Stage 2: consume a grounded FactSheet, ask the LLM to tailor bilingual
 * explanatory text onto its objects, and assemble a Reading. The LLM never
 * supplies identity, geometry or color — only the explanatory prose.
 */
export async function generateReading(
  factsheet: FactSheet,
  opts: GenerateReadingOptions,
): Promise<Reading> {
  // Only A-class objects are tailored/rendered for now; Class-B features are
  // surfaced in the Facts panel but not yet explained or drawn.
  const aObjects = factsheet.objects.filter((o) => o.tier !== 'B');
  const primary = aObjects[0];
  if (!primary) {
    throw new ReaderError(
      `FactSheet has no grounded objects (solve=${factsheet.solve.status}); nothing to tailor.`,
    );
  }

  const runner = opts.runner ?? runClaude;
  const prompt = buildTailorPrompt({
    headline: displayLabel(primary).zh,
    items: aObjects.map((obj) => {
      const l = displayLabel(obj);
      return { id: obj.id, name: `${l.zh} / ${l.en}`, type: obj.type.en };
    }),
    imagePath: opts.imagePath,
    tone: opts.tone,
  });

  const { data, raw, error } = await runTailoring(runner, prompt, opts.model);
  if (!data) {
    throw new ReaderError(`Failed to parse tailoring after retries: ${error}`, raw);
  }

  const byId = new Map<string, TailoredText>(data.features.map((f) => [f.id, f]));
  return buildReading(factsheet, data.narrative, byId, {
    toolVersion: opts.toolVersion,
    tone: opts.tone,
    displayLanguage: opts.displayLanguage,
    imageSrc: opts.imageSrc,
    llm: opts.model ?? 'claude',
  });
}
