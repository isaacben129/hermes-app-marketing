import { Badge, Button, EmptyState, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host } from '@hermes/plugin-sdk'
import React, { useEffect, useState } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

const RENDERER_BASE = 'http://127.0.0.1:8765/api'
async function rendererPost(path, payload) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(`${RENDERER_BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Local renderer failed.')
    return data
  } finally { clearTimeout(timer) }
}
async function rendererHealth() {
  try { const response = await fetch(`${RENDERER_BASE.replace(/\/api$/, '')}/api/health`); return response.ok } catch { return false }
}
async function renderSlideshow(payload) {
  if (!await rendererHealth()) throw new Error('Renderer service is offline. Start the local slideshow renderer, then try again.')
  const data = await rendererPost('render', payload)
  return { ...data, slides: data.slides.map(slide => ({ ...slide, png: Uint8Array.from(atob(slide.pngBase64), c => c.charCodeAt(0)) })) }
}
async function selectSlideImage(ctx, current) {
  if (!ctx.files?.requestFolder || !ctx.files?.list || !ctx.files?.readDataUrl) throw new Error('This Hermes Desktop build does not provide the required scoped folder access.')
  let folderId = current?.folderId
  if (!folderId || !(await ctx.files.folders()).some(folder => folder.id === folderId)) {
    const selected = await ctx.files.requestFolder()
    if (!selected?.ok || !selected.folder) return null
    folderId = selected.folder.id
  }
  const listing = await ctx.files.list(folderId, '')
  if (!listing?.ok) throw new Error(listing?.message || 'Could not list the selected folder.')
  const images = (listing.entries || []).filter(entry => !entry.isDirectory && entry.name.toLowerCase().match(/\.(png|jpe?g|webp)$/))
  if (!images.length) throw new Error('No PNG, JPEG, or WebP images found in the selected folder.')
  const chosen = images.length === 1 ? images[0] : await new Promise(resolve => {
    const raw = window.prompt(`Choose image number:\n${images.map((image, index) => `${index + 1}. ${image.name}`).join('\n')}`, '1')
    if (raw === null) return resolve(null)
    const index = Number(raw) - 1
    resolve(Number.isInteger(index) && index >= 0 && index < images.length ? images[index] : null)
  })
  if (!chosen) return null
  const relativePath = chosen.path
  const imageData = await ctx.files.readDataUrl(folderId, relativePath)
  if (!imageData?.ok || typeof imageData.url !== 'string') throw new Error(imageData?.message || 'Could not read the chosen image.')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imageData.url)
  if (!match) throw new Error('The selected file is not a supported PNG, JPEG, or WebP image.')
  const binary = atob(match[2])
  if (binary.length > 12 * 1024 * 1024) throw new Error('Selected image exceeds the 12 MB render limit.')
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return { folderId, path: relativePath, sourceRef: `user-folder://${folderId}/${relativePath}`, sha256, dataUrl: imageData.url }
}
async function exportSlideshowZip(rendered, source = {}) {
  if (!rendered?.slides?.length) throw new Error('Render slides before exporting.')
  const data = await rendererPost('export', { rendered: { ...rendered, slides: rendered.slides.map(slide => ({ ...slide, pngBase64: btoa(String.fromCharCode(...slide.png)) })) }, source })
  return Uint8Array.from(atob(data.zipBase64), c => c.charCodeAt(0))
}

