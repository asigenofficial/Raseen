'use strict';
/**
 * المستخدمون والجلسات والصلاحيات (RBAC).
 * الجلسة تُخزَّن في قاعدة البيانات ويُرسل رمزها في كوكي HttpOnly.
 */
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { uuid, token } = require('../lib/ids');
const { hashPassword, verifyPassword } = require('../lib/crypto');
const V = require('../lib/validate');

function hashToken(rawToken) {
  if (!rawToken) return '';
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

// ------------------------------------------------------------- محدد محاولات الدخول
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 دقيقة
const MAX_LOGIN_ATTEMPTS = 5;

function checkRateLimit(username, ip) {
  const key = `${String(username || '').trim().toLowerCase()}::${ip || ''}`;
  const entry = loginAttempts.get(key);
  if (!entry) return;
  const now = Date.now();
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(key);
    return;
  }
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    const remainingMin = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.firstAttempt)) / 60000));
    throw new V.ApiError(429, `تم تجاوز الحد الأقصى لمحاولات الدخول (5 محاولات). يرجى المحاولة بعد ${remainingMin} دقيقة`);
  }
}

function recordFailedAttempt(username, ip) {
  const key = `${String(username || '').trim().toLowerCase()}::${ip || ''}`;
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, firstAttempt: now };
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.firstAttempt = now;
  } else {
    entry.count += 1;
  }
  loginAttempts.set(key, entry);
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    db.audit({
      user: username || 'unknown',
      action: 'LOGIN_RATE_LIMITED',
      entityType: 'security',
      details: { attempts: entry.count, window_minutes: 15 },
      ip: ip || '',
    });
  }
}

function clearRateLimit(username, ip) {
  const key = `${String(username || '').trim().toLowerCase()}::${ip || ''}`;
  loginAttempts.delete(key);
}

const PERMISSIONS = [
  'issuers.view', 'issuers.write',
  'clients.view', 'clients.write',
  'items.view', 'items.write',
  'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.backdate',
  'bulk.generate',
  'vouchers.view', 'vouchers.create', 'vouchers.delete',
  'reports.view', 'ledger.view',
  'audit.view', 'users.manage', 'settings.write',
];

const ROLE_PERMISSIONS = {
  ADMIN: PERMISSIONS.slice(),
  ACCOUNTANT: [
    'issuers.view', 'clients.view', 'clients.write', 'items.view', 'items.write',
    'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.backdate',
    'bulk.generate', 'vouchers.view', 'vouchers.create',
    'reports.view', 'ledger.view',
  ],
  VIEWER: ['issuers.view', 'clients.view', 'items.view', 'invoices.view', 'vouchers.view', 'reports.view', 'ledger.view'],
};

const ROLE_LABELS = {
  ADMIN: 'مدير النظام',
  ACCOUNTANT: 'محاسب',
  VIEWER: 'مستعرض',
};

/** أسماء عربية للصلاحيات (تُستخدم في شاشة المستخدمين). */
const PERMISSION_LABELS = {
  'issuers.view': 'عرض الشركات المصدرة',
  'issuers.write': 'إضافة وتعديل الشركات المصدرة',
  'clients.view': 'عرض العملاء',
  'clients.write': 'إضافة وتعديل العملاء',
  'items.view': 'عرض الأصناف والمجموعات',
  'items.write': 'إضافة وتعديل الأصناف والمجموعات',
  'invoices.view': 'عرض الفواتير',
  'invoices.create': 'إصدار الفواتير',
  'invoices.edit': 'تعديل وإلغاء الفواتير',
  'invoices.delete': 'حذف الفواتير نهائياً',
  'invoices.backdate': 'إصدار فاتورة بتاريخ سابق',
  'bulk.generate': 'التوليد الدفعي للفواتير',
  'vouchers.view': 'عرض سندات القبض',
  'vouchers.create': 'تسجيل وإلغاء سندات القبض',
  'vouchers.delete': 'حذف سندات القبض',
  'reports.view': 'عرض التقارير وتصديرها',
  'ledger.view': 'عرض كشوف الحساب',
  'audit.view': 'عرض سجل العمليات',
  'users.manage': 'إدارة المستخدمين والصلاحيات',
  'settings.write': 'تعديل إعدادات النظام',
};

