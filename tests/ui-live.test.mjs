import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { startLocal } from '../src/service/lifecycle.mjs'
import { loadPlugin } from './helpers/load-plugin.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('registered UI uses live HTTP service through save, readback, render, preview, and ZIP download', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marketing-ui-live-'))
  const port = async () => { const net = await import('node:net'); const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p }
  let service; let loaded
  try {
    service = await startLocal({ dataDir, servicePort: await port(), rendererPort: await port(), python: '/opt/hermes/.venv/bin/python' })
    loaded = await loadPlugin(); t.after(loaded.cleanup)
    const realFetch = globalThis.fetch; globalThis.fetch = (url, init = {}) => realFetch(url, { ...init, headers: { ...(init.headers || {}), Origin: 'null' } }); t.after(() => { globalThis.fetch = realFetch })
    const values = new Map([['serviceUrl', `http://127.0.0.1:${service.server.address().port}`], ['serviceToken', service.token]])
    const registry = []; loaded.default.register({ storage: { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k,v) => values.set(k,v) }, files: { requestFolder: async () => ({ ok: true, folderId: 'grant-e2e' }), list: async () => ({ entries: [{ path: 'assets/slide.png' }] }), readDataUrl: async () => ({ ok: true, dataUrl: `data:image/png;base64,${png}` }) }, register: item => registry.push(item) })
    const png = spawnSync('/opt/hermes/.venv/bin/python', ['-c', "from PIL import Image; import io,base64; b=io.BytesIO(); Image.new('RGB',(40,40),(20,80,140)).save(b,format='PNG'); print(base64.b64encode(b.getvalue()).decode())"], { encoding: 'utf8' }).stdout.trim()
    class Reader { readAsDataURL() { this.result = `data:image/png;base64,${png}`; this.onload() } }
    globalThis.FileReader = Reader
    const downloads = []; globalThis.document = { createElement: () => ({ click() { downloads.push(this.href) } }) }; const oldCreate = URL.createObjectURL; URL.createObjectURL = blob => { downloads.push(blob); return 'blob:actual-zip' }
    t.after(() => { delete globalThis.FileReader; delete globalThis.document; URL.createObjectURL = oldCreate })
    let renderer; await act(async () => { renderer = TestRenderer.create(registry.find(x => x.id === 'page').render()); await new Promise(r => setTimeout(r, 30)) })
    const buttons = () => renderer.root.findAllByType('button')
    const click = async text => { const b = buttons().find(x => x.children.join('') === text || x.props['aria-label'] === text); assert.ok(b, `missing ${text}`); await act(async () => { await b.props.onClick(); await tick() }) }
    await click('New draft'); await click('Add slide'); await click('Add slide')
    for (let i=0;i<2;i++) {
      const headline = renderer.root.findAllByType('input').find(x => x.props['aria-label'] === `Slide ${i+1} headline`); assert.ok(headline, JSON.stringify(renderer.root.findAllByType('input').map(x => x.props['aria-label'])))
      await act(async () => headline.props.onChange({ target: { value: `Headline ${i+1}` } }))
      const body = renderer.root.findAllByType('textarea').find(x => x.props['aria-label'] === `Slide ${i+1} body`)
      await act(async () => body.props.onChange({ target: { value: `Body ${i+1}` } }))
      await click(`Choose native image for slide ${i+1}`)
    }
    await click('Save to service'); for (let i=0;i<100 && !renderer.root.findAllByProps({role:'status'}).some(x=>x.children.join('').includes('Saved and verified'));i++) await new Promise(r=>setTimeout(r,20)); await act(async()=>{}); await click('Overview');
    const allButtons = renderer.root.findAllByType('button')
    const getText = (node) => {
      if (!node) return ''
      if (typeof node === 'string') return node
      if (Array.isArray(node)) return node.map(getText).join('')
      if (node.props && node.props.children) return getText(node.props.children)
      if (node.children) return getText(node.children)
      return ''
    }
    const draftBtn = allButtons.find(node => getText(node).includes('Untitled Cherry draft'))
    assert.ok(draftBtn, 'missing draft button')
    await act(async () => { await draftBtn.props.onClick(); await tick() })
    const reopenedBody = renderer.root.findAllByType('textarea').find(x => x.props['aria-label'] === 'Slide 1 body'); await act(async () => reopenedBody.props.onChange({ target: { value: 'Body 1 revised after readback' } })); await click('Save to service'); for (let i=0;i<100 && !renderer.root.findAllByProps({role:'status'}).some(x=>x.children.join('').includes('Saved and verified'));i++) await new Promise(r=>setTimeout(r,20)); await act(async()=>{})
    const ws = await (await fetch(`${values.get('serviceUrl')}/api/workspace?app=Cherry`, { headers: { Authorization: `Bearer ${service.token}`, Origin: 'null' } })).json(); assert.equal(ws.drafts[0].slides.length, 2); assert.ok(ws.drafts[0].slides.every(slide => /^image:[a-f0-9]{64}$/.test(slide.selectedImage.contentRef))); await click('Render saved revision')
    const jobResponse = await fetch(`${values.get('serviceUrl')}/api/jobs` , { headers: { Authorization: `Bearer ${service.token}` } }); const jobs = await jobResponse.json()
    assert.equal(jobs[0].status, 'succeeded'); assert.deepEqual(jobs[0].events.map(x => x.status), ['queued','running','succeeded'])

    await click('Show slide 2'); assert.equal(renderer.root.findByProps({ alt: 'Rendered slide 2' }).props.alt, 'Rendered slide 2')
    await click('Export rendered ZIP')
    const blob = downloads.find(x => x instanceof Blob); assert.ok(blob, 'UI downloaded the real service ZIP response')
    const zip = Buffer.from(await blob.arrayBuffer()); assert.equal(zip.subarray(0,4).toString(), 'PK\x03\x04'); assert.ok(zip.length > 500)
    const check = spawnSync('/opt/hermes/.venv/bin/python', ['-c', "import io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); m=json.loads(z.read('manifest.json')); print(json.dumps({'files':m['files'],'size':len(z.namelist())}))"], { input: zip, encoding: 'utf8' })
    assert.deepEqual(JSON.parse(check.stdout).files, ['slide-01.png','slide-02.png'])
    t.diagnostic(`actual UI ZIP response bytes: ${zip.length}`)
  } finally { if (service) await service.stop(); await fs.rm(dataDir, { recursive: true, force: true }) }
})
