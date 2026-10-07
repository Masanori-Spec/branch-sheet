"""Download the official, digest-pinned test application. No binaries are distributed."""
import hashlib, json, os, pathlib, stat, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / '.native'
EVIDENCE = ROOT / 'evidence'
URL = 'https://github.com/freeplane/freeplane/releases/download/release-1.13.3/freeplane_bin-1.13.3.zip'
DIGEST = 'f1ac40ede94e0c47d0ca29fbfb2533fd41ced9e19d6a06abff78915a1214ba84'
SIZE = 71889782

def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Native applications run only in the reviewed hosted CI gate'
    WORK.mkdir(exist_ok=True); EVIDENCE.mkdir(exist_ok=True)
    target = WORK / 'freeplane.zip'
    with urllib.request.urlopen(URL, timeout=120) as response, target.open('wb') as out:
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            assert total <= SIZE, 'Unexpected official asset size'
            out.write(block)
    assert target.stat().st_size == SIZE
    assert hashlib.sha256(target.read_bytes()).hexdigest() == DIGEST
    destination = WORK / 'freeplane'
    destination.mkdir(exist_ok=True)
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        names = set(); expanded = 0
        for info in archive.infolist():
            path = pathlib.PurePosixPath(info.filename)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in info.filename
            assert info.filename not in names and not stat.S_ISLNK(info.external_attr >> 16)
            names.add(info.filename); expanded += info.file_size
            assert expanded < 512 * 1024 * 1024
        archive.extractall(destination)
    launchers = list(destination.rglob('freeplane.sh'))
    assert len(launchers) == 1
    (WORK / 'launcher-path.txt').write_text(str(launchers[0]) + '\n')
    versions = []
    for path in destination.rglob('version.properties'):
        value = path.read_text()
        if 'freeplane_version=' in value: versions.append(value)
    for path in destination.rglob('*.jar'):
        with zipfile.ZipFile(path) as jar:
            for name in jar.namelist():
                if name.endswith('/version.properties') or name == 'version.properties':
                    value = jar.read(name).decode('utf-8', errors='strict')
                    if 'freeplane_version=' in value: versions.append(value)
    assert versions and all('freeplane_version=1.13.3\n' in value for value in versions)
    result = {'freeplaneVersion': '1.13.3', 'commit': '3a76de18523993a55bf885190438bffef38662a5', 'officialURL': URL, 'sha256': DIGEST, 'bytes': SIZE, 'versionProperties': versions, 'securityPolicy': 'Unmodified official application; no SecurityManager or policy changes', 'distribution': 'Test-only application is excluded from source and evidence archives'}
    (EVIDENCE / 'native-provenance.json').write_text(json.dumps(result, indent=2) + '\n')

if __name__ == '__main__': main()
