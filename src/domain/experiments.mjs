export function recommendExperiment({ experiment, observations, now }) {
  const inconclusive = (reason, evidenceIds = []) => ({ decision: 'inconclusive', reasons: [reason], evidenceIds, policyVersion: experiment?.policy?.version ?? null });
  if (!experiment || typeof experiment !== 'object' || !Array.isArray(observations) || !validDate(now)) return inconclusive('invalid_input');
  const policy = experiment.policy;
  if (!policy || policy.approved !== true || !text(policy.version) || !finite(policy.killBelow) || !finite(policy.keepAtOrAbove) || policy.killBelow < 0 || policy.keepAtOrAbove > 1 || policy.killBelow > policy.keepAtOrAbove) return inconclusive('policy_unconfigured');
  if (!text(experiment.appId) || !text(experiment.changedVariable) || !text(experiment.baseline) || !text(experiment.variant) || experiment.baseline === experiment.variant || !text(experiment.primaryMetric) || !Number.isSafeInteger(experiment.minExposure) || experiment.minExposure < 0 || !finite(experiment.minOutcomeCoverage) || experiment.minOutcomeCoverage < 0 || experiment.minOutcomeCoverage > 1) return inconclusive('invalid_experiment');
  let window;
  try { window = dateWindow(experiment.window); } catch { return inconclusive('invalid_window'); }
  const allIds = observations.map(o => o?.evidenceId).filter(text);
  if (now.slice(0, 10) <= window.end) return inconclusive('window_immature', allIds);
  if (!Number.isFinite(policy.maxSourceAgeMs) || policy.maxSourceAgeMs < 0) return inconclusive('policy_unconfigured', allIds);
  const relevant = observations.filter(o => o?.metric === undefined || o.metric === experiment.primaryMetric);
  if (!relevant.length || relevant.some(o => !o || o.windowStart !== window.start || o.windowEnd !== window.end)) return inconclusive('missing_attribution_or_window_mismatch', allIds);
  if (relevant.some(o => !validDate(o.observedAt) || Date.parse(now) - Date.parse(o.observedAt) > policy.maxSourceAgeMs)) return inconclusive('stale_source', allIds);
  if (relevant.some(o => !Number.isSafeInteger(o.exposure) || o.exposure < 0 || !Number.isSafeInteger(o.outcome) || o.outcome < 0 || !finite(o.coverage) || o.coverage < 0 || o.coverage > 1)) return inconclusive('invalid_observation', allIds);
  const byCell = new Map(relevant.map(o => [o.cell, o]));
  const baseline = byCell.get(experiment.baseline), variant = byCell.get(experiment.variant);
  if (!baseline || !variant) return inconclusive('missing_attribution', allIds);
  if (baseline.exposure < experiment.minExposure || variant.exposure < experiment.minExposure || baseline.coverage < experiment.minOutcomeCoverage || variant.coverage < experiment.minOutcomeCoverage) return inconclusive('underpowered_or_incomplete', allIds);
  const baselineRate = baseline.outcome / baseline.exposure, variantRate = variant.outcome / variant.exposure;
  let decision = 'inconclusive', reason = 'evidence_does_not_meet_configured_rule';
  if (variantRate < policy.killBelow) { decision = 'kill'; reason = 'variant_below_configured_floor'; }
  else if (variantRate >= policy.keepAtOrAbove) { decision = 'keep'; reason = 'variant_met_configured_target'; }
  else if (policy.iterateWhenMixed === true && variantRate !== baselineRate) { decision = 'iterate'; reason = 'adequate_evidence_is_mixed'; }
  return { decision, reasons: [reason], evidenceIds: [...new Set(allIds)], policyVersion: policy.version };
}

const text = v => typeof v === 'string' && v.trim().length > 0;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const validDate = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
function dateWindow(w) {
  if (!w || !dateOnly(w.start) || !dateOnly(w.end) || w.start > w.end) throw new TypeError('invalid window');
  return { start: w.start, end: w.end };
}
const dateOnly = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
