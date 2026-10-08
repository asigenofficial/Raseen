// ==========================================================================
//  مولّد الفواتير الدفعي الذكي المتقدم — مستوحى من أنظمة العمل الواقعية
//  (المسودات المحفوظة، التعديل التفاعلي، إصدار عينة تجريبية، طباعة المعاينة، سندات القبض الآلية)
// ==========================================================================
import { api } from '../core/api.js';
import { store, loadClients, loadItems, loadCategories, currencyLabel } from '../core/store.js';
import * as router from '../core/router.js';
import {
  html, raw, esc, money, num, timeToMinutes, toNum, today,
  toastOk, toastErr, $, delegate, confirmDialog, promptDialog, exportCsv, exportExcel,
  modal, printDoc, icon, generateNextItemCode, downloadPdfFromUrl, renderStoredVoucher, loadStoredTemplate, fillStoredTemplate,
} from '../core/util.js';

const PAY_LABELS = { CASH: 'نقداً', CARD: 'شبكة', TRANSFER: 'تحويل', CREDIT: 'آجل' };

function firstOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

function calcLine(l) {
  const qty = Number(l.quantity) || 0;
  const price = Number(l.unit_price) || 0;
  const disc = Math.min(Number(l.discount) || 0, qty * price);
  const taxRate = Number(l.tax_rate) !== undefined ? Number(l.tax_rate) : 15;
  const taxable = (qty * price) - disc;
  const tax = Math.round((taxable * (taxRate / 100)) * 100) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;
  return {
    ...l,
    item_code: l.item_code || '',
    item_name: l.item_name || '',
    unit: l.unit || 'حبة',
    quantity: qty,
    unit_price: price,
    discount: disc,
    taxable_amount: taxable,
    tax_amount: tax,
    grand_total: total,
  };
}

function recalcInvoice(inv) {
  const rawLines = inv.lines || inv.items || [];
  const lines = rawLines.map(calcLine);
  const taxable = Math.round(lines.reduce((s, l) => s + (l.taxable_amount || 0), 0) * 100) / 100;
  const discount = Math.round(lines.reduce((s, l) => s + (l.discount || 0), 0) * 100) / 100;
  const subtotal = Math.round((taxable + discount) * 100) / 100;
  const tax = Math.round(lines.reduce((s, l) => s + (l.tax_amount || 0), 0) * 100) / 100;
  const grand = Math.round((taxable + tax) * 100) / 100;
  return {
    ...inv,
    lines,
    items: lines,
    subtotal,
    discount_amount: discount,
    taxable_amount: taxable,
    tax_amount: tax,
    grand_total: grand,
  };
}

