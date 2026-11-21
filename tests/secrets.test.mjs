import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { parse } from '../src/ops/secrets.mjs'
import { loadSecrets, secretsPath } from '../src/ops/load-secrets.mjs'
import { mkdtemp as makeTemp, readFile } from 'node:fs/promises'

test('central secrets parser reads Postiz keys, ignores unrelated names, and never expands env values', () => {
  const values = parse('# shared service credentials\nPOSTIZ_API_KEY="secret value"\nPOSTIZ_BASE_URL=https://api.postiz.com/public/v1\nOTHER_TOKEN=ignored\n')
  assert.deepEqual(values, { POSTIZ_API_KEY: 'secret value', POSTIZ_BASE_URL: 'https://api.postiz.com/public/v1' })
  assert.deepEqual(parse('POSTIZ_API_KEY=$SHOULD_NOT_EXPAND'), { POSTIZ_API_KEY: '$SHOULD_NOT_EXPAND' })
  assert.throws(() => parse('POSTIZ_BASE_URL=http://example.com/public/v1'), /HTTPS/)
})

test('shared loader resolves profile scoped default, loads only allowlisted keys, and never redirects durable storage', async () => {
  const home = await makeTemp(path.join(os.tmpdir(), 'marketing-home-'))
  try {
    const folder = path.join(home, '.config', 'hermes')
    await import('node:fs/promises').then(fs => fs.mkdir(folder, { recursive: true }))
    const file = path.join(folder, 'marketing-secrets.env')
    await writeFile(file, 'POSTIZ_API_KEY=fixture-key\nPOSTIZ_BASE_URL=https://example.test/api\nHERMES_MARKETING_DATA_DIR=/tmp/redirect\nUNRELATED_TOKEN=omit\n')
    await chmod(file, 0o600)
    const env = { HERMES_HOME: home }
    assert.equal(secretsPath(env), file)
    assert.deepEqual(await loadSecrets({ env }), { POSTIZ_API_KEY: 'fixture-key', POSTIZ_BASE_URL: 'https://example.test/api' })
    assert.equal(env.POSTIZ_API_KEY, undefined)
    assert.doesNotMatch(await readFile(file, 'utf8'), /actual-secret/)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('shared loader fails closed for explicitly configured missing secrets and permissive files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'marketing-secret-policy-'))
  try {
    await assert.rejects(loadSecrets({ env: { HERMES_MARKETING_SECRETS_FILE: path.join(dir, 'missing') } }), /does not exist/)
    const file = path.join(dir, 'open.env')
    await writeFile(file, 'POSTIZ_API_KEY=fixture\n')
    await chmod(file, 0o644)
    await assert.rejects(loadSecrets({ env: { HERMES_MARKETING_SECRETS_FILE: file } }), /owner-only/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('local startup rejects group/world-readable central secrets files before listening', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'marketing-secrets-'))
  const file = path.join(dir, 'secrets.env')
  try {
    await writeFile(file, 'POSTIZ_API_KEY=dummy\nPOSTIZ_BASE_URL=https://api.postiz.com/public/v1\n')
    await chmod(file, 0o644)
    const child = spawn(process.execPath, ['scripts/start-local.mjs'], { cwd: process.cwd(), env: { ...process.env, HERMES_MARKETING_SECRETS_FILE: file } })
    let output = ''
    child.stderr.on('data', chunk => { output += chunk.toString() })
    await once(child, 'exit')
    assert.match(output, /owner-only/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
