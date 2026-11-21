"""Read-only gallery for saved Cherry render artifacts."""
import hashlib
import json
import re
from pathlib import Path

try:
    from fastapi.responses import JSONResponse
except ImportError:  # lets the file-backed handlers run in standalone unit tests
    class JSONResponse(dict):
        def __init__(self, content, status_code=200): super().__init__(content); self.status_code = status_code

RUN_RE = re.compile(r"^[a-f0-9-]{8,64}$")
PACKAGE_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
MAX_JSON = 2_000_000
MAX_PNG = 8 * 1024 * 1024

def data_dir():
    from dashboard.plugin_api import data_dir as request_data_dir
    return request_data_dir()

def _json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON:
        raise ValueError("invalid metadata")
    return json.loads(path.read_text(encoding="utf-8"))

def list_creatives(app="Cherry"):
    if app != "Cherry": return {"creatives": []}
    root = (data_dir() / "agent-runs").resolve()
    out = []
    if not root.is_dir(): return {"creatives": []}
    for runfile in sorted(root.glob("*/run.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            if runfile.parent.is_symlink() or runfile.is_symlink() or not runfile.resolve().is_relative_to(root) or runfile.stat().st_size > MAX_JSON: continue
            run = _json(runfile)
            if run.get("app") != "Cherry" or not RUN_RE.fullmatch(str(run.get("runId", ""))): continue
            for result in run.get("results", []):
                package = result.get("packageId", "")
                if not PACKAGE_RE.fullmatch(str(package)): continue
                base = (runfile.parent / package).resolve()
                if not base.is_relative_to(root) or base.is_symlink(): continue
                artifact_name = result.get("artifactPath") or package
                if Path(artifact_name).is_absolute() or ".." in Path(artifact_name).parts: continue
                artifact_source = runfile.parent / artifact_name
                artifact = artifact_source.resolve()
                if any(part.is_symlink() for part in [artifact_source, *artifact_source.parents[:2]]) or not artifact.is_relative_to(base): continue
                final = _json(artifact / "final.json")
                critique = _json(artifact / "final-critique.json")
                provenance = _json(artifact / "provenance.json")
                rendered_dir = artifact / "rendered"
                if rendered_dir.is_symlink(): continue
                pngs = sorted(rendered_dir.glob("*.png"))
                slides = []
                for i, p in enumerate(pngs):
                    if p.is_symlink() or not p.resolve().is_relative_to(artifact) or p.stat().st_size > MAX_PNG: continue
                    b = p.read_bytes()
                    if b[:8] != b"\x89PNG\r\n\x1a\n": continue
                    slides.append({"index": i, "sha256": hashlib.sha256(b).hexdigest()})
                if not slides: continue
                out.append({"id": package, "draftId": result.get("draftId", package), "runId": run["runId"], "title": final.get("title") or final.get("hook") or package, "status": result.get("status", "unapproved"), "iteration": artifact.name, "slideCount": len(slides), "slides": slides, "qualityReviews": critique.get("reviews", []), "hardBlockers": critique.get("hardBlockers", [])})
                if len(out) >= 50: return {"creatives": out}
        except (OSError, ValueError, TypeError, KeyError, AttributeError): continue
    return {"creatives": out}

def read_slide(run_id, package_id, slide_index):
    if not RUN_RE.fullmatch(run_id) or not PACKAGE_RE.fullmatch(package_id) or slide_index < 0 or slide_index > 50:
        return JSONResponse({"error":{"code":"invalid_input","message":"Creative slide not found."}}, status_code=404)
    result = next((c for c in list_creatives("Cherry")["creatives"] if c["runId"] == run_id and c["id"] == package_id), None)
    if not result: return JSONResponse({"error":{"code":"not_found","message":"Creative slide not found."}}, status_code=404)
    try:
        root = (data_dir() / "agent-runs" / run_id).resolve()
        record = _json(root / "run.json")
        item = next(x for x in record["results"] if x.get("packageId") == package_id)
        art = (root / (item.get("artifactPath") or package_id)).resolve()
        if not art.is_relative_to(root / package_id): raise ValueError()
        files = sorted((art / "rendered").glob("*.png")); path = files[slide_index]
        if path.is_symlink() or not path.resolve().is_relative_to(art) or path.stat().st_size > MAX_PNG: raise ValueError()
        data = path.read_bytes(); digest = hashlib.sha256(data).hexdigest()
        if data[:8] != b"\x89PNG\r\n\x1a\n" or digest != result["slides"][slide_index]["sha256"]: raise ValueError()
        import base64
        return {"dataUrl":"data:image/png;base64," + base64.b64encode(data).decode(),"sha256":digest,"index":slide_index,"draftId":result["draftId"]}
    except (OSError, ValueError, IndexError, StopIteration, KeyError, TypeError, AttributeError):
        return JSONResponse({"error":{"code":"not_found","message":"Creative slide not found."}}, status_code=404)

async def creatives_endpoint(app: str = "Cherry"):
    try: return list_creatives(app)
    except (OSError, ValueError): return {"creatives": []}
