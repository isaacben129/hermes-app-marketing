import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = fs.readFileSync(path.resolve('desktop-plugins/marketing-system/plugin.js'), 'utf8')
const code = source.replace(/^import \{([\s\S]*?)\} from '([^']+)'\n/gm, (_, names, specifier) => `const { ${names.split(',').map(name => name.trim()).filter(Boolean).join(', ')} } = require(${JSON.stringify(specifier)})\n`).replace(/^import React, \{([\s\S]*?)\} from 'react'\n/m, (_, names) => `const React = require('react'); const { ${names.split(',').map(name => name.trim()).filter(Boolean).join(', ')} } = require('react')\n`)
const state = new Map()
let hookIndex = 0
const storage = new Map()
const navigations = []
const calls = []
const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
const Fragment = Symbol('Fragment')
const react = {
  useState(initial) { const index = hookIndex++; if (!state.has(index)) state.set(index, typeof initial === 'function' ? initial() : initial); return [state.get(index), value => state.set(index, typeof value === 'function' ? value(state.get(index)) : value)] },
  useRef(initial) { const index = hookIndex++; if (!state.has(index)) state.set(index, { current: initial }); return state.get(index) },
  useEffect() {}
}
const sdk = { Badge: 'Badge', Button: 'Button', EmptyState: 'EmptyState', ROUTES_AREA: 'routes', SIDEBAR_NAV_AREA: 'sidebar.nav', PALETTE_AREA: 'commandPalette', host: { navigate: route => navigations.push(route) } }
const registrations = []
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rZkAAAAASUVORK5CYII='
const imageHash = 'a'.repeat(64)
const ctx = {
  storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
  register: item => registrations.push(item),
  files: {
    folders: async () => [], requestFolder: async () => ({ ok: true, folder: { id: 'granted-folder' } }),
    list: async () => ({ ok: true, entries: [{ name: 'synthetic.png', path: 'synthetic.png', isDirectory: false }] }),
    readDataUrl: async () => ({ ok: true, url: `data:image/png;base64,${pixel}` })
  }
}
const context = vm.createContext({
  AbortController, Uint8Array, crypto: { subtle: { digest: async () => Uint8Array.from(imageHash.match(/../g).map(byte => parseInt(byte, 16))).buffer } },
  fetch: async (url, options) => {
    calls.push({ method: 'fetch', url, options })
    if (url.endsWith('/api/health')) return { ok: true }
    return { ok: true, json: async () => ({ dimensions: { width: 1080, height: 1920 }, slides: [{ index: 1, width: 1080, height: 1920, pngBase64: pixel, source_ref: 'user-folder://granted-folder/synthetic.png', image_sha256: imageHash }] }) }
  },
  require(name) { if (name === '@hermes/plugin-sdk') return sdk; if (name === 'react') return react; if (name === 'react/jsx-runtime') return { Fragment, jsx, jsxs: jsx }; throw new Error(`Unexpected import ${name}`) },
  window: { confirm: () => true, prompt: () => '1', addEventListener() {}, removeEventListener() {} },
  btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'), Date, setTimeout, clearTimeout, Blob, URL, document: { createElement: () => ({ click() {} }) }
})
vm.runInContext(code.replace('export default {', 'globalThis.plugin = {'), context)
const plugin = context.plugin
assert.equal(plugin.id, 'marketing-system')
assert.equal(plugin.name, 'App Marketing')
plugin.register(ctx)
assert.deepEqual(Array.from(registrations, item => item.area), ['routes', 'sidebar.nav', 'commandPalette'])
registrations[2].data.run()
assert.deepEqual(navigations, ['/marketing-system'])
const render = () => { hookIndex = 0; const element = registrations[0].render(); return element.type(element.props) }
const find = (node, predicate, acc = [], seen = new Set()) => {
  if (Array.isArray(node)) { node.forEach(item => find(item, predicate, acc, seen)); return acc }
  if (!node || typeof node !== 'object' || seen.has(node)) return acc
  seen.add(node)
  if (predicate(node)) acc.push(node)
  for (const value of Object.values(node.props || {})) Array.isArray(value) ? value.forEach(item => find(item, predicate, acc, seen)) : find(value, predicate, acc, seen)
  return acc
}
let root = render()
const tabs = find(root, node => node.type === 'div' && node.props.role === 'tablist')[0]
assert.deepEqual(Array.from(tabs.props.children, tab => tab.props.children), ['All apps', 'Cherry'])
const createButton = find(root, node => node.type === 'Button' && node.props.children === '＋ Create pipeline concept')[0]
assert(createButton)
createButton.props.onClick()
root = render()
const addSlide = find(root, node => node.type === 'Button' && node.props.children === '＋ Add slide')[0]
assert(addSlide)
addSlide.props.onClick()
root = render()
let headline = find(root, node => node.type === 'input' && node.props['aria-label'] === 'Slide 1 headline')[0]
let body = find(root, node => node.type === 'textarea' && node.props['aria-label'] === 'Slide 1 body')[0]
assert(headline && body)
headline.props.onChange({ target: { value: 'Synthetic headline' } })
body.props.onChange({ target: { value: 'A tiny synthetic render test.' } })
root = render()
const choose = find(root, node => node.type === 'Button' && node.props.children === 'Choose image')[0]
await choose.props.onClick()
root = render()
const renderButton = find(root, node => node.type === 'Button' && node.props.children === 'Render slideshow')[0]
assert(renderButton)
await renderButton.props.onClick()
root = render()
assert.equal(find(root, node => node.props?.role === 'alert' && String(node.props.children).includes('Add both a headline and body')).length, 1)
assert.equal(calls.filter(call => call.url.endsWith('/render')).length, 0)
console.log('PASS plugin route, draft and slide editor; incomplete copy prevents render')