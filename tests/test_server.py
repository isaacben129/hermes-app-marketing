import base64, json, subprocess, sys, time, unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path

class RendererServerTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.root=Path(__file__).parents[1]
  cls.proc=subprocess.Popen([sys.executable,'server.py'],cwd=cls.root/'renderer',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  cls.base='http://127.0.0.1:8765'
  for _ in range(60):
   try: urlopen(cls.base+'/api/health',timeout=.2);break
   except Exception: time.sleep(.1)
  else: raise RuntimeError('renderer server failed to start')
 @classmethod
 def tearDownClass(cls):
  cls.proc.terminate();cls.proc.wait(timeout=5)
 def test_render_and_export_endpoints_round_trip(self):
  req=Request(self.base+'/api/render',data=json.dumps({'slides':['hello'],'theme':'neutral'}).encode(),headers={'Content-Type':'application/json','Origin':'file://'},method='POST')
  with urlopen(req) as r:
   data=json.loads(r.read());self.assertEqual(r.headers.get('Access-Control-Allow-Origin'),'file://')
  png=base64.b64decode(data['slides'][0]['pngBase64']);self.assertEqual(png[:8],b'\x89PNG\r\n\x1a\n')
  export={'rendered':{'dimensions':data['dimensions'],'theme':data['theme'],'slides':[{'index':1,'pngBase64':data['slides'][0]['pngBase64']}]},'source':{'draftId':'local-test'}}
  req=Request(self.base+'/api/export',data=json.dumps(export).encode(),headers={'Content-Type':'application/json','Origin':'file://'},method='POST')
  archive=base64.b64decode(json.loads(urlopen(req).read())['zipBase64'])
  self.assertTrue(archive.startswith(b'PK'))
 def test_rejects_remote_origin(self):
  req=Request(self.base+'/api/render',data=b'{}',headers={'Content-Type':'application/json','Origin':'https://evil.example'},method='POST')
  try:
   urlopen(req)
   self.fail('remote origin should be forbidden')
  except HTTPError as error:
   error.close()
   self.assertEqual(error.code,403)
if __name__=='__main__':unittest.main()
