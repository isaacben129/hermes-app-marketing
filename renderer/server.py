import base64
import hashlib
import io
import json
import os
import re
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from render import render_slideshow

MAX_REQUEST_BYTES = 64_000_000
MAX_RESPONSE_BYTES = 64_000_000
IMAGE_CACHE = Path(os.environ.get('HERMES_MARKETING_RENDER_CACHE', Path(__file__).resolve().parent.parent / 'data' / 'render-cache')).resolve()

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path != '/api/health': self.send_error(404); return
        body=json.dumps({'service':'marketing-renderer','protocol':2,'features':['image_data_url','zip-export'],'maxRequestBytes':MAX_REQUEST_BYTES}).encode()
        self.send_response(200); self._cors(); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        if self.path not in ('/api/render','/api/export'): self.send_error(404); return
        origin=self.headers.get('Origin')
        if origin != 'file://':
            self.send_error(403); return
        try:
            if self.headers.get('Transfer-Encoding'):
                self.send_error(411); return
            size=int(self.headers.get('Content-Length','0'))
            if size <= 0 or size > MAX_REQUEST_BYTES: raise ValueError('Request must be between 1 byte and 64 MB.')
            payload=json.loads(self.rfile.read(size))
            if self.path == '/api/render':
                if not isinstance(payload.get('slides'), list) or not 1 <= len(payload['slides']) <= 20:
                    raise ValueError('Render must contain 1–20 slides.')
                normalized = dict(payload)
                normalized['slides'] = []
                for number, original in enumerate(payload.get('slides') or [], 1):
                    if not isinstance(original, dict) or not (original.get('image_data_url') or original.get('image_path')):
                        raise ValueError(f'Slide {number} requires an image.')
                    slide = dict(original)
                    if 'image_data_url' in slide:
                        encoded = slide.pop('image_data_url')
                        if not isinstance(encoded, str) or len(encoded) > 17 * 1024 * 1024:
                            raise ValueError(f'Slide {number} selected image exceeds the 12 MB limit.')
                        match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', encoded)
                        if not match:
                            raise ValueError(f'Slide {number} selected image must be PNG, JPEG, or WebP data.')
                        raw = base64.b64decode(match.group(2), validate=True)
                        if len(raw) > 12 * 1024 * 1024:
                            raise ValueError(f'Slide {number} selected image exceeds the 12 MB limit.')
                        digest = hashlib.sha256(raw).hexdigest()
                        expected = slide.get('image_sha256')
                        if expected and expected != digest:
                            raise ValueError(f'Slide {number} image SHA-256 does not match selected data.')
                        IMAGE_CACHE.mkdir(parents=True, exist_ok=True)
                        ext = {'png': 'png', 'jpeg': 'jpg', 'webp': 'webp'}[match.group(1)]
                        destination = (IMAGE_CACHE / f'{digest}.{ext}').resolve()
                        if destination.parent != IMAGE_CACHE:
                            raise ValueError('Invalid selected image cache path.')
                        if not destination.exists():
                            destination.write_bytes(raw)
                        slide['image_path'] = str(destination)
                        slide['image_sha256'] = digest
                    else:
                        image_path = Path(str(slide.get('image_path', ''))).resolve()
                        if not image_path.is_relative_to(IMAGE_CACHE):
                            raise ValueError(f'Slide {number} image_path must be inside the local renderer image cache.')
                        if not image_path.is_file():
                            raise ValueError(f'Slide {number} image was not staged in the local renderer cache.')
                        slide['image_path'] = str(image_path)
                    normalized['slides'].append(slide)
                rendered=render_slideshow(normalized)
                result={'dimensions':rendered['dimensions'],'slides':[{'index':s['index'],'width':s['width'],'height':s['height'],'pngBase64':base64.b64encode(s['png']).decode('ascii'),'source_ref':s.get('source_ref'),'image_sha256':s.get('image_sha256')} for s in rendered['slides']]}
                body=json.dumps(result).encode()
            else:
                rendered=payload.get('rendered') or {}; slides=rendered.get('slides') or []
                if not 1 <= len(slides) <= 20: raise ValueError('Export must contain 1–20 slides.')
                output=io.BytesIO(); manifest={'format':'app-agnostic-image-text-slideshow','version':1,'dimensions':rendered.get('dimensions'),'source':payload.get('source') or {},'files':[],'slides':[]}
                with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                    for slide in slides:
                        name=f"slide-{int(slide['index']):02d}.png"; png=base64.b64decode(slide.get('pngBase64',''),validate=True)
                        if not png.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Export contains an invalid PNG.')
                        archive.writestr(name,png); manifest['files'].append(name); manifest['slides'].append({'index':int(slide['index']),'file':name,'source_ref':slide.get('source_ref'),'image_sha256':slide.get('image_sha256')})
                    archive.writestr('manifest.json',json.dumps(manifest,indent=2))
                body=json.dumps({'zipBase64':base64.b64encode(output.getvalue()).decode('ascii')}).encode()
            if len(body)>MAX_RESPONSE_BYTES: raise ValueError('Rendered response too large.')
            self.send_response(200); self._cors(); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        except (ValueError,TypeError,KeyError,json.JSONDecodeError) as exc:
            body=json.dumps({'error':str(exc)}).encode(); self.send_response(400); self._cors(); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)

    def _cors(self):
        origin=self.headers.get('Origin')
        if origin == 'file://' or (origin and origin.startswith('http://127.0.0.1:')):
            self.send_header('Access-Control-Allow-Origin',origin); self.send_header('Vary','Origin')
        self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); self.send_header('Access-Control-Allow-Headers','Content-Type')
    def log_message(self,format,*args): pass

if __name__=='__main__': HTTPServer(('127.0.0.1',8765),Handler).serve_forever()
