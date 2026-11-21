import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import TestRenderer, { act } from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

test('registered native UI saves and reopens through real Python HTTP router and Node ledger', { timeout: 30000 }, async t => {
  const scratch = path.resolve('.artifacts/evidence/native-backend')
  await mkdir(scratch, { recursive: true })
  const home = await mkdtemp(path.join(scratch, 'home-'))
  const child = spawn(process.env.HERMES_TEST_PYTHON || 'python3', ['tests/helpers/backend-host.py'], { env: { ...process.env, HERMES_HOME: home, HERMES_MARKETING_DATA_DIR: path.join(home, 'private-data') }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''; child.stderr.on('data', x => { stderr += x })
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit') }; await rm(home, { recursive: true, force: true }) })
  const base = await new Promise((resolve, reject) => { let text = ''; child.stdout.on('data', x => { text += x; if (text.includes('\n')) resolve(text.trim().split('\n')[0]) }); child.once('exit', () => reject(new Error('backend host failed: ' + stderr))); child.once('error', reject) })
  let ready = false
  for (let i = 0; i < 100; i++) { try { const response = await fetch(base + '/api/plugins/marketing-system/workspace?app=Cherry'); if (response.ok) { ready = true; break } } catch {}; await new Promise(r => setTimeout(r, 20)) }
  assert.ok(ready, stderr)
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const contributions = []
  loaded.default.register({ register: x => contributions.push(x), storage: { get: (_k, d) => d, set() { throw new Error('native transport cannot store credentials') } }, rest: async (route, opts = {}) => {
    const response = await fetch(base + '/api/plugins/marketing-system' + route, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}) })
    const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || response.statusText); return data
  } })
  const route = contributions.find(x => x.id === 'page')
  let renderer
  const mount = async () => { await act(async () => { renderer = TestRenderer.create(route.render()) }); for (let i = 0; i < 100; i++) { if (JSON.stringify(renderer.toJSON()).includes('Connected to the marketing service')) return; await act(async () => new Promise(r => setTimeout(r, 20))) }; assert.fail('native UI did not connect') }
  await mount()
  t.after(() => act(() => renderer.unmount()))
  const click = async label => { const node = renderer.root.findAllByType('button').find(x => x.children.join('') === label); assert.ok(node, label); assert.notEqual(node.props.disabled, true); await act(async () => node.props.onClick()) }
  await click('New draft')
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Title' }).props.onChange({ target: { value: 'Real native-backend tracer bullet' } }))
  await click('Save to service')
  assert.match(JSON.stringify(renderer.toJSON()), /Saved and verified at service revision/)
  await act(() => renderer.unmount())
  await mount()
  const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join(' ')
  const draft = renderer.root.findAllByType('button').find(x => text(x).includes('Real native-backend tracer bullet'))
  assert.ok(draft, 'saved record missing after full UI remount')
  await act(async () => draft.props.onClick())
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Title' }).props.value, 'Real native-backend tracer bullet')
})
