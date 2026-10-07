"""Ordinary window-manager activation on the disposable hosted X display."""
import os, pathlib, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('DISPLAY'), 'Hosted disposable-display gate only'
    with (ROOT / 'evidence/openbox.log').open('w') as log:
        manager = subprocess.Popen(['openbox', '--config-file', '/etc/xdg/openbox/rc.xml'], stdout=log, stderr=subprocess.STDOUT)
        try:
            ready = False; end = time.monotonic() + 15
            while time.monotonic() < end:
                query = subprocess.run(['xdotool', 'get_num_desktops'], capture_output=True, text=True, timeout=5)
                if query.returncode == 0 and query.stdout.strip().isdigit() and int(query.stdout) > 0:
                    ready = True; break
                assert manager.poll() is None, 'Window manager exited during startup'
                time.sleep(.2)
            assert ready, 'Window-manager activation support unavailable'
            subprocess.run([sys.executable, 'scripts/freeplane-native.py'], cwd=ROOT, check=True, timeout=600)
            subprocess.run(['/usr/bin/python3', 'scripts/calc-native.py'], cwd=ROOT, check=True, timeout=900)
        finally:
            manager.terminate()
            try: manager.wait(timeout=10)
            except subprocess.TimeoutExpired: manager.kill()

if __name__ == '__main__': main()
