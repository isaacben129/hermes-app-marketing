import test from 'node:test'
import assert from 'node:assert/strict'
import TestRenderer, { act } from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

test('registered native page exposes the saved Creatives gallery navigation', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const contributions = []
  loaded.default.register({ register: x => contributions.push(x), storage: { get: (_k, f) => f, set() {} }, rest: async () => ({ version: 1, drafts: [], profiles: [] }) })
  let renderer
  await act(async () => { renderer = TestRenderer.create(contributions.find(x => x.id === 'page').render()) })
  t.after(() => act(() => renderer.unmount()))
  const content = JSON.stringify(renderer.toJSON())
  assert.match(content, /Creatives/)
})

test('native Desktop connects through ctx.rest automatically without URL or token storage', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const contributions = []; const calls = []
  let saved = null; let revision = 0
  const ctx = {
    register: x => contributions.push(x),
    storage: { get: (_key, fallback) => fallback, set() { throw new Error('native transport must not store credentials') } },
    rest: async (path, opts = {}) => {
      calls.push({ path, opts })
      if (path === '/health') return { version: 1, services: [] }
      if (path.startsWith('/workspace?app=Cherry')) return { revision, drafts: saved ? [saved] : [], profiles: [] }
      if (path.startsWith('/drafts/')) { assert.equal(opts.method, 'PUT'); assert.equal(typeof opts.body, 'object'); assert.equal(opts.body.expectedRevision, revision); saved = opts.body.draft; revision++; return { revision } }
      throw new Error('unexpected native route ' + path)
    }
  }
  loaded.default.register(ctx)
  let renderer
  await act(async () => { renderer = TestRenderer.create(contributions.find(x => x.id === 'page').render()); await new Promise(r => setTimeout(r, 10)) })
  t.after(() => act(() => renderer.unmount()))
  assert.ok(calls.some(x => x.path === '/workspace?app=Cherry'), 'page did not auto-connect through Hermes')
  const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('')
  const click = async text => { const button = renderer.root.findAllByType('button').find(x => textOf(x) === text || textOf(x).includes(text)); assert.ok(button, text); assert.notEqual(button.props.disabled, true); await act(async () => button.props.onClick()) }
  await click('New draft')
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Title' }).props.onChange({ target: { value: 'Hermes native connection proof' } }))
  await click('Save to service')
  assert.equal(saved.title, 'Hermes native connection proof')
  await click('Overview')
  assert.match(JSON.stringify(renderer.toJSON()), /Hermes native connection proof/)
  await click('App settings')
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Bearer token (stored locally; masked)' }).length, 0)
  assert.match(JSON.stringify(renderer.toJSON()), /Hermes backend/)
})

test('quality editor exposes exact rubric inputs and manual Cherry agent run uses backend contract', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const contributions = []; const calls = []; let revision = 3
  let draft = { id: 'saved-1', app: 'Cherry', title: 'Saved Cherry concept', slides: [], qualityReviews: [] }
  const ctx = { register: x => contributions.push(x), storage: { get: (_key, fallback) => fallback, set() {} }, rest: async (path, opts = {}) => {
    calls.push({ path, opts })
    if (path === '/health') return { version: 1 }
    if (path.startsWith('/workspace?app=Cherry')) return { revision, drafts: [draft], profiles: [] }
    if (path.startsWith('/drafts/')) { assert.equal(opts.body.expectedRevision, revision); draft = opts.body.draft; revision++; return { revision } }
    if (path === '/agent-runs' && opts.method === 'POST') return { runId: 'run-1', status: 'running' }
    if (path === '/agent-runs') return { runtime: {}, runs: [] }
    if (path === '/agent-runs/run-1') return { runId: 'run-1', status: 'succeeded', completedCount: 5, draftIds: ['new-1'] }
    throw new Error(`unexpected ${path}`)
  } }
  loaded.default.register(ctx)
  let renderer; await act(async () => { renderer = TestRenderer.create(contributions.find(x => x.id === 'page').render()); await new Promise(r => setTimeout(r, 0)) })
  const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('')
  const click = async text => { const button = renderer.root.findAllByType('button').find(x => textOf(x) === text || textOf(x).includes(text)); assert.ok(button, text); await act(async () => { button.props.onClick(); await new Promise(r => setTimeout(r, 0)) }) }
  await click('Saved Cherry concept')
  const labels = renderer.root.findAllByType('input').map(input => input.props['aria-label'])
  for (const dimension of ['audience fit', 'hook clarity', 'claim specificity/proof', 'slide progression/payoff', 'mobile legibility/visual coherence', 'promise-to-destination match', 'safety/rights/brand']) assert.ok(labels.some(label => label?.startsWith(`${dimension} score`)), `missing ${dimension}`)
  assert.ok(labels.includes('audience fit reviewer name'))
  const dimensions = ['audience fit', 'hook clarity', 'claim specificity/proof', 'slide progression/payoff', 'mobile legibility/visual coherence', 'promise-to-destination match', 'safety/rights/brand']
  for (const dimension of dimensions) {
    for (const [suffix, value] of [['score (0–5; blank = unassessed)', '4'], ['reviewer name', 'operator'], ['rationale', 'Reviewed against the supplied evidence.'], ['evidence refs (comma separated)', 'evidence-1']]) {
      const input = renderer.root.findByProps({ 'aria-label': `${dimension} ${suffix}` })
      await act(async () => input.props.onChange({ target: { value } }))
    }
  }
  await click('Save to service')
  assert.deepEqual(draft.qualityReviews.map(review => review.dimension), dimensions)
  for (const review of draft.qualityReviews) { assert.deepEqual(Object.keys(review).sort(), ['dimension', 'evidenceRefs', 'rationale', 'reviewedAt', 'reviewer', 'revision', 'score']); assert.deepEqual(review.reviewer, { type: 'human', name: 'operator' }); assert.deepEqual(review.evidenceRefs, ['evidence-1']); assert.equal(review.score, 4); assert.equal(review.revision, 3) }
  await click('Overview'); await click('Generate and critique 5 Cherry slideshows')
  const post = calls.find(call => call.path === '/agent-runs' && call.opts.method === 'POST')
  assert.deepEqual(post.opts.body, { app: 'Cherry', count: 5 })
  assert.ok(calls.some(call => call.path === '/agent-runs/run-1'))
  assert.match(JSON.stringify(renderer.toJSON()), /unapproved|succeeded/i)
})
