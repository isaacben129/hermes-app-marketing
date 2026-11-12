const APPROVED_SOURCE_PREFIXES = ['source:', 'claim:', 'asset:', 'evidence:']
const SAFE_FAILURE = 'Rendering failed.'

function hasApprovedSourceRef(slide) {
  return Array.isArray(slide?.sourceRefs) && slide.sourceRefs.some(ref =>
    typeof ref === 'string' && APPROVED_SOURCE_PREFIXES.some(prefix => ref.startsWith(prefix) && ref.length > prefix.length),
  )
}

function validateJob(job, deps) {
  if (!job || job.local !== true || job.stage !== 'queued') {
    throw new Error('Job must be locally queued before rendering.')
  }
  if (!Array.isArray(job.slides) || job.slides.length === 0 || job.slides.some(slide => !hasApprovedSourceRef(slide))) {
    throw new Error('Every slide must include an approved source reference.')
  }
  if (!deps?.renderer || typeof deps.renderer.render !== 'function') {
    throw new TypeError('An injected renderer capability is required.')
  }
  if (!deps?.jobStore || typeof deps.jobStore.saveArtifact !== 'function' || typeof deps.jobStore.updateJob !== 'function') {
    throw new TypeError('An injected job store is required.')
  }
}

/**
 * Render a locally queued job through the caller-provided renderer and store.
 * The adapter does not depend on a renderer implementation or perform I/O itself.
 */
export async function renderJob(job, { renderer, jobStore, appProfile } = {}) {
  validateJob(job, { renderer, jobStore })
  const fixtureOnly = job.fixtureOnly === true

  try {
    const rendered = await renderer.render(job, { appProfile })
    const artifact = await jobStore.saveArtifact(job.id, rendered)
    const artifactStatus = fixtureOnly ? 'fixture' : 'production'
    const updatedJob = {
      ...job,
      stage: 'completed',
      artifactStatus,
      artifactId: artifact?.id ?? null,
      error: null,
    }
    await jobStore.updateJob(job.id, updatedJob)
    return { status: fixtureOnly ? 'fixture' : 'completed', artifact, job: updatedJob }
  } catch {
    const failedJob = { ...job, stage: 'failed', error: SAFE_FAILURE }
    try {
      await jobStore.updateJob(job.id, failedJob)
    } catch {
      // Keep the adapter result redacted even when failure persistence also fails.
    }
    return { status: 'failed', error: SAFE_FAILURE, job: failedJob }
  }
}
