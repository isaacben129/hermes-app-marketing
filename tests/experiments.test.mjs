import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendExperiment } from '../src/domain/experiments.mjs';

const experiment = { appId: 'cherry', changedVariable: 'hook', baseline: 'a', variant: 'b', primaryMetric: 'qualified_start', window: { start: '2026-11-01', end: '2026-11-03' }, minExposure: 10, minOutcomeCoverage: 0.8, policy: null };
const obs = (cell, outcome, extra = {}) => ({ cell, exposure: 20, outcome, coverage: 1, windowStart: '2026-11-01', windowEnd: '2026-11-03', observedAt: '2026-11-04T00:00:00Z', evidenceId: `${cell}-obs`, ...extra });

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
