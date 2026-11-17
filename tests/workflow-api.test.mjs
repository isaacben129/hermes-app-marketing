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

const cherryProfile = () => {
  const { status: _status, campaign: _campaign, measurement: _measurement, provisionalEventCandidates: _candidates, notes: _notes, ...profile } = structuredClone(cherry)
  return profile
}
const approvedProfile = (app = 'Cherry') => ({ ...cherryProfile(), name: app, appId: app.toLowerCase(), configuration: { ...cherry.configuration, qualifiedEvent: approved('qualified_start'), paidEvent: approved('purchase'), privacyPolicy: approved('privacy-v1') } })
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

test('review revision stays bound to saved draft across review events and unrelated app writes', async t => {
  const { call } = await fixture(t)
  await call('/api/drafts/d1', 'PUT', { expectedRevision: 0, draft: { id: 'd1', app: 'Cherry', slides: [], evidence: [], claims: [] } })
  const first = await call('/api/review', 'POST', { draftId: 'd1', revision: 1 })
  assert.equal(first.body.quality.revision, 1)
  const profile = approvedProfile()
  await call('/api/profiles/Cherry', 'PUT', { expectedRevision: 2, profile })
  const second = await call('/api/review', 'POST', { draftId: 'd1', revision: 3 })
  assert.equal(second.body.quality.revision, 1)
})

test('seven valid reviews survive reload and repeated review, while content edits clear them', async t => {
  const { call } = await fixture(t)
  const profile = approvedProfile()
  profile.configuration.cta = approved('Learn more')
  await call('/api/profiles/Cherry', 'PUT', { expectedRevision: 0, profile })
  const evidence = [{ id: 'evidence-1', provenance: { origin: 'owner', locator: 'local:source', capturedAt: '2026-11-17T00:00:00Z' }, rights: { status: 'cleared', attestation: { decision: 'cleared', attesterType: 'human', attestedBy: 'owner', attestedAt: '2026-11-17T00:00:00Z', basis: 'owned', scope: 'campaign' } } }]
  const dimensions = ['audience fit', 'hook clarity', 'claim specificity/proof', 'slide progression/payoff', 'mobile legibility/visual coherence', 'promise-to-destination match', 'safety/rights/brand']
  const qualityReviews = dimensions.map(dimension => ({ dimension, score: 4, revision: 999, reviewer: { type: 'human', name: 'reviewer' }, evidenceRefs: ['evidence-1'], rationale: 'Supported by saved evidence.', reviewedAt: '2026-11-17T00:00:00Z' }))
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII='
  const bytes = Buffer.from(png, 'base64')
  const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
  const draft = { id: 'd1', app: 'Cherry', slides: [{ selectedImage: { dataUrl: `data:image/png;base64,${png}`, sha256, sourceRef: 'local:image' } }], evidence, claims: [], qualityReviews: qualityReviews.map(review => ({ ...review, evidenceRefs: ['fabricated-pointer'] })) }
  let saved = await call('/api/drafts/d1', 'PUT', { expectedRevision: 1, draft })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  let reviewed = await call('/api/review', 'POST', { draftId: 'd1', revision: 2 })
  assert.equal(reviewed.body.quality.assessment, 'inconclusive')
  let state = (await call('/api/workspace?app=Cherry')).body
  saved = await call('/api/drafts/d1', 'PUT', { expectedRevision: 3, draft: { ...state.drafts[0], qualityReviews } })
  assert.equal(saved.status, 200)
  reviewed = await call('/api/review', 'POST', { draftId: 'd1', revision: 4 })
  assert.equal(reviewed.body.quality.assessment, 'reviewed')
  assert.equal(reviewed.body.quality.dimensions.length, 7)
  reviewed = await call('/api/review', 'POST', { draftId: 'd1', revision: 5 })
  assert.equal(reviewed.body.quality.assessment, 'reviewed')
  assert.equal(reviewed.body.quality.revision, 4)
  state = (await call('/api/workspace?app=Cherry')).body
  saved = await call('/api/drafts/d1', 'PUT', { expectedRevision: 6, draft: { ...state.drafts[0], title: 'Changed' } })
  assert.equal(saved.status, 200)
  const afterEdit = await call('/api/review', 'POST', { draftId: 'd1', revision: 7 })
  assert.equal(afterEdit.body.quality.assessment, 'inconclusive')
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
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
  const crypto = await import('node:crypto')
  const sha256 = crypto.createHash('sha256').update(image).digest('hex')
  await call('/api/drafts/d1', 'PUT', { expectedRevision: 0, draft: { id: 'd1', app: 'Cherry', slides: [] } })
  const result = await call('/api/generation/intake', 'POST', { draftId: 'd1', revision: 1, asset: { draftId: 'd1', revision: 1, prompt: 'test', provider: 'hermes', model: 'm', requestId: 'r', generatedAt: '2026-11-17T00:00:00Z', imageSha256: sha256, dataUrl: `data:image/png;base64,${image.toString('base64')}`, sourceRef: 'local:asset', humanUseApproval: 'pending', rightsStatus: 'cleared' } })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.asset.humanUseApproval, 'pending')
  assert.equal(result.body.asset.rightsStatus, 'unknown')
})

