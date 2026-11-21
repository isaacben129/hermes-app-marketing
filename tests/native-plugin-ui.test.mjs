import test from 'node:test'
import assert from 'node:assert/strict'
import TestRenderer, { act } from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
  const click = async text => { const button = renderer.root.findAllByType('button').find(x => x.children.join('') === text); assert.ok(button, text); assert.notEqual(button.props.disabled, true); await act(async () => button.props.onClick()) }
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
