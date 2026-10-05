// ==========================================================================
//  سندات القبض: قائمة، سند مجمّع بتوزيع على عدة فواتير، عرض وطباعة وإلغاء.
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, can, currencyLabel, getFilterState, setFilterState, clearFilterState } from '../core/store.js';

const syncNotify = (entity, action, payload) => (typeof store.syncNotify === 'function' ? store.syncNotify(entity, action, payload) : null);
const onSync = (cb) => (typeof store.onSync === 'function' ? store.onSync(cb) : () => { });
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, today, monthStart, toastOk, toastErr,
  $, $$, delegate, debounce, modal, formValues, confirmDialog, exportCsv, exportExcel, printDoc, toNum,
  icon, downloadPdfFromHtml, downloadPdfFromUrl, amount, sarSvg, shareDocument, renderStoredVoucher, clientPdfFilename,
  loadStoredTemplate, fillStoredTemplate,
} from '../core/util.js';
import * as _coreUtil from '../core/util.js';
const fillDynamicTemplateHtml = _coreUtil.fillDynamicTemplateHtml || ((html) => html);

const PAGE = 50;

/** نافذة سند القبض المجمّع أو المنفصل (سند لكل فاتورة) مع تأخير التاريخ وفجوة التسلسل. */
export function voucherWizard({ clientId = '', issuerId = '', mode = 'single', onDone }) {
  const cur = currencyLabel();
  let batchMode = false;   // false = سند واحد مجمع, true = سند منفصل لكل فاتورة
  let installMode = false; // true = سندات دفعية (أقساط) على تواريخ مستقبلية

  const m = modal({
    title: mode === 'install' ? 'إنشاء سندات قبض دفعية (أقساط)' : (mode === 'batch' ? 'إنشاء سند منفصل لكل فاتورة' : 'سند قبض جديد'),
    wide: true,
    body: html`
      <div id="w-mode-bar">
        <button type="button" id="btn-mode-single" class="btn btn-sm" title="سند قبض واحد عادي بمبلغ محدد">
          سند عادي موحد
        </button>
        <button type="button" id="btn-mode-install" class="btn btn-sm" title="توليد سندات دفعية مجدولة على أقساط وتواريخ مستقبلية">
          السندات الدفعية (أقساط)
        </button>
        <button type="button" id="btn-mode-batch" class="btn btn-sm" title="إنشاء سند منفصل لكل فاتورة مفتوحة">
          سند منفصل لكل فاتورة
        </button>
      </div>

      <div class="form-grid-3">
        <div class="field"><label class="req">الشركة المصدرة</label>
          <select name="issuer_id" id="w-issuer">
            ${raw(store.issuers.filter((i) => i.is_active).map((i) => `<option value="${esc(i.id)}" ${i.id === issuerId ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
          </select></div>
        <div class="field"><label class="req">العميل</label>
          <select name="client_id" id="w-client">
            <option value="">— اختر العميل —</option>
            ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === clientId ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
          </select></div>
        <div class="field" id="w-date-wrap"><label>التاريخ</label>
          <input type="date" name="voucher_date" id="w-date" value="${today()}" /></div>
      </div>

      <div id="w-batch-opts" class="row mt" style="gap:10px;display:none;align-items:center;background:var(--card);padding:8px 12px;border-radius:8px;border:1px solid var(--line)">
        <div class="field" style="margin:0;min-width:140px">
          <label style="font-size:12px;margin-bottom:2px">تأخير التاريخ (أيام)</label>
          <input type="number" id="w-date-offset" value="2" min="0" max="7" style="width:70px" />
        </div>
        <div class="field" style="margin:0;min-width:140px">
          <label style="font-size:12px;margin-bottom:2px">فجوة التسلسل</label>
          <input type="number" id="w-seq-gap" value="2" min="0" max="20" style="width:70px" />
        </div>
      </div>

      <div id="w-single-opts" class="form-grid-4 mt">
        <div class="field"><label class="req">المبلغ المستلم (${esc(cur)})</label>
          <input type="number" name="total_amount" id="w-amount" value="" step="0.01" min="0.01" /></div>
        <div class="field"><label>طريقة السداد</label>
          <select name="payment_type" id="w-pay-type">
            <option value="CASH">نقداً</option><option value="TRANSFER">تحويل بنكي</option>
            <option value="CARD">شبكة / بطاقة</option><option value="CHEQUE">شيك</option>
          </select></div>
        <div class="field"><label>رقم المرجع / الشيك</label><input type="text" name="reference_no" class="ltr" /></div>
        <div class="field"><label>ملاحظات</label><input type="text" name="notes" /></div>
      </div>
      <div id="w-batch-pay" class="form-grid-2 mt" style="display:none">
        <div class="field"><label>طريقة السداد (لجميع السندات)</label>
          <select id="w-batch-pay-type">
            <option value="CASH">نقداً</option><option value="TRANSFER">تحويل بنكي</option>
            <option value="CARD">شبكة / بطاقة</option><option value="CHEQUE">شيك</option>
          </select></div>
        <div class="field"><label>رقم المرجع / الشيك</label><input type="text" id="w-batch-ref" class="ltr" /></div>
      </div>

      <!-- ── وضع السندات الدفعية ──────────────────────────────────────────── -->
      <div id="w-install-opts" class="mt" style="display:none">
        <div class="alert alert-info tiny" style="margin-bottom:10px">
          <b>وضع السندات الدفعية</b> — حدد العميل ثم الإجمالي وعدد الدفعات والتواتر.
          يمكنك اختيار فواتير محددة للتوزيع التلقائي (FIFO)، أو تركها بدون تخصيص.
        </div>
        <div class="form-grid-4">
          <div class="field"><label class="req">عدد الدفعات</label>
            <input type="number" id="w-inst-count" value="3" min="2" max="24" /></div>
          <div class="field"><label class="req">تاريخ أول دفعة</label>
            <input type="date" id="w-inst-start" /></div>
          <div class="field"><label>التواتر</label>
            <select id="w-inst-freq">
              <option value="7">أسبوعياً</option>
              <option value="14">نصف شهرياً</option>
              <option value="30" selected>شهرياً</option>
              <option value="60">كل شهرين</option>
              <option value="90">ربع سنوي</option>
            </select></div>
          <div class="field"><label class="req">الإجمالي (${esc(cur)})</label>
            <input type="number" id="w-inst-total" step="0.01" min="0.01" /></div>
        </div>
        <div class="form-grid-2 mt">
          <div class="field"><label>طريقة الدفع (لكل الدفعات)</label>
            <select id="w-inst-pay">
              <option value="CASH">نقداً</option><option value="TRANSFER">تحويل بنكي</option>
              <option value="CARD">شبكة / بطاقة</option><option value="CHEQUE">شيك</option>
            </select></div>
          <div class="field"><label>رقم المرجع / الشيك</label>
            <input type="text" id="w-inst-ref" class="ltr" /></div>
        </div>
        <div id="w-inst-preview"></div>
      </div>

      <div class="alert alert-info mt tiny" id="w-hint">
        اختر العميل لعرض فواتيره غير المسددة. يمكنك التوزيع تلقائياً من الأقدم للأحدث، أو إدخال مبلغ لكل فاتورة يدوياً،
        أو تركها بدون توزيع ليبقى المبلغ رصيداً دائناً للعميل.
      </div>
      <div id="w-open"></div>
      <div id="w-batch-progress" style="display:none"></div>`,
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn" data-fifo type="button">توزيع تلقائي (الأقدم أولاً)</button>
             <button class="btn btn-primary" data-ok type="button">حفظ السند</button>`,
  });

  let open = [];
  const alloc = new Map();

  // ── أدوات مساعدة ─────────────────────────────────────────────────────────
  const setActiveBtn = (btnEl, active) => {
    if (!btnEl) return;
    btnEl.classList.toggle('active', !!active);
  };

  // ── تحديث معاينة الدفعات ────────────────────────────────────────────────
  const updateInstallPreview = () => {
    const count = parseInt($('#w-inst-count', m.body)?.value, 10) || 0;
    const start = $('#w-inst-start', m.body)?.value;
    const freq = parseInt($('#w-inst-freq', m.body)?.value, 10) || 30;
    const total = toNum($('#w-inst-total', m.body)?.value, 0);
    const preview = $('#w-inst-preview', m.body);
    if (!preview) return;
    if (!start || !total || count < 2) { preview.innerHTML = ''; return; }

    const base = Math.floor((total / count) * 100) / 100;
    const last = Math.round((total - base * (count - 1)) * 100) / 100;
    const rows = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(start + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + freq * i);
      rows.push({ n: i + 1, date: d.toISOString().substring(0, 10), amt: i === count - 1 ? last : base });
    }
    const totalCalc = rows.reduce((a, r) => a + r.amt, 0);
    preview.innerHTML = `
      <div style="margin-top:12px;border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="background:var(--brand-light);padding:8px 14px;font-size:12px;font-weight:700;color:var(--brand);display:flex;justify-content:space-between">
          <span>📅 جدول الدفعات — ${count} دفعة</span>
          <span>الإجمالي: ${money(totalCalc)} ${cur}</span>
        </div>
        <table class="tbl compact" style="margin:0">
          <thead><tr><th style="width:36px">#</th><th>تاريخ الدفعة</th><th class="text-end">المبلغ</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td class="muted">${r.n}</td>
            <td class="mono ltr">${r.date}</td>
            <td class="text-end num">${money(r.amt)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  };

  // ── تبديل الوضع (موحد / دفعي / منفصل) ──────────────────────────────────
  const updateModeTabs = (curMode) => {
    setActiveBtn($('#btn-mode-single', m.body), curMode === 'single');
    setActiveBtn($('#btn-mode-install', m.body), curMode === 'install');
    setActiveBtn($('#btn-mode-batch', m.body), curMode === 'batch');
  };

  const resetAllModes = () => {
    batchMode = false; installMode = false;
    updateModeTabs('single');
    $('#w-batch-opts', m.body).style.display = 'none';
    $('#w-batch-pay', m.body).style.display = 'none';
    $('#w-install-opts', m.body).style.display = 'none';
    $('#w-single-opts', m.body).style.display = 'grid';
    $('#w-date-wrap', m.body).style.opacity = ''; $('#w-date-wrap', m.body).title = '';
    $('#w-hint', m.body).style.display = '';
    m.el.querySelector('[data-fifo]').style.display = '';
    m.el.querySelector('[data-ok]').textContent = 'حفظ السند';
  };

  const toggleBatch = () => {
    resetAllModes();
    batchMode = true;
    updateModeTabs('batch');
    $('#w-batch-opts', m.body).style.display = 'flex';
    $('#w-batch-pay', m.body).style.display = 'grid';
    $('#w-single-opts', m.body).style.display = 'none';
    $('#w-date-wrap', m.body).style.opacity = '0.4';
    $('#w-date-wrap', m.body).title = 'التاريخ يُحسب تلقائياً من تاريخ كل فاتورة + التأخير';
    $('#w-hint', m.body).style.display = 'none';
    m.el.querySelector('[data-fifo]').style.display = 'none';
    m.el.querySelector('[data-ok]').textContent = 'إنشاء سند لكل فاتورة';
    if (open.length) renderOpen();
  };

  const toggleInstall = () => {
    resetAllModes();
    installMode = true;
    updateModeTabs('install');
    $('#w-install-opts', m.body).style.display = 'block';
    $('#w-single-opts', m.body).style.display = 'none';
    $('#w-date-wrap', m.body).style.opacity = '0.4';
    $('#w-date-wrap', m.body).title = 'التاريخ يُحدَّد لكل دفعة على حدة';
    $('#w-hint', m.body).style.display = 'none';
    m.el.querySelector('[data-fifo]').style.display = 'none';
    m.el.querySelector('[data-ok]').textContent = 'إنشاء الدفعات';
    // اضبط تاريخ أول دفعة الشهر القادم تلقائياً
    if (!$('#w-inst-start', m.body).value) {
      const nx = new Date(); nx.setUTCMonth(nx.getUTCMonth() + 1); nx.setUTCDate(1);
      $('#w-inst-start', m.body).value = nx.toISOString().substring(0, 10);
    }
    ['#w-inst-count', '#w-inst-start', '#w-inst-freq', '#w-inst-total'].forEach((sel) => {
      $('#' + sel.slice(1), m.body)?.addEventListener('input', updateInstallPreview);
    });
    updateInstallPreview();
    if (open.length) renderOpen();
  };

  $('#btn-mode-single', m.body)?.addEventListener('click', resetAllModes);
  $('#btn-mode-install', m.body)?.addEventListener('click', toggleInstall);
  $('#btn-mode-batch', m.body)?.addEventListener('click', toggleBatch);

  if (mode === 'install') toggleInstall();
  else if (mode === 'batch') toggleBatch();
  else resetAllModes();

  // ── رسم جدول الفواتير المفتوحة ───────────────────────────────────────────
  const renderOpen = () => {
    const box = $('#w-open', m.body);
    if (!open.length) {
      box.innerHTML = '<div class="alert alert-warn tiny">لا توجد فواتير غير مسددة لهذا العميل بهذه الشركة — سيُسجَّل المبلغ كرصيد دائن.</div>';
      return;
    }
    const offset = parseInt($('#w-date-offset', m.body)?.value || '2', 10);
    const totalOpen = open.reduce((a, i) => a + i.remaining_amount, 0);
    const totalAlloc = Array.from(alloc.values()).reduce((a, b) => a + b, 0);
    const enteredAmount = toNum($('#w-amount', m.body)?.value, 0);

    const batchDateCol = batchMode ? `<th>تاريخ السند</th>` : '';
    const batchDateCell = (inv) => {
      if (!batchMode) return '';
      const d = new Date(inv.issue_date + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + offset);
      return `<td class="tiny">${d.toISOString().substring(0, 10)}</td>`;
    };

    box.innerHTML = `
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="tbl compact">
          <thead><tr><th style="width:30px"></th><th>الفاتورة</th><th>تاريخ الفاتورة</th>
            ${batchDateCol}
            <th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">المتبقي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            ${batchMode ? '' : `<th style="width:130px">المبلغ الموزّع <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>`}</tr></thead>
          <tbody>
            ${open.map((i) => `<tr>
              <td><input type="checkbox" data-pick="${esc(i.id)}" ${alloc.has(i.id) ? 'checked' : ''} /></td>
              <td class="mono">${esc(i.invoice_number)}</td>
              <td class="tiny">${esc(dateAr(i.issue_date))}</td>
              ${batchDateCell(i)}
              <td class="text-end num tiny">${amount(i.grand_total)}</td>
              <td class="text-end num">${amount(i.remaining_amount)}</td>
              ${batchMode ? '' : `<td><input type="number" data-amt="${esc(i.id)}" value="${alloc.get(i.id) || ''}" step="0.01" min="0" max="${i.remaining_amount}" /></td>`}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="row mt tiny">
        <div>إجمالي المتبقي على الفواتير: <b class="num">${amount(totalOpen)}</b></div>
        <div class="spacer"></div>
        ${batchMode
        ? `<div>المحدد: <b class="num">${amount(totalAlloc)}</b> — <span class="muted">${alloc.size} فاتورة</span></div>`
        : `<div>الموزّع: <b class="num">${amount(totalAlloc)}</b>${enteredAmount ? ` / غير موزّع: <b class="num" style="color:${Math.abs(enteredAmount - totalAlloc) < 0.005 ? 'var(--success)' : 'var(--warn)'}">${amount(Math.round((enteredAmount - totalAlloc) * 100) / 100)}</b>` : ''}</div>`}
      </div>`;

    $$('[data-pick]', box).forEach((cb) => cb.addEventListener('change', () => {
      const id = cb.dataset.pick;
      const inv = open.find((x) => x.id === id);
      if (cb.checked) {
        if (batchMode) {
          alloc.set(id, inv.remaining_amount);
        } else {
          const amt = toNum($('#w-amount', m.body).value, 0);
          const used = Array.from(alloc.values()).reduce((a, b) => a + b, 0);
          const avail = amt ? Math.max(0, Math.round((amt - used) * 100) / 100) : inv.remaining_amount;
          alloc.set(id, Math.min(inv.remaining_amount, avail || inv.remaining_amount));
        }
      } else alloc.delete(id);
      renderOpen();
    }));
    $$('[data-amt]', box).forEach((inp) => inp.addEventListener('change', () => {
      const id = inp.dataset.amt;
      const v = toNum(inp.value, 0);
      if (v > 0) alloc.set(id, v); else alloc.delete(id);
      renderOpen();
    }));
    if (!batchMode && alloc.size === 1) {
      const invId = Array.from(alloc.keys())[0];
      const singleInv = open.find((x) => x.id === invId);
      const notesInp = $('input[name="notes"]', m.body);
      if (singleInv && notesInp && (!notesInp.value || notesInp.value.startsWith('وذلك مقابل سداد فاتورة رقم '))) {
        notesInp.value = `وذلك مقابل سداد فاتورة رقم ${singleInv.invoice_number}`;
      }
    }
  };

  // ── تحديث جدول عند تغيير التأخير ─────────────────────────────────────────
  $('#w-date-offset', m.body).addEventListener('input', () => { if (open.length) renderOpen(); });

  const loadOpen = async () => {
    const clientSel = $('#w-client', m.body).value;
    alloc.clear();
    if (!clientSel) { open = []; $('#w-open', m.body).innerHTML = ''; return; }
    open = await api.get(qs('/api/invoices/open', { client_id: clientSel, issuer_id: $('#w-issuer', m.body).value }));
    if (batchMode) alloc.clear(); // reset selections on reload
    renderOpen();
  };

  $('#w-client', m.body).addEventListener('change', loadOpen);
  $('#w-issuer', m.body).addEventListener('change', loadOpen);
  $('#w-amount', m.body).addEventListener('input', () => { if (open.length) renderOpen(); });

  // ── توزيع تلقائي (الأقدم أولاً) — وضع السند الموحد فقط ──────────────────
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

  // ── حفظ — وضع السند الموحد ────────────────────────────────────────────────
  m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
    if (installMode) { await runInstallmentVouchers(e); return; }
    if (batchMode) { await runBatchVouchers(e); return; }

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
      syncNotify('vouchers', 'create', voucher);
      syncNotify('invoices', 'update');
      m.close();
      if (onDone) onDone(voucher);
      showVoucher(voucher.id, onDone);
    } catch { e.target.disabled = false; }
    return undefined;
  });

  // ── إنشاء سندات منفصلة (Batch Mode) ─────────────────────────────────────
  const runBatchVouchers = async (e) => {
    const clientSel = $('#w-client', m.body).value;
    const issuerSel = $('#w-issuer', m.body).value;
    if (!clientSel || !issuerSel) return toastErr('اختر الشركة والعميل');
    if (alloc.size === 0) return toastErr('حدد فاتورة واحدة على الأقل');

    const offset = parseInt($('#w-date-offset', m.body).value || '2', 10);
    const seqGap = parseInt($('#w-seq-gap', m.body).value || '2', 10);
    const payType = $('#w-batch-pay-type', m.body).value || 'TRANSFER';
    const refNo = $('#w-batch-ref', m.body).value || '';

    const selectedInvoices = open.filter((i) => alloc.has(i.id));
    const total = selectedInvoices.reduce((a, i) => a + i.remaining_amount, 0);

    const ok = await confirmDialog({
      title: `إنشاء ${selectedInvoices.length} سند قبض منفصل`,
      message: `سيتم إنشاء ${selectedInvoices.length} سند منفصل بإجمالي ${money(total)} ر.س.\n• تأخير التاريخ: ${offset} أيام من تاريخ كل فاتورة\n• فجوة التسلسل: ${seqGap} رقم بين كل سند\n\nهل تريد المتابعة؟`,
      confirmText: 'نعم، ابدأ الإنشاء',
    });
    if (!ok) return;

    e.target.disabled = true;
    m.el.querySelector('[data-fifo]').disabled = true;
    m.el.querySelector('[data-close]').disabled = true;

    const progressBox = $('#w-batch-progress', m.body);
    progressBox.style.display = 'block';

    const created = [];
    const errors = [];

    for (let i = 0; i < selectedInvoices.length; i++) {
      const inv = selectedInvoices[i];

      // حساب تاريخ السند
      const d = new Date(inv.issue_date + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + offset);
      const vDate = d.toISOString().substring(0, 10);

      // تقدم التسلسل (فجوة) إن طُلب
      if (seqGap > 0) {
        try { await api.post(`/api/issuers/${issuerSel}/advance-voucher-seq`, { steps: seqGap }); } catch { /* تجاهل */ }
      }

      // تحديث مؤشر التقدم
      progressBox.innerHTML = `
        <div class="alert alert-info tiny" style="margin-top:10px">
          <b>جاري الإنشاء…</b> ${i + 1} / ${selectedInvoices.length} — فاتورة رقم ${inv.invoice_number}
          <div style="height:6px;background:#e2e8f0;border-radius:3px;margin-top:6px">
            <div style="height:100%;background:var(--brand);border-radius:3px;width:${Math.round(((i + 1) / selectedInvoices.length) * 100)}%;transition:width .3s"></div>
          </div>
        </div>`;

      try {
        const v = await api.post('/api/vouchers', {
          issuer_id: issuerSel,
          client_id: clientSel,
          voucher_date: vDate,
          total_amount: inv.remaining_amount,
          payment_type: payType,
          reference_no: refNo,
          notes: `وذلك مقابل سداد فاتورة رقم ${inv.invoice_number}`,
          allocations: [{ invoice_id: inv.id, amount: inv.remaining_amount }],
        });
        created.push({ num: v.voucher_number, inv: inv.invoice_number, date: vDate, amount: inv.remaining_amount });
      } catch (err) {
        errors.push({ inv: inv.invoice_number, err: err.message || 'خطأ غير معروف' });
      }

      // تأخير بسيط بين الطلبات
      await new Promise((r) => setTimeout(r, 150));
    }

    syncNotify('vouchers', 'create', {});
    syncNotify('invoices', 'update');

    // ── عرض ملخص Batch ──────────────────────────────────────────────────────
    const totalCreated = created.reduce((a, v) => a + v.amount, 0);
    progressBox.innerHTML = `
      <div class="card" style="margin-top:12px;border:2px solid var(--success);padding:14px;border-radius:8px">
        <div style="font-weight:700;color:var(--success);margin-bottom:8px">
          تم إنشاء ${created.length} سند بنجاح${errors.length ? ` — ${errors.length} خطأ` : ''}
        </div>
        <div class="table-wrap" style="max-height:220px;overflow-y:auto">
          <table class="tbl compact" style="font-size:12px">
            <thead><tr><th>رقم السند</th><th>الفاتورة</th><th>تاريخ السند</th><th class="text-end">المبلغ</th></tr></thead>
            <tbody>
              ${created.map((v) => `<tr>
                <td class="mono ltr">${esc(v.num)}</td>
                <td class="mono">${esc(v.inv)}</td>
                <td class="tiny">${esc(v.date)}</td>
                <td class="text-end num">${money(v.amount)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td colspan="3"><b>الإجمالي</b></td>
              <td class="text-end num"><b>${money(totalCreated)}</b></td>
            </tr></tfoot>
          </table>
        </div>
        ${errors.length ? `<div class="alert alert-warn tiny mt">${errors.map((er) => `فاتورة ${er.inv}: ${er.err}`).join('<br>')}</div>` : ''}
      </div>`;

    m.el.querySelector('[data-close]').disabled = false;
    m.el.querySelector('[data-close]').textContent = 'إغلاق';
    e.target.style.display = 'none';
    m.el.querySelector('[data-fifo]').style.display = 'none';

    if (onDone) onDone(null);
  };

  // ── إنشاء سندات دفعية (Installment Mode) ──────────────────────────────────
  const runInstallmentVouchers = async (e) => {
    const clientSel = $('#w-client', m.body).value;
    const issuerSel = $('#w-issuer', m.body).value;
    if (!clientSel || !issuerSel) return toastErr('اختر الشركة والعميل');

    const count = parseInt($('#w-inst-count', m.body).value, 10);
    const start = $('#w-inst-start', m.body).value;
    const freq = parseInt($('#w-inst-freq', m.body).value, 10) || 30;
    const total = toNum($('#w-inst-total', m.body).value, 0);
    const payType = $('#w-inst-pay', m.body).value || 'CASH';
    const refNo = $('#w-inst-ref', m.body).value || '';

    if (!start) return toastErr('حدد تاريخ أول دفعة');
    if (!total || total <= 0) return toastErr('أدخل المبلغ الإجمالي');
    if (count < 2 || count > 24) return toastErr('عدد الدفعات يجب أن يكون بين 2 و 24');

    const base = Math.floor((total / count) * 100) / 100;
    const last = Math.round((total - base * (count - 1)) * 100) / 100;
    const installments = Array.from({ length: count }, (_, i) => {
      const d = new Date(start + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + freq * i);
      return { date: d.toISOString().substring(0, 10), amount: i === count - 1 ? last : base };
    });

    const ok = await confirmDialog({
      title: `إنشاء ${count} سند قبض دفعي`,
      message: `الإجمالي: ${money(total)} ${cur}\nأول دفعة: ${installments[0].date}\nآخر دفعة: ${installments[count - 1].date}\nطريقة الدفع: ${payType}\n\nهل تريد المتابعة؟`,
      confirmText: 'نعم، إنشاء الدفعات',
    });
    if (!ok) return;

    e.target.disabled = true;
    m.el.querySelector('[data-fifo]').disabled = true;
    m.el.querySelector('[data-close]').disabled = true;

    const progressBox = $('#w-batch-progress', m.body);
    progressBox.style.display = 'block';

    const created = [];
    const errors = [];

    // FIFO: توزيع الدفعات على الفواتير المختارة من الأقدم للأحدث
    const selInvs = open.filter((i) => alloc.has(i.id)).sort((a, b) => a.issue_date.localeCompare(b.issue_date));
    const remaining = selInvs.map((i) => ({ id: i.id, rem: i.remaining_amount }));

    for (let i = 0; i < installments.length; i++) {
      const inst = installments[i];
      progressBox.innerHTML = `
        <div class="alert alert-info tiny" style="margin-top:10px">
          <b>جاري الإنشاء…</b> دفعة ${i + 1} / ${count} — تاريخ: ${inst.date}
          <div style="height:6px;background:#e2e8f0;border-radius:3px;margin-top:6px">
            <div style="height:100%;background:var(--brand);border-radius:3px;width:${Math.round(((i + 1) / count) * 100)}%;transition:width .3s"></div>
          </div>
        </div>`;

      // FIFO allocation
      let instRem = inst.amount;
      const allocations = [];
      for (const inv of remaining) {
        if (instRem < 0.005) break;
        const take = Math.min(inv.rem, Math.round(instRem * 100) / 100);
        if (take > 0.005) {
          allocations.push({ invoice_id: inv.id, amount: Math.round(take * 100) / 100 });
          inv.rem = Math.round((inv.rem - take) * 100) / 100;
          instRem = Math.round((instRem - take) * 100) / 100;
        }
      }

      try {
        const v = await api.post('/api/vouchers', {
          issuer_id: issuerSel,
          client_id: clientSel,
          voucher_date: inst.date,
          total_amount: inst.amount,
          payment_type: payType,
          reference_no: refNo,
          notes: `دفعة ${i + 1} من ${count}`,
          allocations,
        });
        created.push({ num: v.voucher_number, date: inst.date, amount: inst.amount });
      } catch (err) {
        errors.push({ date: inst.date, err: err.message || 'خطأ' });
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    syncNotify('vouchers', 'create', {});
    syncNotify('invoices', 'update');

    const totalCreated = created.reduce((a, v) => a + v.amount, 0);
    progressBox.innerHTML = `
      <div class="card" style="margin-top:12px;border:2px solid var(--success);padding:14px;border-radius:8px">
        <div style="font-weight:700;color:var(--success);margin-bottom:8px">
          تم إنشاء ${created.length} سند دفعي بنجاح${errors.length ? ` — ${errors.length} خطأ` : ''}
        </div>
        <div class="table-wrap" style="max-height:220px;overflow-y:auto">
          <table class="tbl compact" style="font-size:12px">
            <thead><tr><th>رقم السند</th><th>تاريخ الدفعة</th><th class="text-end">المبلغ</th></tr></thead>
            <tbody>${created.map((v) => `<tr>
              <td class="mono ltr">${esc(v.num)}</td>
              <td class="tiny ltr">${esc(v.date)}</td>
              <td class="text-end num">${money(v.amount)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div style="text-align:left;font-size:13px;font-weight:700;margin-top:8px;color:var(--brand)">
          الإجمالي: ${money(totalCreated)} ${cur}
        </div>
        ${errors.length ? `<div class="alert alert-warn tiny mt">${errors.map((x) => `${esc(x.date)}: ${esc(x.err)}`).join('<br>')}</div>` : ''}
      </div>`;

    e.target.disabled = false;
    m.el.querySelector('[data-fifo]').disabled = false;
    m.el.querySelector('[data-close]').disabled = false;
    if (onDone) onDone(created[0]);
  };

  if (clientId) loadOpen();
  return m;
}


export async function showVoucher(id, onChange) {
  const voucher = await api.get(`/api/vouchers/${id}`);
  const [issuer, client, templatesRes] = await Promise.all([
    api.get(`/api/issuers/${voucher.issuer_id}`),
    api.get(`/api/clients/${voucher.client_id}`),
    api.get('/api/invoices/templates?type=documents').catch(() => []),
  ]);

  const availableTemplates = Array.isArray(templatesRes) ? templatesRes : (templatesRes?.data || []);

  const issuerPrintCfg = (typeof issuer.print_settings === 'string'
    ? JSON.parse(issuer.print_settings || '{}')
    : (issuer.print_settings || {})) || {};

  let currentStyle = issuerPrintCfg.voucher_template_style || (availableTemplates[0]?.id || 'default');

  async function renderDoc(style) {
    let rawHtml = '';
    const targetTpl = availableTemplates.find((t) => t.id === style) || availableTemplates[0];
    if (targetTpl) {
      try {
        const r = await fetch(`/api/invoices/templates/${encodeURIComponent(targetTpl.id)}/render-html`);
        if (r.ok) rawHtml = await r.text();
      } catch { }
    }

    if (rawHtml) {
      return fillDynamicTemplateHtml(rawHtml, { issuer, client, voucher });
    }

    return renderStoredVoucher(voucher, issuer, client, style);
  }

  let currentHtml = await renderDoc(currentStyle);

  const m = modal({
    title: `سند قبض ${voucher.voucher_number} ${voucher.status === 'CANCELLED' ? '(ملغى)' : ''}`,
    wide: true,
    body: html`
      <div style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:13px;color:var(--brand)">قالب السند:</span>
          <select id="v-style-select" style="min-width:280px;font-size:13px;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--field-bg, var(--card));color:var(--text);font-weight:700">
            ${raw(availableTemplates.length
      ? availableTemplates.map((t) => `<option value="${esc(t.id)}" ${t.id === currentStyle ? 'selected' : ''}>${esc(t.name_ar || t.name)} (${esc(t.badge || 'سند HTML')})</option>`).join('')
      : '<option value="default">قالب سند قبض (سند HTML)</option>')}
          </select>
          ${raw((() => {
        const isVoucherDefault = currentStyle && currentStyle === issuerPrintCfg.voucher_template_style;
        return `<button class="btn btn-sm" id="btn-adopt-voucher-tpl" type="button" style="font-size:12px;padding:5px 12px;background:${isVoucherDefault ? 'rgba(16,185,129,0.12)' : 'var(--brand-light)'};border:1px solid ${isVoucherDefault ? 'rgba(16,185,129,0.3)' : 'var(--brand)'};color:${isVoucherDefault ? '#10b981' : 'var(--brand)'};font-weight:700;border-radius:6px;white-space:nowrap" title="${isVoucherDefault ? 'هذا القالب معتمد حالياً كافتراضي لجميع سندات هذه المنشأة' : 'اعتماد هذا القالب كقالب افتراضي لجميع سندات المنشأة'}">
              ${isVoucherDefault ? '✓ القالب المعتمد للمنشأة' : 'اعتماد كقالب افتراضي للمنشأة'}
            </button>`;
      })())}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div style="font-size:12px;color:var(--muted)">
            ${voucher.client_name} — <b class="num">${amount(voucher.total_amount, 'SAR', { size: 13 })}</b>
          </div>
          <div class="tpl-zoom-controls" style="margin:0;">
            <button type="button" class="tpl-zoom-btn" id="vp-zoom-out" title="تصغير">−</button>
            <span class="tpl-zoom-val" id="vp-zoom-text">80%</span>
            <button type="button" class="tpl-zoom-btn" id="vp-zoom-in" title="تكبير">+</button>
            <button type="button" class="tpl-zoom-btn" id="vp-zoom-fit" title="ملاءمة الشاشة" style="border-inline-start:1px solid var(--line-strong); font-size:.72rem;">العرض</button>
          </div>
        </div>
      </div>
      <div class="modal-paper-stage" id="vp-stage">
        <div class="modal-paper-scaler" id="vp-scaler" style="transform: scale(0.80);">
          <div class="modal-paper-sheet">
            <iframe id="v-preview-iframe" style="width:100%;height:100%;min-height:850px;border:none;display:block;background:#fff"></iframe>
          </div>
        </div>
      </div>
    `,
    footer: html`
      <div class="flex gap" style="justify-content:space-between;width:100%">
        <div class="flex gap-xs">
          <span class="badge gray" data-pdf-status title="حالة نسخة PDF المحفوظة">PDF قيد التجهيز</span>
          <button class="btn btn-primary" data-print type="button">${icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}طباعة السند</button>
          <button class="btn" data-pdf type="button">${icon.pdf({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}تحميل PDF</button>
          <button class="btn" data-share type="button" style="background:#10b981;border-color:#10b981;color:#fff">${icon.share({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}مشاركة</button>
          ${voucher.status !== 'CANCELLED' && can('vouchers.edit') ? raw(`<button class="btn" data-edit type="button" style="background:var(--brand-light);border-color:var(--brand);color:var(--brand)">${icon.pencil ? icon.pencil({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' }) : ''}تعديل</button>`) : ''}
          <button class="btn btn-danger" data-delete type="button">${icon.trash({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}حذف نهائي</button>
        </div>
        <button class="btn" data-close type="button">إغلاق</button>
      </div>
    `,
  });

  const refreshVoucherPdfStatus = async (attempt = 0) => {
    const badge = m.el.querySelector('[data-pdf-status]');
    if (!badge) return;
    try {
      const pdf = await api.get(`/api/vouchers/${encodeURIComponent(voucher.id)}/pdf-status`, { silent: true });
      badge.textContent = pdf.status === 'READY' ? 'PDF محفوظ' : pdf.status === 'FAILED' ? 'تعذر تجهيز PDF' : 'PDF قيد التجهيز';
      badge.className = `badge ${pdf.status === 'READY' ? 'green' : pdf.status === 'FAILED' ? 'red' : 'gray'}`;
      if (pdf.error) badge.title = pdf.error;
      if (pdf.status === 'PENDING' && attempt < 5) setTimeout(() => refreshVoucherPdfStatus(attempt + 1), 3000);
    } catch { }
  };
  refreshVoucherPdfStatus();

  let vpZoom = 80;
  const updateVpZoom = (z) => {
    vpZoom = Math.max(25, Math.min(130, z));
    const zText = $('#vp-zoom-text', m.body);
    const scaler = $('#vp-scaler', m.body);
    if (zText) zText.textContent = `${vpZoom}%`;
    if (scaler) scaler.style.transform = `scale(${vpZoom / 100})`;
  };
  const fitVpZoom = () => {
    const stage = $('#vp-stage', m.body);
    if (stage && stage.clientWidth > 60) {
      const availableW = stage.clientWidth - 20;
      const targetW = 794;
      const scale = Math.min(1.15, Math.max(0.25, Math.round((availableW / targetW) * 95) / 100));
      updateVpZoom(Math.round(scale * 100));
    }
  };
  $('#vp-zoom-in', m.body)?.addEventListener('click', () => updateVpZoom(vpZoom + 10));
  $('#vp-zoom-out', m.body)?.addEventListener('click', () => updateVpZoom(vpZoom - 10));
  $('#vp-zoom-fit', m.body)?.addEventListener('click', fitVpZoom);
  setTimeout(fitVpZoom, 40);

  const iframe = $('#v-preview-iframe', m.body);
  if (iframe) iframe.srcdoc = currentHtml;

  const updateVoucherAdoptBtn = () => {
    const adoptBtn = $('#btn-adopt-voucher-tpl', m.body);
    if (!adoptBtn) return;
    const isDefault = currentStyle && currentStyle === issuerPrintCfg.voucher_template_style;
    if (isDefault) {
      adoptBtn.innerHTML = '✓ القالب المعتمد للمنشأة';
      adoptBtn.style.background = 'rgba(16,185,129,0.12)';
      adoptBtn.style.borderColor = 'rgba(16,185,129,0.3)';
      adoptBtn.style.color = '#10b981';
      adoptBtn.title = 'هذا القالب معتمد حالياً كافتراضي لجميع سندات هذه المنشأة';
    } else {
      adoptBtn.innerHTML = '★ اعتماد كقالب افتراضي للمنشأة';
      adoptBtn.style.background = 'var(--brand-light)';
      adoptBtn.style.borderColor = 'var(--brand)';
      adoptBtn.style.color = 'var(--brand)';
      adoptBtn.title = 'حفظ واعتماد هذا القالب ليكون القالب الافتراضي الدائم لسندات هذه المنشأة';
    }
  };

  const styleSel = $('#v-style-select', m.body);
  if (styleSel) {
    styleSel.addEventListener('change', async () => {
      currentStyle = styleSel.value;
      updateVoucherAdoptBtn();
      currentHtml = await renderDoc(currentStyle);
      if (iframe) iframe.srcdoc = currentHtml;
    });
  }

  const adoptBtn = $('#btn-adopt-voucher-tpl', m.body);
  if (adoptBtn) {
    adoptBtn.addEventListener('click', async () => {
      adoptBtn.disabled = true;
      try {
        issuerPrintCfg.voucher_template_style = currentStyle;
        await api.put(`/api/issuers/${issuer.id}`, {
          ...issuer,
          print_settings: issuerPrintCfg,
        });
        issuer.print_settings = issuerPrintCfg;
        if (store.issuers) {
          const stored = store.issuers.find((i) => i.id === issuer.id);
          if (stored) stored.print_settings = issuerPrintCfg;
        }
        toastOk('تم اعتماد القالب كافتراضي لجميع سندات المنشأة بنجاح');
        updateVoucherAdoptBtn();
      } catch (err) {
        toastErr('فشل اعتماد القالب: ' + err.message);
      } finally {
        adoptBtn.disabled = false;
      }
    });
  }

  const pdfBtn = m.el.querySelector('[data-pdf]');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      try {
        const vNum = voucher.voucher_number || 'سند';
        const pdfFileName = clientPdfFilename('سند قبض', voucher.client_name || client?.name, vNum);
        await downloadPdfFromUrl(`/api/vouchers/${encodeURIComponent(voucher.id)}/pdf`, pdfFileName);
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        button.disabled = false;
      }
    });
  }

  const shareBtn = m.el.querySelector('[data-share]');
  if (shareBtn) {
    shareBtn.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const clientNameClean = (voucher.client_name || client?.name || '').replace(/[\/\\?%*:|"<>]/g, '_').trim();
        const vNum = voucher.voucher_number || 'سند';
        const pdfFileName = clientNameClean ? `سند_قبض_${vNum}_${clientNameClean}.pdf` : `سند_قبض_${vNum}.pdf`;
        await shareVoucherPdfFile({ voucher, issuer, client, docHtml: currentHtml, pdfFileName });
      } catch (err) {
        toastErr(err.message || 'تعذر مشاركة السند');
      } finally {
        e.target.disabled = false;
      }
    });
  }

  m.el.querySelector('[data-print]').addEventListener('click', () => {
    printDoc(currentHtml);
  });

  const deleteBtn = m.el.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `حذف سند القبض ${voucher.voucher_number} نهائياً`,
        message: 'هل أنت متأكد من حذف هذا السند نهائياً من قاعدة البيانات؟ سيتم مسح السند والقيود المرتبطة به بالكامل.',
        danger: true,
        okText: 'نعم، حذف نهائي',
      });
      if (!ok) return;
      try {
        await api.del(`/api/vouchers/${id}`);
        toastOk(`تم حذف سند القبض ${voucher.voucher_number} نهائياً من قاعدة البيانات`);
        m.close();
        if (onChange) onChange();
      } catch (err) {
        toastErr(err.message || 'فشل حذف السند');
      }
    });
  }

  // ── زر التعديل ────────────────────────────────────────────────────────────
  const editBtn = m.el.querySelector('[data-edit]');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      openEditVoucherModal(voucher, async (updated) => {
        Object.assign(voucher, updated);
        currentHtml = await renderDoc(currentStyle);
        if (iframe) iframe.srcdoc = currentHtml;
        m.el.querySelector('.modal-title, h2, [class*="title"]')?.childNodes[0] &&
          (m.el.querySelector('.modal-title, h2, [class*="title"]').textContent = `سند قبض ${updated.voucher_number}`);
        if (onChange) onChange(updated);
      });
    });
  }
}

export function openEditVoucherModal(voucher, onDone) {
  const paymentOptions = [
    { v: 'CASH', l: 'نقداً' },
    { v: 'TRANSFER', l: 'تحويل بنكي' },
    { v: 'CHEQUE', l: 'شيك' },
    { v: 'CARD', l: 'شبكة' },
  ];

  const em = modal({
    title: `تعديل سند ${voucher.voucher_number}`,
    body: html`
      <div class="form-grid" style="gap:14px">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          رقم السند
          <input id="ev-number" type="text" class="input mono" dir="ltr" value="${esc(voucher.voucher_number || '')}" placeholder="مثال: RV-00020" style="font-size:14px;font-weight:700">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          تاريخ السند
          <input id="ev-date" type="date" class="input" value="${voucher.voucher_date}" style="font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          طريقة الدفع
          <select id="ev-pay" class="input" style="font-size:14px">
            ${raw(paymentOptions.map((o) => `<option value="${o.v}" ${(voucher.payment_type || voucher.payment_method) === o.v ? 'selected' : ''}>${o.l}</option>`).join(''))}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          رقم المرجع / الشيك
          <input id="ev-ref" type="text" class="input" value="${esc(voucher.reference_no || '')}" placeholder="اختياري" style="font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          الملاحظات
          <input id="ev-notes" type="text" class="input" value="${esc(voucher.notes || '')}" placeholder="اختياري" style="font-size:14px">
        </label>
      </div>
    `,
    footer: html`
      <div class="flex gap" style="justify-content:flex-end;width:100%">
        <button class="btn" data-close type="button">إلغاء</button>
        <button class="btn btn-primary" id="ev-save" type="button">حفظ التعديلات</button>
      </div>
    `,
  });

  em.el.querySelector('#ev-save').addEventListener('click', async (e) => {
    const newNumber = em.el.querySelector('#ev-number').value.trim();
    const newDate = em.el.querySelector('#ev-date').value;
    const newPay = em.el.querySelector('#ev-pay').value;
    const newRef = em.el.querySelector('#ev-ref').value.trim();
    const newNotes = em.el.querySelector('#ev-notes').value.trim();

    if (!newNumber) return toastErr('يرجى إدخال رقم السند');
    if (!newDate) return toastErr('حدد تاريخ السند');

    e.target.disabled = true;
    try {
      const updated = await api.patch(`/api/vouchers/${voucher.id}`, {
        voucher_number: newNumber,
        voucher_date: newDate,
        payment_type: newPay,
        reference_no: newRef,
        notes: newNotes,
      });
      toastOk(`تم تعديل سند ${updated.voucher_number} بنجاح`);
      em.close();
      if (onDone) onDone(updated);
    } catch (err) {
      toastErr(err.message || 'فشل حفظ التعديلات');
      e.target.disabled = false;
    }
  });
}

async function getVoucherRenderedData(voucherId) {
  const voucher = typeof voucherId === 'object' ? voucherId : await api.get(`/api/vouchers/${voucherId}`);
  const [issuer, client, templatesRes] = await Promise.all([
    api.get(`/api/issuers/${voucher.issuer_id}`).catch(() => store.issuers.find((i) => i.id === voucher.issuer_id) || store.activeIssuer || {}),
    api.get(`/api/clients/${voucher.client_id}`).catch(() => store.clients.find((c) => c.id === voucher.client_id) || { name: voucher.client_name }),
    api.get('/api/invoices/templates?type=documents').catch(() => []),
  ]);

  const availableTemplates = Array.isArray(templatesRes) ? templatesRes : (templatesRes?.data || []);
  const issuerPrintCfg = (typeof issuer.print_settings === 'string'
    ? JSON.parse(issuer.print_settings || '{}')
    : (issuer.print_settings || {})) || {};
  const currentStyle = issuerPrintCfg.voucher_template_style || (availableTemplates[0]?.id || 'default');

  let rawHtml = '';
  const targetTpl = availableTemplates.find((t) => t.id === currentStyle) || availableTemplates[0];
  if (targetTpl) {
    try {
      const r = await fetch(`/api/invoices/templates/${encodeURIComponent(targetTpl.id)}/render-html`);
      if (r.ok) rawHtml = await r.text();
    } catch { }
  }

  const docHtml = rawHtml
    ? fillDynamicTemplateHtml(rawHtml, { issuer, client, voucher })
    : await renderStoredVoucher(voucher, issuer, client, currentStyle);

  const clientNameClean = (voucher.client_name || client?.name || '').replace(/[\/\\?%*:|"<>]/g, '_').trim();
  const vNum = voucher.voucher_number || 'سند';
  const pdfFileName = clientNameClean ? `سند_قبض_${vNum}_${clientNameClean}.pdf` : `سند_قبض_${vNum}.pdf`;
  return { voucher, issuer, client, docHtml, pdfFileName };
}

export async function downloadVoucherDirectPdf(voucherId) {
  toastOk('جارٍ تجهيز ملف PDF للسند...');
  const { voucher, client } = await getVoucherRenderedData(voucherId);
  const vid = encodeURIComponent(voucher.id);
  // انتظار اكتمال PDF (حتى 20 ثانية) قبل التحميل
  for (let i = 0; i < 10; i++) {
    const status = await api.get(`/api/vouchers/${vid}/pdf-status`).catch(() => null);
    if (!status || status.status === 'READY') break;
    if (status.status === 'FAILED') throw new Error('فشل توليد ملف PDF: ' + (status.error || ''));
    await new Promise((r) => setTimeout(r, 2000));
  }
  await downloadPdfFromUrl(`/api/vouchers/${vid}/pdf`, clientPdfFilename('سند قبض', voucher.client_name || client?.name, voucher.voucher_number || 'سند'));
}

export async function shareVoucherPdfFile({ voucher, issuer, client, docHtml, pdfFileName }) {
  return shareDocument({
    title: `سند قبض ${voucher.voucher_number || ''}`,
    text: `سند قبض رقم ${voucher.voucher_number || ''} بمبلغ ${voucher.total_amount || ''} ر.س من ${issuer?.name_ar || voucher.issuer_name || ''}`,
    url: `${location.origin}${location.pathname}#/vouchers?q=${encodeURIComponent(voucher.voucher_number || '')}`,
  });
}

export async function shareVoucherDirectPdf(voucherId) {
  const data = await getVoucherRenderedData(voucherId);
  await shareVoucherPdfFile(data);
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
    const res = await api.get(qs('/api/vouchers', {
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
    state.data = res || { items: [], totals: {}, total_count: 0 };
    if (!Array.isArray(state.data.items)) state.data.items = [];
    if (!state.data.totals) state.data.totals = {};
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
          ${raw(can('vouchers.create') ? `
            <button class="btn btn-primary" id="new-v" type="button">
              ${icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}سند قبض جديد
            </button>
            <button class="btn btn-secondary" id="new-v-install" type="button" style="background:#0284c7;color:#fff;border-color:#0284c7;font-weight:700" title="إنشاء وتوليد دفعات سندات قبض مجدولة على أقساط وتواريخ مستقبلية">
              ${raw(icon.calendar({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}السندات الدفعية (أقساط)
            </button>
            <button class="btn" id="new-v-batch" type="button" style="border:1.5px solid var(--line-strong);font-weight:700" title="إنشاء سند قبض منفصل لكل فاتورة غير مسددة">
              سندات لكل فاتورة
            </button>
          ` : '')}
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
          <table class="tbl invoices-tbl vouchers-tbl">
            <thead><tr>
              <th style="white-space:nowrap;min-width:125px">رقم السند</th>
              <th style="white-space:nowrap;min-width:110px">التاريخ</th>
              <th style="min-width:180px">العميل</th>
              <th style="min-width:135px">الشركة</th>
              <th style="white-space:nowrap">طريقة السداد</th>
              <th style="white-space:nowrap">المرجع</th>
              <th class="text-end nowrap" style="white-space:nowrap">المبلغ <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end nowrap" style="white-space:nowrap">الموزّع <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end nowrap" style="white-space:nowrap">غير موزّع <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-center nowrap" style="min-width:80px;white-space:nowrap">الحالة</th>
              <th class="text-center nowrap" style="min-width:180px;white-space:nowrap">الإجراءات</th>
            </tr></thead>
            <tbody>
              ${raw(state.data.items.length ? state.data.items.map((v) => `<tr class="${v.status === 'CANCELLED' ? 'row-off' : ''}">
                <td class="nowrap" style="white-space:nowrap"><a class="mono invoice-no-link" href="javascript:void(0)" data-act="show" data-id="${esc(v.id)}" style="font-weight:700;white-space:nowrap" title="عرض تفاصيل السند"><b>${esc(v.voucher_number)}</b></a></td>
                <td class="tiny nowrap" style="white-space:nowrap">${esc(dateAr(v.voucher_date))}</td>
                <td class="cell-client"><div class="client-name" title="${esc(v.client_name)}">${esc(v.client_name)}</div>${v.client_code ? `<div class="tiny muted mono">${esc(v.client_code)}</div>` : ''}</td>
                <td class="cell-issuer"><div class="issuer-name" title="${esc(v.issuer_name)}">${esc(v.issuer_name)}</div></td>
                <td class="tiny nowrap" style="white-space:nowrap">${esc(v.payment_label)}</td>
                <td class="tiny mono nowrap" style="white-space:nowrap">${esc(v.reference_no || '—')}</td>
                <td class="text-end num nowrap" style="white-space:nowrap"><b>${amount(v.total_amount)}</b></td>
                <td class="text-end num nowrap" style="white-space:nowrap">${amount(v.allocated_total)}</td>
                <td class="text-end num nowrap" style="white-space:nowrap">${v.unallocated > 0 ? `<span class="badge amber" style="white-space:nowrap">${amount(v.unallocated)}</span>` : '—'}</td>
                <td class="text-center nowrap" style="white-space:nowrap">
                  ${v.status === 'CANCELLED' ? '<span class="badge red">ملغى</span>' : '<span class="badge green">نشط</span>'}
                </td>
                <td class="actions">
                  <div class="row-actions-group">
                    <button class="btn btn-sm btn-ghost" data-act="show" data-id="${esc(v.id)}" type="button" title="عرض تفاصيل السند" style="padding:.28rem .55rem">
                      ${icon.eye({ size: 14, style: 'vertical-align:middle' })}<span>عرض</span>
                    </button>
                    <button class="btn btn-sm btn-icon btn-primary" data-act="pdf" data-id="${esc(v.id)}" type="button" title="تحميل ملف PDF">
                      ${icon.pdf({ size: 14, style: 'vertical-align:middle' })}
                    </button>
                    <button class="btn btn-sm btn-icon" data-act="share" data-id="${esc(v.id)}" type="button" style="background:#10b981;border-color:#10b981;color:#fff" title="مشاركة سند القبض">
                      ${icon.share({ size: 13, style: 'vertical-align:middle' })}
                    </button>
                    ${v.status !== 'CANCELLED' && can('vouchers.edit') ? `
                    <button class="btn btn-sm btn-icon" data-act="edit" data-id="${esc(v.id)}" type="button" title="تعديل السند">
                      ${icon.edit({ size: 13, style: 'vertical-align:middle' })}
                    </button>` : ''}
                    ${can('vouchers.delete') ? `<button class="btn btn-sm btn-icon btn-danger" data-act="delete" data-id="${esc(v.id)}" data-num="${esc(v.voucher_number)}" type="button" title="حذف السند">
                      ${icon.trash({ size: 13, style: 'vertical-align:middle' })}
                    </button>` : ''}
                  </div>
                </td>
              </tr>`).join('') : '<tr><td colspan="11" class="text-center muted" style="padding:2rem">لا توجد سندات مطابقة</td></tr>')}
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
        mode: 'single',
        onDone: reload,
      }));
    }

    const newInstallBtn = $('#new-v-install', view);
    if (newInstallBtn) {
      newInstallBtn.addEventListener('click', () => voucherWizard({
        clientId: state.client_id,
        issuerId: state.issuer_id || store.activeIssuerId,
        mode: 'install',
        onDone: reload,
      }));
    }

    const newBatchBtn = $('#new-v-batch', view);
    if (newBatchBtn) {
      newBatchBtn.addEventListener('click', () => voucherWizard({
        clientId: state.client_id,
        issuerId: state.issuer_id || store.activeIssuerId,
        mode: 'batch',
        onDone: reload,
      }));
    }

    if (q0.mode === 'install' || q0.action === 'install') {
      setTimeout(() => {
        voucherWizard({
          clientId: state.client_id,
          issuerId: state.issuer_id || store.activeIssuerId,
          mode: 'install',
          onDone: reload,
        });
      }, 50);
    }

    delegate(view, 'click', '[data-act="show"]', async (e, btn) => { await showVoucher(btn.dataset.id, reload); });

    delegate(view, 'click', '[data-act="edit"]', async (e, btn) => {
      const id = btn.dataset.id;
      const v = state.data.items.find((item) => item.id === id);
      if (v) {
        openEditVoucherModal(v, reload);
      } else {
        try {
          const fetched = await api.get(`/api/vouchers/${id}`);
          openEditVoucherModal(fetched, reload);
        } catch (err) {
          toastErr('تعذر تحميل بيانات السند: ' + (err.message || err));
        }
      }
    });

    delegate(view, 'click', '[data-act="pdf"]', async (e, btn) => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await downloadVoucherDirectPdf(id);
      } catch (err) {
        toastErr('تعذر تحميل ملف PDF: ' + (err.message || err));
      } finally {
        btn.disabled = false;
      }
    });

    delegate(view, 'click', '[data-act="share"]', async (e, btn) => {
      const id = btn.dataset.id;
      const voucher = state.data.items.find((item) => item.id === id);
      if (voucher) await shareVoucherPdfFile({ voucher, issuer: { name_ar: voucher.issuer_name } });
    });

    delegate(view, 'click', '[data-act="delete"]', async (e, btn) => {
      const id = btn.dataset.id;
      const num = btn.dataset.num || '';
      const ok = await confirmDialog({
        title: `حذف سند القبض ${num} نهائياً`,
        message: 'هل أنت متأكد من حذف هذا السند نهائياً من قاعدة البيانات؟ سيتم مسح السند والقيود المرتبطة به بالكامل.',
        danger: true,
        okText: 'نعم، حذف نهائي',
      });
      if (!ok) return;
      try {
        await api.del(`/api/vouchers/${id}`);
        toastOk(`تم حذف سند القبض ${num} نهائياً من قاعدة البيانات`);
        await reload();
      } catch (err) {
        toastErr(err.message || 'فشل حذف السند');
      }
    });

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
          <div class="grid grid-2" style="gap:14px">
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

    const getVouchersDocHtml = async () => {
      const issuer = store.issuers.find((item) => item.id === state.issuer_id) || store.activeIssuer || {};
      let settings = issuer.print_settings || {};
      if (typeof settings === 'string') { try { settings = JSON.parse(settings); } catch { settings = {}; } }
      const template = await loadStoredTemplate('reports', settings.report_template_style || '');
      const rows = state.data.items.map((v) => [
        v.voucher_number, v.voucher_date, v.client_name, v.issuer_name, v.payment_label, v.reference_no || '—',
        money(v.total_amount), money(v.allocated_total), money(v.unallocated), v.status_label,
      ]);
      const totals = state.data.totals || {};
      const footer = ['الإجمالي', '', '', '', '', '', money(totals.total_amount), money(totals.allocated_total || 0), money(totals.unallocated_total || 0), ''];
      const cells = (values, tag) => values.map((value) => `<${tag}>${esc(String(value ?? ''))}</${tag}>`).join('');
      return fillStoredTemplate(template, {
        title: 'تقرير قائمة سندات القبض',
        subtitle: `إجمالي السندات: ${num(state.data.total_count)} — الإجمالي: ${money(totals.total_amount)} ر.س`,
        issuer_name: issuer.name_ar || '', generated_at: new Date().toLocaleString('ar-SA'), page_size: 'A4 landscape',
        stats_html: '', headers_html: cells(headers, 'th'),
        rows_html: rows.length ? rows.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('') : `<tr><td colspan="${headers.length}">لا توجد بيانات مسجلة</td></tr>`,
        footer_html: `<tr>${cells(footer, 'td')}</tr>`,
      }, ['stats_html', 'headers_html', 'rows_html', 'footer_html']);
    };

    $('#btn-pdf-vouchers', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const docHtml = await getVouchersDocHtml();
        await downloadPdfFromHtml(docHtml, 'قائمة-سندات-القبض.pdf');
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        e.target.disabled = false;
      }
    });
  };

  const unsubSync = onSync((ev) => {
    if (ev.entity === 'vouchers' || ev.entity === 'invoices') {
      reload();
    }
  });

  await load();
  draw();
  return () => { unsubSync(); };
}

