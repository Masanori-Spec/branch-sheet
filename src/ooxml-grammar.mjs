import { assert } from './limits.mjs';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XML = 'http://www.w3.org/XML/1998/namespace';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const list = s => s ? s.split(' ') : [];
const rule = (children = '', attributes = '', text = false) => ({ children: list(children), attributes: list(attributes), text });
const rich = {
  r: rule('rPr t'), rPr: rule('rFont charset family b i strike outline shadow condense extend color sz u vertAlign scheme'),
  rFont: rule('', 'val'), charset: rule('', 'val'), family: rule('', 'val'), b: rule('', 'val'), i: rule('', 'val'), strike: rule('', 'val'), outline: rule('', 'val'), shadow: rule('', 'val'), condense: rule('', 'val'), extend: rule('', 'val'), color: rule('', 'auto indexed rgb theme tint'), sz: rule('', 'val'), u: rule('', 'val'), vertAlign: rule('', 'val'), scheme: rule('', 'val'), t: rule('', '', true),
};
export const SHARED = { sst: rule('si', 'count uniqueCount'), si: rule('t r'), ...rich };
export const WORKBOOK = {
  workbook: rule('fileVersion workbookPr bookViews sheets calcPr'), fileVersion: rule('', 'appName lastEdited lowestEdited rupBuild codeName'),
  workbookPr: rule('', 'date1904 showObjects showBorderUnselectedTables filterPrivacy promptedSolutions showInk backupFile saveExternalLinkValues updateLinks codeName hidePivotFieldList showPivotChartFilter allowRefreshQuery autoCompressPictures refreshAllConnections checkCompatibility defaultThemeVersion'),
  bookViews: rule('workbookView'), workbookView: rule('', 'visibility minimized showHorizontalScroll showVerticalScroll showSheetTabs xWindow yWindow windowWidth windowHeight tabRatio firstSheet activeTab autoFilterDateGrouping'),
  sheets: rule('sheet'), sheet: rule('', 'name sheetId state r:id'), calcPr: rule('', 'calcId calcMode fullCalcOnLoad refMode iterate iterateCount iterateDelta fullPrecision calcCompleted calcOnSave concurrentCalc concurrentManualCount forceFullCalc'),
};
export const WORKSHEET = {
  worksheet: rule('sheetPr dimension sheetViews sheetFormatPr cols sheetData printOptions pageMargins pageSetup headerFooter rowBreaks colBreaks'),
  sheetPr: rule('tabColor outlinePr pageSetUpPr', 'syncHorizontal syncVertical syncRef transitionEvaluation transitionEntry published codeName filterMode enableFormatConditionsCalculation'),
  tabColor: rule('', 'auto indexed rgb theme tint'), outlinePr: rule('', 'applyStyles summaryBelow summaryRight showOutlineSymbols'), pageSetUpPr: rule('', 'autoPageBreaks fitToPage'), dimension: rule('', 'ref'),
  sheetViews: rule('sheetView'), sheetView: rule('pane selection', 'windowProtection showFormulas showGridLines showRowColHeaders showZeros rightToLeft tabSelected showRuler showOutlineSymbols defaultGridColor showWhiteSpace view topLeftCell colorId zoomScale zoomScaleNormal zoomScaleSheetLayoutView zoomScalePageLayoutView workbookViewId'),
  pane: rule('', 'xSplit ySplit topLeftCell activePane state'), selection: rule('', 'pane activeCell activeCellId sqref'),
  sheetFormatPr: rule('', 'baseColWidth defaultColWidth defaultRowHeight customHeight zeroHeight thickTop thickBottom outlineLevelRow outlineLevelCol'),
  cols: rule('col'), col: rule('', 'min max width style hidden bestFit customWidth phonetic outlineLevel collapsed'),
  sheetData: rule('row'), row: rule('c', 'r spans s customFormat ht hidden customHeight outlineLevel collapsed thickTop thickBot ph'),
  c: rule('v is', 'r s t'), v: rule('', '', true), is: rule('t r'), ...rich,
  printOptions: rule('', 'horizontalCentered verticalCentered headings gridLines gridLinesSet'), pageMargins: rule('', 'left right top bottom header footer'),
  pageSetup: rule('', 'paperSize paperHeight paperWidth scale firstPageNumber fitToWidth fitToHeight pageOrder orientation usePrinterDefaults blackAndWhite draft cellComments useFirstPageNumber errors horizontalDpi verticalDpi copies'),
  headerFooter: rule('oddHeader oddFooter evenHeader evenFooter firstHeader firstFooter', 'differentOddEven differentFirst scaleWithDoc alignWithMargins'),
  oddHeader: rule('', '', true), oddFooter: rule('', '', true), evenHeader: rule('', '', true), evenFooter: rule('', '', true), firstHeader: rule('', '', true), firstFooter: rule('', '', true),
  rowBreaks: rule('brk', 'count manualBreakCount'), colBreaks: rule('brk', 'count manualBreakCount'), brk: rule('', 'id min max man pt'),
};
export function grammar(vocabulary, root) {
  const stack = [];
  const repeated = new Set(['sst/si', 'si/r', 'is/r', 'bookViews/workbookView', 'sheets/sheet', 'sheetViews/sheetView', 'sheetView/selection', 'cols/col', 'sheetData/row', 'row/c', 'rowBreaks/brk', 'colBreaks/brk']);
  return {
    open(node) {
      const entry = vocabulary[node.local];
      assert(node.uri === NS && entry && (stack.length ? stack.at(-1).entry.children.includes(node.local) : node.local === root), 'Unsupported OOXML element or placement');
      const parent = stack.at(-1);
      if (parent) {
        parent.counts[node.local] = (parent.counts[node.local] ?? 0) + 1;
        if (!repeated.has(`${parent.name}/${node.local}`)) assert(parent.counts[node.local] === 1, 'Repeated OOXML singleton content');
        if (['is', 'si'].includes(parent.name)) assert(!(parent.counts.t && parent.counts.r), 'Mixed plain/rich cell strings are unsupported');
      }
      for (const attribute of Object.values(node.attributes)) {
        if (attribute.uri === XMLNS) continue;
        if (attribute.uri === XML && attribute.local === 'space' && entry.text) { assert(['preserve', 'default'].includes(attribute.value), 'Invalid XML space'); continue; }
        const key = attribute.uri === R ? `r:${attribute.local}` : attribute.local;
        assert((!attribute.uri || attribute.uri === R) && entry.attributes.includes(key), 'Unsupported OOXML attribute');
      }
      stack.push({ name: node.local, entry, counts: {} });
    },
    text(value) { assert(stack.at(-1)?.entry.text || /^[\t\n\r ]*$/.test(value), 'Unexpected non-whitespace OOXML content'); },
    close(node) {
      const current = stack.pop(); assert(current?.name === node.local, 'OOXML nesting mismatch');
      if (current.name === 'r') assert(current.counts.t === 1, 'Rich-text run has no text');
      if (current.name === 'workbook') assert(current.counts.sheets === 1, 'Missing/repeated workbook sheets');
      if (current.name === 'worksheet') assert(current.counts.sheetData === 1, 'Missing/repeated worksheet data');
    },
  };
}
