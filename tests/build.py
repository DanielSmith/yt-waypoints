#!/usr/bin/env python3
"""Check generated packages, isolated rebuilds, and failure-before-replacement."""
import hashlib
import json
import re
import runpy
from pathlib import Path
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
version = json.loads((ROOT / 'package.json').read_text())['version']
shared = ROOT / 'src/shared'

# Signing material must never replace a previously valid archive, including
# when a private key has been renamed to an ordinary distributable filename.
build_tools = runpy.run_path(str(ROOT / 'scripts/build.py'))
with tempfile.TemporaryDirectory(prefix='waypoints-key-guard-') as td:
    directory = Path(td)
    package = directory / 'package'
    package.mkdir()
    destination = directory / 'package.zip'
    destination.write_bytes(b'previous archive')
    cases = [(name, b'not a real key') for name in
             ('signing.PEM', 'signing.key', 'signing.p12', 'signing.pfx',
              'signing.pkcs8', 'signing.ppk', 'id_rsa', 'id_ed25519')]
    for label in ('PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY',
                  'OPENSSH PRIVATE KEY', 'ENCRYPTED PRIVATE KEY'):
        header = b'-----BEGIN ' + label.encode() + b'-----'
        cases.append(('renamed.txt', header + b'\nsynthetic test data\n'))
    for name, data in cases:
        item = package / name
        item.write_bytes(data)
        try:
            build_tools['write_zip'](package, destination)
        except ValueError as error:
            assert name in str(error)
            assert 'synthetic test data' not in str(error)
        else:
            raise AssertionError(f'Signing material accepted: {name}')
        assert destination.read_bytes() == b'previous archive'
        assert not destination.with_suffix('.zip.tmp').exists()
        item.unlink()
    public = b'-----BEGIN ' + b'PUBLIC KEY-----\npublic fixture\n'
    (package / 'public.txt').write_bytes(public)
    build_tools['write_zip'](package, destination)
    with zipfile.ZipFile(destination) as archive:
        assert archive.read('public.txt') == public
print('PASS: key filenames and renamed private-key content rejected without replacing archives; public content allowed')

