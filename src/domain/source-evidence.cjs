'use strict';

const RIGHTS_STATUSES = Object.freeze(['unknown', 'pending', 'cleared', 'restricted']);
const CLAIM_CLASSIFICATIONS = Object.freeze(['fact', 'hypothesis']);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    return false;
  }

  const [datePart, timePart] = value.split('T');
  const calendarDate = new Date(`${datePart}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) {
    return false;
  }

  const [clock] = timePart.split(/[Z+-]/);
  const [hours, minutes, seconds] = clock.split(':');
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) >= 60) return false;

  return true;
}

function issue(code, details = {}) {
  return { code, ...details };
}

function validateEvidenceRecord(record) {
  const issues = [];
  if (!isRecord(record)) return [issue('invalid_evidence_record')];

  if (!hasText(record.id)) issues.push(issue('missing_evidence_id'));

  if (!isRecord(record.provenance)) {
    issues.push(issue('missing_provenance'));
  } else {
    if (!hasText(record.provenance.origin)) issues.push(issue('missing_provenance_origin'));
    if (!hasText(record.provenance.locator)) issues.push(issue('missing_provenance_locator'));
    if (!isTimestamp(record.provenance.capturedAt)) {
      issues.push(issue('invalid_provenance_timestamp'));
    }
  }

  if (!isRecord(record.rights)) {
    issues.push(issue('missing_rights_record'));
    return issues;
  }

  const { status, attestation } = record.rights;
  if (!hasText(status)) {
    issues.push(issue('missing_rights_status'));
  } else if (!RIGHTS_STATUSES.includes(status)) {
    issues.push(issue('invalid_rights_status'));
  } else if (status === 'cleared') {
    if (!isRecord(attestation)) {
      issues.push(issue('rights_attestation_missing'));
    } else if (
      attestation.decision !== 'cleared'
      || attestation.attesterType !== 'human'
      || !hasText(attestation.attestedBy)
      || !isTimestamp(attestation.attestedAt)
      || !hasText(attestation.basis)
      || !hasText(attestation.scope)
    ) {
      issues.push(issue('invalid_rights_attestation'));
    }
  }

  return issues;
}

function evaluateCreativeReadiness(input) {
  const blockers = [];
  const claimAssessments = [];

  if (!isRecord(input)) {
    return { ready: false, blockers: [issue('invalid_input')], claimAssessments };
  }

  if (!Array.isArray(input.evidence)) {
    blockers.push(issue('invalid_evidence_collection'));
  } else if (input.evidence.length === 0) {
    blockers.push(issue('missing_evidence'));
  }

  if (!Array.isArray(input.claims)) blockers.push(issue('invalid_claim_collection'));

  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const claims = Array.isArray(input.claims) ? input.claims : [];
  const evidenceById = new Map();
  const duplicateEvidenceIds = new Set();
  const validEvidenceIds = new Set();

  for (const record of evidence) {
    const evidenceId = isRecord(record) && hasText(record.id) ? record.id : undefined;
    const recordIssues = validateEvidenceRecord(record);
    for (const validationIssue of recordIssues) {
      blockers.push(issue(validationIssue.code, evidenceId ? { evidenceId } : {}));
    }

    if (evidenceId) {
      if (evidenceById.has(evidenceId)) {
        duplicateEvidenceIds.add(evidenceId);
        blockers.push(issue('duplicate_evidence_id', { evidenceId }));
      } else {
        evidenceById.set(evidenceId, record);
      }
      if (recordIssues.length === 0) validEvidenceIds.add(evidenceId);
    }

    const rightsStatus = isRecord(record) && isRecord(record.rights)
      ? record.rights.status
      : undefined;
    if (rightsStatus === 'unknown') blockers.push(issue('rights_unknown', evidenceId ? { evidenceId } : {}));
    if (rightsStatus === 'pending') blockers.push(issue('rights_pending', evidenceId ? { evidenceId } : {}));
    if (rightsStatus === 'restricted') blockers.push(issue('rights_restricted', evidenceId ? { evidenceId } : {}));
  }

  const seenClaimIds = new Set();
  for (const claim of claims) {
    if (!isRecord(claim)) {
      blockers.push(issue('invalid_claim_record'));
      continue;
    }

    const claimId = hasText(claim.id) ? claim.id : undefined;
    if (!claimId) blockers.push(issue('missing_claim_id'));
    else if (seenClaimIds.has(claimId)) blockers.push(issue('duplicate_claim_id', { claimId }));
    else seenClaimIds.add(claimId);

    const classification = claim.classification;
    const knownClassification = CLAIM_CLASSIFICATIONS.includes(classification);
    if (!knownClassification) {
      blockers.push(issue('claim_classification_unknown', claimId ? { claimId } : {}));
    }

    const evidenceIds = Array.isArray(claim.evidenceIds) ? claim.evidenceIds : [];
    if (!Array.isArray(claim.evidenceIds)) {
      blockers.push(issue('invalid_claim_evidence_ids', claimId ? { claimId } : {}));
    }
    if (classification === 'fact' && evidenceIds.length === 0) {
      blockers.push(issue('fact_without_evidence', claimId ? { claimId } : {}));
    }

    let allPointersResolve = evidenceIds.length > 0;
    for (const evidenceId of evidenceIds) {
      if (!hasText(evidenceId)) {
        allPointersResolve = false;
        blockers.push(issue('invalid_evidence_pointer', claimId ? { claimId } : {}));
      } else if (!evidenceById.has(evidenceId) || duplicateEvidenceIds.has(evidenceId)) {
        allPointersResolve = false;
        blockers.push(issue('evidence_pointer_unresolved', { ...(claimId ? { claimId } : {}), evidenceId }));
      }
    }

    if (classification === 'fact' && evidenceIds.length > 0 && allPointersResolve) {
      const hasInvalidEvidence = evidenceIds.some((id) => !validEvidenceIds.has(id));
      if (hasInvalidEvidence) {
        allPointersResolve = false;
        blockers.push(issue('fact_evidence_invalid', claimId ? { claimId } : {}));
      }
    }

    if (claimId && knownClassification) {
      const assessment = classification === 'hypothesis'
        ? 'hypothesis'
        : allPointersResolve ? 'supported_fact' : 'unsupported_fact';
      claimAssessments.push({
        claimId,
        classification,
        evidenceIds: evidenceIds.filter(hasText),
        assessment,
      });
    }
  }

  return { ready: blockers.length === 0, blockers, claimAssessments };
}

module.exports = {
  CLAIM_CLASSIFICATIONS,
  RIGHTS_STATUSES,
  evaluateCreativeReadiness,
  validateEvidenceRecord,
};
