import test from 'node:test'
import assert from 'node:assert/strict'
import TestRenderer, { act } from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/q2sAAAAASUVORK5CYII='

test('native image picker uses scoped folder API, lets user choose a file, and saves/reopens it', async t => {
  const loaded = await loadPlugin(); t.after(loaded.cleanup)
  const contributions = []; let saved; let revision = 1
  const calls = []; let mode = 'normal'
  const ctx = {
    register: item => contributions.push(item), storage: { get: (_key, fallback) => fallback, set() {} },
    files: {
      requestFolder: async () => mode === 'denied' ? { ok: false, cancelled: true } : ({ ok: true, folder: { id: 'grant-7', name: 'Images', path: 'opaque host path' } }),
      list: async (folderId, relativePath) => { calls.push(['list', folderId, relativePath]); return { ok: true, entries: mode === 'empty' ? [{ name: 'folder.png', path: 'folder.png', isDirectory: true }] : [{ name: 'notes.txt', path: 'notes.txt', isDirectory: false }, { name: 'first.png', path: 'first.png', isDirectory: false }, { name: 'chosen.webp', path: 'sub/chosen.webp', isDirectory: false }], truncated: false } },
      readDataUrl: async (folderId, path) => { calls.push(['read', folderId, path]); return mode === 'revoked' ? { ok: false } : { ok: true, url: png } }
    },
    rest: async (path, opts = {}) => {
      if (path === '/health') return { ok: true }
      if (path === '/workspace?app=Cherry') return { revision, profiles: [], drafts: saved ? [saved] : [] }
      if (path.startsWith('/drafts/')) { saved = opts.body.draft; revision++; return { revision } }
      throw new Error(`Unexpected request ${path}`)
    }
  }
  loaded.default.register(ctx)
  let renderer
  await act(async () => { renderer = TestRenderer.create(contributions.find(x => x.id === 'page').render()); await tick() })
  const button = label => renderer.root.findAllByType('button').find(node => node.children.join('') === label)
  const click = async label => act(async () => { assert.ok(button(label), `missing ${label}`); await button(label).props.onClick(); await tick() })
  await click('New draft'); await click('Add slide'); await click('Choose native image for slide 1')
  assert.ok(button('sub/chosen.webp'), 'image candidates must be offered for explicit choice')
  await click('sub/chosen.webp')
  assert.deepEqual(calls, [['list', 'grant-7', ''] , ['read', 'grant-7', 'sub/chosen.webp']])
  await click('Save to service')
  assert.equal(saved.slides[0].selectedImage.path, 'sub/chosen.webp')
  await click('Overview')
  const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('')
  const draftButton = renderer.root.findAllByType('button').find(node => textOf(node).includes(saved.title))
  assert.ok(draftButton)
  await act(async () => { draftButton.props.onClick(); await tick() })
  assert.equal(renderer.root.findAllByType('img').some(img => img.props.src === png), true)
  mode = 'empty'; await click('Choose native image for slide 1')
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /No PNG/i)
  assert.equal(renderer.root.findAllByType('img').some(img => img.props.src === png), true)
  mode = 'revoked'; await click('Choose native image for slide 1'); await click('sub/chosen.webp')
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /revoked/i)
  assert.equal(renderer.root.findAllByType('img').some(img => img.props.src === png), true)
  mode = 'normal'; await click('Choose native image for slide 1'); await click('Cancel image selection')
  assert.equal(renderer.root.findAllByType('img').some(img => img.props.src === png), true)
  mode = 'denied'; await click('Choose native image for slide 1')
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /not granted/i)
  assert.equal(renderer.root.findAllByType('img').some(img => img.props.src === png), true)
})
