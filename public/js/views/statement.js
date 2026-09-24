// ==========================================================================
//  كشف حساب العميل: موحّد لكل الشركات أو مفلتر لشركة، بطباعة وتصدير.
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, can, currencyLabel } from '../core/store.js';
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, monthStart, today, toastOk, toastErr,
  $, delegate, exportCsv, exportExcel, printDoc, icon, downloadPdfFromHtml,
  amount, sarSvg,
} from '../core/util.js';
import { statementPrint } from '../print/templates.js';

export async function render(view, ctx) {
  await loadClients();
  const q0 = (ctx && ctx.query) || {};
  const state = {
    client_id: (ctx.params && ctx.params[0]) || q0.client_id || (store.clients[0] && store.clients[0].id) || '',
    issuer_id: q0.issuer_id !== undefined ? q0.issuer_id : '',
    from: q0.from || '',
    to: q0.to || '',
    data: null,
  };
  const cur = currencyLabel();

  if (!state.client_id) {
    view.innerHTML = html`<div class="card"><div class="empty">
      <h3>لا يوجد عملاء</h3><p class="muted">أضف عميلاً لعرض كشف حسابه.</p>
      <a class="btn btn-primary" href="#/clients">إدارة العملاء</a></div></div>`;
    return undefined;
  }

  const load = async () => {
    const res = await api.get(qs('/api/ledger/statement', {
      client_id: state.client_id,
      issuer_id: state.issuer_id,
      from: state.from,
      to: state.to,
    }));
    state.data = res || {};
    if (!Array.isArray(state.data.entries)) state.data.entries = [];
    if (!state.data.totals) state.data.totals = {};
    if (!state.data.period) state.data.period = {};
    if (!state.data.client) state.data.client = { name: '' };
  };

  const draw = () => {
    const d = state.data;
    const t = d.totals;
    const balColor = t.closing_balance > 0 ? 'var(--danger)' : t.closing_balance < 0 ? 'var(--success)' : 'inherit';

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>كشف حساب — ${d.client.name}</h1>
          <p>${d.scope === 'ALL' ? 'كشف موحّد يشمل كل الشركات المصدرة' : `مقيّد بشركة: ${d.issuer.name}`}
            ${d.period.from || d.period.to ? ` — الفترة: ${d.period.from ? dateAr(d.period.from) : 'البداية'} إلى ${d.period.to ? dateAr(d.period.to) : 'الآن'}` : ' — كل الحركات'}</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="btn-pdf" type="button">
            ${raw(icon.pdf({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            تحميل PDF
          </button>
          <button class="btn" id="print" type="button">
            ${raw(icon.printer({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            طباعة
          </button>
          <button class="btn" id="exp-xls" type="button">
            ${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            تصدير Excel
          </button>
          <button class="btn" id="exp-csv" type="button">
            ${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            CSV
          </button>
          ${raw(can('vouchers.create') ? `<button class="btn" id="pay" type="button">${icon.receipt({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}سند قبض</button>` : '')}
          ${raw(can('invoices.create') ? `<a class="btn" href="#/invoice?client_id=${esc(state.client_id)}">${icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}فاتورة جديدة</a>` : '')}
        </div>
      </div>

      <div class="card">
        <div class="row">
          <div class="field" style="flex:1.3"><label>العميل</label>
            <select id="client_id">
              ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
            </select></div>
          <div class="field"><label>نطاق الكشف</label>
            <select id="issuer_id">
              <option value="">كل الشركات (موحّد)</option>
              ${raw(store.issuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
            </select></div>
          <div class="field" style="max-width:160px"><label>من تاريخ</label><input type="date" id="from" value="${state.from}" /></div>
          <div class="field" style="max-width:160px"><label>إلى تاريخ</label><input type="date" id="to" value="${state.to}" /></div>
          <div class="field" style="max-width:260px"><label>&nbsp;</label>
            <div class="flex">
              <button class="btn btn-sm" data-quick="month" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذا الشهر</button>
              <button class="btn btn-sm" data-quick="year" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذه السنة</button>
              <button class="btn btn-sm" data-quick="all" type="button">كل الحركات</button>
            </div></div>
        </div>
        ${raw(d.scope === 'ISSUER' && !d.includes_opening_balance_row
    ? '<div class="alert alert-warn mt tiny mb0">الرصيد الافتتاحي للعميل غير مرتبط بشركة معينة، لذلك لا يظهر في الكشف المقيّد بشركة واحدة. اختر «كل الشركات» لرؤيته.</div>'
    : '')}
      </div>

      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.debit, 'SAR', { size: 16 })}</div><div class="stat-lab">إجمالي المدين (فواتير)</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.credit, 'SAR', { size: 16 })}</div><div class="stat-lab">إجمالي الدائن (مسدد)</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num" style="color:${balColor}">${amount(t.closing_balance, 'SAR', { size: 16 })}</div><div class="stat-lab">الرصيد الختامي</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.open_invoices_remaining, 'SAR', { size: 16 })}</div><div class="stat-lab">${num(t.open_invoices_count)} فاتورة غير مسددة</div></div></div>
      </div>

      <div class="card pad0 mt">
        <div class="card-head"><h3>الحركات</h3><div class="spacer"></div>
          <span class="tiny muted">${num(d.entries.length)} حركة — صدر ${dateTimeAr(d.generated_at)}</span></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th style="width:30px">#</th><th>التاريخ</th><th>النوع</th><th>المستند</th>
              <th>الشركة</th><th>البيان</th>
              <th class="text-end">مدين <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
              <th class="text-end">دائن <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
              <th class="text-end">الرصيد <span class="cur-sym">${sarSvg({ size: 11 })}</span></th></tr></thead>
            <tbody>
              <tr class="row-open">
                <td colspan="6"><b>الرصيد الافتتاحي ${d.period.from ? `في ${dateAr(d.period.from)}` : ''}</b></td>
                <td colspan="2"></td><td class="text-end num"><b>${amount(d.opening_balance_period)}</b></td>
              </tr>
              ${raw(d.entries.map((e, i) => `<tr>
                <td class="tiny">${i + 1}</td>
                <td class="tiny nowrap">${esc(dateAr(e.transaction_date))}</td>
                <td><span class="badge ${e.doc_type === 'INVOICE' ? 'blue' : e.doc_type === 'RECEIPT' ? 'green' : 'gray'}">${esc(e.doc_type_label)}</span></td>
                <td class="mono tiny">${e.doc_type === 'INVOICE' && e.doc_id
    ? `<a href="#/invoice-view/${esc(e.doc_id)}">${esc(e.doc_number || '')}</a>` : esc(e.doc_number || '—')}</td>
                <td class="tiny">${esc(e.issuer_name)}</td>
                <td class="tiny">${esc(e.description || '')}</td>
                <td class="text-end num">${e.debit ? amount(e.debit) : ''}</td>
                <td class="text-end num">${e.credit ? amount(e.credit) : ''}</td>
                <td class="text-end num"><b>${amount(e.balance_after)}</b></td>
              </tr>`).join(''))}
              ${raw(d.entries.length ? '' : '<tr><td colspan="9" class="text-center muted" style="padding:2rem">لا توجد حركات في هذه الفترة</td></tr>')}
            </tbody>
            <tfoot><tr>
              <td colspan="6" class="text-end"><b>الإجماليات</b></td>
              <td class="text-end num"><b>${amount(t.debit)}</b></td>
              <td class="text-end num"><b>${amount(t.credit)}</b></td>
              <td class="text-end num" style="color:${balColor}"><b>${amount(t.closing_balance)}</b></td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;

    const reload = async () => { await load(); draw(); };
    $('#client_id', view).addEventListener('change', async (e) => {
      state.client_id = e.target.value;
      // تحديث العنوان بدون إعادة تحميل المسار (لتفادي رسم مزدوج)
      history.replaceState(null, '', `#/statement/${state.client_id}`);
      await reload();
    });
    ['issuer_id', 'from', 'to'].forEach((id) => {
      $(`#${id}`, view).addEventListener('change', async (e) => { state[id] = e.target.value; await reload(); });
    });
    delegate(view, 'click', '[data-quick]', async (e, btn) => {
      const k = btn.dataset.quick;
      if (k === 'month') { state.from = monthStart(); state.to = today(); }
      else if (k === 'year') { state.from = `${new Date().getFullYear()}-01-01`; state.to = today(); }
      else { state.from = ''; state.to = ''; }
      await reload();
    });

    $('#btn-pdf', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const issuer = state.issuer_id ? await api.get(`/api/issuers/${state.issuer_id}`) : null;
        const docHtml = statementPrint({
          statement: d,
          issuer: issuer ? { ...issuer, name_ar: issuer.name_ar } : null,
          client: d.client,
        });
        await downloadPdfFromHtml(docHtml, `${fileName}.pdf`);
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        e.target.disabled = false;
      }
    });

    $('#print', view).addEventListener('click', async () => {
      const issuer = state.issuer_id ? await api.get(`/api/issuers/${state.issuer_id}`) : null;
      printDoc(statementPrint({
        statement: d,
        issuer: issuer ? { ...issuer, name_ar: issuer.name_ar } : null,
        client: d.client,
      }));
    });

    const headers = ['#', 'التاريخ', 'النوع', 'المستند', 'الشركة', 'البيان', 'مدين', 'دائن', 'الرصيد'];
    const rows = () => [
      ['', d.period.from || '', 'رصيد افتتاحي', '', '', 'الرصيد الافتتاحي', '', '', d.opening_balance_period],
      ...d.entries.map((e, i) => [i + 1, e.transaction_date, e.doc_type_label, e.doc_number, e.issuer_name,
        e.description, e.debit || '', e.credit || '', e.balance_after]),
    ];
    const fileName = `كشف-حساب-${d.client.code}`;
    $('#exp-csv', view).addEventListener('click', () => exportCsv(fileName, headers, rows()));
    $('#exp-xls', view).addEventListener('click', () => exportExcel(fileName, `كشف حساب ${d.client.name}`, headers, rows(),
      { footer: ['', '', '', '', '', 'الإجماليات', t.debit, t.credit, t.closing_balance] }));

    const payBtn = $('#pay', view);
    if (payBtn) {
      payBtn.addEventListener('click', async () => {
        const { voucherWizard } = await import('./vouchers.js?v=' + Date.now());
        voucherWizard({
          clientId: state.client_id,
          issuerId: state.issuer_id || store.activeIssuerId,
          onDone: async () => { toastOk('تم تحديث كشف الحساب'); await reload(); },
        });
      });
    }
  };

  await load();
  draw();
  return undefined;
}
