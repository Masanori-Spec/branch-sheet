import { SaxesParser } from 'saxes';
import { assert, LIMITS } from './limits.mjs';

export function parseXml(source, handlers = {}) {
  assert(typeof source === 'string', 'Expected XML text');
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  let depth = 0, count = 0;
  parser.on('doctype', () => { throw new Error('DTD and entities are unsupported'); });
  parser.on('processinginstruction', () => { throw new Error('XML processing instructions are unsupported'); });
  parser.on('xmldecl', d => { assert(d.version === '1.0' && (!d.encoding || /^utf-8$/i.test(d.encoding)), 'Only XML 1.0 UTF-8 is supported'); });
  parser.on('error', e => { throw new Error(`Malformed XML: ${e.message}`); });
  parser.on('opentag', n => {
    assert(++depth <= 128 && ++count <= LIMITS.xmlNodes, 'XML structure limit exceeded');
    handlers.open?.(n, depth);
  });
  parser.on('closetag', n => { handlers.close?.(n, depth); depth--; });
  parser.on('text', s => handlers.text?.(s));
  parser.on('cdata', s => handlers.text?.(s));
  parser.write(source).close();
}
export function attr(node, name, fallback = undefined) { return node.attributes[name]?.value ?? fallback; }
export function escapeXml(value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;'); }
// SpreadsheetML escaping is decoded once, preserving an escaped literal _xHHHH_.
export function escapeCell(value) { return escapeXml(value.replace(/_x[0-9a-fA-F]{4}_/g, x => `_x005F_${x.slice(1)}`)); }
export function decodeCell(value) { return value.replace(/_x([0-9a-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16))); }
