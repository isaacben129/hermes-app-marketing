import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const empty = () => ({ revision: 0, profiles: [], drafts: [], observations: [], decisions: [], posts: [], draftRevisions: {} })
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const imageData = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && !value.includes('..')

export class WorkspaceStore {
  #ledger
  #queue = Promise.resolve()
  constructor({ ledger }) { if (!ledger) throw new TypeError('ledger is required'); this.#ledger = ledger }

  async #normalizeDraft(input, existing = null) {
    const draft = structuredClone(input)
    for (const key of ['quality', 'readiness', 'review', 'approved', 'approval']) delete draft[key]
    if (!safeId(draft.id)) throw new TypeError('Invalid draft id')
    const images = []
    for (const slide of draft.slides ?? []) {
      const image = slide.selectedImage
      if (!image) continue
      if (image.dataUrl === undefined && typeof image.contentRef === 'string' && /^image:[a-f\d]{64}$/.test(image.contentRef)) {
        const digest = image.contentRef.slice(6)
        if (image.sha256 !== digest) throw new TypeError('Selected image reference hash mismatch')
        const priorImages = (existing?.slides ?? []).map(item => item.selectedImage).filter(Boolean)
        if (!priorImages.some(prior => prior.contentRef === image.contentRef && prior.sha256 === image.sha256 && prior.sourceRef === image.sourceRef)) throw new TypeError('Selected image reference is not owned by this saved draft')
        const bytes = await fs.readFile(path.join(this.#ledger.baseDir, 'images', digest))
        if (hash(bytes) !== digest) throw new Error('Stored image integrity check failed')
        images.push({ digest, type: image.mimeType?.replace('image/', '') ?? 'png' })
        continue
      }
      if (typeof image.dataUrl !== 'string') throw new TypeError('Selected image data is required')
      const match = imageData.exec(image.dataUrl)
      if (!match) throw new TypeError('Invalid selected image data')
      if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new TypeError('Image data exceeds limit')
      const bytes = Buffer.from(match[2], 'base64')
      if (bytes.toString('base64') !== match[2]) throw new TypeError('Invalid selected image data')
      if (bytes.length > MAX_IMAGE_BYTES) throw new TypeError('Image data exceeds limit')
      const digest = hash(bytes)
      if (typeof image.sha256 !== 'string' || image.sha256 !== digest) throw new TypeError('Selected image SHA-256 mismatch')
      if (typeof image.sourceRef !== 'string' || !image.sourceRef) throw new TypeError('Selected image source reference is required')
      const dir = path.join(this.#ledger.baseDir, 'images')
      await fs.mkdir(dir, { recursive: true, mode: 0o700 })
      const file = path.join(dir, digest)
      try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }) }
      catch (error) { if (error.code !== 'EEXIST') throw error; const existing = await fs.readFile(file); if (hash(existing) !== digest) throw new Error('Stored image integrity check failed') }
      image.contentRef = `image:${digest}`
      image.mimeType = `image/${match[1]}`
      delete image.dataUrl
      images.push({ digest, type: match[1] })
    }
    return draft
  }

  async storeGeneratedImage(bytes, digest) {
    if (!Buffer.isBuffer(bytes) || !/^[a-f\d]{64}$/.test(digest) || hash(bytes) !== digest) throw new TypeError('Generated image hash mismatch')
    const dir = path.join(this.#ledger.baseDir, 'images')
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const file = path.join(dir, digest)
    try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (hash(await fs.readFile(file)) !== digest) throw new Error('Stored image integrity check failed') }
    return `image:${digest}`
  }

