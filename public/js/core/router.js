// ==========================================================================
//  موجّه بسيط يعتمد على hash: #/route/param
// ==========================================================================

const routes = new Map();
let notFoundHandler = null;
let currentDestroy = null;

export function route(name, handler) {
  routes.set(name, handler);
}

export function setNotFound(handler) { notFoundHandler = handler; }

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { name: parts[0] || 'dashboard', params: parts.slice(1), query };
}

export function go(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#/${path.replace(/^\/+/, '')}`;
  if (location.hash === target) {
    render();
    return;
  }
  if (replace) location.replace(target);
  else location.hash = target;
}

export async function render() {
  const { name, params, query } = parseHash();
  const handler = routes.get(name) || notFoundHandler;
  if (!handler) return;
  if (typeof currentDestroy === 'function') {
    try { currentDestroy(); } catch { /* ignore */ }
    currentDestroy = null;
  }
  const result = await handler({ params, query, name });
  if (typeof result === 'function') currentDestroy = result;
  window.scrollTo({ top: 0 });
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}

export const currentRoute = () => parseHash().name;
