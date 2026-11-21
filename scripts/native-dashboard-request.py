"""One fixed, allowlisted request into the current Hermes Python dashboard router."""
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def route_matches(route, method, route_path):
    """Use Starlette's own matcher while excluding the Node forwarding route."""
    from starlette.routing import Match
    endpoint = getattr(route, 'endpoint', None)
    if endpoint is None or endpoint.__name__ == 'application_request':
        return False
    if method not in getattr(route, 'methods', set()):
        return False
    return route.matches({'type': 'http', 'method': method, 'path': route_path, 'root_path': '', 'headers': [], 'query_string': b'', 'scheme': 'http', 'server': ('testserver', 80), 'client': ('testclient', 50000)})[0] is Match.FULL


def main():
    raw = os.environ.get('HERMES_DASHBOARD_REQUEST', '')
    if len(raw) > 64_000:
        raise ValueError()
    request = json.loads(raw)
    if not isinstance(request, dict) or set(request) - {'method', 'path', 'body'}:
        raise ValueError()
    method, raw_path = request.get('method'), request.get('path')
    parsed = urlsplit(raw_path) if isinstance(raw_path, str) else None
    if not parsed or parsed.scheme or parsed.netloc or parsed.fragment or '..' in parsed.path or '\\' in parsed.path:
        raise ValueError()
    data_dir = os.environ.get('HERMES_MARKETING_DATA_DIR', '')
    if not Path(data_dir).is_absolute() or '\0' in data_dir or '..' in Path(data_dir).parts:
        raise ValueError()
    slide_path = re.fullmatch(r'/api/creative-previews/[a-f0-9]{32}/[A-Za-z0-9_-]+/slides/(?:0|[1-9][0-9]*)', parsed.path)
    allowed = (method == 'GET' and (parsed.path == '/api/creative-previews' or parsed.path == '/api/agent-runs' or re.fullmatch(r'/api/agent-runs/[a-f0-9]{32}', parsed.path) or slide_path)) or (method == 'POST' and parsed.path == '/api/agent-runs' and not parsed.query)
    if not allowed:
        raise ValueError()

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    sys.path.insert(0, str(ROOT))
    from dashboard import plugin_api

    app = FastAPI()
    app.include_router(plugin_api.router, prefix='/api')
    # The package router has a generic Node catchall. Only dispatch if a direct
    # route exists, so a missing gallery route cannot recurse into Node.
    route_path = parsed.path.removeprefix('/api')
    direct = any(route_matches(route, method, route_path) for route in plugin_api.router.routes)
    if not direct:
        print(json.dumps({'status': 404, 'body': {'detail': 'Not Found'}}))
        return
    with TestClient(app) as client:
        response = client.request(method, raw_path, json=request.get('body') if method == 'POST' else None)
    try:
        body = response.json()
    except ValueError:
        body = {'detail': 'Not Found'}
    print(json.dumps({'status': response.status_code, 'body': body}, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never emit exception text: import/runtime diagnostics can contain private paths.
        print(json.dumps({'error': 'request_failed'}), file=sys.stderr)
        raise SystemExit(1)