  async #readDraft(draft) {
    const value = structuredClone(draft)
    for (const slide of value.slides ?? []) {
      const image = slide.selectedImage
      if (!image?.contentRef || !/^[a-f\d]{64}$/.test(image.contentRef.slice(6))) continue
      const bytes = await fs.readFile(path.join(this.#ledger.baseDir, 'images', image.contentRef.slice(6)))
      if (hash(bytes) !== image.sha256) throw new Error('Stored image integrity check failed')
    }
    return value
  }

  async load(app) {
    const state = empty()
    const events = await this.#ledger.getEvents()
    const migrations = new Set()
    for (const event of events) {
      const p = event.payload ?? {}
      if (event.type === 'draft.saved' && p.draft?.app === app) {
        state.revision++
        state.draftRevisions[p.draft.id] = Number.isSafeInteger(p.parentRevision) ? p.parentRevision + 1 : state.revision
        const index = state.drafts.findIndex(draft => draft.id === p.draft.id)
        const draft = await this.#readDraft(p.draft)
        if (index < 0) state.drafts.push(draft); else state.drafts[index] = draft
      }
      if (event.type === 'draft.deleted' && p.app === app) {
        state.revision++
        state.drafts = state.drafts.filter(draft => draft.id !== p.draftId)
      }
      if (p.app === app && ['profile.saved', 'review.completed', 'generation.intake', 'experiment.recommended', 'observations.imported', 'postiz.synced', 'postiz.sync_failed'].includes(event.type)) {
        state.revision++
        if (event.type === 'profile.saved') state.profiles = [p.profile]
        if (event.type === 'review.completed') state.drafts = state.drafts.map(draft => { const snapshot = structuredClone(draft); for (const key of ['quality', 'readiness', 'generatedAssets', 'qualityReviews']) delete snapshot[key]; return draft.id === p.draftId && hash(JSON.stringify(snapshot)) === p.contentHash ? { ...draft, quality: p.quality, readiness: p.readiness } : draft })
        if (event.type === 'generation.intake') state.drafts = state.drafts.map(draft => draft.id === p.draftId ? { ...draft, generatedAssets: [...(draft.generatedAssets ?? []), p.asset] } : draft)
        if (event.type === 'experiment.recommended') state.decisions.push(p.decision)
        if (event.type === 'observations.imported') state.observations.push(...p.observations)
        if (event.type === 'postiz.synced') {
          const byId = new Map(state.posts.map(post => [post.id, post]))
          for (const post of p.posts ?? []) byId.set(post.id, post)
          state.posts = [...byId.values()]
          const byEvidence = new Map(state.observations.map(item => [item.evidenceId, item]))
          for (const item of p.observations ?? []) byEvidence.set(item.evidenceId, item)
          state.observations = [...byEvidence.values()]
        }
        if (event.type === 'postiz.sync_failed') {
          state.posts = state.posts.map(post => ({ ...post, freshness: 'stale' }))
          state.observations = state.observations.map(item => item.source === 'postiz' ? { ...item, status: 'stale' } : item)
        }
      }
      if (event.type === 'workspace.imported' && p.migrationId && !migrations.has(p.migrationId)) {
        migrations.add(p.migrationId)
        const part = p.workspace?.[app]
        if (part) {
          state.revision++
          state.profiles.push(...(part.profiles ?? []))
          for (const input of part.drafts ?? []) {
            const draft = await this.#readDraft(input)
            state.draftRevisions[draft.id] = state.revision
            const index = state.drafts.findIndex(item => item.id === draft.id)
            if (index < 0) state.drafts.push(draft); else state.drafts[index] = draft
          }
        }
      }
    }
    return state
  }

  async findDraft(id) {
    const events = await this.#ledger.getEvents()
    const found = new Map()
    for (const event of events) {
      const p = event.payload ?? {}
      if (event.type === 'draft.saved' && p.draft?.id) found.set(p.draft.id, p.draft)
      if (event.type === 'workspace.imported') for (const part of Object.values(p.workspace ?? {})) for (const draft of part.drafts ?? []) found.set(draft.id, draft)
      if (event.type === 'draft.deleted') found.delete(p.draftId)
    }
    const draft = found.get(id)
    return draft ? this.#readDraft(draft) : null
  }

  async rendererPayload(source) {
    const draft = typeof source === 'string' ? await this.findDraft(source) : source
    if (!draft) throw Object.assign(new Error('Draft missing'), { code: 'invalid_input' })
    if (!Array.isArray(draft.slides) || !draft.slides.length) throw Object.assign(new Error('Draft has no slides'), { code: 'invalid_input' })
    const slides = []
    for (const slide of draft.slides) {
      const image = slide.selectedImage
      if (!image?.contentRef || typeof image.sourceRef !== 'string' || !image.sourceRef) throw Object.assign(new Error('Slide image and source reference are required'), { code: 'invalid_input' })
      if (!/^image:[a-f\d]{64}$/.test(image.contentRef)) throw Object.assign(new Error('Invalid stored image reference'), { code: 'invalid_input' })
      const bytes = await fs.readFile(path.join(this.#ledger.baseDir, 'images', image.contentRef.slice(6)))
      if (hash(bytes) !== image.sha256) throw Object.assign(new Error('Stored image integrity check failed'), { code: 'invalid_input' })
      const mime = image.mimeType?.replace('image/', '') ?? 'png'
      slides.push({ headline: slide.headline, body: slide.body, image_data_url: `data:image/${mime};base64,${bytes.toString('base64')}`, image_sha256: image.sha256, source_ref: image.sourceRef, crop: 'cover', text_position: slide.textPosition ?? 'center' })
    }
    return { width: 1080, height: 1920, title: draft.title ?? '', slides }
  }

  saveDraft({ draft, expectedRevision }) {
    return this.#serialize(() => this.#withLock(async () => {
      if (!draft || typeof draft.id !== 'string' || !draft.id || typeof draft.app !== 'string' || !draft.app) throw new TypeError('Invalid draft')
      const current = await this.load(draft.app)
      const existing = await this.findDraft(draft.id)
      if (existing && existing.app !== draft.app) throw Object.assign(new TypeError('Draft ID belongs to another app'), { code: 'invalid_input' })
      if (current.revision !== expectedRevision) throw Object.assign(new Error('Workspace revision is stale'), { code: 'stale_revision' })
      const normalized = await this.#normalizeDraft(draft, existing)
      const contentHash = hash(JSON.stringify(normalized))
      try { await this.#ledger.appendEvent({ type: 'draft.saved', payload: { draft: normalized, parentRevision: current.revision, contentHash } }) }
      catch (error) { throw Object.assign(new Error('Workspace persistence failed'), { code: 'persistence_failed', cause: error }) }
      return { revision: current.revision + 1, draft: await this.#readDraft(normalized) }
    }))
  }

  record({ type, app, payload, expectedRevision }) {
    return this.#serialize(() => this.#withLock(async () => {
      if (typeof app !== 'string' || !app.trim() || typeof type !== 'string' || !type || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Invalid workspace record')
      const current = await this.load(app)
      if (current.revision !== expectedRevision) throw Object.assign(new Error('Workspace revision is stale'), { code: 'stale_revision' })
      try { await this.#ledger.appendEvent({ type, payload: { ...payload, app, parentRevision: current.revision } }) }
      catch (error) { throw Object.assign(new Error('Workspace persistence failed'), { code: 'persistence_failed', cause: error }) }
      return current.revision + 1
    }))
  }

  deleteDraft({ draftId, app, expectedRevision }) {
    return this.#serialize(() => this.#withLock(async () => {
      const current = await this.load(app)
      const draft = await this.findDraft(draftId)
      if (!draft || draft.app !== app) throw Object.assign(new Error('Draft missing'), { code: 'invalid_input' })
      if (current.revision !== expectedRevision) throw Object.assign(new Error('Workspace revision is stale'), { code: 'stale_revision' })
      await this.#ledger.appendEvent({ type: 'draft.deleted', payload: { app, draftId, parentRevision: current.revision } })
      return current.revision + 1
    }))
  }

  importLegacy({ migrationId, profiles = [], drafts = [] }) {
    return this.#serialize(async () => {
      if (typeof migrationId !== 'string' || !migrationId) throw new TypeError('migrationId is required')
      const profileList = Array.isArray(profiles) ? profiles : Object.entries(profiles).map(([app, profile]) => ({ app, ...profile }))
      const events = await this.#ledger.getEvents()
      if (!events.some(event => event.type === 'workspace.imported' && event.payload?.migrationId === migrationId)) {
        const apps = {}
        for (const profile of profileList) {
          if (!profile || typeof profile.app !== 'string') throw new TypeError('Invalid legacy profile')
          ;(apps[profile.app] ??= { profiles: [], drafts: [] }).profiles.push(profile)
        }
        for (const draft of drafts) {
          if (!draft || typeof draft.app !== 'string' || typeof draft.id !== 'string') throw new TypeError('Invalid legacy draft')
          const normalized = await this.#normalizeDraft(draft)
          ;(apps[draft.app] ??= { profiles: [], drafts: [] }).drafts.push(normalized)
        }
        await this.#ledger.appendEvent({ type: 'workspace.imported', payload: { migrationId, workspace: apps } })
      }
      const names = new Set([...drafts.map(draft => draft.app), ...profileList.map(profile => profile.app)])
      const output = {}
      for (const app of names) output[app] = await this.load(app)
      return output
    })
  }

  async #withLock(fn) {
    const lock = path.join(this.#ledger.baseDir, '.workspace-lock')
    await fs.mkdir(path.dirname(lock), { recursive: true })
    let handle
    for (let i = 0; i < 500; i++) { try { handle = await fs.open(lock, 'wx'); break } catch (error) { if (error.code !== 'EEXIST') throw error; await new Promise(resolve => setTimeout(resolve, 10)) } }
    if (!handle) throw new Error('Workspace lock timeout')
    try { return await fn() } finally { await handle.close(); await fs.rm(lock, { force: true }) }
  }
  #serialize(fn) { const result = this.#queue.then(fn); this.#queue = result.catch(() => {}); return result }
}
