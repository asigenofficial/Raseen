'use strict';
/** تعريف مسارات الـ API. */
const { Router } = require('../http/router');
const V = require('../lib/validate');
const db = require('../db');
const auth = require('../services/auth');
const issuers = require('../services/issuers');
const clients = require('../services/clients');
const items = require('../services/items');
const invoices = require('../services/invoices');
const vouchers = require('../services/vouchers');
const generator = require('../services/generator');
const ledger = require('../services/ledger');
const reports = require('../services/reports');
const pdf = require('../services/pdf');
const config = require('../config');

const router = new Router();

const actorOf = (ctx) => (ctx.user ? ctx.user.username : 'system');
const invCtx = (ctx) => ({ actor: actorOf(ctx), user: ctx.user, can: (p) => auth.can(ctx.user, p) });
const need = (ctx, p) => auth.requirePermission(ctx.user, p);

function getSystemSettings() {
  const rows = db.all('SELECT key, value FROM settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    ...map,
    currency: map.currency || config.defaults.currency || 'SAR',
    default_tax_rate: map.default_tax_rate !== undefined ? Number(map.default_tax_rate) : config.defaults.taxRate,
    bulk_max_invoices: map.bulk_max_invoices !== undefined ? Number(map.bulk_max_invoices) : config.bulk.maxInvoicesPerBatch,
    invoice_prefix_default: map.invoice_prefix_default || 'INV',
    invoice_pad_default: map.invoice_pad_default !== undefined ? Number(map.invoice_pad_default) : 5,
    voucher_prefix_default: map.voucher_prefix_default || 'RV',
    print_copies_default: map.print_copies_default !== undefined ? Number(map.print_copies_default) : 1,
    country: map.country || config.defaults.country || 'SA',
  };
}

// ------------------------------------------------------------------ عام
router.get('/api/health', () => {
  const dbOk = Boolean(db.pluck('SELECT 1'));
  return { ok: true, service: 'Raseen', time: db.nowIso(), database: dbOk ? 'connected' : 'error' };
}, { public: true });

router.get('/api/system/backup', (ctx) => {
  if (!ctx.user || ctx.user.role !== 'ADMIN') throw V.forbidden('أخذ النسخ الاحتياطية محصور بمدير النظام');
  const backup = db.createBackup();
  db.audit({
    user: actorOf(ctx),
    action: 'DATABASE_BACKUP',
    entityType: 'system',
    details: { filename: backup.filename, size: backup.sizeBytes },
  });
  if (ctx.query.download === '1' || ctx.query.download === 'true') {
    const fs = require('node:fs');
    const content = fs.readFileSync(backup.path);
    ctx.raw({
      body: content,
      contentType: 'application/octet-stream',
      headers: { 'Content-Disposition': `attachment; filename="${backup.filename}"` },
    });
    return null;
  }
  return { ok: true, data: backup };
});

router.get('/api/meta', () => {
  const sysSettings = getSystemSettings();
  return {
    ok: true,
    data: {
      name: 'Raseen',
      version: '1.0.0',
      currency: sysSettings.currency,
      default_tax_rate: Number(sysSettings.default_tax_rate),
      settings: sysSettings,
      permissions: auth.PERMISSIONS,
      permission_labels: auth.PERMISSION_LABELS,
      role_permissions: auth.ROLE_PERMISSIONS,
      roles: auth.ROLE_LABELS,
      payment_methods: invoices.PAYMENT_LABELS,
      voucher_payment_types: vouchers.PAYMENT_LABELS,
      invoice_statuses: invoices.STATUS_LABELS,
      has_users: db.pluck('SELECT COUNT(*) AS c FROM users') > 0,
    },
  };
}, { public: true });

router.get('/api/settings', (ctx) => {
  need(ctx, 'settings.write');
  return { ok: true, data: getSystemSettings() };
});

