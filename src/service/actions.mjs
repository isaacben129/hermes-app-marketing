import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { validateAppProfile } from '../domain/profiles.mjs'
import { evaluateQuality } from '../domain/quality.mjs'
import { validateGeneratedAsset } from '../domain/generation.mjs'
import { recommendExperiment } from '../domain/experiments.mjs'
import { normalizeOutcomeRows } from '../integrations/outcomes.mjs'
import sourceEvidence from '../domain/source-evidence.cjs'

const reviewContent = value => { const copy = structuredClone(value); for (const key of ['quality', 'readiness', 'generatedAssets', 'qualityReviews']) delete copy[key]; return copy }
const contentHash = value => crypto.createHash('sha256').update(JSON.stringify(reviewContent(value))).digest('hex')
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && !value.includes('..')
const safeApp = value => typeof value === 'string' && value === value.trim() && /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,99}$/u.test(value)
const validWindow = value => value && typeof value.start === 'string' && typeof value.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.start) && /^\d{4}-\d{2}-\d{2}$/.test(value.end) && Number.isFinite(Date.parse(`${value.start}T00:00:00Z`)) && Number.isFinite(Date.parse(`${value.end}T00:00:00Z`)) && value.start <= value.end && new Date(`${value.start}T00:00:00Z`).toISOString().slice(0, 10) === value.start && new Date(`${value.end}T00:00:00Z`).toISOString().slice(0, 10) === value.end
const hasCredentialField = value => Array.isArray(value)
  ? value.some(hasCredentialField)
  : value && typeof value === 'object'
    ? Object.entries(value).some(([key, nested]) => /token|secret|password|api.?key|authorization/i.test(key) || hasCredentialField(nested))
    : false

