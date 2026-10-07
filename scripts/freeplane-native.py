"""Actual native GUI edits of a committed synthetic map under a disposable Xvfb display."""
import hashlib, json, os, pathlib, shutil, subprocess, time, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / '.native'; OUT = ROOT / 'evidence'
IDS = {'R': 'ID_1000001', 'A': 'ID_1000002', 'B': 'ID_1000003', 'X': 'ID_1000004', 'Y': 'ID_1000005'}
STEPS = []

def run(*args, **kw): return subprocess.run(args, check=True, timeout=kw.pop('timeout', 30), text=True, capture_output=True, **kw)
def wait(check, message, seconds=30):
    end = time.monotonic() + seconds; last = None
    while time.monotonic() < end:
        try:
            value = check()
            if value: return value
        except (ET.ParseError, FileNotFoundError, subprocess.CalledProcessError) as error: last = str(error)
        time.sleep(.25)
    raise AssertionError(f'{message}: {last}')
def key(*keys): run('xdotool', 'key', '--clearmodifiers', *keys); time.sleep(.25)
def type_text(value): run('xdotool', 'type', '--clearmodifiers', '--delay', '30', value)
def snapshot(name):
    time.sleep(.4); run('scrot', str(OUT / name))
def parse(path):
    tree = ET.parse(path).getroot(); roots = tree.findall('node'); assert len(roots) == 1
    rows = []
    def visit(node, parent=''):
        rows.append([node.attrib['ID'], node.attrib.get('TEXT'), parent])
        for child in node.findall('node'): visit(child, node.attrib['ID'])
    visit(roots[0]); assert len({r[0] for r in rows}) == len(rows)
    return rows
def expected_before():
    return [[IDS['R'], 'Catalog', ''], [IDS['A'], 'Products', IDS['R']], [IDS['X'], 'Alpha', IDS['A']], [IDS['B'], 'Services', IDS['R']], [IDS['Y'], 'Alpha', IDS['B']]]

