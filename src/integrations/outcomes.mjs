const text = v => typeof v === 'string' && v.trim().length > 0;
const validDate = v => typeof v === 'string' && Number.isFinite(Date.parse(v));

export function normalizeOutcomeRows({ rows, eventDefinitions, attributionPolicy, source, window }) {
  if (!Array.isArray(rows) || !Array.isArray(eventDefinitions) || !eventDefinitions.length) throw new TypeError('rows and eventDefinitions must be arrays');
  if (!attributionPolicy || attributionPolicy.approved !== true || !text(attributionPolicy.policyVersion) || !text(attributionPolicy.evidenceRef) || !text(attributionPolicy.approvedBy) || attributionPolicy.identityJoin !== false || !Array.isArray(attributionPolicy.allowedMappings) || attributionPolicy.allowedMappings.some(x => !['postId'].includes(x))) throw new TypeError('approved, explicit no-identity-join attribution policy is required');
  if (!source || !text(source.type) || !text(source.locator) || !validDate(source.observedAt) || !text(source.appId) || !Number.isSafeInteger(source.creativeRevision) || source.creativeRevision < 0) throw new TypeError('source provenance is required');
  if (Object.keys(source).some(key => !['type','locator','observedAt','appId','creativeRevision'].includes(key))) throw new TypeError('unknown or personal source field is not accepted');
  const bounds = validWindow(window), definitions = new Map();
  for (const def of eventDefinitions) {
    if (!def || !text(def.name) || !['engagement', 'qualified', 'paid', 'revenue'].includes(def.kind) || definitions.has(def.name)) throw new TypeError('event definition is invalid or duplicated');
    definitions.set(def.name, def);
  }
  const seen = new Set();
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('outcome row must be an object');
    const allowed = new Set(['eventName','count','amount','currency','windowStart','windowEnd','appId','creativeRevision','postId','evidenceId','status']);
    if (Object.keys(row).some(key => !allowed.has(key))) throw new TypeError('unknown or personal data field is not accepted');
    const def = definitions.get(row.eventName);
    if (!def) throw new TypeError(`unknown event: ${row.eventName}`);
    const rowBounds = validWindow({ start: row.windowStart, end: row.windowEnd });
    if (rowBounds.start !== bounds.start || rowBounds.end !== bounds.end) throw new TypeError('outcome row window does not match requested window');
    if (row.appId !== source.appId || row.creativeRevision !== source.creativeRevision) throw new TypeError('outcome app or creative revision does not match source');
    if (!attributionPolicy.allowedMappings.includes('postId') || !text(row.postId) || !text(row.evidenceId)) throw new TypeError('explicit post mapping and evidence are required');
    const key = [row.appId, row.creativeRevision, row.eventName, row.postId, bounds.start, bounds.end].join('|');
    if (seen.has(key)) throw new TypeError('duplicate outcome aggregate');
    seen.add(key);
    const status = row.status ?? 'observed';
    if (!['observed','missing','suppressed'].includes(status)) throw new TypeError('outcome status is invalid');
    const count = row.count ?? null;
    if (status !== 'observed' && (count !== null || row.amount !== undefined)) throw new TypeError('missing or suppressed rows cannot have values');
    if (status === 'observed' && def.kind !== 'revenue' && (!Number.isSafeInteger(count) || count < 0)) throw new TypeError('count must be a non-negative safe integer');
    let amount;
    if (def.kind === 'revenue') {
      if (!text(def.refundsPolicy) || !/^[A-Z]{3}$/.test(row.currency ?? '') || (status === 'observed' && (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0))) throw new TypeError('revenue requires decimal amount, ISO3 currency and explicit refunds policy');
      amount = status === 'observed' ? row.amount : null;
    } else if (row.amount !== undefined || row.currency !== undefined) throw new TypeError('amount/currency are only valid for revenue');
    return { appId: row.appId, creativeRevision: row.creativeRevision, postId: row.postId, eventName: row.eventName, metricKind: def.kind, ...(def.kind === 'revenue' ? { amount, currency: row.currency, refundsPolicy: def.refundsPolicy } : { count: status === 'observed' ? count : null }), status, window: { ...bounds }, evidenceId: row.evidenceId, source: { type: source.type, locator: source.locator, observedAt: source.observedAt }, attribution: { postMapped: true, identityJoined: false } };
  });
}

function validWindow(value) {
  if (!value || !dateOnly(value.start) || !dateOnly(value.end) || value.start > value.end) throw new TypeError('window must contain valid ordered dates');
  return { start: value.start, end: value.end };
}
const dateOnly = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
