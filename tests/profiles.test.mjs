import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAppProfile } from '../src/domain/profiles.mjs';
import cherry from '../src/config/cherry.json' with { type: 'json' };

test('Cherry has sourced promise while an independent app cannot inherit approvals', () => {
  assert.equal(validateAppProfile(cherry), true);
  assert.equal(cherry.brand.promise, 'Practice social situations. Start small. Get better over time.');
  const second = { ...cherry, appId: 'other', name: 'Other', brand: { promise: '' }, configuration: Object.fromEntries(Object.keys(cherry.configuration).map(key => [key, { value: null, status: 'unconfigured', evidenceRef: null, reviewer: null, reviewedAt: null }])) };
  assert.equal(validateAppProfile(second), true);
  assert.throws(() => validateAppProfile({ ...cherry, configuration: { ...cherry.configuration, cta: { value: 'Download', status: 'approved', evidenceRef: null, reviewer: null, reviewedAt: null } } }), /evidence|approval/i);
});
