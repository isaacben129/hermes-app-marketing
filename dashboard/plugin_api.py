"""Hermes-authenticated backend; no renderer-side URL or bearer credential.

The existing Node application runs per request, not as an unmanaged daemon.
A cross-process lock serializes its ledger read/compare/write transaction.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from dashboard.agent_runs import get_run, list_runs, start_run
from dashboard.creative_previews import creatives_endpoint, read_slide

router = APIRouter()
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
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired, KeyError) as exc:
        # Log only a fixed category, never exception text, stdout or stderr:
        # child diagnostics and provider configuration may contain secrets.
        if isinstance(exc, subprocess.TimeoutExpired):
            code, message = "backend_timeout", "Marketing backend timed out. Retry after checking the backend host."
        elif isinstance(exc, RuntimeError):
            code, message = "backend_failed", "Marketing application process failed. Check its runtime and private data directory."
        elif isinstance(exc, (ValueError, KeyError)):
            code, message = "backend_invalid_response", "Marketing application returned an invalid response. Check the installed package version."
        else:
            code, message = "backend_unavailable", "Marketing backend could not start or access its private data directory."
        logging.getLogger("hermes.plugins.marketing-system").warning("Marketing request failed: %s", code)
        return JSONResponse({"error": {"code": code, "message": message, "retryable": True}}, status_code=503)


@router.post("/agent-runs")
async def create_agent_run(request: Request):
    try: body = await request.json()
    except ValueError: return JSONResponse({"error": {"code": "invalid_input", "message": "Check the named fields and request schema."}}, status_code=400)
    try: directory = data_dir()
    except ValueError: return JSONResponse({"error": {"code": "invalid_input", "message": "Invalid backend data directory."}}, status_code=400)
    result, status = start_run(directory, body, ROOT)
    if status == 202: return JSONResponse(result, status_code=status)
    details = {
        400: ("invalid_input", "Check the named fields and request schema."),
        429: ("rate_limited", "A Cherry batch is already running for this profile."),
        503: ("unavailable", "Prepared Cherry context, approved local assets, or the authoring CLI is unavailable."),
    }
    code, message = details[status]
    return JSONResponse({"error": {"code": code, "message": message, "retryable": status != 400}}, status_code=status)


@router.get("/agent-runs")
async def read_agent_runs():
    try: return list_runs(data_dir())
    except ValueError: return JSONResponse({"error": {"code": "invalid_input", "message": "Invalid backend data directory."}}, status_code=400)


@router.get("/agent-runs/{run_id}")
async def read_agent_run(run_id: str):
    try: directory = data_dir()
    except ValueError: return JSONResponse({"error": {"code": "invalid_input", "message": "Invalid backend data directory."}}, status_code=400)
    record = get_run(directory, run_id)
    if record is None: return JSONResponse({"error": {"code": "invalid_input", "message": "Run not found."}}, status_code=404)
    return record


@router.get("/creative-previews")
async def read_creative_previews(app: str = "Cherry"):
    try: directory = data_dir()
    except ValueError: return JSONResponse({"error": {"code": "invalid_input", "message": "Invalid backend data directory."}}, status_code=400)
    return await creatives_endpoint(directory, app)


@router.get("/creative-previews/{run_id}/{package_id}/slides/{slide_index}")
async def read_creative_slide(run_id: str, package_id: str, slide_index: int):
    try: directory = data_dir()
    except ValueError: return JSONResponse({"error": {"code": "invalid_input", "message": "Invalid backend data directory."}}, status_code=400)
    return read_slide(directory, run_id, package_id, slide_index)


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
