import importlib.util
import unittest
from PIL import Image
from pathlib import Path

MODULE = Path(__file__).parents[1] / 'renderer' / 'render.py'
spec = importlib.util.spec_from_file_location('marketing_renderer', MODULE)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

class RendererTests(unittest.TestCase):
    def test_produces_one_valid_png_per_ordered_slide(self):
        result = renderer.render_slideshow({'title':'First','slides':['First slide','Second slide']})
        self.assertEqual(len(result['slides']), 2)
        self.assertEqual(result['dimensions'], {'width':1080,'height':1350})
        self.assertTrue(all(slide['png'].startswith(b'\x89PNG\r\n\x1a\n') for slide in result['slides']))
        self.assertTrue(all(Image.open(__import__('io').BytesIO(slide['png'])).size == (1080,1350) for slide in result['slides']))

if __name__ == '__main__': unittest.main()
