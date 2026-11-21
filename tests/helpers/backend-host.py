"""Isolated HTTP host for the real unified plugin router, used by the UI test."""
import importlib.util
from pathlib import Path
import socket
import sys

from fastapi import FastAPI
import uvicorn

path = Path(__file__).resolve().parents[2] / 'dashboard' / 'plugin_api.py'
spec = importlib.util.spec_from_file_location('marketing_ui_backend', path)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
app = FastAPI()
app.include_router(module.router, prefix='/api/plugins/marketing-system')
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
print(f'http://127.0.0.1:{sock.getsockname()[1]}', flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='error')).run(sockets=[sock])
