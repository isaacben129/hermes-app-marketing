import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]

class PackagedPluginImportTests(unittest.TestCase):
    def test_runtime_entry_does_not_import_local_javascript_modules(self):
        source = (ROOT / 'plugin.js').read_text()
        self.assertNotIn("from './renderer-client.js'", source)
        self.assertNotIn('renderer-client.js', source)

    def test_packaged_entry_copies_are_identical(self):
        source = (ROOT / 'plugin.js').read_bytes()
        self.assertEqual((ROOT / 'desktop/plugin.js').read_bytes(), source)
        self.assertEqual((ROOT / 'desktop-plugins/marketing-system/plugin.js').read_bytes(), source)

if __name__ == '__main__': unittest.main()
