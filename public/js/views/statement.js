// ==========================================================================
//  كشف حساب العميل: موحّد لكل الشركات أو مفلتر لشركة، بطباعة وتصدير.
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, can, currencyLabel } from '../core/store.js';
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, monthStart, today, toastOk, toastErr,
  $, delegate, exportCsv, exportExcel, printDoc, icon, downloadPdfFromHtml, clientPdfFilename,
  amount, sarSvg, loadStoredTemplate, fillStoredTemplate,
} from '../core/util.js';

async function renderStatementFromStoredTemplate(statement, issuer, client) {
  let settings = issuer?.print_settings || {};
  if (typeof settings === 'string') { try { settings = JSON.parse(settings); } catch { settings = {}; } }
  const template = await loadStoredTemplate('statements', settings.statement_template_style || '');
  const opening = Number(statement.opening_balance_period || 0);
  const statementDate = (value) => String(value || '').slice(0, 10).replace(/-/g, '/');
  const openingRow = `<tr class="opening-row"><td></td><td></td><td>${esc(statementDate(statement.period?.from))}</td><td></td><td>الرصيد قبل</td><td>${esc(money(0))}</td><td>${esc(money(0))}</td><td>${esc(money(Math.max(0, opening)))}</td><td>${esc(money(Math.max(0, -opening)))}</td></tr>`;
  const rows = openingRow + (statement.entries || []).map((entry, index) => `<tr>
    <td>${index + 1}</td><td>${esc(entry.doc_number || '')}</td><td>${esc(statementDate(entry.transaction_date))}</td><td>${esc(entry.doc_type_label || entry.doc_type || '')}</td>
    <td>${esc(entry.description || '')}</td><td>${esc(money(entry.debit || 0))}</td>
    <td>${esc(money(entry.credit || 0))}</td>
    <td>${esc(money(Math.max(0, entry.balance_after || 0)))}</td><td>${esc(money(Math.max(0, -(entry.balance_after || 0))))}</td></tr>`).join('');
  const logo = issuer?.logo_data
    ? `<img src="${esc(issuer.logo_data)}" alt="شعار المنشأة" class="issuer-logo">`
    : `<div class="logo-placeholder">${esc(issuer?.name_ar || '')}</div>`;
  const issuerAddress = [issuer?.city, issuer?.district, issuer?.street, issuer?.building_no, issuer?.postal_code].filter(Boolean).join(' - ');
  const issuerAddressEn = issuer?.address_en || [issuer?.city_en, issuer?.district_en, issuer?.street_en, issuer?.building_no, issuer?.postal_code].filter(Boolean).join(' - ');
  return fillStoredTemplate(template, {
    issuer_name: issuer?.name_ar || '', client_name: client?.name || '',
    issuer_name_en: issuer?.name_en || '', issuer_tax: issuer?.tax_number || '',
    issuer_cr: issuer?.commercial_register || '', issuer_phone: issuer?.phone || '',
    issuer_email: issuer?.email || '', issuer_address: issuerAddress, issuer_address_en: issuerAddressEn,
    issuer_city_country: [issuer?.city, issuer?.country].filter(Boolean).join(' - '),
    logo_html: logo, currency_name: issuer?.currency === 'SAR' ? 'ريال سعودي' : (issuer?.currency || 'ريال سعودي'),
    client_code: client?.client_code || client?.code || '',
    period_from: statementDate(statement.period?.from), period_to: statementDate(statement.period?.to),
    opening_balance: money(statement.opening_balance_period || 0),
    total_debit: money(statement.totals?.debit || 0), total_credit: money(statement.totals?.credit || 0),
    closing_balance: money(statement.totals?.closing_balance || 0), rows_html: rows,
  }, ['rows_html', 'logo_html']);
}

