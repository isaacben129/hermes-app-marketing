import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const helper = fileURLToPath(new URL('../../scripts/native-dashboard-request.py', import.meta.url))
const safeFailure = { status: 503, body: { error: { code: 'backend_unavailable', message: 'Marketing backend could not start or access its private data directory.', retryable: true } } }

export function isNativeDashboardRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.path !== 'string' || typeof input.method !== 'string') return false
  const pathOnly = input.path.split('?', 1)[0]
  if (input.path.includes('..') || input.path.includes('#') || input.path.includes('\\')) return false
  if (input.method === 'GET' && (/^\/api\/creative-previews(?:\?.*)?$/.test(input.path) || /^\/api\/agent-runs(?:\/[a-f0-9]{32})?$/.test(pathOnly))) return true
  return input.method === 'POST' && pathOnly === '/api/agent-runs' && !input.path.includes('?')
}

export async function dispatchNativeDashboardRequest(input, env = process.env) {
  if (!isNativeDashboardRequest(input)) return null
  const dataDir = env.HERMES_MARKETING_DATA_DIR
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || dataDir.includes('\0') || dataDir.split(path.sep).includes('..') || Buffer.byteLength(JSON.stringify(input)) > 64_000) return safeFailure
  const python = env.HERMES_TEST_PYTHON || env.PYTHON || 'python3'
  try {
    const { stdout } = await execFileAsync(python, [helper], {
      cwd: path.dirname(path.dirname(helper)),
      env: { ...env, HERMES_DASHBOARD_REQUEST: JSON.stringify(input) },
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })
    const response = JSON.parse(stdout)
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || !Object.hasOwn(response, 'body')) return safeFailure
    return response
  } catch {
    return safeFailure
  }
}
