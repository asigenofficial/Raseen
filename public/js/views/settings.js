// ==========================================================================
//  إعدادات النظام العامة: العملة، نسبة الضريبة، الترقيم، سقف الدفعة، الطباعة، والنسخ الاحتياطي.
// ==========================================================================
import { api } from '../core/api.js';
import { store, can } from '../core/store.js';
import { html, raw, esc, formValues, toastOk, toastErr, confirmDialog, $, icon } from '../core/util.js';

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
        <p>الخيارات الافتراضية للعملة، الضريبة، الترقيم، وسقف التوليد الدفعي، والنسخ الاحتياطي.</p>
      </div>
      ${raw(isAdmin ? `
        <div class="page-actions" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <input type="file" id="import-db-input" accept=".db,.sqlite,.sqlite3" style="display:none;" />
          <button class="btn btn-outline" id="btn-export-db" type="button" title="تصدير وتحميل قاعدة البيانات كاملة كملف SQLite (.db)">
            ${icon.download({ size: 16, style: 'vertical-align:text-bottom; margin-left:4px; color:var(--primary, #059669);' })}
            تصدير البيانات
          </button>
          <button class="btn btn-danger" id="btn-import-db" type="button" title="استيراد واستعادة قاعدة البيانات كاملة من ملف SQLite (.db)">
            ${icon.upload({ size: 16, style: 'vertical-align:text-bottom; margin-left:4px;' })}
            استيراد البيانات
          </button>
          <button class="btn" id="btn-create-server-backup" type="button" title="أخذ نسخة احتياطية فورية على السيرفر">
            ${icon.refresh({ size: 16, style: 'vertical-align:text-bottom; margin-left:4px;' })}
            نسخة احتياطية
          </button>
        </div>
      ` : '')}
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

    ${raw(isAdmin ? `
      <div class="card mt-lg" id="db-management-card" style="border: 1px solid var(--border-color, #334155); margin-top: 24px; border-radius: 12px;">
        <div class="card-head" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; border-bottom: 1px solid var(--border-color, #334155); padding-bottom: 14px; margin-bottom: 16px;">
          <div>
            <h3 style="display:flex; align-items:center; gap:8px; margin:0; font-size:16px;">
              ${icon.shieldCheck({ size: 20, style: 'color:var(--primary, #059669)' })}
              إدارة قاعدة البيانات والنسخ الاحتياطي
            </h3>
            <p style="margin:4px 0 0; color:var(--text-muted, #64748b); font-size:13px;">
              تصدير واستيراد قاعدة بيانات النظام بالكامل — خاص بمدير النظام (ADMIN).
            </p>
          </div>
          <span class="badge" style="background:rgba(5,150,105,0.12); color:#059669; font-weight:700; font-size:12px; padding:4px 10px; border-radius:12px; border:1px solid rgba(5,150,105,0.25);">خاص بالمدير فقط</span>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
          <!-- بطاقة التصدير -->
          <div style="background:var(--bg-subtle, rgba(255,255,255,0.02)); border:1px solid var(--border-color, #334155); border-radius:10px; padding:18px; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                <div style="width:38px; height:38px; border-radius:8px; background:rgba(5,150,105,0.15); color:#059669; display:flex; align-items:center; justify-content:center;">
                  ${icon.download({ size: 20 })}
                </div>
                <div>
                  <h4 style="margin:0; font-size:15px; font-weight:700;">تصدير قاعدة البيانات كاملة</h4>
                  <span style="font-size:12px; color:var(--text-muted, #64748b);">ملف SQLite (.db) متكامل ولحظي</span>
                </div>
              </div>
              <p style="margin:0 0 16px 0; font-size:13px; color:var(--text-muted, #64748b); line-height:1.6;">
                تنزيل نسخة مطابقة وفورية لكامل قاعدة البيانات بصيغة <code>.db</code> تحتوي على جميع الفواتير، السندات، العملاء، الأصناف، وسجل الحركات المحاسبية.
              </p>
            </div>
            <button type="button" class="btn btn-primary" id="btn-export-db-card" style="width:100%; display:inline-flex; align-items:center; justify-content:center; gap:8px;">
              ${icon.download({ size: 16 })}
              تصدير وتحميل قاعدة البيانات
            </button>
          </div>

          <!-- بطاقة الاستيراد -->
          <div style="background:var(--bg-subtle, rgba(255,255,255,0.02)); border:1px solid var(--border-color, #334155); border-radius:10px; padding:18px; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                <div style="width:38px; height:38px; border-radius:8px; background:rgba(220,38,38,0.15); color:#dc2626; display:flex; align-items:center; justify-content:center;">
                  ${icon.upload({ size: 20 })}
                </div>
                <div>
                  <h4 style="margin:0; font-size:15px; font-weight:700; color:var(--danger, #dc2626);">استيراد واستعادة قاعدة البيانات</h4>
                  <span style="font-size:12px; color:var(--text-muted, #64748b);">استرجاع كامل مع نسخة وقائية</span>
                </div>
              </div>
              <p style="margin:0 0 16px 0; font-size:13px; color:var(--text-muted, #64748b); line-height:1.6;">
                استعادة قاعدة البيانات من ملف خارجي (بصيغة <code>.db</code>). يقوم النظام تلقائياً بإنشاء نسخة احتياطية وقائية قبل أي عملية استيراد لحماية بياناتك من أي فقدان.
              </p>
            </div>
            <button type="button" class="btn btn-danger" id="btn-import-db-card" style="width:100%; display:inline-flex; align-items:center; justify-content:center; gap:8px;">
              ${icon.upload({ size: 16 })}
              استيراد واستعادة البيانات
            </button>
          </div>
        </div>
      </div>
    ` : '')}
  `;

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
    const triggerExport = () => {
      const link = document.createElement('a');
      link.href = '/api/system/export-db';
      link.download = `raseen_database_${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toastOk('تم بدء تنزيل قاعدة البيانات بنجاح');
    };

    // أزرار التصدير (في رأس الصفحة وفي البطاقة)
    $('#btn-export-db', view)?.addEventListener('click', triggerExport);
    $('#btn-export-db-card', view)?.addEventListener('click', triggerExport);

    // زر النسخة السريعة على السيرفر
    $('#btn-create-server-backup', view)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'جارٍ الحفظ...';
      try {
        const res = await api.get('/api/system/backup');
        toastOk(`تم حفظ نسخة احتياطية على السيرفر: ${res.filename}`);
      } catch (err) {
        toastErr(err.message || 'فشل حفظ النسخة الاحتياطية');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${icon.refresh({ size: 16, style: 'vertical-align:text-bottom; margin-left:4px;' })} نسخة احتياطية`;
      }
    });

    // أزرار الاستيراد تفتح نافذة اختيار الملف تلقائياً
    const fileInput = $('#import-db-input', view);
    const triggerImport = () => {
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
    };

    $('#btn-import-db', view)?.addEventListener('click', triggerImport);
    $('#btn-import-db-card', view)?.addEventListener('click', triggerImport);

    // معالجة الملف بعد اختياره من الجهاز
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        const confirmed = await confirmDialog({
          title: 'تأكيد استيراد واستعادة قاعدة البيانات',
          message: `تحذير هام: هل أنت متأكد من استيراد قاعدة البيانات من الملف «${file.name}»؟ سيتم استبدال البيانات الحالية بالبيانات الموجودة في الملف. سيقوم النظام بحفظ نسخة احتياطية وقائية قبل الاستبدال.`,
          danger: true,
          okText: 'نعم، استيراد واستبدال البيانات',
        });

        if (!confirmed) {
          fileInput.value = '';
          return;
        }

        const btnCard = $('#btn-import-db-card', view);
        const btnTop = $('#btn-import-db', view);
        if (btnCard) { btnCard.disabled = true; btnCard.textContent = 'جارٍ فحص واستيراد البيانات...'; }
        if (btnTop) { btnTop.disabled = true; btnTop.textContent = 'جارٍ الاستيراد...'; }

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
          if (btnCard) {
            btnCard.disabled = false;
            btnCard.innerHTML = `${icon.upload({ size: 16 })} استيراد واستعادة البيانات`;
          }
          if (btnTop) {
            btnTop.disabled = false;
            btnTop.innerHTML = `${icon.upload({ size: 16, style: 'vertical-align:text-bottom; margin-left:4px;' })} استيراد البيانات`;
          }
        }
      });
    }
  }

  return undefined;
}
