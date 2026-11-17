import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeneratedAsset } from '../src/domain/generation.mjs';

const asset = { draftId: 'draft-1', revision: 3, prompt: 'abstract red shapes', provider: 'hermes', model: 'image-model', requestId: 'req-1', generatedAt: '2026-11-17T10:00:00.000Z', imageSha256: 'a'.repeat(64), sourceRef: 'asset://staged/1', humanUseApproval: 'pending' };

test('generation intake verifies revision and content hash while preserving pending human gates', () => {
  const result = validateGeneratedAsset(asset, { expectedRevision: 3, actualSha256: 'a'.repeat(64) });
  assert.equal(result.provenance.requestId, 'req-1');
  assert.equal(result.humanUseApproval, 'pending');
  assert.equal(result.fixtureOnly, true);
  assert.equal(result.useStatus, 'review-required');
});

test('generation intake rejects stale revisions and mismatched hashes', () => {
  assert.throws(() => validateGeneratedAsset(asset, { expectedRevision: 4, actualSha256: 'a'.repeat(64) }), /revision/i);
  assert.throws(() => validateGeneratedAsset(asset, { expectedRevision: 3, actualSha256: 'b'.repeat(64) }), /hash/i);
});
