import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

MODULE = Path(__file__).parents[1] / 'renderer' / 'render.py'
spec = importlib.util.spec_from_file_location('marketing_renderer_contract', MODULE)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class RendererContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.background = self.root / 'synthetic.png'
        image = Image.new('RGB', (720, 1280), (25, 70, 95))
        draw = ImageDraw.Draw(image)
        draw.rectangle((360, 0, 719, 639), fill=(202, 93, 50))
        draw.ellipse((80, 760, 620, 1200), fill=(67, 154, 109))
        image.save(self.background)

    def tearDown(self):
        self.tmp.cleanup()

    def render(self, **overrides):
        width, height = overrides.pop('width', 1080), overrides.pop('height', 1920)
        slide = {
            'headline': 'A short illustrative headline',
            'body': 'An example line composed over the chosen image.',
            'image_path': str(self.background),
            'image_sha256': __import__('hashlib').sha256(self.background.read_bytes()).hexdigest(),
            'source_ref': 'fixture://synthetic-test-image',
            'crop': 'cover',
            'text_position': 'center',
        }
        slide.update(overrides)
        return renderer.render_slideshow({'slides': [slide], 'width': width, 'height': height})

    def test_rejects_invalid_matching_source_hash(self):
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            self.render(image_sha256='0' * 64)

    def test_rejects_empty_headline_and_body(self):
        with self.assertRaisesRegex(ValueError, 'empty'):
            self.render(headline=' ', body='')

    def test_rejects_unsupported_crop_and_text_position(self):
        with self.assertRaisesRegex(ValueError, 'crop'):
            self.render(crop='stretch')
        with self.assertRaisesRegex(ValueError, 'text_position'):
            self.render(text_position='diagonal')

    def test_composites_real_image_and_overlay_text_at_requested_size(self):
        result = self.render(width=720, height=1280)
        self.assertEqual(result['dimensions'], {'width': 720, 'height': 1280})
        rendered = Image.open(io.BytesIO(result['slides'][0]['png'])).convert('RGB')
        self.assertEqual(rendered.size, (720, 1280))
        self.assertGreater(len(rendered.getcolors(maxcolors=1000000) or []), 100)
        source = Image.open(self.background).convert('RGB').resize((720, 1280))
        self.assertNotEqual(rendered.getpixel((360, 640)), source.getpixel((360, 640)))
        self.assertEqual(result['slides'][0]['source_ref'], 'fixture://synthetic-test-image')
        self.assertEqual(len(result['slides'][0]['image_sha256']), 64)

    def test_rejects_missing_image_instead_of_rendering_a_flat_fill(self):
        with self.assertRaisesRegex(ValueError, 'image'):
            self.render(image_path=str(self.root / 'missing.png'))

    def test_rejects_unreadable_overflow_instead_of_shrinking_below_minimum(self):
        with self.assertRaisesRegex(ValueError, 'shorten'):
            self.render(headline='Oversized words ' * 200, body='Keep this line so only the headline overflows.')

    def test_export_contains_rendered_slides_and_provenance_manifest(self):
        result = self.render()
        output = self.root / 'slideshow.zip'
        renderer.export_slideshow_zip(result, output, source={'campaign_id': 'fixture-only'})
        with zipfile.ZipFile(output) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            self.assertIn('slide-01.png', archive.namelist())
            self.assertEqual(manifest['files'], ['slide-01.png'])
            self.assertEqual(len(manifest['slides']), 1)
            self.assertEqual(manifest['slides'][0]['source_ref'], 'fixture://synthetic-test-image')
            self.assertEqual(manifest['slides'][0]['image_sha256'], hashlib.sha256(self.background.read_bytes()).hexdigest())
        self.assertEqual(manifest['source']['campaign_id'], 'fixture-only')


if __name__ == '__main__':
    unittest.main()