export async function render(view) {
  await Promise.all([loadClients(), loadItems(), loadCategories()]);
  const activeIssuers = store.issuers.filter((i) => i.is_active);
  if (!activeIssuers.length || !store.clients.length) {
    view.innerHTML = html`<div class="card"><div class="empty">
      <h3>تحتاج شركة مصدرة وعميلاً واحداً على الأقل</h3>
      <p class="muted">أضف البيانات الأساسية أولاً ثم عد لهذه الشاشة.</p>
      <div class="flex" style="justify-content:center"><a class="btn" href="#/issuers">الشركات</a><a class="btn" href="#/clients">العملاء</a></div>
    </div></div>`;
    return undefined;
  }

  let availableTemplates = [];
  try {
    const res = await api.get('/api/invoices/templates?type=invoices');
    availableTemplates = Array.isArray(res) ? res : (res?.data || []);
    if (!availableTemplates.length) {
      const fallbackRes = await api.get('/api/invoices/templates?type=all');
      const allList = Array.isArray(fallbackRes) ? fallbackRes : (fallbackRes?.data || []);
      availableTemplates = allList.filter((t) => !t.category || t.category === 'invoices' || t.category === 'custom' || t.category === 'custom_invoices');
    }
  } catch {
    try {
      const fallbackRes = await api.get('/api/invoices/templates?type=all');
      const allList = Array.isArray(fallbackRes) ? fallbackRes : (fallbackRes?.data || []);
      availableTemplates = allList.filter((t) => !t.category || t.category === 'invoices' || t.category === 'custom' || t.category === 'custom_invoices');
    } catch {
      availableTemplates = [];
    }
  }

  const activeIssuer = activeIssuers.find((i) => i.id === (store.activeIssuerId || activeIssuers[0].id)) || activeIssuers[0];
  let issuerPrintCfg = {};
  try {
    issuerPrintCfg = typeof activeIssuer?.print_settings === 'string'
      ? JSON.parse(activeIssuer.print_settings || '{}')
      : (activeIssuer?.print_settings || {});
  } catch {}
  const initialTplStyle = issuerPrintCfg?.template_style || (availableTemplates[0]?.id) || '01-royal-navy';

  const state = {
    issuer_id: store.activeIssuerId || activeIssuers[0].id,
    client_id: store.clients[0].id,
    selected_template: initialTplStyle,
    zatca_phase: activeIssuer?.zatca_phase || 'PHASE1',
    date_from: firstOfYear(),
    date_to: today(),
    count: 25,
    target_total: 680000,
    use_target: true,
    start_invoice_number: '',
    number_gap_range: '2-7',
    category_ids: [],
    item_ids: [],
    custom_items: [],
    distribution_mode: 'BALANCED',
    min_items: 4,
    max_items: 6,
    min_qty: 1,
    max_qty: 25,
    min_invoice_total: '',
    max_invoice_total: '',
    discount_enabled: true,
    discount_min_percent: 2,
    discount_max_percent: 10,
    discount_probability: 0.3,
    price_jitter_percent: 3,
    allow_fraction_qty: false,
    skip_weekend: false,
    work_start: '09:00',
    work_end: '22:00',
    payment_methods: ['CREDIT'],
    invoice_type: 'STANDARD',
    issue_vouchers: false,
    auto_save_draft: true,
    font_family: 'Tajawal',
    seed: '',
    notes: '',
    current_draft_id: null,
    drafts: [],
    preview: null,
    busy: false,
    activeEditIndex: null,
  };

  const buildTemplateOptions = (selectedId) => {
    const excelGroup = availableTemplates.length ? `
      <optgroup label="قوالب الفواتير المعتمدة والمخصصة (${availableTemplates.length} قالب)">
        ${availableTemplates.map((t) => `<option value="${esc(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.name_ar || t.name || t.id)} (${esc(t.badge || 'فاتورة HTML')})</option>`).join('')}
      </optgroup>` : '';
    return excelGroup;
  };

  const cur = currencyLabel();

  const loadDraftsList = async () => {
    try {
      state.drafts = await api.get(`/api/bulk/drafts?issuer_id=${state.issuer_id || ''}`);
    } catch {
      state.drafts = [];
    }
  };
  await loadDraftsList();

  const payload = () => {
    const gapParts = (state.number_gap_range || '2-7').split('-').map((x) => parseInt(x, 10));
    const number_gap_min = gapParts[0] || 2;
    const number_gap_max = gapParts[1] || 7;
    return {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      template_style: state.selected_template,
      date_from: state.date_from,
      date_to: state.date_to,
      count: toNum(state.count, 0),
      target_total: state.use_target ? toNum(state.target_total, 0) : 0,
      start_invoice_number: (state.start_invoice_number || '').trim(),
      number_gap_min,
      number_gap_max,
      category_ids: state.category_ids,
      item_ids: state.item_ids,
    custom_items: state.custom_items.map((it) => {
      const code = (it.item_code && it.item_code.trim()) ? it.item_code.trim() : generateNextItemCode(state.custom_items, store.items);
      it.item_code = code;
      return {
        id: it.id || undefined,
        name_ar: it.name_ar,
        item_code: code,
        unit: it.unit || 'حبة',
        sale_price: toNum(it.sale_price, 0),
        tax_rate: it.tax_rate !== undefined ? toNum(it.tax_rate, 15) : 15,
      };
    }),
    distribution_mode: state.distribution_mode,
    min_items: toNum(state.min_items, 1),
    max_items: toNum(state.max_items, 6),
    min_qty: state.min_qty === '' ? 0 : toNum(state.min_qty, 0),
    max_qty: state.max_qty === '' ? 0 : toNum(state.max_qty, 0),
    min_invoice_total: state.min_invoice_total === '' ? 0 : toNum(state.min_invoice_total, 0),
    max_invoice_total: state.max_invoice_total === '' ? 0 : toNum(state.max_invoice_total, 0),
    discount_enabled: state.discount_enabled,
    discount_min_percent: toNum(state.discount_min_percent, 0),
    discount_max_percent: toNum(state.discount_max_percent, 0),
    discount_probability: toNum(state.discount_probability, 0.3),
    price_jitter_percent: toNum(state.price_jitter_percent, 0),
    allow_fraction_qty: state.allow_fraction_qty,
    skip_weekend: state.skip_weekend,
    work_start_minutes: timeToMinutes(state.work_start),
    work_end_minutes: timeToMinutes(state.work_end),
    payment_methods: state.payment_methods,
    invoice_type: state.invoice_type,
    zatca_phase: state.zatca_phase || 'PHASE1',
    issue_vouchers: state.issue_vouchers,
    seed: state.seed === '' ? 0 : toNum(state.seed, 0),
    notes: state.notes,
  };
};

  const recalcPreviewSummary = () => {
    if (!state.preview || !state.preview.invoices) return;
    const invs = state.preview.invoices.map(recalcInvoice);
    state.preview.invoices = invs;
    const total = Math.round(invs.reduce((s, i) => s + (i.grand_total || 0), 0) * 100) / 100;
    const tax = Math.round(invs.reduce((s, i) => s + (i.tax_amount || 0), 0) * 100) / 100;
    const disc = Math.round(invs.reduce((s, i) => s + (i.discount_amount || 0), 0) * 100) / 100;
    const vals = invs.map((i) => i.grand_total);
    const itemDistribution = {};
    for (const inv of invs) {
      for (const l of inv.lines || []) {
        const k = l.item_name || 'غير محدد';
        itemDistribution[k] = (itemDistribution[k] || 0) + (Number(l.quantity) || 1);
      }
    }
    state.preview.summary = {
      count: invs.length,
      grand_total: total,
      tax_total: tax,
      discount_total: disc,
      average: invs.length ? Math.round((total / invs.length) * 100) / 100 : 0,
      min_invoice: vals.length ? Math.min(...vals) : 0,
      max_invoice: vals.length ? Math.max(...vals) : 0,
      unique_baskets: new Set(invs.map((i) => (i.lines || []).map((l) => `${l.item_id}:${l.quantity}`).sort().join('|'))).size,
      date_from: invs.length ? invs[0].issue_date : null,
      date_to: invs.length ? invs[invs.length - 1].issue_date : null,
      item_distribution: itemDistribution,
    };
  };

  const customItemsTableHtml = () => {
    if (!state.custom_items.length) {
      return `
        <div class="pad mt" style="background:rgba(255,255,255,0.02);border:1px dashed var(--line-strong);border-radius:var(--radius-sm);text-align:center">
          <p class="muted tiny" style="margin:.4rem 0">لم يتم تحديد قائمة أصناف مخصصة بعد. سيتم استخدام أصناف الكتالوج العام تلقائياً، أو يمكنك إضافة أصناف يدوياً وتحديد أسعارها وأرقامها للدفعة من النموذج أعلاه.</p>
        </div>
      `;
    }

    return `
      <div class="mt" style="background:rgba(16, 185, 129, 0.08);border:1px solid rgba(16, 185, 129, 0.3);padding:.4rem .8rem;border-radius:var(--radius-sm);margin-bottom:.5rem;display:flex;align-items:center;gap:.6rem">
        <span style="color:#10b981;font-weight:bold;font-size:.85rem">✓ حصر التوليد اليدوي:</span>
        <span class="tiny" style="color:var(--text)">سيقتصر توليد فواتير هذه الدفعة <b>فقط وحصراً</b> على الأصناف المحددة أدناه بالأسعار والأرقام والوحدات الموضحة.</span>
      </div>
      <div class="table-wrap bulk-table-wrap">
        <table class="tbl compact" style="background:var(--card)">
          <thead>
            <tr>
              <th style="width:55px" class="text-center">ترتيب</th>
              <th style="width:125px">رقم الصنف</th>
              <th>اسم الصنف</th>
              <th style="width:95px">الوحدة</th>
              <th style="width:140px" class="text-end">سعر الوحدة (${esc(cur)})</th>
              <th style="width:85px" class="text-center">الضريبة</th>
              <th style="width:45px"></th>
            </tr>
          </thead>
          <tbody>
            ${state.custom_items.map((it, idx) => `
              <tr>
                <td class="text-center" style="white-space:nowrap">
                  <span class="tiny num font-bold" style="margin-left:3px">${idx + 1}</span>
                  ${idx > 0 ? `<button class="btn btn-sm pad0" data-move-custom-item="${idx}:up" type="button" title="تحريك لأعلى" style="width:18px;height:18px;line-height:1;font-size:9px;padding:0">▲</button>` : ''}
                  ${idx < state.custom_items.length - 1 ? `<button class="btn btn-sm pad0" data-move-custom-item="${idx}:down" type="button" title="تحريك لأسفل" style="width:18px;height:18px;line-height:1;font-size:9px;padding:0">▼</button>` : ''}
                </td>
                <td>
                  <input type="text" class="custom-item-prop mono" data-idx="${idx}" data-prop="item_code" value="${esc(it.item_code || '')}" placeholder="رقم الصنف" style="width:110px;padding:.2rem .4rem;font-size:.82rem" />
                </td>
                <td>
                  <input type="text" class="custom-item-prop" data-idx="${idx}" data-prop="name_ar" value="${esc(it.name_ar)}" placeholder="اسم الصنف" style="width:100%;font-weight:600;padding:.2rem .4rem;font-size:.85rem" />
                </td>
                <td>
                  <input type="text" class="custom-item-prop" data-idx="${idx}" data-prop="unit" value="${esc(it.unit || 'حبة')}" placeholder="الوحدة" style="width:80px;padding:.2rem .4rem;font-size:.82rem" />
                </td>
                <td class="text-end">
                  <input type="number" step="any" min="0.01" class="custom-item-prop custom-item-price" data-idx="${idx}" data-prop="sale_price" value="${it.sale_price}" style="width:115px;text-align:right;padding:.25rem .5rem;font-size:.85rem;font-weight:bold" />
                </td>
                <td class="text-center">
                  <input type="number" step="any" min="0" max="100" class="custom-item-prop" data-idx="${idx}" data-prop="tax_rate" value="${it.tax_rate !== undefined ? it.tax_rate : 15}" style="width:60px;text-align:center;padding:.2rem;font-size:.82rem" />%
                </td>
                <td class="text-center">
                  <button class="btn btn-sm btn-danger pad0" style="width:24px;height:24px;line-height:1" data-remove-custom-item="${idx}" type="button" title="حذف الصنف من الدفعة">✕</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4">
                <span class="badge blue tiny">إجمالي الأصناف المحددة للدفعة: <b>${num(state.custom_items.length)}</b> صنف</span>
              </td>
              <td colspan="3" class="text-end" style="gap:.4rem">
                <button class="btn btn-sm" id="btn-autogen-custom-codes" type="button" style="font-size:.78rem">توليد أرقام الأصناف آلياً</button>
                <button class="btn btn-sm" id="btn-bulk-price-adjust" type="button" style="font-size:.78rem">تعديل جماعي للأسعار (±%)</button>
                <button class="btn btn-sm" id="btn-reset-default-prices" type="button" style="font-size:.78rem">استعادة الأسعار الأصلية</button>
                <button class="btn btn-sm btn-danger" id="btn-clear-custom-items" type="button" style="font-size:.78rem">مسح الكل</button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  };

  const draftsSectionHtml = () => {
    if (!state.drafts.length) {
      return `<div class="card pad" style="background:rgba(255,255,255,0.02);border:1px dashed var(--line-strong)">
        <div class="row align-center">
          <div><b>المسودات المحفوظة:</b> <span class="muted tiny">لا توجد مسودات محفوظة حالياً لهذه الشركة.</span></div>
          <div class="spacer"></div>
          <button class="btn btn-sm" id="refresh-drafts" type="button">${raw(icon.refresh({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}تحديث</button>
        </div>
      </div>`;
    }
    return `
      <div class="card">
        <div class="card-head" style="padding:0 0 .5rem">
          <h3>المسودات المحفوظة (${state.drafts.length})</h3>
          <div class="spacer"></div>
          <button class="btn btn-sm" id="refresh-drafts" type="button">${raw(icon.refresh({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}تحديث القائمة</button>
        </div>
        <p class="muted tiny" style="margin-top:-.3rem">يمكنك فتح أي مسودة محفوظة، متابعة التعديل عليها، إصدار عينة تجريبية، أو اعتمادها.</p>
        <div class="grid grid-3 bulk-drafts-grid mt">
          ${state.drafts.map((d) => `
            <div class="card pad" style="border:1px solid ${d.id === state.current_draft_id ? 'var(--brand)' : 'var(--line)'};background:${d.id === state.current_draft_id ? 'rgba(6, 182, 212, 0.08)' : 'var(--card)'}">
              <div class="row align-center">
                <span class="badge ${d.status === 'COMMITTED' ? 'green' : 'blue'} tiny">${d.status === 'COMMITTED' ? 'معتمدة' : 'مسودة'}</span>
                <div class="spacer"></div>
                <span class="tiny muted">${esc(d.updated_at ? d.updated_at.slice(0, 16).replace('T', ' ') : '')}</span>
              </div>
              <div style="font-weight:600;margin:.4rem 0 .2rem;font-size:.95rem">${esc(d.title)}</div>
              <div class="tiny muted">العميل: <b>${esc(d.client_name || 'عام')}</b></div>
              <div class="row mt tiny" style="justify-content:space-between">
                <span>الفواتير: <b class="num">${num(d.invoice_count)}</b></span>
                <span>الإجمالي: <b class="num">${money(d.grand_total)} ${esc(cur)}</b></span>
              </div>
              <div class="row mt-sm" style="gap:.4rem">
                <button class="btn btn-sm btn-primary" data-open-draft="${esc(d.id)}" type="button" style="flex:1">${raw(icon.eye({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}فتح المسودة</button>
                <button class="btn btn-sm btn-danger" data-del-draft="${esc(d.id)}" type="button" title="حذف المسودة">${raw(icon.trash({ size: 13 }))}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  };

  const previewHtml = () => {
    const p = state.preview;
    if (!p) {
      return `<div class="card"><div class="empty">
        <h3>لم يتم توليد أو فتح معاينة بعد</h3>
        <p class="muted">اضبط المعايير بالأعلى واضغط «توليد معاينة»، أو افتح مسودة من القائمة أعلاه. لا يُحفظ شيء رسمي في الحسابات قبل الاعتماد.</p>
      </div></div>`;
    }
    const s = p.summary;
    const targetDiff = state.use_target ? Math.round((s.grand_total - toNum(state.target_total, 0)) * 100) / 100 : 0;
    const dayCount = new Set(p.invoices.map((i) => i.issue_date)).size;

    return `
      <div class="card mt" style="border:2px solid var(--brand)">
        <div class="row align-center">
          <div>
            <h2 style="margin:0;font-size:1.25rem">مراجعة الفواتير قبل الاعتماد</h2>
            <p class="tiny muted" style="margin:.2rem 0 0">يمكنك هنا مراجعة التاريخ والوقت والأصناف والخصومات، حفظ المسودة، طباعة عينة تجريبية أو طباعة المعاينة بالكامل.</p>
          </div>
          <div class="spacer"></div>
          ${state.current_draft_id ? `<span class="badge blue">مسودة مفتوحة: ${esc(p.title || state.current_draft_id.slice(0, 8))}</span>` : ''}
        </div>

        <div class="grid grid-4 mt">
          <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(s.count)}</div><div class="stat-lab">عدد الفواتير</div></div></div>
          <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(s.grand_total)}</div><div class="stat-lab">الإجمالي النهائي (${esc(cur)})</div></div></div>
          <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(s.grand_total - s.tax_total)}</div><div class="stat-lab">قبل الضريبة</div></div></div>
          <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(s.tax_total)}</div><div class="stat-lab">إجمالي الضريبة</div></div></div>
        </div>

        <div class="row mt align-center" style="background:rgba(255,255,255,0.03);padding:.6rem 1rem;border-radius:var(--radius-sm);border:1px solid var(--line)">
          <div><b>مطابقة الميزانية:</b>
            ${state.use_target
    ? (Math.abs(targetDiff) < 0.005
      ? '<span class="badge green">مطابقة تامة للمبلغ المطلوب</span>'
      : `<span class="badge red">فرق ${money(targetDiff)}</span>`)
    : '<span class="badge gray">بدون ميزانية محددة</span>'}
          </div>
          <div class="spacer"></div>
          <div class="tiny muted">
            أقل فاتورة <b class="num">${money(s.min_invoice)}</b> — أعلى فاتورة <b class="num">${money(s.max_invoice)}</b> —
            خصومات <b class="num">${money(s.discount_total)}</b> —
            تراكيب متنوعة <b class="num">${num(s.unique_baskets)}/${num(s.count)}</b> —
            موزعة على <b class="num">${num(dayCount)}</b> يوم
          </div>
        </div>

        ${s.item_distribution && Object.keys(s.item_distribution).length ? `
          <div class="mt-sm" style="background:rgba(6, 182, 212, 0.05);padding:.6rem 1rem;border-radius:var(--radius-sm);border:1px solid rgba(6, 182, 212, 0.25)">
            <div class="row align-center">
              <b class="tiny" style="color:var(--brand)">توزيع المنتجات على فواتير الدفعة (${num(Object.keys(s.item_distribution).length)} صنف تم توزيعه):</b>
              <div class="spacer"></div>
              <span class="tiny muted">إجمالي الكميات المسحوبة لكل صنف عبر الدفعة</span>
            </div>
            <div class="chips mt-xs" style="gap:.4rem">
              ${raw(Object.entries(s.item_distribution).map(([k, count]) => `
                <span class="badge gray tiny" style="font-size:.8rem;padding:.2rem .6rem">
                  ${esc(k)}: <b class="num" style="color:var(--brand);margin-right:4px">${num(count)}</b>
                </span>
              `).join(''))}
            </div>
          </div>
        ` : ''}

        <div class="row mt-sm" style="gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-sm" id="btn-save-draft" type="button" style="background:#0284c7;color:#fff">${raw(icon.copy({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}حفظ المسودة</button>
          <button class="btn btn-sm" id="btn-sample-print" type="button" style="background:#0d9488;color:#fff;font-weight:bold">${raw(icon.eye({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}معاينة الفواتير بالقالب 📄</button>
          <button class="btn btn-sm" id="btn-print-preview" type="button" style="background:#d97706;color:#fff">${raw(icon.printer({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}طباعة المعاينة / PDF</button>
          <button class="btn btn-sm" id="pv-csv" type="button">${raw(icon.fileText({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير CSV</button>
          <button class="btn btn-sm" id="pv-xls" type="button">${raw(icon.fileSpreadsheet({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn btn-sm" id="regen" type="button">${raw(icon.refresh({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}توليد بديل</button>
          <div class="spacer"></div>
          <button class="btn btn-primary" id="commit" type="button" style="font-weight:bold;font-size:.95rem">
            ${raw(icon.checkCircle({ size: 16, style: 'vertical-align:text-bottom;margin-left:5px' }))}اعتماد وطباعة الدفعة (${num(s.count)} فاتورة${state.issue_vouchers ? ' + سندات قبض' : ''})
          </button>
        </div>

        <div class="mt">
          <div class="row align-center" style="margin-bottom:.5rem">
            <h3 style="margin:0">قائمة وتفاصيل الفواتير (تعديل يدوي ومباشر)</h3>
            <div class="spacer"></div>
            <button class="btn btn-sm" id="btn-add-manual-inv" type="button" style="background:#059669;color:#fff;font-weight:600;margin-left:.6rem">
              ${raw(icon.plus({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}+ إضافة فاتورة يدوية
            </button>
            <span class="tiny muted">انقر «تعديل البنود» لتخصيص أصناف وأسعار أي فاتورة مباشرة أو حذفها.</span>
          </div>

          <div class="invoices-list">
            ${p.invoices.map((inv, idx) => `
              <div class="card pad" style="border:1px solid var(--line);background:var(--card)" data-inv-card="${idx}">
                <div class="row align-center">
                  <span class="badge blue" style="font-size:.85rem;font-weight:bold">فاتورة #${idx + 1}</span>
                  <span class="badge green num" style="font-size:.85rem;font-weight:bold">${money(inv.grand_total)} ${esc(cur)}</span>
                  <span class="badge ${(inv.zatca_phase || state.zatca_phase) === 'PHASE2' ? 'teal' : 'gray'} tiny" title="${(inv.zatca_phase || state.zatca_phase) === 'PHASE2' ? 'باركود المرحلة الثانية' : 'باركود المرحلة الأولى'}">${(inv.zatca_phase || state.zatca_phase) === 'PHASE2' ? 'م2 (مشفّر)' : 'م1 (أساسي)'}</span>
                  <span class="tiny muted">${esc(inv.lines.length)} أصناف</span>
                  <div class="spacer"></div>
                  <button class="btn btn-sm" data-preview-inv="${idx}" type="button" style="background:#0d9488;color:#fff;font-weight:600" title="معاينة هذه الفاتورة بالقالب وتبديل القوالب">
                    ${raw(icon.eye({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}معاينة بالقالب
                  </button>
                  <button class="btn btn-sm ${state.activeEditIndex === idx ? 'btn-primary' : ''}" data-toggle-edit="${idx}" type="button">
                    ${raw(icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}${state.activeEditIndex === idx ? 'إغلاق التعديل' : 'تعديل البنود'}
                  </button>
                  <button class="btn btn-sm btn-danger" data-remove-inv="${idx}" type="button" title="حذف الفاتورة من الدفعة">${raw(icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}حذف</button>
                </div>

                <div class="row mt-sm" style="gap:.6rem;align-items:flex-end">
                  <div class="field" style="max-width:130px;margin:0"><label class="tiny">رقم الفاتورة</label>
                    <input type="text" class="inv-field mono" data-idx="${idx}" data-field="invoice_number" value="${esc(inv.invoice_number || '')}" placeholder="تلقائي" /></div>
                  <div class="field" style="max-width:135px;margin:0"><label class="tiny">التاريخ</label>
                    <input type="date" class="inv-field" data-idx="${idx}" data-field="issue_date" value="${inv.issue_date}" /></div>
                  <div class="field" style="max-width:105px;margin:0"><label class="tiny">الوقت</label>
                    <input type="time" step="1" class="inv-field" data-idx="${idx}" data-field="issue_time" value="${inv.issue_time || '10:00:00'}" /></div>
                  <div class="field" style="max-width:115px;margin:0"><label class="tiny">طريقة الدفع</label>
                    <select class="inv-field" data-idx="${idx}" data-field="payment_method">
                      ${raw(Object.entries(PAY_LABELS).map(([k, v]) => `<option value="${esc(k)}" ${inv.payment_method === k ? 'selected' : ''}>${esc(v)}</option>`).join(''))}
                    </select></div>
                  <div class="field" style="flex:1;margin:0"><label class="tiny">ملاحظات الفاتورة</label>
                    <input type="text" class="inv-field" data-idx="${idx}" data-field="notes" value="${esc(inv.notes || '')}" placeholder="ملاحظة اختيارية" /></div>
                </div>

                ${state.activeEditIndex === idx ? `
                  <div class="mt" style="background:rgba(255,255,255,0.03);padding:.75rem;border-radius:var(--radius-sm);border:1px solid var(--line)">
                    <div class="row align-center" style="margin-bottom:.5rem">
                      <b class="tiny">بنود الفاتورة #${idx + 1}:</b>
                      <div class="spacer"></div>
                      <select id="quick-add-item-${idx}" style="max-width:280px;font-size:.8rem">
                        <option value="">-- اختر صنفاً للإضافة السريعة --</option>
                        ${raw(store.items.map((it) => `<option value="${esc(it.id)}">${esc(it.item_code ? `[${it.item_code}] ` : '')}${esc(it.name_ar)} — ${money(it.sale_price)} (${esc(it.unit || 'حبة')})</option>`).join(''))}
                      </select>
                      <button class="btn btn-sm btn-primary" data-add-item="${idx}" type="button">+ إضافة صنف</button>
                    </div>

                    <div class="table-wrap bulk-lines-table-wrap">
                      <table class="tbl compact" style="background:transparent">
                        <thead><tr>
                          <th style="width:30px">#</th><th style="width:100px">رقم الصنف</th><th>الصنف</th><th style="width:75px">الوحدة</th>
                          <th style="width:80px" class="text-end">الكمية</th><th style="width:95px" class="text-end">السعر</th>
                          <th style="width:80px" class="text-end">الخصم</th><th style="width:60px" class="text-center">الضريبة</th>
                          <th style="width:100px" class="text-end">الإجمالي</th><th style="width:40px"></th>
                        </tr></thead>
                        <tbody>
                          ${inv.lines.map((l, lIdx) => `
                            <tr>
                              <td class="tiny">${lIdx + 1}</td>
                              <td><input type="text" style="padding:.2rem;font-size:.8rem;width:95px" class="line-input mono" data-inv="${idx}" data-line="${lIdx}" data-lfield="item_code" value="${esc(l.item_code || '')}" placeholder="رقم الصنف" /></td>
                              <td><b>${esc(l.item_name)}</b></td>
                              <td><input type="text" style="padding:.2rem;font-size:.8rem;width:70px" class="line-input" data-inv="${idx}" data-line="${lIdx}" data-lfield="unit" value="${esc(l.unit || 'حبة')}" /></td>
                              <td><input type="number" step="1" min="1" style="padding:.2rem;font-size:.8rem;text-align:right" class="line-input" data-inv="${idx}" data-line="${lIdx}" data-lfield="quantity" value="${l.quantity}" /></td>
                              <td><input type="number" step="any" min="0" style="padding:.2rem;font-size:.8rem;text-align:right" class="line-input" data-inv="${idx}" data-line="${lIdx}" data-lfield="unit_price" value="${l.unit_price}" /></td>
                              <td><input type="number" step="any" min="0" style="padding:.2rem;font-size:.8rem;text-align:right" class="line-input" data-inv="${idx}" data-line="${lIdx}" data-lfield="discount" value="${l.discount || 0}" /></td>
                              <td class="text-center tiny">${num(l.tax_rate || 15)}%</td>
                              <td class="text-end num font-bold">${money(l.grand_total || ((l.quantity * l.unit_price - (l.discount || 0)) * 1.15))}</td>
                              <td class="text-center"><button class="btn btn-sm btn-danger pad0" style="width:24px;height:24px;line-height:1" data-del-line="${idx}:${lIdx}" type="button">حذف</button></td>
                            </tr>
                          `).join('')}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colspan="3"><b>الإجمالي</b></td>
                            <td colspan="4" class="tiny muted text-end">قبل الضريبة: <b class="num">${money(inv.taxable_amount)}</b> — الضريبة: <b class="num">${money(inv.tax_amount)}</b></td>
                            <td class="text-end num font-bold" style="font-size:1rem;color:var(--brand)">${money(inv.grand_total)}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  };

  const draw = () => {
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>التوليد الدفعي الذكي للفواتير</h1>
          <p>توليد عدد كبير من الفواتير المتنوعة لعميل واحد خلال فترة محددة، مع مطابقة دقيقة لميزانية إجمالية وإدارة المسودات.</p>
        </div>
        <div class="page-actions">
          <a class="btn" href="#/vouchers?mode=install" style="background:var(--brand-light, #f0f9ff);border:1.5px solid var(--brand, #0284c7);color:var(--brand, #0284c7);font-weight:700">
            ${raw(icon.calendar({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            توليد سندات دفعية (أقساط)
          </a>
          <button class="btn btn-primary" id="preview" type="button" style="font-weight:bold">${raw(icon.sparkles({ size: 16, style: 'vertical-align:text-bottom;margin-left:5px' }))}توليد معاينة جديدة</button>
        </div>
      </div>

      <div id="drafts-area">${raw(draftsSectionHtml())}</div>

      <div class="card mt bulk-form-card">
        <div class="card-head" style="padding:0 0 .7rem"><h3>1. الأساسيات</h3></div>
        
        <!-- الصف 1: أطراف الفاتورة والمدى الزمني -->
        <div class="form-grid-4 mt">
          <div class="field">
            <label class="req">الشركة المصدرة</label>
            <select id="issuer_id">${raw(activeIssuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}</select>
          </div>
          <div class="field">
            <label class="req">العميل</label>
            <select id="client_id">${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}</select>
          </div>
          <div class="field">
            <label class="req">من تاريخ</label>
            <input type="date" id="date_from" value="${state.date_from}" />
          </div>
          <div class="field">
            <label class="req">إلى تاريخ</label>
            <input type="date" id="date_to" value="${state.date_to}" />
          </div>
        </div>

        <!-- الصف 2: معايير وأرقام الدفعة والباركود -->
        <div class="form-grid-4 mt">
          <div class="field">
            <label>عدد الفواتير</label>
            <input type="number" id="count" value="${state.count}" min="0" max="5000" />
            <span class="hint">اتركه 0 ليُحدَّد آلياً من الميزانية</span>
          </div>
          <div class="field">
            <div class="field-head-inline">
              <label>الميزانية الإجمالية (${esc(cur)})</label>
              <label class="check tiny" style="cursor:pointer;margin:0" title="تفعيل مطابقة إجمالي الميزانية بدقة">
                <input type="checkbox" id="use_target" ${raw(state.use_target ? 'checked' : '')} style="width:14px;height:14px" />
                <span style="font-size:.72rem;color:var(--brand);font-weight:600">مطابقة دقيقة</span>
              </label>
            </div>
            <input type="number" id="target_total" value="${state.target_total}" min="0" step="0.01" ${raw(state.use_target ? '' : 'disabled')} />
            <span class="hint">إجمالي مبالغ الفواتير المطلوبة بالريال</span>
          </div>
          <div class="field">
            <label>نوع الفواتير</label>
            <select id="invoice_type">
              <option value="STANDARD" ${raw(state.invoice_type === 'STANDARD' ? 'selected' : '')}>فاتورة ضريبية (B2B)</option>
              <option value="SIMPLIFIED" ${raw(state.invoice_type === 'SIMPLIFIED' ? 'selected' : '')}>فاتورة مبسطة (B2C)</option>
            </select>
            <span class="hint">تحديد نوع المعاملة الضريبية</span>
          </div>
          <div class="field">
            <label>مرحلة باركود هيئة الزكاة (QR)</label>
            <div class="segmented-control">
              <label class="segmented-option ${state.zatca_phase === 'PHASE1' ? 'is-active' : ''}">
                <input type="radio" name="bulk_zatca_phase" value="PHASE1" ${state.zatca_phase === 'PHASE1' ? 'checked' : ''} />
                <span>المرحلة الأولى</span>
                <span class="muted tiny">(5 حقول)</span>
              </label>
              <label class="segmented-option ${state.zatca_phase === 'PHASE2' ? 'is-active' : ''}">
                <input type="radio" name="bulk_zatca_phase" value="PHASE2" ${state.zatca_phase === 'PHASE2' ? 'checked' : ''} />
                <span>المرحلة الثانية</span>
                <span class="badge teal tiny" style="margin-right:2px">مشفّر وموقّع</span>
              </label>
            </div>
            <span class="hint" id="bulk-phase-hint">${state.zatca_phase === 'PHASE2' ? 'باركود مشفر وموقع رقمياً (هاش وتوقيع)' : 'باركود مشفر بالحقول الخمسة الأساسية'}</span>
          </div>
        </div>

        <!-- الصف 3: القالب والتسلسل والفوارق والملاحظات -->
        <div class="form-grid-4 mt">
          <div class="field">
            <label>قالب الفاتورة المعتمد للدفعة</label>
            <select id="selected_template">
              ${raw(buildTemplateOptions(state.selected_template))}
            </select>
            <span class="hint">قالب وتصميم الطباعة والمعاينة</span>
          </div>
          <div class="field">
            <label>بداية تسلسل الفواتير (اختياري)</label>
            <input type="text" id="start_invoice_number" class="mono" value="${esc(state.start_invoice_number || '')}" placeholder="مثال: INV-0101" />
            <span class="hint">اتركه فارغاً للاستكمال التلقائي</span>
          </div>
          <div class="field">
            <label>فوارق ترقيم الفواتير</label>
            <select id="number_gap_range">
              <option value="2-7" ${state.number_gap_range === '2-7' ? 'selected' : ''}>فارق عشوائي (2 إلى 7 أرقام - موصى به)</option>
              <option value="3-10" ${state.number_gap_range === '3-10' ? 'selected' : ''}>فارق متوسط (3 إلى 10 أرقام)</option>
              <option value="5-15" ${state.number_gap_range === '5-15' ? 'selected' : ''}>فارق متباعد (5 إلى 15 رقماً)</option>
              <option value="1-1" ${state.number_gap_range === '1-1' ? 'selected' : ''}>متسلسل بدقة (+1 بدون فواصل)</option>
            </select>
            <span class="hint">توليد أرقام غير متتالية كأنها لعملاء متعددين</span>
          </div>
          <div class="field">
            <label>ملاحظة عامة على كل فواتير الدفعة</label>
            <input type="text" id="notes" value="${esc(state.notes)}" placeholder="ملاحظة إضافية تظهر بالفواتير..." />
            <span class="hint">تُدرج في تذييل كافة فواتير الدفعة</span>
          </div>
        </div>

        <!-- الصف 4: شريط خيارات الإجراءات الآلية والمسودات -->
        <div class="bulk-options-bar mt">
          <label class="check-pill">
            <input type="checkbox" id="issue_vouchers" ${raw(state.issue_vouchers ? 'checked' : '')} />
            <div class="check-pill-content">
              <b>إصدار سندات قبض تلقائياً مع الفواتير</b>
              <span class="muted tiny">ترحيل السندات وتخصيصها آلياً لكل فاتورة في حساب العميل</span>
            </div>
          </label>
          <label class="check-pill">
            <input type="checkbox" id="auto_save_draft" ${raw(state.auto_save_draft ? 'checked' : '')} />
            <div class="check-pill-content">
              <b>حفظ المعاينة كمسودة تلقائياً بعد التوليد</b>
              <span class="muted tiny">إمكانية استرجاع أو معاينة أو تعديل الدفعة في أي وقت</span>
            </div>
          </label>
        </div>
      </div>

      <div class="card mt">
        <div class="card-head" style="padding:0 0 .7rem">
          <div>
            <h3 style="margin:0">2. الأصناف وتحديد الأسعار وتوزيع المنتجات على الفواتير</h3>
            <p class="tiny muted" style="margin:.25rem 0 0">حدد الأصناف وأسعارها المعتمدة للدفعة وطريقة توزيعها، أو اتركها لاستخدام الكتالوج العام تلقائياً.</p>
          </div>
          <div class="spacer"></div>
          <span class="badge ${state.custom_items.length ? 'blue' : 'gray'}" id="custom-items-count-badge">
            ${state.custom_items.length ? `${state.custom_items.length} صنف محدد بأسعار خاصة` : `الكتالوج العام (${store.items.length} صنف)`}
          </span>
        </div>

        <!-- شريط إضافة وتحديد أسعار الأصناف للدفعة -->
        <div class="bulk-items-bar mt">
          <div class="bulk-items-inputs">
            <div class="field" style="flex:2.2;min-width:210px">
              <label class="tiny">اختر من الدليل (تعبئة سريعة)</label>
              <select id="quick-catalog-item-select">
                <option value="">-- اختر صنفاً من الدليل أو اكتب بياناته مباشرة --</option>
                ${raw(store.items.map((it) => `<option value="${esc(it.id)}" data-code="${esc(it.item_code || '')}" data-price="${it.sale_price}" data-unit="${esc(it.unit || 'حبة')}" data-name="${esc(it.name_ar)}">${esc(it.item_code ? `[${it.item_code}] ` : '')}${esc(it.name_ar)} (سعر: ${money(it.sale_price)} ${esc(cur)})</option>`).join(''))}
              </select>
            </div>
            <div class="field" style="flex:0.9;min-width:110px">
              <label class="tiny">رقم الصنف</label>
              <input type="text" id="quick-catalog-item-code" class="mono" placeholder="رقم الصنف" autocomplete="off" />
            </div>
            <div class="field" style="flex:2;min-width:180px">
              <label class="tiny req">اسم الصنف أو الخدمة</label>
              <input type="text" id="quick-catalog-item-name" placeholder="ابحث بالاسم أو الباركود..." autocomplete="off" />
            </div>
            <div class="field" style="flex:0.7;min-width:85px">
              <label class="tiny">الوحدة</label>
              <input type="text" id="quick-catalog-item-unit" placeholder="حبة" value="حبة" />
            </div>
            <div class="field" style="flex:1.1;min-width:115px">
              <label class="tiny req">السعر المحدد (${esc(cur)})</label>
              <input type="number" step="any" min="0" id="quick-catalog-item-price" placeholder="سعر الوحدة" />
            </div>
          </div>
          <div class="bulk-items-actions mt-sm">
            <button class="btn btn-primary" id="btn-add-item-to-batch" type="button" style="height:38px">
              ${raw(icon.plus({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}إضافة للدفعة
            </button>
            <button class="btn" id="btn-add-custom-adhoc" type="button" style="height:38px" title="إضافة صنف مخصص حر مباشرة للدفعة">
              ${raw(icon.edit({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}صنف مخصص حر
            </button>
            <button class="btn" id="btn-import-all-catalog" type="button" style="height:38px">
              ${raw(icon.package({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}إدراج كل الأصناف (${store.items.length})
            </button>
          </div>
        </div>

        <!-- إضافة مجموعة كاملة بنقرة واحدة -->
        <div class="mt-sm">
          <label class="tiny muted" style="font-weight:600;display:block;margin-bottom:.3rem">
            إضافة مجموعة أصناف كاملة (انقر على أي مجموعة لإدراج كافة منتجاتها وتعديل أسعارها):
          </label>
          <div class="chips">
            ${raw(store.categories.map((c) => `
              <span class="chip" data-add-cat-items="${esc(c.id)}" style="cursor:pointer" title="انقر لإضافة كافة أصناف مجموعة ${esc(c.name)}">
                ${raw(icon.layers({ size: 12, style: 'vertical-align:text-bottom;margin-left:3px' }))}
                ${esc(c.name)} (${c.items_count || 0})
              </span>
            `).join(''))}
          </div>
        </div>

        <!-- جدول الأصناف المحددة للدفعة وأسعارها -->
        <div id="custom-items-container">
          ${raw(customItemsTableHtml())}
        </div>

        <!-- خيارات طريقة توزيع المنتجات على الفواتير -->
        <div class="distribution-cards mt">
          <label class="distribution-card">
            <input type="radio" name="distribution_mode" value="SEQUENTIAL" ${state.distribution_mode === 'SEQUENTIAL' ? 'checked' : ''} />
            <div>
              <b>توزيع متسلسل</b>
              <div class="muted tiny">إدراج الأصناف في الفواتير بنفس الترتيب الموضح بالجدول</div>
            </div>
          </label>
          <label class="distribution-card">
            <input type="radio" name="distribution_mode" value="BALANCED" ${state.distribution_mode === 'BALANCED' ? 'checked' : ''} />
            <div>
              <b>توزيع متوازن</b>
              <div class="muted tiny">ضمان توزيع كافة الأصناف المختارة بالتساوي على الفواتير</div>
            </div>
          </label>
          <label class="distribution-card">
            <input type="radio" name="distribution_mode" value="RANDOM" ${state.distribution_mode === 'RANDOM' ? 'checked' : ''} />
            <div>
              <b>توزيع عشوائي</b>
              <div class="muted tiny">اختيار وتوليد عشوائي يحاكي المشتريات الواقعية</div>
            </div>
          </label>
        </div>
      </div>

      <div class="card mt bulk-form-card">
        <div class="card-head" style="padding:0 0 .7rem"><h3>3. ضوابط التنوع والواقعية</h3></div>
        
        <div class="form-grid-5 mt">
          <div class="field">
            <label>أقل عدد أصناف</label>
            <input type="number" id="min_items" value="${state.min_items}" min="1" max="100" />
            <span class="hint">الحد الأدنى بالبند</span>
          </div>
          <div class="field">
            <label>أكثر عدد أصناف</label>
            <input type="number" id="max_items" value="${state.max_items}" min="1" max="100" />
            <span class="hint">الحد الأقصى بالبند</span>
          </div>
          <div class="field">
            <label>أقل كمية</label>
            <input type="number" id="min_qty" value="${state.min_qty}" min="0.01" step="0.01" />
            <span class="hint">اختياري؛ عند تركه فارغاً يبدأ من كمية 1</span>
          </div>
          <div class="field">
            <label>أكثر كمية</label>
            <input type="number" id="max_qty" value="${state.max_qty}" min="0.01" step="0.01" />
            <span class="hint">اختياري؛ اتركه فارغاً لحساب الكميات تلقائياً حسب المبلغ</span>
          </div>
          <div class="field">
            <label>تفاوت السعر ±%</label>
            <input type="number" id="price_jitter_percent" value="${state.price_jitter_percent}" min="0" max="50" step="0.5" />
            <span class="hint">لتفادي تكرار السعر بدقة</span>
          </div>
        </div>

        <div class="form-grid-5 mt">
          <div class="field">
            <label>أقل قيمة للفاتورة</label>
            <input type="number" id="min_invoice_total" value="${state.min_invoice_total}" min="0" step="0.01" placeholder="بدون حد" />
            <span class="hint">قيمة إجمالية دنيا</span>
          </div>
          <div class="field">
            <label>أعلى قيمة للفاتورة</label>
            <input type="number" id="max_invoice_total" value="${state.max_invoice_total}" min="0" step="0.01" placeholder="بدون حد" />
            <span class="hint">قيمة إجمالية عليا</span>
          </div>
          <div class="field">
            <label>بداية وقت العمل</label>
            <input type="time" id="work_start" value="${state.work_start}" />
            <span class="hint">توقيت صدور أول فاتورة</span>
          </div>
          <div class="field">
            <label>نهاية وقت العمل</label>
            <input type="time" id="work_end" value="${state.work_end}" />
            <span class="hint">توقيت صدور آخر فاتورة</span>
          </div>
          <div class="field">
            <label>مفتاح التوليد (Seed)</label>
            <input type="number" id="seed" value="${state.seed}" min="0" placeholder="عشوائي" />
            <span class="hint">نفس المفتاح يكرر نفس الأرقام</span>
          </div>
        </div>

        <div class="form-grid-2 mt bulk-options-grid">
          <div class="bulk-option-card">
            <label>الخصومات</label>
            <label class="check"><input type="checkbox" id="discount_enabled" ${raw(state.discount_enabled ? 'checked' : '')} /> تطبيق خصومات عشوائية على بعض البنود</label>
            <div class="bulk-discount-fields mt" ${raw(state.discount_enabled ? '' : 'data-disabled="true"')}>
              <div class="field"><label for="discount_min_percent">أدنى خصم (%)</label><input type="number" id="discount_min_percent" value="${state.discount_min_percent}" min="0" max="90" step="0.5" inputmode="decimal" ${raw(state.discount_enabled ? '' : 'disabled')} /></div>
              <div class="field"><label for="discount_max_percent">أقصى خصم (%)</label><input type="number" id="discount_max_percent" value="${state.discount_max_percent}" min="0" max="90" step="0.5" inputmode="decimal" ${raw(state.discount_enabled ? '' : 'disabled')} /></div>
              <div class="field"><label for="discount_probability">احتمال الخصم (%)</label><input type="number" id="discount_probability" value="${Math.round(Number(state.discount_probability || 0) * 100)}" min="0" max="100" step="5" inputmode="numeric" aria-describedby="discount_probability_hint" ${raw(state.discount_enabled ? '' : 'disabled')} /><span class="hint" id="discount_probability_hint">مثال: 30 يعني احتمال 30٪</span></div>
            </div>
          </div>
          <div class="bulk-option-card">
            <label>خيارات أيام العمل والدفع</label>
            <div class="flex" style="gap:1rem;margin-bottom:.5rem">
              <label class="check"><input type="checkbox" id="allow_fraction_qty" ${raw(state.allow_fraction_qty ? 'checked' : '')} /> كميات كسرية (0.5 / 2.25)</label>
              <label class="check"><input type="checkbox" id="skip_weekend" ${raw(state.skip_weekend ? 'checked' : '')} /> تجاوز عطلة نهاية الأسبوع</label>
            </div>
            <label class="small mt" style="font-weight:600">طرق الدفع المستخدمة</label>
            <div class="chips">
              ${raw(Object.entries(PAY_LABELS).map(([k, v]) => `<span class="chip ${state.payment_methods.includes(k) ? 'on' : ''}" data-pay="${esc(k)}">${esc(v)}</span>`).join(''))}
            </div>
          </div>
        </div>
      </div>

      <div id="preview-area">${raw(previewHtml())}</div>`;

    bind();
  };

  const bindNumeric = (ids) => ids.forEach((id) => {
    const el = $(`#${id}`, view);
    if (el) el.addEventListener('input', (e) => {
      const value = e.target.value;
      state[id] = id === 'discount_probability' && value !== ''
        ? Math.max(0, Math.min(100, Number(value))) / 100
        : value;
    });
  });

  function bind() {
    ['issuer_id', 'client_id', 'date_from', 'date_to', 'invoice_type', 'selected_template', 'work_start', 'work_end'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) {
        el.addEventListener('change', async (e) => {
          state[id] = e.target.value;
          if (id === 'issuer_id') {
            await loadDraftsList();
            const area = $('#drafts-area', view);
            if (area) area.innerHTML = draftsSectionHtml();
            const currIss = activeIssuers.find((i) => i.id === state.issuer_id);
            if (currIss) {
              state.zatca_phase = currIss.zatca_phase || 'PHASE1';
              const radio = $(`input[name="bulk_zatca_phase"][value="${state.zatca_phase}"]`, view);
              if (radio) radio.checked = true;
              const hint = $('#bulk-phase-hint', view);
              if (hint) {
                hint.textContent = state.zatca_phase === 'PHASE2'
                  ? 'باركود مشفر وموقع رقمياً (هاش وتوقيع وسلسلة فواتير)'
                  : 'باركود مشفر بالحقول الخمسة الأساسية';
              }
            }
            if (currIss?.print_settings) {
              try {
                const cfg = typeof currIss.print_settings === 'string' ? JSON.parse(currIss.print_settings) : currIss.print_settings;
                if (cfg.template_style) {
                  state.selected_template = cfg.template_style;
                  const tplEl = $('#selected_template', view);
                  if (tplEl) tplEl.value = cfg.template_style;
                }
              } catch {}
            }
          }
        });
      }
    });

    bindNumeric(['count', 'target_total', 'start_invoice_number', 'min_items', 'max_items', 'min_qty', 'max_qty',
      'min_invoice_total', 'max_invoice_total', 'price_jitter_percent', 'discount_min_percent',
      'discount_max_percent', 'discount_probability', 'seed', 'notes']);

    const gapSelect = $('#number_gap_range', view);
    if (gapSelect) {
      gapSelect.addEventListener('change', (e) => {
        state.number_gap_range = e.target.value;
      });
    }

    const useTargetEl = $('#use_target', view);
    if (useTargetEl) {
      useTargetEl.addEventListener('change', (e) => {
        state.use_target = e.target.checked;
        const targetInput = $('#target_total', view);
        if (targetInput) targetInput.disabled = !e.target.checked;
      });
    }

    const discCheck = $('#discount_enabled', view);
    if (discCheck) discCheck.addEventListener('change', (e) => {
      state.discount_enabled = e.target.checked;
      const fields = $('.bulk-discount-fields', view);
      if (fields) fields.toggleAttribute('data-disabled', !e.target.checked);
      fields?.querySelectorAll('input').forEach((input) => { input.disabled = !e.target.checked; });
    });
    const fracCheck = $('#allow_fraction_qty', view);
    if (fracCheck) fracCheck.addEventListener('change', (e) => { state.allow_fraction_qty = e.target.checked; });
    const skipCheck = $('#skip_weekend', view);
    if (skipCheck) skipCheck.addEventListener('change', (e) => { state.skip_weekend = e.target.checked; });
    const issueVouchersCheck = $('#issue_vouchers', view);
    if (issueVouchersCheck) issueVouchersCheck.addEventListener('change', (e) => { state.issue_vouchers = e.target.checked; });
    const autoSaveCheck = $('#auto_save_draft', view);
    if (autoSaveCheck) autoSaveCheck.addEventListener('change', (e) => { state.auto_save_draft = e.target.checked; });

    const refreshCustomItemsArea = () => {
      const container = $('#custom-items-container', view);
      if (container) container.innerHTML = customItemsTableHtml();
      const badge = $('#custom-items-count-badge', view);
      if (badge) {
        badge.className = `badge ${state.custom_items.length ? 'blue' : 'gray'}`;
        badge.textContent = state.custom_items.length
          ? `${state.custom_items.length} صنف محدد بأسعار خاصة`
          : `الكتالوج العام (${store.items.length} صنف)`;
      }
    };

    let activeFloatingInput = null;
    let activePopoverIdx = -1;

    const getOrCreatePopover = () => {
      let box = document.getElementById('global-item-search-popover');
      if (!box) {
        box = document.createElement('div');
        box.id = 'global-item-search-popover';
        box.className = 'global-item-search-popover hidden';
        document.body.appendChild(box);
      }
      return box;
    };

    const closePopover = () => {
      const box = document.getElementById('global-item-search-popover');
      if (box) {
        box.classList.add('hidden');
        box.innerHTML = '';
      }
      activeFloatingInput = null;
      activePopoverIdx = -1;
    };

    const positionPopover = (input, box) => {
      if (!input || !document.body.contains(input)) {
        closePopover();
        return;
      }
      const rect = input.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 380), window.innerWidth - 24);

      let left = rect.right - width;
      if (left < 12) left = 12;
      if (left + width > window.innerWidth - 12) {
        left = window.innerWidth - width - 12;
      }

      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const popoverHeight = Math.min(360, box.offsetHeight || 300);

      let top;
      if (spaceBelow < 220 && spaceAbove > spaceBelow) {
        top = Math.max(10, rect.top - popoverHeight - 6);
      } else {
        top = rect.bottom + 6;
      }

      box.style.left = `${Math.round(left)}px`;
      box.style.top = `${Math.round(top)}px`;
      box.style.width = `${Math.round(width)}px`;
    };

    const selectCatalogItem = (item) => {
      if (!item) return;
      const select = $('#quick-catalog-item-select', view);
      const codeInput = $('#quick-catalog-item-code', view);
      const nameInput = $('#quick-catalog-item-name', view);
      const unitInput = $('#quick-catalog-item-unit', view);
      const priceInput = $('#quick-catalog-item-price', view);

      if (codeInput) codeInput.value = item.item_code || '';
      if (nameInput) nameInput.value = item.name_ar || '';
      if (unitInput) unitInput.value = item.unit || 'حبة';
      if (priceInput && item.sale_price !== undefined) priceInput.value = item.sale_price;
      if (select) select.value = item.id || '';

      closePopover();
      if (priceInput) {
        priceInput.focus();
        priceInput.select();
      }
    };

    const showItemSuggestions = (input) => {
      activeFloatingInput = input;
      const box = getOrCreatePopover();
      const q = input.value.trim().toLowerCase();
      if (!q) {
        closePopover();
        return;
      }

      const matches = store.items.filter((it) =>
        (it.name_ar && it.name_ar.toLowerCase().includes(q))
        || (it.name_en && it.name_en.toLowerCase().includes(q))
        || (it.item_code && it.item_code.toLowerCase().includes(q))
        || (it.barcode && it.barcode.toLowerCase().includes(q))
      ).slice(0, 10);

      if (!matches.length) {
        box.innerHTML = `
          <div class="popover-empty">
            <span>لا يوجد صنف مطابق لـ "<b>${esc(input.value)}</b>" في الدليل</span>
            <small class="muted">يمكنك المتابعة وإضافته كصنف حر جديد</small>
          </div>
        `;
        box.classList.remove('hidden');
        positionPopover(input, box);
        activePopoverIdx = -1;
        return;
      }

      activePopoverIdx = 0;
      box.innerHTML = `
        <div class="popover-head">
          <span class="popover-title">الأصناف المطابقة (${matches.length})</span>
          <span class="popover-hint">↑↓ للتنقل · Enter للاختيار</span>
        </div>
        <div class="popover-list">
          ${matches.map((it, idx) => `
            <div class="popover-item ${idx === 0 ? 'sel' : ''}" data-id="${esc(it.id)}" data-idx="${idx}">
              <div class="popover-item-main">
                <div class="popover-item-name">${esc(it.name_ar)}</div>
                ${it.name_en ? `<div class="popover-item-sub">${esc(it.name_en)}</div>` : ''}
              </div>
              <div class="popover-item-meta">
                <div class="popover-item-badges">
                  <span class="badge mono gray tiny">${esc(it.item_code || 'بدون كود')}</span>
                  ${it.barcode ? `<span class="badge mono blue tiny">${esc(it.barcode)}</span>` : ''}
                </div>
                <div class="popover-item-price">
                  <strong>${money(it.sale_price)}</strong> <small class="muted">${esc(cur)} / ${esc(it.unit || 'حبة')}</small>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      box.classList.remove('hidden');
      positionPopover(input, box);

      box.querySelectorAll('.popover-item').forEach((el) => {
        el.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const item = store.items.find((x) => x.id === el.dataset.id);
          if (item) selectCatalogItem(item);
        });
        el.addEventListener('mouseenter', () => {
          box.querySelectorAll('.popover-item').forEach((x) => x.classList.remove('sel'));
          el.classList.add('sel');
          activePopoverIdx = Number(el.dataset.idx);
        });
      });
    };

    // ربط البحث اللحظي عند الكتابة أو اللصق في اسم الصنف أو رمزه
    delegate(view, 'input', '#quick-catalog-item-name, #quick-catalog-item-code', (e, input) => {
      showItemSuggestions(input);
    });

    delegate(view, 'focus', '#quick-catalog-item-name, #quick-catalog-item-code', (e, input) => {
      if (input.value.trim().length > 0) showItemSuggestions(input);
    });

    // التنقل بالأسهم واختيار الصنف بـ Enter والإلغاء بـ Escape
    delegate(view, 'keydown', '#quick-catalog-item-name, #quick-catalog-item-code', (e, input) => {
      const box = document.getElementById('global-item-search-popover');
      const isPopoverOpen = box && !box.classList.contains('hidden');

      if (isPopoverOpen) {
        const items = [...box.querySelectorAll('.popover-item')];
        if (items.length) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            activePopoverIdx = (activePopoverIdx + 1) % items.length;
            items.forEach((it, i) => it.classList.toggle('sel', i === activePopoverIdx));
            items[activePopoverIdx]?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            activePopoverIdx = (activePopoverIdx - 1 + items.length) % items.length;
            items.forEach((it, i) => it.classList.toggle('sel', i === activePopoverIdx));
            items[activePopoverIdx]?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const sel = items[activePopoverIdx >= 0 ? activePopoverIdx : 0];
            if (sel) {
              const item = store.items.find((x) => x.id === sel.dataset.id);
              if (item) {
                selectCatalogItem(item);
                return;
              }
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            closePopover();
            return;
          }
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        closePopover();
        const priceInput = $('#quick-catalog-item-price', view);
        if (priceInput) {
          priceInput.focus();
          priceInput.select();
        }
      }
    });

    // الضغط على Enter في حقل السعر يضيف الصنف للدفعة مباشرة
    delegate(view, 'keydown', '#quick-catalog-item-price', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('#btn-add-item-to-batch', view)?.click();
      }
    });

    const onBulkWindowReposition = () => {
      if (activeFloatingInput && document.body.contains(activeFloatingInput)) {
        const box = document.getElementById('global-item-search-popover');
        if (box && !box.classList.contains('hidden')) {
          positionPopover(activeFloatingInput, box);
        }
      } else {
        closePopover();
      }
    };

    const onBulkGlobalClick = (e) => {
      const box = document.getElementById('global-item-search-popover');
      if (!box || box.classList.contains('hidden')) return;
      if (box.contains(e.target) || (activeFloatingInput && activeFloatingInput.contains(e.target))) return;
      closePopover();
    };

    window.addEventListener('scroll', onBulkWindowReposition, { passive: true });
    window.addEventListener('resize', onBulkWindowReposition, { passive: true });
    document.addEventListener('mousedown', onBulkGlobalClick);

    // تغيير اختيار الصنف السريع لملء رقم الصنف واسمه وسعره ووحدته التلقائية
    delegate(view, 'change', '#quick-catalog-item-select', (e, sel) => {
      const opt = sel.selectedOptions[0];
      const codeInput = $('#quick-catalog-item-code', view);
      const nameInput = $('#quick-catalog-item-name', view);
      const unitInput = $('#quick-catalog-item-unit', view);
      const priceInput = $('#quick-catalog-item-price', view);
      if (opt && opt.value) {
        if (codeInput) codeInput.value = opt.dataset.code || '';
        if (nameInput) nameInput.value = opt.dataset.name || '';
        if (unitInput) unitInput.value = opt.dataset.unit || 'حبة';
        if (priceInput && opt.dataset.price) priceInput.value = opt.dataset.price;
      }
    });

    // إضافة أو تحديث صنف للدفعة (سواءً من القائمة أو كتابة يدوية مباشرة)
    delegate(view, 'click', '#btn-add-item-to-batch', () => {
      closePopover();
      const select = $('#quick-catalog-item-select', view);
      const codeInput = $('#quick-catalog-item-code', view);
      const nameInput = $('#quick-catalog-item-name', view);
      const unitInput = $('#quick-catalog-item-unit', view);
      const priceInput = $('#quick-catalog-item-price', view);

      const it = (select && select.value) ? store.items.find((x) => x.id === select.value) : null;
      const customName = (nameInput && nameInput.value.trim()) || (it ? it.name_ar : '');
      if (!customName) {
        toastErr('يرجى تحديد أو كتابة اسم الصنف');
        return;
      }
      let customCode = codeInput ? codeInput.value.trim() : (it ? it.item_code || '' : '');
      if (!customCode) {
        customCode = generateNextItemCode(state.custom_items, store.items);
      }
      const customUnit = unitInput && unitInput.value.trim() ? unitInput.value.trim() : (it ? it.unit || 'حبة' : 'حبة');
      const customPrice = priceInput && priceInput.value !== '' ? Number(priceInput.value) : (it ? it.sale_price : 0);
      if (customPrice <= 0) {
        toastErr('يرجى إدخال سعر وحدة صالح أكبر من الصفر');
        return;
      }

      const existingIdx = state.custom_items.findIndex((x) => (it && x.id === it.id) || (x.name_ar === customName && x.item_code === customCode));
      if (existingIdx >= 0) {
        state.custom_items[existingIdx].item_code = customCode;
        state.custom_items[existingIdx].name_ar = customName;
        state.custom_items[existingIdx].unit = customUnit;
        state.custom_items[existingIdx].sale_price = customPrice;
        toastOk(`تم تحديث بيانات الصنف: ${customName}`);
      } else {
        state.custom_items.push({
          id: it ? it.id : null,
          item_code: customCode,
          name_ar: customName,
          unit: customUnit,
          sale_price: customPrice,
          tax_rate: (it && it.tax_rate !== undefined) ? it.tax_rate : 15,
        });
        toastOk(`تمت إضافة الصنف: ${customName} (رقم الصنف: ${customCode}) بسعر ${money(customPrice)} ${cur}`);
      }

      if (nameInput) nameInput.value = '';
      if (codeInput) codeInput.value = '';
      if (priceInput) priceInput.value = '';
      if (select) select.value = '';
      refreshCustomItemsArea();
    });

    // تغيير ترتيب الأصناف المحددة للدفعة (▲ / ▼)
    delegate(view, 'click', '[data-move-custom-item]', (e, btn) => {
      const [idxStr, dir] = btn.dataset.moveCustomItem.split(':');
      const idx = Number(idxStr);
      if (dir === 'up' && idx > 0) {
        const temp = state.custom_items[idx];
        state.custom_items[idx] = state.custom_items[idx - 1];
        state.custom_items[idx - 1] = temp;
        refreshCustomItemsArea();
      } else if (dir === 'down' && idx < state.custom_items.length - 1) {
        const temp = state.custom_items[idx];
        state.custom_items[idx] = state.custom_items[idx + 1];
        state.custom_items[idx + 1] = temp;
        refreshCustomItemsArea();
      }
    });

    // إضافة صنف مخصص بالكامل (طوالي مش من المجموعات)
    delegate(view, 'click', '#btn-add-custom-adhoc', () => {
      const nextCode = generateNextItemCode(state.custom_items, store.items);
      const m = modal({
        title: 'إضافة صنف مخصص جديد للدفعة',
        slim: true,
        body: html`
          <div class="row">
            <div class="field" style="max-width:140px">
              <label>رقم / كود الصنف</label>
              <input type="text" name="item_code" class="mono" value="${esc(nextCode)}" placeholder="مثال: ${esc(nextCode)}" />
            </div>
            <div class="field" style="flex:2">
              <label class="req">اسم الصنف أو الخدمة</label>
              <input type="text" name="name_ar" placeholder="اسم الصنف بالعربية" required />
            </div>
          </div>
          <div class="row mt">
            <div class="field">
              <label class="req">سعر الوحدة (${esc(cur)})</label>
              <input type="number" step="any" min="0.01" name="sale_price" value="100" required />
            </div>
            <div class="field">
              <label>الوحدة</label>
              <input type="text" name="unit" value="حبة" placeholder="حبة، كرتون، ساعة..." />
            </div>
            <div class="field" style="max-width:110px">
              <label>الضريبة %</label>
              <input type="number" step="any" min="0" max="100" name="tax_rate" value="15" />
            </div>
          </div>`,
        footer: `<button class="btn" data-close type="button">إلغاء</button>
                 <button class="btn btn-primary" data-save-adhoc type="button">إضافة الصنف</button>`,
      });
      m.el.querySelector('[data-save-adhoc]').addEventListener('click', () => {
        const values = formValues(m.body);
        if (!values.name_ar || !values.name_ar.trim()) {
          toastErr('اسم الصنف مطلوب');
          return;
        }
        const price = Number(values.sale_price) || 0;
        if (price <= 0) {
          toastErr('أدخل سعر وحدة صالح أكبر من الصفر');
          return;
        }
        const code = (values.item_code || '').trim() || generateNextItemCode(state.custom_items, store.items);
        state.custom_items.push({
          id: null,
          item_code: code,
          name_ar: values.name_ar.trim(),
          unit: (values.unit || '').trim() || 'حبة',
          sale_price: price,
          tax_rate: values.tax_rate !== '' ? Number(values.tax_rate) : 15,
        });
        m.close();
        refreshCustomItemsArea();
        toastOk(`تمت إضافة الصنف: ${values.name_ar.trim()} (رقم: ${code})`);
      });
    });

    // توليد أرقام الأصناف آلياً للأصناف الحرة في الدفعة
    delegate(view, 'click', '#btn-autogen-custom-codes', () => {
      if (!state.custom_items.length) {
        toastErr('لا توجد أصناف في جدول الدفعة بعد');
        return;
      }
      for (const it of state.custom_items) {
        if (!it.item_code || !it.item_code.trim()) {
          it.item_code = generateNextItemCode(state.custom_items, store.items);
        }
      }
      refreshCustomItemsArea();
      toastOk(`تم توليد وتحديث أرقام الأصناف لجميع أصناف الدفعة (${state.custom_items.length} صنف)`);
    });

    // استيراد جميع الأصناف النشطة
    delegate(view, 'click', '#btn-import-all-catalog', () => {
      const activeItems = store.items.filter((it) => it.is_active !== false && it.sale_price > 0);
      for (const it of activeItems) {
        if (!state.custom_items.some((x) => x.id === it.id)) {
          state.custom_items.push({
            id: it.id,
            item_code: it.item_code,
            name_ar: it.name_ar,
            unit: it.unit || 'حبة',
            sale_price: it.sale_price,
            tax_rate: it.tax_rate !== undefined ? it.tax_rate : 15,
          });
        }
      }
      refreshCustomItemsArea();
      toastOk(`تم إدراج ${activeItems.length} صنف في جدول الأصناف المخصصة`);
    });

    // إضافة أصناف مجموعة كاملة
    delegate(view, 'click', '[data-add-cat-items]', (e, btn) => {
      const catId = btn.dataset.addCatItems;
      const cat = store.categories.find((c) => c.id === catId);
      const catItems = store.items.filter((it) => it.category_id === catId && it.is_active !== false);
      if (!catItems.length) {
        toastErr(`لا توجد أصناف في مجموعة ${cat ? cat.name : ''}`);
        return;
      }
      let added = 0;
      for (const it of catItems) {
        if (!state.custom_items.some((x) => x.id === it.id)) {
          state.custom_items.push({
            id: it.id,
            item_code: it.item_code,
            name_ar: it.name_ar,
            unit: it.unit || 'حبة',
            sale_price: it.sale_price,
            tax_rate: it.tax_rate !== undefined ? it.tax_rate : 15,
          });
          added++;
        }
      }
      refreshCustomItemsArea();
      toastOk(`تمت إضافة ${added} صنف من مجموعة ${cat ? cat.name : ''}`);
    });

    // حذف صنف من قائمة الأصناف المخصصة
    delegate(view, 'click', '[data-remove-custom-item]', (e, btn) => {
      const idx = Number(btn.dataset.removeCustomItem);
      if (state.custom_items[idx]) {
        const removed = state.custom_items.splice(idx, 1);
        refreshCustomItemsArea();
        toastOk(`تم حذف ${removed[0].name_ar} من أصناف الدفعة`);
      }
    });

    // تعديل الحقول في جدول الأصناف المخصصة (الكود، الاسم، الوحدة، السعر)
    delegate(view, 'input', '.custom-item-prop', (e, input) => {
      const idx = Number(input.dataset.idx);
      const prop = input.dataset.prop;
      if (state.custom_items[idx]) {
        if (prop === 'sale_price') {
          state.custom_items[idx].sale_price = Number(input.value) || 0;
        } else {
          state.custom_items[idx][prop] = input.value;
        }
      }
    });

    // تعديل جماعي لأسعار الأصناف المخصصة
    delegate(view, 'click', '#btn-bulk-price-adjust', async () => {
      if (!state.custom_items.length) return;
      const pctStr = await promptDialog({
        title: 'تعديل جماعي للأسعار',
        label: 'أدخل نسبة التعديل المئوية (مثال: 10 لزيادة 10%، أو -5 لخصم 5%)',
        value: '10',
      });
      if (pctStr === null || pctStr === '') return;
      const pct = Number(pctStr);
      if (Number.isNaN(pct)) { toastErr('أدخل رقماً صحيحاً'); return; }
      for (const it of state.custom_items) {
        const newPrice = Math.max(0.01, Math.round(it.sale_price * (1 + pct / 100) * 100) / 100);
        it.sale_price = newPrice;
      }
      refreshCustomItemsArea();
      toastOk(`تم تعديل جميع الأسعار بنسبة ${pct}%`);
    });

    // استعادة الأسعار الأصلية
    delegate(view, 'click', '#btn-reset-default-prices', () => {
      for (const ci of state.custom_items) {
        if (ci.id) {
          const original = store.items.find((x) => x.id === ci.id);
          if (original) ci.sale_price = original.sale_price;
        }
      }
      refreshCustomItemsArea();
      toastOk('تمت استعادة الأسعار الأصلية للأصناف من الدليل');
    });

    // مسح الكل
    delegate(view, 'click', '#btn-clear-custom-items', () => {
      state.custom_items = [];
      refreshCustomItemsArea();
      toastOk('تم تفريغ قائمة الأصناف المخصصة والرجوع للكتالوج العام');
    });

    // تغيير نمط التوزيع
    delegate(view, 'change', 'input[name="distribution_mode"]', (e, radio) => {
      if (radio.checked) {
        state.distribution_mode = radio.value;
        view.querySelectorAll('.distribution-card').forEach((card) => {
          const r = card.querySelector('input[type="radio"]');
          if (r) card.classList.toggle('is-active', r.checked);
        });
      }
    });

    // تغيير مرحلة باركود الزكاة
    delegate(view, 'change', 'input[name="bulk_zatca_phase"]', (e, radio) => {
      if (radio.checked) {
        state.zatca_phase = radio.value;
        view.querySelectorAll('.segmented-option').forEach((opt) => {
          const r = opt.querySelector('input[type="radio"]');
          if (r) opt.classList.toggle('is-active', r.checked);
        });
        const hint = $('#bulk-phase-hint', view);
        if (hint) {
          hint.textContent = state.zatca_phase === 'PHASE2'
            ? 'باركود مشفر وموقع رقمياً (هاش وتوقيع وسلسلة فواتير)'
            : 'باركود مشفر بالحقول الخمسة الأساسية';
        }
        if (state.preview && state.preview.invoices) {
          state.preview.invoices.forEach((inv) => {
            inv.zatca_phase = state.zatca_phase;
          });
          const area = $('#preview-area', view);
          if (area) area.innerHTML = previewHtml();
        }
      }
    });

    delegate(view, 'click', '[data-pay]', (e, chip) => {
      const id = chip.dataset.pay;
      if (state.payment_methods.includes(id)) {
        if (state.payment_methods.length === 1) return;
        state.payment_methods = state.payment_methods.filter((x) => x !== id);
      } else state.payment_methods.push(id);
      chip.classList.toggle('on');
    });

    const prevBtn = $('#preview', view);
    if (prevBtn) prevBtn.addEventListener('click', () => runPreview());

    // التعامل مع المسودات
    delegate(view, 'click', '#refresh-drafts', async () => {
      await loadDraftsList();
      const area = $('#drafts-area', view);
      if (area) area.innerHTML = draftsSectionHtml();
      toastOk('تم تحديث قائمة المسودات');
    });

    delegate(view, 'click', '[data-open-draft]', async (e, btn) => {
      const draftId = btn.dataset.openDraft;
      btn.disabled = true;
      btn.textContent = '⏳ فتح…';
      try {
        const draft = await api.get(`/api/bulk/drafts/${draftId}`);
        state.current_draft_id = draft.id;
        state.issuer_id = draft.issuer_id;
        if (draft.client_id) state.client_id = draft.client_id;
        state.preview = {
          invoices: draft.invoices,
          summary: draft.summary,
          options: draft.options || {},
          title: draft.title,
        };
        if (draft.options?.zatca_phase) {
          state.zatca_phase = draft.options.zatca_phase;
          const radio = $(`input[name="bulk_zatca_phase"][value="${state.zatca_phase}"]`, view);
          if (radio) radio.checked = true;
          const hint = $('#bulk-phase-hint', view);
          if (hint) {
            hint.textContent = state.zatca_phase === 'PHASE2'
              ? 'باركود مشفر وموقع رقمياً (هاش وتوقيع وسلسلة فواتير)'
              : 'باركود مشفر بالحقول الخمسة الأساسية';
          }
        }
        recalcPreviewSummary();
        const area = $('#preview-area', view);
        if (area) area.innerHTML = previewHtml();
        const draftsArea = $('#drafts-area', view);
        if (draftsArea) draftsArea.innerHTML = draftsSectionHtml();
        toastOk(`تم فتح المسودة: ${draft.title}`);
      } catch (err) {
        toastErr(err.message || 'تعذر فتح المسودة');
      }
    });

    delegate(view, 'click', '[data-del-draft]', async (e, btn) => {
      const draftId = btn.dataset.delDraft;
      const ok = await confirmDialog({ title: 'حذف المسودة', message: 'هل أنت متأكد من حذف هذه المسودة المحفوظة؟', danger: true });
      if (!ok) return;
      try {
        await api.delete(`/api/bulk/drafts/${draftId}`);
        if (state.current_draft_id === draftId) state.current_draft_id = null;
        await loadDraftsList();
        const area = $('#drafts-area', view);
        if (area) area.innerHTML = draftsSectionHtml();
        toastOk('تم حذف المسودة');
      } catch (err) {
        toastErr(err.message || 'تعذر حذف المسودة');
      }
    });

    // تفويض نقرات أزرار وإجراءات المعاينة بشكل دائم على الحاوية view لتفادي فقدان الأحداث عند إعادة بناء DOM
    delegate(view, 'click', '#btn-sample-print', () => openBulkInvoicePreviewModal(0));
    delegate(view, 'click', '[data-preview-inv]', (e, btn) => openBulkInvoicePreviewModal(Number(btn.dataset.previewInv)));
    delegate(view, 'click', '#commit', () => commit());
    delegate(view, 'click', '#btn-save-draft', () => saveDraft());
    delegate(view, 'click', '#btn-print-preview', () => printBulkPreview());
    delegate(view, 'click', '#regen', () => regenPreview());
    delegate(view, 'click', '#pv-csv', () => exportBulkCsv());
    delegate(view, 'click', '#pv-xls', () => exportBulkXls());

    delegate(view, 'click', '[data-toggle-edit]', (e, btn) => {
      const idx = Number(btn.dataset.toggleEdit);
      state.activeEditIndex = state.activeEditIndex === idx ? null : idx;
      const area = $('#preview-area', view);
      if (area) area.innerHTML = previewHtml();
    });

    delegate(view, 'click', '[data-remove-inv]', (e, btn) => {
      const idx = Number(btn.dataset.removeInv);
      if (!state.preview || !state.preview.invoices[idx]) return;
      state.preview.invoices.splice(idx, 1);
      recalcPreviewSummary();
      const area = $('#preview-area', view);
      if (area) area.innerHTML = previewHtml();
      toastOk('تم حذف الفاتورة من الدفعة');
    });

    delegate(view, 'change', '.inv-field', (e, input) => {
      const idx = Number(input.dataset.idx);
      const field = input.dataset.field;
      if (!state.preview || !state.preview.invoices[idx]) return;
      state.preview.invoices[idx][field] = input.value;
    });

    delegate(view, 'click', '#btn-add-manual-inv', () => {
      if (!state.preview) return;
      const defaultItem = state.custom_items[0] || store.items[0] || { id: null, name_ar: 'صنف عام', sale_price: 100, unit: 'حبة', tax_rate: 15 };
      const newInv = {
        temp_id: `tmp-${state.preview.invoices.length + 1}`,
        issue_date: state.preview.invoices.length ? state.preview.invoices[state.preview.invoices.length - 1].issue_date : state.date_to,
        issue_time: '12:00:00',
        invoice_type: state.invoice_type,
        zatca_phase: state.zatca_phase || 'PHASE1',
        payment_method: state.payment_methods[0] || 'CREDIT',
        notes: '',
        lines: [
          {
            item_id: defaultItem.id || null,
            item_code: defaultItem.item_code || '',
            item_name: defaultItem.name_ar,
            unit: defaultItem.unit || 'حبة',
            quantity: 1,
            unit_price: defaultItem.sale_price,
            discount: 0,
            tax_rate: defaultItem.tax_rate !== undefined ? defaultItem.tax_rate : 15,
          },
        ],
        subtotal: defaultItem.sale_price,
        discount_amount: 0,
        taxable_amount: defaultItem.sale_price,
        tax_amount: Math.round(defaultItem.sale_price * 0.15 * 100) / 100,
        grand_total: Math.round(defaultItem.sale_price * 1.15 * 100) / 100,
      };
      state.preview.invoices.push(newInv);
      state.activeEditIndex = state.preview.invoices.length - 1;
      recalcPreviewSummary();
      const area = $('#preview-area', view);
      if (area) area.innerHTML = previewHtml();
      toastOk('تمت إضافة فاتورة يدوية جديدة إلى الدفعة');
    });

    delegate(view, 'change', '.line-input', (e, input) => {
      const invIdx = Number(input.dataset.inv);
      const lineIdx = Number(input.dataset.line);
      const lfield = input.dataset.lfield;
      if (!state.preview || !state.preview.invoices[invIdx] || !state.preview.invoices[invIdx].lines[lineIdx]) return;
      if (lfield === 'item_code' || lfield === 'unit' || lfield === 'item_name') {
        state.preview.invoices[invIdx].lines[lineIdx][lfield] = input.value;
      } else {
        state.preview.invoices[invIdx].lines[lineIdx][lfield] = Number(input.value) || 0;
        recalcPreviewSummary();
        const area = $('#preview-area', view);
        if (area) area.innerHTML = previewHtml();
      }
    });

    delegate(view, 'click', '[data-add-item]', (e, btn) => {
      const idx = Number(btn.dataset.addItem);
      const select = $(`#quick-add-item-${idx}`, view);
      if (!select || !select.value) { toastErr('اختر صنفاً أولاً'); return; }
      const it = store.items.find((item) => item.id === select.value);
      if (!it) return;
      state.preview.invoices[idx].lines.push({
        item_id: it.id,
        item_code: it.item_code,
        item_name: it.name_ar,
        unit: it.unit || 'حبة',
        quantity: 1,
        unit_price: it.sale_price,
        discount: 0,
        tax_rate: 15,
      });
      recalcPreviewSummary();
      const area = $('#preview-area', view);
      if (area) area.innerHTML = previewHtml();
      toastOk(`تمت إضافة الصنف: ${it.name_ar}`);
    });

    delegate(view, 'click', '[data-del-line]', (e, btn) => {
      const [invIdx, lineIdx] = btn.dataset.delLine.split(':').map(Number);
      if (!state.preview || !state.preview.invoices[invIdx]) return;
      if (state.preview.invoices[invIdx].lines.length <= 1) {
        toastErr('يجب أن تحتوي الفاتورة على بند واحد على الأقل');
        return;
      }
      state.preview.invoices[invIdx].lines.splice(lineIdx, 1);
      recalcPreviewSummary();
      const area = $('#preview-area', view);
      if (area) area.innerHTML = previewHtml();
    });
  }

  async function openBulkInvoicePreviewModal(targetIndex = 0) {
    if (!state.preview || !state.preview.invoices || !state.preview.invoices.length) {
      toastErr('لا توجد فواتير مُولَّدة بعد للمعاينة');
      return;
    }

    let currentIdx = Math.max(0, Math.min(targetIndex, state.preview.invoices.length - 1));
    let currentStyle = state.selected_template || '01-royal-navy';
    let zoomLevel = 100;
    let currentHtml = '';

    const modalInst = modal({
      title: 'معاينة فواتير الدفعة بالقالب التفاعلي',
      wide: true,
      body: html`
        <div class="bulk-preview-modal-content" style="display:flex;flex-direction:column;gap:.75rem">
          <!-- شريط التحكم العلوي: اختيار القالب والتنقل بين الفواتير والإجراءات -->
          <div class="card" style="padding:.65rem .85rem;margin:0;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem">
            <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
              <span style="font-weight:700;font-size:13px;color:var(--brand);white-space:nowrap">
                قالب الفاتورة:
              </span>
              <select id="modal-bulk-tpl-picker" class="input input-sm" style="min-width:280px;max-width:440px;font-size:13px;padding:5px 10px;border-radius:6px;border:1px solid var(--line);background:var(--field-bg, var(--card));color:var(--text);font-weight:700;cursor:pointer">
                ${raw(buildTemplateOptions(currentStyle))}
              </select>
              <button class="btn btn-sm" id="modal-btn-adopt-tpl" type="button" style="font-size:12px;padding:5px 10px;background:var(--brand-light);border:1px solid var(--brand);color:var(--brand);font-weight:700;white-space:nowrap;border-radius:6px" title="اعتماد هذا القالب للدفعة الحالية">
                ${raw(icon.checkCircle({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}اعتماد هذا القالب للدفعة
              </button>
            </div>

            <!-- أزرار التنقل بين الفواتير -->
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
              <button class="btn btn-sm" id="modal-bulk-prev" type="button" title="الفاتورة السابقة">
                ◀ السابق
              </button>
              <select id="modal-bulk-inv-select" class="input input-sm" style="font-size:12px;padding:4px 8px;border-radius:6px;max-width:240px;font-weight:600">
                ${raw(state.preview.invoices.map((inv, i) => `
                  <option value="${i}" ${i === currentIdx ? 'selected' : ''}>
                    فاتورة #${i + 1} (${money(inv.grand_total)} ${esc(cur)})
                  </option>
                `).join(''))}
              </select>
              <button class="btn btn-sm" id="modal-bulk-next" type="button" title="الفاتورة التالية">
                التالي ▶
              </button>
            </div>

            <!-- أدوات التكبير/التصغير والإجراءات -->
            <div style="display:flex;align-items:center;gap:.5rem">
              <div class="tpl-zoom-controls" style="display:inline-flex;align-items:center;border:1px solid var(--line-strong);border-radius:6px;overflow:hidden">
                <button type="button" class="btn btn-sm pad0" id="modal-zoom-out" style="width:26px;height:26px;border-radius:0" title="تصغير">−</button>
                <span id="modal-zoom-val" style="padding:0 8px;font-size:11px;font-weight:bold" class="num">${zoomLevel}%</span>
                <button type="button" class="btn btn-sm pad0" id="modal-zoom-in" style="width:26px;height:26px;border-radius:0" title="تكبير">+</button>
              </div>
              <button class="btn btn-sm" id="modal-bulk-print" type="button" style="background:#0284c7;color:#fff;font-weight:600">
                ${raw(icon.printer({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}طباعة الفاتورة
              </button>
              <button class="btn btn-sm" id="modal-bulk-pdf" type="button" style="background:#d97706;color:#fff;font-weight:600">
                ${raw(icon.pdf({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}تحميل PDF
              </button>
            </div>
          </div>

          <!-- شاشة عرض المستند الورقي الحقيقي -->
          <div class="tpl-paper-wrapper" style="min-height:72vh;max-height:76vh;overflow:auto;background:rgba(0,0,0,0.3);border-radius:8px;padding:1.5rem 1rem;display:flex;justify-content:center;align-items:flex-start">
            <div id="modal-paper-frame" style="transform:scale(1);transform-origin:top center;transition:transform 0.15s ease;width:100%;max-width:960px;box-shadow:0 8px 30px rgba(0,0,0,0.5);border-radius:4px;overflow:hidden">
              <iframe id="modal-preview-iframe" style="width:100%;min-height:297mm;border:none;background:#ffffff;display:block" title="معاينة الفاتورة"></iframe>
            </div>
          </div>
        </div>
      `,
      footer: null,
    });

    const modalEl = modalInst.el.querySelector('.modal');
    if (modalEl) {
      modalEl.style.maxWidth = '1260px';
      modalEl.style.width = '96vw';
    }

    const iframe = modalInst.el.querySelector('#modal-preview-iframe');
    const tplPicker = modalInst.el.querySelector('#modal-bulk-tpl-picker');
    const invSelect = modalInst.el.querySelector('#modal-bulk-inv-select');
    const prevBtn = modalInst.el.querySelector('#modal-bulk-prev');
    const nextBtn = modalInst.el.querySelector('#modal-bulk-next');
    const adoptBtn = modalInst.el.querySelector('#modal-btn-adopt-tpl');
    const printBtn = modalInst.el.querySelector('#modal-bulk-print');
    const pdfBtn = modalInst.el.querySelector('#modal-bulk-pdf');
    const zoomInBtn = modalInst.el.querySelector('#modal-zoom-in');
    const zoomOutBtn = modalInst.el.querySelector('#modal-zoom-out');
    const zoomVal = modalInst.el.querySelector('#modal-zoom-val');
    const paperFrame = modalInst.el.querySelector('#modal-paper-frame');

    const updateZoom = (z) => {
      zoomLevel = Math.max(50, Math.min(150, z));
      if (zoomVal) zoomVal.textContent = `${zoomLevel}%`;
      if (paperFrame) paperFrame.style.transform = `scale(${zoomLevel / 100})`;
    };

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => updateZoom(zoomLevel + 10));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => updateZoom(zoomLevel - 10));

    async function loadCurrentInvoiceHtml() {
      const inv = state.preview.invoices[currentIdx];
      if (!inv || !iframe) return;

      iframe.srcdoc = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
        <style>body{margin:0;min-height:297mm;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;background:#fff;color:#475569;}
        .spin{width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:#0d9488;border-radius:50%;animation:s .7s linear infinite;}@keyframes s{to{transform:rotate(360deg)}}
        </style></head><body><div class="spin"></div><p style="margin-top:14px;font-weight:bold;font-size:14px">جارٍ تطبيق وتجهيز القالب (${esc(currentStyle)})...</p></body></html>`;

      const issuer = store.issuers.find((i) => i.id === state.issuer_id) || { name_ar: 'الشركة المصدرة', currency: 'SAR' };
      const client = store.clients.find((c) => c.id === state.client_id) || { name: 'العميل' };

      try {
          const res = await fetch('/api/invoices/preview-render-html', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              issuer_id: state.issuer_id,
              client_id: state.client_id,
              style: currentStyle,
              invoice: {
                invoice_number: inv.invoice_number || `${(issuer.invoice_prefix || 'INV').replace(/[-\s]+$/, '').trim() || 'INV'}-${String(currentIdx + 1).padStart(4, '0')}`,
                issue_date: inv.issue_date,
                issue_time: inv.issue_time || '10:00:00',
                invoice_type: inv.invoice_type || state.invoice_type || 'STANDARD',
                zatca_phase: inv.zatca_phase || state.zatca_phase || 'PHASE1',
                qr_payload: inv.qr_payload || '',
                invoice_hash: inv.invoice_hash || '',
                payment_method: inv.payment_method || 'CREDIT',
                notes: inv.notes || '',
                subtotal: inv.subtotal,
                discount_amount: inv.discount_amount,
                taxable_amount: inv.taxable_amount,
                tax_amount: inv.tax_amount,
                grand_total: inv.grand_total,
                lines: inv.lines,
              },
            }),
          });
          if (res.ok) {
            const htmlText = await res.text();
            if (htmlText && htmlText.length > 500) {
              currentHtml = htmlText;
              iframe.srcdoc = htmlText;
              return;
            }
          }
      } catch { /* the selected data template may be unavailable */ }

      currentHtml = '';
      iframe.srcdoc = '<p dir="rtl">تعذر تحميل قالب المعاينة من data. تحقق من ملف القالب المختار.</p>';
    }

    const syncNav = () => {
      if (prevBtn) prevBtn.disabled = currentIdx <= 0;
      if (nextBtn) nextBtn.disabled = currentIdx >= state.preview.invoices.length - 1;
      if (invSelect) invSelect.value = String(currentIdx);
      loadCurrentInvoiceHtml();
    };

    if (tplPicker) {
      tplPicker.addEventListener('change', (e) => {
        currentStyle = e.target.value;
        state.selected_template = currentStyle;
        loadCurrentInvoiceHtml();
      });
    }

    if (invSelect) {
      invSelect.addEventListener('change', (e) => {
        currentIdx = Number(e.target.value);
        syncNav();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentIdx > 0) {
          currentIdx--;
          syncNav();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (currentIdx < state.preview.invoices.length - 1) {
          currentIdx++;
          syncNav();
        }
      });
    }

    if (adoptBtn) {
      adoptBtn.addEventListener('click', () => {
        state.selected_template = currentStyle;
        const mainTplSelect = $('#selected_template', view);
        if (mainTplSelect) mainTplSelect.value = currentStyle;
        toastOk(`تم اعتماد القالب (${currentStyle}) لهذه الدفعة`);
      });
    }

    if (printBtn) {
      printBtn.addEventListener('click', () => {
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } else if (currentHtml) {
          printDoc(currentHtml);
        }
      });
    }

    if (pdfBtn) {
      pdfBtn.addEventListener('click', async () => {
        if (!currentHtml) return;
        pdfBtn.disabled = true;
        pdfBtn.textContent = '⏳ جاري إنشاء الـ PDF…';
        try {
          const inv = state.preview.invoices[currentIdx];
          const invNum = inv?.invoice_number || `INV-${currentIdx + 1}`;
          const res = await fetch('/api/pdf/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              html: currentHtml,
              filename: `invoice_${invNum}.pdf`,
            }),
          });
          if (!res.ok) throw new Error('فشل توليد ملف PDF');
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `invoice_${invNum}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          toastOk('تم تحميل ملف PDF بنجاح');
        } catch (err) {
          toastErr(err.message || 'تعذر تحميل PDF');
        } finally {
          pdfBtn.disabled = false;
          pdfBtn.innerHTML = `${raw(icon.pdf({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}تحميل PDF`;
        }
      });
    }

    syncNav();
  }

  const printBulkPreview = async () => {
    if (!state.preview || !state.preview.invoices || !state.preview.invoices.length) {
      toastErr('لا توجد فواتير مُولَّدة للطباعة');
      return;
    }
    const issuer = store.issuers.find((i) => i.id === state.issuer_id) || { name_ar: 'الشركة المصدرة', currency: 'SAR' };
    const client = store.clients.find((c) => c.id === state.client_id) || { name: 'العميل' };
    try {
      const template = await loadStoredTemplate('reports');
      const rows = state.preview.invoices.map((inv) => `<tr><td>${esc(inv.invoice_number || '')}</td><td>${esc(client.name || '')}</td><td>${esc(money(inv.grand_total || 0))}</td></tr>`).join('');
      printDoc(fillStoredTemplate(template, {
        title: state.preview.title || 'معاينة دفعة فواتير', subtitle: issuer.name_ar || '',
        issuer_name: issuer.name_ar || '', generated_at: new Date().toLocaleString('ar-SA'), page_size: 'A4 portrait',
        stats_html: '', headers_html: '<th>رقم الفاتورة</th><th>العميل</th><th>الإجمالي</th>',
        rows_html: rows, footer_html: '',
      }, ['stats_html', 'headers_html', 'rows_html', 'footer_html']));
    } catch (err) { toastErr(err.message || 'تعذر تحميل قالب التقرير'); }
  };

  const saveDraft = async () => {
    if (!state.preview || !state.preview.invoices || !state.preview.invoices.length) {
      toastErr('لا توجد فواتير مُولَّدة لحفظها كمسودة');
      return;
    }
    const defaultTitle = state.preview.title || `معاينة دفعة ${today()} (${state.preview.invoices.length} فاتورة)`;
    const title = await promptDialog({ title: 'حفظ المسودة', label: 'اسم / عنوان المسودة', value: defaultTitle });
    if (!title) return;
    try {
      const res = await api.post('/api/bulk/drafts', {
        id: state.current_draft_id || undefined,
        title,
        issuer_id: state.issuer_id,
        client_id: state.client_id,
        invoices: state.preview.invoices,
        options: state.preview.options || payload(),
      });
      state.current_draft_id = res.id;
      state.preview.title = res.title;
      await loadDraftsList();
      const draftsArea = $('#drafts-area', view);
      if (draftsArea) draftsArea.innerHTML = draftsSectionHtml();
      toastOk(`تم حفظ المسودة بنجاح (${res.title})`);
    } catch (err) {
      toastErr(err.message || 'تعذر حفظ المسودة');
    }
  };

  const regenPreview = () => {
    state.seed = String(Math.floor(Math.random() * 2000000000));
    const seedInput = $('#seed', view);
    if (seedInput) seedInput.value = state.seed;
    runPreview();
  };

  const exportBulkCsv = () => {
    if (!state.preview || !state.preview.invoices || !state.preview.invoices.length) {
      toastErr('لا توجد بيانات للتصدير');
      return;
    }
    const headers = ['#', 'التاريخ', 'الوقت', 'عدد الأصناف', 'طريقة الدفع', 'قبل الضريبة', 'الخصم', 'الضريبة', 'الإجمالي'];
    const rows = state.preview.invoices.map((inv, i) => [
      i + 1,
      inv.issue_date,
      inv.issue_time || '10:00:00',
      (inv.lines || inv.items || []).length,
      PAY_LABELS[inv.payment_method] || inv.payment_method,
      inv.taxable_amount,
      inv.discount_amount,
      inv.tax_amount,
      inv.grand_total,
    ]);
    exportCsv('معاينة-الدفعة', headers, rows);
  };

  const exportBulkXls = () => {
    if (!state.preview || !state.preview.invoices || !state.preview.invoices.length) {
      toastErr('لا توجد بيانات للتصدير');
      return;
    }
    const headers = ['#', 'التاريخ', 'الوقت', 'عدد الأصناف', 'طريقة الدفع', 'قبل الضريبة', 'الخصم', 'الضريبة', 'الإجمالي'];
    const rows = state.preview.invoices.map((inv, i) => [
      i + 1,
      inv.issue_date,
      inv.issue_time || '10:00:00',
      (inv.lines || inv.items || []).length,
      PAY_LABELS[inv.payment_method] || inv.payment_method,
      inv.taxable_amount,
      inv.discount_amount,
      inv.tax_amount,
      inv.grand_total,
    ]);
    exportExcel('معاينة-الدفعة', 'معاينة دفعة الفواتير', headers, rows);
  };

  async function runPreview() {
    if (state.busy) return;
    state.busy = true;
    const btn = $('#preview', view);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'جارٍ التوليد…';
    }
    try {
      state.preview = await api.post('/api/bulk/preview', payload());
      state.current_draft_id = null;
      recalcPreviewSummary();

      // حفظ تلقائي كمسودة إن كان الخيار مفعلاً
      if (state.auto_save_draft) {
        try {
          const autoDraft = await api.post('/api/bulk/drafts', {
            title: `معاينة دفعة ${today()} (${state.preview.invoices.length} فاتورة)`,
            issuer_id: state.issuer_id,
            client_id: state.client_id,
            invoices: state.preview.invoices,
            options: state.preview.options || payload(),
          });
          state.current_draft_id = autoDraft.id;
          state.preview.title = autoDraft.title;
          await loadDraftsList();
          const draftsArea = $('#drafts-area', view);
          if (draftsArea) draftsArea.innerHTML = draftsSectionHtml();
        } catch { /* ignore auto-draft save error */ }
      }

      const area = $('#preview-area', view);
      if (area) area.innerHTML = previewHtml();
      toastOk(`تم توليد ${state.preview.summary.count} فاتورة للمعاينة`);
    } catch (err) {
      toastErr(err.message || 'فشل التوليد');
    } finally {
      state.busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'توليد معاينة جديدة';
      }
    }
  }

  async function commit() {
    if (!state.preview || !state.preview.invoices.length) return;
    const s = state.preview.summary;
    const voucherMsg = state.issue_vouchers ? ' مع توليد وتخصيص سندات قبض مطابقة آلياً،' : '';
    const ok = await confirmDialog({
      title: 'اعتماد الدفعة بالكامل',
      message: `سيتم حفظ ${s.count} فاتورة بإجمالي ${money(s.grand_total)} ${cur} على العميل${voucherMsg} مع ترقيم رسمي ورموز QR وسلسلة بصمات PIH غير قابلة للتعديل. هل ترغب في المتابعة؟`,
      okText: 'اعتماد وحفظ',
    });
    if (!ok) return;
    const btn = $('#commit', view);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'جارٍ الحفظ والترحيل…';
    }
    try {
      const reqId = state.preview.request_id || (window.crypto?.randomUUID ? window.crypto.randomUUID() : (`req-${Date.now()}-${Math.random().toString(36).slice(2)}`));
      state.preview.request_id = reqId;
      const res = await api.post('/api/bulk/commit', {
        request_id: reqId,
        draft_id: state.current_draft_id || undefined,
        issuer_id: state.issuer_id,
        client_id: state.client_id,
        invoices: state.preview.invoices,
        options: state.preview.options || payload(),
        issue_vouchers: state.issue_vouchers,
      });
      const vText = res.vouchers_count ? ` و ${res.vouchers_count} سند قبض` : '';
      toastOk(`تم حفظ ${res.count} فاتورة${vText} بإجمالي ${money(res.total_amount)} ${cur}`);
      showBatchSuccessModal({
        batchId: res.batch_id,
        count: res.count,
        vouchersCount: res.vouchers_count || 0,
        totalAmount: res.total_amount,
        cur,
        style: state.selected_template || state.invoice_template || 'default',
      });
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'اعتماد وحفظ';
      }
      toastErr(err.message || 'فشل الاعتماد');
    }
  }

  function showBatchSuccessModal({ batchId, count, vouchersCount: initialVouchersCount, totalAmount, cur, style }) {
    let currentVouchersCount = initialVouchersCount || 0;
    let activeStyle = style || 'default';

    const m = modal({
      title: 'تم اعتماد وحفظ الدفعة بنجاح',
      wide: true,
      body: html`
        <div class="stack" style="gap:1.2rem;padding:.5rem 0;">
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:1.2rem 1.4rem;display:flex;align-items:center;gap:1rem;">
            <div style="font-size:2.2rem;line-height:1;color:var(--success, #10b981);">✓</div>
            <div>
              <h3 style="margin:0 0 .3rem 0;color:var(--text, #fff);font-size:1.15rem;">تم إصدار وحفظ ${num(count)} فاتورة رسمية بنجاح</h3>
              <p style="margin:0;font-size:.88rem;color:var(--muted);line-height:1.5;">
                إجمالي الدفعة: <b class="num" style="color:var(--text);font-size:1rem;">${money(totalAmount)} ${cur}</b>
                <span id="modal-batch-vouchers-label">${raw(currentVouchersCount > 0 ? ` — تم إصدار <b style="color:var(--primary, #0d9488)">${num(currentVouchersCount)}</b> سند قبض آلياً.` : '')}</span>
                <br><span class="tiny mono" style="opacity:.8">معرّف الدفعة: ${esc(batchId)}</span>
              </p>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:.7rem;background:rgba(255,255,255,0.03);padding:.7rem 1rem;border-radius:8px;border:1px solid var(--border-color, #334155);flex-wrap:wrap;">
            <label for="modal-batch-tpl-select" style="font-size:.9rem;font-weight:700;white-space:nowrap;margin:0;color:var(--text);">قالب طباعة فواتير الدفعة:</label>
            <select id="modal-batch-tpl-select" class="input" style="flex:1;min-width:220px;padding:.4rem .6rem;font-size:.88rem;">
              ${raw(buildTemplateOptions(activeStyle))}
            </select>
          </div>

          <div style="font-size:.92rem;font-weight:700;color:var(--text);margin-top:.2rem;">إجراءات الطباعة والتحميل الفورية للدفعة:</div>

          <div class="grid grid-3" style="gap:.8rem;">
            <div class="card" style="padding:1rem;display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line);background:var(--card);">
              <div>
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
                  <span style="color:var(--primary, #0d9488);">${raw(icon.printer({ size: 20 }))}</span>
                  <b style="font-size:.95rem;">طباعة فواتير الدفعة (A4)</b>
                </div>
                <p class="tiny muted" style="margin:0 0 1rem 0;line-height:1.4;">إرسال كافة فواتير الدفعة (${num(count)} فاتورة) بالقالب المختار إلى أمر طباعة موحد نظيف.</p>
              </div>
              <button class="btn btn-primary" id="btn-modal-print-batch" type="button" style="width:100%;justify-content:center;">
                ${raw(icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' }))} طباعة كافة الفواتير
              </button>
            </div>

            <div class="card" style="padding:1rem;display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line);background:var(--card);">
              <div>
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
                  <span style="color:var(--primary, #0d9488);">${raw(icon.pdf({ size: 20 }))}</span>
                  <b style="font-size:.95rem;">تحميل ملف PDF مجمّع</b>
                </div>
                <p class="tiny muted" style="margin:0 0 1rem 0;line-height:1.4;">توليد وتنزيل ملف PDF واحد متكامل يضم جميع الفواتير مرتبة بالقالب المختار.</p>
              </div>
              <a class="btn btn-outline" id="btn-modal-dl-pdf" href="/api/bulk/batches/${esc(batchId)}/pdf?style=${esc(activeStyle)}" target="_blank" download="batch_${esc(batchId.slice(0, 8))}.pdf" style="width:100%;justify-content:center;">
                ${raw(icon.pdf({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' }))} تنزيل PDF مجمّع
              </a>
            </div>

            <div class="card" style="padding:1rem;display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line);background:var(--card);">
              <div>
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
                  <span style="color:var(--primary, #0d9488);">${raw(icon.receipt({ size: 20 }))}</span>
                  <b style="font-size:.95rem;">سندات القبض</b>
                </div>
                <p class="tiny muted" id="modal-voucher-desc" style="margin:0 0 1rem 0;line-height:1.4;">
                  ${raw(currentVouchersCount > 0 ? `طباعة ${num(currentVouchersCount)} سند قبض تم تخصيصها للفواتير.` : 'لم يتم إصدار سندات قبض تلقائياً مع الدفعة.')}
                </p>
              </div>
              <div>
                <button class="btn btn-primary" id="btn-modal-generate-vouchers" type="button" style="width:100%;justify-content:center;${currentVouchersCount > 0 ? 'display:none;' : ''}">
                  ${raw(icon.receipt({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' }))} إصدار سندات قبض الآن
                </button>
                <button class="btn btn-outline" id="btn-modal-print-vouchers" type="button" style="width:100%;justify-content:center;${currentVouchersCount > 0 ? '' : 'display:none;'}">
                  ${raw(icon.receipt({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' }))} طباعة السندات (${num(currentVouchersCount)})
                </button>
              </div>
            </div>
          </div>
        </div>
      `,
      footer: html`
        <div class="flex" style="justify-content:space-between;align-items:center;width:100%;">
          <button class="btn btn-primary" id="btn-modal-go-invoices" type="button">
            عرض فواتير الدفعة في جدول الفواتير ←
          </button>
          <button class="btn" data-close type="button">إغلاق</button>
        </div>
      `,
    });

    const tplSelect = $('#modal-batch-tpl-select', m.body);
    if (tplSelect) {
      tplSelect.addEventListener('change', () => {
        activeStyle = tplSelect.value;
        const dlBtn = $('#btn-modal-dl-pdf', m.body);
        if (dlBtn) {
          dlBtn.href = `/api/bulk/batches/${encodeURIComponent(batchId)}/pdf?style=${encodeURIComponent(activeStyle)}`;
        }
      });
    }

    const printBatchBtn = $('#btn-modal-print-batch', m.body);
    if (printBatchBtn) {
      printBatchBtn.addEventListener('click', async () => {
        printBatchBtn.disabled = true;
        printBatchBtn.textContent = 'جارٍ تجهيز الطباعة…';
        try {
          const res = await fetch(`/api/bulk/batches/${encodeURIComponent(batchId)}/render-html?style=${encodeURIComponent(activeStyle)}`);
          if (!res.ok) throw new Error('تعذر جلب فواتير الدفعة');
          const docHtml = await res.text();
          printDoc(docHtml);
        } catch (err) {
          toastErr(err.message || 'فشلت عملية الطباعة');
        } finally {
          printBatchBtn.disabled = false;
          printBatchBtn.innerHTML = `${icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })} طباعة كافة الفواتير`;
        }
      });
    }

    const genVouchersBtn = $('#btn-modal-generate-vouchers', m.body);
    const printVouchersBtn = $('#btn-modal-print-vouchers', m.body);
    const batchPdfBtn = $('#btn-modal-dl-pdf', m.body);
    batchPdfBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await downloadPdfFromUrl(batchPdfBtn.href, `دفعة_${batchId.slice(0, 8)}.pdf`); }
      catch (err) { if (err?.name !== 'AbortError') toastErr(err.message || 'تعذر حفظ ملف الدفعة'); }
    });

    if (genVouchersBtn) {
      genVouchersBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'إصدار سندات قبض للدفعة بالكامل',
          message: `هل ترغب في إنشاء سندات قبض لكافة فواتير الدفعة (${count} فاتورة) وتغيير حالتها إلى مدفوعة آلياً؟`,
          okText: 'إصدار السندات الآن',
        });
        if (!ok) return;
        genVouchersBtn.disabled = true;
        genVouchersBtn.textContent = 'جارٍ إصدار السندات…';
        try {
          const vRes = await api.post(`/api/bulk/batches/${encodeURIComponent(batchId)}/generate-vouchers`, { payment_type: 'TRANSFER' });
          currentVouchersCount = vRes.vouchers_count || count;
          toastOk(`تم إصدار ${num(currentVouchersCount)} سند قبض بنجاح`);
          genVouchersBtn.style.display = 'none';
          if (printVouchersBtn) {
            printVouchersBtn.style.display = 'inline-flex';
            printVouchersBtn.disabled = false;
            printVouchersBtn.innerHTML = `${icon.receipt({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })} طباعة السندات (${num(currentVouchersCount)})`;
          }
          const desc = $('#modal-voucher-desc', m.body);
          if (desc) desc.textContent = `تم إصدار وتخصيص ${num(currentVouchersCount)} سند قبض للفواتير بنجاح.`;
          const vLbl = $('#modal-batch-vouchers-label', m.body);
          if (vLbl) vLbl.innerHTML = ` — تم إصدار <b style="color:var(--primary, #0d9488)">${num(currentVouchersCount)}</b> سند قبض آلياً.`;
        } catch (err) {
          toastErr(err.message || 'فشل إصدار السندات');
          genVouchersBtn.disabled = false;
          genVouchersBtn.textContent = 'إصدار سندات قبض الآن';
        }
      });
    }

    if (printVouchersBtn) {
      printVouchersBtn.addEventListener('click', async () => {
        if (!currentVouchersCount) return;
        printVouchersBtn.disabled = true;
        printVouchersBtn.textContent = 'جارٍ تجهيز السندات…';
        try {
          const vouchers = await api.get(`/api/bulk/batches/${encodeURIComponent(batchId)}/vouchers`);
          if (!vouchers || !vouchers.length) {
            toastErr('لم يتم العثور على سندات قبض لهذه الدفعة');
            return;
          }
          const docs = [];
          for (const v of vouchers) {
            const issuer = store.issuers.find((i) => i.id === v.issuer_id) || store.activeIssuer || {};
            const client = store.clients.find((c) => c.id === v.client_id) || { id: v.client_id, name_ar: v.client_name };
            docs.push(await renderStoredVoucher(v, issuer, client));
          }
          const combined = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>سندات القبض</title>
          <style>
            @media print {
              body { margin: 0; padding: 0; background: #fff !important; }
              .page-break { page-break-after: always; break-after: page; }
              .page-break:last-child { page-break-after: auto; break-after: auto; }
            }
          </style></head><body>
          ${docs.map((d) => `<div class="page-break">${d}</div>`).join('')}
          </body></html>`;
          printDoc(combined);
        } catch (err) {
          toastErr(err.message || 'فشلت طباعة سندات القبض');
        } finally {
          printVouchersBtn.disabled = false;
          printVouchersBtn.innerHTML = `${icon.receipt({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })} طباعة السندات (${num(currentVouchersCount)})`;
        }
      });
    }

    $('#btn-modal-go-invoices', m.footer)?.addEventListener('click', () => {
      m.close();
      router.go(`invoices?batch_id=${batchId}`);
    });
  }

  draw();
  return undefined;
}

