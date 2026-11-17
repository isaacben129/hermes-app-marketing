import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const empty = () => ({ revision: 0, profiles: [], drafts: [], observations: [], decisions: [] })
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
export class WorkspaceStore {
  #ledger
  #queue = Promise.resolve()
  constructor({ ledger }) { if (!ledger) throw new TypeError('ledger is required'); this.#ledger = ledger }
  async load(app) {
    const state = empty(); const events = await this.#ledger.getEvents()
    for (const event of events) {
      const p = event.payload ?? {}
      if (event.type === 'draft.saved' && p.draft?.app === app) { state.revision++; const i=state.drafts.findIndex(d=>d.id===p.draft.id); if(i<0)state.drafts.push(p.draft);else state.drafts[i]=p.draft }
      if (event.type === 'workspace.imported' && p.migrationId && p.workspace) { const part=p.workspace[app]; if(part && !events.slice(0,events.indexOf(event)).some(e=>e.type==='workspace.imported'&&e.payload?.migrationId===p.migrationId)){state.revision++;state.profiles.push(...part.profiles);for(const d of part.drafts){const i=state.drafts.findIndex(x=>x.id===d.id);if(i<0)state.drafts.push(d);else state.drafts[i]=d}} }
    }
    return state
  }
  async findDraft(id) { const events=await this.#ledger.getEvents(); const found=new Map(); for(const e of events){const p=e.payload??{};if(e.type==='draft.saved'&&p.draft?.id)found.set(p.draft.id,p.draft);if(e.type==='workspace.imported')for(const part of Object.values(p.workspace??{}))for(const d of part.drafts??[])found.set(d.id,d)}return found.get(id)??null }
  saveDraft({ draft, expectedRevision }) { return this.#serialize(async()=>this.#withLock(async()=>{ if(!draft||typeof draft.id!=='string'||typeof draft.app!=='string'||draft.saved!==true)throw new TypeError('Invalid saved draft'); const current=await this.load(draft.app); if(current.revision!==expectedRevision){const e=new Error('Workspace revision is stale');e.code='stale_revision';throw e} const copy=structuredClone(draft); if(Array.isArray(copy.assets)){for(const asset of copy.assets){if(typeof asset.dataUrl==='string'&&asset.dataUrl.length>0x1000000)throw new TypeError('Image data exceeds limit'); if(typeof asset.dataUrl==='string'){const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(asset.dataUrl);if(!m)throw new TypeError('Invalid image data');const bytes=Buffer.from(m[2],'base64');const digest=hash(bytes);const dir=path.join(this.#ledger.baseDir,'images');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,digest);try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}asset.sourceRef??=`image:${digest}`;asset.sha256=digest;delete asset.dataUrl}}} const contentHash=hash(JSON.stringify(copy)); await this.#ledger.appendEvent({type:'draft.saved',payload:{draft:copy,parentRevision:current.revision,contentHash}}); return {revision:current.revision+1,draft:copy} })) }
  importLegacy({migrationId,profiles=[],drafts=[]}) { return this.#serialize(async()=>{if(typeof migrationId!=='string'||!migrationId)throw new TypeError('migrationId is required');const events=await this.#ledger.getEvents();if(!events.some(e=>e.type==='workspace.imported'&&e.payload?.migrationId===migrationId)){const apps={};for(const d of drafts){if(!d||typeof d.app!=='string'||typeof d.id!=='string')throw new TypeError('Invalid legacy draft');(apps[d.app]??={profiles:[],drafts:[]}).drafts.push(d)}for(const p of profiles){if(!p||typeof p.app!=='string')throw new TypeError('Invalid legacy profile');(apps[p.app]??={profiles:[],drafts:[]}).profiles.push(p)}await this.#ledger.appendEvent({type:'workspace.imported',payload:{migrationId,workspace:apps}})}const appNames=new Set([...drafts.map(d=>d.app),...profiles.map(p=>p.app)]);const out={};for(const app of appNames)out[app]=await this.load(app);return out}) }
  async #withLock(fn){const lock=path.join(this.#ledger.baseDir,'.workspace-lock');await fs.mkdir(path.dirname(lock),{recursive:true});let handle;for(let i=0;i<500;i++){try{handle=await fs.open(lock,'wx');break}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,10))}}if(!handle)throw new Error('Workspace lock timeout');try{return await fn()}finally{await handle.close();await fs.rm(lock,{force:true})}}
  #serialize(fn){const p=this.#queue.then(fn);this.#queue=p.catch(()=>{});return p}
}
