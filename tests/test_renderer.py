import importlib.util
import io
import unittest
from pathlib import Path
from PIL import Image

MODULE = Path(__file__).parents[1] / 'renderer' / 'render.py'
spec = importlib.util.spec_from_file_location('marketing_renderer', MODULE)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

class RendererTests(unittest.TestCase):
    def test_renders_ordered_slides_to_valid_png_dimensions(self):
        result = renderer.render_slideshow({'title':'Start small','slides':['One small practice step','Notice what happened']})
        self.assertEqual(result['dimensions'], {'width':1080,'height':1350})
        self.assertEqual([s['index'] for s in result['slides']], [1,2])
        for slide in result['slides']:
            image=Image.open(io.BytesIO(slide['png']))
            self.assertEqual(image.format,'PNG')
            self.assertEqual(image.size,(1080,1350))

    def test_rejects_overlong_copy(self):
        with self.assertRaisesRegex(ValueError,'shorten the copy'):
            renderer.render_slideshow({'slides':[{'title':'Oversized title '*500}]})

    def test_rejects_empty_slides_and_unsupported_theme(self):
        with self.assertRaisesRegex(ValueError,'empty'):
            renderer.render_slideshow({'slides':['']})
        with self.assertRaisesRegex(ValueError,'Unsupported theme'):
            renderer.render_slideshow({'theme':'brand-approved','slides':['hello']})

    def test_rejects_copy_that_cannot_fit_minimum_type(self):
        with self.assertRaisesRegex(ValueError,'shorten the copy'):
            renderer.render_slideshow({'slides':[{'title':'A very long title '*500}]})

if __name__ == '__main__': unittest.main()
