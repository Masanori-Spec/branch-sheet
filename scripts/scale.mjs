import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { refresh } from '../src/engine.mjs';
import { writeWorkbook, readWorkbook } from '../src/workbook.mjs';
import { utf8 } from '../src/limits.mjs';
import assert from 'node:assert/strict';
const directory = process.argv[2] ?? 'evidence'; await mkdir(directory, { recursive: true });
const begin = performance.now();
// Root + 99 groups + 19,900 leaves = 20,000 nodes; repeated category names are intentional.
const build = changed => {
  let xml = '<map><node ID="SCALE_ROOT" TEXT="Category catalog">';
  for (let group = 0; group < 99; group++) {
    xml += `<node ID="G${group}" TEXT="Category ${group}">`;
    const first = Math.floor(group * 19900 / 99), end = Math.floor((group + 1) * 19900 / 99);
    for (let i = first; i < end; i++) xml += `<node ID="${changed && i < 100 ? `NEW${i}` : `N${i}`}" TEXT="${changed && i >= 100 && i < 200 ? 'Updated ' : ''}Product ${i % 100} 日本語"/>`;
    xml += '</node>';
  }
  return utf8.encode(xml + '</node></map>');
};
const initial = refresh(build(false));
for (const row of initial.data.active) row.annotations = [`007-${row.id}`, `First line for ${row.id}\nSecond line 日本語`, '=literal owner'];
const prior = writeWorkbook(initial.data), annotatedAt = performance.now();
const updated = refresh(build(true), prior), refreshedAt = performance.now();
assert.equal(updated.data.active.length, 20000); assert.equal(updated.data.removed.length, 100);
assert.equal(updated.report.added.length, 100); assert.equal(updated.report.removed.length, 100); assert.equal(updated.report.renamed.length, 100);
const old = new Map(initial.data.active.map(r => [r.id, r.annotations]));
for (const row of updated.data.active) assert.deepEqual(row.annotations, old.get(row.id) ?? ['', '', '']);
for (const row of updated.data.removed) assert.deepEqual(row.annotations, old.get(row.id));
assert.deepEqual(readWorkbook(updated.workbook), updated.data);
await writeFile(`${directory}/scale-refreshed.xlsx`, updated.workbook);
const result = { nodes: 20000, removed: 100, renamed: 100, added: 100, annotationStringsChecked: 60300, inputMapBytes: build(true).length, priorBytes: prior.length, outputBytes: updated.workbook.length, initialAndAnnotationMilliseconds: Math.round(annotatedAt - begin), refreshMilliseconds: Math.round(refreshedAt - annotatedAt), totalMilliseconds: Math.round(performance.now() - begin), maxRssKiB: process.resourceUsage().maxRSS, scope: 'Core synthetic scale; native Calc reopen is a separate CI check' };
assert(result.totalMilliseconds < 120000, 'Scale budget: 120 seconds');
assert(result.maxRssKiB < 1024 * 1024, 'Scale budget: 1 GiB peak RSS');
await writeFile(`${directory}/scale-result.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
