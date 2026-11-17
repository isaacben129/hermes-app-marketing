import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAppProfile } from '../src/domain/profiles.mjs';
import cherry from '../src/config/cherry.json' with { type: 'json' };

test('Cherry has sourced promise while an independent app cannot inherit approvals', () => {
  const runtimeCherry = { appId: cherry.appId, name: cherry.name, brand: cherry.brand, configuration: cherry.configuration }
  assert.equal(validateAppProfile(runtimeCherry), true)
  assert.equal(cherry.status, 'provisional')
  assert.equal(cherry.provisionalEventCandidates.every(item => item.status === 'candidate_unapproved'), true)
  assert.equal(cherry.brand.promise, 'Practice social situations. Start small. Get better over time.')
  const second = { ...runtimeCherry, appId: 'other', name: 'Other', brand: { promise: '' }, configuration: Object.fromEntries(Object.keys(cherry.configuration).map(key => [key, { value: null, status: 'unconfigured', evidenceRef: null, reviewer: null, reviewedAt: null }])) }
  assert.equal(validateAppProfile(second), true)
  assert.throws(() => validateAppProfile({ ...runtimeCherry, configuration: { ...cherry.configuration, cta: { value: 'Download', status: 'approved', evidenceRef: null, reviewer: null, reviewedAt: null } } }), /evidence|approval/i)
})

test('profile approvals require structured, nonempty values and valid review timestamps', () => {
  const runtimeCherry = { appId: cherry.appId, name: cherry.name, brand: cherry.brand, configuration: cherry.configuration }
  for (const value of ['', [], {}, ['yes']]) assert.throws(() => validateAppProfile({ ...runtimeCherry, configuration: { ...cherry.configuration, cta: { value, status: 'approved', evidenceRef: 'ref', reviewer: 'human', reviewedAt: '2026-11-16T00:00:00Z' } } }));
  for (const reviewedAt of [null, 123, {}, 'not-a-date', '2026-02-30T00:00:00Z']) assert.throws(() => validateAppProfile({ ...runtimeCherry, configuration: { ...cherry.configuration, cta: { value: 'Install', status: 'approved', evidenceRef: 'ref', reviewer: 'human', reviewedAt } } }));
  for (const source of ['004e00e8a14550cdd8947bef0d38a32cf186658a', 'aa65fe1984a785d0a303ded594faba0dd0dbd42e']) { const p = { ...runtimeCherry, brand: { ...runtimeCherry.brand, source: { ...runtimeCherry.brand.source, version: source } } }; if (source.startsWith('aa65')) assert.equal(validateAppProfile(p), true); }
});
