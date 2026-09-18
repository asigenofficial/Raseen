// ==========================================================================
//  Raseen — استوديو ومحرر قوالب Excel الاحترافي (Professional Template Studio)
// ==========================================================================
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { html, raw, esc, toastOk, toastErr, $, $$ } from '../core/util.js';

// ─── Color Themes ─────────────────────────────────────────────────────────
const THEMES = [
  { id: 'emerald', name: 'زمردي رسمي', primary: '#059669', accent: '#047857', bgLight: '#ecfdf5' },
  { id: 'forest', name: 'أخضر غابة', primary: '#15803d', accent: '#166534', bgLight: '#f0fdf4' },
  { id: 'jade', name: 'يشمي هادئ', primary: '#0f766e', accent: '#115e59', bgLight: '#f0fdfa' },
  { id: 'mint', name: 'نعناعي عصري', primary: '#10b981', accent: '#059669', bgLight: '#ecfdf5' },
];

// ─── Categorized Smart Variables ──────────────────────────────────────────
const VARIABLE_CATEGORIES = [
  {
    category: '📄 الفاتورة والسند',
    items: [
      { tag: '{invoice_number}', label: 'رقم الفاتورة', sample: 'INV-2026-0842' },
      { tag: '{date}', label: 'تاريخ المستند', sample: '2026-09-16' },
      { tag: '{payment_method}', label: 'طريقة الدفع', sample: 'تحويل بنكي' },
      { tag: '{voucher_number}', label: 'رقم السند', sample: 'RV-2026-0155' },
      { tag: '{bank_ref}', label: 'المرجع البنكي', sample: 'TXN-984210' },
      { tag: '{notes}', label: 'الملاحظات والشروط', sample: 'خاضعة للشروط والأحكام الرسمية' },
    ]
  },
  {
    category: '🏢 الشركة المصدرة',
    items: [
      { tag: '{company_name}', label: 'اسم الشركة', sample: 'شركة الأفق الحديث للأنظمة التقنية' },
      { tag: '{tax_number}', label: 'الرقم الضريبي', sample: '310123456700003' },
      { tag: '{cr_number}', label: 'السجل التجاري', sample: '1010765432' },
      { tag: '{address}', label: 'العنوان الوطني', sample: 'الرياض - طريق الملك فهد' },
    ]
  },
  {
    category: '👤 العميل / المستلم',
    items: [
      { tag: '{client_name}', label: 'اسم العميل', sample: 'مؤسسة النخبة للمقاولات العامة' },
      { tag: '{client_tax}', label: 'ضريبي العميل', sample: '300987654300003' },
      { tag: '{client_address}', label: 'عنوان العميل', sample: 'جدة - حي الروضة' },
    ]
  },
  {
    category: '💰 المبالغ والضرائب',
    items: [
      { tag: '{subtotal}', label: 'المجموع قبل الضريبة', sample: '10,000.00' },
      { tag: '{tax_amount}', label: 'مبلغ الضريبة 15%', sample: '1,500.00' },
      { tag: '{total}', label: 'الإجمالي النهائي', sample: '11,500.00' },
      { tag: '{amount_in_words}', label: 'المبلغ كتابةً', sample: 'أحد عشر ألفاً وخمسمائة ريال سعودي فقط لا غير' },
    ]
  }
];

