import crypto from 'node:crypto'

const contentHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && !value.includes('..')

export function createActions({ workspace, ledger, runner, renderer, artifacts, clock = () => new Date().toISOString() }) {
  const retryResults = new Map()
  const health = async () => {
    let rendererStatus = 'unavailable'
    let rendererError = null
    let lastSuccess = null
    try { await renderer.health(); rendererStatus = 'healthy'; lastSuccess = clock() }
    catch (error) { rendererStatus = error.code === 'protocol_mismatch' ? 'attention' : 'unavailable'; rendererError = error.code === 'protocol_mismatch' ? 'protocol_mismatch' : 'unavailable' }
    const jobs = runner.list()
    return { version: 1, observedAt: clock(), services: [{ name: 'renderer', status: rendererStatus, lastSuccess, error: rendererError }, { name: 'postiz', status: 'unavailable', lastSuccess: null, error: null }, { name: 'app-outcomes', status: 'unavailable', lastSuccess: null, error: null }], jobs: { queued: jobs.filter(job => job.status === 'queued').length, running: jobs.filter(job => job.status === 'running').length, failed: jobs.filter(job => job.status === 'failed').length } }
  }

  const renderDraft = async ({ jobId, draftId, revision, retryOf }) => {
    if (!renderer) throw Object.assign(new Error('Renderer unavailable'), { code: 'unavailable' })
    if (!safeId(jobId) || !safeId(draftId)) throw Object.assign(new Error('Invalid identifier'), { code: 'invalid_input' })
    const current = await workspace.load((await workspace.findDraft(draftId))?.app)
    const record = current.drafts.find(draft => draft.id === draftId)
    if (!record) throw Object.assign(new Error('Draft missing'), { code: 'invalid_input' })
    if (current.revision !== revision) throw Object.assign(new Error('Stale revision'), { code: 'stale_revision' })
    const payload = await workspace.rendererPayload(record)
    await runner.submit({ id: jobId, name: 'render', input: { draftId, revision, ...(retryOf ? { retryOf } : {}) } })
    try {
      await runner.transition(jobId, 'running')
      const rendered = await renderer.render(payload)
      const artifact = { jobId, draftId, app: record.app, revision, contentHash: contentHash(record), rendered, createdAt: clock() }
      const stored = await artifacts.save(artifact)
      await runner.transition(jobId, 'succeeded', { artifactId: stored.id })
      return { jobId, rendered }
    } catch (error) {
      await runner.transition(jobId, 'failed', { category: 'render_failed' })
      throw Object.assign(new Error('Rendering failed'), { code: 'render_failed', cause: error })
    }
  }

  const exportDraft = async ({ draftId, revision, renderJobId }) => {
    const job = runner.get(renderJobId)
    const artifact = await artifacts.get?.(renderJobId)
    if (!job || job.status !== 'succeeded' || !artifact || artifact.draftId !== draftId || artifact.revision !== revision || artifact.jobId !== renderJobId) throw Object.assign(new Error('Rendered artifact unavailable'), { code: 'invalid_input' })
    const record = await workspace.findDraft(draftId)
    const current = record && await workspace.load(record.app)
    if (!record || record.app !== artifact.app || current.revision !== revision || contentHash(record) !== artifact.contentHash) throw Object.assign(new Error('Rendered artifact is obsolete'), { code: 'stale_revision' })
    if (typeof renderer.export !== 'function') throw Object.assign(new Error('Renderer export unavailable'), { code: 'unavailable' })
    const result = await renderer.export({ rendered: artifact.rendered, source: { app: artifact.app, draftId, revision, renderJobId } })
    const rendered = { ...artifact.rendered, slides: (artifact.rendered.slides ?? []).map(({ pngBase64, ...slide }) => slide) }
    return { zipBase64: result.zipBase64, manifest: { app: artifact.app, draftId, revision, renderJobId, contentHash: artifact.contentHash, rendered } }
  }

  const jobWithEvents = async job => {
    if (!job) return null
    const events = (await ledger.getEvents({ type: 'job.lifecycle' }))
      .filter(event => event.payload?.jobId === job.id)
      .map(event => ({ at: event.timestamp, status: event.payload?.to, ...(event.payload?.category ? { category: event.payload.category } : {}) }))
    return { ...job, events }
  }
  const jobsWithEvents = async () => Promise.all(runner.list().map(jobWithEvents))

  return {
    health,
    workspace: app => workspace.load(app),
    saveDraft: input => workspace.saveDraft(input),
    importLegacy: input => workspace.importLegacy(input),
    jobs: jobsWithEvents,
    job: async id => jobWithEvents(runner.get(id)),
    retry: async id => {
      if (retryResults.has(id)) return retryResults.get(id)
      const old = runner.get(id)
      if (!old || old.status !== 'failed') throw Object.assign(new Error('Retry unavailable'), { code: 'invalid_input' })
      if (old.name !== 'render') throw Object.assign(new Error('This job cannot be retried'), { code: 'invalid_input' })
      if (!safeId(id)) throw Object.assign(new Error('Invalid identifier'), { code: 'invalid_input' })
      const prior = runner.list().find(job => job.input?.retryOf === id)
      if (prior) {
        if (prior.status === 'succeeded') {
          const artifact = await artifacts.get?.(prior.id)
          if (artifact) return { jobId: prior.id, rendered: artifact.rendered }
        }
        throw Object.assign(new Error('Retry already recorded'), { code: 'invalid_input' })
      }
      const attempt = Promise.resolve().then(() => renderDraft({ ...old.input, jobId: crypto.randomUUID(), retryOf: id }))
      retryResults.set(id, attempt)
      try { return await attempt } catch (error) { retryResults.delete(id); throw error }
    },
    renderDraft,
    exportDraft,
    sync: async () => ({ status: 'unavailable' }),
    importOutcomes: async () => { throw Object.assign(new Error('Unavailable'), { code: 'unavailable' }) }
  }
}
