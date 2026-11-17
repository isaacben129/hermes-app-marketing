export function validateGeneratedAsset(input, { expectedRevision, actualSha256 } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Generated asset must be an object');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || input.revision !== expectedRevision) throw new TypeError('Generated asset revision does not match expected revision');
  for (const field of ['draftId', 'prompt', 'provider', 'model', 'requestId', 'sourceRef']) if (!text(input[field])) throw new TypeError(`${field} is required`);
  if (!validDate(input.generatedAt)) throw new TypeError('generatedAt must be a valid date');
  if (!sha(input.imageSha256) || !sha(actualSha256) || input.imageSha256.toLowerCase() !== actualSha256.toLowerCase()) throw new TypeError('image hash does not match actual bytes');
  if (input.humanUseApproval !== 'pending') throw new TypeError('humanUseApproval must remain pending');
  return {
    draftId: input.draftId, revision: input.revision, prompt: input.prompt,
    provenance: { provider: input.provider, model: input.model, requestId: input.requestId, generatedAt: input.generatedAt, imageSha256: input.imageSha256.toLowerCase(), sourceRef: input.sourceRef },
    humanUseApproval: 'pending', fixtureOnly: true, useStatus: 'review-required',
    rightsStatus: 'unknown', claimsStatus: 'unreviewed', distributionStatus: 'blocked',
  };
}

const text = v => typeof v === 'string' && v.trim().length > 0;
const validDate = v => text(v) && Number.isFinite(Date.parse(v));
const sha = v => typeof v === 'string' && /^[a-f\d]{64}$/i.test(v);
