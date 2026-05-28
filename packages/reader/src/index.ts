import { Report } from '@astrolens/schema';
import { buildReaderPrompt } from './prompt.js';
import { runClaude, type RunClaudeOptions } from './claudeCli.js';
import { parseReading } from './parseJson.js';
import { lookupSimbad, type SimbadFacts } from './simbad.js';

export { buildReaderPrompt } from './prompt.js';
export { runClaude } from './claudeCli.js';
export { parseReading, extractJson, LlmReading } from './parseJson.js';
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

export interface GenerateReportOptions {
  imagePath: string; // absolute path to the source image
  width: number;
  height: number;
  hint?: string;
  lang: 'zh' | 'en';
  /** Optional extra instructions (tone/audience/focus) appended to the prompt. */
  style?: string;
  toolVersion: string;
  model?: string;
  /** Relative path stored in report.image.src. Defaults to "image.jpg". */
  imageSrc?: string;
  /** Enrich object facts via SIMBAD. Defaults to true; never fatal. */
  simbad?: boolean;
  // --- injectable seams for tests ---
  runner?: (opts: RunClaudeOptions) => Promise<string>;
  simbadLookup?: (name: string) => Promise<SimbadFacts>;
}

export async function generateReport(opts: GenerateReportOptions): Promise<Report> {
  const runner = opts.runner ?? runClaude;
  const basePrompt = buildReaderPrompt({
    imagePath: opts.imagePath,
    width: opts.width,
    height: opts.height,
    hint: opts.hint,
    lang: opts.lang,
    style: opts.style,
  });

  let raw = await runner({ prompt: basePrompt, model: opts.model });
  let parsed = parseReading(raw);

  if (!parsed.ok) {
    const note =
      opts.lang === 'en'
        ? `\n\nYour previous output could not be parsed. Error:\n${parsed.error}\nOutput ONLY the corrected JSON.`
        : `\n\n上一次输出无法解析,错误如下,请只输出修正后的 JSON:\n${parsed.error}`;
    raw = await runner({ prompt: basePrompt + note, model: opts.model });
    parsed = parseReading(raw);
  }

  if (!parsed.ok) {
    throw new ReaderError(
      `Failed to parse a valid reading from claude output after one retry: ${parsed.error}`,
      raw,
    );
  }

  const reading = parsed.data;
  let object = reading.object;

  if (opts.simbad !== false) {
    const lookup = opts.simbadLookup ?? lookupSimbad;
    const facts = await lookup(object.name);
    object = {
      ...object,
      distance_ly: object.distance_ly ?? facts.distance_ly,
      size_arcmin: object.size_arcmin ?? facts.size_arcmin,
    };
  }

  return Report.parse({
    version: '1.0',
    image: { src: opts.imageSrc ?? 'image.jpg', width: opts.width, height: opts.height },
    language: reading.language ?? opts.lang,
    object,
    narrative: reading.narrative,
    features: reading.features,
    extra_facts: reading.extra_facts,
    created_at: new Date().toISOString(),
    generator: { tool: 'astrolens', tool_version: opts.toolVersion, llm: opts.model ?? 'claude' },
  });
}
