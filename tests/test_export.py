import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

MODULE = Path(__file__).parents[1] / 'renderer' / 'render.py'
spec = importlib.util.spec_from_file_location('marketing_renderer', MODULE)
assert spec and spec.loader
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class ExportTests(unittest.TestCase):
    def test_exports_pngs_and_source_manifest_that_reopens(self):
        with tempfile.TemporaryDirectory() as d:
            image_path = Path(d) / 'synthetic-export-fixture.png'
            image = Image.new('RGB', (640, 960), (18, 74, 101))
            draw = ImageDraw.Draw(image)
            draw.polygon([(0, 0), (640, 0), (320, 960)], fill=(204, 103, 56))
            image.save(image_path)
            digest = hashlib.sha256(image_path.read_bytes()).hexdigest()
            slide = {
                'headline': 'First example', 'body': 'Illustrative fixture copy.',
                'image_path': str(image_path), 'image_sha256': digest,
                'source_ref': 'fixture://synthetic-export-image',
            }
            rendered = renderer.render_slideshow({'slides': [slide, dict(slide, headline='Second example')]})
            out = renderer.export_slideshow_zip(rendered, Path(d) / 'draft.zip', {'draftId': 'fixture:focus-1', 'app': 'Synthetic test fixture'})
            with zipfile.ZipFile(out) as z:
                names = z.namelist()
                self.assertEqual(names, ['slide-01.png', 'slide-02.png', 'manifest.json'])
                manifest = json.loads(z.read('manifest.json'))
                self.assertEqual(manifest['source']['draftId'], 'fixture:focus-1')
                self.assertEqual(manifest['files'], names[:2])
                self.assertEqual(z.read('slide-01.png')[:8], b'\x89PNG\r\n\x1a\n')
                self.assertEqual([item['source_ref'] for item in manifest['slides']], ['fixture://synthetic-export-image'] * 2)
                self.assertEqual([item['image_sha256'] for item in manifest['slides']], [digest, digest])


if __name__ == '__main__':
    unittest.main()
