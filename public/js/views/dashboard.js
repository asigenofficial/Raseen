// ==========================================================================
//  لوحة المعلومات
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, activeIssuer, currencyLabel } from '../core/store.js';
import { html, raw, esc, money, num, dateAr, statusBadge, icon, amount, sarSvg } from '../core/util.js';

function stat(iconContent, cls, value, label, sub) {
  return html`<div class="stat">
    ${iconContent ? raw(`<div class="stat-ico ${cls}">${iconContent}</div>`) : ''}
    <div style="min-width:0">
      <div class="stat-val num">${raw(value)}</div>
      <div class="stat-lab">${label}</div>
      ${raw(sub ? `<div class="tiny muted">${esc(sub)}</div>` : '')}
    </div>
  </div>`;
}

function barChart(monthly) {
  const max = Math.max(1, ...monthly.map((m) => m.total));
  return html`<div class="bar-chart" style="margin-top:.8rem">
    ${raw(monthly.map((m) => `
      <div class="bar" style="height:${Math.round((m.total / max) * 100)}%">
        <div class="tip">${money(m.total)} ر.س</div>
        <span>${esc(m.month.slice(5))}/${esc(m.month.slice(2, 4))}</span>
      </div>`))}
  </div>`;
}

export async function render(view) {
  const issuerId = store.activeIssuerId;
  const rawData = await api.get(qs('/api/reports/dashboard', { issuer_id: issuerId }));
  const data = rawData || {};
  data.month = data.month || { count: 0, total: 0 };
  data.today = data.today || { count: 0, total: 0 };
  data.all = data.all || { count: 0, total: 0, tax: 0, remaining: 0 };
  data.counts = data.counts || { issuers: 0, clients: 0, items: 0, batches: 0 };
  data.by_status = Array.isArray(data.by_status) ? data.by_status : [];
  data.monthly = Array.isArray(data.monthly) ? data.monthly : [];
  data.top_clients = Array.isArray(data.top_clients) ? data.top_clients : [];
  data.top_items = Array.isArray(data.top_items) ? data.top_items : [];
  data.by_issuer = Array.isArray(data.by_issuer) ? data.by_issuer : [];
  data.recent_invoices = Array.isArray(data.recent_invoices) ? data.recent_invoices : [];

  const cur = currencyLabel();
  const iss = activeIssuer();

  const statusMap = new Map(data.by_status.map((s) => [s.status, s]));
  const g = (k) => statusMap.get(k) || { count: 0, total: 0 };

  view.innerHTML = html`
    <div class="page-head">
      <div class="titles">
        <h1>لوحة المعلومات</h1>
        <p>${raw(iss ? `المنشأة النشطة: <b>${esc(iss.name_ar)}</b> — الأرقام أدناه مفلترة على هذه المنشأة` : 'عرض شامل لكل المنشآت')}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-primary" href="#/invoice">${raw(icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}فاتورة جديدة</a>
        <a class="btn" href="#/bulk">${raw(icon.layers({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}توليد دفعة</a>
        <a class="btn" href="#/vouchers">${raw(icon.receipt({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}سند قبض</a>
      </div>
    </div>

    <div class="grid grid-4">
      ${raw(stat(icon.coins({ size: 22 }), 'blue', amount(data.month.total), 'مبيعات الشهر', `${num(data.month.count)} فاتورة`))}
      ${raw(stat(icon.calendar({ size: 22 }), 'green', amount(data.today.total), 'مبيعات اليوم', `${num(data.today.count)} فاتورة`))}
      ${raw(stat(icon.wallet({ size: 22 }), 'amber', amount(data.all.remaining), 'إجمالي المتبقي على العملاء', `${num(g('UNPAID').count + g('PARTIAL').count)} فاتورة غير مسددة`))}
      ${raw(stat(icon.calculator({ size: 22 }), 'red', amount(data.all.tax), 'ضريبة القيمة المضافة', 'إجمالي الضريبة المحصّلة'))}
    </div>

    <div class="grid grid-4 mt">
      ${raw(stat(icon.building({ size: 20 }), 'blue', num(data.counts.issuers), 'شركات مصدرة'))}
      ${raw(stat(icon.users({ size: 20 }), 'green', num(data.counts.clients), 'عملاء'))}
      ${raw(stat(icon.package({ size: 20 }), 'amber', num(data.counts.items), 'أصناف'))}
      ${raw(stat(icon.layers({ size: 20 }), '', num(data.counts.batches), 'دفعات مولّدة'))}
    </div>

    <div class="grid grid-2 mt">
      <div class="card">
        <div class="card-head" style="padding:0 0 .7rem;border-bottom:1px solid var(--line)">
          <h3>المبيعات الشهرية (آخر 12 شهراً)</h3>
        </div>
        ${raw(barChart(data.monthly))}
      </div>

      <div class="card">
        <div class="card-head" style="padding:0 0 .7rem;border-bottom:1px solid var(--line)">
          <h3>حالة الفواتير</h3>
        </div>
        <table class="tbl">
          <thead><tr><th>الحالة</th><th class="text-end">العدد</th><th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 13 })}</span></th></tr></thead>
          <tbody>
            <tr><td>${raw(statusBadge('PAID', 'مسددة'))}</td><td class="text-end num">${num(g('PAID').count)}</td><td class="text-end num">${amount(g('PAID').total)}</td></tr>
            <tr><td>${raw(statusBadge('PARTIAL', 'مسددة جزئياً'))}</td><td class="text-end num">${num(g('PARTIAL').count)}</td><td class="text-end num">${amount(g('PARTIAL').total)}</td></tr>
            <tr><td>${raw(statusBadge('UNPAID', 'غير مسددة'))}</td><td class="text-end num">${num(g('UNPAID').count)}</td><td class="text-end num">${amount(g('UNPAID').total)}</td></tr>
            <tr><td>${raw(statusBadge('CANCELLED', 'ملغاة'))}</td><td class="text-end num">${num(g('CANCELLED').count)}</td><td class="text-end num">${amount(g('CANCELLED').total)}</td></tr>
          </tbody>
          <tfoot><tr><td>الإجمالي</td><td class="text-end num">${num(data.all.count)}</td><td class="text-end num">${amount(data.all.total)}</td></tr></tfoot>
        </table>
      </div>
    </div>

    <div class="grid grid-2 mt">
      <div class="card pad0">
        <div class="card-head"><h3>أعلى العملاء</h3></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>العميل</th><th class="text-end">فواتير</th><th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 12 })}</span></th><th class="text-end">المتبقي <span class="cur-sym">${sarSvg({ size: 12 })}</span></th></tr></thead>
            <tbody>
              ${data.top_clients.length ? data.top_clients.map((c) => raw(`<tr>
                  <td><a href="#/statement/${esc(c.client_id)}">${esc(c.name)}</a><div class="tiny muted mono">${esc(c.code)}</div></td>
                  <td class="text-end num">${num(c.invoices)}</td>
                  <td class="text-end num">${amount(c.total)}</td>
                  <td class="text-end num" style="color:${c.remaining > 0 ? 'var(--danger)' : 'inherit'}">${amount(c.remaining)}</td>
                </tr>`)) : raw('<tr><td colspan="4" class="text-center muted">لا توجد بيانات</td></tr>')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card pad0">
        <div class="card-head"><h3>أكثر الأصناف مبيعاً</h3></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>الصنف</th><th class="text-end">الكمية</th><th class="text-end">الإجمالي</th></tr></thead>
            <tbody>
              ${data.top_items.length ? data.top_items.map((i) => raw(`<tr>
                  <td>${esc(i.item_name)}<div class="tiny muted mono">${esc(i.item_code || '')}</div></td>
                  <td class="text-end num">${num(i.quantity)}</td>
                  <td class="text-end num">${money(i.total)}</td>
                </tr>`)) : raw('<tr><td colspan="3" class="text-center muted">لا توجد بيانات</td></tr>')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card pad0 mt">
      <div class="card-head">
        <h3>توزيع المبيعات على الشركات المصدرة</h3>
        <div class="spacer"></div>
        <a class="btn btn-sm" href="#/issuers">إدارة الشركات</a>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>الشركة</th><th>الكود</th><th class="text-end">فواتير</th><th class="text-end">الإجمالي</th><th class="text-end">المتبقي</th></tr></thead>
          <tbody>
            ${data.by_issuer.map((i) => raw(`<tr>
                <td>${esc(i.name)}</td>
                <td class="mono tiny">${esc(i.code)}</td>
                <td class="text-end num">${num(i.invoices)}</td>
                <td class="text-end num">${money(i.total)}</td>
                <td class="text-end num">${money(i.remaining)}</td>
              </tr>`))}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card pad0 mt">
      <div class="card-head">
        <h3>أحدث الفواتير</h3>
        <div class="spacer"></div>
        <a class="btn btn-sm" href="#/invoices">كل الفواتير</a>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>الرقم</th><th>التاريخ</th><th>العميل</th><th>الشركة</th><th class="text-end">الإجمالي</th><th>الحالة</th></tr></thead>
          <tbody>
            ${data.recent_invoices.length ? data.recent_invoices.map((i) => raw(`<tr class="clickable" onclick="location.hash='#/invoice-view/${esc(i.id)}'">
                <td class="mono">${esc(i.invoice_number)}</td>
                <td class="nowrap tiny">${esc(dateAr(i.issue_date))}</td>
                <td>${esc(i.client_name)}</td>
                <td class="tiny">${esc(i.issuer_name)}</td>
                <td class="text-end num">${money(i.grand_total)}</td>
                <td>${statusBadge(i.status, store.meta.invoice_statuses[i.status])}</td>
              </tr>`)) : raw('<tr><td colspan="6" class="text-center muted">لا توجد فواتير بعد — ابدأ بإصدار أول فاتورة</td></tr>')}
          </tbody>
        </table>
      </div>
    </div>`;
  return undefined;
}
