// ==========================================================================
//  Raseen — محرر ومصمم القوالب المرئي المباشر الحقيقي (True WYSIWYG Document Editor)
//  يتيح تنظيم كامل، إدراج وتخصيص أي جداول، والتحكم الشامل في خلفية وإطار القوالب
// ==========================================================================
import { api } from '../core/api.js';
import { toastOk, toastErr, $, $$, esc } from '../core/util.js';

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
  { label: 'تاريخ الاستحقاق', tag: '{{due_date}}' },
  { label: 'اسم العميل', tag: '{{buyer_name}}' },
  { label: 'الرقم الضريبي للعميل', tag: '{{buyer_tax}}' },
  { label: 'سجل العميل', tag: '{{buyer_cr}}' },
  { label: 'عنوان العميل', tag: '{{buyer_address}}' },
  { label: 'هاتف العميل', tag: '{{buyer_phone}}' },
  { label: 'المجموع قبل الضريبة', tag: '{{subtotal}}' },
  { label: 'الخصم', tag: '{{discount}}' },
  { label: 'مبلغ الضريبة 15%', tag: '{{tax_amount}}' },
  { label: 'المبلغ الإجمالي', tag: '{{grand_total}}' },
  { label: 'طريقة الدفع', tag: '{{payment_method}}' },
  { label: 'ملاحظات / شروط', tag: '{{notes}}' },
  { label: 'رمز التحقق QR', tag: '{{qr_code}}' },
  { label: 'رمز الريال السعودي', tag: '{{currency_symbol}}' },
  { label: 'رمز الريال SVG', tag: '{{sar_symbol}}' },
];

let view = null;
let editingId = null;
let saving = false;
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
  wrapper.innerHTML = `
    <div class="block-controls" contenteditable="false">
      <button type="button" class="btn-ctrl btn-move-up" title="نقل لأعلى">▲</button>
      <button type="button" class="btn-ctrl btn-move-down" title="نقل لأسفل">▼</button>
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
          <td style="width:140px; font-weight:700; padding:6px 12px; background:#f8fafc; color:#475569;">السجل التجاري:</td>
          <td contenteditable="true" style="padding:6px 12px; color:#334155; outline:none;">{{buyer_cr}}</td>
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
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left;">1,000.00 ${SAR_SYMBOL_SVG}</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left; color:#dc2626;">0.00</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left;">150.00 ${SAR_SYMBOL_SVG}</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:left; font-weight:800; color:#0f172a;">1,150.00 ${SAR_SYMBOL_SVG}</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:center; font-weight:700;">2</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:center; color:#64748b;">PRD-02</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:right; font-weight:700; color:#0f172a;">دعم فني وصيانة دورية</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:center; font-weight:700;">1</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left;">500.00 ${SAR_SYMBOL_SVG}</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left; color:#dc2626;">50.00</td>
            <td contenteditable="true" style="padding:7px 6px; border:1px solid #cbd5e1; outline:none; text-align:left;">67.50 ${SAR_SYMBOL_SVG}</td>
            <td contenteditable="true" style="padding:7px 8px; border:1px solid #cbd5e1; outline:none; text-align:left; font-weight:800; color:#0f172a;">517.50 ${SAR_SYMBOL_SVG}</td>
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
      <div style="width:130px; border:1px solid #cbd5e1; border-radius:4px; padding:10px; text-align:center; background:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <div style="margin-bottom:4px;">{{qr_code}}</div>
        <div contenteditable="true" style="font-size:9px; color:#64748b; font-weight:700; outline:none;">رمز التحقق المشفر ZATCA</div>
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
            <td style="padding:6px 10px; text-align:left; font-weight:700; color:#0f172a;">{{subtotal}} ${SAR_SYMBOL_SVG}</td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td contenteditable="true" style="padding:6px 10px; background:#f8fafc; font-weight:700; color:#475569; outline:none;">إجمالي الخصم:</td>
            <td style="padding:6px 10px; text-align:left; font-weight:700; color:#dc2626;">{{discount}} ${SAR_SYMBOL_SVG}</td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td contenteditable="true" style="padding:6px 10px; background:#f8fafc; font-weight:700; color:#475569; outline:none;">ضريبة القيمة المضافة (15%):</td>
            <td style="padding:6px 10px; text-align:left; font-weight:700; color:#0f172a;">{{tax_amount}} ${SAR_SYMBOL_SVG}</td>
          </tr>
          <tr style="background:${color}; color:#fff;" class="totals-grand-row">
            <td contenteditable="true" style="padding:8px 10px; font-size:13px; font-weight:900; outline:none;">المبلغ الإجمالي المستحق:</td>
            <td style="padding:8px 10px; font-size:14px; font-weight:900; text-align:left;">{{grand_total}} ${SAR_SYMBOL_SVG}</td>
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
        <span>{{grand_total}}</span>
        <span style="font-size:0.85em;">${SAR_SYMBOL_SVG}</span>
      </div>
    </div>
  `;
}

