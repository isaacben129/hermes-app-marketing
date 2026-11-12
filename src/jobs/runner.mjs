import { EventLedger } from '../storage/ledger.mjs'

const transitions = {
  queued: new Set(['running', 'cancelled']),
  running: new Set(['succeeded', 'failed', 'cancelled']),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set()
}

export class LocalJobRunner {
  #ledger
  #jobs = new Map()
  #writeQueue = Promise.resolve()

  constructor({ ledger = new EventLedger({ baseDir: '.local-ledger' }) } = {}) {
    this.#ledger = ledger
  }

  async #record(job, from, to, details = {}) {
    const event = await this.#ledger.appendEvent({
      type: 'job.lifecycle',
      payload: { jobId: job.id, from, to, ...details }
    }, `job:${job.id}:${to}`)
    job.status = to
    job.updatedAt = event.timestamp
    return { ...job }
  }

  async #enqueue(operation) {
    const result = this.#writeQueue.then(operation)
    this.#writeQueue = result.catch(() => {})
    return result
  }

  async submit({ id, name, input = {} }) {
    if (!id || !name) throw new TypeError('Job id and name are required')
    if (this.#jobs.has(id)) throw new Error(`Job already exists: ${id}`)
    const job = { id, name, input, status: 'queued', createdAt: new Date().toISOString() }
    this.#jobs.set(id, job)
    try {
      return await this.#enqueue(() => this.#record(job, null, 'queued'))
    } catch (error) {
      this.#jobs.delete(id)
      throw error
    }
  }

  async transition(id, status, details = {}) {
    return this.#enqueue(async () => {
      const job = this.#jobs.get(id)
      if (!job) throw new Error(`Unknown job: ${id}`)
      if (!transitions[job.status]?.has(status)) {
        throw new Error(`Illegal job transition: ${job.status} -> ${status}`)
      }
      if (details.externalSideEffect || details.effect === 'external') {
        throw new Error('External side effects are not allowed by the local job runner')
      }
      return this.#record(job, job.status, status, details)
    })
  }

  async runLocal(id, work) {
    if (typeof work !== 'function') throw new TypeError('Local work callback is required')
    await this.transition(id, 'running')
    try {
      const result = await work()
      await this.transition(id, 'succeeded')
      return result
    } catch (error) {
      await this.transition(id, 'failed', { error: String(error?.message ?? error) })
      throw error
    }
  }

  get(id) {
    const job = this.#jobs.get(id)
    return job ? { ...job } : null
  }

  list() {
    return [...this.#jobs.values()].map(job => ({ ...job }))
  }
}
