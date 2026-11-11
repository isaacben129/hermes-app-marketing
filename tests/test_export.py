import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
MODULE=Path(__file__).parents[1]/'renderer'/'render.py'
spec=importlib.util.spec_from_file_location('marketing_renderer',MODULE)
assert spec and spec.loader
renderer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
class ExportTests(unittest.TestCase):
 def test_exports_pngs_and_source_manifest_that_reopens(self):
  rendered=renderer.render_slideshow({'slides':['first','second']})
  with tempfile.TemporaryDirectory() as d:
   out=renderer.export_slideshow_zip(rendered,Path(d)/'draft.zip',{'draftId':'fixture:focus-1','app':'App A'})
   with zipfile.ZipFile(out) as z:
    names=z.namelist(); self.assertEqual(names,['slide-01.png','slide-02.png','manifest.json'])
    m=json.loads(z.read('manifest.json')); self.assertEqual(m['source']['draftId'],'fixture:focus-1')
    self.assertEqual(m['files'],names[:2]); self.assertEqual(z.read('slide-01.png')[:8],b'\x89PNG\r\n\x1a\n')
if __name__=='__main__': unittest.main()
