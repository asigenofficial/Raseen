// ==========================================================================
//  فحص قوالب الطباعة بمعطيات حقيقية من الخادم المشغّل.
//  التشغيل: node tests/print.check.mjs [http://127.0.0.1:4711]
// ==========================================================================
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.ZQR = require(path.join(ROOT, 'public', 'js', 'vendor', 'zqr.js'));

/**
 * وحدات الواجهة ES modules بينما جذر المشروع commonjs، لذلك نُنسخ الشجرة
 * إلى مجلد مؤقت يحمل package.json من نوع module ثم نستوردها منه.
 */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-print-'));
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(SANDBOX, 'js'), { recursive: true });
fs.writeFileSync(path.join(SANDBOX, 'package.json'), '{"type":"module"}');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* ignore */ } });

const BASE = process.argv[2] || 'http://127.0.0.1:4711';
let problems = 0;
let checks = 0;
const fail = (m) => { problems++; console.log(`  ✗ ${m}`); };
const ok = (cond, m) => { checks++; if (!cond) fail(m); };

// ---------------------------------------------------------------- الجلسة
let cookie = '';
async function call(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) cookie = c.split(';')[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.data;
}

const { invoiceA4, invoiceThermal, voucherPrint, statementPrint, tafqeet } = await import(
  pathToFileURL(path.join(SANDBOX, 'js', 'print', 'templates.js')).href
);

