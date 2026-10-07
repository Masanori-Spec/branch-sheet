import { LIMITS, HEADERS, SHEETS, SCHEMA, assert, text } from './limits.mjs';
import { parseXml, attr, escapeXml, escapeCell, decodeCell } from './xml.mjs';
import { readZip, writeZip } from './zip.mjs';
import { grammar, SHARED, WORKBOOK, WORKSHEET } from './ooxml-grammar.mjs';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PKGREL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export function system(row) { return [row.id, row.label, row.parent, row.depth, row.order, row.path]; }
function fromSystem(a) {
  assert(Array.isArray(a) && a.length === 6, 'Invalid reserved row');
  text(a[0], LIMITS.id, 'Node ID'); text(a[1], LIMITS.label, 'Label'); text(a[2], LIMITS.id, 'Parent ID'); text(a[5], LIMITS.path, 'Path');
  assert(a[0] !== '' && !/\s/u.test(a[0]) && Number.isSafeInteger(a[3]) && a[3] >= 0 && a[3] <= LIMITS.depth && Number.isSafeInteger(a[4]) && a[4] > 0 && a[4] <= LIMITS.active, 'Invalid reserved row types');
  return { id: a[0], label: a[1], parent: a[2], depth: a[3], order: a[4], path: a[5] };
}
function preflight(parts) {
  const metadataRoots = {
    'xl/styles.xml': [NS, 'styleSheet'], 'xl/theme/theme1.xml': ['http://schemas.openxmlformats.org/drawingml/2006/main', 'theme'],
    'docProps/core.xml': ['http://schemas.openxmlformats.org/package/2006/metadata/core-properties', 'coreProperties'],
    'docProps/app.xml': ['http://schemas.openxmlformats.org/officeDocument/2006/extended-properties', 'Properties'],
    'docProps/custom.xml': ['http://schemas.openxmlformats.org/officeDocument/2006/custom-properties', 'Properties'],
  };
  for (const [name, source] of parts) parseXml(source, { open(n, depth) {
    if (depth === 1 && metadataRoots[name]) assert(n.uri === metadataRoots[name][0] && n.local === metadataRoots[name][1], 'Invalid formatting/property metadata root');
    assert(!['f', 'formula', 'formula1', 'formula2', 'definedName', 'hyperlink', 'externalLink', 'oleObject', 'control', 'dataValidation', 'mergeCell', 'AlternateContent'].includes(n.local), 'Formulas, links, merges, controls, and extensions are unsupported');
    // Workbook grammar validates exactly one inert Calc syntax marker; extensions elsewhere still reject.
    assert(n.local !== 'ext' || name === 'xl/workbook.xml', 'Unsupported workbook extension');
    assert(attr(n, 'TargetMode') !== 'External', 'External relationships are unsupported');
    assert(!Object.values(n.attributes).some(a => /(?:vbaproject|macroenabled|externallink|oleobject)/i.test(a.value)), 'Macros and external workbook parts are unsupported');
  } });
}
function relationships(source, permitted) {
  assert(source !== undefined, 'Missing workbook relationships');
  const result = new Map();
  parseXml(source, { open(n, depth) {
    assert(n.uri === PKGREL && (depth === 1 ? n.local === 'Relationships' : depth === 2 && n.local === 'Relationship'), 'Unexpected relationship XML');
    for (const a of Object.values(n.attributes)) assert(a.uri === 'http://www.w3.org/2000/xmlns/' || !a.uri && (depth === 2 && ['Id', 'Type', 'Target', 'TargetMode'].includes(a.local)), 'Unknown relationship attribute');
    if (depth === 2) {
      const id = attr(n, 'Id'), target = attr(n, 'Target'), type = attr(n, 'Type');
      assert(typeof id === 'string' && !result.has(id) && permitted(type, target), 'Unsupported or duplicate relationship');
      assert(attr(n, 'TargetMode') === undefined || attr(n, 'TargetMode') === 'Internal', 'External relationship');
      result.set(id, { type, target });
    }
  }, text(s) { assert(/^[\t\r\n ]*$/.test(s), 'Unexpected relationship text'); } }); return result;
}
function contentTypes(parts) {
  const source = parts.get('[Content_Types].xml'); assert(source !== undefined, 'Missing content types');
  const overrides = new Map(), defaults = new Map();
  const typeFor = name => name === 'xl/workbook.xml' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
    : /^xl\/worksheets\/sheet[123]\.xml$/.test(name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
    : name === 'xl/styles.xml' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'
    : name === 'xl/sharedStrings.xml' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'
    : name === 'xl/theme/theme1.xml' ? 'application/vnd.openxmlformats-officedocument.theme+xml'
    : name === 'docProps/core.xml' ? 'application/vnd.openxmlformats-package.core-properties+xml'
    : name === 'docProps/app.xml' ? 'application/vnd.openxmlformats-officedocument.extended-properties+xml'
    : name === 'docProps/custom.xml' ? 'application/vnd.openxmlformats-officedocument.custom-properties+xml' : undefined;
  parseXml(source, { open(n, depth) {
    assert(n.uri === 'http://schemas.openxmlformats.org/package/2006/content-types' && (depth === 1 ? n.local === 'Types' : depth === 2 && ['Default', 'Override'].includes(n.local)), 'Unsupported content-type XML');
    const keys = n.local === 'Default' ? ['Extension', 'ContentType'] : n.local === 'Override' ? ['PartName', 'ContentType'] : [];
    for (const a of Object.values(n.attributes)) assert(a.uri === 'http://www.w3.org/2000/xmlns/' || !a.uri && keys.includes(a.local), 'Unknown content-type attribute');
    if (depth === 2) {
      const type = attr(n, 'ContentType');
      if (n.local === 'Default') {
        const ext = attr(n, 'Extension');
        const unusedImageDeclaration = ((ext === 'png' && type === 'image/png') || (ext === 'jpeg' && type === 'image/jpeg')) && ![...parts.keys()].some(name => name.endsWith('.' + ext));
        assert(!defaults.has(ext) && ((ext === 'xml' && type === 'application/xml') || (ext === 'rels' && type === 'application/vnd.openxmlformats-package.relationships+xml') || unusedImageDeclaration), 'Unsupported content-type default'); defaults.set(ext, type);
      } else {
        const name = attr(n, 'PartName', '');
        const relationshipOverride = ['/_rels/.rels', '/xl/_rels/workbook.xml.rels'].includes(name) && type === 'application/vnd.openxmlformats-package.relationships+xml';
        assert(name.startsWith('/') && parts.has(name.slice(1)) && !overrides.has(name) && (typeFor(name.slice(1)) === type && type !== undefined || relationshipOverride), 'Invalid content-type override'); overrides.set(name, type);
      }
    }
  }, text(s) { assert(/^[\t\r\n ]*$/.test(s), 'Unexpected content-type text'); } });
  assert(defaults.has('rels'), 'Missing relationship content type');
  for (const name of parts.keys()) if (typeFor(name)) assert(overrides.has('/' + name), 'Missing required content-type override');
}
function sharedStrings(source) {
  if (source === undefined) return [];
  const strings = []; let value = '', token = '', inside = false, inText = false, total = 0; const guard = grammar(SHARED, 'sst');
  parseXml(source, {
    open(n, depth) {
      guard.open(n);
      assert(n.uri === NS, 'Unknown shared-string namespace');
      if (depth === 1) assert(n.local === 'sst', 'Invalid shared-string root');
      if (n.local === 'si') { assert(depth === 2 && !inside, 'Invalid shared-string nesting'); inside = true; value = ''; }
      if (n.local === 't') { assert(inside && !inText, 'Invalid shared-string text'); inText = true; token = ''; }
      assert(!['rPh', 'phoneticPr'].includes(n.local), 'Phonetic cell strings are unsupported');
    },
    text(s) { guard.text(s); if (inText) { token += s; assert(token.length + value.length <= 32767, 'Cell text limit exceeded'); } },
    close(n) {
      guard.close(n);
      if (n.local === 't') { value += decodeCell(token); inText = false; }
      if (n.local === 'si') { text(value, 32767); total += value.length; assert(strings.length < 400020 && total <= LIMITS.zipExpanded, 'Shared-string limit exceeded'); strings.push(value); inside = false; }
    },
  }); return strings;
}
function cells(source, strings, maxCols) {
  assert(source !== undefined, 'Missing worksheet');
  const rows = new Map(), stack = []; let rowIndex = 0, cell = null, part = null; const guard = grammar(WORKSHEET, 'worksheet');
  parseXml(source, {
    open(n, depth) {
      guard.open(n);
      assert(n.uri === NS, 'Unsupported worksheet namespace');
      const parent = stack.at(-1); stack.push(n.local);
      if (depth === 1) assert(n.local === 'worksheet', 'Invalid worksheet root');
      if (n.local === 'row') {
        assert(parent === 'sheetData', 'Unexpected worksheet row');
        rowIndex = Number(attr(n, 'r')); assert(Number.isSafeInteger(rowIndex) && rowIndex > 0 && rowIndex <= LIMITS.records + 10 && !rows.has(rowIndex), 'Invalid or duplicate worksheet row');
        rows.set(rowIndex, new Map());
      }
      if (n.local === 'c') {
        assert(parent === 'row' && !cell, 'Unexpected worksheet cell');
        const ref = attr(n, 'r', ''), match = /^([A-I])([1-9][0-9]*)$/.exec(ref);
        assert(match && Number(match[2]) === rowIndex, 'Unknown or invalid worksheet column');
        const col = match[1].charCodeAt(0) - 65;
        assert(col < maxCols && !rows.get(rowIndex).has(col), 'Unknown or duplicate worksheet column');
        const type = attr(n, 't', 'n'); assert(['n', 's', 'inlineStr'].includes(type), 'Only text and reserved integer cells are supported');
        const style = attr(n, 's'); assert(style === undefined || /^(?:0|[1-9][0-9]{0,4})$/.test(style), 'Invalid style index');
        cell = { col, type, value: '', inline: '', values: 0, inlineCount: 0 };
      }
      if (n.local === 'v') { assert(cell && parent === 'c' && ++cell.values === 1, 'Invalid cell value'); part = 'value'; }
      if (n.local === 'is') { assert(cell && cell.type === 'inlineStr' && parent === 'c' && ++cell.inlineCount === 1, 'Invalid inline string'); }
      if (n.local === 't') { assert(cell && cell.type === 'inlineStr' && (parent === 'is' || parent === 'r'), 'Unexpected cell text'); cell.inlineToken = ''; part = 'inlineToken'; }
      assert(!['rPh', 'phoneticPr'].includes(n.local), 'Phonetic strings are unsupported');
    },
    text(s) { guard.text(s); if (cell && part) { cell[part] += s; assert(cell[part].length <= 32767, 'Cell value exceeds limit'); } },
    close(n) {
      guard.close(n);
      if (n.local === 't') { cell.inline += decodeCell(cell.inlineToken); assert(cell.inline.length <= 32767, 'Cell text limit exceeded'); }
      if (n.local === 'v' || n.local === 't') part = null;
      if (n.local === 'c') {
        let value;
        if (cell.type === 'inlineStr') { assert(cell.values === 0 && cell.inlineCount === 1, 'Ambiguous inline cell'); value = cell.inline; text(value, 32767); }
        else if ((!cell.values || cell.value === '') && cell.type === 'n') value = '';
        else if (cell.type === 's') { assert(/^(?:0|[1-9][0-9]*)$/.test(cell.value), 'Invalid shared string index'); const i = Number(cell.value); assert(i < strings.length, 'Missing shared string'); value = strings[i]; }
        else { assert(/^-?(?:0|[1-9][0-9]*)(?:\.0+)?$/.test(cell.value), 'Unsupported numeric cell'); value = Number(cell.value); assert(Number.isSafeInteger(value), 'Unsafe numeric cell'); }
        rows.get(rowIndex).set(cell.col, value); cell = null;
      }
      stack.pop();
    },
  });
  return [...rows].sort((a, b) => a[0] - b[0]).map(([index, values]) => ({ index, values: Array.from({ length: maxCols }, (_, i) => values.get(i) ?? '') }));
}

export function readWorkbook(bytes) {
  const parts = readZip(bytes); preflight(parts);
  contentTypes(parts);
  const packageRels = relationships(parts.get('_rels/.rels'), (type, target) => (
    (type === `${REL}officeDocument` && target === 'xl/workbook.xml') ||
    (['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'http://schemas.openxmlformats.org/officedocument/2006/relationships/metadata/core-properties'].includes(type) && target === 'docProps/core.xml') ||
    (type === `${REL}extended-properties` && target === 'docProps/app.xml') || (type === `${REL}custom-properties` && target === 'docProps/custom.xml')
  ));
  assert([...packageRels.values()].filter(r => r.type === `${REL}officeDocument`).length === 1, 'Missing/repeated package workbook relationship');
  for (const r of packageRels.values()) assert(parts.has(r.target), 'Missing package relationship target');
  assert(new Set([...packageRels.values()].map(r => r.target)).size === packageRels.size, 'Repeated package relationship target');
  const rels = relationships(parts.get('xl/_rels/workbook.xml.rels'), (type, target) => (
    type === `${REL}worksheet` && /^worksheets\/sheet[123]\.xml$/.test(target) ||
    type === `${REL}styles` && target === 'styles.xml' || type === `${REL}sharedStrings` && target === 'sharedStrings.xml' || type === `${REL}theme` && target === 'theme/theme1.xml'
  ));
  assert([...rels.values()].filter(r => r.type === `${REL}worksheet`).length === 3 && [...rels.values()].filter(r => r.type === `${REL}styles`).length === 1, 'Missing/repeated workbook relationships');
  for (const r of rels.values()) assert(parts.has('xl/' + r.target), 'Missing workbook relationship target');
  assert(new Set([...rels.values()].map(r => r.target)).size === rels.size, 'Repeated workbook relationship target');
  const referenced = new Set([...packageRels.values()].map(r => r.target).concat([...rels.values()].map(r => 'xl/' + r.target)));
  for (const name of parts.keys()) if (!['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels'].includes(name)) assert(referenced.has(name), 'Unreferenced workbook part');
  const sheets = new Map();
  const guard = grammar(WORKBOOK, 'workbook');
  parseXml(parts.get('xl/workbook.xml'), { open(n) {
    guard.open(n);
    if (n.local === 'sheet') {
      const name = attr(n, 'name'), id = Object.values(n.attributes).find(a => a.local === 'id' && a.uri === REL.slice(0, -1))?.value;
      assert(SHEETS.includes(name) && !sheets.has(name) && rels.get(id)?.type === `${REL}worksheet`, 'Unknown or duplicate worksheet');
      sheets.set(name, `xl/${rels.get(id).target}`);
    }
  }, close(n) { guard.close(n); }, text(s) { guard.text(s); } });
  assert(sheets.size === 3 && new Set(sheets.values()).size === 3, 'Expected exactly the three BranchSheet worksheets');
  const strings = sharedStrings(parts.get('xl/sharedStrings.xml'));
  const metadata = cells(parts.get(sheets.get('_BranchSheet')), strings, 2);
  assert(metadata.length >= 4 && metadata[0].index === 1 && metadata[0].values[0] === SCHEMA && metadata[0].values[1] === 'Reserved schema; not an authenticity signature', 'Not a BranchSheet workbook');
  assert(metadata[1].index === 2 && metadata[1].values[0] === 'Root ID' && metadata[2].index === 3 && metadata[2].values[0] === 'Rows', 'Invalid BranchSheet metadata');
  const rootId = text(metadata[1].values[1], LIMITS.id), count = metadata[2].values[1];
  assert(Number.isSafeInteger(count) && count > 0 && count <= LIMITS.records && metadata.length === count + 3, 'Metadata count mismatch');
  const reserved = new Map();
  for (let i = 3; i < metadata.length; i++) {
    const { index, values } = metadata[i]; assert(index === i + 1 && ['Active', 'Removed'].includes(values[0]) && typeof values[1] === 'string', 'Invalid reserved snapshot');
    let a; try { a = JSON.parse(values[1]); } catch { throw new Error('Invalid reserved snapshot JSON'); }
    const row = fromSystem(a); assert(!reserved.has(row.id), 'Duplicate metadata node ID'); reserved.set(row.id, { sheet: values[0], row, json: JSON.stringify(a) });
  }
  const result = { rootId, active: [], removed: [] }; let total = 0; const seen = new Set();
  for (const name of ['Active', 'Removed']) {
    const rows = cells(parts.get(sheets.get(name)), strings, HEADERS.length);
    assert(rows[0]?.index === 1 && JSON.stringify(rows[0].values) === JSON.stringify(HEADERS), 'Reserved column headers changed');
    for (const { values } of rows.slice(1)) {
      if (values.every(v => v === '')) continue;
      const row = fromSystem(values.slice(0, 6)), expected = reserved.get(row.id);
      assert(expected && expected.sheet === name && expected.json === JSON.stringify(system(row)), 'Reserved tree cells changed or stale metadata');
      assert(!seen.has(row.id), 'Duplicate workbook node ID'); seen.add(row.id);
      const annotations = values.slice(6).map(v => text(v, LIMITS.annotation, 'Annotation'));
      total += [...system(row).filter(v => typeof v === 'string'), ...annotations].reduce((a, v) => a + v.length, 0);
      assert(total <= LIMITS.textTotal, 'Workbook text budget exceeded');
      result[name.toLowerCase()].push({ ...row, annotations });
    }
  }
  assert(seen.size === reserved.size && result.active.length > 0 && result.active.length <= LIMITS.active && result.removed.length <= LIMITS.removed, 'Workbook rows missing or excessive');
  const roots = result.active.filter(r => r.parent === '');
  assert(roots.length === 1 && roots[0].id === rootId && roots[0].depth === 0, 'Workbook root metadata mismatch');
  return result;
}

function cell(value, row, col, style = 1) {
  const ref = `${String.fromCharCode(65 + col)}${row}`;
  if (typeof value === 'number') return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
  text(value, 32767);
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeCell(value)}</t></is></c>`;
}
function sheet(rows, metadata = false) {
  const columns = metadata ? '<col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="80" customWidth="1"/>' :
    [25, 27, 25, 9, 12, 60, 24, 48, 24].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return `${XML}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${columns}</cols><sheetData>${rows.map((values, i) => `<row r="${i + 1}"${i === 0 ? ' ht="30" customHeight="1"' : !metadata && values.some(value => typeof value === 'string' && /[\r\n]/.test(value)) ? ` ht="${Math.min(409, Math.max(36, 18 * Math.max(...values.map(value => typeof value === 'string' ? value.split(/\r\n|\r|\n/).length : 1)) + 8))}" customHeight="1"` : ''}>${values.map((v, j) => cell(v, i + 1, j, i === 0 ? 0 : metadata ? 1 : j >= 6 ? 3 : typeof v === 'number' ? 2 : 1)).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
const styles = `${XML}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><color rgb="FF172F36"/><name val="Liberation Sans"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Liberation Sans"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173F48"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF5D6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
export function writeWorkbook(data) {
  assert(data.active.length > 0 && data.active.length <= LIMITS.active && data.removed.length <= LIMITS.removed && data.active.length + data.removed.length <= LIMITS.records, 'Workbook capacity exceeded');
  let total = 0;
  for (const row of [...data.active, ...data.removed]) {
    fromSystem(system(row));
    assert(Array.isArray(row.annotations) && row.annotations.length === 3, 'Expected three annotation strings');
    for (const value of row.annotations) text(value, LIMITS.annotation, 'Annotation');
    total += [...system(row).filter(v => typeof v === 'string'), ...row.annotations].reduce((a, v) => a + v.length, 0);
    assert(total <= LIMITS.textTotal, 'Output text budget exceeded');
  }
  const metadata = [[SCHEMA, 'Reserved schema; not an authenticity signature'], ['Root ID', data.rootId], ['Rows', data.active.length + data.removed.length]];
  for (const name of ['Active', 'Removed']) for (const row of data[name.toLowerCase()]) metadata.push([name, JSON.stringify(system(row))]);
  const parts = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${[1, 2, 3].map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="${PKGREL}"><Relationship Id="rId1" Type="${REL}officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS}" xmlns:r="${REL.slice(0, -1)}"><bookViews><workbookView/></bookViews><sheets>${SHEETS.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}"${i === 2 ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="${PKGREL}">${[1, 2, 3].map(i => `<Relationship Id="rId${i}" Type="${REL}worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rId4" Type="${REL}styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet([HEADERS, ...data.active.map(r => [...system(r), ...r.annotations])]),
    'xl/worksheets/sheet2.xml': sheet([HEADERS, ...data.removed.map(r => [...system(r), ...r.annotations])]),
    'xl/worksheets/sheet3.xml': sheet(metadata, true),
  };
  return writeZip(parts);
}
