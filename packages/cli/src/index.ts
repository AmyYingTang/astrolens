#!/usr/bin/env node
import { cac } from 'cac';
import { TOOL_VERSION } from './version.js';
import { readReport } from './commands/read.js';
import { renderReport } from './commands/render.js';
import { editReport } from './commands/edit.js';

const cli = cac('astrolens');

cli
  .command('read <image>', 'Generate a reading report from a deep-sky image')
  .option('--hint <name>', 'Object name hint, e.g. "Sh2-308"')
  .option('--lang <lang>', 'Output language: zh or en', { default: 'zh' })
  .option('--out <dir>', 'Output directory', { default: '.' })
  .option('--model <model>', 'Model passed to the claude CLI')
  .option('--no-simbad', 'Skip SIMBAD distance/size enrichment')
  .action(async (image: string, options) => {
    await readReport({
      image,
      hint: options.hint,
      lang: options.lang,
      out: options.out,
      model: options.model,
      simbad: options.simbad,
    });
  });

cli
  .command('render <report>', 'Render a report.json to image / embed / poster')
  .option('--format <format>', 'annotated | embed | poster | all', { default: 'annotated' })
  .option('--out <dir>', 'Output directory (default: the report directory)')
  .action(async (report: string, options) => {
    await renderReport({ report, format: options.format, out: options.out });
  });

cli
  .command('edit <report>', 'Open the local editor for a report.json')
  .option('--port <port>', 'Port to serve on', { default: 3000 })
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (report: string, options) => {
    await editReport({ report, port: Number(options.port), open: options.open });
  });

cli.help();
cli.version(TOOL_VERSION);

async function main(): Promise<void> {
  try {
    cli.parse(process.argv, { run: false });
    await cli.runMatchedCommand();
  } catch (err) {
    console.error(`astrolens: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

void main();
