import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { startLocal } from '../src/service/lifecycle.mjs'

test('live service saves, renders through Python HTTP renderer, exports a real ZIP, and stops', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marketing-e2e-'))
  const rendererPort = await freePort()
  const servicePort = await freePort()
  let service
  try {
    service = await startLocal({ dataDir, rendererPort, servicePort, python: '/opt/hermes/.venv/bin/python' })
    const base = `http://127.0.0.1:${servicePort}`
    const headers = { Authorization: `Bearer ${service.token}`, Origin: 'null', 'Content-Type': 'application/json' }
    const png = spawnSync('/opt/hermes/.venv/bin/python', ['-c', "from PIL import Image; import io,base64; b=io.BytesIO(); Image.new('RGB',(4,4),(20,80,140)).save(b,format='PNG'); print(base64.b64encode(b.getvalue()).decode())"], { encoding: 'utf8' }).stdout.trim()
    const imageBytes = Buffer.from(png, 'base64')
    const sha256 = crypto.createHash('sha256').update(imageBytes).digest('hex')
    const draft = { id: 'e2e-draft', app: 'Cherry', title: 'E2E', slides: [{ headline: 'Hello', body: 'Synthetic preview', selectedImage: { dataUrl: `data:image/png;base64,${png}`, sha256, sourceRef: 'synthetic:e2e' } }] }
    let response = await fetch(`${base}/api/drafts/e2e-draft`, { method: 'PUT', headers, body: JSON.stringify({ expectedRevision: 0, draft }) })
    assert.equal(response.status, 200)
    response = await fetch(`${base}/api/render`, { method: 'POST', headers, body: JSON.stringify({ jobId: 'e2e-render', draftId: 'e2e-draft', revision: 1 }) })
    assert.equal(response.status, 202)
    const rendered = (await response.json()).rendered
    assert.equal(rendered.dimensions.width, 1080)
    assert.equal(rendered.slides.length, 1)
    const renderedBytes = Buffer.from(rendered.slides[0].pngBase64, 'base64')
    assert.equal(rendered.slides[0].image_sha256, sha256)
    const renderedSha256 = crypto.createHash('sha256').update(renderedBytes).digest('hex')
    const dimensions = spawnSync('/opt/hermes/.venv/bin/python', ['-c', "from PIL import Image; import io,sys; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); print(f'{im.width}x{im.height}')"], { input: renderedBytes, encoding: 'utf8' }).stdout.trim()
    assert.equal(dimensions, '1080x1920')
    response = await fetch(`${base}/api/export`, { method: 'POST', headers, body: JSON.stringify({ draftId: 'e2e-draft', revision: 1, renderJobId: 'e2e-render' }) })
    assert.equal(response.status, 200)
    const exported = await response.json()
    const zip = Buffer.from(exported.zipBase64, 'base64')
    assert.equal(zip.subarray(0, 4).toString(), 'PK\x03\x04')
    assert.ok(zip.length > 500)
    const zipCheck = spawnSync('/opt/hermes/.venv/bin/python', ['-c', "import hashlib,io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); m=json.loads(z.read('manifest.json')); p=z.read(m['files'][0]); print(json.dumps({'files':m['files'],'sha256':hashlib.sha256(p).hexdigest(),'png':p.startswith(b'\\x89PNG\\r\\n\\x1a\\n')}))"], { input: zip, encoding: 'utf8' })
    const archived = JSON.parse(zipCheck.stdout)
    assert.deepEqual(archived.files, ['slide-01.png'])
    assert.equal(archived.sha256, renderedSha256)
    assert.equal(archived.png, true)
    t.diagnostic(`actual ZIP archive bytes: ${zip.length}`)
    assert.equal(exported.manifest.draftId, 'e2e-draft')
    const metadata = JSON.parse(await fs.readFile(service.connection, 'utf8'))
    assert.equal((await fs.stat(service.connection)).mode & 0o777, 0o600)
    assert.equal(metadata.url, base)
  } finally {
    if (service) { const child = service.child; await service.stop(); assert.equal(await fs.access(service.connection).then(() => true, () => false), false); if (child) assert.ok(child.exitCode !== null || child.signalCode !== null) }
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

async function freePort() {
  const server = await import('node:net').then(({ createServer }) => createServer())
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
