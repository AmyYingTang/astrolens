import { execa } from 'execa';

export interface RunClaudeOptions {
  prompt: string;
  model?: string;
  /** Override the binary, mainly for tests. */
  bin?: string;
}

/**
 * Invoke the user's `claude` CLI in non-interactive print mode and return its
 * final text output. The prompt itself tells Claude which image file to read,
 * so we allow the Read tool.
 */
export async function runClaude(opts: RunClaudeOptions): Promise<string> {
  const bin = opts.bin ?? 'claude';
  const args = ['-p', opts.prompt, '--allowedTools', 'Read'];
  if (opts.model) {
    args.push('--model', opts.model);
  }
  const { stdout } = await execa(bin, args, {
    stdin: 'ignore',
    // The model occasionally writes a long report; give it room.
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}
