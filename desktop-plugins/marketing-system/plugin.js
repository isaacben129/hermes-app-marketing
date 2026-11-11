import { Badge, Button, EmptyState, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host } from '@hermes/plugin-sdk'
import React, { useEffect, useState } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

const ROUTE = '/marketing-system'
const APPS = ['App A', 'App B', 'App C']
const SAMPLES = [
  { id: 'sample-a1', app: 'App A', title: 'Problem → payoff', format: '7-slide carousel', stage: 'Draft', hook: 'Open with a recognizable moment, then show one useful next step.', slides: ['A recognizable moment', 'Why the usual response falls short', 'One practical change', 'A concrete example', 'A specific next step', 'Claim and rights check', 'One clear action'] },
  { id: 'sample-b1', app: 'App B', title: 'One useful thing, made clear', format: '5-slide carousel', stage: 'Concept', hook: 'Teach one small idea without overloading the reader.', slides: ['A concrete question', 'The common assumption', 'A clearer explanation', 'An example that makes it stick', 'A useful next step'] },
  { id: 'sample-c1', app: 'App C', title: 'Two paths, one clear contrast', format: '6-slide carousel', stage: 'Needs review', hook: 'Compare two approaches and make the distinction concrete.', slides: ['Two plausible approaches', 'What each optimizes for', 'Where path one helps', 'Where path two helps', 'The honest trade-off', 'Choose by context'] }
]
const BORDER = 'var(--ui-stroke-secondary)'
const MUTED = { color: 'var(--ui-text-tertiary)' }
const PANEL = { border: `1px solid ${BORDER}`, borderRadius: 'var(--ui-radius-md, 8px)', background: 'color-mix(in srgb, var(--ui-text-secondary) 2%, transparent)' }

