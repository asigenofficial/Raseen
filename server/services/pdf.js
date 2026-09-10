'use strict';
/**
 * خدمة توليد ملفات PDF الحقيقية للفواتير والمستندات المالية.
 * تعتمد على محرك Chrome أو Edge المدمج في بيئة النظام لتوليد ملفات PDF نقية عالية الدقة 100%.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ZQR = require('../../public/js/vendor/zqr.js');
const M = require('../lib/money');

function findBrowserBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.EDGE_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { }
  }
  return null;
}

/**
 * تحويل أي مستند HTML كامل إلى Buffer لملف PDF حقيقي.
 * @param {string} html 
 * @returns {Buffer}
 */
function htmlToPdf(html) {
  const browser = findBrowserBinary();
  if (!browser) {
    throw new Error('لم يتم العثور على متصفح Chrome أو Edge مدعوم لتصدير PDF على الخادم');
  }

  const tmpDir = os.tmpdir();
  const rnd = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpHtml = path.join(tmpDir, `inv_${rnd}.html`);
  const tmpPdf = path.join(tmpDir, `inv_${rnd}.pdf`);

  try {
    fs.writeFileSync(tmpHtml, html, 'utf8');
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      `--print-to-pdf=${tmpPdf}`,
      `file:///${tmpHtml.replace(/\\/g, '/')}`,
    ];

    const res = spawnSync(browser, args, { timeout: 25000, stdio: 'ignore' });
    if (res.error) throw res.error;
    if (!fs.existsSync(tmpPdf) || fs.statSync(tmpPdf).size === 0) {
      throw new Error('فشل توليد ملف PDF');
    }
    return fs.readFileSync(tmpPdf);
  } finally {
    try { if (fs.existsSync(tmpHtml)) fs.unlinkSync(tmpHtml); } catch { }
    try { if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf); } catch { }
  }
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatIban(iban) {
  if (!iban) return '';
  const clean = String(iban).replace(/\s+/g, '').toUpperCase();
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

// ------------------------------------------------------- تفقيط المبالغ المالي
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

function under1000(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const o = rest % 10;
      const t = Math.floor(rest / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

function groupWord(n, singular, dual, plural) {
  if (n === 1) return singular;
  if (n === 2) return dual;
  return `${under1000(n)} ${plural}`;
}

function tafqeet(value, currency = 'ر.س') {
  const total = Math.round(Number(value || 0) * 100);
  const riyals = Math.floor(total / 100);
  const halalas = total % 100;
  if (!riyals && !halalas) return `فقط صفر ${currency} لا غير`;

  const chunks = [];
  const millions = Math.floor(riyals / 1000000);
  const thousands = Math.floor((riyals % 1000000) / 1000);
  const units = riyals % 1000;
  if (millions) chunks.push(groupWord(millions, 'مليون', 'مليونان', 'ملايين'));
  if (thousands) chunks.push(groupWord(thousands, 'ألف', 'ألفان', 'آلاف'));
  if (units) chunks.push(under1000(units));

  let text = chunks.filter(Boolean).join(' و');
  const unitName = currency === 'ر.س' || currency === 'SAR' ? 'ريالاً سعودياً' : currency;
  text = `فقط ${text} ${unitName}`;
  if (halalas) text += ` و${under1000(halalas)} هللة`;
  return `${text} لا غير`;
}

/**
 * توليد HTML رسمي معتمد للفاتورة متوافق مع هيئة الزكاة وأرقى معايير المحاسبة السحابية.
 */
function renderInvoiceHtml({ invoice, issuer, client }) {
  const qrSvgStr = invoice.qr_payload ? ZQR.svg(invoice.qr_payload, { scale: 4, margin: 1 }) : '';
  const lines = invoice.lines || [];
  const cur = invoice.currency === 'SAR' ? 'ر.س' : (invoice.currency || 'ر.س');
  const isPaid = invoice.status === 'PAID' || (invoice.remaining_amount <= 0 && invoice.grand_total > 0);
  const isCancelled = invoice.status === 'CANCELLED';

  const sellerName = invoice.seller_name || issuer.name_ar;
  const sellerTax = invoice.seller_tax_number || issuer.tax_number || '';
  const sellerCr = invoice.seller_cr || issuer.commercial_register || '';
  const sellerAddr = invoice.seller_address || [issuer.building_no, issuer.street, issuer.district, issuer.city, issuer.postal_code].filter(Boolean).join(' - ') || 'المملكة العربية السعودية';

  const buyerName = invoice.buyer_name || client.name;
  const buyerTax = invoice.buyer_tax_number || client.tax_number || '';
  const buyerAddr = invoice.buyer_address || client.address || client.city || '—';

  // تجميع الضرائب حسب النسبة
  const taxGroups = new Map();
  for (const l of lines) {
    const rate = l.tax_rate !== undefined ? l.tax_rate : 15;
    const key = String(rate);
    const g = taxGroups.get(key) || { rate, taxable: 0, tax: 0 };
    g.taxable += l.taxable || 0;
    g.tax += l.tax_amount || 0;
    taxGroups.set(key, g);
  }

  const rows = lines.map((l, i) => `
    <tr>
      <td style="text-align:center;padding:7px 5px;border-bottom:1px solid #e2e8f0">${i + 1}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">
        <div style="font-weight:700;color:#0f172a">${esc(l.item_name)}</div>
        ${l.item_code ? `<div style="font-size:7.5pt;color:#64748b;font-family:Consolas,monospace;direction:ltr;text-align:right">${esc(l.item_code)}</div>` : ''}
      </td>
      <td style="text-align:center;padding:7px 4px;border-bottom:1px solid #e2e8f0;font-size:8.5pt">${esc(l.unit || 'حبه')}</td>
      <td style="text-align:center;padding:7px 4px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${l.quantity}</td>
      <td style="text-align:left;padding:7px 6px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${M.fmt(l.unit_price)}</td>
      <td style="text-align:left;padding:7px 6px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${M.fmt(l.discount || 0)}</td>
      <td style="text-align:left;padding:7px 6px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${M.fmt(l.taxable)}</td>
      <td style="text-align:center;padding:7px 4px;border-bottom:1px solid #e2e8f0;font-size:8.5pt">${l.tax_rate}%</td>
      <td style="text-align:left;padding:7px 6px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${M.fmt(l.tax_amount)}</td>
      <td style="text-align:left;padding:7px 6px;border-bottom:1px solid #e2e8f0;font-weight:700;font-variant-numeric:tabular-nums;color:#0f172a">${M.fmt(l.total_line)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>فاتورة ضريبية ${esc(invoice.invoice_number)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 10mm 12mm 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: "Segoe UI", Tahoma, "Cairo", Arial, sans-serif; direction: rtl; color: #0f172a; font-size: 8.8pt; line-height: 1.4; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: embed; display: inline-block; }
    .ltr { direction: ltr; unicode-bidi: embed; }
    .page-wrap { position: relative; width: 100%; min-height: 275mm; }
    .watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 80pt; font-weight: 900; transform: rotate(-24deg); pointer-events: none; z-index: 0; }
    .watermark.paid { color: rgba(16, 185, 129, 0.12); }
    .watermark.cancelled { color: rgba(225, 29, 72, 0.14); }
    
    .header-box { display: flex; justify-content: space-between; align-items: flex-start; gap: 15px; border-bottom: 2.5px solid #0d9488; padding-bottom: 12px; margin-bottom: 12px; }
    .seller-brand { display: flex; gap: 12px; align-items: flex-start; }
    .seller-logo { max-width: 32mm; max-height: 24mm; object-fit: contain; }
    .seller-logo-fallback { width: 26mm; height: 22mm; background: #0d9488; color: #fff; border-radius: 6px; display: grid; place-items: center; font-size: 15pt; font-weight: 800; }
    .seller-title { font-size: 13.5pt; font-weight: 800; color: #0f172a; margin-bottom: 2px; }
    .seller-title-en { font-size: 8.5pt; color: #64748b; margin-bottom: 4px; }
    .seller-meta { font-size: 8pt; color: #475569; line-height: 1.5; }
    
    .doc-meta { min-width: 68mm; text-align: left; }
    .doc-badge { background: #f0fdfa; border: 1.5px solid #0d9488; border-radius: 6px; padding: 6px 10px; text-align: center; margin-bottom: 6px; }
    .doc-title-ar { font-size: 13pt; font-weight: 900; color: #0f766e; }
    .doc-title-en { font-size: 7.5pt; letter-spacing: .08em; color: #64748b; font-weight: 700; }
    table.meta-tbl { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 4px; }
    table.meta-tbl td { border: 1px solid #cbd5e1; padding: 2px 6px; }
    table.meta-tbl td:first-child { background: #f8fafc; color: #475569; white-space: nowrap; }

    .parties-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .party-card { border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #fff; }
    .party-head { background: #f1f5f9; padding: 3px 8px; font-weight: 800; font-size: 8.5pt; color: #334155; border-bottom: 1px solid #cbd5e1; }
    .party-body { padding: 6px 8px; font-size: 8.2pt; line-height: 1.55; }

    table.items { width: 100%; border-collapse: collapse; font-size: 8.4pt; margin-bottom: 12px; }
    table.items thead th { background: #0d9488; color: #fff; border: 1px solid #0f766e; padding: 6px 4px; font-size: 8pt; }
    table.items tbody tr:nth-child(even) { background: #f8fafc; }
    table.items tr { page-break-inside: avoid; break-inside: avoid; }

    .bottom-section { display: flex; gap: 15px; align-items: flex-start; page-break-inside: avoid; break-inside: avoid; }
    .left-side { flex: 1; }
    .right-side { width: 88mm; }

    .qr-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; background: #f8fafc; text-align: center; margin-bottom: 8px; }
    .qr-card svg { width: 28mm; height: 28mm; }
    .bank-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; background: #fff; font-size: 8pt; margin-bottom: 8px; }

    table.totals { width: 100%; border-collapse: collapse; font-size: 8.6pt; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; }
    table.totals td { padding: 4px 8px; border-bottom: 1px solid #e2e8f0; }
    table.totals tr.grand td { background: #0d9488; color: #fff; font-size: 11pt; font-weight: 900; border: 0; }
    table.totals tr.rem td { font-weight: 800; color: #b91c1c; }

    .tafqeet-box { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 6px; padding: 6px 10px; margin-top: 6px; font-size: 8.2pt; color: #0f766e; font-weight: 700; }
    
    .stamps-zone { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 15px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8.2pt; text-align: center; page-break-inside: avoid; break-inside: avoid; }
    .stamp-box { border: 1.5px dashed #cbd5e1; border-radius: 6px; height: 24mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 4px; color: #64748b; }

    .footer { text-align: center; color: #94a3b8; font-size: 7.5pt; margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  </style>
</head>
<body>
  <div class="page-wrap">
    ${isPaid ? '<div class="watermark paid">مدفوعة — PAID</div>' : ''}
    ${isCancelled ? '<div class="watermark cancelled">ملغاة — CANCELLED</div>' : ''}

    <div class="header-box">
      <div class="seller-brand">
        ${issuer.logo_data
      ? `<img class="seller-logo" src="${esc(issuer.logo_data)}" alt="Logo" />`
      : `<div class="seller-logo-fallback">${esc((sellerName || 'Z').slice(0, 2))}</div>`}
        <div>
          <div class="seller-title">${esc(sellerName)}</div>
          ${issuer.name_en ? `<div class="seller-title-en ltr">${esc(issuer.name_en)}</div>` : ''}
          <div class="seller-meta">
            <div>${esc(sellerAddr)}</div>
            <div>
              ${sellerTax ? `الرقم الضريبي: <b class="ltr">${esc(sellerTax)}</b> ` : ''}
              ${sellerCr ? `— س.ت: <span class="ltr">${esc(sellerCr)}</span>` : ''}
            </div>
            <div>
              ${issuer.phone ? `هاتف: <span class="ltr">${esc(issuer.phone)}</span> ` : ''}
              ${issuer.email ? `— بريد: <span class="ltr">${esc(issuer.email)}</span>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="doc-meta">
        <div class="doc-badge">
          <div class="doc-title-ar">${invoice.invoice_type === 'SIMPLIFIED' ? 'فاتورة ضريبية مبسطة' : 'فاتورة ضريبية'}</div>
          <div class="doc-title-en">${invoice.invoice_type === 'SIMPLIFIED' ? 'SIMPLIFIED TAX INVOICE' : 'TAX INVOICE'}</div>
        </div>
        <table class="meta-tbl">
          <tr><td>رقم الفاتورة</td><td class="ltr"><b>${esc(invoice.invoice_number)}</b></td></tr>
          <tr><td>تاريخ الإصدار</td><td>${esc(invoice.issue_date)}</td></tr>
          <tr><td>وقت الإصدار</td><td class="ltr">${esc(invoice.issue_time || '—')}</td></tr>
          <tr><td>طريقة الدفع</td><td>${esc(invoice.payment_label || invoice.payment_method || 'نقداً')}</td></tr>
        </table>
      </div>
    </div>

    <div class="parties-grid">
      <div class="party-card">
        <div class="party-head">بيانات المورد (البائع) / SELLER</div>
        <div class="party-body">
          <div><b>${esc(sellerName)}</b></div>
          <div>الرقم الضريبي: <span class="ltr">${esc(sellerTax || '—')}</span></div>
          <div>العنوان الوطني: ${esc(sellerAddr)}</div>
        </div>
      </div>
      <div class="party-card">
        <div class="party-head">بيانات العميل (المشتري) / BUYER</div>
        <div class="party-body">
          <div><b>${esc(buyerName)}</b></div>
          <div>الرقم الضريبي: <span class="ltr">${esc(buyerTax || '—')}</span></div>
          <div>العنوان: ${esc(buyerAddr)}</div>
          ${client.mobile || client.phone ? `<div>الاتصال: <span class="ltr">${esc(client.mobile || client.phone)}</span></div>` : ''}
        </div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:24px">#</th>
          <th>الصنف والبيان / Description</th>
          <th style="width:40px">الوحدة</th>
          <th style="width:44px">الكمية</th>
          <th style="width:64px">سعر الوحدة</th>
          <th style="width:52px">الخصم</th>
          <th style="width:72px">قبل الضريبة</th>
          <th style="width:42px">الضريبة</th>
          <th style="width:68px">قيمة الضريبة</th>
          <th style="width:80px">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="bottom-section">
      <div class="left-side">
        ${qrSvgStr ? `
        <div class="qr-card">
          ${qrSvgStr}
          <div style="font-size:7.2pt;color:#64748b;margin-top:3px">رمز التحقق الإلكتروني المعتمد (ZATCA QR)</div>
        </div>` : ''}

        ${issuer.bank_iban || issuer.bank_name ? `
        <div class="bank-card">
          <div style="font-weight:700;color:#0f766e;margin-bottom:2px">معلومات السداد والتحويل البنكي:</div>
          <div>البنك: <b>${esc(issuer.bank_name || '—')}</b></div>
          ${issuer.bank_iban ? `<div>الآيبان: <b class="ltr" style="font-family:Consolas,monospace">${esc(formatIban(issuer.bank_iban))}</b></div>` : ''}
        </div>` : ''}

        ${invoice.notes ? `
        <div style="border:1px dashed #cbd5e1;border-radius:6px;padding:6px 10px;font-size:8pt">
          <b>ملاحظات:</b> ${esc(invoice.notes)}
        </div>` : ''}
      </div>

      <div class="right-side">
        <table class="totals">
          <tr><td>المجموع قبل الخصم</td><td style="text-align:left"><span class="num">${M.fmt(invoice.subtotal)}</span> ${cur}</td></tr>
          ${invoice.discount_amount > 0 ? `<tr><td>إجمالي الخصم</td><td style="text-align:left;color:#b91c1c">-<span class="num">${M.fmt(invoice.discount_amount)}</span> ${cur}</td></tr>` : ''}
          <tr><td>المبلغ الخاضع للضريبة</td><td style="text-align:left"><span class="num">${M.fmt(invoice.taxable_amount)}</span> ${cur}</td></tr>
          ${Array.from(taxGroups.values()).map((g) => `
            <tr><td>ضريبة القيمة المضافة (${g.rate}%)</td><td style="text-align:left"><span class="num">${M.fmt(g.tax)}</span> ${cur}</td></tr>
          `).join('')}
          <tr class="grand"><td>الإجمالي النهائي المستحق</td><td style="text-align:left"><span class="num">${M.fmt(invoice.grand_total)}</span> ${cur}</td></tr>
          <tr><td>المسدد</td><td style="text-align:left;color:#16a34a"><span class="num">${M.fmt(invoice.paid_amount || 0)}</span> ${cur}</td></tr>
          <tr class="rem"><td>المتبقي</td><td style="text-align:left"><span class="num">${M.fmt(invoice.remaining_amount || 0)}</span> ${cur}</td></tr>
        </table>

        <div class="tafqeet-box">
          ${esc(tafqeet(invoice.grand_total, cur))}
        </div>
      </div>
    </div>

    <div class="stamps-zone">
      <div class="stamp-box">
        <span>توقيع المستلم</span>
        <span style="font-size:7pt">...................................</span>
      </div>
      <div class="stamp-box">
        <span>ختم المنشأة الرسمي</span>
        <span style="font-size:7pt">ختم الإدارة المالية</span>
      </div>
      <div class="stamp-box">
        <span>توقيع المفوض / المدير</span>
        <span style="font-size:7pt">...................................</span>
      </div>
    </div>

    <div class="footer">
      تم إصدار هذه الفاتورة إلكترونياً عبر نظام Raseen المتوافق مع هيئة الزكاة والضريبة والجمارك بالمملكة العربية السعودية.
      ${invoice.uuid ? `<br><span class="ltr" style="font-family:monospace;font-size:7pt">UUID: ${esc(invoice.uuid)}</span>` : ''}
    </div>
  </div>
</body>
</html>`;
}

/**
 * توليد HTML رسمي لسند القبض المالي.
 */
function renderVoucherHtml({ voucher, issuer, client }) {
  const cur = voucher.currency === 'SAR' ? 'ر.س' : (voucher.currency || 'ر.س');
  const allocs = (voucher.allocations || []).map((a, i) => `
    <tr>
      <td style="text-align:center;padding:5px;border-bottom:1px solid #e2e8f0">${i + 1}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0" class="ltr"><b>${esc(a.invoice_number)}</b></td>
      <td style="text-align:center;padding:5px;border-bottom:1px solid #e2e8f0">${esc(a.issue_date || '—')}</td>
      <td style="text-align:left;padding:5px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${M.fmt(a.invoice_total)}</td>
      <td style="text-align:left;padding:5px 8px;border-bottom:1px solid #e2e8f0;font-weight:700;font-variant-numeric:tabular-nums">${M.fmt(a.allocated_amount)}</td>
      <td style="text-align:left;padding:5px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${M.fmt(a.invoice_remaining)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>سند قبض ${esc(voucher.voucher_number)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Tahoma, "Cairo", Arial, sans-serif; direction: rtl; color: #0f172a; margin: 0; padding: 0; font-size: 9pt; line-height: 1.5; background:#fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: embed; display: inline-block; }
    .ltr { direction: ltr; unicode-bidi: embed; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0d9488; padding-bottom: 12px; margin-bottom: 15px; }
    .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; margin-bottom: 15px; background: #f8fafc; font-size: 9.5pt; line-height: 2; }
    .big-amt { font-size: 14pt; font-weight: 900; color: #0f766e; background: #f0fdfa; border: 1.5px solid #0d9488; border-radius: 6px; padding: 4px 12px; display: inline-block; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 15px; }
    th { background: #0d9488; color: #fff; border: 1px solid #0f766e; padding: 6px; text-align: center; }
    .sig-zone { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-top: 25px; text-align: center; font-size: 8.5pt; }
    .sig-card { border: 1px dashed #cbd5e1; border-radius: 6px; padding: 10px; height: 26mm; display: flex; flex-direction: column; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <div style="font-size:14pt;font-weight:900;color:#0f172a">${esc(issuer.name_ar)}</div>
      <div style="font-size:8pt;color:#64748b;margin-top:2px">الرقم الضريبي: <span class="ltr">${esc(issuer.tax_number || '—')}</span></div>
      <div style="font-size:8pt;color:#64748b">السجل التجاري: <span class="ltr">${esc(issuer.commercial_register || '—')}</span></div>
    </div>
    <div style="text-align:left">
      <div style="background:#f0fdfa;border:1.5px solid #0d9488;border-radius:6px;padding:6px 14px;text-align:center">
        <div style="font-size:13pt;font-weight:900;color:#0f766e">سند قبض مالي</div>
        <div style="font-size:7.5pt;color:#64748b;letter-spacing:.08em;font-weight:700">OFFICIAL RECEIPT VOUCHER</div>
      </div>
      <div style="font-size:8.5pt;margin-top:5px">رقم السند: <b class="ltr">${esc(voucher.voucher_number)}</b></div>
      <div style="font-size:8.5pt">التاريخ: ${esc(voucher.voucher_date)}</div>
    </div>
  </div>

  <div class="box">
    <div>استلمنا من المكرم / السادة: <b>${esc(client.name)}</b></div>
    <div>مبلغاً وقدره: <span class="big-amt"><span class="num">${M.fmt(voucher.total_amount)}</span> ${esc(cur)}</span></div>
    <div><b>فقط وقدره:</b> ${esc(tafqeet(voucher.total_amount, cur))}</div>
    <div>وذلك عن: ${esc(voucher.notes || 'سداد فواتير مستحقة')}</div>
    <div>طريقة السداد: <b>${esc(voucher.payment_label || voucher.payment_type)}</b>
      ${voucher.reference_no ? ` — رقم المرجع / الشيك: <b class="ltr">${esc(voucher.reference_no)}</b>` : ''}
      ${voucher.bank_name ? ` — المسحوب على بنك: <b>${esc(voucher.bank_name)}</b>` : ''}
    </div>
  </div>

  ${allocs ? `
  <div style="font-weight:800;font-size:9.5pt;margin-bottom:6px;color:#0f766e">الفواتير المسددة بهذا السند:</div>
  <table>
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>رقم الفاتورة</th>
        <th style="width:70px">تاريخها</th>
        <th style="width:85px">إجمالي الفاتورة</th>
        <th style="width:85px">المسدد من السند</th>
        <th style="width:85px">المتبقي بعدها</th>
      </tr>
    </thead>
    <tbody>${allocs}</tbody>
    <tfoot>
      <tr style="background:#f8fafc;font-weight:700">
        <td colspan="4" style="text-align:right;padding:6px 8px;border:1px solid #cbd5e1">المجموع الموزّع</td>
        <td style="text-align:left;padding:6px 8px;border:1px solid #cbd5e1;color:#0f766e"><span class="num">${M.fmt(voucher.allocated_amount)}</span></td>
        <td style="text-align:left;padding:6px 8px;border:1px solid #cbd5e1">${voucher.unallocated > 0 ? `<span style="color:#b45309">فائض: ${M.fmt(voucher.unallocated)}</span>` : '0.00'}</td>
      </tr>
    </tfoot>
  </table>` : ''}

  <div class="sig-zone">
    <div class="sig-card">
      <div>المستلم</div>
      <div style="font-size:7.5pt;color:#94a3b8">...................................</div>
    </div>
    <div class="sig-card">
      <div>أمين الصندوق</div>
      <div style="font-size:7.5pt;color:#94a3b8">...................................</div>
    </div>
    <div class="sig-card">
      <div>المحاسب / الاعتماد</div>
      <div style="font-size:7.5pt;color:#94a3b8">ختم وتوقيع الإدارة المالية</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * توليد HTML رسمي لكشف حساب العميل.
 */
function renderStatementHtml({ statement, issuer, client }) {
  const cur = 'ر.س';
  const periodFrom = statement.period.from || 'البداية';
  const periodTo = statement.period.to || 'الآن';

  const rows = statement.entries.map((e, i) => `
    <tr>
      <td style="text-align:center;padding:5px;border-bottom:1px solid #e2e8f0">${i + 1}</td>
      <td style="text-align:center;padding:5px;border-bottom:1px solid #e2e8f0">${esc(e.transaction_date)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0">${esc(e.doc_type_label || e.doc_type)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0" class="ltr"><b>${esc(e.doc_number || '')}</b></td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0">${esc(e.description || '')}</td>
      <td style="text-align:left;padding:5px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${e.debit ? M.fmt(e.debit) : ''}</td>
      <td style="text-align:left;padding:5px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums">${e.credit ? M.fmt(e.credit) : ''}</td>
      <td style="text-align:left;padding:5px 8px;border-bottom:1px solid #e2e8f0;font-weight:700;font-variant-numeric:tabular-nums">${M.fmt(e.balance_after)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>كشف حساب ${esc(client.name)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 10mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Tahoma, "Cairo", Arial, sans-serif; direction: rtl; color: #0f172a; margin: 0; padding: 0; font-size: 8.5pt; background:#fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: embed; display: inline-block; }
    .ltr { direction: ltr; unicode-bidi: embed; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0d9488; padding-bottom: 10px; margin-bottom: 12px; }
    .kpi-row { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .kpi { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; background: #f8fafc; }
    .kpi.grand { background: #0d9488; color: #fff; border-color: #0f766e; }
    table { width: 100%; border-collapse: collapse; font-size: 8.2pt; margin-bottom: 12px; }
    th { background: #0d9488; color: #fff; border: 1px solid #0f766e; padding: 6px 4px; text-align: center; }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <div style="font-size:13.5pt;font-weight:900;color:#0f172a">${esc(issuer ? issuer.name_ar : 'كشف حساب موحّد')}</div>
      <div style="font-size:8pt;color:#64748b">العميل: <b>${esc(client.name)}</b> (الرقم الضريبي: ${esc(client.tax_number || '—')})</div>
    </div>
    <div style="text-align:left">
      <div style="font-size:12pt;font-weight:900;color:#0f766e">كشف حساب عميل / STATEMENT OF ACCOUNT</div>
      <div style="font-size:8pt;color:#64748b">الفترة: ${esc(periodFrom)} إلى ${esc(periodTo)}</div>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi"><div>إجمالي المدين (فواتير)</div><b class="num" style="font-size:11pt">${M.fmt(statement.totals.debit)} ${cur}</b></div>
    <div class="kpi"><div>إجمالي الدائن (مسدد)</div><b class="num" style="font-size:11pt;color:#16a34a">${M.fmt(statement.totals.credit)} ${cur}</b></div>
    <div class="kpi grand"><div>الرصيد الختامي المستحق</div><b class="num" style="font-size:12pt">${M.fmt(statement.totals.closing_balance)} ${cur}</b></div>
    <div class="kpi"><div>عدد الحركات</div><b style="font-size:11pt">${statement.entries.length} حركة</b></div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:26px">#</th>
        <th style="width:68px">التاريخ</th>
        <th style="width:75px">النوع</th>
        <th style="width:85px">المستند</th>
        <th>البيان</th>
        <th style="width:75px">مدين</th>
        <th style="width:75px">دائن</th>
        <th style="width:85px">الرصيد</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background:#fef3c7;font-weight:700">
        <td colspan="5" style="padding:6px 8px;border-bottom:1px solid #cbd5e1">الرصيد الافتتاحي للفترة</td>
        <td colspan="2" style="border-bottom:1px solid #cbd5e1"></td>
        <td style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1"><span class="num">${M.fmt(statement.opening_balance_period)}</span></td>
      </tr>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function generateInvoicePdf({ invoice, issuer, client, html }) {
  const finalHtml = html || renderInvoiceHtml({ invoice, issuer, client });
  return htmlToPdf(finalHtml);
}

function generateVoucherPdf({ voucher, issuer, client, html }) {
  const finalHtml = html || renderVoucherHtml({ voucher, issuer, client });
  return htmlToPdf(finalHtml);
}

function generateStatementPdf({ statement, issuer, client, html }) {
  const finalHtml = html || renderStatementHtml({ statement, issuer, client });
  return htmlToPdf(finalHtml);
}

module.exports = {
  htmlToPdf,
  convertHtmlToPdf: htmlToPdf,
  renderInvoiceHtml,
  generateInvoicePdf,
  renderVoucherHtml,
  generateVoucherPdf,
  renderStatementHtml,
  generateStatementPdf,
  findBrowserBinary,
  tafqeet,
  formatIban,
};
