import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createService } from './server.mjs'
import { EventLedger } from '../storage/ledger.mjs'
import { WorkspaceStore } from '../storage/workspace.mjs'
import { LocalJobRunner } from '../jobs/runner.mjs'
import { RendererClient } from './renderer-client.mjs'
import { RenderArtifacts } from './artifacts.mjs'
import { createActions } from './actions.mjs'
import { createDefaultPostizReader } from '../integrations/postiz.mjs'
import net from 'node:net'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const handlerScript = `from http.server import HTTPServer\nfrom server import Handler\nHTTPServer(('127.0.0.1', int(__import__('sys').argv[1])), Handler).serve_forever()`

export async function startLocal({ dataDir = process.env.HERMES_MARKETING_DATA_DIR, servicePort = 8764, rendererPort = 8765, allowedOrigin = 'null', python = process.env.PYTHON ?? 'python3', root = projectRoot, startupTimeoutMs = 10000 } = {}) {
  if (!Number.isInteger(servicePort) || servicePort < 0 || servicePort > 65535 || !Number.isInteger(rendererPort) || rendererPort < 0 || rendererPort > 65535) throw new Error('Service and renderer ports must be integers in the range 0–65535')
  if (servicePort && rendererPort && servicePort === rendererPort) throw new Error('Service and renderer ports must differ')
  if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('HERMES_MARKETING_DATA_DIR must be an absolute path')
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
  const token = randomBytes(32).toString('hex')
  const actualRendererPort = rendererPort || await freePort()
  const actualServicePort = servicePort || await freePort()
  if (actualServicePort === actualRendererPort) throw new Error('Service and renderer ports must differ')
  const renderer = new RendererClient({ origin: `http://127.0.0.1:${actualRendererPort}`, timeoutMs: 1000 })
  let child = null
  try { await renderer.health() }
  catch (error) {
    if (error.code === 'protocol_mismatch') throw error
    child = spawn(python, ['-c', handlerScript, String(actualRendererPort)], { cwd: path.join(root, 'renderer'), stdio: 'ignore', env: { ...process.env, PYTHONPATH: path.join(root, 'renderer'), HERMES_MARKETING_RENDER_CACHE: path.join(dataDir, 'render-cache') } })
    let spawnError = null
    child.on('error', error => { spawnError = error })
    try {
      const deadline = Date.now() + startupTimeoutMs
      let ready = false
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Renderer child exited during startup')
        try { await renderer.health(); ready = true; break } catch (probeError) { if (probeError.code === 'protocol_mismatch') throw probeError }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!ready) throw new Error('Renderer protocol 2 startup timed out')
    } catch (startupError) { await stopChild(child); throw startupError }
  }
  const ledger = new EventLedger({ baseDir: path.join(dataDir, 'ledger') })
  const workspace = new WorkspaceStore({ ledger })
  const runner = new LocalJobRunner({ ledger })
  await runner.restore()
  const artifacts = new RenderArtifacts({ dataDir })
  let postizReader = null
  try { postizReader = createDefaultPostizReader() } catch { /* invalid provider configuration remains unavailable */ }
  const actions = createActions({ workspace, ledger, runner, renderer, artifacts, postizReader, python })
  const server = createService({ actions, token, allowedOrigin })
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(actualServicePort, '127.0.0.1', resolve) }) }
  catch (error) { if (child) await stopChild(child); throw error }
  const connection = path.join(dataDir, 'connection.json')
  try {
    await fs.writeFile(connection, JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, token }), { mode: 0o600 })
    await fs.chmod(connection, 0o600)
  } catch (error) {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(connection, { force: true })
    if (child) await stopChild(child)
    throw error
  }
  let stopped = false
  return {
    server, child, token, connection,
    async stop() {
      if (stopped) return
      stopped = true
      await new Promise(resolve => server.close(resolve))
      await fs.rm(connection, { force: true })
      if (child) await stopChild(child)
    }
  }
}



async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1500))])
  if (child.exitCode === null && child.signalCode === null) {
    const killed = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGKILL')
    await killed
  }
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}
