const safeError = error => ({ code: error?.code ?? (error?.status === 401 || error?.status === 403 ? 'provider_denied' : error?.status === 429 ? 'rate_limited' : 'unavailable'), retryable: error?.retryable ?? !(error?.status === 401 || error?.status === 403) })
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function createPostizReader({ transport, clock = () => new Date().toISOString(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxAttempts = 2 } = {}) {
  if (typeof transport !== 'function') throw new TypeError('transport is required')
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) throw new TypeError('maxAttempts must be 1 or 2')
  const cachedMetrics = new Map()
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
  const request = async (path, query = {}) => {
    let lastError
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try { return await transport({ method: 'GET', path, query }) }
      catch (error) {
        lastError = error
        if (error?.status === 401 || error?.status === 403) break
        if (attempt + 1 >= maxAttempts || (error?.status && error.status !== 429 && error.status < 500)) break
        if (error?.status === 429) {
          const delay = Math.min(30000, Math.max(0, Number(error.retryAfterMs) || 0))
          await sleep(delay)
        }
      }
    }
    throw Object.assign(new Error('Postiz request unavailable'), safeError(lastError))
  }
  const listIntegrations = async () => {
    const value = await request('/integrations')
    if (!Array.isArray(value) || value.some(item => !object(item) || typeof item.id !== 'string')) throw Object.assign(new Error('Invalid integrations response'), { code: 'unavailable' })
    return value.map(({ id, name, identifier, disabled, profile }) => ({ id, name, identifier, disabled, profile }))
  }
  const listPosts = async ({ window } = {}) => {
    if (!object(window) || !isoDay(window.start) || !isoDay(window.end) || window.start > window.end) throw new TypeError('window must contain ordered ISO dates')
    const all = [], seen = new Set(), cursors = new Set()
    let cursor, declaredTotal
    for (let page = 0; page < 100; page++) {
      const query = { startDate: window.start, endDate: window.end, ...(cursor ? { cursor } : {}) }
      const value = await request('/posts', query)
      if (!object(value) || !Array.isArray(value.posts)) throw Object.assign(new Error('Invalid posts response'), { code: 'unavailable' })
      if (value.total !== undefined) {
        if (!Number.isSafeInteger(value.total) || value.total < 0 || (declaredTotal !== undefined && declaredTotal !== value.total)) throw Object.assign(new Error('Inconsistent posts total'), { code: 'unavailable' })
        declaredTotal = value.total
      }
      for (const post of value.posts) {
        if (!object(post) || typeof post.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(post.id)) throw Object.assign(new Error('Invalid post record'), { code: 'unavailable' })
        if (!seen.has(post.id)) {
          seen.add(post.id)
          const integration = object(post.integration) ? {
            id: typeof post.integration.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(post.integration.id) ? post.integration.id : null,
            providerIdentifier: typeof post.integration.providerIdentifier === 'string' ? post.integration.providerIdentifier : null,
            name: typeof post.integration.name === 'string' ? post.integration.name : null,
            picture: typeof post.integration.picture === 'string' ? post.integration.picture : null
          } : null
          all.push({ id: post.id, content: typeof post.content === 'string' ? post.content : '', publishDate: validDate(post.publishDate) ? post.publishDate : null, releaseURL: typeof post.releaseURL === 'string' ? post.releaseURL : null, state: typeof post.state === 'string' ? post.state : null, integration })
        }
      }
      if (value.hasMore !== true) break
      if (typeof value.nextCursor !== 'string' || !value.nextCursor || cursors.has(value.nextCursor)) throw Object.assign(new Error('Invalid pagination cursor'), { code: 'unavailable' })
      cursors.add(value.nextCursor); cursor = value.nextCursor
      if (page === 99) throw Object.assign(new Error('Posts pagination limit exceeded'), { code: 'unavailable' })
    }
    if (declaredTotal !== undefined && declaredTotal !== all.length) throw Object.assign(new Error('Posts total does not match returned records'), { code: 'unavailable' })
    return all
  }
  const readPost = async (id, { window } = {}) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new TypeError('post id is required')
    return (await listPosts({ window })).find(post => post.id === id) ?? null
  }
  const readMetrics = async ({ postId, days, appId, creativeRevision } = {}) => {
    if (typeof postId !== 'string' || !postId || !Number.isInteger(days) || days < 1 || days > 365 || typeof appId !== 'string' || !appId || !(creativeRevision === null || (Number.isSafeInteger(creativeRevision) && creativeRevision >= 0))) throw new TypeError('valid post and metric scope are required')
    const key = `${postId}:${days}:${appId}:${creativeRevision}`
    try {
      const value = await request(`/analytics/post/${encodeURIComponent(postId)}`, { date: days })
      if (!Array.isArray(value)) throw Object.assign(new Error('Invalid analytics response'), { code: 'unavailable' })
      const observations = []
      for (const metric of value) {
        if (!object(metric) || typeof metric.label !== 'string' || !Array.isArray(metric.data)) throw Object.assign(new Error('Invalid metric bucket'), { code: 'unavailable' })
        for (const bucket of metric.data) {
          if (!object(bucket) || !isoDay(bucket.date)) throw Object.assign(new Error('Invalid metric date bucket'), { code: 'unavailable' })
          const numeric = typeof bucket.total === 'string' && bucket.total.trim() !== '' ? Number(bucket.total) : typeof bucket.total === 'number' ? bucket.total : NaN
          const available = Number.isFinite(numeric)
          observations.push({ source: 'postiz', postId, appId, creativeRevision, ...(creativeRevision === null ? { attribution: { status: 'unmapped' } } : {}), metric: metric.label, value: available ? numeric : null, denominator: null, windowStart: bucket.date, windowEnd: bucket.date, observedAt: clock(), status: available ? 'available' : 'unsupported', coverage: null, evidenceId: `postiz:${postId}:${metric.label}:${bucket.date}`, fixtureOnly: false })
        }
      }
      cachedMetrics.set(key, observations)
      return { status: 'available', observations }
    } catch (error) {
      const stale = cachedMetrics.get(key)
      return { status: stale ? 'stale' : 'unavailable', observations: stale ?? [], error: safeError(error) }
    }
  }
  const readPlatformMetrics = async ({ integrationId, days, appId } = {}) => {
    if (!safeId(integrationId) || !Number.isInteger(days) || days < 1 || days > 365 || typeof appId !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(appId)) throw Object.assign(new TypeError('valid integration analytics scope is required'), { code: 'invalid_input' })
    const key = `integration:${integrationId}:${days}:${appId}`
    try {
      const value = await request(`/analytics/${integrationId}`, { date: String(days) })
      if (!Array.isArray(value)) throw Object.assign(new Error('Invalid analytics response'), { code: 'unavailable' })
      const observations = []
      for (const metric of value) {
        if (!object(metric) || typeof metric.label !== 'string' || !Array.isArray(metric.data)) throw Object.assign(new Error('Invalid metric bucket'), { code: 'unavailable' })
        for (const bucket of metric.data) {
          if (!object(bucket) || !isoDay(bucket.date)) throw Object.assign(new Error('Invalid metric date bucket'), { code: 'unavailable' })
          const numeric = typeof bucket.total === 'string' && bucket.total.trim() !== '' ? Number(bucket.total) : typeof bucket.total === 'number' ? bucket.total : NaN
          const available = Number.isFinite(numeric)
          observations.push({ source: 'postiz', integrationId, appId, creativeRevision: null, attribution: { status: 'unmapped' }, metric: metric.label, value: available ? numeric : null, denominator: null, windowStart: bucket.date, windowEnd: bucket.date, observedAt: clock(), status: available ? 'available' : 'unsupported', coverage: null, evidenceId: `postiz:${integrationId}:${metric.label}:${bucket.date}`, fixtureOnly: false })
        }
      }
      cachedMetrics.set(key, observations)
      return { status: 'available', observations }
    } catch (error) {
      const stale = cachedMetrics.get(key)
      return { status: stale ? 'stale' : 'unavailable', observations: stale ?? [], error: safeError(error) }
    }
  }
  return { listIntegrations, listPosts, readPost, readMetrics, readPlatformMetrics }
}

