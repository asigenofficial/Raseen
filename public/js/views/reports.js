// ==========================================================================
//  التقارير: المبيعات، الضريبة، أعمار الذمم، الأرصدة، دفعات التوليد.
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, currencyLabel } from '../core/store.js';
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, monthStart, today,
  $, delegate, exportCsv, exportExcel, printDoc, icon, downloadPdfFromHtml, toastErr,
  amount, modal,
} from '../core/util.js';
import { sarSvg } from '../core/icons.js';

const TABS = [
  ['sales', 'المبيعات'],
  ['vat', 'إقرار الضريبة'],
  ['collections', 'التحصيلات'],
  ['profitability', 'الربحية'],
  ['aging', 'أعمار الذمم'],
  ['balances', 'أرصدة العملاء'],
  ['batches', 'دفعات التوليد'],
];

const GROUPS = [
  ['month', 'شهرياً'], ['day', 'يومياً'], ['client', 'حسب العميل'],
  ['issuer', 'حسب الشركة'], ['item', 'حسب الصنف'], ['category', 'حسب المجموعة'],
];

function buildReportHtml({ title, subtitle, headers, rows, footer, issuerName, stats = [] }) {
  const isLandscape = headers.length > 5;
  const pageOrientation = isLandscape ? 'A4 landscape' : 'A4 portrait';
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-SA');
  const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

  const statCardsHtml = stats && stats.length ? `
    <div style="display:flex;gap:12px;margin-bottom:6mm;flex-wrap:wrap;">
      ${stats.map((st) => `
        <div style="flex:1;min-width:130px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:3mm 4mm;text-align:center;">
          <div style="font-size:8pt;color:#64748b;margin-bottom:1mm;">${esc(st.label)}</div>
          <div style="font-size:11pt;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;direction:ltr;display:flex;align-items:center;justify-content:center;gap:4px;">${st.html || esc(st.val)}</div>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>
    @page {
      size: ${pageOrientation};
      margin: 12mm 10mm;
      @bottom-center {
        content: "صفحة " counter(page) " من " counter(pages);
        font-family: "Segoe UI", Tahoma, Arial, sans-serif;
        font-size: 8pt;
        color: #94a3b8;
      }
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: "Segoe UI", Tahoma, "Cairo", Arial, sans-serif;
      color: #0f172a;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-wrap {
      width: 100%;
      margin: 0 auto;
    }
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid #0d9488;
      padding-bottom: 4mm;
      margin-bottom: 5mm;
    }
    .rep-titles h1 {
      margin: 0 0 1.5mm;
      font-size: 16pt;
      color: #0f766e;
      font-weight: 800;
    }
    .rep-titles p {
      margin: 0;
      font-size: 9.5pt;
      color: #475569;
    }
    .rep-meta {
      text-align: left;
      direction: ltr;
      font-size: 8pt;
      color: #64748b;
      line-height: 1.5;
    }
    .rep-meta b { color: #0f172a; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      margin-top: 2mm;
    }
    th {
      background: #0d9488;
      color: #ffffff;
      border: 1px solid #0f766e;
      padding: 2.8mm 2mm;
      font-weight: 700;
      text-align: right;
    }
    th.e { text-align: left; }
    td {
      border: 1px solid #e2e8f0;
      padding: 2mm 2mm;
      color: #1e293b;
    }
    tbody tr:nth-child(even) td {
      background: #f8fafc;
    }
    tfoot td {
      background: #f1f5f9;
      font-weight: 700;
      border-top: 2px solid #0d9488;
      border-bottom: 2px solid #0d9488;
      color: #0f172a;
    }
    .e {
      text-align: left;
      font-variant-numeric: tabular-nums;
      direction: ltr;
    }
    .report-footer {
      margin-top: 8mm;
      padding-top: 3mm;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8pt;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="report-wrap">
    <div class="report-header">
      <div class="rep-titles">
        <h1>${esc(title)}</h1>
        <p>${esc(subtitle)}</p>
      </div>
      <div class="rep-meta">
        <div><b>Raseen Accounting System</b></div>
        <div>تاريخ التقرير: <span>${dateStr} - ${timeStr}</span></div>
        ${issuerName ? `<div>المنشأة: <span style="direction:rtl">${esc(issuerName)}</span></div>` : ''}
      </div>
    </div>

    ${statCardsHtml}

    <table>
      <thead>
        <tr>${headers.map((h, i) => `<th class="${i > 0 ? 'e' : ''}">${esc(h)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map((r) => `
          <tr>${r.map((c, i) => `<td class="${i > 0 ? 'e' : ''}">${esc(c)}</td>`).join('')}</tr>
        `).join('') : `
          <tr><td colspan="${headers.length}" style="text-align:center;padding:6mm;color:#64748b">لا توجد بيانات مسجلة في هذا التقرير</td></tr>
        `}
      </tbody>
      ${footer ? `
        <tfoot>
          <tr>${footer.map((c, i) => `<td class="${i > 0 ? 'e' : ''}">${esc(c)}</td>`).join('')}</tr>
        </tfoot>
      ` : ''}
    </table>

    <div class="report-footer">
      <span>مستند محاسبي رسمي صادر من نظام رصين للفوترة والمحاسبة — تقرير PDF معتمد</span>
      <span style="direction:ltr">A4 Document</span>
    </div>
  </div>
</body>
</html>`;
}

function printTable(title, subtitle, headers, rows, footer, stats = [], issuerName = '') {
  const doc = buildReportHtml({ title, subtitle, headers, rows, footer, stats, issuerName });
  printDoc(doc);
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
    group_by: ((ctx.params && ctx.params[0]) === 'collections' ? 'day' : 'month'),
    as_of: today(),
    only_debtors: false,
    data: null,
  };

  const load = async () => {
    const base = { issuer_id: state.issuer_id, from: state.from, to: state.to };
    if (state.tab === 'sales') state.data = await api.get(qs('/api/reports/sales', { ...base, client_id: state.client_id, group_by: state.group_by }));
    else if (state.tab === 'vat') state.data = await api.get(qs('/api/reports/vat', base));
    else if (state.tab === 'collections') state.data = await api.get(qs('/api/reports/collections', { ...base, client_id: state.client_id, group_by: state.group_by }));
    else if (state.tab === 'profitability') state.data = await api.get(qs('/api/reports/profitability', { ...base, client_id: state.client_id, group_by: state.group_by }));
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
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.total, 'SAR', { size: 16 })}</div><div class="stat-lab">إجمالي المبيعات</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.tax, 'SAR', { size: 16 })}</div><div class="stat-lab">الضريبة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.discount, 'SAR', { size: 16 })}</div><div class="stat-lab">الخصومات</div></div></div>
      </div>
      <div class="card pad0 mt">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>${esc(GROUPS.find((g) => g[0] === state.group_by)[1])}</th><th class="text-end">عدد الفواتير</th>
            ${d.items.some((i) => i.quantity !== undefined) ? '<th class="text-end">الكمية</th>' : ''}
            <th class="text-end">قبل الضريبة <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">الخصم <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">الضريبة <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th style="width:130px">النسبة</th></tr></thead>
          <tbody>${d.items.length ? d.items.map((r) => `<tr>
            <td><b>${esc(r.label)}</b></td>
            <td class="text-end num">${num(r.count)}</td>
            ${r.quantity !== undefined ? `<td class="text-end num">${num(r.quantity)}</td>` : ''}
            <td class="text-end num">${amount(r.subtotal)}</td>
            <td class="text-end num">${amount(r.discount)}</td>
            <td class="text-end num">${amount(r.tax)}</td>
            <td class="text-end num"><b>${amount(r.total)}</b></td>
            <td><div class="mini-bar"><span style="width:${Math.round((r.total / max) * 100)}%"></span></div></td>
          </tr>`).join('') : '<tr><td colspan="8" class="text-center muted" style="padding:2rem">لا توجد بيانات في هذه الفترة</td></tr>'}</tbody>
          <tfoot><tr><td>الإجمالي</td><td class="text-end num">${num(d.totals.count)}</td>
            ${d.items.some((i) => i.quantity !== undefined) ? '<td></td>' : ''}
            <td class="text-end num">${amount(d.totals.subtotal)}</td><td class="text-end num">${amount(d.totals.discount)}</td>
            <td class="text-end num">${amount(d.totals.tax)}</td><td class="text-end num">${amount(d.totals.total)}</td><td></td></tr></tfoot>
        </table></div>
      </div>`;
  };

  const vatBody = () => {
    const d = state.data;
    return `
      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(d.totals.invoices)}</div><div class="stat-lab">عدد الفواتير</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.taxable, 'SAR', { size: 16 })}</div><div class="stat-lab">الوعاء الخاضع للضريبة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.tax, 'SAR', { size: 16 })}</div><div class="stat-lab">ضريبة المخرجات المستحقة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.total, 'SAR', { size: 16 })}</div><div class="stat-lab">الإجمالي بالضريبة</div></div></div>
      </div>
      <div class="card pad0 mt">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>الشركة المصدرة</th><th>الرقم الضريبي</th><th class="text-end">عدد الفواتير</th>
            <th class="text-end">الوعاء الخاضع <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">الضريبة <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th></tr></thead>
          <tbody>${d.items.length ? d.items.map((r) => `<tr>
            <td><b>${esc(r.issuer_name)}</b></td><td class="mono tiny">${esc(r.tax_number || '—')}</td>
            <td class="text-end num">${num(r.invoices)}</td><td class="text-end num">${amount(r.taxable)}</td>
            <td class="text-end num"><b>${amount(r.tax)}</b></td><td class="text-end num">${amount(r.total)}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="text-center muted" style="padding:2rem">لا توجد فواتير في هذه الفترة</td></tr>'}</tbody>
          <tfoot><tr><td colspan="2">الإجمالي</td><td class="text-end num">${num(d.totals.invoices)}</td>
            <td class="text-end num">${amount(d.totals.taxable)}</td><td class="text-end num">${amount(d.totals.tax)}</td>
            <td class="text-end num">${amount(d.totals.total)}</td></tr></tfoot>
        </table></div>
      </div>
      <div class="alert alert-info tiny">هذا التقرير يعرض ضريبة المخرجات من الفواتير غير الملغاة فقط، مجمّعة لكل شركة مصدرة بشكل مستقل — وهو الأساس لإعداد إقرار كل منشأة على حدة.</div>`;
  };

  const collectionsBody = () => {
    const d = state.data;
    return `
      <div class="grid grid-4">
        <div class="stat"><div><div class="stat-val num">${num(d.totals.count)}</div><div class="stat-lab">عدد السندات</div></div></div>
        <div class="stat"><div><div class="stat-val num">${amount(d.totals.amount, 'SAR', { size: 16 })}</div><div class="stat-lab">إجمالي التحصيل</div></div></div>
        <div class="stat"><div><div class="stat-val num">${amount(d.totals.allocated, 'SAR', { size: 16 })}</div><div class="stat-lab">المخصص للفواتير</div></div></div>
        <div class="stat"><div><div class="stat-val num">${amount(d.totals.unallocated, 'SAR', { size: 16 })}</div><div class="stat-lab">غير مخصص</div></div></div>
      </div>
      <div class="card pad0 mt"><div class="table-wrap"><table class="tbl">
        <thead><tr><th>البيان</th><th class="text-end">السندات</th>
          <th class="text-end">المبلغ <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
          <th class="text-end">المخصص <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
          <th class="text-end">غير المخصص <span class="cur-sym">${sarSvg({ size: 11 })}</span></th></tr></thead>
        <tbody>${d.items.length ? d.items.map((r)=>`<tr><td><b>${esc(r.label)}</b></td><td class="text-end num">${num(r.count)}</td><td class="text-end num">${amount(r.amount)}</td><td class="text-end num">${amount(r.allocated)}</td><td class="text-end num">${amount(r.unallocated)}</td></tr>`).join('') : '<tr><td colspan="5" class="text-center muted" style="padding:2rem">لا توجد تحصيلات في الفترة</td></tr>'}</tbody>
        <tfoot><tr><td>الإجمالي</td><td class="text-end num">${num(d.totals.count)}</td><td class="text-end num">${amount(d.totals.amount)}</td><td class="text-end num">${amount(d.totals.allocated)}</td><td class="text-end num">${amount(d.totals.unallocated)}</td></tr></tfoot>
      </table></div></div>`;
  };

  const profitabilityBody = () => {
    const d = state.data;
    return `
      <div class="grid grid-4">
        <div class="stat"><div><div class="stat-val num">${amount(d.totals.revenue, 'SAR', { size: 16 })}</div><div class="stat-lab">صافي المبيعات</div></div></div>
        <div class="stat"><div><div class="stat-val num">${amount(d.totals.cost, 'SAR', { size: 16 })}</div><div class="stat-lab">تكلفة الأصناف</div></div></div>
        <div class="stat"><div><div class="stat-val num">${amount(d.totals.profit, 'SAR', { size: 16 })}</div><div class="stat-lab">الربح الإجمالي</div></div></div>
        <div class="stat"><div><div class="stat-val num">${num(d.totals.margin)}%</div><div class="stat-lab">هامش الربح</div></div></div>
      </div>
      <div class="card pad0 mt"><div class="table-wrap"><table class="tbl">
        <thead><tr><th>البيان</th><th class="text-end">الفواتير</th><th class="text-end">الكمية</th>
          <th class="text-end">المبيعات <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
          <th class="text-end">التكلفة <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
          <th class="text-end">الربح <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th class="text-end">الهامش</th></tr></thead>
        <tbody>${d.items.length ? d.items.map((r)=>`<tr><td><b>${esc(r.label)}</b></td><td class="text-end num">${num(r.invoices)}</td><td class="text-end num">${num(r.quantity)}</td><td class="text-end num">${amount(r.revenue)}</td><td class="text-end num">${amount(r.cost)}</td><td class="text-end num"><b>${amount(r.profit)}</b></td><td class="text-end num">${num(r.margin)}%</td></tr>`).join('') : '<tr><td colspan="7" class="text-center muted" style="padding:2rem">لا توجد بيانات في الفترة</td></tr>'}</tbody>
        <tfoot><tr><td>الإجمالي</td><td class="text-end num">${num(d.totals.invoices)}</td><td></td><td class="text-end num">${amount(d.totals.revenue)}</td><td class="text-end num">${amount(d.totals.cost)}</td><td class="text-end num">${amount(d.totals.profit)}</td><td class="text-end num">${num(d.totals.margin)}%</td></tr></tfoot>
      </table></div></div><div class="alert alert-info tiny">${esc(d.note || '')}</div>`;
  };

  const agingBody = () => {
    const d = state.data;
    return `
      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.b0_30, 'SAR', { size: 16 })}</div><div class="stat-lab">1 — 30 يوم</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.b31_60, 'SAR', { size: 16 })}</div><div class="stat-lab">31 — 60 يوم</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.b61_90, 'SAR', { size: 16 })}</div><div class="stat-lab">61 — 90 يوم</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.b90_plus, 'SAR', { size: 16 })}</div><div class="stat-lab">أكثر من 90 يوم</div></div></div>
      </div>
      <div class="card pad0 mt">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>العميل</th><th>الكود</th>
            <th class="text-end">1-30 <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">31-60 <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">61-90 <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">+90 <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">الإجمالي المستحق <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th></th></tr></thead>
          <tbody>${d.items.length ? d.items.map((r) => `<tr>
            <td><b>${esc(r.name)}</b></td><td class="mono tiny">${esc(r.code)}</td>
            <td class="text-end num">${r.b0_30 ? amount(r.b0_30) : '—'}</td>
            <td class="text-end num">${r.b31_60 ? amount(r.b31_60) : '—'}</td>
            <td class="text-end num">${r.b61_90 ? amount(r.b61_90) : '—'}</td>
            <td class="text-end num" style="color:var(--danger)">${r.b90_plus ? amount(r.b90_plus) : '—'}</td>
            <td class="text-end num"><b>${amount(r.total)}</b></td>
            <td class="actions"><a class="btn btn-sm" href="#/statement/${esc(r.client_id)}">كشف</a></td>
          </tr>`).join('') : '<tr><td colspan="8" class="text-center muted" style="padding:2rem">لا توجد مبالغ مستحقة</td></tr>'}</tbody>
          <tfoot><tr><td colspan="2">الإجمالي</td><td class="text-end num">${amount(d.totals.b0_30)}</td>
            <td class="text-end num">${amount(d.totals.b31_60)}</td><td class="text-end num">${amount(d.totals.b61_90)}</td>
            <td class="text-end num">${amount(d.totals.b90_plus)}</td><td class="text-end num">${amount(d.totals.total)}</td><td></td></tr></tfoot>
        </table></div>
      </div>`;
  };

  const balancesBody = () => {
    const d = state.data;
    return `
      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.debit)}</div><div class="stat-lab">إجمالي المدين</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.credit)}</div><div class="stat-lab">إجمالي الدائن</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(d.totals.balance)}</div><div class="stat-lab">صافي الأرصدة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(d.items.length)}</div><div class="stat-lab">عميل معروض</div></div></div>
      </div>
      <div class="card pad0 mt">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>العميل</th><th>الكود</th><th>الجوال</th><th class="text-end">مدين <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">دائن <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th class="text-end">الرصيد <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th class="text-end">حد الائتمان <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th></th></tr></thead>
          <tbody>${d.items.map((r) => `<tr class="${r.over_limit ? 'row-warn' : ''}">
            <td><b>${esc(r.name)}</b>${r.over_limit ? ' <span class="badge red tiny">تجاوز حد الائتمان</span>' : ''}</td>
            <td class="mono tiny">${esc(r.client_code)}</td><td class="mono tiny">${esc(r.phone || '—')}</td>
            <td class="text-end num">${amount(r.debit)}</td><td class="text-end num">${amount(r.credit)}</td>
            <td class="text-end num" style="color:${r.balance > 0 ? 'var(--danger)' : r.balance < 0 ? 'var(--success)' : 'inherit'}"><b>${amount(r.balance)}</b></td>
            <td class="text-end num tiny">${r.credit_limit ? amount(r.credit_limit) : '—'}</td>
            <td class="actions"><a class="btn btn-sm" href="#/statement/${esc(r.client_id)}">كشف</a></td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">الإجمالي</td><td class="text-end num">${amount(d.totals.debit)}</td>
            <td class="text-end num">${amount(d.totals.credit)}</td><td class="text-end num">${amount(d.totals.balance)}</td>
            <td colspan="2"></td></tr></tfoot>
        </table></div>
      </div>`;
  };

  const batchesBody = () => {
    const items = state.data.items || state.data;
    return `<div class="card pad0">
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>التاريخ</th><th>الشركة</th><th>العميل</th><th class="text-end">عدد الفواتير</th>
          <th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th>المستخدم</th><th>معايير التوليد</th><th></th></tr></thead>
        <tbody>${items.length ? items.map((b) => `<tr>
          <td class="tiny nowrap">${esc(dateTimeAr(b.created_at))}</td>
          <td class="tiny">${esc(b.issuer_name || '')}</td>
          <td>${esc(b.client_name || '')}</td>
          <td class="text-end num">${num(b.invoice_count)}</td>
          <td class="text-end num"><b>${amount(b.total_amount)}</b></td>
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
    if (state.tab === 'collections') {
      return { name:'تقرير-التحصيلات', title:'تقرير التحصيلات', headers:['البيان','عدد السندات','المبلغ','المخصص','غير المخصص'], rows:d.items.map((r)=>[r.label,r.count,r.amount,r.allocated,r.unallocated]), footer:['الإجمالي',d.totals.count,d.totals.amount,d.totals.allocated,d.totals.unallocated] };
    }
    if (state.tab === 'profitability') {
      return { name:'تقرير-الربحية', title:'تقرير الربحية الإجمالية', headers:['البيان','الفواتير','الكمية','المبيعات','التكلفة','الربح','الهامش %'], rows:d.items.map((r)=>[r.label,r.invoices,r.quantity,r.revenue,r.cost,r.profit,r.margin]), footer:['الإجمالي',d.totals.invoices,'',d.totals.revenue,d.totals.cost,d.totals.profit,d.totals.margin] };
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
    const showPeriod = ['sales','vat','collections','profitability'].includes(state.tab);
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>التقارير</h1>
          <p>${issuerLabel()}${showPeriod ? ` — ${periodLabel()}` : ''}</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-info" id="btn-preview-report-doc" type="button" style="display:inline-flex; align-items:center; gap:5px; font-weight:700; background:rgba(6,182,212,0.16); border:1px solid rgba(6,182,212,0.38); color:#38bdf8;" title="عرض ومعاينة التقرير كصورة ومستند A4 رسمي">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            عرض التقرير (صورة) 👁️
          </button>
          <button class="btn btn-primary" id="btn-pdf-report" type="button">
            ${raw(icon.pdf({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            تحميل تقرير PDF
          </button>
          <button class="btn" id="print" type="button">
            ${raw(icon.printer({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            طباعة
          </button>
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
          ${raw(['sales','collections','profitability'].includes(state.tab) ? `
            <div class="field"><label>العميل</label>
              <select id="client_id"><option value="">كل العملاء</option>
                ${store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select></div>
            <div class="field" style="max-width:170px"><label>التجميع</label>
              <select id="group_by">${(state.tab === 'collections' ? [['day','يومياً'],['client','حسب العميل'],['payment','حسب طريقة الدفع'],['issuer','حسب الشركة']] : state.tab === 'profitability' ? [['month','شهرياً'],['client','حسب العميل'],['item','حسب الصنف'],['category','حسب المجموعة'],['issuer','حسب الشركة']] : GROUPS).map(([k, l]) => `<option value="${k}" ${k === state.group_by ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>` : '')}
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
        : state.tab === 'collections' ? collectionsBody()
          : state.tab === 'profitability' ? profitabilityBody()
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

    const sar = sarSvg({ size: 14 });
    const reportStats = () => {
      const d = state.data;
      if (!d) return [];
      if (state.tab === 'sales' && d.totals) {
        return [
          { label: 'عدد الفواتير', val: num(d.totals.count) },
          { label: 'إجمالي المبيعات', html: `${money(d.totals.total)} ${sar}` },
          { label: 'إجمالي الضريبة', html: `${money(d.totals.tax)} ${sar}` },
          { label: 'إجمالي الخصومات', html: `${money(d.totals.discount)} ${sar}` },
        ];
      }
      if (state.tab === 'vat' && d.totals) {
        return [
          { label: 'عدد الفواتير', val: num(d.totals.invoices) },
          { label: 'الوعاء الخاضع للضريبة', html: `${money(d.totals.taxable)} ${sar}` },
          { label: 'ضريبة المخرجات المستحقة', html: `${money(d.totals.tax)} ${sar}` },
          { label: 'الإجمالي شامل الضريبة', html: `${money(d.totals.total)} ${sar}` },
        ];
      }
      if (state.tab === 'collections' && d.totals) return [
        {label:'عدد السندات',val:num(d.totals.count)}, {label:'إجمالي التحصيل',html:`${money(d.totals.amount)} ${sar}`},
        {label:'المخصص للفواتير',html:`${money(d.totals.allocated)} ${sar}`}, {label:'غير المخصص',html:`${money(d.totals.unallocated)} ${sar}`},
      ];
      if (state.tab === 'profitability' && d.totals) return [
        {label:'صافي المبيعات',html:`${money(d.totals.revenue)} ${sar}`}, {label:'التكلفة',html:`${money(d.totals.cost)} ${sar}`},
        {label:'الربح الإجمالي',html:`${money(d.totals.profit)} ${sar}`}, {label:'هامش الربح',val:`${num(d.totals.margin)}%`},
      ];
      if (state.tab === 'aging' && d.totals) {
        return [
          { label: '1 — 30 يوم', html: `${money(d.totals.b0_30)} ${sar}` },
          { label: '31 — 60 يوم', html: `${money(d.totals.b31_60)} ${sar}` },
          { label: '61 — 90 يوم', html: `${money(d.totals.b61_90)} ${sar}` },
          { label: 'أكثر من 90 يوم', html: `${money(d.totals.b90_plus)} ${sar}` },
        ];
      }
      if (state.tab === 'balances' && d.totals) {
        return [
          { label: 'إجمالي المدين', html: `${money(d.totals.debit)} ${sar}` },
          { label: 'إجمالي الدائن', html: `${money(d.totals.credit)} ${sar}` },
          { label: 'صافي الأرصدة المستحقة', html: `${money(d.totals.balance)} ${sar}` },
          { label: 'عدد العملاء المعروضين', val: num(d.items.length) },
        ];
      }
      return [];
    };

    const spec = exportSpec();
    const getReportDocHtml = () => {
      const subtitle = `${issuerLabel()}${showPeriod ? ` — ${periodLabel()}` : ''}`;
      return buildReportHtml({
        title: spec.title,
        subtitle,
        headers: spec.headers,
        rows: spec.rows.map((r) => r.map((c, i) => (i > 0 && typeof c === 'number' ? money(c) : c === undefined || c === null ? '' : c))),
        footer: spec.footer && spec.footer.map((c, i) => (i > 0 && typeof c === 'number' ? money(c) : c)),
        issuerName: issuerLabel(),
        stats: reportStats(),
      });
    };

    $('#exp-csv', view).addEventListener('click', () => exportCsv(spec.name, spec.headers,
      spec.footer ? [...spec.rows, spec.footer] : spec.rows));
    $('#exp-xls', view).addEventListener('click', () => exportExcel(spec.name, spec.title, spec.headers, spec.rows,
      { footer: spec.footer, subtitle: `${issuerLabel()}${showPeriod ? ` — ${periodLabel()}` : ''}` }));

    $('#btn-pdf-report', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const docHtml = getReportDocHtml();
        await downloadPdfFromHtml(docHtml, `${spec.name}.pdf`);
      } catch (err) {
        toastErr(err.message || 'تعذر استخراج ملف PDF للتقرير');
      } finally {
        e.target.disabled = false;
      }
    });

    $('#print', view).addEventListener('click', () => {
      const docHtml = getReportDocHtml();
      printDoc(docHtml);
    });

    $('#btn-preview-report-doc', view)?.addEventListener('click', () => {
      const docHtml = getReportDocHtml();
      let currentZoom = 80;
      const m = modal({
        title: `معاينة بصرية للتقرير: ${spec.title}`,
        wide: true,
        body: html`
          <div style="padding:0.2rem 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem; background:rgba(255,255,255,0.03); padding:0.6rem 0.9rem; border-radius:8px; border:1px solid var(--line); flex-wrap:wrap; gap:0.5rem;">
              <div class="flex gap" style="align-items:center;">
                <span class="badge green" style="font-weight:700;">معاينة A4 رسمية كصورة مستند طبق الأصل</span>
                <span class="tiny muted">${esc(issuerLabel())}</span>
              </div>
              <div class="flex gap-xs" style="align-items:center;">
                <div class="tpl-zoom-controls" style="margin:0; display:inline-flex; align-items:center; background:rgba(0,0,0,0.25); border:1px solid var(--line); border-radius:6px; overflow:hidden;">
                  <button type="button" class="tpl-zoom-btn" id="modal-zoom-out" style="padding:3px 8px; border:none; background:none; color:var(--text); cursor:pointer; font-weight:bold;">−</button>
                  <span class="tpl-zoom-val" id="modal-zoom-text" style="font-size:0.75rem; padding:0 6px; font-variant-numeric:tabular-nums;">${currentZoom}%</span>
                  <button type="button" class="tpl-zoom-btn" id="modal-zoom-in" style="padding:3px 8px; border:none; background:none; color:var(--text); cursor:pointer; font-weight:bold;">+</button>
                </div>
                <button class="btn btn-sm btn-primary" id="btn-modal-print-doc" type="button" style="display:inline-flex; align-items:center; gap:4px; font-size:0.78rem;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
                  طباعة المستند
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
          <div class="flex gap" style="justify-content:flex-end; width:100%;">
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
      $('#btn-modal-print-doc', m.el)?.addEventListener('click', () => printDoc(docHtml));
      $('#btn-modal-pdf-doc', m.el)?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          await downloadPdfFromHtml(docHtml, `${spec.name}.pdf`);
        } catch (err) {
          toastErr('فشل تحميل ملف PDF: ' + err.message);
        } finally {
          e.currentTarget.disabled = false;
        }
      });
    });
  };

  await load();
  draw();
  return undefined;
}
