// Health snapshots are supplied by the host; this module performs no provider I/O.
const KNOWN_STATES = new Set(['healthy', 'attention', 'degraded'])
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000

function asTimestamp(value) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function determineSystemHealth(snapshot, options = {}) {
  if (!snapshot || !Array.isArray(snapshot.services)) {
    return { status: 'unavailable', label: 'Unavailable', observedAt: null, services: [] }
  }

  const observedAt = snapshot.observedAt ?? snapshot.timestamp ?? null
  const observedMs = asTimestamp(observedAt)
  const nowMs = asTimestamp(options.now ?? Date.now())
  const staleAfterMs = Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : DEFAULT_STALE_AFTER_MS
  if (observedMs === null || nowMs === null || nowMs - observedMs > staleAfterMs) {
    return { status: 'stale', label: 'Stale', observedAt, services: snapshot.services }
  }

  const statuses = snapshot.services.map(service => service?.status)
  let status = 'healthy'
  if (statuses.some(value => !KNOWN_STATES.has(value) || value === 'degraded')) status = 'degraded'
  else if (statuses.some(value => value === 'attention')) status = 'attention'
  return { status, label: status[0].toUpperCase() + status.slice(1), observedAt, services: snapshot.services }
}

export function formatMetric(value) {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return 'Unavailable'
  return String(value)
}

export function formatJobChronology(job) {
  if (!job || !Array.isArray(job.events)) return []
  return job.events.map((event, index) => ({
    ...event,
    at: event?.at ?? event?.timestamp ?? null,
    status: event?.status ?? 'unknown',
    message: redactError(event?.error ?? event?.message ?? 'No details available.'),
    _index: index,
  })).sort((left, right) => {
    const leftTime = asTimestamp(left.at) ?? Number.MAX_SAFE_INTEGER
    const rightTime = asTimestamp(right.at) ?? Number.MAX_SAFE_INTEGER
    return leftTime - rightTime || left._index - right._index
  }).map(({ _index, ...event }) => event)
}

export function redactError(error) {
  if (error === null || error === undefined || error === '') return 'No details available.'
  return String(error)
    .replace(/\bBearer\s+[^\s,;]+/gi, '[REDACTED]')
    .replace(/\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, match => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`)
}
