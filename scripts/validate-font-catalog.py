#!/usr/bin/env python3
"""Remove only verified AppleDouble companions; keep the font catalog closed."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct


def apple_double(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        return False
    data = path.read_bytes()
    if len(data) < 26 or data[:8] != bytes.fromhex('0005160700020000'):
        return False
    count = struct.unpack_from('>H', data, 24)[0]
    end = 26 + count * 12
    if not count or end > len(data):
        return False
    for index in range(count):
        _, offset, length = struct.unpack_from('>III', data, 26 + index * 12)
        if offset < end or offset + length > len(data):
            return False
    return True


def validate(catalog):
    manifest_path = catalog / 'manifest.json'
    fonts_dir = catalog / 'fonts'
    if catalog.is_symlink() or manifest_path.is_symlink() or fonts_dir.is_symlink():
        raise ValueError('linked catalog is not allowed')
    manifest = json.loads(manifest_path.read_bytes())
    expected = {}
    for entry in manifest['fonts']:
        name = entry['file']
        if not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(ttf|otf|ttc)', name) or '..' in name or name in expected:
            raise ValueError('invalid or duplicate font filename: ' + name)
        expected[name] = entry['sha256']
    if not expected:
        raise ValueError('empty font catalog')
    metadata = []
    for path in fonts_dir.iterdir():
        if path.name in expected:
            if path.is_symlink() or not path.is_file():
                raise ValueError('invalid font file: ' + path.name)
        elif path.name.startswith('._') and path.name[2:] in expected and apple_double(path):
            metadata.append(path)
        else:
            raise ValueError('unlisted file in font catalog: ' + path.name)
    for name, digest in expected.items():
        if hashlib.sha256((fonts_dir / name).read_bytes()).hexdigest() != digest:
            raise ValueError('font checksum mismatch: ' + name)
    # Do not modify anything until every real font and extra entry is validated.
    for path in metadata:
        path.unlink()
    print(f'{catalog.name}: verified {len(expected)} fonts; removed {len(metadata)} AppleDouble metadata files')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('browser_directory', type=Path)
    args = parser.parse_args()
    catalogs = list((args.browser_directory / 'clawbrowser-fonts').glob('*/manifest.json'))
    if not catalogs:
        raise SystemExit('No bundled font catalog found; refusing unvalidated runtime')
    for manifest in catalogs:
        validate(manifest.parent)


if __name__ == '__main__':
    main()
