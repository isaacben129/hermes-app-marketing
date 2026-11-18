import test from 'node:test'
import assert from 'node:assert/strict'
import { CHERRY_POSTIZ_INTEGRATION_ID } from '../src/integrations/cherry-postiz.mjs'
import { createDefaultPostizReader, createPostizReader } from '../src/integrations/postiz.mjs'

const win = { start: '2026-11-01', end: '2026-11-07' }
const CHERRY = 'cmrb2tjm80001ow6vkzhk1yg9'
const post = (id, integration = CHERRY) => ({ id, content: 'hello', publishDate: '2026-11-02T00:00:00Z', state: 'published', integration: { id: integration, providerIdentifier: 'tiktok', name: 'cherrysocialanxiety' } })

test('Postiz reader keeps posts and analytics scoped to Cherry TikTok integration only', async () => {
  const calls = []
  const reader = createPostizReader({ transport: async request => {
    calls.push(request)
    if (request.path === '/integrations') return [{ id: CHERRY, name: 'cherrysocialanxiety', identifier: 'tiktok', disabled: false }, { id: 'other', name: 'fapcountapp', identifier: 'pinterest', disabled: false }]
    if (request.path === '/posts') return { posts: [post('post-cherry'), post('post-other', 'other')], total: 2 }
    return [{ label: 'views', data: [{ date: '2026-11-02', total: '9' }] }]
  } })
  assert.equal((await reader.listIntegrations()).length, 2)
  const posts = await reader.listPosts({ window: win })
  assert.deepEqual(posts.map(p => p.id), ['post-cherry', 'post-other'])
  const metrics = await reader.readMetrics({ postId: 'post-cherry', days: 7, appId: 'cherry', creativeRevision: null })
  assert.equal(metrics.observations[0].value, 9)
  assert.ok(calls.every(call => call.method === 'GET'))
})

test('default Postiz reader permits GET-only platform analytics and validates Cherry integration scope', async () => {
  const requests = []
  const reader = createDefaultPostizReader({ env: { POSTIZ_BASE_URL: 'https://api.postiz.com/public/v1', POSTIZ_API_KEY: 'test-key' }, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options })
    return { ok: true, json: async () => [] }
  } })
  await reader.listIntegrations()
  assert.equal(requests[0].options.headers.Authorization, 'test-key')
  assert.equal(requests[0].options.redirect, 'error')
  const result = await reader.readMetrics({ postId: 'post-1', days: 30, appId: 'cherry', creativeRevision: null })
  assert.equal(result.status, 'available')
  const directScoped = createPostizReader({ transport: async ({ path, query }) => {
    assert.equal(path, `/analytics/${CHERRY}`)
    assert.deepEqual(query, { date: '30' })
    return [{ label: 'impressions', data: [{ date: '2026-11-01', total: '12' }] }]
  } })
  assert.equal((await directScoped.readPlatformMetrics({ integrationId: CHERRY, scopedIntegrationId: CHERRY, days: 30, appId: 'cherry' })).observations[0].value, 12)
  await assert.rejects(directScoped.readPlatformMetrics({ integrationId: 'other', scopedIntegrationId: CHERRY, days: 30, appId: 'cherry' }), /scope/i)
  assert.throws(() => createDefaultPostizReader({ env: { POSTIZ_BASE_URL: 'http://example.test/api/public/v1', POSTIZ_API_KEY: 'key' } }), /HTTPS/i)
})

test('platform analytics never accepts a different configured integration id', async () => {
  const reader = createPostizReader({ transport: async () => [] })
  await assert.rejects(reader.readPlatformMetrics({ integrationId: 'other', scopedIntegrationId: CHERRY_POSTIZ_INTEGRATION_ID, days: 7, appId: 'cherry' }), /scope/i)
})
