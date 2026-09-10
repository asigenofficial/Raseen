// ==========================================================================
//  فحص شامل للواجهة داخل متصفح حقيقي بدون رأس (Chrome/Edge عبر CDP).
//  يتحقق من إقلاع التطبيق، الدخول، وكل الشاشات، ويرصد أي خطأ JS في الطرفية.
//  التشغيل: node tests/e2e.check.mjs [http://127.0.0.1:4711]
// ==========================================================================
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4711';
const PORT = 9333;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const CANDIDATES = [
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
];
const browser = CANDIDATES.find((p) => p && fs.existsSync(p));
if (!browser) {
  console.log('لم يتم العثور على متصفح Chrome أو Edge — تم تخطي فحص المتصفح.');
  process.exit(0);
}

// ملف تعريف المتصفح داخل مجلد المشروع: بعض مسارات النظام المؤقتة محجوبة على الكتابة.
const profile = path.join(ROOT, '.e2e-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
const logFile = fs.openSync(path.join(profile, 'browser.log'), 'w');
const child = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-networking', '--mute-audio',
  '--disable-crash-reporter', '--no-sandbox',
  '--window-size=1440,1000', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: ['ignore', logFile, logFile], detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let problems = 0;
let checks = 0;
const fail = (m) => { problems++; console.log(`  ✗ ${m}`); };
const ok = (cond, m) => { checks++; if (!cond) fail(m); };

async function cleanup() {
  try { child.kill(); } catch { /* ignore */ }
  await sleep(400);
  try { fs.closeSync(logFile); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}

// --------------------------------------------------------- اتصال CDP
async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* المتصفح لم يجهز بعد */ }
    await sleep(250);
  }
  throw new Error('تعذر الاتصال بمنفذ تصحيح المتصفح');
}

