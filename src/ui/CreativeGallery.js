import React, { useEffect, useState } from 'react'

const h = React.createElement
const iterationLabel = value => {
  const match = typeof value === 'string' && /^iteration-([0-9]+)$/.exec(value)
  return match ? `Revision ${match[1]}` : 'Original'
}
function CreativeCover({ api, item }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const node = React.useRef(null)
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
  const [image, setImage] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    api(`/creative-previews?app=${encodeURIComponent(selectedApp)}`).then(x => { if (live) setItems(x.creatives || []) })
      .catch(e => { if (live) setError(e.message || 'Creative gallery unavailable.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [selectedApp])
  useEffect(() => {
    let live = true
    setError('')
    setImage(null)
    if (selected) api(`/creative-previews/${encodeURIComponent(selected.runId)}/${encodeURIComponent(selected.id)}/slides/${slide}`)
      .then(x => { if (live) setImage(x.dataUrl) })
      .catch(e => { if (live) setError(e.message || 'Rendered slide unavailable.') })
    return () => { live = false }
  }, [selected, slide])
  const panel = { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 6, padding: 14, display: 'grid', gap: 10 }
  if (loading) return h('section', { role: 'status' }, 'Loading generated creatives…')
  if (error && !selected) return h('section', { style: panel }, h('h2', null, 'Generated creatives'), h('p', { role: 'alert' }, `Generated creatives are unavailable: ${error}`))
  if (!items.length) return h('section', { style: panel }, h('h2', null, 'Generated creatives'), h('p', null, 'No saved rendered Cherry creatives are available for this profile.'))
  if (!selected) return h('section', { style: { display: 'grid', gap: 14 } },
    h('h2', null, 'Generated creatives'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 } },
      ...items.map(item => h('button', { key: item.id, onClick: () => { setSelected(item); setSlide(0) }, style: { ...panel, color: 'inherit', textAlign: 'left', cursor: 'pointer' } },
        h(CreativeCover, { api, item }), h('strong', null, item.title), h('span', null, `Unapproved · ${item.status}`), h('span', null, `${item.slideCount} rendered slides · ${iterationLabel(item.iteration)}`)))))
  const buttons = selected.slides.map((_, i) => h('button', { key: i, onClick: () => setSlide(i), 'aria-label': `Show slide ${i + 1}`, 'aria-current': slide === i ? 'true' : undefined }, `Slide ${i + 1}`))
  const reviews = (selected.qualityReviews || []).map((r, i) => h('li', { key: i }, `${r.dimension}: ${r.score ?? 'not scored'}${r.rationale ? ` — ${r.rationale}` : ''}`))
  const blockers = (selected.hardBlockers || []).map((b, i) => h('p', { key: i }, `Blocker: ${typeof b === 'string' ? b : JSON.stringify(b)}`))
  return h('section', { style: { display: 'grid', gap: 14 } }, h('h2', null, 'Generated creatives'),
    h('article', { style: panel }, h('h3', null, selected.title), h('span', { role: 'status' }, `Unapproved · ${selected.status} · ${iterationLabel(selected.iteration)}`),
      image ? h('img', { alt: `${selected.title}, slide ${slide + 1}`, src: image, style: { maxHeight: '65vh', maxWidth: '100%', objectFit: 'contain', justifySelf: 'center' } }) : error ? h('p', { role: 'alert' }, `Rendered slide unavailable: ${error}`) : h('span', { role: 'status' }, 'Loading rendered slide…'),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, ...buttons, h('button', { onClick: () => setSlide(Math.max(0, slide - 1)), disabled: slide === 0 }, 'Previous'), h('button', { onClick: () => setSlide(Math.min(selected.slideCount - 1, slide + 1)), disabled: slide >= selected.slideCount - 1 }, 'Next')),
      h('h4', null, 'Critique scores'), h('ul', null, ...reviews), ...blockers,
      h('button', { onClick: async () => { try { const workspace = await api(`/api/workspace?app=${encodeURIComponent(selectedApp)}`); const draft = workspace.drafts?.find(item => item.id === selected.draftId && item.app === selectedApp); if (!draft) throw new Error('No saved editable draft is linked to this generated result.'); openDraft(draft) } catch (e) { setError(e.message || 'Saved draft is unavailable.') } } }, 'Edit draft'),
      h('button', { onClick: () => { setSelected(null); setSlide(0); setError('') } }, 'Back to creatives')))
}
