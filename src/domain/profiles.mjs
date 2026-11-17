const FIELDS = ['cta', 'channel', 'claims', 'rights', 'qualifiedEvent', 'paidEvent', 'privacyPolicy'];

export function validateAppProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !text(profile.appId) || !text(profile.name)) throw new TypeError('App profile requires appId and name');
  if (!profile.brand || typeof profile.brand !== 'object') throw new TypeError('Brand configuration is required');
  if (profile.brand.promise && (!profile.brand.source || !text(profile.brand.source.locator) || !text(profile.brand.source.version))) throw new TypeError('Sourced brand promise requires source locator and version');
  if (!profile.configuration || typeof profile.configuration !== 'object') throw new TypeError('configuration is required');
  for (const field of FIELDS) {
    const item = profile.configuration[field];
    if (!item || !['unconfigured', 'pending', 'approved', 'rejected'].includes(item.status)) throw new TypeError(`${field} status is invalid`);
    if (item.status === 'unconfigured' && item.value !== null) throw new TypeError(`${field} unconfigured value must be null`);
    if (item.status === 'approved' && (item.value === null || !text(item.evidenceRef) || !text(item.reviewer) || !validDate(item.reviewedAt))) throw new TypeError(`${field} approval requires value, evidence, reviewer and valid reviewedAt`);
    if (item.status !== 'unconfigured' && item.value !== null && typeof item.value !== 'string' && typeof item.value !== 'object') throw new TypeError(`${field} value is invalid`);
  }
  return true;
}

const text = v => typeof v === 'string' && v.trim().length > 0;
const validDate = v => text(v) && Number.isFinite(Date.parse(v));
