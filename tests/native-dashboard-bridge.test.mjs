import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isNativeDashboardRequest } from '../src/service/native-dashboard-client.mjs'

const root = path.resolve(new URL('..', import.meta.url).pathname)

function request(env, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/plugin-request.mjs'], { cwd: root, env, stdio: ['pipe', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.on('data', chunk => output += chunk)
    child.on('error', reject)
    child.on('close', code => {
      try { if (code !== 0) throw Error('request failed'); resolve(JSON.parse(output)) }
      catch { reject(Error('request failed safely')) }
    })
    child.stdin.end(JSON.stringify(value))
  })
}

test('cached Node catchall bridge reads current durable agent runs and validates start requests', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'native-dashboard-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const runId = 'a'.repeat(32)
  const runDir = path.join(dataDir, 'agent-runs', runId)
  await mkdir(runDir, { recursive: true })
  await writeFile(path.join(runDir, 'run.json'), JSON.stringify({ runId, app: 'Cherry', count: 5, status: 'succeeded', stage: 'completed', completedCount: 0, errors: [], results: [] }))
  const env = { ...process.env, HERMES_MARKETING_DATA_DIR: dataDir, HERMES_HOME: dataDir, HERMES_TEST_PYTHON: process.env.PYTHON || 'python3' }
  const listed = await request(env, { method: 'GET', path: '/api/agent-runs' })
  assert.equal(listed.status, 200)
  assert.equal(listed.body.runs[0].runId, runId)
  const detail = await request(env, { method: 'GET', path: `/api/agent-runs/${runId}` })
  assert.equal(detail.status, 200)
  assert.equal(detail.body.stage, 'completed')
  assert.equal((await request(env, { method: 'POST', path: '/api/agent-runs', body: { app: 'Cherry', count: 4 } })).status, 400)
  assert.equal((await request(env, { method: 'POST', path: '/api/agent-runs', body: { app: 'Cherry', count: 5 } })).status, 503)
  assert.deepEqual(await request(env, { method: 'GET', path: '/api/creative-previews' }), { status: 404, body: { detail: 'Not Found' } })
})

test('bridge whitelist rejects traversal and leaves other legacy paths untouched', () => {
  assert.equal(isNativeDashboardRequest({ method: 'GET', path: '/api/agent-runs/../workspace' }), false)
  assert.equal(isNativeDashboardRequest({ method: 'GET', path: '/api/agent-runs/' + 'g'.repeat(32) }), false)
  assert.equal(isNativeDashboardRequest({ method: 'GET', path: '/api/workspace?app=Cherry' }), false)
  assert.equal(isNativeDashboardRequest({ method: 'PUT', path: '/api/agent-runs' }), false)
})

test('bridge subprocess failure is fixed and secret safe', async () => {
  const { dispatchNativeDashboardRequest } = await import('../src/service/native-dashboard-client.mjs')
  const result = await dispatchNativeDashboardRequest({ method: 'GET', path: '/api/agent-runs' }, { HERMES_MARKETING_DATA_DIR: '/tmp/native-test', HERMES_TEST_PYTHON: '/definitely/missing/python', PRIVATE_TOKEN: 'do-not-print' })
  assert.equal(result.status, 503)
  assert.equal(JSON.stringify(result).includes('do-not-print'), false)
})
