import { readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse } from './secrets.mjs'

export function secretsPath(env = process.env) {
  if (env.HERMES_MARKETING_SECRETS_FILE) return path.resolve(env.HERMES_MARKETING_SECRETS_FILE)
  const home = env.HERMES_HOME || env.HERMES_PROFILE_HOME || os.homedir()
  return path.join(home, '.config', 'hermes', 'marketing-secrets.env')
}

export async function loadSecrets({ env = process.env } = {}) {
  const file = secretsPath(env)
  let info
  try { info = await stat(file) }
  catch (error) {
    if (error.code === 'ENOENT' && env.HERMES_MARKETING_SECRETS_FILE) throw new Error('Configured marketing secrets file does not exist')
    if (error.code === 'ENOENT') return {}
    throw new Error('Marketing secrets file is unavailable')
  }
  if (!info.isFile()) throw new Error('Marketing secrets path must be a file')
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('Marketing secrets file permissions must be owner-only (0600)')
  try { return parse(await readFile(file, 'utf8')) }
  catch (error) {
    if (error instanceof TypeError) throw error
    throw new Error('Marketing secrets file is unavailable')
  }
}

export async function applySecrets({ env = process.env } = {}) {
  const values = await loadSecrets({ env })
  for (const [key, value] of Object.entries(values)) if (env[key] === undefined) env[key] = value
  return values
}
