"""Real unified-plugin router -> Node actions -> durable ledger regression."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


class PluginBackendTest(unittest.TestCase):
    def load_client(self):
        api_path = ROOT / 'dashboard' / 'plugin_api.py'
        self.assertTrue(api_path.exists(), 'marketing package has no Hermes backend router')
        spec = importlib.util.spec_from_file_location('marketing_backend_test', api_path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        app = FastAPI()
        app.include_router(module.router, prefix='/api/plugins/marketing-system')
        return TestClient(app)

    def test_save_reopen_and_conflict_without_service_url_or_bearer(self):
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home}):
            client = self.load_client()
            root = '/api/plugins/marketing-system'
            before = client.get(root + '/workspace?app=Cherry')
            self.assertEqual(before.status_code, 200, before.text)
            revision = before.json()['revision']
            draft = {'id': 'native-test-draft', 'app': 'Cherry', 'title': 'Native backend proof', 'slides': [], 'source': {'claim': 'unreviewed', 'rights': 'unknown'}}
            saved = client.put(root + '/drafts/native-test-draft', json={'draft': draft, 'expectedRevision': revision})
            self.assertEqual(saved.status_code, 200, saved.text)
            # A new Python router and Node process must see the same durable record.
            reopened = self.load_client().get(root + '/workspace?app=Cherry')
            self.assertEqual(reopened.status_code, 200, reopened.text)
            self.assertEqual(reopened.json()['drafts'][0]['title'], draft['title'])
            conflict = client.put(root + '/drafts/native-test-draft', json={'draft': {**draft, 'title': 'STALE'}, 'expectedRevision': revision})
            self.assertEqual(conflict.status_code, 409, conflict.text)
            self.assertEqual(client.get(root + '/workspace?app=Cherry').json()['drafts'][0]['title'], draft['title'])
            self.assertEqual(client.get(root + '/workspace?app=cherry').json()['drafts'], [])
            invalid = client.put(root + '/drafts/native-test-draft', json={'draft': draft, 'expectedRevision': reopened.json()['revision'], 'apiKey': 'must-reject'})
            self.assertEqual(invalid.status_code, 400, invalid.text)
            self.assertEqual(client.post(root + '/publish', json={}).status_code, 404)
            self.assertTrue(list(Path(home).rglob('*.jsonl')), 'no durable ledger written under Hermes home')


    def test_unified_backend_renders_and_exports_saved_image_without_renderer_daemon(self):
        import base64, hashlib, io, json, zipfile
        from PIL import Image
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home, 'NODE_OPTIONS': '--import=' + (ROOT / 'tests/helpers/deny-renderer-network.mjs').as_uri()}):
            client = self.load_client()
            root = '/api/plugins/marketing-system'
            buffer = io.BytesIO(); Image.new('RGB', (40, 60), '#9fbbc5').save(buffer, 'PNG')
            raw = buffer.getvalue(); digest = hashlib.sha256(raw).hexdigest()
            draft = {'id': 'local-render-proof', 'app': 'Cherry', 'title': 'Unapproved render check', 'slides': [{'headline': 'One small step', 'body': 'Local test image, not campaign approval.', 'selectedImage': {'dataUrl': 'data:image/png;base64,' + base64.b64encode(raw).decode(), 'sha256': digest, 'sourceRef': 'synthetic:local-render-test'}}]}
            before = client.get(root + '/workspace?app=Cherry').json()
            saved = client.put(root + '/drafts/local-render-proof', json={'draft': draft, 'expectedRevision': before['revision']})
            self.assertEqual(saved.status_code, 200, saved.text)
            rendered = client.post(root + '/render', json={'jobId': 'local-render-job', 'draftId': draft['id'], 'revision': saved.json()['revision']})
            self.assertEqual(rendered.status_code, 202, rendered.text)
            image = Image.open(io.BytesIO(base64.b64decode(rendered.json()['rendered']['slides'][0]['pngBase64'])))
            self.assertEqual(image.size, (1080, 1920))
            exported = client.post(root + '/export', json={'draftId': draft['id'], 'revision': saved.json()['revision'], 'renderJobId': 'local-render-job'})
            self.assertEqual(exported.status_code, 200, exported.text)
            with zipfile.ZipFile(io.BytesIO(base64.b64decode(exported.json()['zipBase64']))) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                self.assertEqual(manifest['files'], ['slide-01.png'])
                self.assertEqual(manifest['slides'][0]['image_sha256'], digest)

    def test_runtime_failure_is_diagnosable_without_leaking_child_output(self):
        import subprocess
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home}):
            client = self.load_client()
            cases = [
                (subprocess.CompletedProcess(['node'], 1, 'PRIVATE-STDOUT', 'PRIVATE-STDERR'), None, 'backend_failed'),
                (None, subprocess.TimeoutExpired('node', 120, output='PRIVATE-STDOUT', stderr='PRIVATE-STDERR'), 'backend_timeout'),
                (subprocess.CompletedProcess(['node'], 0, 'PRIVATE-STDOUT', 'PRIVATE-STDERR'), None, 'backend_invalid_response'),
                (None, OSError('PRIVATE-STDERR'), 'backend_unavailable'),
            ]
            for result, error, code in cases:
                with self.subTest(code=code):
                    with patch('subprocess.run', return_value=result, side_effect=error), self.assertLogs('hermes.plugins.marketing-system', level='WARNING') as logs:
                        response = client.get('/api/plugins/marketing-system/workspace?app=Cherry')
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()['error']['code'], code)
                    combined = response.text + '\n'.join(logs.output)
                    self.assertNotIn('PRIVATE-STDOUT', combined)
                    self.assertNotIn('PRIVATE-STDERR', combined)
                    self.assertIn(code, combined)

    def test_parallel_writes_only_one_expected_revision_wins(self):
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home}):
            client = self.load_client()
            root = '/api/plugins/marketing-system'
            revision = client.get(root + '/workspace?app=Cherry').json()['revision']
            def save(index):
                draft = {'id': f'parallel-{index}', 'app': 'Cherry', 'title': f'Parallel {index}', 'slides': []}
                return client.put(root + f'/drafts/parallel-{index}', json={'draft': draft, 'expectedRevision': revision}).status_code
            with ThreadPoolExecutor(max_workers=2) as pool:
                statuses = sorted(pool.map(save, range(2)))
            self.assertEqual(statuses, [200, 409])
            self.assertEqual(len(client.get(root + '/workspace?app=Cherry').json()['drafts']), 1)

    def test_context_scoped_profile_resolves_private_store(self):
        from hermes_constants import set_hermes_home_override, reset_hermes_home_override
        with tempfile.TemporaryDirectory() as home:
            token = set_hermes_home_override(home)
            try:
                client = self.load_client()
                result = client.get('/api/plugins/marketing-system/workspace?app=Cherry')
                self.assertEqual(result.status_code, 200, result.text)
                self.assertTrue((Path(home) / 'plugin-data' / 'marketing-system' / 'backend.lock').exists())
            finally:
                reset_hermes_home_override(token)

    def test_agent_run_routes_validate_cherry_count_and_fail_closed_without_prepared_context(self):
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home}):
            client = self.load_client()
            root = '/api/plugins/marketing-system/agent-runs'
            self.assertEqual(client.post(root, json={'app': 'Other', 'count': 5}).status_code, 400)
            self.assertEqual(client.post(root, json={'app': 'Cherry', 'count': 4}).status_code, 400)
            self.assertEqual(client.post(root, json={'app': 'Cherry', 'count': 5, 'command': 'echo unsafe'}).status_code, 400)
            denied = client.post(root, json={'app': 'Cherry', 'count': 5})
            self.assertEqual(denied.status_code, 503, denied.text)
            self.assertEqual(denied.json()['error']['code'], 'unavailable')
            self.assertEqual(client.get(root).status_code, 200)
            self.assertEqual(client.get(root + '/arbitrary').status_code, 404)

    def test_agent_run_store_listing_has_expected_shape(self):
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home}):
            result = self.load_client().get('/api/plugins/marketing-system/agent-runs')
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json(), {'runs': []})

    def test_agent_run_detail_route_returns_durable_state_for_server_id(self):
        import json
        run_id = 'a' * 32
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home}):
            folder = Path(home) / 'plugin-data' / 'marketing-system' / 'agent-runs' / run_id
            folder.mkdir(parents=True)
            (folder / 'run.json').write_text(json.dumps({'runId': run_id, 'app': 'Cherry', 'count': 5, 'status': 'running', 'stage': 'package-1-initial-author', 'completedCount': 0, 'errors': [], 'results': []}))
            client = self.load_client()
            detail = client.get('/api/plugins/marketing-system/agent-runs/' + run_id)
            self.assertEqual(detail.status_code, 200, detail.text)
            self.assertEqual(detail.json()['stage'], 'package-1-initial-author')
            self.assertEqual(detail.json()['completedCount'], 0)


if __name__ == '__main__':
    unittest.main()
