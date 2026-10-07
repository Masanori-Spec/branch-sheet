import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8, LIMITS } from '../src/limits.mjs';
import { readMap } from '../src/map.mjs';
import { refresh } from '../src/engine.mjs';
import { writeWorkbook, readWorkbook } from '../src/workbook.mjs';
import { readZip, writeZip, crc32 } from '../src/zip.mjs';
import { zipSync } from 'fflate';
const bytes = s => utf8.encode(s);
const before = '<map><node ID="R" TEXT="Catalog"><node ID="A" TEXT="Products"><node ID="X" TEXT="Alpha"/></node><node ID="B" TEXT="Services"><node ID="Y" TEXT="Alpha"/></node></node></map>';
const after = '<map><node ID="R" TEXT="Catalog"><node ID="A" TEXT="Products"><node ID="Z" TEXT="New"/></node><node ID="B" TEXT="Services"><node ID="X" TEXT="Beta"/></node></node></map>';
function annotated() { const data = refresh(bytes(before)).data; data.active.find(r => r.id === 'X').annotations = ['007', 'line1\nline2', '=1+1']; data.active.find(r => r.id === 'Y').annotations = ['other_x0041_', '日本語\tvalue', 'Alice']; return data; }
function modify(workbook, name, transform) { const parts = Object.fromEntries(readZip(workbook)); const changed = transform(parts[name]); assert.notEqual(changed, parts[name], 'Test mutation must change actual bytes'); parts[name] = changed; return writeZip(parts); }
test('exact IDs carry literal strings across rename/move, retaining removed and blank new rows', () => {
  const result = refresh(bytes(after), writeWorkbook(annotated()));
  assert.deepEqual(result.data.active.map(r => [r.id, r.parent, r.label, r.depth, r.order]), [['R', '', 'Catalog', 0, 1], ['A', 'R', 'Products', 1, 2], ['Z', 'A', 'New', 2, 3], ['B', 'R', 'Services', 1, 4], ['X', 'B', 'Beta', 2, 5]]);
  assert.deepEqual(result.data.active.find(r => r.id === 'X').annotations, ['007', 'line1\nline2', '=1+1']);
  assert.deepEqual(result.data.active.find(r => r.id === 'Z').annotations, ['', '', '']);
  assert.deepEqual(result.data.removed[0].annotations, ['other_x0041_', '日本語\tvalue', 'Alice']);
  assert.deepEqual(result.report, { added: ['Z'], renamed: ['X'], moved: ['X'], removed: ['Y'], restored: [], retained: 4, excludedMapElements: 0 });
});
test('unchanged refresh is byte deterministic and restored IDs recover annotations', () => {
  const r = refresh(bytes(after), writeWorkbook(annotated())), same = refresh(bytes(after), r.workbook);
  assert.deepEqual(same.workbook, r.workbook);
  const restored = refresh(bytes(before), r.workbook);
  assert.deepEqual(restored.data.active.find(r => r.id === 'Y').annotations, ['other_x0041_', '日本語\tvalue', 'Alice']);
  assert.deepEqual(restored.report.restored, ['Y']);
});
test('literal ST_Xstring patterns, CRLF, tabs, astral Unicode and formula-looking strings round-trip as text', () => {
  const data = annotated(); data.active[0].annotations = ['_x0000_ _x005F_ _x0041_', 'a\r\nb\t🧭 é', '=HYPERLINK("https://example.invalid")'];
  assert.deepEqual(readWorkbook(writeWorkbook(data)), data);
});
test('whole rows may be sorted without breaking metadata identity', () => {
  const file = writeWorkbook(annotated());
  const reordered = modify(file, 'xl/worksheets/sheet1.xml', s => s.replace(/<sheetData>(.*?)<\/sheetData>/s, (_, inner) => {
    const rows = inner.match(/<row\b.*?<\/row>/gs), sorted = [rows[0], ...rows.slice(1).reverse()];
    return `<sheetData>${sorted.map((r, i) => r.replace(/(<row r=")[0-9]+/, `$1${i + 1}`).replace(/(<c r="[A-I])[0-9]+/g, `$1${i + 1}`)).join('')}</sheetData>`;
  }));
  assert.deepEqual(refresh(bytes(after), reordered).data, refresh(bytes(after), file).data);
});
for (const [label, xml, pattern] of [
  ['missing ID', '<map><node TEXT="a"/></map>', /Node ID/],
  ['duplicate ID', '<map><node ID="R" TEXT="a"><node ID="R" TEXT="b"/></node></map>', /Duplicate/],
  ['multiple roots', '<map><node ID="R" TEXT="a"/><node ID="S" TEXT="b"/></map>', /one root/],
  ['clone', '<map><node ID="R" TEXT="a" TREE_ID="other"/></map>', /Cloned/],
  ['content clone', '<map><node ID="R" TEXT="a" CONTENT_ID="other"/></map>', /Cloned/],
  ['encrypted', '<map><node ID="R" TEXT="a" ENCRYPTED_CONTENT="secret"/></map>', /encrypted/],
  ['rich core', '<map><node ID="R" TEXT="a"><richcontent TYPE="NODE"><html/></richcontent></node></map>', /Rich/],
  ['HTML TEXT core', '<map><node ID="R" TEXT="&lt;html&gt;&lt;b&gt;Rich&lt;/b&gt;&lt;/html&gt;"/></map>', /HTML/],
  ['mixed-case HTML TEXT core', '<map><node ID="R" TEXT="&lt;HtMl&gt;Rich&lt;/HtMl&gt;"/></map>', /HTML/],
  ['formula', '<map><node ID="R" TEXT="=1+1"/></map>', /Formula/],
  ['typed core', '<map><node ID="R" TEXT="1" OBJECT="java.lang.Long|1"/></map>', /Typed/],
  ['localized core', '<map><node ID="R" TEXT="a" LOCALIZED_TEXT="key"/></map>', /localized/],
  ['DTD', '<!DOCTYPE map [<!ENTITY x "ok">]><map><node ID="R" TEXT="&x;"/></map>', /DTD/],
  ['processing instruction', '<?remote value?><map><node ID="R" TEXT="a"/></map>', /processing/],
]) test(`reject ${label}`, () => assert.throws(() => readMap(bytes(xml)), pattern));
test('ignored notes and style XML are excluded, never evaluated', () => {
  const xml = '<map><hook NAME="MapStyle"><stylenode TEXT="style"/></hook><node ID="R" TEXT="a"><richcontent TYPE="NOTE"><html xmlns="http://www.w3.org/1999/xhtml"><body>ignored</body></html></richcontent><attribute NAME="x" VALUE="=1+1"/></node></map>';
  const result = readMap(bytes(xml)); assert.equal(result.rows.length, 1); assert.equal(result.excluded, 3); assert.equal(JSON.stringify(result.rows).includes('ignored'), false);
});
test('fatal UTF-8 and too-deep maps reject', () => {
  assert.throws(() => readMap(new Uint8Array([255])), /UTF-8/);
  const tree = Array.from({ length: 66 }, (_, i) => `<node ID="n${i}" TEXT="x">`).join('') + '</node>'.repeat(66);
  assert.throws(() => readMap(bytes(`<map>${tree}</map>`)), /depth/);
});
test('different root IDs reject rather than guessing by label', () => assert.throws(() => refresh(bytes(after.replace('ID="R"', 'ID="OTHER"')), writeWorkbook(annotated())), /root ID/));
test('changed reserved parent, label, ID, missing row and duplicate row reject', () => {
  const file = writeWorkbook(annotated());
  for (const transform of [s => s.replace('<t xml:space="preserve">Products</t>', '<t xml:space="preserve">Changed</t>'), s => s.replace(/<row r="3".*?<\/row>/s, ''), s => s.replace('r="A3"', 'r="A2"'), s => s.replace('<c r="C4" s="1" t="inlineStr"><is><t xml:space="preserve">A</t>', '<c r="C4" s="1" t="inlineStr"><is><t xml:space="preserve">B</t>')]) {
    assert.throws(() => readWorkbook(modify(file, 'xl/worksheets/sheet1.xml', transform)));
  }
});
test('formula, numeric annotation, unknown column, changed header and renamed sheet reject', () => {
  const file = writeWorkbook(annotated());
  for (const transform of [s => s.replace('<c r="G4" s="3" t="inlineStr"><is><t xml:space="preserve">007</t></is></c>', '<c r="G4"><f>1+1</f><v>2</v></c>'), s => s.replace('<c r="G4" s="3" t="inlineStr"><is><t xml:space="preserve">007</t></is></c>', '<c r="G4"><v>7</v></c>'), s => s.replace('r="I3"', 'r="J3"'), s => s.replace('>Owner<', '>Other<')]) assert.throws(() => readWorkbook(modify(file, 'xl/worksheets/sheet1.xml', transform)));
  assert.throws(() => readWorkbook(modify(file, 'xl/workbook.xml', s => s.replace('name="Active"', 'name="Other"'))));
});
test('unknown ZIP parts and external links fail before parsing cells', () => {
  const file = writeWorkbook(annotated()), parts = Object.fromEntries(readZip(file)); parts['xl/vbaProject.bin'] = 'x';
  assert.throws(() => readWorkbook(writeZip(parts)), /Unknown/);
  assert.throws(() => readWorkbook(modify(file, '_rels/.rels', s => s.replace('Target="xl/workbook.xml"', 'Target="https://example.invalid" TargetMode="External"'))), /External/);
});
test('ZIP CRC and declared expansion are independently checked', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  const file = writeWorkbook(annotated()).slice(), dv = new DataView(file.buffer);
  let at = -1; for (let i = 0; i < file.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) { at = i; break; }
  dv.setUint32(at + 24, LIMITS.zipExpanded + 1, true);
  assert.throws(() => readWorkbook(file), /Expanded/);
});
test('literal duplicate labels never join annotations to a replacement ID', () => {
  const r = refresh(bytes(before.replace('ID="X"', 'ID="NEW"')), writeWorkbook(annotated()));
  assert.deepEqual(r.data.active.find(r => r.id === 'NEW').annotations, ['', '', '']);
  assert.deepEqual(r.data.removed.find(r => r.id === 'X').annotations, ['007', 'line1\nline2', '=1+1']);
});
