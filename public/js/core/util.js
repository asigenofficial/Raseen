// ==========================================================================
//  أدوات مشتركة للواجهة: القوالب الآمنة، التنسيق، النوافذ، التنبيهات، التصدير.
// ==========================================================================

/** تهريب النصوص لمنع أي حقن HTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** وسم لإدراج HTML جاهز داخل قالب html`` بدون تهريب. */
class Raw {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}
export const raw = (value) => new Raw(value === null || value === undefined ? '' : String(value));

function isSafeSvg(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return s.startsWith('<svg') && s.endsWith('</svg>');
}

/** قالب نصي يهرّب كل القيم المدمجة تلقائياً (إلا ما كان raw أو مصفوفة منها أو وسوم SVG آمنة). */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v instanceof Raw) {
      out += v.value;
    } else if (isSafeSvg(v)) {
      out += v;
    } else if (Array.isArray(v)) {
      out += v.map((x) => (x instanceof Raw ? x.value : isSafeSvg(x) ? x : esc(x))).join('');
    } else {
      out += esc(v);
    }
    out += strings[i + 1];
  }
  return out;
}

// ---------------------------------------------------------------- التنسيق
import { sarSvg, icon } from './icons.js';
export { sarSvg };

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

/** تقريب رقمي بدقة 4 خانات عشرية Decimal(4) للحسابات الضريبية الداخلية بدون تقريب مبكر لخانتين */
export function roundDec4(value) {
  const n = Number(value) || 0;
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.floor(Math.abs(n) * 10000 + 0.5 + 1e-9)) / 10000;
}

/** تقريب رياضي طبيعي لنصف الخانة (Round Half Up) إلى خانتين عشريتين فقط Decimal(2) */
export function roundHalfUp2(value) {
  const n = Number(value) || 0;
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const dec4 = Math.floor(Math.abs(n) * 10000 + 0.5 + 1e-9);
  return (sign * Math.floor((dec4 + 50) / 100)) / 100;
}

/** مبلغ بمنزلتين وفواصل آلاف - يعيد 0.00 بدلاً من NaN */
export function money(value) {
  if (value === '' || value === undefined || value === null) return '0.00';
  const n = Number(String(value).replace(/,/g, '').trim());
  if (isNaN(n) || !Number.isFinite(n)) return '0.00';
  return nf2.format(roundHalfUp2(n));
}

/** رقم عام (كميات، أعداد) - يعيد 0 بدلاً من NaN */
export function num(value) {
  if (value === '' || value === undefined || value === null) return '0';
  const n = Number(String(value).replace(/,/g, '').trim());
  if (isNaN(n) || !Number.isFinite(n)) return '0';
  return nf0.format(n);
}

/** مبلغ مع العملة ورمز الريال السعودي الرسمي فيكتور SVG (الرمز على اليسار دائماً). */
export function amount(value, currency = 'SAR', opt = {}) {
  const isSar = !currency || currency === 'SAR' || currency === 'ر.س' || currency === '﷼';
  const sym = isSar ? sarSvg({ size: opt.size || 13, ...opt }) : esc(currency);
  return raw(`<span class="money-val"><span class="cur-sym">${sym}</span><span class="num">${money(value)}</span></span>`);
}