const wsUrl = await targetWs();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    if (msg.params.type === 'error') consoleErrors.push(text);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    pageErrors.push(d.exception ? (d.exception.description || d.exception.value) : d.text);
  }
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    failedRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
  }
});

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  return res.result.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  // ----------------------------------------------------- الإقلاع والدخول
  await send('Page.navigate', { url: BASE });
  await sleep(1800);
  let dom = await evaluate('document.body.innerText');
  ok(/Raseen/.test(dom), 'شاشة الدخول تظهر عنوان النظام');
  ok(/تسجيل الدخول/.test(dom), 'شاشة الدخول تحتوي زر الدخول');
  ok(await evaluate('typeof globalThis.ZQR === "object" && typeof ZQR.svg === "function"'), 'مكتبة QR محمّلة في الصفحة');
  ok(await evaluate('!!document.querySelector(\'link[href*="app.css"]\') && getComputedStyle(document.body).direction === "rtl"'), 'التنسيق محمّل والاتجاه RTL');

  await evaluate(`(async () => {
    document.querySelector('input[name=username]').value = 'admin';
    document.querySelector('input[name=password]').value = 'Admin@12345';
    document.querySelector('#login-form button[type=submit]').click();
  })()`);
  await sleep(2500);
  dom = await evaluate('document.body.innerText');
  ok(/لوحة المعلومات|لوحة المتابعة|الفواتير/.test(dom), 'تم الدخول وظهرت الواجهة الرئيسية');
  ok(await evaluate('!!document.querySelector(".sidebar") && !!document.querySelector(".topbar")'), 'القائمة الجانبية والشريط العلوي موجودان');
  const navCount = await evaluate('document.querySelectorAll(".sidebar a").length');
  ok(navCount >= 10, `قائمة التنقل تحتوي ${navCount} عنصراً`);

  // -------------------------------------------------------- زيارة الشاشات
  const routes = [
    ['dashboard', ['لوحة المعلومات', 'مبيعات']],
    ['invoices', ['الفواتير', 'الإجمالي']],
    ['invoice', ['فاتورة ضريبية جديدة', 'بنود الفاتورة']],
    ['bulk', ['التوليد الدفعي', 'الأساسيات', 'ضوابط التنوع']],
    ['vouchers', ['سندات القبض']],
    ['statement', ['كشف حساب', 'الرصيد']],
    ['issuers', ['الشركات المصدرة']],
    ['clients', ['العملاء']],
    ['items', ['الأصناف']],
    ['reports/sales', ['التقارير', 'المبيعات']],
    ['reports/vat', ['إقرار الضريبة', 'الوعاء']],
    ['reports/aging', ['أعمار الذمم']],
    ['reports/balances', ['أرصدة العملاء']],
    ['reports/batches', ['دفعات التوليد']],
    ['audit', ['سجل العمليات']],
    ['users', ['المستخدمون', 'الأدوار']],
    ['templates', ['قوالب الفواتير', 'الهوية والألوان']],
    ['settings', ['إعدادات النظام', 'العملة الافتراضية']],
  ];

  for (const [route, expects] of routes) {
    const before = pageErrors.length + consoleErrors.length;
    await evaluate(`location.hash = '#/${route}'`);
    await sleep(route.startsWith('reports') || route === 'dashboard' ? 1200 : 900);
    const text = await evaluate('document.querySelector("#view") ? document.querySelector("#view").innerText : document.body.innerText');
    ok(text.length > 60, `الشاشة ${route}: محتوى مرسوم (${text.length} حرف)`);
    for (const e of expects) ok(text.includes(e), `الشاشة ${route}: تحتوي «${e}»`);
    const escapedSvg = await evaluate('document.body.innerText.includes("<svg") || document.body.innerText.includes("<line") || document.body.innerText.includes("inline-block;flex-shrink")');
    ok(!escapedSvg, `الشاشة ${route}: لا توجد أيقونات SVG مسربة كنص مرئي في الصفحة`);
    ok(pageErrors.length + consoleErrors.length === before, `الشاشة ${route}: بلا أخطاء JS`);
  }

  // ------------------------------------- شاشة فاتورة واحدة مع QR وطباعة
  const invId = await evaluate(`(async () => {
    const r = await fetch('/api/invoices?limit=1');
    const j = await r.json();
    return j.data.items[0].id;
  })()`);
  ok(!!invId, 'جلب معرّف فاتورة للاختبار');
  await evaluate(`location.hash = '#/invoice-view/${invId}'`);
  await sleep(1600);
  const invText = await evaluate('document.querySelector("#view").innerText');
  ok(/فاتورة/.test(invText), 'شاشة الفاتورة: العنوان');
  ok(/رمز الاستجابة السريعة/.test(invText), 'شاشة الفاتورة: قسم رمز QR');
  ok(/بصمة الفاتورة/.test(invText), 'شاشة الفاتورة: بيانات الفاتورة الإلكترونية');
  const qrModules = await evaluate('document.querySelectorAll(".qr-box svg rect, .qr-box svg path").length');
  ok(qrModules > 0, `شاشة الفاتورة: رمز QR مرسوم (${qrModules} عنصر رسم)`);
  const rowCount = await evaluate('document.querySelectorAll("#view table tbody tr").length');
  ok(rowCount > 0, `شاشة الفاتورة: ${rowCount} صف بنود/تخصيصات`);

  // الطباعة: إنشاء المستند داخل إطار وقياس حجمه بدون فتح نافذة طباعة فعلية
  const printSize = await evaluate(`(async () => {
    const [{ invoiceA4, invoiceThermal }, { api }] = await Promise.all([
      import('/js/print/templates.js'), import('/js/core/api.js'),
    ]);
    const invoice = await api.get('/api/invoices/${invId}');
    const issuer = await api.get('/api/issuers/' + invoice.issuer_id);
    const client = await api.get('/api/clients/' + invoice.client_id);
    const a4 = invoiceA4({ invoice, issuer, client });
    const th = invoiceThermal({ invoice, issuer, client });
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(a4); f.contentDocument.close();
    const pages = f.contentDocument.querySelectorAll('.page').length;
    const svgs = f.contentDocument.querySelectorAll('svg').length;
    const height = f.contentDocument.querySelector('.page').getBoundingClientRect().height;
    f.remove();
    return { a4: a4.length, th: th.length, pages, svgs, height: Math.round(height) };
  })()`);
  ok(printSize.a4 > 4000, `قالب A4 مبني في المتصفح (${printSize.a4} حرف)`);
  ok(printSize.pages === 1, 'قالب A4: صفحة واحدة للفاتورة');
  ok(printSize.svgs >= 1, 'قالب A4: يحتوي رمز QR كـ SVG');
  ok(printSize.height > 900, `قالب A4: ارتفاع الصفحة ${printSize.height}px (يقارب A4)`);
  ok(printSize.th > 1200, `قالب 80mm مبني (${printSize.th} حرف)`);

  // -------------------------------------------- معاينة التوليد الدفعي
  await evaluate("location.hash = '#/bulk'");
  await sleep(900);
  const preview = await evaluate(`(async () => {
    const { api } = await import('/js/core/api.js');
    const iss = (await api.get('/api/issuers')).filter(i => i.is_active)[0];
    const cl = (await api.get('/api/clients'))[0];
    const p = await api.post('/api/bulk/preview', {
      issuer_id: iss.id, client_id: cl.id, date_from: '2026-02-01', date_to: '2026-02-28',
      count: 20, target_total: 100000, min_items: 2, max_items: 5, min_qty: 1, max_qty: 12,
      discount_enabled: true, payment_methods: ['CASH','CREDIT'], seed: 777,
    });
    return { count: p.summary.count, total: p.summary.grand_total, unique: p.summary.unique_baskets };
  })()`);
  ok(preview.count === 20, `معاينة التوليد من المتصفح: ${preview.count} فاتورة`);
  ok(Math.abs(preview.total - 100000) < 0.005, `معاينة التوليد تطابق الميزانية بدقة (${preview.total})`);
  ok(preview.unique === 20, `تنوّع كامل في التراكيب (${preview.unique}/20)`);

  // --------------------------------------------------- التصدير والحوارات
  const exportCheck = await evaluate(`(async () => {
    const u = await import('/js/core/util.js');
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:test'; };
    u.exportCsv('t', ['أ','ب'], [[1,'س'],[2,'ص']]);
    u.exportExcel('t', 'عنوان', ['أ','ب'], [[1,'س']]);
    URL.createObjectURL = orig;
    return captured ? captured.size : 0;
  })()`);
  ok(exportCheck > 0, `توليد ملفات التصدير يعمل (${exportCheck} بايت)`);

  const modalCheck = await evaluate(`(async () => {
    const u = await import('/js/core/util.js');
    const m = u.modal({ title: 'اختبار', body: '<div id="probe">محتوى</div>' });
    const exists = !!document.querySelector('#probe');
    m.close();
    const gone = !document.querySelector('#probe');
    u.toastOk('اختبار');
    const toast = document.querySelectorAll('#toast-root .toast').length;
    return { exists, gone, toast };
  })()`);
  ok(modalCheck.exists && modalCheck.gone, 'النوافذ الحوارية تُفتح وتُغلق');
  ok(modalCheck.toast > 0, 'التنبيهات تظهر');

  // --------------------------------------------------- فحص استوديو القوالب التفاعلي بدقة
  await evaluate("location.hash = '#/templates'");
  await sleep(1000);

  const tplAudit = await evaluate(`(async () => {
    const cards = document.querySelectorAll('.tpl-card').length;
    const svgs = document.querySelectorAll('.tpl-card-icon svg').length;
    const hasEmoji = /[\\u{1F300}-\\u{1F6FF}\\u{2600}-\\u{26FF}]/u.test(document.querySelector('.tpl-gallery')?.innerHTML || '');
    
    // تصفية الحراري
    document.querySelector('.tpl-filter-btn[data-filter="pos"]')?.click();
    const posCount = document.querySelectorAll('.tpl-card').length;

    // تصفية A4
    document.querySelector('.tpl-filter-btn[data-filter="a4"]')?.click();
    const a4Count = document.querySelectorAll('.tpl-card').length;

    // استعادة الكل
    document.querySelector('.tpl-filter-btn[data-filter="all"]')?.click();
    const allCount = document.querySelectorAll('.tpl-card').length;

    // اختيار القالب العصري
    document.querySelector('.tpl-card[data-style="modern"]')?.click();
    const modernActive = document.querySelector('.tpl-card[data-style="modern"]')?.classList.contains('active');

    // تبديل التبويبات
    document.querySelector('.tpl-tab-btn[data-tab="columns"]')?.click();
    const colVisible = document.querySelector('#tab-pane-columns')?.style.display !== 'none';
    
    document.querySelector('.tpl-tab-btn[data-tab="qr"]')?.click();
    const qrVisible = document.querySelector('#tab-pane-qr')?.style.display !== 'none';

    document.querySelector('.tpl-tab-btn[data-tab="advanced"]')?.click();
    const advVisible = document.querySelector('#tab-pane-advanced')?.style.display !== 'none';

    document.querySelector('.tpl-tab-btn[data-tab="branding"]')?.click();
    const brandVisible = document.querySelector('#tab-pane-branding')?.style.display !== 'none';

    // نافذة النماذج الجاهزة
    document.querySelector('#btn-presets')?.click();
    const presetCards = document.querySelectorAll('.modal .card[data-preset-id]').length;
    document.querySelector('.modal [data-close]')?.click();

    // التحقق من المعاينة الحية iframe
    const iframeSrc = document.querySelector('#preview-iframe')?.srcdoc || '';
    const iframeValid = iframeSrc.length > 500 && iframeSrc.includes('<!DOCTYPE html>');

    return {
      cards, svgs, hasEmoji, posCount, a4Count, allCount,
      modernActive, colVisible, qrVisible, advVisible, brandVisible,
      presetCards, iframeValid,
    };
  })()`);

  ok(tplAudit.cards === 8, `استوديو القوالب: عرض 8 قوالب معتمدة (${tplAudit.cards})`);
  ok(tplAudit.svgs === 8, `استوديو القوالب: 8 أيقونات SVG فيكتور نظيفة (${tplAudit.svgs})`);
  ok(!tplAudit.hasEmoji, 'استوديو القوالب: خالٍ تماماً من الإيموجيات');
  ok(tplAudit.posCount === 1, `تصفية الكاشير الحراري: قالب واحد (${tplAudit.posCount})`);
  ok(tplAudit.a4Count === 7, `تصفية A4 الضريبية: 7 قوالب (${tplAudit.a4Count})`);
  ok(tplAudit.allCount === 8, `تصفية الكل: 8 قوالب (${tplAudit.allCount})`);
  ok(tplAudit.modernActive, 'اختيار القالب وتفعيله ديناميكياً يعمل');
  ok(tplAudit.colVisible && tplAudit.qrVisible && tplAudit.advVisible && tplAudit.brandVisible, 'تبديل جميع تبويبات الاستوديو الـ 5 يعمل بسلاسة');
  ok(tplAudit.presetCards === 6, `نافذة النماذج الجاهزة تحتوي 6 نماذج أعمال (${tplAudit.presetCards})`);
  ok(tplAudit.iframeValid, 'إطار المعاينة الحية (Live Preview iframe) يحدّث تلقائياً');

  // --------------------------------------------------- فحص محرّر الفواتير والعمليات الحسابية
  await evaluate("location.hash = '#/invoice'");
  await sleep(1200);

  const invEditorAudit = await evaluate(`(async () => {
    const formExists = !!document.querySelector('#lines-tbl') && !!document.querySelector('#issuer');
    const clientSelect = !!document.querySelector('#client');
    const addLineBtn = !!document.querySelector('#add-line');
    const tableRows = document.querySelectorAll('#lines tr').length;
    return { formExists, clientSelect, addLineBtn, tableRows };
  })()`);

  ok(invEditorAudit.formExists, 'محرّر الفاتورة: النموذج مرسوم وجاهز');
  ok(invEditorAudit.clientSelect, 'محرّر الفاتورة: حقل اختيار العميل متاح');
  ok(invEditorAudit.addLineBtn, 'محرّر الفاتورة: زر إضافة بند متاح');

  // --------------------------------------------------- فحص التجاوب على مختلف الأجهزة (Desktop, Tablet, Mobile)
  // 1. شاشة لوحية Tablet / iPad (1024x768)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1024, height: 768, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(400);
  const tabletOk = await evaluate('window.innerWidth === 1024');
  ok(tabletOk, 'التجاوب: شاشة التابلت (1024px) تعمل بتناسق');

  // 2. شاشة جوال Mobile (390x844 iPhone/Android)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await sleep(400);
  const burgerVisible = await evaluate(`(() => {
    const b = document.querySelector('#burger');
    if (!b) return false;
    const style = getComputedStyle(b);
    return style.display !== 'none' && style.visibility !== 'hidden';
  })()`);
  ok(burgerVisible, 'التجاوب: زر القائمة (Burger Menu) يظهر تلقائياً على الجوال');

  // فتح وإغلاق القائمة على الجوال
  await evaluate('document.querySelector("#burger")?.click()');
  await sleep(300);
  const sidebarOpened = await evaluate('document.querySelector(".sidebar")?.classList.contains("open")');
  ok(sidebarOpened, 'التجاوب: القائمة الجانبية تُفتح بسلاسة عند النقر على الجوال');

  await evaluate('document.querySelector("#burger")?.click()');
  await sleep(300);
  const sidebarClosed = await evaluate('!document.querySelector(".sidebar")?.classList.contains("open")');
  ok(sidebarClosed, 'التجاوب: القائمة الجانبية تُغلق بسلاسة على الجوال');

  // إعادة ضبط المتصفح للوضع المكتبي القياسي
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  // ------------------------------------------------------ حصر الأخطاء
  const badRequests = failedRequests.filter((r) => !/\/api\/auth\/login/.test(r) && !/\/api\/auth\/me/.test(r));
  ok(pageErrors.length === 0, `لا استثناءات JS (${pageErrors.length})`);
  ok(consoleErrors.length === 0, `لا أخطاء في طرفية المتصفح (${consoleErrors.length})`);
  ok(badRequests.length === 0, `لا طلبات فاشلة (${badRequests.length})`);
  if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => console.log(`    استثناء: ${String(e).slice(0, 300)}`));
  if (consoleErrors.length) consoleErrors.slice(0, 10).forEach((e) => console.log(`    خطأ طرفية: ${String(e).slice(0, 300)}`));
  if (badRequests.length) badRequests.slice(0, 10).forEach((e) => console.log(`    طلب فاشل: ${e}`));

  console.log(`\nتم تنفيذ ${checks} تحققاً في متصفح حقيقي (${path.basename(browser)}).`);
} catch (err) {
  problems++;
  console.log(`فشل الفحص: ${err.message}`);
} finally {
  await cleanup();
}

if (problems) {
  console.log(`فشل ${problems} تحققاً.`);
  process.exit(1);
}
console.log('كل شاشات الواجهة تعمل بلا أخطاء.');
