import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).with_name('validate-font-catalog.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fonts = self.root / 'fonts'
        self.fonts.mkdir()
        (self.fonts / 'Test.ttf').write_bytes(b'font')
        (self.root / 'manifest.json').write_text(json.dumps({'fonts': [
            {'file': 'Test.ttf', 'sha256': hashlib.sha256(b'font').hexdigest()}]}))

    def metadata(self):
        path = self.fonts / '._Test.ttf'
        path.write_bytes(bytes.fromhex('0005160700020000') + b' ' * 16 + struct.pack('>HIII', 1, 9, 38, 4) + b'meta')
        return path

    def test_clean_catalog(self):
        module.validate(self.root)
        self.assertEqual((self.fonts / 'Test.ttf').read_bytes(), b'font')

    def test_only_valid_metadata_removed_and_rerun_safe(self):
        sidecar = self.metadata()
        module.validate(self.root)
        self.assertFalse(sidecar.exists())
        module.validate(self.root)

    def test_unknown_font_still_rejected(self):
        sidecar = self.metadata()
        (self.fonts / 'Extra.ttf').write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError, 'unlisted'):
            module.validate(self.root)
        self.assertTrue(sidecar.exists())

    def test_fake_metadata_rejected(self):
        (self.fonts / '._Test.ttf').write_bytes(b'not AppleDouble')
        with self.assertRaisesRegex(ValueError, 'unlisted'):
            module.validate(self.root)

    def test_modified_font_rejected_without_cleanup(self):
        sidecar = self.metadata()
        (self.fonts / 'Test.ttf').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            module.validate(self.root)
        self.assertTrue(sidecar.exists())

    def test_symlink_rejected(self):
        (self.fonts / 'Test.ttf').unlink()
        (self.root / 'outside').write_bytes(b'font')
        (self.fonts / 'Test.ttf').symlink_to(self.root / 'outside')
        with self.assertRaisesRegex(ValueError, 'invalid font'):
            module.validate(self.root)

    def test_unlisted_directory_rejected(self):
        (self.fonts / 'cache').mkdir()
        with self.assertRaisesRegex(ValueError, 'unlisted'):
            module.validate(self.root)


if __name__ == '__main__':
    unittest.main()
