import { readMap } from './map.mjs';
import { readWorkbook, writeWorkbook } from './workbook.mjs';
import { LIMITS, assert } from './limits.mjs';

export function refresh(mapBytes, priorBytes = null) {
  const map = readMap(mapBytes), prior = priorBytes ? readWorkbook(priorBytes) : null;
  assert(!prior || prior.rootId === map.rootId, 'Map root ID differs from this workbook family');
  const old = new Map([...(prior?.active ?? []), ...(prior?.removed ?? [])].map(r => [r.id, r]));
  const removedBefore = new Set(prior?.removed.map(r => r.id) ?? []), activeIds = new Set(map.rows.map(r => r.id));
  const report = { added: [], renamed: [], moved: [], removed: [], restored: [], retained: 0, excludedMapElements: map.excluded };
  const active = map.rows.map(row => {
    const previous = old.get(row.id);
    if (!previous) report.added.push(row.id);
    else {
      report.retained++;
      if (removedBefore.has(row.id)) report.restored.push(row.id);
      if (previous.label !== row.label) report.renamed.push(row.id);
      if (previous.parent !== row.parent) report.moved.push(row.id);
    }
    return { ...row, annotations: previous ? [...previous.annotations] : ['', '', ''] };
  });
  const removed = [...old.values()].filter(r => !activeIds.has(r.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const r of removed) if (!removedBefore.has(r.id)) report.removed.push(r.id);
  assert(removed.length <= LIMITS.removed, 'Removed-node capacity exceeded; archive this workbook before starting a new family');
  const data = { rootId: map.rootId, active, removed }, workbook = writeWorkbook(data);
  // Check the emitted schema, typed strings and exact snapshots before release.
  const verified = readWorkbook(workbook);
  assert(JSON.stringify(verified) === JSON.stringify(data), 'Generated workbook did not round-trip exactly');
  return { workbook, report, data };
}
