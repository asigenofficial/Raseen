// ==========================================================================
//  إدارة الشركات / المنشآت المصدرة (Multi-Issuer)
// ==========================================================================
import { api } from '../core/api.js';
import { store, loadIssuers, invalidate, can, setActiveIssuer } from '../core/store.js';
import {
  html, raw, esc, modal, formValues, toastOk, toastErr,
  confirmDialog, $, $$, delegate, dateTimeAr, icon,
  exportExcel, exportCsv,
} from '../core/util.js';

const CITIES = ['الرياض', 'جدة', 'مكة المكرمة', 'المدينة المنورة', 'الدمام', 'الخبر', 'الظهران', 'بريدة', 'أبها', 'تبوك', 'حائل', 'نجران', 'جيزان', 'الطائف', 'الأحساء', 'الجبيل', 'ينبع'];

function issuerForm(data = {}) {
  const v = (k, def = '') => (data[k] === undefined || data[k] === null ? def : data[k]);
  return html`
    <div class="tabs" id="iss-tabs">
      <div class="tab active" data-tab="basic">البيانات الأساسية</div>
      <div class="tab" data-tab="address">العنوان الوطني</div>
      <div class="tab" data-tab="numbering">الترقيم والضريبة</div>
      <div class="tab" data-tab="print">الطباعة والبنك</div>
    </div>

    <div data-panel="basic">
      <div class="row">
        <div class="field"><label class="req">كود الشركة</label>
          <input type="text" name="code" value="${v('code')}" class="ltr" placeholder="ZS-001" /></div>
        <div class="field"><label class="req">الاسم الرسمي بالعربية</label>
          <input type="text" name="name_ar" value="${v('name_ar')}" /></div>
      </div>
      <div class="row mt">
        <div class="field"><label>الاسم بالإنجليزية</label>
          <input type="text" name="name_en" value="${v('name_en')}" class="ltr" /></div>
        <div class="field"><label>الرقم الضريبي (15 رقماً)</label>
          <input type="text" name="tax_number" value="${v('tax_number')}" class="ltr" maxlength="15" placeholder="3XXXXXXXXXXXXX3" />
          <span class="hint">يجب أن يبدأ وينتهي بالرقم 3</span></div>
      </div>
      <div class="row mt">
        <div class="field"><label>رقم السجل التجاري</label>
          <input type="text" name="commercial_register" value="${v('commercial_register')}" class="ltr" /></div>
        <div class="field"><label>الهاتف</label>
          <input type="text" name="phone" value="${v('phone')}" class="ltr" /></div>
      </div>
      <div class="row mt">
        <div class="field"><label>البريد الإلكتروني</label>
          <input type="email" name="email" value="${v('email')}" class="ltr" /></div>
        <div class="field"><label>الموقع الإلكتروني</label>
          <input type="text" name="website" value="${v('website')}" class="ltr" /></div>
      </div>
      <div class="row mt">
        <div class="field">
          <label>شعار المنشأة (يظهر في الفاتورة)</label>
          <input type="file" id="logo-file" accept="image/png,image/jpeg,image/svg+xml,image/webp" />
          <span class="hint">الحد الأقصى 2 ميجابايت — يُحفظ داخل قاعدة البيانات</span>
        </div>
        <div class="field" style="max-width:150px">
          <label>معاينة</label>
          <div id="logo-preview" style="border:1px dashed var(--line-strong);border-radius:8px;padding:.4rem;min-height:70px;display:grid;place-items:center">
            ${raw(v('logo_data') ? `<img src="${esc(v('logo_data'))}" style="max-width:100%;max-height:70px" alt="الشعار" />` : '<span class="tiny muted">لا يوجد شعار</span>')}
          </div>
          <input type="hidden" name="logo_data" value="${v('logo_data')}" />
          <button class="btn btn-sm" type="button" id="logo-clear">إزالة الشعار</button>
        </div>
      </div>
      <label class="check mt"><input type="checkbox" name="is_active" ${raw(v('is_active', true) ? 'checked' : '')} /> الشركة نشطة (تظهر في شاشات الإصدار)</label>
    </div>

    <div data-panel="address" class="hidden">
      <div class="row">
        <div class="field"><label>الشارع (عربي)</label><input type="text" name="street" value="${v('street')}" /></div>
        <div class="field"><label>Street (English)</label><input type="text" name="street_en" value="${v('street_en')}" class="ltr" placeholder="e.g. King Fahd Road" /></div>
        <div class="field" style="max-width:130px"><label>رقم المبنى</label><input type="text" name="building_no" value="${v('building_no')}" class="ltr" /></div>
      </div>
      <div class="row mt">
        <div class="field"><label>الحي (عربي)</label><input type="text" name="district" value="${v('district')}" /></div>
        <div class="field"><label>District (English)</label><input type="text" name="district_en" value="${v('district_en')}" class="ltr" placeholder="e.g. Al Olaya" /></div>
        <div class="field"><label>المدينة (عربي)</label>
          <input type="text" name="city" value="${v('city')}" list="cities-list" />
          <datalist id="cities-list">${raw(CITIES.map((c) => `<option value="${esc(c)}"></option>`).join(''))}</datalist>
        </div>
        <div class="field"><label>City (English)</label><input type="text" name="city_en" value="${v('city_en')}" class="ltr" placeholder="e.g. Riyadh" /></div>
      </div>
      <div class="row mt">
        <div class="field" style="max-width:150px"><label>الرمز البريدي</label><input type="text" name="postal_code" value="${v('postal_code')}" class="ltr" /></div>
        <div class="field" style="max-width:150px"><label>رمز الدولة</label><input type="text" name="country" value="${v('country', 'SA')}" class="ltr" maxlength="2" /></div>
        <div class="field"><label>العنوان بالإنجليزية (Full English Address)</label>
          <input type="text" name="address_en" value="${v('address_en')}" class="ltr" placeholder="e.g. King Fahd Rd, Al Olaya, Bldg 1234, Riyadh 12214, Saudi Arabia" />
        </div>
      </div>
      <div class="alert alert-info mt">العنوان الوطني مطلوب في الفاتورة الضريبية المتوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك (عربي وإنجليزي). في حال ترك العنوان الإنجليزي فارغاً سيتم تركيبه تلقائياً من الحقول الإنجليزية.</div>
    </div>

    <div data-panel="numbering" class="hidden">
      <div class="row">
        <div class="field"><label>بادئة رقم الفاتورة</label><input type="text" name="invoice_prefix" value="${v('invoice_prefix', 'INV')}" class="ltr" /></div>
        <div class="field" style="max-width:150px"><label>الرقم القادم</label><input type="number" name="invoice_next_no" value="${v('invoice_next_no', 1)}" min="1" /></div>
        <div class="field" style="max-width:130px"><label>عدد الخانات</label><input type="number" name="invoice_pad" value="${v('invoice_pad', 5)}" min="1" max="12" /></div>
      </div>
      <div class="row mt">
        <div class="field"><label>بادئة رقم سند القبض</label><input type="text" name="voucher_prefix" value="${v('voucher_prefix', 'RV')}" class="ltr" /></div>
        <div class="field" style="max-width:150px"><label>الرقم القادم</label><input type="number" name="voucher_next_no" value="${v('voucher_next_no', 1)}" min="1" /></div>
      </div>
      <div class="row mt">
        <div class="field" style="max-width:170px"><label>نسبة الضريبة الافتراضية %</label>
          <input type="number" name="default_tax_rate" value="${v('default_tax_rate', 15)}" min="0" max="100" step="0.01" /></div>
        <div class="field" style="max-width:150px"><label>العملة</label><input type="text" name="currency" value="${v('currency', 'SAR')}" class="ltr" /></div>
        <div class="field"><label>مرحلة الفاتورة الإلكترونية</label>
          <select name="zatca_phase">
            <option value="PHASE1" ${raw(v('zatca_phase') === 'PHASE1' ? 'selected' : '')}>المرحلة الأولى — QR بالحقول الخمسة</option>
            <option value="PHASE2" ${raw(v('zatca_phase') === 'PHASE2' ? 'selected' : '')}>المرحلة الثانية — هاش وتوقيع رقمي وسلسلة PIH</option>
          </select>
        </div>
      </div>
      <div class="alert alert-info mt">
        رقم الفاتورة فريد لكل شركة على حدة، فيمكن لشركتين مختلفتين استخدام نفس التسلسل دون تعارض.
      </div>
    </div>

    <div data-panel="print" class="hidden">
      <div class="row">
        <div class="field"><label>اسم البنك</label><input type="text" name="bank_name" value="${v('bank_name')}" /></div>
        <div class="field"><label>رقم الآيبان</label><input type="text" name="bank_iban" value="${v('bank_iban')}" class="ltr" /></div>
      </div>
      <div class="card mt pad-sm" style="background:var(--bg-alt, #f8fafc)">
        <h4 style="margin:0 0 .5rem;font-size:.9rem">إعدادات رمز الاستجابة السريعة (QR)</h4>
        <div class="row">
          <label class="check"><input type="checkbox" id="qr_show_a4" ${raw(v('qr_settings', {}).show_a4 !== false ? 'checked' : '')} /> إظهار QR في فاتورة A4</label>
          <label class="check mr"><input type="checkbox" id="qr_show_thermal" ${raw(v('qr_settings', {}).show_thermal !== false ? 'checked' : '')} /> إظهار QR في الفاتورة الحرارية</label>
        </div>
        <div class="row mt">
          <div class="field" style="max-width:180px">
            <label>حجم رمز QR</label>
            <select name="qr_size">
              <option value="small" ${raw(v('qr_settings', {}).size === 'small' ? 'selected' : '')}>صغير</option>
              <option value="normal" ${raw(!v('qr_settings', {}).size || v('qr_settings', {}).size === 'normal' ? 'selected' : '')}>متوسط (افتراضي)</option>
              <option value="large" ${raw(v('qr_settings', {}).size === 'large' ? 'selected' : '')}>كبير</option>
            </select>
          </div>
        </div>
      </div>
      <div class="field mt"><label>نص التذييل في الفاتورة</label>
        <textarea name="footer_notes">${v('footer_notes')}</textarea></div>
      <div class="field mt"><label>الملاحظات والشروط القانونية</label>
        <textarea name="legal_terms">${v('legal_terms')}</textarea></div>
    </div>`;
}

