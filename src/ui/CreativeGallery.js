import React, { useEffect, useRef, useState } from 'react'

const h = React.createElement
const iterationLabel = value => {
  const match = typeof value === 'string' && /^iteration-([0-9]+)$/.exec(value)
  return match ? `Revision ${match[1]}` : 'Original'
}
function CreativeCover({ api, item }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const node = useRef(null)
  useEffect(() => {
    if (!node.current) return
    let live = true
    const load = () => api(`/creative-previews/${encodeURIComponent(item.runId)}/${encodeURIComponent(item.id)}/slides/0`).then(x => { if (live) setSrc(x.dataUrl) }).catch(() => { if (live) setFailed(true) })
    if (typeof IntersectionObserver === 'undefined') { load(); return () => { live = false } }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load() } })
    observer.observe(node.current)
    return () => { live = false; observer.disconnect() }
  }, [item.id, item.runId])
  return h('span', { ref: node, role: failed ? 'img' : 'status', 'aria-label': failed ? 'Saved cover unavailable' : undefined }, src ? h('img', { alt: '', loading: 'lazy', src, style: { width: '100%', maxHeight: 180, objectFit: 'contain' } }) : failed ? 'Saved cover unavailable' : 'Saved cover preview')
}
export default function CreativeGallery({ api, openDraft, selectedApp = 'Cherry' }) {
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [slide, setSlide] = useState(0)
  const [displayed, setDisplayed] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const requestId = useRef(0)
  useEffect(() => {
    let live = true
    api(`/creative-previews?app=${encodeURIComponent(selectedApp)}`).then(x => { if (live) setItems(x.creatives || []) })
      .catch(e => { if (live) setError(e.message || 'Creative gallery unavailable.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [selectedApp])
  useEffect(() => {
    const request = ++requestId.current
    let live = true
    setError('')
    if (!selected) return () => { live = false }
    const creativeKey = `${selected.runId}/${selected.id}`
    api(`/creative-previews/${encodeURIComponent(selected.runId)}/${encodeURIComponent(selected.id)}/slides/${slide}`)
      .then(async result => {
        if (result.index !== undefined && result.index !== slide) throw new Error('The service returned a different slide than requested.')
        if (!result.dataUrl) throw new Error('The rendered slide has no image data.')
        if (typeof Image !== 'undefined') {
          const decoded = new Image()
          decoded.src = result.dataUrl
          if (typeof decoded.decode === 'function') await decoded.decode()
          else await new Promise((resolve, reject) => { decoded.onload = resolve; decoded.onerror = reject })
        }
        if (live && request === requestId.current) setDisplayed({ creativeKey, index: slide, src: result.dataUrl })
      })
      .catch(e => { if (live && request === requestId.current) setError(e.message || 'Rendered slide unavailable.') })
    return () => { live = false }
  }, [selected, slide, retry])
  const panel = { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 6, padding: 14, display: 'grid', gap: 10 }
  if (loading) return h('section', { role: 'status' }, 'Loading generated creatives…')
  if (error && !selected) return h('section', { style: panel }, h('h2', null, 'Generated creatives'), h('p', { role: 'alert' }, `Generated creatives are unavailable: ${error}`))
  if (!items.length) return h('section', { style: panel }, h('h2', null, 'Generated creatives'), h('p', null, 'No saved rendered Cherry creatives are available for this profile.'))
  if (!selected) return h('section', { style: { display: 'grid', gap: 14 } },
    h('h2', null, 'Generated creatives'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 } },
      ...items.map(item => h('button', { key: item.id, onClick: () => { setSelected(item); setSlide(0); setDisplayed(null) }, style: { ...panel, color: 'inherit', textAlign: 'left', cursor: 'pointer' } },
        h(CreativeCover, { api, item }), h('strong', null, item.title), h('span', null, `Unapproved · ${item.status}`), h('span', null, `${item.slideCount} rendered slides · ${iterationLabel(item.iteration)}`)))))
  const creativeKey = `${selected.runId}/${selected.id}`
  const shown = displayed?.creativeKey === creativeKey ? displayed : null
  const shownLabel = shown ? `Showing ${selected.title}, slide ${shown.index + 1}` : `No slide is currently displayed for ${selected.title}`
  const buttons = selected.slides.map((_, i) => h('button', { key: i, onClick: () => setSlide(i), 'aria-label': `Show slide ${i + 1}`, 'aria-current': slide === i ? 'true' : undefined }, `Slide ${i + 1}`))
  const reviews = (selected.qualityReviews || []).map((r, i) => h('li', { key: i }, `${r.dimension}: ${r.score ?? 'not scored'}${r.rationale ? ` — ${r.rationale}` : ''}`))
  const blockers = (selected.hardBlockers || []).map((b, i) => h('p', { key: i }, `Blocker: ${typeof b === 'string' ? b : JSON.stringify(b)}`))
  return h('section', { style: { display: 'grid', gap: 14 } }, h('h2', null, 'Generated creatives'),
    h('article', { style: panel }, h('h3', null, selected.title), h('span', { role: 'status' }, `Unapproved · ${selected.status} · ${iterationLabel(selected.iteration)}`),
      h('div', { 'aria-label': 'Portrait slide stage', style: { position: 'relative', width: 'min(100%, calc(65vh * 9 / 16))', aspectRatio: '9 / 16', maxHeight: '65vh', margin: 'auto', overflow: 'hidden', background: 'var(--ui-bg-secondary)', display: 'grid', placeItems: 'center' } },
        shown && h('img', { alt: `${selected.title}, slide ${shown.index + 1}`, src: shown.src, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } }),
        (error || shown?.index !== slide) && h('span', { role: error ? 'alert' : 'status', style: { position: 'absolute', zIndex: 1, left: 8, right: 8, bottom: 8, padding: 8, background: 'rgba(0,0,0,.72)', color: 'white', textAlign: 'center' } }, error ? `Slide ${slide + 1} unavailable. ${shownLabel}` : `Loading slide ${slide + 1}. ${shownLabel}`),
      ),
      error && h('button', { onClick: () => { setError(''); setRetry(value => value + 1) } }, 'Retry slide'),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, ...buttons, h('button', { onClick: () => setSlide(Math.max(0, slide - 1)), disabled: slide === 0 }, 'Previous'), h('button', { onClick: () => setSlide(Math.min(selected.slideCount - 1, slide + 1)), disabled: slide >= selected.slideCount - 1 }, 'Next')),
      h('h4', null, 'Critique scores'), h('ul', null, ...reviews), ...blockers,
      h('button', { onClick: async () => { try { const workspace = await api(`/api/workspace?app=${encodeURIComponent(selectedApp)}`); const draft = workspace.drafts?.find(item => item.id === selected.draftId && item.app === selectedApp); if (!draft) throw new Error('No saved editable draft is linked to this generated result.'); openDraft(draft) } catch (e) { setError(e.message || 'Saved draft is unavailable.') } } }, 'Edit draft'),
      h('button', { onClick: () => { setSelected(null); setSlide(0); setDisplayed(null); setError('') } }, 'Back to creatives')))
}
