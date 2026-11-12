import { test, describe, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_DIR = path.join(__dirname, '..', 'tmp-ledger-test')

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  } catch {}
}

describe('durable local event ledger', () => {
  beforeEach(async () => {
    await cleanup()
    await fs.mkdir(TEST_DIR, { recursive: true })
  })

  after(async () => {
    await cleanup()
  })

  test('appendEvent writes JSONL line atomically', async () => {
    // RED: This will fail until we implement the ledger
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: TEST_DIR })
    await ledger.appendEvent({ type: 'test', payload: { value: 1 } })

    const content = await fs.readFile(path.join(TEST_DIR, 'events.jsonl'), 'utf8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 1)
    const event = JSON.parse(lines[0])
    assert.equal(event.type, 'test')
    assert.equal(event.payload.value, 1)
    assert.ok(event.id)
    assert.ok(event.timestamp)
  })

  test('appendEvent creates idempotent event with same idempotency key', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: TEST_DIR })
    await ledger.appendEvent({ type: 'test', payload: { value: 1 } }, 'idem-key-1')
    await ledger.appendEvent({ type: 'test', payload: { value: 2 } }, 'idem-key-1')

    const content = await fs.readFile(path.join(TEST_DIR, 'events.jsonl'), 'utf8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 1) // Only one event due to idempotency
  })

  test('getEvents returns all events in order', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: TEST_DIR })
    await ledger.appendEvent({ type: 'a', payload: {} })
    await ledger.appendEvent({ type: 'b', payload: {} })
    await ledger.appendEvent({ type: 'c', payload: {} })

    const events = await ledger.getEvents()
    assert.equal(events.length, 3)
    assert.equal(events[0].type, 'a')
    assert.equal(events[1].type, 'b')
    assert.equal(events[2].type, 'c')
  })

  test('getEvents filters by type', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: TEST_DIR })
    await ledger.appendEvent({ type: 'foo', payload: {} })
    await ledger.appendEvent({ type: 'bar', payload: {} })
    await ledger.appendEvent({ type: 'foo', payload: {} })

    const events = await ledger.getEvents({ type: 'foo' })
    assert.equal(events.length, 2)
    assert.ok(events.every(e => e.type === 'foo'))
  })

  test('getEvents respects limit and offset', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: TEST_DIR })
    for (let i = 0; i < 10; i++) {
      await ledger.appendEvent({ type: 'seq', payload: { i } })
    }

    const events = await ledger.getEvents({ limit: 3, offset: 2 })
    assert.equal(events.length, 3)
    assert.equal(events[0].payload.i, 2)
    assert.equal(events[2].payload.i, 4)
  })

  test('snapshot creates atomic snapshot file', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: TEST_DIR })
    await ledger.appendEvent({ type: 'snap', payload: { n: 1 } })
    await ledger.appendEvent({ type: 'snap', payload: { n: 2 } })

    await ledger.snapshot()

    const snapFiles = (await fs.readdir(TEST_DIR)).filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    assert.equal(snapFiles.length, 1)

    const snapContent = await fs.readFile(path.join(TEST_DIR, snapFiles[0]), 'utf8')
    const snapshot = JSON.parse(snapContent)
    assert.equal(snapshot.events.length, 2)
    assert.ok(snapshot.checksum)
  })

  test('recover loads from latest snapshot and replays remaining events', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: TEST_DIR })
    await ledger.appendEvent({ type: 'rec', payload: { n: 1 } })
    await ledger.appendEvent({ type: 'rec', payload: { n: 2 } })
    await ledger.snapshot()
    await ledger.appendEvent({ type: 'rec', payload: { n: 3 } })
    await ledger.appendEvent({ type: 'rec', payload: { n: 4 } })

    // Create new ledger instance to simulate recovery
    const recovered = new EventLedger({ baseDir: TEST_DIR })
    const events = await recovered.getEvents()
    assert.equal(events.length, 4)
    assert.equal(events[0].payload.n, 1)
    assert.equal(events[3].payload.n, 4)
  })

  test('idempotency survives restart and concurrent appends preserve every event', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const first = new EventLedger({ baseDir: TEST_DIR })
    await Promise.all(Array.from({ length: 20 }, (_, i) => first.appendEvent({ type: 'concurrent', payload: { i } })))
    await first.appendEvent({ type: 'once', payload: { n: 1 } }, 'persistent-key')
    const restarted = new EventLedger({ baseDir: TEST_DIR })
    await restarted.appendEvent({ type: 'once', payload: { n: 2 } }, 'persistent-key')
    const events = await restarted.getEvents()
    assert.equal(events.length, 21)
    assert.equal(events.filter(event => event.type === 'once').length, 1)
    assert.deepEqual(events.filter(event => event.type === 'concurrent').map(event => event.payload.i).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i))
  })

  test('recovery ignores a corrupt latest snapshot and keeps the journal', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: TEST_DIR })
    await ledger.appendEvent({ type: 'safe', payload: { n: 1 } })
    await ledger.snapshot()
    await fs.writeFile(path.join(TEST_DIR, `snapshot-${Date.now() + 1000}-corrupt.json`), '{bad json')
    await ledger.appendEvent({ type: 'safe', payload: { n: 2 } })
    const recovered = await new EventLedger({ baseDir: TEST_DIR }).recover()
    assert.deepEqual(recovered.map(event => event.payload.n), [1, 2])
  })

  test('persistence failure surfaces as error', async () => {
    const { EventLedger } = await import('../src/storage/ledger.mjs')
    const ledger = new EventLedger({ baseDir: '/invalid/path/that/does/not/exist' })

    try {
      await ledger.appendEvent({ type: 'fail', payload: {} })
      assert.fail('Should have thrown')
    } catch (err) {
      assert.ok(err instanceof Error)
      assert.match(err.message, /permission|ENOENT|EACCES|not writable|invalid/i)
    }
  })
})
