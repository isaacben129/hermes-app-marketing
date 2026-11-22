import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const label = value => value === 'AppSettings' ? 'App settings' : value === 'SystemHealth' ? 'System health' : value

test('Overview renders desktop-first responsive layout with key sections', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; const values = new Map()
  loaded.default.register({
    storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k,v) => values.set(k,v) },
    register: item => registry.push(item)
  })
  const route = registry.find(x => x.id === 'page'); assert.ok(route)
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/health')) return Response.json({ status: 'ok' })
    if (String(url).includes('/api/workspace')) return Response.json({ revision: 5, profiles: [], drafts: [], observations: [], decisions: [], posts: [] })
    throw new Error(`Unexpected request ${url}`)
  }
  t.after(() => { globalThis.fetch = oldFetch })
  let renderer
  await act(async () => { renderer = TestRenderer.create(route.render()) })
  const button = text => renderer.root.findAllByType('button').find(node => node.children.join('') === label(text) || node.props['aria-label'] === text)
  const click = async label => { const b = button(label); assert.ok(b, `missing button ${label}`); await act(async () => { b.props.onClick(); await tick() }) }
  await click('AppSettings')
  const tokenInput = renderer.root.findAllByType('input').find(i => i.props['aria-label'] === 'Bearer token (stored locally; masked)')
  await act(async () => tokenInput.props.onChange({ target: { value: 'test-token' } }))
  await click('Connect')
  await click('Overview')
  const overview = renderer.toJSON()
  const overviewStr = JSON.stringify(overview)
  assert.match(overviewStr, /Marketing overview/, 'Overview header present')
  assert.match(overviewStr, /Service revision/, 'Service revision shown')
  assert.match(overviewStr, /saved drafts/, 'Draft count shown')
  assert.match(overviewStr, /New draft/, 'New draft button present')
})

test('Overview contains only service drafts and keeps a real draft openable', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; const values = new Map()
  loaded.default.register({
    storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k,v) => values.set(k,v) },
    register: item => registry.push(item)
  })
  const route = registry.find(x => x.id === 'page'); assert.ok(route)
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/health')) return Response.json({ status: 'ok' })
    if (String(url).includes('/api/workspace')) return Response.json({ revision: 5, profiles: [], drafts: [{ id: 'real-1', title: 'Real saved draft', app: 'Cherry', slides: [], qualityReviews: [] }], observations: [], decisions: [], posts: [] })
    throw new Error(`Unexpected request ${url}`)
  }
  t.after(() => { globalThis.fetch = oldFetch })
  let renderer
  await act(async () => { renderer = TestRenderer.create(route.render()) })
  const button = text => renderer.root.findAllByType('button').find(node => node.children.join('') === label(text) || node.props['aria-label'] === text)
  const click = async label => { const b = button(label); assert.ok(b, `missing button ${label}`); await act(async () => { b.props.onClick(); await tick() }) }
  await click('AppSettings')
  const tokenInput = renderer.root.findAllByType('input').find(i => i.props['aria-label'] === 'Bearer token (stored locally; masked)')
  await act(async () => tokenInput.props.onChange({ target: { value: 'test-token' } }))
  await click('Connect')
  await click('Overview')
  const overviewStr = JSON.stringify(renderer.toJSON())
  assert.doesNotMatch(overviewStr, /Synthetic demo|Demo preview|Read-only demo|habit stacking|concept campaign/i)
  assert.match(overviewStr, /Real saved draft/)
  const draft = renderer.root.findAllByType('button').find(node => node.findAllByType('div').some(div => div.children.includes('Real saved draft')))
  assert.ok(draft, 'real saved draft is available to open')
  await act(async () => { draft.props.onClick(); await tick() })
  assert.match(JSON.stringify(renderer.toJSON()), /Real saved draft/)
})

