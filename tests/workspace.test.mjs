import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventLedger } from '../src/storage/ledger.mjs'
import { WorkspaceStore } from '../src/storage/workspace.mjs'
const draft=(id,app='Cherry')=>({id,app,title:id,saved:true})
test('workspace saves durable revisions and rejects stale concurrent saves', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-'))
 try { const a=new WorkspaceStore({ledger:new EventLedger({baseDir:dir})}); const first=await a.saveDraft({draft:draft('d1'),expectedRevision:0});
 const b=new WorkspaceStore({ledger:new EventLedger({baseDir:dir})}); assert.deepEqual(await b.load('Cherry'),{revision:1,profiles:[],drafts:[first.draft],observations:[],decisions:[]});
 const results=await Promise.allSettled([a.saveDraft({draft:draft('d1'),expectedRevision:1}),b.saveDraft({draft:draft('d2'),expectedRevision:1})]); assert.equal(results.filter(x=>x.status==='fulfilled').length,1); assert.equal(results.filter(x=>x.status==='rejected').length,1)
 } finally {await fs.rm(dir,{recursive:true,force:true})}
})
test('legacy import is idempotent and scoped to app',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-')); try {const s=new WorkspaceStore({ledger:new EventLedger({baseDir:dir})}); await s.importLegacy({migrationId:'m1',profiles:[],drafts:[draft('a'),draft('b','Other')]}); await s.importLegacy({migrationId:'m1',profiles:[],drafts:[draft('c')]}); assert.deepEqual((await s.load('Cherry')).drafts.map(x=>x.id),['a']); assert.deepEqual((await s.load('Other')).drafts.map(x=>x.id),['b'])}finally{await fs.rm(dir,{recursive:true,force:true})}})
test('findDraft returns a saved draft across app scopes',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-'));try{const s=new WorkspaceStore({ledger:new EventLedger({baseDir:dir})});await s.saveDraft({draft:draft('lookup'),expectedRevision:0});assert.deepEqual(await s.findDraft('lookup'),draft('lookup'))}finally{await fs.rm(dir,{recursive:true,force:true})}})
