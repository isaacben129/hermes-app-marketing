#!/usr/bin/env python3
"""Run the fixed, manual five-package Cherry author/critic sequence."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dashboard.agent_runs import _context_ready, _read, _write, _redacted_error

MODEL = 'gpt-6-luna'
DIMENSIONS = ['audience fit', 'hook clarity', 'claim specificity/proof', 'slide progression/payoff', 'mobile legibility/visual coherence', 'promise-to-destination match', 'safety/rights/brand']


def now(): return datetime.now(timezone.utc).isoformat()


def _stage(record, run_file, name):
    record.update(stage=name, updatedAt=now())
    _write(run_file, record)


def _save_json(file: Path, value):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = file.with_suffix(file.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')
    os.chmod(tmp, 0o600)
    os.replace(tmp, file)


def _asset_map(context, context_dir):
    result = {}
    for item in context['assetManifest']:
        p = Path(item['path'])
        p = p if p.is_absolute() else context_dir / p
        result[item['id']] = {**item, 'absolutePath': str(p.resolve())}
    return result


def _prompt(role_file, context, extra, output_contract):
    role = (ROOT / 'agents' / role_file).read_text(encoding='utf8')
    text = {'roleInstructions': role, 'preparedContext': context, 'task': extra, 'requiredOutput': output_contract}
    encoded = json.dumps(text, ensure_ascii=False)
    if len(encoded) > 100_000: raise ValueError('bounded input exceeded')
    return encoded


def _codex(executable, prompt, schema, output_file, cwd, images=(), deadline=None):
    schema_path = ROOT / 'agents' / schema
    # Codex output is captured in private memory only; diagnostics are never
    # logged or surfaced because process text can contain prompt material.
    image_args = [part for image in images for part in ('--image', str(image))]
    child_env = os.environ.copy()
    for key in ('OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'POSTIZ_API_KEY', 'POSTIZ_BASE_URL', 'HERMES_MARKETING_SECRETS_FILE', 'HERMES_MARKETING_DATA_DIR'):
        child_env.pop(key, None)
    remaining = max(1, deadline - time.monotonic()) if deadline is not None else 240
    proc = subprocess.run([executable, 'exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '-m', MODEL, *image_args, '--output-schema', str(schema_path), '--output-last-message', str(output_file), '--json', '-'], input=prompt, text=True, cwd=cwd, env=child_env, capture_output=True, timeout=min(240, remaining), check=False)
    if proc.returncode != 0 or not output_file.is_file(): raise RuntimeError('model_execution_failed')
    try: result = json.loads(output_file.read_text(encoding='utf8'))
    except (OSError, ValueError): raise RuntimeError('model_output_invalid')
    thread_ids = []
    for line in proc.stdout.splitlines():
        try:
            event = json.loads(line)
            if event.get('type') == 'thread.started' and event.get('thread_id'): thread_ids.append(event['thread_id'])
        except ValueError: continue
    if not thread_ids: raise RuntimeError('model_metadata_missing')
    return result, {'threadId': thread_ids[-1], 'model': MODEL, 'cli': Path(executable).name}


def _validate_package(value, assets, context):
    if not isinstance(value, dict) or not isinstance(value.get('slides'), list) or len(value['slides']) != 5: raise RuntimeError('author_output_invalid')
    if not isinstance(value.get('assetIds'), list) or not isinstance(value.get('sourceRefs'), list) or not isinstance(value.get('claimNotes'), list): raise RuntimeError('author_output_invalid')
    if any(not isinstance(slide, dict) or slide.get('assetId') not in assets for slide in value['slides']): raise RuntimeError('author_asset_invalid')
    selected = [slide['assetId'] for slide in value['slides']]
    if set(value['assetIds']) != set(selected): raise RuntimeError('author_asset_invalid')
    references = set(assets) | {item['sourceRef'] for item in assets.values()} | {item['id'] for item in context['sources']}
    if any(not isinstance(ref, str) or ref not in references for ref in value['sourceRefs']): raise RuntimeError('author_source_invalid')
    for slide in value['slides']:
        for key, limit in (('headline', 100), ('body', 240)):
            if not isinstance(slide.get(key), str) or not slide[key].strip() or len(slide[key]) > limit: raise RuntimeError('author_output_invalid')
        if slide.get('textPosition') not in ('top', 'center', 'bottom'): raise RuntimeError('author_output_invalid')
    return value


def _normalize_critique(value, final=False, rendered=None, context=None):
    if not isinstance(value, dict) or not isinstance(value.get('reviews'), list) or len(value['reviews']) != 7: raise RuntimeError('critic_output_invalid')
    output = []
    for dimension, review in zip(DIMENSIONS, value['reviews']):
        if not isinstance(review, dict) or review.get('dimension') != dimension: raise RuntimeError('critic_output_invalid')
        score = review.get('score')
        if score is not None and (type(score) is not int or not 0 <= score <= 5): raise RuntimeError('critic_output_invalid')
        if not isinstance(review.get('rationale'), str) or not review['rationale'].strip() or not isinstance(review.get('evidenceRefs'), list) or not review['evidenceRefs']: raise RuntimeError('critic_output_invalid')
        if final and any(ref not in {item['file'] for item in rendered or []} for ref in review['evidenceRefs']): raise RuntimeError('critic_output_invalid')
        output.append({**review, 'reviewer': {'type': 'automated', 'name': 'Codex independent critic'}, 'reviewedAt': now()})
    value['reviews'] = output
    if not isinstance(value.get('hardBlockers'), list) or not isinstance(value.get('lessons'), list): raise RuntimeError('critic_output_invalid')
    if final:
        value['hardBlockers'] = sorted(set(value['hardBlockers']) | {'unknownRights', 'unapprovedCta'})
    if final and any(not item['evidenceRefs'] for item in output if item['score'] is not None): raise RuntimeError('critic_output_invalid')
    return value


def _render(final, assets, package_dir):
    renderer_dir = ROOT / 'renderer'
    sys.path.insert(0, str(renderer_dir))
    from render import render_slideshow, export_slideshow_zip
    slides = []
    for slide in final['slides']:
        asset = assets[slide['assetId']]
        slides.append({'headline': slide['headline'], 'body': slide['body'], 'image_path': asset['absolutePath'], 'image_sha256': asset['sha256'], 'source_ref': asset['sourceRef'], 'crop': 'cover', 'text_position': slide['textPosition']})
    rendered = render_slideshow({'width': 1080, 'height': 1920, 'title': final.get('title', ''), 'slides': slides})
    rendered_dir = package_dir / 'rendered'
    rendered_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    for slide in rendered['slides']:
        (rendered_dir / f"slide-{slide['index']:02d}.png").write_bytes(slide['png'])
    export_slideshow_zip(rendered, package_dir / 'export.zip', source={'runId': package_dir.parents[0].name, 'package': package_dir.name})
    return [{'index': slide['index'], 'file': f"rendered/slide-{slide['index']:02d}.png", 'sha256': hashlib.sha256(slide['png']).hexdigest(), 'sourceRef': slide.get('source_ref')} for slide in rendered['slides']]


def _persist_draft(data_dir, run_id, package_index, final, critique, render_info):
    """Use the production one-request API path; retry only a 409 with fresh revision."""
    # Save requests go through the same normal Node action and WorkspaceStore
    # CAS path as UI writes. No provider call is involved.
    import urllib.error
    import urllib.request
    workspace = {'method': 'GET', 'path': '/api/workspace?app=Cherry', 'body': None}
    node = shutil.which('node')
    if not node: raise RuntimeError('node_unavailable')
    def request(value):
        result = subprocess.run([node, str(ROOT / 'scripts' / 'plugin-request.mjs')], input=json.dumps(value), text=True, cwd=ROOT, env={**os.environ, 'HERMES_MARKETING_DATA_DIR': str(data_dir)}, capture_output=True, timeout=30)
        if result.returncode: raise RuntimeError('workspace_request_failed')
        return json.loads(result.stdout)
    current = request(workspace)
    if current['status'] != 200: raise RuntimeError('workspace_read_failed')
    draft_id = f'{run_id}-{package_index:02d}'
    slides = []
    for item in final['_renderSlides']:
        raw = Path(item['absolutePath']).read_bytes()
        ext = Path(item['absolutePath']).suffix.lower()
        mime = {'jpg': 'jpeg', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp', '.png': 'png'}.get(ext, 'png')
        slides.append({'headline': item['headline'], 'body': item['body'], 'textPosition': item['textPosition'], 'selectedImage': {'dataUrl': f'data:image/{mime};base64,' + base64.b64encode(raw).decode('ascii'), 'sha256': item['sha256'], 'sourceRef': item['sourceRef'], 'mimeType': f'image/{mime}'}})
    evidence = [{'id': item['file'], 'provenance': {'origin': 'local-render-preview', 'locator': item['file'], 'capturedAt': now()}, 'rights': {'status': 'pending'}, 'sha256': item['sha256'], 'sourceRef': item['sourceRef']} for item in render_info]
    draft = {'id': draft_id, 'app': 'Cherry', 'title': final['title'], 'slides': slides, 'source': {'runId': run_id, 'packageIndex': package_index, 'brandSource': final['_brandSource'], 'sourceRefs': final.get('sourceRefs', []), 'rights': 'review-required', 'cta': final['_cta'], 'hardBlockers': critique['hardBlockers'], 'status': 'rendered-unapproved', 'previewOnly': True}, 'lineage': {'runId': run_id, 'packageId': draft_id}, 'evidence': evidence, 'qualityReviews': critique['reviews']}
    for attempt in range(2):
        payload = {'method': 'PUT', 'path': '/api/drafts/' + draft_id, 'body': {'draft': draft, 'expectedRevision': current['body']['revision']}}
        saved = request(payload)
        if saved['status'] == 200: return {'draftId': draft_id, 'revision': saved['body']['revision']}
        if saved['status'] != 409 or attempt: raise RuntimeError('workspace_save_failed')
        current = request(workspace)
        if current['status'] != 200: raise RuntimeError('workspace_read_failed')
    raise RuntimeError('workspace_save_failed')


def run(data_dir: Path, run_id: str):
    if not data_dir.is_absolute() or not re.fullmatch(r'[a-f0-9]{32}', run_id): raise ValueError('invalid runner arguments')
    context_dir = (data_dir / 'agent-context').resolve()
    if not _context_ready(data_dir): raise RuntimeError('context_unavailable')
    context = _read(context_dir / 'context.json')
    assets = _asset_map(context, context_dir)
    executable = shutil.which('codex')
    if not executable: raise RuntimeError('codex_unavailable')
    run_dir = data_dir / 'agent-runs' / run_id
    record = _read(run_dir / 'run.json')
    if not record or record.get('status') != 'running': raise RuntimeError('run_record_unavailable')
    lessons, results = [], []
    deadline = time.monotonic() + 18 * 60
    run_file = run_dir / 'run.json'
    for index, direction in enumerate(context['directions'], start=1):
        package_id = f'{run_id}-{index:02d}'
        package_dir = run_dir / package_id
        package_dir.mkdir(parents=True, mode=0o700)
        _stage(record, run_file, f'package-{index}-initial-author')
        prompt = _prompt('cherry-author.md', context, {'phase': 'initial author', 'direction': direction, 'priorPackageLessons': lessons}, 'cherry-run.schema.json')
        author_images = [item['absolutePath'] for item in assets.values()]
        initial, meta1 = _codex(executable, prompt, 'cherry-run.schema.json', package_dir / 'initial.json', context_dir, images=author_images, deadline=deadline)
        initial = _validate_package(initial, assets, context)
        _stage(record, run_file, f'package-{index}-initial-critic')
        (package_dir / 'initial-critique.json').write_text('{}', encoding='utf8')
        critique_prompt = _prompt('cherry-critic.md', context, {'phase': 'independent critique of initial draft', 'direction': direction, 'draft': initial, 'exactRubric': DIMENSIONS, 'datesAsOf': now()}, 'cherry-critique.schema.json')
        critique, meta2 = _codex(executable, critique_prompt, 'cherry-critique.schema.json', package_dir / 'initial-critique.json', context_dir, deadline=deadline)
        critique = _normalize_critique(critique)
        _save_json(package_dir / 'initial-critique.json', critique)
        _stage(record, run_file, f'package-{index}-revision')
        revision_prompt = _prompt('cherry-author.md', context, {'phase': 'revision after independent critique', 'direction': direction, 'initialDraft': initial, 'critique': critique, 'priorPackageLessons': lessons}, 'cherry-run.schema.json')
        final, meta3 = _codex(executable, revision_prompt, 'cherry-run.schema.json', package_dir / 'final.json', context_dir, images=author_images, deadline=deadline)
        final = _validate_package(final, assets, context)
        final['_brandSource'] = context['brandSource']
        final['_cta'] = context['CTA']
        final['_renderSlides'] = [{'headline': slide['headline'], 'body': slide['body'], 'textPosition': slide['textPosition'], **assets[slide['assetId']]} for slide in final['slides']]
        _stage(record, run_file, f'package-{index}-render')
        render_info = _render(final, assets, package_dir)
        _stage(record, run_file, f'package-{index}-final-critic')
        final_critique_prompt = _prompt('cherry-critic.md', context, {'phase': 'independent final critique', 'direction': direction, 'finalDraft': final, 'renderedPngs': render_info, 'exactRubric': DIMENSIONS, 'datesAsOf': now()}, 'cherry-critique.schema.json')
        final_critique, meta4 = _codex(executable, final_critique_prompt, 'cherry-critique.schema.json', package_dir / 'final-critique.json', context_dir, images=[package_dir / item['file'] for item in render_info], deadline=deadline)
        final_critique = _normalize_critique(final_critique, final=True, rendered=render_info, context=context)
        _save_json(package_dir / 'final-critique.json', final_critique)
        _save_json(package_dir / 'provenance.json', {'runId': run_id, 'packageId': package_id, 'modelExecutions': [meta1, meta2, meta3, meta4], 'assetIds': [s['assetId'] for s in final['slides']], 'rendered': render_info, 'createdAt': now()})
        _stage(record, run_file, f'package-{index}-persist-draft')
        saved = _persist_draft(data_dir, run_id, index, final, final_critique, render_info)
        results.append({'packageId': package_id, **saved, 'status': 'rendered-unapproved', 'qualityReviews': final_critique['reviews']})
        lessons.extend(critique.get('lessons', []))
        lessons.extend(final_critique.get('lessons', []))
        record.update(stage=f'package-{index}-complete', completedCount=index, results=results, updatedAt=now()); _write(run_file, record)
    record.update(status='succeeded', stage='completed', completedCount=5, results=results, updatedAt=now()); _write(run_file, record)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    directory = Path(args.data_dir)
    try: run(directory, args.run_id)
    except BaseException as exc:
        record = _read(directory / 'agent-runs' / args.run_id / 'run.json') if re.fullmatch(r'[a-f0-9]{32}', args.run_id) else None
        if record:
            code = 'model_timeout' if isinstance(exc, subprocess.TimeoutExpired) else str(exc) if str(exc) in {'context_unavailable', 'codex_unavailable', 'run_record_unavailable', 'node_unavailable', 'workspace_read_failed', 'workspace_save_failed', 'model_execution_failed', 'model_output_invalid', 'model_metadata_missing', 'author_output_invalid', 'author_asset_invalid', 'author_source_invalid', 'critic_output_invalid'} else 'batch_failed'
            record.update(status='failed', failedStage=record.get('stage'), stage='failed', errors=[_redacted_error(code)], updatedAt=now()); _write(directory / 'agent-runs' / args.run_id / 'run.json', record)
        return 1
    return 0


if __name__ == '__main__': raise SystemExit(main())
