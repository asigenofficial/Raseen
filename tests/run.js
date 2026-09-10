'use strict';
/**
 * اختبارات شاملة من الطرف إلى الطرف لواجهة Raseen.
 * تعمل على قاعدة بيانات مؤقتة منفصلة ولا تمس بيانات النظام.
 *
 * التشغيل: node tests/run.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// قاعدة بيانات مؤقتة قبل تحميل أي وحدة تعتمد على الإعدادات
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsystem-test-'));
process.env.ZS_DATA_DIR = tmpDir;
process.env.ZS_DB_FILE = path.join(tmpDir, 'test.db');
process.env.ZS_PORT = '0';
process.env.ZS_ADMIN_USER = 'admin';
process.env.ZS_ADMIN_PASS = 'Admin@12345';

const db = require('../server/db');
const auth = require('../server/services/auth');
const { createServer } = require('../server/index');
const zatca = require('../server/lib/zatca');
const { seed } = require('../server/db/seed');

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label, extra) {
  if (condition) { passed += 1; return true; }
  failed += 1;
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`);
  console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  return false;
}

function eq(actual, expected, label) {
  return ok(actual === expected, label, actual === expected ? '' : `المتوقع ${JSON.stringify(expected)} والناتج ${JSON.stringify(actual)}`);
}

function near(actual, expected, label, tolerance = 0.01) {
  return ok(Math.abs(actual - expected) <= tolerance, label, `المتوقع ~${expected} والناتج ${actual}`);
}

function section(title) {
  console.log(`\n== ${title}`);
}

async function main() {
  db.open();
  seed({});
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function api(method, url, body, { expectStatus, headers: customHeaders } = {}) {
    const defaultHeaders = {
      'Origin': base,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    };
    const finalHeaders = { ...defaultHeaders, ...(customHeaders || {}) };
    // Remove empty header strings if specified to test missing headers
    for (const [k, v] of Object.entries(finalHeaders)) {
      if (v === '') delete finalHeaders[k];
    }
    const res = await fetch(`${base}${url}`, {
      method,
      headers: finalHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookie) {
      if (c.startsWith('zs_session=')) cookie = c.split(';')[0];
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (expectStatus !== undefined && res.status !== expectStatus) {
      ok(false, `${method} ${url} حالة الاستجابة`, `المتوقع ${expectStatus} والناتج ${res.status}: ${text.slice(0, 200)}`);
    }
    return { status: res.status, body: json, text };
  }

  // ------------------------------------------------------------- عام
  section('الخدمة والمصادقة والأمان');
  let r = await api('GET', '/api/health');
  eq(r.status, 200, 'GET /api/health يعمل');
  ok(r.body.ok === true, 'health يعيد ok');

  r = await api('GET', '/api/issuers');
  eq(r.status, 401, 'المسارات المحمية ترفض بدون جلسة');

  r = await api('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  eq(r.status, 401, 'رفض كلمة مرور خاطئة');

  r = await api('POST', '/api/auth/login', { username: 'admin', password: 'Admin@12345' }, { expectStatus: 200 });
  ok(cookie.startsWith('zs_session='), 'تم تعيين كوكي الجلسة');
  eq(r.body.data.role, 'ADMIN', 'دور المستخدم ADMIN');
  ok(r.body.data.permissions.includes('bulk.generate'), 'صلاحيات المدير تشمل التوليد الدفعي');

  // فحص تشفير توكن الجلسة (M4)
  const sessionRow = db.get("SELECT token FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'admin')");
  ok(sessionRow && sessionRow.token.length === 64 && /^[0-9a-f]+$/.test(sessionRow.token), 'رمز الجلسة مخزن كـ SHA-256 hash في قاعدة البيانات');

  // فحص حماية CSRF (M4)
  r = await api('POST', '/api/auth/logout', {}, { headers: { 'Origin': '', 'Referer': '' } });
  eq(r.status, 403, 'رفض طلب تغيير بدون Origin أو Referer');

  // فحص محدد محاولات الدخول Rate Limiter (M5)
  for (let i = 0; i < 5; i++) {
    await api('POST', '/api/auth/login', { username: 'ratelimit_user', password: 'wrong' });
  }
  r = await api('POST', '/api/auth/login', { username: 'ratelimit_user', password: 'wrong' });
  eq(r.status, 429, 'محاولة الدخول بعد 5 محاولات فاشلة تعيد 429 Rate Limited');
  ok(r.body.error && r.body.error.includes('تم تجاوز الحد الأقصى'), 'رسالة تجاوز محاولات الدخول بالعربية');
  auth._resetRateLimits();

  r = await api('GET', '/api/auth/me', null, { expectStatus: 200 });
  eq(r.body.data.username, 'admin', 'GET /api/auth/me');

  // ------------------------------------------------------------- البيانات الأساسية
  section('الشركات والعملاء والأصناف');
  r = await api('GET', '/api/issuers', null, { expectStatus: 200 });
  ok(r.body.data.length >= 3, 'قائمة الشركات المصدرة', `العدد ${r.body.data.length}`);
  const issuerP1 = r.body.data.find((i) => i.zatca_phase === 'PHASE1');
  const issuerP2 = r.body.data.find((i) => i.zatca_phase === 'PHASE2');
  ok(!!issuerP1 && !!issuerP2, 'توجد منشأة بالمرحلة الأولى وأخرى بالثانية');

  r = await api('POST', '/api/issuers', {
    code: 'TEST-X', name_ar: 'منشأة اختبار', tax_number: '399999999999993',
    qr_settings: { show_a4: true, show_thermal: false, size: 'small' },
  }, { expectStatus: 200 });
  const newIssuer = r.body.data;
  eq(newIssuer.code, 'TEST-X', 'إنشاء منشأة جديدة');
  eq(newIssuer.qr_settings.show_thermal, false, 'حفظ إعدادات QR للمنشأة (M8)');
  r = await api('POST', '/api/issuers', { code: 'TEST-X', name_ar: 'مكرر' });
  eq(r.status, 409, 'رفض تكرار كود المنشأة');
  r = await api('POST', '/api/issuers', { code: 'TEST-Y', name_ar: 'رقم ضريبي خاطئ', tax_number: '123' });
  eq(r.status, 400, 'رفض رقم ضريبي غير صالح');
  r = await api('DELETE', `/api/issuers/${newIssuer.id}`, null, { expectStatus: 200 });
  ok(r.body.ok, 'حذف منشأة بلا فواتير');

  r = await api('GET', '/api/clients?with_balances=1', null, { expectStatus: 200 });
  ok(r.body.data.length >= 8, 'قائمة العملاء');
  const client = r.body.data.find((c) => c.client_code === 'C-0001');
  ok(!!client, 'العميل C-0001 موجود');
  const clientWithOpening = r.body.data.find((c) => c.client_code === 'C-0002');
  near(clientWithOpening.opening_balance, 12500, 'الرصيد الافتتاحي محفوظ');

  r = await api('GET', '/api/items?active_only=1', null, { expectStatus: 200 });
  const allItems = r.body.data;
  ok(allItems.length >= 30, 'قائمة الأصناف');
  const rice = allItems.find((i) => i.item_code === 'IT-0001');
  near(rice.sale_price, 78.5, 'سعر بيع الصنف صحيح');

  r = await api('GET', '/api/categories', null, { expectStatus: 200 });
  const categories = r.body.data;
  ok(categories.length >= 6, 'قائمة المجموعات');

  // ------------------------------------------------------------- الفواتير
  section('الفواتير الفردية والحسابات');
  r = await api('POST', '/api/invoices', {
    issuer_id: issuerP1.id,
    client_id: client.id,
    payment_method: 'CREDIT',
    lines: [
      { item_id: rice.id, quantity: 10, unit_price: 78.5, tax_rate: 15 },
      { item_id: allItems[1].id, quantity: 3, unit_price: 19.75, discount: 5, tax_rate: 15 },
    ],
  }, { expectStatus: 200 });
  const inv1 = r.body.data;
  // 10*78.5 = 785 | 3*19.75 = 59.25 - 5 = 54.25 | subtotal 844.25 | خصم 5 | خاضع 839.25
  near(inv1.subtotal, 844.25, 'المجموع قبل الخصم');
  near(inv1.discount_amount, 5, 'إجمالي الخصم');
  near(inv1.taxable_amount, 839.25, 'الوعاء الضريبي');
  near(inv1.tax_amount, 125.89, 'قيمة الضريبة (تقريب البنود)');
  near(inv1.grand_total, 965.14, 'الإجمالي شامل الضريبة');
  eq(inv1.status, 'UNPAID', 'حالة الفاتورة غير مسددة');
  near(inv1.remaining_amount, inv1.grand_total, 'المتبقي = الإجمالي');
  ok(inv1.invoice_number.startsWith(issuerP1.invoice_prefix), 'الترقيم يستخدم بادئة المنشأة');
  eq(inv1.lines.length, 2, 'عدد البنود');

  // التحقق من لقطات البيانات (M2)
  eq(inv1.seller_name, issuerP1.name_ar, 'حفظ لقطة اسم البائع (M2)');
  eq(inv1.seller_tax_number, issuerP1.tax_number, 'حفظ لقطة الرقم الضريبي للبائع (M2)');
  eq(inv1.buyer_name, client.name, 'حفظ لقطة اسم المشتري (M2)');

  // التحقق من QR (المرحلة الأولى)
  const tags = zatca.parseQrPayload(inv1.qr_payload);
  const tagMap = new Map(tags.map((t) => [t.tag, t.text]));
  eq(tagMap.get(1), issuerP1.name_ar, 'QR Tag 1 = اسم المنشأة');
  eq(tagMap.get(2), issuerP1.tax_number, 'QR Tag 2 = الرقم الضريبي');
  eq(tagMap.get(3), `${inv1.issue_date}T${inv1.issue_time}Z`, 'QR Tag 3 = الطابع الزمني ISO');
  eq(tagMap.get(4), inv1.grand_total.toFixed(2), 'QR Tag 4 = الإجمالي');
  eq(tagMap.get(5), inv1.tax_amount.toFixed(2), 'QR Tag 5 = الضريبة');
  ok(!tagMap.has(6), 'المرحلة الأولى بدون Tag 6');
  eq(inv1.previous_invoice_hash, zatca.GENESIS_PIH, 'أول فاتورة تستخدم PIH الابتدائي');
  ok(inv1.invoice_hash.length > 20, 'هاش الفاتورة مولّد');

  // فاتورة ثانية لنفس المنشأة → تسلسل الهاش
  r = await api('POST', '/api/invoices', {
    issuer_id: issuerP1.id,
    client_id: client.id,
    lines: [{ item_id: rice.id, quantity: 2, unit_price: 100, tax_rate: 15 }],
  }, { expectStatus: 200 });
  const inv2 = r.body.data;
  eq(inv2.previous_invoice_hash, inv1.invoice_hash, 'PIH يشير لهاش الفاتورة السابقة');
  eq(inv2.sequence_no, inv1.sequence_no + 1, 'تسلسل ICV يتزايد');
  near(inv2.grand_total, 230, 'إجمالي الفاتورة الثانية');

  // رفض تكرار رقم فاتورة لنفس المنشأة
  r = await api('POST', '/api/invoices', {
    issuer_id: issuerP1.id, client_id: client.id, invoice_number: inv1.invoice_number,
    lines: [{ item_id: rice.id, quantity: 1, unit_price: 10 }],
  });
  eq(r.status, 409, 'رفض تكرار رقم الفاتورة لنفس المنشأة');

  // نفس الرقم مسموح لمنشأة أخرى (عزل الكيانات)
  r = await api('POST', '/api/invoices', {
    issuer_id: issuerP2.id, client_id: client.id, invoice_number: inv1.invoice_number,
    lines: [{ item_id: rice.id, quantity: 1, unit_price: 10 }],
  }, { expectStatus: 200 });
  const invOther = r.body.data;
  eq(invOther.invoice_number, inv1.invoice_number, 'نفس الرقم مسموح في منشأة مختلفة');
  ok(invOther.signature_mode === 'LOCAL' || invOther.signature_mode === 'PRODUCTION', 'المرحلة الثانية توقّع الفاتورة', invOther.signature_mode);
  const tags2 = new Map(zatca.parseQrPayload(invOther.qr_payload).map((t) => [t.tag, t.text]));
  ok(tags2.has(6), 'المرحلة الثانية تحتوي Tag 6 (الهاش)');
  ok(tags2.has(7), 'المرحلة الثانية تحتوي Tag 7 (التوقيع)');
  ok(tags2.has(8), 'المرحلة الثانية تحتوي Tag 8 (المفتاح العام)');
  eq(tags2.get(6), invOther.invoice_hash, 'Tag 6 يساوي هاش الفاتورة');

  // UBL XML وحصانة اللقطات من التعديل اللاحق
  r = await api('GET', `/api/invoices/${inv1.id}/xml`, null, { expectStatus: 200 });
  ok(r.text.includes('<Invoice'), 'تصدير UBL XML');
  ok(r.text.includes(inv1.invoice_number), 'XML يحتوي رقم الفاتورة');
  ok(r.text.includes('<cbc:ID>PIH</cbc:ID>'), 'XML يحتوي مرجع PIH');

  // سلسلة الهاش
  r = await api('GET', `/api/issuers/${issuerP1.id}/verify-chain`, null, { expectStatus: 200 });
  ok(r.body.data.ok, 'التحقق من سلسلة الفواتير سليم', JSON.stringify(r.body.data.problems || []));
  eq(r.body.data.invoices_checked, 2, 'عدد الفواتير المتحقق منها');

  // ------------------------------------------------------------- سندات القبض
  section('سندات القبض والسداد الجزئي');
  r = await api('POST', '/api/vouchers/for-invoice', {
    invoice_id: inv1.id, amount: 400, payment_type: 'TRANSFER', reference_no: 'TRX-1',
  }, { expectStatus: 200 });
  const v1 = r.body.data;
  near(v1.total_amount, 400, 'مبلغ السند');
  eq(v1.allocations.length, 1, 'توزيع السند على فاتورة واحدة');

  r = await api('GET', `/api/invoices/${inv1.id}`, null, { expectStatus: 200 });
  eq(r.body.data.status, 'PARTIAL', 'الفاتورة أصبحت مسددة جزئياً');
  near(r.body.data.paid_amount, 400, 'المسدد 400');
  near(r.body.data.remaining_amount, 565.14, 'المتبقي بعد السداد الجزئي');

  // رفض توزيع أكبر من المتبقي
  r = await api('POST', '/api/vouchers', {
    issuer_id: issuerP1.id, client_id: client.id, total_amount: 10000,
    allocations: [{ invoice_id: inv1.id, amount: 9000 }],
  });
  eq(r.status, 400, 'رفض توزيع يتجاوز المتبقي على الفاتورة');

  // سند مجمع بتوزيع آلي على كل الفواتير المفتوحة
  r = await api('GET', `/api/invoices/open?client_id=${client.id}&issuer_id=${issuerP1.id}`, null, { expectStatus: 200 });
  const open = r.body.data;
  eq(open.length, 2, 'عدد الفواتير المفتوحة');
  const openTotal = open.reduce((s, i) => s + i.remaining_amount, 0);

  r = await api('POST', '/api/vouchers', {
    issuer_id: issuerP1.id, client_id: client.id, total_amount: openTotal,
    payment_type: 'CASH', auto_allocate: true,
  }, { expectStatus: 200 });
  const v2 = r.body.data;
  eq(v2.allocations.length, 2, 'السند المجمع وزّع على فاتورتين');
  near(v2.unallocated, 0, 'لا يوجد مبلغ غير موزّع');

  r = await api('GET', `/api/invoices/${inv1.id}`, null, { expectStatus: 200 });
  eq(r.body.data.status, 'PAID', 'الفاتورة الأولى أصبحت مسددة');
  r = await api('GET', `/api/invoices/${inv2.id}`, null, { expectStatus: 200 });
  eq(r.body.data.status, 'PAID', 'الفاتورة الثانية أصبحت مسددة');

  // سند بفائض غير موزع (M3)
  r = await api('POST', '/api/vouchers', {
    issuer_id: issuerP1.id, client_id: client.id, total_amount: 500,
    payment_type: 'TRANSFER', allocations: [],
  }, { expectStatus: 200 });
  const vSurplus = r.body.data;
  near(vSurplus.unallocated, 500, 'السند يحتوي فائض غير موزع 500 ر.س (M3)');

  // إلغاء سند يعيد الحالة وينشئ قيداً عكسياً (M1)
  r = await api('POST', `/api/vouchers/${v2.id}/cancel`, { reason: 'اختبار' }, { expectStatus: 200 });
  eq(r.body.data.status, 'CANCELLED', 'إلغاء السند');
  r = await api('GET', `/api/invoices/${inv1.id}`, null, { expectStatus: 200 });
  eq(r.body.data.status, 'PARTIAL', 'حالة الفاتورة رجعت لمسددة جزئياً بعد إلغاء السند');

  const vCancelLedger = db.get("SELECT * FROM client_ledger WHERE doc_type = 'RECEIPT_CANCEL' AND doc_id = :id", { id: v2.id });
  ok(!!vCancelLedger, 'تم إنشاء قيد عكسي RECEIPT_CANCEL عند إلغاء السند (M1)');
  eq(vCancelLedger.debit, Math.round(v2.total_amount * 100), 'مبلغ القيد العكسي مدين بمقدار السند');

  // ------------------------------------------------------------- كشف الحساب
  section('كشف الحساب');
  r = await api('GET', `/api/ledger/statement?client_id=${client.id}`, null, { expectStatus: 200 });
  const soa = r.body.data;
  const debit = soa.totals.debit;
  const credit = soa.totals.credit;
  near(credit, 400 + openTotal + 500, 'إجمالي الدائن يشمل السندات المعتمدة وفائض السند');
  near(debit, inv1.grand_total + inv2.grand_total + invOther.grand_total + openTotal, 'إجمالي المدين يشمل الفواتير والقيد العكسي');
  near(soa.totals.closing_balance, (inv1.grand_total + inv2.grand_total + invOther.grand_total) - 400 - 500, 'الرصيد الختامي = مدين - دائن الصافي بعد الإلغاء');
  const balances = soa.entries.map((e) => e.balance_after);
  ok(balances[balances.length - 1] === soa.totals.closing_balance, 'الرصيد التراكمي متسق مع الختامي');

  r = await api('GET', `/api/ledger/statement?client_id=${client.id}&issuer_id=${issuerP1.id}`, null, { expectStatus: 200 });
  const soaIssuer = r.body.data;
  eq(soaIssuer.scope, 'ISSUER', 'كشف حساب مفلتر بمنشأة');
  near(soaIssuer.totals.debit, inv1.grand_total + inv2.grand_total + openTotal, 'المدين المفلتر يشمل فواتير المنشأة وقيد إلغاء السند');
  near(soaIssuer.totals.closing_balance, (inv1.grand_total + inv2.grand_total) - 400 - 500, 'الرصيد الختامي المفلتر بالمنشأة سليم');

  // ------------------------------------------------------------- التوليد الدفعي
  section('محرك التوليد الدفعي الذكي');
  const foodCat = categories.find((c) => c.code === 'CAT-FOOD');
  const bulkClient = (await api('GET', '/api/clients')).body.data.find((c) => c.client_code === 'C-0003');
  const target = 1000000;
  r = await api('POST', '/api/bulk/preview', {
    issuer_id: issuerP1.id,
    client_id: bulkClient.id,
    date_from: '2025-01-01',
    date_to: '2025-03-31',
    count: 50,
    target_total: target,
    category_ids: [foodCat.id],
    min_items: 2,
    max_items: 6,
    min_qty: 1,
    max_qty: 30,
    discount_enabled: true,
    seed: 12345,
  }, { expectStatus: 200 });
  const preview = r.body.data;
  eq(preview.invoices.length, 50, 'عدد الفواتير المولدة');
  near(preview.summary.grand_total, target, 'مجموع الدفعة يطابق الميزانية بدقة', 0.001);
  ok(preview.summary.unique_baskets >= 48, 'سلال الأصناف متنوعة (بدون تكرار نمطي)', `المتنوع ${preview.summary.unique_baskets}`);
  const dates = new Set(preview.invoices.map((i) => i.issue_date));
  ok(dates.size >= 20, 'التواريخ موزعة على أيام متعددة', `عدد الأيام ${dates.size}`);
  const times = new Set(preview.invoices.map((i) => `${i.issue_date}T${i.issue_time}`));
  eq(times.size, 50, 'كل فاتورة بطابع زمني فريد');
  ok(preview.invoices.every((i) => i.issue_date >= '2025-01-01' && i.issue_date <= '2025-03-31'), 'كل التواريخ داخل النطاق');
  const allInRange = preview.invoices.every((i) => i.lines.length >= 2 && i.lines.length <= 6);
  ok(allInRange, 'عدد الأصناف في كل فاتورة داخل الحدود');

  // نفس المفتاح ينتج نفس الدفعة
  r = await api('POST', '/api/bulk/preview', {
    issuer_id: issuerP1.id, client_id: bulkClient.id, date_from: '2025-01-01', date_to: '2025-03-31',
    count: 50, target_total: target, category_ids: [foodCat.id], min_items: 2, max_items: 6,
    min_qty: 1, max_qty: 30, discount_enabled: true, seed: 12345,
  }, { expectStatus: 200 });
  eq(JSON.stringify(r.body.data.invoices), JSON.stringify(preview.invoices), 'نفس مفتاح التوليد ينتج نفس النتيجة');

  // اعتماد الدفعة
  r = await api('POST', '/api/bulk/commit', {
    issuer_id: issuerP1.id, client_id: bulkClient.id, invoices: preview.invoices, options: preview.options,
  }, { expectStatus: 200 });
  const commit = r.body.data;
  eq(commit.count, 50, 'تم حفظ 50 فاتورة');
  near(commit.total_amount, target, 'مجموع الدفعة المحفوظة يطابق الميزانية', 0.001);

  r = await api('GET', `/api/invoices?batch_id=${commit.batch_id}&limit=100`, null, { expectStatus: 200 });
  eq(r.body.data.items.length, 50, 'استرجاع فواتير الدفعة');
  near(r.body.data.totals.grand_total, target, 'مجموع الفواتير المحفوظة من قاعدة البيانات', 0.001);
  const numbers = new Set(r.body.data.items.map((i) => i.invoice_number));
  eq(numbers.size, 50, 'أرقام الفواتير فريدة');

  r = await api('GET', `/api/issuers/${issuerP1.id}/verify-chain`, null, { expectStatus: 200 });
  ok(r.body.data.ok, 'سلسلة الهاش سليمة بعد الدفعة الكبيرة', JSON.stringify(r.body.data.problems || []));
  eq(r.body.data.invoices_checked, 52, 'عدد الفواتير في السلسلة');

  // توليد بميزانية فقط بدون تحديد عدد
  r = await api('POST', '/api/bulk/preview', {
    issuer_id: issuerP1.id, client_id: bulkClient.id, date_from: '2025-04-01', date_to: '2025-04-30',
    target_total: 250000, min_items: 1, max_items: 4, min_qty: 1, max_qty: 10, seed: 777,
  }, { expectStatus: 200 });
  ok(r.body.data.invoices.length > 0, 'التوليد بالميزانية فقط يحدد العدد آلياً', `العدد ${r.body.data.invoices.length}`);
  near(r.body.data.summary.grand_total, 250000, 'مطابقة الميزانية في حالة العدد التلقائي', 0.001);

  // حدود قيمة الفاتورة
  r = await api('POST', '/api/bulk/preview', {
    issuer_id: issuerP1.id, client_id: bulkClient.id, date_from: '2025-05-01', date_to: '2025-05-31',
    count: 20, min_items: 1, max_items: 3, min_qty: 1, max_qty: 5,
    min_invoice_total: 200, max_invoice_total: 2000, seed: 99,
  }, { expectStatus: 200 });
  const bounded = r.body.data.invoices;
  ok(bounded.every((i) => i.grand_total >= 200 && i.grand_total <= 2000), 'كل الفواتير داخل نطاق القيمة المطلوب');

  // مسودات التوليد الدفعي وسندات القبض التلقائية
  const draftPreview = r.body.data;
  r = await api('POST', '/api/bulk/drafts', {
    title: 'مسودة اختبار مايو 2025',
    issuer_id: issuerP1.id,
    client_id: bulkClient.id,
    invoices: draftPreview.invoices,
    options: draftPreview.options,
  }, { expectStatus: 200 });
  const draftObj = r.body.data;
  ok(draftObj.id && draftObj.title === 'مسودة اختبار مايو 2025', 'حفظ مسودة التوليد الدفعي');
  eq(draftObj.invoice_count, 20, 'عدد فواتير المسودة المحفوظة');

  r = await api('GET', `/api/bulk/drafts?issuer_id=${issuerP1.id}`, null, { expectStatus: 200 });
  ok(Array.isArray(r.body.data) && r.body.data.some((d) => d.id === draftObj.id), 'استرجاع قائمة المسودات');

  r = await api('GET', `/api/bulk/drafts/${draftObj.id}`, null, { expectStatus: 200 });
  eq(r.body.data.id, draftObj.id, 'استرجاع تفاصيل المسودة المفردة');
  eq(r.body.data.invoices.length, 20, 'استرجاع فواتير المسودة المفصلة');

  // اعتماد المسودة مع توليد سندات قبض تلقائية (issue_vouchers: true)
  r = await api('POST', '/api/bulk/commit', {
    draft_id: draftObj.id,
    issuer_id: issuerP1.id,
    client_id: bulkClient.id,
    invoices: r.body.data.invoices.slice(0, 5), // اعتماد أول 5 فواتير
    options: r.body.data.options,
    issue_vouchers: true,
  }, { expectStatus: 200 });
  const draftCommit = r.body.data;
  eq(draftCommit.count, 5, 'تم حفظ فواتير المسودة المعتمدة');
  eq(draftCommit.vouchers_count, 5, 'تم إصدار 5 سندات قبض تلقائية مطابقة للفواتير');

  // التحقق من حالة المسودة بعد الاعتماد
  r = await api('GET', `/api/bulk/drafts/${draftObj.id}`, null, { expectStatus: 200 });
  eq(r.body.data.status, 'COMMITTED', 'تحديث حالة المسودة إلى COMMITTED بعد الاعتماد');

  // إنشاء مسودة وحذفها
  r = await api('POST', '/api/bulk/drafts', {
    title: 'مسودة للحذف',
    issuer_id: issuerP1.id,
    client_id: bulkClient.id,
    invoices: draftPreview.invoices.slice(0, 2),
    options: draftPreview.options,
  }, { expectStatus: 200 });
  const draftToDel = r.body.data;
  r = await api('DELETE', `/api/bulk/drafts/${draftToDel.id}`, null, { expectStatus: 200 });
  ok(r.body.ok, 'حذف المسودة بنجاح');

  // ------------------------------------------------------------- التقارير
  section('التقارير وسجل التدقيق');
  r = await api('GET', '/api/reports/dashboard', null, { expectStatus: 200 });
  const dash = r.body.data;
  ok(dash.counts.invoices >= 53, 'لوحة المعلومات تعد الفواتير');
  ok(dash.by_issuer.length >= 3, 'تفصيل حسب المنشأة');
  ok(dash.top_clients.length >= 1, 'أعلى العملاء');

  r = await api('GET', '/api/reports/vat', null, { expectStatus: 200 });
  ok(r.body.data.totals.tax > 0, 'تقرير الضريبة يحسب الضريبة');

  r = await api('GET', '/api/reports/sales?group_by=item', null, { expectStatus: 200 });
  ok(r.body.data.items.length > 0, 'تقرير المبيعات حسب الصنف');

  r = await api('GET', '/api/reports/aging', null, { expectStatus: 200 });
  ok(r.body.data.totals.total > 0, 'تقرير أعمار الذمم');

  r = await api('GET', '/api/audit?limit=500', null, { expectStatus: 200 });
  const actions = new Set(r.body.data.items.map((a) => a.action));
  ok(actions.has('INVOICE_CREATE'), 'سجل التدقيق يسجل إنشاء الفواتير');
  ok(actions.has('BULK_COMMIT'), 'سجل التدقيق يسجل اعتماد الدفعات');
  ok(actions.has('VOUCHER_CANCEL'), 'سجل التدقيق يسجل إلغاء السندات');
  ok(actions.has('LOGIN'), 'سجل التدقيق يسجل الدخول');

  // ------------------------------------------------------------- الصلاحيات
  section('الصلاحيات وحماية التوقيت (RBAC & M6)');
  r = await api('POST', '/api/users', { username: 'viewer1', password: 'Viewer@12345', role: 'VIEWER', full_name: 'مستعرض' }, { expectStatus: 200 });
  const adminCookie = cookie;
  r = await api('POST', '/api/auth/login', { username: 'viewer1', password: 'Viewer@12345' }, { expectStatus: 200 });
  eq(r.body.data.role, 'VIEWER', 'دخول مستخدم مستعرض');
  r = await api('POST', '/api/invoices', { issuer_id: issuerP1.id, client_id: client.id, lines: [{ item_id: rice.id, quantity: 1, unit_price: 10 }] });
  eq(r.status, 403, 'المستعرض لا يستطيع إنشاء فاتورة');
  r = await api('POST', '/api/bulk/preview', { issuer_id: issuerP1.id, client_id: client.id, date_from: '2025-01-01', date_to: '2025-01-31', count: 5 });
  eq(r.status, 403, 'المستعرض لا يستطيع التوليد الدفعي');
  r = await api('GET', '/api/invoices', null, { expectStatus: 200 });
  ok(r.body.data.items.length > 0, 'المستعرض يستطيع العرض');
  r = await api('GET', '/api/users');
  eq(r.status, 403, 'المستعرض لا يستطيع إدارة المستخدمين');

  // إعادة جلسة المدير لإنشاء مستخدم بدون رجوع زمني
  cookie = adminCookie;

  // فحص حراسة وقت الفاتورة بدون صلاحية invoices.backdate (M6)
  r = await api('POST', '/api/users', {
    username: 'creator_nobackdate', password: 'Cre@12345678', role: 'VIEWER',
    permissions: ['invoices.create', 'invoices.view'], full_name: 'منشئ بدون رجوع زمني',
  }, { expectStatus: 200 });
  r = await api('POST', '/api/auth/login', { username: 'creator_nobackdate', password: 'Cre@12345678' }, { expectStatus: 200 });
  r = await api('POST', '/api/invoices', {
    issuer_id: issuerP1.id, client_id: client.id, issue_time: '08:15:30',
    lines: [{ item_id: rice.id, quantity: 1, unit_price: 10 }],
  });
  eq(r.status, 403, 'المستخدم بدون invoices.backdate لا يمكنه تحديد وقت إصدار مخصص (M6)');

  cookie = adminCookie;

  // ------------------------------------------------------------- الإلغاء والحذف
  section('الإلغاء والحذف والقيود وسلامة السلسلة (M1 & M7)');
  r = await api('POST', `/api/invoices/${inv1.id}/cancel`, { reason: 'اختبار' });
  eq(r.status, 409, 'رفض إلغاء فاتورة عليها سند قبض');

  r = await api('DELETE', `/api/clients/${client.id}`);
  eq(r.status, 409, 'رفض حذف عميل له فواتير');
  r = await api('DELETE', `/api/issuers/${issuerP1.id}`);
  eq(r.status, 409, 'رفض حذف منشأة لها فواتير');

  // إنشاء فاتورة وإلغاؤها والتحقق من القيد العكسي (M1)
  r = await api('POST', '/api/invoices', {
    issuer_id: issuerP2.id, client_id: client.id,
    lines: [{ item_id: rice.id, quantity: 1, unit_price: 50 }],
  }, { expectStatus: 200 });
  const disposable = r.body.data;
  r = await api('POST', `/api/invoices/${disposable.id}/cancel`, { reason: 'اختبار الإلغاء' }, { expectStatus: 200 });
  eq(r.body.data.status, 'CANCELLED', 'إلغاء فاتورة بلا سندات');

  const invCancelLedger = db.get("SELECT * FROM client_ledger WHERE doc_type = 'INVOICE_CANCEL' AND doc_id = :id", { id: disposable.id });
  ok(!!invCancelLedger, 'تم إنشاء قيد عكسي INVOICE_CANCEL عند إلغاء الفاتورة (M1)');
  eq(invCancelLedger.credit, Math.round(disposable.grand_total * 100), 'مبلغ القيد العكسي دائن بمقدار الفاتورة');

  // فحص قيود الحذف النهائي (M7)
  // 1. غير المدير يمنع من حذف الفاتورة
  r = await api('POST', '/api/auth/login', { username: 'creator_nobackdate', password: 'Cre@12345678' }, { expectStatus: 200 });
  r = await api('DELETE', `/api/invoices/${disposable.id}`);
  eq(r.status, 403, 'غير المدير ممنوع من حذف الفاتورة نهائياً (M7)');
  cookie = adminCookie;

  // 2. محاولة حذف فاتورة في وسط السلسلة تمنع (inv2 ليست الأخيرة بعد إضافة 50 فاتورة دفعية على issuerP1)
  r = await api('DELETE', `/api/invoices/${inv2.id}`);
  eq(r.status, 409, 'رفض حذف فاتورة غير الأخيرة في السلسلة حفاظاً على الهاش PIH (M7)');

  // 3. حذف الفاتورة الأخيرة في السلسلة ينجح وتظل السلسلة سليمة
  r = await api('POST', '/api/invoices', {
    issuer_id: issuerP2.id, client_id: client.id,
    lines: [{ item_id: rice.id, quantity: 1, unit_price: 20 }],
  }, { expectStatus: 200 });
  const lastP2Inv = r.body.data;
  r = await api('DELETE', `/api/invoices/${lastP2Inv.id}`, null, { expectStatus: 200 });
  ok(r.body.ok, 'حذف الفاتورة الأخيرة في السلسلة ينجح (M7)');
  const chainCheckP2 = (await api('GET', `/api/issuers/${issuerP2.id}/verify-chain`)).body.data;
  ok(chainCheckP2.ok, 'سلسلة الهاش للمنشأة تظل سليمة بعد حذف الفاتورة الأخيرة');

  // ------------------------------------------ حقول ومرشحات إضافية للواجهة
  section('حقول العميل الإضافية ومرشحات البحث');
  r = await api('POST', '/api/clients', {
    name: 'عميل فرد للاختبار', client_type: 'INDIVIDUAL', payment_terms_days: 30, mobile: '0555555555',
  }, { expectStatus: 200 });
  const indiv = r.body.data;
  eq(indiv.client_type, 'INDIVIDUAL', 'حفظ نوع العميل (فرد)');
  eq(indiv.payment_terms_days, 30, 'حفظ مدة السداد');
  r = await api('PUT', `/api/clients/${indiv.id}`, { payment_terms_days: 45 }, { expectStatus: 200 });
  eq(r.body.data.payment_terms_days, 45, 'تعديل مدة السداد');
  eq(r.body.data.client_type, 'INDIVIDUAL', 'نوع العميل يبقى بعد التعديل الجزئي');
  r = await api('DELETE', `/api/clients/${indiv.id}`, null, { expectStatus: 200 });

  r = await api('GET', '/api/invoices?min_total=100000000', null, { expectStatus: 200 });
  eq(r.body.data.total_count, 0, 'مرشح أقل قيمة للفاتورة يستبعد الكل عند حد مرتفع');
  r = await api('GET', '/api/invoices?max_total=0.01', null, { expectStatus: 200 });
  eq(r.body.data.total_count, 0, 'مرشح أعلى قيمة للفاتورة يستبعد الكل عند حد منخفض');
  r = await api('GET', '/api/invoices?created_by=admin', null, { expectStatus: 200 });
  ok(r.body.data.total_count > 0, 'مرشح المستخدم المنشئ يعمل');
  r = await api('GET', '/api/invoices?created_by=nobody-xyz', null, { expectStatus: 200 });
  eq(r.body.data.total_count, 0, 'مرشح المستخدم المنشئ يستبعد غير الموجود');
  r = await api('GET', '/api/invoices?payment_method=CREDIT', null, { expectStatus: 200 });
  ok(r.body.data.items.every((i) => i.payment_method === 'CREDIT'), 'مرشح طريقة الدفع يعمل');

  // مرشحات البحث في الفواتير المتقدمة
  r = await api('GET', `/api/invoices?q=${encodeURIComponent('بسمتي')}`, null, { expectStatus: 200 });
  ok(r.body.data.items.some((i) => i.id === inv1.id), 'البحث في الفواتير باسم الصنف في البنود يجد الفاتورة');
  r = await api('GET', `/api/invoices?q=${encodeURIComponent(client.tax_number)}`, null, { expectStatus: 200 });
  ok(r.body.data.items.some((i) => i.id === inv1.id), 'البحث في الفواتير بالرقم الضريبي للعميل يجد الفاتورة');

  r = await api('GET', '/api/invoices?invoice_type=STANDARD', null, { expectStatus: 200 });
  ok(r.body.data.total_count > 0 && r.body.data.items.every((i) => i.invoice_type === 'STANDARD'), 'مرشح نوع الفاتورة STANDARD يعمل');
  r = await api('GET', '/api/invoices?has_remaining=1', null, { expectStatus: 200 });
  ok(r.body.data.items.every((i) => (i.grand_total - i.paid_amount) > 0.005), 'مرشح الفواتير ذات المتبقي has_remaining=1 يعمل');

  r = await api('GET', '/api/invoices?sort_by=grand_total&sort_dir=ASC', null, { expectStatus: 200 });
  const totalsArr = r.body.data.items.map((i) => i.grand_total);
  ok(totalsArr.every((v, idx, arr) => idx === 0 || arr[idx - 1] <= v), 'ترتيب الفواتير تصاعدياً حسب الإجمالي يعمل');

  // مرشحات سندات القبض
  r = await api('GET', '/api/vouchers?payment_type=TRANSFER', null, { expectStatus: 200 });
  ok(r.body.data.items.length > 0 && r.body.data.items.every((v) => v.payment_type === 'TRANSFER'), 'مرشح سندات القبض بنوع الدفع TRANSFER يعمل');
  r = await api('GET', '/api/vouchers?min_amount=450', null, { expectStatus: 200 });
  ok(r.body.data.items.every((v) => v.total_amount >= 450), 'مرشح سندات القبض بحد أدنى للمبلغ يعمل');
  r = await api('GET', '/api/vouchers?max_amount=420', null, { expectStatus: 200 });
  ok(r.body.data.items.every((v) => v.total_amount <= 420), 'مرشح سندات القبض بحد أقصى للمبلغ يعمل');
  r = await api('GET', '/api/vouchers?from=2020-01-01&to=2099-12-31', null, { expectStatus: 200 });
  ok(r.body.data.total_count > 0, 'مرشح سندات القبض بالنطاق الزمني يعمل');

  // مرشحات العملاء
  r = await api('GET', `/api/clients?city=${encodeURIComponent('الرياض')}`, null, { expectStatus: 200 });
  ok(r.body.data.length > 0 && r.body.data.every((c) => c.city === 'الرياض'), 'مرشح العملاء حسب المدينة يعمل');
  r = await api('GET', '/api/clients?onlyDebtors=true', null, { expectStatus: 200 });
  ok(r.body.data.length > 0 && r.body.data.every((c) => (c.balance || 0) > 0), 'مرشح العملاء المدينين فقط onlyDebtors يعمل');

  // مرشحات الأصناف
  r = await api('GET', '/api/items?status=active', null, { expectStatus: 200 });
  ok(r.body.data.length > 0 && r.body.data.every((it) => it.is_active === true), 'مرشح الأصناف النشطة status=active يعمل');
  r = await api('GET', '/api/items?min_price=1000', null, { expectStatus: 200 });
  ok(r.body.data.length > 0 && r.body.data.every((it) => it.sale_price >= 1000), 'مرشح الأصناف بالحد الأدنى للسعر min_price يعمل');
  r = await api('GET', '/api/items?max_price=30', null, { expectStatus: 200 });
  ok(r.body.data.length > 0 && r.body.data.every((it) => it.sale_price <= 30), 'مرشح الأصناف بالحد الأعلى للسعر max_price يعمل');
  r = await api('GET', '/api/items?q=IT-0001', null, { expectStatus: 200 });
  eq(r.body.data.length, 1, 'البحث في الأصناف بالكود الدقيق يعيد صنفاً واحداً');
  eq(r.body.data[0].item_code, 'IT-0001', 'الصنف المسترجع يطابق الكود المطلوب');


  // ------------------------------------------------------------- إعدادات النظام
  section('إعدادات النظام العامة (M9)');
  r = await api('GET', '/api/settings', null, { expectStatus: 200 });
  eq(r.body.data.currency, 'SAR', 'إعدادات النظام: العملة الافتراضية');
  r = await api('PUT', '/api/settings', { currency: 'SAR', default_tax_rate: 15, bulk_max_invoices: 3000 }, { expectStatus: 200 });
  eq(r.body.data.bulk_max_invoices, 3000, 'تعديل إعدادات النظام عبر PUT /api/settings');

  r = await api('GET', '/api/meta', null, { expectStatus: 200 });
  ok(Array.isArray(r.body.data.permissions) && r.body.data.permissions.length >= 20, 'قائمة الصلاحيات في /api/meta');
  ok(!!r.body.data.permission_labels['invoices.create'], 'أسماء الصلاحيات العربية متوفرة');
  ok(Array.isArray(r.body.data.role_permissions.VIEWER), 'صلاحيات الأدوار متوفرة للواجهة');
  eq(r.body.data.settings.bulk_max_invoices, 3000, 'إعدادات النظام متوفرة في /api/meta');

  ok(db.pluck("SELECT COUNT(*) c FROM pragma_function_list WHERE name = 'json_each'") > 0
    || db.all("SELECT value FROM json_each('[1,2]')").length === 2, 'دعم JSON1 (json_each) متوفر لمحرك التوليد');

  // ------------------------------------------------------------- استيراد وقوالب Excel والجاهزية السحابية
  section('استيراد وقوالب Excel والنسخ الاحتياطي السحابي');
  // 1. فحص الصحة السحابي وقاعدة البيانات
  r = await api('GET', '/api/health', null, { expectStatus: 200 });
  eq(r.body.database, 'connected', 'فحص الصحة يعيد حالة اتصال قاعدة البيانات');

  // 2. تنزيل نماذج Excel و CSV
  r = await api('GET', '/api/invoices/template?format=xls', null, { expectStatus: 200 });
  ok(r.text.includes('<Workbook') && r.text.includes('مجموعة_الفاتورة'), 'تنزيل نموذج Excel بصيغة SpreadsheetML');

  r = await api('GET', '/api/invoices/template?format=csv', null, { expectStatus: 200 });
  ok(r.text.includes('مجموعة_الفاتورة'), 'تنزيل نموذج CSV بنجاح');

  // 3. فحص استيراد الفواتير - وضع المعاينة (Dry Run) مع أخطاء
  const todayIso = new Date().toISOString().slice(0, 10);
  r = await api('POST', '/api/invoices/import', {
    issuer_id: issuerP1.id,
    rows: [
      { group: 'IMP-1', client: 'عميل_غير_موجود_نهائيا', date: todayIso, item: 'صنف', quantity: 1, unit_price: 10 },
      { group: 'IMP-2', client: client.client_code, date: 'تاريخ_خاطئ', item: 'صنف', quantity: -5, unit_price: 10 },
    ],
    dry_run: true,
  }, { expectStatus: 200 });
  eq(r.body.data.valid, false, 'المعاينة ترصد الأخطاء وتحدد valid = false');
  ok(r.body.data.errors.length >= 2, 'رصد خطأ العميل غير الموجود وخطأ التاريخ والكمية السالبة');

  // 4. استيراد فواتير صالحة متعددة البنود مع الاعتماد
  const secondItem = allItems[1] || rice;
  r = await api('POST', '/api/invoices/import', {
    issuer_id: issuerP2.id,
    rows: [
      { group: 'IMP-G1', client: client.client_code, date: todayIso, item: rice.item_code, unit: 'كيس', quantity: 2, unit_price: 50, discount: 0, tax_rate: 15 },
      { group: 'IMP-G1', client: client.client_code, date: todayIso, item: secondItem.item_code, unit: 'حبة', quantity: 1, unit_price: 20, discount: 0, tax_rate: 15 },
      { group: 'IMP-G2', client: client.name, date: todayIso, item: rice.name_ar, unit: 'كيس', quantity: 1, unit_price: 60, discount: 5, tax_rate: 15 },
    ],
    dry_run: false,
  }, { expectStatus: 200 });
  ok(r.body.data.ok, 'نجاح اعتماد استيراد الفواتير');
  eq(r.body.data.imported_count, 2, 'تم إنشاء فاتورتين (إحداهما متعددة البنود والأخرى فردية)');
  ok(r.body.data.total_amount > 0, 'احتساب إجمالي المبالغ المستوردة');

  // 5. التحقق من سلامة السلسلة بعد الاستيراد
  const chainAfterImport = (await api('GET', `/api/issuers/${issuerP2.id}/verify-chain`)).body.data;
  ok(chainAfterImport.ok, 'سلسلة الهاش لـ issuerP2 تظل متماسكة وسليمة بعد الاستيراد');

  // 6. فحص النسخ الاحتياطي لقاعدة البيانات
  r = await api('POST', '/api/auth/login', { username: 'creator_nobackdate', password: 'Cre@12345678' }, { expectStatus: 200 });
  r = await api('GET', '/api/system/backup');
  eq(r.status, 403, 'غير المدير ممنوع من أخذ نسخ احتياطية لقاعدة البيانات');
  cookie = adminCookie;

  r = await api('GET', '/api/system/backup', null, { expectStatus: 200 });
  ok(r.body.ok && r.body.data.sizeBytes > 0, 'مدير النظام ينشئ نسخة احتياطية سالمة');
  ok(r.body.data.filename.endsWith('.db'), 'ملف النسخة الاحتياطية يحمل امتداد .db');

  r = await api('GET', '/api/system/backup?download=1', null, { expectStatus: 200 });
  ok(r.status === 200, 'تنزيل ملف النسخة الاحتياطية بنجاح عبر API');

  // ------------------------------------------------------------- قوالب الطباعة والتفقيط
  section('قوالب الطباعة (A4 والحراري وسند القبض وكشف الحساب) والتفقيط');
  fs.cpSync(path.join(__dirname, '..', 'public', 'js'), path.join(tmpDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"module"}');
  globalThis.ZQR = require('../public/js/vendor/zqr.js');

  const { pathToFileURL } = require('node:url');
  const { invoiceA4, invoiceThermal, voucherPrint, statementPrint, tafqeet, INVOICE_TEMPLATES, invoicePreviewDoc } = await import(
    pathToFileURL(path.join(tmpDir, 'js', 'print', 'templates.js')).href
  );

  function checkPrintDoc(name, doc, mustContain) {
    ok(doc.startsWith('<!DOCTYPE html>'), `${name}: مستند HTML كامل`);
    ok(doc.includes('dir="rtl"'), `${name}: اتجاه RTL`);
    ok(/@page\s*\{/.test(doc), `${name}: يحتوي قواعد @page للطباعة`);
    ok(!/undefined/.test(doc), `${name}: لا يحتوي كلمة undefined`);
    ok(!/NaN/.test(doc), `${name}: لا يحتوي NaN`);
    ok(!/\[object Object\]/.test(doc), `${name}: لا يحتوي [object Object]`);
    const opens = (doc.match(/<(table|tr|td|div)\b/g) || []).length;
    const closes = (doc.match(/<\/(table|tr|td|div)>/g) || []).length;
    ok(opens === closes, `${name}: توازن الوسوم (${opens} مفتوح / ${closes} مغلق)`);
    for (const s of mustContain) ok(doc.includes(s), `${name}: يحتوي «${s}»`);
    return doc;
  }

  const printInv = (await api('GET', `/api/invoices/${inv1.id}`)).body.data;
  const printIssuer = (await api('GET', `/api/issuers/${printInv.issuer_id}`)).body.data;
  const printClient = (await api('GET', `/api/clients/${printInv.client_id}`)).body.data;

  const a4Doc = checkPrintDoc(`A4 ${printInv.invoice_number}`, invoiceA4({ invoice: printInv, issuer: printIssuer, client: printClient }), [
    'فاتورة ضريبية', printInv.invoice_number, printIssuer.name_ar, printClient.name,
    '<svg', 'الإجمالي المستحق', 'ضريبة القيمة المضافة',
  ]);
  ok(a4Doc.includes(printIssuer.tax_number), 'A4: طباعة الرقم الضريبي للبائع');

  const thermalDoc = checkPrintDoc(`80mm ${printInv.invoice_number}`, invoiceThermal({ invoice: printInv, issuer: printIssuer, client: printClient }), [
    'size: 80mm auto', printInv.invoice_number, '<svg',
  ]);
  ok(thermalDoc.includes('80mm'), '80mm: عرض 80 مم للحراري');

  const twoCopies = invoiceA4({ invoice: printInv, issuer: printIssuer, client: printClient, copies: 2 });
  ok((twoCopies.match(/class="page"/g) || []).length === 2, 'A4: طباعة نسختين في مستند واحد');

  // سند القبض
  const printVoucher = (await api('GET', `/api/vouchers/${v1.id}`)).body.data;
  const voucherDoc = checkPrintDoc(`سند ${printVoucher.voucher_number}`, voucherPrint({ voucher: printVoucher, issuer: printIssuer, client: printClient }), [
    'سند قبض', printVoucher.voucher_number, printClient.name, 'استلمنا من',
  ]);
  ok(voucherDoc.includes('فقط'), 'سند: تفقيط المبلغ بالعربية');

  // كشف الحساب
  const printStmt = (await api('GET', `/api/ledger/statement?client_id=${printClient.id}`)).body.data;
  const stmtDoc = checkPrintDoc('كشف حساب', statementPrint({ statement: printStmt, issuer: printIssuer, client: printStmt.client }), [
    'كشف حساب عميل', printStmt.client.name, 'الرصيد الافتتاحي', 'الرصيد المستحق',
  ]);
  ok(stmtDoc.includes('A4 landscape'), 'كشف حساب: تنسيق أفقي A4 landscape');

  // تفقيط الأرقام بالعربية
  const tafqeetCases = [
    [0, 'صفر'], [1, 'واحد'], [2, 'اثنان'], [11, 'أحد عشر'], [21, 'واحد وعشرون'],
    [100, 'مئة'], [1000, 'ألف'], [2000, 'ألفان'], [1000000, 'مليون'],
  ];
  for (const [val, exp] of tafqeetCases) {
    const tTxt = tafqeet(val);
    ok(tTxt.includes(exp), `تفقيط ${val} يحتوي «${exp}» (${tTxt})`);
  }
  ok(tafqeet(1234.56).includes('هللة'), 'تفقيط أجزاء الهللات');

  // استوديو قوالب الفواتير وإعدادات الطباعة
  ok(Array.isArray(INVOICE_TEMPLATES) && INVOICE_TEMPLATES.length >= 5, 'تصدير مصفوفة قوالب الفواتير المعتمدة (A4 والحراري)');
  const modernDoc = invoicePreviewDoc({
    invoice: printInv,
    issuer: printIssuer,
    client: printClient,
    printSettings: { template_style: 'modern', primary_color: '#2563eb' },
  });
  ok(modernDoc.includes('data-tpl="modern"'), 'معاينة القالب العصري Modern Clean بنجاح');
  ok(modernDoc.includes('#2563eb'), 'تطبيق اللون الأزرق المخصص في نمط الطباعة');

  // حفظ واسترجاع إعدادات الطباعة للمنشأة عبر الـ API
  r = await api('PUT', `/api/issuers/${printIssuer.id}`, {
    print_settings: {
      template_style: 'modern',
      primary_color: '#2563eb',
      font_family: 'Cairo',
      show_item_code: false,
    },
  }, { expectStatus: 200 });
  eq(r.body.data.print_settings.template_style, 'modern', 'حفظ نمط القالب في إعدادات المنشأة عبر API');
  eq(r.body.data.print_settings.primary_color, '#2563eb', 'حفظ اللون المخصص للمنشأة');
  eq(r.body.data.print_settings.show_item_code, false, 'حفظ خيارات إخفاء الأعمدة للمنشأة');

  // ------------------------------------------------------------- تحقق ختامي من الأرصدة
  section('الاتساق المالي العام');
  const invAgg = db.get("SELECT COALESCE(SUM(grand_total),0) t, COALESCE(SUM(paid_amount),0) p FROM invoices WHERE status <> 'CANCELLED'");
  const activeVouchers = db.get("SELECT COALESCE(SUM(total_amount),0) t FROM receipt_vouchers WHERE status = 'ACTIVE'");
  const openingAgg = db.get("SELECT (COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0)) net FROM client_ledger WHERE doc_type = 'OPENING_BALANCE'");
  const ledgerNet = db.get("SELECT (COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0)) net FROM client_ledger");
  eq(ledgerNet.net, invAgg.t + openingAgg.net - activeVouchers.t, 'صافي كشف الحساب يطابق تماماً صافي الفواتير النشطة والأرصدة الافتتاحية مطروحاً منها السندات النشطة');
  const allocSum = db.get("SELECT COALESCE(SUM(a.allocated_amount),0) s FROM voucher_allocations a JOIN receipt_vouchers v ON v.id = a.voucher_id WHERE v.status='ACTIVE'");
  eq(invAgg.p, allocSum.s, 'مجموع المسدد على الفواتير = مجموع المخصصات النشطة');

  await new Promise((resolve) => server.close(resolve));
  db.close();

  console.log('\n----------------------------------------------');
  if (failed === 0) {
    console.log(`نجحت جميع الاختبارات: ${passed}/${passed}`);
  } else {
    console.log(`نجح ${passed} وفشل ${failed}:`);
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('----------------------------------------------');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('فشل تشغيل الاختبارات:', err);
  process.exit(1);
});
