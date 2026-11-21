import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { LocalRendererClient } from '../src/service/local-renderer-client.mjs'

test('LocalRendererClient renders, exports provenance, and rejects paths and oversized payloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-renderer-'))
  try {
    const python = process.env.HERMES_TEST_PYTHON || '/opt/hermes/.venv/bin/python'
    const generated = spawnSync(python, ['-c', "from PIL import Image; import io,base64; b=io.BytesIO(); Image.new('RGB',(20,30),(40,90,120)).save(b,'PNG'); print(base64.b64encode(b.getvalue()).decode())"], { encoding: 'utf8' })
    assert.equal(generated.status, 0)
    const bytes = Buffer.from(generated.stdout.trim(), 'base64')
    const { createHash } = await import('node:crypto')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const client = new LocalRendererClient({ python, dataDir: dir })
    assert.equal((await client.health()).protocol, 2)
    const payload = { width: 360, height: 640, slides: [{ headline: 'Local', body: 'No daemon', image_data_url: `data:image/png;base64,${bytes.toString('base64')}`, image_sha256: sha256, source_ref: 'synthetic:test' }] }
    const rendered = await client.render(payload)
    assert.deepEqual(rendered.dimensions, { width: 360, height: 640 })
    assert.equal(rendered.slides[0].source_ref, 'synthetic:test')
    const zip = await client.export({ rendered, source: { draftId: 'd1' } })
    const checked = spawnSync(python, ['-c', "import base64,io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))); m=json.loads(z.read('manifest.json')); print(json.dumps([m['files'],m['source'],m['slides'][0]['source_ref']]))"], { input: zip.zipBase64, encoding: 'utf8' })
    assert.deepEqual(JSON.parse(checked.stdout), [['slide-01.png'], { draftId: 'd1' }, 'synthetic:test'])
    await assert.rejects(client.render({ ...payload, slides: [{ ...payload.slides[0], image_path: '/etc/passwd' }] }), e => e.code === 'invalid_input')
    await assert.rejects(client.render({ ...payload, slides: [{ ...payload.slides[0], image_data_url: `data:image/png;base64,${'A'.repeat(17_000_000)}` }] }), e => e.code === 'invalid_input')
    const bad = new LocalRendererClient({ python, dataDir: dir, root: path.join(dir, 'missing') })
    await assert.rejects(bad.health(), e => e.code === 'unavailable')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
