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
  modal, printDoc, icon,
} from '../core/util.js';
import { invoiceA4, invoiceThermal, bulkPreviewReport } from '../print/templates.js';

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
    quantity: qty,
    unit_price: price,
    discount: disc,
    taxable_amount: taxable,
    tax_amount: tax,
    grand_total: total,
  };
}

function recalcInvoice(inv) {
  const lines = (inv.lines || []).map(calcLine);
  const taxable = Math.round(lines.reduce((s, l) => s + (l.taxable_amount || 0), 0) * 100) / 100;
  const discount = Math.round(lines.reduce((s, l) => s + (l.discount || 0), 0) * 100) / 100;
  const subtotal = Math.round((taxable + discount) * 100) / 100;
  const tax = Math.round(lines.reduce((s, l) => s + (l.tax_amount || 0), 0) * 100) / 100;
  const grand = Math.round((taxable + tax) * 100) / 100;
  return {
    ...inv,
    lines,
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

  const state = {
    issuer_id: store.activeIssuerId || activeIssuers[0].id,
    client_id: store.clients[0].id,
    date_from: firstOfYear(),
    date_to: today(),
    count: 25,
    target_total: 680000,
    use_target: true,
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

  const cur = currencyLabel();

  const loadDraftsList = async () => {
    try {
      state.drafts = await api.get(`/api/bulk/drafts?issuer_id=${state.issuer_id || ''}`);
    } catch {
      state.drafts = [];
    }
  };
  await loadDraftsList();

  const payload = () => ({
    issuer_id: state.issuer_id,
    client_id: state.client_id,
    date_from: state.date_from,
    date_to: state.date_to,
    count: toNum(state.count, 0),
    target_total: state.use_target ? toNum(state.target_total, 0) : 0,
    category_ids: state.category_ids,
    item_ids: state.item_ids,
    custom_items: state.custom_items.map((it) => ({
      id: it.id || undefined,
      name_ar: it.name_ar,
      item_code: it.item_code || '',
      unit: it.unit || 'حبة',
      sale_price: toNum(it.sale_price, 0),
      tax_rate: it.tax_rate !== undefined ? toNum(it.tax_rate, 15) : 15,
    })),
    distribution_mode: state.distribution_mode,
    min_items: toNum(state.min_items, 1),
    max_items: toNum(state.max_items, 6),
    min_qty: toNum(state.min_qty, 1),
    max_qty: toNum(state.max_qty, 20),
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
    issue_vouchers: state.issue_vouchers,
    seed: state.seed === '' ? 0 : toNum(state.seed, 0),
    notes: state.notes,
  });

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
          <p class="muted tiny" style="margin:.4rem 0">لم يتم تحديد قائمة أصناف مخصصة بعد. سيتم استخدام أصناف الكتالوج العام تلقائياً، أو يمكنك اختيار أصناف وإضافة أسعارها المخصصة للدفعة من الأدوات أعلاه.</p>
        </div>
      `;
    }

    return `
      <div class="table-wrap mt">
        <table class="tbl compact" style="background:var(--card)">
          <thead>
            <tr>
              <th style="width:35px">#</th>
              <th>الصنف</th>
              <th style="width:100px">الكود</th>
              <th style="width:80px">الوحدة</th>
              <th style="width:170px" class="text-end">سعر الوحدة المحدد للدفعة (${esc(cur)})</th>
              <th style="width:80px" class="text-center">الضريبة</th>
              <th style="width:50px"></th>
            </tr>
          </thead>
          <tbody>
            ${state.custom_items.map((it, idx) => `
              <tr>
                <td class="tiny">${idx + 1}</td>
                <td><b>${esc(it.name_ar)}</b></td>
                <td class="tiny mono muted">${esc(it.item_code || '—')}</td>
                <td class="tiny">${esc(it.unit || 'حبة')}</td>
                <td class="text-end">
                  <input type="number" step="any" min="0.01" class="custom-item-price" data-idx="${idx}" value="${it.sale_price}" style="width:130px;text-align:right;padding:.25rem .5rem;font-size:.85rem;font-weight:bold" />
                </td>
                <td class="tiny text-center">${num(it.tax_rate !== undefined ? it.tax_rate : 15)}%</td>
                <td class="text-center">
                  <button class="btn btn-sm btn-danger pad0" style="width:26px;height:26px;line-height:1" data-remove-custom-item="${idx}" type="button" title="حذف الصنف من الدفعة">✕</button>
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
        <div class="grid grid-3 mt">
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
          <button class="btn btn-sm" id="btn-sample-print" type="button" style="background:#475569;color:#fff">${raw(icon.eye({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}إصدار عينة تجريبية</button>
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

          <div class="invoices-list" style="display:flex;flex-direction:column;gap:.75rem;max-height:800px;overflow-y:auto;padding-right:.3rem">
            ${p.invoices.map((inv, idx) => `
              <div class="card pad" style="border:1px solid var(--line);background:var(--card)" data-inv-card="${idx}">
                <div class="row align-center">
                  <span class="badge blue" style="font-size:.85rem;font-weight:bold">فاتورة #${idx + 1}</span>
                  <span class="badge green num" style="font-size:.85rem;font-weight:bold">${money(inv.grand_total)} ${esc(cur)}</span>
                  <span class="tiny muted">${esc(inv.lines.length)} أصناف</span>
                  <div class="spacer"></div>
                  <button class="btn btn-sm ${state.activeEditIndex === idx ? 'btn-primary' : ''}" data-toggle-edit="${idx}" type="button">
                    ${raw(icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}${state.activeEditIndex === idx ? 'إغلاق التعديل' : 'تعديل البنود'}
                  </button>
                  <button class="btn btn-sm btn-danger" data-remove-inv="${idx}" type="button" title="حذف الفاتورة من الدفعة">${raw(icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}حذف</button>
                </div>

                <div class="row mt-sm" style="gap:.6rem;align-items:flex-end">
                  <div class="field" style="max-width:140px;margin:0"><label class="tiny">التاريخ</label>
                    <input type="date" class="inv-field" data-idx="${idx}" data-field="issue_date" value="${inv.issue_date}" /></div>
                  <div class="field" style="max-width:110px;margin:0"><label class="tiny">الوقت</label>
                    <input type="time" step="1" class="inv-field" data-idx="${idx}" data-field="issue_time" value="${inv.issue_time || '10:00:00'}" /></div>
                  <div class="field" style="max-width:120px;margin:0"><label class="tiny">طريقة الدفع</label>
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
                      <select id="quick-add-item-${idx}" style="max-width:250px;font-size:.8rem">
                        <option value="">-- اختر صنفاً للإضافة السريعة --</option>
                        ${raw(store.items.map((it) => `<option value="${esc(it.id)}">${esc(it.name_ar)} — ${money(it.sale_price)}</option>`).join(''))}
                      </select>
                      <button class="btn btn-sm btn-primary" data-add-item="${idx}" type="button">+ إضافة صنف</button>
                    </div>

                    <div class="table-wrap">
                      <table class="tbl compact" style="background:transparent">
                        <thead><tr>
                          <th style="width:30px">#</th><th>الصنف</th><th style="width:70px">الوحدة</th>
                          <th style="width:80px" class="text-end">الكمية</th><th style="width:100px" class="text-end">السعر</th>
                          <th style="width:80px" class="text-end">الخصم</th><th style="width:60px" class="text-center">الضريبة</th>
                          <th style="width:100px" class="text-end">الإجمالي</th><th style="width:40px"></th>
                        </tr></thead>
                        <tbody>
                          ${inv.lines.map((l, lIdx) => `
                            <tr>
                              <td class="tiny">${lIdx + 1}</td>
                              <td><b>${esc(l.item_name)}</b>${l.item_code ? `<div class="tiny muted mono">${esc(l.item_code)}</div>` : ''}</td>
                              <td class="tiny">${esc(l.unit || 'حبة')}</td>
                              <td><input type="number" step="any" min="0.01" style="padding:.2rem;font-size:.8rem;text-align:right" class="line-input" data-inv="${idx}" data-line="${lIdx}" data-lfield="quantity" value="${l.quantity}" /></td>
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
          <button class="btn btn-primary" id="preview" type="button" style="font-weight:bold">${raw(icon.sparkles({ size: 16, style: 'vertical-align:text-bottom;margin-left:5px' }))}توليد معاينة جديدة</button>
        </div>
      </div>

      <div id="drafts-area">${raw(draftsSectionHtml())}</div>

      <div class="card mt">
        <div class="card-head" style="padding:0 0 .7rem"><h3>1. الأساسيات</h3></div>
        <div class="row mt">
          <div class="field"><label class="req">الشركة المصدرة</label>
            <select id="issuer_id">${raw(activeIssuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}</select></div>
          <div class="field"><label class="req">العميل</label>
            <select id="client_id">${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}</select></div>
          <div class="field" style="max-width:160px"><label class="req">من تاريخ</label><input type="date" id="date_from" value="${state.date_from}" /></div>
          <div class="field" style="max-width:160px"><label class="req">إلى تاريخ</label><input type="date" id="date_to" value="${state.date_to}" /></div>
        </div>
        <div class="row mt">
          <div class="field" style="max-width:180px"><label>عدد الفواتير</label>
            <input type="number" id="count" value="${state.count}" min="0" max="5000" />
            <span class="hint">اتركه 0 ليُحدَّد آلياً من الميزانية</span></div>
          <div class="field" style="max-width:230px"><label>الميزانية الإجمالية (${esc(cur)})</label>
            <input type="number" id="target_total" value="${state.target_total}" min="0" step="0.01" ${raw(state.use_target ? '' : 'disabled')} />
            <label class="check tiny mt"><input type="checkbox" id="use_target" ${raw(state.use_target ? 'checked' : '')} /> مطابقة مبلغ إجمالي محدد بدقة</label></div>
          <div class="field" style="max-width:170px"><label>نوع الفواتير</label>
            <select id="invoice_type">
              <option value="STANDARD" ${raw(state.invoice_type === 'STANDARD' ? 'selected' : '')}>ضريبية</option>
              <option value="SIMPLIFIED" ${raw(state.invoice_type === 'SIMPLIFIED' ? 'selected' : '')}>مبسطة</option>
            </select></div>
          <div class="field"><label>ملاحظة عامة على كل فواتير الدفعة</label>
            <input type="text" id="notes" value="${esc(state.notes)}" /></div>
        </div>
        <div class="row mt" style="background:rgba(255,255,255,0.03);padding:.6rem 1rem;border-radius:var(--radius-sm);border:1px solid var(--line);align-items:center">
          <label class="check"><input type="checkbox" id="issue_vouchers" ${raw(state.issue_vouchers ? 'checked' : '')} /> <b>إصدار سندات قبض تلقائياً مع الفواتير</b> (ترحيل وتخصيص آلي)</label>
          <div style="width:1.5rem"></div>
          <label class="check"><input type="checkbox" id="auto_save_draft" ${raw(state.auto_save_draft ? 'checked' : '')} /> حفظ المعاينة كمسودة تلقائياً بعد التوليد</label>
        </div>
      </div>

      <div class="card">
        <div class="card-head" style="padding:0 0 .7rem">
          <div>
            <h3 style="margin:0">2. الأصناف وتحديد الأسعار وتوزيع المنتجات على الفواتير</h3>
            <p class="tiny muted" style="margin:.2rem 0 0">حدد الأصناف وأسعارها المعتمدة للدفعة وطريقة توزيعها، أو اتركها لاستخدام الكتالوج العام تلقائياً.</p>
          </div>
          <div class="spacer"></div>
          <span class="badge ${state.custom_items.length ? 'blue' : 'gray'}" id="custom-items-count-badge">
            ${state.custom_items.length ? `${state.custom_items.length} صنف محدد بأسعار خاصة` : `الكتالوج العام (${store.items.length} صنف)`}
          </span>
        </div>

        <!-- شريط إضافة وتحديد أسعار الأصناف للدفعة -->
        <div class="row align-center mt-sm" style="gap:.6rem;flex-wrap:wrap;background:rgba(255,255,255,0.03);padding:.8rem;border-radius:var(--radius-sm);border:1px solid var(--line)">
          <div class="field" style="flex:2;min-width:240px;margin:0">
            <label class="tiny">اختر صنفاً من الدليل لإضافته وتحديد سعره للدفعة</label>
            <select id="quick-catalog-item-select">
              <option value="">-- اختر صنفاً من الدليل --</option>
              ${raw(store.items.map((it) => `<option value="${esc(it.id)}" data-price="${it.sale_price}" data-unit="${esc(it.unit || 'حبة')}">${esc(it.name_ar)} (سعر الدليل: ${money(it.sale_price)} ${esc(cur)})</option>`).join(''))}
            </select>
          </div>
          <div class="field" style="max-width:140px;margin:0">
            <label class="tiny">السعر المحدد (${esc(cur)})</label>
            <input type="number" step="any" min="0" id="quick-catalog-item-price" placeholder="سعر الوحدة" />
          </div>
          <div style="align-self:flex-end">
            <button class="btn btn-primary" id="btn-add-item-to-batch" type="button" style="font-weight:600;font-size:.85rem;height:38px">
              ${raw(icon.plus({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}+ إضافة صنف
            </button>
          </div>
          <div style="align-self:flex-end">
            <button class="btn" id="btn-add-custom-adhoc" type="button" style="font-size:.85rem;height:38px">
              ${raw(icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}+ صنف مخصص جديد
            </button>
          </div>
          <div style="align-self:flex-end">
            <button class="btn" id="btn-import-all-catalog" type="button" style="font-size:.85rem;height:38px">
              ${raw(icon.package({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}إدراج كل الأصناف (${store.items.length})
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
        <div class="row mt align-center" style="background:rgba(255,255,255,0.02);padding:.7rem 1rem;border-radius:var(--radius-sm);border:1px solid var(--line);gap:1.5rem;flex-wrap:wrap">
          <div>
            <b>طريقة توزيع المنتجات على الفواتير:</b>
          </div>
          <label class="check" style="margin:0;cursor:pointer">
            <input type="radio" name="distribution_mode" value="BALANCED" ${state.distribution_mode === 'BALANCED' ? 'checked' : ''} />
            <b>توزيع متوازن</b> (ضمان توزيع كافة الأصناف المختارة بالتساوي على الفواتير)
          </label>
          <label class="check" style="margin:0;cursor:pointer">
            <input type="radio" name="distribution_mode" value="RANDOM" ${state.distribution_mode === 'RANDOM' ? 'checked' : ''} />
            <b>توزيع عشوائي</b> (اختيار عشوائي حر)
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-head" style="padding:0 0 .7rem"><h3>3. ضوابط التنوع والواقعية</h3></div>
        <div class="row mt">
          <div class="field" style="max-width:150px"><label>أقل عدد أصناف</label><input type="number" id="min_items" value="${state.min_items}" min="1" max="100" /></div>
          <div class="field" style="max-width:150px"><label>أكثر عدد أصناف</label><input type="number" id="max_items" value="${state.max_items}" min="1" max="100" /></div>
          <div class="field" style="max-width:150px"><label>أقل كمية</label><input type="number" id="min_qty" value="${state.min_qty}" min="0.01" step="0.01" /></div>
          <div class="field" style="max-width:150px"><label>أكثر كمية</label><input type="number" id="max_qty" value="${state.max_qty}" min="0.01" step="0.01" /></div>
          <div class="field" style="max-width:200px"><label>تفاوت السعر ±%</label>
            <input type="number" id="price_jitter_percent" value="${state.price_jitter_percent}" min="0" max="50" step="0.5" />
            <span class="hint">لتفادي تكرار نفس السعر في كل فاتورة</span></div>
        </div>
        <div class="row mt">
          <div class="field" style="max-width:190px"><label>أقل قيمة للفاتورة</label><input type="number" id="min_invoice_total" value="${state.min_invoice_total}" min="0" step="0.01" placeholder="بدون حد" /></div>
          <div class="field" style="max-width:190px"><label>أعلى قيمة للفاتورة</label><input type="number" id="max_invoice_total" value="${state.max_invoice_total}" min="0" step="0.01" placeholder="بدون حد" /></div>
          <div class="field" style="max-width:150px"><label>بداية العمل</label><input type="time" id="work_start" value="${state.work_start}" /></div>
          <div class="field" style="max-width:150px"><label>نهاية العمل</label><input type="time" id="work_end" value="${state.work_end}" /></div>
          <div class="field" style="max-width:210px"><label>مفتاح التوليد (Seed)</label>
            <input type="number" id="seed" value="${state.seed}" min="0" placeholder="عشوائي" />
            <span class="hint">نفس المفتاح يعطي نفس الدفعة بالضبط</span></div>
        </div>
        <div class="row mt">
          <div class="field">
            <label>الخصومات</label>
            <label class="check"><input type="checkbox" id="discount_enabled" ${raw(state.discount_enabled ? 'checked' : '')} /> تطبيق خصومات عشوائية على بعض البنود</label>
            <div class="row mt" ${raw(state.discount_enabled ? '' : 'style="opacity:.5"')}>
              <div class="field" style="max-width:120px"><label class="tiny">من %</label><input type="number" id="discount_min_percent" value="${state.discount_min_percent}" min="0" max="90" step="0.5" /></div>
              <div class="field" style="max-width:120px"><label class="tiny">إلى %</label><input type="number" id="discount_max_percent" value="${state.discount_max_percent}" min="0" max="90" step="0.5" /></div>
              <div class="field" style="max-width:150px"><label class="tiny">احتمال الخصم (0-1)</label><input type="number" id="discount_probability" value="${state.discount_probability}" min="0" max="1" step="0.05" /></div>
            </div>
          </div>
          <div class="field">
            <label>خيارات أخرى</label>
            <label class="check"><input type="checkbox" id="allow_fraction_qty" ${raw(state.allow_fraction_qty ? 'checked' : '')} /> السماح بكميات كسرية (0.5 / 2.25)</label>
            <label class="check"><input type="checkbox" id="skip_weekend" ${raw(state.skip_weekend ? 'checked' : '')} /> تجاوز الجمعة والسبت</label>
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
    if (el) el.addEventListener('input', (e) => { state[id] = e.target.value; });
  });

  function bind() {
    ['issuer_id', 'client_id', 'date_from', 'date_to', 'invoice_type', 'work_start', 'work_end'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) {
        el.addEventListener('change', async (e) => {
          state[id] = e.target.value;
          if (id === 'issuer_id') {
            await loadDraftsList();
            const area = $('#drafts-area', view);
            if (area) area.innerHTML = draftsSectionHtml();
          }
        });
      }
    });

    bindNumeric(['count', 'target_total', 'min_items', 'max_items', 'min_qty', 'max_qty',
      'min_invoice_total', 'max_invoice_total', 'price_jitter_percent', 'discount_min_percent',
      'discount_max_percent', 'discount_probability', 'seed', 'notes']);

    const useTargetEl = $('#use_target', view);
    if (useTargetEl) {
      useTargetEl.addEventListener('change', (e) => {
        state.use_target = e.target.checked;
        const targetInput = $('#target_total', view);
        if (targetInput) targetInput.disabled = !e.target.checked;
      });
    }

    const discCheck = $('#discount_enabled', view);
    if (discCheck) discCheck.addEventListener('change', (e) => { state.discount_enabled = e.target.checked; });
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

    // تغيير اختيار الصنف السريع لملء سعره التلقائي
    delegate(view, 'change', '#quick-catalog-item-select', (e, sel) => {
      const opt = sel.selectedOptions[0];
      const priceInput = $('#quick-catalog-item-price', view);
      if (opt && opt.dataset.price && priceInput) {
        priceInput.value = opt.dataset.price;
      }
    });

    // إضافة صنف من الدليل
    delegate(view, 'click', '#btn-add-item-to-batch', () => {
      const select = $('#quick-catalog-item-select', view);
      if (!select || !select.value) {
        toastErr('اختر صنفاً من القائمة أولاً');
        return;
      }
      const it = store.items.find((x) => x.id === select.value);
      if (!it) return;
      const priceInput = $('#quick-catalog-item-price', view);
      const customPrice = priceInput && priceInput.value !== '' ? Number(priceInput.value) : it.sale_price;

      const existingIdx = state.custom_items.findIndex((x) => x.id === it.id);
      if (existingIdx >= 0) {
        state.custom_items[existingIdx].sale_price = customPrice;
        toastOk(`تم تحديث سعر الصنف: ${it.name_ar}`);
      } else {
        state.custom_items.push({
          id: it.id,
          item_code: it.item_code,
          name_ar: it.name_ar,
          unit: it.unit || 'حبة',
          sale_price: customPrice,
          tax_rate: it.tax_rate !== undefined ? it.tax_rate : 15,
        });
        toastOk(`تمت إضافة الصنف: ${it.name_ar} بسعر ${money(customPrice)} ${cur}`);
      }
      refreshCustomItemsArea();
    });

    // إضافة صنف مخصص بالكامل (غير موجود بالدليل)
    delegate(view, 'click', '#btn-add-custom-adhoc', async () => {
      const name = await promptDialog({ title: 'إضافة صنف مخصص للدفعة', label: 'اسم الصنف أو الخدمة', value: '' });
      if (!name) return;
      const priceStr = await promptDialog({ title: 'سعر الصنف', label: `سعر الوحدة (${cur})`, value: '100' });
      const price = Number(priceStr) || 100;
      state.custom_items.push({
        id: null,
        item_code: '',
        name_ar: name,
        unit: 'حبة',
        sale_price: price,
        tax_rate: 15,
      });
      refreshCustomItemsArea();
      toastOk(`تمت إضافة الصنف المخصص: ${name}`);
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

    // تعديل السعر في جدول الأصناف المخصصة
    delegate(view, 'change', '.custom-item-price', (e, input) => {
      const idx = Number(input.dataset.idx);
      if (state.custom_items[idx]) {
        state.custom_items[idx].sale_price = Number(input.value) || 0;
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
      if (radio.checked) state.distribution_mode = radio.value;
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

    bindPreviewArea();
  }

  function bindPreviewArea() {
    const regen = $('#regen', view);
    if (regen) {
      regen.addEventListener('click', () => {
        state.seed = String(Math.floor(Math.random() * 2000000000));
        const seedInput = $('#seed', view);
        if (seedInput) seedInput.value = state.seed;
        runPreview();
      });
    }

    const commitBtn = $('#commit', view);
    if (commitBtn) commitBtn.addEventListener('click', commit);

    const saveDraftBtn = $('#btn-save-draft', view);
    if (saveDraftBtn) {
      saveDraftBtn.addEventListener('click', async () => {
        if (!state.preview || !state.preview.invoices.length) return;
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
      });
    }

    // طباعة عينة تجريبية (Sample Test Print)
    const samplePrintBtn = $('#btn-sample-print', view);
    if (samplePrintBtn) {
      samplePrintBtn.addEventListener('click', async () => {
        if (!state.preview || !state.preview.invoices.length) return;
        const sampleInv = state.preview.invoices[0];
        const issuer = store.issuers.find((i) => i.id === state.issuer_id) || { name_ar: 'الشركة المصدرة', currency: 'SAR' };
        const client = store.clients.find((c) => c.id === state.client_id) || { name: 'العميل التجريبي' };

        const fullSample = {
          ...sampleInv,
          invoice_number: `${issuer.invoice_prefix || 'INV'}-SAMPLE-01`,
          seller_name: issuer.name_ar,
          seller_tax_number: issuer.tax_number,
          buyer_name: client.name,
          buyer_tax_number: client.tax_number,
          qr_payload: 'AQVTYW1wbGUSCjMxMDAwMDAwMDMTAzEwMBQEMjMwMA==',
        };

        const kind = await new Promise((resolve) => {
          modal({
            title: 'إصدار وطباعة فاتورة تجريبية (عينة)',
            slim: true,
            body: html`<p>اختر قالب الطباعة لمعاينة الفاتورة الأولى كعينة قبل اعتماد كامل الدفعة:</p>
              <div class="row mt" style="justify-content:center;gap:1rem">
                <button class="btn btn-primary" id="btn-sample-a4" type="button">مقاس A4</button>
                <button class="btn" id="btn-sample-th" type="button">إيصال حراري (80mm)</button>
              </div>`,
            footer: '<button class="btn" data-close type="button">إلغاء</button>',
            onClose: () => resolve(null),
          });
          const a4Btn = $('#btn-sample-a4');
          if (a4Btn) a4Btn.addEventListener('click', () => { a4Btn.closest('.modal-backdrop').remove(); resolve('a4'); });
          const thBtn = $('#btn-sample-th');
          if (thBtn) thBtn.addEventListener('click', () => { thBtn.closest('.modal-backdrop').remove(); resolve('thermal'); });
        });

        if (kind === 'a4') {
          printDoc(invoiceA4({ invoice: fullSample, issuer, client }));
        } else if (kind === 'thermal') {
          printDoc(invoiceThermal({ invoice: fullSample, issuer, client }));
        }
      });
    }

    // طباعة تقرير المعاينة الشامل (PDF Print Preview)
    const printPrevBtn = $('#btn-print-preview', view);
    if (printPrevBtn) {
      printPrevBtn.addEventListener('click', () => {
        if (!state.preview || !state.preview.invoices.length) return;
        const issuer = store.issuers.find((i) => i.id === state.issuer_id) || { name_ar: 'الشركة المصدرة', currency: 'SAR' };
        const client = store.clients.find((c) => c.id === state.client_id) || { name: 'العميل' };
        printDoc(bulkPreviewReport({
          issuer,
          client,
          invoices: state.preview.invoices,
          summary: state.preview.summary,
          options: state.preview.options,
          title: state.preview.title || `معاينة دفعة فواتير — ${issuer.name_ar}`,
        }));
      });
    }

    // تصدير CSV / Excel
    const csv = $('#pv-csv', view);
    if (csv) {
      const headers = ['#', 'التاريخ', 'الوقت', 'عدد الأصناف', 'طريقة الدفع', 'قبل الضريبة', 'الخصم', 'الضريبة', 'الإجمالي'];
      const rows = () => state.preview.invoices.map((inv, i) => [i + 1, inv.issue_date, inv.issue_time,
        inv.lines.length, PAY_LABELS[inv.payment_method] || inv.payment_method,
        inv.taxable_amount, inv.discount_amount, inv.tax_amount, inv.grand_total]);
      csv.addEventListener('click', () => exportCsv('معاينة-الدفعة', headers, rows()));
      $('#pv-xls', view).addEventListener('click', () => exportExcel('معاينة-الدفعة', 'معاينة دفعة الفواتير', headers, rows()));
    }

    // تفاعل تعديل الفواتير والبنود
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

    // إضافة فاتورة يدوية مباشرة إلى قائمة المعاينة
    delegate(view, 'click', '#btn-add-manual-inv', () => {
      if (!state.preview) return;
      const defaultItem = state.custom_items[0] || store.items[0] || { id: null, name_ar: 'صنف عام', sale_price: 100, unit: 'حبة', tax_rate: 15 };
      const newInv = {
        temp_id: `tmp-${state.preview.invoices.length + 1}`,
        issue_date: state.preview.invoices.length ? state.preview.invoices[state.preview.invoices.length - 1].issue_date : state.date_to,
        issue_time: '12:00:00',
        invoice_type: state.invoice_type,
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
      state.preview.invoices[invIdx].lines[lineIdx][lfield] = Number(input.value) || 0;
      recalcPreviewSummary();
      // تحديث المجاميع المعروضة
      const area = $('#preview-area', view);
      if (area) area.innerHTML = previewHtml();
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
      bindPreviewArea();
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
      const res = await api.post('/api/bulk/commit', {
        draft_id: state.current_draft_id || undefined,
        issuer_id: state.issuer_id,
        client_id: state.client_id,
        invoices: state.preview.invoices,
        options: state.preview.options,
        issue_vouchers: state.issue_vouchers,
      });
      const vText = res.vouchers_count ? ` و ${res.vouchers_count} سند قبض` : '';
      toastOk(`تم حفظ ${res.count} فاتورة${vText} بإجمالي ${money(res.total_amount)} ${cur}`);
      router.go(`invoices?batch_id=${res.batch_id}`);
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'اعتماد وحفظ';
      }
      toastErr(err.message || 'فشل الاعتماد');
    }
  }

  draw();
  return undefined;
}
