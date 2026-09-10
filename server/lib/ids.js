'use strict';
const crypto = require('node:crypto');

function uuid() {
  return crypto.randomUUID();
}

function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** ترقيم بصيغة PREFIX-000123 */
function formatSerial(prefix, number, width = 5) {
  const n = String(number).padStart(width, '0');
  return prefix ? `${prefix}-${n}` : n;
}

module.exports = { uuid, token, formatSerial };
