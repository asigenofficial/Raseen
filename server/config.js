'use strict';
/**
 * إعدادات النظام العامة - Raseen configuration.
 * كل الإعدادات قابلة للتجاوز عبر متغيرات البيئة.
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const config = {
  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  dataDir: process.env.ZS_DATA_DIR || path.join(ROOT, 'data'),
  get dbFile() {
    return process.env.ZS_DB_FILE || path.join(this.dataDir, 'zsystem.db');
  },
  get keyFile() {
    return path.join(this.dataDir, 'secret.key');
  },
  get backupDir() {
    return path.join(this.dataDir, 'backups');
  },
  host: process.env.ZS_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT || process.env.ZS_PORT || 4711),
  sessionTtlHours: Number(process.env.ZS_SESSION_TTL || 12),
  // حدود الحماية
  maxBodyBytes: Number(process.env.ZS_MAX_BODY || 12 * 1024 * 1024), // 12MB (شعارات base64)
  bulk: {
    maxInvoicesPerBatch: Number(process.env.ZS_BULK_MAX || 2000),
  },
  defaults: {
    currency: 'SAR',
    taxRate: 15,
    country: 'SA',
  },
  bootstrapAdmin: {
    username: process.env.ZS_ADMIN_USER || 'admin',
    password: process.env.ZS_ADMIN_PASS || 'Admin@12345',
    fullName: 'مدير النظام',
  },
};

module.exports = config;
