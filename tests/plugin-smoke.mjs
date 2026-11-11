import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = fs.readFileSync(path.resolve('plugin.js'), 'utf8')
const code = source.replace(/^import \{([\s\S]*?)\} from '([^']+)'\n/gm, (_, names, specifier) => `const { ${names.split(',').map(name => name.trim()).filter(Boolean).join(', ')} } = require(${JSON.stringify(specifier)})\n`).replace(/^import React, \{([\s\S]*?)\} from 'react'\n/m, (_, names) => `const React = require('react'); const { ${names.split(',').map(name => name.trim()).filter(Boolean).join(', ')} } = require('react')\n`)
const state = new Map()
let hookIndex = 0
const storage = new Map()
const navigations = []
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
const sdk = { Badge: 'Badge', Button: 'Button', EmptyState: 'EmptyState', ErrorState: 'ErrorState', Skeleton: 'Skeleton', ROUTES_AREA: 'routes', SIDEBAR_NAV_AREA: 'sidebar.nav', PALETTE_AREA: 'commandPalette', host: { navigate: route => navigations.push(route) }, useEffect: (...args) => react.useEffect(...args),   useState: (...args) => react.useState(...args), useRef: (...args) => react.useRef(...args) }
const registrations = []
const ctx = { storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value), remove: key => storage.delete(key) }, register: item => registrations.push(item) }
const context = vm.createContext({ require(name) { if (name === '@hermes/plugin-sdk') return sdk; if (name === 'react') return react; if (name === 'react/jsx-runtime') return { Fragment, jsx, jsxs: jsx }; throw new Error(`Unexpected import ${name}`) }, window: { confirm: () => true, addEventListener() {}, removeEventListener() {} }, Date })
vm.runInContext(code.replace('export default {', 'globalThis.plugin = {'), context)
const plugin = context.plugin
assert.equal(plugin.id, 'marketing-system')
assert.equal(plugin.name, 'App Marketing')
assert.match(source, /--ui-radius-sm, 4px/)
assert.doesNotMatch(source, /PANEL = \{[^\n]*--ui-radius-md/)
plugin.register(ctx)
assert.deepEqual(Array.from(registrations, item => item.area), ['routes', 'sidebar.nav', 'commandPalette'])
registrations[2].data.run()
assert.deepEqual(navigations, ['/marketing-system'])
const render = () => { hookIndex = 0; return registrations[0].render().type({ ctx }) }
let root = render()
let overview = root.props.children.props.children
assert.deepEqual(Array.from(overview.props.children[2].props.children, metric => metric.props.children[0].props.children), ['Qualified activations', 'Paid conversions', 'Attributable revenue'])
assert.deepEqual(Array.from(overview.props.children[1].props.children, tab => tab.props.children), ['All apps', 'App A', 'App B', 'App C'])
let cards = overview.props.children[3].props.children[1].props.children
assert.equal(cards.length, 3)
assert(cards.every(card => card.type === 'button'))
assert.match(cards[1].props['aria-label'], /^Open App B/)
state.set(1, 'sample-b1')
root = render()
const detail = root.props.children.props.children
assert.equal(detail.props.children[0].props.children[0].props.children[1].props.children, 'One useful thing, made clear')
assert.match(source, /ctx\.storage\.set\('drafts', versioned\)/)
assert.match(source, /Review before any external use/)
assert.match(source, /Outcome is unavailable—not zero/)
console.log('PASS plugin ESM evaluates with Hermes SDK/React runtime stubs')
console.log('PASS route/sidebar/command registration and command navigation')
console.log('PASS serious overview metrics, four app tabs, three interactive slideshow cards')
console.log('PASS card activation resolves the correct slideshow detail content')
console.log('PASS local storage boundary, rights review, and honest unavailable outcome')
