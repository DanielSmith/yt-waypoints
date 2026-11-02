#!/usr/bin/env python3
"""Check generated packages, isolated rebuilds, and failure-before-replacement."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
version = json.loads((ROOT / 'package.json').read_text())['version']
shared = ROOT / 'src/shared'

for browser in ('firefox', 'chrome'):
    package = ROOT / f'yt-waypoints-{browser}'
    manifest = json.loads((package / 'manifest.json').read_text())
    assert manifest['version'] == version
    assert manifest['name'] == 'YT Waypoints'
    assert (package / 'LICENSE').read_bytes() == (ROOT / 'LICENSE').read_bytes()
    assert manifest['permissions'] == ['storage', 'activeTab', 'scripting']
    assert all(p.endswith('.png') for p in manifest['icons'].values())
    for size in (16,32,48,96,128):
        image = (package / manifest['icons'][str(size)]).read_bytes()
        assert image[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II',image[16:24]) == (size,size)
    assert not (package / 'icon.svg').exists()
    for item in shared.rglob('*'):
        if item.is_file() and item.name != ".DS_Store" and "__pycache__" not in item.parts and item.suffix != ".pyc":
            assert item.read_bytes() == (package / item.relative_to(shared)).read_bytes(), item
    assert 'background' not in manifest
    assert 'web_accessible_resources' not in manifest
    assert manifest['content_scripts'][0]['js'] == ['metadata.js', 'content.js']
    assert set(manifest['commands']) == {'_execute_action'}
    for removed in ('overlay.js', 'background.js', 'bridge.js', 'worker.js'):
        assert not (package / removed).exists(), removed
    if browser == 'chrome':
        assert 'browser_specific_settings' not in manifest
        assert 'minimum_chrome_version' not in manifest
        assert all(p.endswith('.png') for p in manifest['icons'].values())
    else:
        gecko = manifest['browser_specific_settings']['gecko']
        assert gecko['id'] == 'yt-waypoints@local'
        assert gecko['data_collection_permissions']['required'] == ['none']
        assert 'optional' not in gecko['data_collection_permissions']
    archive = ROOT / 'artifacts' / f'yt-waypoints-{browser}-{version}.zip'
    with zipfile.ZipFile(archive) as z:
        assert 'manifest.json' in z.namelist()
        assert json.loads(z.read('manifest.json')) == manifest
        assert z.testzip() is None
        assert sorted(z.namelist()) == sorted(str(p.relative_to(package)) for p in package.rglob('*') if p.is_file())
        assert not any(p.startswith(('backups/', 'tests/', 'src/', 'scripts/')) for p in z.namelist())
        assert not any('__pycache__' in p or '.DS_Store' in p for p in z.namelist())
        for name in z.namelist():
            assert z.read(name) == (package / name).read_bytes()
print('PASS: shared file parity, popup-only manifests (no worker/overlay), identities, root manifests, ZIP contents match loadable folders')

source_zip = ROOT / 'artifacts' / f'yt-waypoints-source-{version}.zip'
with tempfile.TemporaryDirectory(prefix='waypoints-clean-build-') as td:
    clone = Path(td)
    with zipfile.ZipFile(source_zip) as z:
        names = z.namelist()
        assert all(not p.startswith('/') and '..' not in Path(p).parts for p in names)
        assert z.read('LICENSE') == (ROOT / 'LICENSE').read_bytes()
        assert json.loads(z.read('package.json'))['license'] == 'Apache-2.0'
        assert 'src/shared/popup.js' in names and 'scripts/build.py' in names and 'README.md' in names
        assert 'STORE-SUBMISSION.md' not in names
        assert not any(p.startswith(('artifacts/', 'backups/', 'yt-waypoints-')) for p in names)
        z.extractall(clone)
    result = subprocess.run(['python3', str(clone / 'scripts/build.py')], cwd=td, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    for browser in ('firefox', 'chrome', 'source'):
        name = f'yt-waypoints-{browser}-{version}.zip'
        assert (clone / 'artifacts' / name).read_bytes() == (ROOT / 'artifacts' / name).read_bytes(), name
    # A missing required file must leave an already built package unchanged.
    old_manifest = (clone / 'yt-waypoints-firefox/manifest.json').read_bytes()
    (clone / 'src/firefox/platform.js').unlink()
    failed = subprocess.run(['python3', str(clone / 'scripts/build.py'), 'firefox'], capture_output=True, text=True)
    assert failed.returncode != 0
    assert (clone / 'yt-waypoints-firefox/manifest.json').read_bytes() == old_manifest
    # Exercise the native rule that caused Brave to reject an earlier package.
    chrome_source = clone / 'src/chrome/manifest.json'
    before = (clone / 'yt-waypoints-chrome/manifest.json').read_bytes()
    valid = chrome_source.read_text()
    for platform, shortcut in [('default', 'Ctrl+Alt+Y'), ('mac', 'Command+Alt+Y'), ('mac', 'Command+Option+Y')]:
        invalid = json.loads(valid)
        invalid['commands']['_execute_action']['suggested_key'][platform] = shortcut
        chrome_source.write_text(json.dumps(invalid))
        rejected = subprocess.run(['python3', str(clone / 'scripts/build.py'), 'chrome'], capture_output=True, text=True)
        assert rejected.returncode != 0, shortcut
        assert 'Invalid Chromium shortcut' in rejected.stderr
        assert (clone / 'yt-waypoints-chrome/manifest.json').read_bytes() == before

print('PASS: reviewer source ZIP rebuilds identical packages; missing resources/invalid Chromium shortcuts rejected without replacing existing packages')
