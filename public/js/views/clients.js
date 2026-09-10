// ==========================================================================
//  دليل العملاء المركزي (مشترك بين كل الشركات المصدرة)
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, invalidate, can, currencyLabel, getFilterState, setFilterState, clearFilterState } from '../core/store.js';
import {
  html, raw, esc, money, modal, formValues, toastOk, toastErr, confirmDialog,
  $, delegate, debounce, exportCsv, exportExcel, dateAr, icon,
} from '../core/util.js';

function clientForm(data = {}) {
  const v = (k, def = '') => (data[k] === undefined || data[k] === null ? def : data[k]);
  return html`
    <div class="row">
      <div class="field" style="max-width:170px"><label>كود العميل</label>
        <input type="text" name="client_code" value="${v('client_code')}" class="ltr" placeholder="تلقائي" />
        <span class="hint">يُولَّد تلقائياً إن تُرك فارغاً</span></div>
      <div class="field"><label class="req">اسم العميل</label>
        <input type="text" name="name" value="${v('name')}" /></div>
    </div>
    <div class="row mt">
      <div class="field"><label>نوع العميل</label>
        <select name="client_type">
          <option value="COMPANY" ${raw(v('client_type', 'COMPANY') === 'COMPANY' ? 'selected' : '')}>شركة / مؤسسة (B2B)</option>
          <option value="INDIVIDUAL" ${raw(v('client_type') === 'INDIVIDUAL' ? 'selected' : '')}>فرد (B2C)</option>
        </select></div>
      <div class="field"><label>الرقم الضريبي</label>
        <input type="text" name="tax_number" value="${v('tax_number')}" class="ltr" maxlength="15" />
        <span class="hint">مطلوب للفواتير الضريبية بين المنشآت</span></div>
    </div>
    <div class="row mt">
      <div class="field"><label>رقم الجوال</label><input type="text" name="mobile" value="${v('mobile')}" class="ltr" /></div>
      <div class="field"><label>الهاتف</label><input type="text" name="phone" value="${v('phone')}" class="ltr" /></div>
      <div class="field"><label>البريد الإلكتروني</label><input type="email" name="email" value="${v('email')}" class="ltr" /></div>
    </div>
    <div class="row mt">
      <div class="field"><label>المدينة</label><input type="text" name="city" value="${v('city')}" /></div>
      <div class="field"><label>الرقم الوطني الموحد / السجل</label><input type="text" name="commercial_register" value="${v('commercial_register')}" class="ltr" /></div>
    </div>
    <div class="field mt"><label>العنوان</label><textarea name="address" style="min-height:56px">${v('address')}</textarea></div>
    <div class="row mt">
      <div class="field"><label>الرصيد الافتتاحي</label>
        <input type="number" name="opening_balance" value="${v('opening_balance', 0)}" step="0.01" />
        <span class="hint">موجب = مدين علينا له، سالب = دفعة مقدمة</span></div>
      <div class="field"><label>الحد الائتماني</label>
        <input type="number" name="credit_limit" value="${v('credit_limit', 0)}" step="0.01" min="0" /></div>
      <div class="field" style="max-width:150px"><label>مدة السداد (يوم)</label>
        <input type="number" name="payment_terms_days" value="${v('payment_terms_days', 0)}" min="0" /></div>
    </div>
    <div class="field mt"><label>ملاحظات</label><textarea name="notes" style="min-height:52px">${v('notes')}</textarea></div>
    <label class="check mt"><input type="checkbox" name="is_active" ${raw(v('is_active', true) ? 'checked' : '')} /> عميل نشط</label>`;
}

function openClientModal(client, onSaved) {
  const isNew = !client;
  const m = modal({
    title: isNew ? 'إضافة عميل' : `تعديل: ${client.name}`,
    body: clientForm(client || {}),
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn btn-primary" data-save type="button">${isNew ? 'إضافة' : 'حفظ'}</button>`,
  });
  m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
    const values = formValues(m.body);
    if (!values.name) return toastErr('اسم العميل مطلوب');
    e.target.disabled = true;
    try {
      if (isNew) await api.post('/api/clients', values);
      else await api.put(`/api/clients/${client.id}`, values);
      toastOk('تم الحفظ');
      m.close();
      invalidate('clients');
      await loadClients(true);
      onSaved();
    } catch { e.target.disabled = false; }
    return undefined;
  });
}

