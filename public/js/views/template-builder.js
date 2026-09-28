// ==========================================================================
//  Raseen — محرر ومصمم القوالب المرئي المباشر الحقيقي (True WYSIWYG Document Editor)
//  يتيح تنظيم كامل، إدراج وتخصيص أي جداول، والتحكم الشامل في خلفية وإطار القوالب
// ==========================================================================
import { api } from '../core/api.js';
import { toastOk, toastErr, $, $$, esc, qrSvg, cleanStrayTableRowsAndFixTables } from '../core/util.js';
import { code39Svg } from '../print/code39.js';
import { openAiPromptModal } from './ai-prompt-modal.js';

const PALETTE = [
  '#059669', '#1d4ed8', '#0f172a', '#6d28d9',
  '#0e7490', '#d97706', '#be123c', '#334155'
];

export const SAR_SYMBOL_SVG = `<svg viewBox="0 0 1124.14 1256.39" width="0.88em" height="0.88em" class="sar-sym" style="vertical-align:-0.12em;display:inline-block;fill:currentColor;margin:0 2px;" aria-label="ريال سعودي" title="ريال سعودي"><path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"/><path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"/></svg>`;

const SYSTEM_TAGS = [
  { label: 'اسم المنشأة', tag: '{{seller_name}}' },
  { label: 'الرقم الضريبي للمنشأة', tag: '{{seller_tax}}' },
  { label: 'السجل التجاري', tag: '{{seller_cr}}' },
  { label: 'العنوان الوطني', tag: '{{seller_address}}' },
  { label: 'هاتف المنشأة', tag: '{{seller_phone}}' },
  { label: 'رقم الفاتورة', tag: '{{invoice_number}}' },
  { label: 'تاريخ الإصدار', tag: '{{issue_date}}' },
  { label: 'اسم العميل', tag: '{{buyer_name}}' },
  { label: 'الرقم الضريبي للعميل', tag: '{{buyer_tax}}' },
  { label: 'عنوان العميل', tag: '{{buyer_address}}' },
  { label: 'هاتف العميل', tag: '{{buyer_phone}}' },
  { label: 'المجموع قبل الضريبة', tag: '{{subtotal}}' },
  { label: 'الخصم', tag: '{{discount}}' },
  { label: 'مبلغ الضريبة 15%', tag: '{{tax_amount}}' },
  { label: 'المبلغ الإجمالي', tag: '{{grand_total}}' },
  { label: 'نوع الفاتورة', tag: '{{payment_method}}' },
  { label: 'ملاحظات / شروط', tag: '{{notes}}' },
  { label: 'رمز التحقق QR', tag: '{{qr_code}}' },
  { label: 'رمز الريال السعودي', tag: '{{currency_symbol}}' },
  { label: 'رمز الريال SVG', tag: '{{sar_symbol}}' },
];

let view = null;
let editingId = null;
let saving = false;
let presetStyles = '';
let selectedBlock = null;
let selectedTable = null;
let copiedBlock = null;
let zoomPercent = 100;
let activeTab = 'elements'; // 'elements' | 'background' | 'typography'

let docMeta = {
  type: 'invoices',
  name_ar: 'قالب فواتير مخصص',
  primary_color: '#1a2638',
};

// ─── Sheet Background & Framing State ─────────────────────────────────────
let sheetBg = {
  bgColor: '#ffffff',
  watermarkText: '',
  watermarkOpacity: 0.07,
  watermarkAngle: -35,
  watermarkColor: '#0f172a',
  bgImage: '',
  bgImageOpacity: 0.15,
  bgImageFit: 'contain', // 'contain', 'cover', 'header'
  frameStyle: 'none',    // 'none', 'classic', 'double', 'gold', 'theme'
  frameColor: '#cbd5e1'
};

// ─── Insertable Block Element Generator ───────────────────────────────────

function createBlockElement(htmlContent, blockType = 'block') {
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-block';
  wrapper.dataset.blockType = blockType;
  if (blockType === 'totals' || blockType === 'signatures') {
    wrapper.classList.add('pinned-bottom');
    wrapper.style.marginTop = 'auto';
  }
  wrapper.innerHTML = `
    <div class="block-controls" contenteditable="false">
      <button type="button" class="btn-ctrl btn-move-up" title="نقل لأعلى">▲</button>
      <button type="button" class="btn-ctrl btn-move-down" title="نقل لأسفل">▼</button>
      <button type="button" class="btn-ctrl btn-place-bottom" title="وضع وتثبيت العنصر أسفل الورقة">⬇</button>
      <button type="button" class="btn-ctrl btn-drag" title="اسحب لترتيب العنصر أو إنزاله في فراغ الورقة">⠿</button>
      <button type="button" class="btn-ctrl btn-dup" title="تكرار العنصر">⧉</button>
      <button type="button" class="btn-ctrl btn-del-blk" title="حذف العنصر">&times;</button>
    </div>
    <div class="block-content">
      ${htmlContent}
    </div>
  `;
  attachBlockControls(wrapper);
  return wrapper;
}

// ─── Dynamic Custom Table Generator ───────────────────────────────────────

function generateCustomTableHTML({
  title = 'جدول بيانات مخصص',
  cols = 4,
  rows = 2,
  style = 'financial', // 'financial', 'zebra', 'grid', 'minimal'
  headers = [],
  color = docMeta.primary_color
} = {}) {
  const defaultHeaders = [
    'البند / الوصف', 'التفاصيل والمواصفات', 'الكمية / النسبة', 'القيمة / الملاحظات',
    'الحالة', 'المرجع', 'التاريخ', 'المسؤول'
  ];

  let ths = '';
  for (let i = 0; i < cols; i++) {
    const hText = headers[i] || defaultHeaders[i] || `عمود ${i + 1}`;
    ths += `<th contenteditable="true" style="padding:8px 10px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:right;">${hText}</th>`;
  }

  let trs = '';
  for (let r = 0; r < rows; r++) {
    const isZebra = (style === 'zebra' && r % 2 === 1);
    const rowBg = isZebra ? '#f8fafc' : '#ffffff';
    let tds = '';
    for (let c = 0; c < cols; c++) {
      const val = c === 0 ? `بند ${r + 1}` : '-';
      const weight = c === 0 ? '600' : 'normal';
      tds += `<td contenteditable="true" style="padding:8px 10px; border:1px solid #cbd5e1; outline:none; text-align:right; font-weight:${weight};">${val}</td>`;
    }
    trs += `<tr style="background:${rowBg};">${tds}</tr>`;
  }

  let tableBorder = 'border:1px solid #cbd5e1;';
  if (style === 'minimal') {
    tableBorder = 'border:none; border-bottom:2px solid #cbd5e1;';
  }

  return `
    <div style="margin-bottom:14px;" class="custom-table-container">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <div contenteditable="true" style="font-weight:800; font-size:13px; color:#0f172a; outline:none;">${esc(title)}:</div>
        <div contenteditable="false" style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;">
          <button type="button" class="btn-sub-ctrl btn-add-row" title="إضافة صف جديد للجدول">+ صف</button>
          <button type="button" class="btn-sub-ctrl btn-del-row" title="حذف آخر صف من الجدول">- صف</button>
          <button type="button" class="btn-sub-ctrl btn-add-col" title="إضافة عمود جديد للجدول">+ عمود</button>
          <button type="button" class="btn-sub-ctrl btn-del-col" title="حذف آخر عمود">- عمود</button>
          <button type="button" class="btn-sub-ctrl btn-toggle-zebra" title="تبديل تظليل الصفوف">تظليل</button>
          <label class="btn-sub-ctrl" style="display:inline-flex; align-items:center; gap:2px; cursor:pointer;" title="تغيير لون ترويسة هذا الجدول">
            <span style="font-size:10px;">اللون</span>
            <input type="color" class="inp-tbl-col" value="${color}" style="width:14px; height:14px; border:none; padding:0; background:transparent; cursor:pointer;" />
          </label>
        </div>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:11.5px; ${tableBorder}" class="data-table" data-style="${style}">
        <thead>
          <tr style="background:${color}; color:#fff;" class="tbl-head-row">
            ${ths}
          </tr>
        </thead>
        <tbody>
          ${trs}
        </tbody>
      </table>
    </div>
  `;
}

