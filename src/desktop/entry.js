import React, { useEffect, useMemo, useState } from 'react'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { Badge, Button, EmptyState, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host } from '@hermes/plugin-sdk'
import SystemHealth from '../ui/SystemHealth.js'
import JobDetail from '../ui/JobDetail.js'

const h = React.createElement
const urlDefault = 'http://127.0.0.1:8764'
const ROUTE = '/marketing-system'
const selectedImageData = new Map()
const panel = { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 'var(--ui-radius-sm, 4px)', padding: 14, display: 'grid', gap: 10 }
const labelStyle = { display: 'grid', gap: 5, color: 'var(--ui-text-secondary)', fontSize: '.82rem' }
const fieldStyle = { padding: '9px 10px', color: 'var(--ui-text-primary)', background: 'transparent', border: '1px solid var(--ui-stroke-secondary)', borderRadius: 6, font: 'inherit' }
const json = async response => { const data = await response.json().catch(() => ({})); if (!response.ok) { const detail = typeof data.error === 'object' ? data.error : {}; const code = detail.code || data.code; const message = detail.message || (typeof data.error === 'string' ? data.error : data.message) || 'Service request failed'; throw Object.assign(new Error(`${message} (HTTP ${response.status}${code ? ` · ${code}` : ''})`), { status: response.status, code, retryable: detail.retryable ?? data.retryable }) } return data }
const localServiceOrigin = value => { const parsed = new URL(value); if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Service URL must use HTTP on this device loopback address.'); return parsed.origin }

function MarketingPage({ ctx }) {
  const [base, setBase] = useState(() => ctx.storage.get('serviceUrl', urlDefault))
  const [token, setToken] = useState(() => ctx.storage.get('serviceToken', ''))
  const [connected, setConnected] = useState(false)
  const [workspace, setWorkspace] = useState(null)
  const [selectedApp, setSelectedApp] = useState('Cherry')
  const [health, setHealth] = useState(null)
  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState('Overview')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [rendered, setRendered] = useState(null)
  const [active, setActive] = useState(0)
  const [job, setJob] = useState(null)
  const [jobs, setJobs] = useState([])
  const [metricsText, setMetricsText] = useState('')
  const [profileText, setProfileText] = useState('')
  const [experimentText, setExperimentText] = useState('{"name":"Cherry concept test","policyVersion":"unconfigured"}')
  const [observationText, setObservationText] = useState('[]')
  const generation = React.useRef(0)
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
  const api = async (path, init = {}) => { const origin = localServiceOrigin(base); return json(await fetch(`${origin}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } })) }
  const connect = async () => {
    setError(''); setBusy(true); setConnected(false); setWorkspace(null)
    const request = ++generation.current
    try {
      const origin = localServiceOrigin(base)
      const health = await json(await fetch(`${origin}/api/health`))
      if (request !== generation.current) return
      if (!health) throw new Error('Service health response was empty.')
      ctx.storage.set('serviceUrl', base); ctx.storage.set('serviceToken', token)
      const data = await api(`/api/workspace?app=${encodeURIComponent(selectedApp)}`)
      if (request !== generation.current) return
      setHealth(health); setWorkspace(data); setConnected(true); setNotice('Connected to the marketing service. Workspace records are service-owned.')
    } catch (e) { if (request === generation.current) setError(e.message || 'Marketing service is unavailable.') }
    finally { if (request === generation.current) setBusy(false) }
  }
  useEffect(() => { if (ctx.storage.get('serviceUrl') && ctx.storage.get('serviceToken')) connect() }, [])
  const reload = async () => { const req = ++generation.current; try { const data = await api(`/api/workspace?app=${encodeURIComponent(draft?.app || selectedApp)}`); if (req === generation.current) setWorkspace(data) } catch (e) { if (req === generation.current) setError(e.message) } }
  const edit = (path, value) => { setDraft(current => { const next = structuredClone(current); let target = next; path.slice(0, -1).forEach((part, i) => { const child = path[i + 1]; target = target[part] ??= (/^\d+$/.test(child) ? [] : {}) }); target[path.at(-1)] = value; return next }); setDirty(true); setRendered(null) }
  const openDraft = item => { const copy = structuredClone(item); for (const slide of copy.slides || []) { const image = slide.selectedImage; if (image?.contentRef && !image.dataUrl && selectedImageData.has(image.sha256)) image.dataUrl = selectedImageData.get(image.sha256) }; setDraft(copy); setDirty(false); setRendered(null); setView('Slideshows'); setError('') }
  const createDraft = async () => {
    const item = { id: `draft-${crypto.randomUUID()}`, app: selectedApp, title: `Untitled ${selectedApp} draft`, hook: '', slides: [], brief: '', hypothesis: '', source: { evidence: '', claim: 'unreviewed', rights: 'unknown' }, qualityReviews: [] }
    setDraft(item); setDirty(true); setView('Slideshows'); setNotice('New draft is local until saved to the service.')
  }
  const saveDraft = async () => {
    if (!draft) return
    setBusy(true); setError('')
    try {
      const draftToSave = structuredClone(draft)
      for (const slide of draftToSave.slides || []) { const image = slide.selectedImage; if (image?.contentRef && !image.dataUrl) { const retained = selectedImageData.get(image.sha256); if (!retained) throw new Error('The selected image bytes are no longer available in this UI session. Reattach the image before saving.') ; image.dataUrl = retained } }
      const result = await api(`/api/drafts/${encodeURIComponent(draftToSave.id)}`, { method: 'PUT', body: JSON.stringify({ draft: draftToSave, expectedRevision: workspace?.revision ?? 0 }) })
      const readback = await api(`/api/workspace?app=${encodeURIComponent(draft.app || selectedApp)}`)
      if (!readback.drafts?.some(item => item.id === draft.id)) throw new Error('Save succeeded but draft readback did not include this record.')
      const verified = readback.drafts.find(item => item.id === draft.id); for (const slide of verified.slides || []) { const image = slide.selectedImage; if (image?.contentRef && selectedImageData.has(image.sha256)) image.dataUrl = selectedImageData.get(image.sha256) }; setWorkspace(readback); setDraft(verified); setDirty(false); setNotice(`Saved and verified at service revision ${result.revision ?? readback.revision}.`)
    } catch (e) { setError(e.message || 'Save failed. Your unsaved edits are still here.') }
    finally { setBusy(false) }
  }
  const attachImage = async (index, file) => {
    if (!file) return
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.')
      if (file.size > 12 * 1024 * 1024) throw new Error('Choose an image no larger than 12 MiB.')
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read selected image.')); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file) })
      await acceptImage(index, dataUrl, file.name, null, file.name)
    } catch (e) { setError(e.message || 'Image attachment failed.') }
  }
  const acceptImage = async (index, dataUrl, sourceRef, folderId, path) => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '')
    if (!match || match[2].length > Math.ceil(12 * 1024 * 1024 / 3) * 4) throw new Error('Choose a valid PNG, JPEG, or WebP image no larger than 12 MiB.')
    const binary = atob(match[2]); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    if (bytes.length > 12 * 1024 * 1024) throw new Error('Choose an image no larger than 12 MiB.')
    const signature = match[1] === 'png' ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 : match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    if (!signature) throw new Error('Image bytes do not match the selected image type.')
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join(''); selectedImageData.set(digest, dataUrl)
    const slides = [...draft.slides]; slides[index] = { ...slides[index], selectedImage: { dataUrl, sha256: digest, sourceRef, ...(folderId ? { folderId } : {}), path } }; setDraft({ ...draft, slides }); setDirty(true); setRendered(null); setNotice('Image selected locally. Save the draft to store and verify it with the service.')
  }
  const chooseNativeImage = async index => {
    try {
      if (!ctx.files?.requestFolder || !ctx.files?.list || !ctx.files?.readDataUrl) throw new Error('Native folder access is unavailable; use the browser file picker.')
      const grant = await ctx.files.requestFolder()
      if (!grant?.ok || !grant.folderId) throw new Error('Native image folder access was not granted.')
      const listed = await ctx.files.list(grant.folderId)
      const entry = (listed?.entries || []).find(item => /\.(png|jpe?g|webp)$/i.test(item.path || item.name || ''))
      if (!entry) throw new Error('No PNG, JPEG, or WebP image was found in the selected folder.')
      const result = await ctx.files.readDataUrl(grant.folderId, entry.path || entry.name)
      if (!result?.ok || !result.dataUrl) throw new Error('Could not read the selected native image.')
      await acceptImage(index, result.dataUrl, `${grant.folderId}/${entry.path || entry.name}`, grant.folderId, entry.path || entry.name)
    } catch (e) { setError(e.message || 'Image attachment failed.') }
  }
  const runReview = async () => { try { const out = await api('/api/review', { method: 'POST', body: JSON.stringify({ draftId: draft.id, revision: workspace.revision }) }); setNotice(`Review: ${out.readiness?.status || 'blocked'} · ${out.quality?.status || 'quality assessment returned'}`); await reload() } catch (e) { setError(e.message) } }
  const render = async () => { try { const out = await api('/api/render', { method: 'POST', body: JSON.stringify({ jobId: crypto.randomUUID(), draftId: draft.id, revision: workspace.revision }) }); const actualJob = await api(`/api/jobs/${encodeURIComponent(out.jobId)}`); setJob(actualJob); setJobs(current => [actualJob, ...current.filter(item => item.id !== actualJob.id)]); setRendered(out.rendered); setActive(0); setNotice(`Rendered saved revision · ${actualJob.status}.`) } catch (e) { setError(e.message) } }
  const exportZip = async () => { try { const out = await api('/api/export', { method: 'POST', body: JSON.stringify({ draftId: draft.id, revision: workspace.revision, renderJobId: job?.id }) }); const bin = atob(out.zipBase64); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); const a = document.createElement('a'); const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })); a.href = objectUrl; a.download = 'marketing-slideshow.zip'; a.click(); URL.revokeObjectURL(objectUrl); setNotice(`Exported service artifact · ${out.manifest?.files?.length ?? 'verified'} files.`) } catch (e) { setError(e.message) } }
  const importLegacy = async () => { const legacy = ctx.storage.get('drafts', []); if (!legacy.length) { setNotice('No legacy plugin drafts found to migrate.'); return }; try { const source = JSON.stringify(legacy); const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)); const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''); const migrationId = `plugin-local-${digest}`; ctx.storage.set('legacyImportBackup', { sourceHash: digest, drafts: legacy }); const drafts = legacy.map((item, index) => typeof item === 'string' ? { id: `legacy-${index}-${digest.slice(0, 16)}`, app: selectedApp, title: `Legacy draft ${index + 1}`, slides: [{ headline: item, body: '' }], source: { claim: 'unreviewed', rights: 'unknown' }, qualityReviews: [] } : item); await api('/api/legacy-import', { method: 'POST', body: JSON.stringify({ migrationId, profiles: ctx.storage.get('appProfiles', {}), drafts }) }); await reload(); setNotice('Legacy data imported and service readback completed. Local backup retained.') } catch (e) { setError(e.message) } }
  const refreshHealth = async () => { try { const [snapshot, listed] = await Promise.all([api('/api/health'), api('/api/jobs')]); setHealth(snapshot); setJobs(Array.isArray(listed) ? listed : listed.jobs || []); setJob((Array.isArray(listed) ? listed : listed.jobs || [])[0] || null) } catch (e) { setError(e.message) } }
  const nav = ['Overview', 'Slideshows', 'Experiments', 'Outcomes', 'System health', 'App settings']
  const button = (text, action, disabled = false) => h(Button, { key: text, onClick: action, disabled: disabled || busy, variant: 'outline' }, text)
  const input = (title, value, onChange, multiline = false) => h('label', { style: labelStyle, key: title }, title, multiline ? h('textarea', { 'aria-label': title, value: value ?? '', onChange: e => onChange(e.target.value), rows: 3, style: fieldStyle }) : h('input', { type: title.startsWith('Bearer token') ? 'password' : 'text', 'aria-label': title, value: value ?? '', onChange: e => onChange(e.target.value), style: fieldStyle }))
  const records = workspace?.drafts || []
  const thumbnails = (rendered?.slides || []).map((s, i) => h('button', { key: i, 'aria-label': `Show slide ${i + 1}`, onClick: () => setActive(i), 'aria-current': active === i ? 'true' : undefined, style: { width: 52, height: 92, flex: '0 0 auto', padding: 0 } }, h('img', { alt: '', src: `data:image/png;base64,${s.pngBase64 || s.png || ''}`, style: { width: '100%', height: '100%', objectFit: 'contain' } })))
  const renderPanel = rendered && h('section', { style: panel }, h('h3', null, 'Portrait preview'), h('img', { alt: `Rendered slide ${active + 1}`, src: `data:image/png;base64,${rendered.slides?.[active]?.pngBase64 || rendered.slides?.[active]?.png || ''}`, style: { height: 'min(62vh, 720px)', maxWidth: '100%', objectFit: 'contain' } }), h('div', { style: { display: 'flex', gap: 8, overflowX: 'auto' }, role: 'list', 'aria-label': 'Rendered slide thumbnails' }, thumbnails))
  let content
  if (view === 'App settings') content = h(Fragment, null, h('section', { style: panel }, h('h2', null, 'Service connection'), input('Local service URL', base, setBase), input('Bearer token (stored locally; masked)', token, setToken), button(connected ? 'Reconnect' : 'Connect', connect), button('Import legacy plugin data', importLegacy, !connected), h('p', { role: 'status' }, connected ? `Connected · revision ${workspace?.revision}` : 'Disconnected. Configure the local service and token to load records.'), h('p', null, 'Token is excluded from export and sent only as the Authorization header to this configured service.')), h('section', { style: panel }, h('h2', null, `${selectedApp} app profile`), h('p', null, 'Service owned profile. Enter sourced brand, CTA, claim, rights, event, and privacy records as JSON; saving does not attest approval.'), input(`${selectedApp} profile JSON`, profileText || JSON.stringify(workspace?.profiles?.find(p => p.name === selectedApp) || { appId: selectedApp.toLowerCase(), name: selectedApp, brandPromise: '', claims: [], rights: 'unknown', events: [], privacy: 'unconfigured' }, null, 2), setProfileText, true), button('Save profile with revision check', async () => { try { const profile = JSON.parse(profileText); const out = await api(`/api/profiles/${encodeURIComponent(selectedApp)}`, { method: 'PUT', body: JSON.stringify({ expectedRevision: workspace.revision, profile }) }); setNotice(`Profile saved at service revision ${out.revision}.`); await reload() } catch (e) { setError(e.message) } }, !connected || !profileText)))
  else if (view === 'System health') content = h(Fragment, null, h(SystemHealth, { snapshot: health, metrics: health?.jobs ? { 'Queued jobs': health.jobs.queued, 'Running jobs': health.jobs.running, 'Failed jobs': health.jobs.failed } : {}, onRetry: refreshHealth }), ...(jobs.length ? jobs.map(item => h(JobDetail, { key: item.id, job: item, onRetry: id => item.status === 'failed' && api(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }).then(refreshHealth).catch(e => setError(e.message)) })) : [h(JobDetail, { key: 'empty', job: null })]))
  else if (view === 'Experiments') content = h('section', { style: panel }, h('h2', null, 'Experiment recommendation'), input('Experiment policy and version (JSON)', experimentText, setExperimentText, true), input('Observations (JSON)', observationText, setObservationText, true), button('Recommend decision', async () => { try { const out = await api('/api/experiments/recommend', { method: 'POST', body: JSON.stringify({ draftId: draft?.id, revision: workspace?.revision, experiment: JSON.parse(experimentText), observations: JSON.parse(observationText) }) }); setNotice(`Recommendation: ${out.decision?.status || out.status || 'inconclusive'} · ${out.decision?.rationale || 'No configured policy or sufficient evidence.'}`); await reload() } catch (e) { setError(e.message) } }, !connected), h('p', null, 'No decision is inferred without service-validated policy and observations.'))
  else if (view === 'Slideshows' && draft) content = h(Fragment, null,
    h('section', { style: panel }, h('header', null, h('h2', null, draft.title || 'Draft')), input('Title', draft.title, v => edit(['title'], v)), input('Source evidence and pointers', draft.source?.evidence, v => edit(['source', 'evidence'], v), true), input('Brief', draft.brief, v => edit(['brief'], v), true), input('Working hypothesis (unvalidated)', draft.hypothesis, v => edit(['hypothesis'], v), true),
      h('h3', null, 'Structured slides'), ...(draft.slides || []).map((slide, i) => h('section', { key: i, style: panel }, input(`Slide ${i + 1} headline`, slide.headline, v => edit(['slides', String(i), 'headline'], v)), input(`Slide ${i + 1} body`, slide.body, v => edit(['slides', String(i), 'body'], v), true), button(`Choose native image for slide ${i + 1}`, () => chooseNativeImage(i)), h('label', { style: labelStyle }, 'Browser fallback image picker', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onChange: e => attachImage(i, e.target.files?.[0]) })), h('div', null, `Image: ${slide.selectedImage?.contentRef ? 'saved service asset' : 'not attached'} · rights status: ${slide.selectedImage?.rights || 'unknown'}`))), button('Add slide', () => edit(['slides'], [...(draft.slides || []), { headline: '', body: '', selectedImage: null }]))),
      h('section', { style: panel }, h('h3', null, 'Source evidence and compliance inputs'), ...['claim', 'rights', 'cta', 'channels', 'events', 'privacy'].map(k => input(`${k} · unapproved until reviewed`, draft.source?.[k] ?? draft[k] ?? '', v => edit(['source', k], v))), h('div', null, 'These are operator inputs, not approvals. Rights, privacy, claims, and distribution remain blocked until the service review has evidence.'), h('h3', null, 'Quality review · 7 dimensions'), ...['clarity', 'relevance', 'specificity', 'credibility', 'brandFit', 'accessibility', 'craft'].map(k => h('section', { key: k, style: { display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) minmax(100px, 2fr)', gap: 8 } }, input(`${k} score (0–5; blank = unassessed)`, draft.qualityReviews?.[0]?.dimensions?.[k]?.score ?? '', v => edit(['qualityReviews', '0', 'dimensions', k, 'score'], v === '' ? '' : Number(v))), input(`${k} rationale and evidence pointer`, draft.qualityReviews?.[0]?.dimensions?.[k]?.rationale ?? '', v => edit(['qualityReviews', '0', 'dimensions', k, 'rationale'], v)))), input('Reviewer identity', draft.qualityReviews?.[0]?.reviewer ?? '', v => edit(['qualityReviews', '0', 'reviewer'], v)), input('Review timestamp (ISO 8601)', draft.qualityReviews?.[0]?.reviewedAt ?? '', v => edit(['qualityReviews', '0', 'reviewedAt'], v)), button('Run service review', runReview, !connected || dirty), h('div', null, `Review status: ${draft.review?.status || draft.review || 'not assessed'}`)),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, button(dirty ? 'Save to service' : `Saved · revision ${workspace?.revision ?? '—'}`, saveDraft, !connected || !dirty), button('Render saved revision', render, !connected || dirty || !draft.id), button('Export rendered ZIP', exportZip, !rendered || !job)),
      renderPanel)
  else if (view === 'Slideshows') content = h(EmptyState, { title: 'No draft selected', description: 'Open a service draft or create one.' }, button('New draft', createDraft, !connected))
  else if (view === 'Overview') content = h('section', { style: panel }, h('h2', null, `Marketing overview · ${selectedApp}`), h('label', { style: labelStyle }, 'App', h('select', { 'aria-label': 'App', value: selectedApp, onChange: e => { const app = e.target.value; setSelectedApp(app); setDraft(null); setDirty(false); setRendered(null); setView('Overview'); setWorkspace(null); setError(''); const req = ++generation.current; api(`/api/workspace?app=${encodeURIComponent(app)}`).then(data => { if (req === generation.current) setWorkspace(data) }).catch(error => { if (req === generation.current) setError(error.message) }) }, style: fieldStyle }, ...Array.from(new Set(['Cherry', ...(workspace?.profiles || []).map(p => p.name || p.appId).filter(Boolean)])).map(app => h('option', { key: app, value: app }, app)))), h('p', null, connected ? `Service revision ${workspace?.revision}. ${records.length} saved drafts.` : 'Service disconnected · metrics and records unavailable.'), h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 } }, ...['Qualified activations', 'Paid conversions', 'Attributable revenue'].map(metric => h('section', { key: metric, style: panel }, h('strong', null, metric), h('div', null, metric === 'Qualified activations' && workspace?.observations?.length ? 'Source observations available' : 'Unavailable with source/window')))), h('div', { style: { display: 'grid', gap: 8 } }, ...records.map(item => h('button', { key: item.id, onClick: () => openDraft(item), style: { ...fieldStyle, textAlign: 'left' } }, `${item.title || item.id} · ${item.stage || 'draft'} · Open`))), button('New draft', createDraft, !connected), button('Sync Postiz (read only)', async () => { try { const result = await api('/api/postiz/sync', { method: 'POST', body: JSON.stringify({ app: selectedApp, window: 'last-30-days', days: 30 }) }); setNotice(result.status === 'available' ? `Read ${result.posts?.length || 0} posts and ${result.observations?.length || 0} observations.` : `Postiz unavailable: ${result.reason || result.status || 'no provider data'}`); await reload() } catch (e) { setError(e.message) } }, !connected))
  else content = h('section', { style: panel }, h('h2', null, 'Outcome import'), h('p', null, 'Import owner approved aggregate rows only. Raw event data and provider credentials are not accepted.'), input('Aggregate outcomes JSON', metricsText, setMetricsText, true), button('Import outcomes', async () => { try { const rows = JSON.parse(metricsText); const result = await api('/api/outcomes/import', { method: 'POST', body: JSON.stringify({ app: selectedApp, rows, eventDefinitions: workspace?.profile?.events || [], attributionPolicy: workspace?.profile?.attributionPolicy || null, source: 'operator-import', window: null }) }); setNotice(`Imported ${result.observations?.length ?? 0} service observations.`); await reload() } catch (e) { setError(e.message) } }, !connected), h('h3', null, 'Imported observations'), ...(workspace?.observations || []).map((row, i) => h('pre', { key: i, style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(row))), h('p', null, workspace?.observations?.length ? 'Values below are service returned observations.' : 'No observations returned by service. Outcome is unavailable, not zero.'))
  return h('main', { style: { padding: '20px', color: 'var(--ui-text-primary)' } }, h('div', { style: { maxWidth: 1120, margin: 'auto', display: 'grid', gap: 14 } }, h('header', null, h('div', { style: { color: 'var(--ui-text-tertiary)', fontSize: 12 } }, 'APP MARKETING · SERVICE WORKSPACE'), h('h1', null, draft && view === 'Slideshows' ? draft.title : 'Marketing workflow')), h('nav', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, ...nav.map(name => h(Button, { key: name, variant: name === view ? 'secondary' : 'ghost', onClick: () => { if (dirty && typeof globalThis.confirm === 'function' && !globalThis.confirm('Discard unsaved draft changes?')) return; if (dirty) { setDraft(null); setDirty(false); setRendered(null) } setView(name) } }, name))), error ? h('div', { role: 'alert' }, error) : null, notice ? h('div', { role: 'status', 'aria-live': 'polite' }, notice) : null, content))
}

export default { id: 'marketing-system', name: 'App Marketing', description: 'Service-backed marketing workflow', register(ctx) { ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(MarketingPage, { ctx }) }); ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: 'Marketing', codicon: 'megaphone' } }); ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'marketing-system.open', label: 'Open app marketing', run: () => host.navigate(ROUTE) } }) } }
