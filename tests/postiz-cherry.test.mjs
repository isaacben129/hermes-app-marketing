import test from 'node:test'
import assert from 'node:assert/strict'
import { CHERRY_POSTIZ_INTEGRATION_ID } from '../src/integrations/cherry-postiz.mjs'
import { createDefaultPostizReader, createPostizReader } from '../src/integrations/postiz.mjs'

const win = { start: '2026-11-01', end: '2026-11-07' }
const CHERRY = 'cmrb2tjm80001ow6vkzhk1yg9'
const post = (id, integration = CHERRY) => ({ id, content: 'hello', publishDate: '2026-11-02T00:00:00Z', state: 'published', integration: { id: integration, providerIdentifier: 'tiktok', name: 'cherrysocialanxiety' } })

test('Postiz reader supports multiple integration accounts for an app and scopes posts per account', async () => {
  const calls = []
  const reader = createPostizReader({ transport: async request => {
    calls.push(request)
    if (request.path === '/integrations') return [{ id: CHERRY, name: 'Cherry TikTok', identifier: 'tiktok', disabled: false }, { id: 'account-2', name: 'Cherry TikTok 2', identifier: 'tiktok', disabled: false }, { id: 'other', name: 'fapcountapp', identifier: 'pinterest', disabled: false }]
    if (request.path === '/posts') return { posts: [post('post-cherry'), post('post-account-2', 'account-2'), post('post-other', 'other')], total: 3 }
    return [{ label: 'views', data: [{ date: '2026-11-02', total: '9' }] }]
  } })
  const integrations = await reader.listIntegrations()
  assert.equal(integrations.length, 3)
  assert.deepEqual((await reader.listPosts({ window: win })).map(p => p.id), ['post-cherry', 'post-account-2', 'post-other'])
  assert.equal((await reader.readPlatformMetrics({ integrationId: CHERRY, days: 7, appId: 'cherry' })).observations[0].value, 9)
  assert.equal((await reader.readPlatformMetrics({ integrationId: 'account-2', days: 7, appId: 'cherry' })).observations[0].integrationId, 'account-2')
  assert.ok(calls.every(call => call.method === 'GET'))
})

test('default Postiz reader allows only documented GET analytics and validates scope input', async () => {
  const requests = []
  const reader = createDefaultPostizReader({ env: { POSTIZ_BASE_URL: 'https://api.postiz.com/public/v1', POSTIZ_API_KEY: 'test-key' }, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options })
    return { ok: true, json: async () => [] }
  } })
  await reader.listIntegrations()
  assert.equal(requests[0].options.headers.Authorization, 'test-key')
  assert.equal(requests[0].options.redirect, 'error')
  assert.equal((await reader.readPlatformMetrics({ integrationId: CHERRY, days: 30, appId: 'cherry' })).status, 'available')
  assert.equal(requests[1].url, `https://api.postiz.com/public/v1/analytics/${CHERRY}?date=30`)
  await assert.rejects(reader.readPlatformMetrics({ integrationId: '../other', days: 30, appId: 'cherry' }), /scope/i)
  assert.throws(() => createDefaultPostizReader({ env: { POSTIZ_BASE_URL: 'http://example.test/api/public/v1', POSTIZ_API_KEY: 'key' } }), /HTTPS/i)
})

test('Postiz network boundary denies non-GET and undocumented routes', async () => {
  const calls = []
  const reader = createDefaultPostizReader({ env: { POSTIZ_BASE_URL: 'https://api.postiz.com/public/v1', POSTIZ_API_KEY: 'test-key' }, fetchImpl: async (...args) => { calls.push(args); throw new Error('should not fetch') } })
  await assert.rejects(reader.transport({ method: 'POST', path: '/posts', query: {} }), /denied/i)
  await assert.rejects(reader.transport({ method: 'GET', path: '/settings', query: {} }), /denied/i)
  assert.equal(calls.length, 0)
})
