import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const label = value => value === 'AppSettings' ? 'App settings' : value === 'SystemHealth' ? 'System health' : value
test('registered workflow connects, saves with CAS, then renders only a saved revision', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; const values = new Map(); const requests = []
  const ctx = { storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k,v) => values.set(k,v) }, register: item => registry.push(item) }
  loaded.default.register(ctx)
  const route = registry.find(x => x.id === 'page'); assert.ok(route)
  let revision = 4; let saved = null; let savedId = null
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init })
    if (String(url).endsWith('/api/health')) return Response.json({ status: 'ok' })
    if (String(url).includes('/api/workspace')) return Response.json({ revision, profiles: [], drafts: saved ? [saved] : [], observations: [], decisions: [], posts: [] })
    if (String(url).includes('/api/drafts/')) { const body = JSON.parse(init.body); assert.equal(body.expectedRevision, revision); saved = body.draft; savedId = saved.id; revision++; return Response.json({ revision }) }
    if (String(url).endsWith('/api/render')) { const body = JSON.parse(init.body); assert.equal(body.revision, revision); assert.equal(body.draftId, savedId); return Response.json({ jobId: 'j-1', rendered: { slides: [{ pngBase64: 'AA==' }, { pngBase64: 'AQ==' }] } }) }
    if (String(url).endsWith('/api/jobs/j-1')) return Response.json({ id: 'j-1', status: 'succeeded', events: [] })
    throw new Error(`Unexpected request ${url}`)
  }
  t.after(() => { globalThis.fetch = oldFetch })
  let renderer
  await act(async () => { renderer = TestRenderer.create(route.render()) })
  const findButton = text => renderer.root.findAllByType('button').find(node => node.children.join('') === label(text) || node.props['aria-label'] === text)
  const click = async label => { const b = findButton(label); assert.ok(b, `missing button ${label}`); await act(async () => { b.props.onClick(); await tick() }) }
  await click('AppSettings')
  const inputs = renderer.root.findAllByType('input')
  await act(async () => { inputs.find(i => i.props['aria-label'] === 'Bearer token (stored locally; masked)').props.onChange({ target: { value: 'secret-token' } }) })
  await click('Connect')
  assert.equal(values.get('serviceToken'), 'secret-token')
  assert.ok(requests[1].init.headers.Authorization === 'Bearer secret-token')
  await click('Overview'); await click('New draft')
  assert.equal(findButton('Save to service') !== undefined, true)
  const title = renderer.root.findAllByType('input').find(i => i.props['aria-label'] === 'Title')
  await act(async () => { title.props.onChange({ target: { value: 'Reviewed draft title' } }) })
  await click('Save to service')
  assert.equal(saved.title, 'Reviewed draft title')
  assert.equal(requests.find(x => x.url.includes('/api/drafts/')).init.method, 'PUT')
  await click('Render saved revision')
  const renderCall = requests.find(x => x.url.endsWith('/api/render'))
  const renderPayload = JSON.parse(renderCall.init.body)
  assert.equal(renderPayload.draftId, savedId); assert.equal(renderPayload.revision, revision); assert.match(renderPayload.jobId, /^[0-9a-f-]{36}$/i)
  assert.ok(renderer.root.findByProps({ 'aria-label': 'Rendered slide thumbnails' }))
  await click('Show slide 2')
  assert.equal(renderer.root.findByProps({ alt: 'Rendered slide 2' }).props.alt, 'Rendered slide 2')
})

test('disconnected service keeps persistence actions gated without fabricating records', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; const values = new Map()
  const ctx = { storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k, v) => values.set(k, v) }, register: item => registry.push(item) }
  loaded.default.register(ctx)
  const route = registry.find(x => x.id === 'page'); assert.ok(route)
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('offline-for-draft-create-test') }
  t.after(() => { globalThis.fetch = oldFetch })
  let renderer
  await act(async () => { renderer = TestRenderer.create(route.render()) })
  const buttons = () => renderer.root.findAllByType('button')
  const newDraft = buttons().find(node => node.children.join('') === 'New draft')
  assert.ok(newDraft)
  assert.equal(newDraft.props.disabled, true)
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Untitled Cherry draft/)
  assert.equal(values.has('serviceToken'), false)
})

test('401 and CAS conflict are visible and a conflict preserves the unsaved draft', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; const values = new Map(); loaded.default.register({ storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k,v) => values.set(k,v) }, register: x => registry.push(x) })
  let authorize = false; let conflict = false
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/api/health')) return Response.json({ status: 'ok' })
    if (String(url).includes('/api/workspace')) return authorize ? Response.json({ revision: 8, profiles: [], drafts: [] }) : Response.json({ error: 'unauthorized' }, { status: 401 })
    if (String(url).includes('/api/drafts/')) return conflict ? Response.json({ error: 'revision conflict' }, { status: 409 }) : Response.json({ revision: 9 })
    throw new Error(`Unexpected request ${url}`)
  }
  t.after(() => { globalThis.fetch = oldFetch })
  let renderer; await act(async () => { renderer = TestRenderer.create(registry.find(x => x.id === 'page').render()) })
  const button = text => renderer.root.findAllByType('button').find(n => n.children.join('') === label(text))
  const click = async label => act(async () => { button(label).props.onClick(); await tick() })
  await click('AppSettings'); await click('Connect')
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /unauthorized/i)
  authorize = true; await click('Connect'); await click('Overview'); await click('New draft')
  const title = renderer.root.findAllByType('input').find(n => n.props['aria-label'] === 'Title')
  await act(async () => title.props.onChange({ target: { value: 'Keep my unsaved work' } }))
  conflict = true; await click('Save to service')
  assert.equal(renderer.root.findAllByType('input').find(n => n.props['aria-label'] === 'Title').props.value, 'Keep my unsaved work')
  assert.ok(button('Save to service'))
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /revision conflict/i)
})

test('offline connection keeps editable form visibly disconnected and never fabricates workspace records', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; loaded.default.register({ storage: { get: (_k, fallback) => fallback, set() {} }, register: x => registry.push(x) })
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('fetch failed') }; t.after(() => { globalThis.fetch = oldFetch })
  let renderer; await act(async () => { renderer = TestRenderer.create(registry.find(x => x.id === 'page').render()) })
  const button = renderer.root.findAllByType('button').find(node => node.children.join('') === 'App settings')
  await act(async () => button.props.onClick())
  const connect = renderer.root.findAllByType('button').find(node => node.children.join('') === 'Connect')
  await act(async () => { connect.props.onClick(); await tick() })
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /fetch failed/)
  assert.match(JSON.stringify(renderer.toJSON()), /Disconnected/)
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /sample post|paid conversions: 0/i)
})
