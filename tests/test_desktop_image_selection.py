import base64
import hashlib
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image


class DesktopImageSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).parents[1]
        cls.tmp = tempfile.TemporaryDirectory()
        cls.cache = Path(cls.tmp.name) / 'render-cache'
        os.environ['HERMES_MARKETING_RENDER_CACHE'] = str(cls.cache)
        cls.image_path = Path(cls.tmp.name) / 'user-selected-scene.png'
        Image.new('RGB', (20, 30), (40, 80, 120)).save(cls.image_path)
        cls.raw = cls.image_path.read_bytes()
        cls.data_url = 'data:image/png;base64,' + base64.b64encode(cls.raw).decode('ascii')
        cls.proc = subprocess.Popen([sys.executable, '-c', "import server; server.HTTPServer(('127.0.0.1', 18767), server.Handler).serve_forever()"], cwd=cls.root / 'renderer', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.base = 'http://127.0.0.1:18767'
        for _ in range(60):
            try:
                urlopen(cls.base + '/api/health', timeout=.2)
                break
            except Exception:
                time.sleep(.1)
        else:
            raise RuntimeError('test renderer did not start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.tmp.cleanup()
        os.environ.pop('HERMES_MARKETING_RENDER_CACHE', None)

    def test_scoped_user_image_data_is_staged_and_used_by_real_render(self):
        plugin = (self.root / 'desktop-plugins/marketing-system/plugin.js').read_text()
        self.assertIn('selectSlideImage(', plugin)
        self.assertIn('readDataUrl(folderId, relativePath)', plugin)
        self.assertIn('image_data_url: slide.selectedImage.dataUrl', plugin)
        self.assertIn('image_sha256: slide.selectedImage.sha256', plugin)
        self.assertIn('sourceRef: `user-folder://${folderId}/${relativePath}`', plugin)
        self.assertIn("${RENDERER_BASE.replace(/\\/api$/, '')}/api/health", plugin)
        response = urlopen(Request(self.base + '/api/render', data=json.dumps({
            'width': 320, 'height': 480,
            'slides': [{
                'headline': 'Test', 'body': 'Short.',
                'image_data_url': self.data_url, 'image_sha256': hashlib.sha256(self.raw).hexdigest(),
                'source_ref': 'user-folder://granted-folder/scene.png',
            }],
        }).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST'))
        rendered = json.loads(response.read())
        self.assertTrue(rendered['slides'][0]['pngBase64'])
        self.assertEqual(rendered['slides'][0]['source_ref'], 'user-folder://granted-folder/scene.png')
        staged = next(self.cache.iterdir())
        self.assertEqual(staged.read_bytes(), self.raw)
        self.assertEqual(rendered['slides'][0]['image_sha256'], hashlib.sha256(self.raw).hexdigest())

    def test_unapproved_local_file_path_is_rejected(self):
        request = Request(self.base + '/api/render', data=json.dumps({
            'width': 320, 'height': 480,
            'slides': [{'headline': 'x', 'body': 'y', 'image_path': str(self.image_path)}],
        }).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with self.assertRaises(HTTPError) as caught:
            urlopen(request)
        self.assertEqual(caught.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
