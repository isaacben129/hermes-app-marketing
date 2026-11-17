export const QUALITY_DIMENSIONS = Object.freeze([
  'audience fit', 'hook clarity', 'claim specificity/proof', 'slide progression/payoff',
  'mobile legibility/visual coherence', 'promise-to-destination match', 'safety/rights/brand',
]);

const HARD_CHECKS = Object.freeze(['fontBelowFloor', 'overflow', 'missingImage', 'missingFont', 'unsupportedClaim', 'unknownRights', 'restrictedRights', 'unapprovedCta', 'destinationMismatch']);

export function evaluateQuality({ revision, dimensions = QUALITY_DIMENSIONS, reviews = [], automatedChecks = {} }) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('revision must be a non-negative safe integer');
  if (!Array.isArray(dimensions) || dimensions.length !== QUALITY_DIMENSIONS.length || dimensions.some((d, i) => d !== QUALITY_DIMENSIONS[i])) throw new TypeError('dimensions must contain the exact quality rubric');
  if (!Array.isArray(reviews)) throw new TypeError('reviews must be an array');
  if (!automatedChecks || typeof automatedChecks !== 'object' || Array.isArray(automatedChecks)) throw new TypeError('automatedChecks must be an object');
  const byDimension = new Map();
  for (const review of reviews) {
    if (!review || !QUALITY_DIMENSIONS.includes(review.dimension) || byDimension.has(review.dimension)) throw new TypeError('review dimension is invalid or duplicated');
    if (!review.reviewer || !['human', 'automated'].includes(review.reviewer.type) || typeof review.reviewer.name !== 'string' || !review.reviewer.name.trim()) throw new TypeError('reviewer type and name are required');
    if (review.score !== null && (!Number.isInteger(review.score) || review.score < 0 || review.score > 5)) throw new TypeError('score must be an integer from 0 to 5 or null');
    if (review.score !== null && (!text(review.rationale) || !Array.isArray(review.evidenceRefs) || !review.evidenceRefs.length || review.evidenceRefs.some(ref => !text(ref)))) throw new TypeError('scored reviews require rationale and evidence refs');
    byDimension.set(review.dimension, { score: review.score, reviewer: review.reviewer, evidenceRefs: review.evidenceRefs ?? [], rationale: review.rationale ?? '' });
  }
  const hardBlockers = HARD_CHECKS.filter(key => automatedChecks[key] === true);
  const assessed = QUALITY_DIMENSIONS.map(dimension => ({ dimension, ...(byDimension.get(dimension) ?? { score: null, reviewer: null, evidenceRefs: [], rationale: '' }) }));
  return { rubricVersion: 1, revision, dimensions: assessed, hardBlockers, assessment: hardBlockers.length ? 'blocked' : assessed.every(d => d.score !== null) ? 'reviewed' : 'inconclusive' };
}

const text = value => typeof value === 'string' && value.trim().length > 0;
