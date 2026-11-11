import base64
import io
import json
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from render import render_slideshow

MAX_REQUEST_BYTES = 1_000_000
MAX_RESPONSE_BYTES = 8_000_000

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path != '/api/health': self.send_error(404); return
        body=b'OK'; self.send_response(200); self._cors(); self.send_header('Content-Type','text/plain'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        if self.path not in ('/api/render','/api/export'): self.send_error(404); return
        origin=self.headers.get('Origin')
        if origin and origin not in ('file://','null') and not origin.startswith('http://127.0.0.1:'):
            self.send_error(403); return
        try:
            if self.headers.get('Transfer-Encoding'):
                self.send_error(411); return
            size=int(self.headers.get('Content-Length','0'))
            if size <= 0 or size > MAX_REQUEST_BYTES: raise ValueError('Request must be between 1 byte and 1 MB.')
            payload=json.loads(self.rfile.read(size))
            if self.path == '/api/render':
                rendered=render_slideshow(payload)
                result={'dimensions':rendered['dimensions'],'theme':rendered['theme'],'slides':[{'index':s['index'],'width':s['width'],'height':s['height'],'pngBase64':base64.b64encode(s['png']).decode('ascii')} for s in rendered['slides']]}
                body=json.dumps(result).encode()
            else:
                rendered=payload.get('rendered') or {}; slides=rendered.get('slides') or []
                if not 1 <= len(slides) <= 20: raise ValueError('Export must contain 1–20 slides.')
                output=io.BytesIO(); manifest={'format':'APP Marketing local slideshow export','version':1,'dimensions':rendered.get('dimensions'),'theme':rendered.get('theme'),'source':payload.get('source') or {},'files':[]}
                with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                    for slide in slides:
                        name=f"slide-{int(slide['index']):02d}.png"; png=base64.b64decode(slide.get('pngBase64',''),validate=True)
                        if not png.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Export contains an invalid PNG.')
                        archive.writestr(name,png); manifest['files'].append(name)
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