/** إدراج رمز الريال السعودي كعنصر HTML جاهز داخل القوالب. */
export function sarTag(opt = {}) {
  return raw(`<span class="cur-sym">${sarSvg({ size: opt.size || 13, ...opt })}</span>`);
}

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** تاريخ YYYY-MM-DD → نص عربي مقروء. */
export function dateAr(value) {
  if (!value) return '—';
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${Number(d)} ${MONTHS_AR[Number(m) - 1] || m} ${y}`;
}

/** طابع زمني ISO → تاريخ ووقت. */
export function dateTimeAr(value) {
  if (!value) return '—';
  const iso = String(value);
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 19);
  return `${dateAr(datePart)}${timePart ? ` — ${timePart}` : ''}`;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const nowTime = () => new Date().toTimeString().slice(0, 8);
export const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function minutesToTime(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}
export function timeToMinutes(value) {
  const [h, m] = String(value || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** تفريغ رقم من إدخال نصي. */
export function toNum(value, def = 0) {
  if (value === '' || value === null || value === undefined) return def;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : def;
}

export function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '؟';
  const parts = s.split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

// ------------------------------------------------------------------- DOM
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** قراءة قيم كل الحقول التي تحمل name داخل عنصر. */
export function formValues(root) {
  const out = {};
  $$('[name]', root).forEach((el) => {
    const key = el.getAttribute('name');
    if (el.type === 'checkbox') out[key] = el.checked;
    else if (el.type === 'number') out[key] = el.value === '' ? null : Number(el.value);
    else out[key] = typeof el.value === 'string' ? el.value.trim() : el.value;
  });
  return out;
}

/** ربط أحداث النقر عبر data-act بالتفويض. */
export function delegate(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

// -------------------------------------------------------------- التنبيهات
export function toast(message, type = '') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = html`<span>${message}</span>`;
  el.style.cursor = 'pointer';
  el.title = 'إغلاق';
  el.addEventListener('click', () => el.remove());
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 200);
  }, type === 'err' ? 4000 : 1500);
}

export const toastOk = (m) => toast(m, 'ok');
export const toastErr = (m) => toast(m, 'err');

// ---------------------------------------------------------------- النوافذ
/**
 * نافذة منبثقة. تعيد { el, body, close }.
 */
export function modal({ title, body, footer, wide = false, slim = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  if (root) {
    Array.from(root.querySelectorAll('.modal-backdrop:not(.confirm-dialog-active)')).forEach((el) => el.remove());
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`
    <div class="modal ${raw(wide ? 'wide' : slim ? 'slim' : '')}">
      <div class="modal-head">
        <h3>${title || ''}</h3>
        <button class="btn btn-ghost btn-icon" data-close type="button" aria-label="إغلاق">✕</button>
      </div>
      <div class="modal-body">${raw(typeof body === 'string' ? body : '')}</div>
      ${raw(footer === null ? '' : `<div class="modal-foot">${footer || '<button class="btn" data-close type="button">إغلاق</button>'}</div>`)}
    </div>`;
  root.appendChild(backdrop);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
    if (e.target.closest('[data-close]')) close();
  });
  if (body instanceof HTMLElement) {
    const bodyEl = backdrop.querySelector('.modal-body');
    bodyEl.innerHTML = '';
    bodyEl.appendChild(body);
  }
  const first = backdrop.querySelector('input, select, textarea, button:not([data-close])');
  if (first) setTimeout(() => first.focus(), 40);
  return { el: backdrop, body: backdrop.querySelector('.modal-body'), foot: backdrop.querySelector('.modal-foot'), close };
}

/** تأكيد بنعم/لا. */
export function confirmDialog({ title = 'تأكيد', message = '', danger = false, okText = 'تأكيد' } = {}) {
  // Ponytail: Close any duplicate lingering confirm dialogs immediately
  document.querySelectorAll('.modal-backdrop.confirm-dialog-active').forEach((el) => el.remove());

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      m.close();
      resolve(val);
    };

    const m = modal({
      title,
      slim: true,
      body: html`<p style="margin:0">${message}</p>`,
      footer: `<button class="btn" data-close type="button">إلغاء</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok type="button">${esc(okText)}</button>`,
      onClose: () => finish(false),
    });
    m.el.classList.add('confirm-dialog-active');
    const okBtn = m.el.querySelector('[data-ok]');
    if (okBtn) {
      okBtn.addEventListener('click', () => {
        okBtn.disabled = true;
        finish(true);
      });
    }
  });
}

/** إدخال نصي سريع. */
export function promptDialog({ title = '', label = '', value = '', placeholder = '', multiline = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      slim: true,
      body: html`<div class="field"><label>${label}</label>
        ${raw(multiline
        ? `<textarea name="v" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input type="text" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" />`)}</div>`,
      footer: `<button class="btn" data-close type="button">إلغاء</button>
               <button class="btn btn-primary" data-ok type="button">حفظ</button>`,
      onClose: () => resolve(null),
    });
    const input = m.el.querySelector('[name=v]');
    const done = () => { const v = input.value; m.el.remove(); resolve(v); };
    m.el.querySelector('[data-ok]').addEventListener('click', done);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) done(); });
  });
}

// ------------------------------------------------------------------ التصدير
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** تصدير CSV (بترميز UTF-8 مع BOM ليُقرأ في Excel العربي بشكل صحيح). */
export function exportCsv(filename, headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  download(filename.endsWith('.csv') ? filename : `${filename}.csv`, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
}

/** تصدير Excel (ملف .xls بصيغة جدول HTML — يفتح مباشرة في Excel مع دعم العربية والاتجاه). */
export function exportExcel(filename, title, headers, rows, { footer = null, subtitle = '' } = {}) {
  const thead = `<tr>${headers.map((h) => `<th style="background:#0d9488;color:#fff;border:1px solid #94a3b8;padding:4px">${esc(h)}</th>`).join('')}</tr>`;
  const tbody = rows.map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #cbd5e1;padding:3px">${esc(c)}</td>`).join('')}</tr>`).join('');
  const tfoot = footer ? `<tr>${footer.map((c) => `<td style="border:1px solid #94a3b8;padding:3px;font-weight:bold;background:#f1f5f9">${esc(c)}</td>`).join('')}</tr>` : '';
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8" /><style>table{border-collapse:collapse;font-family:Tahoma,Arial}td,th{mso-number-format:General}</style></head>
<body dir="rtl"><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}<table>${thead}${tbody}${tfoot}</table></body></html>`;
  download(filename.endsWith('.xls') ? filename : `${filename}.xls`, `\uFEFF${doc}`, 'application/vnd.ms-excel;charset=utf-8');
}

