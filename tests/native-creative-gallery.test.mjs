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
  const creative = { id:'pkg-1', draftId:'draft-1', runId:'run-1', title:'Rendered fixture', status:'rendered-unapproved', iteration:'iteration-2', slideCount:2, slides:[{index:0,sha256:'a'},{index:1,sha256:'b'}], qualityReviews:[{dimension:'hook clarity',score:4}], hardBlockers:['rights pending'] }
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
  await click('Creatives'); await click('Rendered fixture')
  assert.ok(calls.includes('/creative-previews/run-1/pkg-1/slides/0'))
  await click('Show slide 2')
  assert.ok(calls.includes('/creative-previews/run-1/pkg-1/slides/1'))
  assert.match(JSON.stringify(renderer.toJSON()),/hook clarity: 4.*rights pending/s)
  await click('Edit draft')
  assert.match(JSON.stringify(renderer.toJSON()),/Rendered fixture/)
  assert.ok(calls.some(path=>path.startsWith('/creative-previews?app=Cherry')))
})