router.put('/api/settings', (ctx) => {
  need(ctx, 'settings.write');
  const payload = ctx.body || {};
  const now = db.nowIso();
  db.tx(() => {
    for (const [key, rawVal] of Object.entries(payload)) {
      if (typeof key !== 'string' || !key.trim()) continue;
      const cleanKey = key.trim();
      const valStr = String(rawVal === undefined || rawVal === null ? '' : rawVal).trim();
      db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, :u)
         ON CONFLICT(key) DO UPDATE SET value = :v, updated_at = :u`,
        { k: cleanKey, v: valStr, u: now },
      );
    }
    db.audit({
      user: actorOf(ctx),
      action: 'SETTINGS_UPDATE',
      entityType: 'settings',
      details: payload,
    });
  });
  return { ok: true, data: getSystemSettings() };
});

// ------------------------------------------------------------------ الدخول
router.post('/api/auth/login', (ctx) => {
  const username = V.str(ctx.body.username, 'اسم المستخدم', { required: true, max: 60 });
  const password = V.str(ctx.body.password, 'كلمة المرور', { required: true, max: 200 });
  const result = auth.login(username, password, ctx.ip);
  ctx.setSessionCookie(result.token, result.expires_at);
  return { ok: true, data: result.user };
}, { public: true });

router.post('/api/auth/logout', (ctx) => {
  auth.logout(ctx.sessionToken);
  ctx.clearSessionCookie();
  return { ok: true };
}, { public: true });

router.get('/api/auth/me', (ctx) => ({ ok: true, data: auth.publicUser(ctx.user) }));

router.post('/api/auth/password', (ctx) => ({
  ok: true,
  data: auth.changeOwnPassword(ctx.user, ctx.body.current_password, ctx.body.new_password),
}));

// ------------------------------------------------------------------ المستخدمون
router.get('/api/users', (ctx) => { need(ctx, 'users.manage'); return { ok: true, data: auth.listUsers() }; });
router.post('/api/users', (ctx) => { need(ctx, 'users.manage'); return { ok: true, data: auth.createUser(ctx.body, actorOf(ctx)) }; });
router.put('/api/users/:id', (ctx) => { need(ctx, 'users.manage'); return { ok: true, data: auth.updateUser(ctx.params.id, ctx.body, actorOf(ctx)) }; });
router.delete('/api/users/:id', (ctx) => { need(ctx, 'users.manage'); return { ok: true, data: auth.deleteUser(ctx.params.id, actorOf(ctx)) }; });

// ------------------------------------------------------------------ إدارة الأدوار والصلاحيات
router.get('/api/roles', (ctx) => { need(ctx, 'users.manage'); return { ok: true, data: auth.listRoles() }; });
router.put('/api/roles/:role', (ctx) => {
  need(ctx, 'users.manage');
  const roles = auth.updateRolePermissions(ctx.params.role, ctx.body.permissions, actorOf(ctx));
  const role = roles.find((r) => r.id === String(ctx.params.role || '').trim().toUpperCase());
  return { ok: true, data: role || roles };
});
router.post('/api/roles/:role/reset', (ctx) => {
  need(ctx, 'users.manage');
  const roles = auth.resetRolePermissions(ctx.params.role, actorOf(ctx));
  const role = roles.find((r) => r.id === String(ctx.params.role || '').trim().toUpperCase());
  return { ok: true, data: role || roles };
});
router.post('/api/roles', (ctx) => {
  need(ctx, 'users.manage');
  const roles = auth.saveCustomRole(ctx.body.key, ctx.body.label, ctx.body.permissions, actorOf(ctx));
  const role = roles.find((r) => r.id === String(ctx.body.key || '').trim().toUpperCase());
  return { ok: true, data: role || roles };
});
router.delete('/api/roles/:role', (ctx) => { need(ctx, 'users.manage'); return { ok: true, data: auth.deleteCustomRole(ctx.params.role, actorOf(ctx)) }; });

// ------------------------------------------------------------------ الشركات المصدرة
router.get('/api/issuers', (ctx) => {
  need(ctx, 'issuers.view');
  return { ok: true, data: issuers.list({ search: ctx.query.q || '', activeOnly: V.bool(ctx.query.active_only, false) }) };
});
router.post('/api/issuers', (ctx) => { need(ctx, 'issuers.write'); return { ok: true, data: issuers.create(ctx.body, actorOf(ctx)) }; });
router.get('/api/issuers/:id', (ctx) => { need(ctx, 'issuers.view'); return { ok: true, data: issuers.get(ctx.params.id) }; });
router.put('/api/issuers/:id', (ctx) => { need(ctx, 'issuers.write'); return { ok: true, data: issuers.update(ctx.params.id, ctx.body, actorOf(ctx)) }; });
router.delete('/api/issuers/:id', (ctx) => { need(ctx, 'issuers.write'); return { ok: true, data: issuers.remove(ctx.params.id, actorOf(ctx)) }; });

router.get('/api/issuers/:id/logo', (ctx) => {
  try {
    const row = issuers.getRaw(ctx.params.id);
    if (!row || !row.logo_data) {
      ctx.raw({ body: 'No logo', contentType: 'text/plain; charset=utf-8' });
      return;
    }
    const match = row.logo_data.match(/^data:([^;,]+)(;base64)?,(.*)$/);
    if (!match) {
      ctx.raw({
        body: row.logo_data,
        contentType: 'image/svg+xml; charset=utf-8',
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
      return;
    }
    const contentType = match[1];
    const isBase64 = !!match[2];
    const rawData = match[3];
    const body = isBase64 ? Buffer.from(rawData, 'base64') : Buffer.from(decodeURIComponent(rawData), 'utf8');
    ctx.raw({
      body,
      contentType,
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    ctx.raw({ body: 'Not found', contentType: 'text/plain; charset=utf-8' });
  }
});

router.get('/api/issuers/:id/credentials', (ctx) => { need(ctx, 'issuers.view'); return { ok: true, data: issuers.getCredentials(ctx.params.id) }; });
router.put('/api/issuers/:id/credentials', (ctx) => { need(ctx, 'settings.write'); return { ok: true, data: issuers.saveCredentials(ctx.params.id, ctx.body, actorOf(ctx)) }; });
router.post('/api/issuers/:id/generate-key', (ctx) => { need(ctx, 'settings.write'); return { ok: true, data: issuers.generateSigningKey(ctx.params.id, actorOf(ctx)) }; });
router.get('/api/issuers/:id/verify-chain', (ctx) => { need(ctx, 'issuers.view'); return { ok: true, data: invoices.verifyChain(ctx.params.id) }; });

// ------------------------------------------------------------------ العملاء
router.get('/api/clients', (ctx) => {
  need(ctx, 'clients.view');
  return {
    ok: true,
    data: clients.list({
      search: ctx.query.q || '',
      activeOnly: V.bool(ctx.query.active_only !== undefined ? ctx.query.active_only : ctx.query.activeOnly, false),
      withBalances: V.bool(ctx.query.with_balances !== undefined ? ctx.query.with_balances : ctx.query.withBalances, false),
      issuerId: ctx.query.issuer_id || ctx.query.issuerId || '',
      clientType: ctx.query.client_type || ctx.query.clientType || '',
      city: ctx.query.city || '',
      onlyDebtors: V.bool(ctx.query.only_debtors !== undefined ? ctx.query.only_debtors : ctx.query.onlyDebtors, false),
    }),
  };
});
router.get('/api/clients/next-code', (ctx) => { need(ctx, 'clients.view'); return { ok: true, data: { code: clients.nextCode() } }; });
router.post('/api/clients', (ctx) => { need(ctx, 'clients.write'); return { ok: true, data: clients.create(ctx.body, actorOf(ctx)) }; });
router.get('/api/clients/:id', (ctx) => { need(ctx, 'clients.view'); return { ok: true, data: clients.get(ctx.params.id) }; });
router.put('/api/clients/:id', (ctx) => { need(ctx, 'clients.write'); return { ok: true, data: clients.update(ctx.params.id, ctx.body, actorOf(ctx)) }; });
router.delete('/api/clients/:id', (ctx) => { need(ctx, 'clients.write'); return { ok: true, data: clients.remove(ctx.params.id, actorOf(ctx)) }; });

// ------------------------------------------------------------------ المجموعات والأصناف
router.get('/api/categories', (ctx) => { need(ctx, 'items.view'); return { ok: true, data: items.listCategories() }; });
router.post('/api/categories', (ctx) => { need(ctx, 'items.write'); return { ok: true, data: items.createCategory(ctx.body, actorOf(ctx)) }; });
router.put('/api/categories/:id', (ctx) => { need(ctx, 'items.write'); return { ok: true, data: items.updateCategory(ctx.params.id, ctx.body, actorOf(ctx)) }; });
router.delete('/api/categories/:id', (ctx) => { need(ctx, 'items.write'); return { ok: true, data: items.removeCategory(ctx.params.id, actorOf(ctx)) }; });

router.get('/api/items', (ctx) => {
  need(ctx, 'items.view');
  return {
    ok: true,
    data: items.listItems({
      search: ctx.query.q || '',
      categoryId: ctx.query.category_id || '',
      activeOnly: V.bool(ctx.query.active_only, false),
      status: ctx.query.status || '',
      minPrice: ctx.query.min_price,
      maxPrice: ctx.query.max_price,
      taxRate: ctx.query.tax_rate,
      limit: Number(ctx.query.limit || 0),
    }),
  };
});
router.get('/api/items/next-code', (ctx) => { need(ctx, 'items.view'); return { ok: true, data: { code: items.nextItemCode() } }; });
router.post('/api/items', (ctx) => { need(ctx, 'items.write'); return { ok: true, data: items.createItem(ctx.body, actorOf(ctx)) }; });
router.get('/api/items/:id', (ctx) => { need(ctx, 'items.view'); return { ok: true, data: items.getItem(ctx.params.id) }; });
router.put('/api/items/:id', (ctx) => { need(ctx, 'items.write'); return { ok: true, data: items.updateItem(ctx.params.id, ctx.body, actorOf(ctx)) }; });
router.delete('/api/items/:id', (ctx) => { need(ctx, 'items.write'); return { ok: true, data: items.removeItem(ctx.params.id, actorOf(ctx)) }; });

// ------------------------------------------------------------------ الفواتير
router.get('/api/invoices/open', (ctx) => {
  need(ctx, 'invoices.view');
  const clientId = V.str(ctx.query.client_id, 'العميل', { required: true, max: 40 });
  return { ok: true, data: invoices.openInvoices(clientId, ctx.query.issuer_id || '') };
});
router.get('/api/invoices', (ctx) => { need(ctx, 'invoices.view'); return { ok: true, data: invoices.search(ctx.query) }; });
router.post('/api/invoices', (ctx) => { need(ctx, 'invoices.create'); return { ok: true, data: invoices.create(ctx.body, invCtx(ctx)) }; });
router.get('/api/invoices/templates', (ctx) => {
  need(ctx, 'invoices.view');
  const tpls = db.all('SELECT id, name_ar, name_en, description, badge, category, color_hex, file_path FROM excel_templates WHERE is_active = 1 ORDER BY rowid');
  return { ok: true, data: tpls };
});
router.delete('/api/invoices/templates/:id', (ctx) => {
  need(ctx, 'issuers.write');
  const id = String(ctx.params.id || '').trim();
  if (!id) throw V.badRequest('معرف القالب غير صالح');
  db.run('UPDATE excel_templates SET is_active = 0, updated_at = :now WHERE id = :id', { id, now: db.nowIso() });
  return { ok: true, data: { id, deleted: true } };
});
router.post('/api/invoices/templates/reset', (ctx) => {
  need(ctx, 'issuers.write');
  db.run('UPDATE excel_templates SET is_active = 1, updated_at = :now', { now: db.nowIso() });
  return { ok: true, data: { reset: true } };
});
router.get('/api/invoices/template', (ctx) => {
  need(ctx, 'invoices.view');
  const rawFormat = String(ctx.query.format || 'xlsx').toLowerCase();
  const format = rawFormat === 'csv' ? 'csv' : (rawFormat === 'xls' ? 'xls' : 'xlsx');
  const style = String(ctx.query.style || 'standard').toLowerCase();
  const tpl = invoices.generateTemplate({ format, style });
  ctx.raw({
    body: tpl.content,
    contentType: tpl.contentType,
    headers: { 'Content-Disposition': `attachment; filename="${tpl.filename}"` },
  });
  return null;
});
router.post('/api/invoices/parse-file', (ctx) => {
  need(ctx, 'invoices.create');
  const body = ctx.body || {};
  const filename = body.filename || 'import.xlsx';
  const fileBase64 = body.file_base64 || body.content || '';
  const rows = invoices.parseSpreadsheetBuffer(fileBase64, filename);
  return { ok: true, data: { rows } };
});
router.post('/api/invoices/import', (ctx) => {
  need(ctx, 'invoices.create');
  return { ok: true, data: invoices.importInvoices(ctx.body, invCtx(ctx)) };
});
router.get('/api/invoices/:id', (ctx) => { need(ctx, 'invoices.view'); return { ok: true, data: invoices.getById(ctx.params.id) }; });
router.post('/api/invoices/:id/cancel', (ctx) => {
  need(ctx, 'invoices.edit');
  return { ok: true, data: invoices.cancel(ctx.params.id, ctx.body.reason, invCtx(ctx)) };
});
router.delete('/api/invoices/:id', (ctx) => { need(ctx, 'invoices.delete'); return { ok: true, data: invoices.remove(ctx.params.id, invCtx(ctx)) }; });
router.get('/api/invoices/:id/xml', (ctx) => {
  need(ctx, 'invoices.view');
  const inv = invoices.getById(ctx.params.id, { withLines: false });
  ctx.raw({
    body: invoices.toXml(ctx.params.id),
    contentType: 'application/xml; charset=utf-8',
    headers: { 'Content-Disposition': `attachment; filename="${inv.invoice_number}.xml"` },
  });
  return null;
});
router.get('/api/invoices/:id/pdf', (ctx) => {
  need(ctx, 'invoices.view');
  const inv = invoices.getById(ctx.params.id);
  const issuer = issuers.get(inv.issuer_id);
  const client = clients.get(inv.client_id);
  const pdfBuf = pdf.generateInvoicePdf({ invoice: inv, issuer, client });
  const filename = encodeURIComponent(`فاتورة_${inv.invoice_number}.pdf`);
  ctx.raw({
    body: pdfBuf,
    contentType: 'application/pdf',
    headers: {
      'Content-Disposition': `attachment; filename="${inv.invoice_number}.pdf"; filename*=UTF-8''${filename}`,
      'Content-Length': String(pdfBuf.length),
    },
  });
  return null;
});
router.post('/api/invoices/:id/pdf', (ctx) => {
  need(ctx, 'invoices.view');
  const inv = invoices.getById(ctx.params.id);
  const issuer = issuers.get(inv.issuer_id);
  const client = clients.get(inv.client_id);
  const html = ctx.body && ctx.body.html ? ctx.body.html : null;
  const pdfBuf = pdf.generateInvoicePdf({ invoice: inv, issuer, client, html });
  const filename = encodeURIComponent(`فاتورة_${inv.invoice_number}.pdf`);
  ctx.raw({
    body: pdfBuf,
    contentType: 'application/pdf',
    headers: {
      'Content-Disposition': `attachment; filename="${inv.invoice_number}.pdf"; filename*=UTF-8''${filename}`,
      'Content-Length': String(pdfBuf.length),
    },
  });
  return null;
});

router.post('/api/pdf/render', (ctx) => {
  need(ctx, 'invoices.view');
  const html = ctx.body && ctx.body.html ? ctx.body.html : '';
  if (!html) throw V.bad('محتوى المستند HTML مطلوب');
  const pdfBuf = pdf.htmlToPdf(html);
  const rawName = ctx.body && ctx.body.filename ? String(ctx.body.filename) : 'document.pdf';
  const cleanName = rawName.endsWith('.pdf') ? rawName : `${rawName}.pdf`;
  const filename = encodeURIComponent(cleanName);
  ctx.raw({
    body: pdfBuf,
    contentType: 'application/pdf',
    headers: {
      'Content-Disposition': `attachment; filename="${cleanName.replace(/"/g, '')}"; filename*=UTF-8''${filename}`,
      'Content-Length': String(pdfBuf.length),
    },
  });
  return null;
});


