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
  try {
    const { stdout } = await execa(bin, args, {
      stdin: 'ignore',
      // The model occasionally writes a long report; give it room.
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; shortMessage?: string; message?: string; code?: string };
    const out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    if (err.code === 'ENOENT') {
      throw new Error('The `claude` CLI was not found on PATH. Install Claude Code so `claude` is runnable.');
    }
    // An auth failure is a login problem, not an identification error — say so
    // plainly instead of surfacing a wall of 401 JSON + the whole prompt.
    if (/\b401\b|authenticat|invalid (?:auth|credential)/i.test(out)) {
      throw new Error(
        'The `claude` CLI could not authenticate — this is a login issue, not an identification error. ' +
          'Launch the server from a terminal where you are logged in to Claude Code (test with `claude -p "say OK"`), ' +
          'or set a valid ANTHROPIC_API_KEY, then restart.',
      );
    }
    throw new Error(
      `The \`claude\` CLI failed: ${err.shortMessage ?? err.message ?? 'unknown error'}` +
        (out.trim() ? `\n${out.trim().slice(0, 400)}` : ''),
    );
  }
}
