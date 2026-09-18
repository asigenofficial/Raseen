// ==========================================================================
//  طبقة الاتصال مع الـ API.
// ==========================================================================
import { toastErr } from './util.js';

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, body, { silent = false, rawText = false } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (!silent) toastErr('تعذر الاتصال بالخادم');
    throw new ApiError(0, 'تعذر الاتصال بالخادم');
  }

  if (res.status === 401 && onUnauthorized) onUnauthorized();

  if (rawText) {
    const text = await res.text();
    if (!res.ok) {
      if (!silent) toastErr('فشل الطلب');
      throw new ApiError(res.status, 'فشل الطلب');
    }
    return text;
  }

  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }

  if (!res.ok || (payload && payload.ok === false)) {
    const message = (payload && payload.error) || `فشل الطلب (${res.status})`;
    if (!silent) toastErr(message);
    throw new ApiError(res.status, message, payload && payload.details);
  }
  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

/** بناء مسار مع بارامترات استعلام (يتجاهل الفراغات). */
export function qs(path, params = {}) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false) return;
    usp.append(k, v === true ? '1' : String(v));
  });
  const s = usp.toString();
  return s ? `${path}?${s}` : path;
}

export const api = {
  get: (path, opts) => request('GET', path, null, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  del: (path, opts) => request('DELETE', path, null, opts),
  delete: (path, opts) => request('DELETE', path, null, opts),
  text: (path) => request('GET', path, null, { rawText: true }),
  ApiError,
};

export { ApiError };
