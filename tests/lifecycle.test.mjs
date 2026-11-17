import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { startLocal } from '../src/service/lifecycle.mjs'

test('refuses an occupied renderer port with an incompatible protocol without stopping its owner', async () => {
  const foreign = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"protocol":1}') })
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve))
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marketing-lifecycle-'))
  try {
    await assert.rejects(startLocal({ dataDir, rendererPort: foreign.address().port, servicePort: 0 }), error => error.code === 'protocol_mismatch')
    const response = await fetch(`http://127.0.0.1:${foreign.address().port}/api/health`)
    assert.equal(response.status, 200)
  } finally { await new Promise(resolve => foreign.close(resolve)); await fs.rm(dataDir, { recursive: true, force: true }) }
})

test('renderer startup timeout cleans up the child process it spawned', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marketing-timeout-'))
  const pidFile = path.join(dataDir, 'renderer.pid')
  const python = path.join(dataDir, 'slow-python')
  await fs.writeFile(python, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`, { mode: 0o700 })
  await fs.chmod(python, 0o700)
  try {
    await assert.rejects(startLocal({ dataDir: path.join(dataDir, 'data'), rendererPort: await freePort(), servicePort: 0, python, startupTimeoutMs: 300 }))
    const pid = Number(await fs.readFile(pidFile, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally { await fs.rm(dataDir, { recursive: true, force: true }) }
})

async function freePort() {
  const server = http.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