export function createDefaultPostizReader({ env = process.env, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const baseText = env.POSTIZ_BASE_URL, apiKey = env.POSTIZ_API_KEY
  if (!baseText || !apiKey) return null
  const base = new URL(baseText)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if (base.username || base.password || base.search || base.hash) throw new TypeError('Postiz base URL cannot contain credentials, query, or fragment')
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) throw new TypeError('Postiz base URL must use HTTPS')
  if (!['/api/public/v1', '/public/v1'].includes(base.pathname.replace(/\/$/, ''))) throw new TypeError('Postiz base URL must end with /api/public/v1 or /public/v1')
  const allowedPaths = new Set(['/integrations', '/posts'])
  const transport = async ({ method, path, query }) => {
    const isAnalytics = /^\/analytics\/post\/[A-Za-z0-9_-]+$/.test(path) || /^\/analytics\/[A-Za-z0-9_-]+$/.test(path)
    if (method !== 'GET' || !(allowedPaths.has(path) || isAnalytics)) throw Object.assign(new Error('Route denied'), { status: 403 })
    const normalizedPath = path
    const url = new URL(`${base.href.replace(/\/$/, '')}${normalizedPath}`)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value))
    const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: apiKey }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw Object.assign(new Error('Provider request failed'), { status: response.status, retryAfterMs: Number(response.headers.get('retry-after')) * 1000 })
    return response.json()
  }
  return { ...createPostizReader({ transport }), transport }
}