for browser in ('firefox', 'chrome'):
    package = ROOT / f'yt-waypoints-{browser}'
    manifest = json.loads((package / 'manifest.json').read_text())
    assert re.fullmatch(r'(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}', manifest['version'])
    assert all(int(part) <= 65535 for part in manifest['version'].split('.'))
    assert manifest['version'] == version.split('-', 1)[0].split('+', 1)[0]
    if browser == 'chrome' and manifest['version'] != version:
        assert manifest['version_name'] == version
    else:
        assert 'version_name' not in manifest
    assert manifest['name'] == 'YT Waypoints'
    assert (package / 'LICENSE').read_bytes() == (ROOT / 'LICENSE').read_bytes()
    assert (package / 'THIRD-PARTY-NOTICES.md').read_bytes() == (ROOT / 'THIRD-PARTY-NOTICES.md').read_bytes()
    assert manifest['permissions'] == ['storage', 'activeTab', 'scripting']
    assert manifest['host_permissions'] == ['*://*.youtube.com/*']
    assert all(p.endswith('.png') for p in manifest['icons'].values())
    for size in (16,32,48,96,128):
        image = (package / manifest['icons'][str(size)]).read_bytes()
        assert image[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II',image[16:24]) == (size,size)
    assert not (package / 'icon.svg').exists()
    for item in shared.rglob('*'):
        if item.is_file() and item.name != ".DS_Store" and "__pycache__" not in item.parts and item.suffix not in ('.pyc', '.js', '.mjs'):
            assert item.read_bytes() == (package / item.relative_to(shared)).read_bytes(), item
    assert 'background' not in manifest
    assert 'web_accessible_resources' not in manifest
    assert manifest['content_scripts'][0]['js'] == ['content-scripts/content.js']
    popup = (package / 'popup.html').read_text()
    assert '<svg' not in popup.lower(), 'UI SVGs must remain external assets'
    assert (package / 'icons/settings.svg').read_bytes() == (shared / 'icons/settings.svg').read_bytes()
    assert 'icons/settings.svg' in (package / 'popup.css').read_text()
    scripts = re.findall(r'<script\b[^>]*\bsrc="([^"]+)"', popup)
    assert len(scripts) == 2 and scripts[0] == '/theme.js'
    assert 'type="module"' in popup
    popup_script = scripts[1].lstrip('/')
    assert (package / 'themes.html').read_bytes() == (shared / 'themes.html').read_bytes()
    manager_scripts = re.findall(r'<script\b[^>]*\bsrc="([^"]+)"', (package / 'themes.html').read_text())
    assert manager_scripts == ['/theme.js', '/theme-manager.js']
    assert (package / 'workspace.html').read_bytes() == (shared / 'workspace.html').read_bytes()
    expected_scripts = ['theme.js', 'theme-manager.js', 'workspace.js', 'content-scripts/content.js', popup_script]
    assert sorted(str(p.relative_to(package)) for p in package.rglob('*.js')) == sorted(expected_scripts)
    for entry in expected_scripts:
        script = package / entry
        assert script.stat().st_size < 5_000_000
        banner = '/*! YT Waypoints | Copyright 2026 Daniel Smith | Apache-2.0 | See LICENSE and THIRD-PARTY-NOTICES.md */'
        # WXT puts content/unlisted script banners just inside its IIFE wrapper.
        assert banner in script.read_text()[:512], entry
        assert script.read_text().count(banner) == 1, entry
        assert f'//# sourceMappingURL={script.name}.map' in script.read_text()
        mapping = json.loads(script.with_suffix('.js.map').read_text())
        assert mapping['sources'] and len(mapping['sources']) == len(mapping['sourcesContent'])
        for name, content in zip(mapping['sources'], mapping['sourcesContent']):
            assert not name.startswith('/') and str(ROOT) not in name, name
            original = (script.parent / name.split('?', 1)[0]).resolve()
            if original.is_relative_to(ROOT / 'src'):
                if name.endswith('?raw'):
                    assert content.startswith('export default '), name
                    assert original.read_text() == json.loads(content.removeprefix('export default ').rstrip(';\n ')), name
                else:
                    assert original.read_text() == content, name
        if entry in (popup_script, 'content-scripts/content.js'):
            assert any(name.endswith('/settings-policy.js') for name in mapping['sources'])
            assert not (package / 'settings-policy.js').exists()
            assert any(name.endswith('/youtube-values.js') for name in mapping['sources'])
            assert not (package / 'youtube-values.js').exists()
        if entry == popup_script:
            assert any(name.endswith('/alap-transfer.mjs') for name in mapping['sources'])
            assert any(name.endswith('/alap-macro-store.mjs') for name in mapping['sources'])
            for query_module in ('alap-query.mjs', 'alap-search-view.mjs', 'alap-tags-core/refiners.mjs'):
                assert any(name.endswith('/' + query_module) for name in mapping['sources']), query_module
            for helper in ('display-time.js', 'popup-dom.js', 'popup-shortcuts.js', 'popup-annotation-editor.js', 'popup-file-save.js'):
                assert any(name.endswith('/' + helper) for name in mapping['sources'])
                assert not (package / helper).exists()
            assert any(name.endswith('/popup-refresh.mjs') for name in mapping['sources'])
            assert not (package / 'popup-refresh.mjs').exists()
            assert any(f'src/{browser}/platform.js' in name for name in mapping['sources'])
            assert not any(f'src/{"chrome" if browser == "firefox" else "firefox"}/' in name for name in mapping['sources'])
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
print('PASS: static-file parity, bundled scripts/maps, popup-only manifests, identities, ZIP contents match loadable folders')

source_zip = ROOT / 'artifacts' / f'yt-waypoints-source-{version}.zip'
with tempfile.TemporaryDirectory(prefix='waypoints-clean-build-') as td:
    clone = Path(td)
    with zipfile.ZipFile(source_zip) as z:
        names = z.namelist()
        assert all(not p.startswith('/') and '..' not in Path(p).parts for p in names)
        assert z.read('LICENSE') == (ROOT / 'LICENSE').read_bytes()
        assert json.loads(z.read('package.json'))['license'] == 'Apache-2.0'
        assert 'src/shared/popup.js' in names and 'src/entrypoints/popup.html' in names
        assert 'scripts/build.py' in names and 'README.md' in names
        assert 'scripts/check-alap-boundary.mjs' in names
        assert not any('node_modules/alap/' in name for name in names)
        for name in ('index.mjs', 'syntax.mjs', 'refiners.mjs', 'PROVENANCE.json', 'LICENSE', 'README.md'):
            relative = 'src/vendor/alap-tags-core/' + name
            assert z.read(relative) == (ROOT / relative).read_bytes()
        for folder in ('popup', 'keyboard'):
            for suite in (ROOT / 'tests' / folder).rglob('*.cjs'):
                relative = suite.relative_to(ROOT).as_posix()
                assert z.read(relative) == suite.read_bytes(), relative
        assert z.read('.prettierrc.json') == (ROOT / '.prettierrc.json').read_bytes()
        for name in ('package-lock.json', 'scripts/build-wxt.mjs', 'wxt.config.mjs', 'BUILDING.md', 'tests/run.cjs', 'tests/quality.cjs'):
            assert z.read(name) == (ROOT / name).read_bytes()
        assert 'STORE-SUBMISSION.md' not in names
        assert not any(p.startswith(('artifacts/', 'backups/', 'yt-waypoints-')) for p in names)
        z.extractall(clone)
    # Use the lockfile and a clean node_modules directory, without network. npm
    # ci in the parent project must have cached the pinned packages first.
    install = subprocess.run(['npm', 'ci', '--offline', '--no-audit', '--no-fund'],
                             cwd=clone, capture_output=True, text=True)
    assert install.returncode == 0, install.stderr
    result = subprocess.run(['python3', str(clone / 'scripts/build.py')], cwd=td, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    for browser in ('firefox', 'chrome', 'source'):
        name = f'yt-waypoints-{browser}-{version}.zip'
        assert (clone / 'artifacts' / name).read_bytes() == (ROOT / 'artifacts' / name).read_bytes(), name
    # A query-source capability regression must fail before changing outputs.
    parser_guard_target = clone / 'src/shared/alap-query.mjs'
    original_query = parser_guard_target.read_text()
    guarded_outputs = [*list((clone / 'artifacts').glob('*.zip')),
                       clone / 'yt-waypoints-firefox/manifest.json',
                       clone / 'yt-waypoints-chrome/manifest.json']
    before_guard = {item: item.read_bytes() for item in guarded_outputs}
    parser_guard_target.write_text(original_query + '\nimport "alap/core";\n')
    guard_result = subprocess.run(['python3', str(clone / 'scripts/build.py')], capture_output=True, text=True)
    assert guard_result.returncode != 0 and 'Alap submission boundary' in guard_result.stderr
    assert all(item.read_bytes() == before for item, before in before_guard.items())
    parser_guard_target.write_text(original_query)
    # Source-only assets are not necessarily present in a browser bundle. The
    # preflight must still reject them before changing any browser/archive.
    protected = [clone / f'yt-waypoints-{browser}' / 'manifest.json' for browser in ('firefox', 'chrome')]
    protected.extend((clone / 'artifacts').glob('*.zip'))
    before_keys = {item: item.read_bytes() for item in protected}
    for name, data in [('signing.pem', b'synthetic fixture'),
                       ('renamed.txt', b'-----BEGIN ' + b'PRIVATE KEY-----\nsynthetic fixture\n')]:
        item = clone / 'assets' / name
        item.write_bytes(data)
        rejected = subprocess.run(['python3', str(clone / 'scripts/build.py')], capture_output=True, text=True)
        assert rejected.returncode != 0
        assert 'cannot be distributed' in rejected.stderr and name in rejected.stderr
        assert all(path.read_bytes() == before for path, before in before_keys.items())
        item.unlink()
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

print('PASS: reviewer source ZIP rebuilds identical packages; signing material/missing resources/invalid Chromium shortcuts rejected without replacing existing packages')
