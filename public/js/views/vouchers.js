// ==========================================================================
//  سندات القبض: قائمة، سند مجمّع بتوزيع على عدة فواتير، عرض وطباعة وإلغاء.
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, can, currencyLabel, getFilterState, setFilterState, clearFilterState } from '../core/store.js';
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, today, monthStart, toastOk, toastErr,
  $, $$, delegate, debounce, modal, formValues, confirmDialog, exportCsv, exportExcel, printDoc, toNum,
  icon, downloadPdfFromHtml, amount, sarSvg,
} from '../core/util.js';
import { voucherPrint, VOUCHER_TEMPLATES } from '../print/templates.js';

const PAGE = 50;

/** نافذة سند القبض المجمّع مع توزيع تفاعلي على الفواتير المفتوحة. */
export function voucherWizard({ clientId = '', issuerId = '', onDone }) {
  const cur = currencyLabel();
  const m = modal({
    title: 'سند قبض جديد',
    wide: true,
    body: html`
      <div class="row">
        <div class="field"><label class="req">الشركة المصدرة</label>
          <select name="issuer_id" id="w-issuer">
            ${raw(store.issuers.filter((i) => i.is_active).map((i) => `<option value="${esc(i.id)}" ${i.id === issuerId ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
          </select></div>
        <div class="field" style="flex:1.3"><label class="req">العميل</label>
          <select name="client_id" id="w-client">
            <option value="">— اختر العميل —</option>
            ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === clientId ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
          </select></div>
        <div class="field" style="max-width:160px"><label>التاريخ</label>
          <input type="date" name="voucher_date" value="${today()}" /></div>
      </div>
      <div class="row mt">
        <div class="field" style="max-width:190px"><label class="req">المبلغ المستلم (${esc(cur)})</label>
          <input type="number" name="total_amount" id="w-amount" value="" step="0.01" min="0.01" /></div>
        <div class="field" style="max-width:170px"><label>طريقة السداد</label>
          <select name="payment_type">
            <option value="CASH">نقداً</option><option value="TRANSFER">تحويل بنكي</option>
            <option value="CARD">شبكة / بطاقة</option><option value="CHEQUE">شيك</option>
          </select></div>
        <div class="field" style="max-width:180px"><label>رقم المرجع / الشيك</label><input type="text" name="reference_no" class="ltr" /></div>
        <div class="field"><label>ملاحظات</label><input type="text" name="notes" /></div>
      </div>
      <div class="alert alert-info mt tiny" id="w-hint">
        اختر العميل لعرض فواتيره غير المسددة. يمكنك التوزيع تلقائياً من الأقدم للأحدث، أو إدخال مبلغ لكل فاتورة يدوياً،
        أو تركها بدون توزيع ليبقى المبلغ رصيداً دائناً للعميل.
      </div>
      <div id="w-open"></div>`,
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn" data-fifo type="button">توزيع تلقائي (الأقدم أولاً)</button>
             <button class="btn btn-primary" data-ok type="button">حفظ السند</button>`,
  });

  let open = [];
  const alloc = new Map();

  const renderOpen = () => {
    const box = $('#w-open', m.body);
    if (!open.length) {
      box.innerHTML = '<div class="alert alert-warn tiny">لا توجد فواتير غير مسددة لهذا العميل بهذه الشركة — سيُسجَّل المبلغ كرصيد دائن.</div>';
      return;
    }
    const totalOpen = open.reduce((a, i) => a + i.remaining_amount, 0);
    const totalAlloc = Array.from(alloc.values()).reduce((a, b) => a + b, 0);
    const enteredAmount = toNum($('#w-amount', m.body).value, 0);
    box.innerHTML = `
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="tbl compact">
          <thead><tr><th style="width:30px"></th><th>الفاتورة</th><th>التاريخ</th>
            <th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">المتبقي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th style="width:130px">المبلغ الموزّع <span class="cur-sym">${sarSvg({ size: 11 })}</span></th></tr></thead>
          <tbody>
            ${open.map((i) => `<tr>
              <td><input type="checkbox" data-pick="${esc(i.id)}" ${alloc.has(i.id) ? 'checked' : ''} /></td>
              <td class="mono">${esc(i.invoice_number)}</td>
              <td class="tiny">${esc(dateAr(i.issue_date))}</td>
              <td class="text-end num tiny">${amount(i.grand_total)}</td>
              <td class="text-end num">${amount(i.remaining_amount)}</td>
              <td><input type="number" data-amt="${esc(i.id)}" value="${alloc.get(i.id) || ''}" step="0.01" min="0" max="${i.remaining_amount}" /></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="row mt tiny">
        <div>إجمالي المتبقي على الفواتير: <b class="num">${amount(totalOpen)}</b></div>
        <div class="spacer"></div>
        <div>الموزّع: <b class="num">${amount(totalAlloc)}</b>
          ${enteredAmount ? ` / غير موزّع: <b class="num" style="color:${Math.abs(enteredAmount - totalAlloc) < 0.005 ? 'var(--success)' : 'var(--warn)'}">${amount(Math.round((enteredAmount - totalAlloc) * 100) / 100)}</b>` : ''}</div>
      </div>`;

    $$('[data-pick]', box).forEach((cb) => cb.addEventListener('change', () => {
      const id = cb.dataset.pick;
      const inv = open.find((x) => x.id === id);
      if (cb.checked) {
        const amt = toNum($('#w-amount', m.body).value, 0);
        const used = Array.from(alloc.values()).reduce((a, b) => a + b, 0);
        const avail = amt ? Math.max(0, Math.round((amt - used) * 100) / 100) : inv.remaining_amount;
        alloc.set(id, Math.min(inv.remaining_amount, avail || inv.remaining_amount));
      } else alloc.delete(id);
      renderOpen();
    }));
    $$('[data-amt]', box).forEach((inp) => inp.addEventListener('change', () => {
      const id = inp.dataset.amt;
      const v = toNum(inp.value, 0);
      if (v > 0) alloc.set(id, v); else alloc.delete(id);
      renderOpen();
    }));
  };

  const loadOpen = async () => {
    const clientSel = $('#w-client', m.body).value;
    alloc.clear();
    if (!clientSel) { open = []; $('#w-open', m.body).innerHTML = ''; return; }
    open = await api.get(qs('/api/invoices/open', { client_id: clientSel, issuer_id: $('#w-issuer', m.body).value }));
    renderOpen();
  };

  $('#w-client', m.body).addEventListener('change', loadOpen);
  $('#w-issuer', m.body).addEventListener('change', loadOpen);
  $('#w-amount', m.body).addEventListener('input', () => { if (open.length) renderOpen(); });

  m.el.querySelector('[data-fifo]').addEventListener('click', () => {
    let remaining = toNum($('#w-amount', m.body).value, 0);
    if (!remaining) return toastErr('أدخل المبلغ المستلم أولاً');
    alloc.clear();
    for (const inv of open) {
      if (remaining <= 0) break;
      const take = Math.min(inv.remaining_amount, Math.round(remaining * 100) / 100);
      if (take > 0) { alloc.set(inv.id, take); remaining = Math.round((remaining - take) * 100) / 100; }
    }
    renderOpen();
    return undefined;
  });

  m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const values = formValues(m.body);
    if (!values.client_id) return toastErr('اختر العميل');
    if (!values.total_amount || values.total_amount <= 0) return toastErr('أدخل مبلغاً صحيحاً');
    const allocations = Array.from(alloc.entries()).map(([invoice_id, amount]) => ({ invoice_id, amount }));
    const sum = allocations.reduce((a, b) => a + b.amount, 0);
    if (sum > values.total_amount + 0.004) return toastErr('مجموع التوزيع أكبر من مبلغ السند');

    if (sum < values.total_amount - 0.004) {
      const surplus = Math.round((values.total_amount - sum) * 100) / 100;
      const proceed = await confirmDialog({
        title: 'تنبيه فائض غير موزّع',
        message: `مبلغ السند (${money(values.total_amount)}) أكبر من المجموع الموزع (${money(sum)}). سيتم تسجيل الفائض (${money(surplus)} ${cur}) كرصيد دائن للعميل في كشف الحساب. هل ترغب في المتابعة؟`,
        confirmText: 'نعم، حفظ السند',
      });
      if (!proceed) return undefined;
    }

    e.target.disabled = true;
    try {
      const voucher = await api.post('/api/vouchers', {
        issuer_id: values.issuer_id,
        client_id: values.client_id,
        voucher_date: values.voucher_date,
        total_amount: values.total_amount,
        payment_type: values.payment_type,
        reference_no: values.reference_no,
        notes: values.notes,
        allocations,
      });
      toastOk(`تم تسجيل السند ${voucher.voucher_number}`);
      m.close();
      if (onDone) onDone(voucher);
    } catch { e.target.disabled = false; }
    return undefined;
  });

  if (clientId) loadOpen();
  return m;
}

async function showVoucher(id, onChange) {
  const voucher = await api.get(`/api/vouchers/${id}`);
  const [issuer, client] = await Promise.all([
    api.get(`/api/issuers/${voucher.issuer_id}`),
    api.get(`/api/clients/${voucher.client_id}`),
  ]);
  const m = modal({
    title: `سند قبض ${voucher.voucher_number} ${voucher.status === 'CANCELLED' ? '(ملغى)' : ''}`,
    wide: true,
    body: html`
      <div style="background:var(--card-bg, #f8fafc);border:1.5px solid var(--primary, #0d9488);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px">
          <span style="color:var(--primary, #0d9488)">قالب السند للطباعة والـ PDF:</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <select id="v-style-select" style="min-width:300px;font-size:13px;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color, #cbd5e1);background:var(--input-bg, #fff);font-weight:700">
            ${raw(VOUCHER_TEMPLATES.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.badge)})</option>`).join(''))}
          </select>
        </div>
      </div>
      <div class="grid grid-2">
        <dl class="kv">
          <dt>العميل</dt><dd>${voucher.client_name}</dd>
          <dt>الشركة</dt><dd>${voucher.issuer_name}</dd>
          <dt>التاريخ</dt><dd>${dateAr(voucher.voucher_date)}</dd>
          <dt>طريقة السداد</dt><dd>${voucher.payment_label}</dd>
          <dt>المرجع</dt><dd class="mono">${voucher.reference_no || '—'}</dd>
        </dl>
        <dl class="kv">
          <dt>المبلغ</dt><dd class="num"><b>${amount(voucher.total_amount, 'SAR', { size: 14 })}</b></dd>
          <dt>الموزّع على فواتير</dt><dd class="num">${amount(voucher.allocated_total)}</dd>
          <dt>غير موزّع (رصيد دائن)</dt><dd class="num">${amount(voucher.unallocated)}</dd>
          <dt>أنشئ بواسطة</dt><dd>${voucher.created_by}</dd>
          <dt>وقت الإنشاء</dt><dd class="tiny">${dateTimeAr(voucher.created_at)}</dd>
        </dl>
      </div>
      ${raw(voucher.notes ? `<div class="alert alert-info tiny">${esc(voucher.notes)}</div>` : '')}
      ${raw(voucher.allocations.length ? `<div class="table-wrap mt"><table class="tbl compact">
        <thead><tr><th>الفاتورة</th><th>تاريخها</th><th class="text-end">إجمالي الفاتورة <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
          <th class="text-end">المخصص <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th class="text-end">المتبقي عليها <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th></th></tr></thead>
        <tbody>${voucher.allocations.map((a) => `<tr>
          <td class="mono">${esc(a.invoice_number)}</td>
          <td class="tiny">${esc(dateAr(a.issue_date))}</td>
          <td class="text-end num tiny">${amount(a.invoice_total)}</td>
          <td class="text-end num"><b>${amount(a.allocated_amount)}</b></td>
          <td class="text-end num">${amount(a.invoice_remaining)}</td>
          <td class="actions"><a class="btn btn-sm" href="#/invoice-view/${esc(a.invoice_id)}">${icon.eye({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}عرض</a></td>
        </tr>`).join('')}</tbody></table></div>`
    : '<div class="alert alert-warn tiny mt">هذا السند غير موزّع على فواتير — كامل مبلغه رصيد دائن للعميل.</div>')}`,
    footer: `<button class="btn" data-close type="button">إغلاق</button>
             <a class="btn" href="/api/vouchers/${voucher.id}/pdf?style=voucher_saqr_slip" id="v-server-pdf" target="_blank" download="سند-${voucher.voucher_number}.pdf">${icon.download({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}تنزيل PDF مباشر</a>
             <button class="btn btn-primary" data-pdf type="button">${icon.pdf({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}تحميل PDF</button>
             <button class="btn" data-print type="button">${icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}طباعة السند</button>
             ${voucher.status === 'ACTIVE' && can('vouchers.create') ? `<button class="btn btn-danger" data-cancel type="button">${icon.trash({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}إلغاء السند</button>` : ''}`,
  });
  const getSelectedStyle = () => {
    const sel = $('#v-style-select', m.body);
    return sel ? sel.value : 'voucher_saqr_slip';
  };
  const serverPdfLink = $('#v-server-pdf', m.footer || m.el);
  const styleSel = $('#v-style-select', m.body);
  if (styleSel && serverPdfLink) {
    styleSel.addEventListener('change', () => {
      serverPdfLink.href = `/api/vouchers/${voucher.id}/pdf?style=${styleSel.value}`;
    });
  }
  const pdfBtn = m.el.querySelector('[data-pdf]');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const style = getSelectedStyle();
        const docHtml = voucherPrint({ voucher, issuer, client, style });
        await downloadPdfFromHtml(docHtml, `سند-قبض-${voucher.voucher_number}.pdf`);
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        e.target.disabled = false;
      }
    });
  }
  m.el.querySelector('[data-print]').addEventListener('click', () => {
    const style = getSelectedStyle();
    printDoc(voucherPrint({ voucher, issuer, client, style }));
  });
  const cancelBtn = m.el.querySelector('[data-cancel]');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'إلغاء سند القبض',
        message: 'سيُعاد فتح الفواتير المسددة بهذا السند ويُعكس أثره في كشف الحساب.',
        danger: true,
        okText: 'إلغاء السند',
      });
      if (!ok) return;
      try {
        await api.post(`/api/vouchers/${id}/cancel`, { reason: 'إلغاء من شاشة السندات' });
        toastOk('تم إلغاء السند');
        m.close();
        if (onChange) onChange();
      } catch { /* تنبيه تلقائي */ }
    });
  }
}

