import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORD_TYPES,
  RECORD_VERSION,
  createRecord,
  transitionRecord,
  validateRecord,
} from '../src/domain/records.js';

const base = (type, fields = {}) => createRecord(type, {
  id: `${type.toLowerCase()}-1`,
  campaignId: 'campaign-1',
  status: 'draft',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  provenance: { source: 'test', actor: 'tester' },
  fixtureOnly: false,
  ...fields,
});

test('exports the complete app-agnostic record vocabulary and version', () => {
  assert.equal(RECORD_VERSION, 1);
  assert.deepEqual(RECORD_TYPES, [
    'AppProfile', 'Source', 'Brief', 'Hypothesis', 'Slide', 'Creative',
    'Review', 'Experiment', 'Post', 'Observation', 'Decision',
  ]);
  for (const type of RECORD_TYPES) assert.equal(base(type).type, type);
});

test('records have version, stable identifiers, timestamps and provenance', () => {
  const record = base('Source', { uri: 'https://example.test/source' });
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.id, 'source-1');
  assert.equal(record.campaignId, 'campaign-1');
  assert.equal(record.provenance.actor, 'tester');
  assert.equal(validateRecord(record), true);
});

test('rejects missing common identity/provenance fields and unsupported record types', () => {
  assert.throws(() => base('Bogus'), /unsupported record type/i);
  assert.throws(() => base('Brief', { id: '' }), /id/i);
  assert.throws(() => base('Brief', { provenance: null }), /provenance/i);
  const record = base('Brief');
  delete record.campaignId;
  assert.throws(() => validateRecord(record), /campaignId/i);
});

test('external-ready transitions require cleared rights, claims and CTA', () => {
  const review = base('Review', { status: 'pending' });
  assert.throws(() => transitionRecord(review, 'external-ready'), /rights/i);
  const cleared = { rightsStatus: 'cleared', claimsStatus: 'supported', ctaStatus: 'checked' };
  assert.equal(transitionRecord({ ...review, ...cleared }, 'external-ready').status, 'external-ready');
  assert.throws(() => transitionRecord({ ...review, rightsStatus: 'cleared' }, 'external-ready'), /claims/i);
  assert.throws(() => transitionRecord({ ...review, ...cleared, ctaStatus: 'unchecked' }, 'external-ready'), /cta/i);
});

test('fixture-only records cannot become real metrics or evidence-backed decisions', () => {
  assert.throws(() => base('Observation', { fixtureOnly: true, metricKind: 'real', value: 42 }), /fixture/i);
  assert.throws(() => base('Decision', { fixtureOnly: true, evidenceKind: 'real', outcome: 'scale' }), /fixture/i);
  assert.throws(() => transitionRecord(base('Experiment', { fixtureOnly: true }), 'real-metrics'), /fixture/i);
  assert.throws(() => transitionRecord(base('Decision', { fixtureOnly: true }), 'real-decision'), /fixture/i);
});

test('transitions return a new validated record without mutating the original', () => {
  const before = base('Brief');
  const after = transitionRecord(before, 'ready');
  assert.equal(before.status, 'draft');
  assert.equal(after.status, 'ready');
  assert.notEqual(after, before);
  assert.equal(after.updatedAt, before.updatedAt);
});
