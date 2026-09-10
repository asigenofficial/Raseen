// ==========================================================================
//  التقارير: المبيعات، الضريبة، أعمار الذمم، الأرصدة، دفعات التوليد.
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, currencyLabel } from '../core/store.js';
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, monthStart, today,
  $, delegate, exportCsv, exportExcel, printDoc, icon,
} from '../core/util.js';

const TABS = [
  ['sales', 'المبيعات'],
  ['vat', 'إقرار الضريبة'],
  ['aging', 'أعمار الذمم'],
  ['balances', 'أرصدة العملاء'],
  ['batches', 'دفعات التوليد'],
];

const GROUPS = [
  ['month', 'شهرياً'], ['day', 'يومياً'], ['client', 'حسب العميل'],
  ['issuer', 'حسب الشركة'], ['item', 'حسب الصنف'], ['category', 'حسب المجموعة'],
];

function printTable(title, subtitle, headers, rows, footer) {
  printDoc(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>@page{size:A4;margin:10mm}body{font-family:Tahoma,Arial;margin:0}
    h2{text-align:center;margin:0 0 2mm}p.sub{text-align:center;color:#475569;font-size:9pt;margin:0 0 4mm}
    table{width:100%;border-collapse:collapse;font-size:9pt}
    th{background:#0d9488;color:#fff;border:1px solid #0f766e;padding:2mm 1mm}
    td{border:1px solid #cbd5e1;padding:1.4mm 1mm}
    tfoot td{background:#f1f5f9;font-weight:700}
    .e{text-align:end}</style></head><body>
    <h2>${esc(title)}</h2><p class="sub">${esc(subtitle)}</p>
    <table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i > 0 ? 'e' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${footer ? `<tfoot><tr>${footer.map((c, i) => `<td class="${i > 0 ? 'e' : ''}">${esc(c)}</td>`).join('')}</tfoot>` : ''}
    </table></body></html>`);
}

export async function render(view, ctx) {
  await loadClients();
  const cur = currencyLabel();
  const state = {
    tab: (ctx.params && ctx.params[0]) || 'sales',
    issuer_id: store.activeIssuerId,
    client_id: '',
    from: monthStart(),
    to: today(),
    group_by: 'month',
    as_of: today(),
    only_debtors: false,
    data: null,
  };

  const load = async () => {
    const base = { issuer_id: state.issuer_id, from: state.from, to: state.to };
    if (state.tab === 'sales') state.data = await api.get(qs('/api/reports/sales', { ...base, client_id: state.client_id, group_by: state.group_by }));
    else if (state.tab === 'vat') state.data = await api.get(qs('/api/reports/vat', base));
    else if (state.tab === 'aging') state.data = await api.get(qs('/api/reports/aging', { issuer_id: state.issuer_id, as_of: state.as_of }));
    else if (state.tab === 'balances') state.data = await api.get(qs('/api/ledger/balances', { issuer_id: state.issuer_id, only_debtors: state.only_debtors ? 1 : '' }));
    else state.data = await api.get(qs('/api/bulk/batches', { issuer_id: state.issuer_id, limit: 100 }));
  };

  const periodLabel = () => `${state.from ? dateAr(state.from) : 'البداية'} — ${state.to ? dateAr(state.to) : 'الآن'}`;
  const issuerLabel = () => {
    const i = store.issuers.find((x) => x.id === state.issuer_id);
    return i ? i.name_ar : 'كل الشركات';
  };

  // ------------------------------------------------------------- الأقسام
  const salesBody = () => {
    const d = state.data;
    const max = Math.max(1, ...d.items.map((i) => i.total));
    return `
      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(d.totals.count)}</div><div class="stat-lab">عدد الفواتير</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.total)}</div><div class="stat-lab">إجمالي المبيعات</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.tax)}</div><div class="stat-lab">الضريبة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.discount)}</div><div class="stat-lab">الخصومات</div></div></div>
      </div>
      <div class="card pad0 mt">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>${esc(GROUPS.find((g) => g[0] === state.group_by)[1])}</th><th class="text-end">عدد الفواتير</th>
            ${d.items.some((i) => i.quantity !== undefined) ? '<th class="text-end">الكمية</th>' : ''}
            <th class="text-end">قبل الضريبة</th><th class="text-end">الخصم</th><th class="text-end">الضريبة</th>
            <th class="text-end">الإجمالي</th><th style="width:130px">النسبة</th></tr></thead>
          <tbody>${d.items.length ? d.items.map((r) => `<tr>
            <td><b>${esc(r.label)}</b></td>
            <td class="text-end num">${num(r.count)}</td>
            ${r.quantity !== undefined ? `<td class="text-end num">${num(r.quantity)}</td>` : ''}
            <td class="text-end num">${money(r.subtotal)}</td>
            <td class="text-end num">${money(r.discount)}</td>
            <td class="text-end num">${money(r.tax)}</td>
            <td class="text-end num"><b>${money(r.total)}</b></td>
            <td><div class="mini-bar"><span style="width:${Math.round((r.total / max) * 100)}%"></span></div></td>
          </tr>`).join('') : '<tr><td colspan="8" class="text-center muted" style="padding:2rem">لا توجد بيانات في هذه الفترة</td></tr>'}</tbody>
          <tfoot><tr><td>الإجمالي</td><td class="text-end num">${num(d.totals.count)}</td>
            ${d.items.some((i) => i.quantity !== undefined) ? '<td></td>' : ''}
            <td class="text-end num">${money(d.totals.subtotal)}</td><td class="text-end num">${money(d.totals.discount)}</td>
            <td class="text-end num">${money(d.totals.tax)}</td><td class="text-end num">${money(d.totals.total)}</td><td></td></tr></tfoot>
        </table></div>
      </div>`;
  };

  const vatBody = () => {
    const d = state.data;
    return `
      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(d.totals.invoices)}</div><div class="stat-lab">عدد الفواتير</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.taxable)}</div><div class="stat-lab">الوعاء الخاضع للضريبة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.tax)}</div><div class="stat-lab">ضريبة المخرجات المستحقة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.total)}</div><div class="stat-lab">الإجمالي بالضريبة</div></div></div>
      </div>
      <div class="card pad0 mt">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>الشركة المصدرة</th><th>الرقم الضريبي</th><th class="text-end">عدد الفواتير</th>
            <th class="text-end">الوعاء الخاضع</th><th class="text-end">الضريبة</th><th class="text-end">الإجمالي</th></tr></thead>
          <tbody>${d.items.length ? d.items.map((r) => `<tr>
            <td><b>${esc(r.issuer_name)}</b></td><td class="mono tiny">${esc(r.tax_number || '—')}</td>
            <td class="text-end num">${num(r.invoices)}</td><td class="text-end num">${money(r.taxable)}</td>
            <td class="text-end num"><b>${money(r.tax)}</b></td><td class="text-end num">${money(r.total)}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="text-center muted" style="padding:2rem">لا توجد فواتير في هذه الفترة</td></tr>'}</tbody>
          <tfoot><tr><td colspan="2">الإجمالي</td><td class="text-end num">${num(d.totals.invoices)}</td>
            <td class="text-end num">${money(d.totals.taxable)}</td><td class="text-end num">${money(d.totals.tax)}</td>
            <td class="text-end num">${money(d.totals.total)}</td></tr></tfoot>
        </table></div>
      </div>
      <div class="alert alert-info tiny">هذا التقرير يعرض ضريبة المخرجات من الفواتير غير الملغاة فقط، مجمّعة لكل شركة مصدرة بشكل مستقل — وهو الأساس لإعداد إقرار كل منشأة على حدة.</div>`;
  };

  const agingBody = () => {
    const d = state.data;
    return `
      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.b0_30)}</div><div class="stat-lab">1 — 30 يوم</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.b31_60)}</div><div class="stat-lab">31 — 60 يوم</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.b61_90)}</div><div class="stat-lab">61 — 90 يوم</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.b90_plus)}</div><div class="stat-lab">أكثر من 90 يوم</div></div></div>
      </div>
      <div class="card pad0 mt">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>العميل</th><th>الكود</th><th class="text-end">1-30</th><th class="text-end">31-60</th>
            <th class="text-end">61-90</th><th class="text-end">+90</th><th class="text-end">الإجمالي المستحق</th><th></th></tr></thead>
          <tbody>${d.items.length ? d.items.map((r) => `<tr>
            <td><b>${esc(r.name)}</b></td><td class="mono tiny">${esc(r.code)}</td>
            <td class="text-end num">${r.b0_30 ? money(r.b0_30) : '—'}</td>
            <td class="text-end num">${r.b31_60 ? money(r.b31_60) : '—'}</td>
            <td class="text-end num">${r.b61_90 ? money(r.b61_90) : '—'}</td>
            <td class="text-end num" style="color:var(--danger)">${r.b90_plus ? money(r.b90_plus) : '—'}</td>
            <td class="text-end num"><b>${money(r.total)}</b></td>
            <td class="actions"><a class="btn btn-sm" href="#/statement/${esc(r.client_id)}">كشف</a></td>
          </tr>`).join('') : '<tr><td colspan="8" class="text-center muted" style="padding:2rem">لا توجد مبالغ مستحقة</td></tr>'}</tbody>
          <tfoot><tr><td colspan="2">الإجمالي</td><td class="text-end num">${money(d.totals.b0_30)}</td>
            <td class="text-end num">${money(d.totals.b31_60)}</td><td class="text-end num">${money(d.totals.b61_90)}</td>
            <td class="text-end num">${money(d.totals.b90_plus)}</td><td class="text-end num">${money(d.totals.total)}</td><td></td></tr></tfoot>
        </table></div>
      </div>`;
  };

  const balancesBody = () => {
    const d = state.data;
    return `
      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.debit)}</div><div class="stat-lab">إجمالي المدين</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.credit)}</div><div class="stat-lab">إجمالي الدائن</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(d.totals.balance)}</div><div class="stat-lab">صافي الأرصدة (${esc(cur)})</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(d.items.length)}</div><div class="stat-lab">عميل معروض</div></div></div>
      </div>
      <div class="card pad0 mt">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>العميل</th><th>الكود</th><th>الجوال</th><th class="text-end">مدين</th>
            <th class="text-end">دائن</th><th class="text-end">الرصيد</th><th class="text-end">حد الائتمان</th><th></th></tr></thead>
          <tbody>${d.items.map((r) => `<tr class="${r.over_limit ? 'row-warn' : ''}">
            <td><b>${esc(r.name)}</b>${r.over_limit ? ' <span class="badge red tiny">تجاوز حد الائتمان</span>' : ''}</td>
            <td class="mono tiny">${esc(r.client_code)}</td><td class="mono tiny">${esc(r.phone || '—')}</td>
            <td class="text-end num">${money(r.debit)}</td><td class="text-end num">${money(r.credit)}</td>
            <td class="text-end num" style="color:${r.balance > 0 ? 'var(--danger)' : r.balance < 0 ? 'var(--success)' : 'inherit'}"><b>${money(r.balance)}</b></td>
            <td class="text-end num tiny">${r.credit_limit ? money(r.credit_limit) : '—'}</td>
            <td class="actions"><a class="btn btn-sm" href="#/statement/${esc(r.client_id)}">كشف</a></td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">الإجمالي</td><td class="text-end num">${money(d.totals.debit)}</td>
            <td class="text-end num">${money(d.totals.credit)}</td><td class="text-end num">${money(d.totals.balance)}</td>
            <td colspan="2"></td></tr></tfoot>
        </table></div>
      </div>`;
  };

  const batchesBody = () => {
    const items = state.data.items || state.data;
    return `<div class="card pad0">
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>التاريخ</th><th>الشركة</th><th>العميل</th><th class="text-end">عدد الفواتير</th>
          <th class="text-end">الإجمالي</th><th>المستخدم</th><th>معايير التوليد</th><th></th></tr></thead>
        <tbody>${items.length ? items.map((b) => `<tr>
          <td class="tiny nowrap">${esc(dateTimeAr(b.created_at))}</td>
          <td class="tiny">${esc(b.issuer_name || '')}</td>
          <td>${esc(b.client_name || '')}</td>
          <td class="text-end num">${num(b.invoice_count)}</td>
          <td class="text-end num"><b>${money(b.total_amount)}</b></td>
          <td class="tiny">${esc(b.created_by)}</td>
          <td class="tiny muted">${esc(batchParams(b))}</td>
          <td class="actions"><a class="btn btn-sm" href="#/invoices?batch_id=${esc(b.id)}">عرض الفواتير</a></td>
        </tr>`).join('') : '<tr><td colspan="8" class="text-center muted" style="padding:2rem">لا توجد دفعات توليد محفوظة</td></tr>'}</tbody>
      </table></div>
    </div>`;
  };

  const batchParams = (b) => {
    const p = b.params || {};
    const bits = [];
    if (p.date_from) bits.push(`${p.date_from} → ${p.date_to}`);
    if (p.target_total) bits.push(`ميزانية ${money(p.target_total)}`);
    if (p.seed) bits.push(`seed ${p.seed}`);
    return bits.join(' — ');
  };

  // -------------------------------------------------------- التصدير
  const exportSpec = () => {
    const d = state.data;
    if (state.tab === 'sales') {
      const withQty = d.items.some((i) => i.quantity !== undefined);
      return {
        name: `تقرير-المبيعات-${state.group_by}`,
        title: `تقرير المبيعات — ${GROUPS.find((g) => g[0] === state.group_by)[1]}`,
        headers: ['البيان', 'عدد الفواتير', ...(withQty ? ['الكمية'] : []), 'قبل الضريبة', 'الخصم', 'الضريبة', 'الإجمالي'],
        rows: d.items.map((r) => [r.label, r.count, ...(withQty ? [r.quantity] : []), r.subtotal, r.discount, r.tax, r.total]),
        footer: ['الإجمالي', d.totals.count, ...(withQty ? [''] : []), d.totals.subtotal, d.totals.discount, d.totals.tax, d.totals.total],
      };
    }
    if (state.tab === 'vat') {
      return {
        name: 'إقرار-الضريبة',
        title: 'تقرير ضريبة القيمة المضافة',
        headers: ['الشركة', 'الرقم الضريبي', 'عدد الفواتير', 'الوعاء الخاضع', 'الضريبة', 'الإجمالي'],
        rows: d.items.map((r) => [r.issuer_name, r.tax_number, r.invoices, r.taxable, r.tax, r.total]),
        footer: ['الإجمالي', '', d.totals.invoices, d.totals.taxable, d.totals.tax, d.totals.total],
      };
    }
    if (state.tab === 'aging') {
      return {
        name: 'أعمار-الذمم',
        title: `أعمار الذمم حتى ${dateAr(state.as_of)}`,
        headers: ['العميل', 'الكود', '1-30', '31-60', '61-90', '+90', 'الإجمالي'],
        rows: d.items.map((r) => [r.name, r.code, r.b0_30, r.b31_60, r.b61_90, r.b90_plus, r.total]),
        footer: ['الإجمالي', '', d.totals.b0_30, d.totals.b31_60, d.totals.b61_90, d.totals.b90_plus, d.totals.total],
      };
    }
    if (state.tab === 'balances') {
      return {
        name: 'أرصدة-العملاء',
        title: 'أرصدة العملاء',
        headers: ['العميل', 'الكود', 'الجوال', 'مدين', 'دائن', 'الرصيد', 'حد الائتمان'],
        rows: d.items.map((r) => [r.name, r.client_code, r.phone, r.debit, r.credit, r.balance, r.credit_limit]),
        footer: ['الإجمالي', '', '', d.totals.debit, d.totals.credit, d.totals.balance, ''],
      };
    }
    const items = d.items || d;
    return {
      name: 'دفعات-التوليد',
      title: 'دفعات التوليد الدفعي',
      headers: ['التاريخ', 'الشركة', 'العميل', 'عدد الفواتير', 'الإجمالي', 'المستخدم'],
      rows: items.map((b) => [b.created_at, b.issuer_name, b.client_name, b.invoice_count, b.total_amount, b.created_by]),
      footer: null,
    };
  };

  const draw = () => {
    const showPeriod = state.tab === 'sales' || state.tab === 'vat';
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>التقارير</h1>
          <p>${issuerLabel()}${showPeriod ? ` — ${periodLabel()}` : ''}</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="print" type="button">${icon.printer({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}طباعة / PDF</button>
          <button class="btn" id="exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn" id="exp-csv" type="button">${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}CSV</button>
        </div>
      </div>

      <div class="tabs">
        ${raw(TABS.map(([k, label]) => `<a class="tab ${k === state.tab ? 'on' : ''}" href="#/reports/${k}">${esc(label)}</a>`).join(''))}
      </div>

      <div class="card">
        <div class="row">
          <div class="field"><label>الشركة المصدرة</label>
            <select id="issuer_id"><option value="">كل الشركات</option>
              ${raw(store.issuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
            </select></div>
          ${raw(state.tab === 'sales' ? `
            <div class="field"><label>العميل</label>
              <select id="client_id"><option value="">كل العملاء</option>
                ${store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select></div>
            <div class="field" style="max-width:170px"><label>التجميع</label>
              <select id="group_by">${GROUPS.map(([k, l]) => `<option value="${k}" ${k === state.group_by ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>` : '')}
          ${raw(showPeriod ? `
            <div class="field" style="max-width:160px"><label>من تاريخ</label><input type="date" id="from" value="${state.from}" /></div>
            <div class="field" style="max-width:160px"><label>إلى تاريخ</label><input type="date" id="to" value="${state.to}" /></div>` : '')}
          ${raw(state.tab === 'aging' ? `<div class="field" style="max-width:170px"><label>حتى تاريخ</label>
            <input type="date" id="as_of" value="${state.as_of}" /></div>` : '')}
          ${raw(state.tab === 'balances' ? `<div class="field" style="max-width:210px"><label>&nbsp;</label>
            <label class="check"><input type="checkbox" id="only_debtors" ${state.only_debtors ? 'checked' : ''} /> المدينون فقط</label></div>` : '')}
          ${raw(showPeriod ? `<div class="field" style="max-width:240px"><label>&nbsp;</label>
            <div class="flex">
              <button class="btn btn-sm" data-quick="month" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذا الشهر</button>
              <button class="btn btn-sm" data-quick="year" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذه السنة</button>
              <button class="btn btn-sm" data-quick="all" type="button">كل الفترات</button>
            </div></div>` : '')}
        </div>
      </div>

      <div id="report-body">${raw(
    state.tab === 'sales' ? salesBody()
      : state.tab === 'vat' ? vatBody()
        : state.tab === 'aging' ? agingBody()
          : state.tab === 'balances' ? balancesBody()
            : batchesBody(),
  )}</div>`;

    const reload = async () => { await load(); draw(); };
    $('#issuer_id', view).addEventListener('change', async (e) => { state.issuer_id = e.target.value; await reload(); });
    ['client_id', 'group_by', 'from', 'to', 'as_of'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) el.addEventListener('change', async (e) => { state[id] = e.target.value; await reload(); });
    });
    const od = $('#only_debtors', view);
    if (od) od.addEventListener('change', async (e) => { state.only_debtors = e.target.checked; await reload(); });
    delegate(view, 'click', '[data-quick]', async (e, btn) => {
      const k = btn.dataset.quick;
      if (k === 'month') { state.from = monthStart(); state.to = today(); }
      else if (k === 'year') { state.from = `${new Date().getFullYear()}-01-01`; state.to = today(); }
      else { state.from = ''; state.to = ''; }
      await reload();
    });

    const spec = exportSpec();
    $('#exp-csv', view).addEventListener('click', () => exportCsv(spec.name, spec.headers,
      spec.footer ? [...spec.rows, spec.footer] : spec.rows));
    $('#exp-xls', view).addEventListener('click', () => exportExcel(spec.name, spec.title, spec.headers, spec.rows,
      { footer: spec.footer, subtitle: `${issuerLabel()}${showPeriod ? ` — ${periodLabel()}` : ''}` }));
    $('#print', view).addEventListener('click', () => printTable(spec.title,
      `${issuerLabel()}${showPeriod ? ` — ${periodLabel()}` : ''}`,
      spec.headers,
      spec.rows.map((r) => r.map((c, i) => (i > 0 && typeof c === 'number' ? money(c) : c === undefined || c === null ? '' : c))),
      spec.footer && spec.footer.map((c, i) => (i > 0 && typeof c === 'number' ? money(c) : c))));
  };

  await load();
  draw();
  return undefined;
}
