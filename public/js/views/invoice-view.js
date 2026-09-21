// ==========================================================================
//  عرض فاتورة: التفاصيل، رمز QR، الطباعة (A4 / حراري)، التصدير، السداد.
// ==========================================================================
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import * as router from '../core/router.js';
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, qrSvg, printDoc, toastOk, toastErr,
  $, modal, formValues, confirmDialog, copyText, download, statusBadge, today, icon,
  amount, sarSvg,
} from '../core/util.js';
import { invoiceA4, tafqeet, INVOICE_TEMPLATES } from '../print/templates.js';

async function loadContext(invoiceId) {
  const invoice = await api.get(`/api/invoices/${invoiceId}`);
  const lines = Array.isArray(invoice.lines) ? invoice.lines : (Array.isArray(invoice.items) ? invoice.items : []);
  invoice.lines = lines;
  invoice.items = lines;
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
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
      method: docHtml ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', origin: window.location.origin },
      ...(docHtml ? { body: JSON.stringify({ html: docHtml }) } : {}),
    });
    if (res.ok) return await res.blob();
  } catch (e) {
    console.warn('PDF server endpoint unreachable:', e);
  }
  throw new Error('تعذر إنشاء ملف PDF من الخادم');
}

export async function downloadInvoicePdf({ invoice, issuer, client, printSettings = null, docHtml = null }) {
  const finalHtml = docHtml || invoiceA4({ invoice, issuer, client, printSettings });
  try {
    invoice.lines = Array.isArray(invoice.lines) ? invoice.lines : (Array.isArray(invoice.items) ? invoice.items : []);
    invoice.items = invoice.lines;
    toastOk('جارٍ تجهيز ملف PDF الفاتورة...');
    let blob = null;
    try {
      blob = await fetchInvoicePdfBlob(invoice.id, finalHtml);
    } catch (e) {
      console.warn('PDF direct generation failed:', e);
    }

    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `فاتورة_${invoice.invoice_number || invoice.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 6000);
      toastOk('تم تحميل ملف الفاتورة PDF بنجاح 📄');
      return blob;
    }

    // Fallback: open print dialog to save as PDF
    printDoc(finalHtml);
    toastOk('تم فتح حوار الطباعة / الحفظ كملف PDF');
    return null;
  } catch (err) {
    console.warn('Fallback printDoc error:', err);
    printDoc(finalHtml);
    toastOk('تم فتح حوار الطباعة / الحفظ كملف PDF');
    return null;
  }
}

export async function shareInvoicePdfFile({ invoice, issuer, client, text, printSettings = null, docHtml = null }) {
  const finalHtml = docHtml || invoiceA4({ invoice, issuer, client, printSettings });
  try {
    invoice.lines = Array.isArray(invoice.lines) ? invoice.lines : (Array.isArray(invoice.items) ? invoice.items : []);
    invoice.items = invoice.lines;
    toastOk('جارٍ تجهيز ملف PDF للمشاركة...');
    let blob = null;
    try {
      blob = await fetchInvoicePdfBlob(invoice.id, finalHtml);
    } catch { }

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

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 6000);
      toastOk('تم تحميل ملف الفاتورة PDF بنجاح');
      return true;
    }

    printDoc(finalHtml);
    toastOk('تم فتح حوار الطباعة / الحفظ كملف PDF للمشاركة');
    return true;
  } catch (err) {
    if (err.name === 'AbortError') return false;
    console.warn('Share file fallback:', err);
    printDoc(finalHtml);
    return false;
  }
}

export function openDownloadModal({ invoice, issuer, client, printSettings = null, docHtml = null }) {
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
    await downloadInvoicePdf({ invoice, issuer, client, printSettings, docHtml });
  });

  $('#dl-print-opt', m.el).addEventListener('click', () => {
    m.close();
    printDoc(docHtml || invoiceA4({ invoice, issuer, client, printSettings }));
  });

  $('#dl-html-opt', m.el).addEventListener('click', () => {
    m.close();
    const doc = docHtml || invoiceA4({ invoice, issuer, client, printSettings });
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

export function openShareModal({ invoice, issuer, client, printSettings = null, docHtml = null }) {
  const m = modal({
    title: `مشاركة الفاتورة: ${invoice.invoice_number}`,
    slim: true,
    body: html`
      <div style="display:flex;flex-direction:column;gap:1rem">
        <div class="alert alert-info" style="font-size:.85rem;line-height:1.6">
          يمكنك إرسال الفاتورة للعميل عبر <b>واتساب</b> أو مشاركة <b>ملف PDF المعتمد</b> مباشرة عبر التطبيقات المثبتة بجهازك:
        </div>

        <div class="field">
          <label style="font-weight:600;font-size:.85rem">رقم هاتف العميل (واتساب):</label>
          <input type="text" id="share-phone-input" class="ltr" value="${client.phone || ''}" placeholder="05xxxxxxxx أو 9665xxxxxxxx" style="font-size:1rem;letter-spacing:1px;font-weight:bold" />
          <span class="tiny muted" style="margin-top:2px">يتم التنسيق تلقائياً للمفتاح الدولي السعودي (+966)</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:.6rem;margin-top:.2rem">
          <button class="btn btn-primary" id="btn-send-whatsapp" type="button" style="display:flex;align-items:center;gap:8px;font-weight:bold;background:#25D366;border-color:#25D366;color:#fff;padding:.75rem 1.4rem;border-radius:8px;font-size:.95rem">
            ${raw(icon.whatsapp({ size: 18 }))}
            إرسال الفاتورة عبر واتساب (WhatsApp Web / App)
          </button>
          <button class="btn" id="btn-share-pdf-direct" type="button" style="display:flex;align-items:center;gap:8px;font-weight:bold;padding:.75rem 1.4rem;border-radius:8px;font-size:.95rem;background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.2)">
            ${raw(icon.share({ size: 18 }))}
            مشاركة ملف PDF عبر تطبيقات النظام
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

  // إرسال الفاتورة عبر واتساب مباشرة للعميل
  $('#btn-send-whatsapp', m.el)?.addEventListener('click', () => {
    const rawPhone = $('#share-phone-input', m.el)?.value?.trim() || '';
    const cleanPhone = formatSaudiPhone(rawPhone);
    if (!cleanPhone) {
      toastErr('يرجى إدخال رقم جوال صالح للعميل (مثال: 0501234567)');
      return;
    }
    const grandTotalStr = typeof invoice.grand_total === 'number' ? invoice.grand_total.toFixed(2) : (invoice.grand_total || '0.00');
    const msg = [
      `مرحباً ${client.name || 'عميلنا العزيز'}،`,
      `مرفق لكم تفاصيل الفاتورة الضريبية رقم: *${invoice.invoice_number}*`,
      issuer.name_ar ? `الصادرة من: *${issuer.name_ar}*` : '',
      `تاريخ الإصدار: ${invoice.issue_date || ''}`,
      `المبلغ الإجمالي: *${grandTotalStr} ريال*`,
      invoice.payment_label ? `طريقة الدفع: ${invoice.payment_label}` : '',
      `\nشكراً لتعاملكم معنا.`
    ].filter(Boolean).join('\n');

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    toastOk('تم فتح محادثة واتساب لإرسال الفاتورة 💬');
  });

  // مشاركة ملف PDF مباشرة عبر النظام (يدعم ويندوز وتطبيقات الهاتف)
  $('#btn-share-pdf-direct', m.el).addEventListener('click', async () => {
    await shareInvoicePdfFile({ invoice, issuer, client, printSettings, docHtml });
  });

  // تنزيل ملف PDF للجهاز
  $('#btn-dl-pdf-direct', m.el)?.addEventListener('click', async () => {
    await downloadInvoicePdf({ invoice, issuer, client, printSettings, docHtml });
  });
}

export async function render(view, ctx) {
  const invoiceId = ctx.params[0];
  if (!invoiceId) {
    router.go('invoices');
    return undefined;
  }

  let activeViewMode = 'template'; // 'template' | 'items'
  let zoomLevel = 82;
  let selectedTplStyle = null;
  let availableTemplates = [];

  const draw = async () => {
    const { invoice, issuer, client } = await loadContext(invoiceId);
    const issuerPrintCfg = (typeof issuer.print_settings === 'string'
      ? JSON.parse(issuer.print_settings || '{}')
      : (issuer.print_settings || {})) || {};

    try {
      const res = await api.get('/api/invoices/templates?type=invoices');
      availableTemplates = Array.isArray(res) ? res : (res?.data || []);
    } catch {
      availableTemplates = [];
    }

    if (!selectedTplStyle) {
      selectedTplStyle = issuerPrintCfg.template_style || (availableTemplates[0]?.id || 'standard');
    }

    const getPrintSettings = () => {
      const tpl = availableTemplates.find((t) => t.id === selectedTplStyle);
      return {
        ...issuerPrintCfg,
        template_style: selectedTplStyle,
        headers: tpl?.headers || issuerPrintCfg.headers || [],
        alignments: tpl?.style_meta?.alignments || issuerPrintCfg.alignments || [],
        header_fill: tpl?.style_meta?.header_fill || tpl?.color_hex || issuerPrintCfg.header_fill,
        banner_text: tpl?.style_meta?.banner_text || issuerPrintCfg.banner_text || '',
        banner_fill: tpl?.style_meta?.banner_fill || issuerPrintCfg.banner_fill || '',
        footer_text: tpl?.style_meta?.footer_text || issuerPrintCfg.footer_text || '',
        has_signatures: tpl?.style_meta?.has_signatures || issuerPrintCfg.has_signatures || false,
        primary_color: tpl?.color_hex || issuerPrintCfg.primary_color || '#0d9488',
        light_color: tpl?.style_meta?.light_color || issuerPrintCfg.light_color || '',
        template_title: tpl?.name_ar || issuerPrintCfg.template_title || '',
      };
    };

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
          ${raw(invoice.status !== 'CANCELLED' && can('invoices.edit') ? `<a class="btn" href="#/invoice?edit=${esc(invoice.id)}" title="تعديل الفاتورة يدوياً">${icon.edit({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}تعديل الفاتورة</a>` : '')}
          <button class="btn btn-danger" id="btn-delete-invoice" type="button" title="حذف الفاتورة نهائياً">${icon.trash({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}حذف الفاتورة</button>
          <a class="btn" href="#/invoices">${raw(icon.arrowRight({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}القائمة</a>
        </div>
      </div>

      ${raw(invoice.status === 'CANCELLED' ? '<div class="alert alert-danger">هذه الفاتورة ملغاة — تم عكس قيدها في كشف حساب العميل، ورقمها وبصمتها محفوظان في السلسلة.</div>' : '')}

      <div class="grid" style="grid-template-columns:minmax(0,2.4fr) minmax(280px,1fr);align-items:start;gap:1.2rem">
        <div>
          <!-- شريط أدوات الفاتورة والقالب -->
          <div class="card" style="padding:.65rem .85rem;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem;border-color:var(--line-strong)">
            <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
              <div class="tab-pill-group" style="display:flex;gap:3px;background:var(--bg);padding:3px;border-radius:8px;border:1px solid var(--line)">
                <button type="button" class="btn btn-sm ${activeViewMode === 'template' ? 'btn-primary' : 'btn-ghost'}" id="tab-btn-template" style="padding:.35rem .75rem;border-radius:6px;font-size:.82rem">
                  ${raw(icon.fileText({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}
                  معاينة الفاتورة بالقالب 📄
                </button>
                <button type="button" class="btn btn-sm ${activeViewMode === 'items' ? 'btn-primary' : 'btn-ghost'}" id="tab-btn-items" style="padding:.35rem .75rem;border-radius:6px;font-size:.82rem">
                  ${raw(icon.fileSpreadsheet({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}
                  جدول البنود والبيانات 📋 (${(invoice.lines || []).length})
                </button>
              </div>

              <div id="tpl-select-wrap" style="display:${activeViewMode === 'template' ? 'flex' : 'none'};align-items:center;gap:6px">
                <span style="font-size:.8rem;color:var(--muted);font-weight:600">القالب:</span>
                <select id="sel-invoice-tpl" class="input input-sm" style="padding:.28rem .6rem;font-size:.82rem;border-radius:6px;background:var(--card);color:var(--text);border:1px solid var(--line-strong)">
                  ${raw(availableTemplates.length
        ? availableTemplates.map((t) => `<option value="${esc(t.id)}" ${t.id === selectedTplStyle ? 'selected' : ''}>${esc(t.name_ar || t.id)}${t.headers?.length ? ` (${t.headers.length} أعمدة)` : ''}</option>`).join('')
        : INVOICE_TEMPLATES.map((t) => `<option value="${t.id}" ${t.id === selectedTplStyle ? 'selected' : ''}>${esc(t.name)}</option>`).join(''))}
                </select>
              </div>
            </div>

            <div id="tpl-zoom-wrap" style="display:${activeViewMode === 'template' ? 'flex' : 'none'};align-items:center;gap:.5rem">
              <div class="tpl-zoom-controls">
                <button type="button" class="tpl-zoom-btn" id="inv-zoom-out" title="تصغير">−</button>
                <span class="tpl-zoom-val" id="inv-zoom-text">${zoomLevel}%</span>
                <button type="button" class="tpl-zoom-btn" id="inv-zoom-in" title="تكبير">+</button>
                <button type="button" class="tpl-zoom-btn" id="inv-zoom-fit" title="ملاءمة العرض" style="border-inline-start:1px solid var(--line-strong);font-size:.75rem">العرض</button>
              </div>
              <button class="btn btn-sm" id="btn-fullscreen-inv" title="معاينة ملء الشاشة" type="button" style="padding:.3rem .55rem">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              </button>
            </div>
          </div>

          <!-- شاشة عرض الفاتورة بالقالب الرسمي المعتمد -->
          <div id="pane-template-preview" style="display:${activeViewMode === 'template' ? 'block' : 'none'}">
            <div class="tpl-paper-wrapper" id="inv-paper-wrapper" style="border-radius:10px;border:1px solid var(--line-strong);min-height:850px;max-height:1050px">
              <div class="tpl-paper-frame" id="inv-paper-frame" style="transform: scale(${zoomLevel / 100})">
                <iframe id="inv-iframe" class="tpl-iframe" title="معاينة الفاتورة بالقالب"></iframe>
              </div>
            </div>
          </div>

          <!-- شاشة عرض جدول البنود والبيانات الفنية -->
          <div id="pane-items-details" style="display:${activeViewMode === 'items' ? 'block' : 'none'}">
            <div class="card pad0">
              <div class="card-head"><h3>بنود الفاتورة</h3><div class="spacer"></div>
                <span class="tiny muted">${(invoice.lines || []).length} بند</span></div>
              <div class="table-wrap">
                <table class="tbl compact">
                  <thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th class="text-end">الكمية</th>
                    <th class="text-end">السعر <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
                    <th class="text-end">الخصم <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
                    <th class="text-end">قبل الضريبة <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
                    <th class="text-center">الضريبة</th>
                    <th class="text-end">قيمة الضريبة <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
                    <th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th></tr></thead>
                  <tbody>
                    ${(invoice.lines || []).map((l, i) => raw(`<tr>
                      <td class="tiny">${i + 1}</td>
                      <td><b>${esc(l.item_name)}</b>${l.item_code ? `<div class="tiny muted mono">${esc(l.item_code)}</div>` : ''}</td>
                      <td class="tiny">${esc(l.unit)}</td>
                      <td class="text-end num">${num(l.quantity)}</td>
                      <td class="text-end num">${amount(l.unit_price)}</td>
                      <td class="text-end num">${l.discount > 0 ? amount(l.discount) : '—'}</td>
                      <td class="text-end num">${amount(l.taxable)}</td>
                      <td class="text-center tiny num">${num(l.tax_rate)}%</td>
                      <td class="text-end num">${amount(l.tax_amount)}</td>
                      <td class="text-end num"><b>${amount(l.total_line)}</b></td>
                    </tr>`))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          ${raw(invoice.allocations && invoice.allocations.length ? `
            <div class="card pad0 mt">
              <div class="card-head"><h3>سندات القبض المرتبطة</h3></div>
              <div class="table-wrap"><table class="tbl compact">
                <thead><tr><th>رقم السند</th><th>التاريخ</th><th>طريقة السداد</th><th class="text-end">المبلغ المخصص <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th></th></tr></thead>
                <tbody>${invoice.allocations.map((a) => `<tr>
                  <td class="mono">${esc(a.voucher_number)}</td>
                  <td class="tiny">${esc(dateAr(a.voucher_date))}</td>
                  <td class="tiny">${esc(a.payment_type)}</td>
                  <td class="text-end num">${amount(a.allocated_amount)}</td>
                  <td class="actions"><a class="btn btn-sm" href="#/vouchers?q=${esc(a.voucher_number)}">${icon.eye({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}عرض</a></td>
                </tr>`).join('')}</tbody>
              </table></div>
            </div>` : '')}

          <div class="card mt">
            <h3>بيانات الفاتورة الإلكترونية</h3>
            <dl class="kv">
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
              <div class="line"><span>الإجمالي قبل الخصم</span><span class="num">${amount(invoice.subtotal)}</span></div>
              <div class="line"><span>الخصم</span><span class="num">${amount(invoice.discount_amount)}</span></div>
              <div class="line"><span>الخاضع للضريبة</span><span class="num">${amount(invoice.taxable_amount)}</span></div>
              <div class="line"><span>ضريبة القيمة المضافة</span><span class="num">${amount(invoice.tax_amount)}</span></div>
              <div class="line grand"><span>الإجمالي</span><span class="num">${amount(invoice.grand_total, 'SAR', { size: 16 })}</span></div>
              <div class="line"><span>المسدد</span><span class="num">${amount(invoice.paid_amount)}</span></div>
              <div class="line" style="font-weight:700;color:var(--danger)"><span>المتبقي</span><span class="num">${amount(invoice.remaining_amount)}</span></div>
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
              <dt>العنوان الوطني</dt><dd class="tiny">${esc(invoice.seller_address || [issuer.building_no, issuer.street, issuer.district, issuer.city].filter(Boolean).join(' - '))}${issuer.address_en || issuer.street_en ? `<div class="ltr muted tiny" style="margin-top:2px">${esc(issuer.address_en || [issuer.building_no, issuer.street_en, issuer.district_en, issuer.city_en].filter(Boolean).join(' - '))}</div>` : ''}</dd>
              <dt>المشتري</dt><dd><a href="#/statement/${client.id}">${client.name}</a></dd>
              <dt>الرقم الضريبي</dt><dd class="mono">${client.tax_number || '—'}</dd>
              <dt>العنوان الوطني</dt><dd class="tiny">${client.building_no || client.street || client.district || client.postal_code ? [client.building_no ? `مبنى ${esc(client.building_no)}` : '', client.street ? `شارع ${esc(client.street)}` : '', client.district ? `حي ${esc(client.district)}` : '', client.city ? esc(client.city) : '', client.postal_code ? `(${esc(client.postal_code)})` : ''].filter(Boolean).join(' - ') : esc(invoice.buyer_address || client.address || client.city || '—')}</dd>
              <dt>طريقة الدفع</dt><dd>${invoice.payment_label}</dd>
              <dt>أنشئت بواسطة</dt><dd>${invoice.created_by}</dd>
              <dt>وقت الإنشاء</dt><dd class="tiny">${dateTimeAr(invoice.created_at)}</dd>
              ${raw(invoice.batch_id ? `<dt>دفعة</dt><dd class="tiny mono">${esc(invoice.batch_id.slice(0, 8))}</dd>` : '')}
            </dl>
            ${raw(invoice.notes ? `<div class="alert alert-info mt tiny mb0"><b>ملاحظات:</b> ${esc(invoice.notes)}</div>` : '')}
          </div>
        </div>
      </div>`;

    let currentInvoiceDocHtml = '';
    const tplHtmlCache = new Map();

    function getLoadingPreviewHtml(title = 'جارٍ تحميل وتجهيز قالب الفاتورة...') {
      return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      min-height: 297mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
      background: #ffffff;
      color: #334155;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3.5px solid #e2e8f0;
      border-top-color: #0d9488;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .title {
      margin-top: 16px;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
    }
    .sub {
      margin-top: 6px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="title">${title}</div>
  <div class="sub">يتم تجهيز المستند وفق قالب Excel المعتمد الحقيقي...</div>
</body>
</html>`;
    }

    async function updateInvoicePreview() {
      const iframe = $('#inv-iframe', view);
      if (!iframe) return;
      const printSettings = getPrintSettings();
      const tplId = selectedTplStyle || printSettings?.template_style;
      const isExcelTpl = tplId && tplId !== 'standard' && tplId !== 'modern' && tplId !== 'classic' && tplId !== 'compact';

      if (isExcelTpl) {
        const cacheKey = `${invoice.id}_${tplId}`;
        if (tplHtmlCache.has(cacheKey)) {
          currentInvoiceDocHtml = tplHtmlCache.get(cacheKey);
          iframe.srcdoc = currentInvoiceDocHtml;
          return;
        }

        // إظهار مؤشر تحميل نظيف بدلاً من وميض قالب قديم غير مرغوب
        iframe.srcdoc = getLoadingPreviewHtml('جارٍ تجهيز قالب الفاتورة الحقيقي...');

        try {
          const res = await fetch(`/api/invoices/${encodeURIComponent(invoice.id)}/render-html?style=${encodeURIComponent(tplId)}`);
          if (res.ok) {
            const filledHtml = await res.text();
            if (filledHtml && filledHtml.length > 500 && iframe) {
              tplHtmlCache.set(cacheKey, filledHtml);
              currentInvoiceDocHtml = filledHtml;
              iframe.srcdoc = filledHtml;
              return;
            }
          }
        } catch { }
      }

      currentInvoiceDocHtml = invoiceA4({
        invoice,
        issuer,
        client,
        printSettings,
        autoPrint: false,
      });
      iframe.srcdoc = currentInvoiceDocHtml;
    }

    function fitZoom() {
      const wrapper = $('#inv-paper-wrapper', view);
      if (wrapper && wrapper.clientWidth > 100) {
        const availableW = wrapper.clientWidth - 28;
        const targetW = 794;
        const calculatedScale = Math.min(1.15, Math.max(0.45, Math.round((availableW / targetW) * 94) / 100));
        zoomLevel = Math.round(calculatedScale * 100);
        const zText = $('#inv-zoom-text', view);
        if (zText) zText.textContent = `${zoomLevel}%`;
        const frame = $('#inv-paper-frame', view);
        if (frame) frame.style.transform = `scale(${zoomLevel / 100})`;
      }
    }

    // تبديل نمط القالب المعروض
    $('#sel-invoice-tpl', view)?.addEventListener('change', (e) => {
      selectedTplStyle = e.target.value;
      updateInvoicePreview();
    });

    // أدوات التكبير والتصغير والملاءمة
    $('#inv-zoom-in', view)?.addEventListener('click', () => {
      zoomLevel = Math.min(150, zoomLevel + 10);
      const zText = $('#inv-zoom-text', view);
      if (zText) zText.textContent = `${zoomLevel}%`;
      const frame = $('#inv-paper-frame', view);
      if (frame) frame.style.transform = `scale(${zoomLevel / 100})`;
    });

    $('#inv-zoom-out', view)?.addEventListener('click', () => {
      zoomLevel = Math.max(40, zoomLevel - 10);
      const zText = $('#inv-zoom-text', view);
      if (zText) zText.textContent = `${zoomLevel}%`;
      const frame = $('#inv-paper-frame', view);
      if (frame) frame.style.transform = `scale(${zoomLevel / 100})`;
    });

    $('#inv-zoom-fit', view)?.addEventListener('click', () => fitZoom());

    // فتح المعاينة في شاشة كاملة
    $('#btn-fullscreen-inv', view)?.addEventListener('click', () => {
      const docHtml = currentInvoiceDocHtml || invoiceA4({
        invoice,
        issuer,
        client,
        printSettings: getPrintSettings(),
        autoPrint: false,
      });
      const m = modal({
        title: `معاينة الفاتورة: ${invoice.invoice_number}`,
        wide: true,
        body: html`<iframe style="width:100%;height:82vh;border:none;background:#fff;border-radius:4px" srcdoc="${esc(docHtml)}"></iframe>`,
        footer: `<button class="btn btn-primary" id="fs-print-inv" type="button">${raw(icon.printer({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}طباعة الفاتورة</button>
                 <button class="btn" data-close type="button">إلغاء</button>`,
      });
      $('#fs-print-inv', m.el).addEventListener('click', () => printDoc(docHtml));
    });

    // تبديل نمط العرض بين القالب والبيانات الفنية
    $('#tab-btn-template', view)?.addEventListener('click', () => {
      activeViewMode = 'template';
      const panePreview = $('#pane-template-preview', view);
      const paneItems = $('#pane-items-details', view);
      const selWrap = $('#tpl-select-wrap', view);
      const zoomWrap = $('#tpl-zoom-wrap', view);
      if (panePreview) panePreview.style.display = 'block';
      if (paneItems) paneItems.style.display = 'none';
      if (selWrap) selWrap.style.display = 'flex';
      if (zoomWrap) zoomWrap.style.display = 'flex';
      $('#tab-btn-template', view)?.classList.add('btn-primary');
      $('#tab-btn-template', view)?.classList.remove('btn-ghost');
      $('#tab-btn-items', view)?.classList.remove('btn-primary');
      $('#tab-btn-items', view)?.classList.add('btn-ghost');
      setTimeout(fitZoom, 50);
    });

    $('#tab-btn-items', view)?.addEventListener('click', () => {
      activeViewMode = 'items';
      const panePreview = $('#pane-template-preview', view);
      const paneItems = $('#pane-items-details', view);
      const selWrap = $('#tpl-select-wrap', view);
      const zoomWrap = $('#tpl-zoom-wrap', view);
      if (panePreview) panePreview.style.display = 'none';
      if (paneItems) paneItems.style.display = 'block';
      if (selWrap) selWrap.style.display = 'none';
      if (zoomWrap) zoomWrap.style.display = 'none';
      $('#tab-btn-template', view)?.classList.remove('btn-primary');
      $('#tab-btn-template', view)?.classList.add('btn-ghost');
      $('#tab-btn-items', view)?.classList.add('btn-primary');
      $('#tab-btn-items', view)?.classList.remove('btn-ghost');
    });

    $('#download-invoice', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await downloadInvoicePdf({ invoice, issuer, client, printSettings: getPrintSettings(), docHtml: currentInvoiceDocHtml });
      } finally {
        e.target.disabled = false;
      }
    });

    $('#share-invoice', view).addEventListener('click', () => {
      openShareModal({
        invoice,
        issuer,
        client,
        printSettings: getPrintSettings(),
        docHtml: currentInvoiceDocHtml,
      });
    });

    $('#print-more', view).addEventListener('click', () => {
      const pm = modal({
        title: 'خيارات الطباعة الورقية',
        slim: true,
        body: html`
          <div style="display:flex;flex-direction:column;gap:.5rem">
            <button class="btn btn-primary" id="pm-a4" type="button">${raw(icon.printer({ size: 16, style: 'vertical-align:text-bottom;margin-left:6px' }))}طباعة A4 قياسي</button>
            <button class="btn" id="pm-copies" type="button">${raw(icon.copy({ size: 16, style: 'vertical-align:text-bottom;margin-left:6px' }))}طباعة نسختين A4 (أصل + صورة)</button>
          </div>
        `,
        footer: '<button class="btn" data-close type="button">إلغاء</button>',
      });
      $('#pm-a4', pm.el).addEventListener('click', () => {
        pm.close();
        printDoc(currentInvoiceDocHtml || invoiceA4({ invoice, issuer, client, printSettings: getPrintSettings() }));
      });
      $('#pm-copies', pm.el).addEventListener('click', () => {
        pm.close();
        printDoc(currentInvoiceDocHtml || invoiceA4({ invoice, issuer, client, copies: 2, printSettings: getPrintSettings() }));
      });
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

    const deleteBtn = $('#btn-delete-invoice', view);
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `حذف الفاتورة ${invoice.invoice_number}`,
          message: `هل أنت متأكد من حذف الفاتورة ${invoice.invoice_number} نهائياً؟ سيتم حذف بنودها وقيدها المرتبط. لا يمكن التراجع عن هذه العملية.`,
          danger: true,
          okText: 'حذف نهائياً',
        });
        if (!ok) return;
        deleteBtn.disabled = true;
        try {
          await api.del(`/api/invoices/${invoice.id}`);
          toastOk(`تم حذف الفاتورة ${invoice.invoice_number} بنجاح`);
          router.go('invoices');
        } catch (err) {
          toastErr('فشل حذف الفاتورة: ' + (err.message || err));
          deleteBtn.disabled = false;
        }
      });
    }

    // إقلاع المعاينة الحية وملاءمة العرض
    updateInvoicePreview();
    setTimeout(fitZoom, 80);
    window.addEventListener('resize', fitZoom);
  };

  await draw();
  return undefined;
}
