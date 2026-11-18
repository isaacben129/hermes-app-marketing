import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostizReader } from '../src/integrations/postiz.mjs'
import { CHERRY_POSTIZ_INTEGRATION_ID, createCherryPostizAnalytics } from '../src/integrations/cherry-postiz.mjs'

test('Cherry analytics uses its selected TikTok integration, preserves metric provenance, and never reports platform data as app attribution', async () => {
  const calls = []
  const analytics = createCherryPostizAnalytics({ transport: async request => {
    calls.push(request)
    assert.equal(request.path, `/analytics/${CHERRY_POSTIZ_INTEGRATION_ID}`)
    return [{ label: 'views', data: [{ date: '2026-11-17', total: '0' }] }]
  }, clock: () => '2026-11-18T12:00:00.000Z' })
  const result = await analytics.read({ days: 30 })
  assert.equal(result.status, 'available')
  assert.equal(result.observations[0].value, 0)
  assert.equal(result.observations[0].attribution.status, 'unmapped')
  assert.equal(result.observations[0].integrationId, CHERRY_POSTIZ_INTEGRATION_ID)
  assert.deepEqual(calls[0].query, { date: '30' })
  await assert.rejects(analytics.read({ days: 30, appId: 'fapcountapp' }), /Cherry/)
})

test('Cherry Postiz analytics reader fails closed for other integration ids', async () => {
  const reader = createPostizReader({ transport: async () => [] })
  await assert.rejects(reader.readPlatformMetrics({ integrationId: 'other', days: 30, appId: 'cherry' }), /scope/i)
})
