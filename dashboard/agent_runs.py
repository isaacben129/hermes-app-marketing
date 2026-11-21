"""Durable, profile scoped supervision for the manual Cherry author/critic batch."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from contextlib import contextmanager

RUBRIC = ['audience fit', 'hook clarity', 'claim specificity/proof', 'slide progression/payoff', 'mobile legibility/visual coherence', 'promise-to-destination match', 'safety/rights/brand']


def _write(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.run-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf8') as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        try: os.unlink(temporary)
        except FileNotFoundError: pass


def _read(path: Path):
    try: return json.loads(path.read_text(encoding='utf8'))
    except (OSError, ValueError): return None


def _redacted_error(code: str):
    return {'code': code, 'message': 'Batch execution did not complete; inspect local runtime readiness.'}


def _context_ready(directory: Path):
    context_dir = (directory / 'agent-context').resolve()
    context_file = context_dir / 'context.json'
    try:
        if context_file.stat().st_size > 80_000: return False
    except OSError: return False
    context = _read(context_file)
    if not isinstance(context, dict): return False
    required = ('brandSource', 'rubric', 'sources', 'assetManifest', 'directions', 'CTA')
    if any(key not in context for key in required): return False
    if not isinstance(context['brandSource'], dict) or not isinstance(context['CTA'], dict): return False
    if context['rubric'] != RUBRIC: return False
    if not isinstance(context['sources'], list) or not context['sources'] or not isinstance(context['assetManifest'], list) or not 1 <= len(context['assetManifest']) <= 50: return False
    if any(not isinstance(source, dict) or not all(isinstance(source.get(key), str) and source[key].strip() for key in ('id', 'url', 'purpose', 'notes')) for source in context['sources']): return False
    cta = context['CTA']
    if not all(isinstance(cta.get(key), str) and cta[key].strip() for key in ('text', 'destination', 'status')): return False
    brand = context['brandSource']
    if any(not isinstance(brand.get(key), str) or not brand[key].strip() for key in ('locator', 'version', 'promise')): return False
    for key in ('tone', 'avoidClaims'):
        value = brand.get(key)
        if not ((isinstance(value, str) and value.strip()) or (isinstance(value, list) and value and all(isinstance(item, str) and item.strip() for item in value))): return False
    directions = context['directions']
    if not isinstance(directions, list) or len(directions) != 5: return False
    if any(not isinstance(item, dict) or not any(isinstance(item.get(key), str) and item[key].strip() for key in ('name', 'title', 'scenario')) or not any(isinstance(item.get(key), str) and item[key].strip() for key in ('brief', 'scenarioBrief', 'description')) for item in directions): return False
    total_asset_bytes = 0
    for asset in context['assetManifest']:
        if not isinstance(asset, dict) or not all(isinstance(asset.get(key), str) and asset[key].strip() for key in ('id', 'path', 'sourceRef', 'rightsStatus')) or asset.get('rightsStatus') != 'review-required' or not re.fullmatch(r'[a-f0-9]{64}', str(asset.get('sha256', ''))): return False
        source = Path(asset['path'])
        source = source if source.is_absolute() else context_dir / source
        try:
            resolved = source.resolve(strict=True)
            if not resolved.is_relative_to(context_dir) or not resolved.is_file(): return False
            size = resolved.stat().st_size
            if size < 1 or size > 8 * 1024 * 1024: return False
            total_asset_bytes += size
            if total_asset_bytes > 40 * 1024 * 1024 or hashlib.sha256(resolved.read_bytes()).hexdigest() != asset['sha256']: return False
        except OSError: return False
    return True


def _records(directory: Path):
    root = directory / 'agent-runs'
    if not root.is_dir(): return []
    rows = []
    for folder in root.iterdir():
        if not folder.is_dir() or not re.fullmatch(r'[a-f0-9]{32}', folder.name): continue
        record = _read(folder / 'run.json')
        if not isinstance(record, dict): continue
        if record.get('status') == 'running':
            pid = record.get('pid')
            try: os.kill(pid, 0)
            except (ProcessLookupError, TypeError, ValueError):
                record.update(status='interrupted', stage='interrupted', completedCount=min(5, max(0, int(record.get('completedCount', 0)))), errors=[_redacted_error('worker_interrupted')], updatedAt=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat())
                _write(folder / 'run.json', record)
        rows.append(record)
    return sorted(rows, key=lambda row: row.get('createdAt', ''), reverse=True)


def list_runs(directory: Path):
    return {'runs': _records(directory)}


def get_run(directory: Path, run_id: str):
    if not re.fullmatch(r'[a-f0-9]{32}', run_id): return None
    return _read(directory / 'agent-runs' / run_id / 'run.json')


@contextmanager
def _start_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            if stream.seek(0, 2) == 0: stream.write(b'0'); stream.flush()
            stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            try: yield
            finally: stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try: yield
            finally: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def start_run(directory: Path, body: dict, root: Path):
    if not isinstance(body, dict) or set(body) != {'app', 'count'} or body.get('app') != 'Cherry' or type(body.get('count')) is not int or body['count'] != 5:
        return {'error': 'invalid_input'}, 400
    if not _context_ready(directory) or not shutil.which('codex'):
        return {'error': 'unavailable'}, 503
    runs_root = directory / 'agent-runs'
    runs_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    # The host request lock is not held over the batch. This short lock only
    # reserves one run across simultaneous request processes.
    with _start_lock(runs_root / 'start.lock'):
        if any(row.get('status') == 'running' for row in _records(directory)):
            return {'error': 'rate_limited'}, 429
        run_id = uuid.uuid4().hex
        folder = runs_root / run_id
        folder.mkdir(mode=0o700)
        now = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
        record = {'runId': run_id, 'app': 'Cherry', 'count': 5, 'status': 'running', 'stage': 'queued', 'completedCount': 0, 'errors': [], 'pid': None, 'createdAt': now, 'updatedAt': now, 'results': []}
        _write(folder / 'run.json', record)
        try:
            child_env = {**os.environ, 'HERMES_MARKETING_DATA_DIR': str(directory.resolve())}
            child = subprocess.Popen([sys.executable, str(root / 'scripts' / 'run-cherry-batch.py'), '--data-dir', str(directory.resolve()), '--run-id', run_id], cwd=root, env=child_env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
            record.update(pid=child.pid, stage='starting', updatedAt=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat())
            _write(folder / 'run.json', record)
        except (OSError, ValueError):
            record.update(status='failed', stage='failed', errors=[_redacted_error('worker_start_failed')], updatedAt=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat())
            _write(folder / 'run.json', record)
            return {'error': 'unavailable'}, 503
        return {'runId': run_id, 'status': 'running'}, 202
