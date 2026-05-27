import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { startStudioServer } from '@astrolens/editor';
import { TOOL_VERSION } from '../version.js';

export interface StudioArgs {
  workspace: string;
  port: number;
  open: boolean;
}

export async function studio(args: StudioArgs): Promise<void> {
  const workspace = resolve(args.workspace);
  const handle = await startStudioServer({ workspace, port: args.port, toolVersion: TOOL_VERSION });

  console.log(`astrolens studio running at ${handle.url}`);
  console.log(`Workspace: ${workspace}`);
  console.log('Press Ctrl+C to stop.');

  if (args.open) {
    spawn('open', [handle.url], { stdio: 'ignore', detached: true }).unref();
  }

  const shutdown = (): void => {
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
