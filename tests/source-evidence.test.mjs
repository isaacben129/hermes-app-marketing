import assert from 'node:assert/strict';
import test from 'node:test';
import sourceEvidence from '../src/domain/source-evidence.cjs';

const { evaluateCreativeReadiness, validateEvidenceRecord } = sourceEvidence;

const validEvidence = (overrides = {}) => ({
  id: 'evidence-1',
  provenance: {
    origin: 'user-provided',
    locator: 'asset://evidence-1',
    capturedAt: '2026-11-12T09:00:00.000Z',
  },
  rights: {
    status: 'cleared',
    attestation: {
      decision: 'cleared',
      attesterType: 'human',
      attestedBy: 'reviewer-1',
      attestedAt: '2026-11-12T09:30:00.000Z',
      basis: 'documented permission',
      scope: 'in-product use',
    },
  },
  ...overrides,
});

const validClaim = (overrides = {}) => ({
  id: 'claim-1',
  classification: 'fact',
  evidenceIds: ['evidence-1'],
  ...overrides,
});

const codes = (result) => result.blockers.map(({ code }) => code);

test('evidence records require a provenance origin, locator, and valid capture time', () => {
  const record = validEvidence({ provenance: { origin: 'user-provided', locator: '' } });

  assert.deepEqual(
    validateEvidenceRecord(record).map(({ code }) => code),
    ['missing_provenance_locator', 'invalid_provenance_timestamp'],
  );
});

test('provenance timestamps reject impossible calendar dates', () => {
  const record = validEvidence({
    provenance: {
      origin: 'user-provided',
      locator: 'asset://evidence-1',
      capturedAt: '2026-02-30T09:00:00.000Z',
    },
  });

  assert.ok(validateEvidenceRecord(record).some(({ code }) => code === 'invalid_provenance_timestamp'));
});

test('unknown rights block readiness even when the evidence is otherwise complete', () => {
  const result = evaluateCreativeReadiness({
    evidence: [validEvidence({ rights: { status: 'unknown' } })],
    claims: [validClaim()],
  });

  assert.equal(result.ready, false);
  assert.ok(codes(result).includes('rights_unknown'));
});

test('cleared rights require a human attestation with identity, time, basis, and scope', () => {
  const result = evaluateCreativeReadiness({
    evidence: [validEvidence({ rights: { status: 'cleared' } })],
    claims: [validClaim()],
  });

  assert.equal(result.ready, false);
  assert.ok(codes(result).includes('rights_attestation_missing'));
});

test('non-human attestation cannot clear rights', () => {
  const evidence = validEvidence({
    rights: {
      status: 'cleared',
      attestation: {
        decision: 'cleared',
        attesterType: 'automation',
        attestedBy: 'automated-review',
        attestedAt: '2026-11-12T09:30:00.000Z',
        basis: 'documented permission',
        scope: 'in-product use',
      },
    },
  });
  const result = evaluateCreativeReadiness({ evidence: [evidence], claims: [validClaim()] });

  assert.equal(result.ready, false);
  assert.ok(codes(result).includes('invalid_rights_attestation'));
});

test('readiness accepts documented rights and evidence-linked facts while preserving hypotheses as hypotheses', () => {
  const result = evaluateCreativeReadiness({
    evidence: [validEvidence()],
    claims: [
      validClaim({ id: 'claim-fact' }),
      { id: 'claim-hypothesis', classification: 'hypothesis', evidenceIds: [] },
    ],
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.claimAssessments, [
    { claimId: 'claim-fact', classification: 'fact', evidenceIds: ['evidence-1'], assessment: 'supported_fact' },
    { claimId: 'claim-hypothesis', classification: 'hypothesis', evidenceIds: [], assessment: 'hypothesis' },
  ]);
});

test('facts without evidence and claim records with unknown classifications block readiness', () => {
  const result = evaluateCreativeReadiness({
    evidence: [validEvidence()],
    claims: [
      { id: 'claim-without-evidence', classification: 'fact', evidenceIds: [] },
      { id: 'claim-without-classification', evidenceIds: [] },
    ],
  });

  assert.equal(result.ready, false);
  assert.ok(codes(result).includes('fact_without_evidence'));
  assert.ok(codes(result).includes('claim_classification_unknown'));
});

test('unresolved evidence pointers and duplicate source IDs block readiness', () => {
  const result = evaluateCreativeReadiness({
    evidence: [validEvidence(), validEvidence()],
    claims: [validClaim({ evidenceIds: ['missing-evidence'] })],
  });

  assert.equal(result.ready, false);
  assert.ok(codes(result).includes('duplicate_evidence_id'));
  assert.ok(codes(result).includes('evidence_pointer_unresolved'));
});

test('restricted rights and malformed input fail closed', () => {
  const restricted = evaluateCreativeReadiness({
    evidence: [validEvidence({ rights: { status: 'restricted' } })],
    claims: [validClaim()],
  });
  const malformed = evaluateCreativeReadiness(null);

  assert.ok(codes(restricted).includes('rights_restricted'));
  assert.equal(malformed.ready, false);
  assert.ok(codes(malformed).includes('invalid_input'));
});
