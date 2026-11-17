import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import React, { act } from 'react'
import TestRenderer from 'react-test-renderer'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true, prompt: (_message, fallback) => fallback ?? null }

async function mountWorkspace(options = {}) {
  const loaded = await loadPlugin()
  const registrations = []
  const storage = new Map()
  let failWrites = false
  const pixels = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 2])]
  const files = options.files || {
    requestFolder: async () => ({ ok: true, folder: { id: 'test-folder' } }),
    list: async () => ({ ok: true, entries: [{ name: 'test.png', path: 'test.png' }] }),
    readDataUrl: async () => ({ ok: true, url: 'data:image/png;base64,dGVzdA==' })
  }
  const ctx = { storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => { if (failWrites) throw new Error('Synthetic storage failure'); storage.set(key, value) } }, files, register: item => registrations.push(item) }
  const previousFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = async (url, request) => { fetchCalls.push({ url: String(url), request }); if (options.realHttp) return previousFetch(url, { ...request, headers: { ...(request?.headers || {}), Origin: 'file://' } }); return options.fetch ? options.fetch(url, request, pixels) : ({ ok: true, json: async () => String(url).endsWith('/health') ? ({ service: 'marketing-renderer', protocol: 2, features: ['image_data_url', 'zip-export'], maxRequestBytes: 64000000 }) : ({ dimensions: { width: 1080, height: 1920 }, slides: pixels.map((png, index) => ({ index: index + 1, pngBase64: Buffer.from(png).toString('base64') })) }) }) }
  loaded.default.register(ctx)
  let renderer
  await act(async () => { renderer = TestRenderer.create(registrations[0].render()) })
  const find = (selector, root = renderer.root) => root.findAll(selector)
  const button = label => find(node => node.type === 'button' && (node.props.children === label || node.props['aria-label'] === label))[0]
  const click = async label => { const target = button(label); assert.ok(target, `Missing production button: ${label}`); await act(async () => { await target.props.onClick?.() }); if (label === '＋ Add slide') { const index = find(node => node.props['aria-label']?.match(/^Slide \d+ headline$/)).length; for (const [suffix, value] of [['headline', `Test headline ${index}`], ['body', `Test body ${index}`]]) { const input = find(node => node.props['aria-label'] === `Slide ${index} ${suffix}`)[0]; await act(async () => input.props.onChange({ target: { value } })) } } }
  const cleanup = async () => { await act(async () => renderer.unmount()); globalThis.fetch = previousFetch; await loaded.cleanup() }
  return { renderer, storage, fetchCalls, find, button, click, failWrites: value => { failWrites = value }, cleanup }
}

test('thumbnail_selection_changes_large_preview', async () => {
  const images = ['data:image/png;base64,Y2hhcnJ5LW9uZQ==', 'data:image/png;base64,Y2hhcnJ5LXR3bw==']
  const ui = await mountWorkspace({ files: {
    requestFolder: async () => ({ ok: true, folder: { id: 'grant-thumbnails' } }),
    list: async () => ({ ok: true, entries: [{ name: 'slide-1.png', path: 'slide-1.png' }, { name: 'slide-2.png', path: 'slide-2.png' }] }),
    readDataUrl: async (_folder, relativePath) => ({ ok: true, url: images[relativePath === 'slide-1.png' ? 0 : 1] })
  } })
  const priorPrompt = window.prompt
  let selection = 0
  window.prompt = () => ['slide-1.png', 'slide-2.png'][selection++]
  try {
    await ui.click('＋ Create pipeline concept')
    await ui.click('＋ Add slide')
    await ui.click('＋ Add slide')
    await ui.click('Choose image for slide 1')
    await ui.click('Choose image for slide 2')
    await ui.click('Render slideshow')
    const renderCall = ui.fetchCalls.find(call => call.url.endsWith('/render'))
    const request = JSON.parse(renderCall.request.body)
    assert.equal(request.slides[0].image_data_url, images[0])
    assert.equal(request.slides[1].image_data_url, images[1])
    assert.equal(ui.find(node => node.type === 'img' && node.props.alt === 'Rendered slide 1').length, 1)
    assert.equal(ui.find(node => node.type === 'img' && node.props.alt === 'Rendered slide 1')[0].props.style.height, 'min(62vh, 720px)')
    assert.equal(ui.find(node => node.props['aria-label'] === 'Show slide 1')[0].props.style.width, '52px')
    await ui.click('Show slide 2')
    assert.equal(ui.find(node => node.type === 'img' && node.props.alt === 'Rendered slide 2').length, 1)
    assert.equal(ui.find(node => node.props['aria-label'] === 'Show slide 2' && node.props['aria-current'] === 'true').length, 1)
    assert.equal(ui.find(node => node.type === 'h3' && node.children.join('') === 'Slide 2 of 2 · 1080 × 1920').length, 1)
  } finally { window.prompt = priorPrompt; await ui.cleanup() }
})