// 1. Header Block (Geometric Angled Banner Style)
function getHeaderBlockHTML(color) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #e2e8f0; padding-bottom:14px; margin-bottom:14px;">
      <div style="flex:1;">
        <div contenteditable="true" style="font-size:22px; font-weight:900; color:#0f172a; margin-bottom:6px; outline:none;">{{seller_name}}</div>
        <div contenteditable="true" style="font-size:12px; color:#475569; line-height:1.8; outline:none;">
          الرقم الضريبي: <strong style="color:#0f172a;">{{seller_tax}}</strong> &bull; السجل التجاري: <strong style="color:#0f172a;">{{seller_cr}}</strong><br/>
          العنوان الوطني: {{seller_address}} &bull; هاتف: 0500000000
        </div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
        <div contenteditable="true" class="doc-title-banner" style="background:${color}; color:#fff; font-size:22px; font-weight:900; padding:6px 32px 6px 16px; clip-path:polygon(0 0, 85% 0, 100% 100%, 0 100%); text-align:center; min-width:220px; outline:none; letter-spacing:0.5px;">فاتورة بيع</div>
        <div contenteditable="true" style="font-size:11px; color:#64748b; font-weight:700; text-align:left; outline:none;">فاتورة ضريبية مبسطة معتمدة</div>
      </div>
    </div>
  `;
}

// 1b. 3 Info Pills (Metadata Chamber)
function getInfoPillsBlockHTML(color) {
  return `
    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:14px;">
      <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:4px; height:36px; display:flex; align-items:center; font-size:12px; font-weight:800; color:#0f172a; overflow:hidden;">
        <span style="width:34px; height:100%; display:flex; align-items:center; justify-content:center; background:#f1f5f9; border-inline-end:1px solid #cbd5e1; color:${color}; font-size:13px; font-weight:900;">#</span>
        <span contenteditable="true" style="padding:0 8px; flex:1; outline:none;">رقم الفاتورة: <span style="color:${color}; font-weight:900;">{{invoice_number}}</span></span>
      </div>
      <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:4px; height:36px; display:flex; align-items:center; font-size:12px; font-weight:800; color:#0f172a; overflow:hidden;">
        <span style="width:34px; height:100%; display:flex; align-items:center; justify-content:center; background:#f1f5f9; border-inline-end:1px solid #cbd5e1; color:${color}; font-size:13px;">التاريخ:</span>
        <span contenteditable="true" style="padding:0 8px; flex:1; outline:none;">تاريخ الإصدار: <span>{{issue_date}}</span></span>
      </div>
      <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:4px; height:36px; display:flex; align-items:center; font-size:12px; font-weight:800; color:#0f172a; overflow:hidden;">
        <span style="width:34px; height:100%; display:flex; align-items:center; justify-content:center; background:#f1f5f9; border-inline-end:1px solid #cbd5e1; color:${color}; font-size:13px;">العميل:</span>
        <span contenteditable="true" style="padding:0 8px; flex:1; outline:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">العميل: <span>{{buyer_name}}</span></span>
      </div>
    </div>
  `;
}

// 2. Logo / Image Block
function getImageBlockHTML(src = '', width = '140px') {
  const imgSrc = src || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="140" height="70" viewBox="0 0 140 70"><rect width="140" height="70" fill="%23f1f5f9" stroke="%23cbd5e1" stroke-dasharray="4"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="12" fill="%2394a3b8">ضع الشعار هنا</text></svg>';
  return `
    <div style="display:flex; justify-content:center; align-items:center; margin-bottom:14px; text-align:center;">
      <div style="position:relative; display:inline-block;" class="logo-container">
        <img src="${imgSrc}" style="max-height:90px; width:${width}; object-fit:contain; border-radius:4px;" class="user-logo-img" alt="شعار المنشأة" />
        <div class="logo-actions" contenteditable="false" style="margin-top:4px; display:flex; gap:4px; justify-content:center;">
          <button type="button" class="btn-sub-ctrl btn-change-logo" style="font-size:10px; background:#0f172a; color:#fff; border:none; padding:2px 8px; border-radius:3px; cursor:pointer;">تغيير الشعار</button>
          <button type="button" class="btn-sub-ctrl btn-resize-logo" data-size="90px" style="font-size:10px; background:#475569; color:#fff; border:none; padding:2px 6px; border-radius:3px; cursor:pointer;">صغير</button>
          <button type="button" class="btn-sub-ctrl btn-resize-logo" data-size="140px" style="font-size:10px; background:#475569; color:#fff; border:none; padding:2px 6px; border-radius:3px; cursor:pointer;">متوسط</button>
          <button type="button" class="btn-sub-ctrl btn-resize-logo" data-size="200px" style="font-size:10px; background:#475569; color:#fff; border:none; padding:2px 6px; border-radius:3px; cursor:pointer;">كبير</button>
        </div>
      </div>
    </div>
  `;
}

// 3. Customer Info Box
function getBuyerBlockHTML(color) {
  return `
    <div style="border:1px solid #cbd5e1; border-radius:4px; overflow:hidden; margin-bottom:14px;">
      <div style="background:#f8fafc; border-bottom:1px solid #cbd5e1; padding:6px 12px; font-size:12px; font-weight:800; color:${color}; display:flex; justify-content:space-between; align-items:center;">
        <span contenteditable="true" style="outline:none;">بيانات العميل (المشتري)</span>
        <span contenteditable="true" style="font-size:10px; color:#64748b; font-weight:600; outline:none;">عميل معتمد</span>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="width:140px; font-weight:700; padding:6px 12px; background:#f8fafc; color:#475569;">الاسم / المنشأة:</td>
          <td contenteditable="true" style="padding:6px 12px; font-weight:800; color:#0f172a; outline:none;">{{buyer_name}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="width:140px; font-weight:700; padding:6px 12px; background:#f8fafc; color:#475569;">الرقم الضريبي:</td>
          <td contenteditable="true" style="padding:6px 12px; font-weight:800; color:#0f172a; outline:none;">{{buyer_tax}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="width:140px; font-weight:700; padding:6px 12px; background:#f8fafc; color:#475569;">العنوان الوطني:</td>
          <td contenteditable="true" style="padding:6px 12px; color:#334155; outline:none;">{{buyer_address}}</td>
        </tr>
        <tr>
          <td style="width:140px; font-weight:700; padding:6px 12px; background:#f8fafc; color:#475569;">رقم التواصل:</td>
          <td contenteditable="true" style="padding:6px 12px; color:#334155; outline:none;">{{buyer_phone}}</td>
        </tr>
      </table>
    </div>
  `;
}

// 4. Financial Items Table (8-Column Professional Standard with SAR Symbol)
function getItemsTableBlockHTML(color) {
  return `
    <div style="margin-bottom:14px;" class="custom-table-container">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <div contenteditable="true" style="font-weight:800; font-size:13px; color:#0f172a; outline:none;">تفاصيل الأصناف والخدمات:</div>
        <div contenteditable="false" style="display:flex; gap:4px; align-items:center;">
          <button type="button" class="btn-sub-ctrl btn-add-row" title="إضافة صف">+ صف</button>
          <button type="button" class="btn-sub-ctrl btn-del-row" title="حذف صف">- صف</button>
          <button type="button" class="btn-sub-ctrl btn-add-col" title="إضافة عمود">+ عمود</button>
          <button type="button" class="btn-sub-ctrl btn-del-col" title="حذف عمود">- عمود</button>
          <label class="btn-sub-ctrl" style="display:inline-flex; align-items:center; gap:2px; cursor:pointer;" title="تغيير لون ترويسة الجدول">
            <span style="font-size:10px;">اللون</span>
            <input type="color" class="inp-tbl-col" value="${color}" style="width:14px; height:14px; border:none; padding:0; background:transparent; cursor:pointer;" />
          </label>
        </div>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:11.5px; border:1px solid #cbd5e1;" class="data-table">
        <thead>
          <tr style="background:${color}; color:#fff;" class="tbl-head-row">
            <th contenteditable="true" style="padding:8px 6px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:center; width:35px;">#</th>
            <th contenteditable="true" style="padding:8px 8px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:center; width:75px;">كود الصنف</th>
            <th contenteditable="true" style="padding:8px 8px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:right;">بيان الصنف أو الخدمة</th>
            <th contenteditable="true" style="padding:8px 6px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:center; width:55px;">الكمية</th>
            <th contenteditable="true" style="padding:8px 6px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:left; width:85px;">سعر الوحدة</th>
            <th contenteditable="true" style="padding:8px 6px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:left; width:65px;">الخصم</th>
            <th contenteditable="true" style="padding:8px 6px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:left; width:75px;">الضريبة</th>
            <th contenteditable="true" style="padding:8px 8px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:left; width:100px;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:center; font-weight:700;">1</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:center; color:#64748b;">PRD-01</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:right; font-weight:700; color:#0f172a;">خدمات برمجية وتطوير أنظمة</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:center; font-weight:700;">1</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left;">${SAR_SYMBOL_SVG} 1,000.00</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left; color:#dc2626;">0.00</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left;">${SAR_SYMBOL_SVG} 150.00</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:left; font-weight:800; color:#0f172a;">${SAR_SYMBOL_SVG} 1,150.00</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:center; font-weight:700;">2</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:center; color:#64748b;">PRD-02</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:right; font-weight:700; color:#0f172a;">دعم فني وصيانة دورية</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:center; font-weight:700;">1</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left;">${SAR_SYMBOL_SVG} 500.00</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left; color:#dc2626;">50.00</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left;">${SAR_SYMBOL_SVG} 67.50</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:left; font-weight:800; color:#0f172a;">${SAR_SYMBOL_SVG} 517.50</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// 5. Totals & QR Code Block
function getTotalsBlockHTML(color) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:stretch; gap:12px; margin-top:10px; margin-bottom:14px;">
      <div style="width:115px; border:1px solid #cbd5e1; border-radius:4px; padding:10px; text-align:center; background:#fff; display:flex; align-items:center; justify-content:center;">
        <div style="width:90px; height:90px; display:flex; align-items:center; justify-content:center; font-family:'Segoe UI', Arial, sans-serif; font-weight:900; font-size:26px; color:#1e293b; border:1.5px dashed #cbd5e1; border-radius:6px; background:#f8fafc; letter-spacing:1px;">QR</div>
      </div>
      <div style="flex:1; border:1px solid #cbd5e1; border-radius:4px; padding:10px 14px; background:#f8fafc; font-size:11.5px; display:flex; flex-direction:column;">
        <div contenteditable="true" style="font-weight:800; color:${color}; margin-bottom:4px; outline:none;">ملاحظات وشروط الفاتورة:</div>
        <div contenteditable="true" style="color:#475569; line-height:1.7; flex:1; outline:none;">
          {{notes}}<br/>
          تعتبر هذه الفاتورة وثيقة رسمية معتمدة وفق اشتراطات هيئة الزكاة والضريبة والجمارك.
        </div>
      </div>
      <div style="min-width:270px; border:1px solid #cbd5e1; border-radius:4px; overflow:hidden;">
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td contenteditable="true" style="padding:6px 10px; background:#f8fafc; font-weight:700; color:#475569; outline:none;">المجموع الخاضع للضريبة:</td>
            <td style="padding:6px 10px; text-align:left; font-weight:700; color:#0f172a;">${SAR_SYMBOL_SVG} {{subtotal}}</td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td contenteditable="true" style="padding:6px 10px; background:#f8fafc; font-weight:700; color:#475569; outline:none;">إجمالي الخصم:</td>
            <td style="padding:6px 10px; text-align:left; font-weight:700; color:#dc2626;">${SAR_SYMBOL_SVG} {{discount}}</td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td contenteditable="true" style="padding:6px 10px; background:#f8fafc; font-weight:700; color:#475569; outline:none;">ضريبة القيمة المضافة (15%):</td>
            <td style="padding:6px 10px; text-align:left; font-weight:700; color:#0f172a;">${SAR_SYMBOL_SVG} {{tax_amount}}</td>
          </tr>
          <tr style="background:${color}; color:#fff;" class="totals-grand-row">
            <td contenteditable="true" style="padding:8px 10px; font-size:13px; font-weight:900; outline:none;">المبلغ الإجمالي المستحق:</td>
            <td style="padding:8px 10px; font-size:14px; font-weight:900; text-align:left;">${SAR_SYMBOL_SVG} {{grand_total}}</td>
          </tr>
        </table>
      </div>
    </div>
  `;
}

// 6. Voucher Banner (For documents / سندات قبض)
function getVoucherBannerBlockHTML(color) {
  return `
    <div style="background:#f8fafc; border:2px solid ${color}; border-radius:8px; padding:14px 22px; display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
      <div>
        <div contenteditable="true" style="font-size:13px; font-weight:700; color:#475569; outline:none;">المبلغ المقبوض كتابة ورقماً:</div>
        <div contenteditable="true" style="font-size:11px; color:#64748b; margin-top:2px; outline:none;">فقط وقدره المبلغ الموضح أعلاه لا غير</div>
      </div>
      <div style="font-size:28px; font-weight:900; color:${color}; font-family:Tahoma, sans-serif; direction:ltr; display:flex; align-items:center; gap:6px;">
        <span style="font-size:0.85em;">${SAR_SYMBOL_SVG}</span>
        <span>{{grand_total}}</span>
      </div>
    </div>
  `;
}

// 7. SAR Symbol Badge Block
function getSarBadgeBlockHTML(color) {
  return `
    <div style="display:inline-flex; align-items:center; gap:8px; font-size:15px; font-weight:800; color:${color}; padding:8px 16px; background:#f8fafc; border:2px solid ${color}; border-radius:6px; margin-bottom:12px;">
      <span contenteditable="true" style="outline:none;">المبلغ الإجمالي:</span>
      <span style="display:inline-flex; align-items:center; gap:4px; direction:ltr;">
        <span style="font-size:1.15em;">${SAR_SYMBOL_SVG}</span>
        <span>{{grand_total}}</span>
      </span>
    </div>
  `;
}

// 8. Voucher Fields
function getVoucherFieldsBlockHTML() {
  return `
    <div style="display:flex; flex-direction:column; gap:14px; margin-bottom:20px; font-size:13px;">
      <div style="display:flex; align-items:baseline; border-bottom:1px dotted #cbd5e1; padding-bottom:6px;">
        <span contenteditable="true" style="width:170px; font-weight:700; color:#475569; outline:none;">استلمنا من المكرم / السيد:</span>
        <span style="font-weight:700; color:#0f172a; flex:1;">{{buyer_name}}</span>
      </div>
      <div style="display:flex; align-items:baseline; border-bottom:1px dotted #cbd5e1; padding-bottom:6px;">
        <span contenteditable="true" style="width:170px; font-weight:700; color:#475569; outline:none;">وذلك مقابل / البيان:</span>
        <span style="font-weight:600; color:#0f172a; flex:1;">{{notes}}</span>
      </div>
      <div style="display:flex; align-items:baseline; border-bottom:1px dotted #cbd5e1; padding-bottom:6px;">
        <span contenteditable="true" style="width:170px; font-weight:700; color:#475569; outline:none;">طريقة القبض / السداد:</span>
        <span style="font-weight:600; color:#0f172a; flex:1;">{{payment_method}}</span>
      </div>
    </div>
  `;
}

// 9. Textbox / Terms & Conditions
function getTextboxBlockHTML(color) {
  return `
    <div style="margin-bottom:14px; padding:12px 16px; border:1px solid #cbd5e1; border-right:4px solid ${color}; border-radius:6px; background:#f8fafc; font-size:12px;">
      <div contenteditable="true" style="font-weight:700; color:${color}; margin-bottom:4px; outline:none;">الشروط والأحكام / ملاحظات هامة:</div>
      <div contenteditable="true" style="color:#475569; line-height:1.7; outline:none;">
        1. تعتبر هذه الفاتورة وثيقة رسمية معتمدة وفق اشتراطات هيئة الزكاة والضريبة والجمارك.<br/>
        2. البضاعة المباعة لا ترد ولا تستبدل بعد مرور 7 أيام من تاريخ الاستلام.<br/>
        3. يرجى سداد المبلغ المستحق عبر التحويل البنكي لحساب المنشأة المعتمد.
      </div>
    </div>
  `;
}

// 10. Signatures & Seals
function getSignaturesBlockHTML() {
  return `
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; margin-top:35px; text-align:center;">
      <div style="border-top:1.5px solid #94a3b8; padding-top:8px;">
        <div contenteditable="true" style="font-size:12px; font-weight:700; color:#475569; outline:none;">توقيع العميل / المستلم</div>
        <div style="height:35px;"></div>
      </div>
      <div style="border-top:1.5px solid #94a3b8; padding-top:8px;">
        <div contenteditable="true" style="font-size:12px; font-weight:700; color:#475569; outline:none;">المحاسب المسؤول</div>
        <div style="height:35px;"></div>
      </div>
      <div style="border-top:1.5px solid #94a3b8; padding-top:8px;">
        <div contenteditable="true" style="font-size:12px; font-weight:700; color:#475569; outline:none;">الختم الرسمي للمنشأة</div>
        <div style="height:35px;"></div>
      </div>
    </div>
  `;
}

// 11. Divider
function getDividerBlockHTML(color) {
  return `
    <div style="margin:16px 0;">
      <hr style="border:none; border-top:2px solid ${color}; margin:0;" />
    </div>
  `;
}

// 12. Status Badge
function getBadgeBlockHTML(color) {
  return `
    <div style="display:inline-block; margin-bottom:12px;">
      <span contenteditable="true" style="background:${color}; color:#fff; font-size:12px; font-weight:800; padding:4px 14px; border-radius:20px; display:inline-flex; align-items:center; gap:6px; outline:none;">
        معتمد رسمياً
      </span>
    </div>
  `;
}

function getQrBlockHTML() {
  return `<div class="builder-qr" style="display:inline-flex; align-items:center; justify-content:center; padding:10px; background:#fff; color:#0f172a;">
    <div class="builder-qr-preview" contenteditable="false" style="width:90px; height:90px; display:flex; align-items:center; justify-content:center; font-family:'Segoe UI', Arial, sans-serif; font-weight:900; font-size:26px; color:#1e293b; border:1.5px dashed #cbd5e1; border-radius:6px; background:#f8fafc; letter-spacing:1px;">QR</div>
    <div class="builder-qr-value" style="display:none;">{{qr_code}}</div>
    <input class="builder-qr-input" value="{{qr_code}}" style="display:none;" />
  </div>`;
}

function getBarcodeBlockHTML() {
  return `<div class="builder-barcode" style="display:inline-flex; flex-direction:column; align-items:center; gap:4px; padding:10px; background:#fff; color:#111;">
    <div class="builder-barcode-preview">${code39Svg('PRD-01')}</div>
    <small class="builder-barcode-label">PRD-01</small>
    <input class="builder-barcode-input" value="PRD-01" title="قيمة الباركود Code 39" style="width:150px; font-size:11px; text-align:center;" />
  </div>`;
}

// ─── Attach Block Controls (Move, Duplicate, Delete, Table Operations) ─────

function selectBlock(block, table = null) {
  selectedBlock?.classList.remove('editor-block-selected');
  selectedBlock = block;
  selectedTable = table || (block?.matches('table') ? block : block?.querySelector('table'));
  selectedBlock?.classList.add('editor-block-selected');
  const styleSelect = $('#sel-table-style', view);
  if (styleSelect) {
    styleSelect.disabled = !selectedTable;
    styleSelect.value = selectedTable?.dataset.style || 'financial';
  }
  const scale = $('#rng-block-scale', view);
  if (scale) {
    scale.disabled = !block;
    scale.value = block ? Number.parseInt(block.style.zoom || '100', 10) : 100;
    $('#out-block-scale', view).textContent = `${scale.value}%`;
  }
  const inpBg = $('#inp-sel-el-bg', view);
  if (inpBg) {
    inpBg.disabled = !block;
    if (block) {
      const bg = block.style.backgroundColor || (window.getComputedStyle ? getComputedStyle(block).backgroundColor : '');
      const hex = normalizeColorToHex(bg);
      if (hex && hex.startsWith('#') && hex.length === 7) inpBg.value = hex;
    }
  }
  const inpCol = $('#inp-sel-el-color', view);
  if (inpCol) {
    inpCol.disabled = !block;
    if (block) {
      const col = block.style.color || (window.getComputedStyle ? getComputedStyle(block).color : '');
      const hex = normalizeColorToHex(col);
      if (hex && hex.startsWith('#') && hex.length === 7) inpCol.value = hex;
    }
  }
  const btnDel = $('#btn-del-selected', view);
  if (btnDel) {
    btnDel.disabled = !block || block.id === 'editor-canvas-sheet';
  }
}

function bottomRoom(item, selector) {
  const page = item.closest('#editor-canvas-sheet');
  if (!page) return 0;
  const pageRect = page.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const scale = item.offsetHeight ? itemRect.height / item.offsetHeight : 1;
  const lastBlock = [...item.parentElement.children].filter(child => child.matches(selector)).at(-1);
  const flowBottom = Math.max(itemRect.bottom, lastBlock?.getBoundingClientRect().bottom || 0);
  const bottomInset = parseFloat(getComputedStyle(page).paddingBottom) || 0;
  const pageScale = page.offsetHeight ? pageRect.height / page.offsetHeight : 1;
  return Math.max(0, (pageRect.bottom - bottomInset * pageScale - flowBottom) / scale);
}

function bindMoveHandle(handle, item, selector) {
  handle.draggable = false;
  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const parent = item.parentElement;
    if (!parent) return;
    const page = item.closest('#editor-canvas-sheet');
    let anchorY = event.clientY;
    let baseGap = parseFloat(getComputedStyle(item).marginTop) || 0;
    const pointerId = event.pointerId;
    view.setPointerCapture(pointerId);
    item.classList.add('builder-moving');
    const onMove = (move) => {
      if (move.pointerId !== pointerId) return;
      let target = document.elementFromPoint(move.clientX, move.clientY);
      while (target && target.parentElement !== parent) target = target.parentElement;
      if (target && target !== item && target.matches(selector)) {
        const after = move.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        parent.insertBefore(item, after ? target.nextSibling : target);
        anchorY = move.clientY;
        baseGap = parseFloat(getComputedStyle(item).marginTop) || 0;
        return;
      }
      if (!page) return;
      const pageRect = page.getBoundingClientRect();
      if (move.clientX < pageRect.left || move.clientX > pageRect.right || move.clientY < pageRect.top || move.clientY > pageRect.bottom) return;
      const scale = item.offsetHeight ? item.getBoundingClientRect().height / item.offsetHeight : 1;
      const currentGap = parseFloat(getComputedStyle(item).marginTop) || 0;
      const room = bottomRoom(item, selector);
      item.style.marginTop = `${Math.max(0, Math.min(currentGap + room, baseGap + (move.clientY - anchorY) / scale))}px`;
    };
    const finish = () => {
      item.classList.remove('builder-moving');
      view.removeEventListener('pointermove', onMove);
      view.removeEventListener('pointerup', finish);
      view.removeEventListener('pointercancel', finish);
      if (view.hasPointerCapture(pointerId)) view.releasePointerCapture(pointerId);
    };
    view.addEventListener('pointermove', onMove);
    view.addEventListener('pointerup', finish);
    view.addEventListener('pointercancel', finish);
  };
}

function attachBlockControls(block) {
  if (!block) return;

  block.tabIndex = 0;
  block.onclick = (e) => selectBlock(block, e.target.closest('table'));
  let dragHandle = $('.btn-drag', block);
  if (!dragHandle && $('.block-controls', block)) {
    dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'btn-ctrl btn-drag';
    dragHandle.title = 'اسحب لترتيب العنصر أو إنزاله في فراغ الورقة';
    dragHandle.textContent = '⠿';
    $('.block-controls', block).appendChild(dragHandle);
  }
  if (dragHandle) bindMoveHandle(dragHandle, block, '.editor-block');
  let bottomButton = $('.btn-place-bottom', block);
  if (!bottomButton && $('.block-controls', block)) {
    bottomButton = document.createElement('button');
    bottomButton.type = 'button';
    bottomButton.className = 'btn-ctrl btn-place-bottom';
    bottomButton.title = 'وضع وتثبيت العنصر أسفل الورقة';
    bottomButton.textContent = '⬇';
    $('.block-controls', block).appendChild(bottomButton);
  }
  if (bottomButton) bottomButton.onclick = (e) => {
    e.stopPropagation();
    if (block.classList.contains('pinned-bottom') || block.style.marginTop === 'auto') {
      block.classList.remove('pinned-bottom');
      block.style.marginTop = '';
      toastOk('تم إلغاء التثبيت أسفل الورقة');
    } else {
      block.classList.add('pinned-bottom');
      block.style.marginTop = 'auto';
      toastOk('تم تثبيت العنصر أسفل الورقة');
    }
  };
  const qrInput = $('.builder-qr-input', block);
  if (qrInput) qrInput.onchange = () => {
    const value = qrInput.value.trim() || '{{qr_code}}';
    try {
      $('.builder-qr-preview', block).innerHTML = value === '{{qr_code}}'
        ? '<div style="width:90px; height:90px; display:flex; align-items:center; justify-content:center; font-family:\'Segoe UI\', Arial, sans-serif; font-weight:900; font-size:26px; color:#1e293b; border:1.5px dashed #cbd5e1; border-radius:6px; background:#f8fafc; letter-spacing:1px;">QR</div>'
        : qrSvg(value, { scale: 3, margin: 1 });
      $('.builder-qr-value', block).textContent = value;
    } catch {
      toastErr('محتوى الرمز طويل أو غير صالح');
    }
  };
  const barcodeInput = $('.builder-barcode-input', block);
  if (barcodeInput) barcodeInput.onchange = () => {
    try {
      const value = barcodeInput.value.trim().toUpperCase();
      $('.builder-barcode-preview', block).innerHTML = code39Svg(value);
      $('.builder-barcode-label', block).textContent = value;
      barcodeInput.value = value;
    } catch (err) {
      barcodeInput.value = $('.builder-barcode-label', block).textContent;
      toastErr(err.message);
    }
  };

  const btnDel = $('.btn-del-blk', block);
  if (btnDel) {
    btnDel.onclick = (e) => {
      e.stopPropagation();
      block.remove();
      if (selectedBlock === block) selectBlock(null);
      toastOk('تم حذف العنصر');
    };
  }

  const btnUp = $('.btn-move-up', block);
  if (btnUp) {
    btnUp.onclick = (e) => {
      e.stopPropagation();
      const prev = block.previousElementSibling;
      if (prev && !prev.classList.contains('canvas-watermark-layer') && !prev.classList.contains('canvas-bg-image-layer')) {
        block.parentNode.insertBefore(block, prev);
        if (block.classList.contains('pinned-bottom')) {
          block.classList.remove('pinned-bottom');
          block.style.marginTop = '';
        }
      }
    };
  }

  const btnDown = $('.btn-move-down', block);
  if (btnDown) {
    btnDown.onclick = (e) => {
      e.stopPropagation();
      const next = block.nextElementSibling;
      if (next) {
        block.parentNode.insertBefore(next, block);
      }
    };
  }

  const btnDup = $('.btn-dup', block);
  if (btnDup) {
    btnDup.onclick = (e) => {
      e.stopPropagation();
      const clone = block.cloneNode(true);
      attachBlockControls(clone);
      block.parentNode.insertBefore(clone, block.nextSibling);
      selectBlock(clone);
      toastOk('تم تكرار العنصر');
    };
  }

  // Handle Logo inside block
  const btnChangeLogo = $('.btn-change-logo', block);
  if (btnChangeLogo) {
    btnChangeLogo.onclick = (e) => {
      e.stopPropagation();
      const img = $('.user-logo-img', block);
      const fileInput = $('#global-img-uploader', view);
      if (fileInput && img) {
        fileInput.onchange = (ev) => {
          const file = ev.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (re) => {
              img.src = re.target.result;
              toastOk('تم تحديث الشعار بنجاح');
            };
            reader.readAsDataURL(file);
          }
        };
        fileInput.click();
      }
    };
  }

  $$('.btn-resize-logo', block).forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const img = $('.user-logo-img', block);
      if (img && btn.dataset.size) {
        img.style.width = btn.dataset.size;
      }
    };
  });

  // Table Row Add
  const btnAddRow = $('.btn-add-row', block);
  if (btnAddRow) {
    btnAddRow.onclick = (e) => {
      e.stopPropagation();
      const tbody = $('tbody', block);
      const thead = $('thead', block);
      if (tbody) {
        const colCount = thead ? thead.querySelectorAll('th').length : (tbody.firstElementChild?.children.length || 4);
        const lastTr = tbody.lastElementChild;
        let newTr;
        if (lastTr) {
          newTr = lastTr.cloneNode(true);
          // Clear inputs and auto-increment row counter if first td is a number
          const tds = newTr.querySelectorAll('td');
          tds.forEach((td, idx) => {
            if (idx === 0 && !isNaN(parseInt(td.textContent.trim()))) {
              td.textContent = String(tbody.children.length + 1);
            } else if (idx === 1 && td.textContent.trim().startsWith('PRD-')) {
              td.textContent = `PRD-0${tbody.children.length + 1}`;
            }
          });
        } else {
          newTr = document.createElement('tr');
          for (let i = 0; i < colCount; i++) {
            const td = document.createElement('td');
            td.contentEditable = 'true';
            td.style.cssText = 'padding:8px 10px; border:1px solid #cbd5e1; outline:none; text-align:right;';
            td.textContent = i === 0 ? String(tbody.children.length + 1) : '-';
            newTr.appendChild(td);
          }
        }
        tbody.appendChild(newTr);
        const table = $('table', block);
        if (table) applyTableStyle(table, table.dataset.style || 'financial');
        toastOk('تمت إضافة صف جديد');
      }
    };
  }

  // Table Row Delete
  const btnDelRow = $('.btn-del-row', block);
  if (btnDelRow) {
    btnDelRow.onclick = (e) => {
      e.stopPropagation();
      const tbody = $('tbody', block);
      if (tbody && tbody.children.length > 1) {
        tbody.lastElementChild.remove();
        toastOk('تم حذف آخر صف');
      } else {
        toastErr('يجب إبقاء صف واحد على الأقل');
      }
    };
  }

  // Table Col Add
  const btnAddCol = $('.btn-add-col', block);
  if (btnAddCol) {
    btnAddCol.onclick = (e) => {
      e.stopPropagation();
      const table = $('table', block);
      if (table) {
        const theadTr = table.querySelector('thead tr');
        if (theadTr) {
          const th = document.createElement('th');
          th.contentEditable = 'true';
          th.style.cssText = 'padding:8px 10px; border:1px solid rgba(255,255,255,0.2); outline:none; text-align:right;';
          th.textContent = `عمود ${theadTr.children.length + 1}`;
          theadTr.appendChild(th);
        }

        table.querySelectorAll('tbody tr').forEach(tr => {
          const td = document.createElement('td');
          td.contentEditable = 'true';
          td.style.cssText = 'padding:8px 10px; border:1px solid #cbd5e1; outline:none; text-align:right;';
          td.textContent = '-';
          tr.appendChild(td);
        });
        toastOk('تمت إضافة عمود جديد');
      }
    };
  }

  // Table Col Delete
  const btnDelCol = $('.btn-del-col', block);
  if (btnDelCol) {
    btnDelCol.onclick = (e) => {
      e.stopPropagation();
      const table = $('table', block);
      if (table) {
        const theadTr = table.querySelector('thead tr');
        if (theadTr && theadTr.children.length > 1) {
          theadTr.lastElementChild.remove();
          table.querySelectorAll('tbody tr').forEach(tr => {
            if (tr.lastElementChild) tr.lastElementChild.remove();
          });
          toastOk('تم حذف آخر عمود');
        } else {
          toastErr('يجب إبقاء عمود واحد على الأقل');
        }
      }
    };
  }

  // Table Zebra Striping Toggle
  const btnZebra = $('.btn-toggle-zebra', block);
  if (btnZebra) {
    btnZebra.onclick = (e) => {
      e.stopPropagation();
      const table = $('table', block);
      if (table) {
        const style = table.dataset.style === 'zebra' ? 'financial' : 'zebra';
        applyTableStyle(table, style);
        if (selectedTable === table) $('#sel-table-style', view).value = style;
        toastOk(style === 'zebra' ? 'تم تفعيل تظليل الصفوف المتبادل' : 'تم إيقاف تظليل الصفوف');
      }
    };
  }

  // Table Header Color Changer
  const inpTblCol = $('.inp-tbl-col', block);
  if (inpTblCol) {
    inpTblCol.oninput = (e) => {
      const headerRow = block.querySelector('thead tr');
      if (headerRow) {
        headerRow.style.backgroundColor = e.target.value;
      }
    };
  }
}

function applyTableStyle(table, style) {
  if (!table) return;
  table.dataset.style = style;
  table.style.border = style === 'minimal' ? 'none' : '1px solid #cbd5e1';
  const header = table.querySelector('thead tr');
  if (header) {
    header.style.backgroundColor = style === 'minimal' ? '#ffffff' : style === 'grid' ? '#e2e8f0' : docMeta.primary_color;
    header.style.color = style === 'minimal' ? docMeta.primary_color : style === 'grid' ? '#0f172a' : '#ffffff';
  }
  table.querySelectorAll('th, td').forEach(cell => {
    cell.style.border = style === 'minimal' ? 'none' : style === 'grid' ? '1px solid #94a3b8' : '1px solid #cbd5e1';
    if (style === 'minimal') cell.style.borderBottom = '1px solid #cbd5e1';
  });
  table.querySelectorAll('tbody tr').forEach((row, index) => {
    row.style.backgroundColor = style === 'zebra' && index % 2 ? '#edf6f8' : '#ffffff';
  });
}

// ─── Sheet Background & Watermark Applicator ──────────────────────────────

function applySheetBackground() {
  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return;

  // 1. Sheet background color
  canvas.style.backgroundColor = sheetBg.bgColor || '#ffffff';

  // 2. Page frame / border styling
  canvas.style.border = 'none';
  canvas.style.outline = 'none';

  if (sheetBg.frameStyle === 'classic') {
    canvas.style.border = `2px solid ${sheetBg.frameColor || '#cbd5e1'}`;
  } else if (sheetBg.frameStyle === 'double') {
    canvas.style.border = `4px double ${sheetBg.frameColor || docMeta.primary_color}`;
  } else if (sheetBg.frameStyle === 'gold') {
    canvas.style.border = '3px solid #d97706';
    canvas.style.outline = '1px solid #b45309';
    canvas.style.outlineOffset = '-6px';
  } else if (sheetBg.frameStyle === 'theme') {
    canvas.style.border = `3px solid ${docMeta.primary_color}`;
    canvas.style.borderTop = `12px solid ${docMeta.primary_color}`;
  }

  // 3. Watermark text overlay layer
  let wmEl = canvas.querySelector('.canvas-watermark-layer');
  if (sheetBg.watermarkText && sheetBg.watermarkText.trim()) {
    if (!wmEl) {
      wmEl = document.createElement('div');
      wmEl.className = 'canvas-watermark-layer';
      canvas.prepend(wmEl);
    }
    wmEl.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(${sheetBg.watermarkAngle}deg);
      font-size: 72px;
      font-weight: 900;
      color: ${sheetBg.watermarkColor || '#0f172a'};
      opacity: ${sheetBg.watermarkOpacity};
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      z-index: 0;
      letter-spacing: 4px;
      font-family: 'Cairo', Arial, sans-serif;
    `;
    wmEl.textContent = sheetBg.watermarkText;
  } else if (wmEl) {
    wmEl.remove();
  }

  // 4. Background letterhead image layer
  let bgImgEl = canvas.querySelector('.canvas-bg-image-layer');
  if (sheetBg.bgImage) {
    if (!bgImgEl) {
      bgImgEl = document.createElement('div');
      bgImgEl.className = 'canvas-bg-image-layer';
      canvas.prepend(bgImgEl);
    }
    let fitStyles = 'background-size: contain; background-position: center; background-repeat: no-repeat;';
    if (sheetBg.bgImageFit === 'cover') {
      fitStyles = 'background-size: cover; background-position: center; background-repeat: no-repeat;';
    } else if (sheetBg.bgImageFit === 'header') {
      fitStyles = 'background-size: 100% auto; background-position: top center; background-repeat: no-repeat;';
    }
    bgImgEl.style.cssText = `
      position: absolute;
      inset: 0;
      background-image: url("${sheetBg.bgImage}");
      ${fitStyles}
      opacity: ${sheetBg.bgImageOpacity};
      pointer-events: none;
      user-select: none;
      z-index: 0;
    `;
  } else if (bgImgEl) {
    bgImgEl.remove();
  }
}

