// ==========================================================================
//  إعدادات النظام العامة: العملة، نسبة الضريبة، الترقيم، سقف الدفعة، الطباعة.
// ==========================================================================
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { html, esc, formValues, toastOk, $, icon } from '../core/util.js';

export async function render(view) {
  if (!can('settings.write')) {
    view.innerHTML = html`
      <div class="card"><div class="empty">
        <h3>لا تملك صلاحية تعديل إعدادات النظام</h3>
      </div></div>`;
    return undefined;
  }

  const settings = await api.get('/api/settings');

  view.innerHTML = html`
    <div class="page-head">
      <div class="titles">
        <h1>إعدادات النظام</h1>
        <p>الخيارات الافتراضية للعملة، الضريبة، الترقيم، وسقف التوليد الدفعي.</p>
      </div>
    </div>

    <form id="settings-form" class="stack">
      <div class="card">
        <div class="card-head"><h3>الإعدادات المالية والضريبية</h3></div>
        <div class="row">
          <div class="field" style="max-width:200px">
            <label class="req">العملة الافتراضية</label>
            <input type="text" name="currency" value="${esc(settings.currency || 'SAR')}" class="ltr" required />
            <span class="hint">مثال: SAR أو ر.س</span>
          </div>
          <div class="field" style="max-width:200px">
            <label class="req">نسبة الضريبة الافتراضية %</label>
            <input type="number" name="default_tax_rate" value="${esc(settings.default_tax_rate ?? 15)}" min="0" max="100" step="0.01" required />
            <span class="hint">النسبة المئوية (مثل 15)</span>
          </div>
          <div class="field" style="max-width:200px">
            <label>رمز الدولة الافتراضي</label>
            <input type="text" name="country" value="${esc(settings.country || 'SA')}" class="ltr" maxlength="4" />
            <span class="hint">ISO Code (مثل SA)</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>الترقيم والتسلسل الافتراضي</h3></div>
        <div class="row">
          <div class="field" style="max-width:220px">
            <label>بادئة رقم الفاتورة الافتراضية</label>
            <input type="text" name="invoice_prefix_default" value="${esc(settings.invoice_prefix_default || 'INV')}" class="ltr" />
          </div>
          <div class="field" style="max-width:180px">
            <label>عدد خانات الترقيم (Padding)</label>
            <input type="number" name="invoice_pad_default" value="${esc(settings.invoice_pad_default ?? 5)}" min="1" max="12" />
          </div>
          <div class="field" style="max-width:220px">
            <label>بادئة رقم سند القبض الافتراضية</label>
            <input type="text" name="voucher_prefix_default" value="${esc(settings.voucher_prefix_default || 'RV')}" class="ltr" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>التوليد الدفعي والطباعة</h3></div>
        <div class="row">
          <div class="field" style="max-width:260px">
            <label class="req">سقف عدد الفواتير في الدفعة الواحدة</label>
            <input type="number" name="bulk_max_invoices" value="${esc(settings.bulk_max_invoices ?? 2000)}" min="10" max="5000" required />
            <span class="hint">الحد الأقصى للتوليد الدفعي (حتى 5000)</span>
          </div>
          <div class="field" style="max-width:200px">
            <label>عدد نسخ الطباعة الافتراضي</label>
            <input type="number" name="print_copies_default" value="${esc(settings.print_copies_default ?? 1)}" min="1" max="5" />
          </div>
        </div>
      </div>

      <div class="row mt">
        <button class="btn btn-primary" type="submit" id="save-settings">${icon.check({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}حفظ الإعدادات</button>
      </div>
    </form>`;

  $('#settings-form', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#save-settings', view);
    btn.disabled = true;
    btn.textContent = 'جارٍ الحفظ…';
    const values = formValues(e.target);
    try {
      await api.put('/api/settings', values);
      toastOk('تم حفظ إعدادات النظام بنجاح');
      btn.disabled = false;
      btn.textContent = 'حفظ الإعدادات';
    } catch {
      btn.disabled = false;
      btn.textContent = 'حفظ الإعدادات';
    }
  });

  return undefined;
}
