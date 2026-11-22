import test from 'node:test'
import assert from 'node:assert/strict'
import TestRenderer, { act } from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('')
const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOoCNAAAAI0APHlrLKsAAAAAElFTkSuQmCC'

test('native gallery browses saved PNG slides, critique and existing draft editor', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const contributions = [], calls = []
  const creative = { id:'0123456789abcdef0123456789abcdef01234567', draftId:'draft-1', runId:'run-1', title:'Rendered fixture', status:'rendered-unapproved', iteration:'iteration-2', slideCount:2, slides:[{index:0,sha256:'a'},{index:1,sha256:'b'}], qualityReviews:[{dimension:'hook clarity',score:4}], hardBlockers:['rights pending'] }
  const ctx = { register:x=>contributions.push(x), storage:{get:(_k,f)=>f,set(){}}, rest:async path=> {
    calls.push(path)
    if(path==='/health') return {version:1}
    if(path.startsWith('/workspace?')) return {revision:1,drafts:[{id:'draft-1',app:'Cherry',title:'Rendered fixture',slides:[],qualityReviews:[]}],profiles:[]}
    if(path==='/agent-runs') return {runs:[]}
    if(path==='/creative-previews?app=Cherry') return {creatives:[creative]}
    if(path.endsWith('/slides/0')) return {dataUrl:onePixelPng,sha256:'a',index:0,draftId:'draft-1'}
    if(path.endsWith('/slides/1')) return {dataUrl:onePixelPng,sha256:'b',index:1,draftId:'draft-1'}
    throw new Error('unexpected '+path)
  } }
  loaded.default.register(ctx)
  let renderer
  await act(async()=>{renderer=TestRenderer.create(contributions.find(x=>x.id==='page').render()); await new Promise(r=>setTimeout(r,10))})
  t.after(()=>act(()=>renderer.unmount()))
  const click=async label=>{const b=renderer.root.findAllByType('button').find(x=>textOf(x).includes(label) || x.props['aria-label']===label);assert.ok(b,label);await act(async()=>{b.props.onClick();await new Promise(r=>setTimeout(r,0))})}
  await click('Creatives'); assert.match(textOf(renderer.toJSON()),/Revision 2/); assert.doesNotMatch(textOf(renderer.toJSON()),/0123456789abcdef0123456789abcdef01234567/); await click('Rendered fixture')
  assert.ok(calls.includes('/creative-previews/run-1/0123456789abcdef0123456789abcdef01234567/slides/0'))
  await click('Show slide 2')
  assert.ok(calls.includes('/creative-previews/run-1/0123456789abcdef0123456789abcdef01234567/slides/1'))
  assert.match(JSON.stringify(renderer.toJSON()),/hook clarity: 4.*rights pending/s)
  await click('Edit draft')
  assert.match(JSON.stringify(renderer.toJSON()),/Rendered fixture/)
  assert.ok(calls.some(path=>path.startsWith('/creative-previews?app=Cherry')))
})

test('gallery keeps the displayed slide and portrait stage while a requested slide loads', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const contributions = []
  let releaseSlide2
  const slide2 = new Promise(resolve => { releaseSlide2 = resolve })
  const creative = { id:'creative-1', draftId:'draft-1', runId:'run-1', title:'Portrait work', status:'rendered-unapproved', slideCount:2, slides:[{index:0},{index:1}] }
  const ctx = { register:x=>contributions.push(x), storage:{get:(_k,f)=>f,set(){}}, rest:async path => {
    if(path==='/health') return {version:1}
    if(path.startsWith('/workspace?')) return {revision:1,drafts:[],profiles:[]}
    if(path==='/agent-runs') return {runs:[]}
    if(path==='/creative-previews?app=Cherry') return {creatives:[creative]}
    if(path.endsWith('/slides/0')) return {dataUrl:'data:image/png;base64,first',index:0}
    if(path.endsWith('/slides/1')) return slide2
    throw new Error('unexpected '+path)
  } }
  loaded.default.register(ctx)
  let renderer
  await act(async()=>{renderer=TestRenderer.create(contributions.find(x=>x.id==='page').render());await new Promise(r=>setTimeout(r,10))})
  t.after(()=>act(()=>renderer.unmount()))
  const click=async label=>{const b=renderer.root.findAllByType('button').find(x=>x.props['aria-label']===label||textOf(x).includes(label));assert.ok(b,label);await act(async()=>{b.props.onClick();await new Promise(r=>setTimeout(r,0))})}
  await click('Creatives'); await click('Portrait work')
  const first=renderer.root.findByType('img')
  assert.equal(first.props.src,'data:image/png;base64,first')
  const stage=renderer.root.findAll(x=>x.props['aria-label']==='Portrait slide stage')[0]
  assert.ok(stage,'fixed portrait stage is present')
  const stageStyle=stage.props.style
  const originalImage=globalThis.Image
  let finishDecode
  globalThis.Image=class { set src(value){this.value=value} decode(){return new Promise(resolve=>{finishDecode=resolve})} }
  t.after(()=>{if(originalImage===undefined)delete globalThis.Image;else globalThis.Image=originalImage})
  await click('Show slide 2')
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,first','old slide remains visible while next request is pending')
  assert.deepEqual(renderer.root.findAll(x=>x.props['aria-label']==='Portrait slide stage')[0].props.style,stageStyle)
  assert.match(JSON.stringify(renderer.toJSON()),/Loading slide 2/)
  await act(async()=>{releaseSlide2({dataUrl:'data:image/png;base64,second',index:1});await new Promise(r=>setTimeout(r,0))})
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,first','old slide remains visible until replacement decode completes')
  await act(async()=>{finishDecode();await new Promise(r=>setTimeout(r,0))})
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,second')
})

