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
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

/** مبلغ بمنزلتين وفواصل آلاف. */
export function money(value) {
  const n = Number(value || 0);
  return nf2.format(Number.isFinite(n) ? n : 0);
}

/** رقم عام (كميات، أعداد). */
export function num(value) {
  const n = Number(value || 0);
  return nf0.format(Number.isFinite(n) ? n : 0);
}

/** مبلغ مع العملة. */
export function amount(value, currency = 'ر.س') {
  return `${money(value)} ${currency}`;
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
    else if (el.type === 'number') out[key] = el.value === '' ? '' : Number(el.value);
    else out[key] = el.value;
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
  return new Promise((resolve) => {
    const m = modal({
      title,
      slim: true,
      body: html`<p style="margin:0">${message}</p>`,
      footer: `<button class="btn" data-close type="button">إلغاء</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok type="button">${esc(okText)}</button>`,
      onClose: () => resolve(false),
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      m.el.remove();
      resolve(true);
    });
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
    const res = await fetch('/api/pdf/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: window.location.origin },
      body: JSON.stringify({ html: docHtml, filename }),
    });
    if (!res.ok) throw new Error('تعذر إنشاء ملف PDF');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    toastOk('تم تحميل ملف PDF بنجاح 📄');
    return blob;
  } catch (err) {
    console.warn('PDF download fallback to print:', err);
    printDoc(docHtml);
    toastOk('تم فتح حوار الطباعة / الحفظ كملف PDF');
    return null;
  }
}
