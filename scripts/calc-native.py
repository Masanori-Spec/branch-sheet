"""Real Calc/UNO edits, XLSX serialization and independent literal-value oracles."""
import copy, hashlib, json, os, pathlib, subprocess, time, uuid
import uno
from com.sun.star.beans import PropertyValue
from com.sun.star.document.MacroExecMode import NEVER_EXECUTE
from com.sun.star.document.UpdateDocMode import NO_UPDATE
from com.sun.star.table import TableSortField
from com.sun.star.table.TableSortFieldType import ALPHANUMERIC

ROOT = pathlib.Path(__file__).resolve().parents[1]; OUT = ROOT / 'evidence'; WORK = ROOT / '.native'
HEADERS = ['Node ID', 'Label', 'Parent ID', 'Depth', 'Tree order', 'Path', 'Keyword', 'Description', 'Owner']
X_TEXT = ['007', 'line1\nline2', '=1+1']
Y_TEXT = ['other_x0041_', '日本語\tvalue', 'Alice']

def props(**items):
    result = []
    for key, value in items.items():
        item = PropertyValue(); item.Name = key; item.Value = value; result.append(item)
    return tuple(result)
def command(*args, expect_success=True):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=180)
    if expect_success: assert result.returncode == 0, result.stdout + result.stderr
    return result
def generate(map_path, stem, prior=None, expect_success=True):
    args = ['node', 'src/cli.mjs', str(map_path), '--out', str(OUT / (stem + '.xlsx')), '--report', str(OUT / (stem + '-review.json'))]
    if prior: args += ['--prior', str(prior)]
    return command(*args, expect_success=expect_success)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def expected(ids, state):
    R, A, B, X, Y, Z = [ids[k] for k in ['R', 'A', 'B', 'X', 'Y', 'Z']]
    def row(i, label, parent, depth, order, path, annotations): return [i, label, parent, depth, order, json.dumps(path, ensure_ascii=False, separators=(',', ':')), *annotations]
    blanks = ['', '', '']
    root = row(R, 'Catalog', '', 0, 1, ['Catalog'], blanks)
    a = row(A, 'Products', R, 1, 2, ['Catalog', 'Products'], blanks)
    oldx = row(X, 'Alpha', A, 2, 3, ['Catalog', 'Products', 'Alpha'], X_TEXT)
    b = row(B, 'Services', R, 1, 4, ['Catalog', 'Services'], blanks)
    y = row(Y, 'Alpha', B, 2, 5, ['Catalog', 'Services', 'Alpha'], Y_TEXT)
    if state == 'before': return {'Active': [root, a, oldx, b, y], 'Removed': []}
    z = row(Z, 'New', A, 2, 3, ['Catalog', 'Products', 'New'], blanks)
    x = row(X, 'Beta', B, 2, 5, ['Catalog', 'Services', 'Beta'], X_TEXT)
    if state == 'updated': return {'Active': [root, a, z, b, x], 'Removed': [y]}
    assert state == 'restored'
    # Native undo restores Y in its original position before X; source order is regenerated.
    x[4] = 6
    return {'Active': [root, a, z, b, y, x], 'Removed': []}

