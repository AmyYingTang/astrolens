import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Best-effort load of `KEY=VALUE` lines from a .env file in the current working
 * directory into process.env. Existing env vars win (so `export` / shell still
 * overrides the file). Zero-dependency; silently does nothing if there's no file.
 */
export function loadEnv(file = '.env'): void {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    return; // no .env file — fine
  }
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
