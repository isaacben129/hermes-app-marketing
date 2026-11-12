import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { formatJobChronology, redactError } = require('../src/ops/health.js')
const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length < 2 ? children[0] : children } }) }
const source = await (await import('node:fs/promises')).readFile(new URL('../src/ui/JobDetail.js', import.meta.url), 'utf8')
const componentSource = source.split('\n').filter(line => !line.startsWith('import ')).join('\n').replace('export default function JobDetail', 'function JobDetail')
const JobDetail = new Function('React', 'formatJobChronology', 'redactError', `${componentSource}; return JobDetail`)(React, formatJobChronology, redactError)

function flatten(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(flatten)
  return [node.type, ...Object.entries(node.props ?? {}).flatMap(([key, value]) => key === 'children' ? flatten(value) : [])]
}

test('job chronology sorts events by timestamp and summarizes public fields', () => {
  const job = { id: 'job-1', status: 'failed', events: [
    { at: '2025-06-01T10:02:00.000Z', status: 'failed', message: 'Network timeout' },
    { at: '2025-06-01T10:00:00.000Z', status: 'queued', message: 'Queued' },
  ] }
  assert.deepEqual(formatJobChronology(job).map(event => event.status), ['queued', 'failed'])
})

test('job detail renders chronological events and redacts bearer tokens', () => {
  const job = { id: 'job-1', status: 'failed', createdAt: '2025-06-01T10:00:00.000Z', events: [
    { at: '2025-06-01T10:02:00.000Z', status: 'failed', error: 'Authorization: Bearer secret-token-value' },
    { at: '2025-06-01T10:00:00.000Z', status: 'queued', message: 'Queued' },
  ] }
  assert.equal(redactError(job.events[0].error), 'Authorization: [REDACTED]')
  const output = flatten(JobDetail({ job }))
  assert.ok(output.indexOf('queued', output.indexOf('queued') + 1) < output.indexOf('failed', output.indexOf('failed') + 1))
  assert.ok(output.includes('Authorization: [REDACTED]'))
  assert.ok(!output.includes('secret-token-value'))
})

test('missing job details render an explicit unavailable state', () => {
  assert.ok(flatten(JobDetail({ job: null })).includes('Job details unavailable.'))
})

test('job action callbacks are inert until the corresponding click handler runs', () => {
  const calls = []
  const tree = JobDetail({ job: { id: 'job-42', status: 'queued', events: [] }, onRetry: id => calls.push(['retry', id]), onPause: id => calls.push(['pause', id]), onResume: id => calls.push(['resume', id]) })
  const buttons = []
  function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'button') buttons.push(node); const children = node.props?.children; for (const child of Array.isArray(children) ? children : [children]) visit(child) }
  visit(tree)
  assert.deepEqual(calls, [])
  for (const button of buttons) button.props.onClick()
  assert.deepEqual(calls, [['retry', 'job-42'], ['pause', 'job-42'], ['resume', 'job-42']])
})
