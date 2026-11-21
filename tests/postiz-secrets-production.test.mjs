import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const root = process.cwd()

test('production plugin-request loads owner-only credentials and sends only to an injected loopback Postiz transport', async t => {
  const calls = []
  const local = createServer(async (req, res) => {
    calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/public/v1/integrations') return res.end(JSON.stringify([{ id: 'fixture-channel', name: 'fixture', disabled: false }]))
    if (req.url.startsWith('/api/public/v1/posts?')) return res.end(JSON.stringify({ posts: [], total: 0, hasMore: false }))
    if (req.url.startsWith('/api/public/v1/analytics/fixture-channel?')) return res.end('[]')
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve))
  t.after(() => { local.closeAllConnections(); return new Promise(resolve => local.close(resolve)) })
  const folder = await mkdtemp(path.join(os.tmpdir(), 'plugin-request-secret-fixture-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const secretFile = path.join(folder, 'marketing-secrets.env')
  await writeFile(secretFile, `POSTIZ_API_KEY=fixture-only-key\nPOSTIZ_BASE_URL=http://127.0.0.1:${local.address().port}/api/public/v1\n`)
  await chmod(secretFile, 0o600)
  const env = { ...process.env, HERMES_HOME: folder, HERMES_MARKETING_DATA_DIR: path.join(folder, 'store'), HERMES_MARKETING_SECRETS_FILE: secretFile }
  delete env.POSTIZ_API_KEY
  delete env.POSTIZ_BASE_URL
  const invoke = input => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/plugin-request.mjs'], { cwd: root, env, stdio: ['pipe', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.once('error', reject)
    child.once('close', code => {
      if (code !== 0) return reject(new Error('production plugin-request failed without exposing child diagnostics'))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('production plugin-request returned invalid JSON')) }
    })
    child.stdin.end(JSON.stringify(input))
  })
  const profile = {
    appId: 'cherry', name: 'Cherry', brand: { promise: '', source: { locator: 'Cherry', version: 'a5751c4350b2818bf8d05a60264f8fe91e755c8b' }, tone: '', avoidClaims: '' },
    configuration: Object.fromEntries(['cta', 'claims', 'rights', 'qualifiedEvent', 'paidEvent', 'privacyPolicy'].map(key => [key, { value: null, status: 'unconfigured' }])),
  }
  profile.configuration.channel = { value: 'fixture-channel', status: 'approved', evidenceRef: 'fixture-owner-approved', reviewer: 'fixture owner', reviewedAt: '2026-11-21T00:00:00Z' }
  const saved = await invoke({ method: 'PUT', path: '/api/profiles/Cherry', body: { expectedRevision: 0, profile } })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  const synced = await invoke({ method: 'POST', path: '/api/postiz/sync', body: { app: 'Cherry', window: { start: '2026-11-01', end: '2026-11-21' }, days: 21 } })
  assert.equal(synced.status, 200, JSON.stringify(synced.body))
  assert.equal(synced.body.status, 'connected', JSON.stringify({ error: synced.body.error, paths: calls.map(call => call.path) }))
  assert.deepEqual(calls.map(call => call.path.split('?')[0]), ['/api/public/v1/integrations', '/api/public/v1/posts', '/api/public/v1/analytics/fixture-channel'])
  assert.ok(calls.every(call => call.method === 'GET' && call.authorization === 'fixture-only-key'))
  assert.doesNotMatch(JSON.stringify(synced), /fixture-only-key/)
})