// ─── Extract Clean HTML for Disk Saving & PDF Printing ─────────────────────

function serializeCanvasToCleanHTML() {
  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return '';

  const clone = canvas.cloneNode(true);

  // Remove editor UI controls
  $$('.block-controls', clone).forEach(c => c.remove());
  $$('.preset-section-controls', clone).forEach(c => c.remove());
  $$('.preset-tbl-controls', clone).forEach(c => c.remove());
  $$('.preset-section', clone).forEach(section => {
    section.classList.remove('preset-section', 'builder-moving', 'editor-block-selected');
    if (section.dataset.builderPositioned) {
      section.style.position = '';
      delete section.dataset.builderPositioned;
    }
  });
  $$('.preset-sub-shape', clone).forEach(el => {
    el.classList.remove('preset-sub-shape', 'editor-block-selected');
  });
  $$('.logo-actions', clone).forEach(c => c.remove());
  $$('.btn-sub-ctrl', clone).forEach(c => c.remove());
  $$('.builder-qr', clone).forEach(qr => {
    const value = qr.querySelector('.builder-qr-value');
    if (value?.textContent.trim() === '{{qr_code}}') {
      qr.querySelector('.builder-qr-preview')?.remove();
      value.style.display = '';
    } else value?.remove();
    qr.querySelector('.builder-qr-input')?.remove();
  });
  $$('.builder-barcode-input', clone).forEach(input => input.remove());

  // Remove contenteditable attributes
  $$('[contenteditable]', clone).forEach(el => el.removeAttribute('contenteditable'));

  // Clean internal class names and preserve bottom pinning
  $$('.editor-block', clone).forEach(el => {
    if (el.classList.contains('pinned-bottom') || el.dataset.blockType === 'totals' || el.dataset.blockType === 'signatures' || el.style.marginTop === 'auto') {
      el.style.marginTop = 'auto';
      el.style.marginBottom = '0';
    }
    el.removeAttribute('class');
    el.removeAttribute('data-block-type');
  });

  const innerHtml = clone.innerHTML;
  const extraStyles = presetStyles;

  // If this template has presetStyles (imported or AI generated), output clean HTML matching the original structure
  if (extraStyles && extraStyles.trim().length > 30) {
    const containerClasses = Array.from(canvas.classList).filter(c => c !== 'editor-a4-sheet' && c !== 'has-preset').join(' ') || 'invoice-container';
    const finalHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${esc(docMeta.name_ar)}</title>
<style>
${extraStyles}
</style>
</head>
<body>
  <div class="${containerClasses}" style="${canvas.style.cssText}">
    ${innerHtml}
  </div>
</body>
</html>`;
    return cleanStrayTableRowsAndFixTables(finalHtml);
  }

  // Frame styles for print export
  let frameCSS = '';
  if (sheetBg.frameStyle === 'classic') {
    frameCSS = `border: 2px solid ${sheetBg.frameColor || '#cbd5e1'};`;
  } else if (sheetBg.frameStyle === 'double') {
    frameCSS = `border: 4px double ${sheetBg.frameColor || docMeta.primary_color};`;
  } else if (sheetBg.frameStyle === 'gold') {
    frameCSS = `border: 3px solid #d97706; outline: 1px solid #b45309; outline-offset: -6px;`;
  } else if (sheetBg.frameStyle === 'theme') {
    frameCSS = `border: 3px solid ${docMeta.primary_color}; border-top: 12px solid ${docMeta.primary_color};`;
  }

  const finalHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${esc(docMeta.name_ar)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    display: flex;
    flex-direction: column;
    font-family: 'Cairo', Tahoma, Arial, sans-serif;
    font-size: 12px;
    color: #1e293b;
    background-color: ${sheetBg.bgColor || '#ffffff'};
    padding: 12px;
    direction: rtl;
    position: relative;
    min-height: 277mm;
    box-sizing: border-box;
    ${frameCSS}
  }
  table { border-collapse: collapse; }
  .sar-sym { display: inline-flex; align-items: center; vertical-align: middle; margin: 0 2px; }
  .sar-sym svg { width: 0.88em; height: 0.88em; fill: currentColor; }
  .canvas-watermark-layer {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(${sheetBg.watermarkAngle}deg);
    font-size: 72px;
    font-weight: 900;
    color: ${sheetBg.watermarkColor || '#0f172a'};
    opacity: ${sheetBg.watermarkOpacity};
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
    z-index: 0;
  }
  .canvas-bg-image-layer {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  @media print {
    body {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      padding: 0;
    }
  }
</style>
</head>
<body>
  ${innerHtml}
</body>
</html>`;
  return cleanStrayTableRowsAndFixTables(finalHtml);
}

// ─── Color Normalization & Theme Extraction Helpers ───────────────────────

function normalizeColorToHex(col) {
  if (!col) return '';
  col = String(col).trim();
  if (col.startsWith('#')) {
    if (col.length === 4) {
      return ('#' + col[1] + col[1] + col[2] + col[2] + col[3] + col[3]).toLowerCase();
    }
    return col.toLowerCase();
  }
  const rgbMatch = col.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`.toLowerCase();
  }
  return col.toLowerCase();
}

