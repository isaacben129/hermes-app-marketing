"""Read-only, profile-scoped access to saved Cherry render artifacts."""
import base64
import hashlib
import json
import re
import warnings
from pathlib import Path, PurePosixPath

from fastapi.responses import JSONResponse
from PIL import Image

RUN_RE = re.compile(r"^[a-f0-9]{32}$")
PACKAGE_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")
MAX_JSON, MAX_PNG, MAX_SLIDES, MAX_TOTAL, MAX_RUNS, MAX_ITEMS = 2_000_000, 8 * 1024 * 1024, 50, 80 * 1024 * 1024, 500, 100

def _json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON:
        raise ValueError("invalid metadata")
    return json.loads(path.read_text(encoding="utf-8"))

def _safe_path(path, within):
    path, within = Path(path), Path(within)
    current = path
    while current != current.parent:
        if current.is_symlink(): raise ValueError("symlink")
        if current == within: break
        current = current.parent
    resolved, base = path.resolve(strict=True), within.resolve(strict=True)
    if not resolved.is_relative_to(base): raise ValueError("path escape")
    return resolved

def _image(path, artifact, expected):
    path = _safe_path(path, artifact)
    if not path.is_file() or path.stat().st_size > MAX_PNG: raise ValueError("invalid image size")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected: raise ValueError("image digest mismatch")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        with Image.open(path) as image:
            if image.format != "PNG" or not (1 <= image.width <= 4096 and 1 <= image.height <= 4096):
                raise ValueError("invalid PNG dimensions or format")
            image.verify()
    return data

def _creative(directory, run_id, result, verify_images=True):
    if not PACKAGE_RE.fullmatch(result.get("packageId", "")): raise ValueError("invalid package")
    package = result["packageId"]
    run_root = _safe_path(Path(directory) / "agent-runs" / run_id, Path(directory) / "agent-runs")
    package_root = _safe_path(run_root / package, run_root)
    name = result.get("artifactPath", package)
    if not isinstance(name, str): raise ValueError("invalid artifact path")
    relative = PurePosixPath(name)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts) or relative.parts[0] != package: raise ValueError("invalid artifact path")
    artifact = _safe_path(run_root.joinpath(*relative.parts), package_root)
    final, critique, provenance = (_json(artifact / filename) for filename in ("final.json", "final-critique.json", "provenance.json"))
    slides_meta = final.get("slides")
    rendered = provenance.get("rendered")
    if not isinstance(slides_meta, list) or not isinstance(rendered, list) or not 1 <= len(slides_meta) <= MAX_SLIDES or len(rendered) != len(slides_meta): raise ValueError("inconsistent slide records")
    slides, files, total = [], set(), 0
    for expected_index, entry in enumerate(rendered, 1):
        if not isinstance(entry, dict) or entry.get("index") != expected_index: raise ValueError("invalid provenance index")
        filename, digest = entry.get("file"), entry.get("sha256")
        rel = PurePosixPath(filename) if isinstance(filename, str) else PurePosixPath("/")
        if rel.is_absolute() or len(rel.parts) != 2 or rel.parts[0] != "rendered" or not re.fullmatch(r"slide-[0-9]{2,3}\.png", rel.parts[1]) or filename in files or not isinstance(digest, str) or not SHA_RE.fullmatch(digest): raise ValueError("invalid provenance entry")
        files.add(filename)
        path = _safe_path(artifact.joinpath(*rel.parts), artifact)
        if verify_images:
            data = _image(path, artifact, digest); total += len(data)
            if total > MAX_TOTAL: raise ValueError("render budget exceeded")
        elif not path.is_file() or path.stat().st_size > MAX_PNG:
            raise ValueError("invalid image")
        slides.append({"index": expected_index - 1, "sha256": digest, "file": filename})
    title = final.get("title") or final.get("hook") or package
    reviews, blockers = critique.get("reviews", []), critique.get("hardBlockers", [])
    if not isinstance(title, str) or len(title) > 500 or not isinstance(reviews, list) or len(reviews) > 100 or not isinstance(blockers, list) or len(blockers) > 100: raise ValueError("invalid critique metadata")
    if any(not isinstance(r, dict) or not isinstance(r.get("dimension", ""), str) or len(r.get("dimension", "")) > 120 or (r.get("score") is not None and (not isinstance(r.get("score"), (int, float)) or isinstance(r.get("score"), bool) or not 0 <= r["score"] <= 5)) or not isinstance(r.get("rationale", ""), str) or len(r.get("rationale", "")) > 4000 for r in reviews): raise ValueError("invalid review")
    if any(not isinstance(b, (str, dict)) or (isinstance(b, str) and len(b) > 4000) or (isinstance(b, dict) and len(json.dumps(b)) > 4000) for b in blockers): raise ValueError("invalid blocker")
    return {"id": package, "draftId": result.get("draftId", package), "runId": run_id, "title": title, "status": str(result.get("status", "unapproved"))[:100], "iteration": artifact.name, "slideCount": len(slides), "slides": slides, "qualityReviews": reviews, "hardBlockers": blockers, "_bytes": total if verify_images else 0, "_artifact": str(artifact)}

