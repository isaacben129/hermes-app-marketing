import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('run_cherry_batch_test', ROOT / 'scripts' / 'run-cherry-batch.py')
batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch)


class CherryBatchRunnerTest(unittest.TestCase):
    def test_codex_execution_uses_fixed_model_readonly_ephemeral_cli_and_records_real_session_id(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'message.json'
            fixture_response = {'fixtureMarker': True}
            def mocked_process(args, **kwargs):
                output.write_text(json.dumps(fixture_response), encoding='utf8')
                return type('FixtureCompleted', (), {'returncode': 0, 'stdout': '{"type":"thread.started","thread_id":"fixture-session-123"}\n', 'stderr': ''})()
            with patch.object(batch.subprocess, 'run', side_effect=mocked_process) as call:
                result, metadata = batch._codex('/fixture/codex', 'fixture-only prompt', 'cherry-run.schema.json', output, directory)
            self.assertEqual(result, fixture_response)
            self.assertEqual(metadata['threadId'], 'fixture-session-123')
            self.assertEqual(metadata['model'], 'gpt-6-luna')
            args = call.call_args.args[0]
            self.assertIn('--ignore-user-config', args)
            self.assertIn('--ephemeral', args)
            self.assertEqual(args[args.index('--sandbox') + 1], 'read-only')
            self.assertEqual(args[args.index('-m') + 1], 'gpt-6-luna')
            self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', args)
            self.assertNotIn('OPENAI_API_KEY', call.call_args.kwargs['env'])
            self.assertNotIn('POSTIZ_API_KEY', call.call_args.kwargs['env'])

    def test_nonzero_cli_result_is_not_success_shaped(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'message.json'
            with patch.object(batch.subprocess, 'run', return_value=type('FixtureCompleted', (), {'returncode': 1, 'stdout': 'fixture', 'stderr': 'fixture'})()):
                with self.assertRaisesRegex(RuntimeError, 'model_execution_failed'):
                    batch._codex('/fixture/codex', 'fixture-only prompt', 'cherry-run.schema.json', output, directory)


if __name__ == '__main__': unittest.main()
