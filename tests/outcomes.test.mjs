import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOutcomeRows } from '../src/integrations/outcomes.mjs';

const args = { rows: [{ eventName: 'qualified_start', count: 8, windowStart: '2026-11-01', windowEnd: '2026-11-07', campaignId: 'c1' }], eventDefinitions: [{ name: 'qualified_start', kind: 'qualified' }], attributionPolicy: { allowCampaignId: true, allowPostId: false, identityJoin: false }, source: { type: 'manual-aggregate', locator: 'owner-export', observedAt: '2026-11-08T00:00:00Z' }, window: { start: '2026-11-01', end: '2026-11-07' } };

test('outcome intake accepts privacy-safe aggregate and distinguishes suppressed from zero', () => {
  const result = normalizeOutcomeRows({ ...args, rows: [...args.rows, { eventName: 'qualified_start', count: null, suppressed: true, windowStart: '2026-11-01', windowEnd: '2026-11-07', campaignId: 'c2' }] });
  assert.equal(result.length, 2);
  assert.equal(result[0].count, 8);
  assert.equal(result[1].status, 'suppressed');
  assert.equal(result[1].count, null);
});

test('outcome intake rejects unknown events and incompatible windows', () => {
  assert.throws(() => normalizeOutcomeRows({ ...args, rows: [{ ...args.rows[0], eventName: 'click' }] }), /unknown event/i);
  assert.throws(() => normalizeOutcomeRows({ ...args, rows: [{ ...args.rows[0], windowEnd: '2026-11-06' }] }), /window/i);
});
