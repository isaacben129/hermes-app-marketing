import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecord, transitionRecord, validateRecord } from '../src/domain/records.js';

const base = (overrides = {}) => ({
  id: 'record-1',
  campaignId: 'campaign-1',
  status: 'draft',
  createdAt: '2026-11-18T08:00:00.000Z',
  updatedAt: '2026-11-18T08:00:00.000Z',
  provenance: { origin: 'local-test', locator: 'fixture://record-1' },
  fixtureOnly: false,
  ...overrides,
});

test('createRecord supplies and validates the supported schema version', () => {
  const record = createRecord('Creative', base());
  assert.equal(record.schemaVersion, 1);
  assert.equal(validateRecord(record), true);
});

test('records preserve provenance and do not silently treat unknown rights as cleared', () => {
  const record = createRecord('Source', base({ provenance: { origin: 'upload', locator: 'file://a', rightsStatus: 'unknown' } }));
  assert.equal(record.provenance.rightsStatus, 'unknown');
  assert.throws(() => transitionRecord(record, 'external-ready', { rightsStatus: 'unknown', claimsStatus: 'supported', ctaStatus: 'checked' }), /cleared rights/);
});

test('records without app scope and source provenance fail closed', () => {
  assert.throws(() => createRecord('Creative', base({ campaignId: '' })), /campaignId/);
  assert.throws(() => createRecord('Source', base({ provenance: null })), /provenance/);
});

test('external-ready transition requires cleared rights, supported claims, and checked CTA', () => {
  const record = createRecord('Creative', base());
  assert.throws(() => transitionRecord(record, 'external-ready'), /cleared rights/);
  assert.throws(() => transitionRecord(record, 'external-ready', { rightsStatus: 'cleared' }), /supported claims/);
  assert.throws(() => transitionRecord(record, 'external-ready', { rightsStatus: 'cleared', claimsStatus: 'supported' }), /checked CTA/);
  assert.equal(transitionRecord(record, 'external-ready', { rightsStatus: 'cleared', claimsStatus: 'supported', ctaStatus: 'checked' }).status, 'external-ready');
});

test('fixture-only observation or decision cannot be converted to real results', () => {
  const observation = createRecord('Observation', base({ fixtureOnly: true, metricKind: 'illustrative' }));
  const decision = createRecord('Decision', base({ fixtureOnly: true, evidenceKind: 'illustrative' }));
  assert.throws(() => transitionRecord(observation, 'real-metrics'), /Fixture-only/);
  assert.throws(() => transitionRecord(decision, 'real-decision'), /Fixture-only/);
  assert.throws(() => createRecord('Observation', base({ fixtureOnly: true, metricKind: 'real' })), /Fixture-only/);
});

test('record transition returns a new immutable-style value and validates updates', () => {
  const original = createRecord('Brief', base());
  const next = transitionRecord(original, 'review', { updatedAt: '2026-11-18T09:00:00.000Z' });
  assert.notEqual(next, original);
  assert.equal(original.status, 'draft');
  assert.equal(next.status, 'review');
  assert.throws(() => transitionRecord(original, 'review', { provenance: null }), /provenance/);
});
