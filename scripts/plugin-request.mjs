// One bounded request through the existing production router and actions.
// The ephemeral listener never leaves this child process; no daemon or token file.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createService } from '../src/service/server.mjs'
import { createActions } from '../src/service/actions.mjs'
import { EventLedger } from '../src/storage/ledger.mjs'
import { WorkspaceStore } from '../src/storage/workspace.mjs'
import { LocalJobRunner } from '../src/jobs/runner.mjs'
import { LocalRendererClient } from '../src/service/local-renderer-client.mjs'
import { RenderArtifacts } from '../src/service/artifacts.mjs'
import { createDefaultPostizReader } from '../src/integrations/postiz.mjs'
import { applySecrets } from '../src/ops/load-secrets.mjs'
import { dispatchNativeDashboardRequest } from '../src/service/native-dashboard-client.mjs'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const nativeResponse = await dispatchNativeDashboardRequest(input, process.env)
if (nativeResponse) {
  process.stdout.write(JSON.stringify(nativeResponse))
  process.exit(0)
}
await applySecrets()
const dataDir = process.env.HERMES_MARKETING_DATA_DIR
if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('Absolute data directory required')
await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
const ledger = new EventLedger({ baseDir: path.join(dataDir, 'ledger') })
const workspace = new WorkspaceStore({ ledger })
const runner = new LocalJobRunner({ ledger })
await runner.restore()
const renderer = new LocalRendererClient({ dataDir })
const artifacts = new RenderArtifacts({ dataDir })
let postizReader = null
try { postizReader = createDefaultPostizReader() } catch { /* report unavailable, not fabricated data */ }
const actions = createActions({ workspace, ledger, runner, renderer, artifacts, postizReader })
const token = randomBytes(32).toString('hex')
const server = createService({ actions, token, allowedOrigin: 'null' })
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  if (typeof input.path !== 'string' || !input.path.startsWith('/api/') || input.path.includes('..') || !['GET', 'PUT', 'POST', 'DELETE'].includes(input.method)) throw new Error('Invalid request')
  const response = await fetch(`http://127.0.0.1:${server.address().port}${input.path}`, {
    method: input.method,
    headers: { Origin: 'null', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(['PUT', 'POST', 'DELETE'].includes(input.method) && input.body !== null ? { body: JSON.stringify(input.body) } : {})
  })
  process.stdout.write(JSON.stringify({ status: response.status, body: await response.json() }))
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
