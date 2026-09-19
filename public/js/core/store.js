// ==========================================================================
//  حالة التطبيق المشتركة (المستخدم، القوائم المرجعية، المنشأة النشطة).
// ==========================================================================
import { api, qs } from './api.js';
import { sarSvg } from './icons.js';

const LS_ISSUER = 'zs.active_issuer';

export const store = {
  user: null,
  meta: null,
  issuers: [],
  clients: [],
  items: [],
  categories: [],
  activeIssuerId: localStorage.getItem(LS_ISSUER) || '',
  loaded: { clients: false, items: false, categories: false, issuers: false },
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(store)); }

export function can(permission) {
  if (!store.user) return false;
  if (store.user.role === 'ADMIN') return true;
  const permissions = store.user.effective_permissions || [];
  if (permissions.includes('*') || permissions.includes(permission)) return true;
  const [resource, action] = permission.split('.');
  return action === 'write' && ['create', 'edit'].some((a) => permissions.includes(`${resource}.${a}`));
}

export function setActiveIssuer(id) {
  store.activeIssuerId = id || '';
  if (id) localStorage.setItem(LS_ISSUER, id);
  else localStorage.removeItem(LS_ISSUER);
  emit();
}

export function activeIssuer() {
  return store.issuers.find((i) => i.id === store.activeIssuerId) || null;
}

export async function loadMeta() {
  store.meta = (await api.get('/api/meta', { silent: true })) ?? {};
  return store.meta;
}

export async function loadSession() {
  try {
    store.user = await api.get('/api/auth/me', { silent: true });
    return store.user;
  } catch {
    store.user = null;
    return null;
  }
}

export async function loadIssuers(force = false) {
  if (store.loaded.issuers && !force) return store.issuers;
  const res = await api.get('/api/issuers');
  store.issuers = Array.isArray(res) ? res : (res?.data && Array.isArray(res.data) ? res.data : []);
  store.loaded.issuers = true;
  if (store.activeIssuerId && !store.issuers.some((i) => i.id === store.activeIssuerId)) {
    store.activeIssuerId = '';
    localStorage.removeItem(LS_ISSUER);
  }
  if (!store.activeIssuerId && store.issuers.length) {
    const firstActive = store.issuers.find((i) => i.is_active) || store.issuers[0];
    store.activeIssuerId = firstActive.id;
    localStorage.setItem(LS_ISSUER, firstActive.id);
  }
  emit();
  return store.issuers;
}

export async function loadClients(force = false) {
  if (store.loaded.clients && !force) return store.clients;
  const res = await api.get(qs('/api/clients', { active_only: true }));
  store.clients = Array.isArray(res) ? res : (res?.data && Array.isArray(res.data) ? res.data : []);
  store.loaded.clients = true;
  return store.clients;
}

export async function loadItems(force = false) {
  if (store.loaded.items && !force) return store.items;
  const res = await api.get(qs('/api/items', { active_only: true }));
  store.items = Array.isArray(res) ? res : (res?.data && Array.isArray(res.data) ? res.data : []);
  store.loaded.items = true;
  return store.items;
}

export async function loadCategories(force = false) {
  if (store.loaded.categories && !force) return store.categories;
  const res = await api.get('/api/categories');
  store.categories = Array.isArray(res) ? res : (res?.data && Array.isArray(res.data) ? res.data : []);
  store.loaded.categories = true;
  return store.categories;
}

export async function loadLookups(force = false) {
  await Promise.all([loadIssuers(force), loadClients(force), loadItems(force), loadCategories(force)]);
}

export function invalidate(key) {
  if (key) store.loaded[key] = false;
  else Object.keys(store.loaded).forEach((k) => { store.loaded[k] = false; });
}

export function clientName(id) {
  const c = store.clients.find((x) => x.id === id);
  return c ? c.name : '';
}

export function issuerName(id) {
  const i = store.issuers.find((x) => x.id === id);
  return i ? i.name_ar : '';
}

export function currency() {
  const iss = activeIssuer();
  return (iss && iss.currency) || 'SAR';
}

export const currencyLabel = () => {
  const c = currency();
  return c === 'SAR' ? 'ر.س' : c;
};

export const currencySymbol = (curr, opt = {}) => {
  const c = curr || currency();
  if (!c || c === 'SAR' || c === 'ر.س' || c === '﷼') {
    return sarSvg({ size: opt.size || 16, ...opt });
  }
  return c;
};

// ------------------------------------------------------------- حالة الفلاتر الثابتة
const filterStates = new Map();

export function getFilterState(key, defaults = {}) {
  try {
    const cached = filterStates.get(key) || JSON.parse(sessionStorage.getItem(`zs.filter.${key}`) || 'null');
    if (cached && typeof cached === 'object') {
      return { ...defaults, ...cached };
    }
  } catch { /* ignore */ }
  return { ...defaults };
}

export function setFilterState(key, state) {
  try {
    filterStates.set(key, state);
    sessionStorage.setItem(`zs.filter.${key}`, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function clearFilterState(key) {
  try {
    filterStates.delete(key);
    sessionStorage.removeItem(`zs.filter.${key}`);
  } catch { /* ignore */ }
}