function detectPrimaryColorFromHTML(rawHtml, doc) {
  if (!rawHtml) return null;
  // 1. Check CSS variables
  const varMatch = rawHtml.match(/--(?:primary|primary-color|theme-color|brand-color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]+\))/i);
  if (varMatch) {
    const hex = normalizeColorToHex(varMatch[1]);
    if (hex && hex.startsWith('#')) return hex;
  }

  // 2. Check thead / th background
  const th = doc.querySelector('thead tr, th, .tbl-head-row, .grand-total, .doc-title-banner, .banner, .header');
  if (th) {
    const bg = th.style.backgroundColor || th.style.background || th.getAttribute('bgcolor');
    if (bg && !bg.includes('#fff') && !bg.includes('white') && !bg.includes('#000') && !bg.includes('transparent')) {
      const hex = normalizeColorToHex(bg);
      if (hex && hex.startsWith('#')) return hex;
    }
  }

  // 3. Check hex colors in style tags
  const hexes = rawHtml.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) || [];
  const candidateHexes = hexes.filter(h => {
    const lower = normalizeColorToHex(h);
    return lower !== '#fff' && lower !== '#ffffff' && lower !== '#000' && lower !== '#000000' &&
           lower !== '#f8fafc' && lower !== '#f1f5f9' && lower !== '#e2e8f0' && lower !== '#cbd5e1' &&
           lower !== '#94a3b8' && lower !== '#64748b' && lower !== '#475569' && lower !== '#334155' &&
           lower !== '#1e293b' && lower !== '#0f172a';
  });
  if (candidateHexes.length > 0) {
    const counts = {};
    candidateHexes.forEach(h => {
      const norm = normalizeColorToHex(h);
      counts[norm] = (counts[norm] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    if (sorted.length > 0) return sorted[0][0];
  }
  return null;
}

// ─── In-place Theme Color Applicator (Comprehensive Global Color Engine) ─────

function applyThemeColorInPlace(newColor) {
  const oldColor = docMeta.primary_color;
  docMeta.primary_color = newColor;

  const indicator = $('#theme-color-indicator', view);
  if (indicator) indicator.style.background = newColor;

  const inpCustom = $('#inp-custom-color', view);
  if (inpCustom) inpCustom.value = newColor;

  $$('.btn-palette-col', view).forEach(b => {
    b.style.border = (b.dataset.color.toLowerCase() === newColor.toLowerCase()) ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)';
  });

  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return;

  const oldHex = normalizeColorToHex(oldColor);
  const newHex = normalizeColorToHex(newColor);

  // 1. Set CSS custom properties on canvas container so all CSS variables update dynamically
  ['--primary', '--primary-color', '--theme-color', '--accent', '--accent-color', '--brand-color', '--header-bg'].forEach(v => {
    canvas.style.setProperty(v, newColor);
  });

  // 2. Update presetStyles and #preset-custom-style
  if (presetStyles && oldHex && oldHex !== newHex) {
    presetStyles = presetStyles.replace(new RegExp(oldHex, 'gi'), newHex);
    applyPresetStyles(presetStyles);
  }

  // 3. Update all inline styles, attributes, and SVGs across the entire canvas
  if (oldHex && oldHex !== newHex) {
    const regexOld = new RegExp(oldHex, 'gi');
    canvas.querySelectorAll('*').forEach(el => {
      const styleAttr = el.getAttribute('style');
      if (styleAttr && styleAttr.toLowerCase().includes(oldHex)) {
        el.setAttribute('style', styleAttr.replace(regexOld, newHex));
      }
      const fill = el.getAttribute('fill');
      if (fill && fill.toLowerCase() === oldHex) {
        el.setAttribute('fill', newHex);
      }
      const stroke = el.getAttribute('stroke');
      if (stroke && stroke.toLowerCase() === oldHex) {
        el.setAttribute('stroke', newHex);
      }
    });
  }

  // 4. Update default builder block classes if present
  $$('.tbl-head-row, thead.tbl-head-row tr', canvas).forEach(el => {
    el.style.backgroundColor = newColor;
  });

  $$('[data-block-type="header"] div[style*="font-size:22px"]', canvas).forEach(el => {
    el.style.color = newColor;
  });

  $$('[data-block-type="totals"] .totals-grand-row', canvas).forEach(el => {
    el.style.backgroundColor = newColor;
  });

  $$('[data-block-type="voucher_banner"]', canvas).forEach(el => {
    const banner = el.querySelector('div[style*="border:"]');
    if (banner) banner.style.borderColor = newColor;
    const num = el.querySelector('div[style*="font-size:28px"]');
    if (num) num.style.color = newColor;
  });

  $$('[data-block-type="textbox"]', canvas).forEach(el => {
    const box = el.querySelector('div[style*="border-right"]');
    if (box) box.style.borderRightColor = newColor;
  });

  $$('[data-block-type="divider"] hr', canvas).forEach(hr => {
    hr.style.borderTopColor = newColor;
  });

  // Border of main container if it was themed
  const mainCard = canvas.querySelector('.invoice-container, .voucher-card, .receipt-card, .invoice-card');
  if (mainCard && mainCard.style.borderColor) {
    mainCard.style.borderColor = newColor;
  }

  if (sheetBg.frameStyle === 'theme') {
    applySheetBackground();
  }
}

// ─── Insert HTML / Text at Cursor Position ────────────────────────────────

function insertHTMLAtCursor(htmlSnippet) {
  const sel = window.getSelection();
  if (sel.getRangeAt && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    let parent = range.commonAncestorContainer;
    if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentNode;
    const editable = parent.closest('[contenteditable="true"]');
    if (editable) {
      range.deleteContents();
      const temp = document.createElement('div');
      temp.innerHTML = htmlSnippet;
      const frag = document.createDocumentFragment();
      let node, lastNode;
      while ((node = temp.firstChild)) {
        lastNode = frag.appendChild(node);
      }
      range.insertNode(frag);
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.setEndAfter(lastNode);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      toastOk('تم إدراج العنصر في النص');
      return;
    }
  }

  // Fallback: append badge block
  const canvas = $('#editor-canvas-sheet', view);
  if (canvas) {
    const blk = createBlockElement(getSarBadgeBlockHTML(docMeta.primary_color), 'sar_badge');
    canvas.appendChild(blk);
    blk.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toastOk('تمت إضافة العنصر إلى ورقة العمل');
  }
}

function insertAtCursor(text) {
  const sel = window.getSelection();
  if (sel.getRangeAt && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    const canvas = $('#editor-canvas-sheet', view);
    if (canvas) {
      const p = document.createElement('div');
      p.contentEditable = 'true';
      p.textContent = text;
      canvas.appendChild(p);
    }
  }
}

// ─── Render View ───────────────────────────────────────────────────────────

function renderView() {
  if (!view) return;
  selectedBlock = null;
  selectedTable = null;

  view.innerHTML = `
    <!-- Hidden File Inputs -->
    <input type="file" id="global-img-uploader" accept="image/*" style="display:none;" />
    <input type="file" id="bg-img-uploader" accept="image/*" style="display:none;" />

    <div class="visual-doc-editor" style="display:flex; flex-direction:column; height:calc(100vh - 65px); min-height:600px; background:#0b1120; color:#f8fafc; overflow:hidden;">
      
      <!-- Top Action Bar (Header) -->
      <header style="background:#131c2e; border-bottom:1px solid #1e293b; padding:0.45rem 1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; z-index:30;">
        
        <!-- Branding & Core Controls -->
        <div class="builder-core-controls">
          <div id="theme-color-indicator" style="background:${docMeta.primary_color}; width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,0.4); flex-shrink:0;">
            R
          </div>
          <span style="font-weight:800; font-size:0.95rem; white-space:nowrap;">محرر ومصمم القوالب</span>
          
          <select id="sel-doc-type" style="padding:4px 8px; font-size:0.8rem; font-weight:700; background:#0f172a; color:#fff; border:1px solid #334155; border-radius:5px;">
            <option value="invoices" ${docMeta.type === 'invoices' ? 'selected' : ''}>قالب فاتورة ضريبية</option>
            <option value="documents" ${docMeta.type === 'documents' ? 'selected' : ''}>قالب سند مالي / قبض</option>
          </select>

          <select id="sel-preset-template" style="padding:4px 8px; font-size:0.8rem; font-weight:700; background:#0f172a; color:#38bdf8; border:1px solid #0284c7; border-radius:5px; cursor:pointer;" title="تحميل قالب جاهز ومعتمد للتعديل عليه">
            <option value="">قوالب جاهزة معتمدة ▾</option>
          </select>

          <input type="text" id="inp-doc-name" value="${esc(docMeta.name_ar)}" placeholder="اسم القالب..." style="padding:4px 10px; font-size:0.8rem; background:#0f172a; color:#fff; border:1px solid #334155; border-radius:5px;" />
        </div>

        <!-- Center: Quick Color Palette -->
        <div class="builder-palette-controls">
          <span style="font-size:0.75rem; color:#94a3b8; font-weight:700;">الثيم:</span>
          ${PALETTE.map(c => `
            <button type="button" class="btn-palette-col" data-color="${c}" style="width:17px; height:17px; border-radius:50%; background:${c}; border:${docMeta.primary_color === c ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)'}; cursor:pointer; padding:0; transition:transform 0.15s;" title="${c}"></button>
          `).join('')}
          <input type="color" id="inp-custom-color" value="${esc(docMeta.primary_color)}" style="width:22px; height:20px; border:none; cursor:pointer; background:transparent; padding:0;" title="لون مخصص" />
        </div>

        <!-- Right: Primary Actions -->
        <div class="builder-actions-row">
          <button type="button" class="btn btn-sm btn-open-ai-prompt" style="background:linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; border:none; font-size:0.8rem; font-weight:800; padding:5px 13px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 8px rgba(99,102,241,0.35); transition:transform 0.1s;" title="نسخ برومبت الذكاء الاصطناعي لإنشاء وتوليد القالب">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
            برومبت الذكاء الاصطناعي
          </button>
          <button type="button" id="btn-open-paste-modal" class="btn btn-sm" style="background:#0284c7; color:#fff; border:none; font-size:0.8rem; font-weight:800; padding:5px 13px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 8px rgba(2,132,199,0.35); transition:transform 0.1s;" title="لصق كود HTML مباشرة للتحكم في جميع أشكاله وتعديله">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            لصق كود HTML
          </button>
          <button type="button" class="btn btn-sm btn-clear-sheet" style="background:#1e293b; color:#94a3b8; border:1px solid #334155; font-size:0.78rem; padding:4px 10px;" title="إفراغ الصفحة للبدء من جديد">
            إفراغ
          </button>
          <button type="button" class="btn btn-sm btn-print-sheet" style="background:#1e293b; color:#fff; border:1px solid #334155; font-size:0.78rem; font-weight:700; padding:4px 12px; display:inline-flex; align-items:center; gap:4px;">
            طباعة ومعاينة
          </button>
          <button type="button" class="btn btn-sm btn-save-sheet" style="background:#059669; color:#fff; border:none; font-size:0.82rem; font-weight:700; padding:5px 16px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:6px;" ${saving ? 'disabled' : ''}>
            ${saving ? 'جاري الحفظ...' : 'حفظ القالب في النظام'}
          </button>
        </div>

      </header>

      <!-- Segmented Tab Nav (مرتبة ومنظمة في 3 أقسام رئيسية) -->
      <nav style="background:#182234; border-bottom:1px solid #1e293b; padding:0 1rem; display:flex; align-items:center; justify-content:space-between; gap:12px; z-index:25;">
        <div style="display:flex; align-items:center; gap:4px;">
          <button type="button" class="tab-btn ${activeTab === 'elements' ? 'active' : ''}" data-tab="elements">
            الجداول والعناصر
          </button>
          <button type="button" class="tab-btn ${activeTab === 'background' ? 'active' : ''}" data-tab="background">
            الخلفية وإطار الورقة
          </button>
          <button type="button" class="tab-btn ${activeTab === 'typography' ? 'active' : ''}" data-tab="typography">
            النصوص والتنسيق والوسوم
          </button>
        </div>
        <div style="font-size:0.72rem; color:#64748b;">
          انقر على أي نص أو خلية في الورقة لكتابة وتعديل ما تريده مباشرة
        </div>
      </nav>

      <!-- Tab Content 1: الجداول والعناصر (Tables & Document Blocks) -->
      <div id="tab-panel-elements" class="tab-panel" style="display:${activeTab === 'elements' ? 'flex' : 'none'}; background:#0f172a; border-bottom:1px solid #1e293b; padding:0.4rem 1rem; align-items:center; gap:6px; flex-wrap:wrap; font-size:0.75rem;">
        
        <!-- Quick Table Generator Modal Trigger -->
        <button type="button" id="btn-open-table-modal" class="btn-open-modal-tbl" style="background:#2563eb; border:1px solid #1d4ed8; color:#fff; font-weight:800; padding:4px 10px; border-radius:5px; font-size:0.74rem; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
          + إنشاء جدول مخصص...
        </button>

        <div style="width:1px; height:18px; background:#334155; margin:0 4px;"></div>

        <button type="button" class="btn-insert-blk" data-type="header">ترويسة وعنوان</button>
        <button type="button" class="btn-insert-blk" data-type="info_pills">كبسولات الفاتورة</button>
        <button type="button" class="btn-insert-blk" data-type="logo">شعار المنشأة</button>
        <button type="button" class="btn-insert-blk" data-type="buyer">بيانات العميل</button>
        <button type="button" class="btn-insert-blk" data-type="items_table">جدول الأصناف والأسعار (المالي)</button>
        <button type="button" class="btn-insert-blk" data-type="payments_table">جدول الدفعات والأقساط</button>
        <button type="button" class="btn-insert-blk" data-type="specs_table">جدول البنود والمواصفات</button>
        <button type="button" class="btn-insert-blk" data-type="totals">الإجماليات ورمز QR</button>
        <button type="button" class="btn-insert-blk" data-type="qr_code">رمز QR فقط</button>
        
        ${docMeta.type === 'documents' ? `
        <button type="button" class="btn-insert-blk" data-type="voucher_banner">شريط المبلغ</button>
        <button type="button" class="btn-insert-blk" data-type="voucher_fields">حقول السند</button>
        <button type="button" class="btn-insert-blk" data-type="signatures">التواقيع والختم</button>
        ` : ''}

        <button type="button" class="btn-insert-blk" data-type="textbox">شروط وملاحظات</button>
        <button type="button" class="btn-insert-blk" data-type="badge">شارة معتمدة</button>
        <button type="button" class="btn-insert-blk" data-type="divider">خط فاصل</button>
      </div>

      <!-- Tab Content 2: الخلفية وإطار الورقة (Sheet Background, Letterhead, Watermark & Frame) -->
      <div id="tab-panel-background" class="tab-panel" style="display:${activeTab === 'background' ? 'flex' : 'none'}; background:#0f172a; border-bottom:1px solid #1e293b; padding:0.4rem 1rem; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; font-size:0.75rem;">
        
        <!-- Section 1: Sheet Tint / Background Color -->
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="color:#38bdf8; font-weight:800;">لون الورقة:</span>
          <button type="button" class="btn-bg-tint" data-color="#ffffff" style="background:#ffffff; color:#0f172a;" title="أبيض ناصع">أبيض</button>
          <button type="button" class="btn-bg-tint" data-color="#fcfbf9" style="background:#fcfbf9; color:#0f172a;" title="عاجي مريح">عاجي</button>
          <button type="button" class="btn-bg-tint" data-color="#f8fafc" style="background:#f8fafc; color:#0f172a;" title="رمادي ناعم">رمادي</button>
          <button type="button" class="btn-bg-tint" data-color="#fbf8f2" style="background:#fbf8f2; color:#0f172a;" title="كريمي كلاسيكي">كريمي</button>
          <label style="display:inline-flex; align-items:center; gap:2px; background:#1e293b; padding:2px 6px; border-radius:4px; border:1px solid #334155; cursor:pointer;" title="لون خلفية مخصص">
            <span style="font-size:10px;">اللون</span>
            <input type="color" id="inp-sheet-bg-color" value="${esc(sheetBg.bgColor)}" style="width:16px; height:16px; border:none; background:transparent; cursor:pointer; padding:0;" />
          </label>
        </div>

        <div style="width:1px; height:20px; background:#334155;"></div>

        <!-- Section 2: Official Letterhead Image -->
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="color:#38bdf8; font-weight:800;">ورق رسمي (خلفية):</span>
          <button type="button" id="btn-upload-bg-img" class="btn-tag-chip" style="background:#0284c7; color:#fff; font-weight:700;">
            رفع صورة الورق الرسمي
          </button>
          <select id="sel-bg-img-fit" style="padding:2px 6px; font-size:0.75rem; background:#1e293b; color:#fff; border:1px solid #334155; border-radius:4px; cursor:pointer;" title="نمط ملء الورقة بالخلفية">
            <option value="contain" ${sheetBg.bgImageFit === 'contain' ? 'selected' : ''}>احتواء كامل</option>
            <option value="cover" ${sheetBg.bgImageFit === 'cover' ? 'selected' : ''}>تغطية ممدودة</option>
            <option value="header" ${sheetBg.bgImageFit === 'header' ? 'selected' : ''}>ترويسة علوية فقط</option>
          </select>
          <label style="display:inline-flex; align-items:center; gap:3px; color:#94a3b8;" title="درجة شفافية صورة الخلفية">
            <span>شفافية:</span>
            <input type="range" id="rng-bg-img-opacity" min="0.05" max="1" step="0.05" value="${sheetBg.bgImageOpacity}" style="width:65px; cursor:pointer;" />
          </label>
          <button type="button" id="btn-remove-bg-img" class="btn-tag-chip" style="background:#ef4444; color:#fff;" title="حذف صورة الخلفية" ${sheetBg.bgImage ? '' : 'hidden'}>حذف</button>
        </div>

        <div style="width:1px; height:20px; background:#334155;"></div>

        <!-- Section 3: Text Watermark (علامة مائية) -->
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="color:#38bdf8; font-weight:800;">علامة مائية:</span>
          <input type="text" id="inp-watermark-text" value="${esc(sheetBg.watermarkText)}" placeholder="مثال: مسودة / DRAFT..." style="padding:2px 8px; font-size:0.75rem; background:#1e293b; color:#fff; border:1px solid #334155; border-radius:4px; width:130px;" />
          
          <button type="button" class="btn-tag-chip btn-quick-wm" data-wm="مسودة">مسودة</button>
          <button type="button" class="btn-tag-chip btn-quick-wm" data-wm="DRAFT">DRAFT</button>
          <button type="button" class="btn-tag-chip btn-quick-wm" data-wm="معتمد">معتمد</button>
          <button type="button" class="btn-tag-chip btn-quick-wm" data-wm="" style="color:#ef4444;">إلغاء</button>
          
          <label style="display:inline-flex; align-items:center; gap:3px; color:#94a3b8;" title="شفافية العلامة المائية">
            <input type="range" id="rng-wm-opacity" min="0.02" max="0.30" step="0.02" value="${sheetBg.watermarkOpacity}" style="width:60px; cursor:pointer;" />
          </label>
        </div>

        <div style="width:1px; height:20px; background:#334155;"></div>

        <!-- Section 4: Frame / Border (إطار وبرواز الورقة) -->
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="color:#38bdf8; font-weight:800;">إطار الورقة:</span>
          <select id="sel-frame-style" style="padding:2px 6px; font-size:0.75rem; background:#1e293b; color:#fff; border:1px solid #334155; border-radius:4px; cursor:pointer;">
            <option value="none" ${sheetBg.frameStyle === 'none' ? 'selected' : ''}>بدون إطار</option>
            <option value="classic" ${sheetBg.frameStyle === 'classic' ? 'selected' : ''}>كلاسيكي رفيع</option>
            <option value="double" ${sheetBg.frameStyle === 'double' ? 'selected' : ''}>مزدوج فخم</option>
            <option value="gold" ${sheetBg.frameStyle === 'gold' ? 'selected' : ''}>ذهبي ملكي</option>
            <option value="theme" ${sheetBg.frameStyle === 'theme' ? 'selected' : ''}>إطار بلون الثيم</option>
          </select>
          <input type="color" id="inp-frame-color" value="${esc(sheetBg.frameColor)}" style="width:20px; height:18px; border:none; background:transparent; cursor:pointer; padding:0;" title="لون الإطار" />
        </div>

      </div>

      <!-- Tab Content 3: النصوص والتنسيق والوسوم (Typography & Tags) -->
      <div id="tab-panel-typography" class="tab-panel" style="display:${activeTab === 'typography' ? 'flex' : 'none'}; background:#0f172a; border-bottom:1px solid #1e293b; padding:0.4rem 1rem; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:0.75rem;">
        
        <!-- Text Styling -->
        <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
          <span style="color:#94a3b8; font-weight:700;">التنسيق:</span>
          <select id="sel-font-size" style="padding:2px 6px; font-size:0.75rem; background:#1e293b; color:#fff; border:1px solid #334155; border-radius:4px; cursor:pointer;">
            <option value="1">صغير جداً</option>
            <option value="2">صغير (11px)</option>
            <option value="3" selected>عادي (13px)</option>
            <option value="4">متوسط (15px)</option>
            <option value="5">عنوان فرعي (18px)</option>
            <option value="6">عنوان رئيسي (24px)</option>
          </select>

          <button type="button" class="btn-fmt" data-cmd="bold" title="عريض (Bold)" style="font-weight:900;">B</button>
          <button type="button" class="btn-fmt" data-cmd="italic" title="مائل (Italic)" style="font-style:italic;">I</button>
          <button type="button" class="btn-fmt" data-cmd="underline" title="تسطير (Underline)" style="text-decoration:underline;">U</button>
          <button type="button" class="btn-fmt" data-cmd="strikeThrough" title="شطب (Strikethrough)" style="text-decoration:line-through;">S</button>

          <div style="width:1px; height:18px; background:#334155; margin:0 3px;"></div>

          <label style="display:inline-flex; align-items:center; gap:2px; cursor:pointer; background:#1e293b; padding:2px 6px; border-radius:4px; border:1px solid #334155;" title="لون النص المحدد">
            <span style="font-weight:700; color:#cbd5e1;">A</span>
            <input type="color" id="inp-text-color" value="#1e293b" style="width:16px; height:16px; border:none; background:transparent; cursor:pointer; padding:0;" />
          </label>

          <label style="display:inline-flex; align-items:center; gap:2px; cursor:pointer; background:#1e293b; padding:2px 6px; border-radius:4px; border:1px solid #334155;" title="لون تمييز الخلفية">
            <span style="font-size:10px;font-weight:700;">BG</span>
            <input type="color" id="inp-bg-color" value="#fef08a" style="width:16px; height:16px; border:none; background:transparent; cursor:pointer; padding:0;" />
          </label>

          <div style="width:1px; height:18px; background:#334155; margin:0 3px;"></div>

          <button type="button" class="btn-fmt" data-cmd="justifyRight" title="محاذاة لليمين">≡→</button>
          <button type="button" class="btn-fmt" data-cmd="justifyCenter" title="توسيط">≡</button>
          <button type="button" class="btn-fmt" data-cmd="justifyLeft" title="محاذاة لليسار">←≡</button>
          <button type="button" class="btn-fmt" data-cmd="insertUnorderedList" title="قائمة نقطية">•≡</button>
          <button type="button" class="btn-fmt" data-cmd="insertOrderedList" title="قائمة مرقمة">1≡</button>
          <button type="button" class="btn-fmt" data-cmd="removeFormat" title="إزالة التنسيق">مسح التنسيق</button>
        </div>

        <!-- System Tags & SAR Symbol -->
        <div style="display:flex; align-items:center; gap:4px; overflow-x:auto; max-width:550px; padding:2px 0;">
          <button type="button" id="btn-insert-sar-symbol" class="btn-tag-chip" style="background:#059669; color:#fff; border-color:#059669; font-weight:800; display:inline-flex; align-items:center; gap:4px;" title="إدراج رمز الريال السعودي المعتمد">
            ${SAR_SYMBOL_SVG}
            <span>+ رمز الريال</span>
          </button>
          <span style="color:#64748b; font-weight:700; white-space:nowrap;">+ وسوم ذكية:</span>
          ${SYSTEM_TAGS.slice(0, 5).map(t => `
            <button type="button" class="btn-tag-chip" data-tag="${t.tag}" title="${t.tag}">${t.label}</button>
          `).join('')}
          <div class="dropdown-tags-wrapper" style="position:relative; display:inline-block;">
            <button type="button" id="btn-more-tags" class="btn-tag-chip" style="background:#334155; color:#fff;">المزيد ▾</button>
            <div id="dropdown-all-tags" style="display:none; position:absolute; top:100%; left:0; background:#1e293b; border:1px solid #475569; border-radius:6px; padding:6px; box-shadow:0 8px 20px rgba(0,0,0,0.5); z-index:100; min-width:210px;">
              ${SYSTEM_TAGS.map(t => `
                <div class="tag-opt-item" data-tag="${t.tag}" style="padding:4px 8px; font-size:11px; cursor:pointer; color:#e2e8f0; border-radius:4px; display:flex; justify-content:space-between;">
                  <span>${t.label}</span>
                  <code style="color:#38bdf8; font-size:10px;">${t.tag}</code>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

      </div>

      <!-- Main Canvas Workspace (Real A4 Sheet) -->
      <div class="builder-workspace" id="builder-workspace" style="flex:1; min-height:0; overflow:auto; padding:20px 8px; display:flex; justify-content:center; align-items:flex-start; background:#0b1120;">
        <div class="editor-a4-sheet" id="editor-canvas-sheet">
          <!-- Blocks and background layers populate here -->
        </div>
      </div>

      <div class="builder-bottom-bar">
        <span>حرّك العنصر بأزرار ▲ ▼ أو اسحب ⠿ إلى فراغ أسفل الورقة</span>
        <div class="builder-bottom-actions">
          <label for="sel-table-style">شكل الجدول</label>
          <select id="sel-table-style" disabled>
            <option value="financial">مالي</option><option value="zebra">صفوف متبادلة</option>
            <option value="grid">شبكة</option><option value="minimal">بسيط</option>
          </select>
          <button type="button" id="btn-copy-block" class="btn-tag-chip">نسخ العنصر</button>
          <button type="button" id="btn-paste-block" class="btn-tag-chip">لصق العنصر</button>
          <label for="inp-sel-el-bg" title="لون خلفية العنصر أو الخلية المحددة">خلفية العنصر</label>
          <input type="color" id="inp-sel-el-bg" value="#ffffff" disabled style="width:20px; height:20px; border:none; background:transparent; cursor:pointer; padding:0;" title="تغيير لون خلفية العنصر المحدد" />
          <label for="inp-sel-el-color" title="لون نص أو حدود العنصر المحدد">لون العنصر</label>
          <input type="color" id="inp-sel-el-color" value="#000000" disabled style="width:20px; height:20px; border:none; background:transparent; cursor:pointer; padding:0;" title="تغيير لون نص أو حدود العنصر المحدد" />
          <button type="button" id="btn-del-selected" class="btn-tag-chip" style="background:#dc2626; color:#fff;" disabled title="حذف العنصر المحدد">حذف المحدد</button>
          <label for="rng-block-scale">حجم العنصر</label>
          <input type="range" id="rng-block-scale" min="60" max="140" step="10" value="100" disabled />
          <output id="out-block-scale">100%</output>
          <label for="rng-builder-zoom">التكبير</label>
          <input type="range" id="rng-builder-zoom" min="25" max="150" step="5" value="100" />
          <output id="out-builder-zoom">100%</output>
          <button type="button" id="btn-builder-zoom-fit" class="btn-tag-chip" style="background:#0284c7; color:#fff; font-weight:700;">ملاءمة</button>
        </div>
      </div>

    </div>

    <!-- Custom Table Creation Modal (منشئ الجداول المخصص) -->
    <div id="modal-custom-table" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); backdrop-filter:blur(3px); z-index:1000; align-items:center; justify-content:center; padding:16px;">
      <div style="background:#1e293b; border:1px solid #334155; border-radius:8px; width:450px; max-width:95vw; box-shadow:0 20px 40px rgba(0,0,0,0.6); color:#fff; overflow:hidden;">
        <div style="background:#0f172a; padding:12px 18px; border-bottom:1px solid #334155; display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:15px; font-weight:800; display:flex; align-items:center; gap:6px;">
            إنشاء جدول مخصص
          </h3>
          <button type="button" id="btn-close-table-modal" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">&times;</button>
        </div>
        <div style="padding:18px; display:flex; flex-direction:column; gap:14px; font-size:13px;">
          <div>
            <label style="display:block; margin-bottom:4px; font-weight:700; color:#94a3b8;">عنوان الجدول:</label>
            <input type="text" id="inp-modal-tbl-title" value="جدول البيانات والمواصفات" style="width:100%; padding:6px 10px; background:#0f172a; border:1px solid #334155; border-radius:4px; color:#fff;" />
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label style="display:block; margin-bottom:4px; font-weight:700; color:#94a3b8;">عدد الأعمدة (Columns):</label>
              <input type="number" id="inp-modal-tbl-cols" value="4" min="1" max="10" style="width:100%; padding:6px 10px; background:#0f172a; border:1px solid #334155; border-radius:4px; color:#fff;" />
            </div>
            <div>
              <label style="display:block; margin-bottom:4px; font-weight:700; color:#94a3b8;">عدد الصفوف الأولية (Rows):</label>
              <input type="number" id="inp-modal-tbl-rows" value="3" min="1" max="20" style="width:100%; padding:6px 10px; background:#0f172a; border:1px solid #334155; border-radius:4px; color:#fff;" />
            </div>
          </div>
          <div>
            <label style="display:block; margin-bottom:4px; font-weight:700; color:#94a3b8;">نمط تصميم الجدول:</label>
            <select id="sel-modal-tbl-style" style="width:100%; padding:6px 10px; background:#0f172a; border:1px solid #334155; border-radius:4px; color:#fff;">
              <option value="financial">كلاسيكي مالي (ترويسة بلون الثيم)</option>
              <option value="zebra">مخطط متبادل (Zebra Striped Rows)</option>
              <option value="grid">شبكة حدود كاملة (Full Grid)</option>
              <option value="minimal">حديث بسيط (Minimalist)</option>
            </select>
          </div>
        </div>
        <div style="background:#0f172a; padding:12px 18px; border-top:1px solid #334155; display:flex; justify-content:flex-end; gap:8px;">
          <button type="button" id="btn-cancel-table-modal" style="background:#334155; color:#cbd5e1; border:none; padding:6px 14px; border-radius:4px; cursor:pointer; font-size:12px;">إلغاء</button>
          <button type="button" id="btn-confirm-add-table" style="background:#2563eb; color:#fff; border:none; padding:6px 18px; border-radius:4px; cursor:pointer; font-weight:700; font-size:12px;">إدراج الجدول في الصفحة</button>
        </div>
      </div>
    </div>

    <!-- Direct HTML Code Paste & Import Modal -->
    <div id="modal-paste-html" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.72); backdrop-filter:blur(4px); z-index:1000; align-items:center; justify-content:center; padding:16px;">
      <div style="background:#111a2e; border:1px solid #233554; border-radius:10px; width:720px; max-width:96vw; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,0.7); color:#f1f5f9; overflow:hidden;">
        <div style="background:#0b1322; padding:14px 18px; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:15px; font-weight:800; display:flex; align-items:center; gap:8px; color:#38bdf8;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            لصق واستيراد كود HTML (دعم كافة الأشكال والتصاميم)
          </h3>
          <button type="button" id="btn-close-paste-modal" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">&times;</button>
        </div>
        <div style="padding:16px 20px; display:flex; flex-direction:column; gap:12px; font-size:13px; overflow-y:auto; flex:1;">
          <div style="background:#0f172a; border:1px solid #1e293b; border-radius:6px; padding:8px 12px; font-size:12px; color:#94a3b8; line-height:1.6;">
            الصق كود HTML كامل (يشمل &lt;style&gt; أو &lt;div&gt;). سيقوم النظام بتفعيل التحكم الكامل: التحريك، السحب، تكبير/تصغير كل شكل، تعديل النصوص مباشرة، وإدارة صفوف وأعمدة الجداول.
          </div>
          <div>
            <label style="display:block; margin-bottom:4px; font-weight:700; color:#cbd5e1;">اسم القالب المستورد:</label>
            <input type="text" id="inp-paste-tpl-name" placeholder="مثال: فاتورة ضريبية حديثة أو سند مالي..." style="width:100%; padding:7px 10px; background:#070d18; border:1px solid #334155; border-radius:5px; color:#fff;" />
          </div>
          <div>
            <label style="display:block; margin-bottom:4px; font-weight:700; color:#cbd5e1;">كود HTML للقالب:</label>
            <textarea id="txt-paste-html-code" placeholder="<!DOCTYPE html> أو <div class=...>" style="width:100%; height:240px; background:#060a12; border:1px solid #334155; border-radius:6px; color:#38bdf8; padding:10px; font-size:12px; font-family:monospace; resize:vertical; outline:none; line-height:1.5;"></textarea>
          </div>
        </div>
        <div style="background:#0b1322; padding:12px 20px; border-top:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center;">
          <button type="button" id="btn-cancel-paste-modal" style="background:#1e293b; color:#cbd5e1; border:1px solid #334155; padding:6px 14px; border-radius:5px; cursor:pointer; font-size:12px;">إلغاء</button>
          <button type="button" id="btn-confirm-import-code" style="background:linear-gradient(135deg, #0284c7, #0369a1); color:#fff; border:none; padding:8px 22px; border-radius:6px; cursor:pointer; font-weight:800; font-size:13px; display:inline-flex; align-items:center; gap:6px; box-shadow:0 4px 12px rgba(2,132,199,0.35);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            تطبيق واستيراد في المصمم
          </button>
        </div>
      </div>
    </div>

    <style>
      .builder-core-controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
      .builder-core-controls #sel-doc-type { width: 180px; }
      .builder-core-controls #sel-preset-template { width: 210px; }
      .builder-core-controls #inp-doc-name { width: 150px; }
      .builder-palette-controls { display:flex; align-items:center; gap:5px; }
      .builder-actions-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .builder-bottom-bar { flex:none; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding:8px 16px; background:#131c2e; border-top:1px solid #334155; font-size:0.75rem; color:#94a3b8; }
      .builder-bottom-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
      .builder-bottom-actions select { width:auto; padding:4px 8px; background:#0f172a; color:#fff; border:1px solid #475569; border-radius:5px; }
      #rng-builder-zoom, #rng-block-scale { width:80px; }

      @media (max-width: 860px) {
        .visual-doc-editor {
          height: auto !important;
          min-height: calc(100vh - 65px);
        }
        .visual-doc-editor > header {
          padding: 0.5rem 0.6rem !important;
          flex-direction: column;
          align-items: stretch !important;
          gap: 8px !important;
        }
        .builder-core-controls {
          width: 100%;
          gap: 6px;
        }
        .builder-core-controls #sel-doc-type,
        .builder-core-controls #sel-preset-template,
        .builder-core-controls #inp-doc-name {
          width: 100% !important;
          max-width: 100% !important;
          flex: 1 1 100% !important;
        }
        .builder-palette-controls {
          justify-content: center;
          padding: 3px 0;
          width: 100%;
        }
        .builder-actions-row {
          width: 100%;
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .builder-actions-row .btn {
          flex: 1 1 calc(50% - 4px);
          font-size: 0.74rem !important;
          padding: 5px 8px !important;
          text-align: center;
          justify-content: center;
        }
        .builder-actions-row .btn-save-sheet {
          flex: 1 1 100% !important;
          font-size: 0.84rem !important;
          padding: 8px 12px !important;
        }
        .visual-doc-editor > nav {
          padding: 0 0.4rem;
          overflow-x: auto;
          flex-wrap: nowrap;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .visual-doc-editor > nav::-webkit-scrollbar {
          display: none;
        }
        .visual-doc-editor > nav > div:last-child {
          display: none;
        }
        .tab-btn {
          padding: 6px 10px;
          font-size: 0.76rem;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .builder-workspace {
          padding: 12px 6px !important;
        }
        .builder-bottom-bar {
          padding: 6px 8px;
          font-size: 0.7rem;
        }
        .builder-bottom-bar > span {
          display: none;
        }
        .builder-bottom-actions {
          width: 100%;
          justify-content: space-between;
          gap: 4px;
        }
        #rng-builder-zoom, #rng-block-scale {
          width: 55px;
        }
      }
      .visual-doc-editor > header, .visual-doc-editor > nav, .visual-doc-editor > .tab-panel { flex-shrink:0; }
      .editor-block-selected { outline:2px solid #38bdf8 !important; outline-offset:3px; }
      .btn-drag { cursor:grab; }
      .btn-drag, .preset-drag { touch-action:none; cursor:grab; }
      .builder-moving { opacity:.65; }
      .preset-section { position: relative; transition: outline 0.12s; border-radius: 4px; }
      .preset-section:hover { outline: 1px dashed rgba(56, 189, 248, 0.45); }
      .preset-section.editor-block-selected { outline: 2px solid #0284c7 !important; outline-offset: 2px; }
      .preset-sub-shape { position: relative; transition: outline 0.12s; border-radius: 4px; cursor: pointer; }
      .preset-sub-shape:hover { outline: 1px dashed rgba(14, 165, 233, 0.45); }
      .preset-sub-shape.editor-block-selected { outline: 2px solid #0284c7 !important; outline-offset: 2px; }
      .preset-section:hover > .preset-section-controls,
      .preset-section:focus-within > .preset-section-controls { display:flex; }
      .preset-section > .preset-section-controls {
        position: absolute; top: -14px; left: 8px; z-index: 60; display: none;
        gap: 3px; background: #0f172a; padding: 2px 6px; border-radius: 5px;
        border: 1px solid #334155; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
      .preset-section:hover > .preset-tbl-controls,
      .preset-section:focus-within > .preset-tbl-controls { display:flex !important; }
      .preset-tbl-controls {
        position: absolute; top: -14px; right: 8px; z-index: 60; display: none;
        gap: 3px; background: #0f172a; padding: 2px 6px; border-radius: 5px;
        border: 1px solid #334155; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
      .preset-tbl-controls button {
        padding: 2px 6px; font-size: 10px; background: #1e293b; color: #fff;
        border: 1px solid #475569; border-radius: 3px; cursor: pointer;
      }
      .preset-tbl-controls button:hover { background: #2563eb; }
      .tab-btn {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: #94a3b8;
        padding: 8px 14px;
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
      }
      .tab-btn:hover {
        color: #f1f5f9;
        background: rgba(255,255,255,0.02);
      }
      .tab-btn.active {
        color: #38bdf8;
        border-bottom-color: #38bdf8;
        background: rgba(56, 189, 248, 0.06);
      }
      .btn-bg-tint {
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid #cbd5e1;
        font-size: 0.72rem;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.1s;
      }
      .btn-bg-tint:hover {
        transform: scale(1.05);
      }
      .btn-fmt {
        background: #1e293b;
        border: 1px solid #334155;
        color: #f8fafc;
        width: 26px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.78rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }
      .btn-fmt:hover {
        background: #334155;
      }
      .btn-tag-chip {
        background: rgba(255,255,255,0.06);
        border: 1px solid #334155;
        color: #cbd5e1;
        padding: 2px 7px;
        border-radius: 4px;
        font-size: 0.7rem;
        white-space: nowrap;
        cursor: pointer;
        transition: all 0.15s;
      }
      .btn-tag-chip:hover {
        background: #0284c7;
        color: #fff;
        border-color: #0284c7;
      }
      .btn-insert-blk {
        background: rgba(255,255,255,0.06);
        border: 1px solid #334155;
        color: #f1f5f9;
        padding: 4px 9px;
        border-radius: 5px;
        font-size: 0.73rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .btn-insert-blk:hover {
        background: ${docMeta.primary_color};
        border-color: ${docMeta.primary_color};
        color: #fff;
        transform: translateY(-1px);
      }
      .tag-opt-item:hover {
        background: #334155;
      }

      /* ── A4 Sheet Styling ── */
      .editor-a4-sheet {
        display: flex;
        flex-direction: column;
        width: 210mm;
        min-height: 297mm;
        background: #ffffff;
        color: #1e293b;
        box-shadow: 0 16px 45px rgba(0,0,0,0.7);
        border-radius: 4px;
        padding: 16mm 14mm;
        position: relative;
        direction: rtl;
        font-family: 'Cairo', Tahoma, Arial, sans-serif;
        font-size: 13px;
        box-sizing: border-box;
        overflow: hidden;
        margin: 0 auto;
        flex-shrink: 0;
        transform-origin: top center;
      }
      .editor-a4-sheet.has-preset,
      .editor-a4-sheet.invoice-container,
      .editor-a4-sheet[class*="container"],
      .editor-a4-sheet[class*="card"] {
        padding: unset;
        overflow: visible;
        background: #ffffff;
        box-shadow: 0 16px 45px rgba(0,0,0,0.7);
      }
      .editor-block {
        position: relative;
        z-index: 1;
        border: 1px dashed transparent;
        transition: border 0.15s;
        margin-bottom: 8px;
        width: 100%;
        box-sizing: border-box;
      }
      .editor-block.pinned-bottom,
      .editor-block[data-block-type="totals"],
      .editor-block[data-block-type="signatures"] {
        margin-top: auto !important;
        margin-bottom: 0 !important;
      }
      .editor-block:hover {
        border-color: rgba(5, 150, 105, 0.4);
      }
      .block-controls {
        position: absolute;
        top: -12px;
        left: 4px;
        display: none;
        gap: 3px;
        z-index: 100;
        background: #1e293b;
        padding: 2px 4px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      .editor-block:hover .block-controls {
        display: flex;
      }
      .btn-ctrl {
        background: #334155;
        color: #fff;
        border: none;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        cursor: pointer;
      }
      .btn-ctrl:hover {
        background: #475569;
      }
      .btn-ctrl.btn-del-blk {
        background: #ef4444;
      }
      .btn-ctrl.btn-del-blk:hover {
        background: #dc2626;
      }

      .btn-sub-ctrl {
        font-size: 10px;
        background: #1e293b;
        color: #f1f5f9;
        border: 1px solid #475569;
        padding: 2px 6px;
        border-radius: 3px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .btn-sub-ctrl:hover {
        background: #334155;
      }

      [contenteditable]:hover {
        outline: 1px dashed #cbd5e1 !important;
      }
      [contenteditable]:focus {
        outline: 2px solid ${docMeta.primary_color} !important;
        background: rgba(5, 150, 105, 0.04);
      }

      @media print {
        .editor-a4-sheet { zoom:1 !important; }
        body * { visibility: hidden !important; }
        .editor-a4-sheet, .editor-a4-sheet * { visibility: visible !important; }
        .block-controls, .logo-actions, .btn-sub-ctrl { display: none !important; }
        .editor-a4-sheet {
          position: absolute;
          left: 0;
          top: 0;
          width: 100% !important;
          margin: 0 !important;
          box-shadow: none !important;
          padding: 10mm !important;
        }
      }
    </style>
  `;

  // Populate default blocks
  populateInitialBlocks();

  // Apply background initial state
  applySheetBackground();

  // Attach event handlers
  attachAppEvents();
}

// ─── Populate Initial Starter Blocks ───────────────────────────────────────

function populateInitialBlocks() {
  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return;

  canvas.innerHTML = '';
  const col = docMeta.primary_color;

  if (docMeta.type === 'documents') {
    canvas.appendChild(createBlockElement(getHeaderBlockHTML(col), 'header'));
    canvas.appendChild(createBlockElement(getImageBlockHTML(), 'logo'));
    canvas.appendChild(createBlockElement(getVoucherBannerBlockHTML(col), 'voucher_banner'));
    canvas.appendChild(createBlockElement(getVoucherFieldsBlockHTML(), 'voucher_fields'));
    const sig = createBlockElement(getSignaturesBlockHTML(), 'signatures');
    sig.classList.add('pinned-bottom');
    sig.style.marginTop = 'auto';
    canvas.appendChild(sig);
  } else {
    canvas.appendChild(createBlockElement(getHeaderBlockHTML(col), 'header'));
    canvas.appendChild(createBlockElement(getInfoPillsBlockHTML(col), 'info_pills'));
    canvas.appendChild(createBlockElement(getBuyerBlockHTML(col), 'buyer'));
    canvas.appendChild(createBlockElement(getItemsTableBlockHTML(col), 'items_table'));
    const totals = createBlockElement(getTotalsBlockHTML(col), 'totals');
    totals.classList.add('pinned-bottom');
    totals.style.marginTop = 'auto';
    canvas.appendChild(totals);
  }
}

// ─── Presets Dropdown & Template Loader ─────────────────────────────────────

async function loadPresetsDropdown() {
  const selPreset = $('#sel-preset-template', view);
  if (!selPreset) return;
  try {
    const list = await api.get('/api/invoices/templates?type=' + (docMeta.type || 'all'));
    if (Array.isArray(list) && list.length > 0) {
      selPreset.innerHTML = '<option value="">قوالب جاهزة معتمدة ▾</option>' +
        list.map(t => `<option value="${t.id}" data-color="${t.color_hex || ''}" data-name="${esc(t.name_ar)}">${esc(t.name_ar)} (${t.badge || 'معتمد'})</option>`).join('');
    }
  } catch (e) {
    console.warn('Could not load template presets:', e);
  }
}

function applyPresetStyles(styles) {
  presetStyles = styles || '';
  let customStyleTag = $('#preset-custom-style', view);
  if (!customStyleTag) {
    customStyleTag = document.createElement('style');
    customStyleTag.id = 'preset-custom-style';
    view.appendChild(customStyleTag);
  }
  const clean = presetStyles.replace(/@page\s*\{[^}]*\}/g, '');
  
  // If the imported styles contain container classes (.invoice-container, .voucher-card, etc.),
  // map body/html to #builder-workspace, and map the container class directly to #editor-canvas-sheet!
  const hasInvoiceContainer = /\.invoice-container\b/i.test(clean);
  const hasVoucherCard = /\.voucher-card\b/i.test(clean);
  const hasReceiptCard = /\.receipt-card\b/i.test(clean);
  const hasDocCard = /\.doc-card\b/i.test(clean);

  let scoped = clean;
  if (hasInvoiceContainer || hasVoucherCard || hasReceiptCard || hasDocCard) {
    scoped = scoped
      .replace(/(^|[\s,;{}])body\b/gi, '$1#builder-workspace')
      .replace(/(^|[\s,;{}])html\b/gi, '$1#builder-workspace');
    if (hasInvoiceContainer) {
      scoped = scoped.replace(/\.invoice-container\b/g, '#editor-canvas-sheet');
    }
    if (hasVoucherCard) {
      scoped = scoped.replace(/\.voucher-card\b/g, '#editor-canvas-sheet');
    }
    if (hasReceiptCard) {
      scoped = scoped.replace(/\.receipt-card\b/g, '#editor-canvas-sheet');
    }
    if (hasDocCard) {
      scoped = scoped.replace(/\.doc-card\b/g, '#editor-canvas-sheet');
    }
  } else {
    scoped = scoped
      .replace(/(^|[\s,;{}])body\b/gi, '$1#editor-canvas-sheet')
      .replace(/(^|[\s,;{}])html\b/gi, '$1#editor-canvas-sheet');
  }

  // Also bind :root variables to #editor-canvas-sheet so variables cascade properly
  scoped = scoped.replace(/:root\b/g, ':root, #editor-canvas-sheet');

  customStyleTag.textContent = scoped;
}

function attachPresetSectionDrag() {
  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return;

  const root = canvas;

  // Enhance Barcode elements in imported templates with click-to-edit
  canvas.querySelectorAll('.barcode, .builder-barcode, .barcode-wrap, [class*="barcode"], [id*="barcode"]').forEach(bc => {
    bc.style.cursor = 'pointer';
    bc.title = 'انقر لتعديل قيمة الباركود أو نوعه';
    bc.onclick = (e) => {
      e.stopPropagation();
      selectBlock(bc);
      const currentVal = bc.textContent.trim().replace(/\*/g, '') || 'PRD-01';
      const newVal = prompt('أدخل قيمة الباركود الجديدة (Code 39):', currentVal);
      if (newVal !== null && newVal.trim().length > 0) {
        try {
          const cleanVal = newVal.trim().toUpperCase();
          bc.innerHTML = `
            <div class="builder-barcode-preview">${code39Svg(cleanVal)}</div>
            <small class="builder-barcode-label" style="display:block; text-align:center;">${cleanVal}</small>
          `;
          toastOk('تم تحديث الباركود');
        } catch (err) {
          toastErr(err.message || 'خطأ في توليد الباركود');
        }
      }
    };
  });

  // Enhance QR code elements in imported templates with click-to-edit
  canvas.querySelectorAll('.qr-code, .qr-container, .builder-qr, [class*="qr"], [id*="qr"]').forEach(qr => {
    qr.style.cursor = 'pointer';
    qr.title = 'انقر لتعديل محتوى رمز QR';
    qr.onclick = (e) => {
      e.stopPropagation();
      selectBlock(qr);
      const newVal = prompt('أدخل محتوى أو رابط رمز الاستجابة السريعة QR (أو اتركه {{qr_code}} للربط التلقائي):', '{{qr_code}}');
      if (newVal !== null) {
        try {
          const cleanVal = newVal.trim() || '{{qr_code}}';
          qr.innerHTML = cleanVal === '{{qr_code}}'
            ? '<div style="width:90px; height:90px; display:flex; align-items:center; justify-content:center; font-family:\'Segoe UI\', Arial, sans-serif; font-weight:900; font-size:26px; color:#1e293b; border:1.5px dashed #cbd5e1; border-radius:6px; background:#f8fafc; letter-spacing:1px;">QR</div>'
            : qrSvg(cleanVal, { scale: 3, margin: 1 });
          toastOk('تم تحديث رمز QR');
        } catch {
          toastErr('محتوى QR طويل أو غير صالح');
        }
      }
    };
  });

  // Make inner cards and tables selectable for color and style adjustments
  canvas.querySelectorAll('.card, .box, .panel, .kpi-card, .party-box, .info-pill, .badge, table').forEach(sub => {
    sub.onclick = (ev) => {
      ev.stopPropagation();
      selectBlock(sub, sub.matches('table') ? sub : sub.querySelector('table'));
    };
  });

    const sections = [...root.children].filter(el =>
      el instanceof HTMLElement &&
      !el.matches('script, style') &&
      !el.classList.contains('canvas-watermark-layer') &&
      !el.classList.contains('canvas-bg-image-layer') &&
      getComputedStyle(el).position !== 'absolute'
    );

    sections.forEach(section => {
      section.classList.add('preset-section');
      if (getComputedStyle(section).position === 'static') {
        section.dataset.builderPositioned = 'true';
        section.style.position = 'relative';
      }

      // Make section or its sub-shapes selectable on click to enable scale slider and inspector
      section.onclick = (e) => {
        e.stopPropagation();
        const targetSub = e.target.closest('.preset-sub-shape, table, .card, .box, .panel, .kpi-card, .party-box, .info-pill, .badge, .qr-container, .builder-qr');
        if (targetSub && targetSub !== section && section.contains(targetSub)) {
          selectBlock(targetSub, targetSub.matches('table') ? targetSub : targetSub.querySelector('table'));
        } else {
          selectBlock(section, section.matches('table') ? section : section.querySelector('table'));
        }
      };

      // Detect and equip sub-shapes inside grids or flex rows (e.g. 2 cards, 3 KPI boxes, badge containers)
      const subShapes = section.querySelectorAll('.card, .box, .panel, .kpi-card, .party-box, .info-pill, .badge, .qr-container, .builder-qr, [class*="card"], [class*="box"], [class*="col-"]');
      subShapes.forEach(sub => {
        if (sub.matches('.preset-section-controls, .preset-tbl-controls, .block-controls, [contenteditable="true"]')) return;
        sub.classList.add('preset-sub-shape');
        sub.onclick = (ev) => {
          ev.stopPropagation();
          selectBlock(sub, sub.matches('table') ? sub : sub.querySelector('table'));
        };
      });

      // Add section move & edit controls pill
      let controls = section.querySelector(':scope > .preset-section-controls');
      if (!controls) {
        controls = document.createElement('div');
        controls.className = 'block-controls preset-section-controls';
        controls.contentEditable = 'false';
        controls.innerHTML = `
          <button type="button" class="btn-ctrl preset-up" title="نقل القسم لأعلى">▲</button>
          <button type="button" class="btn-ctrl preset-down" title="نقل القسم لأسفل">▼</button>
          <button type="button" class="btn-ctrl preset-bottom" title="وضع القسم أسفل الورقة">⬇</button>
          <button type="button" class="btn-ctrl preset-drag" title="اسحب لترتيب القسم">⠿</button>
          <button type="button" class="btn-ctrl preset-dup" title="تكرار ونسخ">⧉</button>
          <button type="button" class="btn-ctrl preset-del" title="حذف">&times;</button>
        `;
        section.appendChild(controls);
      }

      controls.querySelector('.preset-up').onclick = (e) => {
        e.stopPropagation();
        let prev = section.previousElementSibling;
        while (prev && !prev.matches('.preset-section')) prev = prev.previousElementSibling;
        if (prev) {
          root.insertBefore(section, prev);
          selectBlock(section);
          toastOk('تم نقل القسم لأعلى');
        }
      };

      controls.querySelector('.preset-down').onclick = (e) => {
        e.stopPropagation();
        let next = section.nextElementSibling;
        while (next && !next.matches('.preset-section')) next = next.nextElementSibling;
        if (next) {
          root.insertBefore(next, section);
          selectBlock(section);
          toastOk('تم نقل القسم لأسفل');
        }
      };

      const btnBottom = controls.querySelector('.preset-bottom');
      if (btnBottom) {
        btnBottom.onclick = (e) => {
          e.stopPropagation();
          const gap = parseFloat(getComputedStyle(section).marginTop) || 0;
          section.style.marginTop = `${gap + bottomRoom(section, '.preset-section')}px`;
          toastOk('تم نقل القسم لأسفل الصفحة');
        };
      }

      controls.querySelector('.preset-dup').onclick = (e) => {
        e.stopPropagation();
        const clone = section.cloneNode(true);
        clone.querySelectorAll('.preset-section-controls, .preset-tbl-controls').forEach(c => c.remove());
        section.after(clone);
        attachPresetSectionDrag();
        selectBlock(clone);
        toastOk('تم تكرار ونسخ القسم');
      };

      controls.querySelector('.preset-del').onclick = (e) => {
        e.stopPropagation();
        section.remove();
        selectBlock(null);
        toastOk('تم حذف القسم');
      };

      bindMoveHandle(controls.querySelector('.preset-drag'), section, '.preset-section');

      // If the section is or contains a table, equip it with granular table controls
      const tbl = section.matches('table') ? section : section.querySelector('table');
      if (tbl) {
        let tblControls = section.querySelector(':scope > .preset-tbl-controls');
        if (!tblControls) {
          tblControls = document.createElement('div');
          tblControls.className = 'preset-tbl-controls';
          tblControls.contentEditable = 'false';
          tblControls.innerHTML = `
            <button type="button" class="btn-sub-ctrl tbl-add-row" title="إضافة صف جديد">+ صف</button>
            <button type="button" class="btn-sub-ctrl tbl-del-row" title="حذف آخر صف">- صف</button>
            <button type="button" class="btn-sub-ctrl tbl-add-col" title="إضافة عمود">+ عمود</button>
            <button type="button" class="btn-sub-ctrl tbl-del-col" title="حذف آخر عمود">- عمود</button>
            <button type="button" class="btn-sub-ctrl tbl-zebra" title="تبديل تظليل الصفوف">تظليل</button>
          `;
          section.appendChild(tblControls);

          tblControls.querySelector('.tbl-add-row').onclick = (ev) => {
            ev.stopPropagation();
            const tbody = tbl.querySelector('tbody') || tbl;
            const lastRow = tbody.lastElementChild;
            if (lastRow) {
              const newRow = lastRow.cloneNode(true);
              newRow.querySelectorAll('td').forEach((td, idx) => {
                td.contentEditable = 'true';
                if (idx === 0 && !isNaN(parseInt(td.textContent.trim()))) {
                  td.textContent = String(tbody.children.length + 1);
                } else if (idx === 1 && td.textContent.trim().startsWith('PRD-')) {
                  td.textContent = `PRD-0${tbody.children.length + 1}`;
                }
              });
              tbody.appendChild(newRow);
              toastOk('تمت إضافة صف جديد للجدول');
            }
          };

          tblControls.querySelector('.tbl-del-row').onclick = (ev) => {
            ev.stopPropagation();
            const tbody = tbl.querySelector('tbody') || tbl;
            if (tbody.children.length > 1) {
              tbody.lastElementChild.remove();
              toastOk('تم حذف آخر صف');
            } else {
              toastErr('يجب إبقاء صف واحد على الأقل');
            }
          };

          tblControls.querySelector('.tbl-add-col').onclick = (ev) => {
            ev.stopPropagation();
            const theadTr = tbl.querySelector('thead tr') || tbl.querySelector('tr');
            if (theadTr) {
              const th = document.createElement('th');
              th.contentEditable = 'true';
              th.style.cssText = 'padding:6px 8px; border:1px solid #cbd5e1; outline:none; text-align:right; font-weight:bold;';
              th.textContent = 'عمود جديد';
              theadTr.appendChild(th);
            }
            tbl.querySelectorAll('tbody tr').forEach(tr => {
              const td = document.createElement('td');
              td.contentEditable = 'true';
              td.style.cssText = 'padding:6px 8px; border:1px solid #cbd5e1; outline:none; text-align:right;';
              td.textContent = '-';
              tr.appendChild(td);
            });
            toastOk('تمت إضافة عمود جديد');
          };

          tblControls.querySelector('.tbl-del-col').onclick = (ev) => {
            ev.stopPropagation();
            const theadTr = tbl.querySelector('thead tr') || tbl.querySelector('tr');
            if (theadTr && theadTr.children.length > 1) {
              theadTr.lastElementChild.remove();
              tbl.querySelectorAll('tbody tr').forEach(tr => {
                if (tr.lastElementChild) tr.lastElementChild.remove();
              });
              toastOk('تم حذف آخر عمود');
            } else {
              toastErr('يجب إبقاء عمود واحد على الأقل');
            }
          };

          tblControls.querySelector('.tbl-zebra').onclick = (ev) => {
            ev.stopPropagation();
            const style = tbl.dataset.style === 'zebra' ? 'financial' : 'zebra';
            applyTableStyle(tbl, style);
            toastOk(style === 'zebra' ? 'تم تفعيل التظليل المتبادل' : 'تم إلغاء التظليل');
          };
        }
      }
    });
}

function loadRawHtmlIntoCanvas(rawHtml, tplName) {
  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return;

  rawHtml = cleanStrayTableRowsAndFixTables(rawHtml);

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  applyPresetStyles(Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n'));

  // Detect and synchronize primary theme color from imported template
  const detectedCol = detectPrimaryColorFromHTML(rawHtml, doc);
  if (detectedCol) {
    docMeta.primary_color = detectedCol;
    const indicator = $('#theme-color-indicator', view);
    if (indicator) indicator.style.background = detectedCol;
    const inpCustom = $('#inp-custom-color', view);
    if (inpCustom) inpCustom.value = detectedCol;
    $$('.btn-palette-col', view).forEach(b => {
      b.style.border = (b.dataset.color.toLowerCase() === detectedCol.toLowerCase()) ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)';
    });
  }

  // Extract body inner content or main container
  const container = doc.querySelector('.invoice-container') ||
                    doc.querySelector('.voucher-card') ||
                    doc.querySelector('.receipt-card') ||
                    doc.querySelector('.invoice-card') ||
                    doc.querySelector('.invoice-box') ||
                    doc.querySelector('.doc-card') ||
                    doc.querySelector('.receipt-container') ||
                    doc.querySelector('.bill-container');

  if (container) {
    canvas.className = 'editor-a4-sheet has-preset ' + (container.className || '');
    canvas.style.cssText = container.style.cssText;
    canvas.style.width = '210mm';
    canvas.style.minHeight = '297mm';
    canvas.style.position = 'relative';
    canvas.style.boxSizing = 'border-box';
    canvas.style.margin = '0 auto';
    canvas.style.zoom = '100%';
    canvas.innerHTML = container.innerHTML;
  } else {
    canvas.className = 'editor-a4-sheet has-preset';
    canvas.style.cssText = doc.body.style.cssText;
    canvas.style.width = '210mm';
    canvas.style.minHeight = '297mm';
    canvas.style.position = 'relative';
    canvas.style.boxSizing = 'border-box';
    canvas.style.margin = '0 auto';
    canvas.style.zoom = '100%';
    canvas.innerHTML = doc.body.innerHTML;
  }

  // Ensure block zoom is reset to 100%
  const rngBlock = $('#rng-block-scale', view);
  if (rngBlock) {
    rngBlock.value = 100;
    rngBlock.disabled = true;
    $('#out-block-scale', view).textContent = '100%';
  }

  selectBlock(null);

  // Make ALL text elements directly editable across all shapes & components
  canvas.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, td, th, strong, b, small, label, div, a, li, blockquote, .num, .ar-title, .en-title, .party-val, .kpi-val, .info-value, .meta-val, .amount-value, .statement-value').forEach(el => {
    if (!el.querySelector('div, table, section, header, footer, ul, ol') && el.textContent.trim().length > 0) {
      el.contentEditable = 'true';
      el.setAttribute('spellcheck', 'false');
      el.style.outline = 'none';
    }
  });

  attachPresetSectionDrag();

  if (tplName) {
    const cleanName = tplName.replace(/\(.*?\)/g, '').trim();
    docMeta.name_ar = cleanName;
    const inpName = $('#inp-doc-name', view);
    if (inpName) inpName.value = cleanName;
  }

  // Re-apply background overlay
  applySheetBackground();

  toastOk('تم استيراد القالب وتفعيل التحكم الكامل بالألوان، الأقسام، الباركود، والـ QR!');
}

function restoreEditorContent(content) {
  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return;
  canvas.innerHTML = content;
  if (canvas.querySelector('.invoice-container, .voucher-card')) canvas.style.padding = '0';
  $$('.editor-block', canvas).forEach(attachBlockControls);
  attachPresetSectionDrag();
  applySheetBackground();
}

// ─── Attach Application Events ─────────────────────────────────────────────

function attachAppEvents() {
  if (!view) return;

  const canvas = $('#editor-canvas-sheet', view);

  $('.btn-open-ai-prompt', view)?.addEventListener('click', () => {
    openAiPromptModal({
      defaultType: docMeta.type
    });
  });

  const pasteModal = $('#modal-paste-html', view);
  $('#btn-open-paste-modal', view)?.addEventListener('click', () => {
    if (pasteModal) {
      pasteModal.style.display = 'flex';
      const txt = $('#txt-paste-html-code', pasteModal);
      if (txt) {
        txt.value = '';
        txt.focus();
      }
      const inp = $('#inp-paste-tpl-name', pasteModal);
      if (inp) inp.value = docMeta.name_ar || '';
    }
  });

  $('#btn-close-paste-modal', view)?.addEventListener('click', () => {
    if (pasteModal) pasteModal.style.display = 'none';
  });
  $('#btn-cancel-paste-modal', view)?.addEventListener('click', () => {
    if (pasteModal) pasteModal.style.display = 'none';
  });

  $('#btn-confirm-import-code', view)?.addEventListener('click', () => {
    const txt = $('#txt-paste-html-code', view);
    const htmlCode = txt?.value.trim();
    if (!htmlCode) return toastErr('يرجى لصق كود HTML أولاً');
    const inp = $('#inp-paste-tpl-name', view);
    const customName = inp?.value.trim() || 'قالب مستورد مخصص';
    loadRawHtmlIntoCanvas(htmlCode, customName);
    if (pasteModal) pasteModal.style.display = 'none';
  });

  $('#sel-table-style', view)?.addEventListener('change', (e) => {
    applyTableStyle(selectedTable, e.target.value);
  });
  $('#btn-copy-block', view)?.addEventListener('click', () => {
    if (!selectedBlock) return toastErr('حدد عنصراً أولاً');
    copiedBlock = selectedBlock.cloneNode(true);
    toastOk('تم نسخ العنصر');
  });
  $('#btn-paste-block', view)?.addEventListener('click', () => {
    if (!copiedBlock) return toastErr('انسخ عنصراً أولاً');
    const clone = copiedBlock.cloneNode(true);
    attachBlockControls(clone);
    if (selectedBlock?.isConnected) selectedBlock.after(clone);
    else canvas.appendChild(clone);
    attachPresetSectionDrag();
    selectBlock(clone);
    clone.scrollIntoView({ block: 'nearest' });
  });
  function applyBuilderZoom(zp) {
    zoomPercent = Math.max(20, Math.min(150, zp));
    if (canvas) {
      canvas.style.zoom = `${zoomPercent}%`;
    }
    const rng = $('#rng-builder-zoom', view);
    const out = $('#out-builder-zoom', view);
    if (rng) rng.value = zoomPercent;
    if (out) out.textContent = `${zoomPercent}%`;
  }

  function fitBuilderZoom() {
    const ws = $('#builder-workspace', view) || $('.builder-workspace', view);
    if (!ws || ws.clientWidth < 60) return;
    const availableW = ws.clientWidth - 20;
    const targetW = 794;
    let scale = Math.min(1.15, Math.max(0.24, Math.round((availableW / targetW) * 96) / 100));
    if (availableW >= 860) {
      scale = 1.0;
    }
    applyBuilderZoom(Math.round(scale * 100));
  }

  $('#rng-builder-zoom', view)?.addEventListener('input', (e) => {
    applyBuilderZoom(Number(e.target.value));
  });
  $('#btn-builder-zoom-fit', view)?.addEventListener('click', fitBuilderZoom);
  window.addEventListener('resize', fitBuilderZoom);
  setTimeout(fitBuilderZoom, 60);

  $('#rng-block-scale', view)?.addEventListener('input', (e) => {
    if (!selectedBlock) return;
    selectedBlock.style.zoom = `${e.target.value}%`;
    $('#out-block-scale', view).textContent = `${e.target.value}%`;
  });
  view.onkeydown = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = e.key.toLowerCase();
    if (key === 'c' && selectedBlock) {
      copiedBlock = selectedBlock.cloneNode(true);
      e.preventDefault();
    } else if (key === 'v' && copiedBlock) {
      $('#btn-paste-block', view).click();
      e.preventDefault();
    }
  };

  // Tab Switching
  $$('.tab-btn', view).forEach(btn => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      activeTab = tab;
      $$('.tab-btn', view).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      $$('.tab-panel', view).forEach(p => p.style.display = 'none');
      const targetPanel = $(`#tab-panel-${tab}`, view);
      if (targetPanel) targetPanel.style.display = 'flex';
    };
  });

  // Load presets from backend
  loadPresetsDropdown();

  // Preset Template Selection Handler
  const selPreset = $('#sel-preset-template', view);
  if (selPreset) {
    selPreset.onchange = async () => {
      const opt = selPreset.selectedOptions[0];
      const tplId = selPreset.value;
      if (!tplId) return;

      if (canvas.children.length > 0 && !confirm('هل تريد استبدال محتوى صفحة التصميم بالقالب المختار؟')) {
        selPreset.value = '';
        return;
      }

      try {
        const rawHtml = await api.text('/api/invoices/templates/' + tplId + '/render-html');
        if (rawHtml) {
          loadRawHtmlIntoCanvas(rawHtml, opt?.dataset?.name || opt?.textContent);
        }
      } catch (err) {
        toastErr('تعذر تحميل القالب: ' + (err.message || 'خطأ في الاتصال'));
      }
    };
  }

  // Type change
  const selType = $('#sel-doc-type', view);
  if (selType) {
    selType.onchange = () => {
      if (confirm('تغيير نوع القالب سيبدأ بتصميم أساسي مناسب للنوع المختار، هل تريد المتابعة؟')) {
        docMeta.type = selType.value;
        docMeta.name_ar = docMeta.type === 'invoices' ? 'قالب فواتير مخصص' : 'قالب سند مالي مخصص';
        renderView();
      } else {
        selType.value = docMeta.type;
      }
    };
  }

  // Name change
  const inpName = $('#inp-doc-name', view);
  if (inpName) {
    inpName.oninput = () => {
      docMeta.name_ar = inpName.value;
    };
  }

  // Selected element background and text color inputs
  $('#inp-sel-el-bg', view)?.addEventListener('input', (e) => {
    if (!selectedBlock) return;
    selectedBlock.style.backgroundColor = e.target.value;
  });

  $('#inp-sel-el-color', view)?.addEventListener('input', (e) => {
    if (!selectedBlock) return;
    selectedBlock.style.color = e.target.value;
    if (selectedBlock.style.borderColor) selectedBlock.style.borderColor = e.target.value;
    selectedBlock.querySelectorAll('svg, path').forEach(s => s.setAttribute('fill', e.target.value));
  });

  $('#btn-del-selected', view)?.addEventListener('click', () => {
    if (!selectedBlock || selectedBlock.id === 'editor-canvas-sheet') return;
    const target = selectedBlock;
    selectBlock(null);
    target.remove();
    toastOk('تم حذف العنصر المحدد');
  });

  // Global canvas element selection
  canvas?.addEventListener('click', (e) => {
    if (e.target.closest('.block-controls, .btn-sub-ctrl, .preset-tbl-controls, .logo-actions')) return;
    const target = e.target.closest('.preset-sub-shape, .preset-section, table, th, td, .card, .box, .panel, .kpi-card, .party-box, .info-pill, .badge, .qr-container, .builder-qr, .barcode, .builder-barcode, .editor-block') || e.target;
    if (target && target !== canvas) {
      selectBlock(target, target.matches('table') ? target : target.querySelector('table'));
    }
  });

  // Theme color palette buttons
  $$('.btn-palette-col', view).forEach(btn => {
    btn.onclick = () => {
      const col = btn.dataset.color;
      applyThemeColorInPlace(col);
      toastOk('تم تطبيق لون الثيم على القالب');
    };
  });

  const inpCustomColor = $('#inp-custom-color', view);
  if (inpCustomColor) {
    inpCustomColor.oninput = () => {
      applyThemeColorInPlace(inpCustomColor.value);
    };
  }

  // ── Sheet Background Event Handlers ──

  // Sheet Tint presets
  $$('.btn-bg-tint', view).forEach(btn => {
    btn.onclick = () => {
      sheetBg.bgColor = btn.dataset.color;
      const inpBg = $('#inp-sheet-bg-color', view);
      if (inpBg) inpBg.value = sheetBg.bgColor;
      applySheetBackground();
      toastOk('تم تغيير لون خلفية الورقة');
    };
  });

  const inpSheetBg = $('#inp-sheet-bg-color', view);
  if (inpSheetBg) {
    inpSheetBg.oninput = () => {
      sheetBg.bgColor = inpSheetBg.value;
      applySheetBackground();
    };
  }

  // Background Letterhead Image Upload
  const btnUploadBgImg = $('#btn-upload-bg-img', view);
  const bgImgInput = $('#bg-img-uploader', view);
  if (btnUploadBgImg && bgImgInput) {
    btnUploadBgImg.onclick = () => bgImgInput.click();
    bgImgInput.onchange = (ev) => {
      const file = ev.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          sheetBg.bgImage = re.target.result;
          applySheetBackground();
          $('#btn-remove-bg-img', view)?.removeAttribute('hidden');
          toastOk('تم تحميل صورة الورق الرسمي للخلفية');
        };
        reader.readAsDataURL(file);
      }
    };
  }

  const selBgImgFit = $('#sel-bg-img-fit', view);
  if (selBgImgFit) {
    selBgImgFit.onchange = () => {
      sheetBg.bgImageFit = selBgImgFit.value;
      applySheetBackground();
    };
  }

  const rngBgImgOpacity = $('#rng-bg-img-opacity', view);
  if (rngBgImgOpacity) {
    rngBgImgOpacity.oninput = () => {
      sheetBg.bgImageOpacity = parseFloat(rngBgImgOpacity.value);
      applySheetBackground();
    };
  }

  const btnRemoveBgImg = $('#btn-remove-bg-img', view);
  if (btnRemoveBgImg) {
    btnRemoveBgImg.onclick = () => {
      sheetBg.bgImage = '';
      applySheetBackground();
      const removeButton = $('#btn-remove-bg-img', view);
      if (removeButton) removeButton.hidden = true;
      toastOk('تمت إزالة صورة الخلفية');
    };
  }

  // Watermark handlers
  const inpWatermark = $('#inp-watermark-text', view);
  if (inpWatermark) {
    inpWatermark.oninput = () => {
      sheetBg.watermarkText = inpWatermark.value;
      applySheetBackground();
    };
  }

  $$('.btn-quick-wm', view).forEach(btn => {
    btn.onclick = () => {
      sheetBg.watermarkText = btn.dataset.wm;
      if (inpWatermark) inpWatermark.value = sheetBg.watermarkText;
      applySheetBackground();
      toastOk(sheetBg.watermarkText ? `تم ضبط العلامة المائية: ${sheetBg.watermarkText}` : 'تمت إزالة العلامة المائية');
    };
  });

  const rngWmOpacity = $('#rng-wm-opacity', view);
  if (rngWmOpacity) {
    rngWmOpacity.oninput = () => {
      sheetBg.watermarkOpacity = parseFloat(rngWmOpacity.value);
      applySheetBackground();
    };
  }

  // Frame / Border handlers
  const selFrame = $('#sel-frame-style', view);
  if (selFrame) {
    selFrame.onchange = () => {
      sheetBg.frameStyle = selFrame.value;
      applySheetBackground();
      toastOk('تم تحديث إطار الورقة');
    };
  }

  const inpFrameColor = $('#inp-frame-color', view);
  if (inpFrameColor) {
    inpFrameColor.oninput = () => {
      sheetBg.frameColor = inpFrameColor.value;
      applySheetBackground();
    };
  }

  // ── Custom Table Modal Handlers ──

  const modalTbl = $('#modal-custom-table', view);
  const btnOpenTblModal = $('#btn-open-table-modal', view);
  const btnCloseTblModal = $('#btn-close-table-modal', view);
  const btnCancelTblModal = $('#btn-cancel-table-modal', view);
  const btnConfirmAddTbl = $('#btn-confirm-add-table', view);

  if (btnOpenTblModal && modalTbl) {
    btnOpenTblModal.onclick = () => {
      modalTbl.style.display = 'flex';
    };
  }

  const hideTblModal = () => {
    if (modalTbl) modalTbl.style.display = 'none';
  };

  if (btnCloseTblModal) btnCloseTblModal.onclick = hideTblModal;
  if (btnCancelTblModal) btnCancelTblModal.onclick = hideTblModal;

  if (btnConfirmAddTbl) {
    btnConfirmAddTbl.onclick = () => {
      const title = $('#inp-modal-tbl-title', view)?.value || 'جدول مخصص';
      const cols = parseInt($('#inp-modal-tbl-cols', view)?.value || '4');
      const rows = parseInt($('#inp-modal-tbl-rows', view)?.value || '2');
      const style = $('#sel-modal-tbl-style', view)?.value || 'financial';

      const tableHTML = generateCustomTableHTML({
        title,
        cols: Math.max(1, Math.min(cols, 10)),
        rows: Math.max(1, Math.min(rows, 30)),
        style,
        color: docMeta.primary_color
      });

      const newBlock = createBlockElement(tableHTML, 'custom_table');
      if (canvas && newBlock) {
        canvas.appendChild(newBlock);
        newBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        toastOk('تم إنشاء وإدراج الجدول بنجاح');
      }
      hideTblModal();
    };
  }

  // ── Text Formatting Commands ──

  $$('.btn-fmt', view).forEach(btn => {
    btn.onmousedown = (e) => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      document.execCommand(cmd, false, null);
    };
  });

  const selFontSize = $('#sel-font-size', view);
  if (selFontSize) {
    selFontSize.onchange = () => {
      document.execCommand('fontSize', false, selFontSize.value);
    };
  }

  const inpTextColor = $('#inp-text-color', view);
  if (inpTextColor) {
    inpTextColor.oninput = () => {
      document.execCommand('foreColor', false, inpTextColor.value);
    };
  }

  const inpBgColor = $('#inp-bg-color', view);
  if (inpBgColor) {
    inpBgColor.oninput = () => {
      document.execCommand('hiliteColor', false, inpBgColor.value);
    };
  }

  // Insert SAR Symbol Button
  const btnSar = $('#btn-insert-sar-symbol', view);
  if (btnSar) {
    btnSar.onclick = (e) => {
      e.preventDefault();
      insertHTMLAtCursor(SAR_SYMBOL_SVG);
    };
  }

  // Tag Chips insertion
  $$('.btn-tag-chip', view).forEach(chip => {
    chip.onclick = () => {
      const tag = chip.dataset.tag;
      if (tag) {
        insertAtCursor(tag);
        toastOk('تم إدراج الوسم ' + tag);
      }
    };
  });

  // Dropdown more tags toggle
  const btnMoreTags = $('#btn-more-tags', view);
  const dropTags = $('#dropdown-all-tags', view);
  if (btnMoreTags && dropTags) {
    btnMoreTags.onclick = (e) => {
      e.stopPropagation();
      dropTags.style.display = dropTags.style.display === 'none' ? 'block' : 'none';
    };
    document.addEventListener('click', () => {
      if (dropTags) dropTags.style.display = 'none';
    });
  }

  $$('.tag-opt-item', view).forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      const tag = item.dataset.tag;
      if (tag) {
        insertAtCursor(tag);
        if (dropTags) dropTags.style.display = 'none';
        toastOk('تم إدراج الوسم ' + tag);
      }
    };
  });

  // Insert Blocks onto Canvas
  $$('.btn-insert-blk[data-type]', view).forEach(btn => {
    btn.onclick = () => {
      const type = btn.dataset.type;
      const col = docMeta.primary_color;
      let newBlock = null;

      switch (type) {
        case 'header':
          newBlock = createBlockElement(getHeaderBlockHTML(col), 'header');
          break;
        case 'info_pills':
          newBlock = createBlockElement(getInfoPillsBlockHTML(col), 'info_pills');
          break;
        case 'logo':
          newBlock = createBlockElement(getImageBlockHTML(), 'logo');
          break;
        case 'buyer':
          newBlock = createBlockElement(getBuyerBlockHTML(col), 'buyer');
          break;
        case 'items_table':
          newBlock = createBlockElement(getItemsTableBlockHTML(col), 'items_table');
          break;
        case 'payments_table':
          newBlock = createBlockElement(generateCustomTableHTML({
            title: 'جدول الدفعات والأقساط المستحقة',
            cols: 5,
            rows: 3,
            headers: ['رقم الدفعة', 'تاريخ الاستحقاق', 'المبلغ المستحق', 'طريقة الدفع', 'حالة السداد'],
            color: col
          }), 'payments_table');
          break;
        case 'specs_table':
          newBlock = createBlockElement(generateCustomTableHTML({
            title: 'جدول البنود والمواصفات الفنية',
            cols: 4,
            rows: 3,
            headers: ['#', 'البند المطلوب', 'المواصفات والتفاصيل الفنية', 'ملاحظات الاعتماد'],
            style: 'zebra',
            color: col
          }), 'specs_table');
          break;
        case 'totals':
          newBlock = createBlockElement(getTotalsBlockHTML(col), 'totals');
          break;
        case 'sar_badge':
          newBlock = createBlockElement(getSarBadgeBlockHTML(col), 'sar_badge');
          break;
        case 'qr_code':
          newBlock = createBlockElement(getQrBlockHTML(), 'qr_code');
          break;
        case 'barcode':
          newBlock = createBlockElement(getBarcodeBlockHTML(), 'barcode');
          break;
        case 'voucher_banner':
          newBlock = createBlockElement(getVoucherBannerBlockHTML(col), 'voucher_banner');
          break;
        case 'voucher_fields':
          newBlock = createBlockElement(getVoucherFieldsBlockHTML(), 'voucher_fields');
          break;
        case 'textbox':
          newBlock = createBlockElement(getTextboxBlockHTML(col), 'textbox');
          break;
        case 'signatures':
          newBlock = createBlockElement(getSignaturesBlockHTML(), 'signatures');
          break;
        case 'badge':
          newBlock = createBlockElement(getBadgeBlockHTML(col), 'badge');
          break;
        case 'divider':
          newBlock = createBlockElement(getDividerBlockHTML(col), 'divider');
          break;
      }

      if (newBlock && canvas) {
        canvas.appendChild(newBlock);
        selectBlock(newBlock);
        newBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        toastOk('تمت إضافة العنصر إلى المستند');
      }
    };
  });

  // Clear sheet
  const btnClear = $('.btn-clear-sheet', view);
  if (btnClear) {
    btnClear.onclick = () => {
      if (confirm('هل تريد إفراغ ورقة العمل بالكامل للبدء من صفحة بيضاء؟')) {
        if (canvas) {
          canvas.innerHTML = '';
          canvas.style.padding = '';
        }
        selectBlock(null);
        applySheetBackground();
        toastOk('تم إفراغ الصفحة');
      }
    };
  }

  // Print sheet
  const btnPrint = $('.btn-print-sheet', view);
  if (btnPrint) {
    btnPrint.onclick = () => {
      window.print();
    };
  }

  // Save sheet to database and disk as clean HTML
  const btnSave = $('.btn-save-sheet', view);
  if (btnSave) {
    btnSave.onclick = async () => {
      const inpDocName = $('#inp-doc-name', view);
      if (inpDocName && inpDocName.value && inpDocName.value.trim()) {
        docMeta.name_ar = inpDocName.value.trim();
      }

      if (!docMeta.name_ar || !docMeta.name_ar.trim()) {
        toastErr('يرجى كتابة اسم للقالب أولاً');
        inpDocName?.focus();
        return;
      }

      const chosenName = docMeta.name_ar.trim();
      saving = true;
      btnSave.disabled = true;
      btnSave.textContent = 'جاري الحفظ...';

      try {
        const generatedHTML = serializeCanvasToCleanHTML();
        const payload = {
          id: editingId || undefined,
          type: docMeta.type,
          category: docMeta.type,
          name_ar: chosenName,
          primary_color: docMeta.primary_color,
          html_content: generatedHTML,
          editor_content: canvas.innerHTML,
          preset_styles: presetStyles,
          bg_config: sheetBg
        };

        const res = await api.post('/api/templates/builder', payload);
        if (res?.id) {
          editingId = res.id;
        }

        toastOk(`تم حفظ القالب «${chosenName}» بنجاح في النظام وملفات القوالب!`);
      } catch (err) {
        toastErr('فشل حفظ القالب: ' + (err.message || 'خطأ غير متوقع'));
      } finally {
        saving = false;
        btnSave.disabled = false;
        btnSave.innerHTML = 'حفظ القالب في النظام';
      }
    };
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────

export async function render(container) {
  view = container;
  document.querySelector('head #preset-custom-style')?.remove();
  editingId = null;
  saving = false;
  presetStyles = '';
  selectedBlock = null;
  selectedTable = null;
  copiedBlock = null;
  zoomPercent = 100;
  activeTab = 'elements';
  docMeta = {
    type: 'invoices',
    name_ar: 'قالب فواتير مخصص',
    primary_color: '#1a2638',
  };
  sheetBg = {
    bgColor: '#ffffff',
    watermarkText: '',
    watermarkOpacity: 0.07,
    watermarkAngle: -35,
    watermarkColor: '#0f172a',
    bgImage: '',
    bgImageOpacity: 0.15,
    bgImageFit: 'contain',
    frameStyle: 'none',
    frameColor: '#cbd5e1'
  };

  const aiHtml = sessionStorage.getItem('raseen_imported_ai_html');
  const aiType = sessionStorage.getItem('raseen_imported_ai_type');
  if (aiHtml) {
    sessionStorage.removeItem('raseen_imported_ai_html');
    sessionStorage.removeItem('raseen_imported_ai_type');
    docMeta.type = aiType || 'invoices';
    docMeta.name_ar = aiType === 'documents' ? 'سند مالي بالذكاء الاصطناعي' : 'فاتورة بالذكاء الاصطناعي';
    renderView();
    loadRawHtmlIntoCanvas(aiHtml, docMeta.name_ar);
    return;
  }

  const requestedId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('id');
  if (requestedId) {
    try {
      const response = await api.get('/api/templates/builder/' + encodeURIComponent(requestedId));
      const config = response.builder_config || response;
      const htmlToLoad = config.html_content || config.editor_content;
      if (htmlToLoad) {
        editingId = requestedId;
        docMeta = { type: config.type || config.category || 'invoices', name_ar: config.name_ar || 'قالب مخصص', primary_color: config.primary_color || '#1a2638' };
        if (config.bg_config) sheetBg = { ...sheetBg, ...config.bg_config };
        renderView();
        loadRawHtmlIntoCanvas(htmlToLoad, docMeta.name_ar);
        if (config.preset_styles) applyPresetStyles(config.preset_styles);
        return;
      }
    } catch (err) {
      toastErr('تعذر فتح القالب: ' + (err.message || 'خطأ غير متوقع'));
    }
  }
  renderView();
}
