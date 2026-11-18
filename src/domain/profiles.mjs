const FIELDS = ['cta', 'channel', 'claims', 'rights', 'qualifiedEvent', 'paidEvent', 'privacyPolicy'];

export function validateAppProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !text(profile.appId) || !text(profile.name)) throw new TypeError('App profile requires appId and name');
  if (!profile.brand || typeof profile.brand !== 'object' || Array.isArray(profile.brand)) throw new TypeError('Brand configuration is required');
  if (profile.brand.promise && (!profile.brand.source || !text(profile.brand.source.locator) || profile.brand.source.version !== 'aa65fe1984a785d0a303ded594faba0dd0dbd42e')) throw new TypeError('Sourced brand promise requires exact approved source version');
  if (!profile.configuration || typeof profile.configuration !== 'object' || Array.isArray(profile.configuration)) throw new TypeError('configuration is required');
  for (const field of FIELDS) {
    const item = profile.configuration[field];
    if (!item || typeof item !== 'object' || Array.isArray(item) || !['unconfigured', 'pending', 'approved', 'rejected'].includes(item.status)) throw new TypeError(`${field} status is invalid`);
    if (item.status === 'unconfigured' && item.value !== null) throw new TypeError(`${field} unconfigured value must be null`);
    if (item.status === 'approved' && (!(field === 'channel' ? validChannelValue(item.value) : text(item.value)) || !text(item.evidenceRef) || !text(item.reviewer) || !validDate(item.reviewedAt))) throw new TypeError(`${field} approval requires nonempty scalar value, evidence, reviewer and valid reviewedAt`);
    if (item.status !== 'unconfigured' && item.value !== null && typeof item.value !== 'string' && typeof item.value !== 'object') throw new TypeError(`${field} value is invalid`);
    if (field === 'channel' && item.value !== null) {
      const ids = Array.isArray(item.value) ? item.value : typeof item.value === 'string' ? [item.value] : item.value?.integrationIds ?? (item.value?.integrationId ? [item.value.integrationId] : null);
      if (!ids || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) || new Set(ids).size !== ids.length) throw new TypeError('channel integration IDs are invalid');
    }
  }
  return true;
}

const text = v => typeof v === 'string' && v.trim().length > 0;
const validChannelValue = value => { const ids = Array.isArray(value) ? value : typeof value === 'string' ? [value] : value?.integrationIds ?? (value?.integrationId ? [value.integrationId] : []); return ids.length > 0 && ids.length <= 100 && ids.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)) && new Set(ids).size === ids.length; };
const validDate = v => text(v) && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) && validCalendarDate(v.slice(0, 10)) && Number.isFinite(Date.parse(v));
const validCalendarDate = v => { const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; };