function openIssuerModal(issuer, onSaved) {
  const isNew = !issuer;
  const m = modal({
    title: isNew ? 'إضافة شركة مصدرة' : `تعديل: ${issuer.name_ar}`,
    wide: true,
    body: issuerForm(issuer || {}),
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn btn-primary" data-save type="button">${isNew ? 'إضافة الشركة' : 'حفظ التعديلات'}</button>`,
  });

  delegate(m.body, 'click', '.tab', (e, tab) => {
    $$('.tab', m.body).forEach((t) => t.classList.toggle('active', t === tab));
    $$('[data-panel]', m.body).forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
  });

  const fileInput = $('#logo-file', m.body);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toastErr('حجم الشعار يتجاوز 2 ميجابايت');
    const reader = new FileReader();
    reader.onload = () => {
      $('[name=logo_data]', m.body).value = reader.result;
      $('#logo-preview', m.body).innerHTML = `<img src="${reader.result}" style="max-width:100%;max-height:70px" alt="الشعار" />`;
    };
    reader.readAsDataURL(file);
    return undefined;
  });
  $('#logo-clear', m.body).addEventListener('click', () => {
    $('[name=logo_data]', m.body).value = '';
    $('#logo-preview', m.body).innerHTML = '<span class="tiny muted">لا يوجد شعار</span>';
  });

  m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
    const values = formValues(m.body);
    if (!values.code || !values.name_ar) return toastErr('كود الشركة والاسم بالعربية مطلوبان');
    values.is_active = values.is_active ? 1 : 0;
    values.qr_settings = JSON.stringify({
      show_a4: $('#qr_show_a4', m.body) ? $('#qr_show_a4', m.body).checked : true,
      show_thermal: $('#qr_show_thermal', m.body) ? $('#qr_show_thermal', m.body).checked : true,
      size: $('[name=qr_size]', m.body) ? $('[name=qr_size]', m.body).value : 'normal',
    });
    values.default_tax_rate = Number(values.default_tax_rate) || 15;
    values.invoice_next_no = parseInt(values.invoice_next_no, 10) || 1;
    values.invoice_pad = parseInt(values.invoice_pad, 10) || 5;
    values.voucher_next_no = parseInt(values.voucher_next_no, 10) || 1;
    e.target.disabled = true;
    try {
      if (isNew) await api.post('/api/issuers', values);
      else await api.put(`/api/issuers/${issuer.id}`, values);
      m.close();
      toastOk('تم الحفظ بنجاح');
      invalidate('issuers');
      await loadIssuers(true);
      if (onSaved) onSaved();
    } catch {
      e.target.disabled = false;
    }
    return undefined;
  });
}