test('text_only_renderer_protocol_is_refused_before_readiness', async () => {
  const ui = await mountWorkspace({ fetch: async (url) => ({ ok: true, text: async () => 'OK', json: async () => ({}) }) })
  try {
    await ui.click('＋ Create pipeline concept')
    await ui.click('＋ Add slide')
    await ui.click('Choose image for slide 1')
    await ui.click('Render slideshow')
    assert.equal(ui.fetchCalls.some(call => call.url.endsWith('/render')), false)
    assert.match(ui.find(node => node.props.role === 'alert')[0].children.join(''), /protocol/i)
  } finally { await ui.cleanup() }
})

test('edit_invalidates_render', async () => {
  const ui = await mountWorkspace()
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide'); await ui.click('Choose image for slide 1'); await ui.click('Render slideshow')
    assert.equal(ui.find(node => node.type === 'img' && node.props.alt === 'Rendered slide 1').length, 1)
    const field = ui.find(node => node.type === 'textarea' && node.props['aria-label'] === 'Slide 1 body')[0]
    await act(async () => field.props.onChange({ target: { value: 'Edited text' } }))
    assert.equal(ui.find(node => node.type === 'img' && node.props.alt === 'Rendered slide 1').length, 0)
  } finally { await ui.cleanup() }
})

test('navigate_resets_preview', async () => {
  const ui = await mountWorkspace()
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide'); await ui.click('Choose image for slide 1'); await ui.click('Render slideshow')
    await ui.click('← Overview')
    await ui.click('Open Cherry workspace draft: Cherry workspace draft')
    assert.equal(ui.find(node => node.type === 'img' && node.props.alt.startsWith('Rendered slide')).length, 0)
  } finally { await ui.cleanup() }
})

test('save_failure_keeps_dirty_and_shows_error', async () => {
  const ui = await mountWorkspace()
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide')
    ui.failWrites(true)
    await ui.click('Save draft')
    assert.ok(ui.find(node => node.props.children === 'Unsaved changes').length >= 1)
    assert.match(ui.find(node => node.props.role === 'alert')[0].children.join(''), /Synthetic storage failure/)
  } finally { await ui.cleanup() }
})

test('new_cherry_draft_has_no_invented_approvals', async () => {
  const ui = await mountWorkspace()
  try {
    await ui.click('＋ New local draft')
    const draft = ui.storage.get('drafts')[0]
    assert.equal(draft.app, 'Cherry')
    assert.equal(draft.cta, 'unconfigured')
    assert.equal(draft.claimsApproval, 'unconfigured')
    assert.equal(draft.rights, 'unknown')
    assert.equal(draft.review, 'blocked')
    assert.deepEqual(draft.channels, [])
    assert.deepEqual(draft.assets, [])
  } finally { await ui.cleanup() }
})

