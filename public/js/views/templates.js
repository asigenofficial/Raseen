// ==========================================================================
//  استوديو قوالب الفواتير: رفع وتحميل القوالب بدقة كاملة، 8 قوالب، ومعاينة حية
// ==========================================================================
import { api } from '../core/api.js';
import { store, can } from '../core/store.js';
import {
  html, raw, esc, money, printDoc, download, modal, toastOk, toastErr, $, $$,
} from '../core/util.js';
import {
  invoiceA4, invoiceThermal, invoicePreviewDoc, INVOICE_TEMPLATES,
} from '../print/templates.js';

const PALETTES = [
  { name: 'تيل زيتي', color: '#0d9488', dark: '#0f766e', light: '#f0fdfa' },
  { name: 'أزرق ملكي', color: '#2563eb', dark: '#1d4ed8', light: '#eff6ff' },
  { name: 'كحلي داكن', color: '#1e3a8a', dark: '#172554', light: '#f8fafc' },
  { name: 'أخضر زمردي', color: '#059669', dark: '#047857', light: '#ecfdf5' },
  { name: 'رمادي فحمي', color: '#334155', dark: '#1e293b', light: '#f8fafc' },
  { name: 'عنابي راقٍ', color: '#991b1b', dark: '#7f1d1d', light: '#fef2f2' },
  { name: 'بنفسجي تقني', color: '#7c3aed', dark: '#6d28d9', light: '#f5f3ff' },
  { name: 'برتقالي دافئ', color: '#d97706', dark: '#b45309', light: '#fffbeb' },
];

const PRESET_TEMPLATES = [
  {
    id: 'preset-tech',
    title: 'شركات التقنية والبرمجيات',
    style: 'modern',
    color: '#2563eb',
    dark: '#1d4ed8',
    light: '#eff6ff',
    font: 'Cairo',
    badge: 'تقني حديث',
    desc: 'تصميم أزرق ملكي عصري ببطاقات ناعمة وترويسة ملونة للحلول الرقمية.',
  },
  {
    id: 'preset-executive',
    title: 'المكاتب الاستشارية والقانونية',
    style: 'executive',
    color: '#d97706',
    dark: '#b45309',
    light: '#fffbeb',
    font: 'Cairo',
    badge: 'تنفيذي فاخر',
    desc: 'تصميم ذهبي تنفيذي برأسية ملكية عريضة وهوية رفيعة للمحاماة والاستشارات.',
  },
  {
    id: 'preset-contracting',
    title: 'المقاولات والإنشاءات الهندسية',
    style: 'grid',
    color: '#334155',
    dark: '#1e293b',
    light: '#f8fafc',
    font: 'Tahoma',
    badge: 'هندسي دقيق',
    desc: 'شبكة حدودية هندسية كاملة، توضح كل بند وكمية بدقة متناهية.',
  },
  {
    id: 'preset-trade',
    title: 'التجارة والتوريدات العامة',
    style: 'standard',
    color: '#059669',
    dark: '#047857',
    light: '#ecfdf5',
    font: 'Segoe UI',
    badge: 'رسمي معتمد',
    desc: 'قالب أخضر زمردي رسمي متطابق 100% مع متطلبات هيئة الزكاة والضريبة.',
  },
  {
    id: 'preset-medical',
    title: 'المراكز الطبية والصيدليات',
    style: 'minimal',
    color: '#0d9488',
    dark: '#0f766e',
    light: '#f0fdfa',
    font: 'Cairo',
    badge: 'بسيط وهادئ',
    desc: 'تصميم فائق النعومة بمساحات بيضاء مريحة وبدون إطارات داكنة.',
  },
  {
    id: 'preset-pos',
    title: 'نقاط البيع ومحلات التجزئة',
    style: 'thermal',
    color: '#1e293b',
    dark: '#0f172a',
    light: '#f8fafc',
    font: 'Cairo',
    badge: 'كاشير حراري 80mm',
    desc: 'إيصال حراري 80 مم سريع ونقي مع باركود ورمز QR متوافق.',
  },
];

function buildMockInvoice(issuer) {
  const cur = issuer.currency || 'SAR';
  return {
    id: 'mock-inv-1',
    invoice_number: `${issuer.invoice_prefix || 'INV'}-00108`,
    sequence_no: 108,
    invoice_type: 'STANDARD',
    uuid: '3c8129a0-9c2b-4e1a-821f-69e120fbd4a1',
    issue_date: new Date().toISOString().slice(0, 10),
    issue_time: '14:30:00',
    currency: cur,
    subtotal: 3850,
    discount_amount: 150,
    taxable_amount: 3700,
    tax_amount: 555,
    grand_total: 4255,
    paid_amount: 2000,
    remaining_amount: 2255,
    status: 'PARTIAL',
    status_label: 'مسددة جزئياً',
    payment_method: 'TRANSFER',
    payment_label: 'تحويل بنكي',
    seller_name: issuer.name_ar,
    seller_tax_number: issuer.tax_number || '300000000000003',
    seller_cr: issuer.commercial_register || '1010000000',
    seller_address: [issuer.building_no, issuer.street, issuer.district, issuer.city].filter(Boolean).join(' - ') || 'الرياض - المملكة العربية السعودية',
    buyer_name: 'شركة آفاق المستقبل للتجارة والمقاولات',
    buyer_tax_number: '310998877600003',
    buyer_cr: '1010887766',
    buyer_address: 'طريق الملك فهد - حي العليا - الرياض',
    qr_payload: 'AQtaU3lzdGVtIFNBBA8zMDAwMDAwMDAwMDAwMDMFEzIwMjYtMDktMDZUMTQ6MzA6MDBaBgQ0MjU1BwM1NTU=',
    invoice_hash: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
    signature_mode: issuer.zatca_phase === 'PHASE2' ? 'LOCAL' : 'NONE',
    notes: 'يتم السداد خلال 15 يوماً من تاريخ استلام الفاتورة الرسمية.',
    lines: [
      {
        line_no: 1,
        item_code: 'SRV-01',
        item_name: 'خدمات استشارية تقنية وتطوير نظم رقمية',
        unit: 'خدمة',
        quantity: 2,
        unit_price: 1200,
        discount: 100,
        taxable: 2300,
        tax_rate: 15,
        tax_amount: 345,
        total_line: 2645,
      },
      {
        line_no: 2,
        item_code: 'LIC-ERP',
        item_name: 'اشتراك سنوي ترخيص المنظومة السحابية',
        unit: 'سنة',
        quantity: 1,
        unit_price: 1450,
        discount: 50,
        taxable: 1400,
        tax_rate: 15,
        tax_amount: 210,
        total_line: 1610,
      },
    ],
  };
}

