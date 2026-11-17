import http from 'node:http'

const MAX_BODY_BYTES = 64_000_000
const retryableCodes = new Set(['unavailable', 'persistence_failed', 'render_failed', 'rate_limited', 'service_offline', 'protocol_mismatch'])
const hasCredentialField = value => Array.isArray(value)
  ? value.some(hasCredentialField)
  : value && typeof value === 'object'
    ? Object.entries(value).some(([key, nested]) => /token|secret|password|api.?key|authorization/i.test(key) || hasCredentialField(nested))
    : false

function response(res, status, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8' }
  if (origin !== undefined) { headers['access-control-allow-origin'] = origin; headers.vary = 'Origin' }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

function errorResponse(res, status, code, origin) {
  response(res, status, { error: { code, message: 'Request could not be completed', retryable: retryableCodes.has(code) } }, origin)
}

function statusFor(error) {
  return ({ invalid_input: 400, stale_revision: 409, persistence_failed: 503, unavailable: 503, service_offline: 503, protocol_mismatch: 503, render_failed: 502, rate_limited: 429 })[error.code] ?? 400
}

export function createService({ actions, token, allowedOrigin = 'null' }) {
  if (!actions || typeof token !== 'string' || !token) throw new TypeError('actions and token required')
  if (typeof allowedOrigin !== 'string' || !allowedOrigin) throw new TypeError('allowedOrigin must be an explicit origin string')
  let rendering = false
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin
    const corsOrigin = origin === allowedOrigin ? allowedOrigin : undefined
    const expectedHost = `127.0.0.1:${res.socket.localPort}`
    if (req.headers.host !== expectedHost) { errorResponse(res, 403, 'provider_denied', corsOrigin); return }
    if (req.method === 'OPTIONS') {
      if (!corsOrigin) { errorResponse(res, 403, 'provider_denied'); return }
      res.writeHead(204, { 'access-control-allow-origin': corsOrigin, vary: 'Origin', 'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-max-age': '600' })
      res.end()
      return
    }
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/api/health') {
      try {
        const value = await actions.health()
        response(res, 200, { version: value.version, observedAt: value.observedAt, services: value.services?.map(({ name, status, lastSuccess, error }) => ({ name, status, lastSuccess, error })) ?? [] }, corsOrigin)
      } catch { errorResponse(res, 503, 'unavailable', corsOrigin) }
      return
    }
    if (!corsOrigin) { errorResponse(res, 403, 'provider_denied'); return }
    if (req.headers.authorization !== `Bearer ${token}`) { errorResponse(res, 401, 'provider_denied', corsOrigin); return }
    let body = {}
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const declared = Number(req.headers['content-length'] ?? 0)
      if (declared > MAX_BODY_BYTES) { errorResponse(res, 413, 'invalid_input', corsOrigin); req.resume(); return }
      try {
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > MAX_BODY_BYTES) { errorResponse(res, 413, 'invalid_input', corsOrigin); return }
          chunks.push(chunk)
        }
        const raw = Buffer.concat(chunks).toString('utf8')
        body = raw ? JSON.parse(raw) : {}
        if (!body || typeof body !== 'object' || Array.isArray(body) || hasCredentialField(body)) throw new TypeError('JSON body must be a credential-free object')
      } catch { errorResponse(res, 400, 'invalid_input', corsOrigin); return }
    }
    const invoke = async (work, successStatus = 200) => {
      try { response(res, successStatus, await work(), corsOrigin) }
      catch (error) { errorResponse(res, statusFor(error), error.code ?? 'invalid_input', corsOrigin) }
    }
    const draftMatch = /^\/api\/drafts\/([^/]+)$/.exec(url.pathname)
    const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname)
    const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(url.pathname)
    const retryMatch = /^\/api\/jobs\/([^/]+)\/retry$/.exec(url.pathname)
    if (req.method === 'GET' && url.pathname === '/api/workspace') return invoke(() => actions.workspace(url.searchParams.get('app')))
    if (req.method === 'PUT' && profileMatch) {
      let app
      try { app = decodeURIComponent(profileMatch[1]) } catch { errorResponse(res, 400, 'invalid_input', corsOrigin); return }
      return invoke(() => actions.saveProfile({ app, ...body }))
    }
    if (req.method === 'POST' && url.pathname === '/api/review') return invoke(() => actions.review(body))
    if (req.method === 'POST' && url.pathname === '/api/generation/intake') return invoke(() => actions.intakeGeneration(body))
    if (req.method === 'POST' && url.pathname === '/api/experiments/recommend') return invoke(() => actions.recommend(body))
    if (req.method === 'PUT' && draftMatch) {
      let id
      try { id = decodeURIComponent(draftMatch[1]) } catch { errorResponse(res, 400, 'invalid_input', corsOrigin); return }
      if ((body.id && body.id !== id) || (body.draft?.id && body.draft.id !== id)) { errorResponse(res, 400, 'invalid_input', corsOrigin); return }
      return invoke(() => actions.saveDraft({ ...body, draft: body.draft ?? { ...body, id } }))
    }
    if (req.method === 'DELETE' && draftMatch) {
      let id
      try { id = decodeURIComponent(draftMatch[1]) } catch { errorResponse(res, 400, 'invalid_input', corsOrigin); return }
      return invoke(() => actions.deleteDraft({ draftId: id, ...body }))
    }
    if (req.method === 'POST' && url.pathname === '/api/legacy-import') return invoke(() => actions.importLegacy(body))
    if (req.method === 'POST' && url.pathname === '/api/render') {
      if (rendering) { errorResponse(res, 429, 'rate_limited', corsOrigin); return }
      rendering = true
      try { return await invoke(() => actions.renderDraft(body), 202) } finally { rendering = false }
    }
    if (req.method === 'POST' && url.pathname === '/api/export') return invoke(() => actions.exportDraft(body))
    if (req.method === 'GET' && url.pathname === '/api/jobs') return invoke(() => actions.jobs())
    if (req.method === 'GET' && jobMatch) return invoke(() => actions.job(decodeURIComponent(jobMatch[1])))
    if (req.method === 'POST' && retryMatch) return invoke(() => actions.retry(decodeURIComponent(retryMatch[1])), 202)
    if (req.method === 'POST' && url.pathname === '/api/postiz/sync') return invoke(() => actions.sync(body))
    if (req.method === 'POST' && url.pathname === '/api/outcomes/import') return invoke(() => actions.importOutcomes(body))
    errorResponse(res, 404, 'invalid_input', corsOrigin)
  })
}
