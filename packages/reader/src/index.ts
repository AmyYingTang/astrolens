import { Reading, categoryColorKey, otypeLabel } from '@astrolens/schema';
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

/** Pick a display label: proper name → Messier/NGC/IC → star designation → type. */
function displayLabel(obj: FactObject): LocalizedString {
  // 1. a friendly proper name (Antares, Sh 2-308 …)
  const n = obj.names[0] ?? '';
  if (n && !JUNK_NAME.test(n)) return { zh: n, en: n };
  // 2. a canonical catalogue id
  const id = obj.catalog_ids.messier || obj.catalog_ids.ngc || obj.catalog_ids.ic;
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

  // Only A-class (catalog-grounded) objects become rendered circles for now;
  // Class-B morphological features live in the factsheet + Facts panel but are
  // not drawn on the canvas yet (anchor/arrow rendering is a later slice).
  const aObjects = factsheet.objects.filter((o) => o.tier !== 'B');
  const primary = aObjects[0]!;
  const features = aObjects.map((obj, i) => {
    const t = byId.get(obj.id);
    const center = obj.coord.pixel ?? [Math.round(width / 2), Math.round(height / 2)];
    return {
      id: obj.id,
      fact_ref: { object_id: obj.id, feature_id: obj.id },
      label: displayLabel(obj),
      color_key: categoryColorKey(obj.category),
      circle: { cx: center[0]!, cy: center[1]!, r: radiusFor(obj) },
      badge: { num: String(i + 1), offset_x: 0, offset_y: 0, bubble_r: bubbleR },
      explanation: t?.explanation ?? { zh: '', en: '' },
      physics: t?.physics,
      interesting: t?.interesting,
      needs_human_review: obj.coord.pixel == null,
    };
  });

  return Reading.parse({
    version: '2.0',
    source_factsheet: { hash: factsheet.image.hash },
    image: { src: opts.imageSrc ?? factsheet.image.src, width, height },
    display_language: opts.displayLanguage ?? 'zh',
    tone: opts.tone,
    object: {
      name: displayLabel(primary).zh,
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
    headline: reading.object.name,
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