const mockClient = {
  id: 'mock-client-1',
  name: 'شركة آفاق المستقبل للتجارة والمقاولات',
  client_code: 'C-0008',
  tax_number: '310998877600003',
  address: 'طريق الملك فهد - حي العليا',
  city: 'الرياض',
  mobile: '0501234567',
  phone: '0112345678',
};

export async function render(view) {
  const issuers = await api.get('/api/issuers');
  if (!issuers || !issuers.length) {
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
    activeIssuer = await api.get(`/api/issuers/${activeIssuer.id}`);
  } catch { /* التراجع للمنشأة المتاحة */ }

  let recentInvoices = [];
  try {
    const invRes = await api.get(`/api/invoices?issuer_id=${encodeURIComponent(activeIssuer.id)}&limit=5`);
    recentInvoices = invRes.items || [];
  } catch { recentInvoices = []; }

  // قراءة إعدادات الطباعة الحالية
  let printCfg = {
    template_style: 'standard',
    primary_color: '#0d9488',
    dark_color: '#0f766e',
    light_color: '#f0fdfa',
    font_family: 'Cairo',
    font_size: 'normal',
    logo_position: 'right',
    logo_size: 'medium',
    show_item_code: true,
    show_unit: true,
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

  let qrCfg = {
    show_a4: true,
    show_thermal: true,
    size: 'medium',
    scale: 4,
    thermal_scale: 3,
    ...(activeIssuer.qr_settings || {}),
  };

  let activeFilter = 'all'; // all | a4 | pos
  let activeTab = 'branding';
  let zoomLevel = 90;
  let isSimulatedWatermark = false;
  let currentInvoice = buildMockInvoice(activeIssuer);
  let selectedInvoiceId = 'mock';

  function renderView() {
    const filteredTemplates = INVOICE_TEMPLATES.filter((tpl) => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'a4') return tpl.category === 'a4' || tpl.paper === 'A4';
      if (activeFilter === 'pos') return tpl.category === 'pos' || tpl.paper === '80mm';
      return true;
    });

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>قوالب الفواتير وتخصيص الطباعة</h1>
          <p>تخصيص سهل وفوري لقوالب الفواتير، رفع وتحميل القوالب الجاهزة بدقة كاملة، وتطبيقها للمنشأة بنقرة واحدة.</p>
        </div>
        <div class="page-actions">
          <div class="field" style="margin:0; min-width:210px;">
            <select id="sel-issuer">
              ${raw(issuers.map((iss) => `<option value="${esc(iss.id)}"${iss.id === activeIssuer.id ? ' selected' : ''}>${esc(iss.name_ar)} (${esc(iss.code)})</option>`).join(''))}
            </select>
          </div>
          <button class="btn" id="btn-presets" title="عرض نماذج قوالب جاهزة ومصممة لمختلف الأنشطة" type="button">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>نماذج جاهزة
          </button>
          <button class="btn" id="btn-download-json" title="تنزيل ملف القالب الحالي بصيغة JSON بدقة متكاملة" type="button">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>تحميل القالب
          </button>
          <button class="btn" id="btn-upload-json" title="رفع واستيراد ملف قالب JSON مجهز سابقاً" type="button">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>رفع قالب
          </button>
          <input type="file" id="file-template-upload" accept=".json,application/json" style="display:none;" />
          <button class="btn" id="btn-reset" title="استعادة الضبط الافتراضي للقالب" type="button">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>استعادة الافتراضي
          </button>
          <button class="btn btn-primary" id="btn-print-test" type="button">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>تجربة الطباعة
          </button>
          ${raw(can('issuers.write') ? '<button class="btn btn-success" id="btn-save" style="background:linear-gradient(135deg, #10b981, #059669); border-color:#34d399; color:#fff;" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>حفظ القالب للمنشأة</button>' : '')}
        </div>
      </div>

      <!-- الخطوة 1: اختيار نمط وتصميم الفاتورة -->
      <div class="tpl-section-title">
        <span class="tpl-section-badge">١</span>
        <span>اختر نمط وتصميم الفاتورة</span>
      </div>

      <!-- أزرار التصفية السريعة للقوالب -->
      <div class="tpl-filters">
        <button type="button" class="tpl-filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>جميع القوالب (${INVOICE_TEMPLATES.length})
        </button>
        <button type="button" class="tpl-filter-btn ${activeFilter === 'a4' ? 'active' : ''}" data-filter="a4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/></svg>فواتير A4 الضريبية (${INVOICE_TEMPLATES.filter((t) => t.category === 'a4' || t.paper === 'A4').length})
        </button>
        <button type="button" class="tpl-filter-btn ${activeFilter === 'pos' ? 'active' : ''}" data-filter="pos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><line x1="8" x2="16" y1="8" y2="8"/><line x1="8" x2="16" y1="12" y2="12"/><line x1="8" x2="12" y1="16" y2="16"/></svg>إيصالات الكاشير الحرارية (${INVOICE_TEMPLATES.filter((t) => t.category === 'pos' || t.paper === '80mm').length})
        </button>
      </div>

      <!-- معرض القوالب المنظم -->
      <div class="tpl-gallery">
        ${raw(filteredTemplates.map((tpl) => `
          <div class="tpl-card ${tpl.id === printCfg.template_style ? 'active' : ''}" data-style="${esc(tpl.id)}">
            <div class="tpl-card-head">
              <span class="tpl-card-icon">${raw(tpl.icon)}</span>
              <span class="tpl-card-badge">${esc(tpl.badge || tpl.paper)}</span>
            </div>
            <div>
              <div class="tpl-card-title">${esc(tpl.name)}</div>
              <p class="tpl-card-desc">${esc(tpl.desc)}</p>
            </div>
            <div style="margin-top:.8rem; padding-top:.6rem; border-top:1px solid var(--line); display:flex; justify-content:space-between; align-items:center;">
              <span class="tiny muted">${tpl.paper === '80mm' ? 'طابعة إيصالات 80mm' : 'صفحة A4 قياسية'}</span>
              <span class="badge ${tpl.id === printCfg.template_style ? 'green' : 'gray'}" style="font-size:.72rem;">
                ${tpl.id === printCfg.template_style ? raw('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:4px;"><polyline points="20 6 9 17 4 12"/></svg>القالب المعتمد') : 'اختيار القالب'}
              </span>
            </div>
          </div>
        `).join(''))}
      </div>

      <!-- الخطوة 2: لوحة التخصيص والمعاينة المباشرة -->
      <div class="tpl-section-title">
        <span class="tpl-section-badge">٢</span>
        <span>تخصيص الهوية والمعاينة الحية الفورية</span>
      </div>

      <div class="tpl-studio">
        <!-- لوحة التحكم السهلة على اليمين -->
        <div class="tpl-controls">
          <div class="tpl-tabs">
            <button class="tpl-tab-btn ${activeTab === 'branding' ? 'active' : ''}" data-tab="branding" type="button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>الهوية والألوان
            </button>
            <button class="tpl-tab-btn ${activeTab === 'columns' ? 'active' : ''}" data-tab="columns" type="button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>أعمدة الجدول
            </button>
            <button class="tpl-tab-btn ${activeTab === 'qr' ? 'active' : ''}" data-tab="qr" type="button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>الـ QR والفوترة
            </button>
            <button class="tpl-tab-btn ${activeTab === 'footer' ? 'active' : ''}" data-tab="footer" type="button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><path d="M20 19.5v-15A2.5 2.5 0 0 0 17.5 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5Z"/><path d="m8 10 2 2 4-4"/></svg>التذييل والتواقيع
            </button>
            <button class="tpl-tab-btn ${activeTab === 'advanced' ? 'active' : ''}" data-tab="advanced" type="button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:6px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>رفع وتحميل و CSS
            </button>
          </div>

          <div class="tpl-tab-pane">
            <!-- تبويب الهوية والألوان -->
            <div id="tab-pane-branding" style="${activeTab === 'branding' ? '' : 'display:none'}">
              <div class="field">
                <label>لوحات ألوان متناسقة جاهزة (بنقرة واحدة)</label>
                <div class="color-swatches">
                  ${raw(PALETTES.map((p) => `<button type="button" class="color-swatch ${p.color.toLowerCase() === (printCfg.primary_color || '').toLowerCase() ? 'active' : ''}" data-color="${p.color}" data-dark="${p.dark}" data-light="${p.light}" style="background:${p.color}" title="${p.name}"></button>`).join(''))}
                </div>
              </div>

              <div class="field mt">
                <label>اللون الرئيسي للهوية والترويسة</label>
                <div class="flex gap" style="align-items:center;">
                  <input type="color" id="ctrl-color" value="${esc(printCfg.primary_color || '#0d9488')}" style="width:48px; height:38px; padding:2px; border-radius:6px; cursor:pointer;" />
                  <input type="text" id="ctrl-color-hex" value="${esc(printCfg.primary_color || '#0d9488')}" class="ltr" style="max-width:130px;" />
                </div>
              </div>

              <div class="row mt">
                <div class="field">
                  <label>خط المستند العربي</label>
                  <select id="ctrl-font">
                    <option value="Cairo"${printCfg.font_family === 'Cairo' ? ' selected' : ''}>Cairo (عصري ومقروء)</option>
                    <option value="Segoe UI"${printCfg.font_family === 'Segoe UI' ? ' selected' : ''}>Segoe UI (قياسي ويندوز)</option>
                    <option value="Tahoma"${printCfg.font_family === 'Tahoma' ? ' selected' : ''}>Tahoma (رسمي كلاسيكي)</option>
                    <option value="Noto Naskh Arabic"${printCfg.font_family === 'Noto Naskh Arabic' ? ' selected' : ''}>Noto Naskh (نسخ عربي أصيل)</option>
                    <option value="Arial"${printCfg.font_family === 'Arial' ? ' selected' : ''}>Arial</option>
                  </select>
                </div>
                <div class="field">
                  <label>حجم الخط العام</label>
                  <select id="ctrl-font-size">
                    <option value="compact"${printCfg.font_size === 'compact' ? ' selected' : ''}>مدمج (Compact 8pt)</option>
                    <option value="normal"${printCfg.font_size === 'normal' || !printCfg.font_size ? ' selected' : ''}>قياسي (Standard 8.4pt)</option>
                    <option value="large"${printCfg.font_size === 'large' ? ' selected' : ''}>مريح / كبير (9.2pt)</option>
                  </select>
                </div>
              </div>

              <div class="row mt">
                <div class="field">
                  <label>موضع الشعار</label>
                  <select id="ctrl-logo-pos">
                    <option value="right"${printCfg.logo_position === 'right' || !printCfg.logo_position ? ' selected' : ''}>يمين (الافتراضي)</option>
                    <option value="left"${printCfg.logo_position === 'left' ? ' selected' : ''}>يسار</option>
                    <option value="none"${printCfg.logo_position === 'none' ? ' selected' : ''}>إخفاء الشعار</option>
                  </select>
                </div>
                <div class="field">
                  <label>حجم الشعار في الرأسية</label>
                  <select id="ctrl-logo-size">
                    <option value="small"${printCfg.logo_size === 'small' ? ' selected' : ''}>صغير (20mm)</option>
                    <option value="medium"${printCfg.logo_size === 'medium' || !printCfg.logo_size ? ' selected' : ''}>متوسط (28mm)</option>
                    <option value="large"${printCfg.logo_size === 'large' ? ' selected' : ''}>كبير (38mm)</option>
                  </select>
                </div>
              </div>

              ${raw(activeIssuer.has_logo ? '' : '<div class="alert alert-info mt tiny mb0">لم ترفع المنشأة شعاراً بعد؛ يتم استخدام اسم المنشأة تلقائياً كشعار بديل. يمكنك رفع شعار رسمي من شاشة «الشركات المصدرة».</div>')}
            </div>

            <!-- تبويب أعمدة الجدول -->
            <div id="tab-pane-columns" style="${activeTab === 'columns' ? '' : 'display:none'}">
              <p class="tiny muted mb">تحكّم بظهور أو إخفاء أعمدة جدول البنود بنقرة واحدة:</p>
              <div class="tpl-switches">
                <div class="tpl-switch-item">
                  <label for="col-item-code">إظهار كود / باركود الصنف</label>
                  <input type="checkbox" id="col-item-code" ${printCfg.show_item_code !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="col-unit">إظهار عمود وحدة القياس</label>
                  <input type="checkbox" id="col-unit" ${printCfg.show_unit !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="col-discount">إظهار عمود الخصم التجاري</label>
                  <input type="checkbox" id="col-discount" ${printCfg.show_discount !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="col-taxable">إظهار عمود الإجمالي قبل الضريبة (الوعاء)</label>
                  <input type="checkbox" id="col-taxable" ${printCfg.show_taxable !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="col-tax-rate">إظهار عمود نسبة الضريبة %</label>
                  <input type="checkbox" id="col-tax-rate" ${printCfg.show_tax_rate !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="col-tax-amount">إظهار عمود مبلغ الضريبة</label>
                  <input type="checkbox" id="col-tax-amount" ${printCfg.show_tax_amount !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="col-striped">تلوين صفوف الجدول بالتناوب (Zebra Stripe)</label>
                  <input type="checkbox" id="col-striped" ${printCfg.striped_rows !== false ? 'checked' : ''} />
                </div>
              </div>
            </div>

            <!-- تبويب الـ QR والفوترة الإلكترونية -->
            <div id="tab-pane-qr" style="${activeTab === 'qr' ? '' : 'display:none'}">
              <p class="tiny muted mb">إعدادات وتنسيق رمز الاستجابة السريعة (متطلب هيئة الزكاة والضريبة والجمارك):</p>
              <div class="tpl-switches mb">
                <div class="tpl-switch-item">
                  <label for="qr-show-a4">إظهار رمز QR في فاتورة A4</label>
                  <input type="checkbox" id="qr-show-a4" ${qrCfg.show_a4 !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="qr-show-thermal">إظهار رمز QR في الفاتورة الحرارية 80mm</label>
                  <input type="checkbox" id="qr-show-thermal" ${qrCfg.show_thermal !== false ? 'checked' : ''} />
                </div>
              </div>

              <div class="row mt">
                <div class="field">
                  <label>حجم رمز الـ QR</label>
                  <select id="ctrl-qr-size">
                    <option value="small"${qrCfg.size === 'small' ? ' selected' : ''}>صغير (24mm)</option>
                    <option value="medium"${qrCfg.size === 'medium' || !qrCfg.size ? ' selected' : ''}>متوسط (30mm)</option>
                    <option value="large"${qrCfg.size === 'large' ? ' selected' : ''}>كبير (38mm)</option>
                  </select>
                </div>
                <div class="field">
                  <label>موضع الـ QR في A4</label>
                  <select id="ctrl-qr-pos">
                    <option value="right"${printCfg.qr_position === 'right' || !printCfg.qr_position ? ' selected' : ''}>يمين أسفل (بجانب الإجماليات)</option>
                    <option value="left"${printCfg.qr_position === 'left' ? ' selected' : ''}>يسار أسفل</option>
                    <option value="center"${printCfg.qr_position === 'center' ? ' selected' : ''}>في المنتصف</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- تبويب التذييل والتواقيع والبنك -->
            <div id="tab-pane-footer" style="${activeTab === 'footer' ? '' : 'display:none'}">
              <div class="tpl-switches">
                <div class="tpl-switch-item">
                  <label for="foot-bank">إظهار الحساب البنكي والآيبان</label>
                  <input type="checkbox" id="foot-bank" ${printCfg.show_bank !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="foot-tafqeet">إظهار تفقيط المبلغ بالحروف العربية (Tafqeet)</label>
                  <input type="checkbox" id="foot-tafqeet" ${printCfg.show_tafqeet !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="foot-sig">إظهار خانات التوقيع والاعتماد الرسمي</label>
                  <input type="checkbox" id="foot-sig" ${printCfg.show_signatures !== false ? 'checked' : ''} />
                </div>
                <div class="tpl-switch-item">
                  <label for="foot-notes">إظهار الملاحظات والشروط القانونية</label>
                  <input type="checkbox" id="foot-notes" ${printCfg.show_notes !== false ? 'checked' : ''} />
                </div>
              </div>

              <div class="field mt">
                <label>عدد نسخ الطباعة الافتراضية</label>
                <input type="number" id="ctrl-copies" min="1" max="4" value="${esc(printCfg.copies || 1)}" style="max-width:140px;" />
                <span class="hint">1 = نسخة أصلية، 2 = أصل + صورة للعميل</span>
              </div>
            </div>

            <!-- تبويب رفع/تحميل و CSS متقدم -->
            <div id="tab-pane-advanced" style="${activeTab === 'advanced' ? '' : 'display:none'}">
              <div class="stack">
                <div class="card" style="background:rgba(255,255,255,0.02); border:1px solid var(--line); padding:.9rem;">
                  <h4 style="margin:0 0 .4rem; display:flex; align-items:center; gap:8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand);"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                    تصدير وتحميل حزمة القالب
                  </h4>
                  <p class="tiny muted" style="margin-bottom:.8rem;">تنزيل ملف إعدادات القالب بالكامل مع الألوان والأبعاد والأعمدة والـ QR لحفظه كنسخة احتياطية أو نقله لجهاز آخر:</p>
                  <div class="flex gap">
                    <button class="btn btn-sm" id="btn-tab-export-json" type="button">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:5px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>تنزيل حزمة القالب (.json)
                    </button>
                    <button class="btn btn-sm" id="btn-tab-export-html" type="button">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:5px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/></svg>تنزيل صفحة HTML كاملة
                    </button>
                  </div>
                </div>

                <div class="card" style="background:rgba(255,255,255,0.02); border:1px solid var(--line); padding:.9rem;">
                  <h4 style="margin:0 0 .4rem; display:flex; align-items:center; gap:8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand);"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                    رفع واستيراد قالب جاهز
                  </h4>
                  <p class="tiny muted" style="margin-bottom:.8rem;">اختر ملف قالب بصيغة JSON تم تصديره سابقاً أو أعدّه مصمم، وسيتم تطبيقه فورياً بدقة:</p>
                  <button class="btn btn-sm btn-primary" id="btn-tab-import-json" type="button">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-inline-end:5px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>اختيار ملف القالب من جهازك (.json)
                  </button>
                </div>

                <div class="field mt">
                  <label>تخصيص أنماط CSS إضافية (Custom CSS Overrides)</label>
                  <textarea id="ctrl-custom-css" class="mono tiny" placeholder=".page { /* قواعد CSS مخصصة */ }" style="min-height:90px;">${esc(printCfg.custom_css || '')}</textarea>
                  <span class="hint">للمستخدمين المتقدمين: يمكنك كتابة أي استثناءات تنسيق CSS خاصة وسيتم حقنها في رأس القالب مباشرة.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- قسم المعاينة الحية اللحظية على اليسار -->
        <div class="tpl-preview-pane">
          <div class="tpl-preview-toolbar">
            <div class="tpl-preview-info">
              <span>نوع الورق:</span>
              <span class="badge ${printCfg.template_style === 'thermal' ? 'amber' : 'green'}">
                ${printCfg.template_style === 'thermal' ? 'بكرة إيصال حراري (80mm)' : 'صفحة A4 قياسية (210×297mm)'}
              </span>
              <span class="muted tiny">|</span>
              <span class="muted tiny">مصدر البيانات:</span>
              <select id="sel-invoice-source" style="padding:.25rem .5rem; font-size:.82rem; border-radius:6px; background:var(--field-bg); color:#fff; border:1px solid var(--line-strong);">
                <option value="mock"${selectedInvoiceId === 'mock' ? ' selected' : ''}>نموذج تجريبي متكامل</option>
                ${raw(recentInvoices.map((inv) => `<option value="${esc(inv.id)}"${inv.id === selectedInvoiceId ? ' selected' : ''}>فاتورة #${esc(inv.invoice_number)} (${money(inv.grand_total)} ${esc(inv.currency || 'ر.س')})</option>`).join(''))}
              </select>
            </div>

            <div class="tpl-preview-actions">
              <label class="flex gap tiny" style="align-items:center; cursor:pointer; margin-inline-end:.5rem;">
                <input type="checkbox" id="chk-watermark" ${isSimulatedWatermark ? 'checked' : ''} />
                <span>معاينة كفاتورة ملغاة</span>
              </label>

              <div class="tpl-zoom-controls">
                <button type="button" class="tpl-zoom-btn" id="zoom-out" title="تصغير المعاينة">−</button>
                <span class="tpl-zoom-val" id="zoom-text">${zoomLevel}%</span>
                <button type="button" class="tpl-zoom-btn" id="zoom-in" title="تكبير المعاينة">+</button>
              </div>
            </div>
          </div>

          <div class="tpl-paper-wrapper">
            <div class="tpl-paper-frame ${printCfg.template_style === 'thermal' ? 'thermal' : ''}" id="paper-frame" style="transform: scale(${zoomLevel / 100});">
              <iframe id="preview-iframe" class="tpl-iframe" title="معاينة حية لقالب الفاتورة"></iframe>
            </div>
          </div>
        </div>
      </div>
    `;

    attachEvents();
    updateLivePreview();
  }

  function updateLivePreview() {
    const iframe = $('#preview-iframe', view);
    if (!iframe) return;

    const invToRender = {
      ...currentInvoice,
      status: isSimulatedWatermark ? 'CANCELLED' : currentInvoice.status,
    };

    const docHtml = invoicePreviewDoc({
      invoice: invToRender,
      issuer: activeIssuer,
      client: mockClient,
      printSettings: printCfg,
      qrSettings: qrCfg,
    });

    iframe.srcdoc = docHtml;
  }

  // تصدير القالب كحزمة JSON كاملة بدقة
  function exportTemplateAsJson() {
    const currentTpl = INVOICE_TEMPLATES.find((t) => t.id === printCfg.template_style) || { name: 'قالب الفاتورة' };
    const payload = {
      zsystem_template_version: '1.0',
      exported_at: new Date().toISOString(),
      template_name: currentTpl.name,
      template_style: printCfg.template_style,
      issuer_name: activeIssuer.name_ar,
      issuer_code: activeIssuer.code,
      print_settings: { ...printCfg },
      qr_settings: { ...qrCfg },
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const safeName = (currentTpl.name || 'template').replace(/[^\w\u0600-\u06FF]+/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    download(`zsystem_template_${safeName}_${dateStr}.json`, jsonStr, 'application/json;charset=utf-8');
    toastOk('تم تصدير وتحميل ملف القالب بدقة كاملة بنجاح.');
  }

  // تصدير مستند HTML مستقل كامل
  function exportStandaloneHtml() {
    const invToRender = {
      ...currentInvoice,
      status: isSimulatedWatermark ? 'CANCELLED' : currentInvoice.status,
    };
    const htmlDoc = invoiceA4({
      invoice: invToRender,
      issuer: activeIssuer,
      client: mockClient,
      printSettings: printCfg,
      qrSettings: qrCfg,
      autoPrint: false,
    });
    const code = activeIssuer.code || 'export';
    download(`invoice_template_${code}_${printCfg.template_style}.html`, htmlDoc, 'text/html;charset=utf-8');
    toastOk('تم تحميل مستند HTML المستقل بدقة كاملة.');
  }

  // فتح نافذة القوالب الجاهزة بنقرة واحدة
  function openPresetsModal() {
    const m = modal({
      title: 'نماذج قوالب جاهزة ومصممة لمختلف الأنشطة',
      wide: true,
      body: html`
        <div class="stack">
          <p class="muted small" style="margin-top:0;">اختر نموذجاً جاهزاً متكاملاً، وسيتم تطبيقه فوراً على استوديو القوالب مع إمكانية تعديله وحفظه للمنشأة:</p>
          <div class="grid grid-3" style="gap:.9rem;">
            ${raw(PRESET_TEMPLATES.map((preset) => `
              <div class="card" style="margin:0; padding:1rem; cursor:pointer; border:1px solid var(--line); transition:all .18s; display:flex; flex-direction:column; justify-content:space-between;" data-preset-id="${preset.id}">
                <div>
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:.5rem;">
                    <span style="font-weight:800; font-size:.92rem; color:#fff;">${esc(preset.title)}</span>
                    <span class="badge gray" style="font-size:.7rem;">${esc(preset.badge)}</span>
                  </div>
                  <p class="tiny muted" style="margin:0 0 .8rem; line-height:1.4;">${esc(preset.desc)}</p>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--line); padding-top:.6rem;">
                  <span style="display:inline-block; width:22px; height:22px; border-radius:50%; background:${preset.color}; border:2px solid #fff;"></span>
                  <button type="button" class="btn btn-sm btn-primary btn-apply-preset" data-preset-id="${preset.id}">تطبيق النموذج</button>
                </div>
              </div>
            `).join(''))}
          </div>
        </div>`,
      footer: '<button class="btn" data-close type="button">إغلاق</button>',
    });

    $$('.btn-apply-preset', m.el).forEach((btn) => {
      btn.addEventListener('click', () => {
        const pId = btn.dataset.presetId;
        const targetPreset = PRESET_TEMPLATES.find((p) => p.id === pId);
        if (targetPreset) {
          printCfg.template_style = targetPreset.style;
          printCfg.primary_color = targetPreset.color;
          printCfg.dark_color = targetPreset.dark;
          printCfg.light_color = targetPreset.light;
          printCfg.font_family = targetPreset.font;
          m.close();
          renderView();
          toastOk(`تم تطبيق نموذج «${targetPreset.title}» بنجاح!`);
        }
      });
    });
  }

  function attachEvents() {
    // تبديل الشركة المصدرة
    $('#sel-issuer', view).addEventListener('change', async (e) => {
      const newId = e.target.value;
      try {
        activeIssuer = await api.get(`/api/issuers/${newId}`);
        printCfg = {
          template_style: 'standard',
          primary_color: '#0d9488',
          dark_color: '#0f766e',
          light_color: '#f0fdfa',
          font_family: 'Cairo',
          font_size: 'normal',
          logo_position: 'right',
          logo_size: 'medium',
          show_item_code: true,
          show_unit: true,
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
        currentInvoice = buildMockInvoice(activeIssuer);
        renderView();
        toastOk(`تم تحميل إعدادات: ${activeIssuer.name_ar}`);
      } catch (err) {
        toastErr('فشل تحميل بيانات المنشأة: ' + err.message);
      }
    });

    // أزرار التحميل والرفع والنماذج الجاهزة
    $('#btn-presets', view)?.addEventListener('click', openPresetsModal);
    $('#btn-download-json', view)?.addEventListener('click', exportTemplateAsJson);
    $('#btn-tab-export-json', view)?.addEventListener('click', exportTemplateAsJson);
    $('#btn-tab-export-html', view)?.addEventListener('click', exportStandaloneHtml);

    const fileInput = $('#file-template-upload', view);
    const uploadTrigger = () => fileInput?.click();
    $('#btn-upload-json', view)?.addEventListener('click', uploadTrigger);
    $('#btn-tab-import-json', view)?.addEventListener('click', uploadTrigger);

    // معالجة رفع ملف القالب
    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const importedPrint = data.print_settings || data;
        const importedQr = data.qr_settings || {};

        if (!importedPrint || typeof importedPrint !== 'object') {
          throw new Error('الملف لا يحتوي على كائن إعدادات قالب صالح');
        }

        printCfg = {
          ...printCfg,
          ...importedPrint,
          copies: Math.max(1, parseInt(importedPrint.copies, 10) || 1),
        };

        if (importedQr && typeof importedQr === 'object') {
          qrCfg = {
            ...qrCfg,
            ...importedQr,
          };
        }

        renderView();
        toastOk(`تم رفع واستيراد القالب «${data.template_name || file.name}» بدقة كاملة!`);
      } catch (err) {
        toastErr('تعذر استيراد القالب: ' + err.message);
      } finally {
        e.target.value = '';
      }
    });

    // تبديل فلتر القوالب (all | a4 | pos)
    $$('.tpl-filter-btn', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        renderView();
      });
    });

    // اختيار قالب من المعرض
    $$('.tpl-card', view).forEach((card) => {
      card.addEventListener('click', () => {
        const styleId = card.dataset.style;
        printCfg.template_style = styleId;
        renderView();
      });
    });

    // تبديل تبويبات أدوات التحكم
    $$('.tpl-tab-btn', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        $$('.tpl-tab-btn', view).forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        ['branding', 'columns', 'qr', 'footer', 'advanced'].forEach((tabName) => {
          const pane = $(`#tab-pane-${tabName}`, view);
          if (pane) pane.style.display = tabName === activeTab ? '' : 'none';
        });
      });
    });

    // لوحات الألوان الجاهزة
    $$('.color-swatch', view).forEach((swatch) => {
      swatch.addEventListener('click', () => {
        $$('.color-swatch', view).forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
        printCfg.primary_color = swatch.dataset.color;
        printCfg.dark_color = swatch.dataset.dark;
        printCfg.light_color = swatch.dataset.light;
        const colorInput = $('#ctrl-color', view);
        const hexInput = $('#ctrl-color-hex', view);
        if (colorInput) colorInput.value = printCfg.primary_color;
        if (hexInput) hexInput.value = printCfg.primary_color;
        updateLivePreview();
      });
    });

    // ملتقط اللون المخصص
    const colorPicker = $('#ctrl-color', view);
    const hexInput = $('#ctrl-color-hex', view);
    if (colorPicker && hexInput) {
      colorPicker.addEventListener('input', (e) => {
        const col = e.target.value;
        hexInput.value = col;
        printCfg.primary_color = col;
        printCfg.dark_color = col;
        updateLivePreview();
      });
      hexInput.addEventListener('change', (e) => {
        const col = e.target.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(col)) {
          colorPicker.value = col;
          printCfg.primary_color = col;
          printCfg.dark_color = col;
          updateLivePreview();
        }
      });
    }

    // الخطوط والحجم وموضع الشعار
    $('#ctrl-font', view)?.addEventListener('change', (e) => {
      printCfg.font_family = e.target.value;
      updateLivePreview();
    });
    $('#ctrl-font-size', view)?.addEventListener('change', (e) => {
      printCfg.font_size = e.target.value;
      updateLivePreview();
    });
    $('#ctrl-logo-pos', view)?.addEventListener('change', (e) => {
      printCfg.logo_position = e.target.value;
      updateLivePreview();
    });
    $('#ctrl-logo-size', view)?.addEventListener('change', (e) => {
      printCfg.logo_size = e.target.value;
      updateLivePreview();
    });

    // خيارات أعمدة الجدول
    $('#col-item-code', view)?.addEventListener('change', (e) => {
      printCfg.show_item_code = e.target.checked;
      updateLivePreview();
    });
    $('#col-unit', view)?.addEventListener('change', (e) => {
      printCfg.show_unit = e.target.checked;
      updateLivePreview();
    });
    $('#col-discount', view)?.addEventListener('change', (e) => {
      printCfg.show_discount = e.target.checked;
      updateLivePreview();
    });
    $('#col-taxable', view)?.addEventListener('change', (e) => {
      printCfg.show_taxable = e.target.checked;
      updateLivePreview();
    });
    $('#col-tax-rate', view)?.addEventListener('change', (e) => {
      printCfg.show_tax_rate = e.target.checked;
      updateLivePreview();
    });
    $('#col-tax-amount', view)?.addEventListener('change', (e) => {
      printCfg.show_tax_amount = e.target.checked;
      updateLivePreview();
    });
    $('#col-striped', view)?.addEventListener('change', (e) => {
      printCfg.striped_rows = e.target.checked;
      updateLivePreview();
    });

    // خيارات الـ QR
    $('#qr-show-a4', view)?.addEventListener('change', (e) => {
      qrCfg.show_a4 = e.target.checked;
      updateLivePreview();
    });
    $('#qr-show-thermal', view)?.addEventListener('change', (e) => {
      qrCfg.show_thermal = e.target.checked;
      updateLivePreview();
    });
    $('#ctrl-qr-size', view)?.addEventListener('change', (e) => {
      qrCfg.size = e.target.value;
      updateLivePreview();
    });
    $('#ctrl-qr-pos', view)?.addEventListener('change', (e) => {
      printCfg.qr_position = e.target.value;
      updateLivePreview();
    });

    // خيارات التذييل
    $('#foot-bank', view)?.addEventListener('change', (e) => {
      printCfg.show_bank = e.target.checked;
      updateLivePreview();
    });
    $('#foot-tafqeet', view)?.addEventListener('change', (e) => {
      printCfg.show_tafqeet = e.target.checked;
      updateLivePreview();
    });
    $('#foot-sig', view)?.addEventListener('change', (e) => {
      printCfg.show_signatures = e.target.checked;
      updateLivePreview();
    });
    $('#foot-notes', view)?.addEventListener('change', (e) => {
      printCfg.show_notes = e.target.checked;
      updateLivePreview();
    });
    $('#ctrl-copies', view)?.addEventListener('change', (e) => {
      printCfg.copies = Math.max(1, parseInt(e.target.value, 10) || 1);
    });

    // تخصيص أنماط CSS
    $('#ctrl-custom-css', view)?.addEventListener('input', (e) => {
      printCfg.custom_css = e.target.value;
      updateLivePreview();
    });

    // مصدر الفاتورة للمعاينة (افتراضية أو حقيقية)
    $('#sel-invoice-source', view)?.addEventListener('change', async (e) => {
      selectedInvoiceId = e.target.value;
      if (selectedInvoiceId === 'mock') {
        currentInvoice = buildMockInvoice(activeIssuer);
      } else {
        try {
          const inv = await api.get(`/api/invoices/${selectedInvoiceId}`);
          if (inv) currentInvoice = inv;
        } catch {
          currentInvoice = buildMockInvoice(activeIssuer);
        }
      }
      updateLivePreview();
    });

    // العلامة المائية / تجربة حالة ملغاة
    $('#chk-watermark', view)?.addEventListener('change', (e) => {
      isSimulatedWatermark = e.target.checked;
      updateLivePreview();
    });

    // أزرار التكبير والتصغير
    $('#zoom-in', view)?.addEventListener('click', () => {
      zoomLevel = Math.min(130, zoomLevel + 10);
      $('#zoom-text', view).textContent = `${zoomLevel}%`;
      $('#paper-frame', view).style.transform = `scale(${zoomLevel / 100})`;
    });
    $('#zoom-out', view)?.addEventListener('click', () => {
      zoomLevel = Math.max(60, zoomLevel - 10);
      $('#zoom-text', view).textContent = `${zoomLevel}%`;
      $('#paper-frame', view).style.transform = `scale(${zoomLevel / 100})`;
    });

    // تجربة الطباعة الحية
    $('#btn-print-test', view)?.addEventListener('click', () => {
      const invToPrint = {
        ...currentInvoice,
        status: isSimulatedWatermark ? 'CANCELLED' : currentInvoice.status,
      };
      if (printCfg.template_style === 'thermal') {
        const htmlDoc = invoiceThermal({
          invoice: invToPrint,
          issuer: activeIssuer,
          client: mockClient,
          qrSettings: qrCfg,
        });
        printDoc(htmlDoc);
      } else {
        const htmlDoc = invoiceA4({
          invoice: invToPrint,
          issuer: activeIssuer,
          client: mockClient,
          printSettings: printCfg,
          qrSettings: qrCfg,
          copies: printCfg.copies || 1,
        });
        printDoc(htmlDoc);
      }
    });

    // استعادة الضبط الافتراضي
    $('#btn-reset', view)?.addEventListener('click', () => {
      if (!confirm('هل ترغب في استعادة الضبط الافتراضي للقالب؟')) return;
      printCfg = {
        template_style: 'standard',
        primary_color: '#0d9488',
        dark_color: '#0f766e',
        light_color: '#f0fdfa',
        font_family: 'Cairo',
        font_size: 'normal',
        logo_position: 'right',
        logo_size: 'medium',
        show_item_code: true,
        show_unit: true,
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
      };
      qrCfg = {
        show_a4: true,
        show_thermal: true,
        size: 'medium',
        scale: 4,
        thermal_scale: 3,
      };
      renderView();
      toastOk('تمت استعادة الإعدادات القياسية للقالب');
    });

    // حفظ التخصيص للمنشأة
    $('#btn-save', view)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const originalText = btn.innerHTML;
      btn.textContent = 'جارٍ الحفظ…';
      try {
        await api.put(`/api/issuers/${activeIssuer.id}`, {
          print_settings: printCfg,
          qr_settings: qrCfg,
        });
        activeIssuer.print_settings = { ...printCfg };
        activeIssuer.qr_settings = { ...qrCfg };
        toastOk(`تم حفظ وتثبيت القالب بنجاح لمنشأة: ${activeIssuer.name_ar}`);
      } catch (err) {
        toastErr('فشل حفظ القالب: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    });
  }

  renderView();
}