export async function render(view, ctx) {
  await loadClients();
  const q0 = (ctx && ctx.query) || {};
  const state = {
    client_id: (ctx.params && ctx.params[0]) || q0.client_id || (store.clients[0] && store.clients[0].id) || '',
    issuer_id: q0.issuer_id !== undefined ? q0.issuer_id : (store.activeIssuerId || ''),
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
    state.q = state.q || '';
    const d = state.data;
    const t = d.totals;
    const balColor = t.closing_balance > 0 ? 'var(--danger)' : t.closing_balance < 0 ? 'var(--success)' : 'inherit';

    const getFilteredEntries = () => {
      const q = (state.q || '').trim().toLowerCase();
      if (!q) return d.entries;
      return d.entries.filter((e) => {
        const numVal = (e.doc_number || '').toLowerCase();
        const descVal = (e.description || '').toLowerCase();
        const issVal = (e.issuer_name || '').toLowerCase();
        const typeVal = (e.doc_type_label || '').toLowerCase();
        const dtVal = (dateAr(e.transaction_date) || '').toLowerCase();
        return numVal.includes(q) || descVal.includes(q) || issVal.includes(q) || typeVal.includes(q) || dtVal.includes(q);
      });
    };

    const rowsHtml = (entries) => {
      const isFiltered = Boolean((state.q || '').trim());
      const showOpening = !isFiltered || 'الرصيد قبل'.includes((state.q || '').trim().toLowerCase()) || 'رصيد افتتاحي'.includes((state.q || '').trim().toLowerCase());
      let res = '';
      if (showOpening) {
        res += `
          <tr class="row-open">
            <td class="text-center tiny muted">1</td>
            <td class="text-center tiny muted">—</td>
            <td class="text-center tiny nowrap" style="white-space:nowrap">${d.period.from ? esc(dateAr(d.period.from)) : '—'}</td>
            <td class="text-center nowrap"><span class="badge gray">—</span></td>
            <td><b>الرصيد قبل</b></td>
            <td class="text-end num nowrap">0.00</td>
            <td class="text-end num nowrap">0.00</td>
            <td class="text-end num nowrap"><b>${d.opening_balance_period > 0 ? amount(d.opening_balance_period) : '0.00'}</b></td>
            <td class="text-end num nowrap"><b>${d.opening_balance_period < 0 ? amount(Math.abs(d.opening_balance_period)) : '0.00'}</b></td>
          </tr>`;
      }
      if (entries.length) {
        res += entries.map((e, i) => `<tr>
          <td class="tiny text-center muted">${i + 2}</td>
          <td class="mono tiny nowrap" style="white-space:nowrap;font-weight:700">
            ${e.doc_type === 'INVOICE' && e.doc_id
    ? `<a class="invoice-no-link" href="#/invoice-view/${esc(e.doc_id)}" title="عرض الفاتورة">${esc(e.doc_number || '')}</a>`
    : e.doc_type === 'RECEIPT' && e.doc_id
      ? `<a class="invoice-no-link" href="#/vouchers?q=${encodeURIComponent(e.doc_number || '')}" title="عرض السند">${esc(e.doc_number || '')}</a>`
      : esc(e.doc_number || '—')}
          </td>
          <td class="tiny nowrap text-center" style="white-space:nowrap">${esc(dateAr(e.transaction_date))}</td>
          <td class="text-center nowrap"><span class="badge ${e.doc_type === 'INVOICE' ? 'blue' : e.doc_type === 'RECEIPT' ? 'green' : 'gray'}">${esc(e.doc_type_label || (e.doc_type === 'INVOICE' ? 'فاتورة بيع' : e.doc_type === 'RECEIPT' ? 'سند قبض' : e.doc_type))}</span></td>
          <td class="cell-desc"><div style="line-height:1.4;word-break:normal">${esc(e.description || '—')}</div></td>
          <td class="text-end num nowrap" ${e.debit ? '' : 'style="color:var(--muted)"'}>${e.debit ? amount(e.debit) : '0.00'}</td>
          <td class="text-end num nowrap" ${e.credit ? '' : 'style="color:var(--muted)"'}>${e.credit ? amount(e.credit) : '0.00'}</td>
          <td class="text-end num nowrap" ${e.balance_after > 0 ? 'style="font-weight:700;color:var(--danger)"' : 'style="color:var(--muted)"'}>${e.balance_after > 0 ? amount(e.balance_after) : '0.00'}</td>
          <td class="text-end num nowrap" ${e.balance_after < 0 ? 'style="font-weight:700;color:var(--success)"' : 'style="color:var(--muted)"'}>${e.balance_after < 0 ? amount(Math.abs(e.balance_after)) : '0.00'}</td>
        </tr>`).join('');
      } else if (isFiltered) {
        res += `<tr><td colspan="9" class="text-center muted" style="padding:2rem">لا توجد حركات مطابقة لبحثك «${esc(state.q)}»</td></tr>`;
      } else {
        res += '<tr><td colspan="9" class="text-center muted" style="padding:2rem">لا توجد حركات في هذه الفترة</td></tr>';
      }
      return res;
    };

    const initialEntries = getFilteredEntries();

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

      <div class="card" style="margin-bottom:1rem;padding:0.9rem 1.2rem;">
        <div style="display:flex;flex-wrap:wrap;gap:1.8rem;align-items:center;">
          <div><span class="muted tiny" style="display:block">رقم الحساب</span><strong class="mono" style="font-size:1.05rem">${esc(d.client.code || d.client.client_code || '—')}</strong></div>
          <div style="border-right:1px solid var(--line);padding-right:1.8rem"><div><span class="muted tiny" style="display:block">اسم الحساب</span><strong style="font-size:1.05rem">${esc(d.client.name)}</strong></div></div>
          <div style="border-right:1px solid var(--line);padding-right:1.8rem"><div><span class="muted tiny" style="display:block">العملة</span><strong>ريال سعودي (SAR)</strong></div></div>
          <div style="border-right:1px solid var(--line);padding-right:1.8rem"><div><span class="muted tiny" style="display:block">الفترة</span><span class="muted">${d.period.from ? esc(dateAr(d.period.from)) : 'البداية'} — ${d.period.to ? esc(dateAr(d.period.to)) : 'الآن'}</span></div></div>
        </div>
      </div>

      <div class="card">
        <div class="filter-row">
          <div class="field flex-2"><label>العميل</label>
            <select id="client_id">
              ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
            </select></div>
          <div class="field flex-2"><label>الشركة / المنشأة</label>
            <select id="issuer_id">
              <option value="">كل الشركات (موحّد)</option>
              ${raw(store.issuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}${i.name_en ? ` — ${esc(i.name_en)}` : ''}</option>`).join(''))}
            </select></div>
          <div class="field field-date"><label>من تاريخ</label><input type="date" id="from" value="${state.from}" /></div>
          <div class="field field-date"><label>إلى تاريخ</label><input type="date" id="to" value="${state.to}" /></div>
          <div class="filter-actions-col">
            <div class="filter-btn-group">
              <button class="btn btn-sm" data-quick="month" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذا الشهر</button>
              <button class="btn btn-sm" data-quick="year" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذه السنة</button>
              <button class="btn btn-sm" data-quick="all" type="button">كل الحركات</button>
            </div>
          </div>
        </div>
        <div class="filter-row" style="margin-top:.75rem">
          <div class="field flex-2" style="margin-bottom:0">
            <label for="statement-q">بحث سريع في الحركات</label>
            <input type="search" id="statement-q" value="${esc(state.q)}" placeholder="ابحث برقم المستند، رقم الفاتورة، السند، البيان، اسم الشركة، التاريخ…" autocomplete="off" />
          </div>
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
        <div class="card-head" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">الحركات</h3>
          <div class="spacer"></div>
          <span class="tiny muted" id="statement-count">
            ${state.q ? `<span class="badge blue tiny" style="margin-left:6px">${num(initialEntries.length)} مطابقة</span> من أصل ` : ''}${num(d.entries.length)} حركة — صدر ${dateTimeAr(d.generated_at)}
          </span>
        </div>
        <div class="table-wrap">
          <table class="tbl statement-tbl">
            <thead>
              <tr>
                <th rowspan="2" style="width:28px" class="text-center nowrap">#</th>
                <th rowspan="2" class="nowrap text-center" style="width:115px">رقم المستند / قيد</th>
                <th rowspan="2" class="nowrap text-center" style="width:95px">التاريخ</th>
                <th rowspan="2" class="text-center nowrap" style="width:85px">النوع</th>
                <th rowspan="2" style="min-width:160px">البيان</th>
                <th colspan="2" class="text-center nowrap" style="border-bottom:1px solid var(--border)">الحركة</th>
                <th colspan="2" class="text-center nowrap" style="border-bottom:1px solid var(--border)">الرصيد</th>
              </tr>
              <tr>
                <th class="text-end nowrap" style="width:90px">مدين <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
                <th class="text-end nowrap" style="width:90px">دائن <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
                <th class="text-end nowrap" style="width:90px">مدين</th>
                <th class="text-end nowrap" style="width:90px">دائن</th>
              </tr>
            </thead>
            <tbody id="statement-rows">
              ${raw(rowsHtml(initialEntries))}
            </tbody>
            <tfoot><tr>
              <td colspan="5" class="text-center"><b>الإجمالي</b></td>
              <td class="text-end num nowrap"><b>${amount(t.debit)}</b></td>
              <td class="text-end num nowrap"><b>${amount(t.credit)}</b></td>
              <td class="text-end num nowrap" style="color:${balColor}"><b>${amount(Math.max(0, t.closing_balance))}</b></td>
              <td class="text-end num nowrap" style="color:${balColor}"><b>${amount(Math.max(0, -t.closing_balance))}</b></td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;

    const qInput = $('#statement-q', view);
    if (qInput) {
      qInput.addEventListener('input', (e) => {
        state.q = e.target.value;
        const filtered = getFilteredEntries();
        const tbody = $('#statement-rows', view);
        if (tbody) tbody.innerHTML = rowsHtml(filtered);
        const countEl = $('#statement-count', view);
        if (countEl) {
          if (state.q.trim()) {
            countEl.innerHTML = `<span class="badge blue tiny" style="margin-left:6px">${num(filtered.length)} مطابقة</span> من أصل ${num(d.entries.length)} حركة — صدر ${dateTimeAr(d.generated_at)}`;
          } else {
            countEl.textContent = `${num(d.entries.length)} حركة — صدر ${dateTimeAr(d.generated_at)}`;
          }
        }
      });
    }

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

    const getIssuerForDoc = async () => {
      const targetId = state.issuer_id || store.activeIssuerId || (store.issuers && store.issuers[0] && store.issuers[0].id);
      if (targetId) {
        try {
          const fresh = await api.get(`/api/issuers/${targetId}`);
          if (fresh) return fresh;
        } catch (_) {}
        const cached = store.issuers?.find((i) => i.id === targetId);
        if (cached) return cached;
      }
      return store.activeIssuer || (store.issuers && store.issuers[0]) || null;
    };

    $('#btn-pdf', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const issuer = await getIssuerForDoc();
        const docHtml = await renderStatementFromStoredTemplate(d, issuer, d.client);
        await downloadPdfFromHtml(docHtml, clientPdfFilename('كشف حساب', d.client.name, d.client.code || ''));
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        e.target.disabled = false;
      }
    });

    $('#print', view).addEventListener('click', async () => {
      const issuer = await getIssuerForDoc();
      try { printDoc(await renderStatementFromStoredTemplate(d, issuer, d.client), { flowing: true }); }
      catch (err) { toastErr(err.message || 'تعذر تحميل قالب كشف الحساب'); }
    });

    const headers = ['#', 'رقم المستند / قيد', 'التاريخ', 'النوع', 'البيان', 'حركة مدين', 'حركة دائن', 'رصيد مدين', 'رصيد دائن'];
    const rows = () => {
      const currentEntries = getFilteredEntries();
      return [
        ['1', '—', d.period.from || '', '—', 'الرصيد قبل', '0.00', '0.00', d.opening_balance_period > 0 ? d.opening_balance_period : '0.00', d.opening_balance_period < 0 ? -d.opening_balance_period : '0.00'],
        ...currentEntries.map((e, i) => [
          i + 2,
          e.doc_number || '',
          e.transaction_date,
          e.doc_type_label || (e.doc_type === 'INVOICE' ? 'فاتورة بيع' : e.doc_type === 'RECEIPT' ? 'سند قبض' : e.doc_type),
          e.description,
          e.debit ? e.debit : '0.00',
          e.credit ? e.credit : '0.00',
          e.balance_after > 0 ? e.balance_after : '0.00',
          e.balance_after < 0 ? -e.balance_after : '0.00',
        ]),
      ];
    };
    const fileName = `كشف-حساب-${d.client.code || 'client'}`;
    $('#exp-csv', view).addEventListener('click', () => exportCsv(fileName, headers, rows()));
    $('#exp-xls', view).addEventListener('click', () => exportExcel(fileName, `كشف حساب ${d.client.name}`, headers, rows(),
      { footer: ['', '', '', '', 'الإجمالي', t.debit, t.credit, Math.max(0, t.closing_balance), Math.max(0, -t.closing_balance)] }));

    const payBtn = $('#pay', view);
    if (payBtn) {
      payBtn.addEventListener('click', async () => {
        const { voucherWizard } = await import('./vouchers.js');
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
