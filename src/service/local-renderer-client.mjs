import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_BYTES = 64_000_000
const rootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer')

export class LocalRendererClient {
  constructor({ python = process.env.HERMES_RENDER_PYTHON || process.env.PYTHON || 'python3', dataDir, root = rootDefault, timeoutMs = 60000 } = {}) {
    if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('dataDir is required')
    this.python = python; this.dataDir = path.resolve(dataDir); this.root = path.resolve(root); this.timeoutMs = Math.min(60000, Math.max(1, timeoutMs))
  }
  async #request(operation, payload = {}) {
    const input = Buffer.from(JSON.stringify({ operation, dataDir: this.dataDir, payload }))
    if (input.length > MAX_BYTES) throw Object.assign(new Error('Renderer request too large'), { code: 'invalid_input' })
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, [path.join(this.root, 'request.py')], { cwd: this.root, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
      const chunks = []; let size = 0; let settled = false
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value) }
      const timer = setTimeout(() => { child.kill(); finish(Object.assign(new Error('Renderer timed out'), { code: 'render_failed' })) }, this.timeoutMs)
      child.on('error', () => finish(Object.assign(new Error('Renderer unavailable'), { code: 'unavailable' })))
      child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { child.kill(); finish(Object.assign(new Error('Renderer response too large'), { code: 'render_failed' })) } else chunks.push(chunk) })
      child.on('close', code => {
        if (settled) return
        if (code !== 0) return finish(Object.assign(new Error('Renderer rejected the request'), { code: operation === 'health' ? 'unavailable' : 'invalid_input' }))
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { finish(Object.assign(new Error('Renderer returned invalid data'), { code: 'render_failed' })) }
      })
      child.stdin.end(input)
    })
  }
  async health() {
    const value = await this.#request('health')
    if (value.protocol !== 2) throw Object.assign(new Error('Renderer protocol mismatch'), { code: 'protocol_mismatch' })
    return value
  }
  async render(payload) { await this.health(); return this.#request('render', payload) }
  async export(payload) { await this.health(); return this.#request('export', payload) }
}
