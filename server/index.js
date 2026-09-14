'use strict';
/**
 * Raseen — نقطة تشغيل الخادم.
 * خادم HTTP بدون أي حزم خارجية: يخدم واجهة الويب الثابتة + واجهة API بصيغة JSON.
 */
const http = require('node:http');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const auth = require('./services/auth');
const apiRouter = require('./routes/api');
const { sendJson, sendText, sendError, sendFileFrom } = require('./http/respond');
const V = require('./lib/validate');

const SESSION_COOKIE = 'zs_session';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.maxBodyBytes) {
        reject(new V.ApiError(413, 'حجم البيانات المرسلة كبير جداً'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const first = fwd.split(',')[0].trim();
    if (first) return first;
  }
  return (req.socket && req.socket.remoteAddress) || '';
}

async function handleApi(req, res, url) {
  const method = req.method.toUpperCase();
  const matched = apiRouter.match(method, url.pathname);
  if (!matched) throw V.notFound('المسار غير موجود');

  let body = {};
  if (method !== 'GET' && method !== 'HEAD') {
    const raw = await readBody(req);
    if (raw.length) {
      const text = raw.toString('utf8');
      const type = String(req.headers['content-type'] || '');
      if (type.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try { body = JSON.parse(text); } catch { throw V.bad('صيغة JSON غير صالحة'); }
      } else {
        body = Object.fromEntries(new URLSearchParams(text));
      }
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE] || req.headers['x-session-token'] || '';
  const user = auth.userForToken(sessionToken);

  // حماية CSRF: طلبات التغيير يجب أن تأتي من نفس الأصل وتتحقق من Origin أو Referer
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const rawHost = req.headers.host || '';

    if (!origin && !referer) {
      throw V.forbidden('طلب مرفوض: غياب ترويسة Origin أو Referer');
    }

    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { originHost = ''; }
      if (!originHost || (originHost !== host && originHost !== rawHost)) throw V.forbidden('طلب من أصل غير مسموح');
    } else if (referer) {
      let refererHost = '';
      try { refererHost = new URL(referer).host; } catch { refererHost = ''; }
      if (!refererHost || (refererHost !== host && refererHost !== rawHost)) throw V.forbidden('طلب من مصدر غير مسموح');
    }
  }

  if (!matched.route.options.public && !user) throw V.unauthorized();

  const isSecure = Boolean(req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https');
  let rawResponse = null;
  const ctx = {
    req,
    res,
    params: matched.params,
    query: Object.fromEntries(url.searchParams.entries()),
    body: body || {},
    user,
    sessionToken,
    ip: clientIp(req),
    setSessionCookie(token, expiresAt) {
      const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecure ? '; Secure' : ''}`);
    },
    clearSessionCookie() {
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? '; Secure' : ''}`);
    },
    raw(payload) { rawResponse = payload; },
  };

  const result = await matched.route.handler(ctx);
  if (res.writableEnded) return;
  if (rawResponse) {
    sendText(res, 200, rawResponse.body, rawResponse.contentType, rawResponse.headers || {});
    return;
  }
  sendJson(res, 200, result === null || result === undefined ? { ok: true } : result);
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((err) => sendError(res, err));
      return;
    }
    // ملفات الواجهة
    try {
      if (url.pathname === '/' || url.pathname === '') {
        if (sendFileFrom(config.publicDir, '/index.html', res)) return;
      }
      if (sendFileFrom(config.publicDir, url.pathname, res)) return;
      // مسارات الواجهة أحادية الصفحة
      if (!path.extname(url.pathname) && sendFileFrom(config.publicDir, '/index.html', res)) return;
      sendText(res, 404, 'غير موجود');
    } catch (err) {
      sendError(res, err);
    }
  });
}

function start() {
  db.open();
  const bootstrap = auth.ensureBootstrapAdmin();
  auth.purgeExpiredSessions();
  const server = createServer();
  server.listen(config.port, config.host, () => {
    const url = `http://${config.host}:${config.port}`;
    console.log('==============================================');
    console.log('  Raseen — نظام الفواتير والمحاسبة');
    console.log(`  الواجهة: ${url}`);
    console.log(`  قاعدة البيانات: ${config.dbFile}`);
    if (bootstrap) {
      console.log('  ----------------------------------------');
      console.log(`  تم إنشاء مستخدم أولي: ${bootstrap.username} / ${bootstrap.password}`);
      console.log('  يرجى تغيير كلمة المرور بعد أول دخول.');
    }
    console.log('==============================================');
  });

  const shutdown = (signal) => {
    console.log(`\n[z-system] جاري الإيقاف الآمن للخادم (${signal || 'SHUTDOWN'})...`);
    server.close(() => {
      try { db.close(); } catch { /* ignore */ }
      console.log('[z-system] تم إغلاق قاعدة البيانات وإنهاء الخدمة بنجاح.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[z-system] انتهاء مهلة الإيقاف، إغلاق إجباري.');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    console.error('[z-system] رفض غير ملتقط في Promise:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[z-system] استثناء حرج غير ملتقط:', err);
    if (err && err.code === 'EADDRINUSE') {
      process.exit(1);
    }
  });

  return server;
}

if (require.main === module) start();

module.exports = { createServer, start };
