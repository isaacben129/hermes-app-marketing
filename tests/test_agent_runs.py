import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from dashboard.agent_runs import get_run, list_runs, start_run

ROOT = Path(__file__).resolve().parents[1]


def prepared_context(directory):
    context_dir = directory / 'agent-context'
    context_dir.mkdir(parents=True)
    asset = context_dir / 'asset.bin'
    asset.write_bytes(b'fixture-only-image-bytes')
    context = {
        'brandSource': {'locator': 'fixture', 'version': 'fixture-v1', 'promise': 'fixture promise', 'tone': 'fixture tone', 'avoidClaims': 'fixture claims'},
        'rubric': ['audience fit', 'hook clarity', 'claim specificity/proof', 'slide progression/payoff', 'mobile legibility/visual coherence', 'promise-to-destination match', 'safety/rights/brand'],
        'sources': [{'id': 'source-fixture', 'url': 'fixture://local', 'purpose': 'structural inspiration only', 'notes': 'fixture source'}],
        'assetManifest': [{'id': 'asset-fixture', 'path': 'asset.bin', 'sha256': hashlib.sha256(asset.read_bytes()).hexdigest(), 'sourceRef': 'fixture-source', 'rightsStatus': 'review-required'}],
        'directions': [{'name': f'fixture direction {i}', 'brief': 'fixture only'} for i in range(5)],
        'CTA': {'text': 'fixture CTA', 'destination': 'fixture destination', 'status': 'unapproved'},
    }
    (context_dir / 'context.json').write_text(json.dumps(context), encoding='utf8')


class AgentRunsTest(unittest.TestCase):
    def test_start_persists_server_id_launches_only_fixed_runner_and_enforces_one_active_batch(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            prepared_context(directory)
            with patch('dashboard.agent_runs.shutil.which', return_value='/fixture/bin/codex'), patch('dashboard.agent_runs.subprocess.Popen') as spawn, patch('dashboard.agent_runs.os.kill'):
                spawn.return_value.pid = 43210
                response, status = start_run(directory, {'app': 'Cherry', 'count': 5}, ROOT)
                self.assertEqual(status, 202)
                self.assertEqual(response['status'], 'running')
                self.assertRegex(response['runId'], r'^[a-f0-9]{32}$')
                record = get_run(directory, response['runId'])
                self.assertEqual(record['pid'], 43210)
                self.assertEqual(record['completedCount'], 0)
                self.assertEqual(record['stage'], 'starting')
                command = spawn.call_args.args[0]
                self.assertEqual(command, [__import__('sys').executable, str(ROOT / 'scripts' / 'run-cherry-batch.py'), '--data-dir', str(directory.resolve()), '--run-id', response['runId']])
                second, second_status = start_run(directory, {'app': 'Cherry', 'count': 5}, ROOT)
                self.assertEqual(second_status, 429)
                self.assertEqual(list_runs(directory)['runs'][0]['runId'], response['runId'])

    def test_context_asset_hash_mismatch_fails_closed_before_cli_spawn(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            prepared_context(directory)
            context_path = directory / 'agent-context' / 'context.json'
            context = json.loads(context_path.read_text())
            context['assetManifest'][0]['sha256'] = '0' * 64
            context_path.write_text(json.dumps(context))
            with patch('dashboard.agent_runs.shutil.which', return_value='/fixture/bin/codex'), patch('dashboard.agent_runs.subprocess.Popen') as spawn:
                response, status = start_run(directory, {'app': 'Cherry', 'count': 5}, ROOT)
                self.assertEqual((response, status), ({'error': 'unavailable'}, 503))
                spawn.assert_not_called()


if __name__ == '__main__': unittest.main()
