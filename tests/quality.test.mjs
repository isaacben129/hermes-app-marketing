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
  assert.throws(() => evaluateQuality({ ...input, reviews: [{ dimension: dims[0], score: 4, revision: 2, reviewedAt: '2026-11-16T00:00:00Z', reviewer: { type: 'human', name: 'reviewer' } }] }), /rationale|evidence/i);
});

test('scored reviews are revision-bound, valid, and automated blockers are booleans', () => {
  const review = { dimension: dims[0], score: 4, reviewer: { type: 'human', name: 'reviewer' }, revision: 2, reviewedAt: '2026-11-16T00:00:00Z', rationale: 'Observed in preview', evidenceRefs: ['preview-1'] };
  assert.equal(evaluateQuality({ ...input, reviews: [review] }).dimensions[0].score, 4);
  for (const changes of [{ revision: 1 }, { reviewedAt: 'bad' }, { reviewedAt: '2026-02-30T00:00:00Z' }, { reviewer: null }, { evidenceRefs: [] }, { rationale: '' }, { score: 5.5 }, { score: NaN }, { score: 6 }]) assert.throws(() => evaluateQuality({ ...input, reviews: [{ ...review, ...changes }] }));
  for (const check of ['fontBelowFloor', 'overflow', 'missingImage', 'missingFont', 'unsupportedClaim', 'unknownRights', 'restrictedRights', 'unapprovedCta', 'destinationMismatch']) {
    assert.equal(evaluateQuality({ ...input, automatedChecks: { [check]: true } }).assessment, 'blocked');
    for (const value of ['true', [], {}]) assert.throws(() => evaluateQuality({ ...input, automatedChecks: { [check]: value } }));
  }
  assert.equal(evaluateQuality(input).assessment, 'inconclusive');
  assert.equal(evaluateQuality({ ...input, reviews: [review] }).assessment, 'inconclusive');
});