async function openCredentials(issuer) {
  const creds = await api.get(`/api/issuers/${issuer.id}/credentials`);
  const m = modal({
    title: `إعدادات الربط والفاتورة الإلكترونية — ${issuer.name_ar}`,
    body: html`
      <div class="alert alert-warn">
        هذه البيانات حساسة وتُخزَّن مشفّرة (AES-256-GCM) بمفتاح محلي في مجلد <span class="mono">data</span>.
        الحصول على شهادة الامتثال والإنتاج (CSID) يتم عبر منصة هيئة الزكاة والضريبة والجمارك، وهو مطلوب للربط الفعلي.
      </div>
      <dl class="kv">
        <dt>مفتاح التوقيع (ECDSA)</dt><dd>${raw(creds.has_private_key ? '<span class="badge green">متوفر</span>' : '<span class="badge gray">غير متوفر</span>')}</dd>
        <dt>شهادة X.509</dt><dd>${raw(creds.has_certificate ? '<span class="badge green">متوفرة</span>' : '<span class="badge gray">غير متوفرة</span>')}</dd>
        <dt>شهادة الامتثال</dt><dd>${creds.has_compliance_csid ? creds.compliance_csid_masked : '—'}</dd>
        <dt>شهادة الإنتاج</dt><dd>${creds.has_production_csid ? creds.production_csid_masked : '—'}</dd>
        <dt>آخر تحديث</dt><dd class="tiny mono">${creds.updated_at ? dateTimeAr(creds.updated_at) : '—'}</dd>
      </dl>
      ${raw(creds.certificate_info ? `<div class="alert alert-info mt tiny">
          <b>الشهادة:</b> ${esc(creds.certificate_info.subject)}<br/>
          <b>الجهة المصدرة:</b> ${esc(creds.certificate_info.issuer)}<br/>
          <b>تنتهي:</b> ${esc(creds.certificate_info.valid_to)}
        </div>` : '')}
      <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0" />
      <div class="stack">
        <button class="btn" type="button" id="gen-key">توليد مفتاح توقيع ECDSA محلي (prime256v1)</button>
        <div class="field"><label>شهادة الامتثال (Compliance CSID)</label><input type="text" name="compliance_csid" class="ltr" placeholder="اتركه فارغاً لعدم التغيير" /></div>
        <div class="field"><label>شهادة الإنتاج (Production CSID)</label><input type="text" name="production_csid" class="ltr" placeholder="اتركه فارغاً لعدم التغيير" /></div>
        <div class="field"><label>المفتاح السري (Secret)</label><input type="password" name="secret" class="ltr" placeholder="اتركه فارغاً لعدم التغيير" /></div>
        <div class="field"><label>شهادة X.509 بصيغة PEM</label>
          <textarea name="certificate_pem" class="ltr mono" placeholder="-----BEGIN CERTIFICATE-----"></textarea></div>
      </div>`,
    footer: `<button class="btn" data-close type="button">إغلاق</button>
             <button class="btn btn-primary" data-save type="button">حفظ البيانات الحساسة</button>`,
  });

  $('#gen-key', m.body).addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await api.post(`/api/issuers/${issuer.id}/generate-key`, {});
      toastOk('تم توليد مفتاح التوقيع');
      m.close();
      modal({
        title: 'المفتاح العام (لطلب الشهادة)',
        body: html`<p class="small">استخدم المفتاح العام التالي عند إعداد طلب توقيع الشهادة (CSR) لدى الهيئة:</p>
          <textarea class="mono ltr" readonly style="min-height:150px">${res.public_key_pem}</textarea>`,
      });
    } catch { e.target.disabled = false; }
  });

  m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api.put(`/api/issuers/${issuer.id}/credentials`, formValues(m.body));
      toastOk('تم حفظ بيانات الربط');
      m.close();
    } catch { e.target.disabled = false; }
  });
}

