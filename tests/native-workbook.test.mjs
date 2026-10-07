import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readWorkbook, system } from '../src/workbook.mjs';
import { readZip, writeZip } from '../src/zip.mjs';
const fixture = await readFile(new URL('../fixtures/calc-7.3.7.2-annotated.xlsx', import.meta.url));
const provenance = JSON.parse(await readFile(new URL('../fixtures/calc-7.3.7.2-provenance.json', import.meta.url), 'utf8'));
test('byte-identical real Calc-saved workbook retains exact typed annotation values and reserved IDs', () => {
  assert.equal(createHash('sha256').update(fixture).digest('hex'), provenance.memberSHA256);
  const data = readWorkbook(fixture);
  assert.equal(data.rootId, 'ID_1000001'); assert.deepEqual(data.removed, []);
  assert.deepEqual(data.active.map(r => [...system(r), ...r.annotations]), [
    ['ID_1000005', 'Alpha', 'ID_1000003', 2, 5, '["Catalog","Services","Alpha"]', 'other_x0041_', '日本語\tvalue', 'Alice'],
    ['ID_1000004', 'Alpha', 'ID_1000002', 2, 3, '["Catalog","Products","Alpha"]', '007', 'line1\nline2', '=1+1'],
    ['ID_1000003', 'Services', 'ID_1000001', 1, 4, '["Catalog","Services"]', '', '', ''],
    ['ID_1000002', 'Products', 'ID_1000001', 1, 2, '["Catalog","Products"]', '', '', ''],
    ['ID_1000001', 'Catalog', '', 0, 1, '["Catalog"]', '', '', ''],
  ]);
});
function mutated(part, transform) { const parts = Object.fromEntries(readZip(fixture)); const changed = transform(parts[part]); assert.notEqual(changed, parts[part]); parts[part] = changed; return writeZip(parts); }
for (const [name, transform] of [
  ['unknown extension URI', s => s.replace('{7626C862-2A13-11E5-B345-FEFF819CDC9F}', '{UNKNOWN}')],
  ['wrong extension namespace', s => s.replace('http://schemas.libreoffice.org/', 'https://example.invalid/')],
  ['unknown syntax value', s => s.replace('CalcA1ExcelA1', 'ExcelA1')],
  ['extra payload attribute', s => s.replace('stringRefSyntax=', 'extra="x" stringRefSyntax=')],
  ['extra extension attribute', s => s.replace(' uri="{7626', ' extra="x" uri="{7626')],
  ['extra payload child', s => s.replace('stringRefSyntax="CalcA1ExcelA1"/>', 'stringRefSyntax="CalcA1ExcelA1"><unknown/></loext:extCalcPr>')],
  ['missing payload', s => s.replace('<loext:extCalcPr stringRefSyntax="CalcA1ExcelA1"/>', '')],
  ['duplicate payload', s => s.replace('<loext:extCalcPr stringRefSyntax="CalcA1ExcelA1"/>', '<loext:extCalcPr stringRefSyntax="CalcA1ExcelA1"/><loext:extCalcPr stringRefSyntax="CalcA1ExcelA1"/>')],
  ['nonempty protection', s => s.replace('<workbookProtection/>', '<workbookProtection lockStructure="true"/>')],
  ['different date compatibility', s => s.replace('dateCompatibility="false"', 'dateCompatibility="true"')],
]) test(`native metadata compatibility still rejects ${name}`, () => assert.throws(() => readWorkbook(mutated('xl/workbook.xml', transform))));
test('known Calc metadata does not permit formulas or extensions in other parts', () => {
  assert.throws(() => readWorkbook(mutated('xl/worksheets/sheet1.xml', s => s.replace('<v>19</v>', '<f>1+1</f><v>19</v>'))), /Formulas/);
  assert.throws(() => readWorkbook(mutated('xl/styles.xml', s => s.replace('</styleSheet>', '<ext uri="{7626C862-2A13-11E5-B345-FEFF819CDC9F}"/></styleSheet>'))), /extension/);
});
test('native empty cells are blank; malformed shared-string indexes still reject', () => {
  assert.equal(readWorkbook(fixture).active.at(-1).parent, '');
  for (const value of ['', '<v/>']) assert.throws(() => readWorkbook(mutated('xl/worksheets/sheet1.xml', s => s.replace('<c r="C6" s="2"/>', `<c r="C6" s="2" t="s">${value}</c>`))), /shared string index/);
});
test('unused native MIME declarations and exact metadata relationships do not admit other parts or targets', () => {
  assert.throws(() => readWorkbook(mutated('[Content_Types].xml', s => s.replace('ContentType="image/png"', 'ContentType="image/svg+xml"'))), /content-type/);
  assert.throws(() => readWorkbook(mutated('[Content_Types].xml', s => s.replace('Extension="png"', 'Extension="svg"'))), /content-type/);
  assert.throws(() => readWorkbook(mutated('[Content_Types].xml', s => s.replace('PartName="/_rels/.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"', 'PartName="/_rels/.rels" ContentType="image/png"'))), /content-type/);
  assert.throws(() => readWorkbook(mutated('_rels/.rels', s => s.replace('Target="docProps/core.xml"', 'Target="docProps/app.xml"'))), /relationship/);
  assert.throws(() => readWorkbook(mutated('_rels/.rels', s => s.replace('officedocument/2006/relationships/metadata', 'officeDocument/2006/relationships/metadata'))), /relationship/);
  const parts = Object.fromEntries(readZip(fixture)); parts['xl/media/image1.png'] = 'unsupported';
  assert.throws(() => readWorkbook(writeZip(parts)), /Unknown/);
});
test('known extension cannot move outside its single workbook extension slot or carry text', () => {
  assert.throws(() => readWorkbook(mutated('xl/workbook.xml', s => s.replace('<extLst>', '').replace('</extLst>', ''))), /placement/);
  assert.throws(() => readWorkbook(mutated('xl/workbook.xml', s => s.replace('<extLst>', '<extLst>HIDDEN'))), /non-whitespace/);
  assert.throws(() => readWorkbook(mutated('xl/workbook.xml', s => s.replace('</extLst>', '</extLst><extLst/>'))), /Repeated/);
});
