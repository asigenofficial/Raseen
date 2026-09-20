// ==========================================================================
//  دليل العملاء المركزي (مشترك بين كل الشركات المصدرة)
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, invalidate, can, currencyLabel, getFilterState, setFilterState, clearFilterState } from '../core/store.js';
import {
  html, raw, esc, money, modal, formValues, toastOk, toastErr, confirmDialog,
  $, delegate, debounce, exportCsv, exportExcel, dateAr, icon, amount, sarSvg,
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
      <div class="field"><label>الرقم الوطني الموحد / السجل</label><input type="text" name="commercial_register" value="${v('commercial_register')}" class="ltr" /></div>
      <div class="field"><label>رمز الدولة</label><input type="text" name="country" value="${v('country', 'SA')}" class="ltr" maxlength="2" /></div>
    </div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:8px;padding:.8rem;margin-top:.9rem">
      <div style="font-weight:700;font-size:.85rem;margin-bottom:.5rem;color:var(--primary)">العنوان الوطني للعميل (المشتري)</div>
      <div class="row">
        <div class="field"><label>المدينة</label><input type="text" name="city" value="${v('city')}" placeholder="الرياض، جدة، الدمام…" /></div>
        <div class="field"><label>الحي</label><input type="text" name="district" value="${v('district')}" placeholder="العليا، الملز، النسيم…" /></div>
        <div class="field"><label>الشارع</label><input type="text" name="street" value="${v('street')}" placeholder="طريق الملك فهد…" /></div>
      </div>
      <div class="row mt">
        <div class="field" style="max-width:140px"><label>رقم المبنى</label><input type="text" name="building_no" value="${v('building_no')}" class="ltr" placeholder="1234" /></div>
        <div class="field" style="max-width:160px"><label>الرمز البريدي</label><input type="text" name="postal_code" value="${v('postal_code')}" class="ltr" placeholder="12345" /></div>
        <div class="field"><label>العنوان الكامل / الإضافي</label><input type="text" name="address" value="${v('address')}" placeholder="وصف إضافي أو عنوان تفصيلي" /></div>
      </div>
    </div>
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
    values.is_active = values.is_active ? 1 : 0;
    values.opening_balance = Number(values.opening_balance) || 0;
    values.credit_limit = Number(values.credit_limit) || 0;
    values.payment_terms_days = parseInt(values.payment_terms_days, 10) || 0;
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

function openClientImportModal(onSuccess) {
  const m = modal({
    title: 'استيراد العملاء من ملف Excel / CSV',
    body: html`
      <div class="stack">
        <p class="tiny muted" style="margin:0">
          يمكنك استيراد قاعدة العملاء دفعة واحدة. يقوم النظام تلقائياً بالتعرف على الأعمدة وتحديث العملاء الحاليين وإضافة الجدد.
        </p>
        <div class="row items-center" style="gap:1rem;background:var(--bg-subtle,#f8fafc);padding:.75rem;border-radius:6px;border:1px dashed var(--border,#cbd5e1)">
          <div style="flex:1">
            <label class="btn btn-sm btn-outline" style="cursor:pointer;display:inline-flex;align-items:center;gap:.4rem">
              ${icon.upload({ size: 15 })}
              <span>اختر ملف Excel أو CSV</span>
              <input type="file" id="client-import-file" accept=".xlsx,.xls,.csv" style="display:none" />
            </label>
            <span id="client-selected-file" class="tiny muted" style="margin-right:.5rem">لم يتم اختيار ملف</span>
          </div>
          <a class="btn btn-sm btn-ghost" href="/api/clients/template" download="clients-import-template.xlsx">
            ${icon.download({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}تحميل نموذج Excel فارغ
          </a>
        </div>
        <div id="client-import-preview" style="display:none"></div>
      </div>
    `,
    footer: `
      <button class="btn" data-close type="button">إلغاء</button>
      <button class="btn btn-primary" id="commit-client-import" type="button" disabled>اعتماد وإضافة العملاء</button>
    `,
  });

  const fileInput = m.el.querySelector('#client-import-file');
  const fileNameEl = m.el.querySelector('#client-selected-file');
  const previewArea = m.el.querySelector('#client-import-preview');
  const commitBtn = m.el.querySelector('#commit-client-import');
  let parsedClients = [];

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    fileNameEl.textContent = file.name;
    previewArea.style.display = 'block';
    previewArea.innerHTML = '<div class="text-center muted" style="padding:1.5rem">جارٍ قراءة وفحص ملف العملاء…</div>';
    commitBtn.disabled = true;

    try {
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

      const res = await api.post('/api/clients/analyze-excel', { file_base64: b64, filename: file.name });
      parsedClients = (res.rows || []).filter((r) => !r.errors || r.errors.length === 0);

      const errorRows = (res.rows || []).filter((r) => r.errors && r.errors.length > 0);
      let errorsSnippet = '';
      if (errorRows.length) {
        errorsSnippet = `
          <div class="alert alert-danger tiny mt" style="max-height:100px;overflow-y:auto">
            <b>تحذير: تم استبعاد ${errorRows.length} صف لاحتوائها على أخطاء:</b>
            <ul>${errorRows.slice(0, 5).map((er) => `<li>صف ${er.row_index}: ${esc(er.name || 'بدون اسم')} (${er.errors.join('، ')})</li>`).join('')}</ul>
          </div>
        `;
      }

      previewArea.innerHTML = html`
        <div class="card pad0 mt" style="border:1px solid var(--border)">
          <div style="padding:.6rem 1rem;background:var(--bg-subtle);display:flex;justify-content:space-between;align-items:center">
            <b>معاينة العملاء (${parsedClients.length} عميل)</b>
            <span class="badge blue">${res.total_rows} سطر في الملف</span>
          </div>
          <div class="table-wrap" style="max-height:220px;overflow-y:auto">
            <table class="tbl tiny">
              <thead><tr><th>#</th><th>كود</th><th>اسم العميل</th><th>الجوال</th><th>الرقم الضريبي</th><th>السجل التجاري</th><th>المدينة</th><th>الرصيد الافتتاحي</th></tr></thead>
              <tbody>
                ${parsedClients.slice(0, 20).map((c, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td class="mono">${esc(c.client_code || 'تلقائي')}</td>
                    <td><b>${esc(c.name)}</b></td>
                    <td class="mono">${esc(c.phone || '—')}</td>
                    <td class="mono">${esc(c.tax_number || '—')}</td>
                    <td class="mono">${esc(c.commercial_register || '—')}</td>
                    <td>${esc(c.city || '—')}</td>
                    <td class="num">${esc(c.opening_balance || 0)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${parsedClients.length > 20 ? `<div class="tiny muted text-center" style="padding:.4rem">تم عرض أول 20 عميلاً فقط من أصل ${parsedClients.length}…</div>` : ''}
        </div>
        ${raw(errorsSnippet)}
      `;

      if (parsedClients.length > 0) {
        commitBtn.disabled = false;
      } else {
        previewArea.innerHTML += '<div class="alert alert-danger tiny mt">لم يتم العثور على أي عملاء صالحين للاستيراد في الملف</div>';
      }
    } catch (err) {
      previewArea.innerHTML = `<div class="alert alert-danger tiny">${esc(err.message || 'فشل فحص الملف')}</div>`;
    }
  });

  commitBtn.addEventListener('click', async () => {
    if (!parsedClients.length) return;
    commitBtn.disabled = true;
    commitBtn.textContent = 'جارٍ الحفظ في قاعدة البيانات…';
    try {
      const saveRes = await api.post('/api/clients/import', { clients: parsedClients });
      toastOk(`تم استيراد العملاء بنجاح (جديد: ${saveRes.created || 0}، محدث: ${saveRes.updated || 0})`);
      m.close();
      invalidate('clients');
      await loadClients(true);
      await onSuccess();
    } catch (err) {
      commitBtn.disabled = false;
      commitBtn.textContent = 'اعتماد وإضافة العملاء';
      toastErr(err.message || 'فشل استيراد العملاء');
    }
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
    return rows.map((c) => {
      const addrBadges = [
        c.city ? `<span class="badge gray tiny" style="font-size:10px;padding:1px 5px">📍 ${esc(c.city)}</span>` : '',
        c.district ? `<span class="badge gray tiny" style="font-size:10px;padding:1px 5px">حي ${esc(c.district)}</span>` : '',
        c.street ? `<span class="tiny muted" style="font-size:11px">ش. ${esc(c.street)}</span>` : '',
        c.building_no ? `<span class="tiny muted mono" style="font-size:10px">مبنى: ${esc(c.building_no)}</span>` : '',
        c.postal_code ? `<span class="tiny muted mono" style="font-size:10px">(${esc(c.postal_code)})</span>` : '',
      ].filter(Boolean).join(' ');

      return `<tr>
        <td class="mono tiny">${esc(c.client_code)}</td>
        <td>
          <b>${esc(c.name)}</b>
          ${addrBadges ? `<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:3px;align-items:center">${addrBadges}</div>` : ''}
          ${c.mobile ? `<div class="tiny muted mono" style="margin-top:2px">📞 ${esc(c.mobile)}</div>` : ''}
        </td>
        <td class="tiny">${c.client_type === 'INDIVIDUAL' ? 'فرد' : 'شركة'}</td>
        <td class="mono tiny">${esc(c.tax_number || '—')}</td>
        <td class="text-end num">${amount(c.total_invoiced)}</td>
        <td class="text-end num">${amount(c.total_paid)}</td>
        <td class="text-end num" style="font-weight:700;color:${c.balance > 0.004 ? 'var(--danger)' : c.balance < -0.004 ? 'var(--success)' : 'inherit'}">${amount(c.balance)}</td>
        <td class="actions">
          <a class="btn btn-sm" href="#/statement/${esc(c.id)}" title="كشف الحساب">${icon.statement({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}كشف</a>
          <a class="btn btn-sm" href="#/invoice?client_id=${esc(c.id)}" title="فاتورة جديدة">${icon.plus({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}فاتورة</a>
          ${can('clients.write') ? `<button class="btn btn-sm" data-act="edit" data-id="${esc(c.id)}" type="button" title="تعديل">${icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}تعديل</button>` : ''}
          ${can('clients.write') ? `<button class="btn btn-sm btn-danger" data-act="del" data-id="${esc(c.id)}" type="button" title="حذف">${icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}حذف</button>` : ''}
        </td>
      </tr>`;
    }).join('');
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
          ${raw(can('clients.write') ? `<button class="btn btn-outline" id="import-clients-btn" type="button">${icon.upload({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}استيراد Excel</button>` : '')}
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
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.invoiced)}</div><div class="stat-lab">إجمالي المفوتر</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.paid)}</div><div class="stat-lab">إجمالي المسدد</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(t.balance)}</div><div class="stat-lab">صافي الأرصدة</div></div></div>
      </div>

      <div class="card pad0 mt">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th>الكود</th><th>العميل</th><th>النوع</th><th>الرقم الضريبي</th>
              <th class="text-end">المفوتر <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
              <th class="text-end">المسدد <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
              <th class="text-end">الرصيد <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th></th>
            </tr></thead>
            <tbody id="rows">${raw(rowsHtml())}</tbody>
          </table>
        </div>
      </div>`;

    const addBtn = $('#add', view);
    if (addBtn) addBtn.addEventListener('click', () => openClientModal(null, async () => { await load(); draw(); }));
    const importClientsBtn = $('#import-clients-btn', view);
    if (importClientsBtn) importClientsBtn.addEventListener('click', () => openClientImportModal(async () => { await load(); draw(); }));

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

    const headers = ['الكود', 'العميل', 'النوع', 'الرقم الضريبي', 'الجوال', 'المدينة', 'الحي', 'الشارع', 'رقم المبنى', 'الرمز البريدي', 'المفوتر', 'المسدد', 'الرصيد'];
    const dataRows = () => (state.onlyDebtors ? state.rows.filter((c) => c.balance > 0.004) : state.rows)
      .map((c) => [
        c.client_code, c.name, c.client_type === 'INDIVIDUAL' ? 'فرد' : 'شركة', c.tax_number || '',
        c.mobile || '', c.city || '', c.district || '', c.street || '', c.building_no || '', c.postal_code || '',
        money(c.total_invoiced), money(c.total_paid), money(c.balance),
      ]);
    $('#exp-csv', view).addEventListener('click', () => exportCsv(`العملاء-${dateAr(new Date().toISOString())}`, headers, dataRows()));
    $('#exp-xls', view).addEventListener('click', () => exportExcel('العملاء', 'كشف أرصدة العملاء', headers, dataRows()));
  };

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
      const row = btn.closest('tr');
      if (row) row.style.opacity = '0.3';
      try {
        await api.del(`/api/clients/${client.id}`);
        toastOk('تم حذف العميل');
        row?.remove();
        state.rows = state.rows.filter((x) => x.id !== client.id);
        invalidate('clients');
        await load();
        draw();
      } catch {
        if (row) row.style.opacity = '1';
        await load();
        draw();
      }
    }
  });

  await load();
  draw();
  return undefined;
}