function MarketingPage({ ctx }) {
  const [app, setApp] = useState('All apps')
  const [selectedId, setSelectedId] = useState(null)
  const [drafts, setDrafts] = useState(() => ctx.storage.get('drafts', []))
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
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

  const updateDraft = (field, value) => {
    if (!selected?.isDraft) return
    setDrafts(drafts.map(item => item.id === selected.id ? { ...item, [field]: value } : item))
    setDirty(true)
  }
  const saveDraft = () => {
    ctx.storage.set('drafts', drafts)
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
    setDirty(false)
    next()
    setNotice('')
  }
  const updateSlide = (index, value) => {
    const slides = [...selected.slides]
    slides[index] = value
    updateDraft('slides', slides)
  }
  const titleNode = jsxs('header', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '14px', flexWrap: 'wrap' }, children: [jsxs('div', { children: [jsx('div', { style: { color: 'var(--ui-text-quaternary)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase' }, children: 'APP MARKETING · LOCAL PROTOTYPE' }), jsx('h1', { style: { margin: '7px 0 4px', fontSize: '1.4rem', fontWeight: 600 }, children: selected ? selected.title : 'Marketing overview' }), jsx('div', { style: { ...MUTED, fontSize: '0.84rem' }, children: 'Slideshow workspace · no accounts, external services, or live business data.' })] }), selected ? button('← Overview', () => navigateTo(() => setSelectedId(null)), 'outline') : null] })
  const appTabs = jsx('div', { role: 'tablist', 'aria-label': 'App workspace', style: { display: 'flex', gap: '7px', flexWrap: 'wrap' }, children: ['All apps', ...APPS].map(item => jsx(Button, { role: 'tab', 'aria-selected': item === app, variant: item === app ? 'secondary' : 'ghost', onClick: () => navigateTo(() => { setApp(item); setSelectedId(null) }), children: item }, item)) })
  const metric = (label, caption) => jsxs('section', { style: { ...PANEL, minWidth: '0', flex: '1 1 185px', padding: '13px 15px' }, children: [jsx('div', { style: { color: 'var(--ui-text-quaternary)', fontSize: '0.7rem', textTransform: 'uppercase' }, children: label }), jsx('div', { style: { marginTop: '7px', fontSize: '1.4rem', fontWeight: 600 }, children: '—' }), jsx('div', { style: { ...MUTED, fontSize: '0.77rem', marginTop: '3px' }, children: caption })] })
  const sampleCard = item => jsx('button', { type: 'button', 'aria-label': `Open ${item.app} slideshow: ${item.title}`, onClick: () => navigateTo(() => setSelectedId(item.id)), style: { ...PANEL, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0', minHeight: '160px', padding: '14px', textAlign: 'left', color: 'inherit', cursor: 'pointer' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '7px', flexWrap: 'wrap' }, children: [badge(item.app, true), badge(item.isDraft ? 'Local draft' : item.stage)] }), jsx('div', { style: { fontSize: '0.98rem', fontWeight: 600 }, children: item.title }), jsx('div', { style: { ...MUTED, fontSize: '0.79rem' }, children: item.isDraft ? 'Saved only in this Hermes plugin' : item.format }), jsx('div', { style: { ...MUTED, fontSize: '0.82rem', lineHeight: 1.45 }, children: item.hook || 'Add an opening hook in the detail editor.' }), jsx('div', { style: { color: 'var(--ui-text-quaternary)', fontSize: '0.73rem', marginTop: 'auto' }, children: item.isDraft ? 'Local draft · Open details →' : 'Illustrative sample · Open details →' })] }, item.id)

  const overview = jsxs(Fragment, { children: [titleNode, appTabs, jsx('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '9px' }, children: [metric('Qualified activations', 'Not connected'), metric('Paid conversions', 'Not connected'), metric('Attributable revenue', 'Not connected')] }), jsxs('section', { style: { display: 'grid', gap: '10px' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }, children: [jsxs('div', { children: [jsx('h2', { style: { margin: 0, fontSize: '1rem', fontWeight: 600 }, children: 'Slideshow concepts' }), jsx('div', { style: { ...MUTED, fontSize: '0.77rem', marginTop: '3px' }, children: `${cards.length} cards · examples are fictional` })] }), button('＋ New local draft', createDraft, 'secondary')] }), cards.length ? jsx('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '10px' }, children: cards.map(sampleCard) }) : jsx(EmptyState, { title: 'No concepts yet', description: 'Add a local draft for this app workspace.' })] })] })
  let detail = null
  if (selected) {
    const slideNodes = selected.slides.length ? jsx('ol', { style: { display: 'grid', gap: '7px', margin: 0, paddingLeft: '23px' }, children: selected.slides.map((slide, index) => jsx('li', { style: { padding: '5px 2px' }, children: selected.isDraft ? jsx('textarea', { 'aria-label': `Slide ${index + 1}`, value: slide, rows: 2, onChange: event => updateSlide(index, event.target.value), style: { ...fieldStyle, width: '100%', resize: 'vertical' } }) : slide }, `${selected.id}-${index}`)) }) : jsx('div', { style: MUTED, children: 'No slides yet. Add a slide to start this draft.' })
    const editor = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '11px', padding: '14px' }, children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }, children: [jsx('h2', { style: { margin: 0, fontSize: '1rem' }, children: 'Slideshow details' }), selected.isDraft ? jsxs('div', { style: { display: 'flex', gap: '7px' }, children: [button(dirty ? 'Save draft' : 'Saved', saveDraft, 'secondary', !dirty), button('Delete draft', deleteDraft, 'outline')] }) : badge('Read-only sample')] }), selected.isDraft ? jsx('label', { style: fieldLabel, children: ['Draft title', jsx('input', { 'aria-label': 'Draft title', value: selected.title, onChange: event => updateDraft('title', event.target.value), style: fieldStyle })] }) : jsx('div', { children: selected.title }), selected.isDraft ? jsx('label', { style: fieldLabel, children: ['Opening hook', jsx('textarea', { 'aria-label': 'Opening hook', value: selected.hook, rows: 3, onChange: event => updateDraft('hook', event.target.value), style: { ...fieldStyle, resize: 'vertical' } })] }) : jsx('div', { style: MUTED, children: selected.hook }), jsx('div', { style: { color: 'var(--ui-text-secondary)', fontSize: '0.78rem', textTransform: 'uppercase' }, children: 'Ordered slides' }), slideNodes, selected.isDraft ? jsxs('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap' }, children: [button('＋ Add slide', () => updateDraft('slides', [...selected.slides, '']), 'outline'), selected.slides.length ? button('Remove last slide', () => updateDraft('slides', selected.slides.slice(0, -1)), 'outline') : null] }) : null] })
    const review = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '7px', padding: '13px 15px' }, children: [jsx('h2', { style: { margin: 0, fontSize: '0.92rem' }, children: 'Review before any external use' }), ...['Claim evidence: not provided', 'CTA destination: not connected', 'Asset rights and provenance: not provided', 'Human approval: required before sharing'].map(text => jsx('div', { style: { ...MUTED, fontSize: '0.79rem' }, children: text }, text))] })
    const performance = jsxs('section', { style: { ...PANEL, display: 'grid', gap: '7px', padding: '13px 15px' }, children: [jsx('h2', { style: { margin: 0, fontSize: '0.92rem' }, children: 'Performance' }), jsx('div', { style: { ...MUTED, fontSize: '0.82rem' }, children: 'No platform or attribution data connected. Outcome is unavailable—not zero.' })] })
    detail = jsxs(Fragment, { children: [titleNode, appTabs, jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }, children: [jsx('span', { style: { color: 'var(--ui-text-secondary)', fontSize: '0.78rem' }, children: `Status · ${selected.stage}` }), selected.isDraft ? badge(dirty ? 'Unsaved changes' : 'Local draft', true) : badge('Sample creative only')] }), editor, review, performance, notice ? jsx('div', { role: 'status', 'aria-live': 'polite', style: MUTED, children: notice }) : null] })
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