async function verifyChain(issuer) {
  const res = await api.get(`/api/issuers/${issuer.id}/verify-chain`);
  modal({
    title: `التحقق من سلسلة الفواتير — ${issuer.name_ar}`,
    body: html`
      <div class="alert ${res.ok ? 'alert-success' : 'alert-danger'}">
        ${res.ok ? 'السلسلة سليمة: هاش كل فاتورة يطابق محتواها ومرتبط بالفاتورة السابقة.' : 'تم العثور على مشكلات في السلسلة.'}
      </div>
      <dl class="kv"><dt>عدد الفواتير المتحقق منها</dt><dd>${res.invoices_checked}</dd></dl>
      ${raw(res.problems && res.problems.length ? `<table class="tbl mt"><thead><tr><th>الفاتورة</th><th>الملاحظة</th></tr></thead><tbody>
        ${res.problems.map((p) => `<tr><td class="mono">${esc(p.invoice_number)}</td><td>${esc(p.issue)}</td></tr>`).join('')}
      </tbody></table>` : '')}`,
  });
}

function openIssuerImportModal(onSuccess) {
  const m = modal({
    title: 'استيراد الشركات المصدرة من ملف Excel / CSV',
    body: html`
      <div class="stack">
        <div class="dropzone" id="issuer-import-dropzone" style="margin-top:.4rem;padding:2rem 1.2rem;cursor:pointer;">
          <div class="dropzone-icon" style="margin-bottom:.6rem;">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>
          </div>
          <button type="button" class="btn btn-primary" id="btn-browse-issuer-file" style="margin-bottom:.8rem;font-size:1rem;padding:.65rem 1.4rem;pointer-events:none;">
            ${icon.upload({ size: 18 })}
            <span>فتح واختيار ملف Excel أو CSV من جهازك</span>
          </button>
          <div style="font-size:.9rem;color:var(--muted);margin-bottom:.3rem;">
            أو اسحب ملف الإكسل وأفلته مباشرة هنا
          </div>
          <div class="tiny dim" id="issuer-selected-file">
            الصيغ المدعومة: ملفات Excel (.xlsx, .xls) أو .csv
          </div>
          <input type="file" id="issuer-import-file" accept=".xlsx,.xls,.csv" style="display:none;" />
        </div>

        <div class="row items-center justify-between" style="padding:.2rem .4rem;margin-top:.2rem;">
          <span class="tiny muted">يقوم النظام تلقائياً بالتعرف على الأعمدة وتحديث الشركات الحالية وإضافة الجديدة</span>
          <a class="tiny muted" href="/api/issuers/template" download="issuers-import-template.xlsx" style="text-decoration:underline;">
            ${icon.download({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px;' })}تنزيل نموذج Excel تجريبي فارغ
          </a>
        </div>

        <div id="issuer-import-preview" style="display:none"></div>
      </div>
    `,
    footer: `
      <button class="btn" data-close type="button">إلغاء</button>
      <button class="btn btn-primary" id="commit-issuer-import" type="button" disabled>اعتماد وإضافة الشركات</button>
    `,
  });

  const dropzone = m.el.querySelector('#issuer-import-dropzone');
  const fileInput = m.el.querySelector('#issuer-import-file');
  const fileNameEl = m.el.querySelector('#issuer-selected-file');
  const previewArea = m.el.querySelector('#issuer-import-preview');
  const commitBtn = m.el.querySelector('#commit-issuer-import');
  let parsedIssuers = [];

  dropzone.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });

  async function handleFile(file) {
    fileNameEl.innerHTML = `<span style="color:var(--brand);font-weight:700;">ملف محدد: ${esc(file.name)} (${(file.size / 1024).toFixed(1)} ك.ب)</span>`;
    previewArea.style.display = 'block';
    previewArea.innerHTML = '<div class="text-center muted" style="padding:1.5rem">جارٍ قراءة وفحص ملف الشركات…</div>';
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

      const res = await api.post('/api/issuers/analyze-excel', { file_base64: b64, filename: file.name });
      parsedIssuers = (res.rows || []).filter((r) => !r.errors || r.errors.length === 0);

      const errorRows = (res.rows || []).filter((r) => r.errors && r.errors.length > 0);
      let errorsSnippet = '';
      if (errorRows.length) {
        errorsSnippet = `
          <div class="alert alert-danger tiny mt" style="max-height:100px;overflow-y:auto">
            <b>تحذير: تم استبعاد ${errorRows.length} صف لاحتوائها على أخطاء:</b>
            <ul>${errorRows.slice(0, 5).map((er) => `<li>صف ${er.row_index}: ${esc(er.name_ar || 'بدون اسم')} (${er.errors.join('، ')})</li>`).join('')}</ul>
          </div>
        `;
      }

      previewArea.innerHTML = html`
        <div class="card pad0 mt" style="border:1px solid var(--line);background:var(--card-solid);">
          <div style="padding:.6rem 1rem;background:rgba(255,255,255,0.03);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);">
            <b>معاينة الشركات الجاهزة للاستيراد (${parsedIssuers.length} شركة)</b>
            <span class="badge blue">${res.total_rows} سطر في الملف</span>
          </div>
          <div class="table-wrap" style="max-height:220px;overflow-y:auto">
            <table class="tbl tiny">
              <thead><tr><th>#</th><th>كود</th><th>الاسم بالعربية</th><th>الاسم بالإنجليزية</th><th>الرقم الضريبي</th><th>السجل التجاري</th><th>المدينة</th><th>الهاتف</th></tr></thead>
              <tbody>
                ${parsedIssuers.slice(0, 25).map((iss, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td class="mono">${esc(iss.code || 'تلقائي')}</td>
                    <td><b>${esc(iss.name_ar)}</b></td>
                    <td class="ltr">${esc(iss.name_en || '—')}</td>
                    <td class="mono">${esc(iss.tax_number || '—')}</td>
                    <td class="mono">${esc(iss.commercial_register || '—')}</td>
                    <td>${esc(iss.city || '—')}</td>
                    <td class="ltr">${esc(iss.phone || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${parsedIssuers.length > 25 ? `<div class="tiny muted text-center" style="padding:.4rem">تم عرض أول 25 شركة فقط من أصل ${parsedIssuers.length}…</div>` : ''}
        </div>
        ${raw(errorsSnippet)}
      `;

      if (parsedIssuers.length > 0) {
        commitBtn.disabled = false;
      } else {
        previewArea.innerHTML += '<div class="alert alert-danger tiny mt">لم يتم العثور على أي شركات صالحة للاستيراد في الملف</div>';
      }
    } catch (err) {
      previewArea.innerHTML = `<div class="alert alert-danger tiny">${esc(err.message || 'فشل فحص الملف')}</div>`;
    }
  }

  commitBtn.addEventListener('click', async () => {
    if (!parsedIssuers.length) return;
    commitBtn.disabled = true;
    commitBtn.textContent = 'جارٍ الحفظ والاعتماد…';
    try {
      const res = await api.post('/api/issuers/import', { issuers: parsedIssuers });
      toastOk(`تم استيراد ${res.created + res.updated} شركة بنجاح (جديدة: ${res.created}، محدثة: ${res.updated})`);
      m.close();
      onSuccess?.();
    } catch (err) {
      toastErr(err.message || 'فشل استيراد الشركات');
      commitBtn.disabled = false;
      commitBtn.textContent = 'اعتماد وإضافة الشركات';
    }
  });
}

