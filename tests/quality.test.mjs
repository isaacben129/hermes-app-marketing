import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuality } from '../src/domain/quality.mjs';

const dims = ['audience fit', 'hook clarity', 'claim specificity/proof', 'slide progression/payoff', 'mobile legibility/visual coherence', 'promise-to-destination match', 'safety/rights/brand'];
const input = { revision: 2, dimensions: dims, reviews: [], automatedChecks: {} };

test('quality review leaves absent human judgments unassessed and honors hard blockers', () => {
  const result = evaluateQuality({ ...input, automatedChecks: { overflow: true } });
  assert.equal(result.rubricVersion, 1);
  assert.equal(result.revision, 2);
  assert.equal(result.assessment, 'blocked');
  assert.deepEqual(result.dimensions.map(item => item.score), Array(7).fill(null));
  assert.ok(result.hardBlockers.includes('overflow'));
});

test('quality review rejects scores without rationale and evidence', () => {
  assert.throws(() => evaluateQuality({ ...input, reviews: [{ dimension: dims[0], score: 4, reviewer: { type: 'human', name: 'reviewer' } }] }), /rationale|evidence/i);
});
