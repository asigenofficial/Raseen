// ==========================================================================
//  قائمة الفواتير: بحث وتصفية شاملة، إجماليات، طباعة، تصدير.
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, can, getFilterState, setFilterState, clearFilterState } from '../core/store.js';
import {
  html, raw, esc, money, num, dateAr, statusBadge, monthStart, today, toastOk,
  $, delegate, debounce, exportCsv, exportExcel, parseSpreadsheetText, printDoc, modal, toastErr, formValues,
  icon, downloadPdfFromHtml, amount, sarSvg,
} from '../core/util.js';
import { invoiceA4 } from '../print/templates.js';
import { downloadInvoicePdf, shareInvoicePdfFile } from './invoice-view.js';

const PAGE = 50;

export async function render(view, ctx) {
  await loadClients();
  const q0 = (ctx && ctx.query) || {};
  const defaults = {
    issuer_id: store.activeIssuerId,
    client_id: '',
    status: '',
    invoice_type: '',
    has_remaining: false,
    from: '',
    to: '',
    q: '',
    batch_id: '',
    min_total: '',
    max_total: '',
    payment_method: '',
    offset: 0,
  };
  const cached = getFilterState('invoices', defaults);
  const state = {
    ...cached,
    ...q0,
    has_remaining: q0.has_remaining !== undefined ? Boolean(q0.has_remaining === 'true' || q0.has_remaining === '1') : Boolean(cached.has_remaining),
    offset: q0.offset !== undefined ? Number(q0.offset) : (cached.offset || 0),
    data: { items: [], totals: {}, total_count: 0 },
  };
  if (q0.issuer_id !== undefined) state.issuer_id = q0.issuer_id;

  const saveState = () => {
    setFilterState('invoices', {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      status: state.status,
      invoice_type: state.invoice_type,
      has_remaining: state.has_remaining,
      from: state.from,
      to: state.to,
      q: state.q,
      batch_id: state.batch_id,
      min_total: state.min_total,
      max_total: state.max_total,
      payment_method: state.payment_method,
      offset: state.offset,
    });
  };

  const load = async () => {
    saveState();
    state.data = await api.get(qs('/api/invoices', {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      status: state.status,
      invoice_type: state.invoice_type,
      has_remaining: state.has_remaining ? '1' : '',
      from: state.from,
      to: state.to,
      q: state.q,
      batch_id: state.batch_id,
      min_total: state.min_total,
      max_total: state.max_total,
      payment_method: state.payment_method,
      limit: PAGE,
      offset: state.offset,
    }));
  };

  const reload = async () => {
    await load();
    draw();
  };

  const printOne = async (id, kind) => {
    const invoice = await api.get(`/api/invoices/${id}`);
    const [issuer, client] = await Promise.all([
      api.get(`/api/issuers/${invoice.issuer_id}`),
      api.get(`/api/clients/${invoice.client_id}`),
    ]);
    printDoc(kind === 'thermal' ? invoiceThermal({ invoice, issuer, client }) : invoiceA4({ invoice, issuer, client }));
  };

  const rowsHtml = () => {
    if (!state.data.items.length) {
      return '<tr><td colspan="10" class="text-center muted" style="padding:2rem">لا توجد فواتير مطابقة للتصفية</td></tr>';
    }
    return state.data.items.map((i) => `<tr>
      <td><a class="mono" href="#/invoice-view/${esc(i.id)}"><b>${esc(i.invoice_number)}</b></a>
        ${i.batch_id ? '<span class="badge blue tiny">دفعة</span>' : ''}
        <span class="badge ${i.zatca_phase === 'PHASE2' ? 'teal' : 'gray'} tiny" title="${i.zatca_phase === 'PHASE2' ? 'باركود المرحلة الثانية' : 'باركود المرحلة الأولى'}">${i.zatca_phase === 'PHASE2' ? 'م2' : 'م1'}</span>
      </td>
      <td class="nowrap tiny">${esc(dateAr(i.issue_date))}<div class="muted mono">${esc(i.issue_time)}</div></td>
      <td>${esc(i.client_name)}<div class="tiny muted mono">${esc(i.client_code)}</div></td>
      <td class="tiny">${esc(i.issuer_name)}</td>
      <td class="tiny">${esc(i.payment_label)}</td>
      <td class="text-end num">${amount(i.taxable_amount)}</td>
      <td class="text-end num">${amount(i.tax_amount)}</td>
      <td class="text-end num"><b>${amount(i.grand_total)}</b></td>
      <td class="text-end num" style="color:${i.remaining_amount > 0 ? 'var(--danger)' : 'var(--success)'}">${amount(i.remaining_amount)}</td>
      <td class="actions">
        ${statusBadge(i.status, i.status_label)}
        <a class="btn btn-sm" href="#/invoice-view/${esc(i.id)}" title="عرض الفاتورة">${icon.eye({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}عرض</a>
        ${i.status !== 'CANCELLED' && can('invoices.edit') ? `<a class="btn btn-sm" href="#/invoice?edit=${esc(i.id)}" title="تعديل الفاتورة يدوياً">${icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}تعديل</a>` : ''}
        <button class="btn btn-sm btn-primary" data-act="download" data-id="${esc(i.id)}" type="button" title="تحميل ملف الفاتورة PDF">
          ${icon.pdf({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}تحميل</button>
        <button class="btn btn-sm" data-act="share" data-id="${esc(i.id)}" type="button" style="background:#10b981;border-color:#10b981;color:#fff;font-weight:600" title="مشاركة الفاتورة">
          ${icon.share({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}مشاركة</button>
        ${i.status !== 'CANCELLED' && i.remaining_amount > 0 && can('vouchers.create')
    ? `<button class="btn btn-sm" data-act="pay" data-id="${esc(i.id)}" type="button" title="سند قبض">${icon.receipt({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}سند</button>` : ''}
      </td>
    </tr>`).join('');
  };

  const draw = () => {
    const t = state.data.totals;
    const pageFrom = state.data.total_count ? state.offset + 1 : 0;
    const pageTo = Math.min(state.offset + PAGE, state.data.total_count);

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>الفواتير</h1>
          <p>إجمالي النتائج: <b class="num">${num(state.data.total_count)}</b> فاتورة</p>
        </div>
        <div class="page-actions">
          ${raw(can('invoices.create') ? `<a class="btn btn-primary" href="#/invoice">${icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}فاتورة جديدة</a>` : '')}
          <button class="btn btn-primary" id="btn-pdf-list" type="button">${raw(icon.pdf({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تحميل قائمة PDF</button>
          <button class="btn" id="print-list" type="button">${raw(icon.printer({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}طباعة القائمة</button>
          ${raw(can('invoices.create') ? `<button class="btn" id="import-excel-btn" type="button">${icon.upload({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}استيراد Excel</button>` : '')}
          <a class="btn" href="/api/invoices/template?purpose=import&format=xlsx" target="_blank" download="invoices_template.xlsx">${raw(icon.download({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}نموذج Excel (.xlsx)</a>
          <button class="btn" id="exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn" id="exp-csv" type="button">${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}CSV</button>
        </div>
      </div>

      <div class="card filter-box">
        <div class="row">
          <div class="field" style="flex:1.4"><label>بحث</label>
            <input type="search" id="q" value="${esc(state.q)}" placeholder="رقم الفاتورة، اسم العميل، كوده…" /></div>
          <div class="field"><label>الشركة المصدرة</label>
            <select id="issuer_id">
              <option value="">كل الشركات</option>
              ${raw(store.issuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
            </select></div>
          <div class="field"><label>العميل</label>
            <select id="client_id">
              <option value="">كل العملاء</option>
              ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}
            </select></div>
          <div class="field" style="max-width:140px"><label>الحالة</label>
            <select id="status">
              <option value="">كل الحالات</option>
              ${raw(Object.entries(store.meta.invoice_statuses).map(([k, v]) => `<option value="${esc(k)}" ${k === state.status ? 'selected' : ''}>${esc(v)}</option>`).join(''))}
            </select></div>
          <div class="field" style="max-width:140px"><label>النوع</label>
            <select id="invoice_type">
              <option value="">كل الأنواع</option>
              <option value="STANDARD" ${state.invoice_type === 'STANDARD' ? 'selected' : ''}>ضريبية (B2B)</option>
              <option value="SIMPLIFIED" ${state.invoice_type === 'SIMPLIFIED' ? 'selected' : ''}>مبسطة (B2C)</option>
            </select></div>
          <div class="field" style="max-width:130px"><label>&nbsp;</label>
            <label class="check" style="white-space:nowrap">
              <input type="checkbox" id="has_remaining" ${state.has_remaining ? 'checked' : ''} /> المتبقي فقط
            </label></div>
        </div>
        <div class="row mt">
          <div class="field" style="max-width:160px"><label>من تاريخ</label><input type="date" id="from" value="${state.from}" /></div>
          <div class="field" style="max-width:160px"><label>إلى تاريخ</label><input type="date" id="to" value="${state.to}" /></div>
          <div class="field" style="max-width:140px"><label>أقل قيمة</label><input type="number" id="min_total" value="${state.min_total}" step="0.01" min="0" /></div>
          <div class="field" style="max-width:140px"><label>أعلى قيمة</label><input type="number" id="max_total" value="${state.max_total}" step="0.01" min="0" /></div>
          <div class="field" style="max-width:150px"><label>طريقة الدفع</label>
            <select id="payment_method">
              <option value="">الكل</option>
              ${raw(Object.entries(store.meta.payment_methods).map(([k, v]) => `<option value="${esc(k)}" ${k === state.payment_method ? 'selected' : ''}>${esc(v)}</option>`).join(''))}
            </select></div>
          <div class="field" style="max-width:240px"><label>&nbsp;</label>
            <div class="flex">
              <button class="btn btn-sm" data-quick="month" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذا الشهر</button>
              <button class="btn btn-sm" data-quick="today" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}اليوم</button>
              <button class="btn btn-sm" data-quick="clear" type="button">إزالة التصفية</button>
            </div></div>
        </div>
        ${raw(state.batch_id ? `<div class="alert alert-info mt tiny">التصفية مقيّدة بدفعة توليد محددة (<span class="mono">${esc(state.batch_id.slice(0, 8))}</span>).
          <a href="#/invoices">إزالة</a></div>` : '')}
      </div>

      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.grand_total, 'SAR', { size: 16 })}</div><div class="stat-lab">إجمالي الفواتير</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.paid, 'SAR', { size: 16 })}</div><div class="stat-lab">المسدد</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.remaining, 'SAR', { size: 16 })}</div><div class="stat-lab">المتبقي</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.tax, 'SAR', { size: 16 })}</div><div class="stat-lab">الضريبة</div></div></div>
      </div>

      <div class="card pad0 mt">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th>الرقم</th><th>التاريخ</th><th>العميل</th><th>الشركة</th><th>الدفع</th>
              <th class="text-end">قبل الضريبة <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end">الضريبة <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end">المتبقي <span class="cur-sym">${sarSvg({ size: 12 })}</span></th><th></th>
            </tr></thead>
            <tbody>${raw(rowsHtml())}</tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn btn-sm" id="prev" ${raw(state.offset === 0 ? 'disabled' : '')} type="button">${raw(icon.arrowRight({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}السابق</button>
          <span class="tiny muted">${pageFrom} — ${pageTo} من ${num(state.data.total_count)}</span>
          <button class="btn btn-sm" id="next" ${raw(pageTo >= state.data.total_count ? 'disabled' : '')} type="button">التالي${raw(icon.arrowLeft({ size: 14, style: 'vertical-align:text-bottom;margin-right:3px' }))}</button>
        </div>
      </div>`;

    const reload = async () => { await load(); draw(); };

    $('#q', view).addEventListener('input', debounce(async (e) => { state.q = e.target.value; state.offset = 0; await reload(); }, 350));
    ['issuer_id', 'client_id', 'status', 'invoice_type', 'from', 'to', 'payment_method'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) el.addEventListener('change', async (e) => { state[id] = e.target.value; state.offset = 0; await reload(); });
    });
    const remEl = $('#has_remaining', view);
    if (remEl) remEl.addEventListener('change', async (e) => { state.has_remaining = e.target.checked; state.offset = 0; await reload(); });
    ['min_total', 'max_total'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) el.addEventListener('change', async (e) => { state[id] = e.target.value; state.offset = 0; await reload(); });
    });
    delegate(view, 'click', '[data-quick]', async (e, btn) => {
      const kind = btn.dataset.quick;
      if (kind === 'month') { state.from = monthStart(); state.to = today(); }
      else if (kind === 'today') { state.from = today(); state.to = today(); }
      else {
        clearFilterState('invoices');
        Object.assign(state, defaults, { issuer_id: store.activeIssuerId, data: state.data });
      }
      state.offset = 0;
      await reload();
    });
    $('#prev', view).addEventListener('click', async () => { state.offset = Math.max(0, state.offset - PAGE); await reload(); });
    $('#next', view).addEventListener('click', async () => { state.offset += PAGE; await reload(); });

    const headers = ['رقم الفاتورة', 'التاريخ', 'الوقت', 'العميل', 'كود العميل', 'الشركة المصدرة', 'طريقة الدفع',
      'قبل الضريبة', 'الضريبة', 'الإجمالي', 'المسدد', 'المتبقي', 'الحالة'];
    const rows = () => state.data.items.map((i) => [i.invoice_number, i.issue_date, i.issue_time, i.client_name,
      i.client_code, i.issuer_name, i.payment_label, i.taxable_amount, i.tax_amount, i.grand_total,
      i.paid_amount, i.remaining_amount, i.status_label]);
    $('#exp-csv', view).addEventListener('click', () => exportCsv('الفواتير', headers, rows()));
    $('#exp-xls', view).addEventListener('click', () => exportExcel('الفواتير', 'قائمة الفواتير', headers, rows(),
      { footer: ['الإجمالي', '', '', '', '', '', '', '', money(t.tax), money(t.grand_total), money(t.paid), money(t.remaining), ''] }));

    const getInvoiceListDocHtml = () => {
      return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير قائمة الفواتير</title>
        <style>
          @page { size: A4 landscape; margin: 10mm; }
          * { box-sizing: border-box; }
          body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; color: #0f172a; background: #fff; }
          .header { border-bottom: 2px solid #0d9488; padding-bottom: 4mm; margin-bottom: 4mm; display: flex; justify-content: space-between; align-items: center; }
          h2 { margin: 0; font-size: 15pt; color: #0f766e; }
          .sub { color: #64748b; font-size: 8.5pt; }
          table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 3mm; }
          th { background: #0d9488; color: #fff; border: 1px solid #0f766e; padding: 2.2mm 1.5mm; font-weight: 700; text-align: right; }
          th.e { text-align: left; }
          td { border: 1px solid #cbd5e1; padding: 1.8mm 1.5mm; }
          tr:nth-child(even) td { background: #f8fafc; }
          tfoot td { background: #f1f5f9; font-weight: 700; border-top: 2px solid #0d9488; }
          .e { text-align: left; font-variant-numeric: tabular-nums; direction: ltr; }
          .footer { margin-top: 5mm; display: flex; justify-content: space-between; font-size: 8pt; color: #64748b; }
        </style></head><body>
        <div class="header">
          <div>
            <h2>تقرير قائمة الفواتير</h2>
            <div class="sub">إجمالي النتائج: ${num(state.data.total_count)} فاتورة</div>
          </div>
          <div style="font-size:8pt;color:#64748b;text-align:left;direction:ltr">
            <div><b>Raseen System</b></div>
            <div>${new Date().toLocaleDateString('ar-SA')}</div>
          </div>
        </div>
        <table>
          <thead><tr>${headers.map((h, i) => `<th class="${i >= 7 && i <= 11 ? 'e' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${state.data.items.map((i) => `<tr>${[
            i.invoice_number, i.issue_date, i.issue_time, i.client_name,
            i.client_code, i.issuer_name, i.payment_label, money(i.taxable_amount), money(i.tax_amount), money(i.grand_total),
            money(i.paid_amount), money(i.remaining_amount), i.status_label
          ].map((c, idx) => `<td class="${idx >= 7 && idx <= 11 ? 'e' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          <tfoot><tr>
            <td colspan="7">الإجمالي</td>
            <td class="e">${money(t.taxable_amount || (t.grand_total - t.tax))}</td>
            <td class="e">${money(t.tax)}</td>
            <td class="e">${money(t.grand_total)}</td>
            <td class="e">${money(t.paid)}</td>
            <td class="e">${money(t.remaining)}</td>
            <td></td>
          </tr></tfoot>
        </table>
        <div class="footer">
          <span>نظام رصين للفوترة والمحاسبة — تقرير رسمي A4 PDF</span>
          <span style="direction:ltr">Page 1</span>
        </div>
        </body></html>`;
    };

    $('#btn-pdf-list', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const docHtml = getInvoiceListDocHtml();
        await downloadPdfFromHtml(docHtml, 'قائمة-الفواتير.pdf');
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        e.target.disabled = false;
      }
    });

    $('#print-list', view).addEventListener('click', () => {
      const docHtml = getInvoiceListDocHtml();
      printDoc(docHtml);
    });

    const openImportModal = async () => {
      const activeIssuer = store.issuers.find((i) => i.id === state.issuer_id) || store.issuers[0];
      if (!activeIssuer) return toastErr('يرجى تحديد شركة مصدرة أولاً');

      let parsedRows = [];
      let previewResult = null;

      const m = modal({
        title: 'استيراد الفواتير من ملف Excel / CSV',
        body: html`
          <div class="stack">
            <div class="row" style="align-items:center;justify-content:space-between;background:#f8fafc;padding:.7rem .9rem;border-radius:var(--radius-sm);border:1px solid var(--line);gap:.6rem;flex-wrap:wrap">
              <div>
                <b>الشركة المصدرة:</b> <span class="mono">${esc(activeIssuer.name_ar)}</span>
              </div>
              <div class="flex" style="gap:.4rem;align-items:center;flex-wrap:wrap">
                <a class="btn btn-sm btn-primary" id="btn-dl-template" href="/api/invoices/template?purpose=import&format=xlsx" download="invoice-import.xlsx">تنزيل نموذج الاستيراد</a>
              </div>
            </div>

            <p class="hint">1. نزّل النموذج وأدخل بياناتك وكود العميل المسجل. 2. ارفع الملف وراجع الإجماليات. 3. اعتمد الاستيراد. استخدم رقم المجموعة نفسه لبنود الفاتورة الواحدة.</p><div class="dropzone" id="import-dropzone">
              <div class="dropzone-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>
              </div>
              <div style="font-weight:600;margin-bottom:.2rem">اسحب وأفلت ملف Excel هنا، أو انقر للاختيار</div>
              <div class="tiny muted">الصيغ المدعومة: .xlsx (Excel الأصلي المعتمد), .xls, .csv</div>
              <input type="file" id="import-file" accept=".xlsx,.xls,.csv,.tsv,.xml" style="display:none" />
            </div>

            <div id="import-preview-box" style="display:none"></div>
          </div>`,
        footer: `<button class="btn" data-close type="button">إلغاء</button>
                 <button class="btn btn-primary" id="btn-commit-import" type="button" disabled>اعتماد واستيراد الفواتير</button>`,
      });

      const dropzone = m.el.querySelector('#import-dropzone');
      const fileInput = m.el.querySelector('#import-file');
      const previewBox = m.el.querySelector('#import-preview-box');
      const commitBtn = m.el.querySelector('#btn-commit-import');
      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
      });

      const processFile = async (file) => {
        try {
          previewBox.style.display = 'block';
          previewBox.innerHTML = '<div class="text-center muted" style="padding:1rem">جارٍ قراءة وفحص ملف Excel…</div>';
          commitBtn.disabled = true;

          const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => {
              const res = r.result || '';
              const commaIdx = res.indexOf(',');
              resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
            };
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          const parseRes = await api.post('/api/invoices/parse-file', { file_base64: b64, filename: file.name });
          const rawTable = parseRes.raw_rows || [];
          const smartRows = parseRes.rows || [];
          const analysis = parseRes.analysis || {};
          if (analysis.diagnostics && !analysis.diagnostics.valid) {
            const details = (analysis.diagnostics.errors || []).map((x) => `<li>${esc(x)}</li>`).join('');
            previewBox.innerHTML = `<div class="alert alert-danger"><b>تعذر فهم القالب تلقائياً</b><ul>${details}</ul><div class="tiny">استخدم أسماء أعمدة واضحة مثل: العميل، الصنف، الكمية، سعر الوحدة — بالعربية أو الإنجليزية.</div></div>`;
            return;
          }

          if (!rawTable || rawTable.length < 2) {
            previewBox.innerHTML = '<div class="alert alert-danger">الملف فارغ أو لا يحتوي على أسطر بيانات كافية</div>';
            return;
          }

          parsedRows = smartRows;
          if (!parsedRows.length) {
            previewBox.innerHTML = '<div class="alert alert-danger">لم يتم العثور على صفوف صالحة للاستيراد</div>';
            return;
          }
          const warnings = analysis.diagnostics?.warnings || [];
          if (warnings.length) {
            previewBox.innerHTML = `<div class="alert alert-info tiny">${warnings.map((x) => esc(x)).join(' — ')}</div>`;
          }


          previewBox.innerHTML = '<div class="text-center muted" style="padding:1rem">جارٍ فحص وتحليل البيانات مع الخادم…</div>';
          commitBtn.disabled = true;

          try {
            previewResult = await api.post('/api/invoices/import', {
              issuer_id: activeIssuer.id,
              rows: parsedRows,
              dry_run: true,
            });

            renderPreview(previewResult, file.name);
          } catch (err) {
            previewBox.innerHTML = `<div class="alert alert-danger">${esc(err.message || 'فشل فحص الملف')}</div>`;
          }
        } catch (err) {
          previewBox.innerHTML = `<div class="alert alert-danger">${esc(err.message || 'فشل قراءة الملف')}</div>`;
        }
      };

      const renderPreview = (res, fileName) => {
        const hasErrors = !res.valid || (res.errors && res.errors.length > 0);
        commitBtn.disabled = hasErrors;

        const errorsHtml = hasErrors ? `
          <div class="alert alert-danger tiny" style="max-height:140px;overflow-y:auto;margin-top:.6rem">
            <b>تم رصد ${res.errors.length} أخطاء تمنع الاعتماد:</b>
            <ul style="margin:.3rem 0 0 1rem;padding:0">
              ${res.errors.map((e) => `<li>السطر ${e.row}: ${esc(e.message)}</li>`).join('')}
            </ul>
          </div>` : '';

        const previewRowsHtml = (res.preview || []).slice(0, 15).map((p, idx) => `
          <tr>
            <td class="c">${idx + 1}</td>
            <td class="mono"><b>${esc(p.group)}</b></td>
            <td>${esc(p.client_name)}</td>
            <td class="tiny">${esc(p.issue_date)}</td>
            <td class="c"><span class="badge tiny">${esc(p.invoice_type)}</span></td>
            <td class="c">${p.items_count}</td>
            <td class="text-end num">${money(p.grand_total)}</td>
          </tr>
        `).join('');

        previewBox.innerHTML = `
          <div class="card pad0" style="margin-top:.6rem">
            <div style="padding:.7rem .9rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
              <div>
                <b>الملف:</b> <span class="mono">${esc(fileName)}</span>
                <span style="margin-inline-start:.6rem" class="badge ${hasErrors ? 'status-err' : 'status-ok'}">
                  ${hasErrors ? `يوجد ${res.errors.length} أخطاء` : 'جاهز للاعتماد'}
                </span>
              </div>
              <div class="flex" style="gap:.8rem;font-size:.84rem">
                <div>فواتير: <b class="num">${res.invoices_count || 0}</b></div>
                <div>أسطر: <b class="num">${res.lines_count || 0}</b></div>
                <div>الإجمالي: <b class="num">${money(res.totals?.grand_total || 0)}</b></div>
              </div>
            </div>
            ${errorsHtml}
            <div class="preview-table-container">
              <table class="tbl">
                <thead>
                  <tr><th class="c">#</th><th>المجموعة</th><th>العميل</th><th>التاريخ</th><th class="c">النوع</th><th class="c">البنود</th><th class="text-end">الإجمالي</th></tr>
                </thead>
                <tbody>${previewRowsHtml}</tbody>
              </table>
            </div>
          </div>`;
      };

      commitBtn.addEventListener('click', async () => {
        if (!parsedRows.length || !previewResult || !previewResult.valid) return;
        commitBtn.disabled = true;
        commitBtn.textContent = 'جارٍ الحفظ والترحيل…';
        try {
          const res = await api.post('/api/invoices/import', {
            issuer_id: activeIssuer.id,
            rows: parsedRows,
            dry_run: false,
          });
          toastOk(`تم استيراد ${res.imported_count} فاتورة بنجاح بمبلغ ${money(res.total_amount)} ر.س`);
          m.close();
          await reload();
        } catch (err) {
          commitBtn.disabled = false;
          commitBtn.textContent = 'اعتماد واستيراد الفواتير';
          toastErr(err.message || 'فشل استيراد الفواتير');
        }
      });
    };

    const importBtn = $('#import-excel-btn', view);
    if (importBtn) importBtn.addEventListener('click', openImportModal);

    delegate(view, 'click', '[data-act]', async (e, btn) => {
      const id = btn.dataset.id;
      if (btn.dataset.act === 'download') {
        btn.disabled = true;
        try {
          const invoice = await api.get(`/api/invoices/${id}`);
          const [issuer, client] = await Promise.all([
            api.get(`/api/issuers/${invoice.issuer_id}`),
            api.get(`/api/clients/${invoice.client_id}`),
          ]);
          await downloadInvoicePdf({ invoice, issuer, client });
        } finally {
          btn.disabled = false;
        }
      } else if (btn.dataset.act === 'share') {
        btn.disabled = true;
        try {
          const invoice = await api.get(`/api/invoices/${id}`);
          const [issuer, client] = await Promise.all([
            api.get(`/api/issuers/${invoice.issuer_id}`),
            api.get(`/api/clients/${invoice.client_id}`),
          ]);
          await shareInvoicePdfFile({ invoice, issuer, client });
        } finally {
          btn.disabled = false;
        }
      } else if (btn.dataset.act === 'print' || btn.dataset.act === 'thermal') {
        btn.disabled = true;
        try {
          const invoice = await api.get(`/api/invoices/${id}`);
          const [issuer, client] = await Promise.all([
            api.get(`/api/issuers/${invoice.issuer_id}`),
            api.get(`/api/clients/${invoice.client_id}`),
          ]);
          printDoc(invoiceA4({ invoice, issuer, client }));
        } finally {
          btn.disabled = false;
        }
      }
      else if (btn.dataset.act === 'pay') {
        const invoice = await api.get(`/api/invoices/${id}`);
        const m = modal({
          title: `سند قبض للفاتورة ${invoice.invoice_number}`,
          slim: true,
          body: html`
            <div class="alert alert-info tiny">المتبقي على الفاتورة: <b class="num">${money(invoice.remaining_amount)}</b></div>
            <div class="field"><label class="req">المبلغ</label>
              <input type="number" name="amount" value="${invoice.remaining_amount}" step="0.01" min="0.01" max="${invoice.remaining_amount}" /></div>
            <div class="field mt"><label>طريقة السداد</label>
              <select name="payment_type"><option value="CASH">نقداً</option><option value="TRANSFER">تحويل</option>
                <option value="CARD">شبكة</option><option value="CHEQUE">شيك</option></select></div>
            <div class="field mt"><label>المرجع</label><input type="text" name="reference_no" class="ltr" /></div>`,
          footer: `<button class="btn" data-close type="button">إلغاء</button>
                   <button class="btn btn-primary" data-ok type="button">تسجيل</button>`,
        });
        m.el.querySelector('[data-ok]').addEventListener('click', async (ev) => {
          const values = formValues(m.body);
          if (!values.amount) return toastErr('أدخل المبلغ');
          ev.target.disabled = true;
          try {
            const v = await api.post('/api/vouchers/for-invoice', { invoice_id: id, ...values });
            toastOk(`تم تسجيل السند ${v.voucher_number}`);
            m.close();
            await reload();
          } catch { ev.target.disabled = false; }
          return undefined;
        });
      }
    });
  };

  await load();
  draw();
  return undefined;
}