/**
 * تحليل محتوى نصي لملف جدول بيانات (CSV، TSV، أو XML Spreadsheet 2003 أو HTML Table)
 * ويعيد مصفوفة من الأسطر (Array of Arrays).
 */
export function parseSpreadsheetText(content, filename = '') {
  let text = String(content || '').replace(/^\uFEFF/, '');
  const lowerName = filename.toLowerCase();

  // فحص صيغة XML Spreadsheet 2003
  if (text.includes('<Workbook') && text.includes('<Table')) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');
      const rows = [];
      const rowEls = xmlDoc.querySelectorAll('Row');
      for (const rEl of rowEls) {
        const row = [];
        const cellEls = rEl.querySelectorAll('Cell');
        for (const cEl of cellEls) {
          const dataEl = cEl.querySelector('Data');
          row.push(dataEl ? (dataEl.textContent || '').trim() : '');
        }
        if (row.some((c) => c !== '')) rows.push(row);
      }
      if (rows.length) return rows;
    } catch { /* التراجع إلى المحلل النصي */ }
  }

  // فحص صيغة HTML Table (.xls)
  if (text.includes('<table') || text.includes('<TABLE')) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const rows = [];
      const trs = doc.querySelectorAll('tr');
      for (const tr of trs) {
        const row = [];
        const cells = tr.querySelectorAll('th, td');
        for (const cell of cells) {
          row.push((cell.textContent || '').trim());
        }
        if (row.some((c) => c !== '')) rows.push(row);
      }
      if (rows.length) return rows;
    } catch { /* التراجع إلى CSV */ }
  }

  // محلل CSV / TSV متكامل مع معالجة علامات الاقتباس والفواصل
  const delimiter = lowerName.endsWith('.tsv') || text.includes('\t') ? '\t' : (text.includes(';') && !text.includes(',') ? ';' : ',');
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      currentVal = '';
      if (currentRow.some((c) => c !== '')) rows.push(currentRow);
      currentRow = [];
    } else {
      currentVal += char;
    }
  }
  if (currentVal || currentRow.length) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c !== '')) rows.push(currentRow);
  }

  return rows;
}

