const ALLOWED = new Set(['POSTIZ_API_KEY', 'POSTIZ_BASE_URL'])

export function parse(text) {
  const values = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) throw new TypeError('Invalid secrets file line')
    const [, key, encoded] = match
    if (!ALLOWED.has(key)) continue
    let value = encoded.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').trim()
    values[key] = value
  }
  if (values.POSTIZ_BASE_URL) {
    const url = new URL(values.POSTIZ_BASE_URL)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new TypeError('Postiz base URL must use HTTPS')
  }
  return values
}
