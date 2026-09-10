// ==========================================================================
//  عرض فاتورة: التفاصيل، رمز QR، الطباعة (A4 / حراري)، التصدير، السداد.
// ==========================================================================
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import * as router from '../core/router.js';
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, qrSvg, printDoc, toastOk, toastErr,
  $, modal, formValues, confirmDialog, copyText, download, statusBadge, today, icon,
} from '../core/util.js';
import { invoiceA4, invoiceThermal, tafqeet } from '../print/templates.js';

async function loadContext(invoiceId) {
  const invoice = await api.get(`/api/invoices/${invoiceId}`);
  const [issuer, client] = await Promise.all([
    api.get(`/api/issuers/${invoice.issuer_id}`),
    api.get(`/api/clients/${invoice.client_id}`),
  ]);
  return { invoice, issuer, client };
}

function receiptModal(invoice, onDone) {
  const m = modal({
    title: `سند قبض للفاتورة ${invoice.invoice_number}`,
    body: html`
      <div class="alert alert-info">
        إجمالي الفاتورة <b class="num">${money(invoice.grand_total)}</b> —
        المسدد <b class="num">${money(invoice.paid_amount)}</b> —
        المتبقي <b class="num">${money(invoice.remaining_amount)}</b>
      </div>
      <div class="row">
        <div class="field"><label class="req">المبلغ المستلم</label>
          <input type="number" name="amount" value="${invoice.remaining_amount}" step="0.01" min="0.01" max="${invoice.remaining_amount}" /></div>
        <div class="field"><label>طريقة السداد</label>
          <select name="payment_type">
            <option value="CASH">نقداً</option>
            <option value="TRANSFER">تحويل بنكي</option>
            <option value="CARD">شبكة / بطاقة</option>
            <option value="CHEQUE">شيك</option>
          </select></div>
      </div>
      <div class="row mt">
        <div class="field"><label>التاريخ</label><input type="date" name="voucher_date" value="${today()}" /></div>
        <div class="field"><label>رقم المرجع / الشيك</label><input type="text" name="reference_no" class="ltr" /></div>
      </div>
      <div class="row mt">
        <div class="field"><label>البنك</label><input type="text" name="bank_name" /></div>
      </div>
      <div class="field mt"><label>ملاحظات</label><input type="text" name="notes" /></div>`,
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn btn-primary" data-ok type="button">تسجيل السند</button>`,
  });
  m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const values = formValues(m.body);
    if (!values.amount || values.amount <= 0) return toastErr('أدخل مبلغاً صحيحاً');
    e.target.disabled = true;
    try {
      const voucher = await api.post('/api/vouchers/for-invoice', { invoice_id: invoice.id, ...values });
      toastOk(`تم تسجيل سند القبض ${voucher.voucher_number}`);
      m.close();
      onDone();
    } catch { e.target.disabled = false; }
    return undefined;
  });
}

export function formatSaudiPhone(phone) {
  if (!phone) return '';
  let clean = String(phone).replace(/[^0-9]/g, '');
  if (clean.startsWith('00')) clean = clean.slice(2);
  if (clean.startsWith('05')) clean = '966' + clean.slice(1);
  else if (clean.startsWith('5') && clean.length === 9) clean = '966' + clean;
  return clean;
}

export async function fetchInvoicePdfBlob(invoiceId, docHtml) {
  if (docHtml) {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: window.location.origin },
        body: JSON.stringify({ html: docHtml }),
      });
      if (res.ok) return await res.blob();
    } catch {}
  }
  const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
    headers: { origin: window.location.origin },
  });
  if (!res.ok) throw new Error('تعذر إنشاء ملف PDF');
  return await res.blob();
}

