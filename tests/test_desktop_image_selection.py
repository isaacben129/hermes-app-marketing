import base64
import hashlib
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
        cls.base = 'http://127.0.0.1:18767'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name) / 'render-cache'
        os.environ['HERMES_MARKETING_RENDER_CACHE'] = str(self.cache)
        self.image_path = Path(self.tmp.name) / 'user-selected-scene.png'
        Image.new('RGB', (20, 30), (40, 80, 120)).save(self.image_path)
        self.raw = self.image_path.read_bytes()
        self.data_url = 'data:image/png;base64,' + base64.b64encode(self.raw).decode('ascii')
        self.proc = subprocess.Popen([sys.executable, '-c', "import server; server.HTTPServer(('127.0.0.1', 18767), server.Handler).serve_forever()"], cwd=self.root / 'renderer', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                urlopen(self.base + '/api/health', timeout=.2)
                break
            except Exception:
                time.sleep(.1)
        else:
            raise RuntimeError('test renderer did not start')

    def tearDown(self):
        self.proc.terminate()
        self.proc.wait(timeout=5)
        self.tmp.cleanup()
        os.environ.pop('HERMES_MARKETING_RENDER_CACHE', None)

    def test_scoped_user_image_data_is_staged_and_used_by_real_render(self):
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

    def test_render_rejects_each_image_outside_cache_and_never_reads_arbitrary_local_paths(self):
        request = Request(self.base + '/api/render', data=json.dumps({
            'width': 320, 'height': 480,
            'slides': [
                {'headline': 'x', 'body': 'y', 'image_path': str(self.image_path)},
                {'headline': 'x', 'body': 'y', 'image_path': str(Path(self.tmp.name) / 'outside-2.png')},
            ],
        }).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST')
        with self.assertRaises(HTTPError) as caught:
            urlopen(request)
        self.assertEqual(caught.exception.code, 400)
        caught.exception.close()
        self.assertFalse(self.cache.exists() and any(self.cache.iterdir()))

    def test_health_advertises_renderer_protocol_identity(self):
        with urlopen(self.base + '/api/health') as response:
            health = json.loads(response.read())
        self.assertEqual(health, {
            'service': 'marketing-renderer', 'protocol': 2,
            'features': ['image_data_url', 'zip-export'], 'maxRequestBytes': 64000000,
        })

    def test_malformed_and_wrong_hash_image_data_are_rejected(self):
        for image, digest in [('data:image/png;base64,@@@', None), (self.data_url, '0' * 64)]:
            payload = {'slides': [{'headline': 'Test', 'body': 'Short.', 'image_data_url': image, 'image_sha256': digest}]}
            request = Request(self.base + '/api/render', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST')
            with self.subTest(image=image[:25]), self.assertRaises(HTTPError) as caught:
                urlopen(request)
            self.assertEqual(caught.exception.code, 400)
            caught.exception.close()

    def test_advertised_oversize_request_and_untrusted_loopback_origin_are_rejected(self):
        oversized = Request(self.base + '/api/render', data=b'{}', headers={'Content-Type': 'application/json', 'Content-Length': '64000001', 'Origin': 'file://'}, method='POST')
        with self.assertRaises(HTTPError) as caught:
            urlopen(oversized)
        self.assertEqual(caught.exception.code, 400)
        self.assertIn('between 1 byte and 64 MB', caught.exception.read().decode())
        caught.exception.close()
        remote = Request(self.base + '/api/render', data=b'{}', headers={'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1.evil:9999'}, method='POST')
        with self.assertRaises(HTTPError) as caught:
            urlopen(remote)
        self.assertEqual(caught.exception.code, 403)
        caught.exception.close()
        for headers in ({'Content-Type': 'application/json', 'Origin': 'null'}, {'Content-Type': 'application/json'}):
            untrusted = Request(self.base + '/api/render', data=b'{}', headers=headers, method='POST')
            with self.subTest(origin=headers.get('Origin')), self.assertRaises(HTTPError) as caught:
                urlopen(untrusted)
            self.assertEqual(caught.exception.code, 403)
            caught.exception.close()

    def test_render_rejects_more_than_twenty_slides_before_staging(self):
        slide = {'headline': 'Test', 'body': 'Short.', 'image_data_url': self.data_url, 'image_sha256': hashlib.sha256(self.raw).hexdigest()}
        request = Request(self.base + '/api/render', data=json.dumps({'slides': [slide] * 21}).encode(), headers={'Content-Type': 'application/json', 'Origin': 'file://'}, method='POST')
        with self.assertRaises(HTTPError) as caught:
            urlopen(request)
        self.assertEqual(caught.exception.code, 400)
        caught.exception.close()
        self.assertFalse(self.cache.exists() and any(self.cache.iterdir()))


if __name__ == '__main__':
    unittest.main()
