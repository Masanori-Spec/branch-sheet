import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { refresh } from './engine.mjs';
import { LIMITS, assert } from './limits.mjs';
import { bounded } from './io.mjs';

try {
  const args = process.argv.slice(2), map = args.shift(), options = {};
  assert(map && !map.startsWith('-'), 'Usage: node src/cli.mjs map.mm [--prior workbook.xlsx] --out refreshed.xlsx --report review.json');
  while (args.length) { const flag = args.shift(); assert(['--prior', '--out', '--report'].includes(flag) && !(flag in options) && args.length, 'Unknown or repeated option'); options[flag] = args.shift(); }
  assert(options['--out'] && options['--report'], 'Both --out and --report are required');
  const targets = [options['--out'], options['--report']].map(p => resolve(p));
  assert(new Set([...targets, resolve(map), ...(options['--prior'] ? [resolve(options['--prior'])] : [])]).size === targets.length + 1 + (options['--prior'] ? 1 : 0), 'Input and output paths must differ');
  const result = refresh(await bounded(map, LIMITS.mapBytes), options['--prior'] ? await bounded(options['--prior'], LIMITS.workbookBytes) : null);
  await writeFile(targets[0], result.workbook, { flag: 'wx' });
  await writeFile(targets[1], JSON.stringify(result.report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`Created ${result.data.active.length} active and ${result.data.removed.length} removed rows.\n`);
} catch (error) { process.stderr.write(`BranchSheet: ${error.message}\n`); process.exitCode = 1; }
