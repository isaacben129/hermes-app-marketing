import test from 'node:test'
import assert from 'node:assert/strict'
import TestRenderer, { act } from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

test('native connection recovers durable Cherry runs after a fresh plugin mount', async t => {
  const saved = { runId: 'persisted-run', app: 'Cherry', status: 'running', stage: 'review', completedCount: 2 }
  const calls = []
  const ctx = {
    register: x => contributions.push(x), storage: { get: (_key, fallback) => fallback, set() {} },
    rest: async (path, opts = {}) => {
      calls.push({ path, opts })
      if (path === '/health') return { version: 1 }
      if (path.startsWith('/workspace?')) return { revision: 1, drafts: [], profiles: [] }
      if (path === '/agent-runs') return { runtime: { status: 'ready' }, runs: [saved] }
      if (path === '/agent-runs/persisted-run') return { ...saved }
      throw new Error(`unexpected ${path}`)
    }
  }
  const contributions = []
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  loaded.default.register(ctx)
  let renderer
  await act(async () => { renderer = TestRenderer.create(contributions.find(x => x.id === 'page').render()); await new Promise(r => setTimeout(r, 20)) })
  t.after(() => act(() => renderer.unmount()))
  const text = () => JSON.stringify(renderer.toJSON())
  assert.ok(calls.some(call => call.path === '/agent-runs'), 'connect did not restore durable runs')
  assert.match(text(), /persisted-run.*running.*2 completed/s)
  assert.equal(calls.some(call => call.path === '/agent-runs' && call.opts.method === 'POST'), false)
})

test('native connection restores terminal run details without polling and keeps workspace connected on list failure', async t => {
  for (const status of ['succeeded', 'failed']) {
    const contributions = []; const calls = []
    const ctx = { register: x => contributions.push(x), storage: { get: (_key, fallback) => fallback, set() {} }, rest: async path => {
      calls.push(path)
      if (path === '/health') return { version: 1 }
      if (path.startsWith('/workspace?')) return { revision: 1, drafts: [], profiles: [] }
      if (path === '/agent-runs') return { runtime: {}, runs: [{ runId: `${status}-run`, status }] }
      if (path === `/agent-runs/${status}-run`) return { runId: `${status}-run`, status, completedCount: 5 }
      throw new Error(`unexpected ${path}`)
    } }
    const loaded = await loadPlugin(); t.after(loaded.cleanup); loaded.default.register(ctx)
    let renderer
    await act(async () => { renderer = TestRenderer.create(contributions.find(x => x.id === 'page').render()); await new Promise(r => setTimeout(r, 10)) })
    t.after(() => act(() => renderer.unmount()))
    assert.match(JSON.stringify(renderer.toJSON()), new RegExp(`${status}-run.*${status}.*5 completed`, 's'))
    assert.equal(calls.filter(path => path === `/agent-runs/${status}-run`).length, 1)
  }
  const contributions = []
  const ctx = { register: x => contributions.push(x), storage: { get: (_key, fallback) => fallback, set() {} }, rest: async path => {
    if (path === '/health') return { version: 1 }
    if (path.startsWith('/workspace?')) return { revision: 1, drafts: [], profiles: [] }
    if (path === '/agent-runs') throw new Error('endpoint unavailable')
    throw new Error(`unexpected ${path}`)
  } }
  const loaded = await loadPlugin(); t.after(loaded.cleanup); loaded.default.register(ctx)
  let renderer
  await act(async () => { renderer = TestRenderer.create(contributions.find(x => x.id === 'page').render()); await new Promise(r => setTimeout(r, 10)) })
  t.after(() => act(() => renderer.unmount()))
  assert.match(JSON.stringify(renderer.toJSON()), /Connected to the marketing service.*Saved agent runs are unavailable/s)
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /role":"alert"/)
})

test('a recovered running agent refreshes the workspace when it completes', async t => {
  const contributions = []; const detailCalls = []; let workspaceReads = 0
  const ctx = { register: x => contributions.push(x), storage: { get: (_key, fallback) => fallback, set() {} }, rest: async path => {
    if (path === '/health') return { version: 1 }
    if (path.startsWith('/workspace?')) { workspaceReads++; return { revision: workspaceReads, drafts: [], profiles: [] } }
    if (path === '/agent-runs') return { runtime: {}, runs: [{ runId: 'recovering', status: 'running' }] }
    if (path === '/agent-runs/recovering') { detailCalls.push(path); return { runId: 'recovering', status: detailCalls.length > 1 ? 'succeeded' : 'running', completedCount: 5 } }
    throw new Error(`unexpected ${path}`)
  } }
  const loaded = await loadPlugin(); t.after(loaded.cleanup); loaded.default.register(ctx)
  let renderer
  await act(async () => { renderer = TestRenderer.create(contributions.find(x => x.id === 'page').render()); await new Promise(r => setTimeout(r, 20)) })
  t.after(() => act(() => renderer.unmount()))
  await act(async () => { await new Promise(r => setTimeout(r, 2150)) })
  assert.ok(detailCalls.length >= 2, 'recovered running run was not polled')
  assert.ok(workspaceReads >= 2, 'workspace was not refreshed after successful completion')
  assert.match(JSON.stringify(renderer.toJSON()), /recovering.*succeeded/s)
})
