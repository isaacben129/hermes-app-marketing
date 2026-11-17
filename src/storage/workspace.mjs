import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const empty = () => ({ revision: 0, profiles: [], drafts: [], observations: [], decisions: [] })
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const imageData = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/

export class WorkspaceStore {
  #ledger
  #queue = Promise.resolve()
  constructor({ ledger }) { if (!ledger) throw new TypeError('ledger is required'); this.#ledger = ledger }

  async #normalizeDraft(input) {
    const draft = structuredClone(input)
    const images = []
    for (const slide of draft.slides ?? []) {
      const image = slide.selectedImage
      if (!image) continue
      if (typeof image.dataUrl !== 'string') throw new TypeError('Selected image data is required')
      const match = imageData.exec(image.dataUrl)
      if (!match) throw new TypeError('Invalid selected image data')
      const bytes = Buffer.from(match[2], 'base64')
      if (bytes.length > 12 * 1024 * 1024) throw new TypeError('Image data exceeds limit')
      const digest = hash(bytes)
      if (typeof image.sha256 !== 'string' || image.sha256 !== digest) throw new TypeError('Selected image SHA-256 mismatch')
      if (typeof image.sourceRef !== 'string' || !image.sourceRef) throw new TypeError('Selected image source reference is required')
      const dir = path.join(this.#ledger.baseDir, 'images')
      await fs.mkdir(dir, { recursive: true, mode: 0o700 })
      const file = path.join(dir, digest)
      try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }) }
      catch (error) { if (error.code !== 'EEXIST') throw error }
      image.contentRef = `image:${digest}`
      image.mimeType = `image/${match[1]}`
      delete image.dataUrl
      images.push({ digest, type: match[1] })
    }
    return draft
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
        const index = state.drafts.findIndex(draft => draft.id === p.draft.id)
        const draft = await this.#readDraft(p.draft)
        if (index < 0) state.drafts.push(draft); else state.drafts[index] = draft
      }
      if (event.type === 'workspace.imported' && p.migrationId && !migrations.has(p.migrationId)) {
        migrations.add(p.migrationId)
        const part = p.workspace?.[app]
        if (part) {
          state.revision++
          state.profiles.push(...(part.profiles ?? []))
          for (const input of part.drafts ?? []) {
            const draft = await this.#readDraft(input)
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
    }
    const draft = found.get(id)
    return draft ? this.#readDraft(draft) : null
  }

  async rendererPayload(id) {
    const draft = await this.findDraft(id)
    if (!draft) throw Object.assign(new Error('Draft missing'), { code: 'invalid_input' })
    if (!Array.isArray(draft.slides) || !draft.slides.length) throw Object.assign(new Error('Draft has no slides'), { code: 'invalid_input' })
    const slides = []
    for (const slide of draft.slides) {
      const image = slide.selectedImage
      if (!image?.contentRef || typeof image.sourceRef !== 'string' || !image.sourceRef) throw Object.assign(new Error('Slide image and source reference are required'), { code: 'invalid_input' })
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
      const normalized = await this.#normalizeDraft(draft)
      const contentHash = hash(JSON.stringify(normalized))
      try { await this.#ledger.appendEvent({ type: 'draft.saved', payload: { draft: normalized, parentRevision: current.revision, contentHash } }) }
      catch (error) { throw Object.assign(new Error('Workspace persistence failed'), { code: 'persistence_failed', cause: error }) }
      return { revision: current.revision + 1, draft: await this.#readDraft(normalized) }
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
