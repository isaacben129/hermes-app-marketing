import base64
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path
from PIL import Image, ImageDraw


class RendererServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).parents[1]
        cls.tmp = tempfile.TemporaryDirectory()
        cls.image_path = Path(cls.tmp.name) / 'synthetic-server-fixture.png'
        image = Image.new('RGB', (640, 960), (31, 81, 107))
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 600, 450), fill=(198, 92, 48))
        draw.ellipse((110, 510, 530, 930), fill=(72, 158, 112))
        image.save(cls.image_path)
        cls.digest = hashlib.sha256(cls.image_path.read_bytes()).hexdigest()
        cls.proc = subprocess.Popen([sys.executable, 'server.py'], cwd=cls.root / 'renderer', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.base = 'http://127.0.0.1:8765'
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

    def test_render_and_export_endpoints_round_trip(self):
        slide = {
            'headline': 'Synthetic image-led example',
            'body': 'Geometry fixture with overlay copy.',
            'image_path': str(self.image_path),
            'image_sha256': self.digest,
            'source_ref': 'fixture://synthetic-server-image',
        }
        req = Request(self.base + '/api/render', data=json.dumps({'slides': [slide]}).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST')
        with urlopen(req) as response:
            data = json.loads(response.read())
            self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), 'file://')
        png = base64.b64decode(data['slides'][0]['pngBase64'])
        self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(data['slides'][0]['source_ref'], 'fixture://synthetic-server-image')
        self.assertEqual(data['slides'][0]['image_sha256'], self.digest)
        export = {
            'rendered': {
                'dimensions': data['dimensions'],
                'slides': [{
                    'index': data['slides'][0]['index'],
                    'pngBase64': data['slides'][0]['pngBase64'],
                    'source_ref': data['slides'][0]['source_ref'],
                    'image_sha256': data['slides'][0]['image_sha256'],
                }],
            },
            'source': {'draftId': 'fixture:synthetic-server-test'},
        }
        req = Request(self.base + '/api/export', data=json.dumps(export).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST')
        archive = base64.b64decode(json.loads(urlopen(req).read())['zipBase64'])
        self.assertTrue(archive.startswith(b'PK'))
        with zipfile.ZipFile(__import__('io').BytesIO(archive)) as z:
            manifest = json.loads(z.read('manifest.json'))
            self.assertEqual(manifest['slides'][0]['source_ref'], 'fixture://synthetic-server-image')
            self.assertEqual(manifest['slides'][0]['image_sha256'], self.digest)

    def test_plugin_render_contract_composes_image_led_slides_and_round_trips_export(self):
        """The copy-only UI payload is not silently accepted as a real render."""
        payload = {
            'title': 'Synthetic illustrative slideshow',
            'theme': 'neutral',
            'slides': [
                {
                    'headline': 'A recognizable moment',
                    'body': 'A useful next step, over an explicit synthetic image.',
                    'image_path': str(self.image_path),
                    'image_sha256': self.digest,
                    'source_ref': 'fixture://synthetic-server-image',
                },
                {
                    'headline': 'One practical change',
                    'body': 'An image-led second slide with ordered text.',
                    'image_path': str(self.image_path),
                    'image_sha256': self.digest,
                    'source_ref': 'fixture://synthetic-server-image',
                },
            ],
        }
        request = Request(
            self.base + '/api/render', data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST',
        )
        with urlopen(request) as response:
            self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), 'file://')
            rendered = json.loads(response.read())
        self.assertEqual([slide['index'] for slide in rendered['slides']], [1, 2])
        self.assertEqual(rendered['dimensions'], {'width': 1080, 'height': 1920})
        source = Image.open(self.image_path).convert('RGB').resize((1080, 1920))
        for slide in rendered['slides']:
            png = base64.b64decode(slide['pngBase64'])
            with Image.open(io.BytesIO(png)) as image:
                self.assertEqual(image.format, 'PNG')
                self.assertEqual(image.size, (1080, 1920))
                self.assertGreater(len(image.convert('RGB').getcolors(maxcolors=1000000) or []), 100)
                self.assertNotEqual(image.convert('RGB').getpixel((540, 960)), source.getpixel((540, 960)))
            self.assertEqual(slide['source_ref'], 'fixture://synthetic-server-image')
            self.assertEqual(slide['image_sha256'], self.digest)

        export = {
            'rendered': {'dimensions': rendered['dimensions'], 'slides': rendered['slides']},
            'source': {'draftId': 'fixture:synthetic-server-test'},
        }
        request = Request(
            self.base + '/api/export', data=json.dumps(export).encode(),
            headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST',
        )
        archive = base64.b64decode(json.loads(urlopen(request).read())['zipBase64'])
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            manifest = json.loads(bundle.read('manifest.json'))
            self.assertEqual(manifest['files'], ['slide-01.png', 'slide-02.png'])
            self.assertEqual(manifest['source']['draftId'], 'fixture:synthetic-server-test')
            self.assertEqual(len(manifest['slides']), 2)
            self.assertEqual(manifest['slides'][0]['source_ref'], 'fixture://synthetic-server-image')
            self.assertEqual(manifest['slides'][0]['image_sha256'], self.digest)
            self.assertEqual(bundle.read('slide-01.png')[:8], b'\x89PNG\r\n\x1a\n')

    def test_rejects_plugin_copy_only_payload_instead_of_claiming_static_copy_is_rendered(self):
        request = Request(
            self.base + '/api/render',
            data=json.dumps({'title': 'Sample', 'theme': 'neutral', 'slides': ['A recognizable moment']}).encode(),
            headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST',
        )
        with self.assertRaises(HTTPError) as caught:
            urlopen(request)
        self.assertEqual(caught.exception.code, 400)
        self.assertIn('requires an image', caught.exception.read().decode())
        caught.exception.close()

    def test_rejects_remote_origin(self):
        req = Request(self.base + '/api/render', data=b'{}', headers={'Content-Type': 'application/json', 'Origin': 'https://evil.example'}, method='POST')
        try:
            urlopen(req)
            self.fail('remote origin should be forbidden')
        except HTTPError as error:
            error.close()
            self.assertEqual(error.code, 403)


if __name__ == '__main__':
    unittest.main()
