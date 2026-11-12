export const RECORD_VERSION = 1;

export const RECORD_TYPES = Object.freeze([
  'AppProfile',
  'Source',
  'Brief',
  'Hypothesis',
  'Slide',
  'Creative',
  'Review',
  'Experiment',
  'Post',
  'Observation',
  'Decision',
]);

const typeSet = new Set(RECORD_TYPES);
const EXTERNAL_READY_STATUSES = new Set(['external-ready', 'publish-ready', 'approved-for-publishing']);
const REAL_OUTCOME_STATUSES = new Set(['real-metrics', 'real-decision']);

const hasText = value => typeof value === 'string' && value.trim().length > 0;

export function createRecord(type, fields = {}) {
  if (!typeSet.has(type)) throw new TypeError(`Unsupported record type: ${type}`);
  const record = { schemaVersion: RECORD_VERSION, type, ...fields };
  validateRecord(record);
  return record;
}

export function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('Record must be an object');
  }
  if (record.schemaVersion !== RECORD_VERSION) {
    throw new TypeError(`Unsupported schemaVersion: ${record.schemaVersion}`);
  }
  if (!typeSet.has(record.type)) throw new TypeError(`Unsupported record type: ${record.type}`);
  for (const key of ['id', 'campaignId']) {
    if (!hasText(record[key])) throw new TypeError(`Record ${key} is required`);
  }
  if (!hasText(record.status)) throw new TypeError('Record status is required');
  for (const key of ['createdAt', 'updatedAt']) {
    if (!hasText(record[key]) || Number.isNaN(Date.parse(record[key]))) {
      throw new TypeError(`Record ${key} must be a valid timestamp`);
    }
  }
  if (!record.provenance || typeof record.provenance !== 'object' || Array.isArray(record.provenance)) {
    throw new TypeError('Record provenance is required');
  }
  if (typeof record.fixtureOnly !== 'boolean') {
    throw new TypeError('Record fixtureOnly must be a boolean');
  }
  if (EXTERNAL_READY_STATUSES.has(record.status)) assertExternalReady(record);
  if (record.fixtureOnly && record.type === 'Observation' && isRealMetric(record)) {
    throw new TypeError('Fixture-only records cannot represent real metrics');
  }
  if (record.fixtureOnly && record.type === 'Decision' && isRealDecision(record)) {
    throw new TypeError('Fixture-only records cannot represent real decisions');
  }
  return true;
}

export function transitionRecord(record, status, updates = {}) {
  validateRecord(record);
  if (!hasText(status)) throw new TypeError('Transition status is required');
  const next = { ...record, ...updates, status };
  if (next.fixtureOnly && REAL_OUTCOME_STATUSES.has(status)) {
    throw new TypeError('Fixture-only records cannot transition to real metrics or decisions');
  }
  validateRecord(next);
  return next;
}

function assertExternalReady(record) {
  const review = record.review && typeof record.review === 'object' ? record.review : {};
  const fields = { ...review, ...record };
  if (fields.rightsStatus !== 'cleared') {
    throw new TypeError('External-ready status requires cleared rights');
  }
  if (fields.claimsStatus !== 'supported') {
    throw new TypeError('External-ready status requires supported claims');
  }
  if (fields.ctaStatus !== 'checked') {
    throw new TypeError('External-ready status requires checked CTA');
  }
}

function isRealMetric(record) {
  return record.metricKind === 'real' || record.measurementKind === 'real' || record.isRealMetric === true;
}

function isRealDecision(record) {
  return record.evidenceKind === 'real' || record.decisionKind === 'real' || record.isRealDecision === true;
}
