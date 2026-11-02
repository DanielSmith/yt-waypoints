#!/usr/bin/env python3
"""Assemble self-contained Firefox/Chrome folders and deterministic store ZIPs.

No download, bundler, or minification. Run from any working directory.
"""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ('firefox', 'chrome')


def validate(package):
    manifest = json.loads((package / 'manifest.json').read_text())
    # Chromium validates every suggested shortcut, including the default on Mac.
    # Ctrl+Alt and Command+Option are forbidden in shortcut suggestions.
    if 'browser_specific_settings' not in manifest:
        for command in manifest.get('commands', {}).values():
            keys = command.get('suggested_key', {})
            if isinstance(keys, str):
                keys = {'default': keys}
            for platform, shortcut in keys.items():
                modifiers = set(shortcut.split('+')[:-1])
                if modifiers & {'Alt', 'Option'} and modifiers & {'Ctrl', 'Command', 'MacCtrl'}:
                    raise ValueError(f'Invalid Chromium shortcut ({platform}): {shortcut}; use Ctrl+Shift instead')
    refs = [manifest['action']['default_popup']]
    icons = manifest['action']['default_icon']
    refs.extend(icons.values() if isinstance(icons, dict) else [icons])
    refs.extend(manifest['icons'].values())
    for script in manifest['content_scripts']:
        refs.extend(script['js'])
    for group in manifest.get('web_accessible_resources', []):
        refs.extend(group['resources'])

    class Page(HTMLParser):
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == 'script' and 'src' in attrs:
                refs.append(attrs['src'])
            if tag == 'link' and attrs.get('rel') == 'stylesheet' and 'href' in attrs:
                refs.append(attrs['href'])

    Page().feed((package / manifest['action']['default_popup']).read_text())
    for ref in refs:
        item = package / ref
        if not item.is_file() or not item.resolve().is_relative_to(package.resolve()):
            raise ValueError(f'Missing or invalid extension resource: {ref}')
    return manifest


def write_zip(package, destination):
    # Stable timestamps/order make identical source produce identical ZIP bytes.
    temporary = destination.with_suffix('.zip.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for item in sorted(package.rglob('*')):
                if item.is_file():
                    info = zipfile.ZipInfo(item.relative_to(package).as_posix(), (2020, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    archive.writestr(info, item.read_bytes())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def build(browser):
    version = json.loads((ROOT / 'package.json').read_text())['version']
    output = ROOT / f'yt-waypoints-{browser}'
    source = ROOT / 'src'
    # Build and check everything before changing the loadable extension.
    with tempfile.TemporaryDirectory(prefix='.waypoints-build-', dir=ROOT) as td:
        staged = Path(td)
        shutil.copytree(source / 'shared', staged, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
        shutil.copytree(source / browser, staged, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
        manifest = json.loads((staged / 'manifest.json').read_text())
        manifest['version'] = version
        (staged / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (staged / 'BUILD-INFO.txt').write_text(
            'Generated extension. Edit src/shared/ and src/' + browser + '/, then rebuild.\n'
        )
        shutil.copy2(ROOT / "LICENSE", staged / "LICENSE")
        validate(staged)
        artifacts = ROOT / 'artifacts'
        artifacts.mkdir(exist_ok=True)
        zip_path = artifacts / f'yt-waypoints-{browser}-{version}.zip'
        write_zip(staged, zip_path)
        # Preserve output path: changing an unpacked Chrome extension's path
        # can change its identity and disconnect it from existing local data.
        previous = ROOT / f'.yt-waypoints-{browser}.previous'
        if previous.exists():
            raise FileExistsError(f'Unfinished previous build found: {previous}')
        if output.exists():
            output.rename(previous)
        try:
            staged.rename(output)
        except BaseException:
            if previous.exists():
                previous.rename(output)
            raise
        if previous.exists():
            shutil.rmtree(previous)
    print(f'{browser}: {output.relative_to(ROOT)}/ -> {zip_path.relative_to(ROOT)}')


def write_sources():
    version = json.loads((ROOT / 'package.json').read_text())['version']
    artifacts = ROOT / 'artifacts'
    artifacts.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.waypoints-source-', dir=ROOT) as td:
        stage = Path(td)
        for name in ('src', 'tests', 'assets'):
            shutil.copytree(ROOT / name, stage / name,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
        (stage / 'scripts').mkdir()
        shutil.copy2(ROOT / 'scripts/build.py', stage / 'scripts/build.py')
        for name in ('package.json', 'README.md', 'PRIVACY.md', 'LICENSE'):
            shutil.copy2(ROOT / name, stage / name)
        write_zip(stage, artifacts / f'yt-waypoints-source-{version}.zip')
    print(f'Reviewer sources: artifacts/yt-waypoints-source-{version}.zip')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('browser', nargs='?', choices=(*TARGETS, 'all'), default='all')
    args = parser.parse_args()
    for browser in TARGETS if args.browser == 'all' else (args.browser,):
        build(browser)
    write_sources()


if __name__ == '__main__':
    main()
