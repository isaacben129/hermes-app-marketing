// Fail the old daemon seam without disturbing the ephemeral application router.
const original = globalThis.fetch
globalThis.fetch = (url, ...args) => {
  if (new URL(url).port === '8765') throw new Error('External renderer deliberately unavailable in this regression')
  return original(url, ...args)
}
