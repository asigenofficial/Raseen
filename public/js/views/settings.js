// ==========================================================================
//  إعدادات النظام العامة: العملة، نسبة الضريبة، الترقيم، سقف الدفعة، الطباعة، والنسخ الاحتياطي.
// ==========================================================================
import { api } from '../core/api.js';
import { store, can } from '../core/store.js';
import { html, esc, formValues, toastOk, toastErr, confirmDialog, $, icon } from '../core/util.js';

export async function render(view) {
  if (!can('settings.write')) {
    view.innerHTML = html`
      <div class="card"><div class="empty">
        <h3>لا تملك صلاحية تعديل إعدادات النظام</h3>
      </div></div>`;
    return undefined;
  }

  const settings = await api.get('/api/settings');
  const isAdmin = store.user?.role === 'ADMIN';

  view.innerHTML = html`
    <div class="page-head">
      <div class="titles">
        <h1>إعدادات النظام</h1>
        <p>الخيارات الافتراضية للعملة، الضريبة، الترقيم، وسقف التوليد الدفعي، وإدارة قاعدة البيانات.</p>
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
    </form>

    ${isAdmin ? html`
      <div class="card mt-lg" id="db-management-card" style="border: 1px solid var(--border-color, #e2e8f0); margin-top: 24px;">
        <div class="card-head" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; border-bottom: 1px solid var(--border-color, #e2e8f0); padding-bottom: 14px; margin-bottom: 16px;">
          <div>
            <h3 style="display:flex; align-items:center; gap:8px; margin:0; font-size:16px;">
              ${icon.shieldCheck({ size: 20, style: 'color:var(--primary, #059669)' })}
              إدارة قاعدة البيانات والنسخ الاحتياطي
            </h3>
            <p style="margin:4px 0 0; color:var(--text-muted, #64748b); font-size:13px;">
              تصدير واستيراد قاعدة بيانات النظام بالكامل — خاص بمدير النظام (ADMIN).
            </p>
          </div>
          <span class="badge" style="background:rgba(5,150,105,0.1); color:#059669; font-weight:700; font-size:12px; padding:4px 10px; border-radius:12px; border:1px solid rgba(5,150,105,0.2);">خاص بالمدير فقط</span>
        </div>

        <div class="stack" style="gap:16px;">
          <!-- قسم التصدير -->
          <div style="background:var(--bg-subtle, #f8fafc); border:1px solid var(--border-color, #e2e8f0); border-radius:10px; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
              <div style="max-width:550px;">
                <h4 style="margin:0 0 6px 0; font-size:15px; font-weight:700; color:var(--text-color, #1e293b);">
                  ${icon.download({ size: 18, style: 'vertical-align:text-bottom; margin-left:6px; color:var(--primary, #059669)' })}
                  تصدير قاعدة البيانات كاملة
                </h4>
                <p style="margin:0; font-size:13px; color:var(--text-muted, #64748b); line-height:1.6;">
                  تنزيل نسخة مطابقة وفورية لكامل قاعدة البيانات بصيغة <code>.db</code> تحتوي على جميع الفواتير، السندات، العملاء، الأصناف، وسجل الحركات المحاسبية.
                </p>
              </div>
              <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <button type="button" class="btn btn-outline" id="btn-create-server-backup" style="font-size:13px;">
                  ${icon.refresh({ size: 15, style: 'vertical-align:text-bottom; margin-left:4px;' })}
                  نسخة فورية على السيرفر
                </button>
                <button type="button" class="btn btn-primary" id="btn-export-db" style="font-size:13px; font-weight:600;">
                  ${icon.download({ size: 16, style: 'vertical-align:text-bottom; margin-left:5px;' })}
                  تصدير وتحميل قاعدة البيانات
                </button>
              </div>
            </div>
          </div>

          <!-- قسم الاستيراد -->
          <div style="background:var(--bg-subtle, #f8fafc); border:1px dashed var(--danger-border, #fca5a5); border-radius:10px; padding:16px;">
            <div style="max-width:700px; margin-bottom:14px;">
              <h4 style="margin:0 0 6px 0; font-size:15px; font-weight:700; color:var(--danger, #dc2626);">
                ${icon.upload({ size: 18, style: 'vertical-align:text-bottom; margin-left:6px;' })}
                استيراد واستعادة قاعدة البيانات
              </h4>
              <p style="margin:0; font-size:13px; color:var(--text-muted, #64748b); line-height:1.6;">
                استعادة قاعدة البيانات من ملف خارجي (بصيغة <code>.db</code> أو <code>.sqlite</code>).
                <br />
                <span style="display:inline-block; margin-top:4px; font-weight:600; color:var(--primary, #059669);">
                  ✓ أمان وحماية مضمونة: يقوم النظام تلقائياً بإنشاء نسخة احتياطية وقائية قبل أي عملية استيراد لحماية بياناتك من أي فقدان.
                </span>
              </p>
            </div>

            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
              <div style="flex:1; min-width:240px; max-width:400px;">
                <input type="file" id="import-db-input" accept=".db,.sqlite,.sqlite3" style="font-size:13px; padding:7px 10px; width:100%; border:1px solid var(--border-color, #cbd5e1); border-radius:8px; background:var(--card-bg, #fff);" />
              </div>
              <button type="button" class="btn btn-danger" id="btn-import-db" style="font-size:13px; font-weight:600;">
                ${icon.upload({ size: 16, style: 'vertical-align:text-bottom; margin-left:5px;' })}
                استيراد واستعادة البيانات
              </button>
            </div>
          </div>
        </div>
      </div>
    ` : ''}`;

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

  // إدارة قاعدة البيانات (خاص بمدير النظام فقط)
  if (isAdmin) {
    // 1. تصدير وتحميل قاعدة البيانات
    const btnExport = $('#btn-export-db', view);
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = '/api/system/export-db';
        link.download = `raseen_database_${new Date().toISOString().slice(0, 10)}.db`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        toastOk('تم بدء تنزيل قاعدة البيانات بنجاح');
      });
    }

    // 2. إنشاء نسخة فورية على السيرفر
    const btnServerBackup = $('#btn-create-server-backup', view);
    if (btnServerBackup) {
      btnServerBackup.addEventListener('click', async () => {
        btnServerBackup.disabled = true;
        btnServerBackup.textContent = 'جارٍ الحفظ...';
        try {
          const res = await api.get('/api/system/backup');
          toastOk(`تم حفظ نسخة احتياطية على السيرفر: ${res.filename}`);
        } catch (err) {
          toastErr(err.message || 'فشل حفظ النسخة الاحتياطية');
        } finally {
          btnServerBackup.disabled = false;
          btnServerBackup.innerHTML = `${icon.refresh({ size: 15, style: 'vertical-align:text-bottom; margin-left:4px;' })} نسخة فورية على السيرفر`;
        }
      });
    }

    // 3. استيراد واستعادة قاعدة البيانات
    const btnImport = $('#btn-import-db', view);
    const fileInput = $('#import-db-input', view);
    if (btnImport && fileInput) {
      btnImport.addEventListener('click', async () => {
        const file = fileInput.files?.[0];
        if (!file) {
          toastErr('يرجى تحديد ملف قاعدة البيانات (.db) أولاً');
          fileInput.focus();
          return;
        }

        const confirmed = await confirmDialog({
          title: 'تأكيد استيراد واستعادة قاعدة البيانات',
          message: `تحذير: هل أنت متأكد من استيراد قاعدة البيانات من الملف «${file.name}»؟ سيتم استبدال البيانات الحالية بالبيانات الموجودة في الملف. سيقوم النظام بحفظ نسخة احتياطية وقائية قبل الاستبدال.`,
          danger: true,
          okText: 'نعم، استيراد واستبدال البيانات',
        });

        if (!confirmed) return;

        btnImport.disabled = true;
        btnImport.textContent = 'جارٍ فحص واستيراد البيانات...';

        try {
          const fd = new FormData();
          fd.append('database_file', file);

          const res = await fetch('/api/system/import-db', {
            method: 'POST',
            body: fd,
          });

          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || 'فشل استيراد قاعدة البيانات');
          }

          toastOk('تم استيراد واستعادة كافة بيانات النظام بنجاح! جارٍ تحديث الصفحة...');
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (err) {
          toastErr(err.message || 'حدث خطأ أثناء استيراد قاعدة البيانات');
          btnImport.disabled = false;
          btnImport.innerHTML = `${icon.upload({ size: 16, style: 'vertical-align:text-bottom; margin-left:5px;' })} استيراد واستعادة البيانات`;
        }
      });
    }
  }

  return undefined;
}
