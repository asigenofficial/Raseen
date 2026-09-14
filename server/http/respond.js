'use strict';
/** أدوات الاستجابة HTTP. */
const fs = require('node:fs');
const path = require('node:path');
const { ApiError } = require('../lib/validate');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
};

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload === undefined ? null : payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  const body = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, err) {
  const status = err instanceof ApiError ? err.status : 500;
  const message = err instanceof ApiError ? err.message : 'خطأ داخلي في الخادم';
  if (!(err instanceof ApiError)) {
    console.error('[z-system] error:', err && err.stack ? err.stack : err);
  }
  sendJson(res, status, {
    ok: false,
    error: message,
    details: err instanceof ApiError ? err.details : undefined,
  });
}

function sendFileFrom(rootDir, urlPath, res) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.normalize(path.join(rootDir, clean));
  if (!target.startsWith(path.normalize(rootDir))) {
    sendText(res, 403, 'forbidden');
    return true;
  }
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return false;
  }
  if (stat.isDirectory()) return false;
  const ext = path.extname(target).toLowerCase();
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    ...SECURITY_HEADERS,
  });
  res.end(body);
  return true;
}

module.exports = { sendJson, sendText, sendError, sendFileFrom, MIME, SECURITY_HEADERS };