const ROUTE = '/marketing-system'
const CHERRY_STARTER = {
  id: 'brand-guide:cherry',
  kind: 'Brand source',
  evidence: 'Brand guide only. Product features, assets, claims, CTA, channels, and outcome data are not configured.'
}
const cherryWorkspaceDraft = (id, title = 'Untitled Cherry workspace draft') => ({
  id, app: 'Cherry', title, format: 'Draft · 0 slides', stage: 'Draft', hook: '', slides: [], isDraft: true,
  source: { ...CHERRY_STARTER, evidence: 'Brand guide only; no product facts, claims, creative, or outcomes inferred.' },
  brief: 'Practice social situations. Start small. Get better over time.', hypothesis: '', rights: 'unknown',
  claim: 'unreviewed', cta: 'unconfigured', claimsApproval: 'unconfigured', channels: [], assets: [],
  events: { status: 'unconfigured', privacy: 'unconfigured' }, review: 'blocked', versions: []
})
const BORDER = 'var(--ui-stroke-secondary)'
const MUTED = { color: 'var(--ui-text-tertiary)' }
const PANEL = { border: `1px solid ${BORDER}`, borderRadius: 'var(--ui-radius-sm, 4px)', background: 'color-mix(in srgb, var(--ui-text-secondary) 2%, transparent)' }

