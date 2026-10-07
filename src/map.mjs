import { LIMITS, assert, decode, text } from './limits.mjs';
import { parseXml, attr } from './xml.mjs';

export function readMap(bytes) {
  assert(bytes.length <= LIMITS.mapBytes, 'Map exceeds 16 MiB');
  const source = decode(bytes), rows = [], ids = new Set(), stack = [];
  let rootCount = 0, mapSeen = false, total = 0, excluded = 0;
  parseXml(source, {
    open(n, depth) {
      const parent = stack.at(-1);
      let row = null;
      if (depth === 1) { assert(n.name === 'map' && n.uri === '', 'Expected a Freeplane map'); mapSeen = true; }
      else if (n.name === 'node' && (parent?.row || parent?.name === 'map')) {
        assert(n.uri === '', 'Namespaced tree nodes are unsupported');
        if (parent.name === 'map') rootCount++;
        assert(rootCount === 1, 'Map must have exactly one root node');
        assert(!['TREE_ID', 'CONTENT_ID', 'ENCRYPTED_CONTENT'].some(k => attr(n, k) !== undefined), 'Cloned or encrypted nodes are unsupported');
        assert(!['OBJECT', 'LOCALIZED_TEXT'].some(k => attr(n, k) !== undefined), 'Typed or localized node cores are unsupported');
        const id = text(attr(n, 'ID'), LIMITS.id, 'Node ID');
        assert(id.length > 0 && !/[\s\u0000-\u001f]/u.test(id), 'Missing or invalid node ID');
        assert(!ids.has(id), 'Duplicate node ID'); ids.add(id);
        const label = text(attr(n, 'TEXT'), LIMITS.label, 'Plain node label');
        assert(!label.trimStart().startsWith('='), 'Formula node cores are unsupported');
        assert(!/^<html>/i.test(label), 'HTML node cores are unsupported');
        const level = parent.row ? parent.row.depth + 1 : 0;
        assert(level <= LIMITS.depth && rows.length < LIMITS.active, 'Map node/depth limit exceeded');
        // JSON segments are unambiguous even when labels contain slash, newline, or duplicate text.
        const segments = parent.row ? [...parent.segments, label] : [label];
        const path = text(JSON.stringify(segments), LIMITS.path, 'Tree path');
        total += id.length + label.length + path.length;
        assert(total <= LIMITS.textTotal, 'Map projected text limit exceeded');
        row = { id, label, parent: parent.row?.id ?? '', depth: level, order: rows.length + 1, path };
        rows.push(row); stack.push({ name: n.name, row, segments }); return;
      } else if (parent?.row && n.name === 'richcontent' && attr(n, 'TYPE') === 'NODE') {
        throw new Error('Rich node cores are unsupported');
      } else if (n.name === 'node') {
        throw new Error('Nodes outside the plain tree are unsupported');
      } else if (parent?.row || parent?.name === 'map') excluded++;
      stack.push({ name: n.name, row });
    },
    close() { stack.pop(); },
  });
  assert(mapSeen && rootCount === 1 && rows.length > 0, 'Map must have one nonempty root tree');
  return { rootId: rows[0].id, rows, excluded, ordering: 'XML sibling preorder; visual left/right positions are not used' };
}