// ------------------------------------------------------------------ التوليد الدفعي
router.post('/api/bulk/preview', (ctx) => { need(ctx, 'bulk.generate'); return { ok: true, data: generator.generate(ctx.body) }; });
router.post('/api/bulk/commit', (ctx) => { need(ctx, 'bulk.generate'); return { ok: true, data: generator.commit(ctx.body, invCtx(ctx)) }; });
router.get('/api/bulk/batches', (ctx) => {
  need(ctx, 'invoices.view');
  return { ok: true, data: generator.listBatches({ issuerId: ctx.query.issuer_id || '', clientId: ctx.query.client_id || '' }) };
});
router.get('/api/bulk/drafts', (ctx) => {
  need(ctx, 'bulk.generate');
  return { ok: true, data: generator.listDrafts({ issuerId: ctx.query.issuer_id || '', clientId: ctx.query.client_id || '' }) };
});
router.post('/api/bulk/drafts', (ctx) => {
  need(ctx, 'bulk.generate');
  return { ok: true, data: generator.saveDraft(ctx.body, invCtx(ctx)) };
});
router.get('/api/bulk/drafts/:id', (ctx) => {
  need(ctx, 'bulk.generate');
  return { ok: true, data: generator.getDraft(ctx.params.id) };
});
router.delete('/api/bulk/drafts/:id', (ctx) => {
  need(ctx, 'bulk.generate');
  return { ok: true, data: generator.deleteDraft(ctx.params.id, invCtx(ctx)) };
});

