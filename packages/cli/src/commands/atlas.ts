import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { startAtlasServer } from '@astrolens/atlas';

export interface AtlasArgs {
  dataDir: string;
  port: number;
  open: boolean;
}

export async function atlas(args: AtlasArgs): Promise<void> {
  const dataDir = resolve(args.dataDir);
  const handle = await startAtlasServer({ dataDir, port: args.port });

  console.log(`astrolens feature-atlas tool running at ${handle.url}`);
  console.log(`Data dir: ${dataDir}`);
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
