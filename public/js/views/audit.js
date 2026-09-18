// ==========================================================================
//  سجل العمليات (Audit Trail): من فعل ماذا ومتى ولأي شركة.
// ==========================================================================
import { api, qs } from '../core/api.js';
import {
  html, raw, esc, num, dateTimeAr, monthStart, today,
  $, delegate, debounce, exportCsv, exportExcel, modal, icon, downloadPdfFromHtml, toastErr,
} from '../core/util.js';

const PAGE = 100;

const ACTION_LABELS = {
  LOGIN: 'تسجيل دخول',
  LOGIN_FAILED: 'محاولة دخول فاشلة',
  LOGOUT: 'تسجيل خروج',
  PASSWORD_CHANGE: 'تغيير كلمة المرور',
  USER_CREATE: 'إضافة مستخدم',
  USER_UPDATE: 'تعديل مستخدم',
  USER_DELETE: 'حذف مستخدم',
  ISSUER_CREATE: 'إضافة شركة مصدرة',
  ISSUER_UPDATE: 'تعديل شركة مصدرة',
  ISSUER_DELETE: 'حذف شركة مصدرة',
  ISSUER_CREDENTIALS: 'تحديث بيانات ربط ZATCA',
  ISSUER_KEY_GENERATE: 'توليد مفتاح توقيع',
  CLIENT_CREATE: 'إضافة عميل',
  CLIENT_UPDATE: 'تعديل عميل',
  CLIENT_DELETE: 'حذف عميل',
  CATEGORY_CREATE: 'إضافة مجموعة',
  CATEGORY_UPDATE: 'تعديل مجموعة',
  CATEGORY_DELETE: 'حذف مجموعة',
  ITEM_CREATE: 'إضافة صنف',
  ITEM_UPDATE: 'تعديل صنف',
  ITEM_DELETE: 'حذف صنف',
  INVOICE_CREATE: 'إصدار فاتورة',
  INVOICE_CANCEL: 'إلغاء فاتورة',
  INVOICE_DELETE: 'حذف فاتورة',
  VOUCHER_CREATE: 'تسجيل سند قبض',
  VOUCHER_CANCEL: 'إلغاء سند قبض',
  VOUCHER_DELETE: 'حذف سند قبض',
  BULK_COMMIT: 'اعتماد دفعة فواتير',
};

const ACTION_TONE = (a) => {
  if (a.endsWith('_DELETE') || a === 'LOGIN_FAILED') return 'red';
  if (a.endsWith('_CANCEL')) return 'amber';
  if (a.endsWith('_CREATE') || a === 'BULK_COMMIT') return 'green';
  if (a.endsWith('_UPDATE') || a === 'PASSWORD_CHANGE') return 'blue';
  return 'gray';
};

const describe = (d) => Object.entries(d || {})
  .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  .join(' — ');

