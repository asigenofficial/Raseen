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
import { sarSvg } from './icons.js';
export { sarSvg };

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

/** مبلغ بمنزلتين وفواصل آلاف - يعيد 0.00 بدلاً من NaN */
export function money(value) {
  if (value === '' || value === undefined || value === null) return '0.00';
  const n = Number(String(value).replace(/,/g, '').trim());
  if (isNaN(n) || !Number.isFinite(n)) return '0.00';
  return nf2.format(n);
}

/** رقم عام (كميات، أعداد) - يعيد 0 بدلاً من NaN */
export function num(value) {
  if (value === '' || value === undefined || value === null) return '0';
  const n = Number(String(value).replace(/,/g, '').trim());
  if (isNaN(n) || !Number.isFinite(n)) return '0';
  return nf0.format(n);
}

/** مبلغ مع العملة ورمز الريال السعودي الرسمي فيكتور SVG. */
export function amount(value, currency = 'SAR', opt = {}) {
  const isSar = !currency || currency === 'SAR' || currency === 'ر.س' || currency === '﷼';
  const sym = isSar ? sarSvg({ size: opt.size || 13, ...opt }) : esc(currency);
  return raw(`<span class="money-val"><span class="num">${money(value)}</span> <span class="cur-sym">${sym}</span></span>`);
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
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = html`<span>${message}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 250);
  }, type === 'err' ? 6000 : 3200);
}

export const toastOk = (m) => toast(m, 'ok');
export const toastErr = (m) => toast(m, 'err');

// ---------------------------------------------------------------- النوافذ
/**
 * نافذة منبثقة. تعيد { el, body, close }.
 */
export function modal({ title, body, footer, wide = false, slim = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
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
export function printDoc(docHtml) {
  const holder = document.getElementById('print-root');
  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'طباعة');
  frame.style.width = '260mm';
  frame.style.height = '380mm';
  frame.style.border = '0';
  holder.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(docHtml);
  doc.close();
  const go = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (err) {
      toastErr('تعذر بدء الطباعة');
    }
    setTimeout(() => frame.remove(), 60000);
  };
  if (doc.readyState === 'complete') setTimeout(go, 120);
  else frame.onload = () => setTimeout(go, 120);
}

/** توليد رمز QR كـ SVG من حمولة نصية. */
export function qrSvg(payload, options = {}) {
  if (!payload) return '';
  try {
    return globalThis.ZQR.svg(payload, { ecl: 'M', margin: 2, scale: 4, ...options });
  } catch (err) {
    console.warn('QR error', err);
    return '<div class="tiny muted">تعذر توليد رمز QR</div>';
  }
}

/** نسخ نص للحافظة. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toastOk('تم النسخ');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toastOk('تم النسخ');
  }
}

export function statusBadge(status, label) {
  const map = { PAID: 'green', PARTIAL: 'amber', UNPAID: 'gray', CANCELLED: 'red', ACTIVE: 'green' };
  return html`<span class="badge ${map[status] || 'gray'}">${label || status}</span>`;
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { icon } from './icons.js';

/**
 * تنزيل أي مستند HTML كملف PDF حقيقي عالي الدقة عبر الخادم مع استعادة الطباعة في حال التعذر.
 */
export async function downloadPdfFromHtml(docHtml, filename = 'document.pdf') {
  try {
    toastOk('جارٍ تجهيز ملف PDF...');
    const safeName = String(filename || 'document.pdf').endsWith('.pdf') ? String(filename) : `${filename}.pdf`;
    const res = await fetch('/api/pdf/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: docHtml, filename: safeName }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'تعذر إنشاء ملف PDF');
    }
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: 'application/pdf' });

    // استخدام كائن File مع الاسم العربي الصريح لمنع المتصفح من تنزيل اسم عشوائي UUID
    let fileObj;
    try {
      fileObj = new File([blob], safeName, { type: 'application/pdf' });
    } catch {
      fileObj = blob;
    }

    const url = URL.createObjectURL(fileObj);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        a.remove();
        URL.revokeObjectURL(url);
      } catch { }
    }, 60000);
    toastOk('تم تحميل ملف PDF بنجاح 📄');
    return blob;
  } catch (err) {
    console.warn('PDF download fallback to print:', err);
    printDoc(docHtml);
    toastOk('تم فتح حوار الطباعة / الحفظ كملف PDF');
    return null;
  }
}


function detectColumnTypeJS(th) {
  const clean = (th || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  if (clean.includes('شامل') || clean.includes('مع الضريبة') || clean.includes('صافي') || clean.includes('with vat') || clean.includes('total with') || clean.includes('gross') || clean.includes('total line')) {
    return 'total';
  }
  if (clean.includes('كود') || clean.includes('رمز') || clean.includes('item code') || clean.includes('sku') || clean.includes('barcode') || clean.includes('رقم الصنف')) {
    return 'code';
  }
  if (clean === '#' || clean === 'م' || clean === 'ت' || clean === 'م.' || clean.includes('تسلسل') || clean === 'no' || clean === 'no.' || clean === 'sr' || clean === 'sn') {
    return 'index';
  }
  if (clean.includes('سعر') || clean.includes('price')) {
    return 'price';
  }
  if (clean.includes('كمية') || clean.includes('qty') || clean.includes('quantity') || clean.includes('عدد')) {
    return 'qty';
  }
  if (clean.includes('وحدة') || clean.includes('unit') || clean.includes('uom')) {
    return 'unit';
  }
  if (clean.includes('خصم') || clean.includes('discount')) {
    return 'discount';
  }
  if (clean.includes('نسبة') || clean.includes('معدل') || clean.includes('rate') || clean === '%' || clean === '15%') {
    return 'tax_rate';
  }
  if (clean.includes('ضريبة') || clean.includes('vat') || clean.includes('tax')) {
    return 'tax_amount';
  }
  if (clean.includes('قبل') || clean.includes('خاضع') || clean.includes('taxable') || clean.includes('إجمالي') || clean.includes('subtotal') || clean.includes('total') || clean.includes('مبلغ')) {
    return 'taxable';
  }
  if (clean.includes('ملاحظ') || clean.includes('note')) {
    return 'notes';
  }
  return 'name';
}

function extractTableHeadersJS(htmlSnippet) {
  const tableMatches = htmlSnippet.match(/<table\b[^>]*>([\s\S]*?)<\/table>/gi) || [];
  let targetTableHtml = '';
  for (const tbl of tableMatches) {
    if (/items_rows|items_table_body|items_body|table_rows/i.test(tbl)) {
      targetTableHtml = tbl;
      break;
    }
  }
  if (!targetTableHtml) {
    for (const tbl of tableMatches) {
      if (/وصف|صنف|بيان|كمية|سعر|item|desc|qty|price/i.test(tbl)) {
        targetTableHtml = tbl;
        break;
      }
    }
  }
  if (!targetTableHtml) {
    targetTableHtml = htmlSnippet;
  }

  const thRegex = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
  let matches = [...targetTableHtml.matchAll(thRegex)];
  if (matches.length > 0) {
    return matches.map(m => m[1]);
  }
  const trMatch = targetTableHtml.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
  if (trMatch) {
    const tdMatches = [...trMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length > 0) {
      return tdMatches.map(m => m[1]);
    }
  }
  return [];
}

function generateSmartRowsJS(htmlSnippet, rawLines) {
  const headers = extractTableHeadersJS(htmlSnippet);
  let cols = [];
  if (headers.length > 0) {
    cols = headers.map(detectColumnTypeJS);
  } else {
    cols = ['index', 'name', 'qty', 'unit', 'price', 'taxable', 'discount', 'tax_amount', 'tax_rate', 'total'];
  }

  let lines = rawLines;
  if (!lines || lines.length === 0) {
    lines = [
      { item_name: 'اسم الصنف أو الخدمة 1', item_code: 'ITM-01', unit: 'حبة', quantity: 0, unit_price: 0, discount: 0, taxable: 0, tax_amount: 0, total_line: 0 },
    ];
  }

  const filledRows = lines.map((l, idx) => {
    const rawQty = Number(String(l.quantity ?? '').replace(/,/g, '').trim());
    const qtyNum = (!isNaN(rawQty) && Number.isFinite(rawQty)) ? rawQty : 0;
    const qtyStr = qtyNum % 1 === 0 ? String(qtyNum) : qtyNum.toFixed(2);

    const rawPrice = Number(String(l.unit_price ?? '').replace(/,/g, '').trim());
    const priceNum = (!isNaN(rawPrice) && Number.isFinite(rawPrice)) ? rawPrice : 0;
    const priceStr = priceNum.toFixed(2);

    const rawDisc = Number(String(l.discount ?? '').replace(/,/g, '').trim());
    const discNum = (!isNaN(rawDisc) && Number.isFinite(rawDisc) && rawDisc > 0) ? rawDisc : 0;
    const discStr = discNum.toFixed(2);

    const rawTaxable = Number(String(l.taxable ?? '').replace(/,/g, '').trim());
    const taxableNum = (!isNaN(rawTaxable) && Number.isFinite(rawTaxable) && l.taxable !== undefined && l.taxable !== '')
      ? rawTaxable
      : Math.max(0, qtyNum * priceNum - discNum);
    const taxableStr = taxableNum.toFixed(2);

    const rawVat = Number(String(l.tax_amount ?? '').replace(/,/g, '').trim());
    const vatNum = (!isNaN(rawVat) && Number.isFinite(rawVat) && l.tax_amount !== undefined && l.tax_amount !== '')
      ? rawVat
      : (taxableNum * 0.15);
    const vatStr = vatNum.toFixed(2);

    const rawTotal = Number(String(l.total_line ?? '').replace(/,/g, '').trim());
    const totalNum = (!isNaN(rawTotal) && Number.isFinite(rawTotal) && l.total_line !== undefined && l.total_line !== '')
      ? rawTotal
      : (taxableNum + vatNum);
    const totalStr = totalNum.toFixed(2);

    const itemName = l.item_name || l.name || 'اسم الصنف أو الخدمة';
    const itemCode = l.item_code || l.code || '—';
    const unit = l.unit || 'حبة';

    const bg = idx % 2 === 1 ? '#fafafa' : '#fff';
    const cells = cols.map(c => {
      switch (c) {
        case 'index':
          return `<td class="c" style="padding:6px 8px;text-align:center;">${idx + 1}</td>`;
        case 'code':
          return `<td class="c" style="padding:6px 8px;text-align:center;font-family:Tahoma,sans-serif;">${esc(itemCode)}</td>`;
        case 'name':
          return `<td class="r" style="padding:6px 8px;font-weight:600;text-align:right;">${esc(itemName)}</td>`;
        case 'unit':
          return `<td class="c" style="padding:6px 8px;text-align:center;">${esc(unit)}</td>`;
        case 'price':
          return `<td class="c num" style="padding:6px 8px;text-align:center;font-family:Tahoma,sans-serif;">${priceStr}</td>`;
        case 'qty':
          return `<td class="c num" style="padding:6px 8px;text-align:center;font-family:Tahoma,sans-serif;">${qtyStr}</td>`;
        case 'taxable':
          return `<td class="c num" style="padding:6px 8px;text-align:center;font-family:Tahoma,sans-serif;">${taxableStr}</td>`;
        case 'discount':
          return `<td class="c num" style="padding:6px 8px;text-align:center;font-family:Tahoma,sans-serif;">${discStr}</td>`;
        case 'tax_rate':
          return `<td class="c num" style="padding:6px 8px;text-align:center;font-family:Tahoma,sans-serif;">15%</td>`;
        case 'tax_amount':
          return `<td class="c num" style="padding:6px 8px;text-align:center;font-family:Tahoma,sans-serif;">${vatStr}</td>`;
        case 'total':
          return `<td class="c num" style="padding:6px 8px;text-align:center;font-family:Tahoma,sans-serif;font-weight:700;">${totalStr}</td>`;
        case 'notes':
          return `<td class="c" style="padding:6px 8px;text-align:center;"></td>`;
        default:
          return `<td class="r" style="padding:6px 8px;text-align:right;">${esc(itemName)}</td>`;
      }
    }).join('');

    return `<tr style="background:${bg};">${cells}</tr>`;
  });

  return filledRows.join('');
}

/**
 * محرك استبدال الوسوم الديناميكي الشامل لأي قالب HTML بدون أي قيود أو ثوابت.
 * يكتشف الوسوم والجداول وهيكلتها برمجياً ويستبدلها بالقيم الحقيقية تلقائياً.
 */
export function fillDynamicTemplateHtml(rawHtml, { issuer = {}, client = {}, voucher = null, invoice = null, extra = {} } = {}) {
  if (!rawHtml) return '';

  const doc = voucher || invoice || {};
  const addr = [issuer.building_no, issuer.street, issuer.district, issuer.city].filter(Boolean).join(' - ')
    || issuer.address || issuer.city || '';
  const clientAddr = [client.building_no, client.street, client.district, client.city].filter(Boolean).join(' - ')
    || client.address || client.city || '';

  const docTotal = Number(voucher?.total_amount ?? invoice?.grand_total ?? 0);
  const docDate = voucher?.voucher_date || invoice?.issue_date || new Date().toISOString().slice(0, 10);
  const docNumber = voucher?.voucher_number || invoice?.invoice_number || '';
  const partyName = client.name || voucher?.client_name || invoice?.client_name || '';

  // توليد صفوف الأصناف بذكاء وفق أعمدة القالب الفعلية
  const smartRows = generateSmartRowsJS(rawHtml, invoice?.lines);

  const resolveTagValue = (rawKey) => {
    const k = rawKey.trim().toLowerCase();

    // 1. مخصص في extra
    if (extra[rawKey] !== undefined) return String(extra[rawKey]);
    if (extra[k] !== undefined) return String(extra[k]);

    // 2. بيانات المنشأة المصدرة
    if (k === 'seller_name' || k === 'issuer_name' || k === 'company_name' || k === 'seller' || k === 'receiver_name') {
      return issuer.name_ar || issuer.name || '';
    }
    if (k === 'seller_name_en' || k === 'issuer_name_en') return issuer.name_en || '';
    if (k === 'seller_tax' || k === 'seller_vat' || k === 'tax_number' || k === 'vat_number') {
      return issuer.tax_number || '';
    }
    if (k === 'seller_cr' || k === 'cr_number' || k === 'commercial_register') {
      return issuer.commercial_register || '';
    }
    if (k === 'seller_address' || k === 'issuer_address' || k === 'company_address') return addr;
    if (k === 'seller_address_en') return issuer.address_en || '';
    if (k === 'seller_phone' || k === 'company_phone' || k === 'phone') return issuer.phone || issuer.mobile || '';
    if (k === 'seller_email' || k === 'company_email' || k === 'email') return issuer.email || '';
    if (k === 'seller_iban' || k === 'iban' || k === 'bank_account') return issuer.iban || '';
    if (k === 'bank_name' || k === 'seller_bank') return issuer.bank_name || '';

    // ترويسات بيانات المنشأة الذكية - تظهر فقط القيم المتوفرة بدون ثوابت فارغة
    if (k === 'seller_meta_ar') {
      const parts = [];
      if (addr) parts.push(addr);
      if (issuer.tax_number) {
        parts.push(issuer.tax_number.includes('ضريب') ? issuer.tax_number : `الرقم الضريبي: ${issuer.tax_number}`);
      }
      if (issuer.commercial_register) {
        parts.push(issuer.commercial_register.includes('سجل') ? issuer.commercial_register : `السجل التجاري: ${issuer.commercial_register}`);
      }
      if (issuer.phone || issuer.mobile) {
        const ph = issuer.phone || issuer.mobile;
        parts.push(ph.includes('هاتف') || ph.includes('جوال') ? ph : `جوال: ${ph}`);
      }
      return parts.join('<br />');
    }
    if (k === 'seller_meta_en') {
      const parts = [];
      if (issuer.address_en) parts.push(issuer.address_en);
      if (issuer.tax_number) {
        parts.push(issuer.tax_number.toUpperCase().includes('TAX') ? issuer.tax_number : `TAX NO.: ${issuer.tax_number}`);
      }
      if (issuer.commercial_register) {
        parts.push(issuer.commercial_register.toUpperCase().includes('CR') || issuer.commercial_register.toUpperCase().includes('RECORD') ? issuer.commercial_register : `Commercial Record No : ${issuer.commercial_register}`);
      }
      if (issuer.phone || issuer.mobile) {
        const ph = issuer.phone || issuer.mobile;
        parts.push(ph.toUpperCase().includes('PHONE') ? ph : `PHONE: ${ph}`);
      }
      return parts.join('<br />');
    }

    // 3. بيانات العميل / الطرف المستلم
    if (k === 'buyer_name' || k === 'client_name' || k === 'customer_name' || k === 'received_from' || k === 'client') {
      return partyName;
    }
    if (k === 'buyer_tax' || k === 'client_tax' || k === 'buyer_vat') return client.tax_number || '';
    if (k === 'buyer_cr' || k === 'client_cr') return client.commercial_register || '';
    if (k === 'buyer_address' || k === 'client_address') return clientAddr;
    if (k === 'buyer_phone' || k === 'client_phone') return client.phone || client.mobile || '';
    if (k === 'buyer_email' || k === 'client_email') return client.email || '';
    if (k === 'buyer_city' || k === 'client_city') return client.city || '';
    if (k === 'buyer_street' || k === 'client_street') return client.street || '';
    if (k === 'buyer_district' || k === 'client_district') return client.district || '';
    if (k === 'buyer_postal_code' || k === 'buyer_zip' || k === 'client_postal_code') return client.postal_code || '';
    if (k === 'buyer_building_no' || k === 'client_building_no') return client.building_no || '';

    // 4. أرقام وتواريخ المستند
    if (k === 'invoice_number' || k === 'voucher_number' || k === 'doc_number' || k === 'number' || k === 'reference') {
      return docNumber;
    }
    if (k === 'issue_date' || k === 'voucher_date' || k === 'invoice_date' || k === 'date') {
      return docDate;
    }
    if (k === 'due_date') return invoice?.due_date || '';
    if (k === 'issue_time' || k === 'time') return invoice?.issue_time || '';

    // 5. المبالغ المالية
    if (k === 'amount' || k === 'grand_total' || k === 'total' || k === 'total_amount' || k === 'net_amount') {
      const rawAmt = voucher?.total_amount ?? invoice?.grand_total;
      const n = Number(String(rawAmt ?? '').replace(/,/g, '').trim());
      const val = (!isNaN(n) && Number.isFinite(n)) ? n : 0;
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (k === 'subtotal' || k === 'taxable' || k === 'taxable_amount') {
      const sub = invoice?.subtotal ?? docTotal;
      const n = Number(String(sub ?? '').replace(/,/g, '').trim());
      const val = (!isNaN(n) && Number.isFinite(n)) ? n : 0;
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (k === 'tax_amount' || k === 'vat_amount' || k === 'vat') {
      const tax = invoice?.tax_amount;
      const n = Number(String(tax ?? '').replace(/,/g, '').trim());
      const val = (!isNaN(n) && Number.isFinite(n)) ? n : 0;
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (k === 'discount' || k === 'discount_amount') {
      const d = invoice?.discount_amount ?? invoice?.discount;
      const n = Number(String(d ?? '').replace(/,/g, '').trim());
      const val = (!isNaN(n) && Number.isFinite(n)) ? n : 0;
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (k === 'paid_amount' || k === 'paid') {
      const p = invoice?.paid_amount;
      const n = Number(String(p ?? '').replace(/,/g, '').trim());
      const val = (!isNaN(n) && Number.isFinite(n)) ? n : 0;
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (k === 'remaining_amount' || k === 'due_amount' || k === 'balance_due') {
      const rem = invoice?.remaining_amount;
      const n = Number(String(rem ?? '').replace(/,/g, '').trim());
      const val = (!isNaN(n) && Number.isFinite(n)) ? n : 0;
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (k === 'amount_in_words' || k === 'tafqeet' || k === 'total_in_words') {
      if (doc?.amount_in_words && doc.amount_in_words !== '—' && doc.amount_in_words !== '0') return String(doc.amount_in_words);
      if (docTotal > 0) {
        return Math.floor(docTotal).toLocaleString('ar-SA') + ' ريال سعودي';
      }
      return 'صفر ريال سعودي';
    }

    // 6. طرق الدفع والبيان
    if (k === 'amount_halala' || k === 'halala' || k === 'halalas') {
      const h = Math.round((docTotal % 1) * 100);
      return String(h).padStart(2, '0');
    }
    if (k === 'amount_riyal' || k === 'riyal' || k === 'riyals') {
      return Math.floor(docTotal).toLocaleString('en-US');
    }
    if (k === 'is_cash') {
      const p = (voucher?.payment_type || voucher?.payment_label || invoice?.payment_method || '').toLowerCase();
      return (!p || p.includes('cash') || p.includes('نقد')) ? '✓' : '';
    }
    if (k === 'is_transfer' || k === 'is_bank') {
      const p = (voucher?.payment_type || voucher?.payment_label || invoice?.payment_method || '').toLowerCase();
      return (p.includes('transfer') || p.includes('تحويل') || p.includes('بنك')) ? '✓' : '';
    }
    if (k === 'is_check' || k === 'is_cheque') {
      const p = (voucher?.payment_type || voucher?.payment_label || invoice?.payment_method || '').toLowerCase();
      return (p.includes('check') || p.includes('cheque') || p.includes('شيك')) ? '✓' : '';
    }
    if (k === 'is_card' || k === 'is_pos') {
      const p = (voucher?.payment_type || voucher?.payment_label || invoice?.payment_method || '').toLowerCase();
      return (p.includes('card') || p.includes('pos') || p.includes('شبكة') || p.includes('مدى')) ? '✓' : '';
    }
    if (k === 'payment_method' || k === 'payment_type' || k === 'payment_label' || k === 'payment_mode') {
      return voucher?.payment_label || voucher?.payment_type || invoice?.payment_label || invoice?.payment_method || '';
    }
    if (k === 'notes' || k === 'paid_for' || k === 'description' || k === 'memo' || k === 'statement') {
      return doc.notes || '';
    }
    if (k === 'reference_no' || k === 'cheque_no' || k === 'ref_no' || k === 'check_number') {
      return voucher?.reference_no || '';
    }
    if (k === 'currency_symbol' || k === 'sar_symbol') {
      return `<svg viewBox="0 0 1124.14 1256.39" width="0.88em" height="0.88em" class="sar-sym" style="vertical-align:-0.12em;display:inline-block;fill:currentColor;margin:0 2px;" aria-label="ريال سعودي" title="ريال سعودي"><path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"/><path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"/></svg>`;
    }
    if (k === 'currency') {
      return issuer.currency || 'SAR';
    }

    // 7. الشعار والباركود والرموز الخاصة
    if (k === 'logo' || k === 'seller_logo' || k === 'company_logo') {
      const logoSrc = issuer?.logo_data || issuer?.logo;
      if (logoSrc) {
        return `<img src="${logoSrc}" alt="شعار المنشأة" class="doc-logo-img" style="max-height:75px; max-width:200px; object-fit:contain; display:block;" />`;
      }
      return `<div class="doc-logo-placeholder" style="display:inline-flex; align-items:center; justify-content:center; padding:8px 16px; border:1.5px dashed #94a3b8; border-radius:6px; font-weight:700; color:#64748b; font-size:12px;">شعار المنشأة</div>`;
    }

    if (k === 'qr_code' || k === 'barcode' || k === 'qr' || k === 'zatca_qr') {
      const qrPayload = invoice?.qr_payload || invoice?.qr_code || '';
      if (qrPayload) {
        const svg = qrSvg(qrPayload, { scale: 3, margin: 1 });
        return `<div class="zatca-qr-container" style="display:inline-block; line-height:0;">${svg}</div>`;
      }
      if (globalThis.ZQR && typeof globalThis.ZQR.svg === 'function') {
        const sampleQr = globalThis.ZQR.svg('ZATCA-SAMPLE-INVOICE-PREVIEW', { ecl: 'M', margin: 1, scale: 3 });
        return `<div class="zatca-qr-container" style="display:inline-block; line-height:0;">${sampleQr}</div>`;
      }
      return `<div style="width:90px; height:90px; border:1px solid #0f172a; display:inline-flex; align-items:center; justify-content:center; font-family:monospace; font-size:10px; font-weight:700;">ZATCA QR</div>`;
    }

    if (k === 'remaining_amount' || k === 'due_amount' || k === 'balance_due') {
      const p = Number(invoice?.paid_amount ?? docTotal);
      const rem = Number(invoice?.remaining_amount ?? Math.max(0, docTotal - p));
      return rem.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (k === 'total_qty' || k === 'total_quantity' || k === 'qty_total') {
      const lines = invoice?.lines || [];
      const sum = lines.reduce((acc, l) => acc + Number(l.quantity || 0), 0);
      return sum > 0 ? (sum % 1 === 0 ? String(sum) : sum.toFixed(2)) : '0.00';
    }

    // 8. صفوف وجداول الأصناف الذكية التلقائية لأي قالب
    if (k.startsWith('items_rows') || k.startsWith('items_table_body') || k.startsWith('items_body') || k.startsWith('table_rows')) {
      return smartRows;
    }

    if (k === 'items_table') {
      return `
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin:10px 0;" dir="rtl">
          <thead>
            <tr style="background:#0f172a; color:#fff;">
              <th style="padding:7px 8px; text-align:center; border:1px solid #cbd5e1; width:36px;">#</th>
              <th style="padding:7px 8px; text-align:right; border:1px solid #cbd5e1;">الصنف / الخدمة</th>
              <th style="padding:7px 8px; text-align:center; border:1px solid #cbd5e1; width:70px;">الكمية</th>
              <th style="padding:7px 8px; text-align:right; border:1px solid #cbd5e1; width:95px;">سعر الوحدة</th>
              <th style="padding:7px 8px; text-align:right; border:1px solid #cbd5e1; width:85px;">الضريبة</th>
              <th style="padding:7px 8px; text-align:right; border:1px solid #cbd5e1; width:110px;">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${smartRows}
          </tbody>
        </table>
      `;
    }

    // 9. بحث ديناميكي في حقول الكائن المباشرة
    if (doc[rawKey] !== undefined) return String(doc[rawKey]);
    if (doc[k] !== undefined) return String(doc[k]);
    if (issuer[rawKey] !== undefined) return String(issuer[rawKey]);
    if (issuer[k] !== undefined) return String(issuer[k]);
    if (client[rawKey] !== undefined) return String(client[rawKey]);
    if (client[k] !== undefined) return String(client[k]);

    return '';
  };

  let result = rawHtml.replace(/\{\{\s*([a-zA-Z0-9_\-\.]+)\s*\}\}/g, (match, key) => {
    const val = resolveTagValue(key);
    return val !== undefined ? val : match;
  });

  // استبدال ذكي إضافي إذا كان القالب يحتوي على tbody ثابت أو فارغ بدون وسوم
  const tbodyRegex = /(<tbody\b[^>]*>)([\s\S]*?)(<\/tbody>)/i;
  if (tbodyRegex.test(result) && !rawHtml.includes('{{items_rows') && !rawHtml.includes('{{items_table')) {
    result = result.replace(tbodyRegex, `$1${smartRows}$3`);
  }

  return result;
}