test('Synthetic demo data never enters operations or persistent records', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; const values = new Map()
  const apiCalls = []
  loaded.default.register({
    storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k,v) => values.set(k,v) },
    register: item => registry.push(item)
  })
  const route = registry.find(x => x.id === 'page'); assert.ok(route)
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    apiCalls.push({ url: String(url), method: init.method || 'GET', body: init.body })
    if (String(url).endsWith('/api/health')) return Response.json({ status: 'ok' })
    if (String(url).includes('/api/workspace')) return Response.json({ revision: 5, profiles: [], drafts: [], observations: [], decisions: [], posts: [] })
    throw new Error(`Unexpected request ${url}`)
  }
  t.after(() => { globalThis.fetch = oldFetch })
  let renderer
  await act(async () => { renderer = TestRenderer.create(route.render()) })
  const button = text => renderer.root.findAllByType('button').find(node => node.children.join('') === label(text) || node.props['aria-label'] === text)
  const click = async label => { const b = button(label); assert.ok(b, `missing button ${label}`); await act(async () => { b.props.onClick(); await tick() }) }
  await click('AppSettings')
  const tokenInput = renderer.root.findAllByType('input').find(i => i.props['aria-label'] === 'Bearer token (stored locally; masked)')
  await act(async () => tokenInput.props.onChange({ target: { value: 'test-token' } }))
  await click('Connect')
  await click('Overview')
  const saveCalls = apiCalls.filter(c => c.method === 'PUT' || c.method === 'POST')
  const syntheticCalls = saveCalls.filter(c => JSON.stringify(c).includes('synthetic') || JSON.stringify(c).includes('demo') || JSON.stringify(c).includes('Synthetic'))
  assert.equal(syntheticCalls.length, 0, 'No synthetic/demo data sent to service APIs')
  const localStorageKeys = Array.from(values.keys())
  const syntheticKeys = localStorageKeys.filter(k => k.includes('synthetic') || k.includes('demo') || k.includes('Synthetic') || k.includes('Demo'))
  assert.equal(syntheticKeys.length, 0, 'No synthetic/demo data in local storage')
})

test('Mobile viewport renders Overview without horizontal overflow and key actions reachable', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; const values = new Map()
  loaded.default.register({
    storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k,v) => values.set(k,v) },
    register: item => registry.push(item)
  })
  const route = registry.find(x => x.id === 'page'); assert.ok(route)
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/health')) return Response.json({ status: 'ok' })
    if (String(url).includes('/api/workspace')) return Response.json({ revision: 5, profiles: [], drafts: [], observations: [], decisions: [], posts: [] })
    throw new Error(`Unexpected request ${url}`)
  }
  t.after(() => { globalThis.fetch = oldFetch })
  let renderer
  await act(async () => { renderer = TestRenderer.create(route.render()) })
  const button = text => renderer.root.findAllByType('button').find(node => node.children.join('') === label(text) || node.props['aria-label'] === text)
  const click = async label => { const b = button(label); assert.ok(b, `missing button ${label}`); await act(async () => { b.props.onClick(); await tick() }) }
  await click('AppSettings')
  const tokenInput = renderer.root.findAllByType('input').find(i => i.props['aria-label'] === 'Bearer token (stored locally; masked)')
  await act(async () => tokenInput.props.onChange({ target: { value: 'test-token' } }))
  await click('Connect')
  await click('Overview')
  const overview = renderer.toJSON()
  const overviewStr = JSON.stringify(overview)
  assert.match(overviewStr, /New draft/, 'New draft button reachable on mobile')
  assert.match(overviewStr, /Marketing overview/, 'Overview header present on mobile')
  assert.doesNotMatch(overviewStr, /overflow-x: auto|overflow-x: scroll|white-space: nowrap.*width: \d{4}/, 'No forced horizontal overflow patterns')
})

test('Overview shows service revision and draft count from workspace', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const registry = []; const values = new Map()
  loaded.default.register({
    storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k,v) => values.set(k,v) },
    register: item => registry.push(item)
  })
  const route = registry.find(x => x.id === 'page'); assert.ok(route)
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/health')) return Response.json({ status: 'ok' })
    if (String(url).includes('/api/workspace')) return Response.json({ revision: 12, profiles: [], drafts: [{ id: 'd-1', title: 'Draft One', stage: 'draft' }, { id: 'd-2', title: 'Draft Two', stage: 'review' }], observations: [], decisions: [], posts: [] })
    throw new Error(`Unexpected request ${url}`)
  }
  t.after(() => { globalThis.fetch = oldFetch })
  let renderer
  await act(async () => { renderer = TestRenderer.create(route.render()) })
  const button = text => renderer.root.findAllByType('button').find(node => node.children.join('') === label(text) || node.props['aria-label'] === text)
  const click = async label => { const b = button(label); assert.ok(b, `missing button ${label}`); await act(async () => { b.props.onClick(); await tick() }) }
  await click('AppSettings')
  const tokenInput = renderer.root.findAllByType('input').find(i => i.props['aria-label'] === 'Bearer token (stored locally; masked)')
  await act(async () => tokenInput.props.onChange({ target: { value: 'test-token' } }))
  await click('Connect')
  await click('Overview')
  const overviewStr = JSON.stringify(renderer.toJSON())
  assert.match(overviewStr, /Service revision 12/, 'Service revision 12 shown')
  assert.match(overviewStr, /2 saved drafts/, 'Draft count shows 2')
  assert.match(overviewStr, /Draft One/, 'Draft One listed')
  assert.match(overviewStr, /Draft Two/, 'Draft Two listed')
})
