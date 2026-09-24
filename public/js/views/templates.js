// ==========================================================================
//  Raseen — مركز واجهة قوالب وتقارير المستندات (Document Templates & Reports Hub)
//  إدارة وتوليد تقارير المستندات وقوالب Excel المعتمدة للفواتير والسندات والتقارير
// ==========================================================================
import { api } from '../core/api.js';
import { store, can } from '../core/store.js';
import {
  html, raw, esc, printDoc, modal, toastOk, toastErr, $, $$, exportExcel, downloadPdfFromHtml, fillDynamicTemplateHtml,
} from '../core/util.js';
import {
  invoiceA4, invoiceThermal, invoicePreviewDoc, INVOICE_TEMPLATES,
  VOUCHER_TEMPLATES, voucherPrint,
} from '../print/templates.js?v=5';
import { PRESET_LOGOS } from '../print/logos.js';

const PALETTES = [
  { name: 'سماوي رسين الحديث', color: '#06b6d4', dark: '#0891b2', light: '#ecfeff' },
  { name: 'تيل زيتي متوازن', color: '#0d9488', dark: '#0f766e', light: '#f0fdfa' },
  { name: 'أزرق ملكي أنيق', color: '#2563eb', dark: '#1d4ed8', light: '#eff6ff' },
  { name: 'كحلي داكن موثوق', color: '#1e3a8a', dark: '#172554', light: '#f8fafc' },
  { name: 'أخضر زمردي رسمي', color: '#059669', dark: '#047857', light: '#ecfdf5' },
  { name: 'رمادي فحمي رصين', color: '#334155', dark: '#1e293b', light: '#f8fafc' },
  { name: 'عنابي تنفيذي فاخر', color: '#991b1b', dark: '#7f1d1d', light: '#fef2f2' },
  { name: 'بنفسجي تقني حديث', color: '#7c3aed', dark: '#6d28d9', light: '#f5f3ff' },
  { name: 'برونزي ذهبي دافئ', color: '#d97706', dark: '#b45309', light: '#fffbeb' },
  { name: 'أسود مالي ناصع', color: '#0f172a', dark: '#020617', light: '#f1f5f9' },
];

function buildMockInvoice(issuer, phase = 'PHASE1') {
  const cur = issuer.currency || 'SAR';
  const isPhase2 = phase === 'PHASE2';
  return {
    id: 'preview-inv',
    invoice_number: `${issuer.invoice_prefix || 'INV'}-0001`,
    invoice_type: 'STANDARD',
    issue_date: new Date().toISOString().slice(0, 10),
    issue_time: '12:00:00',
    currency: cur,
    subtotal: 1000,
    discount_amount: 0,
    taxable_amount: 1000,
    tax_amount: 150,
    grand_total: 1150,
    paid_amount: 1150,
    remaining_amount: 0,
    status: 'PAID',
    status_label: 'مسددة',
    payment_method: 'CASH',
    payment_label: 'نقدي',
    zatca_phase: phase,
    signature_mode: isPhase2 ? 'LOCAL' : 'NONE',
    seller_name: issuer.name_ar || '',
    seller_name_en: issuer.name_en || '',
    seller_tax_number: issuer.tax_number || '',
    seller_cr: issuer.commercial_register || '',
    seller_address: [issuer.building_no, issuer.street, issuer.district, issuer.city].filter(Boolean).join(' - '),
    seller_address_en: issuer.address_en || '',
    buyer_name: 'العميل',
    buyer_tax_number: '',
    buyer_cr: '',
    buyer_address: '',
    qr_payload: '',
    invoice_hash: '',
    notes: '',
    lines: [
      {
        line_no: 1,
        item_code: 'ITM-01',
        item_name: 'بند الفاتورة',
        unit: 'حبة',
        quantity: 1,
        unit_price: 1000,
        discount: 0,
        taxable: 1000,
        tax_rate: 15,
        tax_amount: 150,
        total_line: 1150,
      },
    ],
  };
}