export function createActions({ workspace, ledger, runner, renderer, artifacts, postizReader = null, python = process.env.PYTHON ?? 'python3', clock = () => new Date().toISOString() }) {
  const retryResults = new Map()
  let postizLastSuccess = null
  const health = async () => {
    let rendererStatus = 'unavailable'
    let rendererError = null
    let lastSuccess = null
    try { await renderer.health(); rendererStatus = 'healthy'; lastSuccess = clock() }
    catch (error) { rendererStatus = error.code === 'protocol_mismatch' ? 'attention' : 'unavailable'; rendererError = error.code === 'protocol_mismatch' ? 'protocol_mismatch' : 'unavailable' }
    const jobs = runner.list()
    const providerEvents = await ledger.getEvents()
    const postizEvents = providerEvents.filter(event => ['postiz.synced', 'postiz.sync_failed'].includes(event.type))
    const latestPostiz = postizEvents.at(-1)
    const lastPostizSuccess = [...postizEvents].reverse().find(event => event.type === 'postiz.synced')?.payload?.syncedAt ?? null
    const postizStatus = !latestPostiz ? 'disconnected' : latestPostiz.type === 'postiz.sync_failed' ? (lastPostizSuccess ? 'attention' : 'unavailable') : latestPostiz.payload?.degraded ? 'attention' : 'healthy'
    const outcomeSuccess = [...providerEvents].reverse().find(event => event.type === 'observations.imported')?.timestamp ?? null
    return { version: 1, observedAt: clock(), services: [{ name: 'renderer', status: rendererStatus, lastSuccess, error: rendererError }, { name: 'postiz', status: postizStatus, lastSuccess: lastPostizSuccess, error: latestPostiz?.type === 'postiz.sync_failed' ? latestPostiz.payload.errorCode : latestPostiz?.payload?.degraded ? 'unavailable' : null }, { name: 'app-outcomes', status: outcomeSuccess ? 'healthy' : 'disconnected', lastSuccess: outcomeSuccess, error: null }], jobs: { queued: jobs.filter(job => job.status === 'queued').length, running: jobs.filter(job => job.status === 'running').length, failed: jobs.filter(job => job.status === 'failed').length } }
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
  const requireWorkspaceRevision = async (app, revision) => {
    if (!safeApp(app) || !Number.isSafeInteger(revision) || revision < 0) throw Object.assign(new TypeError('app and expected revision are required'), { code: 'invalid_input' })
    const state = await workspace.load(app)
    if (state.revision !== revision) throw Object.assign(new Error('Workspace revision is stale'), { code: 'stale_revision' })
    return state
  }
  const persist = async (type, app, payload, revision) => workspace.record({ type, app, payload, expectedRevision: revision })

  return {
    health,
    workspace: app => { if (!safeApp(app)) throw Object.assign(new TypeError('app is required'), { code: 'invalid_input' }); return workspace.load(app) },
    saveDraft: async input => {
      if (!safeApp(input?.draft?.app)) throw Object.assign(new TypeError('Draft app is invalid'), { code: 'invalid_input' })
      if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) throw Object.assign(new TypeError('expectedRevision is invalid'), { code: 'invalid_input' })
      const existing = await workspace.findDraft(input.draft.id)
      const draft = structuredClone(input.draft)
      if (existing && contentHash(existing) !== contentHash(draft)) delete draft.qualityReviews
      return workspace.saveDraft({ ...input, draft })
    },
    saveProfile: async ({ app, expectedRevision, profile }) => {
      const state = await requireWorkspaceRevision(app, expectedRevision)
      validateAppProfile(profile)
      if (profile.name !== app || profile.appId !== app.toLowerCase() || !/^[a-z0-9][a-z0-9_-]*$/.test(profile.appId)) throw Object.assign(new TypeError('Profile identity must match app scope'), { code: 'invalid_input' })
      const only = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key))
      if (!only(profile, ['appId', 'name', 'brand', 'configuration']) || !only(profile.brand, ['promise', 'source', 'tone', 'avoidClaims']) || (profile.brand.source && !only(profile.brand.source, ['locator', 'version'])) || !only(profile.configuration, ['cta', 'channel', 'claims', 'rights', 'qualifiedEvent', 'paidEvent', 'privacyPolicy']) || Object.values(profile.configuration).some(item => !only(item, ['value', 'status', 'evidenceRef', 'reviewer', 'reviewedAt'])) || hasCredentialField(profile) || /:\/\/|[?#@]/.test(profile.brand.source?.locator ?? '')) throw Object.assign(new TypeError('Profile contains unsupported or unsafe fields'), { code: 'invalid_input' })
      const revision = await persist('profile.saved', app, { profile: structuredClone(profile) }, state.revision)
      return { revision, profile }
    },
    review: async ({ draftId, revision }) => {
      const found = await workspace.findDraft(draftId)
      if (!found) throw Object.assign(new Error('Draft missing'), { code: 'invalid_input' })
      const state = await requireWorkspaceRevision(found.app, revision)
      const draft = state.drafts.find(item => item.id === draftId)
      if (!draft) throw Object.assign(new Error('Draft missing'), { code: 'invalid_input' })
      const evidence = Array.isArray(draft.evidence) ? draft.evidence : []
      const readiness = sourceEvidence.evaluateCreativeReadiness({ evidence, claims: Array.isArray(draft.claims) ? draft.claims : [] })
      const imageMissing = !Array.isArray(draft.slides) || !draft.slides.length || draft.slides.some(slide => !slide.selectedImage?.contentRef)
      const blockerCodes = new Set((readiness.blockers ?? []).map(item => item.code))
      const rightsUnknown = evidence.length === 0 || evidence.some(item => !item.rights || item.rights.status !== 'cleared' || item.rights.attestation?.attesterType !== 'human') || ['rights_unknown', 'rights_pending', 'rights_attestation_missing', 'invalid_rights_attestation', 'missing_rights_record', 'missing_rights_status'].some(code => blockerCodes.has(code))
      const restrictedRights = evidence.some(item => item.rights?.status === 'restricted')
      const profile = state.profiles.find(item => item.appId === found.app.toLowerCase())
      const checks = {
        missingImage: imageMissing,
        unknownRights: rightsUnknown,
        restrictedRights,
        unsupportedClaim: ['fact_without_evidence', 'invalid_evidence_pointer', 'evidence_pointer_unresolved', 'fact_evidence_invalid', 'claim_classification_unknown', 'invalid_claim_record'].some(code => blockerCodes.has(code)),
        unapprovedCta: !profile || profile.configuration?.cta?.status !== 'approved'
      }
      const stableRevision = state.draftRevisions?.[draftId] ?? revision
      const evidenceCounts = new Map()
      for (const item of evidence) if (item?.id) evidenceCounts.set(item.id, (evidenceCounts.get(item.id) ?? 0) + 1)
      const refs = new Set(evidence.filter(item => item?.id && evidenceCounts.get(item.id) === 1 && sourceEvidence.validateEvidenceRecord(item).length === 0).map(item => item.id))
      for (const job of runner.list()) if (job.status === 'succeeded' && await artifacts.get?.(job.id)) refs.add(job.id)
      const reviews = (Array.isArray(draft.qualityReviews) ? draft.qualityReviews : []).map(review => {
        const evidenceRefs = (review.evidenceRefs ?? []).filter(ref => refs.has(ref))
        return { ...review, revision: stableRevision, ...(review.score !== null && evidenceRefs.length !== (review.evidenceRefs ?? []).length ? { score: null, rationale: '', evidenceRefs: [] } : { evidenceRefs }) }
      })
      const quality = evaluateQuality({ revision: stableRevision, reviews, automatedChecks: checks })
      const contentHashValue = contentHash(draft)
      const newRevision = await persist('review.completed', draft.app, { draftId, contentHash: contentHashValue, readiness, quality }, state.revision)
      return { revision: newRevision, readiness, quality }
    },
    intakeGeneration: async ({ draftId, revision, asset }) => {
      const found = await workspace.findDraft(draftId)
      if (!found) throw Object.assign(new Error('Draft missing'), { code: 'invalid_input' })
      const state = await requireWorkspaceRevision(found.app, revision)
      if (!asset || asset.draftId !== draftId) throw Object.assign(new TypeError('Asset draft identity mismatch'), { code: 'invalid_input' })
      const match = typeof asset.dataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(asset.dataUrl)
      if (!match) throw Object.assign(new TypeError('Generated asset bytes are required'), { code: 'invalid_input' })
      const bytes = Buffer.from(match[2], 'base64')
      if (bytes.toString('base64') !== match[2] || bytes.length > 12 * 1024 * 1024) throw Object.assign(new TypeError('Invalid generated image data'), { code: 'invalid_input' })
      const validation = spawnSync(python, ['-c', "import io,json,sys; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); fmt=im.format; w,h=im.size; assert w>0 and h>0 and w*h<=40000000; im.load(); print(json.dumps({'format':fmt}))"], { input: bytes, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 })
      let imageInfo
      try { if (validation.status !== 0 || validation.error) throw Error(); imageInfo = JSON.parse(validation.stdout) } catch { throw Object.assign(new TypeError('Generated image is invalid'), { code: 'invalid_input' }) }
      if (imageInfo.format !== ({ png: 'PNG', jpeg: 'JPEG', webp: 'WEBP' }[match[1]])) throw Object.assign(new TypeError('Generated image format does not match declaration'), { code: 'invalid_input' })
      const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
      const normalized = validateGeneratedAsset(asset, { expectedRevision: revision, actualSha256 })
      normalized.contentRef = await workspace.storeGeneratedImage(bytes, actualSha256)
      normalized.mimeType = `image/${match[1]}`
      const newRevision = await persist('generation.intake', found.app, { draftId, asset: normalized }, state.revision)
      return { revision: newRevision, asset: normalized }
    },
    recommend: async ({ draftId, revision, experiment, observations }) => {
      const found = await workspace.findDraft(draftId)
      if (!found) throw Object.assign(new Error('Draft missing'), { code: 'invalid_input' })
      const state = await requireWorkspaceRevision(found.app, revision)
      if (!Array.isArray(observations)) throw Object.assign(new TypeError('observations must be an array'), { code: 'invalid_input' })
      if (experiment?.appId !== found.app.toLowerCase()) throw Object.assign(new TypeError('Experiment app must match draft'), { code: 'invalid_input' })
      const experimentFields = ['appId', 'changedVariable', 'baseline', 'variant', 'primaryMetric', 'window', 'minExposure', 'minOutcomeCoverage', 'policy']
      const policyFields = ['version', 'approved', 'killBelow', 'keepAtOrAbove', 'maxSourceAgeMs', 'iterateWhenMixed']
      const observationFields = ['cell', 'appId', 'metric', 'status', 'fixtureOnly', 'attributionVerified', 'evidenceId', 'source', 'windowStart', 'windowEnd', 'observedAt', 'exposure', 'outcome', 'coverage']
      if (!experiment || typeof experiment !== 'object' || Array.isArray(experiment) || Object.keys(experiment).some(key => !experimentFields.includes(key)) || (experiment.policy && (typeof experiment.policy !== 'object' || Array.isArray(experiment.policy) || Object.keys(experiment.policy).some(key => !policyFields.includes(key))))) throw Object.assign(new TypeError('Experiment contains unsupported fields'), { code: 'invalid_input' })
      if (observations.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !observationFields.includes(key)) || Object.values(item).some(value => typeof value === 'object' && value !== null))) throw Object.assign(new TypeError('Observation contains unsupported fields'), { code: 'invalid_input' })
      const decision = recommendExperiment({ experiment, observations, now: clock() })
      const newRevision = await persist('experiment.recommended', found.app, { draftId, decision: { ...decision, experiment: structuredClone(experiment), observations: structuredClone(observations), draftRevision: revision, recordedAt: clock() } }, state.revision)
      return { revision: newRevision, decision }
    },
    deleteDraft: async ({ draftId, app, expectedRevision }) => {
      if (!safeApp(app) || !safeId(draftId)) throw Object.assign(new TypeError('Draft or app id is invalid'), { code: 'invalid_input' })
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Object.assign(new TypeError('expectedRevision is invalid'), { code: 'invalid_input' })
      const revision = await workspace.deleteDraft({ draftId, app, expectedRevision })
      return { revision, deleted: true }
    },
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
    sync: async ({ app, window, days } = {}) => {
      if (!safeApp(app)) throw Object.assign(new TypeError('app is required'), { code: 'invalid_input' })
      if (!validWindow(window) || !Number.isInteger(days) || days < 1 || days > 365) throw Object.assign(new TypeError('window and days are invalid'), { code: 'invalid_input' })
      const state = await workspace.load(app)
      if (!postizReader) {
        try { await persist('postiz.sync_failed', app, { errorCode: 'unavailable', failedAt: clock() }, state.revision) } catch {}
        const staleState = await workspace.load(app)
        const lastSuccess = [...await ledger.getEvents()].reverse().find(event => event.type === 'postiz.synced' && event.payload?.app === app)?.payload?.syncedAt ?? null
        return { status: 'unavailable', posts: staleState.posts ?? [], observations: (staleState.observations ?? []).filter(item => item.source === 'postiz'), lastSuccess, error: { code: 'unavailable' } }
      }
      try {
        const profile = state.profiles.find(item => item.appId === app.toLowerCase())
        const [integrations, listedPosts] = await Promise.all([postizReader.listIntegrations(), postizReader.listPosts({ window })])
        const channel = profile?.configuration?.channel
        const channelId = channel?.status === 'approved' ? (typeof channel.value === 'string' ? channel.value : channel.value?.integrationId) : null
        const integration = channelId && integrations.find(item => item.id === channelId && item.disabled !== true)
        if (!integration) {
          const lastSuccess = [...await ledger.getEvents()].reverse().find(event => event.type === 'postiz.synced' && event.payload?.app === app)?.payload?.syncedAt ?? null
          return { status: 'blocked', posts: state.posts ?? [], observations: (state.observations ?? []).filter(item => item.source === 'postiz'), lastSuccess, error: { code: channelId ? 'channel_unmatched' : 'channel_unconfigured' } }
        }
        const matchedPosts = integration ? listedPosts.filter(post => post.integration?.id === integration.id) : []
        const posts = matchedPosts.map(post => ({ id: post.id, content: post.content, publishDate: post.publishDate, releaseURL: post.releaseURL, state: post.state, integration: post.integration, channelMatch: { status: 'matched', profileIntegrationId: integration.id, providerIntegrationId: post.integration.id }, syncedAt: clock() }))
        const observations = []
        let staleMetrics = false
        for (const post of posts) {
          const metrics = await postizReader.readMetrics({ postId: post.id, days, appId: app.toLowerCase(), creativeRevision: null })
          if (metrics.status === 'unavailable') throw Object.assign(new Error('Postiz metrics unavailable'), { code: metrics.error?.code ?? 'unavailable' })
          if (metrics.status === 'stale') staleMetrics = true
          if (metrics.status === 'available' || metrics.status === 'stale') observations.push(...metrics.observations.map(item => ({ ...item, creativeRevision: Number.isSafeInteger(item.creativeRevision) && item.creativeRevision >= 0 ? item.creativeRevision : null, attribution: item.attribution ?? { status: 'unmapped' }, ...(metrics.status === 'stale' ? { status: 'stale' } : {}) })))
        }
        const unmatchedCount = listedPosts.length - matchedPosts.length
        const revision = await persist('postiz.synced', app, { posts, observations, unmatchedCount, syncedAt: clock(), degraded: staleMetrics }, state.revision)
        postizLastSuccess = clock()
        return { status: 'connected', posts, observations, unmatchedCount, lastSuccess: postizLastSuccess, revision }
      } catch (error) {
        const code = error.code ?? 'unavailable'
        try { await persist('postiz.sync_failed', app, { errorCode: code, failedAt: clock() }, state.revision) } catch {}
        const staleState = await workspace.load(app)
        const lastSuccess = [...await ledger.getEvents()].reverse().find(event => event.type === 'postiz.synced' && event.payload?.app === app)?.payload?.syncedAt ?? null
        return { status: 'unavailable', posts: staleState.posts ?? [], observations: (staleState.observations ?? []).filter(item => item.source === 'postiz'), lastSuccess, error: { code } }
      }
    },
    importOutcomes: async ({ app, rows, eventDefinitions, attributionPolicy, source, window } = {}) => {
      if (!safeApp(app)) throw Object.assign(new TypeError('app is invalid'), { code: 'invalid_input' })
      const state = await workspace.load(app)
      const profile = state.profiles.find(item => item.appId === app.toLowerCase())
      if (!profile || profile.configuration?.qualifiedEvent?.status !== 'approved' || profile.configuration?.paidEvent?.status !== 'approved' || profile.configuration?.privacyPolicy?.status !== 'approved') throw Object.assign(new Error('Approved event and privacy profile configuration is required'), { code: 'invalid_input' })
      if (source?.appId !== app.toLowerCase()) throw Object.assign(new TypeError('Outcome source app does not match'), { code: 'invalid_input' })
      if (typeof source.locator !== 'string' || source.locator.length > 200 || /:\/\/|[?#@]|(?:token|secret|password|api[-_]?key)/i.test(source.locator)) throw Object.assign(new TypeError('Outcome source locator is not a safe local reference'), { code: 'invalid_input' })
      const allowed = new Map([[profile.configuration.qualifiedEvent.value, 'qualified'], [profile.configuration.paidEvent.value, 'paid']])
      if (!Array.isArray(eventDefinitions) || eventDefinitions.some(definition => allowed.get(definition?.name) !== definition?.kind)) throw Object.assign(new TypeError('Event definitions must match approved profile events'), { code: 'invalid_input' })
      const observations = normalizeOutcomeRows({ rows, eventDefinitions, attributionPolicy, source, window })
      const revision = await persist('observations.imported', app, { observations }, state.revision)
      return { revision, observations }
    }
  }
}