export async function render(view) {
  const draw = async () => {
    const rawIssuers = await api.get('/api/issuers');
    const issuers = Array.isArray(rawIssuers) ? rawIssuers : (rawIssuers?.data || []);
    store.issuers = issuers;
    const writable = can('issuers.write');

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>الشركات المصدرة</h1>
          <p>كل شركة مستقلة تماماً ببياناتها الرسمية وترقيمها وضريبتها وسلسلة فواتيرها الإلكترونية.</p>
        </div>
        <div class="page-actions">
          ${raw(writable ? `<button class="btn btn-primary" id="add-issuer" type="button">${icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}إضافة شركة</button>` : '')}
          ${raw(writable ? `<button class="btn btn-outline" id="import-issuers-btn" type="button">${icon.upload({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}استيراد Excel</button>` : '')}
          <button class="btn" id="exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn" id="exp-csv" type="button">${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}CSV</button>
        </div>
      </div>

      ${raw(!issuers.length ? `<div class="card"><div class="empty">
        <h3>لا توجد شركات مصدرة بعد</h3>
        <p class="muted">أضف أول شركة لتتمكن من إصدار الفواتير وسندات القبض.</p>
        <div class="row gap mt justify-center">
          ${writable ? `<button class="btn btn-primary" id="add-issuer-2" type="button">${icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}إضافة شركة</button>` : ''}
          ${writable ? `<button class="btn btn-outline" id="import-issuers-btn-2" type="button">${icon.upload({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}استيراد Excel</button>` : ''}
        </div>
      </div></div>` : '')}

      ${raw(issuers.length ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:0.65rem;">
        ${issuers.map((i) => `
          <div class="card" style="padding:0.65rem 0.85rem; border-radius:8px; border:1px solid ${i.id === store.activeIssuerId ? 'var(--primary, #06b6d4)' : 'var(--line)'}; background:${i.id === store.activeIssuerId ? 'rgba(6,182,212,0.04)' : 'var(--surface)'}; display:flex; flex-direction:column; justify-content:space-between; gap:0.45rem;">
            <!-- ترويسة البطاقة المصغرة -->
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:34px; height:34px; border-radius:6px; background:rgba(6,182,212,0.1); display:grid; place-items:center; overflow:hidden; flex:none; border:1px solid rgba(6,182,212,0.2)">
                ${i.logo_data ? `<img src="${esc(i.logo_data)}" alt="logo" style="width:100%;height:100%;object-fit:contain" />` : icon.building({ size: 18, stroke: 'var(--brand)' })}
              </div>
              <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:4px;">
                  <h4 style="margin:0; font-size:0.88rem; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${esc(i.name_ar)}">${esc(i.name_ar)}</h4>
                  <span class="badge mono" style="font-size:0.65rem; padding:1px 4px; flex:none;">${esc(i.code)}</span>
                </div>
                <div style="display:flex; align-items:center; gap:3px; margin-top:2px; flex-wrap:wrap;">
                  <span class="badge ${i.is_active ? 'green' : 'gray'}" style="font-size:0.62rem; padding:0 4px;">${i.is_active ? 'نشطة' : 'معطلة'}</span>
                  <span class="badge ${i.zatca_phase === 'PHASE2' ? 'teal' : 'blue'}" style="font-size:0.62rem; padding:0 4px;">${i.zatca_phase === 'PHASE2' ? 'المرحلة 2' : 'المرحلة 1'}</span>
                  ${i.id === store.activeIssuerId ? '<span class="badge amber" style="font-size:0.62rem; padding:0 4px;">النشطة</span>' : ''}
                </div>
              </div>
            </div>

            <!-- بيانات المنشأة في شبكة مدمجة -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:3px 6px; font-size:0.73rem; background:rgba(255,255,255,0.02); padding:5px 7px; border-radius:6px; border:1px solid rgba(255,255,255,0.04);">
              <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><span style="color:var(--muted)">ضريبي:</span> <span class="mono" style="font-weight:600">${esc(i.tax_number || '—')}</span></div>
              <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><span style="color:var(--muted)">سجل:</span> <span class="mono">${esc(i.commercial_register || '—')}</span></div>
              <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><span style="color:var(--muted)">المدينة:</span> <span>${esc(i.city || '—')}</span></div>
              <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><span style="color:var(--muted)">ترقيم:</span> <span class="mono">${esc(i.invoice_prefix)}-${String(i.invoice_next_no).padStart(i.invoice_pad, '0')}</span> (${esc(String(i.default_tax_rate))}%)</div>
            </div>

            <!-- أزرار الإجراءات المصغرة -->
            <div style="display:flex; align-items:center; gap:3px; flex-wrap:wrap; padding-top:2px;">
              ${i.id !== store.activeIssuerId ? `<button class="btn btn-xs" data-act="activate" data-id="${esc(i.id)}" type="button" title="تعيين كمنشأة نشطة">${icon.check({ size: 10, style: 'vertical-align:middle;margin-left:2px' })}نشطة</button>` : ''}
              ${writable ? `<button class="btn btn-xs" data-act="edit" data-id="${esc(i.id)}" type="button" title="تعديل">${icon.edit({ size: 10, style: 'vertical-align:middle;margin-left:2px' })}تعديل</button>` : ''}
              <button class="btn btn-xs" data-act="creds" data-id="${esc(i.id)}" type="button" title="الربط الإلكتروني والشهادات">${icon.shieldCheck({ size: 10, style: 'vertical-align:middle;margin-left:2px' })}ربط</button>
              <button class="btn btn-xs" data-act="chain" data-id="${esc(i.id)}" type="button" title="التحقق من سلسلة الفواتير">${icon.search({ size: 10, style: 'vertical-align:middle;margin-left:2px' })}سلسلة</button>
              <a class="btn btn-xs" href="#/invoices?issuer_id=${esc(i.id)}" title="فواتير المنشأة">${icon.invoice({ size: 10, style: 'vertical-align:middle;margin-left:2px' })}فواتير</a>
              ${writable ? `<button class="btn btn-xs btn-danger" style="margin-inline-start:auto; padding:2px 5px;" data-act="del" data-id="${esc(i.id)}" type="button" title="حذف المنشأة">${icon.trash({ size: 10, style: 'vertical-align:middle' })}</button>` : ''}
            </div>
          </div>`).join('')}
      </div>` : '')}`;

    const addBtn = $('#add-issuer', view);
    if (addBtn) addBtn.addEventListener('click', () => openIssuerModal(null, draw));
    const add2 = $('#add-issuer-2', view);
    if (add2) add2.addEventListener('click', () => openIssuerModal(null, draw));

    const triggerImport = () => {
      openIssuerImportModal(async () => {
        invalidate('issuers');
        await loadIssuers(true);
        draw();
      });
    };
    const impBtn = $('#import-issuers-btn', view);
    if (impBtn) impBtn.addEventListener('click', triggerImport);
    const impBtn2 = $('#import-issuers-btn-2', view);
    if (impBtn2) impBtn2.addEventListener('click', triggerImport);

    const expHeaders = [
      'كود الشركة', 'الاسم الرسمي بالعربية', 'الاسم بالإنجليزية', 'الرقم الضريبي', 'السجل التجاري',
      'المدينة', 'الحي', 'الشارع', 'رقم المبنى', 'الرمز البريدي',
      'الهاتف', 'البريد الإلكتروني', 'الموقع الإلكتروني', 'نسبة الضريبة%', 'بادئة الفاتورة', 'الحالة',
    ];
    const expRows = () => issuers.map((i) => [
      i.code,
      i.name_ar,
      i.name_en || '',
      i.tax_number || '',
      i.commercial_register || '',
      i.city || '',
      i.district || '',
      i.street || '',
      i.building_no || '',
      i.postal_code || '',
      i.phone || '',
      i.email || '',
      i.website || '',
      i.default_tax_rate ?? 15,
      i.invoice_prefix || 'INV',
      i.is_active ? 'نشطة' : 'معطلة',
    ]);

    const expXls = $('#exp-xls', view);
    if (expXls) {
      expXls.addEventListener('click', () => {
        exportExcel('الشركات_المصدرة', 'الشركات والمنشآت المصدرة', expHeaders, expRows());
      });
    }

    const expCsv = $('#exp-csv', view);
    if (expCsv) {
      expCsv.addEventListener('click', () => {
        exportCsv('الشركات_المصدرة', expHeaders, expRows());
      });
    }

    delegate(view, 'click', '[data-act]', async (e, btn) => {
      const issuer = issuers.find((x) => x.id === btn.dataset.id);
      if (!issuer) return;
      switch (btn.dataset.act) {
        case 'activate':
          setActiveIssuer(issuer.id);
          toastOk(`تم تعيين «${issuer.name_ar}» كشركة نشطة`);
          draw();
          break;
        case 'edit': {
          const full = await api.get(`/api/issuers/${issuer.id}`);
          openIssuerModal(full, draw);
          break;
        }
        case 'creds': openCredentials(issuer); break;
        case 'chain': verifyChain(issuer); break;
        case 'del': {
          const ok = await confirmDialog({
            title: 'حذف شركة مصدرة',
            message: `سيتم حذف «${issuer.name_ar}» نهائياً. لا يمكن الحذف إذا كانت لها فواتير.`,
            danger: true,
            okText: 'حذف',
          });
          if (!ok) return;
          try {
            await api.del(`/api/issuers/${issuer.id}`);
            toastOk('تم حذف الشركة');
            invalidate('issuers');
            await loadIssuers(true);
            draw();
          } catch { /* رسالة الخطأ تظهر تلقائياً */ }
          break;
        }
        default: break;
      }
    });
  };

  await draw();
  return undefined;
}