const mockClient = {
  id: '',
  name: 'العميل',
  client_code: '',
  tax_number: '',
  building_no: '',
  street: '',
  district: '',
  city: '',
  postal_code: '',
  country: '',
  address: '',
  mobile: '',
  phone: '',
};

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export async function render(view) {
  const rawIssuers = await api.get('/api/issuers');
  const issuers = Array.isArray(rawIssuers) ? rawIssuers : (rawIssuers?.data || []);
  if (!issuers.length) {
    view.innerHTML = html`
      <div class="card"><div class="empty">
        <h3>لا توجد شركات مصدرة في النظام</h3>
        <p class="muted">أضف منشأة مصدرة أولاً من شاشة «الشركات المصدرة» لتهيئة وتخصيص قوالبها.</p>
        <a href="#/issuers" class="btn btn-primary mt">إدارة الشركات المصدرة</a>
      </div></div>`;
    return undefined;
  }

  let activeIssuerId = store.activeIssuerId || issuers[0].id;
  let activeIssuer = issuers.find((i) => i.id === activeIssuerId) || issuers[0];

  try {
    const rawActive = await api.get(`/api/issuers/${activeIssuer.id}`);
    if (rawActive && rawActive.id) activeIssuer = rawActive;
  } catch { /* التراجع للمنشأة المتاحة */ }

  let excelTemplates = [];
  async function loadTemplates() {
    try {
      const res = await api.get('/api/invoices/templates?type=all');
      excelTemplates = Array.isArray(res) ? res : (res?.data || []);
    } catch {
      excelTemplates = [];
    }
  }
  await loadTemplates();

  // جلب فواتير وعملاء وسندات حقيقية للمنشأة لتكون المعاينة ديناميكية بالكامل بدون أي بيانات ثابتة
  let liveClients = [];
  let liveInvoices = [];
  let liveVouchers = [];
  async function loadIssuerData() {
    try {
      const [invRes, cliRes, vouRes] = await Promise.all([
        api.get(`/api/invoices?issuer_id=${encodeURIComponent(activeIssuer.id)}&limit=10`),
        api.get(`/api/clients?issuer_id=${encodeURIComponent(activeIssuer.id)}&limit=10`),
        api.get(`/api/vouchers?issuer_id=${encodeURIComponent(activeIssuer.id)}&limit=10`),
      ]);
      liveInvoices = Array.isArray(invRes) ? invRes : (invRes?.items || invRes?.data || []);
      liveClients = Array.isArray(cliRes) ? cliRes : (cliRes?.items || cliRes?.data || []);
      liveVouchers = Array.isArray(vouRes) ? vouRes : (vouRes?.items || vouRes?.data || []);
    } catch {
      liveInvoices = [];
      liveClients = [];
      liveVouchers = [];
    }
  }
  await loadIssuerData();

  let issuerPrintSettings = {};
  try {
    issuerPrintSettings = typeof activeIssuer.print_settings === 'string'
      ? JSON.parse(activeIssuer.print_settings || '{}')
      : (activeIssuer.print_settings || {});
  } catch { issuerPrintSettings = {}; }

  let issuerQrSettings = {};
  try {
    issuerQrSettings = typeof activeIssuer.qr_settings === 'string'
      ? JSON.parse(activeIssuer.qr_settings || '{}')
      : (activeIssuer.qr_settings || {});
  } catch { issuerQrSettings = {}; }

  let printCfg = {
    template_style: 'standard',
    primary_color: '#06b6d4',
    dark_color: '#0891b2',
    light_color: '#ecfeff',
    font_family: 'Cairo',
    font_size: 'normal',
    logo_position: 'center',
    logo_size: 'medium',
    show_item_code: true,
    show_unit: true,
    show_currency_column: true,
    show_discount: true,
    show_taxable: true,
    show_tax_rate: true,
    show_tax_amount: true,
    striped_rows: true,
    show_bank: true,
    show_tafqeet: true,
    show_signatures: true,
    show_notes: true,
    qr_position: 'right',
    copies: 1,
    custom_css: '',
    ...issuerPrintSettings,
  };

  let qrCfg = {
    show_a4: true,
    show_thermal: true,
    size: 'medium',
    scale: 4,
    thermal_scale: 3,
    ...issuerQrSettings,
  };

  // فحص علامة التبويب من الرابط
  const hash = window.location.hash || '';
  let activeHubTab = 'invoices'; // افتراضياً فواتير المبيعات
  if (hash.includes('tab=vouchers')) activeHubTab = 'vouchers';
  else activeHubTab = 'invoices';

  let printSubTab = 'branding';
  let zoomLevel = 62;
  let activeZatcaPhase = activeIssuer.zatca_phase || 'PHASE1';
  let invoiceState = 'normal';

  function getDynamicPreviewInvoice() {
    if (liveInvoices.length > 0) {
      const realInv = liveInvoices[0];
      const matchedClient = liveClients.find((c) => c.id === realInv.client_id) || liveClients[0] || {};
      return {
        ...realInv,
        currency: realInv.currency || activeIssuer.currency || 'SAR',
        seller_name: activeIssuer.name_ar || '',
        seller_name_en: activeIssuer.name_en || '',
        seller_tax_number: activeIssuer.tax_number || '',
        seller_cr: activeIssuer.commercial_register || '',
        seller_address: [activeIssuer.building_no, activeIssuer.street, activeIssuer.district, activeIssuer.city].filter(Boolean).join(' - '),
        seller_address_en: activeIssuer.address_en || '',
        buyer_name: realInv.client_name || matchedClient.name || 'العميل',
        buyer_tax_number: realInv.client_tax_number || matchedClient.tax_number || '',
        buyer_cr: matchedClient.commercial_register || '',
        buyer_address: realInv.client_address || matchedClient.address || '',
        status_label: realInv.status_label || (realInv.status === 'PAID' ? 'مسددة' : 'معتمدة'),
        payment_label: realInv.payment_label || 'نقدي',
        lines: realInv.lines && realInv.lines.length ? realInv.lines : buildMockInvoice(activeIssuer, activeZatcaPhase).lines,
      };
    }
    return buildMockInvoice(activeIssuer, activeZatcaPhase);
  }

  let currentInvoice = getDynamicPreviewInvoice();
  let searchQuery = '';

  // ------------------------------------------------------------- مولدات الأقسام
  function renderKpisHtml(invoiceTemplates, voucherTemplates, currentTpl, activeZatcaPhase) {
    return `
      <div class="doc-tpl-kpis">
        <div class="doc-tpl-kpi-card">
          <div class="doc-tpl-kpi-icon" style="background:rgba(6,182,212,0.15); color:#06b6d4;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          </div>
          <div class="doc-tpl-kpi-info">
            <span class="doc-tpl-kpi-val">${invoiceTemplates.length}</span>
            <span class="doc-tpl-kpi-label">قوالب فواتير المبيعات</span>
          </div>
        </div>
        <div class="doc-tpl-kpi-card">
          <div class="doc-tpl-kpi-icon" style="background:rgba(168,85,247,0.15); color:#a855f7;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
          </div>
          <div class="doc-tpl-kpi-info">
            <span class="doc-tpl-kpi-val">${voucherTemplates.length}</span>
            <span class="doc-tpl-kpi-label">قوالب سندات ومستندات</span>
          </div>
        </div>
        <div class="doc-tpl-kpi-card" style="border-color:rgba(6,182,212,0.3);">
          <div class="doc-tpl-kpi-icon" style="background:rgba(6,182,212,0.2); color:#38bdf8;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div class="doc-tpl-kpi-info">
            <span class="doc-tpl-kpi-val" style="font-size:1.05rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">${esc(currentTpl.name_ar || currentTpl.name)}</span>
            <span class="doc-tpl-kpi-label">قالب الفاتورة المعتمد</span>
          </div>
        </div>
        <div class="doc-tpl-kpi-card">
          <div class="doc-tpl-kpi-icon" style="background:rgba(16,185,129,0.15); color:#10b981;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div class="doc-tpl-kpi-info">
            <span class="doc-tpl-kpi-val" style="font-size:0.92rem; color:#10b981;">${activeZatcaPhase === 'PHASE2' ? 'المرحلة 2 (تكامل)' : 'المرحلة 1 (مشفر)'}</span>
            <span class="doc-tpl-kpi-label">هيئة الزكاة والضريبة (ZATCA)</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderSearchBarHtml(activeTab) {
    const uploadLabel = activeTab === 'vouchers' ? 'رفع قالب سند قبض جديد (.html) ⤒' : 'رفع قالب فاتورة جديد (.html) ⤒';
    return `
      <div class="card" style="padding:0.75rem 1rem; margin:0; background:rgba(255,255,255,0.02); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
        <div style="position:relative; flex:1; min-width:240px; max-width:460px;">
          <input type="text" id="inp-hub-search" value="${esc(searchQuery)}" placeholder="بحث في أسماء القوالب أو الأعمدة المكتشفة..." style="width:100%; padding-inline-start:34px; font-size:0.86rem;" />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); color:var(--muted);"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <div class="flex gap-sm" style="align-items:center;">
          <label class="btn btn-sm btn-primary" style="margin:0; cursor:pointer; display:inline-flex; align-items:center; gap:5px; font-size:0.8rem;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
            ${uploadLabel}
            <input type="file" class="file-upload-tab-specific" accept=".html,.htm,.xlsx,.xls" style="display:none;" />
          </label>
        </div>
      </div>
    `;
  }

  function renderReportsGridHtml(reports) {
    if (!reports.length) {
      return `
        <div class="doc-tpl-empty">
          <h3>لا توجد قوالب تقارير مطابقة</h3>
          <p class="muted">يمكنك رفع أي تقرير Excel بصيغة .xlsx وسيقوم النظام باكتشاف خلاياه تلقائياً.</p>
          <label class="btn btn-primary mt" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
            رفع قالب تقرير الآن ⤒
            <input type="file" class="file-upload-tab-specific" accept=".xlsx,.xls" style="display:none;" />
          </label>
        </div>
      `;
    }

    const cards = reports.map((tpl) => {
      const headers = tpl.headers || [];
      const chipsHtml = headers.slice(0, 4).map((h, i) => `<span class="doc-tpl-chip green"><span style="opacity:0.6;">#${i + 1}</span> ${esc(h)}</span>`).join('');
      const moreChips = headers.length > 4 ? `<span class="doc-tpl-chip" style="font-size:0.68rem;">+${headers.length - 4} أعمدة</span>` : '';
      const sizeBadge = tpl.file_size ? `<span class="badge gray tiny" style="font-size:0.65rem;">${formatBytes(tpl.file_size)}</span>` : '';

      return `
        <div class="doc-tpl-card">
          <div class="doc-tpl-card-top">
            <div class="doc-tpl-card-icon" style="background:rgba(16,185,129,0.12); color:#10b981;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/></svg>
            </div>
            <div class="doc-tpl-card-meta">
              <div class="doc-tpl-card-title">
                <span>${esc(tpl.name_ar || tpl.name)}</span>
                <span class="badge green tiny" style="font-size:0.68rem;">تقرير معتمد</span>
                ${sizeBadge}
              </div>
              <p class="doc-tpl-card-desc">${esc(tpl.description || 'قالب تقرير محاسبي ذكي بصيغة Excel')}</p>
              <div class="doc-tpl-card-chips">
                <span class="tiny muted" style="font-size:0.7rem; font-weight:700;">الأعمدة المكتشفة (${headers.length}):</span>
                ${chipsHtml}
                ${moreChips}
              </div>
            </div>
          </div>
          <div class="doc-tpl-card-foot">
            <div class="flex gap-xs" style="align-items:center; flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-info btn-visual-preview" data-tpl-id="${esc(tpl.id)}" style="display:inline-flex; align-items:center; gap:5px; font-size:0.8rem; font-weight:700; background:rgba(6,182,212,0.16); border:1px solid rgba(6,182,212,0.38); color:#38bdf8;" title="عرض ومعاينة التقرير بصرية كصورة ومستند رسمي">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                عرض التقرير (صورة)
              </button>
              <button type="button" class="btn btn-sm btn-success btn-generate-report" data-tpl-id="${esc(tpl.id)}" style="display:inline-flex; align-items:center; gap:5px; font-size:0.8rem; font-weight:700; background:linear-gradient(135deg, #059669, #047857); border-color:#34d399; color:#fff;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                توليد إكسل
              </button>
            </div>
            <div class="doc-tpl-card-actions">
              <button type="button" class="btn btn-sm btn-inspect-tpl" data-tpl-id="${esc(tpl.id)}" title="فحص خلايا القالب" style="padding:4px 8px; font-size:0.76rem;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                فحص
              </button>
              <a class="btn btn-sm" href="/api/invoices/template?style=${esc(tpl.id)}&format=xlsx" target="_blank" download="report_template_${esc(tpl.id)}.xlsx" title="تنزيل ملف القالب (.xlsx)" style="padding:4px 8px; font-size:0.76rem;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                تنزيل .xlsx
              </a>
              <button type="button" class="btn btn-sm btn-danger btn-delete-tpl" data-tpl-id="${esc(tpl.id)}" data-tpl-name="${esc(tpl.name_ar || tpl.name)}" title="حذف القالب" style="padding:4px 7px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="doc-tpl-grid">${cards}</div>`;
  }

  function renderInvoicesGridHtml(invoices, currentStyle, activeIssuer) {
    if (!invoices.length) {
      return `
        <div class="doc-tpl-empty">
          <h3>لا توجد قوالب فواتير مطابقة</h3>
          <p class="muted">ارفع قالب فواتير جديد (.html) ليتم اكتشاف وسومه وبياناته تلقائياً.</p>
        </div>
      `;
    }

    const cards = invoices.map((tpl) => {
      const isActive = tpl.id === currentStyle;
      const tplColor = tpl.color_hex || '#06b6d4';
      const headers = tpl.headers || [];
      const chipsHtml = headers.slice(0, 4).map((h, i) => `<span class="doc-tpl-chip" style="background:${tplColor}15; border:1px solid ${tplColor}35; color:${tplColor};"><span style="opacity:0.6;">#${i + 1}</span> ${esc(h)}</span>`).join('');
      const moreChips = headers.length > 4 ? `<span class="doc-tpl-chip" style="font-size:0.68rem;">+${headers.length - 4} أعمدة</span>` : '';
      const sizeBadge = tpl.file_size ? `<span class="badge gray tiny" style="font-size:0.65rem;">${formatBytes(tpl.file_size)}</span>` : '';

      return `
        <div class="doc-tpl-card ${isActive ? 'is-active' : ''}" style="${isActive ? `border-color:${tplColor}; box-shadow:0 0 0 1.5px ${tplColor}44;` : `border-color:${tplColor}25;`}">
          <div class="doc-tpl-card-top">
            <div class="doc-tpl-card-icon" style="background:${tplColor}18; color:${tplColor}; border:1px solid ${tplColor}35;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/></svg>
            </div>
            <div class="doc-tpl-card-meta">
              <div class="doc-tpl-card-title">
                <span style="font-weight:800;">${esc(tpl.name_ar || tpl.name)}</span>
                ${isActive ? `<span class="badge tiny" style="background:${tplColor}22; color:${tplColor}; border:1px solid ${tplColor}55; font-weight:700;">القالب المعتمد النشط ✓</span>` : `<span class="badge tiny" style="background:${tplColor}15; color:${tplColor}; font-size:0.68rem;">${esc(tpl.badge || 'فاتورة إكسل')}</span>`}
                ${sizeBadge}
              </div>
              <p class="doc-tpl-card-desc">${esc(tpl.description || 'قالب فاتورة مبيعات ضريبية متوافق مع هيئة الزكاة')}</p>
              <div class="doc-tpl-card-chips">
                <span class="tiny muted" style="font-size:0.7rem; font-weight:700;">الأعمدة (${headers.length}):</span>
                ${chipsHtml}
                ${moreChips}
              </div>
            </div>
          </div>
          <div class="doc-tpl-card-foot">
            <div class="flex gap-xs" style="align-items:center; flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-info btn-visual-invoice-modal" data-tpl-id="${esc(tpl.id)}" title="معاينة الفاتورة كصورة ومستند A4 رسمي" style="display:inline-flex; align-items:center; gap:5px; font-size:0.8rem; font-weight:700; background:rgba(6,182,212,0.18); border:1px solid rgba(6,182,212,0.45); color:#38bdf8;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                عرض الفاتورة (صورة)
              </button>
              ${isActive ? `
                <button type="button" class="btn btn-sm" disabled style="background:${tplColor}22; border:1px solid ${tplColor}55; color:${tplColor}; font-size:0.78rem; padding:4px 10px; font-weight:700;">معتمد للمنشأة ✓</button>
              ` : `
                <button type="button" class="btn btn-sm btn-primary btn-select-template" data-tpl-id="${esc(tpl.id)}" style="font-size:0.78rem; padding:4px 10px;">اعتماد القالب</button>
              `}
            </div>
            <div class="doc-tpl-card-actions">
              <button type="button" class="btn btn-sm btn-inspect-tpl" data-tpl-id="${esc(tpl.id)}" title="فحص خلايا القالب" style="padding:4px 8px; font-size:0.76rem;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                فحص
              </button>
              <a class="btn btn-sm" href="/api/invoices/template?style=${esc(tpl.id)}" target="_blank" download="invoice_template_${esc(tpl.id)}.html" title="تنزيل ملف القالب" style="padding:4px 8px; font-size:0.76rem;">
                تنزيل القالب
              </a>
              <button type="button" class="btn btn-sm btn-danger btn-delete-tpl" data-tpl-id="${esc(tpl.id)}" data-tpl-name="${esc(tpl.name_ar || tpl.name)}" title="حذف القالب" style="padding:4px 7px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="doc-tpl-grid">${cards}</div>`;
  }

  function renderVouchersGridHtml(vouchers) {
    if (!vouchers.length) {
      return `
        <div class="doc-tpl-empty">
          <h3>لا توجد قوالب سندات إضافية</h3>
          <p class="muted">يمكنك رفع أي نموذج سند قبض بصيغة .html وسيقوم النظام بتسجيله فوراً.</p>
        </div>
      `;
    }

    const cards = vouchers.map((tpl) => {
      const tplColor = tpl.color_hex || '#7c3aed';
      const isVoucherActive = (printCfg.voucher_template_style || '') === tpl.id;
      const headers = tpl.headers || [];
      const isHtmlTpl = tpl.badge?.includes('HTML') || (tpl.file_path && tpl.file_path.endsWith('.html')) || headers.length === 0;
      const chipsHtml = isHtmlTpl
        ? `<span class="doc-tpl-chip" style="background:${tplColor}15; border:1px solid ${tplColor}35; color:${tplColor};">بيانات المنشأة</span>
           <span class="doc-tpl-chip" style="background:${tplColor}15; border:1px solid ${tplColor}35; color:${tplColor};">بيانات العميل</span>
           <span class="doc-tpl-chip" style="background:${tplColor}15; border:1px solid ${tplColor}35; color:${tplColor};">المبالغ والسداد</span>
           <span class="doc-tpl-chip" style="background:${tplColor}15; border:1px solid ${tplColor}35; color:${tplColor};">طباعة A4</span>`
        : headers.slice(0, 4).map((h, i) => `<span class="doc-tpl-chip" style="background:${tplColor}15; border:1px solid ${tplColor}35; color:${tplColor};"><span style="opacity:0.6;">#${i + 1}</span> ${esc(h)}</span>`).join('');
      const sizeBadge = tpl.file_size ? `<span class="badge gray tiny" style="font-size:0.65rem;">${formatBytes(tpl.file_size)}</span>` : '';

      return `
        <div class="doc-tpl-card" style="border-color:${tplColor}25;">
          <div class="doc-tpl-card-top">
            <div class="doc-tpl-card-icon" style="background:${tplColor}18; color:${tplColor}; border:1px solid ${tplColor}35;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            </div>
            <div class="doc-tpl-card-meta">
              <div class="doc-tpl-card-title">
                <span style="font-weight:800;">${esc(tpl.name_ar || tpl.name)}</span>
                ${isVoucherActive ? `<span class="badge tiny" style="background:${tplColor}22; color:${tplColor}; border:1px solid ${tplColor}55; font-weight:700;">القالب المعتمد النشط ✓</span>` : `<span class="badge tiny" style="background:${tplColor}15; color:${tplColor}; font-size:0.68rem;">${esc(tpl.badge || 'سند قبض')}</span>`}
                ${sizeBadge}
              </div>
              <p class="doc-tpl-card-desc">${esc(tpl.description || 'قالب إيصال وسند قبض مالي معتمد')}</p>
              <div class="doc-tpl-card-chips">
                <span class="tiny muted" style="font-size:0.7rem; font-weight:700;">${isHtmlTpl ? 'الحقول الديناميكية:' : `الأعمدة (${headers.length}):`}</span>
                ${chipsHtml}
              </div>
            </div>
          </div>
          <div class="doc-tpl-card-foot">
            <div class="flex gap-xs" style="align-items:center; flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-info btn-visual-voucher-modal" data-tpl-id="${esc(tpl.id)}" style="display:inline-flex; align-items:center; gap:5px; font-size:0.8rem; font-weight:700; background:${tplColor}20; border:1px solid ${tplColor}55; color:${tplColor};" title="عرض ومعاينة السند بصرية كصورة ومستند رسمي">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                عرض السند (صورة)
              </button>
              ${isVoucherActive ? `
                <button type="button" class="btn btn-sm" disabled style="background:${tplColor}22; border:1px solid ${tplColor}55; color:${tplColor}; font-size:0.78rem; padding:4px 10px; font-weight:700;">معتمد للمنشأة ✓</button>
              ` : `
                <button type="button" class="btn btn-sm btn-primary btn-select-voucher-template" data-tpl-id="${esc(tpl.id)}" style="font-size:0.78rem; padding:4px 10px;">اعتماد القالب</button>
              `}
            </div>
            <div class="doc-tpl-card-actions">
              ${tpl.is_builtin ? '' : `
                <button type="button" class="btn btn-sm btn-inspect-tpl" data-tpl-id="${esc(tpl.id)}" title="فحص خلايا القالب" style="padding:4px 8px; font-size:0.76rem;">فحص</button>
                <a class="btn btn-sm" href="/api/invoices/template?style=${esc(tpl.id)}" target="_blank" download="${esc(tpl.name_ar || tpl.name || 'voucher_template')}.html" style="padding:4px 8px; font-size:0.76rem;">تنزيل القالب</a>
                <button type="button" class="btn btn-sm btn-danger btn-delete-tpl" data-tpl-id="${esc(tpl.id)}" data-tpl-name="${esc(tpl.name_ar || tpl.name)}" style="padding:4px 7px;">حذف</button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="doc-tpl-grid">${cards}</div>`;
  }

  function renderPrintStudioHtml(printSubTab, printCfg, qrCfg, activeIssuer, activeZatcaPhase, zoomLevel) {
    const swatchesHtml = PALETTES.map((p) =>
      `<button type="button" class="color-swatch ${p.color.toLowerCase() === (printCfg.primary_color || '').toLowerCase() ? 'active' : ''}" data-color="${p.color}" data-dark="${p.dark}" data-light="${p.light}" style="background:${p.color}" title="${p.name}"></button>`
    ).join('');

    const presetLogosHtml = PRESET_LOGOS.map((pl) => `
      <button type="button" class="btn btn-sm btn-apply-logo-preset" data-logo-id="${pl.id}" style="padding:4px 6px; font-size:.72rem; text-align:start; display:flex; align-items:center; gap:5px; background:rgba(255,255,255,0.02); border:1px solid var(--line);" title="${esc(pl.name)}">
        <span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${pl.color}; flex-shrink:0;"></span>
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(pl.name)}</span>
      </button>
    `).join('');

    return `
      <div class="tpl-studio">
        <div class="tpl-controls">
          <div class="tpl-tabs">
            <button class="tpl-tab-btn ${printSubTab === 'branding' ? 'active' : ''}" data-print-subtab="branding" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>الهوية والألوان
            </button>
            <button class="tpl-tab-btn ${printSubTab === 'columns' ? 'active' : ''}" data-print-subtab="columns" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>أعمدة الجدول
            </button>
            <button class="tpl-tab-btn ${printSubTab === 'qr' ? 'active' : ''}" data-print-subtab="qr" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="5" height="5" x="3" y="3" rx="1"/></svg>الـ QR والفوترة
            </button>
            <button class="tpl-tab-btn ${printSubTab === 'footer' ? 'active' : ''}" data-print-subtab="footer" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 19.5v-15A2.5 2.5 0 0 0 17.5 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5Z"/></svg>التذييل والبنك
            </button>
            <button class="tpl-tab-btn ${printSubTab === 'advanced' ? 'active' : ''}" data-print-subtab="advanced" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/></svg>تخصيص CSS
            </button>
          </div>

          <div class="tpl-tab-pane">
            <!-- تبويب الهوية والألوان -->
            <div id="subtab-pane-branding" style="${printSubTab === 'branding' ? '' : 'display:none'}">
              <div class="field">
                <label style="font-weight:700;">لوحات ألوان متناسقة جاهزة</label>
                <div class="color-swatches">${swatchesHtml}</div>
              </div>

              <div class="row mt">
                <div class="field" style="flex:1;">
                  <label style="font-weight:700;">اللون الرئيسي</label>
                  <div class="flex gap-sm">
                    <input type="color" id="ctrl-color" value="${esc(printCfg.primary_color || '#06b6d4')}" style="width:42px; height:36px; padding:2px; cursor:pointer;" />
                    <input type="text" id="ctrl-color-hex" value="${esc(printCfg.primary_color || '#06b6d4')}" class="ltr font-mono" style="flex:1; font-size:0.85rem;" />
                  </div>
                </div>
                <div class="field" style="flex:1;">
                  <label style="font-weight:700;">اللون الداكن</label>
                  <div class="flex gap-sm">
                    <input type="color" id="ctrl-color-dark" value="${esc(printCfg.dark_color || '#0891b2')}" style="width:42px; height:36px; padding:2px; cursor:pointer;" />
                    <input type="text" id="ctrl-color-dark-hex" value="${esc(printCfg.dark_color || '#0891b2')}" class="ltr font-mono" style="flex:1; font-size:0.85rem;" />
                  </div>
                </div>
              </div>

              <div class="row mt">
                <div class="field" style="flex:1;">
                  <label style="font-weight:700;">خط الطباعة</label>
                  <select id="ctrl-font">
                    <option value="Cairo"${printCfg.font_family === 'Cairo' ? ' selected' : ''}>Cairo (القاهرة - رسمي)</option>
                    <option value="Tajawal"${printCfg.font_family === 'Tajawal' ? ' selected' : ''}>Tajawal (تجوال - حديث)</option>
                    <option value="Almarai"${printCfg.font_family === 'Almarai' ? ' selected' : ''}>Almarai (المراعي - واضح)</option>
                    <option value="Segoe UI"${printCfg.font_family === 'Segoe UI' ? ' selected' : ''}>Segoe UI (افتراضي النظام)</option>
                  </select>
                </div>
                <div class="field" style="flex:1;">
                  <label style="font-weight:700;">حجم شعار المنشأة</label>
                  <select id="ctrl-logo-size">
                    <option value="small"${printCfg.logo_size === 'small' ? ' selected' : ''}>صغير (20mm)</option>
                    <option value="medium"${!printCfg.logo_size || printCfg.logo_size === 'medium' ? ' selected' : ''}>متوسط (26mm)</option>
                    <option value="large"${printCfg.logo_size === 'large' ? ' selected' : ''}>كبير (38mm)</option>
                  </select>
                </div>
              </div>

              <!-- بطاقة شعار المنشأة -->
              <div class="card mt" style="background:rgba(255,255,255,0.03); border:1px solid var(--line); border-radius:8px; padding:.9rem; margin-bottom:0;">
                <div class="flex" style="justify-content:space-between; align-items:center; margin-bottom:.6rem;">
                  <label style="font-weight:800; font-size:.88rem; margin:0; display:flex; align-items:center; gap:6px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                    شعار المنشأة المعتمد
                  </label>
                  <span class="badge ${activeIssuer.logo_data ? 'green' : 'gray'}" id="badge-logo-status" style="font-size:.72rem;">
                    ${activeIssuer.logo_data ? 'شعار نشط' : 'بديل الشعار التلقائي'}
                  </span>
                </div>

                <div class="flex gap" style="align-items:center; margin-bottom:.8rem;">
                  <div id="logo-preview-box" style="width:72px; height:58px; border-radius:6px; border:1px solid var(--line); background:#fff; display:grid; place-items:center; overflow:hidden; flex-shrink:0; padding:3px; box-shadow:0 2px 6px rgba(0,0,0,0.15);">
                    ${activeIssuer.logo_data
        ? `<img src="${esc(activeIssuer.logo_data)}" alt="شعار" style="max-width:100%; max-height:100%; object-fit:contain;" />`
        : `<div style="font-size:.68rem; color:#64748b; text-align:center; font-weight:700; line-height:1.2;">بديل<br>الشعار</div>`}
                  </div>
                  <div style="flex:1;">
                    <div class="flex gap-sm" style="flex-wrap:wrap;">
                      <label class="btn btn-sm btn-primary" style="cursor:pointer; margin:0; display:inline-flex; align-items:center; gap:5px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                        رفع شعار جديد ⤒
                        <input type="file" id="file-logo-input" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none;" />
                      </label>
                      ${activeIssuer.logo_data ? '<button type="button" class="btn btn-sm btn-danger" id="btn-remove-logo" style="margin:0;">إزالة الشعار</button>' : ''}
                    </div>
                    <div class="tiny muted" style="margin-top:4px; line-height:1.3;">يدعم SVG, PNG, JPG بدقة عالية وتنسيق شفاف.</div>
                  </div>
                </div>

                <div style="border-top:1px solid rgba(255,255,255,0.07); padding-top:.6rem;">
                  <div class="tiny muted mb-sm" style="font-weight:700;">أو اختر نموذج شعار جاهز:</div>
                  <div class="grid grid-3" style="gap:5px;">${presetLogosHtml}</div>
                </div>
              </div>
            </div>

            <!-- تبويب أعمدة الجدول -->
            <div id="subtab-pane-columns" style="${printSubTab === 'columns' ? '' : 'display:none'}">
              <div class="stack" style="gap:.6rem;">
                <label class="checkbox-line"><input type="checkbox" id="col-code" ${printCfg.show_item_code ? 'checked' : ''} /><span>عمود رمز/كود البند (Item Code)</span></label>
                <label class="checkbox-line"><input type="checkbox" id="col-unit" ${printCfg.show_unit ? 'checked' : ''} /><span>عمود وحدة القياس (Unit)</span></label>
                <label class="checkbox-line"><input type="checkbox" id="col-currency" ${printCfg.show_currency_column !== false ? 'checked' : ''} /><span>عمود العملة (ر.س / SAR) في جدول البنود</span></label>
                <label class="checkbox-line"><input type="checkbox" id="col-discount" ${printCfg.show_discount ? 'checked' : ''} /><span>عمود الخصم (Discount)</span></label>
                <label class="checkbox-line"><input type="checkbox" id="col-taxable" ${printCfg.show_taxable ? 'checked' : ''} /><span>عمود المبلغ الخاضع للضريبة</span></label>
                <label class="checkbox-line"><input type="checkbox" id="col-tax-rate" ${printCfg.show_tax_rate ? 'checked' : ''} /><span>عمود نسبة الضريبة (15%)</span></label>
                <label class="checkbox-line"><input type="checkbox" id="col-tax-amount" ${printCfg.show_tax_amount ? 'checked' : ''} /><span>عمود قيمة الضريبة (VAT Amount)</span></label>
                <label class="checkbox-line"><input type="checkbox" id="col-striped" ${printCfg.striped_rows ? 'checked' : ''} /><span>تلوين الصفوف بالتناوب (Striped Rows)</span></label>
              </div>
            </div>

            <!-- تبويب الـ QR والفوترة -->
            <div id="subtab-pane-qr" style="${printSubTab === 'qr' ? '' : 'display:none'}">
              <div class="field">
                <label style="font-weight:700;">محاكاة مرحلة هيئة الزكاة والضريبة والجمارك</label>
                <select id="ctrl-zatca-phase">
                  <option value="PHASE1"${activeZatcaPhase === 'PHASE1' ? ' selected' : ''}>المرحلة 1: إصدار وحفظ الفواتير إلكترونياً (QR مشفر TLV)</option>
                  <option value="PHASE2"${activeZatcaPhase === 'PHASE2' ? ' selected' : ''}>المرحلة 2: الربط والتكامل الفوري (الختم والتوقيع الرقمي والتشفير الكامل)</option>
                </select>
              </div>
              <div class="stack mt" style="gap:.6rem;">
                <label class="checkbox-line"><input type="checkbox" id="qr-a4" ${qrCfg.show_a4 ? 'checked' : ''} /><span>إظهار رمز الاستجابة السريعة (QR) في طباعة A4</span></label>
                <label class="checkbox-line"><input type="checkbox" id="qr-thermal" ${qrCfg.show_thermal ? 'checked' : ''} /><span>إظهار رمز الاستجابة السريعة (QR) في الإيصال الحراري</span></label>
              </div>
            </div>

            <!-- تبويب التذييل والبنك -->
            <div id="subtab-pane-footer" style="${printSubTab === 'footer' ? '' : 'display:none'}">
              <div class="stack" style="gap:.6rem;">
                <label class="checkbox-line"><input type="checkbox" id="ft-bank" ${printCfg.show_bank ? 'checked' : ''} /><span>إظهار بيانات الحساب البنكي والآيبان (IBAN)</span></label>
                <label class="checkbox-line"><input type="checkbox" id="ft-tafqeet" ${printCfg.show_tafqeet ? 'checked' : ''} /><span>إظهار تفقيط المبلغ كتابة بالريال السعودي</span></label>
                <label class="checkbox-line"><input type="checkbox" id="ft-signatures" ${printCfg.show_signatures ? 'checked' : ''} /><span>إظهار منطقة التوقيعات والأختام الرسمية</span></label>
                <label class="checkbox-line"><input type="checkbox" id="ft-notes" ${printCfg.show_notes ? 'checked' : ''} /><span>إظهار الملاحظات والشروط والأحكام</span></label>
              </div>
            </div>

            <!-- تبويب تخصيص CSS -->
            <div id="subtab-pane-advanced" style="${printSubTab === 'advanced' ? '' : 'display:none'}">
              <div class="field">
                <label style="font-weight:700;">تخصيص أنماط CSS إضافية (Custom CSS Overrides)</label>
                <textarea id="ctrl-custom-css" class="mono tiny" placeholder=".page { /* قواعد CSS مخصصة */ }" style="min-height:120px;">${esc(printCfg.custom_css || '')}</textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- قسم المعاينة الحية -->
        <div class="tpl-preview-pane">
          <div class="tpl-preview-toolbar">
            <div class="tpl-preview-info">
              <span class="badge green" style="font-weight:700;">ورق A4 ضريبي (210×297mm)</span>
            </div>
            <div class="tpl-preview-actions">
              <div class="tpl-zoom-controls">
                <button type="button" class="tpl-zoom-btn" id="zoom-out" title="تصغير المعاينة">−</button>
                <span class="tpl-zoom-val" id="zoom-text">${zoomLevel}%</span>
                <button type="button" class="tpl-zoom-btn" id="zoom-in" title="تكبير المعاينة">+</button>
                <button type="button" class="tpl-zoom-btn" id="zoom-fit" title="ملء العرض" style="border-inline-start:1px solid var(--line-strong); font-size:.75rem;">العرض</button>
              </div>
              <button class="btn btn-sm" id="btn-fullscreen" title="معاينة في نافذة كاملة" type="button" style="padding:.3rem .6rem;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              </button>
              <button class="btn btn-sm btn-primary" id="btn-print-test" type="button" style="padding:.3rem .6rem; display:inline-flex; align-items:center; gap:4px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>تجربة الطباعة
              </button>
            </div>
          </div>

          <div class="tpl-paper-wrapper" id="paper-wrapper">
            <div class="tpl-paper-frame" id="paper-frame" style="transform: scale(${zoomLevel / 100});">
              <iframe id="preview-iframe" class="tpl-iframe" title="معاينة حية لقالب الفاتورة"></iframe>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderView() {
    const currentTpl = excelTemplates.find((t) => t.id === printCfg.template_style)
      || INVOICE_TEMPLATES.find((t) => t.id === printCfg.template_style)
      || { name_ar: 'الرسمي المعتمد', id: 'standard' };

    const invoiceTemplates = excelTemplates.filter((t) => t.category === 'invoices' || t.category === 'custom' || t.category === 'custom_invoices');
    const voucherTemplates = excelTemplates.filter((t) => t.category === 'documents' || t.category === 'vouchers' || t.category === 'custom_vouchers');

    const filterList = (list) => {
      if (!searchQuery) return list;
      const q = searchQuery.toLowerCase();
      return list.filter((t) =>
        (t.name_ar && t.name_ar.toLowerCase().includes(q)) ||
        (t.name_en && t.name_en.toLowerCase().includes(q)) ||
        (t.id && t.id.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        ((t.headers || []).some((h) => String(h).toLowerCase().includes(q)))
      );
    };

    const filteredInvoices = filterList(invoiceTemplates);
    const filteredVouchers = filterList(voucherTemplates);

    const kpiHtml = renderKpisHtml(invoiceTemplates, voucherTemplates, currentTpl, activeZatcaPhase);
    const searchBarHtml = activeHubTab !== 'print' ? renderSearchBarHtml(activeHubTab) : '';

    let contentHtml = '';
    if (activeHubTab === 'vouchers') {
      contentHtml = renderVouchersGridHtml(filteredVouchers);
    } else if (activeHubTab === 'print') {
      contentHtml = renderPrintStudioHtml(printSubTab, printCfg, qrCfg, activeIssuer, activeZatcaPhase, zoomLevel);
    } else {
      contentHtml = renderInvoicesGridHtml(filteredInvoices, printCfg.template_style, activeIssuer);
    }

    view.innerHTML = html`
      <div class="doc-tpl-hub">
        <!-- ترويسة الصفحة العامة -->
        <div class="page-head" style="margin-bottom:0;">
          <div>
            <h1 style="margin:0; display:flex; align-items:center; gap:8px;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--primary);"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/></svg>
              القوالب
            </h1>
          </div>
          <div class="page-actions" style="flex-wrap:wrap; gap:.5rem;">
            <div class="field" style="margin:0; min-width:210px;">
              <select id="sel-issuer">
                ${raw(issuers.map((iss) => `<option value="${esc(iss.id)}"${iss.id === activeIssuer.id ? ' selected' : ''}>${esc(iss.name_ar)} (${esc(iss.code)})</option>`).join(''))}
              </select>
            </div>
            <label class="btn btn-primary" style="margin:0; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              رفع قالب جديد (.html) ⤒
              <input type="file" id="file-upload-global" accept=".html,.htm,.xlsx,.xls" style="display:none;" />
            </label>
            <button class="btn" id="btn-reset-templates" title="إعادة فحص ومزامنة القوالب من القرص يدوياً" type="button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:text-bottom; margin-inline-end:5px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>إعادة فحص القرص
            </button>
          </div>
        </div>

        <!-- مؤشرات KPI إحصائية سريعة -->
        ${raw(kpiHtml)}

        <!-- شريط تبويبات المركز الرئيسي (فواتير وسندات فقط) -->
        <div class="doc-tpl-nav">
          <button type="button" class="doc-tpl-tab-btn ${activeHubTab === 'invoices' ? 'active' : ''}" data-hub-tab="invoices">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/></svg>
            قوالب فواتير المبيعات (${invoiceTemplates.length})
          </button>
          <button type="button" class="doc-tpl-tab-btn ${activeHubTab === 'vouchers' || activeHubTab === 'documents' ? 'active' : ''}" data-hub-tab="vouchers">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            قوالب المستندات والسندات (${voucherTemplates.length})
          </button>
        </div>

        <!-- شريط البحث السريع والرفع -->
        ${raw(searchBarHtml)}

        <!-- محتوى التبويب النشط -->
        ${raw(contentHtml)}
      </div>
    `;

    attachEvents();
    if (activeHubTab === 'print') {
      updateLivePreview();
    }
  }

  function generateZatcaTlvBase64(sellerName, vatNumber, dateStr, total, vatTotal) {
    try {
      const enc = new TextEncoder();
      const fields = [
        { tag: 1, val: enc.encode(sellerName || '') },
        { tag: 2, val: enc.encode(vatNumber || '') },
        { tag: 3, val: enc.encode(dateStr || new Date().toISOString()) },
        { tag: 4, val: enc.encode(String(Number(total || 0).toFixed(2))) },
        { tag: 5, val: enc.encode(String(Number(vatTotal || 0).toFixed(2))) },
      ];
      let totalLen = 0;
      fields.forEach((f) => { totalLen += 2 + f.val.length; });
      const buf = new Uint8Array(totalLen);
      let offset = 0;
      fields.forEach((f) => {
        buf[offset++] = f.tag;
        buf[offset++] = f.val.length;
        buf.set(f.val, offset);
        offset += f.val.length;
      });
      let binary = '';
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
      return btoa(binary);
    } catch {
      return '';
    }
  }

  function resolvePreviewEntities(tpl) {
    const isDocOrVoucher = tpl?.category === 'documents' || tpl?.category === 'vouchers' || (tpl?.badge && tpl.badge.includes('سند'));
    if (isDocOrVoucher) {
      return {
        issuerToUse: {
          name_ar: 'اسم الشركة',
          name_en: 'Company Name',
          tax_number: 'الرقم الضريبي',
          commercial_register: 'السجل التجاري',
          building_no: '',
          street: 'العنوان الوطني',
          district: '',
          city: '',
          address_en: 'National Address',
          phone: 'رقم الهاتف / الجوال',
          mobile: 'رقم الهاتف / الجوال',
        },
        clientToUse: {
          name: 'اسم العميل',
          tax_number: 'الرقم الضريبي للعميل',
          commercial_register: 'السجل التجاري للعميل',
          address: 'عنوان العميل',
          phone: '',
        },
        invToRender: {
          voucher_number: 'رقم السند',
          invoice_number: 'رقم السند',
          voucher_date: 'تاريخ السند',
          issue_date: 'تاريخ السند',
          grand_total: 'المبلغ',
          amount_in_words: 'المبلغ بالحروف',
          notes: 'ملاحظات وبيان السند',
          status: 'ISSUED',
          status_label: 'معتمدة',
        },
      };
    }

    let invStatus = currentInvoice.status;
    if (invoiceState === 'cancelled') invStatus = 'CANCELLED';
    else if (invoiceState === 'draft') invStatus = 'DRAFT';

    const snap = tpl?.style_meta?.snapshot;
    let issuerToUse = activeIssuer;
    let clientToUse = liveClients[0] || mockClient;

    let invToRender = {
      ...currentInvoice,
      status: invStatus,
      status_label: invStatus === 'CANCELLED' ? 'ملغاة' : invStatus === 'DRAFT' ? 'مسودة' : (currentInvoice.status_label || 'معتمدة'),
      zatca_phase: activeZatcaPhase,
      signature_mode: activeZatcaPhase === 'PHASE2' ? 'LOCAL' : 'NONE',
    };

    if (snap && (snap.seller || snap.invoice)) {
      let sName = snap.seller?.name_ar || '';
      let sTax = snap.seller?.tax_number || '';
      let sCr = snap.seller?.commercial_register || '';
      let sAddr = snap.seller?.address || '';

      if (snap.seller && typeof snap.seller === 'object') {
        for (const [k, v] of Object.entries(snap.seller)) {
          if (!v || typeof v !== 'string') continue;
          const lk = k.toLowerCase();
          if (!sName && (lk.includes('اسم') || lk.includes('منشأة') || lk.includes('شركة') || lk.includes('مؤسسة') || lk.includes('name') || lk.includes('seller') || lk.includes('المورد'))) sName = v;
          if (!sTax && (lk.includes('ضريب') || lk.includes('vat') || lk.includes('tax'))) sTax = v;
          if (!sCr && (lk.includes('سجل') || lk.includes('cr'))) sCr = v;
          if (!sAddr && (lk.includes('عنوان') || lk.includes('address') || lk.includes('حي') || lk.includes('طريق'))) sAddr = v;
        }
      }
      if (!sName) {
        sName = tpl?.name_ar || activeIssuer.name_ar;
      }

      let bName = snap.buyer?.name || '';
      let bTax = snap.buyer?.tax_number || '';
      let bAddr = snap.buyer?.address || '';
      if (snap.buyer && typeof snap.buyer === 'object') {
        for (const [k, v] of Object.entries(snap.buyer)) {
          if (!v || typeof v !== 'string') continue;
          const lk = k.toLowerCase();
          if (!bName && (lk.includes('اسم') || lk.includes('عميل') || lk.includes('مشتري') || lk.includes('buyer') || lk.includes('client'))) bName = v;
          if (!bTax && (lk.includes('ضريب') || lk.includes('vat') || lk.includes('tax'))) bTax = v;
          if (!bAddr && (lk.includes('عنوان') || lk.includes('address') || lk.includes('حي'))) bAddr = v;
        }
      }
      if (!bName) bName = mockClient.name;

      issuerToUse = {
        ...activeIssuer,
        name_ar: sName || activeIssuer.name_ar,
        name_en: activeIssuer.name_en || '',
        tax_number: sTax || activeIssuer.tax_number,
        commercial_register: sCr || activeIssuer.commercial_register,
        building_no: '',
        street: sAddr || activeIssuer.street || '',
        district: '',
        city: '',
        address_en: '',
      };

      clientToUse = {
        ...mockClient,
        name: bName || mockClient.name,
        tax_number: bTax || mockClient.tax_number,
        commercial_register: snap.buyer?.cr || '',
        address: bAddr || mockClient.address,
      };

      const dateStr = (snap.invoice?.issue_date || new Date().toISOString().slice(0, 10)) + 'T14:30:00Z';
      const grandTotal = snap.invoice?.grand_total ?? currentInvoice.grand_total;
      const taxAmount = snap.invoice?.tax_amount ?? currentInvoice.tax_amount;

      const qrPayload = generateZatcaTlvBase64(
        sName || activeIssuer.name_ar,
        sTax || activeIssuer.tax_number,
        dateStr,
        grandTotal,
        taxAmount
      );

      let mergedLines = currentInvoice.lines;
      if (snap.invoice?.lines && snap.invoice.lines.length) {
        mergedLines = snap.invoice.lines.map((sl, idx) => {
          const fallbackLine = currentInvoice.lines[idx % currentInvoice.lines.length] || {};
          return {
            ...fallbackLine,
            ...sl,
            line_no: idx + 1,
            item_name: sl['item_name'] || sl['السلعة أو الخدمة'] || sl['الصنف'] || sl['الوصف'] || fallbackLine.item_name,
            quantity: Number(sl['quantity'] || sl['الكمية'] || fallbackLine.quantity) || 1,
            unit_price: Number(sl['unit_price'] || sl['سعر الوحدة'] || sl['السعر'] || fallbackLine.unit_price) || 100,
            total_line: Number(sl['total_line'] || sl['الإجمالي شامل الضريبة'] || sl['الإجمالي'] || fallbackLine.total_line) || 115,
            tax_amount: Number(sl['tax_amount'] || sl['قيمة الضريبة'] || fallbackLine.tax_amount) || 15,
            taxable: Number(sl['taxable'] || sl['الصافي قبل الضريبة'] || fallbackLine.taxable) || 100,
          };
        });
      }

      invToRender = {
        ...invToRender,
        invoice_number: snap.invoice?.invoice_number || currentInvoice.invoice_number,
        issue_date: snap.invoice?.issue_date || currentInvoice.issue_date,
        payment_label: snap.invoice?.payment_label || currentInvoice.payment_label,
        seller_name: sName || activeIssuer.name_ar,
        seller_name_en: activeIssuer.name_en || '',
        seller_tax_number: sTax || activeIssuer.tax_number,
        seller_cr: sCr || activeIssuer.commercial_register,
        seller_address: sAddr || activeIssuer.address,
        buyer_name: bName || mockClient.name,
        buyer_tax_number: bTax || mockClient.tax_number,
        buyer_address: bAddr || mockClient.address,
        subtotal: snap.invoice?.subtotal ?? currentInvoice.subtotal,
        discount_amount: snap.invoice?.discount_amount ?? currentInvoice.discount_amount,
        taxable_amount: snap.invoice?.taxable_amount ?? currentInvoice.taxable_amount,
        tax_amount: taxAmount,
        grand_total: grandTotal,
        paid_amount: grandTotal,
        remaining_amount: 0,
        qr_payload: qrPayload || currentInvoice.qr_payload,
        lines: mergedLines,
      };
    }

    return { issuerToUse, clientToUse, invToRender };
  }

  const templateHtmlCache = new Map();

  function getTemplateLoadingHtml(title = 'جارٍ تحميل وتجهيز قالب الفاتورة...') {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      min-height: 297mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
      background: #ffffff;
      color: #334155;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3.5px solid #e2e8f0;
      border-top-color: #0d9488;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .title {
      margin-top: 16px;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
    }
    .sub {
      margin-top: 6px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="title">${title}</div>
  <div class="sub">يتم تجهيز المستند وفق قالب Excel المعتمد الحقيقي...</div>
</body>
</html>`;
  }

  function updateLivePreview() {
    const iframe = $('#preview-iframe', view);
    if (!iframe) return;

    const tpl = excelTemplates.find((t) => t.id === printCfg.template_style);
    if (tpl) {
      printCfg.template_title = tpl.name_ar || tpl.name;
      printCfg.headers = tpl.headers || [];
      printCfg.header_fill = tpl.style_meta?.header_fill || tpl.color_hex;
      printCfg.banner_text = tpl.style_meta?.banner_text || '';
      printCfg.banner_fill = tpl.style_meta?.banner_fill || tpl.style_meta?.header_fill || '';
      printCfg.primary_color = tpl.color_hex || printCfg.primary_color || '#0d9488';
    }

    const { issuerToUse, clientToUse, invToRender } = resolvePreviewEntities(tpl);

    const fallbackHtml = () => invoicePreviewDoc({
      invoice: invToRender,
      issuer: issuerToUse,
      client: clientToUse,
      printSettings: printCfg,
      qrSettings: qrCfg,
    });

    if (tpl && tpl.id) {
      if (templateHtmlCache.has(tpl.id)) {
        iframe.srcdoc = templateHtmlCache.get(tpl.id);
        return;
      }
      iframe.srcdoc = getTemplateLoadingHtml(`جارٍ تحميل قالب: ${tpl.name_ar || tpl.name}`);
      fetch(`/api/invoices/templates/${encodeURIComponent(tpl.id)}/render-html`)
        .then((r) => r.ok ? r.text() : null)
        .then((realHtml) => {
          if (realHtml && iframe) {
            const filledHtml = fillDynamicTemplateHtml(realHtml, {
              issuer: issuerToUse,
              client: clientToUse,
              invoice: invToRender,
              preview: true,
            });
            templateHtmlCache.set(tpl.id, filledHtml);
            iframe.srcdoc = filledHtml;
          } else if (iframe) {
            iframe.srcdoc = fallbackHtml();
          }
        })
        .catch(() => {
          if (iframe) iframe.srcdoc = fallbackHtml();
        });
    } else {
      iframe.srcdoc = fallbackHtml();
    }
  }

  function openFullscreenPreview(tplOverride = null) {
    const tpl = tplOverride || excelTemplates.find((t) => t.id === printCfg.template_style);
    const previewPrintCfg = { ...printCfg };
    if (tpl) {
      previewPrintCfg.template_style = tpl.id;
      previewPrintCfg.template_title = tpl.name_ar || tpl.name;
      previewPrintCfg.headers = tpl.headers || [];
      previewPrintCfg.alignments = tpl.style_meta?.alignments || [];
      previewPrintCfg.header_fill = tpl.style_meta?.header_fill || tpl.color_hex;
      previewPrintCfg.banner_text = tpl.style_meta?.banner_text || '';
      previewPrintCfg.banner_fill = tpl.style_meta?.banner_fill || tpl.style_meta?.header_fill || '';
      previewPrintCfg.primary_color = tpl.color_hex || previewPrintCfg.primary_color || '#0d9488';
      previewPrintCfg.dark_color = tpl.style_meta?.header_fill || tpl.color_hex;
    }

    const { issuerToUse, clientToUse, invToRender } = resolvePreviewEntities(tpl);

    let docHtml = '';
    const fallbackHtml = () => invoicePreviewDoc({
      invoice: invToRender,
      issuer: issuerToUse,
      client: clientToUse,
      printSettings: previewPrintCfg,
      qrSettings: qrCfg,
    });

    const m = modal({
      title: `معاينة الفاتورة: ${tpl?.name_ar || activeIssuer.name_ar}`,
      wide: true,
      body: html`
        <div style="background:#0b101c; padding:1.5rem; border-radius:8px; display:flex; justify-content:center; overflow:auto; max-height:78vh;">
          <div style="background:#fff; width:210mm; min-height:297mm; box-shadow:0 10px 40px rgba(0,0,0,0.6); border-radius:4px; overflow:hidden;">
            <iframe id="fullscreen-iframe" style="width:100%; height:100%; min-height:850px; border:none; display:block; background:#fff;"></iframe>
          </div>
        </div>
      `,
      footer: html`
        <div class="flex gap" style="justify-content:space-between; width:100%;">
          <div class="flex gap-xs">
            <button class="btn btn-primary" id="btn-modal-print" type="button" style="display:inline-flex;align-items:center;gap:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
              طباعة الآن
            </button>
            <button class="btn" id="btn-modal-pdf" type="button" style="display:inline-flex;align-items:center;gap:4px;">
              PDF ⤓
            </button>
          </div>
          <button class="btn" data-close type="button">إغلاق</button>
        </div>
      `,
    });

    const fIframe = $('#fullscreen-iframe', m.el);
    if (tpl && tpl.id) {
      if (templateHtmlCache.has(tpl.id)) {
        docHtml = templateHtmlCache.get(tpl.id);
        if (fIframe) fIframe.srcdoc = docHtml;
      } else {
        if (fIframe) fIframe.srcdoc = getTemplateLoadingHtml(`جارٍ تحميل ومعاينة قالب: ${tpl.name_ar || tpl.name}`);
        fetch(`/api/invoices/templates/${encodeURIComponent(tpl.id)}/render-html`)
          .then((r) => r.ok ? r.text() : null)
          .then((realHtml) => {
            if (realHtml && fIframe) {
              const filledHtml = fillDynamicTemplateHtml(realHtml, {
                issuer: issuerToUse,
                client: clientToUse,
                invoice: invToRender,
                preview: true,
              });
              templateHtmlCache.set(tpl.id, filledHtml);
              docHtml = filledHtml;
              fIframe.srcdoc = filledHtml;
            } else if (fIframe) {
              docHtml = fallbackHtml();
              fIframe.srcdoc = docHtml;
            }
          })
          .catch(() => {
            docHtml = fallbackHtml();
            if (fIframe) fIframe.srcdoc = docHtml;
          });
      }
    } else {
      docHtml = fallbackHtml();
      if (fIframe) fIframe.srcdoc = docHtml;
    }

    $('#btn-modal-print', m.el)?.addEventListener('click', () => {
      printDoc(docHtml);
    });

    $('#btn-modal-pdf', m.el)?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await downloadPdfFromHtml(docHtml, `${tpl?.id || 'invoice'}_preview.pdf`);
      } catch (err) {
        toastErr('فشل تصدير ملف PDF: ' + (err.message || err));
      } finally {
        e.currentTarget.disabled = false;
      }
    });
  }

  async function openVoucherFullscreenPreview(tplId) {
    const tpl = excelTemplates.find((t) => t.id === tplId) || { id: tplId, name_ar: 'سند قبض' };

    // عرض قالب السند بمسميات الحقول العامة (اسم الشركة، اسم العميل، إلخ) بدلاً من الاسم المباشر
    const placeholderIssuer = {
      name_ar: 'اسم الشركة',
      name_en: 'Company Name',
      tax_number: 'الرقم الضريبي',
      commercial_register: 'السجل التجاري',
      building_no: '',
      street: 'العنوان الوطني',
      district: '',
      city: '',
      address_en: 'National Address',
      phone: 'رقم الهاتف / الجوال',
      mobile: 'رقم الهاتف / الجوال',
    };
    const placeholderClient = {
      name: 'اسم العميل',
      tax_number: 'الرقم الضريبي للعميل',
      commercial_register: 'السجل التجاري للعميل',
      address: 'عنوان العميل',
    };
    const placeholderVoucher = {
      voucher_number: 'رقم السند',
      voucher_date: 'تاريخ السند',
      total_amount: 'المبلغ',
      amount_in_words: 'المبلغ بالحروف',
      payment_label: 'طريقة السداد',
      reference_no: 'رقم المرجع',
      notes: 'ملاحظات وبيان السند',
    };

    let docHtml = '';
    try {
      const res = await fetch(`/api/invoices/templates/${encodeURIComponent(tplId)}/render-html`);
      if (res.ok) {
        const rawHtml = await res.text();
        if (rawHtml) {
          docHtml = fillDynamicTemplateHtml(rawHtml, {
            issuer: placeholderIssuer,
            client: placeholderClient,
            voucher: placeholderVoucher,
          });
        }
      }
    } catch {}

    if (!docHtml) {
      docHtml = voucherPrint({ voucher: placeholderVoucher, issuer: placeholderIssuer, client: placeholderClient, style: tplId });
    }

    const m = modal({
      title: `معاينة سند القبض: ${tpl.name_ar || tpl.name || tplId}`,
      wide: true,
      body: html`
        <div style="background:#0b101c; padding:1.5rem; border-radius:8px; display:flex; justify-content:center; overflow:auto; max-height:78vh;">
          <div style="background:#fff; width:210mm; min-height:297mm; box-shadow:0 10px 40px rgba(0,0,0,0.6); border-radius:4px; overflow:hidden;">
            <iframe id="fullscreen-voucher-iframe" style="width:100%; height:100%; min-height:850px; border:none; display:block; background:#fff;"></iframe>
          </div>
        </div>
      `,
      footer: html`
        <div class="flex gap" style="justify-content:space-between; width:100%;">
          <div class="flex gap-xs">
            <button class="btn btn-primary" id="btn-modal-print-voucher" type="button" style="display:inline-flex;align-items:center;gap:4px;">
              طباعة الآن
            </button>
            <button class="btn" id="btn-modal-pdf-voucher" type="button" style="display:inline-flex;align-items:center;gap:4px;">
              PDF ⤓
            </button>
          </div>
          <button class="btn" data-close type="button">إغلاق</button>
        </div>
      `,
    });
    const ifr = $('#fullscreen-voucher-iframe', m.el);
    if (ifr) ifr.srcdoc = docHtml;
    $('#btn-modal-print-voucher', m.el)?.addEventListener('click', () => printDoc(docHtml));
    $('#btn-modal-pdf-voucher', m.el)?.addEventListener('click', () => downloadPdfFromHtml(docHtml, `معاينة-سند-${tplId}.pdf`));
  }

  // معاينة بصرية للتقرير كصورة ومستند رسمي A4
  function buildVisualReportDocHtml({ tpl, issuer, items, isVouchers = false }) {
    const isLandscape = (tpl.headers || []).length > 6;
    const pageOrientation = isLandscape ? 'A4 landscape' : 'A4 portrait';
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-SA');
    const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

    let headers = tpl.headers || [];
    let rows = [];
    let totals = {};

    if (isVouchers) {
      if (!headers.length) {
        headers = ['رقم السند', 'تاريخ الإصدار', 'اسم العميل', 'المبلغ (ر.س)', 'طريقة الدفع', 'المخصص للفواتير', 'البيان'];
      }
      const voucherList = Array.isArray(items) ? items : [];
      let sumAmount = 0;
      rows = voucherList.map((v, idx) => {
        sumAmount += Number(v.amount || 0);
        return [
          v.voucher_number || `REC-${idx + 1}`,
          v.issue_date || '',
          v.client_name || '',
          Number(v.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          v.payment_method_label || v.payment_method || '',
          Number(v.allocated_amount || v.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          v.notes || '',
        ];
      });
      totals = { count: voucherList.length, total: sumAmount };
    } else {
      if (!headers.length) {
        headers = ['رقم الفاتورة', 'تاريخ الإصدار', 'العميل', 'الرقم الضريبي للعميل', 'قبل الضريبة', 'الخصم', 'ضريبة 15%', 'الإجمالي شامل الضريبة', 'المسدد', 'المتبقي', 'الحالة'];
      }
      const invList = Array.isArray(items) ? items : [];
      let sumSubtotal = 0, sumTax = 0, sumTotal = 0;
      rows = invList.map((inv) => {
        sumSubtotal += Number(inv.subtotal || 0);
        sumTax += Number(inv.tax_amount || 0);
        sumTotal += Number(inv.grand_total || 0);
        return [
          inv.invoice_number || '',
          inv.issue_date || '',
          inv.client_name || '',
          inv.client_tax_number || '',
          Number(inv.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          Number(inv.discount_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          Number(inv.tax_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          Number(inv.grand_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          Number(inv.paid_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          Number(inv.remaining_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          inv.status_label || inv.status || 'معتمدة',
        ];
      });
      totals = { count: invList.length, subtotal: sumSubtotal, tax: sumTax, total: sumTotal };
    }

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${esc(tpl.name_ar || tpl.name)}</title>
  <style>
    @page { size: ${pageOrientation}; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: "Segoe UI", Tahoma, "Cairo", Arial, sans-serif;
      color: #0f172a;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid #0d9488;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .sheet-title h1 {
      margin: 0 0 4px;
      font-size: 16pt;
      color: #0f766e;
      font-weight: 800;
    }
    .sheet-title p {
      margin: 0;
      font-size: 9.5pt;
      color: #475569;
    }
    .sheet-meta {
      text-align: left;
      direction: ltr;
      font-size: 8.5pt;
      color: #64748b;
      line-height: 1.5;
    }
    .kpi-row {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .kpi-box {
      flex: 1;
      min-width: 120px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 12px;
      text-align: center;
    }
    .kpi-box .val {
      font-size: 13pt;
      font-weight: 800;
      color: #0f766e;
      margin-top: 2px;
    }
    .kpi-box .lbl {
      font-size: 8pt;
      color: #64748b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      margin-bottom: 16px;
    }
    th {
      background: #0f766e;
      color: #fff;
      padding: 7px 8px;
      text-align: right;
      font-weight: 700;
      border: 1px solid #0d9488;
    }
    td {
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
      text-align: right;
    }
    tr:nth-child(even) td {
      background: #f8fafc;
    }
    .num {
      text-align: left;
      direction: ltr;
      font-variant-numeric: tabular-nums;
      font-family: Consolas, monospace, sans-serif;
    }
    .stamps {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      padding-top: 14px;
      border-top: 1px dashed #cbd5e1;
      font-size: 8.5pt;
      color: #64748b;
    }
    .stamp-box {
      text-align: center;
      width: 180px;
      height: 75px;
      border: 1px dashed #94a3b8;
      border-radius: 6px;
      padding-top: 8px;
    }
    .footer-note {
      text-align: center;
      margin-top: 20px;
      font-size: 8pt;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="sheet-head">
    <div class="sheet-title">
      <h1>${esc(tpl.name_ar || tpl.name)}</h1>
      <p>المنشأة: <b>${esc(issuer.name_ar)}</b> — الرقم الضريبي: <span style="direction:ltr; display:inline-block;">${esc(issuer.tax_number || '')}</span></p>
    </div>
    <div class="sheet-meta">
      <div><b>Raseen Document Report</b></div>
      <div>Date: ${dateStr} ${timeStr}</div>
      <div>Template: ${esc(tpl.id)}.xlsx</div>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi-box">
      <div class="lbl">${isVouchers ? 'إجمالي عدد السندات' : 'إجمالي عدد الفواتير'}</div>
      <div class="val">${totals.count}</div>
    </div>
    ${totals.subtotal !== undefined ? `
      <div class="kpi-box">
        <div class="lbl">المبلغ قبل الضريبة</div>
        <div class="val num">${totals.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س</div>
      </div>
    ` : ''}
    ${totals.tax !== undefined ? `
      <div class="kpi-box">
        <div class="lbl">إجمالي الضريبة (15%)</div>
        <div class="val num">${totals.tax.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س</div>
      </div>
    ` : ''}
    <div class="kpi-box">
      <div class="lbl">${isVouchers ? 'إجمالي مبالغ التحصيل' : 'الإجمالي شامل الضريبة'}</div>
      <div class="val num">${totals.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        ${headers.map((h) => `<th>${esc(h)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.length > 0 ? rows.map((r) => `
        <tr>
          ${r.map((cell, cIdx) => `<td class="${cIdx >= 3 && !isNaN(String(cell).replace(/,/g, '')) ? 'num' : ''}">${esc(cell)}</td>`).join('')}
        </tr>
      `).join('') : `
        <tr>
          <td colspan="${headers.length}" style="text-align: center; padding: 24px; color: #94a3b8;">
            لا توجد سجلات مسجلة حالياً لعرضها في هذا التقرير
          </td>
        </tr>
      `}
    </tbody>
  </table>

  ${tpl.style_meta?.footer_text ? `
  <div class="footer-note" style="border-top:1px solid #cbd5e1;margin-top:20px;padding-top:10px;text-align:center;font-size:8pt;color:#64748b;">
    ${esc(tpl.style_meta.footer_text)}
  </div>` : ''}
</body>
</html>`;
  }

  async function openVisualReportPreviewModal(tpl) {
    const isVouchers = tpl.category === 'vouchers' || tpl.id.includes('voucher');
    let items = [];
    try {
      if (isVouchers) {
        const res = await api.get(`/api/vouchers?issuer_id=${encodeURIComponent(activeIssuer.id)}&limit=25`);
        items = Array.isArray(res) ? res : (res?.data || []);
      } else {
        const res = await api.get(`/api/invoices?issuer_id=${encodeURIComponent(activeIssuer.id)}&limit=25`);
        items = Array.isArray(res) ? res : (res?.items || res?.data || []);
      }
    } catch { items = []; }

    const docHtml = buildVisualReportDocHtml({
      tpl,
      issuer: activeIssuer,
      items,
      isVouchers,
    });

    let currentZoom = 80;

    const m = modal({
      title: `معاينة بصرية للمستند: ${tpl.name_ar || tpl.name}`,
      wide: true,
      body: html`
        <div style="padding:0.2rem 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem; background:rgba(255,255,255,0.03); padding:0.6rem 0.9rem; border-radius:8px; border:1px solid var(--line); flex-wrap:wrap; gap:0.5rem;">
            <div class="flex gap" style="align-items:center;">
              <span class="badge green" style="font-weight:700;">معاينة A4 رسمية كصورة مستند طبق الأصل</span>
              <span class="tiny muted">المنشأة: ${esc(activeIssuer.name_ar)}</span>
            </div>
            <div class="flex gap-xs" style="align-items:center;">
              <div class="tpl-zoom-controls" style="margin:0;">
                <button type="button" class="tpl-zoom-btn" id="modal-zoom-out" title="تصغير">−</button>
                <span class="tpl-zoom-val" id="modal-zoom-text">${currentZoom}%</span>
                <button type="button" class="tpl-zoom-btn" id="modal-zoom-in" title="تكبير">+</button>
              </div>
              <button class="btn btn-sm btn-primary" id="btn-modal-print-doc" type="button" style="display:inline-flex; align-items:center; gap:4px; font-size:0.78rem;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
                طباعة الآن
              </button>
              <button class="btn btn-sm" id="btn-modal-pdf-doc" type="button" style="display:inline-flex; align-items:center; gap:4px; font-size:0.78rem;">
                PDF ⤓
              </button>
            </div>
          </div>

          <div style="background:#0b101c; border:1px solid var(--line); border-radius:8px; padding:1.2rem; display:flex; justify-content:center; overflow:auto; max-height:72vh;">
            <div id="modal-paper-wrapper" style="transform: scale(${currentZoom / 100}); transform-origin: top center; transition: transform 0.15s ease;">
              <div style="background:#fff; width:210mm; min-height:297mm; box-shadow:0 12px 40px rgba(0,0,0,0.65); border-radius:4px; overflow:hidden;">
                <iframe id="modal-doc-iframe" style="width:100%; height:100%; min-height:920px; border:none; display:block; background:#fff;"></iframe>
              </div>
            </div>
          </div>
        </div>
      `,
      footer: html`
        <div class="flex gap" style="justify-content:space-between; width:100%;">
          <a class="btn" href="/api/invoices/template?style=${esc(tpl.id)}&format=xlsx" target="_blank" download="template_${esc(tpl.id)}.xlsx" style="display:inline-flex; align-items:center; gap:5px; font-size:0.8rem;">
            تنزيل ملف الإكسل (.xlsx) ⤓
          </a>
          <button class="btn btn-primary" data-close type="button">إغلاق المعاينة</button>
        </div>
      `,
    });

    const iframe = $('#modal-doc-iframe', m.el);
    if (iframe) iframe.srcdoc = docHtml;

    const updateZoom = (z) => {
      currentZoom = Math.max(40, Math.min(130, z));
      const zText = $('#modal-zoom-text', m.el);
      const pWrap = $('#modal-paper-wrapper', m.el);
      if (zText) zText.textContent = `${currentZoom}%`;
      if (pWrap) pWrap.style.transform = `scale(${currentZoom / 100})`;
    };

    $('#modal-zoom-in', m.el)?.addEventListener('click', () => updateZoom(currentZoom + 10));
    $('#modal-zoom-out', m.el)?.addEventListener('click', () => updateZoom(currentZoom - 10));

    $('#btn-modal-print-doc', m.el)?.addEventListener('click', () => {
      printDoc(docHtml);
    });

    $('#btn-modal-pdf-doc', m.el)?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await downloadPdfFromHtml(docHtml, `${tpl.id}_report.pdf`);
      } catch (err) {
        toastErr('فشل تحميل ملف PDF: ' + err.message);
      } finally {
        e.currentTarget.disabled = false;
      }
    });
  }

  // نافذة فحص خلايا وأعمدة القالب
  function showTemplateInspectionModal(tpl, inspectionData = null) {
    const isHtmlTpl = tpl.badge?.includes('HTML') || (tpl.file_path && tpl.file_path.endsWith('.html')) || (tpl.headers || []).length === 0;
    const headers = inspectionData?.headers || tpl.headers || [];
    const sampleRows = inspectionData?.samplePreviewRows || inspectionData?.sampleRows || tpl.style_meta?.sample_rows || [];
    const seller = inspectionData?.metadata?.seller || tpl.style_meta?.seller || tpl.style_meta?.snapshot?.seller || {};
    const buyer = inspectionData?.metadata?.buyer || tpl.style_meta?.buyer || tpl.style_meta?.snapshot?.buyer || {};
    const merges = inspectionData?.layoutMerges || tpl.style_meta?.merges || [];
    const color = tpl.color_hex || tpl.style_meta?.accent_color || tpl.style_meta?.header_fill || '#06b6d4';

    const sellerEntries = Object.entries(seller).filter(([k, v]) => v && typeof v === 'string');
    const buyerEntries = Object.entries(buyer).filter(([k, v]) => v && typeof v === 'string');

    let customDetailsHtml = '';
    if (isHtmlTpl) {
      // استخراج الحقول والوسوم الديناميكية المكتشفة تلقائياً من ملف القالب مباشرة
      const rawDiscovered = (tpl.headers && tpl.headers.length)
        ? tpl.headers
        : (inspectionData?.detected_placeholders || inspectionData?.headers || []);

      const detectedList = rawDiscovered.map((tag) => {
        return String(tag).startsWith('{{') ? tag : `{{${tag}}}`;
      });

      customDetailsHtml = `
        <div class="card" style="background:rgba(6,182,212,0.06); border:1px solid rgba(6,182,212,0.3); border-radius:8px; padding:0.85rem; margin-bottom:1rem;">
          <div style="font-size:0.9rem; font-weight:800; color:#38bdf8; margin-bottom:0.4rem; display:flex; align-items:center; gap:6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            اكتشاف تلقائي كامل لوسوم وحقول القالب
          </div>
          <div class="tiny muted" style="line-height:1.4;">
            يقوم النظام بقراءة وتحليل ملف القالب برمجياً، واستخراج كافة المتغيرات والحقول الموجودة في كود القالب تلقائياً دون الحاجة لأي تعريف يدوي مسبق.
          </div>
        </div>

        <div style="margin-bottom:1rem;">
          <b style="display:block; font-size:0.86rem; margin-bottom:0.5rem; color:#fff;">الوسوم والمتغيرات المكتشفة تلقائياً من القالب (${detectedList.length}):</b>
          ${detectedList.length ? `
            <div class="grid grid-2" style="gap:6px;">
              ${detectedList.map((tag) => `
                <div style="background:rgba(255,255,255,0.03); border:1px solid var(--line); border-radius:6px; padding:7px 10px; display:flex; justify-content:space-between; align-items:center;">
                  <span class="ltr font-mono" style="color:var(--primary); font-size:0.82rem; font-weight:700;">${esc(tag)}</span>
                  <span class="tiny muted" style="color:#94a3b8;">حقل ديناميكي تلقائي</span>
                </div>
              `).join('')}
            </div>
          ` : '<p class="tiny muted">لم يتم العثور على وسوم {{...}} في ملف القالب.</p>'}
        </div>
      `;
    } else {
      const snapBoxHtml = (sellerEntries.length || buyerEntries.length) ? `
        <div class="card" style="background:rgba(6,182,212,0.06); border:1px solid rgba(6,182,212,0.3); border-radius:8px; padding:0.8rem; margin-bottom:1rem;">
          <div style="font-size:0.88rem; font-weight:800; color:#38bdf8; margin-bottom:0.5rem; display:flex; align-items:center; gap:6px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>
            البيانات الفعلية المكتشفة تلقائياً من ملف الإكسل
          </div>
          <div class="grid grid-2" style="gap:8px; font-size:0.8rem;">
            <div style="background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:6px; border:1px solid var(--line);">
              <b style="color:#e2e8f0; display:block; margin-bottom:4px; font-size:0.82rem;">بيانات المنشأة (البائع):</b>
              ${sellerEntries.map(([k, v]) => `<div style="margin-bottom:3px;"><span class="tiny muted">${esc(k)}:</span> <b style="color:var(--primary); font-size:0.8rem;">${esc(v)}</b></div>`).join('') || '<span class="tiny muted">لا توجد بيانات</span>'}
            </div>
            <div style="background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:6px; border:1px solid var(--line);">
              <b style="color:#e2e8f0; display:block; margin-bottom:4px; font-size:0.82rem;">بيانات العميل (المشتري):</b>
              ${buyerEntries.map(([k, v]) => `<div style="margin-bottom:3px;"><span class="tiny muted">${esc(k)}:</span> <b style="color:#38bdf8; font-size:0.8rem;">${esc(v)}</b></div>`).join('') || '<span class="tiny muted">لا توجد بيانات</span>'}
            </div>
          </div>
        </div>
      ` : '';

      const headersChipsHtml = headers.map((h, i) => `
        <div style="background:rgba(6,182,212,0.12); border:1px solid rgba(6,182,212,0.3); padding:4px 9px; border-radius:6px; font-size:0.75rem; color:#e2e8f0; display:flex; align-items:center; gap:5px;">
          <span style="opacity:0.6; font-size:0.68rem;">#${i + 1}</span>
          <b>${esc(h)}</b>
        </div>
      `).join('');

      const mergesHtml = merges.length ? `
        <div style="margin-bottom:1rem;">
          <b style="display:block; font-size:0.86rem; margin-bottom:0.4rem; color:#fff;">الخلايا المدمجة المكتشفة في القالب (${merges.length}):</b>
          <div class="flex gap-xs" style="flex-wrap:wrap; max-height:100px; overflow-y:auto;">
            ${merges.map(m => `<span class="badge tiny" style="background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.3); color:#94a3b8; font-family:monospace;">${esc(m)}</span>`).join('')}
          </div>
        </div>
      ` : '';

      const sampleTableHtml = sampleRows && sampleRows.length ? `
        <div style="margin-top:1rem;">
          <b style="display:block; font-size:0.86rem; margin-bottom:0.4rem; color:#fff;">معاينة عينة من صفوف البنود (${sampleRows.length} صفوف):</b>
          <div style="overflow-x:auto; border:1px solid var(--line); border-radius:6px;">
            <table class="table tiny" style="margin:0;">
              <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
              <tbody>
                ${sampleRows.map((r) => `<tr>${r.map((cell) => `<td>${esc(cell || '')}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : '';

      customDetailsHtml = `
        ${snapBoxHtml ? snapBoxHtml : ''}
        <div style="margin-bottom:1rem;">
          <b style="display:block; font-size:0.86rem; margin-bottom:0.5rem; color:#fff;">أعمدة الجدول المكتشفة تلقائياً (${headers.length}):</b>
          ${headers.length ? `<div class="flex gap-xs" style="flex-wrap:wrap;">${headersChipsHtml}</div>` : '<p class="tiny muted">لا توجد أعمدة محددة أو الملف غير مهيأ.</p>'}
        </div>
        ${mergesHtml ? mergesHtml : ''}
        ${sampleTableHtml ? sampleTableHtml : ''}
      `;
    }

    const inspModal = modal({
      title: `فحص واكتشاف تفاصيل القالب: ${tpl.name_ar || tpl.name || 'قالب'}`,
      wide: true,
      body: html`
        <div style="padding:0.4rem 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; background:rgba(255,255,255,0.03); padding:0.8rem; border-radius:8px; border:1px solid var(--line); flex-wrap:wrap; gap:0.5rem;">
            <div>
              <div style="font-size:0.95rem; font-weight:800; color:#fff;">${esc(tpl.name_ar || tpl.name)}</div>
              <div class="tiny muted" style="margin-top:3px;">المسار الفعلي: <span class="ltr font-mono" style="color:var(--primary);">${esc(tpl.file_path || tpl.id + (isHtmlTpl ? '.html' : '.xlsx'))}</span></div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge tiny" style="display:inline-flex; align-items:center; gap:5px; background:rgba(255,255,255,0.05); border:1px solid var(--line);">
                <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${color};"></span>
                <span style="font-family:monospace; color:${color}; font-weight:700;">${color}</span>
              </span>
              <span class="badge green" style="font-weight:700;">جاهز للاستخدام ✓</span>
            </div>
          </div>

          ${raw(customDetailsHtml)}

          <div class="card tiny mt" style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); border-radius:6px; padding:0.6rem 0.8rem; margin-bottom:0;">
            <span style="color:#34d399; font-weight:700;">✓ نظام القوالب الديناميكي المباشر:</span>
            <span class="muted"> يتم استخراج البيانات والقالب مباشرة من القرص بدون أي وسائط ثابتة. أي تعديل ينعكس فورياً.</span>
          </div>
        </div>
      `,
      footer: html`
        <div class="flex gap" style="justify-content:space-between; width:100%;">
          ${(tpl.category === 'documents' || tpl.category === 'vouchers') ? `
            <button class="btn btn-sm btn-info" id="btn-insp-preview-voucher" type="button" style="display:inline-flex; align-items:center; gap:5px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              معاينة السند الآن
            </button>
          ` : '<div></div>'}
          <button class="btn btn-primary" data-close type="button">إغلاق</button>
        </div>
      `,
    });

    $('#btn-insp-preview-voucher', inspModal.el)?.addEventListener('click', () => {
      inspModal.close();
      openVoucherFullscreenPreview(tpl.id);
    });
  }

  // نافذة توليد وتصدير تقرير المستندات بالبيانات الحقيقية
  function openGenerateReportModal(tpl) {
    const isVouchers = tpl.category === 'vouchers' || tpl.id.includes('voucher');
    const headersChipsHtml = (tpl.headers || []).map((h, i) => `<span class="doc-tpl-chip green"><span style="opacity:0.6;">#${i + 1}</span> ${esc(h)}</span>`).join('');

    const m = modal({
      title: `توليد وتصدير تقرير: ${tpl.name_ar || tpl.name}`,
      wide: true,
      body: html`
        <div style="padding:0.4rem 0;">
          <div class="card" style="background:rgba(6,182,212,0.06); border:1px solid rgba(6,182,212,0.25); padding:0.9rem; border-radius:8px; margin-bottom:1.2rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
              <div>
                <b style="color:#fff; font-size:0.95rem;">${esc(tpl.name_ar || tpl.name)}</b>
                <div class="tiny muted" style="margin-top:2px;">قالب Excel نشط ومطابق لقواعد النظام: <span class="ltr font-mono" style="color:var(--primary);">${esc(tpl.id)}.xlsx</span></div>
              </div>
              <span class="badge green" style="font-weight:700;">تصدير بيانات حقيقية</span>
            </div>
          </div>

          <div class="row" style="margin-bottom:1rem;">
            <div class="field" style="flex:1;">
              <label style="font-weight:700; color:#fff;">الشركة المصدرة *</label>
              <select id="gen-rep-issuer" style="width:100%;">
                ${raw(issuers.map((iss) => `<option value="${esc(iss.id)}"${iss.id === activeIssuer.id ? ' selected' : ''}>${esc(iss.name_ar)} (${esc(iss.code)})</option>`).join(''))}
              </select>
            </div>
          </div>

          <div class="row" style="margin-bottom:0.8rem;">
            <div class="field" style="flex:1;">
              <label style="font-weight:700; color:#fff;">من تاريخ</label>
              <input type="date" id="gen-rep-from" value="${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)}" />
            </div>
            <div class="field" style="flex:1;">
              <label style="font-weight:700; color:#fff;">إلى تاريخ</label>
              <input type="date" id="gen-rep-to" value="${new Date().toISOString().slice(0, 10)}" />
            </div>
          </div>

          <div class="flex gap-sm" style="margin-bottom:1.2rem; align-items:center;">
            <span class="tiny muted" style="font-weight:700;">فترات سريعة:</span>
            <button type="button" class="btn btn-sm btn-quick-date" data-range="month">هذا الشهر</button>
            <button type="button" class="btn btn-sm btn-quick-date" data-range="quarter">هذا الربع</button>
            <button type="button" class="btn btn-sm btn-quick-date" data-range="year">هذه السنة</button>
            <button type="button" class="btn btn-sm btn-quick-date" data-range="all">كل الفترات</button>
          </div>

          <div class="card tiny" style="background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px; padding:0.75rem;">
            <div style="font-weight:700; color:#fff; margin-bottom:6px;">الأعمدة المدرجة في التقرير المستخرج (${(tpl.headers || []).length}):</div>
            <div class="flex gap-xs" style="flex-wrap:wrap;">
              ${raw(headersChipsHtml)}
            </div>
          </div>
        </div>
      `,
      footer: html`
        <div class="flex gap" style="justify-content:space-between; width:100%;">
          <button class="btn" data-close type="button">إلغاء</button>
          <button class="btn btn-primary" id="btn-run-export-excel" type="button" style="display:inline-flex; align-items:center; gap:6px; font-weight:700; background:linear-gradient(135deg, #059669, #047857); border-color:#34d399; color:#fff;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            تصدير تقرير Excel معبأ بالبيانات (.xls)
          </button>
        </div>
      `,
    });

    $$('.btn-quick-date', m.el).forEach((btn) => {
      btn.addEventListener('click', () => {
        const range = btn.dataset.range;
        const now = new Date();
        const fromInp = $('#gen-rep-from', m.el);
        const toInp = $('#gen-rep-to', m.el);
        if (range === 'month') {
          fromInp.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
          toInp.value = now.toISOString().slice(0, 10);
        } else if (range === 'quarter') {
          const qMonth = Math.floor(now.getMonth() / 3) * 3;
          fromInp.value = new Date(now.getFullYear(), qMonth, 1).toISOString().slice(0, 10);
          toInp.value = now.toISOString().slice(0, 10);
        } else if (range === 'year') {
          fromInp.value = `${now.getFullYear()}-01-01`;
          toInp.value = now.toISOString().slice(0, 10);
        } else if (range === 'all') {
          fromInp.value = '';
          toInp.value = '';
        }
      });
    });

    $('#btn-run-export-excel', m.el)?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = 'جارٍ استخراج وتعبئة البيانات...';
      try {
        const issuerId = $('#gen-rep-issuer', m.el).value;
        const from = $('#gen-rep-from', m.el).value;
        const to = $('#gen-rep-to', m.el).value;
        const iss = issuers.find((i) => i.id === issuerId) || activeIssuer;

        if (isVouchers) {
          let url = `/api/vouchers?issuer_id=${encodeURIComponent(issuerId)}`;
          if (from) url += `&date_from=${encodeURIComponent(from)}`;
          if (to) url += `&date_to=${encodeURIComponent(to)}`;
          const res = await api.get(url);
          const rowsData = Array.isArray(res) ? res : (res?.data || []);

          const headers = ['رقم السند', 'تاريخ الإصدار', 'اسم العميل', 'المبلغ (ر.س)', 'طريقة الدفع', 'المخصص للفواتير', 'البيان والملاحظات'];
          let totalAmount = 0;
          const rows = rowsData.map((v) => {
            totalAmount += Number(v.amount || 0);
            return [
              v.voucher_number || '',
              v.issue_date || '',
              v.client_name || '',
              v.amount !== undefined ? Number(v.amount).toFixed(2) : '0.00',
              v.payment_method_label || v.payment_method || '',
              v.allocated_amount !== undefined ? Number(v.allocated_amount).toFixed(2) : '0.00',
              v.notes || '',
            ];
          });
          const footer = ['الإجمالي', '', '', totalAmount.toFixed(2), '', '', ''];
          exportExcel(
            `تقرير_سندات_القبض_${new Date().toISOString().slice(0, 10)}`,
            `تقرير سندات القبض — ${iss.name_ar}`,
            headers,
            rows,
            { footer, subtitle: `الفترة: ${from || 'البداية'} إلى ${to || 'الآن'} — الشركة: ${iss.name_ar}` }
          );
          toastOk(`تم تصدير ${rows.length} سند قبض بنجاح!`);
        } else {
          let url = `/api/invoices?issuer_id=${encodeURIComponent(issuerId)}&limit=1000`;
          if (from) url += `&date_from=${encodeURIComponent(from)}`;
          if (to) url += `&date_to=${encodeURIComponent(to)}`;
          const res = await api.get(url);
          const invList = Array.isArray(res) ? res : (res?.items || res?.data || []);

          const headers = ['رقم الفاتورة', 'تاريخ الإصدار', 'العميل', 'الرقم الضريبي للعميل', 'قبل الضريبة', 'الخصم', 'ضريبة 15%', 'الإجمالي شامل الضريبة', 'المسدد', 'المتبقي', 'طريقة الدفع', 'الحالة'];
          let sumSubtotal = 0, sumDiscount = 0, sumTax = 0, sumTotal = 0, sumPaid = 0, sumRem = 0;
          const rows = invList.map((inv) => {
            sumSubtotal += Number(inv.subtotal || 0);
            sumDiscount += Number(inv.discount_amount || 0);
            sumTax += Number(inv.tax_amount || 0);
            sumTotal += Number(inv.grand_total || 0);
            sumPaid += Number(inv.paid_amount || 0);
            sumRem += Number(inv.remaining_amount || 0);
            return [
              inv.invoice_number || '',
              inv.issue_date || '',
              inv.client_name || '',
              inv.client_tax_number || '',
              Number(inv.subtotal || 0).toFixed(2),
              Number(inv.discount_amount || 0).toFixed(2),
              Number(inv.tax_amount || 0).toFixed(2),
              Number(inv.grand_total || 0).toFixed(2),
              Number(inv.paid_amount || 0).toFixed(2),
              Number(inv.remaining_amount || 0).toFixed(2),
              inv.payment_method_label || inv.payment_method || '',
              inv.status_label || inv.status || '',
            ];
          });
          const footer = [
            'الإجمالي', '', '', '',
            sumSubtotal.toFixed(2),
            sumDiscount.toFixed(2),
            sumTax.toFixed(2),
            sumTotal.toFixed(2),
            sumPaid.toFixed(2),
            sumRem.toFixed(2),
            '', ''
          ];
          exportExcel(
            `تقرير_الفواتير_المعتمد_${new Date().toISOString().slice(0, 10)}`,
            `ملخص وقائمة الفواتير المعتمد — ${iss.name_ar}`,
            headers,
            rows,
            { footer, subtitle: `الفترة: ${from || 'البداية'} إلى ${to || 'الآن'} — الشركة: ${iss.name_ar}` }
          );
          toastOk(`تم تصدير ${rows.length} فاتورة بنجاح وفق القالب المعتمد!`);
        }
        m.close();
      } catch (err) {
        toastErr('فشل تصدير التقرير: ' + (err.message || err));
      } finally {
        btn.disabled = false;
        btn.textContent = 'تصدير تقرير Excel معبأ بالبيانات (.xls)';
      }
    });
  }

  // رفع القوالب الذكي
  async function handleExcelUpload(file, categoryHint = 'auto') {
    if (!file) return;
    if (!/\.(html|htm|xlsx|xls)$/i.test(file.name)) {
      toastErr('يرجى اختيار ملف قالب بصيغة .html أو .xlsx');
      return;
    }

    const defaultName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(',')[1];
          let inspection = null;
          try {
            const inspRes = await api.post('/api/invoices/templates/inspect', {
              filename: file.name,
              file_base64: base64,
            });
            inspection = inspRes?.data || inspRes;
          } catch (err) {
            console.warn('Inspection note:', err);
          }

          const detectedHeaders = inspection?.headers || [];
          const detectedMeta = inspection?.metadata || inspection?.metadataFields || {};
          const detectedTitleVal = inspection?.detectedTitle || inspection?.title;
          const suggestedTitle = (detectedTitleVal && detectedTitleVal.length < 60) ? detectedTitleVal : defaultName;

          let detectedCategory = categoryHint;
          if (detectedCategory === 'auto') {
            const nameLower = file.name.toLowerCase();
            if (nameLower.includes('report') || nameLower.includes('summary') || nameLower.includes('تقرير') || nameLower.includes('ملخص')) {
              detectedCategory = 'reports';
            } else if (nameLower.includes('voucher') || nameLower.includes('receipt') || nameLower.includes('سند') || nameLower.includes('قبض')) {
              detectedCategory = 'vouchers';
            } else {
              detectedCategory = 'invoices';
            }
          }

          const detectedHeadersChipsHtml = detectedHeaders.map((h, i) => `
            <div style="background:rgba(255,255,255,0.04); border:1px solid var(--line); padding:3px 8px; border-radius:5px; font-size:0.75rem; color:#e2e8f0;">
              <span style="opacity:0.6; font-size:0.68rem;">#${i + 1}</span> ${esc(h)}
            </div>
          `).join('');

          const uploadModal = modal({
            title: 'فحص واكتشاف قالب Excel ذكي جديد',
            wide: true,
            body: html`
              <div style="padding:0.4rem 0;">
                <div class="card" style="background:rgba(6,182,212,0.06); border:1px solid rgba(6,182,212,0.25); padding:0.8rem; border-radius:8px; margin-bottom:1rem;">
                  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
                    <div>
                      <b style="color:#fff; font-size:0.92rem;">ملف الإكسل:</b>
                      <span class="ltr font-mono" style="color:var(--primary); margin-inline-start:6px;">${esc(file.name)}</span>
                    </div>
                    <span class="badge green" style="font-weight:700;">اكتشاف فوري وتلقائي</span>
                  </div>
                </div>

                <div class="field" style="margin-bottom:1rem;">
                  <label style="font-weight:700; color:#fff;">اسم القالب المعروض في النظام *</label>
                  <input type="text" id="inp-tpl-name" value="${esc(suggestedTitle)}" placeholder="مثال: قالب تقرير المبيعات المعتمد" style="width:100%; font-size:0.9rem;" required />
                </div>

                <div class="field" style="margin-bottom:1rem;">
                  <label style="font-weight:700; color:#fff;">تصنيف القالب *</label>
                  <select id="sel-tpl-category" style="width:100%;">
                    <option value="invoices"${detectedCategory !== 'vouchers' ? ' selected' : ''}>قالب فاتورة مبيعات (Sales Invoice)</option>
                    <option value="vouchers"${detectedCategory === 'vouchers' ? ' selected' : ''}>قالب سند قبض (Receipt Voucher)</option>
                  </select>
                </div>

                <div style="margin-bottom:1rem;">
                  <b style="display:block; font-size:0.84rem; margin-bottom:0.4rem; color:#fff;">الأعمدة المكتشفة تلقائياً في ملف Excel (${detectedHeaders.length}):</b>
                  ${detectedHeaders.length ? raw(`<div class="flex gap-xs" style="flex-wrap:wrap;">${detectedHeadersChipsHtml}</div>`) : '<p class="tiny muted">تم قراءة بنية القالب وسيتم حفظه واعتماده تلقائياً.</p>'}
                </div>
              </div>
            `,
            footer: html`
              <div class="flex gap" style="justify-content:space-between; width:100%;">
                <button class="btn" data-close type="button">إلغاء</button>
                <button class="btn btn-primary" id="btn-confirm-upload" type="button" style="display:inline-flex; align-items:center; gap:5px; font-weight:700;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  حفظ واعتماد القالب
                </button>
              </div>
            `,
          });

          $('#btn-confirm-upload', uploadModal.el)?.addEventListener('click', async () => {
            const chosenName = $('#inp-tpl-name', uploadModal.el)?.value.trim() || suggestedTitle;
            const chosenCategory = $('#sel-tpl-category', uploadModal.el)?.value || 'invoices';
            const uploadBtn = $('#btn-confirm-upload', uploadModal.el);
            uploadBtn.disabled = true;
            uploadBtn.textContent = 'جارٍ الحفظ والمزامنة...';

            try {
              const res = await api.post('/api/invoices/templates/upload', {
                filename: file.name,
                file_base64: base64,
                category: chosenCategory,
                name_ar: chosenName,
              });

              toastOk(`تم رفع واعتماد قالب «${chosenName}» بنجاح!`);
              uploadModal.close();

              if (chosenCategory === 'vouchers') activeHubTab = 'vouchers';
              else activeHubTab = 'invoices';

              templateHtmlCache.clear();
              await loadTemplates();
              renderView();
            } catch (err) {
              toastErr('فشل حفظ القالب: ' + err.message);
              uploadBtn.disabled = false;
              uploadBtn.textContent = 'حفظ واعتماد القالب';
            }
          });
        } catch (err) {
          toastErr('فشل فحص ملف القالب: ' + err.message);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      toastErr('حدث خطأ أثناء قراءة الملف: ' + err.message);
    }
  }

  function attachEvents() {
    // تبديل تبويبات المركز
    $$('.doc-tpl-tab-btn', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        activeHubTab = btn.dataset.hubTab;
        window.location.hash = `#/templates?tab=${activeHubTab}`;
        renderView();
      });
    });

    // البحث الفوري
    const searchInp = $('#inp-hub-search', view);
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderView();
        const newInp = $('#inp-hub-search', view);
        if (newInp) {
          newInp.focus();
          newInp.setSelectionRange(newInp.value.length, newInp.value.length);
        }
      });
    }

    // رفع القالب العام
    $('#file-upload-global', view)?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleExcelUpload(file, 'auto');
      e.target.value = '';
    });

    // رفع القالب المخصص للتبويب
    $$('.file-upload-tab-specific', view).forEach((input) => {
      input.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handleExcelUpload(file, activeHubTab);
        e.target.value = '';
      });
    });

    // توليد التقرير المعتمد
    $$('.btn-generate-report', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        const tplId = btn.dataset.tplId;
        const tpl = excelTemplates.find((t) => t.id === tplId);
        if (!tpl) return;
        openGenerateReportModal(tpl);
      });
    });

    // معاينة الفاتورة كصورة ومستند A4 رسمي
    $$('.btn-visual-invoice-modal', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        const tplId = btn.dataset.tplId;
        const tpl = excelTemplates.find((t) => t.id === tplId);
        if (!tpl) return;
        openFullscreenPreview(tpl);
      });
    });

    // معاينة بصرية للمستند/التقرير/السند كصورة ومستند رسمي A4
    $$('.btn-visual-preview', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        const tplId = btn.dataset.tplId;
        const tpl = excelTemplates.find((t) => t.id === tplId);
        if (!tpl) return;
        if (tpl.category === 'invoices') {
          openFullscreenPreview(tpl);
        } else {
          openVisualReportPreviewModal(tpl);
        }
      });
    });

    // فحص خلايا القالب
    $$('.btn-inspect-tpl', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        const tplId = btn.dataset.tplId;
        const tpl = excelTemplates.find((t) => t.id === tplId);
        if (!tpl) return;
        showTemplateInspectionModal(tpl);
      });
    });

    // اختيار قالب معتمد
    $$('.btn-select-template', view).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tplId = btn.dataset.tplId;
        const tpl = excelTemplates.find((t) => t.id === tplId);
        printCfg.template_style = tplId;
        if (tpl) {
          printCfg.headers = tpl.headers || [];
          printCfg.alignments = tpl.style_meta?.alignments || [];
          printCfg.header_fill = tpl.style_meta?.header_fill || tpl.color_hex;
          printCfg.banner_text = tpl.style_meta?.banner_text || '';
          printCfg.banner_fill = tpl.style_meta?.banner_fill || tpl.style_meta?.header_fill || '';
          printCfg.primary_color = tpl.color_hex || printCfg.primary_color || '#0d9488';
          printCfg.dark_color = tpl.style_meta?.header_fill || tpl.color_hex;
          printCfg.light_color = tpl.style_meta?.light_color || tpl.style_meta?.banner_fill || '';
          printCfg.template_title = tpl.name_ar || tpl.name;
        }
        try {
          await api.put(`/api/issuers/${activeIssuer.id}`, {
            ...activeIssuer,
            print_settings: printCfg,
            qr_settings: qrCfg,
          });
          activeIssuer.print_settings = printCfg;
          toastOk(`تم اعتماد قالب «${tpl?.name_ar || tplId}» رسمياً للمنشأة وحفظ الإعدادات بنجاح`);
        } catch (err) {
          toastErr('حدث خطأ أثناء حفظ اعتماد القالب: ' + err.message);
        }
        renderView();
      });
    });

    // معاينة الفاتورة في نافذة بصرية كصورة A4
    $$('.btn-visual-invoice-modal', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        const tplId = btn.dataset.tplId;
        const tpl = excelTemplates.find((t) => t.id === tplId);
        openFullscreenPreview(tpl);
      });
    });

    // اعتماد قالب سند قبض
    $$('.btn-select-voucher-template', view).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tplId = btn.dataset.tplId;
        const tpl = excelTemplates.find((t) => t.id === tplId);
        printCfg.voucher_template_style = tplId;
        try {
          await api.put(`/api/issuers/${activeIssuer.id}`, {
            ...activeIssuer,
            print_settings: printCfg,
            qr_settings: qrCfg,
          });
          activeIssuer.print_settings = printCfg;
          toastOk(`تم اعتماد قالب «${tpl?.name_ar || tplId}» رسمياً لسندات القبض وحفظ الإعدادات بنجاح`);
        } catch (err) {
          toastErr('حدث خطأ أثناء حفظ اعتماد القالب: ' + err.message);
        }
        renderView();
      });
    });

    // معاينة سند القبض في نافذة بصرية كصورة A4
    $$('.btn-visual-voucher-modal', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        const tplId = btn.dataset.tplId;
        openVoucherFullscreenPreview(tplId).catch((err) => {
          console.error('Voucher preview error:', err);
          toastErr('فشل عرض معاينة السند: ' + (err.message || err));
        });
      });
    });

    // معاينة في استوديو الطباعة
    $$('.btn-preview-in-print', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        const tplId = btn.dataset.tplId;
        const tpl = excelTemplates.find((t) => t.id === tplId);
        printCfg.template_style = tplId;
        if (tpl) {
          printCfg.headers = tpl.headers || [];
          printCfg.header_fill = tpl.style_meta?.header_fill || tpl.color_hex;
          printCfg.banner_text = tpl.style_meta?.banner_text || '';
          printCfg.banner_fill = tpl.style_meta?.banner_fill || tpl.style_meta?.header_fill || '';
          printCfg.primary_color = tpl.color_hex || printCfg.primary_color || '#0d9488';
          printCfg.template_title = tpl.name_ar || tpl.name;
        }
        activeHubTab = 'print';
        renderView();
      });
    });

    // حذف قالب
    $$('.btn-delete-tpl', view).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tplId = btn.dataset.tplId;
        const tplName = btn.dataset.tplName || tplId;
        if (!confirm(`هل أنت متأكد من حذف قالب «${tplName}» نهائياً؟`)) return;
        try {
          await api.del(`/api/invoices/templates/${tplId}`);
          toastOk(`تم حذف قالب «${tplName}»`);
          if (printCfg.template_style === tplId) {
            printCfg.template_style = 'standard';
          }
          if (printCfg.voucher_template_style === tplId) {
            printCfg.voucher_template_style = '';
          }
          await api.put(`/api/issuers/${activeIssuer.id}`, {
            ...activeIssuer,
            print_settings: printCfg,
            qr_settings: qrCfg,
          }).catch(() => {});
          await loadTemplates();
          renderView();
        } catch (err) {
          toastErr('فشل حذف القالب: ' + err.message);
        }
      });
    });

    // إعادة مزامنة القوالب مع القرص
    $('#btn-reset-templates', view)?.addEventListener('click', async () => {
      try {
        await api.post('/api/invoices/templates/reset');
        await loadTemplates();
        renderView();
        toastOk('تمت مزامنة وفحص القوالب من القرص بنجاح');
      } catch (err) {
        toastErr('فشل مزامنة القوالب: ' + err.message);
      }
    });

    // تبديل الشركة المصدرة
    $('#sel-issuer', view)?.addEventListener('change', async (e) => {
      const newId = e.target.value;
      try {
        activeIssuer = await api.get(`/api/issuers/${newId}`);
        activeZatcaPhase = activeIssuer.zatca_phase || 'PHASE1';
        printCfg = {
          template_style: 'standard',
          primary_color: '#06b6d4',
          dark_color: '#0891b2',
          light_color: '#ecfeff',
          font_family: 'Cairo',
          font_size: 'normal',
          logo_position: 'center',
          logo_size: 'medium',
          show_item_code: true,
          show_unit: true,
          show_currency_column: true,
          show_discount: true,
          show_taxable: true,
          show_tax_rate: true,
          show_tax_amount: true,
          striped_rows: true,
          show_bank: true,
          show_tafqeet: true,
          show_signatures: true,
          show_notes: true,
          qr_position: 'right',
          copies: 1,
          custom_css: '',
          ...(activeIssuer.print_settings || {}),
        };
        qrCfg = {
          show_a4: true,
          show_thermal: true,
          size: 'medium',
          scale: 4,
          thermal_scale: 3,
          ...(activeIssuer.qr_settings || {}),
        };
        await loadIssuerData();
        currentInvoice = getDynamicPreviewInvoice();
        renderView();
        toastOk(`تم تحميل بيانات: ${activeIssuer.name_ar}`);
      } catch (err) {
        toastErr('فشل تحميل المنشأة: ' + err.message);
      }
    });

    // حفظ الإعدادات للمنشأة
    $('#btn-save-settings', view)?.addEventListener('click', async () => {
      try {
        await api.put(`/api/issuers/${activeIssuer.id}`, {
          print_settings: printCfg,
          qr_settings: qrCfg,
        });
        toastOk('تم حفظ تخصيص الطباعة للمنشأة بنجاح');
      } catch (err) {
        toastErr('فشل حفظ الإعدادات: ' + err.message);
      }
    });

    // أدوات استوديو الطباعة إذا كان نشطاً
    if (activeHubTab === 'print') {
      $$('.tpl-tab-btn[data-print-subtab]', view).forEach((btn) => {
        btn.addEventListener('click', () => {
          printSubTab = btn.dataset.printSubtab;
          $$('.tpl-tab-btn[data-print-subtab]', view).forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          ['branding', 'columns', 'qr', 'footer', 'advanced'].forEach((name) => {
            const pane = $(`#subtab-pane-${name}`, view);
            if (pane) pane.style.display = name === printSubTab ? '' : 'none';
          });
        });
      });

      $('#btn-fullscreen', view)?.addEventListener('click', openFullscreenPreview);
      $('#btn-print-test', view)?.addEventListener('click', () => {
        const iframe = $('#preview-iframe', view);
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.print();
        } else {
          openFullscreenPreview();
        }
      });

      // ألوان الهوية
      $$('.color-swatch', view).forEach((swatch) => {
        swatch.addEventListener('click', () => {
          $$('.color-swatch', view).forEach((s) => s.classList.remove('active'));
          swatch.classList.add('active');
          printCfg.primary_color = swatch.dataset.color;
          printCfg.dark_color = swatch.dataset.dark;
          printCfg.light_color = swatch.dataset.light;
          const colorInput = $('#ctrl-color', view);
          const hexInput = $('#ctrl-color-hex', view);
          const darkInput = $('#ctrl-color-dark', view);
          const darkHexInput = $('#ctrl-color-dark-hex', view);
          if (colorInput) colorInput.value = printCfg.primary_color;
          if (hexInput) hexInput.value = printCfg.primary_color;
          if (darkInput) darkInput.value = printCfg.dark_color;
          if (darkHexInput) darkHexInput.value = printCfg.dark_color;
          updateLivePreview();
        });
      });

      $('#ctrl-color', view)?.addEventListener('input', (e) => {
        printCfg.primary_color = e.target.value;
        const hex = $('#ctrl-color-hex', view);
        if (hex) hex.value = e.target.value;
        updateLivePreview();
      });
      $('#ctrl-color-hex', view)?.addEventListener('change', (e) => {
        printCfg.primary_color = e.target.value.trim();
        updateLivePreview();
      });

      $('#ctrl-font', view)?.addEventListener('change', (e) => {
        printCfg.font_family = e.target.value;
        updateLivePreview();
      });
      $('#ctrl-logo-size', view)?.addEventListener('change', (e) => {
        printCfg.logo_size = e.target.value;
        updateLivePreview();
      });

      // رفع شعار
      $('#file-logo-input', view)?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const dataUrl = ev.target.result;
          try {
            await api.put(`/api/issuers/${activeIssuer.id}`, { logo_data: dataUrl });
            activeIssuer.logo_data = dataUrl;
            toastOk('تم تحديث شعار المنشأة بنجاح');
            renderView();
          } catch (err) {
            toastErr('فشل تحديث الشعار: ' + err.message);
          }
        };
        reader.readAsDataURL(file);
      });

      $('#btn-remove-logo', view)?.addEventListener('click', async () => {
        try {
          await api.put(`/api/issuers/${activeIssuer.id}`, { logo_data: null });
          activeIssuer.logo_data = null;
          toastOk('تمت إزالة الشعار');
          renderView();
        } catch (err) {
          toastErr('فشل إزالة الشعار: ' + err.message);
        }
      });

      $$('.btn-apply-logo-preset', view).forEach((btn) => {
        btn.addEventListener('click', async () => {
          const pId = btn.dataset.logoId;
          const p = PRESET_LOGOS.find((x) => x.id === pId);
          if (!p) return;
          try {
            await api.put(`/api/issuers/${activeIssuer.id}`, { logo_data: p.svg });
            activeIssuer.logo_data = p.svg;
            toastOk(`تم تطبيق نموذج شعار «${p.name}»`);
            renderView();
          } catch (err) {
            toastErr('فشل تطبيق النموذج: ' + err.message);
          }
        });
      });

      // إعدادات الأعمدة
      [
        ['col-code', 'show_item_code'],
        ['col-unit', 'show_unit'],
        ['col-currency', 'show_currency_column'],
        ['col-discount', 'show_discount'],
        ['col-taxable', 'show_taxable'],
        ['col-tax-rate', 'show_tax_rate'],
        ['col-tax-amount', 'show_tax_amount'],
        ['col-striped', 'striped_rows'],
      ].forEach(([id, prop]) => {
        const el = $(`#${id}`, view);
        if (el) el.addEventListener('change', (e) => {
          printCfg[prop] = e.target.checked;
          updateLivePreview();
        });
      });

      // إعدادات التذييل
      [
        ['ft-bank', 'show_bank'],
        ['ft-tafqeet', 'show_tafqeet'],
        ['ft-signatures', 'show_signatures'],
        ['ft-notes', 'show_notes'],
      ].forEach(([id, prop]) => {
        const el = $(`#${id}`, view);
        if (el) el.addEventListener('change', (e) => {
          printCfg[prop] = e.target.checked;
          updateLivePreview();
        });
      });

      // محاكاة الزكاة والـ QR
      $('#ctrl-zatca-phase', view)?.addEventListener('change', (e) => {
        activeZatcaPhase = e.target.value;
        currentInvoice = buildMockInvoice(activeIssuer, activeZatcaPhase);
        updateLivePreview();
      });
      $('#qr-a4', view)?.addEventListener('change', (e) => {
        qrCfg.show_a4 = e.target.checked;
        updateLivePreview();
      });
      $('#qr-thermal', view)?.addEventListener('change', (e) => {
        qrCfg.show_thermal = e.target.checked;
        updateLivePreview();
      });

      // تخصيص CSS
      $('#ctrl-custom-css', view)?.addEventListener('input', (e) => {
        printCfg.custom_css = e.target.value;
        updateLivePreview();
      });


      // التكبير والتصغير
      $('#zoom-in', view)?.addEventListener('click', () => {
        if (zoomLevel < 120) {
          zoomLevel += 8;
          $('#zoom-text', view).textContent = `${zoomLevel}%`;
          const frame = $('#paper-frame', view);
          if (frame) frame.style.transform = `scale(${zoomLevel / 100})`;
        }
      });
      $('#zoom-out', view)?.addEventListener('click', () => {
        if (zoomLevel > 35) {
          zoomLevel -= 8;
          $('#zoom-text', view).textContent = `${zoomLevel}%`;
          const frame = $('#paper-frame', view);
          if (frame) frame.style.transform = `scale(${zoomLevel / 100})`;
        }
      });
      $('#zoom-fit', view)?.addEventListener('click', () => {
        zoomLevel = 62;
        $('#zoom-text', view).textContent = '62%';
        const frame = $('#paper-frame', view);
        if (frame) frame.style.transform = 'scale(0.62)';
      });
    }
  }

  // فحص تلقائي وتحديث حي عند عودة التركيز للنافذة عند إضافة أي ملفات جديدة بالقرص
  let isCheckingLive = false;
  const onFocusOrVisible = async () => {
    if (document.hidden || isCheckingLive) return;
    isCheckingLive = true;
    try {
      const prevIds = excelTemplates.map((t) => t.id).sort().join(',');
      await loadTemplates();
      const newIds = excelTemplates.map((t) => t.id).sort().join(',');
      if (prevIds !== newIds) {
        renderView();
      }
    } finally {
      isCheckingLive = false;
    }
  };
  window.addEventListener('focus', onFocusOrVisible);
  document.addEventListener('visibilitychange', onFocusOrVisible);

  renderView();
  return undefined;
}
