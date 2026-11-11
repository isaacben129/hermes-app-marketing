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
async function renderSlideshow(payload) {
  const data = await rendererPost('render', payload)
  return { ...data, slides: data.slides.map(slide => ({ ...slide, png: Uint8Array.from(atob(slide.pngBase64), c => c.charCodeAt(0)) })) }
}
async function exportSlideshowZip(rendered, source = {}) {
  if (!rendered?.slides?.length) throw new Error('Render slides before exporting.')
  const data = await rendererPost('export', { rendered: { ...rendered, slides: rendered.slides.map(slide => ({ ...slide, pngBase64: btoa(String.fromCharCode(...slide.png)) })) }, source })
  return Uint8Array.from(atob(data.zipBase64), c => c.charCodeAt(0))
}

const ROUTE = '/marketing-system'
const APPS = ['App A', 'App B', 'App C']
const SAMPLES = [
  { id: 'sample-a1', app: 'App A', title: 'Problem → payoff', format: '7-slide carousel', stage: 'Draft', hook: 'Open with a recognizable moment, then show one useful next step.', slides: ['A recognizable moment', 'Why the usual response falls short', 'One practical change', 'A concrete example', 'A specific next step', 'Claim and rights check', 'One clear action'] },
  { id: 'sample-b1', app: 'App B', title: 'One useful thing, made clear', format: '5-slide carousel', stage: 'Concept', hook: 'Teach one small idea without overloading the reader.', slides: ['A concrete question', 'The common assumption', 'A clearer explanation', 'An example that makes it stick', 'A useful next step'] },
  { id: 'sample-c1', app: 'App C', title: 'Two paths, one clear contrast', format: '6-slide carousel', stage: 'Needs review', hook: 'Compare two approaches and make the distinction concrete.', slides: ['Two plausible approaches', 'What each optimizes for', 'Where path one helps', 'Where path two helps', 'The honest trade-off', 'Choose by context'] }
]
const BORDER = 'var(--ui-stroke-secondary)'
const MUTED = { color: 'var(--ui-text-tertiary)' }
const PANEL = { border: `1px solid ${BORDER}`, borderRadius: 'var(--ui-radius-sm, 4px)', background: 'color-mix(in srgb, var(--ui-text-secondary) 2%, transparent)' }

