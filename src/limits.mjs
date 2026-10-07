export const LIMITS = Object.freeze({
  mapBytes: 16 * 1024 * 1024, workbookBytes: 16 * 1024 * 1024,
  zipExpanded: 96 * 1024 * 1024, zipPart: 48 * 1024 * 1024, zipFiles: 48,
  active: 20000, removed: 20000, records: 40000, depth: 64,
  id: 128, label: 2048, path: 8192, annotation: 16000,
  textTotal: 24 * 1024 * 1024, xmlNodes: 1500000,
});
export const HEADERS = Object.freeze(['Node ID', 'Label', 'Parent ID', 'Depth', 'Tree order', 'Path', 'Keyword', 'Description', 'Owner']);
export const SHEETS = Object.freeze(['Active', 'Removed', '_BranchSheet']);
export const SCHEMA = 'BranchSheet/1';
export function fail(message) { throw new Error(message); }
export function assert(ok, message) { if (!ok) fail(message); }
export const utf8 = new TextEncoder();
export function decode(bytes) {
  assert(bytes instanceof Uint8Array, 'Expected file bytes');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('Invalid UTF-8'); }
}
export function text(value, limit, label = 'Text') {
  assert(typeof value === 'string' && value.length <= limit, `${label} exceeds its text limit`);
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value), `${label} contains unsupported XML characters`);
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const d = value.charCodeAt(++i); assert(d >= 0xdc00 && d <= 0xdfff, `${label} contains an unpaired surrogate`); }
    else assert(c < 0xdc00 || c > 0xdfff, `${label} contains an unpaired surrogate`);
  }
  return value;
}