function effectivePermissions(user) {
  const base = ROLE_PERMISSIONS[user.role] || [];
  let extra = [];
  try { extra = JSON.parse(user.permissions || '[]'); } catch { extra = []; }
  return Array.from(new Set([...base, ...extra.filter((p) => PERMISSIONS.includes(p))]));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    role_label: ROLE_LABELS[user.role] || user.role,
    is_active: !!user.is_active,
    permissions: effectivePermissions(user),
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

function ensureBootstrapAdmin() {
  const count = db.pluck('SELECT COUNT(*) AS c FROM users');
  if (count > 0) return null;
  const { username, password, fullName } = config.bootstrapAdmin;
  const { salt, hash } = hashPassword(password);
  const id = uuid();
  db.run(
    `INSERT INTO users (id, username, full_name, password_hash, password_salt, role, permissions, is_active, created_at)
     VALUES (:id, :username, :full_name, :hash, :salt, 'ADMIN', '[]', 1, :created_at)`,
    { id, username, full_name: fullName, hash, salt, created_at: db.nowIso() },
  );
  return { username, password };
}

function findByUsername(username) {
  return db.get('SELECT * FROM users WHERE username = :u', { u: String(username || '').trim() });
}

function login(username, password, ip) {
  checkRateLimit(username, ip);
  const user = findByUsername(username);
  if (!user || !user.is_active) {
    recordFailedAttempt(username, ip);
    throw new V.ApiError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  if (!verifyPassword(password, user.password_salt, user.password_hash)) {
    recordFailedAttempt(username, ip);
    db.audit({ user: user.username, action: 'LOGIN_FAILED', entityType: 'user', entityId: user.id, ip });
    throw new V.ApiError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  clearRateLimit(username, ip);
  const t = token();
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000).toISOString();
  db.run(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, ip)
     VALUES (:token, :user_id, :created_at, :expires_at, :ip)`,
    { token: hashToken(t), user_id: user.id, created_at: db.nowIso(), expires_at: expires, ip: ip || '' },
  );
  db.run('UPDATE users SET last_login_at = :t WHERE id = :id', { t: db.nowIso(), id: user.id });
  db.audit({ user: user.username, action: 'LOGIN', entityType: 'user', entityId: user.id, ip });
  return { token: t, expires_at: expires, user: publicUser({ ...user, last_login_at: db.nowIso() }) };
}

function logout(sessionToken) {
  if (!sessionToken) return;
  db.run('DELETE FROM sessions WHERE token = :t', { t: hashToken(sessionToken) });
}

function userForToken(sessionToken) {
  if (!sessionToken) return null;
  const hashed = hashToken(sessionToken);
  const row = db.get(
    `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = :t`,
    { t: hashed },
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.run('DELETE FROM sessions WHERE token = :t', { t: hashed });
    return null;
  }
  if (!row.is_active) return null;
  return row;
}

function purgeExpiredSessions() {
  db.run('DELETE FROM sessions WHERE expires_at < :now', { now: db.nowIso() });
}

function can(user, permission) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  return effectivePermissions(user).includes(permission);
}

function requirePermission(user, permission) {
  if (!can(user, permission)) throw V.forbidden(`الصلاحية المطلوبة: ${permission}`);
}

// ------------------------------------------------------------- إدارة المستخدمين
function listUsers() {
  return db.all('SELECT * FROM users ORDER BY created_at').map(publicUser);
}

function createUser(payload, actor) {
  const username = V.str(payload.username, 'اسم المستخدم', { required: true, max: 40 });
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    throw V.bad('اسم المستخدم يجب أن يكون 3-40 حرفاً إنجليزياً/رقماً بدون مسافات');
  }
  if (findByUsername(username)) throw V.conflict('اسم المستخدم مستخدم مسبقاً');
  const password = V.str(payload.password, 'كلمة المرور', { required: true, max: 200, min: 8 });
  const role = V.oneOf(payload.role, 'الدور', ['ADMIN', 'ACCOUNTANT', 'VIEWER'], 'ACCOUNTANT');
  const perms = V.arr(payload.permissions, 'الصلاحيات').filter((p) => PERMISSIONS.includes(p));
  const { salt, hash } = hashPassword(password);
  const id = uuid();
  db.run(
    `INSERT INTO users (id, username, full_name, password_hash, password_salt, role, permissions, is_active, created_at)
     VALUES (:id, :username, :full_name, :hash, :salt, :role, :perms, :active, :created_at)`,
    {
      id,
      username,
      full_name: V.str(payload.full_name, 'الاسم الكامل', { max: 120 }) || username,
      hash,
      salt,
      role,
      perms: JSON.stringify(perms),
      active: V.bool(payload.is_active, true) ? 1 : 0,
      created_at: db.nowIso(),
    },
  );
  db.audit({ user: actor, action: 'USER_CREATE', entityType: 'user', entityId: id, details: { username, role } });
  return publicUser(db.get('SELECT * FROM users WHERE id = :id', { id }));
}

function updateUser(id, payload, actor) {
  const user = db.get('SELECT * FROM users WHERE id = :id', { id });
  if (!user) throw V.notFound('المستخدم غير موجود');
  const role = payload.role === undefined ? user.role : V.oneOf(payload.role, 'الدور', ['ADMIN', 'ACCOUNTANT', 'VIEWER'], user.role);
  const fullName = payload.full_name === undefined ? user.full_name : V.str(payload.full_name, 'الاسم الكامل', { max: 120 });
  const isActive = payload.is_active === undefined ? !!user.is_active : V.bool(payload.is_active, true);
  const perms = payload.permissions === undefined
    ? user.permissions
    : JSON.stringify(V.arr(payload.permissions, 'الصلاحيات').filter((p) => PERMISSIONS.includes(p)));

  // منع تعطيل آخر مدير نظام
  if ((!isActive || role !== 'ADMIN') && user.role === 'ADMIN') {
    const admins = db.pluck("SELECT COUNT(*) AS c FROM users WHERE role = 'ADMIN' AND is_active = 1 AND id <> :id", { id });
    if (admins === 0) throw V.bad('لا يمكن تعطيل أو تغيير دور آخر مدير نظام نشط');
  }

  let hash = user.password_hash;
  let salt = user.password_salt;
  if (payload.password) {
    const pw = V.str(payload.password, 'كلمة المرور', { required: true, min: 8, max: 200 });
    const h = hashPassword(pw);
    hash = h.hash;
    salt = h.salt;
    db.run('DELETE FROM sessions WHERE user_id = :id', { id });
  }
  db.run(
    `UPDATE users SET full_name = :full_name, role = :role, permissions = :perms, is_active = :active,
       password_hash = :hash, password_salt = :salt WHERE id = :id`,
    { id, full_name: fullName, role, perms, active: isActive ? 1 : 0, hash, salt },
  );
  db.audit({ user: actor, action: 'USER_UPDATE', entityType: 'user', entityId: id, details: { role, is_active: isActive } });
  return publicUser(db.get('SELECT * FROM users WHERE id = :id', { id }));
}

function deleteUser(id, actor) {
  const user = db.get('SELECT * FROM users WHERE id = :id', { id });
  if (!user) throw V.notFound('المستخدم غير موجود');
  if (user.role === 'ADMIN') {
    const admins = db.pluck("SELECT COUNT(*) AS c FROM users WHERE role = 'ADMIN' AND id <> :id", { id });
    if (admins === 0) throw V.bad('لا يمكن حذف آخر مدير نظام');
  }
  db.run('DELETE FROM users WHERE id = :id', { id });
  db.audit({ user: actor, action: 'USER_DELETE', entityType: 'user', entityId: id, details: { username: user.username } });
  return { ok: true };
}

function changeOwnPassword(user, currentPassword, newPassword) {
  const row = db.get('SELECT * FROM users WHERE id = :id', { id: user.id });
  if (!verifyPassword(currentPassword, row.password_salt, row.password_hash)) {
    throw V.bad('كلمة المرور الحالية غير صحيحة');
  }
  const pw = V.str(newPassword, 'كلمة المرور الجديدة', { required: true, min: 8, max: 200 });
  const { salt, hash } = hashPassword(pw);
  db.run('UPDATE users SET password_hash = :hash, password_salt = :salt WHERE id = :id', { hash, salt, id: user.id });
  db.run('DELETE FROM sessions WHERE user_id = :id', { id: user.id });
  db.audit({ user: user.username, action: 'PASSWORD_CHANGE', entityType: 'user', entityId: user.id });
  return { ok: true };
}

module.exports = {
  PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABELS, PERMISSION_LABELS,
  ensureBootstrapAdmin, login, logout, userForToken, purgeExpiredSessions,
  can, requirePermission, publicUser, effectivePermissions,
  listUsers, createUser, updateUser, deleteUser, changeOwnPassword,
  _resetRateLimits: () => loginAttempts.clear(),
};