test('large_png_preview_and_zip_do_not_overflow_arguments', async () => {
  const raw = new Uint8Array(1_100_000); raw.set([137, 80, 78, 71, 13, 10, 26, 10]); raw.fill(23, 8)
  const pngBase64 = Buffer.from(raw).toString('base64')
  const ui = await mountWorkspace({ fetch: async (url, request) => {
    if (String(url).endsWith('/health')) return { ok: true, json: async () => ({ service: 'marketing-renderer', protocol: 2, features: ['image_data_url', 'zip-export'], maxRequestBytes: 64000000 }) }
    if (String(url).endsWith('/export')) return { ok: true, json: async () => ({ zipBase64: 'UEsDBA==' }) }
    return { ok: true, json: async () => ({ dimensions: { width: 1080, height: 1920 }, slides: [{ index: 1, pngBase64 }] }) }
  } })
  const priorDocument = globalThis.document
  globalThis.document = { createElement: () => ({ click() {} }) }
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide'); await ui.click('Choose image for slide 1'); await ui.click('Render slideshow')
    assert.equal(ui.find(node => node.type === 'img' && node.props.alt === 'Rendered slide 1')[0].props.src, `data:image/png;base64,${pngBase64}`)
    await ui.click('Export slideshow ZIP')
    const exportCall = ui.fetchCalls.find(call => call.url.endsWith('/export'))
    assert.equal(JSON.parse(exportCall.request.body).rendered.slides[0].pngBase64, pngBase64)
  } finally { globalThis.document = priorDocument; await ui.cleanup() }
})

test('cancel_image_picker_preserves_slide', async () => {
  const ui = await mountWorkspace({ files: { requestFolder: async () => ({ ok: false, cancelled: true }) } })
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide')
    const slide = ui.find(node => node.type === 'textarea' && node.props['aria-label'] === 'Slide 1 body')[0]
    await act(async () => slide.props.onChange({ target: { value: 'Keep this slide' } }))
    await ui.click('Choose image for slide 1')
    assert.equal(ui.find(node => node.type === 'textarea' && node.props['aria-label'] === 'Slide 1 body')[0].props.value, 'Keep this slide')
  } finally { await ui.cleanup() }
})

test('selected_image_bytes_cross_the_production_render_boundary_with_hash_and_source', async () => {
  const imageBytes = Buffer.from('synthetic image bytes')
  const dataUrl = `data:image/png;base64,${imageBytes.toString('base64')}`
  const ui = await mountWorkspace({ files: {
    requestFolder: async () => ({ ok: true, folder: { id: 'grant-1' } }),
    list: async folderId => ({ ok: true, entries: [{ name: 'fixture.png', path: 'fixture.png', isDirectory: false }] }),
    readDataUrl: async (folderId, relativePath) => ({ ok: true, url: dataUrl })
  } })
  const priorPrompt = window.prompt
  window.prompt = () => 'fixture.png'
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide')
    await ui.click('Choose image for slide 1'); await ui.click('Render slideshow')
    const call = ui.fetchCalls.find(item => item.url.endsWith('/render'))
    const renderedRequest = JSON.parse(call.request.body)
    assert.equal(renderedRequest.slides[0].image_data_url, dataUrl)
    assert.equal(renderedRequest.slides[0].image_sha256, '9d714b0153c5204b5503770a41d5800ed8ba4e24da1a9429b6654397075031b6')
    assert.equal(renderedRequest.slides[0].source_ref, 'user-folder://grant-1/fixture.png')
  } finally { window.prompt = priorPrompt; await ui.cleanup() }
})

test('oversized_image_data_url_is_rejected_before_hashing_or_http', async () => {
  const tooLarge = `data:image/png;base64,${'A'.repeat(64_000_000)}`
  const ui = await mountWorkspace({ files: {
    requestFolder: async () => ({ ok: true, folder: { id: 'grant-large' } }),
    list: async () => ({ ok: true, entries: [{ name: 'large.png', path: 'large.png' }] }),
    readDataUrl: async () => ({ ok: true, url: tooLarge })
  } })
  const priorPrompt = window.prompt
  window.prompt = () => 'large.png'
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide'); await ui.click('Choose image for slide 1')
    assert.equal(ui.fetchCalls.some(call => call.url.endsWith('/render')), false)
    assert.match(ui.find(node => node.props.role === 'alert')[0].children.join(''), /12 MB/)
  } finally { window.prompt = priorPrompt; await ui.cleanup() }
})

