import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOutcomeRows } from '../src/integrations/outcomes.mjs';

const args = { rows: [{ eventName: 'qualified_start', count: 8, windowStart: '2026-11-01', windowEnd: '2026-11-07', appId: 'cherry', creativeRevision: 1, postId: 'p1', evidenceId: 'ev1' }], eventDefinitions: [{ name: 'qualified_start', kind: 'qualified' }], attributionPolicy: { approved: true, policyVersion: 'v1', evidenceRef: 'approval', approvedBy: 'owner', allowedMappings: ['postId'], identityJoin: false }, source: { type: 'manual-aggregate', locator: 'owner-export', observedAt: '2026-11-08T00:00:00Z', appId: 'cherry', creativeRevision: 1 }, window: { start: '2026-11-01', end: '2026-11-07' } };

test('outcome intake accepts privacy-safe aggregate and distinguishes suppressed from zero', () => {
  const result = normalizeOutcomeRows({ ...args, rows: [...args.rows, { eventName: 'qualified_start', status: 'suppressed', count: null, windowStart: '2026-11-01', windowEnd: '2026-11-07', appId: 'cherry', creativeRevision: 1, postId: 'p2', evidenceId: 'ev2' }] });
  assert.equal(result.length, 2);
  assert.equal(result[0].count, 8);
  assert.equal(result[1].status, 'suppressed');
  assert.equal(result[1].count, null);
});

test('outcome attribution is approved, allowlisted, provenance-safe, normalized and decimal-revenue capable', () => {
  const policy = args.attributionPolicy;
  const source = { ...args.source, appId: 'cherry', creativeRevision: 2 };
  const row = { ...args.rows[0], appId: 'cherry', creativeRevision: 2, postId: 'p1', evidenceId: 'ev1', status: 'observed' };
  const result = normalizeOutcomeRows({ ...args, attributionPolicy: policy, source, rows: [row] });
  assert.deepEqual(Object.keys(result[0]).sort(), ['appId','creativeRevision','eventName','metricKind','count','status','window','postId','evidenceId','source','attribution'].sort());
  assert.equal(result[0].appId, 'cherry');
  assert.throws(() => normalizeOutcomeRows({ ...args, attributionPolicy: { ...policy, allowedMappings: [] }, source, rows: [row] }));
  assert.throws(() => normalizeOutcomeRows({ ...args, attributionPolicy: policy, source, rows: [{ ...row, appId: 'elsewhere' }] }));
  assert.throws(() => normalizeOutcomeRows({ ...args, attributionPolicy: policy, source, rows: [{ ...row, surprise: { email: 'x' } }] }));
  assert.throws(() => normalizeOutcomeRows({ ...args, attributionPolicy: policy, source: { ...source, email: 'x' }, rows: [row] }));
  assert.throws(() => normalizeOutcomeRows({ ...args, attributionPolicy: policy, source, rows: [row, { ...row, evidenceId: 'ev2' }] }));
  const revenue = normalizeOutcomeRows({ ...args, attributionPolicy: policy, source, eventDefinitions: [{ name: 'sales', kind: 'revenue', refundsPolicy: 'net refunds' }], rows: [{ ...row, eventName: 'sales', amount: 12.34, currency: 'USD' }] });
  assert.equal(revenue[0].amount, 12.34);
  assert.equal('count' in revenue[0], false);
  assert.throws(() => normalizeOutcomeRows({ ...args, attributionPolicy: policy, source, eventDefinitions: [{ name: 'sales', kind: 'revenue', refundsPolicy: 'net refunds' }], rows: [{ ...row, eventName: 'sales', amount: 12, currency: 'usd' }] }));
});

test('outcome intake rejects unknown events and incompatible windows', () => {
  assert.throws(() => normalizeOutcomeRows({ ...args, rows: [{ ...args.rows[0], eventName: 'click' }] }), /unknown event/i);
  assert.throws(() => normalizeOutcomeRows({ ...args, rows: [{ ...args.rows[0], windowEnd: '2026-11-06' }] }), /window/i);
});