// 7. SAR Symbol Badge Block
function getSarBadgeBlockHTML(color) {
  return `
    <div style="display:inline-flex; align-items:center; gap:8px; font-size:15px; font-weight:800; color:${color}; padding:8px 16px; background:#f8fafc; border:2px solid ${color}; border-radius:6px; margin-bottom:12px;">
      <span contenteditable="true" style="outline:none;">المبلغ الإجمالي: {{grand_total}}</span>
      <span style="font-size:1.15em;">${SAR_SYMBOL_SVG}</span>
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

// ─── Attach Block Controls (Move, Duplicate, Delete, Table Operations) ─────

function attachBlockControls(block) {
  if (!block) return;

  const btnDel = $('.btn-del-blk', block);
  if (btnDel) {
    btnDel.onclick = (e) => {
      e.stopPropagation();
      block.remove();
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
        const rows = table.querySelectorAll('tbody tr');
        const isStriped = table.dataset.striped === 'true';
        rows.forEach((tr, i) => {
          tr.style.backgroundColor = (!isStriped && i % 2 === 1) ? '#f8fafc' : '#ffffff';
        });
        table.dataset.striped = isStriped ? 'false' : 'true';
        toastOk(isStriped ? 'تم إيقاف تظليل الصفوف' : 'تم تفعيل تظليل الصفوف المتبادل');
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
  $$('.logo-actions', clone).forEach(c => c.remove());
  $$('.btn-sub-ctrl', clone).forEach(c => c.remove());

  // Remove contenteditable attributes
  $$('[contenteditable]', clone).forEach(el => el.removeAttribute('contenteditable'));

  // Clean internal class names
  $$('.editor-block', clone).forEach(el => {
    el.removeAttribute('class');
    el.removeAttribute('data-block-type');
  });

  const innerHtml = clone.innerHTML;
  const customStyleEl = $('#preset-custom-style', view);
  const extraStyles = customStyleEl ? customStyleEl.textContent : '';

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

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${esc(docMeta.name_ar)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Cairo', Tahoma, Arial, sans-serif;
    font-size: 12px;
    color: #1e293b;
    background-color: ${sheetBg.bgColor || '#ffffff'};
    padding: 12px;
    direction: rtl;
    position: relative;
    min-height: 297mm;
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
  ${extraStyles}
</style>
</head>
<body>
  ${innerHtml}
  <div style="margin-top:20px; text-align:center; font-size:10px; color:#94a3b8; border-top:1px solid #f1f5f9; padding-top:6px; position:relative; z-index:1;">
    تم إنشاء وطباعة هذا المستند عبر نظام رصين المالي المعتمد
  </div>
</body>
</html>`;
}

// ─── In-place Theme Color Applicator ──────────────────────────────────────