export async function render(view) {
  const state = {
    q: '', action: '', entity_type: '', user: '', from: '', to: '', offset: 0,
    data: { items: [], total_count: 0 },
  };

  const load = async () => {
    state.data = await api.get(qs('/api/audit', {
      q: state.q, action: state.action, entity_type: state.entity_type, user: state.user,
      from: state.from, to: state.to, limit: PAGE, offset: state.offset,
    }));
  };

  const draw = () => {
    const pageTo = Math.min(state.offset + PAGE, state.data.total_count);
    const actions = Array.from(new Set([...Object.keys(ACTION_LABELS), ...state.data.items.map((i) => i.action)])).sort();
    const users = Array.from(new Set(state.data.items.map((i) => i.user_name))).sort();

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>سجل العمليات</h1>
          <p>كل عملية إصدار أو تعديل أو إلغاء أو حذف مسجَّلة باسم المستخدم ووقتها — ${num(state.data.total_count)} سجل.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="btn-pdf-audit" type="button">
            ${raw(icon.pdf({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            تحميل تقرير PDF
          </button>
          <button class="btn" id="exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn" id="exp-csv" type="button">${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}CSV</button>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <div class="field" style="flex:1.4"><label>بحث</label>
            <input type="search" id="q" value="${esc(state.q)}" placeholder="مستخدم، عملية، معرّف، تفاصيل…" /></div>
          <div class="field"><label>نوع العملية</label>
            <select id="action"><option value="">كل العمليات</option>
              ${raw(actions.map((a) => `<option value="${esc(a)}" ${a === state.action ? 'selected' : ''}>${esc(ACTION_LABELS[a] || a)}</option>`).join(''))}
            </select></div>
          <div class="field" style="max-width:170px"><label>الكيان</label>
            <select id="entity_type"><option value="">الكل</option>
              ${raw(['invoice', 'receipt_voucher', 'client', 'item', 'item_category', 'issuer', 'user', 'invoice_batch', 'session']
    .map((e) => `<option value="${esc(e)}" ${e === state.entity_type ? 'selected' : ''}>${esc(e)}</option>`).join(''))}
            </select></div>
          <div class="field" style="max-width:170px"><label>المستخدم</label>
            <select id="user"><option value="">الكل</option>
              ${raw(users.map((u) => `<option value="${esc(u)}" ${u === state.user ? 'selected' : ''}>${esc(u)}</option>`).join(''))}
            </select></div>
          <div class="field" style="max-width:150px"><label>من تاريخ</label><input type="date" id="from" value="${state.from}" /></div>
          <div class="field" style="max-width:150px"><label>إلى تاريخ</label><input type="date" id="to" value="${state.to}" /></div>
        </div>
        <div class="flex mt">
          <button class="btn btn-sm" data-quick="month" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذا الشهر</button>
          <button class="btn btn-sm" data-quick="today" type="button">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}اليوم</button>
          <button class="btn btn-sm" data-quick="clear" type="button">إزالة التصفية</button>
        </div>
      </div>

      <div class="card pad0">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th style="width:150px">الوقت</th><th>المستخدم</th><th>العملية</th>
              <th>الكيان</th><th>التفاصيل</th><th>IP</th><th></th></tr></thead>
            <tbody>
              ${raw(state.data.items.length ? state.data.items.map((r) => `<tr>
                <td class="tiny nowrap">${esc(dateTimeAr(r.created_at))}</td>
                <td><b>${esc(r.user_name)}</b></td>
                <td><span class="badge ${ACTION_TONE(r.action)}">${esc(ACTION_LABELS[r.action] || r.action)}</span></td>
                <td class="tiny muted">${esc(r.entity_type)}</td>
                <td class="tiny" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(describe(r.details))}</td>
                <td class="tiny mono">${esc(r.ip || '—')}</td>
                <td class="actions">
                  ${r.entity_type === 'invoice' && r.action !== 'INVOICE_DELETE' ? `<a class="btn btn-sm" href="#/invoice-view/${esc(r.entity_id)}">${icon.eye({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}الفاتورة</a>` : ''}
                  <button class="btn btn-sm" data-json="${esc(r.id)}" type="button">JSON</button>
                </td>
              </tr>`).join('') : '<tr><td colspan="7" class="text-center muted" style="padding:2rem">لا توجد سجلات مطابقة</td></tr>')}
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
    ['action', 'entity_type', 'user', 'from', 'to'].forEach((id) => {
      $(`#${id}`, view).addEventListener('change', async (e) => { state[id] = e.target.value; state.offset = 0; await reload(); });
    });
    delegate(view, 'click', '[data-quick]', async (e, btn) => {
      const k = btn.dataset.quick;
      if (k === 'month') { state.from = monthStart(); state.to = today(); }
      else if (k === 'today') { state.from = today(); state.to = today(); }
      else Object.assign(state, { q: '', action: '', entity_type: '', user: '', from: '', to: '' });
      state.offset = 0;
      await reload();
    });
    $('#prev', view).addEventListener('click', async () => { state.offset = Math.max(0, state.offset - PAGE); await reload(); });
    $('#next', view).addEventListener('click', async () => { state.offset += PAGE; await reload(); });

    delegate(view, 'click', '[data-json]', (e, btn) => {
      const row = state.data.items.find((r) => r.id === btn.dataset.json);
      if (!row) return;
      modal({
        title: `تفاصيل العملية — ${ACTION_LABELS[row.action] || row.action}`,
        body: html`<textarea class="mono ltr" readonly style="min-height:280px;font-size:.75rem">${JSON.stringify(row, null, 2)}</textarea>`,
      });
    });

    const headers = ['الوقت', 'المستخدم', 'العملية', 'الكيان', 'المعرّف', 'التفاصيل', 'IP'];
    const rows = () => state.data.items.map((r) => [r.created_at, r.user_name, ACTION_LABELS[r.action] || r.action,
      r.entity_type, r.entity_id, describe(r.details), r.ip]);
    $('#exp-csv', view).addEventListener('click', () => exportCsv('سجل-العمليات', headers, rows()));
    $('#exp-xls', view).addEventListener('click', () => exportExcel('سجل-العمليات', 'سجل العمليات', headers, rows()));

    const getAuditDocHtml = () => {
      const now = new Date();
      return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل العمليات والتدقيق</title>
        <style>
          @page { size: A4 landscape; margin: 10mm; }
          * { box-sizing: border-box; }
          body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; color: #0f172a; background: #fff; }
          .header { border-bottom: 2.5px solid #0d9488; padding-bottom: 4mm; margin-bottom: 4mm; display: flex; justify-content: space-between; align-items: center; }
          h1 { margin: 0 0 1mm; font-size: 15pt; color: #0f766e; }
          .sub { color: #64748b; font-size: 8.5pt; }
          table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 2mm; }
          th { background: #0d9488; color: #fff; border: 1px solid #0f766e; padding: 2.2mm 1.5mm; font-weight: 700; text-align: right; }
          td { border: 1px solid #cbd5e1; padding: 1.8mm 1.5mm; color: #1e293b; }
          tr:nth-child(even) td { background: #f8fafc; }
          .mono { font-family: monospace; font-size: 7.5pt; direction: ltr; text-align: left; }
          .footer { margin-top: 5mm; display: flex; justify-content: space-between; font-size: 8pt; color: #64748b; }
        </style></head><body>
        <div class="header">
          <div>
            <h1>تقرير سجل العمليات والتدقيق (Audit Trail)</h1>
            <div class="sub">إجمالي السجلات: ${num(state.data.total_count)} عملية مسجلة</div>
          </div>
          <div style="font-size:8pt;color:#64748b;text-align:left;direction:ltr">
            <div><b>Raseen Audit System</b></div>
            <div>${now.toLocaleDateString('ar-SA')} - ${now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        <table>
          <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${state.data.items.map((r) => `<tr>
            <td style="white-space:nowrap" class="mono">${esc(dateTimeAr(r.created_at))}</td>
            <td><b>${esc(r.user_name)}</b></td>
            <td>${esc(ACTION_LABELS[r.action] || r.action)}</td>
            <td class="mono">${esc(r.entity_type)}</td>
            <td class="mono">${esc(r.entity_id ? r.entity_id.slice(0, 10) : '—')}</td>
            <td style="font-size:7.5pt;max-width:320px">${esc(describe(r.details))}</td>
            <td class="mono">${esc(r.ip || '—')}</td>
          </tr>`).join('')}</tbody>
        </table>
        <div class="footer">
          <span>نظام رصين — سجل تدقيق رقابي معتمد</span>
          <span style="direction:ltr">Page 1</span>
        </div>
        </body></html>`;
    };

    $('#btn-pdf-audit', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const docHtml = getAuditDocHtml();
        await downloadPdfFromHtml(docHtml, 'سجل-العمليات.pdf');
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
