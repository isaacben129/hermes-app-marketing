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
      payload: { jobId: job.id, from, to, name: job.name, input: job.input, ...details }
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

  async restore(events) {
    const journal = events ?? await this.#ledger.getEvents()
    for (const event of journal) { if (event.type !== 'job.lifecycle') continue; const p=event.payload??{}; let job=this.#jobs.get(p.jobId); if(!job && p.to==='queued'){job={id:p.jobId,name:p.name??'local task',input:p.input??{},status:'queued',createdAt:event.timestamp,updatedAt:event.timestamp};this.#jobs.set(job.id,job)} if(job){job.status=p.to;job.updatedAt=event.timestamp;if(p.artifactId)job.artifactId=p.artifactId;if(p.to==='failed')job.failureCategory=p.category??'failed'}}
    for(const job of this.#jobs.values())if(job.status==='running'){await this.#record(job,'running','failed',{category:'interrupted'});job.failureCategory='interrupted'}
    return this.list()
  }

  get(id) {
    const job = this.#jobs.get(id)
    return job ? { ...job } : null
  }

  list() {
    return [...this.#jobs.values()].map(job => ({ ...job }))
  }
}
