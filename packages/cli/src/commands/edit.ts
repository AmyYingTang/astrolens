import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { startEditorServer } from '@astrolens/editor';

export interface EditArgs {
  report: string;
  port: number;
  open: boolean;
}

export async function editReport(args: EditArgs): Promise<void> {
  const reportPath = resolve(args.report);
  const handle = await startEditorServer({ reportPath, port: args.port });

  console.log(`astrolens editor running at ${handle.url}`);
  console.log(`Editing: ${reportPath}`);
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