function MarketingPage({ ctx }) {
  const [app, setApp] = useState('All apps')
  const [selectedId, setSelectedId] = useState(null)
  const [drafts, setDrafts] = useState(() => ctx.storage.get('drafts', []))
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [rendered, setRendered] = useState(null)
  const [renderError, setRenderError] = useState('')
  const dirtyRef = React.useRef(false)
  dirtyRef.current = dirty
  const records = [...drafts, ...SAMPLES]
  const selected = records.find(item => item.id === selectedId) || null
  const cards = records.filter(item => app === 'All apps' || item.app === app)

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

  const reviewReady = item => item.rights === 'cleared' && item.claim === 'supported' && item.cta === 'checked' && item.slides.length > 0
  const createPipeline = () => {
    const item = { id: `pipeline-${Date.now()}`, app: app === 'All apps' ? 'App A' : app,
      title: 'Fictional focus app · static copy', isDraft: true, stage: 'Draft', hook: '', slides: [],
      source: { id: 'fixture:focus-1', kind: 'Fictional fixture', evidence: 'This fictional app lets a user write one next step. This is invented product context, not evidence of effectiveness.' },
      brief: 'Introduce the fictional one-next-step feature to readers who want a simple starting point.',
      hypothesis: 'Showing one concrete next step may make the feature easier to understand. Untested hypothesis.',
      rights: 'unknown', claim: 'unreviewed', cta: 'unchecked', review: 'blocked', versions: [] }
    const next = [item, ...drafts]
    ctx.storage.set('drafts', next)
    setDrafts(next)
    setSelectedId(item.id)
    setDirty(false)
  }
  const renderSlides = async () => {
    if (!selected?.slides?.length) return
    try { setRendered(await renderSlideshow({ title: selected.title, slides: selected.slides, theme: 'neutral' })) }
    catch (error) { setRenderError(error.message || 'Render failed.') }
  }
  const downloadPng = (slide, index) => {
    const url = URL.createObjectURL(new Blob([slide.png], { type: 'image/png' }))
    const link = document.createElement('a'); link.href = url; link.download = `slide-${String(index + 1).padStart(2, '0')}.png`; link.click()
    URL.revokeObjectURL(url)
  }
  const generateCopy = () => {
    if (selected.slides.length && !window.confirm('Replace current slide copy? Saved versions remain available.')) return
    setRendered(null)
    updateDraft('slides', [
      'What is one next step you could write down?',
      'Fictional example: this app lets you write one next step.',
      `Concept to explore: ${selected.hypothesis}`,
      'Try writing a next step on paper. No destination or account required.'
    ])
  }
  const updateDraft = (field, value) => {
    if (!selected?.isDraft) return
    setDrafts(drafts.map(item => item.id === selected.id ? { ...item, [field]: value, ...(item.source ? { review: 'blocked', ...(['slides', 'hypothesis', 'brief', 'hook', 'title'].includes(field) ? { claim: 'unreviewed', cta: 'unchecked' } : {}) } : {}) } : item))
    setDirty(true)
    setRendered(null)
  }
  const updateSlide = (index, value) => {
    const slides = [...selected.slides]
    slides[index] = value
    updateDraft('slides', slides)
  }
  const saveDraft = () => {
    const versioned = drafts.map(item => item.id === selected.id && item.source ? {
      ...item, versions: [...item.versions, { number: item.versions.length + 1, savedAt: new Date().toISOString(),
        title: item.title, source: { ...item.source }, brief: item.brief, hypothesis: item.hypothesis,
        slides: [...item.slides], rights: item.rights, claim: item.claim, cta: item.cta, review: item.review }]
    } : item)
    ctx.storage.set('drafts', versioned)
    setDrafts(versioned)
    setDirty(false)
    setNotice('Draft saved in this Hermes plugin on this device.')
  }
  const createDraft = () => {
    if (dirty && !window.confirm('Discard unsaved draft changes?')) return
    const item = { id: `draft-${Date.now()}`, app: app === 'All apps' ? 'App A' : app, title: 'Untitled slideshow draft', format: 'Draft · 0 slides', stage: 'Draft', hook: '', slides: [], isDraft: true }
    const next = [item, ...drafts]
    setDrafts(next)
    ctx.storage.set('drafts', next)
    setDirty(false)
    setSelectedId(item.id)
    setNotice('New local draft created.')
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
  const appTabs = jsx('div', { role: 'tablist', 'aria-label': 'App workspace', style: { display: 'flex', gap: '7px', flexWrap: 'wrap' }, children: ['All apps', ...APPS].map(item => jsx(Button, { role: 'tab', 'aria-selected': item === app, variant: item === app ? 'secondary' : 'ghost', onClick: () => navigateTo(() => { setApp(item); setSelectedId(null) }), children: item }, item)) })
  const metric = (label, caption) => jsxs('section', { style: { ...PANEL, minWidth: '0', flex: '1 1 185px', padding: '13px 15px' }, children: [jsx('div', { style: { color: 'var(--ui-text-quaternary)', fontSize: '0.7rem', textTransform: 'uppercase' }, children: label }), jsx('div', { style: { marginTop: '7px', fontSize: '1.4rem', fontWeight: 600 }, children: '—' }), jsx('div', { style: { ...MUTED, fontSize: '0.77rem', marginTop: '3px' }, children: caption })] })
  const sampleCard = item => jsx('button', { type: 'button', 'aria-label': `Open ${item.app} slideshow: ${item.title}`, onClick: () => navigateTo(() => setSelectedId(item.id)), style: { ...PANEL, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0', minHeight: '160px', padding: '14px', textAlign: 'left', color: 'inherit', cursor: 'pointer' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '7px', flexWrap: 'wrap' }, children: [badge(item.app, true), badge(item.isDraft ? 'Local draft' : item.stage)] }), jsx('div', { style: { fontSize: '0.98rem', fontWeight: 600 }, children: item.title }), jsx('div', { style: { ...MUTED, fontSize: '0.79rem' }, children: item.isDraft ? 'Saved only in this Hermes plugin' : item.format }), jsx('div', { style: { ...MUTED, fontSize: '0.82rem', lineHeight: 1.45 }, children: item.hook || 'Add an opening hook in the detail editor.' }), jsx('div', { style: { color: 'var(--ui-text-quaternary)', fontSize: '0.73rem', marginTop: 'auto' }, children: item.isDraft ? 'Local draft · Open details →' : 'Illustrative sample · Open details →' })] }, item.id)

  const overview = jsxs(Fragment, { children: [titleNode, appTabs, jsx('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '9px' }, children: [metric('Qualified activations', 'Not connected'), metric('Paid conversions', 'Not connected'), metric('Attributable revenue', 'Not connected')] }), jsxs('section', { style: { display: 'grid', gap: '10px' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }, children: [jsxs('div', { children: [jsx('h2', { style: { margin: 0, fontSize: '1rem', fontWeight: 600 }, children: 'Slideshow concepts' }), jsx('div', { style: { ...MUTED, fontSize: '0.77rem', marginTop: '3px' }, children: `${cards.length} cards · examples are fictional` })] }), button('＋ New local draft', createDraft, 'secondary'), button('＋ Fixture pipeline', createPipeline, 'secondary')] }), cards.length ? jsx('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '10px' }, children: cards.map(sampleCard) }) : jsx(EmptyState, { title: 'No concepts yet', description: 'Add a local draft for this app workspace.' })] })] })
  let detail = null
  if (selected) {
    const slideNodes = selected.slides.length ? jsx('ol', { style: { display: 'grid', gap: '7px', margin: 0, paddingLeft: '23px' }, children: selected.slides.map((slide, index) => jsx('li', { style: { padding: '5px 2px' }, children: selected.isDraft ? jsx('textarea', { 'aria-label': `Slide ${index + 1}`, value: slide, rows: 2, onChange: event => updateSlide(index, event.target.value), style: { ...fieldStyle, width: '100%', resize: 'vertical' } }) : slide }, `${selected.id}-${index}`)) }) : jsx('div', { style: MUTED, children: 'No slides yet. Add a slide to start this draft.' })
    const editor = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '11px', padding: '14px' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }, children: [jsx('h2', { style: { margin: 0, fontSize: '1rem' }, children: 'Slideshow details' }), selected.isDraft ? jsxs('div', { style: { display: 'flex', gap: '7px' }, children: [button(dirty ? 'Save draft' : 'Saved', saveDraft, 'secondary', !dirty), button('Delete draft', deleteDraft, 'outline')] }) : badge('Read-only sample')] }), selected.isDraft ? jsx('label', { style: fieldLabel, children: ['Draft title', jsx('input', { 'aria-label': 'Draft title', value: selected.title, onChange: event => updateDraft('title', event.target.value), style: fieldStyle })] }) : jsx('div', { children: selected.title }), selected.isDraft ? jsx('label', { style: fieldLabel, children: ['Opening hook', jsx('textarea', { 'aria-label': 'Opening hook', value: selected.hook, rows: 3, onChange: event => updateDraft('hook', event.target.value), style: { ...fieldStyle, resize: 'vertical' } })] }) : jsx('div', { style: MUTED, children: selected.hook }), jsx('div', { style: { color: 'var(--ui-text-secondary)', fontSize: '0.78rem', textTransform: 'uppercase' }, children: 'Ordered slides' }), slideNodes, selected.isDraft ? jsxs('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap' }, children: [button('＋ Add slide', () => updateDraft('slides', [...selected.slides, '']), 'outline'), selected.slides.length ? button('Remove last slide', () => updateDraft('slides', selected.slides.slice(0, -1)), 'outline') : null] }) : null] })
    const input = (label, value, onChange) => jsx('label', { style: fieldLabel, children: [label, jsx('textarea', { 'aria-label': label, value, onChange: e => onChange(e.target.value), style: fieldStyle })] })
    const status = (label, field, options) => jsx('label', { style: fieldLabel, children: [label, jsx('select', { 'aria-label': label, value: selected[field], onChange: e => updateDraft(field, e.target.value), children: options.map(value => jsx('option', { value, children: value }, value)) })] })
    const pipeline = selected.source ? jsxs('section', { style: { ...PANEL, padding: '14px', display: 'grid', gap: '10px' }, children: [
      jsx('h2', { children: 'Local fixture pipeline' }),
      jsx('p', { children: `${selected.source.kind} · ${selected.source.id}: ${selected.source.evidence}` }),
      jsx('p', { children: `Brief, hypothesis and all slide copy derive from ${selected.source.id}. Copy is a proposal, not validated performance or product claims.` }),
      input('Brief', selected.brief, value => updateDraft('brief', value)),
      input('Hypothesis', selected.hypothesis, value => updateDraft('hypothesis', value)),
      button('Generate static copy', generateCopy, 'outline', !selected.brief.trim() || !selected.hypothesis.trim()),
      button('Render slides', renderSlides, 'secondary', !selected.slides.length),
      renderError ? jsx('div', { role: 'alert', children: renderError }) : null,
      rendered ? jsxs('section', { style: { display: 'grid', gap: '10px' }, children: [jsx('h3', { children: `Rendered preview · ${rendered.dimensions.width} × ${rendered.dimensions.height}` }), button('Download slide 1 PNG', () => downloadPng(rendered.slides[0], 0), 'outline'),
      button('Export ZIP', async () => {
        try { const zip = await exportSlideshowZip(rendered, { draftId: selected.id, title: selected.title, app: selected.app, sourceId: selected.source?.id || null }); const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); const link = document.createElement('a'); link.href = url; link.download = 'slideshow-export.zip'; link.click(); URL.revokeObjectURL(url); setNotice('ZIP exported locally with slide images and source manifest.') }
        catch (error) { setRenderError(error.message || 'Export failed.') }
      }, 'secondary'),
      ...rendered.slides.map((slide, index) => jsxs('figure', { style: { ...PANEL, padding: '10px' }, children: [jsx('img', { src: `data:image/png;base64,${btoa(String.fromCharCode(...slide.png))}`, alt: `Rendered slide ${index + 1}`, style: { display: 'block', width: 'min(100%, 360px)', height: 'auto' } }), button(`Download slide ${index + 1} PNG`, () => downloadPng(slide, index), 'outline')] }, index))] }) : null,
      ...selected.slides.slice(1).map((_, index) => button(`Move slide ${index + 2} up`, () => {
        const slides = [...selected.slides]; [slides[index], slides[index + 1]] = [slides[index + 1], slides[index]]; updateDraft('slides', slides)
      })),
      status('Rights status', 'rights', ['unknown', 'cleared', 'restricted']),
      status('Claim status', 'claim', ['unreviewed', 'supported', 'unsupported']),
      status('CTA status', 'cta', ['unchecked', 'checked', 'blocked']),
      jsx('p', { children: `External review: ${selected.review}. Unknown or restricted rights block readiness. Statuses are local human attestations; nothing is sent.` }),
      button('Mark ready for external review', () => {
        if (!reviewReady(selected)) return
        setDrafts(drafts.map(item => item.id === selected.id ? { ...item, review: 'ready' } : item)); setDirty(true)
      }, 'outline', !reviewReady(selected)),
      jsx('h3', { children: 'Saved versions' }),
      ...selected.versions.map(version => jsx('details', { children: [jsx('summary', { children: `Version ${version.number} · ${version.savedAt}` }), jsx('pre', { style: { whiteSpace: 'pre-wrap' }, children: JSON.stringify(version, null, 2) })] }, version.number))
    ] }) : null
    const review = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '7px', padding: '13px 15px' }, children: [jsx('h2', { style: { margin: 0, fontSize: '0.92rem' }, children: 'Review before any external use' }), ...(selected.source ? [`Claim evidence: ${selected.source.id} · ${selected.claim}`, `CTA: ${selected.cta}`, `Rights: ${selected.rights}`] : ['Claim evidence: not provided', 'CTA destination: not connected', 'Asset rights and provenance: not provided', 'Human approval: required before sharing']).map(text => jsx('div', { style: { ...MUTED, fontSize: '0.79rem' }, children: text }, text))] })
    const performance = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '7px', padding: '13px 15px' }, children: [jsx('h2', { style: { margin: 0, fontSize: '0.92rem' }, children: 'Performance' }), jsx('div', { style: { ...MUTED, fontSize: '0.82rem' }, children: 'No platform or attribution data connected. Outcome is unavailable—not zero.' })] })
    detail = jsxs(Fragment, { children: [titleNode, appTabs, jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }, children: [jsx('span', { style: { color: 'var(--ui-text-secondary)', fontSize: '0.78rem' }, children: `Status · ${selected.stage}` }), selected.isDraft ? badge(dirty ? 'Unsaved changes' : 'Local draft', true) : badge('Sample creative only')] }), editor, pipeline, review, performance, notice ? jsx('div', { role: 'status', 'aria-live': 'polite', style: MUTED, children: notice }) : null] })
  }
  return jsx('main', { className: 'h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8', children: jsx('div', { style: { maxWidth: '1120px', margin: '0 auto', display: 'grid', gap: '15px', paddingBottom: '20px' }, children: selected ? detail : overview }) })
}

export default {
  id: 'marketing-system',
  name: 'App Marketing',
  description: 'App-agnostic slideshow workspace · fictional sample records only',
  register(ctx) {
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(MarketingPage, { ctx }) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: 'Marketing', codicon: 'megaphone' } })
    ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'marketing-system.open', label: 'Open app marketing', keywords: ['marketing', 'slideshows', 'app workspace'], run: () => host.navigate(ROUTE) } })
  }
}
