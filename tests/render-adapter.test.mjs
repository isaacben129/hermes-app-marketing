import assert from 'node:assert/strict'
import { renderJob } from '../src/render/adapter.mjs'

const slide = { title: 'Welcome', body: 'A source-backed message', sourceRefs: ['source:approved-1'] }
const job = () => ({
  id: 'job-1',
  stage: 'queued',
  local: true,
  fixtureOnly: false,
  slides: [slide],
})
const fakes = (overrides = {}) => {
  const calls = { render: [], save: [], update: [] }
  const deps = {
    renderer: { render: async (...args) => { calls.render.push(args); return { bytes: Buffer.from('png'), mimeType: 'image/png' } } },
    jobStore: {
      saveArtifact: async (...args) => { calls.save.push(args); return { id: 'artifact-1' } },
      updateJob: async (...args) => { calls.update.push(args); return args[1] },
    },
    appProfile: { id: 'app-a' },
    ...overrides,
  }
  return { calls, deps }
}

{
  const record = job()
  const { calls, deps } = fakes()
  const result = await renderJob(record, deps)
  assert.equal(result.status, 'completed')
  assert.equal(result.artifact.id, 'artifact-1')
  assert.equal(record.stage, 'queued', 'does not mutate caller-owned job record')
  assert.deepEqual(calls.render[0], [record, { appProfile: deps.appProfile }])
  assert.deepEqual(calls.save[0], ['job-1', { bytes: Buffer.from('png'), mimeType: 'image/png' }])
  assert.equal(calls.update[0][0], 'job-1')
  assert.equal(calls.update[0][1].stage, 'completed')
}

{
  const record = { ...job(), local: false }
  const { calls, deps } = fakes()
  await assert.rejects(renderJob(record, deps), /locally queued/)
  assert.equal(calls.render.length, 0)
}

{
  const record = { ...job(), stage: 'running' }
  const { calls, deps } = fakes()
  await assert.rejects(renderJob(record, deps), /locally queued/)
  assert.equal(calls.render.length, 0)
}

{
  const record = { ...job(), slides: [{ title: 'Unproven', body: 'No provenance' }] }
  const { calls, deps } = fakes()
  await assert.rejects(renderJob(record, deps), /approved source reference/)
  assert.equal(calls.render.length, 0)
}

{
  const record = { ...job(), slides: [{ ...slide, sourceRefs: [] }] }
  const { calls, deps } = fakes()
  await assert.rejects(renderJob(record, deps), /approved source reference/)
  assert.equal(calls.render.length, 0)
}

{
  const record = { ...job(), fixtureOnly: true }
  const { calls, deps } = fakes()
  const result = await renderJob(record, deps)
  assert.equal(result.status, 'fixture')
  assert.equal(result.artifact.id, 'artifact-1')
  assert.equal(calls.update[0][1].stage, 'completed')
  assert.equal(calls.update[0][1].artifactStatus, 'fixture')
}

{
  const record = job()
  const secret = 'provider-token-should-not-leak'
  const calls = { save: [], update: [] }
  const deps = {
    renderer: { render: async () => { throw new Error(`provider failed: ${secret}`) } },
    jobStore: {
      saveArtifact: async (...args) => calls.save.push(args),
      updateJob: async (...args) => calls.update.push(args),
    },
    appProfile: { id: 'app-a' },
  }
  const result = await renderJob(record, deps)
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'Rendering failed.')
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.equal(calls.save.length, 0)
  assert.equal(calls.update[0][1].stage, 'failed')
  assert.equal(calls.update[0][1].error, 'Rendering failed.')
}

{
  const record = job()
  const calls = { save: [], update: [] }
  const deps = {
    renderer: { render: async () => ({ bytes: Buffer.from('png') }) },
    jobStore: {
      saveArtifact: async (...args) => { calls.save.push(args); throw new Error('storage: private/path') },
      updateJob: async (...args) => calls.update.push(args),
    },
    appProfile: { id: 'app-a' },
  }
  const result = await renderJob(record, deps)
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'Rendering failed.')
  assert.equal(calls.update[0][1].stage, 'failed')
  assert.ok(!JSON.stringify(result).includes('private/path'))
}

console.log('PASS queued/local validation, approved sources, injected renderer/store, fixture labeling, and redacted failure persistence')