function applyThemeColorInPlace(newColor) {
  docMeta.primary_color = newColor;

  const indicator = $('#theme-color-indicator', view);
  if (indicator) indicator.style.background = newColor;

  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return;

  $$('.tbl-head-row, thead tr', canvas).forEach(el => {
    el.style.backgroundColor = newColor;
  });

  $$('.doc-title-banner, [style*="clip-path"], .invoice-title-banner', canvas).forEach(el => {
    el.style.backgroundColor = newColor;
  });

  $$('.totals-grand-row, [style*="grand_total"]', canvas).forEach(el => {
    el.style.backgroundColor = newColor;
  });

  $$('.pill-icon-wrap, [data-block-type="info_pills"] span[style*="border-inline-end"]', canvas).forEach(el => {
    el.style.color = newColor;
  });

  $$('[data-block-type="header"] div[style*="font-size:22px"]', canvas).forEach(el => {
    el.style.color = newColor;
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

  view.innerHTML = `
    <!-- Hidden File Inputs -->
    <input type="file" id="global-img-uploader" accept="image/*" style="display:none;" />
    <input type="file" id="bg-img-uploader" accept="image/*" style="display:none;" />

    <div class="visual-doc-editor" style="display:flex; flex-direction:column; height:calc(100vh - 65px); min-height:600px; background:#0b1120; color:#f8fafc; overflow:hidden;">
      
      <!-- Top Action Bar (Header) -->
      <header style="background:#131c2e; border-bottom:1px solid #1e293b; padding:0.45rem 1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; z-index:30;">
        
        <!-- Branding & Core Controls -->
        <div style="display:flex; align-items:center; gap:8px;">
          <div id="theme-color-indicator" style="background:${docMeta.primary_color}; width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,0.4);">
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

          <input type="text" id="inp-doc-name" value="${esc(docMeta.name_ar)}" placeholder="اسم القالب..." style="padding:4px 10px; font-size:0.8rem; background:#0f172a; color:#fff; border:1px solid #334155; border-radius:5px; width:160px;" />
        </div>

        <!-- Center: Quick Color Palette -->
        <div style="display:flex; align-items:center; gap:5px;">
          <span style="font-size:0.75rem; color:#94a3b8; font-weight:700;">الثيم:</span>
          ${PALETTE.map(c => `
            <button type="button" class="btn-palette-col" data-color="${c}" style="width:17px; height:17px; border-radius:50%; background:${c}; border:${docMeta.primary_color === c ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)'}; cursor:pointer; padding:0; transition:transform 0.15s;" title="${c}"></button>
          `).join('')}
          <input type="color" id="inp-custom-color" value="${esc(docMeta.primary_color)}" style="width:22px; height:20px; border:none; cursor:pointer; background:transparent; padding:0;" title="لون مخصص" />
        </div>

        <!-- Right: Primary Actions -->
        <div style="display:flex; align-items:center; gap:6px;">
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
        <button type="button" class="btn-insert-blk" data-type="sar_badge">${SAR_SYMBOL_SVG} شارة الريال</button>
        
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
          ${sheetBg.bgImage ? `
            <button type="button" id="btn-remove-bg-img" class="btn-tag-chip" style="background:#ef4444; color:#fff;" title="حذف صورة الخلفية">حذف</button>
          ` : ''}
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
      <div style="flex:1; overflow:auto; padding:24px 10px; display:flex; justify-content:center; align-items:flex-start; background:#0b1120;">
        <div class="editor-a4-sheet" id="editor-canvas-sheet">
          <!-- Blocks and background layers populate here -->
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

    <style>
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
      }
      .editor-block {
        position: relative;
        z-index: 1;
        border: 1px dashed transparent;
        transition: border 0.15s;
        margin-bottom: 8px;
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
    canvas.appendChild(createBlockElement(getSignaturesBlockHTML(), 'signatures'));
  } else {
    canvas.appendChild(createBlockElement(getHeaderBlockHTML(col), 'header'));
    canvas.appendChild(createBlockElement(getInfoPillsBlockHTML(col), 'info_pills'));
    canvas.appendChild(createBlockElement(getBuyerBlockHTML(col), 'buyer'));
    canvas.appendChild(createBlockElement(getItemsTableBlockHTML(col), 'items_table'));
    canvas.appendChild(createBlockElement(getTotalsBlockHTML(col), 'totals'));
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

function loadRawHtmlIntoCanvas(rawHtml, tplName) {
  const canvas = $('#editor-canvas-sheet', view);
  if (!canvas) return;

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // Extract <style>
  const styles = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
  let customStyleTag = $('#preset-custom-style', view);
  if (!customStyleTag) {
    customStyleTag = document.createElement('style');
    customStyleTag.id = 'preset-custom-style';
    document.head.appendChild(customStyleTag);
  }
  customStyleTag.textContent = styles;

  // Extract body inner content or container
  const container = doc.querySelector('.invoice-container') || doc.querySelector('.voucher-card') || doc.body;
  const content = container ? container.innerHTML : rawHtml;

  canvas.innerHTML = content;

  // Make text elements directly editable
  canvas.querySelectorAll('h1, h2, h3, h4, p, span, td, th, div').forEach(el => {
    if (el.children.length === 0 || (el.children.length === 1 && el.querySelector('.sar-sym'))) {
      el.contentEditable = 'true';
    }
  });

  if (tplName) {
    const cleanName = tplName.replace(/\(.*?\)/g, '').trim();
    docMeta.name_ar = cleanName;
    const inpName = $('#inp-doc-name', view);
    if (inpName) inpName.value = cleanName;
  }

  // Re-apply background overlay
  applySheetBackground();

  toastOk('تم تحميل القالب بنجاح للتصميم والتعديل!');
}

// ─── Attach Application Events ─────────────────────────────────────────────

function attachAppEvents() {
  if (!view) return;

  const canvas = $('#editor-canvas-sheet', view);

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
          if (opt?.dataset?.color) {
            applyThemeColorInPlace(opt.dataset.color);
          }
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

  // Theme color palette buttons
  $$('.btn-palette-col', view).forEach(btn => {
    btn.onclick = () => {
      const col = btn.dataset.color;
      applyThemeColorInPlace(col);
      $$('.btn-palette-col', view).forEach(b => {
        b.style.border = (b.dataset.color === col) ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)';
      });
      const customCol = $('#inp-custom-color', view);
      if (customCol) customCol.value = col;
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
          renderView(); // re-render to update remove button and options
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
      renderView();
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
        if (canvas) canvas.innerHTML = '';
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
      if (!docMeta.name_ar || !docMeta.name_ar.trim()) {
        toastErr('يرجى كتابة اسم للقالب أولاً');
        return;
      }

      saving = true;
      btnSave.disabled = true;
      btnSave.textContent = 'جاري الحفظ...';

      try {
        const generatedHTML = serializeCanvasToCleanHTML();
        const payload = {
          id: editingId || undefined,
          type: docMeta.type,
          category: docMeta.type,
          name_ar: docMeta.name_ar.trim(),
          primary_color: docMeta.primary_color,
          html_content: generatedHTML,
          bg_config: sheetBg
        };

        const res = await api.post('/api/templates/builder', payload);
        if (res?.id) {
          editingId = res.id;
        }

        toastOk('تم حفظ القالب بنجاح في النظام وملفات القوالب!');
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
  editingId = null;
  saving = false;
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

  renderView();
}
