'use strict';
/**
 * التشفير وكلمات المرور.
 * - كلمات المرور: PBKDF2-SHA512 (210,000 تكرار) مع ملح عشوائي لكل مستخدم.
 * - البيانات الحساسة (شهادات ZATCA والمفاتيح السرية): AES-256-GCM بمفتاح محلي
 *   يُنشأ تلقائياً في data/secret.key بصلاحيات مقيدة.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const PBKDF2_ITER = 210000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), s, PBKDF2_ITER, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

let cachedKey = null;
function masterKey() {
  if (cachedKey) return cachedKey;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = config.keyFile;
  if (fs.existsSync(file)) {
    cachedKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (cachedKey.length !== 32) throw new Error('ملف المفتاح data/secret.key غير صالح');
  } else {
    cachedKey = crypto.randomBytes(32);
    fs.writeFileSync(file, cachedKey.toString('base64'), { mode: 0o600 });
  }
  return cachedKey;
}

/** تشفير نص -> "v1:iv:tag:cipher" (base64) */
function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decryptSecret(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** إخفاء قيمة سرية للعرض فقط. */
function maskSecret(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function sha256Base64(input) {
  return crypto.createHash('sha256').update(input).digest('base64');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  encryptSecret,
  decryptSecret,
  maskSecret,
  sha256Base64,
  sha256Hex,
  masterKeyPath: () => path.resolve(config.keyFile),
};