function checkDoc(name, doc, mustContain) {
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

console.log(`فحص قوالب الطباعة مقابل ${BASE}`);
await call('POST', '/api/auth/login', { username: 'admin', password: 'Admin@12345' });

let list = await call('GET', '/api/invoices?limit=5');
if (!list.items || !list.items.length) {
  const issuers = await call('GET', '/api/issuers');
  const clients = await call('GET', '/api/clients');
  const items = await call('GET', '/api/items?limit=2');
  if (issuers.length && clients.length && items.length) {
    const inv = await call('POST', '/api/invoices', {
      issuer_id: issuers[0].id,
      client_id: clients[0].id,
      payment_method: 'CASH',
      lines: [
        { item_id: items[0].id, quantity: 2, unit_price: items[0].sale_price || 50, tax_rate: 15 },
      ],
    });
    list = { items: [inv] };
  } else {
    console.log('لا توجد فواتير في قاعدة البيانات ولا توجد بيانات أساسية كافية.');
    process.exit(1);
  }
}

const outDir = path.join(ROOT, 'data', 'print-preview');
const DUMP = process.argv.includes('--dump');
if (DUMP) fs.mkdirSync(outDir, { recursive: true });
/** حفظ نسخة معاينة على القرص عند تمرير ‎--dump‎ فقط. */
const dump = (name, doc) => { if (DUMP) fs.writeFileSync(path.join(outDir, name), doc); };

for (const head of list.items.slice(0, 3)) {
  const invoice = await call('GET', `/api/invoices/${head.id}`);
  const issuer = await call('GET', `/api/issuers/${invoice.issuer_id}`);
  const client = await call('GET', `/api/clients/${invoice.client_id}`);

  const a4 = checkDoc(`A4 ${invoice.invoice_number}`, invoiceA4({ invoice, issuer, client }), [
    'فاتورة ضريبية', invoice.invoice_number, issuer.name_ar, client.name,
    '<svg', 'الإجمالي المستحق', 'ضريبة القيمة المضافة',
  ]);
  ok(a4.includes(issuer.tax_number), `A4 ${invoice.invoice_number}: الرقم الضريبي للبائع`);
  ok((a4.match(/<tbody>/g) || []).length >= 1, `A4 ${invoice.invoice_number}: جدول البنود`);
  ok(invoice.lines.every((l) => a4.includes(l.item_name)), `A4 ${invoice.invoice_number}: كل البنود مطبوعة`);

  const th = checkDoc(`80mm ${invoice.invoice_number}`, invoiceThermal({ invoice, issuer, client }), [
    'size: 80mm auto', invoice.invoice_number, '<svg',
  ]);
  ok(th.includes('80mm'), `80mm ${invoice.invoice_number}: عرض 80 مم`);

  const two = invoiceA4({ invoice, issuer, client, copies: 2 });
  ok((two.match(/class="page"/g) || []).length === 2, `A4 ${invoice.invoice_number}: نسختان في مستند واحد`);

  dump(`invoice-${invoice.invoice_number}-a4.html`, a4);
  dump(`invoice-${invoice.invoice_number}-80mm.html`, th);
}

// --------------------------------------------------------------- السندات
let vouchers = await call('GET', '/api/vouchers?limit=2');
if ((!vouchers.items || !vouchers.items.length) && list.items.length) {
  const inv = await call('GET', `/api/invoices/${list.items[0].id}`);
  if (inv.remaining_amount > 0) {
    const vc = await call('POST', '/api/vouchers/for-invoice', {
      invoice_id: inv.id,
      amount: Math.min(50, inv.remaining_amount),
      payment_type: 'CASH',
      voucher_date: new Date().toISOString().slice(0, 10),
      notes: 'سند فحص الطباعة المؤتمت',
    });
    vouchers = { items: [vc] };
  }
}
for (const vh of (vouchers.items || [])) {
  const voucher = await call('GET', `/api/vouchers/${vh.id}`);
  const issuer = await call('GET', `/api/issuers/${voucher.issuer_id}`);
  const client = await call('GET', `/api/clients/${voucher.client_id}`);
  const doc = checkDoc(`سند ${voucher.voucher_number}`, voucherPrint({ voucher, issuer, client }), [
    'سند قبض', voucher.voucher_number, client.name, 'استلمنا من',
  ]);
  ok(doc.includes('فقط'), `سند ${voucher.voucher_number}: تفقيط المبلغ`);
  if (voucher.allocations.length) {
    ok(voucher.allocations.every((a) => doc.includes(a.invoice_number)),
      `سند ${voucher.voucher_number}: كل الفواتير المسددة مطبوعة`);
  }
  dump(`voucher-${voucher.voucher_number}.html`, doc);
}

// ----------------------------------------------------------- كشف الحساب
const clients = await call('GET', '/api/clients?with_balances=1');
const target = clients.find((c) => c.balance) || clients[0];
for (const scope of ['', clients.length ? (await call('GET', '/api/issuers'))[0].id : '']) {
  const st = await call('GET', `/api/ledger/statement?client_id=${target.id}${scope ? `&issuer_id=${scope}` : ''}`);
  const issuer = scope ? await call('GET', `/api/issuers/${scope}`) : null;
  const doc = checkDoc(`كشف حساب ${scope ? 'مقيّد' : 'موحّد'}`, statementPrint({ statement: st, issuer, client: st.client }), [
    'كشف حساب عميل', st.client.name, 'الرصيد الافتتاحي', 'الرصيد المستحق',
  ]);
  ok(doc.includes('A4 landscape'), `كشف ${scope ? 'مقيّد' : 'موحّد'}: تنسيق أفقي`);
  ok(st.entries.every((e) => !e.doc_number || doc.includes(e.doc_number)),
    `كشف ${scope ? 'مقيّد' : 'موحّد'}: كل أرقام المستندات مطبوعة`);
  dump(`statement-${scope ? 'issuer' : 'all'}.html`, doc);
}

// -------------------------------------------------------------- التفقيط
const cases = [
  [0, 'صفر'], [1, 'واحد'], [2, 'اثنان'], [11, 'أحد عشر'], [21, 'واحد وعشرون'],
  [100, 'مئة'], [1000, 'ألف'], [2000, 'ألفان'], [1000000, 'مليون'],
];
for (const [value, expect] of cases) {
  const text = tafqeet(value);
  ok(text.includes(expect), `تفقيط ${value} يحتوي «${expect}» (النتيجة: ${text})`);
}
ok(tafqeet(1234.56).includes('هللة'), 'تفقيط الهللات');
ok(tafqeet(750000).includes('سبعمئة') && tafqeet(750000).includes('خمسون'), 'تفقيط 750000');

console.log(`\nتم تنفيذ ${checks} تحققاً${DUMP ? " — ملفات المعاينة في data/print-preview" : ""}.`);
if (problems) {
  console.log(`فشل ${problems} تحققاً.`);
  process.exit(1);
}
console.log('كل قوالب الطباعة سليمة.');
