import { test, describe, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_DIR = path.join(__dirname, '..', 'tmp-runner-test')

async function cleanup() {
  await fs.rm(TEST_DIR, { recursive: true, force: true })
}

describe('safe local job lifecycle', () => {
  beforeEach(async () => {
    await cleanup()
    await fs.mkdir(TEST_DIR, { recursive: true })
  })

  after(cleanup)

  test('records queued, running and succeeded phases around local work', async () => {
    const { LocalJobRunner } = await import('../src/jobs/runner.mjs')
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const runner = new LocalJobRunner({ ledger: new EventLedger({ baseDir: TEST_DIR }) })
    await runner.submit({ id: 'job-1', name: 'local task' })
    const result = await runner.runLocal('job-1', async () => 'done')
    assert.equal(result, 'done')
    assert.equal(runner.get('job-1').status, 'succeeded')
    assert.deepEqual((await new EventLedger({ baseDir: TEST_DIR }).getEvents()).map(e => e.payload.to), ['queued', 'running', 'succeeded'])
  })

  test('rejects illegal transitions and explicit external side effects', async () => {
    const { LocalJobRunner } = await import('../src/jobs/runner.mjs')
    const runner = new LocalJobRunner({ ledger: new (await import('../src/storage/ledger.mjs')).EventLedger({ baseDir: TEST_DIR }) })
    await runner.submit({ id: 'job-2', name: 'local task' })
    await assert.rejects(runner.transition('job-2', 'succeeded'), /Illegal job transition/)
    await assert.rejects(runner.transition('job-2', 'running', { externalSideEffect: true }), /External side effects/)
    assert.equal(runner.get('job-2').status, 'queued')
  })

  test('records failed local work and rethrows the error', async () => {
    const { LocalJobRunner } = await import('../src/jobs/runner.mjs')
    const runner = new LocalJobRunner({ ledger: new (await import('../src/storage/ledger.mjs')).EventLedger({ baseDir: TEST_DIR }) })
    await runner.submit({ id: 'job-3', name: 'local task' })
    await assert.rejects(runner.runLocal('job-3', async () => { throw new Error('local failure') }), /local failure/)
    assert.equal(runner.get('job-3').status, 'failed')
  })
})
