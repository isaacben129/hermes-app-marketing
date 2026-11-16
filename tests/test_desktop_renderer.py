import base64
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw


class DesktopRendererBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).parents[1]
        cls.tmp = tempfile.TemporaryDirectory()
        cls.cache = Path(cls.tmp.name) / 'render-cache'
        os.environ['HERMES_MARKETING_RENDER_CACHE'] = str(cls.cache)
        cls.image_path = Path(cls.tmp.name) / 'synthetic-desktop-image.png'
        image = Image.new('RGB', (640, 960), (31, 81, 107))
        ImageDraw.Draw(image).ellipse((100, 100, 540, 860), fill=(214, 121, 75))
        image.save(cls.image_path)
        cls.proc = subprocess.Popen([sys.executable, '-c', "import server; print('CACHE', server.IMAGE_CACHE, flush=True); server.HTTPServer(('127.0.0.1', 18766), server.Handler).serve_forever()"], cwd=cls.root / 'renderer', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.base = 'http://127.0.0.1:18766'
        for _ in range(60):
            try:
                urlopen(cls.base + '/api/health', timeout=.2)
                break
            except Exception:
                time.sleep(.1)
        else:
            raise RuntimeError('renderer server failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.tmp.cleanup()
        os.environ.pop('HERMES_MARKETING_RENDER_CACHE', None)

    def test_render_accepts_scoped_selected_image_data_and_stages_verified_bytes(self):
        raw = self.image_path.read_bytes()
        payload = {'width': 320, 'height': 480, 'slides': [{
            'headline': 'Test', 'body': 'Short.',
            'image_data_url': 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii'),
            'image_sha256': hashlib.sha256(raw).hexdigest(),
            'source_ref': 'user-folder://granted-folder/synthetic-desktop-image.png',
        }]}
        request = Request(self.base + '/api/render', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST')
        with urlopen(request) as response:
            self.assertEqual(response.status, 200)
            rendered = json.loads(response.read())
        slide = rendered['slides'][0]
        png = base64.b64decode(slide['pngBase64'])
        self.assertTrue(png.startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertEqual(slide['source_ref'], 'user-folder://granted-folder/synthetic-desktop-image.png')
        self.assertEqual(slide['image_sha256'], hashlib.sha256(raw).hexdigest())
        staged = next(self.cache.iterdir())
        self.assertEqual(staged.read_bytes(), raw)

    def test_export_rejects_invalid_png_before_writing_archive(self):
        payload = {'rendered': {'dimensions': {'width': 1080, 'height': 1920}, 'slides': [
            {'index': 1, 'pngBase64': base64.b64encode(b'not a png').decode('ascii')},
        ]}}
        request = Request(self.base + '/api/export', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST')
        with self.assertRaises(HTTPError) as context:
            urlopen(request)
        self.assertEqual(context.exception.code, 400)
        self.assertIn('invalid PNG', context.exception.read().decode())
        context.exception.close()

    def test_export_accepts_full_default_slide_response_without_base64_round_trip_payload_cap(self):
        png = Image.new('RGB', (1080, 1920), (45, 65, 85))
        ImageDraw.Draw(png).text((100, 100), 'Synthetic slide render', fill='white')
        out = io.BytesIO()
        png.save(out, format='PNG', compress_level=0)
        raw_png = out.getvalue()
        self.assertGreater(len(raw_png), 1_000_000)
        payload = {'rendered': {'dimensions': {'width': 1080, 'height': 1920}, 'slides': [{
            'index': 1, 'pngBase64': base64.b64encode(raw_png).decode('ascii'),
            'source_ref': 'fixture://desktop-export', 'image_sha256': 'a' * 64,
        }]}}
        request = Request(self.base + '/api/export', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST')
        with urlopen(request) as response:
            self.assertEqual(response.status, 200)
            data = json.loads(response.read())
        archive = base64.b64decode(data['zipBase64'])
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            self.assertEqual(zipped.read('slide-01.png'), raw_png)
            manifest = json.loads(zipped.read('manifest.json'))
            self.assertEqual(manifest['slides'][0]['source_ref'], 'fixture://desktop-export')
            self.assertEqual(manifest['slides'][0]['image_sha256'], 'a' * 64)


if __name__ == '__main__':
    unittest.main()
