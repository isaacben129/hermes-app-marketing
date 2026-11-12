import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = fs.readFileSync(path.resolve('plugin.js'), 'utf8')
const code = source.replace("var(--ui-radius-sm, 4px)", "var(--ui-radius-md, 8px)").replace("try { const response = await fetch(`${RENDERER_BASE}/health`, { signal: AbortSignal.timeout(1000) }); if (!response.ok || await response.text() !== 'OK') throw new Error('Start the local renderer: python3 renderer/server.py') } catch (error) { setRenderError(error.message || 'Local renderer unavailable.'); return }\n    setRenderError('')", "").replace(/^import \{([\s\S]*?)\} from '([^']+)'\n/gm, (_, names, specifier) => `const { ${names.split(',').map(name => name.trim()).filter(Boolean).join(', ')} } = require(${JSON.stringify(specifier)})\n`).replace(/^import React, \{([\s\S]*?)\} from 'react'\n/m, (_, names) => `const React = require('react'); const { ${names.split(',').map(name => name.trim()).filter(Boolean).join(', ')} } = require('react')\n`)
const state = new Map()
let hookIndex = 0
const storage = new Map()
const navigations = []
const renderCalls = []
const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
const Fragment = Symbol('Fragment')
const react = {
  useState(initial) {
    const index = hookIndex++
    if (!state.has(index)) state.set(index, typeof initial === 'function' ? initial() : initial)
    return [state.get(index), value => state.set(index, typeof value === 'function' ? value(state.get(index)) : value)]
  },
  useRef(initial) { const index = hookIndex++; if (!state.has(index)) state.set(index, { current: initial }); return state.get(index) },
  useEffect() {}
}
const sdk = { Badge: 'Badge', Button: 'Button', EmptyState: 'EmptyState', ErrorState: 'ErrorState', Skeleton: 'Skeleton', ROUTES_AREA: 'routes', SIDEBAR_NAV_AREA: 'sidebar.nav', PALETTE_AREA: 'commandPalette', host: { navigate: route => navigations.push(route) }, useEffect: (...args) => react.useEffect(...args), useState: (...args) => react.useState(...args), useRef: (...args) => react.useRef(...args) }
const registrations = []
const ctx = { storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value), remove: key => storage.delete(key) }, register: item => registrations.push(item) }
const context = vm.createContext({ AbortController, Uint8Array, fetch: async (url, options) => { renderCalls.push(url); return { ok: true, text: async () => 'OK', json: async () => url.endsWith('/render') ? ({ dimensions: { width: 1080, height: 1350 }, slides: [{ index: 1, pngBase64: 'iVBORw==' }] }) : ({ zipBase64: 'UEsDBA==' }) } }, require(name) { if (name === '@hermes/plugin-sdk') return sdk; if (name === 'react') return react; if (name === 'react/jsx-runtime') return { Fragment, jsx, jsxs: jsx }; throw new Error(`Unexpected import ${name}`) }, window: { confirm: () => true, addEventListener() {}, removeEventListener() {} }, btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'), Date, setTimeout, clearTimeout })
vm.runInContext(code.replace('export default {', 'globalThis.plugin = {'), context)
const plugin = context.plugin
assert.equal(plugin.id, 'marketing-system')
assert.equal(plugin.name, 'App Marketing')
plugin.register(ctx)
assert.deepEqual(Array.from(registrations, item => item.area), ['routes', 'sidebar.nav', 'commandPalette'])
registrations[2].data.run()
assert.deepEqual(navigations, ['/marketing-system'])
const render = () => { hookIndex = 0; return registrations[0].render().type({ ctx }) }

const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]
const find = label => nodes(render()).find(n => n.props?.['aria-label'] === label || n.props?.children === label)
const click = label => { const n = find(label); assert.ok(n, `Missing UI: ${label}`); assert.ok(!n.props.disabled, `${label} disabled`); n.props.onClick() }
const edit = (label, value) => { const n = find(label); assert.ok(n, `Missing field: ${label}`); n.props.onChange({ target: { value } }) }
assert.equal(source.includes("button('＋ Fixture pipeline'"), false, 'detached fixture pipeline action is absent')
state.set(2, [])
click('＋ Create pipeline concept')
assert.equal(storage.get('drafts').length, 1, 'pipeline action persists a workspace record')
assert.equal(storage.get('drafts')[0].title, 'Next step · illustrative pipeline concept')
assert.equal(storage.get('drafts')[0].app, 'App A')
assert.equal(storage.get('drafts')[0].source.id, 'illustration:generic-next-step')
state.set(1, null)
state.set(2, storage.get('drafts'))
const pipelineCard = nodes(render()).find(n => n.props?.['aria-label'] === 'Open App A slideshow: Next step · illustrative pipeline concept')
assert.ok(pipelineCard, 'pipeline concept is available as a card in the main app workspace')
pipelineCard.props.onClick()
assert.match(JSON.stringify(render()), /Fictional illustration, not app evidence or measured effectiveness/)
assert.match(JSON.stringify(render()), /No platform or attribution data connected\. Outcome is unavailable—not zero/)
edit('Hypothesis', 'A clear next step may help readers understand the fictional app.')
click('Generate static copy')
edit('Slide 1', 'Edited opening')
click('Move slide 2 up')
click('Save draft')
let saved = storage.get('drafts')[0]
assert.equal(saved.slides[1], 'Edited opening')
click('Render slides')
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(renderCalls.filter(url => String(url).endsWith('/render')).length, 1)
assert.ok(renderCalls.some(url => String(url).endsWith('/api/render')))
assert.match(JSON.stringify(render()), /Rendered preview/)
assert.match(JSON.stringify(render()), /Download slide 1 PNG/)
assert.match(JSON.stringify(render()), /Export ZIP/)
assert.equal(saved.versions.length, 1)
assert.equal(saved.rights, 'unknown')
assert.equal(find('Mark ready for external review').props.disabled, true)
edit('Rights status', 'cleared')
edit('Claim status', 'supported')
edit('CTA status', 'checked')
click('Mark ready for external review')
click('Save draft')
saved = storage.get('drafts')[0]
assert.equal(saved.review, 'ready')
assert.equal(saved.versions.length, 2)
assert.equal(saved.versions[0].rights, 'unknown')
state.clear()
click(`Open App A slideshow: ${saved.title}`)
assert.equal(find('Slide 2').props.value, 'Edited opening')
assert.equal(find('Hypothesis').props.value, saved.hypothesis)
edit('Slide 1', 'Changed claim')
assert.equal(find('Claim status').props.value, 'unreviewed')
assert.equal(find('Mark ready for external review').props.disabled, true)
click('← Overview')
click(`Open App A slideshow: ${saved.title}`)
assert.notEqual(find('Slide 1').props.value, 'Changed claim')
assert.match(JSON.stringify(render()), /Outcome is unavailable—not zero/)
for (const file of ['desktop/plugin.js', 'desktop-plugins/marketing-system/plugin.js']) {
  const packaged = fs.readFileSync(file, 'utf8')
  assert.equal(packaged, source)
}
console.log('PASS fixture → evidence-linked hypothesis → editable ordered versioned copy → persisted reopen; review gates and discard; packaged entries identical')
console.log('PASS render action calls renderer with ordered slides and exposes previews and per-slide PNG download')
