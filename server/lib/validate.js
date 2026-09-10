'use strict';
/** أدوات التحقق من المدخلات وأخطاء الـ API. */

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || null;
  }
}

const bad = (msg, details) => new ApiError(400, msg, details);
const notFound = (msg = 'العنصر غير موجود') => new ApiError(404, msg);
const conflict = (msg, details) => new ApiError(409, msg, details);
const unauthorized = (msg = 'الجلسة غير صالحة، يرجى تسجيل الدخول') => new ApiError(401, msg);
const forbidden = (msg = 'لا تملك صلاحية تنفيذ هذه العملية') => new ApiError(403, msg);

function str(value, field, { required = false, max = 500, min = 0, trim = true } = {}) {
  let v = value === null || value === undefined ? '' : String(value);
  if (trim) v = v.trim();
  if (!v) {
    if (required) throw bad(`الحقل «${field}» مطلوب`);
    return '';
  }
  if (v.length > max) throw bad(`الحقل «${field}» أطول من الحد المسموح (${max})`);
  if (v.length < min) throw bad(`الحقل «${field}» أقصر من الحد المسموح (${min})`);
  return v;
}

function num(value, field, { required = false, min = -1e15, max = 1e15, def = 0 } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw bad(`الحقل «${field}» مطلوب`);
    return def;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`الحقل «${field}» يجب أن يكون رقماً`);
  if (n < min || n > max) throw bad(`الحقل «${field}» يجب أن يكون بين ${min} و ${max}`);
  return n;
}

function int(value, field, opts = {}) {
  const n = num(value, field, opts);
  return Math.trunc(n);
}

function bool(value, def = false) {
  if (value === null || value === undefined || value === '') return def;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function oneOf(value, field, allowed, def) {
  const v = value === null || value === undefined || value === '' ? def : String(value);
  if (!allowed.includes(v)) throw bad(`الحقل «${field}» يجب أن يكون أحد: ${allowed.join(', ')}`);
  return v;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function date(value, field, { required = false, def = null } = {}) {
  const v = str(value, field, { required, max: 10 });
  if (!v) return def;
  if (!DATE_RE.test(v)) throw bad(`الحقل «${field}» يجب أن يكون بصيغة YYYY-MM-DD`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw bad(`التاريخ في «${field}» غير صالح`);
  return v;
}

function time(value, field, { required = false, def = null } = {}) {
  const v = str(value, field, { required, max: 8 });
  if (!v) return def;
  if (!TIME_RE.test(v)) throw bad(`الحقل «${field}» يجب أن يكون بصيغة HH:MM:SS`);
  return v.length === 5 ? `${v}:00` : v;
}

function arr(value, field, { required = false, max = 5000 } = {}) {
  if (value === null || value === undefined) {
    if (required) throw bad(`الحقل «${field}» مطلوب`);
    return [];
  }
  if (!Array.isArray(value)) throw bad(`الحقل «${field}» يجب أن يكون قائمة`);
  if (value.length > max) throw bad(`الحقل «${field}» يتجاوز ${max} عنصر`);
  return value;
}

/** التحقق من صيغة الرقم الضريبي السعودي: 15 رقماً يبدأ وينتهي بـ 3. */
function vatNumber(value, field = 'الرقم الضريبي', { required = false } = {}) {
  const v = str(value, field, { required, max: 20 });
  if (!v) return '';
  if (!/^\d{15}$/.test(v)) throw bad('الرقم الضريبي يجب أن يكون 15 رقماً');
  if (!v.startsWith('3') || !v.endsWith('3')) {
    throw bad('الرقم الضريبي السعودي يجب أن يبدأ وينتهي بالرقم 3');
  }
  return v;
}

module.exports = {
  ApiError, bad, notFound, conflict, unauthorized, forbidden,
  str, num, int, bool, oneOf, date, time, arr, vatNumber,
};