// ------------------------------------------------------------------ سندات القبض
router.post('/api/vouchers/for-invoice', (ctx) => { need(ctx, 'vouchers.create'); return { ok: true, data: vouchers.createForInvoice(ctx.body, invCtx(ctx)) }; });
router.get('/api/vouchers', (ctx) => { need(ctx, 'vouchers.view'); return { ok: true, data: vouchers.search(ctx.query) }; });
router.post('/api/vouchers', (ctx) => { need(ctx, 'vouchers.create'); return { ok: true, data: vouchers.create(ctx.body, invCtx(ctx)) }; });
router.get('/api/vouchers/:id', (ctx) => { need(ctx, 'vouchers.view'); return { ok: true, data: vouchers.getById(ctx.params.id) }; });
router.get('/api/vouchers/:id/pdf', (ctx) => {
  need(ctx, 'vouchers.view');
  const v = vouchers.getById(ctx.params.id);
  const issuer = issuers.get(v.issuer_id);
  const client = clients.get(v.client_id);
  const pdfBuf = pdf.generateVoucherPdf({ voucher: v, issuer, client });
  const filename = encodeURIComponent(`سند_${v.voucher_number}.pdf`);
  ctx.raw({
    body: pdfBuf,
    contentType: 'application/pdf',
    headers: {
      'Content-Disposition': `attachment; filename="${v.voucher_number}.pdf"; filename*=UTF-8''${filename}`,
      'Content-Length': String(pdfBuf.length),
    },
  });
  return null;
});
router.post('/api/vouchers/:id/cancel', (ctx) => { need(ctx, 'vouchers.create'); return { ok: true, data: vouchers.cancel(ctx.params.id, ctx.body.reason, invCtx(ctx)) }; });
router.delete('/api/vouchers/:id', (ctx) => { need(ctx, 'vouchers.delete'); return { ok: true, data: vouchers.remove(ctx.params.id, invCtx(ctx)) }; });

