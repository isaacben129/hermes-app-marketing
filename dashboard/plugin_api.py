"""Hermes-authenticated backend; no renderer-side URL or bearer credential.

The existing Node application runs per request, not as an unmanaged daemon.
A cross-process lock serializes its ledger read/compare/write transaction.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import subprocess

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()
ROOT = Path(__file__).resolve().parents[1]
MAX_BODY_BYTES = 64_000_000


def data_dir() -> Path:
    override = os.environ.get("HERMES_MARKETING_DATA_DIR")
    if override:
        value = Path(override).expanduser()
        if not value.is_absolute():
            raise ValueError("Marketing data directory must be absolute")
        return value
    # Resolve at request time: Hermes may switch the scoped profile home.
    from hermes_constants import get_hermes_home
    return get_hermes_home() / "plugin-data" / "marketing-system"


@contextmanager
def transaction_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            if handle.seek(0, 2) == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def invoke(payload: dict, directory: Path):
    node = shutil.which("node")
    if not node:
        return JSONResponse({"error": {"code": "runtime_unavailable", "message": "App Marketing requires Node.js on the Hermes backend host.", "retryable": False}}, status_code=503)
    from hermes_constants import get_hermes_home
    env = {**os.environ, "HERMES_HOME": str(get_hermes_home()), "HERMES_MARKETING_DATA_DIR": str(directory)}
    try:
        with transaction_lock(directory / "backend.lock"):
            result = subprocess.run([node, str(ROOT / "scripts" / "plugin-request.mjs")], input=json.dumps(payload), capture_output=True, text=True, cwd=ROOT, env=env, timeout=120)
        if result.returncode:
            raise RuntimeError("Application runtime failed")
        response = json.loads(result.stdout)
        return JSONResponse(response["body"], status_code=response["status"])
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired, KeyError):
        # Never return subprocess stderr: provider configuration may contain secrets.
        return JSONResponse({"error": {"code": "backend_unavailable", "message": "Marketing backend could not complete this request. Check its runtime and private data directory.", "retryable": True}}, status_code=503)


@router.api_route("/{path:path}", methods=["GET", "PUT", "POST", "DELETE"])
async def application_request(path: str, request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_BODY_BYTES:
            return JSONResponse({"error": {"code": "invalid_input", "message": "Request exceeds the marketing payload limit."}}, status_code=413)
    try:
        body = json.loads(raw) if raw else None
        directory = data_dir()
    except (ValueError, TypeError):
        return JSONResponse({"error": {"code": "invalid_input", "message": "Invalid request or backend data directory."}}, status_code=400)
    query = request.url.query
    payload = {"method": request.method, "path": "/api/" + path + ("?" + query if query else ""), "body": body}
    return await asyncio.to_thread(invoke, payload, directory)
