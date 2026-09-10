'use strict';
/**
 * طبقة الوصول لقاعدة البيانات — تعتمد على node:sqlite المدمج (بدون أي حزم خارجية).
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { uuid } = require('../lib/ids');

let db = null;

function nowIso() {
  return new Date().toISOString();
}

/** أعمدة تُضاف للقواعد القديمة (ترقية غير مدمِّرة). */
const MIGRATIONS = [
  ['clients', 'client_type', "TEXT NOT NULL DEFAULT 'COMPANY'"],
  ['clients', 'payment_terms_days', 'INTEGER NOT NULL DEFAULT 0'],
  ['invoices', 'seller_name', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'seller_tax_number', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'seller_cr', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'seller_address', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'buyer_name', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'buyer_tax_number', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'buyer_cr', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'buyer_address', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'due_date', 'TEXT'],
  ['invoices', 'cheque_date', 'TEXT'],
  ['invoices', 'cheque_no', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'prices_include_tax', 'INTEGER NOT NULL DEFAULT 0'],
  ['invoices', 'zatca_phase', "TEXT NOT NULL DEFAULT 'PHASE1'"],
  ['issuers', 'print_settings', "TEXT NOT NULL DEFAULT '{}'"],
];

function migrate() {
  for (const [table, column, ddl] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.length) continue;
    if (cols.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function open() {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')").run();
  return db;
}

function conn() {
  return db || open();
}

function close() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

function all(sql, params) {
  const stmt = conn().prepare(sql);
  return params === undefined ? stmt.all() : stmt.all(params);
}

function get(sql, params) {
  const stmt = conn().prepare(sql);
  const row = params === undefined ? stmt.get() : stmt.get(params);
  return row === undefined ? null : row;
}

function run(sql, params) {
  const stmt = conn().prepare(sql);
  return params === undefined ? stmt.run() : stmt.run(params);
}

function pluck(sql, params, column) {
  const row = get(sql, params);
  if (!row) return null;
  return column ? row[column] : Object.values(row)[0];
}

/** تنفيذ عملية داخل معاملة (transaction) مع تراجع تلقائي عند الخطأ. */
let txDepth = 0;
function tx(fn) {
  const c = conn();
  if (txDepth > 0) return fn(c); // معاملات متداخلة: نفس المعاملة
  c.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const result = fn(c);
    c.exec('COMMIT');
    return result;
  } catch (err) {
    try { c.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    txDepth = 0;
  }
}

/** كتابة سجل تدقيق. */
function audit({ user, action, entityType, entityId, issuerId, details, ip }) {
  run(
    `INSERT INTO audit_logs (id, user_name, action, entity_type, entity_id, issuer_id, details, ip, created_at)
     VALUES (:id, :user_name, :action, :entity_type, :entity_id, :issuer_id, :details, :ip, :created_at)`,
    {
      id: uuid(),
      user_name: user || 'system',
      action,
      entity_type: entityType || '',
      entity_id: entityId || '',
      issuer_id: issuerId || null,
      details: JSON.stringify(details === undefined ? {} : details),
      ip: ip || '',
      created_at: nowIso(),
    },
  );
}

/**
 * إنشاء نسخة احتياطية آمنة ومتسقة من قاعدة البيانات باستخدام أمر VACUUM INTO.
 * يعمل بأمان حتى أثناء التشغيل ونمط WAL.
 */
function createBackup(customPath) {
  const dir = config.backupDir;
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = customPath || path.join(dir, `zsystem_backup_${ts}.db`);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  const escaped = dest.replace(/\\/g, '/').replace(/'/g, "''");
  conn().exec(`VACUUM INTO '${escaped}'`);
  const stat = fs.statSync(dest);
  return { path: dest, filename: path.basename(dest), sizeBytes: stat.size, createdAt: nowIso() };
}

module.exports = { open, conn, close, all, get, run, pluck, tx, audit, createBackup, nowIso };
