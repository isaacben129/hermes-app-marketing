import test from 'node:test'
import assert from 'node:assert/strict'
import { createPostizReader, createDefaultPostizReader } from '../src/integrations/postiz.mjs'

const win = { start: '2026-11-01', end: '2026-11-07' }
const post = id => ({ id, content: 'hello', publishDate: '2026-11-02T00:00:00Z', state: 'published', integration: { id: 'int-1', providerIdentifier: 'instagram', name: 'Brand' } })

test('reader uses official GET routes, dedupes advertised pages, and reads posts by list lookup', async () => {
  const calls = []
  const reader = createPostizReader({
    transport: async request => {
      calls.push(request)
      if (request.path === '/integrations') return [{ id: 'int-1', name: 'Brand', identifier: 'instagram', disabled: false }]
      return request.query.cursor ? { posts: [post('p2')], total: 2 } : { posts: [post('p1')], hasMore: true, nextCursor: 'next', total: 2 }
    }
  })
  assert.equal((await reader.listIntegrations())[0].id, 'int-1')
  assert.deepEqual((await reader.listPosts({ window: win })).map(item => item.id), ['p1', 'p2'])
  assert.equal((await reader.readPost('p2', { window: win })).id, 'p2')
  assert.ok(calls.every(call => call.method === 'GET' && ['/integrations', '/posts'].includes(call.path)))
  assert.deepEqual(calls[1].query, { startDate: win.start, endDate: win.end })
})

test('metrics preserve dated buckets, zero, unsupported values, provenance, and stale cache', async () => {
  let broken = false
  const reader = createPostizReader({ clock: () => '2026-11-08T00:00:00Z', transport: async () => { if (broken) throw Object.assign(new Error('secret'), { status: 503 }); return [{ label: 'views', data: [{ date: '2026-11-01', total: '0' }, { date: '2026-11-02', total: null }] }] } })
  const fresh = await reader.readMetrics({ postId: 'p1', days: 7, appId: 'cherry', creativeRevision: 4 })
  assert.equal(fresh.observations[0].value, 0)
  assert.equal(fresh.observations[1].value, null)
  assert.equal(fresh.observations[1].status, 'unsupported')
  assert.equal(fresh.observations[0].windowStart, '2026-11-01')
  assert.equal(fresh.observations[0].source, 'postiz')
  broken = true
  const stale = await reader.readMetrics({ postId: 'p1', days: 7, appId: 'cherry', creativeRevision: 4 })
  assert.equal(stale.status, 'stale')
  assert.equal(stale.observations[0].value, 0)
  assert.equal(JSON.stringify(stale).includes('secret'), false)
})

test('reader rejects malformed pagination, totals, dates and metric input', async () => {
  let result = { posts: [post('p1')], total: 2 }
  const reader = createPostizReader({ transport: async () => result })
  await assert.rejects(reader.listPosts({ window: win }), /total/i)
  result = { posts: [post('p1')], hasMore: true, nextCursor: 'a' }
  const repeated = createPostizReader({ transport: async () => result })
  await assert.rejects(repeated.listPosts({ window: win }), /cursor/i)
  await assert.rejects(reader.listPosts({ window: { start: 'no', end: '2026-11-07' } }), /window/i)
  await assert.rejects(reader.readMetrics({ postId: 'p1', days: 366, appId: 'cherry', creativeRevision: 0 }), /scope/i)
})

test('auth is attempted once and rate limits retry at most once with bounded delay', async () => {
  let calls = 0, delay = 0
  const denied = createPostizReader({ transport: async () => { calls++; throw Object.assign(new Error('secret'), { status: 403 }) }, sleep: async () => {} })
  await assert.rejects(denied.listIntegrations(), error => error.code === 'provider_denied')
  assert.equal(calls, 1)
  calls = 0
  const limited = createPostizReader({ transport: async () => { calls++; throw Object.assign(new Error('secret'), { status: 429, retryAfterMs: 90000 }) }, sleep: async ms => { delay = ms } })
  await assert.rejects(limited.listIntegrations(), error => error.code === 'rate_limited')
  assert.equal(calls, 2)
  assert.equal(delay, 30000)
})

test('default reader uses only explicit env credentials, HTTPS, raw auth header, fixed GET paths, and redirects denied', async () => {
  const requests = []
  const reader = createDefaultPostizReader({ env: { POSTIZ_BASE_URL: 'https://example.test/api/public/v1', POSTIZ_API_KEY: 'secret-key' }, fetchImpl: async (url, options) => { requests.push({ url: String(url), options }); return { ok: true, json: async () => [] } } })
  await reader.listIntegrations()
  assert.equal(requests[0].options.headers.Authorization, 'secret-key')
  assert.equal(requests[0].options.redirect, 'error')
  assert.equal(createDefaultPostizReader({ env: {} }), null)
  assert.ok(createDefaultPostizReader({ env: { POSTIZ_BASE_URL: 'https://api.postiz.com/public/v1', POSTIZ_API_KEY: 'secret' }, fetchImpl: async () => ({ ok: true, json: async () => [] }) }))
  assert.throws(() => createDefaultPostizReader({ env: { POSTIZ_BASE_URL: 'http://example.test/api/public/v1', POSTIZ_API_KEY: 'secret' } }), /HTTPS/i)
})