test('render_requires_an_image_for_each_slide_before_http', async () => {
  const ui = await mountWorkspace()
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide'); await ui.click('Render slideshow')
    assert.equal(ui.fetchCalls.length, 0)
    assert.match(ui.find(node => node.props.role === 'alert')[0].children.join(''), /image for each slide/i)
  } finally { await ui.cleanup() }
})

test('saved_selected_image_survives_reopen_and_is_sent_with_nonempty_slide_text', async () => {
  const ui = await mountWorkspace({ files: {
    requestFolder: async () => ({ ok: true, folder: { id: 'persist-folder' } }),
    list: async () => ({ ok: true, entries: [{ name: 'persist.png', path: 'persist.png' }] }),
    readDataUrl: async () => ({ ok: true, url: 'data:image/png;base64,cGVyc2lzdA==' })
  } })
  const priorPrompt = window.prompt; window.prompt = () => 'persist.png'
  try {
    await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide')
    for (const [label, value] of [['Slide 1 headline', 'A real headline'], ['Slide 1 body', 'A real body']]) {
      const input = ui.find(node => node.props['aria-label'] === label)[0]
      await act(async () => input.props.onChange({ target: { value } }))
    }
    await ui.click('Choose image for slide 1'); await ui.click('Save draft'); await ui.click('← Overview')
    await ui.click('Open Cherry workspace draft: Cherry workspace draft')
    await ui.click('Render slideshow')
    const request = JSON.parse(ui.fetchCalls.find(call => call.url.endsWith('/render')).request.body)
    assert.equal(request.slides[0].headline, 'A real headline')
    assert.equal(request.slides[0].body, 'A real body')
    assert.equal(request.slides[0].image_data_url, 'data:image/png;base64,cGVyc2lzdA==')
  } finally { window.prompt = priorPrompt; await ui.cleanup() }
})


test('production_render_caller_reaches_real_python_handler', async () => {
  const child = spawn('/opt/hermes/.venv/bin/python', ['-c', "import sys; sys.path.insert(0,'renderer'); from http.server import HTTPServer; from server import Handler; HTTPServer(('127.0.0.1',8765),Handler).serve_forever()"], { stdio: 'ignore' })
  const waitReady = async () => { for (let i = 0; i < 50; i++) { try { const response = await fetch('http://127.0.0.1:8765/api/health'); if (response.ok) return } catch {} await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error('real renderer failed to start') }
  try {
    await waitReady()
    const raw = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGMMSKlgYGBgYmBgYGBgAAAOEgEwZR3iZwAAAABJRU5ErkJggg==', 'base64')
    const dataUrl = `data:image/png;base64,${raw.toString('base64')}`
    const ui = await mountWorkspace({ realHttp: true, files: { requestFolder: async () => ({ ok: true, folder: { id: 'real-folder' } }), list: async () => ({ ok: true, entries: [{ name: 'real.png', path: 'real.png' }] }), readDataUrl: async () => ({ ok: true, url: dataUrl }) } })
    const priorPrompt = window.prompt; window.prompt = () => 'real.png'
    try {
      await ui.click('＋ Create pipeline concept'); await ui.click('＋ Add slide')
      for (const [label, value] of [['Slide 1 headline', 'Actual endpoint headline'], ['Slide 1 body', 'Actual endpoint body']]) { const input = ui.find(node => node.props['aria-label'] === label)[0]; await act(async () => input.props.onChange({ target: { value } })) }
      await ui.click('Choose image for slide 1'); await ui.click('Render slideshow')
      assert.equal(ui.find(node => node.type === 'img' && node.props.alt === 'Rendered slide 1').length, 1)
      const image = ui.find(node => node.type === 'img' && node.props.alt === 'Rendered slide 1')[0]
      assert.ok(Buffer.from(image.props.src.split(',')[1], 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      const call = ui.fetchCalls.find(item => item.url.endsWith('/render'))
      const sent = JSON.parse(call.request.body).slides[0]
      assert.equal(sent.headline, 'Actual endpoint headline'); assert.equal(sent.body, 'Actual endpoint body')
    } finally { window.prompt = priorPrompt; await ui.cleanup() }
  } finally { child.kill('SIGTERM') }
})
