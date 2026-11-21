import base64
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
from PIL import Image
from render import render_slideshow, export_slideshow_zip

MAX = 64_000_000
IMAGE_MAX = 12 * 1024 * 1024

def main():
    raw = sys.stdin.buffer.read(MAX + 1)
    if len(raw) > MAX: raise ValueError('request too large')
    req = json.loads(raw)
    op = req.get('operation')
    if op == 'health':
        from render import _font
        _font(20)
        return {'service':'local-renderer','protocol':2,'features':['image_data_url','zip-export']}
    if op == 'render':
        payload = req.get('payload')
        if not isinstance(payload, dict) or not isinstance(payload.get('slides'), list): raise ValueError('invalid render input')
        normalized = dict(payload); normalized['slides'] = []
        cache = Path(req['dataDir']).resolve() / 'local-render-cache'; cache.mkdir(parents=True, exist_ok=True)
        for slide in payload['slides']:
            if not isinstance(slide, dict) or 'image_path' in slide: raise ValueError('image_path is unsupported')
            encoded = slide.get('image_data_url')
            if not isinstance(encoded, str) or not encoded.startswith('data:image/') or ';base64,' not in encoded: raise ValueError('valid inline image required')
            mime, b64 = encoded[11:].split(';base64,', 1)
            if mime not in ('png','jpeg','webp') or len(b64) > ((IMAGE_MAX+2)//3)*4: raise ValueError('invalid or oversized image')
            data = base64.b64decode(b64, validate=True)
            if not data or len(data) > IMAGE_MAX: raise ValueError('invalid or oversized image')
            with Image.open(io.BytesIO(data)) as im: im.load()
            digest = hashlib.sha256(data).hexdigest()
            if slide.get('image_sha256') not in (None, digest): raise ValueError('image hash mismatch')
            ext = {'png':'png','jpeg':'jpg','webp':'webp'}[mime]
            target = cache / f'{digest}.{ext}'
            if not target.exists(): target.write_bytes(data)
            clean = {k:v for k,v in slide.items() if k != 'image_data_url'}
            clean.update(image_path=str(target), image_sha256=digest)
            normalized['slides'].append(clean)
        result = render_slideshow(normalized)
        return {'dimensions':result['dimensions'],'slides':[{'index':s['index'],'width':s['width'],'height':s['height'],'pngBase64':base64.b64encode(s['png']).decode(),'source_ref':s.get('source_ref'),'image_sha256':s.get('image_sha256')} for s in result['slides']]}
    if op == 'export':
        payload = req.get('payload') or {}; rendered = payload.get('rendered') or {}
        slides = rendered.get('slides')
        if not isinstance(slides, list) or not 1 <= len(slides) <= 20: raise ValueError('invalid slides')
        normalized=[]
        for s in slides:
            png=base64.b64decode(s.get('pngBase64',''), validate=True)
            with Image.open(io.BytesIO(png)) as im: im.load()
            if im.format != 'PNG': raise ValueError('invalid PNG')
            normalized.append({'index':s['index'],'png':png,'source_ref':s.get('source_ref'),'image_sha256':s.get('image_sha256')})
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
            files=[]; provenance=[]
            for s in normalized:
                name=f"slide-{int(s['index']):02d}.png"; z.writestr(name,s['png']); files.append(name)
                provenance.append({'index':int(s['index']),'file':name,'source_ref':s['source_ref'],'image_sha256':s['image_sha256']})
            z.writestr('manifest.json',json.dumps({'format':'app-agnostic-image-text-slideshow','version':1,'dimensions':rendered.get('dimensions'),'source':payload.get('source') or {},'files':files,'slides':provenance},sort_keys=True))
        return {'zipBase64':base64.b64encode(out.getvalue()).decode()}
    raise ValueError('unknown operation')

try:
    result=main(); out=json.dumps(result,separators=(',',':')).encode()
    if len(out)>MAX: raise ValueError('response too large')
    sys.stdout.buffer.write(out)
except Exception as e:
    sys.stderr.write(type(e).__name__)
    sys.exit(2)
