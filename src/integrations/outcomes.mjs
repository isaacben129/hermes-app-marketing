export function normalizeOutcomeRows({ rows, eventDefinitions, attributionPolicy, source, window }) {
  if (!Array.isArray(rows) || !Array.isArray(eventDefinitions) || !eventDefinitions.length) throw new TypeError('rows and eventDefinitions must be arrays');
  if (!attributionPolicy || typeof attributionPolicy !== 'object' || attributionPolicy.identityJoin !== false) throw new TypeError('explicit no-identity-join attribution policy is required');
  if (!source || !text(source.type) || !text(source.locator) || !validDate(source.observedAt)) throw new TypeError('source provenance is required');
  const bounds = validWindow(window);
  const definitions = new Map();
  for (const def of eventDefinitions) {
    if (!def || !text(def.name) || !['engagement', 'qualified', 'paid', 'revenue'].includes(def.kind) || definitions.has(def.name)) throw new TypeError('event definition is invalid or duplicated');
    definitions.set(def.name, def);
  }
  const seen = new Set();
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('outcome row must be an object');
    for (const forbidden of ['userId', 'personId', 'email', 'payload', 'text']) if (forbidden in row) throw new TypeError('person-level or raw event data is not accepted');
    const def = definitions.get(row.eventName);
    if (!def) throw new TypeError(`unknown event: ${row.eventName}`);
    const rowBounds = validWindow({ start: row.windowStart, end: row.windowEnd });
    if (rowBounds.start !== bounds.start || rowBounds.end !== bounds.end) throw new TypeError('outcome row window does not match requested window');
    if (row.campaignId && attributionPolicy.allowCampaignId !== true) throw new TypeError('campaign mapping is not allowed by attribution policy');
    if (row.postId && attributionPolicy.allowPostId !== true) throw new TypeError('post mapping is not allowed by attribution policy');
    if (!row.campaignId && !row.postId) throw new TypeError('campaign or post mapping is required');
    const key = [row.eventName, row.campaignId ?? '', row.postId ?? '', bounds.start, bounds.end].join('|');
    if (seen.has(key)) throw new TypeError('duplicate outcome aggregate');
    seen.add(key);
    const status = row.suppressed === true ? 'suppressed' : row.missing === true ? 'missing' : 'observed';
    if (status !== 'observed' && row.count !== undefined && row.count !== null) throw new TypeError('missing or suppressed rows cannot have counts');
    if (status === 'observed' && (!Number.isSafeInteger(row.count) || row.count < 0)) throw new TypeError('count must be a non-negative safe integer');
    if (def.kind === 'revenue' && (!text(row.currency) || !text(def.refundsPolicy))) throw new TypeError('revenue requires currency and explicit refunds policy');
    return { eventName: row.eventName, metricKind: def.kind, count: status === 'observed' ? row.count : null, status, window: { ...bounds }, campaignId: row.campaignId ?? null, postId: row.postId ?? null, ...(def.kind === 'revenue' ? { currency: row.currency, refundsPolicy: def.refundsPolicy } : {}), source: { ...source }, attribution: { campaignMapped: Boolean(row.campaignId), postMapped: Boolean(row.postId), identityJoined: false } };
  });
}

function validWindow(value) {
  if (!value || !dateOnly(value.start) || !dateOnly(value.end) || value.start > value.end) throw new TypeError('window must contain valid ordered dates');
  return { start: value.start, end: value.end };
}
const dateOnly = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const validDate = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const text = v => typeof v === 'string' && v.trim().length > 0;
