import hashlib, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from dashboard import creative_previews as cp

PNG = b'\x89PNG\r\n\x1a\nfixture'

class CreativePreviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name); self.run='a'*32; self.pkg=self.run+'-01'
        self.root=self.data/'agent-runs'/self.run; self.art=self.root/self.pkg/'iteration-2'
        (self.art/'rendered').mkdir(parents=True)
        record={'runId':self.run,'app':'Cherry','results':[{'packageId':self.pkg,'draftId':self.pkg,'status':'rendered-unapproved','artifactPath':self.pkg+'/iteration-2','qualityReviews':[{'dimension':'hook','score':4}]}]}
        (self.root/'run.json').write_text(json.dumps(record))
        for name,value in [('final.json',{'title':'Fixture title'}),('final-critique.json',{'hardBlockers':['rights']}),('provenance.json',{'fixture':True})]: (self.art/name).write_text(json.dumps(value))
        (self.art/'rendered/slide-01.png').write_bytes(PNG)
        self.patch=patch.object(cp,'data_dir',return_value=self.data); self.patch.start(); self.addCleanup(self.patch.stop)

    def test_lists_latest_saved_and_returns_verified_image(self):
        result=cp.list_creatives()['creatives'][0]
        self.assertEqual((result['title'],result['iteration'],result['status']),('Fixture title','iteration-2','rendered-unapproved'))
        image=cp.read_slide(self.run,self.pkg,0)
        self.assertEqual(image['sha256'],hashlib.sha256(PNG).hexdigest())
        self.assertEqual(__import__('base64').b64decode(image['dataUrl'].split(',',1)[1]), PNG)

    def test_other_app_and_bad_paths_are_isolated(self):
        self.assertEqual(cp.list_creatives('Other'),{'creatives':[]})
        self.assertEqual(cp.read_slide('../'+self.run,self.pkg,0).status_code,404)
        (self.art/'rendered/slide-01.png').unlink()
        self.assertEqual(cp.list_creatives()['creatives'],[])

    def test_symlinked_package_escape_is_not_listed(self):
        outside=Path(self.tmp.name)/'outside'; outside.mkdir()
        link=self.root/self.pkg
        import shutil
        shutil.rmtree(link); link.symlink_to(outside, target_is_directory=True)
        self.assertEqual(cp.list_creatives()['creatives'],[])

if __name__ == '__main__': unittest.main()
