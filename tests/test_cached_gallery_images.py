"""Real cached 1.1 router -> updated Node/Python -> large saved PNG regression."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import random
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

class CachedGalleryImageTests(unittest.TestCase):
    def test_cached_original_router_returns_complete_large_saved_png_before_secret_loading(self):
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary)
            run_id = 'c' * 32; package_id = run_id + '-01'
            folder = data / 'agent-runs' / run_id / package_id
            (folder / 'rendered').mkdir(parents=True)
            raw_pixels = random.Random(5).randbytes(256 * 256 * 3)
            buffer = io.BytesIO(); Image.frombytes('RGB', (256, 256), raw_pixels).save(buffer, 'PNG'); png = buffer.getvalue()
            self.assertGreater(len(png), 65536)
            digest = hashlib.sha256(png).hexdigest()
            (folder / 'rendered/slide-01.png').write_bytes(png)
            (folder.parent / 'run.json').write_text(json.dumps({'runId': run_id, 'app': 'Cherry', 'status': 'succeeded', 'results': [{'packageId': package_id, 'draftId': package_id, 'status': 'rendered-unapproved'}]}))
            (folder / 'final.json').write_text(json.dumps({'title': 'Explicit large image fixture', 'slides': [{'headline': 'Fixture', 'body': 'Test only'}]}))
            (folder / 'final-critique.json').write_text(json.dumps({'reviews': [], 'hardBlockers': ['fixture only']}))
            (folder / 'provenance.json').write_text(json.dumps({'rendered': [{'index': 1, 'file': 'rendered/slide-01.png', 'sha256': digest}]}))
            module = types.ModuleType('cached_marketing_image_fixture')
            module.__file__ = str(ROOT / 'dashboard/plugin_api.py')
            sys.modules[module.__name__] = module
            self.addCleanup(sys.modules.pop, module.__name__, None)
            source = (ROOT / 'tests/helpers/legacy-marketing-api.py').read_text()
            exec(compile(source, module.__file__, 'exec'), module.__dict__)
            app = FastAPI(); app.include_router(module.router, prefix='/api/plugins/marketing-system')
            with patch.dict(os.environ, {'HERMES_HOME': temporary, 'HERMES_MARKETING_DATA_DIR': temporary, 'HERMES_TEST_PYTHON': sys.executable, 'HERMES_MARKETING_SECRETS_FILE': str(data / 'missing-provider-file-must-not-be-read')}):
                response = TestClient(app).get(f'/api/plugins/marketing-system/creative-previews/{run_id}/{package_id}/slides/0')
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            actual = base64.b64decode(result['dataUrl'].split(',', 1)[1])
            self.assertEqual(actual, png)
            self.assertEqual(result['sha256'], digest)