def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('DISPLAY'), 'Hosted disposable-display gate only'
    ids = json.loads((OUT / 'freeplane-result.json').read_text())['ids']
    generate(OUT / 'before.mm', 'initial')
    profile = WORK / 'calc-profile'; profile.mkdir(exist_ok=True)
    pipe = 'branchsheet_' + uuid.uuid4().hex
    log = (OUT / 'calc.log').open('w')
    process = subprocess.Popen(['libreoffice', '-env:UserInstallation=' + profile.as_uri(), '--norestore', '--nodefault', '--nologo', '--nofirststartwizard', '--accept=pipe,name=' + pipe + ';urp;StarOffice.ComponentContext'], stdout=log, stderr=subprocess.STDOUT)
    local = uno.getComponentContext(); resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    context = None; end = time.monotonic() + 60
    while context is None and time.monotonic() < end:
        try: context = resolver.resolve('uno:pipe,name=' + pipe + ';urp;StarOffice.ComponentContext')
        except Exception: time.sleep(.3)
    assert context is not None, 'LibreOffice UNO did not start'
    desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
    filters = context.ServiceManager.createInstanceWithContext('com.sun.star.document.FilterFactory', context)
    assert filters.hasByName('Calc Office Open XML'), 'Required native XLSX filter missing'
    documents = []
    def load(path, hidden=False):
        document = desktop.loadComponentFromURL(path.as_uri(), '_blank', 0, props(Hidden=hidden, MacroExecutionMode=NEVER_EXECUTE, UpdateDocMode=NO_UPDATE, ReadOnly=False))
        assert document and document.supportsService('com.sun.star.sheet.SpreadsheetDocument')
        documents.append(document); return document
    def close(document): document.close(True); documents.remove(document)
    def save(document, path): document.storeAsURL(path.as_uri(), props(FilterName='Calc Office Open XML', Overwrite=False))
    def capture(document):
        result = {}
        assert list(document.Sheets.getElementNames()) == ['Active', 'Removed', '_BranchSheet']
        for name in ['Active', 'Removed']:
            sheet = document.Sheets.getByName(name); cursor = sheet.createCursor(); cursor.gotoEndOfUsedArea(False); end_row = cursor.RangeAddress.EndRow
            assert end_row < 40002
            header = [sheet.getCellByPosition(c, 0).getString() for c in range(9)]; assert header == HEADERS
            rows = []
            for r in range(1, end_row + 1):
                cells = [sheet.getCellByPosition(c, r) for c in range(9)]
                if not any(c.getString() for c in cells): continue
                values = [c.getValue() if i in (3, 4) else c.getString() for i, c in enumerate(cells)]
                assert all(value == int(value) for value in values[3:5]), 'Non-integral reserved native value'
                types = [c.getType().value for c in cells]
                assert all(t != 'FORMULA' for t in types), 'Native consumer encountered a formula'
                rows.append({'row': r + 1, 'values': values, 'types': types})
            result[name] = rows
        return result
    def verify(record, state, allow_sorted=False):
        wanted = expected(ids, state)
        for name in ['Active', 'Removed']:
            values = [r['values'] for r in record[name]]
            if allow_sorted:
                assert sorted(values) == sorted(wanted[name])
            else: assert values == wanted[name], (name, values, wanted[name])
            for row in record[name]:
                for i, value in enumerate(row['values']):
                    kind = row['types'][i]
                    if i in (3, 4): assert kind == 'VALUE'
                    elif value: assert kind == 'TEXT', (value, kind)
                    else: assert kind in ('TEXT', 'EMPTY')
    def screenshot(name, document, sheet='Active', columns=None):
        controller = document.getCurrentController(); target = document.Sheets.getByName(sheet); controller.setActiveSheet(target)
        controller.setPropertyValue('ZoomValue', 70)
        if columns: controller.select(target.getCellRangeByName(columns))
        windows = command('xdotool', 'search', '--onlyvisible', '--class', 'libreoffice').stdout.split()
        assert windows
        command('xdotool', 'windowsize', windows[-1], '1500', '920')
        command('xdotool', 'windowfocus', '--sync', windows[-1])
        time.sleep(.5); command('scrot', str(OUT / name))
    try:
        document = load(OUT / 'initial.xlsx'); sheet = document.Sheets.getByName('Active')
        for r in range(1, 6):
            node_id = sheet.getCellByPosition(0, r).getString()
            values = X_TEXT if node_id == ids['X'] else Y_TEXT if node_id == ids['Y'] else ['', '', '']
            for c, value in enumerate(values, 6): sheet.getCellByPosition(c, r).setString(value)
        verify(capture(document), 'before')
        region = sheet.getCellRangeByPosition(0, 1, 8, 5)
        field = TableSortField(); field.Field = 0; field.IsAscending = False; field.IsCaseSensitive = True; field.FieldType = ALPHANUMERIC
        descriptor = list(region.createSortDescriptor())
        for item in descriptor:
            if item.Name == 'SortFields': item.Value = (field,)
            if item.Name == 'ContainsHeader': item.Value = False
            if item.Name == 'IsSortColumns': item.Value = False
        region.sort(tuple(descriptor))
        sorted_record = capture(document); verify(sorted_record, 'before', allow_sorted=True)
        assert [r['values'][0] for r in sorted_record['Active']] == sorted(ids[k] for k in ['R', 'A', 'B', 'X', 'Y'])[::-1]
        save(document, OUT / 'calc-annotated.xlsx'); screenshot('calc-annotated.png', document, columns='G1:I6'); close(document)
        document = load(OUT / 'calc-annotated.xlsx'); annotated_record = capture(document); verify(annotated_record, 'before', allow_sorted=True); close(document)
        generate(OUT / 'updated.mm', 'refreshed', OUT / 'calc-annotated.xlsx')
        document = load(OUT / 'refreshed.xlsx'); refreshed_record = capture(document); verify(refreshed_record, 'updated')
        screenshot('calc-refreshed-active.png', document, columns='G1:I6'); screenshot('calc-refreshed-removed.png', document, 'Removed', 'A1:I2'); close(document)
        generate(OUT / 'updated.mm', 'unchanged', OUT / 'refreshed.xlsx')
        assert (OUT / 'unchanged.xlsx').read_bytes() == (OUT / 'refreshed.xlsx').read_bytes()
        generate(OUT / 'restored.mm', 'restored', OUT / 'refreshed.xlsx')
        document = load(OUT / 'restored.xlsx'); restored_record = capture(document); verify(restored_record, 'restored'); close(document)
        controls = []
        for name in ['changed-parent', 'swapped-ids', 'duplicate-id', 'stale-metadata', 'swapped-annotations', 'corrupt-annotation']:
            document = load(OUT / 'calc-annotated.xlsx', hidden=True); sheet = document.Sheets.getByName('Active')
            row_by_id = {sheet.getCellByPosition(0, r).getString(): r for r in range(1, 6)}; x, y = row_by_id[ids['X']], row_by_id[ids['Y']]
            if name == 'changed-parent': sheet.getCellByPosition(2, x).setString(ids['B'])
            elif name == 'swapped-ids':
                sheet.getCellByPosition(0, x).setString(ids['Y']); sheet.getCellByPosition(0, y).setString(ids['X'])
            elif name == 'duplicate-id': sheet.getCellByPosition(0, x).setString(ids['Y'])
            elif name == 'stale-metadata': document.Sheets.getByName('_BranchSheet').getCellByPosition(1, 1).setString('STALE_ROOT')
            elif name == 'swapped-annotations':
                for c, value in enumerate(Y_TEXT, 6): sheet.getCellByPosition(c, x).setString(value)
                for c, value in enumerate(X_TEXT, 6): sheet.getCellByPosition(c, y).setString(value)
            else: sheet.getCellByPosition(6, x).setString('CORRUPTED')
            bad = OUT / ('negative-' + name + '.xlsx'); save(document, bad); changed_record = capture(document)
            metadata_root = document.Sheets.getByName('_BranchSheet').getCellByPosition(1, 1).getString()
            assert metadata_root == ('STALE_ROOT' if name == 'stale-metadata' else ids['R'])
            close(document)
            # Retain actual native-edited inputs, then independently verify the exact intended fault.
            intended = copy.deepcopy(annotated_record)
            ix = next(r for r in intended['Active'] if r['values'][0] == ids['X']); iy = next(r for r in intended['Active'] if r['values'][0] == ids['Y'])
            if name == 'changed-parent': ix['values'][2] = ids['B']
            elif name == 'swapped-ids': ix['values'][0], iy['values'][0] = ids['Y'], ids['X']
            elif name == 'duplicate-id': ix['values'][0] = ids['Y']
            elif name == 'swapped-annotations': ix['values'][6:], iy['values'][6:] = Y_TEXT, X_TEXT
            elif name == 'corrupt-annotation': ix['values'][6] = 'CORRUPTED'
            assert changed_record == intended
            result = generate(OUT / 'updated.mm', 'negative-output-' + name, bad, expect_success=False)
            control = {'name': name, 'inputSHA256': digest(bad), 'actualInputCells': changed_record, 'actualMetadataRoot': metadata_root, 'exitCode': result.returncode}
            if name in ['swapped-annotations', 'corrupt-annotation']:
                assert result.returncode == 0
                document = load(OUT / ('negative-output-' + name + '.xlsx'), hidden=True); actual = capture(document); close(document)
                intended_output = copy.deepcopy(refreshed_record)
                ox = next(r for r in intended_output['Active'] if r['values'][0] == ids['X']); oy = intended_output['Removed'][0]
                if name == 'swapped-annotations': ox['values'][6:], oy['values'][6:] = Y_TEXT, X_TEXT
                else: ox['values'][6] = 'CORRUPTED'
                assert actual == intended_output
                try: verify(actual, 'updated')
                except AssertionError: pass
                else: raise AssertionError('Independent annotation oracle failed to detect its intended fault')
                control.update({'rejectedBy': 'independent literal annotation oracle (manual annotation edits are valid input)', 'actualOutputCells': actual})
            else:
                assert result.returncode != 0 and not (OUT / ('negative-output-' + name + '.xlsx')).exists()
                control.update({'rejectedBy': 'product reserved-cell/metadata gate', 'stderr': result.stderr})
            controls.append(control)
        # Realistic capacity file was generated by the core scale gate; Calc reopens all 20,100 rows.
        scale_started = time.monotonic(); document = load(OUT / 'scale-refreshed.xlsx', hidden=True)
        scale = capture(document); assert len(scale['Active']) == 20000 and len(scale['Removed']) == 100
        for item in scale['Active'] + scale['Removed']:
            row = item['values']; node_id = row[0]
            annotations = ['', '', ''] if node_id.startswith('NEW') else [f'007-{node_id}', f'First line for {node_id}\nSecond line 日本語', '=literal owner']
            assert row[6:] == annotations
            for value, kind in zip(row[6:], item['types'][6:]): assert kind == 'TEXT' if value else kind in ('EMPTY', 'TEXT')
        scale_result = {'active': 20000, 'removed': 100, 'annotationStringsChecked': 60300, 'reopenAndCheckSeconds': round(time.monotonic() - scale_started, 3)}; close(document)
        result = {'libreOfficeVersion': command('libreoffice', '--version').stdout.strip(), 'filter': 'Calc Office Open XML', 'annotated': annotated_record, 'refreshed': refreshed_record, 'restored': restored_record, 'negativeControls': controls, 'idempotentBytes': True, 'scale': scale_result, 'files': {name: digest(OUT / name) for name in ['initial.xlsx', 'calc-annotated.xlsx', 'refreshed.xlsx', 'unchanged.xlsx', 'restored.xlsx', 'scale-refreshed.xlsx']}, 'scope': 'Actual Calc setString, native row sort, XLSX save, close/reopen and typed-value checks; synthetic inputs only; no formula recalculation'}
        (OUT / 'calc-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    finally:
        for document in list(documents):
            try: close(document)
            except Exception: pass
        desktop.terminate()
        try: process.wait(timeout=15)
        except subprocess.TimeoutExpired: process.terminate()
        log.close()

if __name__ == '__main__': main()
