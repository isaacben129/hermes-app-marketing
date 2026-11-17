import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendExperiment } from '../src/domain/experiments.mjs';

const experiment = { appId: 'cherry', changedVariable: 'hook', baseline: 'a', variant: 'b', primaryMetric: 'qualified_start', window: { start: '2026-11-01', end: '2026-11-03' }, minExposure: 10, minOutcomeCoverage: 0.8, policy: null };
const obs = (cell, outcome, extra = {}) => ({ cell, appId: 'cherry', metric: 'qualified_start', status: 'available', fixtureOnly: false, attributionVerified: true, source: 'owner-export', exposure: 20, outcome, coverage: 1, windowStart: '2026-11-01', windowEnd: '2026-11-03', observedAt: '2026-11-04T00:00:00Z', evidenceId: `${cell}-obs`, ...extra });

test('experiment recommendation is inconclusive without approved policy and required evidence', () => {
  assert.equal(recommendExperiment({ experiment, observations: [obs('a', 5), obs('b', 8)], now: '2026-11-05T00:00:00Z' }).decision, 'inconclusive');
  const configured = { ...experiment, policy: { version: 'test-1', approved: true, killBelow: 0.1, keepAtOrAbove: 0.2, maxSourceAgeMs: 86400000 } };
  assert.equal(recommendExperiment({ experiment: configured, observations: [obs('a', 5), obs('b', 8, { coverage: 0.2 })], now: '2026-11-05T00:00:00Z' }).decision, 'inconclusive');
});

test('experiment applies only explicit policy floors and targets', () => {
  const configured = { ...experiment, policy: { version: 'test-1', approved: true, killBelow: 0.1, keepAtOrAbove: 0.2, maxSourceAgeMs: 86400000 } };
  assert.equal(recommendExperiment({ experiment: configured, observations: [obs('a', 10), obs('b', 0)], now: '2026-11-05T00:00:00Z' }).decision, 'kill');
  assert.equal(recommendExperiment({ experiment: configured, observations: [obs('a', 2), obs('b', 10)], now: '2026-11-05T00:00:00Z' }).decision, 'keep');
});

test('experiment fails closed on unverified, duplicate, invalid and ambiguous evidence', () => {
  const configured = { ...experiment, policy: { version: 'test-1', approved: true, killBelow: 0.1, keepAtOrAbove: 0.2, maxSourceAgeMs: 86400000 } };
  const pair = [obs('a', 5), obs('b', 8)];
  for (const override of [{ appId: 'elsewhere' }, { metric: 'other' }, { status: 'missing' }, { status: 'suppressed' }, { fixtureOnly: true }, { attributionVerified: false }, { evidenceId: '' }, { source: '' }, { observedAt: '2026-11-06T00:00:00Z' }, { windowStart: '2026-11-02' }, { exposure: 0 }, { outcome: 21 }]) {
    assert.equal(recommendExperiment({ experiment: configured, observations: [pair[0], { ...pair[1], ...override }], now: '2026-11-05T00:00:00Z' }).decision, 'inconclusive');
  }
  assert.equal(recommendExperiment({ experiment: configured, observations: [...pair, obs('b', 4, { evidenceId: 'duplicate-cell' })], now: '2026-11-05T00:00:00Z' }).decision, 'inconclusive');
  assert.equal(recommendExperiment({ experiment: configured, observations: [pair[0], { ...pair[1], evidenceId: pair[0].evidenceId }], now: '2026-11-05T00:00:00Z' }).decision, 'inconclusive');
  assert.equal(recommendExperiment({ experiment: { ...configured, minExposure: 0 }, observations: [pair[0], pair[1]], now: '2026-11-05T00:00:00Z' }).decision, 'inconclusive');
  assert.equal(recommendExperiment({ experiment: configured, observations: [pair[0], pair[1]], now: 'not-a-real-date-xyz' }).decision, 'inconclusive');
  const mixed = { ...configured, policy: { ...configured.policy, killBelow: 0, keepAtOrAbove: 1, iterateWhenMixed: true } };
  assert.equal(recommendExperiment({ experiment: mixed, observations: pair, now: '2026-11-05T00:00:00Z' }).decision, 'iterate');
});