function MarketingPage({ ctx }) {
  const [app, setApp] = useState('Cherry')
  const [appProfiles, setAppProfiles] = useState(() => ctx.storage.get('appProfiles', { Cherry: { name: 'Cherry', brandSource: 'brand-guidelines.md', brandPromise: 'Practice social situations. Start small. Get better over time.', tone: ['calm', 'matter-of-fact', 'supportive but restrained'], avoidClaims: ['therapy', 'cure', 'heal', 'confidence', 'guaranteed outcomes'], cta: 'unconfigured', channels: [], assets: [], rights: 'unconfigured', claimsApproval: 'unconfigured', events: 'unconfigured', privacy: 'unconfigured' } }))
  const [selectedId, setSelectedId] = useState(null)
  const [drafts, setDrafts] = useState(() => ctx.storage.get('drafts', []))
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [rendered, setRendered] = useState(null)
  const [renderError, setRenderError] = useState('')
  const [renderBusy, setRenderBusy] = useState(false)
  const dirtyRef = React.useRef(false)
  dirtyRef.current = dirty
  const records = drafts
  const selected = records.find(item => item.id === selectedId) || null
  const cards = records.filter(item => app === 'All apps' || item.app === app)
  const configuredApps = Object.keys(appProfiles || { Cherry: {} })
  const getProfile = name => (appProfiles || { Cherry: {} })[name] || {}

  useEffect(() => {
    const beforeUnload = event => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  const button = (label, onClick, variant = 'ghost', disabled = false) => jsx(Button, { variant, onClick, disabled, children: label }, label)
  const badge = (label, accent = false) => jsx(Badge, { variant: accent ? 'secondary' : 'outline', children: label }, label)
  const fieldLabel = { display: 'grid', gap: '6px', color: 'var(--ui-text-secondary)', fontSize: '0.8rem' }
  const fieldStyle = { border: `1px solid ${BORDER}`, borderRadius: 'var(--ui-radius-md, 8px)', background: 'transparent', color: 'var(--ui-text-primary)', padding: '9px 10px', font: 'inherit' }
  const updateDraft = (field, value) => {
    if (!selected?.isDraft) return
    setDrafts(drafts.map(item => item.id === selected.id ? { ...item, [field]: value, review: 'blocked', ...( ['slides', 'hypothesis', 'brief', 'hook', 'title'].includes(field) ? { claim: 'unreviewed', claimsApproval: 'unconfigured' } : {}) } : item))
    setDirty(true)
    setRendered(null)
  }
  const updateSlide = (index, patch) => {
    const slides = selected.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...patch } : slide)
    updateDraft('slides', slides)
  }
  const reviewReady = item => item.rights === 'cleared' && item.claim === 'supported' && item.cta === 'checked' && item.claimsApproval === 'approved' && item.assets.length > 0 && item.channels.length > 0 && item.events.status === 'configured' && item.events.privacy === 'approved' && item.slides.length > 0
  const createPipelineConcept = () => {
    if (dirty && !window.confirm('Discard unsaved draft changes?')) return
    const item = {
      ...cherryWorkspaceDraft(`concept-${Date.now()}`, `${app} workspace draft`), app,
      source: { ...CHERRY_STARTER, id: `brand:${app}`, evidence: app === 'Cherry' ? CHERRY_STARTER.evidence : 'Brand source unconfigured; no facts inferred.' },
      brief: app === 'Cherry' ? 'Practice social situations. Start small. Get better over time.' : '', cta: 'unconfigured', claimsApproval: 'unconfigured',
      channels: [], assets: [], events: { status: 'unconfigured', privacy: 'unconfigured' }
    }
    const next = [item, ...drafts]
    ctx.storage.set('drafts', next)
    setDrafts(next)
    setSelectedId(item.id)
    setDirty(false)
    setNotice(`${app} starter draft added. Unconfigured fields remain blocked pending review.`)
  }
  const renderSlides = async () => {
    if (!selected?.slides?.length) return
    setRenderBusy(true)
    setRenderError('')
    try {
      const slides = selected.slides.map((slide, index) => {
        if (!slide.selectedImage?.dataUrl) throw new Error(`Select a real image for slide ${index + 1} before rendering.`)
        if (!slide.headline?.trim() || !slide.body?.trim()) throw new Error(`Add both a headline and body to slide ${index + 1}.`)
        return { headline: slide.headline, body: slide.body, image_data_url: slide.selectedImage.dataUrl, image_sha256: slide.selectedImage.sha256, source_ref: slide.selectedImage.sourceRef, crop: 'cover', text_position: slide.textPosition || 'bottom' }
      })
      setRendered(await renderSlideshow({ title: selected.title, slides, width: 1080, height: 1920 }))
    } catch (error) { setRenderError(error.message || 'Render failed.') }
    finally { setRenderBusy(false) }
  }
  const addSlide = () => updateDraft('slides', [...selected.slides, { headline: '', body: '', selectedImage: null, textPosition: 'bottom' }])
  const chooseImage = async index => {
    setRenderError('')
    try {
      const image = await selectSlideImage(ctx, selected.slides[index]?.selectedImage)
      if (image) updateSlide(index, { selectedImage: image })
    } catch (error) { setRenderError(error.message || 'Image selection failed.') }
  }
  const downloadPng = (slide, index) => {
    const url = URL.createObjectURL(new Blob([slide.png], { type: 'image/png' }))
    const link = document.createElement('a'); link.href = url; link.download = `slide-${String(index + 1).padStart(2, '0')}.png`; link.click()
    URL.revokeObjectURL(url)
  }
  const downloadZip = async () => {
    try {
      const bytes = await exportSlideshowZip(rendered, { draftId: selected.id, app: selected.app })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const link = document.createElement('a'); link.href = url; link.download = `${selected.app.toLowerCase()}-slideshow.zip`; link.click()
      URL.revokeObjectURL(url)
    } catch (error) { setRenderError(error.message || 'Export failed.') }
  }
  const generateCopy = () => {
    if (selected.slides.length && !window.confirm('Replace current slide copy? Saved versions remain available.')) return
    setRendered(null)
    updateDraft('slides', [
      { headline: 'What is one next step?', body: 'Write it down in your own words.', selectedImage: null, textPosition: 'bottom' },
      { headline: 'Start with something small.', body: 'An illustrative prompt, not an app feature claim.', selectedImage: null, textPosition: 'bottom' },
      { headline: 'Choose a real image.', body: 'Add your approved artwork before rendering.', selectedImage: null, textPosition: 'bottom' },
      { headline: 'Review before sharing.', body: 'No CTA, destination, or external-use approval is configured.', selectedImage: null, textPosition: 'bottom' }
    ])
  }
  const saveDraft = () => {
    const versioned = drafts.map(item => item.id === selected.id && item.source ? {
      ...item, versions: [...item.versions, { number: item.versions.length + 1, savedAt: new Date().toISOString(),
        title: item.title, source: { ...item.source }, brief: item.brief, hypothesis: item.hypothesis,
        slides: [...item.slides], rights: item.rights, claim: item.claim, cta: item.cta,
        claimsApproval: item.claimsApproval, channels: [...item.channels], assets: [...item.assets], events: { ...item.events }, review: item.review }]
    } : item)
    ctx.storage.set('drafts', versioned)
    setDrafts(versioned)
    setDirty(false)
    setNotice('Draft saved in this Hermes plugin on this device.')
  }
  const createDraft = () => {
    if (dirty && !window.confirm('Discard unsaved draft changes?')) return
    const profile = getProfile(app)
    const item = { id: `draft-${Date.now()}`, app, title: `Untitled ${app} workspace draft`, format: 'Draft · 0 slides', stage: 'Draft', hook: '', slides: [], isDraft: true,
      source: { id: `brand:${app}`, kind: 'Brand source', evidence: profile?.brandSource === 'brand-guidelines.md' ? 'Verified brand guide only; product facts and claims not provided.' : 'Brand source unconfigured; no facts inferred.' },
      brief: profile?.brandPromise || '', hypothesis: '', rights: 'unknown', claim: 'unreviewed', cta: profile?.cta || 'unconfigured',
      claimsApproval: profile?.claimsApproval || 'unconfigured', channels: profile?.channels || [], assets: profile?.assets || [],
      events: { status: profile?.events || 'unconfigured', privacy: profile?.privacy || 'unconfigured' }, review: 'blocked', versions: [] }
    const next = [item, ...drafts]
    setDrafts(next)
    ctx.storage.set('drafts', next)
    setDirty(false)
    setSelectedId(item.id)
    setNotice(`${app} starter draft created. CTA, claims approval, channels, assets, rights, events, and privacy remain unconfigured.`)
  }
  const deleteDraft = () => {
    if (!window.confirm('Delete this local draft?')) return
    const next = drafts.filter(item => item.id !== selected.id)
    setDrafts(next)
    ctx.storage.set('drafts', next)
    setDirty(false)
    setSelectedId(null)
    setNotice('Local draft deleted.')
  }
  const navigateTo = next => {
    if (dirty && !window.confirm('Discard unsaved draft changes?')) return
    if (dirty) setDrafts(ctx.storage.get('drafts', []))
    setRendered(null)
    setRenderError('')
    setNotice('')
    setSelectedId(null)
    setDirty(false)
    next()
    setNotice('')
  }
  const titleNode = jsxs('header', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '14px', flexWrap: 'wrap' }, children: [jsxs('div', { children: [jsx('div', { style: { color: 'var(--ui-text-quaternary)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase' }, children: 'APP MARKETING · LOCAL PROTOTYPE' }), jsx('h1', { style: { margin: '7px 0 4px', fontSize: '1.4rem', fontWeight: 600 }, children: selected ? selected.title : 'Marketing overview' }), jsx('div', { style: { ...MUTED, fontSize: '0.84rem' }, children: 'Slideshow workspace · no accounts, external services, or live business data.' })] }), selected ? button('← Overview', () => navigateTo(() => setSelectedId(null)), 'outline') : null] })
  const appTabs = jsx('div', { role: 'tablist', 'aria-label': 'App workspace', style: { display: 'flex', gap: '7px', flexWrap: 'wrap' }, children: ['All apps', ...configuredApps].map(item => jsx(Button, { role: 'tab', 'aria-selected': item === app, variant: item === app ? 'secondary' : 'ghost', onClick: () => navigateTo(() => { setApp(item); setSelectedId(null) }), children: item }, item)) })
  const addAppProfile = () => {
    const name = window.prompt('App name')?.trim()
    if (!name || Object.hasOwn(appProfiles || { Cherry: {} }, name)) return
    const next = { ...(appProfiles || { Cherry: {} }), [name]: { name, brandSource: 'unconfigured', brandPromise: '', tone: [], avoidClaims: [], cta: 'unconfigured', channels: [], assets: [], rights: 'unconfigured', claimsApproval: 'unconfigured', events: 'unconfigured', privacy: 'unconfigured' } }
    setAppProfiles(next)
    ctx.storage.set('appProfiles', next)
    setNotice(`${name} added with unconfigured brand and compliance fields.`)
  }
  const metric = (label, caption) => jsxs('section', { style: { ...PANEL, minWidth: '0', flex: '1 1 185px', padding: '13px 15px' }, children: [jsx('div', { style: { color: 'var(--ui-text-quaternary)', fontSize: '0.7rem', textTransform: 'uppercase' }, children: label }), jsx('div', { style: { marginTop: '7px', fontSize: '1.4rem', fontWeight: 600 }, children: '—' }), jsx('div', { style: { ...MUTED, fontSize: '0.77rem', marginTop: '3px' }, children: caption })] })
  const sampleCard = item => jsx('button', { type: 'button', 'aria-label': `Open ${item.app} workspace draft: ${item.title}`, onClick: () => navigateTo(() => setSelectedId(item.id)), style: { ...PANEL, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0', minHeight: '160px', padding: '14px', textAlign: 'left', color: 'inherit', cursor: 'pointer' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '7px', flexWrap: 'wrap' }, children: [badge(item.app, true), badge(item.isDraft ? 'Local draft' : item.stage)] }), jsx('div', { style: { fontSize: '0.98rem', fontWeight: 600 }, children: item.title }), jsx('div', { style: { ...MUTED, fontSize: '0.79rem' }, children: 'Saved only in this Hermes plugin' }), jsx('div', { style: { ...MUTED, fontSize: '0.82rem', lineHeight: 1.45 }, children: item.hook || 'Add an opening hook in the detail editor.' }), jsx('div', { style: { color: 'var(--ui-text-quaternary)', fontSize: '0.73rem', marginTop: 'auto' }, children: 'Local draft · Open details →' })] }, item.id)

  const overview = jsxs(Fragment, { children: [titleNode, appTabs, jsx('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '9px' }, children: [metric('Qualified activations', 'Not connected'), metric('Paid conversions', 'Not connected'), metric('Attributable revenue', 'Not connected')] }), jsxs('section', { style: { display: 'grid', gap: '10px' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }, children: [jsxs('div', { children: [jsx('h2', { style: { margin: 0, fontSize: '1rem', fontWeight: 600 }, children: `${app} workspace drafts` }), jsx('div', { style: { ...MUTED, fontSize: '0.77rem', marginTop: '3px' }, children: `${cards.length} local drafts · no sample creatives` })] }), button('＋ Add app', addAppProfile, 'outline'), button('＋ New local draft', createDraft, 'secondary'), button('＋ Create pipeline concept', createPipelineConcept, 'secondary')] }), cards.length ? jsx('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '10px' }, children: cards.map(sampleCard) }) : jsx(EmptyState, { title: 'Cherry workspace ready to configure', description: 'Create a local draft. No claims, CTA, channel, creative, or outcome is assumed.' })] })] })
  let detail = null
  if (selected) {
    const slideNodes = selected.slides.length ? jsx('ol', { style: { display: 'grid', gap: '9px', margin: 0, paddingLeft: '23px' }, children: selected.slides.map((slide, index) => jsxs('li', { style: { ...PANEL, padding: '12px', display: 'grid', gap: '9px' }, children: [
      jsx('label', { style: fieldLabel, children: ['Headline', jsx('input', { 'aria-label': `Slide ${index + 1} headline`, value: slide.headline || '', onChange: event => updateSlide(index, { headline: event.target.value }), style: fieldStyle })] }),
      jsx('label', { style: fieldLabel, children: ['Body', jsx('textarea', { 'aria-label': `Slide ${index + 1} body`, value: slide.body || '', rows: 2, onChange: event => updateSlide(index, { body: event.target.value }), style: { ...fieldStyle, resize: 'vertical' } })] }),
      jsxs('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }, children: [button(slide.selectedImage ? 'Change image' : 'Choose image', () => chooseImage(index), 'outline'), slide.selectedImage ? jsx('span', { style: MUTED, children: `${slide.selectedImage.path} · SHA-256 ${slide.selectedImage.sha256.slice(0, 12)}…` }) : jsx('span', { style: MUTED, children: 'Image required · use a folder you explicitly grant' })] }),
      jsx('label', { style: fieldLabel, children: ['Text placement', jsx('select', { 'aria-label': `Slide ${index + 1} text placement`, value: slide.textPosition || 'bottom', onChange: event => updateSlide(index, { textPosition: event.target.value }), style: fieldStyle, children: ['top', 'center', 'bottom'].map(value => jsx('option', { value, children: value }, value)) })] })
    ] }, `${selected.id}-${index}`)) }) : jsx('div', { style: MUTED, children: 'No slides yet. Add a slide, write its copy, and choose an image.' })
    const editor = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '11px', padding: '14px' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }, children: [jsx('h2', { style: { margin: 0, fontSize: '1rem' }, children: 'Slideshow details' }), selected.isDraft ? jsxs('div', { style: { display: 'flex', gap: '7px' }, children: [button(dirty ? 'Save draft' : 'Saved', saveDraft, 'secondary', !dirty), button('Delete draft', deleteDraft, 'outline')] }) : badge('Read-only sample')] }), selected.isDraft ? jsx('label', { style: fieldLabel, children: ['Draft title', jsx('input', { 'aria-label': 'Draft title', value: selected.title, onChange: event => updateDraft('title', event.target.value), style: fieldStyle })] }) : jsx('div', { children: selected.title }), selected.isDraft ? jsx('label', { style: fieldLabel, children: ['Opening hook', jsx('textarea', { 'aria-label': 'Opening hook', value: selected.hook, rows: 3, onChange: event => updateDraft('hook', event.target.value), style: { ...fieldStyle, resize: 'vertical' } })] }) : jsx('div', { style: MUTED, children: selected.hook }), jsx('div', { style: { color: 'var(--ui-text-secondary)', fontSize: '0.78rem', textTransform: 'uppercase' }, children: 'Ordered image-led slides' }), slideNodes, selected.isDraft ? jsxs('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap' }, children: [button('＋ Add slide', addSlide, 'outline'), selected.slides.length ? button('Remove last slide', () => updateDraft('slides', selected.slides.slice(0, -1)), 'outline') : null, button('Generate copy draft', generateCopy, 'outline')] }) : null] })
    const input = (label, value, onChange) => jsx('label', { style: fieldLabel, children: [label, jsx('textarea', { 'aria-label': label, value, onChange: e => onChange(e.target.value), style: fieldStyle })] })
    const pipeline = jsxs('section', { style: { ...PANEL, padding: '14px', display: 'grid', gap: '10px' }, children: [
      jsx('h2', { children: `${selected.app} starter configuration` }),
      jsx('p', { children: selected.brief || 'No brand promise configured.' }),
      jsx('p', { children: 'Brand foundation only. No product feature, performance result, or creative is asserted. Avoid therapy, cure, heal, confidence, and guaranteed outcomes.' }),
      input('Brief', selected.brief, value => updateDraft('brief', value)),
      input('Working hypothesis (unvalidated)', selected.hypothesis, value => updateDraft('hypothesis', value)),
      jsx('div', { children: 'CTA: unconfigured · Channels: unconfigured · Assets / rights: unconfigured · Claim approval: unconfigured · Events / privacy: unconfigured' }),
      jsx('div', { children: 'Status values are local workspace data only. They do not represent rights clearance, claims approval, privacy review, or permission to distribute.' }),
      button(renderBusy ? 'Rendering…' : 'Render slideshow', renderSlides, 'secondary', renderBusy || !selected.slides.length),
      renderError ? jsx('div', { role: 'alert', children: renderError }) : null,
      rendered ? jsxs('section', { style: { display: 'grid', gap: '10px' }, children: [jsx('h3', { children: `Rendered preview · ${rendered.dimensions.width} × ${rendered.dimensions.height}` }), button('Download slideshow ZIP', downloadZip, 'secondary'), ...rendered.slides.map((slide, index) => jsxs('figure', { style: { ...PANEL, padding: '10px', margin: 0 }, children: [jsx('img', { src: `data:image/png;base64,${btoa(String.fromCharCode(...slide.png))}`, alt: `Rendered slide ${index + 1}`, style: { display: 'block', width: 'min(100%, 360px)', height: 'auto' } }), button(`Download slide ${index + 1} PNG`, () => downloadPng(slide, index), 'outline')] }, index))] }) : null,
      ...selected.slides.slice(1).map((_, index) => button(`Move slide ${index + 2} up`, () => {
        const slides = [...selected.slides]; [slides[index], slides[index + 1]] = [slides[index + 1], slides[index]]; updateDraft('slides', slides)
      })),
      jsx('div', { children: `CTA: ${selected.cta}; claims approval: ${selected.claimsApproval}; rights: ${selected.rights}; channels: ${selected.channels.length ? selected.channels.join(', ') : 'unconfigured'}; events/privacy: ${selected.events.status}/${selected.events.privacy}` }),
      jsx('p', { children: `External review: ${selected.review}. Starting values do not attest to support or clearance. No external share or publishing is wired.` }),
      button('Mark ready for external review', () => { if (!reviewReady(selected)) return; setDrafts(drafts.map(item => item.id === selected.id ? { ...item, review: 'ready' } : item)); setDirty(true) }, 'outline', !reviewReady(selected)),
      jsx('h3', { children: 'Saved versions' }),
      ...selected.versions.map(version => jsx('details', { children: [jsx('summary', { children: `Version ${version.number} · ${version.savedAt}` }), jsx('pre', { style: { whiteSpace: 'pre-wrap' }, children: JSON.stringify(version, null, 2) })] }, version.number))
    ] })
    const review = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '7px', padding: '13px 15px' }, children: [jsx('h2', { style: { margin: 0, fontSize: '0.92rem' }, children: 'Review before any external use' }), ...[`Brand source: ${selected.source.id} · ${selected.source.evidence}`, 'Product claims: not provided; approval unconfigured', 'CTA destination: not provided', 'Asset rights and provenance: not provided; clearance unconfigured', 'Channels: not provided', 'Events and privacy: unconfigured', 'Human approval: required before sharing'].map(text => jsx('div', { style: { ...MUTED, fontSize: '0.79rem' }, children: text }, text))] })
    const performance = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '7px', padding: '13px 15px' }, children: [jsx('h2', { style: { margin: 0, fontSize: '0.92rem' }, children: 'Performance' }), jsx('div', { style: { ...MUTED, fontSize: '0.82rem' }, children: 'No platform or attribution data connected. Outcome is unavailable—not zero.' })] })
    detail = jsxs(Fragment, { children: [titleNode, appTabs, jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }, children: [jsx('span', { style: { color: 'var(--ui-text-secondary)', fontSize: '0.78rem' }, children: `Status · ${selected.stage}` }), badge(dirty ? 'Unsaved changes' : 'Local draft', true)] }), editor, pipeline, review, performance, notice ? jsx('div', { role: 'status', 'aria-live': 'polite', style: MUTED, children: notice }) : null] })
  }
  return jsx('main', { className: 'h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8', children: jsx('div', { style: { maxWidth: '1120px', margin: '0 auto', display: 'grid', gap: '15px', paddingBottom: '20px' }, children: selected ? detail : overview }) })
}

export default {
  id: 'marketing-system',
  name: 'App Marketing',
  description: 'App-agnostic marketing workspace with Cherry configured first; factual inputs remain unconfigured',
  register(ctx) {
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(MarketingPage, { ctx }) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: 'Marketing', codicon: 'megaphone' } })
    ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'marketing-system.open', label: 'Open app marketing', keywords: ['marketing', 'slideshows', 'app workspace'], run: () => host.navigate(ROUTE) } })
  }
}
