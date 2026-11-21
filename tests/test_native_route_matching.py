import importlib.util
from pathlib import Path

from fastapi import APIRouter


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'native-dashboard-request.py'
spec = importlib.util.spec_from_file_location('native_dashboard_request', SCRIPT)
native_request = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native_request)


def harmless(**kwargs):
    return None


def test_production_matcher_accepts_dynamic_slide_parameter_names():
    router = APIRouter()
    router.add_api_route('/creative-previews/{run_id}/{package_id}/slides/{slide_index}', harmless, methods=['GET'])
    route = router.routes[0]
    path = '/creative-previews/' + 'a' * 32 + '/package_1/slides/0'
    from starlette.routing import Match
    assert route.matches({'type': 'http', 'method': 'GET', 'path': path, 'root_path': '', 'headers': [], 'query_string': b''})[0] is Match.FULL
    assert native_request.route_matches(route, 'GET', path)

    alternate = APIRouter()
    alternate.add_api_route('/creative-previews/{run_id}/{package_id}/slides/{any_index_name}', harmless, methods=['GET'])
    assert native_request.route_matches(alternate.routes[0], 'GET', path)


def test_production_matcher_does_not_accept_catchall_or_partial_paths():
    router = APIRouter()

    async def application_request(path: str):
        return None

    router.add_api_route('/{path:path}', application_request, methods=['GET'])
    assert not native_request.route_matches(router.routes[0], 'GET', '/unregistered')

    router.add_api_route('/agent-runs/{run_id}', harmless, methods=['GET'])
    assert not native_request.route_matches(router.routes[-1], 'GET', '/agent-runs/not-a-full-match/extra')