export async function render(view) {
  const defaults = { q: '', client_type: '', onlyDebtors: false, scope: 'ALL' };
  const cached = getFilterState('clients', defaults);
  const state = { ...cached, rows: [] };
  const cur = currencyLabel();

  const saveState = () => {
    setFilterState('clients', {
      q: state.q,
      client_type: state.client_type,
      onlyDebtors: state.onlyDebtors,
      scope: state.scope,
    });
  };

  const load = async () => {
    saveState();
    state.rows = await api.get(qs('/api/clients', {
      with_balances: true,
      q: state.q,
      client_type: state.client_type,
      issuer_id: state.scope === 'ISSUER' ? store.activeIssuerId : '',
    }));
  };

  const rowsHtml = () => {
    let rows = state.rows;
    if (state.onlyDebtors) rows = rows.filter((c) => c.balance > 0.004);
    if (!rows.length) return '<tr><td colspan="8" class="text-center muted" style="padding:1.5rem">لا توجد نتائج</td></tr>';
    return rows.map((c) => `<tr>
        <td class="mono tiny">${esc(c.client_code)}</td>
        <td>
          <b>${esc(c.name)}</b>
          <div class="tiny muted">${esc(c.city || '')}${c.mobile ? ` — ${esc(c.mobile)}` : ''}</div>
        </td>
        <td class="tiny">${c.client_type === 'INDIVIDUAL' ? 'فرد' : 'شركة'}</td>
        <td class="mono tiny">${esc(c.tax_number || '—')}</td>
        <td class="text-end num">${money(c.total_invoiced)}</td>
        <td class="text-end num">${money(c.total_paid)}</td>
        <td class="text-end num" style="font-weight:700;color:${c.balance > 0.004 ? 'var(--danger)' : c.balance < -0.004 ? 'var(--success)' : 'inherit'}">${money(c.balance)}</td>
        <td class="actions">
          <a class="btn btn-sm" href="#/statement/${esc(c.id)}" title="كشف الحساب">${icon.statement({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}كشف</a>
          <a class="btn btn-sm" href="#/invoice?client_id=${esc(c.id)}" title="فاتورة جديدة">${icon.plus({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}فاتورة</a>
          ${can('clients.write') ? `<button class="btn btn-sm" data-act="edit" data-id="${esc(c.id)}" type="button" title="تعديل">${icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}تعديل</button>` : ''}
          ${can('clients.write') ? `<button class="btn btn-sm btn-danger" data-act="del" data-id="${esc(c.id)}" type="button" title="حذف">${icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}حذف</button>` : ''}
        </td>
      </tr>`).join('');
  };

  const totals = () => {
    let rows = state.rows;
    if (state.onlyDebtors) rows = rows.filter((c) => c.balance > 0.004);
    return rows.reduce((acc, c) => ({
      invoiced: acc.invoiced + c.total_invoiced,
      paid: acc.paid + c.total_paid,
      balance: acc.balance + c.balance,
      count: acc.count + 1,
    }), { invoiced: 0, paid: 0, balance: 0, count: 0 });
  };

  const draw = () => {
    const t = totals();
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>العملاء</h1>
          <p>دليل موحد يُستخدم من كل الشركات المصدرة، مع أرصدة محدَّثة لحظياً.</p>
        </div>
        <div class="page-actions">
          ${raw(can('clients.write') ? `<button class="btn btn-primary" id="add" type="button">${icon.userPlus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}إضافة عميل</button>` : '')}
          <button class="btn" id="exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn" id="exp-csv" type="button">${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}CSV</button>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <div class="field" style="flex:1.8"><label>بحث</label>
            <input type="search" id="q" value="${state.q}" placeholder="اسم، كود، جوال، رقم ضريبي، سجل…" /></div>
          <div class="field" style="max-width:180px"><label>نوع العميل</label>
            <select id="client_type">
              <option value="">كل الأنواع</option>
              <option value="COMPANY" ${state.client_type === 'COMPANY' ? 'selected' : ''}>شركات / منشآت</option>
              <option value="INDIVIDUAL" ${state.client_type === 'INDIVIDUAL' ? 'selected' : ''}>أفراد</option>
            </select></div>
          <div class="field" style="max-width:200px"><label>نطاق الأرصدة</label>
            <select id="scope">
              <option value="ALL" ${raw(state.scope === 'ALL' ? 'selected' : '')}>كل الشركات (موحّد)</option>
              <option value="ISSUER" ${raw(state.scope === 'ISSUER' ? 'selected' : '')}>الشركة النشطة فقط</option>
            </select></div>
          <div class="field" style="max-width:140px"><label>&nbsp;</label>
            <label class="check"><input type="checkbox" id="debtors" ${raw(state.onlyDebtors ? 'checked' : '')} /> المدينون فقط</label></div>
          <div class="field" style="max-width:110px"><label>&nbsp;</label>
            <button class="btn btn-sm" id="clear-filters" type="button">إزالة التصفية</button></div>
        </div>
        ${raw(state.scope === 'ISSUER' ? '<div class="alert alert-info mt tiny">النطاق مفلتر على الشركة النشطة، لذلك لا يشمل الأرصدة الافتتاحية العامة للعميل.</div>' : '')}
      </div>

      <div class="grid grid-4">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${t.count}</div><div class="stat-lab">عميل</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(t.invoiced)}</div><div class="stat-lab">إجمالي المفوتر (${cur})</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(t.paid)}</div><div class="stat-lab">إجمالي المسدد (${cur})</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${money(t.balance)}</div><div class="stat-lab">صافي الأرصدة (${cur})</div></div></div>
      </div>

      <div class="card pad0 mt">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th>الكود</th><th>العميل</th><th>النوع</th><th>الرقم الضريبي</th>
              <th class="text-end">المفوتر</th><th class="text-end">المسدد</th><th class="text-end">الرصيد</th><th></th>
            </tr></thead>
            <tbody id="rows">${raw(rowsHtml())}</tbody>
          </table>
        </div>
      </div>`;

    const addBtn = $('#add', view);
    if (addBtn) addBtn.addEventListener('click', () => openClientModal(null, async () => { await load(); draw(); }));

    $('#q', view).addEventListener('input', debounce(async (e) => {
      state.q = e.target.value;
      await load();
      $('#rows', view).innerHTML = rowsHtml();
    }, 300));
    $('#client_type', view).addEventListener('change', async (e) => {
      state.client_type = e.target.value;
      await load();
      draw();
    });
    $('#scope', view).addEventListener('change', async (e) => {
      state.scope = e.target.value;
      await load();
      draw();
    });
    $('#debtors', view).addEventListener('change', (e) => {
      state.onlyDebtors = e.target.checked;
      saveState();
      draw();
    });
    $('#clear-filters', view).addEventListener('click', async () => {
      clearFilterState('clients');
      Object.assign(state, defaults);
      await load();
      draw();
    });

    const headers = ['الكود', 'العميل', 'النوع', 'الرقم الضريبي', 'الجوال', 'المدينة', 'المفوتر', 'المسدد', 'الرصيد'];
    const dataRows = () => (state.onlyDebtors ? state.rows.filter((c) => c.balance > 0.004) : state.rows)
      .map((c) => [c.client_code, c.name, c.client_type === 'INDIVIDUAL' ? 'فرد' : 'شركة', c.tax_number || '',
        c.mobile || '', c.city || '', money(c.total_invoiced), money(c.total_paid), money(c.balance)]);
    $('#exp-csv', view).addEventListener('click', () => exportCsv(`العملاء-${dateAr(new Date().toISOString())}`, headers, dataRows()));
    $('#exp-xls', view).addEventListener('click', () => exportExcel('العملاء', 'كشف أرصدة العملاء', headers, dataRows()));

    delegate(view, 'click', '[data-act]', async (e, btn) => {
      const client = state.rows.find((x) => x.id === btn.dataset.id);
      if (!client) return;
      if (btn.dataset.act === 'edit') {
        const full = await api.get(`/api/clients/${client.id}`);
        openClientModal(full, async () => { await load(); draw(); });
      } else if (btn.dataset.act === 'del') {
        const ok = await confirmDialog({
          title: 'حذف عميل',
          message: `سيتم حذف «${client.name}». لا يمكن الحذف إذا كانت له فواتير أو سندات.`,
          danger: true,
          okText: 'حذف',
        });
        if (!ok) return;
        try {
          await api.del(`/api/clients/${client.id}`);
          toastOk('تم حذف العميل');
          invalidate('clients');
          await load();
          draw();
        } catch { /* تنبيه تلقائي */ }
      }
    });
  };

  await load();
  draw();
  return undefined;
}