def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('DISPLAY'), 'Hosted disposable-display gate only'
    OUT.mkdir(exist_ok=True); WORK.mkdir(exist_ok=True)
    launcher = pathlib.Path((WORK / 'launcher-path.txt').read_text().strip())
    profile = WORK / 'freeplane-profile'; preferences = profile / '1.12.x'; preferences.mkdir(parents=True, exist_ok=True)
    # Ordinary startup/keyboard preferences only. Official security and scripting policy stay untouched.
    settings = 'load_last_map=false\nload_last_maps=false\nalways_load_last_maps=false\nacceleratorFor.MindMap/CopyIDAction=control alt I\n'
    (preferences / 'auto.properties').write_text(settings)
    (OUT / 'freeplane-fixture-preferences.txt').write_text(settings)
    current = WORK / 'native-map.mm'; shutil.copyfile(ROOT / 'fixtures/seed.mm', current)
    command = ['bash', str(launcher), '-U' + str(profile)]
    log = (OUT / 'freeplane.log').open('w')
    process = subprocess.Popen(command + [current.as_uri()], cwd=launcher.parent, stdout=log, stderr=subprocess.STDOUT)
    def focus():
        # Java's WM_CLASS is platform-dependent. Select only the explicit synthetic map title.
        ids = run('xdotool', 'search', '--onlyvisible', '--name', current.stem).stdout.split()
        windows = [value for value in ids if current.stem.lower() in run('xdotool', 'getwindowname', value).stdout.lower()]
        if not windows: return None
        assert len(windows) == 1, 'Ambiguous synthetic map window'
        window = windows[-1]; run('xdotool', 'windowfocus', '--sync', window)
        run('xdotool', 'windowsize', window, '1500', '920'); return window
    def open_node(node_id, verify_clipboard=True):
        run(*command, current.as_uri() + '#' + node_id, timeout=40)
        time.sleep(.6); wait(focus, 'Synthetic native map window is not selected')
        if verify_clipboard:
            key('ctrl+alt+i')
            observed = wait(lambda: run('xclip', '-selection', 'clipboard', '-o').stdout == node_id, 'Native selection did not match exact ID')
            assert observed
        STEPS.append({'action': 'select-by-native-file-fragment', 'id': node_id, 'clipboardVerified': verify_clipboard})
    def save_expect(expected, name):
        key('ctrl+s'); rows = wait(lambda: parse(current) == expected and parse(current), 'Native saved map differs from fixed expected state')
        STEPS.append({'action': name, 'rows': rows, 'sha256': hashlib.sha256(current.read_bytes()).hexdigest()})
    def rename(node_id, label):
        open_node(node_id); key('F2'); key('ctrl+a'); type_text(label); key('Return')
    try:
        wait(lambda: focus(), 'Freeplane did not start', 90)
        rename(IDS['R'], 'Catalog'); save_expect(expected_before(), 'native-first-save')
        key('ctrl+w'); open_node(IDS['R'])
        rename(IDS['R'], 'Reopen marker'); interim = expected_before(); interim[0][1] = 'Reopen marker'; save_expect(interim, 'reopened-native-edit')
        rename(IDS['R'], 'Catalog'); save_expect(expected_before(), 'native-before-reopen-save')
        shutil.copyfile(current, OUT / 'before.mm'); snapshot('freeplane-before.png')
        rename(IDS['X'], 'Beta'); renamed = expected_before(); renamed[2][1] = 'Beta'; save_expect(renamed, 'rename-X-preserves-ID')
        open_node(IDS['X']); key('ctrl+x')
        # CopyID would replace the move clipboard. This selection is checked by the complete saved-tree oracle below.
        open_node(IDS['B'], verify_clipboard=False); key('ctrl+v')
        moved = [renamed[0], renamed[1], renamed[3], renamed[4], [IDS['X'], 'Beta', IDS['B']]]
        save_expect(moved, 'cross-parent-move-preserves-ID')
        open_node(IDS['A']); key('Tab'); type_text('New'); key('Return'); key('ctrl+s')
        added = wait(lambda: len(parse(current)) == 6 and parse(current), 'Native child was not added')
        new = [row for row in added if row[0] not in IDS.values()]
        assert len(new) == 1 and new[0][1:] == ['New', IDS['A']]
        IDS['Z'] = new[0][0]
        with_z = [moved[0], moved[1], new[0], *moved[2:]]
        assert added == with_z
        STEPS.append({'action': 'native-add-generated-ID', 'id': IDS['Z'], 'rows': added})
        open_node(IDS['Y']); key('Delete'); time.sleep(.3)
        snapshot('freeplane-delete-dialog.png'); key('Return')
        updated = [row for row in with_z if row[0] != IDS['Y']]
        save_expect(updated, 'native-delete-Y')
        shutil.copyfile(current, OUT / 'updated.mm'); snapshot('freeplane-updated.png')
        key('ctrl+z'); save_expect(with_z, 'native-undo-restores-same-Y-ID')
        shutil.copyfile(current, OUT / 'restored.mm')
        # Reopen the saved changed file through the actual application, then save an inert label round trip.
        key('ctrl+w'); current = OUT / 'updated.mm'
        open_node(IDS['R']); rename(IDS['R'], 'Reopen changed'); changed = [list(r) for r in updated]; changed[0][1] = 'Reopen changed'; save_expect(changed, 'updated-reopened-edit')
        rename(IDS['R'], 'Catalog'); save_expect(updated, 'updated-reopened-save')
        assert parse(OUT / 'before.mm') == expected_before()
        assert parse(OUT / 'updated.mm') == updated and parse(OUT / 'restored.mm') == with_z
        (OUT / 'freeplane-result.json').write_text(json.dumps({'ids': IDS, 'steps': STEPS, 'before': expected_before(), 'updated': updated, 'restored': with_z, 'scope': 'Unmodified Freeplane GUI save/reopen/rename/move/add/delete/undo on one synthetic map; no scripts or formula evaluation'}, indent=2) + '\n')
        key('ctrl+q'); process.wait(timeout=20)
    finally:
        visible = []
        try:
            for window in run('xdotool', 'search', '--onlyvisible', '--name', '.').stdout.split()[:40]:
                visible.append({'window': window, 'title': run('xdotool', 'getwindowname', window).stdout.strip()[:512]})
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired): pass
        (OUT / 'freeplane-progress.json').write_text(json.dumps({'steps': STEPS, 'visibleWindowsAtEnd': visible, 'processExit': process.poll()}, indent=2) + '\n')
        if current.exists(): shutil.copyfile(current, OUT / 'freeplane-working-copy.mm')
        if process.poll() is None:
            snapshot('freeplane-failure.png'); process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill()
        log.close()

if __name__ == '__main__': main()
