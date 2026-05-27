import { z } from 'zod';
import { Feature, ObjectInfo } from '@astrolens/schema';

/** The portion of a Report the LLM is asked to produce. Tool-owned fields
 * (version, image dims, generator, timestamps) are filled in by the reader. */
export const LlmReading = z.object({
  language: z.enum(['zh', 'en']).optional(),
  object: ObjectInfo,
  narrative: z.string(),
  features: z.array(Feature),
  extra_facts: z.array(z.string()).default([]),
});
export type LlmReading = z.infer<typeof LlmReading>;

/** Strip markdown fences and any prose around the JSON object. */
export function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1]! : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return candidate.trim();
  }
  return candidate.slice(start, end + 1).trim();
}

export type ParseResult =
  | { ok: true; data: LlmReading }
  | { ok: false; error: string };

export function parseReading(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch (e) {
    return { ok: false, error: `JSON.parse failed: ${(e as Error).message}` };
  }
  const result = LlmReading.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.toString() };
  }
  return { ok: true, data: result.data };
}
