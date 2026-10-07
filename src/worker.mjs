import { refresh } from './engine.mjs';
import { createReview, pageOf } from './review.mjs';
import { LIMITS, assert } from './limits.mjs';
let current = null;
const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
function reason(error) {
  const message = String(error?.message ?? '');
  if (message === 'Map root ID differs from this workbook family') return 'family';
  if (/limit|capacity|budget|excess|exceed/i.test(message)) return 'limit';
  if (/reserved|snapshot|metadata|schema|rows missing/i.test(message)) return 'reserved';
  if (/duplicate|repeated/i.test(message)) return 'duplicate';
  return 'invalid';
}
self.onmessage = async ({ data }) => {
  const id = data?.id;
  try {
    if (data?.type === 'build') {
      current = null;
      assert(data.map instanceof Uint8Array && data.map.byteLength <= LIMITS.mapBytes && (!data.prior || data.prior instanceof Uint8Array && data.prior.byteLength <= LIMITS.workbookBytes), 'Input limit exceeded');
      const inputHashes = { mapSHA256: await sha(data.map), priorSHA256: data.prior ? await sha(data.prior) : null };
      const result = refresh(data.map, data.prior), review = createReview(result);
      const receipt = { schema: 'BranchSheet-review/1', ...inputHashes, workbookSHA256: await sha(result.workbook), rootId: result.data.rootId, counts: review.counts, changes: result.report, otherTreeChangeIds: review.rows.filter(row => row.changes.includes('structure')).map(row => row.id), scope: 'Exact map-local IDs; supported plain TEXT cores and BranchSheet workbook schema. Notes/decorations excluded. Root ID is not map authenticity. No original file mutation or formula evaluation.' };
      current = { review, workbook: result.workbook, receipt };
      const workbook = result.workbook.slice();
      self.postMessage({ type: 'built', id, counts: review.counts, receipt, workbook, page: pageOf(review) }, [workbook.buffer]);
    } else if (data?.type === 'page') {
      assert(current, 'No reviewed result');
      self.postMessage({ type: 'page', id, page: pageOf(current.review, data.query) });
    } else throw Error('Unsupported worker request');
  } catch (error) { self.postMessage({ type: 'error', id, reason: reason(error) }); }
};
