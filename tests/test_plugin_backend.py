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


if __name__ == '__main__':
    unittest.main()