// Flattened variables map for sample replacement
const SAMPLE_MAP = {};
VARIABLE_CATEGORIES.forEach(cat => {
  cat.items.forEach(it => {
    SAMPLE_MAP[it.tag] = it.sample;
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────
function colLetter(idx) {
  let name = '', n = idx;
  do { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return name;
}

function parseCellRef(ref) {
  if (!ref) return null;
  const m = String(ref).trim().match(/^([A-Z]+)([0-9]+)$/i);
  if (!m) return null;
  let col = 0;
  const s = m[1].toUpperCase();
  for (let i = 0; i < s.length; i++) col = col * 26 + (s.charCodeAt(i) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) };
}

function parseRange(rangeStr) {
  if (!rangeStr) return null;
  const parts = String(rangeStr).split(':');
  if (parts.length !== 2) return null;
  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1]);
  if (!start || !end) return null;
  return {
    c1: Math.min(start.col, end.col),
    r1: Math.min(start.row, end.row),
    c2: Math.max(start.col, end.col),
    r2: Math.max(start.row, end.row),
  };
}

/**
 * تحويل نتيجة فحص ملف Excel القادمة من الخادم إلى gridState جاهز للتحرير
 */
function gridStateFromInspection(inspection) {
  const layout = Array.isArray(inspection?.layoutGrid) ? inspection.layoutGrid : [];
  const fills = Array.isArray(inspection?.layoutFills) ? inspection.layoutFills : [];
  const merges = Array.isArray(inspection?.layoutMerges) ? inspection.layoutMerges.filter(Boolean) : [];

  const rowsCount = Math.max(20, Math.min(80, layout.length + 4));
  let colsCount = 8;
  layout.forEach((row) => {
    if (Array.isArray(row)) colsCount = Math.max(colsCount, row.length);
  });
  colsCount = Math.max(8, Math.min(24, colsCount + 2));

  const cols = Array.from({ length: colsCount }, () => ({ width: 14 }));
  const rows = Array.from({ length: rowsCount }, () => ({ height: 24 }));
  const cells = {};

  for (let r = 0; r < Math.min(layout.length, rowsCount); r++) {
    const row = Array.isArray(layout[r]) ? layout[r] : [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      const pos = colLetter(c) + (r + 1);
      const bg = fills[r] && fills[r][c] ? fills[r][c] : undefined;
      if (v || bg) {
        cells[pos] = {
          v: String(v || ''),
          size: 11,
          align: 'right',
          ...(bg && bg !== '#ffffff' ? { bg } : {}),
        };
      }
    }
  }

  const validMerges = merges
    .map(m => String(m).toUpperCase())
    .filter(m => /^[A-Z]+[0-9]+:[A-Z]+[0-9]+$/.test(m))
    .slice(0, 60);

  return { cols, rows, cells, merges: validMerges };
}

function lightenHex(hex, factor = 0.85) {
  const c = String(hex || '#000000').replace('#', '').padEnd(6, '0');
  const r = Math.round(parseInt(c.slice(0, 2), 16) + (255 - parseInt(c.slice(0, 2), 16)) * factor);
  const g = Math.round(parseInt(c.slice(2, 4), 16) + (255 - parseInt(c.slice(2, 4), 16)) * factor);
  const b = Math.round(parseInt(c.slice(4, 6), 16) + (255 - parseInt(c.slice(4, 6), 16)) * factor);
  return '#' + [r, g, b].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
}

// ─── Presets ──────────────────────────────────────────────────────────────
function getTaxInvoicePreset(primary = '#059669') {
  const lt = lightenHex(primary, 0.92);
  const ac = lightenHex(primary, 0.15);

  const cols = [
    { width: 6 },  // A: م
    { width: 30 }, // B: الصنف
    { width: 10 }, // C: الكمية
    { width: 14 }, // D: السعر
    { width: 14 }, // E: الضريبة
    { width: 16 }, // F: الإجمالي
  ];
  const rows = Array.from({ length: 24 }, (_, i) => {
    if (i === 0) return { height: 42 };
    if (i === 1) return { height: 24 };
    if (i === 2) return { height: 32 };
    if (i === 5) return { height: 8 };
    if (i === 6) return { height: 30 };
    if (i === 20) return { height: 30 };
    if (i === 23) return { height: 55 };
    return { height: 23 };
  });

  const cells = {
    'A1': { v: store.activeIssuer?.name_ar || 'اسم المنشأة / الشركة المصدرة', bg: primary, color: '#ffffff', bold: true, size: 16, align: 'center' },
    'A2': { v: 'الرقم الضريبي: {tax_number}  |  السجل التجاري: {cr_number}  |  {address}', bg: lt, color: '#1e293b', bold: false, size: 10, align: 'center' },
    'A3': { v: 'فاتورة ضريبية معتمدة — TAX INVOICE', bg: ac, color: '#ffffff', bold: true, size: 13, align: 'center' },

    'A4': { v: 'رقم الفاتورة: {invoice_number}', bg: '#ffffff', color: '#0f172a', bold: true, size: 11, align: 'right' },
    'C4': { v: 'التاريخ: {date}', bg: '#ffffff', color: '#0f172a', bold: false, size: 11, align: 'right' },
    'E4': { v: 'طريقة الدفع: {payment_method}', bg: '#ffffff', color: '#0f172a', bold: false, size: 11, align: 'right' },

    'A5': { v: 'اسم العميل: {client_name}', bg: '#f8fafc', color: '#0f172a', bold: true, size: 11, align: 'right' },
    'C5': { v: 'الرقم الضريبي للعميل: {client_tax}', bg: '#f8fafc', color: '#0f172a', bold: false, size: 11, align: 'right' },
    'E5': { v: 'عنوان العميل: {client_address}', bg: '#f8fafc', color: '#0f172a', bold: false, size: 11, align: 'right' },

    'A7': { v: 'م', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'B7': { v: 'اسم الصنف / الخدمة', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'C7': { v: 'الكمية', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'D7': { v: 'سعر الوحدة', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'E7': { v: 'ضريبة القيمة المضافة', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'F7': { v: 'الإجمالي شامل الضريبة', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },

    'A8': { v: '1', bg: '#ffffff', color: '#64748b', bold: false, size: 10, align: 'center' },
    'B8': { v: 'تقديم خدمات استشارية وتطوير برمجيات', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'right' },
    'C8': { v: '1', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'center' },
    'D8': { v: '1000.00', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'center' },
    'E8': { v: '150.00', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'center' },
    'F8': { v: '1150.00', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'center' },

    'A19': { v: 'المجموع قبل الضريبة (الخاضع للضريبة):', bg: lt, color: '#1e293b', bold: true, size: 10, align: 'right' },
    'E19': { v: '{subtotal}', bg: lt, color: primary, bold: true, size: 11, align: 'center' },

    'A20': { v: 'ضريبة القيمة المضافة (15%):', bg: lt, color: '#1e293b', bold: true, size: 10, align: 'right' },
    'E20': { v: '{tax_amount}', bg: lt, color: primary, bold: true, size: 11, align: 'center' },

    'A21': { v: 'الإجمالي النهائي المستحق شامل الضريبة:', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'right' },
    'E21': { v: '{total}', bg: primary, color: '#ffffff', bold: true, size: 13, align: 'center' },

    'A22': { v: 'المبلغ كتابةً: {amount_in_words}', bg: '#f8fafc', color: '#475569', bold: false, size: 10, align: 'right' },
    'A23': { v: 'الملاحظات والشروط: {notes}', bg: '#ffffff', color: '#475569', bold: false, size: 10, align: 'right' },

    'A24': { v: 'توقيع المستلم:\n....................', bg: '#ffffff', color: '#64748b', bold: false, size: 10, align: 'center' },
    'C24': { v: 'المحاسب المسؤول:\n....................', bg: '#ffffff', color: '#64748b', bold: false, size: 10, align: 'center' },
    'E24': { v: 'اعتماد الإدارة:\n....................', bg: '#ffffff', color: '#64748b', bold: false, size: 10, align: 'center' },
  };

  const merges = [
    'A1:F1', 'A2:F2', 'A3:F3',
    'A4:B4', 'C4:D4', 'E4:F4',
    'A5:B5', 'C5:D5', 'E5:F5',
    'A19:D19', 'E19:F19',
    'A20:D20', 'E20:F20',
    'A21:D21', 'E21:F21',
    'A22:F22', 'A23:F23',
    'A24:B24', 'C24:D24', 'E24:F24',
  ];

  return { cols, rows, cells, merges };
}

function getReceiptVoucherPreset(primary = '#059669') {
  const lt = lightenHex(primary, 0.92);
  const ac = lightenHex(primary, 0.15);

  const cols = [
    { width: 6 },
    { width: 24 },
    { width: 14 },
    { width: 22 },
    { width: 16 },
    { width: 16 },
  ];
  const rows = Array.from({ length: 20 }, (_, i) => {
    if (i === 0) return { height: 42 };
    if (i === 1) return { height: 24 };
    if (i === 2) return { height: 32 };
    if (i === 8) return { height: 8 };
    if (i === 9) return { height: 30 };
    if (i === 16) return { height: 30 };
    if (i === 19) return { height: 55 };
    return { height: 23 };
  });

  const cells = {
    'A1': { v: store.activeIssuer?.name_ar || 'اسم المنشأة / الشركة المصدرة', bg: primary, color: '#ffffff', bold: true, size: 16, align: 'center' },
    'A2': { v: 'الرقم الضريبي: {tax_number}  |  السجل التجاري: {cr_number}', bg: lt, color: '#1e293b', bold: false, size: 10, align: 'center' },
    'A3': { v: 'سند قبض مالي معتمد — OFFICIAL RECEIPT VOUCHER', bg: ac, color: '#ffffff', bold: true, size: 13, align: 'center' },

    'A4': { v: 'رقم السند: {voucher_number}', bg: '#ffffff', color: '#0f172a', bold: true, size: 11, align: 'right' },
    'D4': { v: 'التاريخ: {date}', bg: '#ffffff', color: '#0f172a', bold: false, size: 11, align: 'right' },

    'A5': { v: 'استلمنا من المكرم / السادة: {client_name}', bg: '#f8fafc', color: '#0f172a', bold: true, size: 11, align: 'right' },
    'A6': { v: 'مبلغ وقدره: {amount} ريال سعودي', bg: '#ffffff', color: primary, bold: true, size: 11, align: 'right' },
    'D6': { v: 'المبلغ كتابة: {amount_in_words}', bg: '#ffffff', color: '#475569', bold: false, size: 10, align: 'right' },

    'A7': { v: 'طريقة السداد: {payment_method}', bg: '#f8fafc', color: '#0f172a', bold: false, size: 10, align: 'right' },
    'D7': { v: 'رقم المرجع البنكي / الشيك: {bank_ref}', bg: '#f8fafc', color: '#0f172a', bold: false, size: 10, align: 'right' },

    'A8': { v: 'وذلك لقاء: {notes}', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'right' },

    'A10': { v: 'م', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'B10': { v: 'رقم الفاتورة المرتبطة', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'C10': { v: 'التاريخ', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'D10': { v: 'اسم العميل', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'E10': { v: 'طريقة الدفع', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },
    'F10': { v: 'المبلغ المسدد', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'center' },

    'A11': { v: '1', bg: '#ffffff', color: '#64748b', bold: false, size: 10, align: 'center' },
    'B11': { v: 'INV-2026-001', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'center' },
    'C11': { v: '2026-09-16', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'center' },
    'D11': { v: 'شركة النخبة للتجارة', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'right' },
    'E11': { v: 'حوالة بنكية', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'center' },
    'F11': { v: '5,000.00', bg: '#ffffff', color: '#334155', bold: false, size: 10, align: 'center' },

    'A17': { v: 'إجمالي المبالغ المقبوضة:', bg: primary, color: '#ffffff', bold: true, size: 11, align: 'right' },
    'F17': { v: '{total}', bg: primary, color: '#ffffff', bold: true, size: 12, align: 'center' },

    'A19': { v: 'توقيع المستلم:\n....................', bg: '#ffffff', color: '#64748b', bold: false, size: 10, align: 'center' },
    'D19': { v: 'اعتماد الإدارة والمحاسبة:\n....................', bg: '#ffffff', color: '#64748b', bold: false, size: 10, align: 'center' },
  };

  const merges = [
    'A1:F1', 'A2:F2', 'A3:F3',
    'A4:C4', 'D4:F4',
    'A5:F5',
    'A6:C6', 'D6:F6',
    'A7:C7', 'D7:F7',
    'A8:F8',
    'A17:E17',
    'A19:C19', 'D19:F19',
  ];

  return { cols, rows, cells, merges };
}

function getBlankPreset() {
  const cols = Array.from({ length: 8 }, () => ({ width: 16 }));
  const rows = Array.from({ length: 24 }, () => ({ height: 24 }));
  return { cols, rows, cells: {}, merges: [] };
}

function getInvoicePresetVariant(kind, primary = '#059669') {
  const grid = getTaxInvoicePreset(primary);
  if (kind === 'compact') {
    grid.cols = [{ width: 5 }, { width: 24 }, { width: 9 }, { width: 12 }, { width: 12 }, { width: 14 }];
    grid.rows = grid.rows.map((row, i) => ({ height: i < 3 ? Math.max(22, row.height - 6) : Math.max(18, row.height - 4) }));
    grid.cells.A3.v = 'فاتورة ضريبية مختصرة — COMPACT TAX INVOICE';
  } else if (kind === 'services') {
    grid.cols = [{ width: 6 }, { width: 38 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 16 }];
    grid.cells.B7.v = 'وصف الخدمة / نطاق العمل';
    grid.cells.C7.v = 'الساعات';
    grid.cells.D7.v = 'سعر الساعة';
    grid.cells.B8.v = 'خدمات مهنية واستشارية حسب نطاق العمل المعتمد';
    grid.cells.A3.v = 'فاتورة خدمات مهنية — PROFESSIONAL SERVICES';
  } else if (kind === 'retail') {
    grid.cols = [{ width: 5 }, { width: 28 }, { width: 9 }, { width: 12 }, { width: 12 }, { width: 15 }];
    grid.cells.B7.v = 'المنتج / الباركود';
    grid.cells.B8.v = 'منتج تجريبي — SKU-1001';
    grid.cells.A3.v = 'فاتورة مبيعات وتجزئة — RETAIL INVOICE';
  } else if (kind === 'contracting') {
    grid.cols = [{ width: 5 }, { width: 34 }, { width: 10 }, { width: 12 }, { width: 13 }, { width: 16 }];
    grid.cells.B7.v = 'وصف أعمال المقاولات / البند التعاقدي';
    grid.cells.B8.v = 'أعمال البناء حسب الكميات الجدولية المعتمدة';
    grid.cells.B9.v = 'رقم أمر الشراء / العقد: {notes}';
    grid.cells.A3.v = 'فاتورة مقاولات وأعمال إنشائية — CONTRACTING INVOICE';
  } else if (kind === 'logistics') {
    grid.cols = [{ width: 5 }, { width: 30 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 16 }];
    grid.cells.B7.v = 'وصف الشحنة / الخدمة اللوجستية';
    grid.cells.C7.v = 'الكمية / الوزن';
    grid.cells.D7.v = 'سعر الوحدة';
    grid.cells.B8.v = 'خدمات نقل وتخزين وتوزيع داخل المملكة';
    grid.cells.A3.v = 'فاتورة خدمات لوجستية ونقل — LOGISTICS INVOICE';
  }
  return grid;
}

// ─── Ready Templates (قوالب جاهزة بنقرة واحدة) ───────────────────────────
const READY_TEMPLATES = [
  { id: 'ready-tax-emerald', name: 'فاتورة ضريبية كلاسيكية', desc: 'النموذج الرسمي المعتمد مع ترويسة كاملة', kind: 'classic', type: 'invoices', primary: '#059669' },
  { id: 'ready-tax-blue', name: 'فاتورة شركات ومقاولات', desc: 'رسمية بالأزرق الملكي مع بنود أعمال تعاقدية', kind: 'contracting', type: 'invoices', primary: '#1e40af' },
  { id: 'ready-tax-services', name: 'فاتورة خدمات مهنية', desc: 'مناسبة للاستشارات والمهن الحرة (ساعات × سعر)', kind: 'services', type: 'invoices', primary: '#6d28d9' },
  { id: 'ready-tax-retail', name: 'فاتورة مبيعات وتجزئة', desc: 'سريعة للتجزئة والباركود — أعمدة مدمجة', kind: 'retail', type: 'invoices', primary: '#b45309' },
  { id: 'ready-tax-logistics', name: 'فاتورة خدمات لوجستية', desc: 'نقل وتخزين وتوزيع مع أوزان الشحنات', kind: 'logistics', type: 'invoices', primary: '#0f766e' },
  { id: 'ready-tax-compact', name: 'فاتورة مختصرة', desc: 'نموذج مدمج مناسب للطباعة الحرارية والموبايل', kind: 'compact', type: 'invoices', primary: '#334155' },
  { id: 'ready-receipt-emerald', name: 'سند قبض مالي معتمد', desc: 'سند قبض رسمي مع جدول الفواتير المسددة', kind: 'receipt', type: 'documents', primary: '#047857' },
  { id: 'ready-receipt-maroon', name: 'سند صرف فاخر', desc: 'سند صرف بالعنابي مع خانات الاعتماد والتوقيع', kind: 'receipt', type: 'documents', primary: '#9f1239' },
];

function buildReadyTemplate(t) {
  cfg.type = t.type;
  cfg.primary_color = t.primary;
  cfg.accent_color = lightenHex(t.primary, 0.15);
  if (t.kind === 'receipt') {
    cfg.gridState = getReceiptVoucherPreset(t.primary);
  } else {
    cfg.gridState = getInvoicePresetVariant(t.kind, t.primary);
  }
  editingId = null;
  activeCell = 'A1';
  activeTab = 'editor';
  renderView();
  attachEvents();
}

// ─── Studio State ─────────────────────────────────────────────────────────
let cfg = {
  type: 'invoices',
  name_ar: '',
  company_name_ar: '',
  primary_color: '#059669',
  accent_color: '#047857',
  logo_data: '',
  logo_width: 140,
  logo_height: 70,
  logo_position: 'left',
  gridState: null,
};

let activeTab = 'editor';      // 'editor' | 'preview' | 'settings' | 'gallery'
let previewMode = 'sample';    // 'sample' (واقعية) | 'tags' (الوسوم)
let activeCell = 'A1';
let existingTemplates = [];
let editingId = null;
let saving = false;
let view = null;
let zoomLevel = 100;

// ─── Spreadsheet Table Render ─────────────────────────────────────────────
function renderGridTable() {
  const grid = cfg.gridState || getTaxInvoicePreset(cfg.primary_color);
  cfg.gridState = grid;
  const numCols = grid.cols.length;
  const numRows = grid.rows.length;
  const merges = grid.merges || [];

  const parsedMerges = merges.map(m => {
    const r = parseRange(m);
    return r ? { ...r, raw: m } : null;
  }).filter(Boolean);

  function checkMerge(row, col) {
    for (const m of parsedMerges) {
      if (row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2) {
        if (row === m.r1 && col === m.c1) {
          return { isOrigin: true, colspan: m.c2 - m.c1 + 1, rowspan: m.r2 - m.r1 + 1, range: m.raw };
        }
        return { isSlave: true };
      }
    }
    return null;
  }

  // Header row with letters
  let thCells = `<th class="tb-corner-th" title="تحديد ورقة العمل">⊞</th>`;
  for (let c = 0; c < numCols; c++) {
    const letter = colLetter(c);
    const w = grid.cols[c]?.width || 14;
    thCells += `<th class="tb-col-th" data-col="${c}" style="width:${w * 10}px;min-width:${w * 10}px;">
      <div class="tb-col-title">${letter}</div>
      <div class="tb-col-resizer" data-col="${c}" title="اسحب أو انقر لضبط العرض"></div>
    </th>`;
  }
  const theadHtml = `<thead><tr>${thCells}</tr></thead>`;

  // Body rows
  let tbodyHtml = '<tbody>';
  for (let r = 1; r <= numRows; r++) {
    const rIdx = r - 1;
    const h = grid.rows[rIdx]?.height || 24;
    let rowCells = `<th class="tb-row-th" data-row="${r}">
      <span>${r}</span>
    </th>`;

    for (let c = 0; c < numCols; c++) {
      const mergeInfo = checkMerge(r, c);
      if (mergeInfo?.isSlave) continue;

      const pos = colLetter(c) + r;
      const cellData = grid.cells[pos] || {};
      const isActive = pos === activeCell;
      const val = cellData.v !== undefined ? cellData.v : '';

      const bg = cellData.bg ? `background-color:${cellData.bg};` : '';
      const color = cellData.color ? `color:${cellData.color};` : '';
      const bold = cellData.bold ? `font-weight:700;` : '';
      const size = cellData.size ? `font-size:${cellData.size}px;` : 'font-size:11px;';
      const align = cellData.align ? `text-align:${cellData.align};` : 'text-align:right;';

      const cs = mergeInfo?.isOrigin && mergeInfo.colspan > 1 ? ` colspan="${mergeInfo.colspan}"` : '';
      const rs = mergeInfo?.isOrigin && mergeInfo.rowspan > 1 ? ` rowspan="${mergeInfo.rowspan}"` : '';

      const img = cellData.image;
      const imgHtml = img?.src ? `<img src="${esc(img.src)}" class="tb-cell-img" style="max-width:${Math.min(img.width || 80, (grid.cols[c]?.width || 14) * 10 - 8)}px;max-height:${Math.min(img.height || 60, h - 8)}px;" alt="صورة" />` : '';

      rowCells += `<td class="tb-grid-cell${isActive ? ' tb-cell-active' : ''}${img?.src ? ' tb-cell-has-image' : ''}"
        data-ref="${pos}"
        ${cs}${rs}
        style="${bg}${color}${bold}${size}${align}height:${h}px;"
        tabindex="0">
        ${imgHtml}
        <div class="tb-cell-val" contenteditable="true" spellcheck="false" dir="auto" data-ref="${pos}">${esc(val)}</div>
      </td>`;
    }

    tbodyHtml += `<tr style="height:${h}px;">
      <th class="tb-row-th" data-row="${r}">
        <span>${r}</span>
        <div class="tb-row-resizer" data-row="${r}" title="اسحب أو انقر لضبط الارتفاع"></div>
      </th>
      ${rowCells.replace(`<th class="tb-row-th" data-row="${r}">\n      <span>${r}</span>\n    </th>`, '')}
    </tr>`;
  }
  tbodyHtml += '</tbody>';

  return `<div class="tb-grid-viewport" style="transform:scale(${zoomLevel / 100});transform-origin:top right;">
    <table class="tb-main-table" id="tb-grid-table">
      ${theadHtml}
      ${tbodyHtml}
    </table>
  </div>`;
}

// ─── A4 Realistic Print Preview ───────────────────────────────────────────
function renderPrintPreview() {
  const grid = cfg.gridState || getTaxInvoicePreset(cfg.primary_color);
  const numCols = grid.cols.length;
  const numRows = grid.rows.length;
  const merges = grid.merges || [];

  const parsedMerges = merges.map(m => {
    const r = parseRange(m);
    return r ? { ...r, raw: m } : null;
  }).filter(Boolean);

  function checkMerge(row, col) {
    for (const m of parsedMerges) {
      if (row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2) {
        if (row === m.r1 && col === m.c1) {
          return { isOrigin: true, colspan: m.c2 - m.c1 + 1, rowspan: m.r2 - m.r1 + 1 };
        }
        return { isSlave: true };
      }
    }
    return null;
  }

  let tableRows = '';
  for (let r = 1; r <= numRows; r++) {
    let rowCells = '';
    let hasContent = false;

    for (let c = 0; c < numCols; c++) {
      const mergeInfo = checkMerge(r, c);
      if (mergeInfo?.isSlave) continue;

      const pos = colLetter(c) + r;
      const cellData = grid.cells[pos] || {};
      let val = cellData.v !== undefined ? String(cellData.v) : '';

      if (val || cellData.bg) hasContent = true;

      // In sample mode, replace tags with realistic data
      if (previewMode === 'sample' && val) {
        Object.entries(SAMPLE_MAP).forEach(([tag, sample]) => {
          val = val.replaceAll(tag, sample);
        });
      }

      const bg = cellData.bg ? `background-color:${cellData.bg};` : '';
      const color = cellData.color ? `color:${cellData.color};` : '';
      const bold = cellData.bold ? `font-weight:700;` : '';
      const size = cellData.size ? `font-size:${cellData.size}px;` : 'font-size:11px;';
      const align = cellData.align ? `text-align:${cellData.align};` : 'text-align:right;';

      const cs = mergeInfo?.isOrigin && mergeInfo.colspan > 1 ? ` colspan="${mergeInfo.colspan}"` : '';
      const rs = mergeInfo?.isOrigin && mergeInfo.rowspan > 1 ? ` rowspan="${mergeInfo.rowspan}"` : '';

      const img = cellData.image;
      const imgHtml = img?.src ? `<img src="${esc(img.src)}" style="display:block;max-width:100%;max-height:${Math.min(img.height || 80, 120)}px;object-fit:contain;margin:2px auto;" alt="" />` : '';
      if (img?.src) hasContent = true;

      rowCells += `<td ${cs}${rs} style="${bg}${color}${bold}${size}${align}padding:4px 8px;border:1px solid #cbd5e1;white-space:pre-wrap;">${imgHtml}${esc(val)}</td>`;
    }

    if (hasContent || r <= 15) {
      tableRows += `<tr>${rowCells}</tr>`;
    }
  }

  return `
  <div class="tb-preview-container">
    <div class="tb-preview-toolbar">
      <div class="tb-preview-toggles">
        <span style="font-size:0.85rem;color:var(--text-muted);font-weight:700;">وضع المعاينة:</span>
        <button type="button" class="btn btn-sm tb-prev-mode-btn${previewMode === 'sample' ? ' active' : ''}" data-pmode="sample">
          ✨ بيانات واقعية ونموذجية
        </button>
        <button type="button" class="btn btn-sm tb-prev-mode-btn${previewMode === 'tags' ? ' active' : ''}" data-pmode="tags">
          🏷️ الوسوم الذكية الخام
        </button>
      </div>

      <div class="tb-preview-actions">
        <button class="btn btn-sm" id="btn-print-preview" title="طباعة فورية">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          طباعة A4
        </button>
      </div>
    </div>

    <!-- Realistic Paper -->
    <div class="tb-paper-sheet" id="tb-printable-sheet" style="transform:scale(${zoomLevel / 100});transform-origin:top center;">
      <table style="width:100%;border-collapse:collapse;direction:rtl;font-family:Calibri,Arial,sans-serif;">
        ${tableRows}
      </table>
    </div>
  </div>`;
}

// ─── Settings / Branding Tab ──────────────────────────────────────────────
function renderSettingsTab() {
  const themeButtons = THEMES.map(t =>
    `<button type="button" class="tb-theme-card${cfg.primary_color === t.primary ? ' active' : ''}" data-theme="${t.id}">
      <div class="tb-theme-bar" style="background:${t.primary};"></div>
      <div class="tb-theme-info">
        <span class="tb-theme-title">${esc(t.name)}</span>
        <span class="tb-theme-hex">${t.primary}</span>
      </div>
    </button>`
  ).join('');

  return `
  <div class="tb-settings-wrap">
    <div class="tb-card">
      <div class="tb-card-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <h3>إعدادات وهوية القالب المتقدمة</h3>
      </div>
      <div class="tb-card-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="field">
            <label>اسم القالب الرسمي *</label>
            <input type="text" id="inp-settings-name" value="${esc(cfg.name_ar)}" placeholder="مثال: فاتورة ضريبية رسمية 2026" style="width:100%;" />
          </div>
          <div class="field">
            <label>اسم المنشأة في الرأس</label>
            <input type="text" id="inp-settings-company" value="${esc(cfg.company_name_ar)}" placeholder="اسم شركتك" style="width:100%;" />
          </div>
        </div>

        <div class="field" style="margin-top:1rem;">
          <label>نوع القالب وتصنيفه</label>
          <div style="display:flex;gap:10px;">
            <button type="button" class="btn tb-settings-type${cfg.type === 'invoices' ? ' active' : ''}" data-type="invoices" style="flex:1;">
              📄 فاتورة مبيعات وضريبة (Invoices)
            </button>
            <button type="button" class="btn tb-settings-type${cfg.type === 'documents' ? ' active' : ''}" data-type="documents" style="flex:1;">
              🧾 سند قبض ومستندات (Vouchers)
            </button>
          </div>
        </div>

        <div class="field" style="margin-top:1.2rem;">
          <label>السمة اللونية المعتمدة (تطبق تلقائياً على الترويسات والعناوين)</label>
          <div class="tb-themes-grid">
            ${raw(themeButtons)}
          </div>
        </div>

        <div class="field" style="margin-top:1.2rem;">
          <label>شعار المنشأة داخل ملف Excel (PNG أو JPG، بحد أقصى 2MB)</label>
          <div class="tb-logo-upload">
            <div class="tb-logo-preview">
              ${cfg.logo_data ? `<img src="${esc(cfg.logo_data)}" alt="معاينة الشعار" />` : '<span>لا توجد صورة</span>'}
            </div>
            <div style="flex:1;display:grid;gap:10px;">
              <input type="file" id="inp-template-logo" accept="image/png,image/jpeg" />
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                <label class="field">العرض بالبكسل<input type="number" id="inp-logo-width" min="40" max="500" value="${Number(cfg.logo_width) || 140}" /></label>
                <label class="field">الارتفاع بالبكسل<input type="number" id="inp-logo-height" min="30" max="250" value="${Number(cfg.logo_height) || 70}" /></label>
                <label class="field">الموضع<select id="sel-logo-position"><option value="left" ${cfg.logo_position === 'left' ? 'selected' : ''}>يسار الرأس</option><option value="center" ${cfg.logo_position === 'center' ? 'selected' : ''}>وسط الرأس</option><option value="right" ${cfg.logo_position === 'right' ? 'selected' : ''}>يمين الرأس</option></select></label>
              </div>
              ${cfg.logo_data ? '<button type="button" class="btn btn-sm" id="btn-remove-template-logo">إزالة الصورة</button>' : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Saved Gallery Tab ────────────────────────────────────────────────────
function renderGalleryTab() {
  const readyCards = READY_TEMPLATES.map(t => `
    <div class="tb-gallery-card tb-ready-card">
      <div class="tb-gallery-badge" style="background:${t.primary};"></div>
      <div class="tb-gallery-content">
        <div class="tb-gallery-header">
          <span class="tb-gallery-type">${t.type === 'documents' ? '🧾 سند' : '📄 فاتورة'}</span>
          <span class="tb-gallery-ext tb-ext-new">جديد</span>
        </div>
        <h4 class="tb-gallery-name">${esc(t.name)}</h4>
        <div class="tb-ready-desc">${esc(t.desc)}</div>
      </div>
      <div class="tb-gallery-actions">
        <button class="btn btn-sm btn-primary tpl-ready-btn" data-ready-id="${esc(t.id)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          استخدام في المحرر
        </button>
      </div>
    </div>`).join('');

  const readySection = `
  <div style="margin-bottom:1.5rem;">
    <h3 style="margin:0 0 0.75rem;font-size:1.1rem;display:flex;align-items:center;gap:8px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      قوالب جاهزة بنقرة واحدة (${READY_TEMPLATES.length})
    </h3>
    <div class="tb-gallery-grid">${raw(readyCards)}</div>
  </div>`;

  if (!existingTemplates.length) {
    return `
    <div class="tb-gallery-wrap">
      ${readySection}
      <div class="tb-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <h3>لا توجد قوالب مخصصة محفوظة بعد</h3>
        <p>أنشئ قالبك الأول الآن من محرر الخلايا واحفظه كملف Excel حقيقي!</p>
        <button class="btn btn-primary" id="btn-create-first-tpl">إنشاء قالب جديد الآن</button>
      </div>
    </div>`;
  }

  const cards = existingTemplates.map(t => {
    const bc = t.builder_config ? (typeof t.builder_config === 'object' ? t.builder_config : {}) : {};
    const pc = bc.primary_color || t.color_hex || '#059669';
    const isEditing = editingId === t.id;

    return `
    <div class="tb-gallery-card${isEditing ? ' active' : ''}">
      <div class="tb-gallery-badge" style="background:${pc};"></div>
      <div class="tb-gallery-content">
        <div class="tb-gallery-header">
          <span class="tb-gallery-type">${t.category === 'documents' ? '🧾 سند قبض' : '📄 فاتورة ضريبية'}</span>
          <span class="tb-gallery-ext">.XLSX</span>
        </div>
        <h4 class="tb-gallery-name">${esc(t.name_ar || t.id)}</h4>
        <div class="tb-gallery-file">${esc(t.id)}.xlsx</div>
        <div class="tb-gallery-meta">مسجل ومتاح لتصدير الفواتير والسندات</div>
      </div>
      <div class="tb-gallery-actions">
        <button class="btn btn-sm btn-primary tpl-btn-edit" data-tpl-id="${esc(t.id)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          تعديل في المحرر
        </button>
        <button class="btn btn-sm tpl-btn-dl" data-tpl-id="${esc(t.id)}" title="تحميل ملف Excel">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          تحميل
        </button>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="tb-gallery-wrap">
    ${readySection}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h3 style="margin:0;font-size:1.1rem;display:flex;align-items:center;gap:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        مكتبة القوالب المسجلة (${existingTemplates.length})
      </h3>
    </div>
    <div class="tb-gallery-grid">
      ${raw(cards)}
    </div>
  </div>`;
}

// ─── Main View Assembly ───────────────────────────────────────────────────
function renderView() {
  const activeCellData = (cfg.gridState?.cells && cfg.gridState.cells[activeCell]) || {};

  // Build Variable Dropdown Items
  const varsHtml = VARIABLE_CATEGORIES.map(cat => `
    <div class="tb-var-group">
      <div class="tb-var-group-title">${cat.category}</div>
      <div class="tb-var-group-items">
        ${cat.items.map(it => `
          <button type="button" class="tb-var-item" data-tag="${esc(it.tag)}" title="${esc(it.sample)}">
            <span class="tb-var-tag">${esc(it.tag)}</span>
            <span class="tb-var-lbl">${esc(it.label)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');

  view.innerHTML = html`
  <div class="tb-studio">
    <!-- Top Header Studio Bar -->
    <div class="tb-header">
      <div class="tb-header-left">
        <div class="tb-brand-badge">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
        </div>
        <div class="tb-title-box">
          <input type="text" id="inp-tpl-quick-name" value="${esc(cfg.name_ar || 'قالب Excel جديد بدون اسم')}" class="tb-title-input" placeholder="اكتب اسم القالب هنا..." />
          <div class="tb-title-sub">
            <span>${cfg.type === 'documents' ? 'سند قبض معتمد' : 'فاتورة ضريبية'}</span>
            <span class="tb-dot">·</span>
            <span>${editingId ? `تعديل القالب: ${editingId}` : 'قالب جديد'}</span>
          </div>
        </div>
      </div>

      <!-- Studio Navigation Tabs -->
      <div class="tb-tabs-nav">
        <button type="button" class="tb-tab-btn${activeTab === 'editor' ? ' active' : ''}" data-tab="editor">
          📊 محرر الخلايا التفاعلي
        </button>
        <button type="button" class="tb-tab-btn${activeTab === 'preview' ? ' active' : ''}" data-tab="preview">
          📄 معاينة A4 الحية
        </button>
        <button type="button" class="tb-tab-btn${activeTab === 'settings' ? ' active' : ''}" data-tab="settings">
          ⚙️ الهوية والسمة
        </button>
        <button type="button" class="tb-tab-btn${activeTab === 'gallery' ? ' active' : ''}" data-tab="gallery">
          📁 القوالب المحفوظة (${existingTemplates.length})
        </button>
      </div>

      <!-- Actions -->
      <div class="tb-header-actions">
        <!-- Preset Dropdown Button -->
        <div class="tb-dropdown-wrap">
          <button type="button" class="btn btn-sm tb-dropdown-trigger" id="btn-presets-menu">
            <span>✨ قوالب أساسية</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="tb-dropdown-menu" id="tb-presets-dropdown">
            <button type="button" class="tb-dropdown-item tb-preset-select" data-preset="tax_invoice">
              📄 فاتورة ضريبية معتمدة (ZATCA)
            </button>
            <button type="button" class="tb-dropdown-item tb-preset-select" data-preset="services_invoice">🧑‍💼 فاتورة خدمات مهنية</button>
            <button type="button" class="tb-dropdown-item tb-preset-select" data-preset="retail_invoice">🛒 فاتورة مبيعات وتجزئة</button>
            <button type="button" class="tb-dropdown-item tb-preset-select" data-preset="compact_invoice">📑 فاتورة ضريبية مختصرة</button>
            <button type="button" class="tb-dropdown-item tb-preset-select" data-preset="receipt_voucher">
              🧾 سند قبض مالي رسمي
            </button>
            <div class="tb-dropdown-divider"></div>
            <button type="button" class="tb-dropdown-item tb-preset-select" data-preset="blank">
              📋 جدول فارغ من الصفر
            </button>
          </div>
        </div>

        <button id="btn-save-template" class="btn btn-primary" style="font-weight:700;background:${cfg.primary_color};border-color:${cfg.primary_color};gap:6px;">
          ${saving ? 'جارٍ الحفظ...' : raw(`
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            ${editingId ? 'حفظ التحديثات' : 'حفظ وإنشاء ملف .xlsx'}
          `)}
        </button>

        ${editingId ? `<button id="btn-cancel-edit" class="btn btn-sm">إلغاء</button>` : ''}
      </div>
    </div>

    <!-- Main Content by Tab -->
    <div class="tb-content-body">

      ${activeTab === 'editor' ? raw(`
        <!-- Full Ribbon Toolbar -->
        <div class="tb-ribbon">
          <!-- Section 1: Font & Formatting -->
          <div class="tb-ribbon-group">
            <button type="button" class="tb-tool-btn${activeCellData.bold ? ' active' : ''}" id="btn-tool-bold" title="خط عريض (Ctrl+B)">
              <b>B</b>
            </button>
            <select class="tb-tool-select" id="sel-tool-size" title="حجم الخط">
              ${[9, 10, 11, 12, 13, 14, 16, 18, 20, 24].map(s => `
                <option value="${s}" ${(activeCellData.size || 11) == s ? 'selected' : ''}>${s}px</option>
              `).join('')}
            </select>
            <button type="button" class="tb-tool-btn" id="btn-font-grow" title="تكبير حجم الخط">A⁺</button>
            <button type="button" class="tb-tool-btn" id="btn-font-shrink" title="تصغير حجم الخط">A⁻</button>
          </div>

          <div class="tb-ribbon-divider"></div>

          <!-- Section: Cell Dimensions (تكبير وتصغير الخلية) -->
          <div class="tb-ribbon-group" title="تكبير وتصغير عرض العمود / الخلية المحددة">
            <span style="font-size:0.75rem;color:var(--text-muted);font-weight:700;">عرض الخلية:</span>
            <button type="button" class="tb-tool-btn" id="btn-col-shrink" title="تصغير عرض العمود">-</button>
            <span class="tb-dim-badge" id="tb-col-width-lbl">14</span>
            <button type="button" class="tb-tool-btn" id="btn-col-grow" title="تكبير عرض العمود">+</button>
            <button type="button" class="tb-tool-btn" id="btn-col-fit" title="ملاءمة العرض للمحتوى" style="margin-right:4px;">⇿</button>
          </div>

          <div class="tb-ribbon-divider"></div>

          <div class="tb-ribbon-group" title="تكبير وتصغير ارتفاع الصف / الخلية المحددة">
            <span style="font-size:0.75rem;color:var(--text-muted);font-weight:700;">ارتفاع الخلية:</span>
            <button type="button" class="tb-tool-btn" id="btn-row-shrink" title="تقليل ارتفاع الصف">-</button>
            <span class="tb-dim-badge" id="tb-row-height-lbl">24px</span>
            <button type="button" class="tb-tool-btn" id="btn-row-grow" title="زيادة ارتفاع الصف">+</button>
            <button type="button" class="tb-tool-btn" id="btn-row-fit" title="ملاءمة الارتفاع للمحتوى" style="margin-right:4px;">⇳</button>
          </div>

          <div class="tb-ribbon-divider"></div>

          <!-- Section 2: Alignments -->
          <div class="tb-ribbon-group">
            <button type="button" class="tb-tool-btn${(activeCellData.align || 'right') === 'right' ? ' active' : ''}" data-align="right" title="محاذاة لليمين">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="7" y2="18"/></svg>
            </button>
            <button type="button" class="tb-tool-btn${activeCellData.align === 'center' ? ' active' : ''}" data-align="center" title="محاذاة للوسط">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="6"/><line x1="21" y1="12" x2="3" y2="12"/><line x1="18" y1="18" x2="6" y2="18"/></svg>
            </button>
            <button type="button" class="tb-tool-btn${activeCellData.align === 'left' ? ' active' : ''}" data-align="left" title="محاذاة لليسار">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
            </button>
          </div>

          <div class="tb-ribbon-divider"></div>

          <!-- Section 3: Colors -->
          <div class="tb-ribbon-group">
            <label class="tb-color-picker-wrap" title="لون تعبئة الخلية">
              <span class="tb-color-badge" style="background:${activeCellData.bg || '#ffffff'};"></span>
              <span style="font-size:0.75rem;">تعبئة</span>
              <input type="color" id="inp-cell-bg" value="${activeCellData.bg || '#ffffff'}" />
            </label>
            <label class="tb-color-picker-wrap" title="لون خط الخلية">
              <span class="tb-color-badge" style="background:${activeCellData.color || '#000000'};"></span>
              <span style="font-size:0.75rem;">لون الخط</span>
              <input type="color" id="inp-cell-color" value="${activeCellData.color || '#000000'}" />
            </label>
          </div>

          <div class="tb-ribbon-divider"></div>

          <!-- Section 4: Merge & Split -->
          <div class="tb-ribbon-group">
            <button type="button" class="btn btn-sm tb-ribbon-btn" id="btn-toggle-merge" title="دمج الخلايا أو فك دمجها">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
              <span>دمج / فك</span>
            </button>
          </div>

          <div class="tb-ribbon-divider"></div>

          <!-- Section 5: Add/Remove Row & Column -->
          <div class="tb-ribbon-group">
            <button type="button" class="tb-tool-btn" id="btn-add-row" title="إضافة صف أسفل">+ صف</button>
            <button type="button" class="tb-tool-btn" id="btn-del-row" title="حذف الصف الحالي">- صف</button>
            <button type="button" class="tb-tool-btn" id="btn-add-col" title="إضافة عمود يسار">+ عمود</button>
            <button type="button" class="tb-tool-btn" id="btn-del-col" title="حذف العمود الأخير">- عمود</button>
          </div>

          <div class="tb-ribbon-divider"></div>

          <!-- Section 6: Image, Import & Variables -->
          <div class="tb-ribbon-group">
            <button type="button" class="tb-tool-btn" id="btn-insert-image" title="إدراج صورة في الخلية (Ctrl+Shift+I)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            </button>
            <button type="button" class="tb-tool-btn" id="btn-import-excel" title="استيراد ملف Excel إلى المحرر">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10" transform="rotate(180 12 12.5)"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            </button>
            <input type="file" id="inp-import-excel" accept=".xlsx,.xls" style="display:none;" />
            <input type="file" id="inp-cell-image" accept="image/png,image/jpeg" style="display:none;" />
          </div>

          <div class="tb-ribbon-divider"></div>

          <!-- Section 7: Smart Variables Dropdown -->
          <div class="tb-dropdown-wrap">
            <button type="button" class="btn btn-sm tb-ribbon-btn" id="btn-vars-menu" style="background:rgba(6,182,212,.1);border-color:var(--primary);color:var(--primary);font-weight:700;">
              🏷️ إدراج وسم ذكي
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="tb-vars-dropdown" id="tb-vars-dropdown">
              ${varsHtml}
            </div>
          </div>

          <!-- Section 8: Zoom -->
          <div class="tb-ribbon-group" style="margin-right:auto;">
            <button type="button" class="tb-tool-btn" id="btn-zoom-out" title="تصغير (Ctrl -)">-</button>
            <span style="font-size:0.75rem;min-width:38px;text-align:center;" id="tb-zoom-label">${zoomLevel}%</span>
            <button type="button" class="tb-tool-btn" id="btn-zoom-in" title="تكبير (Ctrl +)">+</button>
            <button type="button" class="tb-tool-btn" id="btn-zoom-reset" title="إعادة تعيين الزوم (Ctrl+0)">100%</button>
            <button type="button" class="tb-tool-btn" id="btn-fit-a4" title="ملاءمة عرض A4">A4</button>
          </div>
        </div>

        <!-- Formula Bar -->
        <div class="tb-formula-bar">
          <div class="tb-name-box" id="tb-active-cell-ref">${esc(activeCell)}</div>
          <div class="tb-fx-icon">fx</div>
          <input type="text" id="tb-formula-input" value="${esc(activeCellData.v || '')}" placeholder="اكتب نص أو صيغة أو وسم في الخلية..." autocomplete="off" />
        </div>

        <!-- The Main Spreadsheet Grid Wrapper -->
        <div class="tb-sheet-workspace" id="tb-sheet-workspace">
          ${renderGridTable()}
        </div>

        <!-- Professional Status Bar -->
        <div class="tb-status-bar">
          <div class="tb-status-item">الخلية النشطة: <b>${esc(activeCell)}</b></div>
          <div class="tb-status-item">أبعاد الورقة: <b>${cfg.gridState?.cols?.length || 6} أعمدة × ${cfg.gridState?.rows?.length || 24} صف</b></div>
          <div class="tb-status-item">الدمج: <b>${cfg.gridState?.merges?.length || 0} نطاق مدمج</b></div>
          <div class="tb-status-item" style="margin-right:auto;color:var(--text-muted);">
            💡 انقر نقراً مزدوجاً على أي خلية للتعديل المباشر أو استخدم شريط الصيغ أعلاه.
          </div>
        </div>
      `) : ''}

      ${activeTab === 'preview' ? raw(renderPrintPreview()) : ''}
      ${activeTab === 'settings' ? raw(renderSettingsTab()) : ''}
      ${activeTab === 'gallery' ? raw(renderGalleryTab()) : ''}

    </div>

    <!-- Context Menu for Cell Operations -->
    <div class="tb-context-menu" id="tb-context-menu" style="display:none;">
      <button type="button" class="tb-ctx-item" data-act="copy">📋 نسخ المحتوى</button>
      <button type="button" class="tb-ctx-item" data-act="paste">📝 لصق</button>
      <div class="tb-ctx-divider"></div>
      <button type="button" class="tb-ctx-item" data-act="add-row">➕ إدراج صف أسفل</button>
      <button type="button" class="tb-ctx-item" data-act="del-row">❌ حذف الصف الحالي</button>
      <button type="button" class="tb-ctx-item" data-act="add-col">➕ إدراج عمود</button>
      <button type="button" class="tb-ctx-item" data-act="del-col">❌ حذف العمود</button>
      <div class="tb-ctx-divider"></div>
      <button type="button" class="tb-ctx-item" data-act="merge">⛶ دمج / فك دمج</button>
      <button type="button" class="tb-ctx-item" data-act="clear">🧹 مسح الخلية</button>
    </div>

    <!-- Styles -->
    <style>
      .tb-studio { display: flex; flex-direction: column; min-height: 85vh; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-bottom: 2rem; }
      
      /* Header */
      .tb-header { display: flex; align-items: center; justify-content: space-between; padding: 0.8rem 1.2rem; background: rgba(0,0,0,0.25); border-bottom: 1px solid var(--line); flex-wrap: wrap; gap: 0.8rem; }
      .tb-header-left { display: flex; align-items: center; gap: 10px; }
      .tb-brand-badge { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg, var(--primary), #047857); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
      .tb-title-box { display: flex; flex-direction: column; }
      .tb-title-input { background: transparent; border: 1px solid transparent; color: var(--text); font-size: 1.05rem; font-weight: 800; padding: 2px 6px; border-radius: 5px; outline: none; transition: border-color .15s; }
      .tb-title-input:hover, .tb-title-input:focus { border-color: var(--primary); background: rgba(255,255,255,.05); }
      .tb-title-sub { font-size: 0.72rem; color: var(--text-muted); display: flex; align-items: center; gap: 5px; padding-right: 6px; }
      .tb-dot { opacity: 0.5; }

      /* Tabs Nav */
      .tb-tabs-nav { display: flex; background: rgba(255,255,255,.03); border: 1px solid var(--line); border-radius: 8px; padding: 3px; gap: 2px; }
      .tb-tab-btn { background: transparent; border: none; color: var(--text-muted); font-size: 0.82rem; font-weight: 600; padding: 6px 12px; border-radius: 6px; cursor: pointer; transition: all .15s; }
      .tb-tab-btn:hover { color: var(--text); }
      .tb-tab-btn.active { background: var(--card); color: var(--primary); font-weight: 800; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }

      .tb-header-actions { display: flex; align-items: center; gap: 8px; }

      /* Ribbon Toolbar */
      .tb-ribbon { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(255,255,255,.02); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
      .tb-ribbon-group { display: flex; align-items: center; gap: 4px; }
      .tb-ribbon-divider { width: 1px; height: 22px; background: var(--line); margin: 0 4px; }
      .tb-tool-btn { background: transparent; border: 1px solid var(--line); border-radius: 5px; padding: 4px 8px; font-size: 0.8rem; color: var(--text); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; transition: all .15s; }
      .tb-tool-btn:hover { border-color: var(--primary); color: var(--primary); }
      .tb-tool-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
      .tb-ribbon-btn { font-size: 0.78rem; padding: 4px 9px; height: 28px; display: inline-flex; align-items: center; gap: 5px; }

      .tb-tool-select { background: var(--card); border: 1px solid var(--line); border-radius: 5px; color: var(--text); padding: 3px 6px; font-size: 0.8rem; height: 28px; outline: none; }
      .tb-color-picker-wrap { position: relative; display: flex; align-items: center; gap: 5px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 5px; cursor: pointer; height: 28px; }
      .tb-color-picker-wrap input[type="color"] { position: absolute; opacity: 0; width: 100%; height: 100%; left: 0; top: 0; cursor: pointer; }
      .tb-color-badge { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #94a3b8; flex-shrink: 0; }

      /* Formula Bar */
      .tb-formula-bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(0,0,0,0.18); border-bottom: 1px solid var(--line); }
      .tb-name-box { background: var(--primary); color: #fff; font-weight: 800; font-size: 0.82rem; padding: 3px 12px; border-radius: 5px; min-width: 52px; text-align: center; letter-spacing: 0.5px; }
      .tb-fx-icon { font-size: 0.85rem; font-weight: 800; font-style: italic; color: var(--text-muted); user-select: none; }
      #tb-formula-input { flex: 1; border: 1px solid var(--line); border-radius: 5px; background: rgba(255,255,255,.04); color: var(--text); padding: 5px 8px; font-size: 0.88rem; outline: none; transition: border-color .15s; }
      #tb-formula-input:focus { border-color: var(--primary); background: rgba(255,255,255,.08); }

      /* Main Sheet Workspace */
      .tb-sheet-workspace { flex: 1; min-height: 520px; max-height: 650px; overflow: auto; background: #0f172a; padding: 16px; display: flex; justify-content: center; }
      .tb-grid-viewport { background: #fff; box-shadow: 0 4px 20px rgba(0,0,0,0.3); border-radius: 4px; overflow: hidden; height: fit-content; transition: transform .15s; }
      .tb-main-table { border-collapse: collapse; direction: rtl; table-layout: fixed; width: max-content; }

      .tb-corner-th { width: 38px; min-width: 38px; background: #f8fafc; border: 1px solid #cbd5e1; color: #64748b; font-size: 11px; text-align: center; user-select: none; }
      .tb-col-th { background: #f8fafc; border: 1px solid #cbd5e1; color: #334155; font-size: 11px; font-weight: 700; text-align: center; padding: 4px; user-select: none; position: relative; }
      .tb-col-title { width: 100%; text-align: center; }
      .tb-col-resizer { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize; user-select: none; z-index: 5; }
      .tb-col-resizer:hover, .tb-col-resizer.resizing { background: var(--primary); }

      .tb-row-th { width: 38px; min-width: 38px; background: #f8fafc; border: 1px solid #cbd5e1; color: #64748b; font-size: 11px; font-weight: 700; text-align: center; padding: 2px; user-select: none; position: relative; }

      .tb-grid-cell { border: 1px solid #cbd5e1; padding: 0; cursor: cell; position: relative; user-select: none; vertical-align: middle; }
      .tb-grid-cell:hover { background-color: rgba(6,182,212,0.08) !important; }
      .tb-grid-cell.tb-cell-active { outline: 2.5px solid #059669 !important; outline-offset: -1px; z-index: 10; }
      .tb-cell-val { width: 100%; height: 100%; min-height: 24px; padding: 4px 8px; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: pre-wrap; word-break: break-word; outline: none; cursor: text; user-select: text; }
      .tb-cell-val:focus { background: rgba(37,99,235,0.06); }
      .tb-cell-img { display: block; margin: 2px auto; object-fit: contain; pointer-events: none; }
      .tb-cell-has-image .tb-cell-val { position: absolute; inset: 0; padding-top: 4px; }
      .tb-dim-badge { background: rgba(255,255,255,.08); border: 1px solid var(--line); color: var(--primary); font-weight: 700; font-size: 0.75rem; padding: 2px 7px; border-radius: 4px; min-width: 34px; text-align: center; font-family: monospace; }
      .tb-row-resizer { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; cursor: row-resize; user-select: none; z-index: 5; }
      .tb-row-resizer:hover, .tb-row-resizer.resizing { background: var(--primary); }

      /* Status Bar */
      .tb-status-bar { display: flex; align-items: center; gap: 16px; padding: 6px 14px; background: rgba(0,0,0,0.3); border-top: 1px solid var(--line); font-size: 0.74rem; color: var(--text-muted); }
      .tb-status-item b { color: var(--text); }

      /* Dropdowns */
      .tb-dropdown-wrap { position: relative; display: inline-block; }
      .tb-dropdown-menu { display: none; position: absolute; top: calc(100% + 4px); right: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 25px rgba(0,0,0,0.3); min-width: 220px; z-index: 100; padding: 4px; }
      .tb-dropdown-wrap.open .tb-dropdown-menu { display: block; }
      .tb-dropdown-item { width: 100%; padding: 8px 12px; font-size: 0.82rem; text-align: right; background: transparent; border: none; color: var(--text); border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
      .tb-dropdown-item:hover { background: rgba(255,255,255,.05); color: var(--primary); }
      .tb-dropdown-divider { height: 1px; background: var(--line); margin: 4px 0; }

      /* Smart Variables Dropdown */
      .tb-vars-dropdown { display: none; position: absolute; top: calc(100% + 4px); right: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.35); width: 320px; max-height: 420px; overflow-y: auto; z-index: 100; padding: 8px; }
      .tb-dropdown-wrap.open .tb-vars-dropdown { display: block; }
      .tb-var-group { margin-bottom: 8px; }
      .tb-var-group-title { font-size: 0.75rem; font-weight: 800; color: var(--primary); padding: 4px 8px; border-bottom: 1px dashed var(--line); margin-bottom: 4px; }
      .tb-var-group-items { display: flex; flex-direction: column; gap: 2px; }
      .tb-var-item { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 5px 8px; background: transparent; border: none; color: var(--text); border-radius: 5px; cursor: pointer; font-size: 0.78rem; text-align: right; }
      .tb-var-item:hover { background: rgba(6,182,212,.1); color: var(--primary); }
      .tb-var-tag { font-family: monospace; font-weight: 700; color: var(--primary); }
      .tb-var-lbl { color: var(--text-muted); font-size: 0.72rem; }

      /* Context Menu */
      .tb-context-menu { position: fixed; background: var(--card); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.4); padding: 4px; min-width: 170px; z-index: 1000; }
      .tb-ctx-item { width: 100%; padding: 6px 10px; background: transparent; border: none; color: var(--text); font-size: 0.78rem; text-align: right; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
      .tb-ctx-item:hover { background: var(--primary); color: #fff; }
      .tb-ctx-divider { height: 1px; background: var(--line); margin: 3px 0; }

      /* Preview Tab */
      .tb-preview-container { padding: 1.5rem; background: #0b1120; display: flex; flex-direction: column; align-items: center; }
      .tb-preview-toolbar { width: 100%; max-width: 840px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; flex-wrap: wrap; gap: 8px; }
      .tb-preview-toggles { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,.05); border: 1px solid var(--line); padding: 3px 8px; border-radius: 8px; }
      .tb-prev-mode-btn { background: transparent; border: none; color: var(--text-muted); font-size: 0.78rem; padding: 4px 8px; border-radius: 5px; cursor: pointer; }
      .tb-prev-mode-btn.active { background: var(--primary); color: #fff; font-weight: 700; }
      .tb-paper-sheet { width: 100%; max-width: 840px; background: #fff; padding: 36px; border-radius: 8px; box-shadow: 0 6px 30px rgba(0,0,0,0.35); color: #000; }

      /* Settings Tab */
      .tb-settings-wrap { padding: 1.5rem; max-width: 800px; margin: 0 auto; width: 100%; }
      .tb-logo-upload { display:flex;gap:14px;align-items:center;padding:12px;border:1px dashed var(--line-strong);border-radius:10px;background:var(--field-bg); }
      .tb-logo-preview { width:150px;height:86px;display:grid;place-items:center;border:1px solid var(--line);border-radius:8px;background:#fff;color:#64748b;overflow:hidden; }
      .tb-logo-preview img { max-width:100%;max-height:100%;object-fit:contain; }
      .tb-card { background: rgba(255,255,255,.02); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
      .tb-card-header { padding: 1rem 1.2rem; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 8px; }
      .tb-card-header h3 { margin: 0; font-size: 1rem; font-weight: 700; }
      .tb-card-body { padding: 1.2rem; }
      .tb-settings-type { background: rgba(255,255,255,.03); border: 1px solid var(--line); color: var(--text-muted); font-size: 0.85rem; padding: 8px 12px; }
      .tb-settings-type.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 700; }
      .tb-themes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; margin-top: 6px; }
      .tb-theme-card { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(255,255,255,.03); border: 1px solid var(--line); border-radius: 8px; cursor: pointer; text-align: right; transition: all .15s; }
      .tb-theme-card:hover { border-color: var(--primary); }
      .tb-theme-card.active { border-color: var(--primary); background: rgba(6,182,212,.1); }
      .tb-theme-bar { width: 10px; height: 32px; border-radius: 4px; flex-shrink: 0; }
      .tb-theme-info { display: flex; flex-direction: column; }
      .tb-theme-title { font-weight: 700; font-size: 0.82rem; color: var(--text); }
      .tb-theme-hex { font-size: 0.7rem; color: var(--text-muted); font-family: monospace; }

      /* Gallery Tab */
      .tb-gallery-wrap { padding: 1.5rem; }
      .tb-gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
      .tb-gallery-card { background: rgba(255,255,255,.03); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; transition: all .15s; }
      .tb-gallery-card:hover { border-color: var(--primary); transform: translateY(-2px); }
      .tb-gallery-card.active { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
      .tb-gallery-badge { height: 6px; width: 100%; }
      .tb-gallery-content { padding: 12px; flex: 1; }
      .tb-gallery-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .tb-gallery-type { font-size: 0.72rem; color: var(--text-muted); font-weight: 700; }
      .tb-gallery-ext { font-size: 0.65rem; background: rgba(255,255,255,.08); padding: 1px 5px; border-radius: 3px; font-weight: 700; color: var(--primary); }
      .tb-gallery-name { margin: 0 0 4px; font-size: 0.95rem; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tb-gallery-file { font-size: 0.72rem; color: var(--text-muted); font-family: monospace; }
      .tb-gallery-meta { font-size: 0.7rem; color: #10b981; margin-top: 6px; }
      .tb-gallery-actions { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--line); background: rgba(0,0,0,0.15); }
      .tb-ready-card { border-style: dashed; }
      .tb-ready-desc { font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; line-height: 1.5; }
      .tb-ext-new { background: rgba(16,185,129,.15); color: #10b981; }

      .tb-empty-state { text-align: center; padding: 4rem 1rem; color: var(--text-muted); }
      .tb-empty-state h3 { color: var(--text); margin: 1rem 0 0.5rem; }
      .tb-empty-state p { margin-bottom: 1.2rem; font-size: 0.88rem; }

      /* ثيم الضوء لمحرر القوالب (Light Theme Adaptations) */
      html[data-theme="light"] .tb-studio { background: #ffffff; border-color: var(--line); }
      html[data-theme="light"] .tb-header { background: #f8fafc; border-color: var(--line); }
      html[data-theme="light"] .tb-ribbon { background: #ffffff; border-color: var(--line); }
      html[data-theme="light"] .tb-formula-bar { background: #f1f5f9; border-color: var(--line); }
      html[data-theme="light"] .tb-tabs-nav { background: #f1f5f9; border-color: var(--line); }
      html[data-theme="light"] .tb-tab-btn { color: #64748b; }
      html[data-theme="light"] .tb-tab-btn:hover { color: #0f172a; }
      html[data-theme="light"] .tb-tab-btn.active { background: #ffffff; color: var(--primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      html[data-theme="light"] .tb-tool-btn { background: #ffffff; border-color: var(--line); color: #1e293b; }
      html[data-theme="light"] .tb-tool-btn:hover { border-color: var(--primary); color: var(--primary); background: #f8fafc; }
      html[data-theme="light"] .tb-tool-btn.active { background: var(--primary); color: #ffffff; border-color: var(--primary); }
      html[data-theme="light"] .tb-tool-select { background: #ffffff; border-color: var(--line); color: #1e293b; }
      html[data-theme="light"] .tb-color-picker-wrap { background: #ffffff; border-color: var(--line); color: #1e293b; }
      html[data-theme="light"] .tb-dim-badge { background: #f8fafc; border-color: var(--line); color: var(--primary); }
      html[data-theme="light"] #tb-formula-input { background: #ffffff; border-color: var(--line); color: #0f172a; }
      html[data-theme="light"] .tb-status-bar { background: #f8fafc; border-color: var(--line); color: #64748b; }
      html[data-theme="light"] .tb-card { background: #f8fafc; border-color: var(--line); }
      html[data-theme="light"] .tb-gallery-card { background: #ffffff; border-color: var(--line); }
      html[data-theme="light"] .tb-gallery-actions { background: #f8fafc; border-color: var(--line); }
    </style>
  </div>`;
}

// ─── Attach Events & Interactive Controllers ──────────────────────────────
function attachEvents() {
  // Tab Switching
  $$('.tb-tab-btn', view).forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderView();
      attachEvents();
    });
  });

  // Preview Mode Toggles
  $$('.tb-prev-mode-btn', view).forEach(btn => {
    btn.addEventListener('click', () => {
      previewMode = btn.dataset.pmode;
      renderView();
      attachEvents();
    });
  });

  // Print Preview Button
  $('#btn-print-preview', view)?.addEventListener('click', () => {
    window.print();
  });

  // Preset Selector Dropdown
  const btnPresets = $('#btn-presets-menu', view);
  if (btnPresets) {
    btnPresets.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btnPresets.closest('.tb-dropdown-wrap');
      wrap.classList.toggle('open');
    });
  }

  // Variables Dropdown Button
  const btnVars = $('#btn-vars-menu', view);
  if (btnVars) {
    btnVars.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btnVars.closest('.tb-dropdown-wrap');
      wrap.classList.toggle('open');
    });
  }

  // Global click to close dropdowns & context menu
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tb-dropdown-wrap')) {
      $$('.tb-dropdown-wrap', view).forEach(w => w.classList.remove('open'));
    }
    const ctx = $('#tb-context-menu', view);
    if (ctx) ctx.style.display = 'none';
  });

  // Preset selection execution
  $$('.tb-preset-select', view).forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset;
      if (p === 'tax_invoice') {
        cfg.gridState = getTaxInvoicePreset(cfg.primary_color);
        cfg.type = 'invoices';
        if (!cfg.name_ar) cfg.name_ar = 'فاتورة ضريبية رسمية معتمدة';
      } else if (p === 'services_invoice') {
        cfg.gridState = getInvoicePresetVariant('services', cfg.primary_color);
        cfg.type = 'invoices';
        cfg.name_ar = 'فاتورة خدمات مهنية';
      } else if (p === 'retail_invoice') {
        cfg.gridState = getInvoicePresetVariant('retail', cfg.primary_color);
        cfg.type = 'invoices';
        cfg.name_ar = 'فاتورة مبيعات وتجزئة';
      } else if (p === 'compact_invoice') {
        cfg.gridState = getInvoicePresetVariant('compact', cfg.primary_color);
        cfg.type = 'invoices';
        cfg.name_ar = 'فاتورة ضريبية مختصرة';
      } else if (p === 'receipt_voucher') {
        cfg.gridState = getReceiptVoucherPreset(cfg.primary_color);
        cfg.type = 'documents';
        if (!cfg.name_ar) cfg.name_ar = 'سند قبض مالي رسمي معتمد';
      } else if (p === 'blank') {
        cfg.gridState = getBlankPreset();
      }
      activeCell = 'A1';
      activeTab = 'editor';
      renderView();
      attachEvents();
      toastOk('تم تطبيق القالب بنجاح في محرر الخلايا!');
    });
  });

  // Theme selection
  $$('.tb-theme-card', view).forEach(card => {
    card.addEventListener('click', () => {
      const tid = card.dataset.theme;
      const th = THEMES.find(t => t.id === tid);
      if (!th) return;
      cfg.primary_color = th.primary;
      cfg.accent_color = th.accent;

      // Update grid cells that were using the previous primary
      if (cfg.gridState && cfg.gridState.cells) {
        for (const c of Object.values(cfg.gridState.cells)) {
          if (c && c.color === '#ffffff' && c.bg && c.bg !== '#ffffff') {
            c.bg = th.primary;
          }
        }
      }
      renderView();
      attachEvents();
      toastOk(`تم تطبيق سمة «${th.name}»`);
    });
  });

  // Settings type toggles
  $$('.tb-settings-type', view).forEach(btn => {
    btn.addEventListener('click', () => {
      cfg.type = btn.dataset.type;
      renderView();
      attachEvents();
    });
  });

  // Quick name input
  $('#inp-tpl-quick-name', view)?.addEventListener('input', e => {
    cfg.name_ar = e.target.value.trim();
  });
  $('#inp-settings-name', view)?.addEventListener('input', e => {
    cfg.name_ar = e.target.value.trim();
  });
  $('#inp-settings-company', view)?.addEventListener('input', e => {
    cfg.company_name_ar = e.target.value.trim();
  });
  $('#inp-template-logo', view)?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toastErr('الصيغة المدعومة للشعار هي PNG أو JPG فقط');
    if (file.size > 2 * 1024 * 1024) return toastErr('حجم الصورة يجب ألا يتجاوز 2MB');
    const reader = new FileReader();
    reader.onload = () => {
      cfg.logo_data = String(reader.result || '');
      renderView();
      attachEvents();
      toastOk('تمت إضافة الصورة وستظهر داخل ملف Excel');
    };
    reader.readAsDataURL(file);
  });
  $('#inp-logo-width', view)?.addEventListener('input', e => { cfg.logo_width = Math.max(40, Math.min(500, Number(e.target.value) || 140)); });
  $('#inp-logo-height', view)?.addEventListener('input', e => { cfg.logo_height = Math.max(30, Math.min(250, Number(e.target.value) || 70)); });
  $('#sel-logo-position', view)?.addEventListener('change', e => { cfg.logo_position = e.target.value; });
  $('#btn-remove-template-logo', view)?.addEventListener('click', () => {
    cfg.logo_data = '';
    renderView();
    attachEvents();
  });

  // Cell Selection in Table
  // Cell Selection and Direct In-Cell Typing
  const table = $('#tb-grid-table', view);
  if (table) {
    table.addEventListener('click', e => {
      const td = e.target.closest('.tb-grid-cell');
      if (!td) return;
      selectCell(td.dataset.ref);
      const valEl = td.querySelector('.tb-cell-val');
      if (valEl && e.target !== valEl) {
        valEl.focus();
      }
    });

    // Double-click to highlight and select all text inside the cell
    table.addEventListener('dblclick', e => {
      const td = e.target.closest('.tb-grid-cell');
      if (!td) return;
      selectCell(td.dataset.ref);
      const valEl = td.querySelector('.tb-cell-val');
      if (valEl) {
        valEl.focus();
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(valEl);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch { }
      }
    });

    // Right-click context menu
    table.addEventListener('contextmenu', e => {
      e.preventDefault();
      const td = e.target.closest('.tb-grid-cell');
      if (!td) return;
      selectCell(td.dataset.ref);

      const ctx = $('#tb-context-menu', view);
      if (ctx) {
        ctx.style.display = 'block';
        ctx.style.left = `${Math.min(window.innerWidth - 180, e.clientX)}px`;
        ctx.style.top = `${Math.min(window.innerHeight - 250, e.clientY)}px`;
      }
    });
  }

  // Formula Input Handler (bidirectional sync with in-cell typing)
  const formulaInput = $('#tb-formula-input', view);
  if (formulaInput) {
    formulaInput.addEventListener('input', e => {
      updateActiveCellValue(e.target.value);
    });

    formulaInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        moveToNextRow();
      }
    });
  }

  // Insert Variable from Dropdown
  $$('.tb-var-item', view).forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (!tag || !activeCell || !cfg.gridState) return;

      const cell = cfg.gridState.cells[activeCell] || {};
      const cur = cell.v || '';
      const newVal = cur ? `${cur} ${tag}` : tag;
      updateActiveCellValue(newVal);

      if (formulaInput) formulaInput.value = newVal;

      toastOk(`تم إدراج الوسم ${tag}`);
      $$('.tb-dropdown-wrap', view).forEach(w => w.classList.remove('open'));
    });
  });

  // Listen for direct typing inside contenteditable cells
  table?.addEventListener('input', e => {
    const valEl = e.target.closest('.tb-cell-val');
    if (!valEl) return;
    const ref = valEl.dataset.ref;
    if (!ref || !cfg.gridState) return;

    activeCell = ref;
    if (!cfg.gridState.cells[ref]) {
      cfg.gridState.cells[ref] = { v: '', size: 11, align: 'right' };
    }
    cfg.gridState.cells[ref].v = valEl.innerText;

    // Update formula bar synchronously
    const fi = $('#tb-formula-input', view);
    if (fi) fi.value = valEl.innerText;
    const nameBox = $('#tb-active-cell-ref', view);
    if (nameBox) nameBox.textContent = ref;
  });

  table?.addEventListener('keydown', e => {
    const valEl = e.target.closest('.tb-cell-val');
    if (!valEl) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      valEl.blur();
      moveToNextRow();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      valEl.blur();
      moveToNextCol();
    }
  });

  // Cell Resizing Helpers (Smooth, zero-rebuild in-place DOM updates)
  function applyColWidth(colIdx, newW) {
    if (!cfg.gridState) return;
    if (!cfg.gridState.cols[colIdx]) cfg.gridState.cols[colIdx] = { width: 14 };
    cfg.gridState.cols[colIdx].width = Math.max(4, Math.min(80, newW));

    const th = view.querySelector(`th.tb-col-th[data-col="${colIdx}"]`);
    if (th) {
      th.style.width = `${cfg.gridState.cols[colIdx].width * 10}px`;
      th.style.minWidth = `${cfg.gridState.cols[colIdx].width * 10}px`;
    }
    const badge = $('#tb-col-width-lbl', view);
    if (badge) badge.textContent = cfg.gridState.cols[colIdx].width;
  }

  function applyRowHeight(rowNum, newH) {
    if (!cfg.gridState) return;
    const rIdx = rowNum - 1;
    if (!cfg.gridState.rows[rIdx]) cfg.gridState.rows[rIdx] = { height: 24 };
    cfg.gridState.rows[rIdx].height = Math.max(16, Math.min(180, newH));

    const tbody = view.querySelector('#tb-grid-table tbody');
    if (tbody && tbody.children[rIdx]) {
      const tr = tbody.children[rIdx];
      tr.style.height = `${cfg.gridState.rows[rIdx].height}px`;
      tr.querySelectorAll('td.tb-grid-cell').forEach(td => {
        td.style.height = `${cfg.gridState.rows[rIdx].height}px`;
      });
    }
    const badge = $('#tb-row-height-lbl', view);
    if (badge) badge.textContent = `${cfg.gridState.rows[rIdx].height}px`;
  }

  // Column Width Grow / Shrink (Instant)
  $('#btn-col-grow', view)?.addEventListener('click', () => {
    const parsed = parseCellRef(activeCell);
    if (!parsed || !cfg.gridState) return;
    const curW = cfg.gridState.cols[parsed.col]?.width || 14;
    applyColWidth(parsed.col, curW + 2);
    toastOk(`عرض العمود ${colLetter(parsed.col)}: ${cfg.gridState.cols[parsed.col].width}`);
  });

  $('#btn-col-shrink', view)?.addEventListener('click', () => {
    const parsed = parseCellRef(activeCell);
    if (!parsed || !cfg.gridState) return;
    const curW = cfg.gridState.cols[parsed.col]?.width || 14;
    applyColWidth(parsed.col, curW - 2);
    toastOk(`عرض العمود ${colLetter(parsed.col)}: ${cfg.gridState.cols[parsed.col].width}`);
  });

  // Row Height Grow / Shrink (Instant)
  $('#btn-row-grow', view)?.addEventListener('click', () => {
    const parsed = parseCellRef(activeCell);
    if (!parsed || !cfg.gridState) return;
    const rIdx = parsed.row - 1;
    const curH = cfg.gridState.rows[rIdx]?.height || 24;
    applyRowHeight(parsed.row, curH + 4);
    toastOk(`ارتفاع الصف ${parsed.row}: ${cfg.gridState.rows[rIdx].height}px`);
  });

  $('#btn-row-shrink', view)?.addEventListener('click', () => {
    const parsed = parseCellRef(activeCell);
    if (!parsed || !cfg.gridState) return;
    const rIdx = parsed.row - 1;
    const curH = cfg.gridState.rows[rIdx]?.height || 24;
    applyRowHeight(parsed.row, curH - 4);
    toastOk(`ارتفاع الصف ${parsed.row}: ${cfg.gridState.rows[rIdx].height}px`);
  });

  // Draggable Column & Row Resizers
  $$('.tb-col-resizer', view).forEach(resizer => {
    let dragHappened = false;
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragHappened = false;
      const colIdx = Number(resizer.dataset.col);
      const startX = e.clientX;
      const initialWidth = cfg.gridState.cols[colIdx]?.width || 14;
      resizer.classList.add('resizing');

      const onMouseMove = (moveEv) => {
        dragHappened = true;
        // In RTL table, moving mouse to left (decreasing clientX) enlarges column
        const diffPx = startX - moveEv.clientX;
        const newW = Math.max(4, Math.round(initialWidth + diffPx / 10));
        applyColWidth(colIdx, newW);
      };

      const onMouseUp = () => {
        resizer.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    resizer.addEventListener('click', (e) => {
      if (dragHappened) return;
      e.stopPropagation();
      const colIdx = Number(resizer.dataset.col);
      const curW = cfg.gridState.cols[colIdx]?.width || 14;
      const newW = curW >= 28 ? 10 : (curW <= 12 ? 22 : 30);
      applyColWidth(colIdx, newW);
      toastOk(`تم ضبط عرض العمود ${colLetter(colIdx)} إلى ${newW}`);
    });
  });

  $$('.tb-row-resizer', view).forEach(resizer => {
    let dragHappened = false;
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragHappened = false;
      const rowNum = Number(resizer.dataset.row);
      const rIdx = rowNum - 1;
      const startY = e.clientY;
      const initialHeight = cfg.gridState.rows[rIdx]?.height || 24;
      resizer.classList.add('resizing');

      const onMouseMove = (moveEv) => {
        dragHappened = true;
        const diffPx = moveEv.clientY - startY;
        const newH = Math.max(16, Math.round(initialHeight + diffPx));
        applyRowHeight(rowNum, newH);
      };

      const onMouseUp = () => {
        resizer.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    resizer.addEventListener('click', (e) => {
      if (dragHappened) return;
      e.stopPropagation();
      const rowNum = Number(resizer.dataset.row);
      const rIdx = rowNum - 1;
      const curH = cfg.gridState.rows[rIdx]?.height || 24;
      const newH = curH >= 48 ? 24 : (curH <= 24 ? 48 : 24);
      applyRowHeight(rowNum, newH);
      toastOk(`تم ضبط ارتفاع الصف ${rowNum} إلى ${newH}px`);
    });
  });

  // Bold Button
  $('#btn-tool-bold', view)?.addEventListener('click', () => {
    if (!activeCell || !cfg.gridState) return;
    if (!cfg.gridState.cells[activeCell]) cfg.gridState.cells[activeCell] = { v: '', size: 11 };
    const cur = !!cfg.gridState.cells[activeCell].bold;
    cfg.gridState.cells[activeCell].bold = !cur;

    const td = $(`[data-ref="${activeCell}"]`, view);
    if (td) td.style.fontWeight = !cur ? '700' : 'normal';
    $('#btn-tool-bold', view)?.classList.toggle('active', !cur);
  });

  // Font Size Select
  $('#sel-tool-size', view)?.addEventListener('change', e => {
    if (!activeCell || !cfg.gridState) return;
    if (!cfg.gridState.cells[activeCell]) cfg.gridState.cells[activeCell] = { v: '' };
    const sz = Number(e.target.value) || 11;
    cfg.gridState.cells[activeCell].size = sz;

    const td = $(`[data-ref="${activeCell}"]`, view);
    if (td) td.style.fontSize = `${sz}px`;
  });

  // Alignment
  $$('[data-align]', view).forEach(btn => {
    btn.addEventListener('click', () => {
      if (!activeCell || !cfg.gridState) return;
      if (!cfg.gridState.cells[activeCell]) cfg.gridState.cells[activeCell] = { v: '' };
      const al = btn.dataset.align;
      cfg.gridState.cells[activeCell].align = al;

      const td = $(`[data-ref="${activeCell}"]`, view);
      if (td) td.style.textAlign = al;

      $$('[data-align]', view).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Cell Background
  $('#inp-cell-bg', view)?.addEventListener('input', e => {
    if (!activeCell || !cfg.gridState) return;
    if (!cfg.gridState.cells[activeCell]) cfg.gridState.cells[activeCell] = { v: '' };
    const color = e.target.value;
    cfg.gridState.cells[activeCell].bg = color;

    const td = $(`[data-ref="${activeCell}"]`, view);
    if (td) td.style.backgroundColor = color;
  });

  // Cell Text Color
  $('#inp-cell-color', view)?.addEventListener('input', e => {
    if (!activeCell || !cfg.gridState) return;
    if (!cfg.gridState.cells[activeCell]) cfg.gridState.cells[activeCell] = { v: '' };
    const color = e.target.value;
    cfg.gridState.cells[activeCell].color = color;

    const td = $(`[data-ref="${activeCell}"]`, view);
    if (td) td.style.color = color;
  });

  // Merge / Unmerge Toggle
  $('#btn-toggle-merge', view)?.addEventListener('click', () => {
    toggleMergeActiveCell();
  });

  // Row and Column Controls
  $('#btn-add-row', view)?.addEventListener('click', () => {
    if (!cfg.gridState) return;
    cfg.gridState.rows.push({ height: 24 });
    renderView();
    attachEvents();
    toastOk('تمت إضافة صف جديد');
  });

  $('#btn-del-row', view)?.addEventListener('click', () => {
    if (!cfg.gridState || cfg.gridState.rows.length <= 3) return;
    const parsed = parseCellRef(activeCell);
    const delRow = parsed ? parsed.row : cfg.gridState.rows.length;
    cfg.gridState.rows.splice(delRow - 1, 1);
    renderView();
    attachEvents();
    toastOk(`تم حذف الصف ${delRow}`);
  });

  $('#btn-add-col', view)?.addEventListener('click', () => {
    if (!cfg.gridState) return;
    cfg.gridState.cols.push({ width: 14 });
    renderView();
    attachEvents();
    toastOk('تمت إضافة عمود جديد');
  });

  $('#btn-del-col', view)?.addEventListener('click', () => {
    if (!cfg.gridState || cfg.gridState.cols.length <= 2) return;
    cfg.gridState.cols.pop();
    renderView();
    attachEvents();
    toastOk('تم حذف العمود الأخير');
  });

  // Zoom Controls (editor + preview)
  function applyZoom(newZoom) {
    zoomLevel = Math.max(50, Math.min(200, Math.round(newZoom / 10) * 10));
    const gridVp = view.querySelector('.tb-grid-viewport');
    if (gridVp) gridVp.style.transform = `scale(${zoomLevel / 100})`;
    const paper = view.querySelector('.tb-paper-sheet');
    if (paper) paper.style.transform = `scale(${zoomLevel / 100})`;
    const lbl = $('#tb-zoom-label', view);
    if (lbl) lbl.textContent = `${zoomLevel}%`;
  }

  $('#btn-zoom-in', view)?.addEventListener('click', () => applyZoom(zoomLevel + 10));
  $('#btn-zoom-out', view)?.addEventListener('click', () => applyZoom(zoomLevel - 10));
  $('#btn-zoom-reset', view)?.addEventListener('click', () => applyZoom(100));
  $('#btn-fit-a4', view)?.addEventListener('click', () => {
    const workspace = view.querySelector('.tb-sheet-workspace');
    const vp = view.querySelector('.tb-grid-viewport');
    if (!workspace || !vp) return;
    const availableW = workspace.clientWidth - 48;
    const gridW = vp.scrollWidth || vp.offsetWidth || 800;
    const target = Math.min(150, Math.max(50, Math.round((availableW / gridW) * 100)));
    applyZoom(target);
    toastOk(`تم ضبط الزوم على ${zoomLevel}% لملاءمة A4`);
  });

  // Keyboard shortcuts for zoom and navigation (replaced on each attach to avoid leaks)
  if (view.__zoomKeyHandler) {
    view.removeEventListener('keydown', view.__zoomKeyHandler);
  }
  view.__zoomKeyHandler = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const key = e.key;
    if (key === '=' || key === '+') {
      e.preventDefault();
      applyZoom(zoomLevel + 10);
    } else if (key === '-') {
      e.preventDefault();
      applyZoom(zoomLevel - 10);
    } else if (key === '0') {
      e.preventDefault();
      applyZoom(100);
    } else if (key === 'b' && (e.shiftKey || e.altKey)) {
      e.preventDefault();
      $('#btn-tool-bold', view)?.click();
    }
  };
  view.addEventListener('keydown', view.__zoomKeyHandler);

  // Cell dimensions: fit to content
  function fitColToContent(colIdx) {
    if (!cfg.gridState) return;
    let max = 10;
    const cells = cfg.gridState.cells || {};
    for (const [ref, cell] of Object.entries(cells)) {
      const parsed = parseCellRef(ref);
      if (!parsed || parsed.col !== colIdx) continue;
      const text = String(cell?.v || '');
      const img = cell?.image;
      const approx = img ? Math.max(10, Math.ceil((img.width || 80) / 10)) : Math.max(4, Math.ceil(text.length * 0.65));
      if (approx > max) max = approx;
    }
    applyColWidth(colIdx, Math.min(80, max));
  }

  function fitRowToContent(rowNum) {
    if (!cfg.gridState) return;
    let max = 24;
    const cells = cfg.gridState.cells || {};
    for (const [ref, cell] of Object.entries(cells)) {
      const parsed = parseCellRef(ref);
      if (!parsed || parsed.row !== rowNum) continue;
      const text = String(cell?.v || '');
      const lines = text.split('\n').length;
      const img = cell?.image;
      const approx = img ? Math.max(24, Math.min(180, img.height || 60)) : Math.max(24, lines * 16 + 8);
      if (approx > max) max = approx;
    }
    applyRowHeight(rowNum, Math.min(180, max));
  }

  $('#btn-col-fit', view)?.addEventListener('click', () => {
    const parsed = parseCellRef(activeCell);
    if (!parsed) return;
    fitColToContent(parsed.col);
    toastOk(`تمت ملاءمة عرض العمود ${colLetter(parsed.col)} للمحتوى`);
  });

  $('#btn-row-fit', view)?.addEventListener('click', () => {
    const parsed = parseCellRef(activeCell);
    if (!parsed) return;
    fitRowToContent(parsed.row);
    toastOk(`تمت ملاءمة ارتفاع الصف ${parsed.row} للمحتوى`);
  });

  // ─── Insert Image into Active Cell ───────────────────────────────────────
  $('#btn-insert-image', view)?.addEventListener('click', () => {
    if (!activeCell || !cfg.gridState) return toastErr('اختر خلية أولاً');
    $('#inp-cell-image', view)?.click();
  });

  $('#inp-cell-image', view)?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toastErr('الصيغة المدعومة PNG أو JPG فقط');
    if (file.size > 2 * 1024 * 1024) return toastErr('حجم الصورة يجب ألا يتجاوز 2MB');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 200, maxH = 160;
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
        if (!cfg.gridState.cells[activeCell]) {
          cfg.gridState.cells[activeCell] = { v: '', size: 11, align: 'right' };
        }
        cfg.gridState.cells[activeCell].image = {
          src: String(reader.result || ''),
          width: w,
          height: h,
          position: 'center',
        };
        // Expand row/col to fit image if needed
        const parsed = parseCellRef(activeCell);
        if (parsed) {
          fitColToContent(parsed.col);
          fitRowToContent(parsed.row);
        }
        renderView();
        attachEvents();
        toastOk('تمت إضافة الصورة للخلية');
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // Keyboard shortcut for image insertion (replaced on each attach to avoid leaks)
  if (document.__studioImgKeyHandler) {
    document.removeEventListener('keydown', document.__studioImgKeyHandler);
  }
  document.__studioImgKeyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
      if (activeTab !== 'editor') return;
      e.preventDefault();
      $('#btn-insert-image', view)?.click();
    }
  };
  document.addEventListener('keydown', document.__studioImgKeyHandler);

  // ─── Import Excel into the Builder ───────────────────────────────────────
  $('#btn-import-excel', view)?.addEventListener('click', () => {
    $('#inp-import-excel', view)?.click();
  });

  $('#inp-import-excel', view)?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) return toastErr('ارفع ملف Excel فقط');

    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || '').split(',')[1] || '');
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const inspection = await api.post('/api/invoices/templates/inspect', {
        filename: file.name,
        file_base64: base64,
      });
      const grid = gridStateFromInspection(inspection);
      cfg.gridState = grid;
      cfg.name_ar = inspection.detectedTitle || file.name.replace(/\.[^.]+$/, '');
      activeCell = 'A1';
      activeTab = 'editor';
      renderView();
      attachEvents();
      toastOk('تم استيراد ملف Excel إلى المحرر');
    } catch (err) {
      toastErr('فشل استيراد Excel: ' + (err.message || err));
    }
    e.target.value = '';
  });

  // Context Menu Actions
  $$('.tb-ctx-item', view).forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'add-row') $('#btn-add-row', view)?.click();
      else if (act === 'del-row') $('#btn-del-row', view)?.click();
      else if (act === 'add-col') $('#btn-add-col', view)?.click();
      else if (act === 'del-col') $('#btn-del-col', view)?.click();
      else if (act === 'merge') toggleMergeActiveCell();
      else if (act === 'clear') {
        if (cfg.gridState?.cells?.[activeCell]) {
          cfg.gridState.cells[activeCell].v = '';
          updateActiveCellValue('');
        }
      }
      const ctx = $('#tb-context-menu', view);
      if (ctx) ctx.style.display = 'none';
    });
  });

  // Save / Update Template
  $('#btn-save-template', view)?.addEventListener('click', async () => {
    cfg.name_ar = $('#inp-tpl-quick-name', view)?.value?.trim() || cfg.name_ar;

    if (!cfg.name_ar) {
      toastErr('يرجى كتابة اسم القالب أولاً');
      return;
    }

    saving = true;
    renderView();
    attachEvents();

    try {
      const payload = {
        type: cfg.type,
        name_ar: cfg.name_ar,
        company_name_ar: cfg.company_name_ar,
        primary_color: cfg.primary_color,
        accent_color: cfg.accent_color,
        logo_data: cfg.logo_data,
        logo_width: cfg.logo_width,
        logo_height: cfg.logo_height,
        logo_position: cfg.logo_position,
        gridState: cfg.gridState,
        columns: [],
      };

      if (editingId) {
        await api.put(`/api/templates/builder/${editingId}`, payload);
        toastOk(`تم تحديث قالب «${cfg.name_ar}» وتوليد ملف Excel المعتمد بنجاح!`);
      } else {
        const res = await api.post('/api/templates/builder', payload);
        toastOk(`تم حفظ قالب «${cfg.name_ar}» في النظام وتوليد ملف .xlsx بنجاح!`);
      }

      await loadExisting();
      activeTab = 'gallery';
    } catch (err) {
      toastErr('فشل حفظ القالب: ' + (err.message || err));
    } finally {
      saving = false;
      renderView();
      attachEvents();
    }
  });

  // Cancel edit
  $('#btn-cancel-edit', view)?.addEventListener('click', () => {
    editingId = null;
    cfg.gridState = getTaxInvoicePreset(cfg.primary_color);
    renderView();
    attachEvents();
  });

  // Edit from gallery
  $$('.tpl-btn-edit', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.tplId;
      try {
        const tpl = await api.get(`/api/templates/builder/${id}/config`);
        const bc = tpl?.builder_config || {};
        editingId = id;
        cfg = {
          type: bc.type || tpl.category || 'invoices',
          name_ar: tpl.name_ar || id,
          company_name_ar: bc.company_name_ar || '',
          primary_color: bc.primary_color || tpl.color_hex || '#059669',
          accent_color: bc.accent_color || '#047857',
          logo_data: bc.logo_data || '',
          logo_width: bc.logo_width || 140,
          logo_height: bc.logo_height || 70,
          logo_position: bc.logo_position || 'left',
          gridState: bc.gridState || (bc.type === 'documents' ? getReceiptVoucherPreset(bc.primary_color) : getTaxInvoicePreset(bc.primary_color)),
        };
        activeCell = 'A1';
        activeTab = 'editor';
        renderView();
        attachEvents();
        toastOk(`تم تحميل قالب «${cfg.name_ar}» في الاستوديو!`);
      } catch (err) {
        toastErr('تعذر تحميل بيانات القالب: ' + err.message);
      }
    });
  });

  // Ready templates: one-click apply
  $$('.tpl-ready-btn', view).forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = READY_TEMPLATES.find(t => t.id === btn.dataset.readyId);
      if (!tpl) return;
      buildReadyTemplate(tpl);
      toastOk(`تم تحميل قالب «${tpl.name}» في المحرر — عدّله واحفظه كملف Excel!`);
    });
  });

  // Download from gallery
  $$('.tpl-btn-dl', view).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tplId;
      const tpl = existingTemplates.find(t => t.id === id);
      if (!tpl) return;
      const cat = tpl.category || 'invoices';
      const url = `/data/templates/${cat}/${id}.xlsx`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  });
}

// ─── Inline Cell Editor ───────────────────────────────────────────────────
function openInlineEditor(td) {
  const existingVal = cfg.gridState?.cells?.[activeCell]?.v || '';
  td.innerHTML = `<textarea class="tb-inline-editor" dir="auto">${esc(existingVal)}</textarea>`;
  const textarea = td.querySelector('.tb-inline-editor');
  if (textarea) {
    textarea.focus();
    textarea.select();

    const commit = () => {
      updateActiveCellValue(textarea.value);
      const fi = $('#tb-formula-input', view);
      if (fi) fi.value = textarea.value;
      td.innerHTML = `<div class="tb-cell-val" dir="auto">${esc(textarea.value)}</div>`;
    };

    textarea.addEventListener('blur', commit);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
        moveToNextRow();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commit();
        moveToNextCol();
      }
    });
  }
}

function updateActiveCellValue(newVal) {
  if (!activeCell || !cfg.gridState) return;
  if (!cfg.gridState.cells[activeCell]) {
    cfg.gridState.cells[activeCell] = { v: '', size: 11, align: 'right' };
  }
  cfg.gridState.cells[activeCell].v = newVal;

  const td = $(`[data-ref="${activeCell}"]`, view);
  if (td) {
    const valDiv = td.querySelector('.tb-cell-val');
    if (valDiv) valDiv.textContent = newVal;
  }
}

function selectCell(ref) {
  if (!ref || !cfg.gridState) return;
  activeCell = ref;

  $$('.tb-grid-cell', view).forEach(el => el.classList.remove('tb-cell-active'));
  const targetTd = $(`[data-ref="${ref}"]`, view);
  if (targetTd) targetTd.classList.add('tb-cell-active');

  const refBadge = $('#tb-active-cell-ref', view);
  if (refBadge) refBadge.textContent = ref;

  const cellData = cfg.gridState.cells[ref] || {};
  const formulaInput = $('#tb-formula-input', view);
  if (formulaInput) {
    formulaInput.value = cellData.v !== undefined ? cellData.v : '';
  }

  const btnBold = $('#btn-tool-bold', view);
  if (btnBold) btnBold.classList.toggle('active', !!cellData.bold);

  const selSize = $('#sel-tool-size', view);
  if (selSize) selSize.value = cellData.size || 11;

  const al = cellData.align || 'right';
  $$('[data-align]', view).forEach(b => {
    b.classList.toggle('active', b.dataset.align === al);
  });

  const parsed = parseCellRef(ref);
  if (parsed && cfg.gridState) {
    const colWidthLbl = $('#tb-col-width-lbl', view);
    if (colWidthLbl) colWidthLbl.textContent = cfg.gridState.cols[parsed.col]?.width || 14;
    const rowHeightLbl = $('#tb-row-height-lbl', view);
    if (rowHeightLbl) rowHeightLbl.textContent = `${cfg.gridState.rows[parsed.row - 1]?.height || 24}px`;
  }
}

function moveToNextRow() {
  const parsed = parseCellRef(activeCell);
  if (parsed && cfg.gridState && parsed.row < cfg.gridState.rows.length) {
    selectCell(colLetter(parsed.col) + (parsed.row + 1));
  }
}

function moveToNextCol() {
  const parsed = parseCellRef(activeCell);
  if (parsed && cfg.gridState && parsed.col < cfg.gridState.cols.length - 1) {
    selectCell(colLetter(parsed.col + 1) + parsed.row);
  }
}

function toggleMergeActiveCell() {
  if (!activeCell || !cfg.gridState) return;
  const merges = cfg.gridState.merges || [];
  const parsed = parseCellRef(activeCell);
  if (!parsed) return;

  const existingIdx = merges.findIndex(m => {
    const r = parseRange(m);
    return r && parsed.row >= r.r1 && parsed.row <= r.r2 && parsed.col >= r.c1 && parsed.col <= r.c2;
  });

  if (existingIdx >= 0) {
    merges.splice(existingIdx, 1);
    toastOk('تم فك دمج الخلية');
  } else {
    const nextCol = Math.min(cfg.gridState.cols.length - 1, parsed.col + 1);
    const newMerge = `${colLetter(parsed.col)}${parsed.row}:${colLetter(nextCol)}${parsed.row}`;
    merges.push(newMerge);
    toastOk(`تم دمج الخلايا (${newMerge})`);
  }
  renderView();
  attachEvents();
}

// ─── Load Existing Templates ──────────────────────────────────────────────
async function loadExisting() {
  try {
    const [inv, doc] = await Promise.all([
      api.get('/api/invoices/templates?category=invoices'),
      api.get('/api/invoices/templates?category=documents'),
    ]);
    existingTemplates = [
      ...(Array.isArray(inv) ? inv : []).map(t => ({ ...t, category: 'invoices' })),
      ...(Array.isArray(doc) ? doc : []).map(t => ({ ...t, category: 'documents' })),
    ];
  } catch {
    existingTemplates = [];
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────
export async function render(container) {
  view = container;
  cfg = {
    type: 'invoices',
    name_ar: '',
    company_name_ar: store.activeIssuer?.name_ar || '',
    primary_color: '#059669',
    accent_color: '#047857',
    logo_data: '',
    logo_width: 140,
    logo_height: 70,
    logo_position: 'left',
    gridState: getTaxInvoicePreset('#059669'),
  };
  activeTab = 'editor';
  previewMode = 'sample';
  activeCell = 'A1';
  editingId = null;
  saving = false;
  zoomLevel = 100;

  await loadExisting();
  renderView();
  attachEvents();
}