test('generation intake rejects bytes that are not the declared image before writing events', async t => {
  const { call } = await fixture(t)
  const image = Buffer.from('generated fixture image')
  const sha256 = (await import('node:crypto')).createHash('sha256').update(image).digest('hex')
  await call('/api/drafts/d1', 'PUT', { expectedRevision: 0, draft: { id: 'd1', app: 'Cherry', slides: [] } })
  const result = await call('/api/generation/intake', 'POST', { draftId: 'd1', revision: 1, asset: { draftId: 'd1', revision: 1, prompt: 'test', provider: 'hermes', model: 'm', requestId: 'r', generatedAt: '2026-11-17T00:00:00Z', imageSha256: sha256, dataUrl: `data:image/png;base64,${image.toString('base64')}`, sourceRef: 'local:asset', humanUseApproval: 'pending' } })
  assert.equal(result.status, 400)
  const state = (await call('/api/workspace?app=Cherry')).body
  assert.equal(state.revision, 1)
  assert.equal(state.drafts[0].generatedAssets, undefined)
})

test('Postiz sync is app channel matched and leaves creative attribution unknown',async t=>{const reader={listIntegrations:async()=>[{id:'int-1',name:'Brand'}],listPosts:async()=>[{id:'p1',content:'hello',integration:{id:'int-1'}},{id:'p2',integration:{id:'other'}}],readMetrics:async()=>({status:'available',observations:[{source:'postiz',postId:'p1',appId:'cherry',creativeRevision:null,metric:'views',value:0,status:'available',evidenceId:'postiz:p1:views:2026-11-01',attribution:{status:'unmapped'}}]})};const {call}=await fixture(t,reader);const profile=approvedProfile();profile.configuration.channel=approved('int-1');await call('/api/profiles/Cherry','PUT',{expectedRevision:0,profile});let result=await call('/api/postiz/sync','POST',{app:'Cherry',window:{start:'2026-11-01',end:'2026-11-07'},days:7});assert.equal(result.body.status,'connected');assert.deepEqual(result.body.posts.map(post=>post.id),['p1']);assert.equal(result.body.observations[0].creativeRevision,null);assert.deepEqual(result.body.observations[0].attribution,{status:'unmapped'});assert.equal((await call('/api/workspace?app=Cherry')).body.posts.length,1)})

test('unknown channel is blocked and does not emit successful sync', async t => {
  const reader = { listIntegrations: async () => [{ id: 'int-1' }], listPosts: async () => [{ id: 'p1', integration: { id: 'int-1' } }], readMetrics: async () => ({ status: 'available', observations: [] }) }
  const { call } = await fixture(t, reader)
  const profile = approvedProfile(); profile.configuration.channel = approved('int-1')
  await call('/api/profiles/Cherry', 'PUT', { expectedRevision: 0, profile })
  const known = await call('/api/postiz/sync', 'POST', { app: 'Cherry', window: { start: '2026-11-01', end: '2026-11-07' }, days: 7 })
  assert.equal(known.body.status, 'connected')
  const other = approvedProfile('Other')
  await call('/api/profiles/Other', 'PUT', { expectedRevision: 0, profile: other })
  const result = await call('/api/postiz/sync', 'POST', { app: 'Other', window: { start: '2026-11-01', end: '2026-11-07' }, days: 7 })
  assert.equal(result.body.status, 'blocked')
  assert.equal(result.body.error.code, 'channel_unconfigured')
  assert.equal(result.body.lastSuccess, null)
  assert.equal((await call('/api/workspace?app=Other')).body.revision, 1)
})

test('offline sync for another app does not inherit the first app last success', async t => {
  let offline = false
  const reader = { listIntegrations: async () => { if (offline) throw Object.assign(new Error('offline'), { code: 'unavailable' }); return [{ id: 'int-1' }] }, listPosts: async () => [], readMetrics: async () => ({ status: 'available', observations: [] }) }
  const { call } = await fixture(t, reader)
  const profileA = approvedProfile(); profileA.configuration.channel = approved('int-1')
  await call('/api/profiles/Cherry', 'PUT', { expectedRevision: 0, profile: profileA })
  await call('/api/postiz/sync', 'POST', { app: 'Cherry', window: { start: '2026-11-01', end: '2026-11-07' }, days: 7 })
  const profileB = approvedProfile('Other')
  await call('/api/profiles/Other', 'PUT', { expectedRevision: 0, profile: profileB })
  offline = true
  const result = await call('/api/postiz/sync', 'POST', { app: 'Other', window: { start: '2026-11-01', end: '2026-11-07' }, days: 7 })
  assert.equal(result.body.status, 'unavailable')
  assert.equal(result.body.lastSuccess, null)
})

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
  assert.deepEqual(response.body.error, { code: 'invalid_input', message: 'Check the named fields and request schema.', retryable: false })
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
