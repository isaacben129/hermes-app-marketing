import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import cherry from '../src/config/cherry.json' with { type: 'json' }
import { EventLedger } from '../src/storage/ledger.mjs'
import { WorkspaceStore } from '../src/storage/workspace.mjs'
import { LocalJobRunner } from '../src/jobs/runner.mjs'
import { createActions } from '../src/service/actions.mjs'
import { createService } from '../src/service/server.mjs'

const approvedProfile = () => ({ ...structuredClone(cherry), configuration: { ...cherry.configuration, qualifiedEvent: approved('qualified_start'), paidEvent: approved('purchase'), privacyPolicy: approved('privacy-v1') } })
const approved = value => ({ value, status: 'approved', evidenceRef: 'owner:evidence', reviewer: 'owner', reviewedAt: '2026-11-17T00:00:00Z' })

async function fixture(t, postizReader = null) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-api-'))
  const ledger = new EventLedger({ baseDir: dir })
  const workspace = new WorkspaceStore({ ledger })
  const runner = new LocalJobRunner({ ledger })
  const actions = createActions({ workspace, ledger, runner, renderer: {}, artifacts: { get: async () => null }, postizReader, clock: () => '2026-11-17T12:00:00Z' })
  const server = createService({ actions, token: 'local-secret', allowedOrigin: 'http://127.0.0.1:3000' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }) })
  const call = async (route, method = 'GET', body) => {
    const response = await fetch(`${base}${route}`, { method, headers: { Authorization: 'Bearer local-secret', Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }
  return { call, workspace }
}

test('real HTTP profile CAS, scoped workspace, hard-block review, and experiment persist', async t => {
  const { call } = await fixture(t)
  const profile = approvedProfile()
  let result = await call('/api/profiles/Cherry', 'PUT', { expectedRevision: 0, profile })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.revision, 1)
  assert.equal((await call('/api/workspace?app=Other')).body.profiles.length, 0)
  result = await call('/api/drafts/d1', 'PUT', { expectedRevision: 1, draft: { id: 'd1', app: 'Cherry', slides: [], evidence: [], claims: [] } })
  assert.equal(result.body.revision, 2)
  result = await call('/api/review', 'POST', { draftId: 'd1', revision: 2 })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.quality.quality, undefined)
  assert.equal(result.body.quality.assessment, 'blocked')
  assert.deepEqual(result.body.quality.hardBlockers, ['missingImage', 'unknownRights', 'unapprovedCta'])
  result = await call('/api/experiments/recommend', 'POST', { draftId: 'd1', revision: 3, experiment: { appId: 'cherry' }, observations: [] })
  assert.equal(result.body.decision.decision, 'inconclusive')
  const loaded = (await call('/api/workspace?app=Cherry')).body
  assert.equal(loaded.decisions.length, 1)
  assert.equal(loaded.drafts[0].quality.assessment, 'blocked')
  result = await call('/api/drafts/d1', 'PUT', { expectedRevision: 4, draft: { ...loaded.drafts[0], title: 'edited', quality: { approved: true }, readiness: { ready: true } } })
  assert.equal(result.body.revision, 5)
  const edited = (await call('/api/workspace?app=Cherry')).body.drafts[0]
  assert.equal(edited.quality, undefined)
  assert.equal(edited.readiness, undefined)
  result = await call('/api/profiles/Cherry', 'PUT', { expectedRevision: 0, profile })
  assert.equal(result.status, 409)
})

test('HTTP outcome import validates profile settings and persists normalized observations', async t => {
  const { call } = await fixture(t)
  await call('/api/profiles/Cherry', 'PUT', { expectedRevision: 0, profile: approvedProfile() })
  const window = { start: '2026-11-01', end: '2026-11-07' }
  const result = await call('/api/outcomes/import', 'POST', {
    app: 'Cherry', rows: [{ eventName: 'qualified_start', count: 4, windowStart: window.start, windowEnd: window.end, appId: 'cherry', creativeRevision: 1, postId: 'post-1', evidenceId: 'evidence-1' }],
    eventDefinitions: [{ name: 'qualified_start', kind: 'qualified' }],
    attributionPolicy: { approved: true, policyVersion: 'p1', evidenceRef: 'policy:e1', approvedBy: 'owner', identityJoin: false, allowedMappings: ['postId'] },
    source: { type: 'owner-export', locator: 'local-file', observedAt: '2026-11-08T00:00:00Z', appId: 'cherry', creativeRevision: 1 }, window
  })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.observations[0].count, 4)
  assert.equal((await call('/api/workspace?app=Cherry')).body.observations.length, 1)
})

