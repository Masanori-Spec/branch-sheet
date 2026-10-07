import test from 'node:test';
import assert from 'node:assert/strict';
import { refresh } from '../src/engine.mjs';
import { readWorkbook } from '../src/workbook.mjs';
import { readZip, writeZip } from '../src/zip.mjs';
import { utf8 } from '../src/limits.mjs';
const good = () => refresh(utf8.encode('<map><node ID="R" TEXT="Root"/></map>')).workbook;
function mutate(part, transform) { const parts = Object.fromEntries(readZip(good())); const next = transform(parts[part]); assert.notEqual(next, parts[part]); parts[part] = next; return writeZip(parts); }
for (const [name, change] of [
  ['direct inline text', s => s.replace('<is><t xml:space="preserve"></t></is>', '<is>LOST NOTE</is>')],
  ['run without inline wrapper', s => s.replace('<is><t xml:space="preserve"></t></is>', '<r><t>007</t></r>')],
  ['child inside text', s => s.replace('>Root</t>', '>Ro<unknown/>ot</t>')],
  ['unknown cell attribute', s => s.replace('r="G2"', 'r="G2" cm="1"')],
  ['missing inline payload', s => s.replace('<is><t xml:space="preserve"></t></is>', '')],
  ['mixed text and runs', s => s.replace('<is><t xml:space="preserve"></t></is>', '<is><t>a</t><r><t>b</t></r></is>')],
  ['unknown worksheet element', s => s.replace('</sheetData>', '</sheetData><mystery/>')],
  ['repeated sheet data', s => s.replace('</sheetData>', '</sheetData><sheetData/>')],
]) test(`unsupported OOXML ${name} rejects without losing data`, () => assert.throws(() => readWorkbook(mutate('xl/worksheets/sheet1.xml', change))));
test('required content types and package relationships are validated', () => {
  for (const [part, transform] of [
    ['[Content_Types].xml', s => s.replace('spreadsheetml.sheet.main+xml', 'spreadsheetml.unknown+xml')],
    ['[Content_Types].xml', s => s.replace(/<Override PartName="\/xl\/styles.xml"[^>]+\/>/, '')],
    ['_rels/.rels', s => s.replace(/<Relationship Id="rId1"[^>]+\/>/, '')],
    ['xl/workbook.xml', s => s.replace('<sheets>', '<sheets>NONWHITESPACE')],
    ['xl/workbook.xml', s => s.replace('</sheets>', '</sheets><unknown/>')],
  ]) assert.throws(() => readWorkbook(mutate(part, transform)));
});
test('ST_Xstring decoding is per complete t element, never across rich-text runs', () => {
  for (const [markup, expected] of [
    ['<r><t>_x0</t></r><r><t>041_</t></r>', '_x0041_'],
    ['<r><t>_x005F_x0041_</t></r><r><t>_x0042_</t></r>', '_x0041_B'],
    ['<r><t>_x005F_</t></r><r><t>x0041_</t></r>', '_x0041_'],
  ]) {
    const parts = Object.fromEntries(readZip(good()));
    parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace('<c r="G2" s="3" t="inlineStr"><is><t xml:space="preserve"></t></is></c>', `<c r="G2" s="3" t="inlineStr"><is>${markup}</is></c>`);
    assert.equal(readWorkbook(writeZip(parts)).active[0].annotations[0], expected);
    parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace(`<c r="G2" s="3" t="inlineStr"><is>${markup}</is></c>`, '<c r="G2" s="3" t="s"><v>0</v></c>');
    parts['xl/sharedStrings.xml'] = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si>${markup}</si></sst>`;
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
    parts['xl/_rels/workbook.xml.rels'] = parts['xl/_rels/workbook.xml.rels'].replace('</Relationships>', '<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
    assert.equal(readWorkbook(writeZip(parts)).active[0].annotations[0], expected);
  }
});
