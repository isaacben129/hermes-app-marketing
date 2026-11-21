import hashlib, io, json, tempfile, unittest
from pathlib import Path
from PIL import Image
from dashboard import creative_previews as cp

class CreativePreviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name); self.run='a'*32; self.pkg='pkg-safe_1'
        self.root=self.data/'agent-runs'/self.run; self.art=self.root/self.pkg/'iteration-2'
        (self.art/'rendered').mkdir(parents=True)
        rendered=[]
        for index in (1, 2):
            buffer=io.BytesIO(); Image.new('RGB',(24,36),(index*20,40,60)).save(buffer,'PNG'); data=buffer.getvalue()
            name=f'slide-{index:02}.png'; (self.art/'rendered'/name).write_bytes(data)
            rendered.append({'index':index,'file':f'rendered/{name}','sha256':hashlib.sha256(data).hexdigest()})
        record={'runId':self.run,'app':'Cherry','results':[{'packageId':self.pkg,'draftId':'saved-draft-1','status':'unapproved','artifactPath':self.pkg+'/iteration-2'}]}
        (self.root/'run.json').write_text(json.dumps(record))
        for name,value in [('final.json',{'title':'Fixture title','slides':[{},{}]}),('final-critique.json',{'reviews':[{'dimension':'hook clarity','score':4}],'hardBlockers':['rights']}),('provenance.json',{'rendered':rendered})]: (self.art/name).write_text(json.dumps(value))

    def test_lists_saved_and_returns_provenance_verified_real_png(self):
        result=cp.list_creatives(self.data)['creatives'][0]
        self.assertEqual((result['title'],result['iteration'],result['slideCount']),('Fixture title','iteration-2',2))
        image=cp.read_slide(self.data,self.run,self.pkg,1)
        data=__import__('base64').b64decode(image['dataUrl'].split(',',1)[1])
        self.assertEqual(hashlib.sha256(data).hexdigest(),image['sha256'])
        with Image.open(io.BytesIO(data)) as decoded: self.assertEqual(decoded.size,(24,36))

    def test_skips_non_object_run_records_without_hiding_valid_runs(self):
        malformed=self.data/'agent-runs'/('b'*32); malformed.mkdir()
        (malformed/'run.json').write_text('[]')
        self.assertEqual(len(cp.list_creatives(self.data)['creatives']),1)
        (malformed/'run.json').write_text(json.dumps([]))
        self.assertEqual(len(cp.list_creatives(self.data)['creatives']),1)

    def test_rejects_jpeg_with_png_name_even_with_matching_provenance_digest(self):
        path=self.art/'rendered'/'slide-01.png'; buffer=io.BytesIO(); Image.new('RGB',(24,36)).save(buffer,'JPEG'); data=buffer.getvalue(); path.write_bytes(data)
        provenance=self.art/'provenance.json'; body=json.loads(provenance.read_text()); body['rendered'][0]['sha256']=hashlib.sha256(data).hexdigest(); provenance.write_text(json.dumps(body))
        self.assertEqual(cp.list_creatives(self.data)['creatives'],[])
        self.assertEqual(cp.read_slide(self.data,self.run,self.pkg,0).status_code,404)

    def test_rejects_png_dimensions_outside_bounds(self):
        path=self.art/'rendered'/'slide-01.png'; buffer=io.BytesIO(); Image.new('RGB',(4097,1)).save(buffer,'PNG'); data=buffer.getvalue(); path.write_bytes(data)
        provenance=self.art/'provenance.json'; body=json.loads(provenance.read_text()); body['rendered'][0]['sha256']=hashlib.sha256(data).hexdigest(); provenance.write_text(json.dumps(body))
        self.assertEqual(cp.list_creatives(self.data)['creatives'],[])

    def test_tampered_digest_missing_png_and_malformed_provenance_are_unavailable(self):
        provenance=self.art/'provenance.json'; body=json.loads(provenance.read_text()); body['rendered'][0]['sha256']='0'*64; provenance.write_text(json.dumps(body))
        self.assertEqual(cp.list_creatives(self.data)['creatives'],[])
        self.assertEqual(cp.read_slide(self.data,self.run,self.pkg,0).status_code,404)
        body['rendered'][0]['sha256']='bad'; provenance.write_text(json.dumps(body))
        self.assertEqual(cp.list_creatives(self.data)['creatives'],[])

    def test_app_run_id_and_symlinked_package_are_isolated(self):
        self.assertEqual(cp.list_creatives(self.data,'Other'),{'creatives':[]})
        self.assertEqual(cp.read_slide(self.data,'../'+self.run,self.pkg,0).status_code,404)
        outside=Path(self.tmp.name)/'outside'; outside.mkdir()
        import shutil
        link=self.root/self.pkg; shutil.rmtree(link); link.symlink_to(outside,target_is_directory=True)
        self.assertEqual(cp.list_creatives(self.data)['creatives'],[])

if __name__ == '__main__': unittest.main()
