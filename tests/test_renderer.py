import hashlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw

MODULE = Path(__file__).parents[1] / 'renderer' / 'render.py'
spec = importlib.util.spec_from_file_location('marketing_renderer', MODULE)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class RendererTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.image_path = Path(self.tmp.name) / 'synthetic-fixture.png'
        image = Image.new('RGB', (720, 1280), (25, 70, 95))
        draw = ImageDraw.Draw(image)
        draw.rectangle((360, 0, 719, 639), fill=(202, 93, 50))
        draw.ellipse((80, 760, 620, 1200), fill=(67, 154, 109))
        image.save(self.image_path)

    def tearDown(self):
        self.tmp.cleanup()

    def slide(self, headline='One small practice step', body='Notice what happened'):
        return {
            'headline': headline,
            'body': body,
            'image_path': str(self.image_path),
            'image_sha256': hashlib.sha256(self.image_path.read_bytes()).hexdigest(),
            'source_ref': 'fixture://synthetic-test-image',
        }

    def test_renders_ordered_slides_to_valid_png_dimensions(self):
        result = renderer.render_slideshow({'slides': [self.slide(), self.slide('Start small', 'Try one step')]})
        self.assertEqual(result['dimensions'], {'width': 1080, 'height': 1920})
        self.assertEqual([s['index'] for s in result['slides']], [1, 2])
        for slide in result['slides']:
            image = Image.open(io.BytesIO(slide['png']))
            self.assertEqual(image.format, 'PNG')
            self.assertEqual(image.size, (1080, 1920))
            self.assertEqual(slide['source_ref'], 'fixture://synthetic-test-image')
            self.assertEqual(len(slide['image_sha256']), 64)

    def test_rejects_overlong_copy(self):
        with self.assertRaisesRegex(ValueError, 'shorten the copy'):
            renderer.render_slideshow({'slides': [self.slide('Oversized headline ' * 500)]})

    def test_rejects_empty_slides_and_unsupported_crop(self):
        with self.assertRaisesRegex(ValueError, '1–20 ordered slides'):
            renderer.render_slideshow({'slides': []})
        bad_crop = self.slide()
        bad_crop['crop'] = 'stretch'
        with self.assertRaisesRegex(ValueError, 'unsupported crop'):
            renderer.render_slideshow({'slides': [bad_crop]})

    def test_rejects_copy_that_cannot_fit_minimum_type(self):
        with self.assertRaisesRegex(ValueError, 'shorten the copy'):
            renderer.render_slideshow({'slides': [self.slide('A very long title ' * 500)]})

    def test_text_only_payload_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Text-only slides are unsupported'):
            renderer.render_slideshow({'slides': ['hello']})


if __name__ == '__main__':
    unittest.main()
