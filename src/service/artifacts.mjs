import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export class RenderArtifacts {
  constructor({ dataDir }) { this.directory = path.join(dataDir, 'artifacts') }
  async save(artifact) {
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
    try { return JSON.parse(await fs.readFile(path.join(this.directory, `${id}.json`), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
}
