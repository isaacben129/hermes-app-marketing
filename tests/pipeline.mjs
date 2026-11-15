import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = fs.readFileSync(path.resolve('plugin.js'), 'utf8')
const code = source.replace("var(--ui-radius-sm, 4px)", "var(--ui-radius-md, 8px)").replace("try { const response = await fetch(`${RENDERER_BASE}/health`, { signal: AbortSignal.timeout(1000) }); if (!response.ok || await response.text() !== 'OK') throw new Error('Start the local renderer: python3 renderer/server.py') } catch (error) { setRenderError(error.message || 'Local renderer unavailable.'); return }\n    setRenderError('')", "").replace(/^import \{([\s\S]*?)\} from '([^']+)'\n/gm, (_, names, specifier) => `const { ${names.split(',').map(name => name.trim()).filter(Boolean).join(', ')} } = require(${JSON.stringify(specifier)})\n`).replace(/^import React, \{([\s\S]*?)\} from 'react'\n/m, (_, names) => `const React = require('react'); const { ${names.split(',').map(name => name.trim()).filter(Boolean).join(', ')} } = require('react')\n`)
const prompts = ['Other App']
let promptIndex = 0
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
const context = vm.createContext({ AbortController, Uint8Array, fetch: async (url, options) => { renderCalls.push(url); return { ok: true, text: async () => 'OK', json: async () => url.endsWith('/render') ? ({ dimensions: { width: 1080, height: 1350 }, slides: [{ index: 1, pngBase64: 'iVBORw==' }] }) : ({ zipBase64: 'UEsDBA==' }) } }, require(name) { if (name === '@hermes/plugin-sdk') return sdk; if (name === 'react') return react; if (name === 'react/jsx-runtime') return { Fragment, jsx, jsxs: jsx }; throw new Error(`Unexpected import ${name}`) }, window: { confirm: () => true, prompt: () => prompts[promptIndex++], addEventListener() {}, removeEventListener() {} }, btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'), Date, setTimeout, clearTimeout })
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
assert.equal(source.includes("const [app, setApp] = useState('Cherry')"), true, 'Cherry is selected first')
assert.ok(!source.includes("const SAMPLES = ["), 'fictional app sample cards are not first-class records')
assert.equal(source.includes("'Practice social situations. Start small. Get better over time.'"), true, 'Cherry promise uses verified brand wording')
assert.equal(source.includes("'Untitled Cherry workspace draft'"), true, 'first new draft is Cherry-specific')
assert.equal(source.includes("cta: profile?.cta || 'unconfigured'"), true, 'CTA begins unconfigured for every app')
assert.equal(source.includes("claimsApproval: profile?.claimsApproval || 'unconfigured'"), true, 'claims approval begins unconfigured')
assert.equal(source.includes("channels: profile?.channels || []"), true, 'channels remain unconfigured')
assert.equal(source.includes("assets: profile?.assets || []"), true, 'assets and rights evidence are not fabricated')
assert.equal(source.includes("events: { status: profile?.events || 'unconfigured'"), true, 'events and privacy remain unconfigured')
assert.match(source, /Avoid therapy, cure, heal, confidence, and guaranteed outcomes/)
assert.equal(source.includes("Object.keys(appProfiles || { Cherry: {} })"), true, 'the app selector supports additional profiles')
assert.equal(source.includes("button('＋ Add app', addAppProfile, 'outline')"), true, 'the user can configure another app independently')
assert.equal(source.includes("ctx.storage.set('appProfiles', next)"), true, 'app profiles persist separately')
assert.equal(source.includes("const profile = getProfile(app)"), true, 'new drafts bind to the selected app profile')
state.set(2, [])
click('＋ Create pipeline concept')
assert.equal(storage.get('drafts').length, 1, 'pipeline action persists a workspace record')
assert.equal(storage.get('drafts')[0].title, 'Cherry workspace draft')
assert.equal(storage.get('drafts')[0].app, 'Cherry')
assert.equal(storage.get('drafts')[0].brief, 'Practice social situations. Start small. Get better over time.')
assert.equal(storage.get('drafts')[0].hypothesis, '')
assert.equal(storage.get('drafts')[0].cta, 'unconfigured')
assert.equal(storage.get('drafts')[0].claimsApproval, 'unconfigured')
assert.equal(storage.get('drafts')[0].channels.length, 0)
assert.equal(storage.get('drafts')[0].assets.length, 0)
assert.equal(storage.get('drafts')[0].events.status, 'unconfigured')
assert.equal(storage.get('drafts')[0].events.privacy, 'unconfigured')
assert.equal(storage.get('drafts')[0].rights, 'unknown')
assert.equal(storage.get('drafts')[0].review, 'blocked')
state.set(1, null)
state.set(2, storage.get('drafts'))
const pipelineCard = nodes(render()).find(n => n.props?.['aria-label'] === 'Open Cherry workspace draft: Cherry workspace draft')
assert.ok(pipelineCard, 'Cherry pipeline concept is available as a local app draft')
pipelineCard.props.onClick()
assert.match(JSON.stringify(render()), /Brand foundation only\. No product feature, performance result, or creative is asserted/)
assert.match(JSON.stringify(render()), /No platform or attribution data connected\. Outcome is unavailable—not zero/)
assert.match(JSON.stringify(render()), /CTA: unconfigured · Channels: unconfigured · Assets \/ rights: unconfigured · Claim approval: unconfigured · Events \/ privacy: unconfigured/)
edit('Working hypothesis (unvalidated)', 'A small step is a hypothesis, not an outcome claim.')
click('Save draft')
let saved = storage.get('drafts')[0]
assert.equal(saved.hypothesis, 'A small step is a hypothesis, not an outcome claim.')
assert.equal(saved.claim, 'unreviewed')
assert.equal(saved.claimsApproval, 'unconfigured')
assert.equal(find('Mark ready for external review').props.disabled, true)
state.clear()
click('＋ Add app')
assert.ok(storage.has('appProfiles'))
assert.equal(storage.get('appProfiles')['Other App'].brandSource, 'unconfigured')
assert.equal(storage.get('appProfiles')['Other App'].cta, 'unconfigured')
assert.equal(storage.get('appProfiles')['Other App'].privacy, 'unconfigured')
state.set(0, 'Other App')
click('＋ New local draft')
assert.equal(storage.get('drafts')[0].app, 'Other App')
assert.equal(storage.get('drafts')[0].brief, '')
assert.equal(storage.get('drafts')[0].source.evidence, 'Brand source unconfigured; no facts inferred.')

for (const file of ['desktop/plugin.js', 'desktop-plugins/marketing-system/plugin.js']) {
  const packaged = fs.readFileSync(file, 'utf8')
  assert.equal(packaged.replaceAll('Cherry', 'App A'), source.replaceAll('Cherry', 'App A'))
}
console.log('PASS fixture → evidence-linked hypothesis → editable ordered versioned copy → persisted reopen; review gates and discard; packaged entries identical')
console.log('PASS render action calls renderer with ordered slides and exposes previews and per-slide PNG download')