test('gallery ignores late slide responses and offers recovery while retaining the shown slide', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const contributions=[]; const pending={}
  const creative={id:'creative-2',draftId:'d',runId:'r',title:'Race work',status:'rendered-unapproved',slideCount:3,slides:[{},{},{}]}
  const ctx={register:x=>contributions.push(x),storage:{get:(_k,f)=>f,set(){}},rest:async path=>{
    if(path==='/health')return {version:1}; if(path.startsWith('/workspace?'))return {revision:1,drafts:[],profiles:[]}; if(path==='/agent-runs')return {runs:[]};
    if(path==='/creative-previews?app=Cherry')return {creatives:[creative]}
    const n=Number(path.split('/').at(-1)); if(n===0)return {dataUrl:'data:image/png;base64,first',index:0}
    return new Promise((resolve,reject)=>{pending[n]={resolve,reject}})
  }}
  loaded.default.register(ctx); let renderer
  await act(async()=>{renderer=TestRenderer.create(contributions.find(x=>x.id==='page').render());await new Promise(r=>setTimeout(r,10))});t.after(()=>act(()=>renderer.unmount()))
  const click=async label=>{const b=renderer.root.findAllByType('button').find(x=>x.props['aria-label']===label||textOf(x).includes(label));assert.ok(b,label);await act(async()=>{b.props.onClick();await new Promise(r=>setTimeout(r,0))})}
  await click('Creatives');await click('Race work');await click('Show slide 2');await click('Show slide 3')
  await act(async()=>{pending[2].resolve({dataUrl:'data:image/png;base64,third',index:2});await new Promise(r=>setTimeout(r,0))})
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,third')
  await act(async()=>{pending[1].resolve({dataUrl:'data:image/png;base64,late-second',index:1});await new Promise(r=>setTimeout(r,0))})
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,third','late B cannot replace selected C')
  await click('Show slide 2')
  await act(async()=>{pending[1].reject(new Error('render unavailable'));await new Promise(r=>setTimeout(r,0))})
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,third','failed request keeps shown slide')
  assert.match(JSON.stringify(renderer.toJSON()),/slide 3/,'status identifies the displayed slide')
  assert.ok(renderer.root.findAllByType('button').some(button=>textOf(button).includes('Retry')),'retry recovery is available')
})

test('failed next slide keeps retry inside the reserved stage and retry recovers without stale decode overwrites', async t => {
  const loaded=await loadPlugin();t.after(loaded.cleanup);const contributions=[],pending={}
  const creatives=[{id:'one',runId:'r',title:'First work',status:'rendered-unapproved',slideCount:2,slides:[{},{}]},{id:'two',runId:'r',title:'Other work',status:'rendered-unapproved',slideCount:1,slides:[{}]}]
  const ctx={register:x=>contributions.push(x),storage:{get:(_k,f)=>f,set(){}},rest:async path=>{
    if(path==='/health')return{version:1};if(path.startsWith('/workspace?'))return{revision:1,drafts:[],profiles:[]};if(path==='/agent-runs')return{runs:[]};if(path==='/creative-previews?app=Cherry')return{creatives}
    const [, ,run,id,,n]=path.split('/');if(n==='0'&&id==='one')return{dataUrl:'data:image/png;base64,shown',index:0};if(n==='0'&&id==='two')return{dataUrl:'data:image/png;base64,other',index:0}
    return new Promise((resolve,reject)=>{(pending[id+n]||=[]).push({resolve,reject})})
  }}
  loaded.default.register(ctx);let renderer
  await act(async()=>{renderer=TestRenderer.create(contributions.find(x=>x.id==='page').render());await new Promise(r=>setTimeout(r,10))});t.after(()=>act(()=>renderer.unmount()))
  const click=async label=>{const b=renderer.root.findAllByType('button').find(x=>x.props['aria-label']===label||textOf(x).includes(label));assert.ok(b,label);await act(async()=>{b.props.onClick();await new Promise(r=>setTimeout(r,0))})}
  await click('Creatives');await click('First work');await click('Show slide 2')
  await act(async()=>{pending.one1[0].reject(new Error('renderer says image missing'));await new Promise(r=>setTimeout(r,0))})
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,shown')
  const stage=renderer.root.findAll(x=>x.props['aria-label']==='Portrait slide stage')[0]
  const overlay=stage.findAll(x=>x.props.role==='alert')[0]
  const retry=renderer.root.findAllByType('button').find(x=>textOf(x).includes('Retry slide'))
  const tree=renderer.toJSON();const findStage=node=>node?.props?.['aria-label']==='Portrait slide stage'?node:(node?.children||[]).map(findStage).find(Boolean)
  assert.ok(retry);assert.match(JSON.stringify(findStage(tree)),/Retry slide/,'retry must be within the fixed stage overlay')
  assert.match(textOf(overlay),/renderer says image missing/)
  await click('Retry slide');assert.ok(pending.one1.length===2)
  await act(async()=>{pending.one1[1].resolve({dataUrl:'data:image/png;base64,recovered',index:1});await new Promise(r=>setTimeout(r,0))})
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,recovered');assert.doesNotMatch(textOf(stage),/unavailable/)
  const original=globalThis.Image;let finish
  globalThis.Image=class{set src(v){this.value=v}decode(){return this.value.includes('other')?new Promise(resolve=>finish=resolve):Promise.resolve()}}
  t.after(()=>{if(original===undefined)delete globalThis.Image;else globalThis.Image=original})
  await click('Back to creatives');await click('Other work')
  await click('Back to creatives');await click('First work')
  await act(async()=>{finish();await new Promise(r=>setTimeout(r,0))})
  assert.equal(renderer.root.findByType('img').props.src,'data:image/png;base64,shown','late decoded image cannot replace the currently selected creative')
})
