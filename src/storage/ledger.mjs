import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export class EventLedger {
  #baseDir
  #eventsFile
  #idempotencyFile
  #snapshotsDir
  #idempotencyCache = new Map()
  #idempotencyLoaded = false
  #writeQueue = Promise.resolve()

  constructor({ baseDir }) {
    this.#baseDir = baseDir
    this.#eventsFile = path.join(baseDir, 'events.jsonl')
    this.#idempotencyFile = path.join(baseDir, 'idempotency.json')
    this.#snapshotsDir = path.join(baseDir, 'snapshots')
  }

  async #ensureDirs() {
    await fs.mkdir(this.#baseDir, { recursive: true })
    await fs.mkdir(this.#snapshotsDir, { recursive: true })
  }

  async #loadIdempotencyCache() {
    if (this.#idempotencyLoaded) return
    try {
      const data = JSON.parse(await fs.readFile(this.#idempotencyFile, 'utf8'))
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [key, eventId] of Object.entries(data)) {
          if (typeof eventId === 'string') this.#idempotencyCache.set(key, eventId)
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    this.#idempotencyLoaded = true
  }

  async #saveIdempotencyCache() {
    const tempFile = `${this.#idempotencyFile}.${crypto.randomUUID()}.tmp`
    try {
      await fs.writeFile(tempFile, JSON.stringify(Object.fromEntries(this.#idempotencyCache)), { flag: 'wx' })
      await fs.rename(tempFile, this.#idempotencyFile)
    } catch (error) {
      await fs.rm(tempFile, { force: true }).catch(() => {})
      throw error
    }
  }

  #serializeWrite(operation) {
    const result = this.#writeQueue.then(operation)
    this.#writeQueue = result.catch(() => {})
    return result
  }

  #generateId() {
    return crypto.randomUUID()
  }

  #generateChecksum(data) {
    return crypto.createHash('sha256').update(data).digest('hex')
  }

  async #readJournal() {
    let content
    try {
      content = await fs.readFile(this.#eventsFile, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    return content.split('\n').filter(Boolean).map(line => JSON.parse(line))
  }

  async appendEvent(event, idempotencyKey) {
    return this.#serializeWrite(async () => {
      await this.#ensureDirs()
      await this.#loadIdempotencyCache()
      if (idempotencyKey && this.#idempotencyCache.has(idempotencyKey)) {
        const existingId = this.#idempotencyCache.get(idempotencyKey)
        return (await this.#readAllEvents()).find(item => item.id === existingId)
      }

      const eventRecord = {
        id: this.#generateId(),
        timestamp: new Date().toISOString(),
        type: event.type,
        payload: event.payload
      }
      const line = `${JSON.stringify(eventRecord)}\n`
      await fs.appendFile(this.#eventsFile, line, { encoding: 'utf8', flag: 'a' })

      if (idempotencyKey) {
        this.#idempotencyCache.set(idempotencyKey, eventRecord.id)
        try {
          await this.#saveIdempotencyCache()
        } catch (error) {
          this.#idempotencyCache.delete(idempotencyKey)
          throw error
        }
      }
      return eventRecord
    })
  }

  async #readAllEvents() {
    const snapshot = await this.#loadLatestSnapshot()
    const journal = await this.#readJournal()
    return snapshot && journal.length < snapshot.eventCount ? [...snapshot.events, ...journal] : journal
  }

  async getEvents({ type, limit, offset = 0 } = {}) {
    await this.#ensureDirs()
    let events = await this.#readAllEvents()
    if (type) events = events.filter(event => event.type === type)
    if (offset) events = events.slice(offset)
    if (limit !== undefined) events = events.slice(0, limit)
    return events
  }

  async snapshot() {
    return this.#serializeWrite(async () => {
      await this.#ensureDirs()
      const events = await this.#readAllEvents()
      const snapshotData = {
        timestamp: new Date().toISOString(),
        eventCount: events.length,
        events,
        checksum: this.#generateChecksum(JSON.stringify(events))
      }
      const snapshotFile = path.join(this.#baseDir, `snapshot-${Date.now()}-${crypto.randomUUID()}.json`)
      const tempFile = `${snapshotFile}.tmp`
      try {
        await fs.writeFile(tempFile, JSON.stringify(snapshotData, null, 2), { encoding: 'utf8', flag: 'wx' })
        await fs.rename(tempFile, snapshotFile)
      } catch (error) {
        await fs.rm(tempFile, { force: true }).catch(() => {})
        throw error
      }
      return snapshotData
    })
  }

  async #loadLatestSnapshot() {
    let snapshots
    try {
      snapshots = (await fs.readdir(this.#baseDir))
        .filter(file => file.startsWith('snapshot-') && file.endsWith('.json'))
        .sort()
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    for (const file of snapshots.reverse()) {
      try {
        const snapshot = JSON.parse(await fs.readFile(path.join(this.#baseDir, file), 'utf8'))
        if (!Array.isArray(snapshot.events) || snapshot.eventCount !== snapshot.events.length) continue
        if (this.#generateChecksum(JSON.stringify(snapshot.events)) !== snapshot.checksum) continue
        return snapshot
      } catch {
        // Skip corrupt snapshots and attempt an earlier valid one.
      }
    }
    return null
  }

  async recover() {
    await this.#ensureDirs()
    return this.#readAllEvents()
  }
}