export async function render(view, ctx) {
  await loadClients();
  const q0 = (ctx && ctx.query) || {};
  const defaults = {
    issuer_id: store.activeIssuerId,
    client_id: '',
    status: '',
    payment_type: '',
    from: '',
    to: '',
    min_amount: '',
    max_amount: '',
    q: '',
    offset: 0,
  };
  const cached = getFilterState('vouchers', defaults);
  const state = {
    ...cached,
    ...q0,
    offset: q0.offset !== undefined ? Number(q0.offset) : (cached.offset || 0),
    data: { items: [], totals: {}, total_count: 0 },
  };
  if (q0.issuer_id !== undefined) state.issuer_id = q0.issuer_id;

  const saveState = () => {
    setFilterState('vouchers', {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      status: state.status,
      payment_type: state.payment_type,
      from: state.from,
      to: state.to,
      min_amount: state.min_amount,
      max_amount: state.max_amount,
      q: state.q,
      offset: state.offset,
    });
  };

  const load = async () => {
    saveState();
    state.data = await api.get(qs('/api/vouchers', {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      status: state.status,
      payment_type: state.payment_type,
      from: state.from,
      to: state.to,
      min_amount: state.min_amount,
      max_amount: state.max_amount,
      q: state.q,
      limit: PAGE,
      offset: state.offset,
    }));
  };

  const draw = () => {
    const pageTo = Math.min(state.offset + PAGE, state.data.total_count);
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>سندات القبض</h1>
          <p>سند واحد يمكن أن يسدد فاتورة واحدة أو عدة فواتير، كلياً أو جزئياً.</p>
        </div>
        <div class="page-actions">
          ${raw(can('vouchers.create') ? `<button class="btn btn-primary" id="new-v" type="button">${icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}سند قبض جديد</button>` : '')}
          <button class="btn btn-primary" id="btn-pdf-vouchers" type="button">
            ${raw(icon.pdf({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            تحميل قائمة PDF
          </button>
          <button class="btn" id="btn-voucher-templates" type="button">
            ${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            قوالب Excel للسندات ▾
          </button>
          <button class="btn" id="exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn" id="exp-csv" type="button">${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}CSV</button>
        </div>
      </div>

      <div class="card filter-box">
        <div class="filter-row">
          <div class="field flex-2"><label for="q">بحث سريع</label>
            <input type="search" id="q" value="${esc(state.q)}" placeholder="رقم السند، المرجع، اسم العميل، ملاحظات…" /></div>
          <div class="field"><label for="issuer_id">الشركة</label>
            <select id="issuer_id"><option value="">كل الشركات</option>
              ${raw(store.issuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
            </select></div>
          <div class="field"><label for="client_id">العميل</label>
            <select id="client_id"><option value="">كل العملاء</option>
              ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}
            </select></div>
          <div class="field field-sm"><label for="status">الحالة</label>
            <select id="status"><option value="">كل الحالات</option>
              <option value="ACTIVE" ${raw(state.status === 'ACTIVE' ? 'selected' : '')}>نشط</option>
              <option value="CANCELLED" ${raw(state.status === 'CANCELLED' ? 'selected' : '')}>ملغى</option>
            </select></div>
          <div class="field field-sm"><label for="payment_type">طريقة السداد</label>
            <select id="payment_type"><option value="">كل الطرق</option>
              <option value="CASH" ${raw(state.payment_type === 'CASH' ? 'selected' : '')}>نقداً</option>
              <option value="TRANSFER" ${raw(state.payment_type === 'TRANSFER' ? 'selected' : '')}>تحويل بنكي</option>
              <option value="CARD" ${raw(state.payment_type === 'CARD' ? 'selected' : '')}>شبكة</option>
              <option value="CHEQUE" ${raw(state.payment_type === 'CHEQUE' ? 'selected' : '')}>شيك</option>
            </select></div>
        </div>
        <div class="filter-row" style="margin-top:.75rem">
          <div class="field field-date"><label for="from">من تاريخ</label><input type="date" id="from" value="${state.from}" /></div>
          <div class="field field-date"><label for="to">إلى تاريخ</label><input type="date" id="to" value="${state.to}" /></div>
          <div class="field field-num"><label for="min_amount">أقل مبلغ</label><input type="number" id="min_amount" value="${state.min_amount}" placeholder="0.00" step="0.01" min="0" /></div>
          <div class="field field-num"><label for="max_amount">أعلى مبلغ</label><input type="number" id="max_amount" value="${state.max_amount}" placeholder="0.00" step="0.01" min="0" /></div>
          <div class="filter-actions-col">
            <div class="filter-btn-group">
              <button class="btn btn-sm" data-quick="today" type="button" title="سندات اليوم">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}اليوم</button>
              <button class="btn btn-sm" data-quick="month" type="button" title="سندات هذا الشهر">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذا الشهر</button>
              <button class="btn btn-sm" data-quick="clear" type="button" title="إعادة تعيين الفلاتر">إعادة تعيين</button>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(state.data.totals.total_amount, 'SAR', { size: 16 })}</div><div class="stat-lab">إجمالي السندات المطابقة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(state.data.total_count)}</div><div class="stat-lab">عدد السندات</div></div></div>
      </div>

      <div class="card pad0 mt">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>رقم السند</th><th>التاريخ</th><th>العميل</th><th>الشركة</th><th>طريقة السداد</th>
              <th>المرجع</th><th class="text-end">المبلغ <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end">الموزّع <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end">غير موزّع <span class="cur-sym">${sarSvg({ size: 12 })}</span></th><th></th></tr></thead>
            <tbody>
              ${raw(state.data.items.length ? state.data.items.map((v) => `<tr class="${v.status === 'CANCELLED' ? 'row-off' : ''}">
                <td class="mono"><b>${esc(v.voucher_number)}</b></td>
                <td class="tiny nowrap">${esc(dateAr(v.voucher_date))}</td>
                <td>${esc(v.client_name)}<div class="tiny muted mono">${esc(v.client_code)}</div></td>
                <td class="tiny">${esc(v.issuer_name)}</td>
                <td class="tiny">${esc(v.payment_label)}</td>
                <td class="tiny mono">${esc(v.reference_no || '—')}</td>
                <td class="text-end num"><b>${amount(v.total_amount)}</b></td>
                <td class="text-end num">${amount(v.allocated_total)}</td>
                <td class="text-end num">${v.unallocated > 0 ? `<span class="badge amber">${amount(v.unallocated)}</span>` : '—'}</td>
                <td class="actions">
                  ${v.status === 'CANCELLED' ? '<span class="badge red">ملغى</span>' : '<span class="badge green">نشط</span>'}
                  <button class="btn btn-sm" data-act="show" data-id="${esc(v.id)}" type="button">${icon.eye({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}عرض</button>
                </td>
              </tr>`).join('') : '<tr><td colspan="10" class="text-center muted" style="padding:2rem">لا توجد سندات مطابقة</td></tr>')}
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn btn-sm" id="prev" ${raw(state.offset === 0 ? 'disabled' : '')} type="button">${raw(icon.arrowRight({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}السابق</button>
          <span class="tiny muted">${state.data.total_count ? state.offset + 1 : 0} — ${pageTo} من ${num(state.data.total_count)}</span>
          <button class="btn btn-sm" id="next" ${raw(pageTo >= state.data.total_count ? 'disabled' : '')} type="button">التالي${raw(icon.arrowLeft({ size: 14, style: 'vertical-align:text-bottom;margin-right:3px' }))}</button>
        </div>
      </div>`;

    const reload = async () => { await load(); draw(); };
    $('#q', view).addEventListener('input', debounce(async (e) => { state.q = e.target.value; state.offset = 0; await reload(); }, 350));
    ['issuer_id', 'client_id', 'status', 'payment_type', 'from', 'to'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) el.addEventListener('change', async (e) => { state[id] = e.target.value; state.offset = 0; await reload(); });
    });
    ['min_amount', 'max_amount'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) el.addEventListener('change', async (e) => { state[id] = e.target.value; state.offset = 0; await reload(); });
    });

    delegate(view, 'click', '[data-quick]', async (e, btn) => {
      const kind = btn.dataset.quick;
      if (kind === 'month') { state.from = monthStart(); state.to = today(); }
      else if (kind === 'today') { state.from = today(); state.to = today(); }
      else {
        clearFilterState('vouchers');
        Object.assign(state, defaults, { issuer_id: store.activeIssuerId, data: state.data });
      }
      state.offset = 0;
      await reload();
    });

    $('#prev', view).addEventListener('click', async () => { state.offset = Math.max(0, state.offset - PAGE); await reload(); });
    $('#next', view).addEventListener('click', async () => { state.offset += PAGE; await reload(); });

    const newBtn = $('#new-v', view);
    if (newBtn) {
      newBtn.addEventListener('click', () => voucherWizard({
        clientId: state.client_id,
        issuerId: state.issuer_id || store.activeIssuerId,
        onDone: reload,
      }));
    }

    delegate(view, 'click', '[data-act="show"]', async (e, btn) => { await showVoucher(btn.dataset.id, reload); });

    const headers = ['رقم السند', 'التاريخ', 'العميل', 'الشركة', 'طريقة السداد', 'المرجع', 'المبلغ', 'الموزّع', 'غير موزّع', 'الحالة'];
    const rows = () => state.data.items.map((v) => [v.voucher_number, v.voucher_date, v.client_name, v.issuer_name,
      v.payment_label, v.reference_no, v.total_amount, v.allocated_total, v.unallocated, v.status_label]);
    $('#exp-csv', view).addEventListener('click', () => exportCsv('سندات-القبض', headers, rows()));
    $('#exp-xls', view).addEventListener('click', () => exportExcel('سندات-القبض', 'سندات القبض', headers, rows()));

    $('#btn-voucher-templates', view)?.addEventListener('click', () => {
      modal({
        title: 'قوالب Excel المعتمدة لسندات القبض',
        wide: true,
        body: html`
          <p class="muted" style="margin-bottom:14px;font-size:13px">
            اختر قالب سند القبض المطلوب لتنزيل ملف الـ Excel الأصلي (.xlsx) المعتمد أو صيغة SpreadsheetML (.xls):
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="card" style="border:2px solid #0284c7;border-radius:10px;padding:16px;background:#f0f9ff">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span class="badge" style="background:#0284c7;color:#fff;font-weight:700">عينة توريدات الصقر</span>
                <span class="tiny mono" style="color:#0369a1">A4 Portrait</span>
              </div>
              <h3 style="margin:0 0 6px;color:#0369a1;font-size:15px">قسيمة تحصيل وسند قبض (توريدات الصقر)</h3>
              <p style="font-size:12px;color:#334155;margin:0 0 14px;line-height:1.5">
                قالب قسيمة تحصيل الصقر بكروت المؤشرات الأربعة (المبلغ، رقم السند، التاريخ، العميل)، شريط التفقيط، جدول بيان السند وتوزيع الفواتير، وثلاث تواقيع معتمدة (الصندوق، المحاسب، الختم).
              </p>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <a class="btn btn-sm btn-primary" href="/api/vouchers/template?style=voucher_saqr_slip&format=xlsx" target="_blank" download="voucher_template_voucher_saqr_slip.xlsx" style="background:#0284c7;border-color:#0284c7">
                  ${raw(icon.download({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}تنزيل Excel (.xlsx)
                </a>
                <a class="btn btn-sm" href="/api/vouchers/template?style=voucher_saqr_slip&format=xls" target="_blank" download="voucher_template_voucher_saqr_slip.xls">
                  تنزيل توافقي (.xls)
                </a>
              </div>
            </div>

            <div class="card" style="border:2px solid #1e3a8a;border-radius:10px;padding:16px;background:#f8fafc">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span class="badge" style="background:#1e3a8a;color:#fff;font-weight:700">عينة الإصدار الفاخر وتويوتا</span>
                <span class="tiny mono" style="color:#172554">A4 Portrait</span>
              </div>
              <h3 style="margin:0 0 6px;color:#1e3a8a;font-size:15px">سند قبض تجاري (الإصدار الفاخر وتويوتا)</h3>
              <p style="font-size:12px;color:#334155;margin:0 0 14px;line-height:1.5">
                قالب تنفيذي ثنائي اللغة فاخر، شريط بيانات السند والتاريخ، شارة المبلغ البارزة، شريط التفقيط، جدول تسديد الفواتير، والاعتماد الثنائي (الصندوق والمحاسب).
              </p>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <a class="btn btn-sm btn-primary" href="/api/vouchers/template?style=voucher_luxury_receipt&format=xlsx" target="_blank" download="voucher_template_voucher_luxury_receipt.xlsx" style="background:#1e3a8a;border-color:#1e3a8a">
                  ${raw(icon.download({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}تنزيل Excel (.xlsx)
                </a>
                <a class="btn btn-sm" href="/api/vouchers/template?style=voucher_luxury_receipt&format=xls" target="_blank" download="voucher_template_voucher_luxury_receipt.xls">
                  تنزيل توافقي (.xls)
                </a>
              </div>
            </div>
          </div>
        `,
        footer: '<button class="btn" data-close type="button">إغلاق</button>',
      });
    });

    const getVouchersDocHtml = () => {
      const now = new Date();
      return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير سندات القبض</title>
        <style>
          @page { size: A4 landscape; margin: 10mm; }
          * { box-sizing: border-box; }
          body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; color: #0f172a; background: #fff; }
          .header { border-bottom: 2.5px solid #0d9488; padding-bottom: 4mm; margin-bottom: 4mm; display: flex; justify-content: space-between; align-items: center; }
          h1 { margin: 0 0 1mm; font-size: 15pt; color: #0f766e; }
          .sub { color: #64748b; font-size: 8.5pt; }
          table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 2mm; }
          th { background: #0d9488; color: #fff; border: 1px solid #0f766e; padding: 2.2mm 1.5mm; font-weight: 700; text-align: right; }
          th.e { text-align: left; }
          td { border: 1px solid #cbd5e1; padding: 1.8mm 1.5mm; color: #1e293b; }
          tr:nth-child(even) td { background: #f8fafc; }
          tfoot td { background: #f1f5f9; font-weight: 700; border-top: 2px solid #0d9488; }
          .e { text-align: left; font-variant-numeric: tabular-nums; direction: ltr; }
          .footer { margin-top: 5mm; display: flex; justify-content: space-between; font-size: 8pt; color: #64748b; }
        </style></head><body>
        <div class="header">
          <div>
            <h1>تقرير قائمة سندات القبض</h1>
            <div class="sub">إجمالي السندات: ${num(state.data.total_count)} سند — بمبلغ إجمالي: ${money(state.data.totals.total_amount)} ر.س</div>
          </div>
          <div style="font-size:8pt;color:#64748b;text-align:left;direction:ltr">
            <div><b>Raseen System</b></div>
            <div>${now.toLocaleDateString('ar-SA')}</div>
          </div>
        </div>
        <table>
          <thead><tr>${headers.map((h, i) => `<th class="${i >= 6 && i <= 8 ? 'e' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${state.data.items.map((v) => `<tr>
            <td class="e"><b>${esc(v.voucher_number)}</b></td>
            <td>${esc(v.voucher_date)}</td>
            <td>${esc(v.client_name)}</td>
            <td>${esc(v.issuer_name)}</td>
            <td>${esc(v.payment_label)}</td>
            <td>${esc(v.reference_no || '—')}</td>
            <td class="e">${money(v.total_amount)}</td>
            <td class="e">${money(v.allocated_total)}</td>
            <td class="e">${money(v.unallocated)}</td>
            <td>${esc(v.status_label)}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr>
            <td colspan="6">الإجمالي</td>
            <td class="e">${money(state.data.totals.total_amount)}</td>
            <td class="e">${money(state.data.totals.allocated_total || 0)}</td>
            <td class="e">${money(state.data.totals.unallocated_total || 0)}</td>
            <td></td>
          </tr></tfoot>
        </table>
        <div class="footer">
          <span>نظام رصين للفوترة والمحاسبة — تقرير رسمي A4 PDF</span>
          <span style="direction:ltr">Page 1</span>
        </div>
        </body></html>`;
    };

    $('#btn-pdf-vouchers', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const docHtml = getVouchersDocHtml();
        await downloadPdfFromHtml(docHtml, 'قائمة-سندات-القبض.pdf');
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        e.target.disabled = false;
      }
    });
  };

  await load();
  draw();
  return undefined;
}