// ------------------------------------------------------------------ كشف الحساب
router.get('/api/ledger/statement/pdf', (ctx) => {
  need(ctx, 'ledger.view');
  const st = ledger.statement(ctx.query);
  const issuer = st.issuer && st.issuer.id ? issuers.get(st.issuer.id) : null;
  const client = clients.get(st.client.id);
  const pdfBuf = pdf.generateStatementPdf({ statement: st, issuer, client });
  const filename = encodeURIComponent(`كشف_حساب_${st.client.name}.pdf`);
  ctx.raw({
    body: pdfBuf,
    contentType: 'application/pdf',
    headers: {
      'Content-Disposition': `attachment; filename="statement_${st.client.id}.pdf"; filename*=UTF-8''${filename}`,
      'Content-Length': String(pdfBuf.length),
    },
  });
  return null;
});
router.get('/api/ledger/statement', (ctx) => { need(ctx, 'ledger.view'); return { ok: true, data: ledger.statement(ctx.query) }; });
router.get('/api/ledger/balances', (ctx) => {
  need(ctx, 'ledger.view');
  return { ok: true, data: ledger.balances({ issuerId: ctx.query.issuer_id || '', onlyDebtors: V.bool(ctx.query.only_debtors, false) }) };
});

// ------------------------------------------------------------------ التقارير
router.get('/api/reports/dashboard', (ctx) => { need(ctx, 'reports.view'); return { ok: true, data: reports.dashboard(ctx.query) }; });
router.get('/api/reports/sales', (ctx) => { need(ctx, 'reports.view'); return { ok: true, data: reports.sales(ctx.query) }; });
router.get('/api/reports/vat', (ctx) => { need(ctx, 'reports.view'); return { ok: true, data: reports.vat(ctx.query) }; });
router.get('/api/reports/aging', (ctx) => { need(ctx, 'reports.view'); return { ok: true, data: reports.aging(ctx.query) }; });
router.get('/api/audit', (ctx) => { need(ctx, 'audit.view'); return { ok: true, data: reports.auditLog(ctx.query) }; });

module.exports = router;
