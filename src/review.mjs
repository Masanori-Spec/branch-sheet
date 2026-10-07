import { assert } from './limits.mjs';
export const PAGE_SIZE = 50;
export const FILTERS = ['all', 'active', 'removed', 'added', 'renamed', 'moved', 'restored', 'structure', 'unchanged'];
export function createReview(result) {
  const sets = Object.fromEntries(['added', 'renamed', 'moved', 'restored'].map(k => [k, new Set(result.report[k])]));
  const previous = new Map([...(result.previous?.active ?? []), ...(result.previous?.removed ?? [])].map(row => [row.id, row]));
  const rows = [...result.data.active.map(row => ({ ...row, sheet: 'Active' })), ...result.data.removed.map(row => ({ ...row, sheet: 'Removed' }))].map(row => {
    const changes = Object.keys(sets).filter(k => sets[k].has(row.id));
    const prior = previous.get(row.id);
    if (prior && !changes.length && (prior.depth !== row.depth || prior.order !== row.order || prior.path !== row.path)) changes.push('structure');
    if (row.sheet === 'Removed') changes.push('removed');
    if (!changes.length) changes.push('unchanged');
    return { ...row, changes, before: previous.has(row.id) ? { label: previous.get(row.id).label, parent: previous.get(row.id).parent, path: previous.get(row.id).path, depth: previous.get(row.id).depth, order: previous.get(row.id).order } : null };
  });
  return { rows, counts: { all: rows.length, active: result.data.active.length, removed: result.data.removed.length, ...Object.fromEntries(Object.entries(sets).map(([key, value]) => [key, value.size])), structure: rows.filter(r => r.changes.includes('structure')).length, unchanged: rows.filter(r => r.changes.includes('unchanged')).length } };
}
export function pageOf(review, query = {}) {
  const { filter = 'all', search = '', page = 0 } = query;
  assert(FILTERS.includes(filter) && typeof search === 'string' && search.length <= 256 && Number.isSafeInteger(page) && page >= 0, 'Invalid review query');
  const find = search.toLocaleLowerCase('en');
  const rows = review.rows.filter(row => (filter === 'all' || filter === 'active' && row.sheet === 'Active' || row.changes.includes(filter)) && (!find || row.id.toLocaleLowerCase('en').includes(find) || row.label.toLocaleLowerCase('en').includes(find)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), current = Math.min(page, pages - 1);
  return { rows: rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE), total: rows.length, page: current, pages, pageSize: PAGE_SIZE };
}
export function shortText(value, limit = 180) {
  if (value.length <= limit) return value;
  let end = limit; const c = value.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return value.slice(0, end) + '…';
}
