// ==========================================================================
//  محرر الفاتورة (إصدار فاتورة جديدة)
// ==========================================================================
import { api } from '../core/api.js';
import { store, loadClients, loadItems, can, invalidate } from '../core/store.js';
import * as router from '../core/router.js';
import {
  html, raw, esc, money, toNum, today, nowTime, toastOk, toastErr,
  $, $$, delegate, modal, formValues, confirmDialog, icon,
} from '../core/util.js';

const emptyLine = () => ({
  key: Math.random().toString(36).slice(2),
  item_id: '', item_code: '', item_name: '', unit: 'حبة',
  quantity: 1, unit_price: 0, discount: 0, tax_rate: 15,
});

function lineTotals(line) {
  const gross = Math.round(line.quantity * line.unit_price * 100) / 100;
  const taxable = Math.max(0, Math.round((gross - line.discount) * 100) / 100);
  const tax = Math.round(taxable * (line.tax_rate / 100) * 100) / 100;
  return { gross, taxable, tax, total: Math.round((taxable + tax) * 100) / 100 };
}

const DRAFT_KEY = 'zs.invoice_draft';

function saveDraft(state) {
  try {
    const hasLines = state.lines && state.lines.some((l) => (l.item_name && l.item_name.trim()) || l.unit_price > 0);
    if (!state.client_id && !hasLines && !state.notes) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const draft = {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      issue_date: state.issue_date,
      issue_time: state.issue_time,
      invoice_type: state.invoice_type,
      payment_method: state.payment_method,
      invoice_number: state.invoice_number,
      notes: state.notes,
      auto_receipt: state.auto_receipt,
      print_after: state.print_after,
      header_discount_percent: state.header_discount_percent,
      lines: state.lines,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* ignore storage error */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.lines) && data.lines.length > 0) {
      return data;
    }
  } catch {}
  return null;
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export async function render(view, ctx) {
  await Promise.all([loadClients(), loadItems()]);
  const query = (ctx && ctx.query) || {};
  const draft = loadDraft();
  const state = {
    issuer_id: store.activeIssuerId,
    client_id: query.client_id || '',
    issue_date: today(),
    issue_time: nowTime(),
    invoice_type: 'STANDARD',
    payment_method: 'CREDIT',
    invoice_number: '',
    notes: '',
    auto_receipt: false,
    print_after: true,
    header_discount_percent: 0,
    lines: [emptyLine()],
    ...(draft || {}),
  };
  if (query.client_id) state.client_id = query.client_id;
  if (!state.lines || !state.lines.length) state.lines = [emptyLine()];

  const activeIssuers = store.issuers.filter((i) => i.is_active);
  if (!activeIssuers.length) {
    view.innerHTML = html`<div class="card"><div class="empty">
      <h3>لا توجد شركة مصدرة نشطة</h3><p class="muted">أضف شركة مصدرة أولاً لتتمكن من إصدار الفواتير.</p>
      <a class="btn btn-primary" href="#/issuers">إدارة الشركات</a></div></div>`;
    return undefined;
  }
  if (!state.issuer_id || !activeIssuers.some((i) => i.id === state.issuer_id)) state.issuer_id = activeIssuers[0].id;

  const issuerOf = () => activeIssuers.find((i) => i.id === state.issuer_id) || activeIssuers[0];
  const defaultRate = () => Number(issuerOf().default_tax_rate || 15);
  if (state.lines[0].tax_rate === undefined) state.lines[0].tax_rate = defaultRate();

  const totals = () => {
    let subtotal = 0; let discount = 0; let taxable = 0; let tax = 0;
    for (const l of state.lines) {
      const t = lineTotals(l);
      subtotal += t.gross;
      discount += Math.min(l.discount, t.gross);
      taxable += t.taxable;
      tax += t.tax;
    }
    const round = (n) => Math.round(n * 100) / 100;
    return { subtotal: round(subtotal), discount: round(discount), taxable: round(taxable), tax: round(tax), grand: round(taxable + tax) };
  };

  const linesHtml = () => state.lines.map((l, i) => {
    const t = lineTotals(l);
    return `<tr data-key="${l.key}">
      <td class="text-center tiny">${i + 1}</td>
      <td style="min-width:230px">
        <div class="rel">
          <input type="text" data-f="item_name" value="${esc(l.item_name)}" placeholder="اكتب اسم الصنف أو الكود…" autocomplete="off" />
          <div class="item-search-results hidden" data-results></div>
        </div>
        ${l.item_code ? `<div class="tiny muted mono">${esc(l.item_code)}</div>` : ''}
      </td>
      <td style="width:78px"><input type="text" data-f="unit" value="${esc(l.unit)}" /></td>
      <td style="width:86px"><input type="number" data-f="quantity" value="${l.quantity}" step="0.001" min="0.001" /></td>
      <td style="width:104px"><input type="number" data-f="unit_price" value="${l.unit_price}" step="0.01" min="0" /></td>
      <td style="width:96px"><input type="number" data-f="discount" value="${l.discount}" step="0.01" min="0" /></td>
      <td style="width:74px"><input type="number" data-f="tax_rate" value="${l.tax_rate}" step="0.01" min="0" max="100" /></td>
      <td class="text-end num" style="width:92px">${money(t.taxable)}</td>
      <td class="text-end num" style="width:84px">${money(t.tax)}</td>
      <td class="text-end num" style="width:98px"><b>${money(t.total)}</b></td>
      <td class="actions">
        <button class="btn btn-sm" data-act="dup" type="button" title="تكرار البند">${icon.copy({ size: 13, style: 'vertical-align:text-bottom;margin-left:2px' })}تكرار</button>
        <button class="btn btn-sm btn-danger" data-act="rm" type="button" title="حذف البند">${icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:2px' })}حذف</button>
      </td>
    </tr>`;
  }).join('');

  const totalsHtml = () => {
    const t = totals();
    return `
      <div class="line"><span>الإجمالي قبل الخصم</span><span class="num">${money(t.subtotal)}</span></div>
      <div class="line"><span>الخصم</span><span class="num">${money(t.discount)}</span></div>
      <div class="line"><span>الإجمالي الخاضع للضريبة</span><span class="num">${money(t.taxable)}</span></div>
      <div class="line"><span>ضريبة القيمة المضافة</span><span class="num">${money(t.tax)}</span></div>
      <div class="line grand"><span>الإجمالي المستحق</span><span class="num">${money(t.grand)}</span></div>
      <div class="line tiny muted"><span>عدد البنود</span><span class="num">${state.lines.length}</span></div>`;
  };

  const draw = () => {
    const iss = issuerOf();
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>فاتورة ضريبية جديدة</h1>
          <p>الترقيم تلقائي لكل شركة، ويتم توليد رمز QR وبصمة الفاتورة عند الحفظ.${draft ? ' <span class="badge blue">تم استعادة المسودة تلقائياً</span>' : ''}</p>
        </div>
        <div class="page-actions">
          <button class="btn" id="reset" type="button">${icon.refresh({ size: 15, style: 'vertical-align:text-bottom;margin-left:3px' })}تفريغ</button>
          <button class="btn btn-primary" id="save" type="button">${icon.check({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}حفظ وإصدار الفاتورة</button>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <div class="field"><label class="req">الشركة المصدرة</label>
            <select id="issuer">
              ${raw(activeIssuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
            </select>
            <span class="hint">الرقم القادم: <span class="mono">${esc(iss.invoice_prefix)}-${String(iss.invoice_next_no).padStart(iss.invoice_pad, '0')}</span></span>
          </div>
          <div class="field" style="flex:1.4"><label class="req">العميل</label>
            <div class="flex" style="gap:.35rem">
              <select id="client" style="flex:1">
                <option value="">— اختر العميل —</option>
                ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
              </select>
              ${raw(can('clients.write') ? `<button class="btn" id="new-client" type="button" title="عميل جديد">${icon.userPlus({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}عميل جديد</button>` : '')}
            </div>
          </div>
          <div class="field" style="max-width:150px"><label>نوع الفاتورة</label>
            <select id="invoice_type">
              <option value="STANDARD" ${raw(state.invoice_type === 'STANDARD' ? 'selected' : '')}>ضريبية</option>
              <option value="SIMPLIFIED" ${raw(state.invoice_type === 'SIMPLIFIED' ? 'selected' : '')}>مبسطة</option>
            </select>
          </div>
        </div>
        <div class="row mt">
          <div class="field" style="max-width:160px"><label>التاريخ</label>
            <input type="date" id="issue_date" value="${state.issue_date}" ${raw(can('invoices.backdate') ? '' : 'readonly title="لا تملك صلاحية تغيير التاريخ"')} /></div>
          <div class="field" style="max-width:130px"><label>الوقت</label>
            <input type="time" id="issue_time" value="${state.issue_time}" step="1" /></div>
          <div class="field" style="max-width:170px"><label>طريقة الدفع</label>
            <select id="payment_method">
              ${raw(Object.entries(store.meta.payment_methods).map(([k, v]) => `<option value="${esc(k)}" ${k === state.payment_method ? 'selected' : ''}>${esc(v)}</option>`).join(''))}
            </select></div>
          <div class="field" style="max-width:190px"><label>رقم فاتورة يدوي (اختياري)</label>
            <input type="text" id="invoice_number" value="${esc(state.invoice_number)}" class="ltr" placeholder="تلقائي" /></div>
          <div class="field" style="max-width:150px"><label>خصم عام %</label>
            <input type="number" id="header_discount" value="${state.header_discount_percent}" min="0" max="100" step="0.01" /></div>
        </div>
      </div>

      <div class="card pad0">
        <div class="card-head">
          <h3>بنود الفاتورة</h3>
          <div class="spacer"></div>
          <span class="tiny muted">ابحث عن الصنف بالاسم أو الكود، أو اكتب وصفاً حراً</span>
          <button class="btn btn-sm" id="add-line" type="button">${icon.plus({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}إضافة بند</button>
        </div>
        <div class="table-wrap">
          <table class="tbl compact" id="lines-tbl">
            <thead><tr>
              <th style="width:26px">#</th><th>الصنف / الوصف</th><th>الوحدة</th><th>الكمية</th>
              <th>السعر</th><th>الخصم</th><th>الضريبة %</th>
              <th class="text-end">قبل الضريبة</th><th class="text-end">الضريبة</th><th class="text-end">الإجمالي</th><th></th>
            </tr></thead>
            <tbody id="lines">${raw(linesHtml())}</tbody>
          </table>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>ملاحظات وخيارات</h3>
          <div class="field"><label>ملاحظات تظهر في الفاتورة</label>
            <textarea id="notes" style="min-height:70px">${esc(state.notes)}</textarea></div>
          <label class="check mt"><input type="checkbox" id="auto_receipt" ${raw(state.auto_receipt ? 'checked' : '')} />
            إنشاء سند قبض تلقائي بكامل المبلغ (للفواتير غير الآجلة)</label>
          <label class="check"><input type="checkbox" id="print_after" ${raw(state.print_after ? 'checked' : '')} />
            الانتقال لشاشة الفاتورة للتحميل والمشاركة بعد الحفظ</label>
        </div>
        <div class="card">
          <h3>الإجماليات</h3>
          <div class="totals-box" id="totals">${raw(totalsHtml())}</div>
          <button class="btn btn-primary btn-block mt" id="save2" type="button">${icon.check({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}حفظ وإصدار الفاتورة</button>
        </div>
      </div>`;

    bind();
  };

  const refreshLines = () => {
    $('#lines', view).innerHTML = linesHtml();
    $('#totals', view).innerHTML = totalsHtml();
    saveDraft(state);
  };
  const refreshTotals = () => {
    $('#totals', view).innerHTML = totalsHtml();
    saveDraft(state);
  };

  function applyItem(line, item) {
    line.item_id = item.id;
    line.item_code = item.item_code;
    line.item_name = item.name_ar;
    line.unit = item.unit;
    line.unit_price = item.sale_price;
    line.tax_rate = item.tax_rate;
    saveDraft(state);
  }

  function bind() {
    $('#issuer', view).addEventListener('change', (e) => {
      state.issuer_id = e.target.value;
      saveDraft(state);
      draw();
    });
    $('#client', view).addEventListener('change', (e) => { state.client_id = e.target.value; saveDraft(state); });
    $('#invoice_type', view).addEventListener('change', (e) => { state.invoice_type = e.target.value; saveDraft(state); });
    $('#issue_date', view).addEventListener('change', (e) => { state.issue_date = e.target.value; saveDraft(state); });
    $('#issue_time', view).addEventListener('change', (e) => { state.issue_time = e.target.value; saveDraft(state); });
    $('#payment_method', view).addEventListener('change', (e) => { state.payment_method = e.target.value; saveDraft(state); });
    $('#invoice_number', view).addEventListener('input', (e) => { state.invoice_number = e.target.value; saveDraft(state); });
    $('#header_discount', view).addEventListener('input', (e) => { state.header_discount_percent = toNum(e.target.value); saveDraft(state); });
    $('#notes', view).addEventListener('input', (e) => { state.notes = e.target.value; saveDraft(state); });
    $('#auto_receipt', view).addEventListener('change', (e) => { state.auto_receipt = e.target.checked; saveDraft(state); });
    $('#print_after', view).addEventListener('change', (e) => { state.print_after = e.target.checked; saveDraft(state); });
    $('#add-line', view).addEventListener('click', () => {
      const l = emptyLine();
      l.tax_rate = defaultRate();
      state.lines.push(l);
      refreshLines();
      const inputs = $$('#lines tr [data-f=item_name]', view);
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    $('#reset', view).addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'تفريغ الفاتورة', message: 'سيتم مسح كل البنود والبيانات المدخلة.' })) return;
      clearDraft();
      state.lines = [emptyLine()];
      state.lines[0].tax_rate = defaultRate();
      state.notes = '';
      state.invoice_number = '';
      draw();
    });
    const newClientBtn = $('#new-client', view);
    if (newClientBtn) {
      newClientBtn.addEventListener('click', () => {
        const m = modal({
          title: 'عميل جديد (سريع)',
          slim: true,
          body: html`
            <div class="field"><label class="req">اسم العميل</label><input type="text" name="name" /></div>
            <div class="field mt"><label>الجوال</label><input type="text" name="mobile" class="ltr" /></div>
            <div class="field mt"><label>الرقم الضريبي</label><input type="text" name="tax_number" class="ltr" maxlength="15" /></div>
            <div class="field mt"><label>المدينة</label><input type="text" name="city" /></div>`,
          footer: `<button class="btn" data-close type="button">إلغاء</button>
                   <button class="btn btn-primary" data-ok type="button">إضافة</button>`,
        });
        m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
          const values = formValues(m.body);
          if (!values.name) return toastErr('اسم العميل مطلوب');
          e.target.disabled = true;
          try {
            const created = await api.post('/api/clients', values);
            invalidate('clients');
            await loadClients(true);
            state.client_id = created.id;
            m.close();
            toastOk('تمت إضافة العميل');
            draw();
          } catch { e.target.disabled = false; }
          return undefined;
        });
      });
    }

    // تعديل حقول البنود
    delegate($('#lines', view), 'input', 'input[data-f]', (e, input) => {
      const key = input.closest('tr').dataset.key;
      const line = state.lines.find((l) => l.key === key);
      if (!line) return;
      const field = input.dataset.f;
      if (field === 'item_name') {
        line.item_name = input.value;
        line.item_id = line.item_id && input.value ? line.item_id : '';
        showSuggestions(input, line);
        return;
      }
      if (field === 'unit') line.unit = input.value;
      else line[field] = toNum(input.value);
      // تحديث خلايا الإجماليات لهذا الصف فقط
      const t = lineTotals(line);
      const cells = input.closest('tr').querySelectorAll('td');
      cells[7].textContent = money(t.taxable);
      cells[8].textContent = money(t.tax);
      cells[9].innerHTML = `<b>${money(t.total)}</b>`;
      refreshTotals();
    });

    delegate($('#lines', view), 'click', '[data-act]', (e, btn) => {
      const key = btn.closest('tr').dataset.key;
      const idx = state.lines.findIndex((l) => l.key === key);
      if (idx < 0) return;
      if (btn.dataset.act === 'rm') {
        if (state.lines.length === 1) {
          state.lines = [emptyLine()];
          state.lines[0].tax_rate = defaultRate();
        } else state.lines.splice(idx, 1);
      } else if (btn.dataset.act === 'dup') {
        state.lines.splice(idx + 1, 0, { ...state.lines[idx], key: Math.random().toString(36).slice(2) });
      }
      refreshLines();
    });

    // اختصارات: Enter في آخر بند يضيف بنداً جديداً
    delegate($('#lines', view), 'keydown', 'input', (e, input) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const results = input.parentElement.querySelector('[data-results]');
        if (results && !results.classList.contains('hidden')) {
          const sel = results.querySelector('.sel') || results.querySelector('div');
          if (sel) { sel.click(); return; }
        }
        $('#add-line', view).click();
      }
    });

    $('#save', view).addEventListener('click', save);
    $('#save2', view).addEventListener('click', save);
  }

  function showSuggestions(input, line) {
    const box = input.parentElement.querySelector('[data-results]');
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) { box.classList.add('hidden'); return; }
    const matches = store.items.filter((it) => it.name_ar.toLowerCase().includes(q)
      || (it.name_en || '').toLowerCase().includes(q)
      || (it.item_code || '').toLowerCase().includes(q)
      || (it.barcode || '').includes(q)).slice(0, 12);
    if (!matches.length) { box.classList.add('hidden'); return; }
    box.innerHTML = matches.map((it) => `<div data-id="${esc(it.id)}">
        <b>${esc(it.name_ar)}</b>
        <span class="tiny muted mono"> ${esc(it.item_code)} · ${money(it.sale_price)} / ${esc(it.unit)}</span>
      </div>`).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('div[data-id]').forEach((el) => {
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const item = store.items.find((x) => x.id === el.dataset.id);
        if (item) applyItem(line, item);
        box.classList.add('hidden');
        refreshLines();
      });
    });
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150), { once: true });
  }

  async function save(e) {
    const btn = e.currentTarget;
    if (!state.client_id) return toastErr('اختر العميل أولاً');
    const lines = state.lines
      .filter((l) => l.item_name.trim() && l.quantity > 0)
      .map((l) => ({
        item_id: l.item_id || null,
        item_code: l.item_code,
        item_name: l.item_name.trim(),
        unit: l.unit,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount: l.discount,
        tax_rate: l.tax_rate,
      }));
    if (!lines.length) return toastErr('أضف بنداً واحداً على الأقل مع اسم وكمية');

    btn.disabled = true;
    try {
      const invoice = await api.post('/api/invoices', {
        issuer_id: state.issuer_id,
        client_id: state.client_id,
        issue_date: state.issue_date,
        issue_time: state.issue_time,
        invoice_type: state.invoice_type,
        payment_method: state.payment_method,
        invoice_number: state.invoice_number || undefined,
        discount_percent: state.header_discount_percent || undefined,
        notes: state.notes,
        auto_receipt: state.auto_receipt,
        lines,
      });
      clearDraft();
      toastOk(`تم إصدار الفاتورة ${invoice.invoice_number} بمبلغ ${money(invoice.grand_total)}`);
      invalidate('issuers');
      if (state.print_after) {
        router.go(`invoice-view/${invoice.id}`);
      } else {
        state.lines = [emptyLine()];
        state.lines[0].tax_rate = defaultRate();
        state.invoice_number = '';
        state.notes = '';
        draw();
      }
    } catch {
      btn.disabled = false;
    }
    return undefined;
  }

  draw();
  return undefined;
}