test('generation intake derives hash and does not accept caller-cleared human rights gates', async t => {
  const { call } = await fixture(t)
  const image = Buffer.from('generated fixture image')
  const crypto = await import('node:crypto')
  const sha256 = crypto.createHash('sha256').update(image).digest('hex')
  await call('/api/drafts/d1', 'PUT', { expectedRevision: 0, draft: { id: 'd1', app: 'Cherry', slides: [] } })
  const result = await call('/api/generation/intake', 'POST', { draftId: 'd1', revision: 1, asset: { draftId: 'd1', revision: 1, prompt: 'test', provider: 'hermes', model: 'm', requestId: 'r', generatedAt: '2026-11-17T00:00:00Z', imageSha256: sha256, dataUrl: `data:image/png;base64,${image.toString('base64')}`, sourceRef: 'local:asset', humanUseApproval: 'pending', rightsStatus: 'cleared' } })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.asset.humanUseApproval, 'pending')
  assert.equal(result.body.asset.rightsStatus, 'unknown')
})

test('Postiz sync is GET-only, app channel matched, durable, and health reflects recorded connection',async t=>{const reader={listIntegrations:async()=>[{id:'int-1',name:'Brand'}],listPosts:async()=>[{id:'p1',content:'hello',integration:{id:'int-1'}},{id:'p2',integration:{id:'other'}}],readMetrics:async()=>({status:'available',observations:[{source:'postiz',postId:'p1',appId:'cherry',creativeRevision:0,metric:'views',value:0,status:'available',evidenceId:'postiz:p1:views:2026-11-01'}]})};const {call}=await fixture(t,reader);const profile=approvedProfile();profile.configuration.channel=approved('int-1');await call('/api/profiles/Cherry','PUT',{expectedRevision:0,profile});let result=await call('/api/postiz/sync','POST',{app:'Cherry',window:{start:'2026-11-01',end:'2026-11-07'},days:7});assert.equal(result.body.status,'connected');assert.deepEqual(result.body.posts.map(post=>post.id),['p1']);assert.equal((await call('/api/workspace?app=Cherry')).body.posts.length,1);let health=(await call('/api/health')).body;assert.equal(health.services.find(item=>item.name==='postiz').status,'healthy')})

test('Postiz unavailable configuration never returns invented posts',async t=>{const {call}=await fixture(t);const result=await call('/api/postiz/sync','POST',{app:'Cherry',window:{start:'2026-11-01',end:'2026-11-07'},days:7});assert.equal(result.body.status,'unavailable');assert.deepEqual(result.body.posts,[]);assert.equal(result.body.lastSuccess,null)})

test('HTTP delete persists a tombstone under workspace CAS and rejects stale delete', async t => {
  const { call, workspace } = await fixture(t)
  await call('/api/drafts/d1', 'PUT', { expectedRevision: 0, draft: { id: 'd1', app: 'Cherry', slides: [] } })
  let result = await call('/api/drafts/d1', 'DELETE', { app: 'Cherry', expectedRevision: 0 })
  assert.equal(result.status, 409)
  result = await call('/api/drafts/d1', 'DELETE', { app: 'Cherry', expectedRevision: 1 })
  assert.deepEqual(result.body, { revision: 2, deleted: true })
  assert.equal((await call('/api/workspace?app=Cherry')).body.drafts.length, 0)
  assert.equal(await workspace.findDraft('d1'), null)
})

test('protected write bodies reject credential-shaped fields with safe errors', async t => {
  const { call } = await fixture(t)
  const response = await call('/api/drafts/d1', 'PUT', { expectedRevision: 0, draft: { id: 'd1', app: 'Cherry', apiKey: 'never-store-this' } })
  assert.equal(response.status, 400)
  assert.deepEqual(response.body.error, { code: 'invalid_input', message: 'Request could not be completed', retryable: false })
})

test('stale Postiz metric cache is durably marked stale and health becomes attention', async t => {
  let stale = false
  const reader = {
    listIntegrations: async () => [{ id: 'int-1' }],
    listPosts: async () => [{ id: 'p1', integration: { id: 'int-1' } }],
    readMetrics: async () => ({ status: stale ? 'stale' : 'available', observations: [{ source: 'postiz', postId: 'p1', appId: 'cherry', creativeRevision: 0, metric: 'views', value: 2, status: 'available', evidenceId: 'postiz:p1:views:2026-11-01' }] })
  }
  const { call } = await fixture(t, reader)
  const profile = approvedProfile(); profile.configuration.channel = approved('int-1')
  await call('/api/profiles/Cherry', 'PUT', { expectedRevision: 0, profile })
  await call('/api/postiz/sync', 'POST', { app: 'Cherry', window: { start: '2026-11-01', end: '2026-11-07' }, days: 7 })
  stale = true
  const sync = await call('/api/postiz/sync', 'POST', { app: 'Cherry', window: { start: '2026-11-01', end: '2026-11-07' }, days: 7 })
  assert.equal(sync.body.observations[0].status, 'stale')
  assert.equal((await call('/api/workspace?app=Cherry')).body.observations[0].status, 'stale')
  assert.equal((await call('/api/health')).body.services.find(item => item.name === 'postiz').status, 'attention')
})
