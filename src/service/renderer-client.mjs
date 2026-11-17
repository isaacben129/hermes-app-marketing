export class RendererClient {
  constructor({ origin = 'http://127.0.0.1:8765', fetchImpl = fetch, timeoutMs = 30000 } = {}) {
    this.origin = origin
    this.fetch = fetchImpl
    this.timeoutMs = timeoutMs
  }
  async health() {
    const response = await this.fetch(`${this.origin}/api/health`, { signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw Object.assign(new Error('Renderer unavailable'), { code: 'unavailable' })
    const value = await response.json()
    const features = value.features
    const supports = name => Array.isArray(features)
      ? features.includes(name)
      : features && typeof features === 'object' && features[name] === true
    if (value.protocol !== 2 || !supports('render') || !supports('export')) {
      throw Object.assign(new Error('Renderer protocol mismatch'), { code: 'protocol_mismatch' })
    }
    return value
  }
  async #post(route, payload) {
    await this.health()
    const response = await this.fetch(`${this.origin}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw Object.assign(new Error('Renderer request failed'), { code: response.status === 400 ? 'invalid_input' : 'render_failed' })
    return response.json()
  }
  render(payload) { return this.#post('/api/render', payload) }
  export(payload) { return this.#post('/api/export', payload) }
}