def list_creatives(directory, app="Cherry"):
    if app != "Cherry": return {"creatives": []}
    root = Path(directory) / "agent-runs"
    if root.is_symlink() or not root.is_dir(): return {"creatives": []}
    output, total_bytes = [], 0
    for run_root in sorted(root.iterdir(), key=lambda p: p.name, reverse=True)[:MAX_RUNS]:
        try:
            if not RUN_RE.fullmatch(run_root.name): continue
            _safe_path(run_root, root)
            record = _json(run_root / "run.json")
            if not isinstance(record, dict) or record.get("runId") != run_root.name or record.get("app") != "Cherry" or not isinstance(record.get("results"), list): continue
            for result in record["results"][:MAX_ITEMS]:
                if not isinstance(result, dict): continue
                try:
                    candidate = _creative(directory, run_root.name, result)
                    if total_bytes + candidate["_bytes"] > MAX_TOTAL: break
                    total_bytes += candidate["_bytes"]
                    output.append(candidate)
                except (OSError, ValueError, TypeError, KeyError, AttributeError, Image.DecompressionBombError): continue
                if len(output) >= MAX_ITEMS: break
        except (OSError, ValueError, TypeError, KeyError): continue
        if len(output) >= MAX_ITEMS: break
    for item in output: item.pop("_artifact", None); item.pop("_bytes", None)
    return {"creatives": output}

def read_slide(directory, run_id, package_id, slide_index):
    if not RUN_RE.fullmatch(run_id) or not PACKAGE_RE.fullmatch(package_id) or not 0 <= slide_index < MAX_SLIDES:
        return JSONResponse({"error": {"code": "not_found", "message": "Creative slide not found."}}, status_code=404)
    try:
        run_root = _safe_path(Path(directory) / "agent-runs" / run_id, Path(directory) / "agent-runs")
        record = _json(run_root / "run.json")
        if not isinstance(record, dict) or record.get("runId") != run_id or record.get("app") != "Cherry" or not isinstance(record.get("results"), list): raise ValueError("invalid run")
        result = next(r for r in record["results"] if isinstance(r, dict) and r.get("packageId") == package_id)
        creative = _creative(directory, run_id, result, verify_images=False)
        metadata = creative["slides"][slide_index]
        data = _image(Path(creative["_artifact"]) / metadata["file"], Path(creative["_artifact"]), metadata["sha256"])
        return {"dataUrl": "data:image/png;base64," + base64.b64encode(data).decode(), "sha256": metadata["sha256"], "index": slide_index, "draftId": creative["draftId"]}
    except (OSError, ValueError, TypeError, KeyError, IndexError, StopIteration, AttributeError, Image.DecompressionBombError):
        return JSONResponse({"error": {"code": "not_found", "message": "Creative slide not found."}}, status_code=404)

async def creatives_endpoint(directory, app="Cherry"):
    try: return list_creatives(directory, app)
    except (OSError, ValueError, TypeError): return {"creatives": []}
