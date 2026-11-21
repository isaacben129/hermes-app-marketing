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
    def test_five_package_completion_matches_ui_succeeded_contract(self):
        from tests.test_agent_runs import prepared_context
        import copy
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp); prepared_context(directory)
            run_id = 'b' * 32
            folder = directory / 'agent-runs' / run_id; folder.mkdir(parents=True)
            (folder / 'run.json').write_text(json.dumps({'runId': run_id, 'status': 'running', 'completedCount': 0}))
            calls = []
            def model_fixture(executable, prompt, schema, output_file, cwd, **kwargs):
                calls.append(schema)
                if schema == 'cherry-run.schema.json':
                    value = {'title': 'Explicit test fixture', 'slides': [{'headline': 'Fixture', 'body': 'Fixture only', 'textPosition': 'top', 'assetId': 'asset-fixture'} for _ in range(5)], 'assetIds': ['asset-fixture'], 'sourceRefs': ['source-fixture'], 'claimNotes': []}
                else:
                    value = {'reviews': [{'dimension': d, 'score': 3, 'rationale': 'Fixture judgment, not live critique', 'evidenceRefs': ['rendered/slide-01.png']} for d in batch.DIMENSIONS], 'hardBlockers': [], 'lessons': ['fixture lesson']}
                return copy.deepcopy(value), {'threadId': f'fixture-{len(calls)}', 'model': batch.MODEL}
            with patch.object(batch.shutil, 'which', return_value='/fixture/codex'), patch.object(batch, '_codex', side_effect=model_fixture), patch.object(batch, '_render', return_value=[{'file': 'rendered/slide-01.png', 'sha256': '0'*64}]), patch.object(batch, '_persist_draft', side_effect=lambda data_dir, rid, i, *rest: {'draftId': f'{rid}-{i:02d}', 'revision': i}):
                batch.run(directory, run_id)
            record = json.loads((folder / 'run.json').read_text())
            self.assertEqual(record['status'], 'succeeded')
            self.assertEqual(record['completedCount'], 5)
            self.assertEqual(len(record['results']), 5)
            self.assertEqual(len(calls), 20)

    def test_unjudged_dimension_may_have_no_render_evidence_but_scored_dimensions_require_it(self):
        reviews = [{'dimension': d, 'score': 3, 'rationale': 'Fixture', 'evidenceRefs': ['rendered/slide-01.png']} for d in batch.DIMENSIONS]
        reviews[4].update(score=None, rationale='Exact rendered PNGs were not supplied.', evidenceRefs=[])
        value = batch._normalize_critique({'reviews': reviews, 'hardBlockers': [], 'lessons': []})
        self.assertIsNone(value['reviews'][4]['score'])
        self.assertEqual(value['reviews'][4]['evidenceRefs'], [])
        reviews[4]['score'] = 3
        with self.assertRaisesRegex(RuntimeError, 'critic_output_invalid'):
            batch._normalize_critique({'reviews': reviews, 'hardBlockers': [], 'lessons': []})

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
