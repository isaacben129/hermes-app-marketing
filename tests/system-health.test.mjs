import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { determineSystemHealth, formatMetric } = require('../src/ops/health.js')
const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length < 2 ? children[0] : children } }) }
const source = await (await import('node:fs/promises')).readFile(new URL('../src/ui/SystemHealth.js', import.meta.url), 'utf8')
const componentSource = source.split('\n').filter(line => !line.startsWith('import ')).join('\n').replace('export default function SystemHealth', 'function SystemHealth')
const SystemHealth = new Function('React', 'determineSystemHealth', 'formatMetric', `${componentSource}; return SystemHealth`)(React, determineSystemHealth, formatMetric)

function flatten(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(flatten)
  return [node.type, ...Object.entries(node.props ?? {}).flatMap(([key, value]) => key === 'children' ? flatten(value) : [])]
}

test('system health classifies snapshots into healthy, attention and degraded', () => {
  const snapshot = overrides => ({ observedAt: '2025-06-01T10:00:00.000Z', services: [{ name: 'Queue', status: 'healthy' }], ...overrides })
  const now = '2025-06-01T10:00:30.000Z'
  assert.equal(determineSystemHealth(snapshot({}), { now }).status, 'healthy')
  assert.equal(determineSystemHealth(snapshot({ services: [{ name: 'Queue', status: 'attention' }] }), { now }).status, 'attention')
  assert.equal(determineSystemHealth(snapshot({ services: [{ name: 'Queue', status: 'degraded' }] }), { now }).status, 'degraded')
})

test('health uses explicit stale and unavailable states rather than invented live values', () => {
  assert.equal(determineSystemHealth(null, { now: '2025-06-01T10:10:00.000Z' }).status, 'unavailable')
  assert.equal(determineSystemHealth({ observedAt: '2025-06-01T09:00:00.000Z', services: [] }, { now: '2025-06-01T10:00:00.000Z', staleAfterMs: 60_000 }).status, 'stale')
  assert.equal(formatMetric(undefined), 'Unavailable')
  assert.equal(formatMetric(null), 'Unavailable')
})

test('health view renders snapshot freshness and unavailable metrics', () => {
  const output = flatten(SystemHealth({ snapshot: { observedAt: '2025-06-01T10:00:00.000Z', services: [{ name: 'Queue', status: 'healthy' }] }, now: '2025-06-01T10:00:30.000Z', metrics: { completed: null } }))
  assert.ok(output.includes('Healthy'))
  assert.ok(output.includes('Last checked 2025-06-01T10:00:00.000Z'))
  assert.ok(output.includes('Queue'))
  assert.ok(output.includes('Unavailable'))
})

test('health retry pause and resume callbacks invoke only when clicked', () => {
  const calls = []
  const tree = SystemHealth({ snapshot: null, onRetry: () => calls.push('retry'), onPause: () => calls.push('pause'), onResume: () => calls.push('resume') })
  const buttons = []
  function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'button') buttons.push(node); const children = node.props?.children; for (const child of Array.isArray(children) ? children : [children]) visit(child) }
  visit(tree)
  assert.deepEqual(calls, [])
  for (const button of buttons) button.props.onClick()
  assert.deepEqual(calls, ['retry', 'pause', 'resume'])
})