export async function downloadInvoicePdf({ invoice, issuer, client }) {
  try {
    toastOk('جارٍ تجهيز ملف PDF الفاتورة...');
    const docHtml = invoiceA4({ invoice, issuer, client });
    const blob = await fetchInvoicePdfBlob(invoice.id, docHtml);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `فاتورة_${invoice.invoice_number}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    toastOk('تم تحميل ملف الفاتورة PDF بنجاح 📄');
    return blob;
  } catch (err) {
    toastErr('تعذر تنزيل ملف PDF: ' + (err.message || 'خطأ'));
    return null;
  }
}

export async function shareInvoicePdfFile({ invoice, issuer, client, text }) {
  try {
    toastOk('جارٍ تجهيز ملف PDF للمشاركة...');
    const docHtml = invoiceA4({ invoice, issuer, client });
    const blob = await fetchInvoicePdfBlob(invoice.id, docHtml);
    if (blob) {
      const filename = `فاتورة_${invoice.invoice_number}.pdf`;
      const file = new File([blob], filename, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `فاتورة ${invoice.invoice_number} — ${issuer.name_ar}`,
          text: text || `فاتورة ضريبية رقم ${invoice.invoice_number} من ${issuer.name_ar}`,
          files: [file],
        });
        toastOk('تمت مشاركة ملف الفاتورة PDF بنجاح');
        return true;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return false;
    console.warn('Share file fallback:', err);
  }

  // Fallback: download file directly to user device
  await downloadInvoicePdf({ invoice, issuer, client });
  toastOk('تم تنزيل ملف PDF الفاتورة، يمكنك إرساله ومشاركته الآن مباشرة');
  return false;
}

export function openDownloadModal({ invoice, issuer, client }) {
  const m = modal({
    title: `تحميل الفاتورة: ${invoice.invoice_number}`,
    slim: true,
    body: html`
      <div class="alert alert-info" style="font-size:.85rem">
        اختر صيغة تحميل الفاتورة المناسبة لك:
      </div>
      <div style="display:flex;flex-direction:column;gap:.75rem;margin-top:1rem">
        <!-- تحميل مباشر لملف PDF -->
        <button class="btn btn-primary" id="dl-pdf-file-opt" type="button" style="text-align:right;padding:.9rem 1rem;display:flex;flex-direction:column;gap:3px;background:linear-gradient(135deg,#0d9488,#0f766e);border-color:#0d9488">
          <span style="font-size:1rem;font-weight:bold;display:flex;align-items:center;gap:8px">
            ${raw(icon.pdf({ size: 22 }))}
            تحميل ملف الفاتورة بصيغة PDF مباشرة (.pdf)
          </span>
          <span style="font-size:.78rem;opacity:.95">تنزيل مستند PDF رسمي معتمد عالي الدقة جاهز للطباعة والمشاركة</span>
        </button>

        <!-- طباعة A4 -->
        <button class="btn" id="dl-print-opt" type="button" style="text-align:right;padding:.85rem 1rem;display:flex;flex-direction:column;gap:3px">
          <span style="font-size:.95rem;font-weight:bold;display:flex;align-items:center;gap:8px">
            ${raw(icon.printer({ size: 20 }))}
            طباعة الفاتورة A4 (حوار الطباعة المباشر)
          </span>
          <span style="font-size:.78rem;color:var(--muted)">فتح نافذة الطباعة لاختيار الطابعة أو الحفظ اليدوي</span>
        </button>

        <!-- ملف HTML مستقل -->
        <button class="btn" id="dl-html-opt" type="button" style="text-align:right;padding:.85rem 1rem;display:flex;flex-direction:column;gap:3px">
          <span style="font-size:.95rem;font-weight:bold;display:flex;align-items:center;gap:8px">
            ${raw(icon.htmlFile({ size: 20 }))}
            تحميل مستند الفاتورة (ملف HTML مستقل)
          </span>
          <span style="font-size:.78rem;color:var(--muted)">ملف خفيف يحتوي على رمز QR والبيانات بالكامل يعمل بدون اتصال بالإنترنت</span>
        </button>

        <!-- ملف XML ZATCA -->
        <button class="btn" id="dl-xml-opt" type="button" style="text-align:right;padding:.85rem 1rem;display:flex;flex-direction:column;gap:3px">
          <span style="font-size:.95rem;font-weight:bold;display:flex;align-items:center;gap:8px">
            ${raw(icon.xml({ size: 20 }))}
            تنزيل ملف XML الإلكتروني (ZATCA UBL 2.1)
          </span>
          <span style="font-size:.78rem;color:var(--muted)">الملف الإلكتروني المعتمد بصيغة XML المتوافقة مع متطلبات هيئة الزكاة</span>
        </button>
      </div>
    `,
    footer: `<button class="btn" data-close type="button">إلغاء</button>`,
  });

  $('#dl-pdf-file-opt', m.el).addEventListener('click', async () => {
    m.close();
    await downloadInvoicePdf({ invoice, issuer, client });
  });

  $('#dl-print-opt', m.el).addEventListener('click', () => {
    m.close();
    printDoc(invoiceA4({ invoice, issuer, client }));
  });

  $('#dl-html-opt', m.el).addEventListener('click', () => {
    m.close();
    const doc = invoiceA4({ invoice, issuer, client });
    download(`فاتورة_${invoice.invoice_number}.html`, doc, 'text/html;charset=utf-8');
    toastOk('تم تحميل مستند الفاتورة');
  });

  $('#dl-xml-opt', m.el).addEventListener('click', async () => {
    m.close();
    const xml = await api.text(`/api/invoices/${invoice.id}/xml`);
    download(`${invoice.invoice_number}.xml`, xml, 'application/xml;charset=utf-8');
    toastOk('تم تنزيل ملف XML');
  });
}

export function openShareModal({ invoice, issuer, client }) {
  const m = modal({
    title: `مشاركة الفاتورة: ${invoice.invoice_number}`,
    slim: true,
    body: html`
      <!-- بيانات العميل والمبلغ -->
      <div style="background:var(--bg-subtle, rgba(255,255,255,0.04));border:1px solid var(--line, #334155);padding:.85rem 1rem;margin-bottom:1.1rem;border-radius:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
        <div>
          <div style="font-size:.78rem;color:var(--muted)">العميل المستلم:</div>
          <b style="font-size:.98rem">${esc(client.name)}</b>
        </div>
        <div style="text-align:left">
          <div style="font-size:.78rem;color:var(--muted)">الإجمالي المستحق:</div>
          <b class="num" style="font-size:1.2rem;color:var(--accent, #0ea5e9)">${money(invoice.grand_total)} <small style="font-size:.75rem">ر.س</small></b>
        </div>
      </div>

      <!-- قسم مشاركة وتحميل ملف PDF الفعلي -->
      <div style="background:linear-gradient(135deg, rgba(13,148,136,0.18), rgba(99,102,241,0.18));border:1px solid rgba(13,148,136,0.35);border-radius:12px;padding:1.4rem 1rem;text-align:center">
        <div style="font-size:1.05rem;font-weight:bold;color:var(--accent,#2dd4bf);margin-bottom:5px;display:flex;align-items:center;justify-content:center;gap:8px">
          ${raw(icon.pdf({ size: 24 }))}
          مشاركة ملف الفاتورة PDF (وليس مجرد رابط)
        </div>
        <div style="font-size:.82rem;color:var(--muted);margin-bottom:1.25rem">
          مشاركة أو تنزيل ملف PDF الفعلي مباشرة لإرساله للعميل عبر تطبيقات التواصل
        </div>

        <div style="display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="btn-share-pdf-direct" type="button" style="display:flex;align-items:center;gap:8px;font-weight:bold;padding:.75rem 1.4rem;border-radius:8px;font-size:.95rem">
            ${raw(icon.share({ size: 18 }))}
            مشاركة ملف PDF عبر التطبيقات
          </button>
          <button class="btn" id="btn-dl-pdf-direct" type="button" style="display:flex;align-items:center;gap:8px;font-weight:bold;padding:.75rem 1.4rem;border-radius:8px;font-size:.95rem;background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.2)">
            ${raw(icon.download({ size: 18 }))}
            تحميل ملف PDF للجهاز
          </button>
        </div>
      </div>
    `,
    footer: `<button class="btn" data-close type="button">إغلاق</button>`,
  });

  // مشاركة ملف PDF مباشرة عبر النظام (يدعم ويندوز وتطبيقات الهاتف)
  $('#btn-share-pdf-direct', m.el).addEventListener('click', async () => {
    await shareInvoicePdfFile({ invoice, issuer, client });
  });

  // تنزيل ملف PDF للجهاز
  $('#btn-dl-pdf-direct', m.el).addEventListener('click', async () => {
    await downloadInvoicePdf({ invoice, issuer, client });
  });
}

export async function render(view, ctx) {
  const invoiceId = ctx.params[0];
  if (!invoiceId) {
    router.go('invoices');
    return undefined;
  }

  const draw = async () => {
    const { invoice, issuer, client } = await loadContext(invoiceId);

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>فاتورة ${invoice.invoice_number} ${raw(statusBadge(invoice.status, invoice.status_label))}
            <span class="badge ${invoice.zatca_phase === 'PHASE2' ? 'teal' : 'blue'}" style="font-size:.78rem;vertical-align:middle">
              ${invoice.zatca_phase === 'PHASE2' ? 'مرحلة 2' : 'مرحلة 1'}
            </span>
          </h1>
          <p>${issuer.name_ar} — ${client.name} — ${dateAr(invoice.issue_date)} ${invoice.issue_time}</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="download-invoice" type="button">
            ${raw(icon.pdf({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            تحميل الفاتورة
          </button>
          <button class="btn" id="share-invoice" type="button" style="background:#10b981;border-color:#10b981;color:#fff;font-weight:600" title="مشاركة الفاتورة">
            ${raw(icon.share({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            مشاركة
          </button>
          <button class="btn" id="print-more" type="button" title="خيارات الطباعة الورقية">
            ${raw(icon.printer({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            طباعة ورقية ▾
          </button>
          ${raw(invoice.status !== 'CANCELLED' && invoice.remaining_amount > 0 && can('vouchers.create')
    ? `<button class="btn btn-primary" id="pay" type="button">${icon.receipt({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}سند قبض</button>` : '')}
          ${raw(invoice.status !== 'CANCELLED' && can('invoices.edit') ? `<button class="btn btn-danger" id="cancel" type="button">${icon.invoiceX({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}إلغاء الفاتورة</button>` : '')}
          <a class="btn" href="#/invoices">${raw(icon.arrowRight({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}القائمة</a>
        </div>
      </div>

      ${raw(invoice.status === 'CANCELLED' ? '<div class="alert alert-danger">هذه الفاتورة ملغاة — تم عكس قيدها في كشف حساب العميل، ورقمها وبصمتها محفوظان في السلسلة.</div>' : '')}

      <div class="grid" style="grid-template-columns:minmax(0,2.4fr) minmax(260px,1fr)">
        <div>
          <div class="card pad0">
            <div class="card-head"><h3>بنود الفاتورة</h3><div class="spacer"></div>
              <span class="tiny muted">${invoice.lines.length} بند</span></div>
            <div class="table-wrap">
              <table class="tbl compact">
                <thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th class="text-end">الكمية</th>
                  <th class="text-end">السعر</th><th class="text-end">الخصم</th><th class="text-end">قبل الضريبة</th>
                  <th class="text-center">الضريبة</th><th class="text-end">قيمة الضريبة</th><th class="text-end">الإجمالي</th></tr></thead>
                <tbody>
                  ${invoice.lines.map((l, i) => raw(`<tr>
                    <td class="tiny">${i + 1}</td>
                    <td><b>${esc(l.item_name)}</b>${l.item_code ? `<div class="tiny muted mono">${esc(l.item_code)}</div>` : ''}</td>
                    <td class="tiny">${esc(l.unit)}</td>
                    <td class="text-end num">${num(l.quantity)}</td>
                    <td class="text-end num">${money(l.unit_price)}</td>
                    <td class="text-end num">${money(l.discount)}</td>
                    <td class="text-end num">${money(l.taxable)}</td>
                    <td class="text-center tiny num">${num(l.tax_rate)}%</td>
                    <td class="text-end num">${money(l.tax_amount)}</td>
                    <td class="text-end num"><b>${money(l.total_line)}</b></td>
                  </tr>`))}
                </tbody>
              </table>
            </div>
          </div>

          ${raw(invoice.allocations && invoice.allocations.length ? `
            <div class="card pad0">
              <div class="card-head"><h3>سندات القبض المرتبطة</h3></div>
              <div class="table-wrap"><table class="tbl compact">
                <thead><tr><th>رقم السند</th><th>التاريخ</th><th>طريقة السداد</th><th class="text-end">المبلغ المخصص</th><th></th></tr></thead>
                <tbody>${invoice.allocations.map((a) => `<tr>
                  <td class="mono">${esc(a.voucher_number)}</td>
                  <td class="tiny">${esc(dateAr(a.voucher_date))}</td>
                  <td class="tiny">${esc(a.payment_type)}</td>
                  <td class="text-end num">${money(a.allocated_amount)}</td>
                  <td class="actions"><a class="btn btn-sm" href="#/vouchers?q=${esc(a.voucher_number)}">${icon.eye({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}عرض</a></td>
                </tr>`).join('')}</tbody>
              </table></div>
            </div>` : '')}

          <div class="card">
            <h3>بيانات الفاتورة الإلكترونية</h3>
            <dl class="kv">
              <dt>المعرّف الفريد (UUID)</dt><dd class="mono tiny">${invoice.uuid}</dd>
              <dt>التسلسل (ICV)</dt><dd class="mono">${invoice.sequence_no}</dd>
              <dt>بصمة الفاتورة (Hash)</dt><dd class="mono tiny" style="word-break:break-all">${invoice.invoice_hash}</dd>
              <dt>بصمة الفاتورة السابقة (PIH)</dt><dd class="mono tiny" style="word-break:break-all">${invoice.previous_invoice_hash}</dd>
              <dt>وضع التوقيع</dt><dd>
                ${raw(invoice.signature_mode === 'PRODUCTION' ? '<span class="badge green">شهادة إنتاج</span>'
    : invoice.signature_mode === 'LOCAL' ? '<span class="badge amber">توقيع محلي (بدون شهادة معتمدة)</span>'
      : '<span class="badge gray">المرحلة الأولى — بدون توقيع</span>')}</dd>
              <dt>حمولة QR (Base64)</dt><dd class="mono tiny" style="word-break:break-all">${invoice.qr_payload}</dd>
            </dl>
            <div class="flex mt">
              <button class="btn btn-sm" id="copy-hash" type="button">${raw(icon.copy({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}نسخ البصمة</button>
              <button class="btn btn-sm" id="copy-qr" type="button">${raw(icon.qrCode({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}نسخ حمولة QR</button>
              <button class="btn btn-sm" id="view-xml" type="button">${raw(icon.fileText({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}عرض UBL XML</button>
            </div>
            ${raw(invoice.signature_mode === 'LOCAL' ? `<div class="alert alert-warn mt tiny">
              التوقيع مُولَّد بمفتاح محلي لأن شهادة الإنتاج (CSID) من هيئة الزكاة والضريبة والجمارك غير مُهيَّأة لهذه المنشأة.
              البنية والحساب مطابقان للمواصفة، لكن الاعتماد الرسمي يتطلب إتمام التسجيل والحصول على الشهادة.
            </div>` : '')}
          </div>
        </div>

        <div>
          <div class="card">
            <h3>الإجماليات</h3>
            <div class="totals-box">
              <div class="line"><span>الإجمالي قبل الخصم</span><span class="num">${money(invoice.subtotal)}</span></div>
              <div class="line"><span>الخصم</span><span class="num">${money(invoice.discount_amount)}</span></div>
              <div class="line"><span>الخاضع للضريبة</span><span class="num">${money(invoice.taxable_amount)}</span></div>
              <div class="line"><span>ضريبة القيمة المضافة</span><span class="num">${money(invoice.tax_amount)}</span></div>
              <div class="line grand"><span>الإجمالي</span><span class="num">${money(invoice.grand_total)}</span></div>
              <div class="line"><span>المسدد</span><span class="num">${money(invoice.paid_amount)}</span></div>
              <div class="line" style="font-weight:700;color:var(--danger)"><span>المتبقي</span><span class="num">${money(invoice.remaining_amount)}</span></div>
            </div>
            <div class="alert alert-info mt tiny mb0">${tafqeet(invoice.grand_total, invoice.currency === 'SAR' ? 'ر.س' : invoice.currency)}</div>
          </div>

          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.6rem">
              <h3 style="margin:0">رمز الاستجابة السريعة (QR)</h3>
              <span class="badge ${invoice.zatca_phase === 'PHASE2' ? 'teal' : 'blue'}">
                ${invoice.zatca_phase === 'PHASE2' ? 'المرحلة الثانية (مشفّر)' : 'المرحلة الأولى (أساسي)'}
              </span>
            </div>
            <div class="qr-box">${raw(qrSvg(invoice.qr_payload, { scale: 5 }))}</div>
            <p class="tiny muted text-center mb0 mt">
              ${invoice.zatca_phase === 'PHASE2'
                ? 'باركود معتمد للمرحلة الثانية: يتضمن الحقول الأساسية الخمسة + هاش الفاتورة والتوقيع الرقمي والمفتاح العام وسلسلة PIH.'
                : 'باركود معتمد للمرحلة الأولى: يتضمن الحقول الإلزامية الخمسة (اسم المورد، الرقم الضريبي، التاريخ والوقت، الإجمالي، والضريبة).'}
            </p>
          </div>

          <div class="card">
            <h3>الأطراف</h3>
            <dl class="kv">
              <dt>البائع</dt><dd>${issuer.name_ar}</dd>
              <dt>الرقم الضريبي</dt><dd class="mono">${issuer.tax_number || '—'}</dd>
              <dt>المشتري</dt><dd><a href="#/statement/${client.id}">${client.name}</a></dd>
              <dt>الرقم الضريبي</dt><dd class="mono">${client.tax_number || '—'}</dd>
              <dt>طريقة الدفع</dt><dd>${invoice.payment_label}</dd>
              <dt>أنشئت بواسطة</dt><dd>${invoice.created_by}</dd>
              <dt>وقت الإنشاء</dt><dd class="tiny">${dateTimeAr(invoice.created_at)}</dd>
              ${raw(invoice.batch_id ? `<dt>دفعة</dt><dd class="tiny mono">${esc(invoice.batch_id.slice(0, 8))}</dd>` : '')}
            </dl>
            ${raw(invoice.notes ? `<div class="alert alert-info mt tiny mb0"><b>ملاحظات:</b> ${esc(invoice.notes)}</div>` : '')}
          </div>
        </div>
      </div>`;

    $('#download-invoice', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await downloadInvoicePdf({ invoice, issuer, client });
      } finally {
        e.target.disabled = false;
      }
    });
    $('#share-invoice', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await shareInvoicePdfFile({ invoice, issuer, client });
      } finally {
        e.target.disabled = false;
      }
    });
    $('#print-more', view).addEventListener('click', () => {
      const pm = modal({
        title: 'خيارات الطباعة الورقية',
        slim: true,
        body: html`
          <div style="display:flex;flex-direction:column;gap:.5rem">
            <button class="btn btn-primary" id="pm-a4" type="button">${raw(icon.printer({ size: 16, style: 'vertical-align:text-bottom;margin-left:6px' }))}طباعة A4 قياسي</button>
            <button class="btn" id="pm-80" type="button">${raw(icon.receipt({ size: 16, style: 'vertical-align:text-bottom;margin-left:6px' }))}طباعة حرارية 80mm</button>
            <button class="btn" id="pm-copies" type="button">${raw(icon.copy({ size: 16, style: 'vertical-align:text-bottom;margin-left:6px' }))}طباعة نسختين (أصل + صورة)</button>
          </div>
        `,
        footer: '<button class="btn" data-close type="button">إلغاء</button>',
      });
      $('#pm-a4', pm.el).addEventListener('click', () => { pm.close(); printDoc(invoiceA4({ invoice, issuer, client })); });
      $('#pm-80', pm.el).addEventListener('click', () => { pm.close(); printDoc(invoiceThermal({ invoice, issuer, client })); });
      $('#pm-copies', pm.el).addEventListener('click', () => { pm.close(); printDoc(invoiceA4({ invoice, issuer, client, copies: 2 })); });
    });
    $('#view-xml', view).addEventListener('click', async () => {
      const xml = await api.text(`/api/invoices/${invoice.id}/xml`);
      modal({
        title: `UBL 2.1 XML — ${invoice.invoice_number}`,
        wide: true,
        body: html`<textarea class="mono ltr" readonly style="min-height:420px;font-size:.72rem">${xml}</textarea>`,
      });
    });
    $('#copy-hash', view).addEventListener('click', () => copyText(invoice.invoice_hash));
    $('#copy-qr', view).addEventListener('click', () => copyText(invoice.qr_payload));

    const payBtn = $('#pay', view);
    if (payBtn) payBtn.addEventListener('click', () => receiptModal(invoice, draw));

    const cancelBtn = $('#cancel', view);
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'إلغاء الفاتورة',
          message: 'سيتم عكس قيد الفاتورة في كشف الحساب مع الاحتفاظ برقمها وبصمتها في السلسلة (الإلغاء أسلم من الحذف). هل تريد المتابعة؟',
          danger: true,
          okText: 'إلغاء الفاتورة',
        });
        if (!ok) return;
        try {
          await api.post(`/api/invoices/${invoice.id}/cancel`, { reason: 'إلغاء من شاشة الفاتورة' });
          toastOk('تم إلغاء الفاتورة');
          draw();
        } catch { /* تنبيه تلقائي */ }
      });
    }
  };

  await draw();
  return undefined;
}
