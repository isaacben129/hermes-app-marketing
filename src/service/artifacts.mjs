import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export class RenderArtifacts {
  constructor({ dataDir }) { this.directory = path.join(dataDir, 'artifacts') }
  async save(artifact) {
    if (typeof artifact?.jobId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(artifact.jobId) || artifact.jobId.includes('..')) throw new TypeError('Invalid artifact job id')
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const file = path.join(this.directory, `${artifact.jobId}.json`)
    const temp = `${file}.${crypto.randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify(artifact), { flag: 'wx', mode: 0o600 })
      await fs.rename(temp, file)
    } catch (error) { await fs.rm(temp, { force: true }); throw error }
    return { id: artifact.jobId }
  }
  async get(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || id.includes('..')) return null
    try { return JSON.parse(await fs.readFile(path.join(this.directory, `${id}.json`), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
}