/**
 * طباعة مستند مستقل داخل إطار مخفي (يعمل بدون نوافذ منبثقة).
 * @param {string} docHtml مستند HTML كامل بأنماطه الخاصة
 */
function applyVoucherPageStyle(html) {
  if (/reference-voucher/i.test(html)) {
    const style = `<style data-voucher-page>
@page { size: A4 portrait !important; margin: 0 !important; }
html {
  margin: 0 !important; padding: 0 !important;
  background: #fff !important;
}
body {
  width: 210mm !important; max-width: 210mm !important; min-width: 210mm !important;
  min-height: 297mm !important;
  margin: 0 auto !important;
  padding: 10mm !important;
  box-sizing: border-box !important;
  background: #fff !important;
  display: block !important;
}
.reference-voucher, body > main.reference-voucher {
  width: 190mm !important; max-width: 190mm !important;
  height: auto !important; max-height: none !important; min-height: 0 !important;
  margin: 0 auto !important;
  display: block !important;
  box-sizing: border-box !important;
}
@media print {
  body { margin: 0 !important; background: #fff !important; }
  .reference-voucher, body > main.reference-voucher { box-shadow: none !important; }
}
</style>`;
    return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, style + "\n</head>") : style + "\n" + html;
  }
  const style = `<style data-voucher-page>
@page { size: A4 portrait !important; margin: 0 !important; }
html, body {
  height: 295mm !important; max-height: 295mm !important; min-height: 0 !important;
  margin: 0 !important; padding: 0 !important; box-sizing: border-box !important;
  overflow: hidden !important; background: #fff !important;
}
body > .receipt-card, body > .receipt-container, body > .receipt-page, body > .receipt, body > .page, body > .sheet, body > main:not(.reference-voucher), .voucher-container {
  width: 210mm !important; max-width: 210mm !important;
  height: 295mm !important; max-height: 295mm !important; min-height: 0 !important;
  margin: 0 auto !important; padding: 10mm 12mm !important; box-sizing: border-box !important;
  display: flex !important; flex-direction: column !important; justify-content: space-between !important;
  overflow: hidden !important; break-inside: avoid !important; page-break-inside: avoid !important;
  break-after: avoid !important; page-break-after: avoid !important;
}
body > .receipt-card > .head, body > .receipt-container > .head, body > .receipt-page > .head, body > main > .header, body > .sheet > .header { margin-bottom: 4mm !important; flex-shrink: 0 !important; }
body > .receipt-card > .receipt-box, body > .receipt-container > .receipt-box { margin-top: 0 !important; flex-shrink: 0 !important; }
body > .receipt-card > footer, body > .receipt-container > footer, body > .receipt-container > .foot, body > .receipt-page > footer, body > main > footer, body > .sheet > footer, body > .sheet > .voucher-footer { margin-top: auto !important; flex-shrink: 0 !important; }
body > .receipt-page > .document-heading { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .amount-card { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .ornament { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .bottom-rule { margin-top: 4mm !important; }
body > .receipt-card > *, body > .receipt-container > *, body > .receipt-page > *, body > .receipt > *, body > .page > *, body > main > *, body > .sheet > * { flex-shrink: 0; }
@media print {
  body { margin: 0 !important; background: #fff !important; }
  body > .receipt-card, body > .receipt-container, body > .receipt-page, body > .receipt, body > .page, body > main, body > .sheet { box-shadow: none !important; }
}
</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, style + "\n</head>") : style + "\n" + html;
}

export function printDoc(docHtml, { flowing = false } = {}) {
  const holder = document.getElementById('print-root') || document.body;
  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'طباعة');
  frame.style.width = '260mm';
  frame.style.height = '380mm';
  frame.style.border = '0';
  holder.appendChild(frame);
  const doc = frame.contentWindow.document;

  const printFixStyle = flowing ? `<style>@media print { html, body { height: auto !important; max-height: none !important; overflow: visible !important; } thead { display: table-header-group; } tr { break-inside: avoid; } }</style>` : `<style>
    @page { size: A4 portrait; margin: 0 !important; }
    .invoice-container, .invoice-frame, .page, [data-invoice-page], .sheet, .receipt-card, .receipt-container, .receipt-page, .receipt, .voucher-container {
      width: 210mm !important;
      max-width: 210mm !important;
      min-height: 297mm !important;
      height: 295mm !important; max-height: 295mm !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: flex-start !important;
      box-sizing: border-box !important;
      margin: 0 auto !important;
      position: relative !important;
      overflow: hidden !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .top-content-wrap {
      flex: 1 1 auto !important;
      display: flex !important;
      flex-direction: column !important;
      min-height: 0 !important;
    }
    .bottom-content-wrap, .bottom, .invoice-container > .summary-section, .invoice-container > .totals, .invoice-container > footer, .invoice-container > .footer-zone, .sheet > .voucher-footer, .sheet > footer {
      margin-top: auto !important;
      flex-shrink: 0 !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    @media print {
 @page { size: A4 portrait; margin: 0 !important; }
 html, body { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
 [data-invoice-page] { width: 210mm !important; min-height: 0 !important; height: 297mm !important; max-height: 297mm !important; box-sizing: border-box !important; margin: 0 auto !important; padding: 6mm 8mm 4mm !important; overflow: hidden !important; break-after: page !important; page-break-after: always !important; display: flex !important; flex-direction: column !important; justify-content: space-between !important; }
 [data-invoice-page]:last-child { break-after: auto !important; page-break-after: auto !important; }
 [data-invoice-page] .invoice-body-content { flex: 0 1 auto !important; }
 [data-invoice-page] .items-main-table, [data-invoice-page] .items-table { page-break-inside: avoid !important; break-inside: avoid !important; }
 [data-invoice-page] .items-main-table tr, [data-invoice-page] .items-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
}
</style>`;

  const allPages = prefix + pages.join('\n') + suffix;
  let finalHtml = htmlStr.replace(bodyMatch[0], `<body${bodyAttrs}>\n${allPages}\n</body>`);
  if (finalHtml.includes('</head>')) {
    finalHtml = finalHtml.replace('</head>', multiCss + '\n</head>');
  } else {
    finalHtml = multiCss + '\n' + finalHtml;
  }
  return finalHtml;
}

// ------------------------------------------------------------- توليد رقم صنف تلقائي للأصناف الحرة
export function generateNextItemCode(existingList = [], catalogItems = []) {
  let maxNum = 0;
  const list = [
    ...(catalogItems || []),
    ...(existingList || []),
  ];
  for (const item of list) {
    const code = typeof item === 'string' ? item : (item?.item_code || '');
    const m = String(code).match(/ITM-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `ITM-${String(maxNum + 1).padStart(4, '0')}`;
}

// ------------------------------------------------------------- شريط التصفح المجزأ الموحّد (Pagination)
export function renderPager({
  idPrefix = '',
  offset = 0,
  limit = 20,
  total = 0,
  sizes = [10, 20, 50, 100],
  standalone = false,
  label = 'عنصر',
} = {}) {
  const safeLimit = Math.max(1, Number(limit) || 20);
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(totalPages, Math.floor(safeOffset / safeLimit) + 1);
  const pageFrom = safeTotal ? Math.min(safeTotal, (currentPage - 1) * safeLimit + 1) : 0;
  const pageTo = Math.min(safeTotal, currentPage * safeLimit);

  const prevId = idPrefix ? `${idPrefix}-prev` : 'prev';
  const nextId = idPrefix ? `${idPrefix}-next` : 'next';
  const limitId = idPrefix ? `${idPrefix}-limit` : 'pager-limit';
  const pagerKey = idPrefix || 'main';

  const pageNums = [];
  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) pageNums.push(p);
  } else {
    pageNums.push(1);
    if (currentPage > 3) pageNums.push('...');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let p = start; p <= end; p++) pageNums.push(p);
    if (currentPage < totalPages - 2) pageNums.push('...');
    pageNums.push(totalPages);
  }

  const pagesHtml = pageNums.map((p) => {
    if (p === '...') return '<span class="pager-ellipsis">…</span>';
    const active = p === currentPage;
    return `<button type="button" class="pager-page-btn num ${active ? 'active' : ''}" data-pager-key="${esc(pagerKey)}" data-pager-page="${p}" ${active ? 'aria-current="page"' : ''}>${p}</button>`;
  }).join('');

  const sizeSet = sizes && sizes.length ? Array.from(new Set([...sizes, safeLimit])).sort((a, b) => a - b) : [];
  const sizeOptionsHtml = sizeSet.map((sz) =>
    `<option value="${sz}" ${sz === safeLimit ? 'selected' : ''}>${sz} / صفحة</option>`
  ).join('');

  return `
    <div class="pager ${standalone ? 'pager-standalone' : ''}" data-pager-wrap="${esc(pagerKey)}">
      <div class="pager-nav">
        <button class="btn btn-sm" id="${esc(prevId)}" data-pager-prev="${esc(pagerKey)}" ${currentPage <= 1 ? 'disabled' : ''} type="button">
          ${icon.arrowRight({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}السابق
        </button>
        <div class="pager-pages">${pagesHtml}</div>
        <button class="btn btn-sm" id="${esc(nextId)}" data-pager-next="${esc(pagerKey)}" ${currentPage >= totalPages || safeTotal === 0 ? 'disabled' : ''} type="button">
          التالي${icon.arrowLeft({ size: 14, style: 'vertical-align:text-bottom;margin-right:3px' })}
        </button>
      </div>
      <div class="pager-meta">
        <span class="badge blue tiny num">صفحة ${currentPage} من ${totalPages}</span>
        <span class="tiny muted num">عرض ${num(pageFrom)} — ${num(pageTo)} من ${num(safeTotal)} ${esc(label)}</span>
        ${sizeSet.length ? `<select class="pager-limit" id="${esc(limitId)}" data-pager-limit="${esc(pagerKey)}" title="عدد العناصر المعروضة في كل صفحة">${sizeOptionsHtml}</select>` : ''}
      </div>
    </div>
  `;
}

export function bindPager(root, {
  idPrefix = '',
  offset = 0,
  limit = 20,
  total = 0,
  onChange,
} = {}) {
  if (!root || typeof onChange !== 'function') return;
  const pagerKey = idPrefix || 'main';
  const wrap = root.querySelector(`[data-pager-wrap="${pagerKey}"]`) || root;
  const safeLimit = Math.max(1, Number(limit) || 20);
  const safeTotal = Math.max(0, Number(total) || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(totalPages, Math.floor(Math.max(0, Number(offset) || 0) / safeLimit) + 1);

  const prevBtn = wrap.querySelector(`[data-pager-prev="${pagerKey}"]`);
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        onChange(Math.max(0, (currentPage - 2) * safeLimit), safeLimit);
      }
    });
  }

  const nextBtn = wrap.querySelector(`[data-pager-next="${pagerKey}"]`);
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) {
        onChange(currentPage * safeLimit, safeLimit);
      }
    });
  }

  wrap.querySelectorAll(`[data-pager-key="${pagerKey}"][data-pager-page]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetPage = Number(btn.dataset.pagerPage);
      if (targetPage >= 1 && targetPage <= totalPages && targetPage !== currentPage) {
        onChange((targetPage - 1) * safeLimit, safeLimit);
      }
    });
  });

  const limitSel = wrap.querySelector(`[data-pager-limit="${pagerKey}"]`);
  if (limitSel) {
    limitSel.addEventListener('change', (e) => {
      const newLimit = Math.max(1, Number(e.target.value) || safeLimit);
      onChange(0, newLimit);
    });
  }
}
