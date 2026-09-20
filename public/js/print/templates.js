// ==========================================================================
//  قوالب الطباعة: فاتورة A4، فاتورة حرارية 80mm، سند قبض، كشف حساب.
//  كل قالب مستند HTML كامل بأنماطه الخاصة يُطبع داخل إطار مستقل.
// ==========================================================================
import { esc, money, num, dateAr, qrSvg } from '../core/util.js';
import { sarSvg } from '../core/icons.js';

const FONT = '"Segoe UI", Tahoma, "Cairo", "Noto Naskh Arabic", Arial, sans-serif';

function docShell({ title, pageCss, body, autoPrint = true }) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${esc(title)}</title>
<style>
  @page { ${pageCss} }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: ${FONT}; color: #0f172a; }
  body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: embed; display: inline-block; }
  .ltr { direction: ltr; unicode-bidi: embed; }
  table { border-collapse: collapse; width: 100%; }
  .muted { color: #64748b; }
  ${body.css || ''}
</style></head><body>${body.html}${autoPrint ? '' : ''}</body></html>`;
}

const addressLine = (o) => [o.building_no, o.street, o.district, o.city, o.postal_code, o.country]
  .filter(Boolean).join(' - ');

export function formatIban(iban) {
  if (!iban) return '';
  const clean = String(iban).replace(/\s+/g, '').toUpperCase();
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

export const INVOICE_TEMPLATES = [
  {
    id: 'standard',
    name: 'الرسمي المعتمد (Standard A4)',
    desc: 'القالب الضريبي القياسي المتوافق مع هيئة الزكاة والضريبة والجمارك، رأسية متوازنة وتنسيق رسمي شامل.',
    badge: 'الافتراضي العام',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></svg>',
    paper: 'A4',
  },
  {
    id: 'detailed_address',
    name: 'العنوان الوطني المفصل (National Address)',
    desc: 'شبكة العنوان الوطني المفصل (المبنى، الشارع، الحي، الرمز، الإضافي)، وتوريدات البنية التحتية.',
    badge: 'عنوان وطني مفصل',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    paper: 'A4',
  },
];

// ------------------------------------------------------------- فحص سطوع اللون
export function isLightColor(hex) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return false;
  const clean = hex.replace('#', '');
  if (clean.length < 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return l > 0.62;
}

// ------------------------------------------------------------- محول الأعمدة الديناميكي الذكي من ملف الإكسل
export function getColumnRenderer(header, colIndex, allHeaders, { curSym, curBadge, showItemCode, alignment } = {}) {
  const rawH = String(header || '').trim();
  const h = rawH.toLowerCase().replace(/\s+/g, ' ');

  // 1. الترقيم والتسلسل
  if (/^(#|م|ت|رقم|تسلسل|no\.?|sr|sn)$/i.test(h) || h === '#') {
    return {
      thClass: 'c',
      thStyle: 'width:32px',
      renderTd: (l, i) => `<td class="c">${i + 1}</td>`,
    };
  }

  // 2. كود / رمز الصنف
  if (/^(كود|رمز|رقم الصنف|item code|code|item no)$/i.test(h) || (/كود|رمز|code/i.test(h) && !/اسم|وصف|description|name/i.test(h))) {
    return {
      thClass: 'c',
      thStyle: 'width:75px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.item_code || '—')}</td>`,
    };
  }

  // 3. الوحدة
  if (/^(الوحدة|وحدة|unit|uom)(\s+(unit|uom))?$/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:52px',
      renderTd: (l) => `<td class="c">${esc(l.unit || 'حبة')}</td>`,
    };
  }

  // 4. الكميات المتنوعة
  if (/مطلوب|ordered/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:60px',
      renderTd: (l) => `<td class="e num">${num(l.ordered_qty || l.quantity)}</td>`,
    };
  }
  if (/مسلم|مستلم|received|delivered/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:60px',
      renderTd: (l) => `<td class="e num">${num(l.delivered_qty || l.received_qty || l.quantity)}</td>`,
    };
  }
  if (/متبقي|remaining/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:60px',
      renderTd: (l) => `<td class="e num">${num(l.remaining_qty || 0)}</td>`,
    };
  }
  if (/مقبول|accepted/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:60px',
      renderTd: (l) => `<td class="e num">${num(l.accepted_qty || l.quantity)}</td>`,
    };
  }
  if (/مرفوض|rejected/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:55px',
      renderTd: (l) => `<td class="e num">${num(l.rejected_qty || 0)}</td>`,
    };
  }
  if (/كمية|الكمية|العدد|qty|quantity/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:58px',
      renderTd: (l) => `<td class="e num">${num(l.quantity)}</td>`,
    };
  }

  // 5. سعر الوحدة
  if (/سعر الوحدة|سعر المفرد|سعر|unit price|rate|price/i.test(h) && !/قبل|شامل|إجمالي|total|tax rate|vat rate/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:82px',
      renderTd: (l) => `<td class="e"><span class="num">${money(l.unit_price)}</span> <small class="cur-sym">${curSym}</small></td>`,
    };
  }

  // 6. الخصم
  if (/خصم|تخفيض|discount/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:62px',
      renderTd: (l) => `<td class="e">${l.discount ? `<span class="num">${money(l.discount)}</span> <small class="cur-sym">${curSym}</small>` : '—'}</td>`,
    };
  }

  // 7. نسبة الضريبة
  if (/النسبة|نسبة|معدل|vat %|tax rate|rate %/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:50px',
      renderTd: (l) => `<td class="c num">${num(l.tax_rate)}%</td>`,
    };
  }

  // 7b. فئة الضريبة (ZATCA Tax Category)
  if (/فئة الضريبة|فئة|كود الضريبة|tax cat/i.test(h) && !/صنف|item/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:46px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.tax_category || (l.tax_rate > 0 ? 'S' : 'Z'))}</td>`,
    };
  }

  // 8. الإجمالي شامل الضريبة أو الإجمالي
  if (/شامل|مع الضريبة|total with vat|inclusive|total amount/i.test(h) || /اجمالي|إجمالي|المجموع|مجموع|total|line total/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:96px',
      renderTd: (l) => {
        const tot = l.total_line ?? l.line_total ?? l.total ?? ((l.quantity || 0) * (l.unit_price || 0) + (l.tax_amount || 0));
        return `<td class="e"><b class="num">${money(tot)}</b> <small class="cur-sym">${curSym}</small></td>`;
      },
    };
  }

  // 9. قيمة الضريبة
  if (/قيمة الضريبة|مبلغ الضريبة|ضريبة|vat amount|tax amount/i.test(h) && !/شامل|قبل|خاضع/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="e"><span class="num">${money(l.tax_amount)}</span> <small class="cur-sym">${curSym}</small></td>`,
    };
  }

  // 10. الإجمالي قبل الضريبة (الخاضع للضريبة / الصافي)
  if (/قبل الضريبة|خاضع|الخاضع|صافي|الصافي|subtotal|taxable|amount before|مبلغ قبل/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:86px',
      renderTd: (l) => `<td class="e"><span class="num">${money(l.taxable)}</span> <small class="cur-sym">${curSym}</small></td>`,
    };
  }

  // 11. العملة
  if (/عملة|currency/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:44px',
      renderTd: () => `<td class="c">${curBadge}</td>`,
    };
  }

  // 12. الحساب أو الفاتورة أو المستند
  if (/حساب|مستند|account|doc/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.account_no || l.invoice_number || l.doc_no || '—')}</td>`,
    };
  }

  // 13. التاريخ
  if (/تاريخ|date/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="c tiny">${esc(l.date || l.issue_date || '—')}</td>`,
    };
  }

  // 14. المرجع
  if (/مرجع|reference|ref/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.reference || l.ref || '—')}</td>`,
    };
  }

  // 15. مركز التكلفة
  if (/مركز|cost center/i.test(h)) {
    return {
      thClass: 's',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="s tiny">${esc(l.cost_center || 'المركز العام')}</td>`,
    };
  }

  // 16. المشروع
  if (/مشروع|project/i.test(h)) {
    return {
      thClass: 's',
      thStyle: 'width:90px',
      renderTd: (l) => `<td class="s tiny">${esc(l.project || 'المشروع الرئيسي')}</td>`,
    };
  }

  // 17. موقع التخزين / المستودع
  if (/موقع|مستودع|warehouse|location/i.test(h)) {
    return {
      thClass: 's',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="s tiny">${esc(l.warehouse || l.location || 'المستودع الرئيسي')}</td>`,
    };
  }

  // 18. رقم التشغيلة / الدفعة
  if (/تشغيل|دفعة|batch|lot/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.batch_no || '—')}</td>`,
    };
  }

  // 19. طريقة الدفع
  if (/طريقة|دفع|سداد|payment/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="c tiny">${esc(l.payment_method_label || l.payment_method || '—')}</td>`,
    };
  }

  // 20. مدين / دائن / رصيد
  if (/مدين|debit/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="e num">${l.debit ? money(l.debit) : money(l.taxable || 0)}</td>`,
    };
  }
  if (/دائن|credit/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="e num">${l.credit ? money(l.credit) : '0.00'}</td>`,
    };
  }
  if (/رصيد|balance/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="e num">${money(l.balance || l.total_line || 0)}</td>`,
    };
  }

  // 21. الحالة
  if (/حالة|status/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:70px',
      renderTd: (l) => `<td class="c tiny"><span class="badge green tiny">${esc(l.status || 'معتمد')}</span></td>`,
    };
  }

  // 22. الملاحظات
  if (/ملاحظ|notes|comment/i.test(h)) {
    return {
      thClass: 's',
      thStyle: 'width:90px',
      renderTd: (l) => `<td class="s tiny muted">${esc(l.notes || '—')}</td>`,
    };
  }

  // 23. الفئة
  if (/فئة|category/i.test(h) && !/ضريب/i.test(h)) {
    return {
      thClass: 's',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="s tiny">${esc(l.category || 'عام')}</td>`,
    };
  }

  // 24. السيريال أو الرقم التسلسلي أو IMEI
  if (/سيريال|تسلسل|serial|imei|sn/i.test(h) && !/^(#|م|ت|رقم|no\.?)$/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.serial_no || l.serial || '—')}</td>`,
    };
  }

  // 25. الباركود الدولي
  if (/باركود|بار كود|barcode|gtin|ean/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.barcode || '—')}</td>`,
    };
  }

  // 26. الماركة أو العلامة التجارية
  if (/ماركة|علامة|براند|brand|maker/i.test(h)) {
    return {
      thClass: 's',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="s tiny">${esc(l.brand || '—')}</td>`,
    };
  }

  // 27. المقاس والحجم والوزن
  if (/مقاس|حجم|size|dimension/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:70px',
      renderTd: (l) => `<td class="c tiny">${esc(l.size || '—')}</td>`,
    };
  }
  if (/وزن|weight/i.test(h)) {
    return {
      thClass: 'e',
      thStyle: 'width:65px',
      renderTd: (l) => `<td class="e num tiny">${esc(l.weight || '—')}</td>`,
    };
  }

  // 28. الضمان وبلد المنشأ
  if (/ضمان|warranty/i.test(h)) {
    return {
      thClass: 's',
      thStyle: 'width:80px',
      renderTd: (l) => `<td class="s tiny">${esc(l.warranty || 'سنتان')}</td>`,
    };
  }
  if (/منشأ|بلد|origin|country/i.test(h)) {
    return {
      thClass: 's',
      thStyle: 'width:75px',
      renderTd: (l) => `<td class="s tiny">${esc(l.origin || 'السعودية')}</td>`,
    };
  }

  // 29. أمر الشراء وبوليصة الشحن
  if (/أمر الشراء|أمر شراء|purchase order|po(\s+no)?/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.po_number || l.po || '—')}</td>`,
    };
  }
  if (/بوليصة|شحن|waybill|tracking/i.test(h)) {
    return {
      thClass: 'c',
      thStyle: 'width:85px',
      renderTd: (l) => `<td class="c mono tiny">${esc(l.tracking_no || l.waybill || '—')}</td>`,
    };
  }

  // 30. الاسم أو الصنف أو الوصف (إذا تطابق مع كلمات الصنف)
  if (/صنف|سلعة|خدمة|بيان|وصف|item|desc|particular/i.test(h) || !allHeaders || allHeaders.length <= 3) {
    const hasDedicatedCodeCol = Array.isArray(allHeaders) && allHeaders.some((item) => /كود|رمز|رقم الصنف|item code/i.test(item));
    return {
      thClass: 's',
      thStyle: '',
      renderTd: (l) => `<td>${esc(l.item_name)}${!hasDedicatedCodeCol && showItemCode && l.item_code ? `<div class="tiny muted ltr">${esc(l.item_code)}</div>` : ''}</td>`,
    };
  }

  // 31. محرك ذكي تلقائي لأي عمود مخصص أو كلمة جديدة يضيفها المستخدم في ملف Excel
  const alignClass = alignment === 'center' ? 'c' : (alignment === 'left' ? 'e' : 's');
  return {
    thClass: alignClass,
    thStyle: 'width:80px',
    renderTd: (l) => {
      let val = l[rawH] ?? l[h] ?? l.custom_fields?.[rawH] ?? l.custom_fields?.[h] ?? l.extra?.[rawH];
      if (val === undefined && Array.isArray(l) && colIndex < l.length) {
        val = l[colIndex];
      }
      if (val !== undefined && val !== null && val !== '') {
        const isNum = !isNaN(Number(String(val).replace(/,/g, ''))) && String(val).trim() !== '';
        return `<td class="${isNum ? 'e num' : alignClass} tiny">${esc(String(val))}</td>`;
      }
      return `<td class="c tiny muted">—</td>`;
    },
  };
}

// ------------------------------------------------------------- فاتورة A4
export function invoiceA4({ invoice, issuer, client, copies = 1, printSettings = null, qrSettings = null, autoPrint = true }) {
  const qrCfg = qrSettings || (typeof issuer.qr_settings === 'string' ? JSON.parse(issuer.qr_settings || '{}') : (issuer.qr_settings || {}));
  const printCfg = printSettings || (typeof issuer.print_settings === 'string' ? JSON.parse(issuer.print_settings || '{}') : (issuer.print_settings || {}));

  const brandColor = printCfg.primary_color || '#0d9488';
  const brandDark = printCfg.dark_color || (brandColor === '#0d9488' ? '#0f766e' : brandColor);
  const brandLight = printCfg.light_color || (isLightColor(brandColor) ? '#fffbeb' : '#f0fdfa');
  const tplStyle = printCfg.template_style || 'standard';
  const fontFamily = printCfg.font_family ? `"${printCfg.font_family}", ${FONT}` : FONT;
  const fontSize = printCfg.font_size === 'compact' ? '8pt' : printCfg.font_size === 'large' ? '9.2pt' : '8.4pt';

  const isCustomTemplate = Array.isArray(printCfg.headers) && printCfg.headers.length > 0;
  const showItemCode = printCfg.show_item_code !== false;
  const showUnit = printCfg.show_unit !== false;
  const showCurrencyColumn = printCfg.show_currency_column !== false;
  const showDiscount = printCfg.show_discount !== false;
  const showTaxable = printCfg.show_taxable !== false;
  const showTaxRate = printCfg.show_tax_rate !== false;
  const showTaxAmount = printCfg.show_tax_amount !== false;
  const showBank = isCustomTemplate ? false : (printCfg.show_bank !== false);
  const showTafqeet = printCfg.show_tafqeet !== false;
  const showSignatures = isCustomTemplate ? false : (printCfg.show_signatures !== false);
  const showNotes = isCustomTemplate ? false : (printCfg.show_notes !== false);
  const stripedRows = printCfg.striped_rows !== false;
  const logoPos = printCfg.logo_position || 'center';
  const logoSize = printCfg.logo_size || 'medium';
  const logoWidth = logoSize === 'small' ? '20mm' : logoSize === 'large' ? '38mm' : '26mm';
  const logoHeight = logoSize === 'small' ? '16mm' : logoSize === 'large' ? '28mm' : '20mm';

  const showQr = qrCfg.show_a4 !== false;
  const qrScale = qrCfg.scale || (qrCfg.size === 'large' ? 5 : qrCfg.size === 'small' ? 3 : 4);
  const qr = showQr ? qrSvg(invoice.qr_payload, { scale: qrScale, margin: 1 }) : '';
  const cur = invoice.currency === 'SAR' ? 'ر.س' : (invoice.currency || 'ر.س');
  const isSar = !invoice.currency || invoice.currency === 'SAR' || invoice.currency === 'ر.س' || invoice.currency === '﷼';
  const curSym = isSar ? sarSvg({ size: '0.95em' }) : esc(cur);
  const curBadge = isSar
    ? `<span class="cur-badge cur-badge-sar" title="ريال سعودي">${sarSvg({ size: '1.05em' })}</span>`
    : `<span class="cur-badge">${esc(cur)}</span>`;
  const isCancelled = invoice.status === 'CANCELLED';

  const sellerName = invoice.seller_name || issuer.name_ar;
  const sellerNameEn = invoice.seller_name_en || issuer.name_en || '';
  const sellerTax = invoice.seller_tax_number || issuer.tax_number;
  const sellerCr = invoice.seller_cr || issuer.commercial_register;
  const sellerAddr = invoice.seller_address || addressLine(issuer) || '—';
  const sellerAddrEn = invoice.seller_address_en || issuer.address_en || [
    issuer.building_no ? `Bldg ${issuer.building_no}` : '',
    issuer.street_en,
    issuer.district_en,
    issuer.city_en,
    issuer.postal_code,
    issuer.country === 'SA' ? 'Saudi Arabia' : (issuer.country || 'Saudi Arabia'),
  ].filter(Boolean).join(' - ');

  const buyerName = invoice.buyer_name || client.name;
  const buyerTax = invoice.buyer_tax_number || client.tax_number;
  const buyerNationalAddr = [
    client.city ? `المدينة: ${client.city}` : '',
    client.district ? `الحي: ${client.district}` : '',
    client.street ? `الشارع: ${client.street}` : '',
    client.building_no ? `رقم المبنى: ${client.building_no}` : '',
    client.postal_code ? `الرمز البريدي: ${client.postal_code}` : '',
    client.country && client.country !== 'SA' ? `الدولة: ${client.country}` : '',
  ].filter(Boolean).join(' - ');
  const buyerAddr = invoice.buyer_address || buyerNationalAddr || client.address || client.city || '—';

  invoice.lines = Array.isArray(invoice.lines) ? invoice.lines : (Array.isArray(invoice.items) ? invoice.items : []);
  const taxGroups = new Map();
  for (const l of invoice.lines) {
    const key = String(l.tax_rate);
    const g = taxGroups.get(key) || { rate: l.tax_rate, taxable: 0, tax: 0 };
    g.taxable += l.taxable;
    g.tax += l.tax_amount;
    taxGroups.set(key, g);
  }

  // تنسيق وبناء أعمدة الجدول ديناميكياً من ملف الإكسل مع تنظيف الدمج المكرر
  let customHeaders = null;
  let customAlignments = [];
  if (Array.isArray(printCfg.headers) && printCfg.headers.length > 0) {
    const deduped = [];
    const dedupedAligns = [];
    const rawAligns = Array.isArray(printCfg.alignments) ? printCfg.alignments : [];
    for (let i = 0; i < printCfg.headers.length; i++) {
      const h = String(printCfg.headers[i] || '').trim();
      if (h && (deduped.length === 0 || deduped[deduped.length - 1].toLowerCase() !== h.toLowerCase())) {
        deduped.push(h);
        dedupedAligns.push(rawAligns[i] || 'right');
      }
    }
    // Reverse if in LTR order (where total is first and item/description is last)
    const firstIsTotal = /إجمالي|اجمالي|total|مجموع/i.test(deduped[0] || '');
    const lastIsItem = /صنف|وصف|خدمة|بيان|item|desc|م|#/i.test(deduped[deduped.length - 1] || '');
    if (firstIsTotal && lastIsItem) {
      deduped.reverse();
      dedupedAligns.reverse();
    }
    // Only use customHeaders if it contains actual item-related column headers
    const hasItemConcept = deduped.some((h) => /صنف|وصف|خدمة|بيان|سلعة|كمية|سعر|مفرد|ضريبة|vat|tax|إجمالي|اجمالي|مجموع|total|item|desc|qty|price/i.test(h));
    if (hasItemConcept && deduped.length >= 2) {
      customHeaders = deduped;
      customAlignments = dedupedAligns;
    }
  }

  let theadHtml = '';
  let linesHtml = '';

  if (customHeaders) {
    const renderers = customHeaders.map((h, i) => getColumnRenderer(h, i, customHeaders, {
      curSym,
      curBadge,
      showItemCode,
      alignment: customAlignments[i],
    }));
    theadHtml = `<tr>` + customHeaders.map((h, i) => {
      const r = renderers[i];
      return `<th class="${r.thClass}" style="${r.thStyle}">${esc(h)}</th>`;
    }).join('') + `</tr>`;
    linesHtml = invoice.lines.map((l, idx) => `<tr>` + renderers.map((r) => r.renderTd(l, idx)).join('') + `</tr>`).join('');
  } else {
    theadHtml = `<tr>
        <th class="c" style="width:26px">#</th>
        <th>الصنف / الوصف</th>
        ${showUnit ? '<th class="c" style="width:48px">الوحدة</th>' : ''}
        <th class="e" style="width:52px">الكمية</th>
        ${showCurrencyColumn ? '<th class="c" style="width:38px">العملة</th>' : ''}
        <th class="e" style="width:72px">السعر</th>
        ${showDiscount ? '<th class="e" style="width:58px">الخصم</th>' : ''}
        ${showTaxable ? '<th class="e" style="width:80px">قبل الضريبة</th>' : ''}
        ${showTaxRate ? '<th class="c" style="width:42px">الضريبة</th>' : ''}
        ${showTaxAmount ? '<th class="e" style="width:72px">قيمة الضريبة</th>' : ''}
        <th class="e" style="width:86px">الإجمالي</th>
      </tr>`;
    linesHtml = invoice.lines.map((l, idx) => `<tr>
        <td class="c">${idx + 1}</td>
        <td>${esc(l.item_name)}${showItemCode && l.item_code ? `<div class="tiny muted ltr">${esc(l.item_code)}</div>` : ''}</td>
        ${showUnit ? `<td class="c">${esc(l.unit || '')}</td>` : ''}
        <td class="e"><span class="num">${num(l.quantity)}</span></td>
        ${showCurrencyColumn ? `<td class="c">${curBadge}</td>` : ''}
        <td class="e"><span class="num">${money(l.unit_price)}</span> <small class="cur-sym">${curSym}</small></td>
        ${showDiscount ? `<td class="e">${l.discount ? `<span class="num">${money(l.discount)}</span> <small class="cur-sym">${curSym}</small>` : '—'}</td>` : ''}
        ${showTaxable ? `<td class="e"><span class="num">${money(l.taxable)}</span> <small class="cur-sym">${curSym}</small></td>` : ''}
        ${showTaxRate ? `<td class="c"><span class="num">${num(l.tax_rate)}%</span></td>` : ''}
        ${showTaxAmount ? `<td class="e"><span class="num">${money(l.tax_amount)}</span> <small class="cur-sym">${curSym}</small></td>` : ''}
        <td class="e"><b class="num">${money(l.total_line)}</b> <small class="cur-sym">${curSym}</small></td>
      </tr>`).join('');
  }

  // حساب الألوان والبينر ديناميكياً من بيانات القالب
  const headerFill = printCfg.header_fill || brandColor;
  const isLightHdr = isLightColor(headerFill);
  const thTextColor = isLightHdr ? '#1e293b' : '#ffffff';
  const thBorderColor = isLightHdr ? (brandColor || '#d97706') : (brandDark || '#0f766e');

  const rawBannerText = printCfg.banner_text || 'فاتورة مبيعات ضريبية';
  const bannerText = rawBannerText
    .replace(/\|\s*(رقم|التاريخ|Date|Invoice\s*No)[^|]*/gi, '')
    .replace(/\s*\|\s*$/, '')
    .trim();
  const bannerFill = printCfg.banner_fill || (isLightColor(brandColor) ? brandColor : (isLightHdr ? headerFill : '#dbeafe'));
  const isLightBnr = isLightColor(bannerFill);
  const bannerTextColor = isLightBnr ? (brandDark || '#0f172a') : '#ffffff';
  const bannerBorder = isLightBnr ? (brandColor || '#93c5fd') : bannerFill;

  const logoFallback = `<div class="logo-fallback" style="width:${logoWidth};height:${logoHeight};" title="شعار المنشأة">
    <svg viewBox="0 0 110 88" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;max-height:100%;max-width:100%;overflow:visible;">
      <defs>
        <linearGradient id="lfb-grad-${esc(tplStyle || 'def')}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${brandColor}" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="${brandDark}" stop-opacity="0.22"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="106" height="84" rx="8" fill="url(#lfb-grad-${esc(tplStyle || 'def')})" stroke="${brandColor}" stroke-width="1.6" stroke-dasharray="3.5 2.5"/>
      <g transform="translate(55, 32)" stroke="${brandDark}" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="-18" y="-13" width="36" height="26" rx="4.5" />
        <circle cx="-6" cy="-3" r="3.2" fill="${brandDark}" />
        <path d="M-15 9 L-5 -2 L4 6 L10 0 L15 9" />
      </g>
      <text x="55" y="65" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="8.8" font-weight="700" fill="${brandDark}">شعار المنشأة</text>
      <text x="55" y="76" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="6.5" font-weight="600" fill="#64748b" letter-spacing="0.5">LOGO AREA</text>
    </svg>
  </div>`;

  const logoHtml = logoPos === 'none' ? '' : (issuer.logo_data
    ? `<img class="logo" src="${esc(issuer.logo_data)}" alt="" style="max-width:${logoWidth};max-height:${logoHeight};display:block;margin:0 auto;" />`
    : logoFallback);

  const one = `
  <div class="page"${tplStyle && tplStyle !== 'standard' ? ` data-tpl="${esc(tplStyle)}"` : ''}>
    ${isCancelled ? '<div class="watermark">ملغاة</div>' : ''}
    <header class="head" style="background:${isLightColor(brandLight) ? brandLight : '#f8fafc'}; border:1.5px solid ${brandColor}44; border-radius:6px; padding:10px 16px; margin-bottom:12px; display:grid; grid-template-columns:minmax(0,1.1fr) auto minmax(0,1.1fr); gap:8px 14px; align-items:center; position:relative;">
      <!-- Left Column: English Info -->
      <div class="brand-side-info-en" style="text-align:left; direction:ltr;">
        ${sellerNameEn ? `<div style="font-size:12.5pt; font-weight:800; color:${brandDark}; font-family:'Segoe UI', Arial, sans-serif; line-height:1.25; margin-bottom:4px;">${esc(sellerNameEn)}</div>` : ''}
        <table style="font-size:8.5pt; border-collapse:collapse; text-align:left; line-height:1.4;">
          ${sellerTax ? `<tr><td style="padding:1.5px 0; font-weight:700; color:#0f172a; width:65px;">Vat No.</td><td style="padding:1.5px 0; color:#0f172a; font-weight:600;"><span class="ltr">${esc(sellerTax)}</span></td></tr>` : ''}
          ${sellerCr ? `<tr><td style="padding:1.5px 0; font-weight:700; color:#0f172a; width:65px;">CR.</td><td style="padding:1.5px 0; color:#0f172a; font-weight:600;"><span class="ltr">${esc(sellerCr)}</span></td></tr>` : ''}
          ${issuer.phone ? `<tr><td style="padding:1.5px 0; font-weight:700; color:#0f172a; width:65px;">Phone.</td><td style="padding:1.5px 0; color:#0f172a; font-weight:600;"><span class="ltr">${esc(issuer.phone)}</span></td></tr>` : ''}
        </table>
      </div>

      <!-- Center Column: Logo & Document Title Badge -->
      <div class="brand-side-center" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; min-width:140px;">
        <div style="display:flex; align-items:center; justify-content:center; max-height:80px;">
          ${logoHtml}
        </div>
        <div style="background:${bannerFill}; border:1.5px solid ${bannerBorder}; border-radius:4px; padding:4px 22px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.05); white-space:nowrap;">
          <span style="color:${bannerTextColor}; font-weight:900; font-size:10.5pt; text-decoration:underline;">${esc(bannerText)}</span>
        </div>
      </div>

      <!-- Right Column: Arabic Info -->
      <div class="brand-side-info" style="text-align:right; direction:rtl;">
        <div style="font-size:13.5pt; font-weight:800; color:${brandDark}; line-height:1.25; margin-bottom:3px;">${esc(sellerName)}</div>
        ${sellerAddr ? `<div style="font-size:8pt; color:#334155; margin-bottom:4px; line-height:1.3;">${esc(sellerAddr)}</div>` : ''}
        <table style="font-size:8.5pt; border-collapse:collapse; margin-inline-start:auto; line-height:1.4; direction:rtl;">
          ${sellerTax ? `<tr><td style="padding:1.5px 0; font-weight:700; color:#0f172a; width:85px; text-align:right;">الرقم الضريبي:</td><td style="padding:1.5px 4px; text-align:left; color:#0f172a; font-weight:600;"><span class="ltr mono">${esc(sellerTax)}</span></td></tr>` : ''}
          ${sellerCr ? `<tr><td style="padding:1.5px 0; font-weight:700; color:#0f172a; width:85px; text-align:right;">السجل التجاري:</td><td style="padding:1.5px 4px; text-align:left; color:#0f172a; font-weight:600;"><span class="ltr mono">${esc(sellerCr)}</span></td></tr>` : ''}
          ${issuer.phone ? `<tr><td style="padding:1.5px 0; font-weight:700; color:#0f172a; width:85px; text-align:right;">رقم الجوال:</td><td style="padding:1.5px 4px; text-align:left; color:#0f172a; font-weight:600;"><span class="ltr mono">${esc(issuer.phone)}</span></td></tr>` : ''}
        </table>
      </div>
    </header>

    <section class="parties">
      <div class="party">
        <div class="party-h">بيانات العميل / المشتري (Client Details)</div>
        <table class="kv">
          <tr><td>الاسم</td><td><b>${esc(buyerName)}</b></td></tr>
          <tr><td>الرقم الضريبي</td><td class="ltr">${esc(buyerTax || '—')}</td></tr>
          ${client.building_no || client.street || client.district || client.postal_code || client.city ? `
          <tr><td>العنوان الوطني</td><td>
            <div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;">
              ${client.building_no ? `<span class="badge-mini">رقم المبنى: ${esc(client.building_no)}</span>` : ''}
              ${client.street ? `<span class="badge-mini">الشارع: ${esc(client.street)}</span>` : ''}
              ${client.district ? `<span class="badge-mini">الحي: ${esc(client.district)}</span>` : ''}
              ${client.city ? `<span class="badge-mini">المدينة: ${esc(client.city)}</span>` : ''}
              ${client.postal_code ? `<span class="badge-mini ltr">الرمز: ${esc(client.postal_code)}</span>` : ''}
            </div>
          </td></tr>` : `<tr><td>العنوان</td><td>${esc(buyerAddr)}</td></tr>`}
          <tr><td>الجوال / الهاتف</td><td class="ltr">${esc(client.mobile || client.phone || '—')}</td></tr>
        </table>
      </div>
      <div class="party">
        <div class="party-h">بيانات الفاتورة والمستند (Invoice Details)</div>
        <table class="kv">
          <tr><td>رقم الفاتورة</td><td class="ltr"><b>${esc(invoice.invoice_number)}</b></td></tr>
          <tr><td>تاريخ الإصدار</td><td>${esc(dateAr(invoice.issue_date))}</td></tr>
          <tr><td>وقت الإصدار</td><td class="ltr">${esc(invoice.issue_time)}</td></tr>
          <tr><td>طريقة الدفع</td><td>${esc(invoice.payment_label || invoice.payment_method || 'نقداً')}</td></tr>
          <tr><td>نوع الفاتورة</td><td>${invoice.invoice_type === 'SIMPLIFIED' ? 'فاتورة ضريبية مبسطة' : 'فاتورة ضريبية معتمدة'}</td></tr>
          <tr><td>الحالة</td><td>${esc(invoice.status_label || invoice.status)}</td></tr>
          <tr><td>العملة الأساسية</td><td class="ltr"><b style="display:inline-flex;align-items:center;vertical-align:middle;">${curSym}</b> (${esc(invoice.currency || 'SAR')})</td></tr>
        </table>
      </div>
    </section>

    <table class="items ${stripedRows ? 'striped' : ''}">
      <thead>${theadHtml}</thead>
      <tbody>${linesHtml}</tbody>
    </table>

    <section class="bottom">
      <div class="left-col">
        ${showQr ? `<div class="qr qr-${esc(printCfg.qr_position || 'right')}">
          ${qr}
          <div class="tiny muted c">رمز الاستجابة السريعة (متطلب هيئة الزكاة والضريبة والجمارك)</div>
        </div>` : ''}
        <div class="notes">
          ${showNotes && invoice.notes ? `<div class="note"><b>ملاحظات:</b> ${esc(invoice.notes)}</div>` : ''}
          ${showBank && (issuer.bank_name || issuer.bank_iban) ? `<div class="note"><b>بيانات السداد:</b> ${esc(issuer.bank_name || '')}${issuer.bank_iban ? ` — <span class="ltr" style="font-family:Consolas,monospace;font-weight:bold">${esc(formatIban(issuer.bank_iban))}</span>` : ''}</div>` : ''}
          ${showNotes && issuer.legal_terms ? `<div class="note tiny">${esc(issuer.legal_terms)}</div>` : ''}
        </div>
      </div>
      <div class="right-col">
        <table class="totals">
          <tr><td>الإجمالي قبل الخصم</td><td class="e num">${money(invoice.subtotal)} <small class="cur-sym">${curSym}</small></td></tr>
          ${invoice.discount_amount > 0 ? `<tr><td>الخصم</td><td class="e num">${money(invoice.discount_amount)} <small class="cur-sym">${curSym}</small></td></tr>` : ''}
          <tr><td>الإجمالي الخاضع للضريبة</td><td class="e num">${money(invoice.taxable_amount)} <small class="cur-sym">${curSym}</small></td></tr>
          ${Array.from(taxGroups.values()).map((g) => `<tr><td>ضريبة القيمة المضافة (${num(g.rate)}%)</td><td class="e num">${money(g.tax)} <small class="cur-sym">${curSym}</small></td></tr>`).join('')}
          <tr class="grand"><td>الإجمالي المستحق</td><td class="e num">${money(invoice.grand_total)} <span class="grand-cur">${curSym}</span></td></tr>
          <tr><td>المسدد</td><td class="e num">${money(invoice.paid_amount)} <small class="cur-sym">${curSym}</small></td></tr>
          <tr class="rem"><td>المتبقي</td><td class="e num">${money(invoice.remaining_amount)} <small class="cur-sym">${curSym}</small></td></tr>
        </table>
        ${showTafqeet ? `<div class="words">${esc(tafqeet(invoice.grand_total, cur))}</div>` : ''}
      </div>
    </section>

    ${isCustomTemplate ? (printCfg.footer_text ? `
    <footer class="foot" style="border-top:1px solid #cbd5e1;margin-top:5mm;padding-top:2.5mm;text-align:center;color:#64748b;font-size:7.5pt">
      <div>${esc(printCfg.footer_text)}</div>
    </footer>` : '') : `
    <footer class="foot">
      <div>${esc(issuer.footer_notes || 'شكراً لتعاملكم معنا')}</div>
      ${showSignatures ? `<div class="sig" style="display:flex;justify-content:space-between;align-items:center;margin:3mm 0;">
        <div>توقيع المستلم: ................................</div>
        <div>عن ${esc(sellerName)}: ................................</div>
      </div>` : ''}
      <div class="tiny muted c">
        ${invoice.zatca_phase === 'PHASE2' || (invoice.signature_mode && invoice.signature_mode !== 'NONE')
      ? `فاتورة إلكترونية معتمدة — المرحلة الثانية (الربط والتكامل المشفر) — بصمة الفاتورة: <span class="ltr">${esc(String(invoice.invoice_hash).slice(0, 32))}…</span>`
      : 'فاتورة إلكترونية — المرحلة الأولى (رمز QR بالحقول الخمسة الأساسية)'}
      </div>
    </footer>`}
  </div>`;

  const css = `
    html, body { font-family: ${fontFamily}; font-size: ${fontSize}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 210mm; min-height: 297mm; padding: 10mm 9mm; position: relative; page-break-after: always; box-sizing: border-box; background: ${printCfg.light_color && printCfg.light_color !== '#ffffff' ? printCfg.light_color : '#ffffff'}; ${isCustomTemplate ? `border: 1.5px solid ${brandColor}88;` : ''} }
    .page:last-child { page-break-after: auto; }
    .watermark { position: absolute; inset: 0; display: grid; place-items: center; font-size: 90pt; color: rgba(220,38,38,.13); font-weight: 800; transform: rotate(-20deg); pointer-events: none; z-index: 0; }
    .head { display: flex; gap: 8mm; justify-content: space-between; border-bottom: 2px solid ${brandColor}; padding-bottom: 4mm; }
    .head.head-center { align-items: center; }
    .head-col { display: flex; flex-direction: column; }
    .head-col-side { flex: 1; }
    .head-col-center { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 4mm; text-align: center; }
    .logo-center-col { text-align: center; }
    .brand { display: flex; gap: 4mm; align-items: flex-start; }
    .logo { object-fit: contain; }
    .logo-fallback { border-radius: 2.5mm; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; vertical-align: middle; background: transparent; }
    .co { font-size: 14pt; font-weight: 800; color: #0f172a; }
    .co-en { font-size: 9pt; color: #475569; }
    .tiny { font-size: 7.6pt; line-height: 1.5; }
    .badge-mini { display: inline-block; background: #e2e8f0; border-radius: 3px; padding: 1px 5px; font-size: 7.2pt; color: #334155; font-weight: 600; margin-inline-end: 2px; }
    .title-box { text-align: center; min-width: 62mm; }
    .t1 { font-size: 13pt; font-weight: 800; color: ${brandDark}; }
    .t2 { font-size: 8pt; letter-spacing: .08em; color: #64748b; margin-bottom: 2mm; }
    table.meta { font-size: 8pt; border-collapse: collapse; width: 100%; }
    table.meta td { border: 1px solid #cbd5e1; padding: 1mm 2mm; }
    table.meta td:first-child { background: #f1f5f9; color: #475569; white-space: nowrap; }
    .parties { display: flex; gap: 4mm; margin: 4mm 0; }
    .party { flex: 1; border: 1px solid #cbd5e1; border-radius: 2mm; overflow: hidden; }
    .party-h { background: ${isLightColor(brandLight) ? brandLight : '#f8fafc'}; padding: 1.4mm 2mm; font-size: 8.5pt; font-weight: 800; border-bottom: 1.5px solid ${brandColor}44; color: ${brandDark}; }
    table.kv { font-size: 8.4pt; border-collapse: collapse; width: 100%; }
    table.kv td { padding: 1mm 2mm; border-bottom: 1px solid #eef2f7; }
    table.kv td:first-child { color: #64748b; width: 26mm; }
    table.items { font-size: 8.4pt; margin-top: 2mm; border-collapse: collapse; width: 100%; }
    table.items thead tr { break-inside: avoid; page-break-inside: avoid; }
    table.items th { background: ${headerFill}; color: ${thTextColor}; padding: 1.8mm 1.2mm; font-size: 8pt; font-weight: 800; border: 1px solid ${thBorderColor}; white-space: pre-line; line-height: 1.25; }
    table.items td { border: 1px solid #cbd5e1; padding: 1.3mm 1mm; vertical-align: top; }
    table.items tr { break-inside: avoid; page-break-inside: avoid; }
    table.items.striped tbody tr:nth-child(even) { background: #f8fafc; }
    .c { text-align: center; } .e { text-align: end; } .s { text-align: start; }
    .bottom { display: flex; gap: 4mm; margin-top: 4mm; align-items: flex-start; break-inside: avoid; page-break-inside: avoid; }
    .left-col { flex: 1; }
    .right-col { width: 84mm; }
    .qr { text-align: center; }
    .qr svg { width: 30mm; height: 30mm; }
    .notes { margin-top: 3mm; }
    .note { font-size: 8pt; border-inline-start: 2px solid ${brandColor}; padding-inline-start: 2mm; margin-bottom: 1.5mm; }
    table.totals { font-size: 9pt; border-collapse: collapse; width: 100%; }
    table.totals td { padding: 1.3mm 2mm; border-bottom: 1px solid #e2e8f0; }
    table.totals tr.grand td { background: ${brandColor}; color: ${isLightColor(brandColor) ? '#1e293b' : '#ffffff'}; font-size: 11pt; font-weight: 800; border: 0; }
    table.totals tr.rem td { font-weight: 700; color: #b91c1c; }
    .words { margin-top: 2mm; font-size: 8.4pt; background: #f1f5f9; padding: 1.6mm 2mm; border-radius: 1.5mm; }
    .foot { margin-top: 5mm; border-top: 1px solid #cbd5e1; padding-top: 2.5mm; font-size: 8.4pt; }
    .cur-badge { display: inline-flex; align-items: center; justify-content: center; padding: 1.5px 6px; border-radius: 3.5px; background: #f1f5f9; color: #334155; font-size: 7.5pt; font-weight: 700; border: 1px solid #e2e8f0; vertical-align: middle; line-height: 1; }
    .cur-badge svg { vertical-align: middle; }
    .cur-sym { display: inline-flex; align-items: center; justify-content: center; font-size: 7.5pt; color: #64748b; margin-inline-start: 3px; font-weight: 600; vertical-align: middle; }
    .cur-sym svg { vertical-align: middle; }
    .grand-cur { display: inline-flex; align-items: center; justify-content: center; font-size: 9.5pt; margin-inline-start: 4px; font-weight: 700; vertical-align: middle; }
    .grand-cur svg { fill: currentColor; vertical-align: middle; }

    /* أنماط القوالب الإضافية */
    .page[data-tpl="modern"] {
      background: linear-gradient(to bottom, #ffffff, #fafafa);
    }
    .page[data-tpl="modern"] .head {
      border-bottom: 3px solid ${brandColor};
      background: ${brandLight};
      padding: 4mm 5mm;
      border-radius: 2.5mm;
    }
    .page[data-tpl="modern"] .party {
      border-color: #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .page[data-tpl="modern"] .party-h {
      background: ${brandLight};
      color: ${brandDark};
      border-bottom-color: #e2e8f0;
    }
    .page[data-tpl="modern"] table.items th {
      border: 0;
      border-bottom: 2px solid ${brandDark};
    }
    .page[data-tpl="modern"] table.totals tr.grand td {
      border-radius: 1.5mm;
    }

    .page[data-tpl="classic"] {
      border: 3px double #334155;
      padding: 8mm;
    }
    .page[data-tpl="classic"] .head {
      border-bottom: 2px solid #334155;
    }
    .page[data-tpl="classic"] .t1 {
      color: #0f172a;
    }
    .page[data-tpl="classic"] table.items th {
      background: #1e293b;
      border-color: #0f172a;
    }
    .page[data-tpl="classic"] table.totals tr.grand td {
      background: #1e293b;
    }

    .page[data-tpl="compact"] {
      padding: 6mm;
    }
    .page[data-tpl="compact"] .head {
      padding-bottom: 2.5mm;
    }
    .page[data-tpl="compact"] .parties {
      margin: 2.5mm 0;
    }
    .page[data-tpl="compact"] table.items {
      font-size: 8pt;
    }
    .page[data-tpl="compact"] table.items th {
      padding: 1mm;
    }
    .page[data-tpl="compact"] table.items td {
      padding: 0.9mm 1mm;
    }

    /* القالب التنفيذي الملكي */
    .page[data-tpl="executive"] {
      border-top: 5mm solid ${brandDark};
      padding: 10mm 12mm;
    }
    .page[data-tpl="executive"] .head {
      border-bottom: 2px solid ${brandDark};
      padding-bottom: 5mm;
    }
    .page[data-tpl="executive"] .t1 {
      color: ${brandDark};
      font-size: 15pt;
      letter-spacing: .02em;
    }
    .page[data-tpl="executive"] .party-h {
      background: #1e293b;
      color: #fff;
      border-color: #0f172a;
    }
    .page[data-tpl="executive"] table.items th {
      background: linear-gradient(135deg, ${brandDark}, #0f172a);
      color: #fff;
      border: 1px solid #0f172a;
    }
    .page[data-tpl="executive"] table.totals tr.grand td {
      background: ${brandDark};
    }

    /* القالب البسيط النظيف */
    .page[data-tpl="minimal"] {
      padding: 12mm 14mm;
    }
    .page[data-tpl="minimal"] .head {
      border-bottom: 1px solid #e2e8f0;
    }
    .page[data-tpl="minimal"] .party {
      border: 0;
      border-bottom: 1px solid #e2e8f0;
      border-radius: 0;
    }
    .page[data-tpl="minimal"] .party-h {
      background: transparent;
      padding-inline-start: 0;
      color: ${brandDark};
      border-bottom: 0;
    }
    .page[data-tpl="minimal"] table.items th {
      background: #f8fafc;
      color: #334155;
      border: 0;
      border-bottom: 2px solid #e2e8f0;
    }
    .page[data-tpl="minimal"] table.items td {
      border: 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .page[data-tpl="minimal"] table.totals tr.grand td {
      background: #f8fafc;
      color: ${brandDark};
      border-top: 2px solid ${brandDark};
    }

    /* القالب الهندسي للمشاريع والمقاولات */
    .page[data-tpl="grid"] {
      padding: 8mm 10mm;
    }
    .page[data-tpl="grid"] .head {
      border: 2px solid #334155;
      padding: 3mm 4mm;
      margin-bottom: 3mm;
    }
    .page[data-tpl="grid"] .party {
      border: 1.5px solid #334155;
      border-radius: 0;
    }
    .page[data-tpl="grid"] .party-h {
      background: #334155;
      color: #fff;
      border-bottom: 1.5px solid #334155;
      font-weight: 800;
    }
    .page[data-tpl="grid"] table.items th {
      background: #475569;
      border: 1.5px solid #1e293b;
      color: #fff;
      font-weight: 800;
    }
    .page[data-tpl="grid"] table.items td {
      border: 1.5px solid #cbd5e1;
    }
    .page[data-tpl="grid"] table.totals td {
      border: 1.5px solid #cbd5e1;
    }
    .page[data-tpl="grid"] table.totals tr.grand td {
      background: #1e293b;
      color: #fff;
      border: 1.5px solid #0f172a;
    }

    /* القالب المؤسسي الحديث (Corporate) */
    .page[data-tpl="corporate"] {
      padding: 9mm 11mm;
      background: #ffffff;
    }
    .page[data-tpl="corporate"] .head {
      border-bottom: 3px solid ${brandColor};
      padding-bottom: 5mm;
    }
    .page[data-tpl="corporate"] .parties {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 2mm;
      padding: 2.5mm;
      gap: 4mm;
    }
    .page[data-tpl="corporate"] .party {
      border: 0;
      background: transparent;
    }
    .page[data-tpl="corporate"] .party-h {
      background: transparent;
      border-bottom: 1.5px solid ${brandColor};
      color: ${brandDark};
      font-size: 8.8pt;
      font-weight: 800;
      padding: 0 0 1.2mm;
    }
    .page[data-tpl="corporate"] table.items th {
      background: ${brandDark};
      color: #ffffff;
      border: 1px solid ${brandDark};
      font-weight: 700;
    }

    /* قالب 2 - ذهبي عاجي */
    .page[data-tpl*="4b0d1693"], .page[data-tpl*="gold"], .page[data-tpl*="ذهبي"] {
      background: #FAF6EB;
      border: 2px solid #76602D;
      padding: 9mm;
    }
    .page[data-tpl*="4b0d1693"] .head, .page[data-tpl*="gold"] .head {
      border: 1.5px solid #76602D !important;
      background: #FAF6EB !important;
    }
    .page[data-tpl*="4b0d1693"] .party, .page[data-tpl*="gold"] .party {
      border: 1px solid #c8ba9d;
      background: #ffffff;
    }
    .page[data-tpl*="4b0d1693"] .party-h, .page[data-tpl*="gold"] .party-h {
      background: #f5eedf;
      color: #76602D;
      border-bottom: 1.5px solid #76602D;
    }
    .page[data-tpl*="4b0d1693"] table.items th, .page[data-tpl*="gold"] table.items th {
      background: #76602D !important;
      color: #ffffff !important;
      border: 1px solid #59481e !important;
    }
    .page[data-tpl*="4b0d1693"] table.items td, .page[data-tpl*="gold"] table.items td {
      border-color: #dcd3c3;
    }
    .page[data-tpl*="4b0d1693"] table.totals tr.grand td, .page[data-tpl*="gold"] table.totals tr.grand td {
      background: #76602D !important;
      color: #ffffff !important;
    }

    /* قالب رواسي وينبع للاتصالات والتجزئة */
    .page[data-tpl="rawasi"], .page[data-tpl="re_rawasi_telecom"] {
      border-top: 4.5mm solid #1e3a8a;
      padding: 9mm 11mm;
    }
    .page[data-tpl="rawasi"] .head, .page[data-tpl="re_rawasi_telecom"] .head {
      border-bottom: 2px solid #1e3a8a;
      padding-bottom: 4mm;
    }
    .page[data-tpl="rawasi"] .party-h, .page[data-tpl="re_rawasi_telecom"] .party-h {
      background: #eff6ff;
      color: #1e3a8a;
      border-bottom: 1.5px solid #bfdbfe;
    }
    .page[data-tpl="rawasi"] table.items th, .page[data-tpl="re_rawasi_telecom"] table.items th {
      background: #1e3a8a;
      color: #ffffff;
      border-color: #172554;
    }
    .page[data-tpl="rawasi"] table.totals tr.grand td, .page[data-tpl="re_rawasi_telecom"] table.totals tr.grand td {
      background: #1e3a8a;
    }

    /* قالب سجل المقاولات والحديد (الزهراني والمجد) */
    .page[data-tpl="ledger"], .page[data-tpl="re_alzahraani_contracting"] {
      border: 2px solid #111827;
      padding: 8mm 9mm;
    }
    .page[data-tpl="ledger"] .head, .page[data-tpl="re_alzahraani_contracting"] .head {
      border-bottom: 2.5px solid #111827;
      padding-bottom: 4mm;
    }
    .page[data-tpl="ledger"] .party-h, .page[data-tpl="re_alzahraani_contracting"] .party-h {
      background: #1f2937;
      color: #f9fafb;
      border-bottom: 1px solid #111827;
    }
    .page[data-tpl="ledger"] table.items th, .page[data-tpl="re_alzahraani_contracting"] table.items th {
      background: #111827;
      color: #ffffff;
      border-color: #030712;
    }
    .page[data-tpl="ledger"] table.totals tr.grand td, .page[data-tpl="re_alzahraani_contracting"] table.totals tr.grand td {
      background: #111827;
    }

    /* قالب التوريد والشحن واللوجستيات (أوتاد البدر والحرة) */
    .page[data-tpl="logistics"], .page[data-tpl="re_awtad_albadr"] {
      padding: 9mm 11mm;
      background: #fafafa;
    }
    .page[data-tpl="logistics"] .head, .page[data-tpl="re_awtad_albadr"] .head {
      border-bottom: 2px solid #0f766e;
      background: #f0fdfa;
      padding: 3mm 4mm;
      border-radius: 2mm;
    }
    .page[data-tpl="logistics"] .party-h, .page[data-tpl="re_awtad_albadr"] .party-h {
      background: #ccfbf1;
      color: #0f766e;
      border-bottom: 1px solid #99f6e4;
    }
    .page[data-tpl="logistics"] table.items th, .page[data-tpl="re_awtad_albadr"] table.items th {
      background: #0f766e;
      color: #ffffff;
      border-color: #134e4a;
    }
    .page[data-tpl="logistics"] table.totals tr.grand td, .page[data-tpl="re_awtad_albadr"] table.totals tr.grand td {
      background: #0f766e;
    }

    /* قالب موجة تردد والإلكترونيات الفاخرة */
    .page[data-tpl="re_mowjat_taradud"] {
      border-top: 4mm solid #0284c7;
      padding: 9mm 11mm;
    }
    .page[data-tpl="re_mowjat_taradud"] .head {
      border-bottom: 2px solid #0284c7;
      padding-bottom: 4mm;
    }
    .page[data-tpl="re_mowjat_taradud"] .party-h {
      background: #e0f2fe;
      color: #0369a1;
      border-bottom: 1px solid #bae6fd;
    }
    .page[data-tpl="re_mowjat_taradud"] table.items th {
      background: #0284c7;
      color: #ffffff;
      border-color: #0369a1;
    }
    .page[data-tpl="re_mowjat_taradud"] table.totals tr.grand td {
      background: #0284c7;
    }

    /* قالب تركيب ومواد المقاولات والعزل والكثيري */
    .page[data-tpl="re_tarkeeb_contracting"] {
      border-top: 4mm solid #b45309;
      padding: 8.5mm 10mm;
    }
    .page[data-tpl="re_tarkeeb_contracting"] .head {
      border-bottom: 2px solid #b45309;
      padding-bottom: 4mm;
    }
    .page[data-tpl="re_tarkeeb_contracting"] .party-h {
      background: #fef3c7;
      color: #92400e;
      border-bottom: 1px solid #fde68a;
    }
    .page[data-tpl="re_tarkeeb_contracting"] table.items th {
      background: #b45309;
      color: #ffffff;
      border-color: #78350f;
    }
    .page[data-tpl="re_tarkeeb_contracting"] table.totals tr.grand td {
      background: #b45309;
    }

    /* قالب العنوان الوطني والتوريد المفصل (رواد الاتحاد) */
    .page[data-tpl="detailed_address"], .page[data-tpl="re_ruwad_alittihad"] {
      border-top: 4.5mm solid #15803d;
      padding: 8.5mm 10mm;
    }
    .page[data-tpl="detailed_address"] .head, .page[data-tpl="re_ruwad_alittihad"] .head {
      border-bottom: 2px solid #15803d;
      padding-bottom: 4mm;
    }
    .page[data-tpl="detailed_address"] .party-h, .page[data-tpl="re_ruwad_alittihad"] .party-h {
      background: #dcfce7;
      color: #166534;
      border-bottom: 1px solid #bbf7d0;
    }
    .page[data-tpl="detailed_address"] table.items th, .page[data-tpl="re_ruwad_alittihad"] table.items th {
      background: #15803d;
      color: #ffffff;
      border-color: #166534;
    }
    .page[data-tpl="detailed_address"] table.totals tr.grand td, .page[data-tpl="re_ruwad_alittihad"] table.totals tr.grand td {
      background: #15803d;
    }

    /* قالب نيوم المستقبلية (Neom Horizon) */
    .page[data-tpl="neom_horizon"] {
      background: #ffffff;
      border-top: 6.5mm solid #059669;
      padding: 9mm 11mm;
    }
    .page[data-tpl="neom_horizon"] .head {
      border-bottom: 2px solid #10b981;
      background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
      padding: 4mm 5mm;
      border-radius: 3mm;
    }
    .page[data-tpl="neom_horizon"] .t1 {
      color: #065f46;
      font-weight: 900;
      letter-spacing: .03em;
    }
    .page[data-tpl="neom_horizon"] .party {
      border: 1.5px solid #a7f3d0;
      border-radius: 3mm;
      box-shadow: 0 2px 5px rgba(16, 185, 129, 0.05);
    }
    .page[data-tpl="neom_horizon"] .party-h {
      background: #d1fae5;
      color: #065f46;
      font-weight: 800;
      border-bottom: 1.5px solid #a7f3d0;
    }
    .page[data-tpl="neom_horizon"] table.items th {
      background: linear-gradient(135deg, #059669 0%, #047857 100%);
      color: #ffffff;
      border: 0;
      font-weight: 800;
    }
    .page[data-tpl="neom_horizon"] table.items tbody tr:nth-child(even) {
      background: #f0fdf4;
    }
    .page[data-tpl="neom_horizon"] table.totals tr.grand td {
      background: linear-gradient(135deg, #059669 0%, #047857 100%);
      border-radius: 2mm;
    }

    /* قالب الياقوت الملكي التنفيذي (Royal Sapphire) */
    .page[data-tpl="royal_sapphire"] {
      background: #ffffff;
      border: 3.5px double #1e3a8a;
      outline: 1.2px solid #d97706;
      outline-offset: -4.5mm;
      padding: 10mm 12mm;
    }
    .page[data-tpl="royal_sapphire"] .head {
      border-bottom: 2px solid #1e3a8a;
      padding-bottom: 5mm;
    }
    .page[data-tpl="royal_sapphire"] .t1 {
      color: #1e3a8a;
      font-size: 15.5pt;
      font-weight: 900;
    }
    .page[data-tpl="royal_sapphire"] .party {
      border: 1.5px solid #1e3a8a;
      border-radius: 0;
    }
    .page[data-tpl="royal_sapphire"] .party-h {
      background: #1e3a8a;
      color: #fef3c7;
      font-weight: 800;
      border-bottom: 1.5px solid #d97706;
    }
    .page[data-tpl="royal_sapphire"] table.items th {
      background: #1e3a8a;
      color: #ffffff;
      border: 1px solid #172554;
      border-bottom: 2px solid #d97706;
    }
    .page[data-tpl="royal_sapphire"] table.totals tr.grand td {
      background: #1e3a8a;
      color: #fef3c7;
      border-top: 2.5px solid #d97706;
    }

    /* قالب المينيمال الإسكندنافي (Nordic Clean) */
    .page[data-tpl="nordic_frost"] {
      background: #ffffff;
      padding: 11mm 13mm;
    }
    .page[data-tpl="nordic_frost"] .head {
      border-bottom: 1.5px solid #e2e8f0;
      padding-bottom: 5mm;
    }
    .page[data-tpl="nordic_frost"] .party {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 3mm;
    }
    .page[data-tpl="nordic_frost"] .party-h {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      border-bottom: 1px solid #e2e8f0;
    }
    .page[data-tpl="nordic_frost"] table.items th {
      background: #334155;
      color: #f8fafc;
      border: 0;
      font-weight: 700;
    }
    .page[data-tpl="nordic_frost"] table.items td {
      border: 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .page[data-tpl="nordic_frost"] table.totals td {
      border-bottom: 1px solid #f1f5f9;
    }
    .page[data-tpl="nordic_frost"] table.totals tr.grand td {
      background: #334155;
      color: #ffffff;
      border-radius: 2mm;
    }

    /* قالب الماتريكس الصناعي (Matrix Industrial) */
    .page[data-tpl="matrix_industrial"] {
      background: #ffffff;
      border-top: 5mm solid #ea580c;
      border-bottom: 3.5mm solid #0f172a;
      padding: 8mm 10mm;
    }
    .page[data-tpl="matrix_industrial"] .head {
      border-bottom: 2.5px solid #0f172a;
      padding-bottom: 4mm;
    }
    .page[data-tpl="matrix_industrial"] .t1 {
      color: #0f172a;
      font-weight: 900;
      letter-spacing: .02em;
    }
    .page[data-tpl="matrix_industrial"] .party {
      border: 1.5px solid #0f172a;
      border-radius: 1mm;
    }
    .page[data-tpl="matrix_industrial"] .party-h {
      background: #0f172a;
      color: #fed7aa;
      font-weight: 900;
      border-bottom: 1.5px solid #ea580c;
    }
    .page[data-tpl="matrix_industrial"] table.items th {
      background: #0f172a;
      color: #ffffff;
      border: 1px solid #000;
      border-bottom: 2.5px solid #ea580c;
      font-weight: 800;
    }
    .page[data-tpl="matrix_industrial"] table.items td {
      border: 1.2px solid #94a3b8;
    }
    .page[data-tpl="matrix_industrial"] table.totals td {
      border: 1.2px solid #94a3b8;
    }
    .page[data-tpl="matrix_industrial"] table.totals tr.grand td {
      background: #ea580c;
      color: #ffffff;
      font-weight: 900;
    }

    /* قالب الديوان الملكي الفاخر (Royal Diwan) */
    .page[data-tpl="royal_diwan"] {
      background: #fcfdfa;
      border: 4px double #064e3b;
      outline: 1.5px solid #b45309;
      outline-offset: -5mm;
      padding: 12mm 14mm;
    }
    .page[data-tpl="royal_diwan"] .head {
      border-bottom: 2px solid #b45309;
      padding-bottom: 5mm;
      position: relative;
    }
    .page[data-tpl="royal_diwan"] .co {
      color: #064e3b;
      font-size: 15pt;
      font-weight: 900;
    }
    .page[data-tpl="royal_diwan"] .co-en {
      color: #92400e;
      font-weight: 600;
    }
    .page[data-tpl="royal_diwan"] .t1 {
      color: #064e3b;
      font-size: 16pt;
      font-weight: 900;
      letter-spacing: .04em;
    }
    .page[data-tpl="royal_diwan"] .t2 {
      color: #b45309;
      font-weight: 700;
    }
    .page[data-tpl="royal_diwan"] table.meta td:first-child {
      background: #fef3c7;
      color: #78350f;
      font-weight: 700;
    }
    .page[data-tpl="royal_diwan"] .party {
      border: 1.5px solid #064e3b;
      border-radius: 1mm;
      background: #ffffff;
    }
    .page[data-tpl="royal_diwan"] .party-h {
      background: linear-gradient(135deg, #064e3b 0%, #04382c 100%);
      color: #fef3c7;
      font-weight: 800;
      border-bottom: 1.5px solid #b45309;
    }
    .page[data-tpl="royal_diwan"] table.items th {
      background: linear-gradient(135deg, #064e3b 0%, #04382c 100%);
      color: #fef3c7;
      border: 1px solid #064e3b;
      border-bottom: 2.5px solid #b45309;
      font-weight: 800;
    }
    .page[data-tpl="royal_diwan"] table.items td {
      border: 1px solid #cbd5e1;
    }
    .page[data-tpl="royal_diwan"] table.items tbody tr:nth-child(even) {
      background: #f0fdf4;
    }
    .page[data-tpl="royal_diwan"] .cur-badge {
      background: #fef3c7;
      color: #78350f;
      border: 1px solid #fde68a;
    }
    .page[data-tpl="royal_diwan"] table.totals td {
      border-bottom: 1px solid #e2e8f0;
    }
    .page[data-tpl="royal_diwan"] table.totals tr.grand td {
      background: linear-gradient(135deg, #064e3b 0%, #04382c 100%);
      color: #fef3c7;
      font-weight: 900;
      border: 1px solid #064e3b;
      border-top: 3px solid #b45309;
    }

    /* قالب الفنتك السحابي العصري (Modern Obsidian FinTech) */
    .page[data-tpl="fintech_obsidian"] {
      background: #ffffff;
      border-top: 6mm solid #090d16;
      border-bottom: 2.5mm solid #06b6d4;
      padding: 9mm 11mm;
    }
    .page[data-tpl="fintech_obsidian"] .head {
      background: linear-gradient(135deg, #090d16 0%, #0f172a 100%);
      color: #ffffff;
      padding: 5mm 6mm;
      border-radius: 3mm;
      border-bottom: 2.5px solid #06b6d4;
    }
    .page[data-tpl="fintech_obsidian"] .head .co {
      color: #ffffff;
    }
    .page[data-tpl="fintech_obsidian"] .head .co-en {
      color: #94a3b8;
    }
    .page[data-tpl="fintech_obsidian"] .head .tiny {
      color: #cbd5e1;
    }
    .page[data-tpl="fintech_obsidian"] .head .tiny b {
      color: #38bdf8;
    }
    .page[data-tpl="fintech_obsidian"] .head .t1 {
      color: #38bdf8;
      font-weight: 900;
    }
    .page[data-tpl="fintech_obsidian"] .head .t2 {
      color: #94a3b8;
    }
    .page[data-tpl="fintech_obsidian"] .head table.meta td:first-child {
      background: #1e293b;
      color: #94a3b8;
      border-color: #334155;
    }
    .page[data-tpl="fintech_obsidian"] .head table.meta td {
      border-color: #334155;
      color: #f8fafc;
    }
    .page[data-tpl="fintech_obsidian"] .party {
      border: 1px solid #e2e8f0;
      border-radius: 2.5mm;
      box-shadow: 0 2px 6px rgba(9, 13, 22, 0.04);
    }
    .page[data-tpl="fintech_obsidian"] .party-h {
      background: #090d16;
      color: #38bdf8;
      font-weight: 800;
      border-bottom: 2px solid #06b6d4;
    }
    .page[data-tpl="fintech_obsidian"] table.items th {
      background: #090d16;
      color: #ffffff;
      border: 1px solid #090d16;
      border-bottom: 2.5px solid #06b6d4;
      font-weight: 800;
    }
    .page[data-tpl="fintech_obsidian"] table.items td {
      border: 1px solid #f1f5f9;
    }
    .page[data-tpl="fintech_obsidian"] table.items tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .page[data-tpl="fintech_obsidian"] .cur-badge {
      background: #090d16;
      color: #38bdf8;
      border: 1px solid #0891b2;
    }
    .page[data-tpl="fintech_obsidian"] table.totals tr.grand td {
      background: linear-gradient(135deg, #090d16 0%, #0e7490 100%);
      color: #ffffff;
      font-weight: 900;
      border-radius: 2mm;
    }

    /* قالب المؤسسي العالمي ثنائي اللغة (Global Enterprise Matrix) */
    .page[data-tpl="bilingual_matrix"] {
      padding: 9mm 10mm;
      background: #ffffff;
      border-top: 5mm solid #1e40af;
      border-bottom: 2mm solid #1e40af;
    }
    .page[data-tpl="bilingual_matrix"] .head {
      border-bottom: 2.5px solid #1e40af;
      padding-bottom: 4mm;
    }
    .page[data-tpl="bilingual_matrix"] .co {
      color: #1e40af;
      font-weight: 900;
    }
    .page[data-tpl="bilingual_matrix"] .t1 {
      color: #1e40af;
      font-size: 14pt;
      font-weight: 900;
    }
    .page[data-tpl="bilingual_matrix"] .t2 {
      color: #1d4ed8;
      font-weight: 700;
      letter-spacing: .12em;
    }
    .page[data-tpl="bilingual_matrix"] table.meta td:first-child {
      background: #eff6ff;
      color: #1e40af;
      font-weight: 700;
    }
    .page[data-tpl="bilingual_matrix"] .party {
      border: 1.5px solid #bfdbfe;
      border-radius: 1.5mm;
      background: #f8fafc;
    }
    .page[data-tpl="bilingual_matrix"] .party-h {
      background: #1e40af;
      color: #ffffff;
      font-weight: 800;
      border-bottom: 1.5px solid #1d4ed8;
      padding: 1.8mm 3mm;
    }
    .page[data-tpl="bilingual_matrix"] table.items {
      border: 1.5px solid #1e40af;
    }
    .page[data-tpl="bilingual_matrix"] table.items th {
      background: #1e40af;
      color: #ffffff;
      border: 1px solid #1d4ed8;
      font-weight: 800;
      font-size: 7.6pt;
    }
    .page[data-tpl="bilingual_matrix"] table.items td {
      border: 1px solid #bfdbfe;
    }
    .page[data-tpl="bilingual_matrix"] table.items tbody tr:nth-child(even) {
      background: #eff6ff;
    }
    .page[data-tpl="bilingual_matrix"] .cur-badge {
      background: #eff6ff;
      color: #1e40af;
      border: 1px solid #bfdbfe;
    }
    .page[data-tpl="bilingual_matrix"] table.totals {
      border: 1.5px solid #1e40af;
    }
    .page[data-tpl="bilingual_matrix"] table.totals td {
      border: 1px solid #bfdbfe;
    }
    .page[data-tpl="bilingual_matrix"] table.totals tr.grand td {
      background: #1e40af;
      color: #ffffff;
      font-weight: 900;
    }

    /* قالب المينيمال السويسري النقي (Swiss International Clean) */
    .page[data-tpl="swiss_clean"] {
      padding: 13mm 14mm;
      background: #ffffff;
    }
    .page[data-tpl="swiss_clean"] .head {
      border-bottom: 1.5px solid #0f172a;
      padding-bottom: 6mm;
      margin-bottom: 5mm;
    }
    .page[data-tpl="swiss_clean"] .co {
      font-size: 16pt;
      font-weight: 900;
      color: #000000;
      letter-spacing: -.02em;
    }
    .page[data-tpl="swiss_clean"] .t1 {
      font-size: 18pt;
      font-weight: 900;
      color: #000000;
    }
    .page[data-tpl="swiss_clean"] .t2 {
      font-size: 8pt;
      color: #64748b;
    }
    .page[data-tpl="swiss_clean"] table.meta {
      border: 0;
    }
    .page[data-tpl="swiss_clean"] table.meta td {
      border: 0;
      border-bottom: 1px solid #f1f5f9;
      padding: 1.2mm 0;
    }
    .page[data-tpl="swiss_clean"] table.meta td:first-child {
      background: transparent;
      color: #64748b;
      font-weight: 600;
    }
    .page[data-tpl="swiss_clean"] .party {
      border: 0;
      border-top: 1.5px solid #0f172a;
      border-radius: 0;
      background: transparent;
      padding-top: 2mm;
    }
    .page[data-tpl="swiss_clean"] .party-h {
      background: transparent;
      border: 0;
      color: #000000;
      font-size: 9pt;
      font-weight: 900;
      padding: 0 0 2mm 0;
    }
    .page[data-tpl="swiss_clean"] table.kv td {
      border: 0;
      border-bottom: 1px solid #f1f5f9;
      padding: 1.2mm 0;
    }
    .page[data-tpl="swiss_clean"] table.items {
      border: 0;
      border-top: 2px solid #000000;
      border-bottom: 2px solid #000000;
    }
    .page[data-tpl="swiss_clean"] table.items th {
      background: transparent;
      color: #000000;
      border: 0;
      border-bottom: 1.5px solid #000000;
      font-weight: 800;
      font-size: 8pt;
      padding: 2.5mm 1mm;
    }
    .page[data-tpl="swiss_clean"] table.items td {
      border: 0;
      border-bottom: 1px solid #e2e8f0;
      padding: 2mm 1mm;
    }
    .page[data-tpl="swiss_clean"] table.items.striped tbody tr:nth-child(even) {
      background: transparent;
    }
    .page[data-tpl="swiss_clean"] .cur-badge {
      background: #f1f5f9;
      color: #0f172a;
      border: 1px solid #cbd5e1;
    }
    .page[data-tpl="swiss_clean"] table.totals {
      border: 0;
    }
    .page[data-tpl="swiss_clean"] table.totals td {
      border: 0;
      border-bottom: 1px solid #f1f5f9;
      padding: 1.5mm 0;
    }
    .page[data-tpl="swiss_clean"] table.totals tr.grand td {
      background: transparent;
      color: #000000;
      font-size: 13pt;
      font-weight: 900;
      border-top: 2px solid #000000;
      border-bottom: 2px solid #000000;
      padding: 2.5mm 0;
    }

    /* قالب المخطط الهندسي للمشاريع (Project Blueprint) */
    .page[data-tpl="blueprint"] {
      padding: 8mm 9mm;
      background: #ffffff;
      border: 2.5px solid #1e3a8a;
      outline: 1px solid #93c5fd;
      outline-offset: -3.5mm;
    }
    .page[data-tpl="blueprint"] .head {
      border: 2px solid #1e3a8a;
      background: #f0f9ff;
      padding: 3.5mm 4mm;
      margin-bottom: 3.5mm;
    }
    .page[data-tpl="blueprint"] .co {
      font-family: "Consolas", monospace, "Cairo";
      font-weight: 800;
      color: #1e3a8a;
    }
    .page[data-tpl="blueprint"] .t1 {
      font-family: "Consolas", monospace, "Cairo";
      color: #1e3a8a;
      font-weight: 900;
      letter-spacing: .05em;
    }
    .page[data-tpl="blueprint"] table.meta td {
      font-family: "Consolas", monospace, "Cairo";
      border: 1.2px solid #1e3a8a;
    }
    .page[data-tpl="blueprint"] table.meta td:first-child {
      background: #dbeafe;
      color: #1e3a8a;
      font-weight: 700;
    }
    .page[data-tpl="blueprint"] .party {
      border: 1.5px solid #1e3a8a;
      border-radius: 0;
      background: #ffffff;
    }
    .page[data-tpl="blueprint"] .party-h {
      background: #1e3a8a;
      color: #ffffff;
      font-weight: 800;
      font-family: "Consolas", monospace, "Cairo";
      border-bottom: 1.5px solid #1e3a8a;
    }
    .page[data-tpl="blueprint"] table.kv td {
      border: 1px solid #e0f2fe;
      font-family: "Consolas", monospace, "Segoe UI";
    }
    .page[data-tpl="blueprint"] table.items {
      border: 1.5px solid #1e3a8a;
    }
    .page[data-tpl="blueprint"] table.items th {
      background: #1e3a8a;
      color: #ffffff;
      border: 1.2px solid #0f172a;
      font-family: "Consolas", monospace, "Cairo";
      font-weight: 800;
      padding: 2mm 1mm;
    }
    .page[data-tpl="blueprint"] table.items td {
      border: 1.2px solid #93c5fd;
      font-family: "Consolas", monospace, "Segoe UI";
    }
    .page[data-tpl="blueprint"] table.items tbody tr:nth-child(even) {
      background: #f0f9ff;
    }
    .page[data-tpl="blueprint"] .cur-badge {
      background: #dbeafe;
      color: #1e3a8a;
      border: 1px solid #93c5fd;
      font-family: "Consolas", monospace, "Segoe UI";
    }
    .page[data-tpl="blueprint"] table.totals {
      border: 1.5px solid #1e3a8a;
    }
    .page[data-tpl="blueprint"] table.totals td {
      border: 1.2px solid #93c5fd;
      font-family: "Consolas", monospace, "Segoe UI";
    }
    .page[data-tpl="blueprint"] table.totals tr.grand td {
      background: #1e3a8a;
      color: #ffffff;
      font-weight: 900;
      border: 1.5px solid #0f172a;
    }

    /* قالب البوتيك المخملي الراقي (Warm Boutique & Luxury) */
    .page[data-tpl="boutique_warm"] {
      padding: 10mm 12mm;
      background: #fffaf8;
      border-top: 5mm solid #9f1239;
      border-bottom: 2mm solid #9f1239;
    }
    .page[data-tpl="boutique_warm"] .head {
      border-bottom: 2px solid #fda4af;
      padding-bottom: 5mm;
    }
    .page[data-tpl="boutique_warm"] .co {
      color: #881337;
      font-size: 15pt;
      font-weight: 800;
    }
    .page[data-tpl="boutique_warm"] .co-en {
      color: #9f1239;
    }
    .page[data-tpl="boutique_warm"] .t1 {
      color: #881337;
      font-size: 15pt;
      font-weight: 800;
    }
    .page[data-tpl="boutique_warm"] .t2 {
      color: #be123c;
    }
    .page[data-tpl="boutique_warm"] table.meta td {
      border-color: #fecdd3;
    }
    .page[data-tpl="boutique_warm"] table.meta td:first-child {
      background: #ffe4e6;
      color: #881337;
      font-weight: 700;
    }
    .page[data-tpl="boutique_warm"] .party {
      border: 1.5px solid #fecdd3;
      border-radius: 3mm;
      background: #ffffff;
      box-shadow: 0 1px 4px rgba(159, 18, 57, 0.03);
    }
    .page[data-tpl="boutique_warm"] .party-h {
      background: #fff1f2;
      color: #881337;
      font-weight: 800;
      border-bottom: 1.5px solid #fecdd3;
    }
    .page[data-tpl="boutique_warm"] table.kv td {
      border-bottom: 1px solid #fff1f2;
    }
    .page[data-tpl="boutique_warm"] table.items th {
      background: linear-gradient(135deg, #9f1239 0%, #881337 100%);
      color: #ffffff;
      border: 1px solid #881337;
      font-weight: 700;
    }
    .page[data-tpl="boutique_warm"] table.items td {
      border: 1px solid #ffe4e6;
    }
    .page[data-tpl="boutique_warm"] table.items tbody tr:nth-child(even) {
      background: #fff1f2;
    }
    .page[data-tpl="boutique_warm"] .cur-badge {
      background: #ffe4e6;
      color: #881337;
      border: 1px solid #fecdd3;
    }
    .page[data-tpl="boutique_warm"] table.totals td {
      border-bottom: 1px solid #ffe4e6;
    }
    .page[data-tpl="boutique_warm"] table.totals tr.grand td {
      background: linear-gradient(135deg, #9f1239 0%, #881337 100%);
      color: #ffffff;
      font-weight: 800;
      border-radius: 2mm;
    }

    /* قالب النخبة الأندلسي الملكي (Elite Andalusian) */
    .page[data-tpl="elite_andalusian"] {
      background: #fdfbf7;
      border: 3.5px double #1e293b;
      outline: 1.5px solid #b45309;
      outline-offset: -4.5mm;
      padding: 11mm 13mm;
    }
    .page[data-tpl="elite_andalusian"] .head {
      border-bottom: 2px solid #b45309;
      padding-bottom: 5mm;
      position: relative;
    }
    .page[data-tpl="elite_andalusian"] .co {
      color: #0f172a;
      font-size: 15.5pt;
      font-weight: 900;
    }
    .page[data-tpl="elite_andalusian"] .co-en {
      color: #b45309;
      font-weight: 700;
      letter-spacing: .05em;
    }
    .page[data-tpl="elite_andalusian"] .t1 {
      color: #0f172a;
      font-size: 16pt;
      font-weight: 900;
    }
    .page[data-tpl="elite_andalusian"] .t2 {
      color: #b45309;
      font-weight: 800;
      letter-spacing: .1em;
    }
    .page[data-tpl="elite_andalusian"] table.meta td:first-child {
      background: #fef3c7;
      color: #92400e;
      font-weight: 700;
      border-color: #fde68a;
    }
    .page[data-tpl="elite_andalusian"] table.meta td {
      border-color: #fde68a;
    }
    .page[data-tpl="elite_andalusian"] .party {
      border: 1.5px solid #1e293b;
      border-radius: 1.5mm;
      background: #ffffff;
    }
    .page[data-tpl="elite_andalusian"] .party-h {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      color: #fef3c7;
      font-weight: 800;
      border-bottom: 1.5px solid #b45309;
    }
    .page[data-tpl="elite_andalusian"] table.items th {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      color: #fef3c7;
      border: 1px solid #1e293b;
      border-bottom: 2.5px solid #b45309;
      font-weight: 800;
    }
    .page[data-tpl="elite_andalusian"] table.items td {
      border: 1px solid #e2e8f0;
    }
    .page[data-tpl="elite_andalusian"] table.items tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .page[data-tpl="elite_andalusian"] .cur-badge {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
    }
    .page[data-tpl="elite_andalusian"] table.totals tr.grand td {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      color: #fef3c7;
      font-weight: 900;
      border: 1px solid #1e293b;
      border-top: 2.5px solid #b45309;
    }

    /* قالب الكريستال العصري المبتكر (Crystal Modern Clean) */
    .page[data-tpl="crystal_modern"] {
      background: #ffffff;
      border-top: 6mm solid #0284c7;
      border-bottom: 3mm solid #0ea5e9;
      padding: 9mm 11mm;
    }
    .page[data-tpl="crystal_modern"] .head {
      border-bottom: 2px solid #38bdf8;
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      padding: 4.5mm 5.5mm;
      border-radius: 3.5mm;
    }
    .page[data-tpl="crystal_modern"] .co {
      color: #0369a1;
      font-weight: 900;
    }
    .page[data-tpl="crystal_modern"] .t1 {
      color: #0284c7;
      font-weight: 900;
      letter-spacing: .02em;
    }
    .page[data-tpl="crystal_modern"] .party {
      border: 1.5px solid #bae6fd;
      border-radius: 3mm;
      background: #ffffff;
      box-shadow: 0 2px 8px rgba(2, 132, 199, 0.05);
    }
    .page[data-tpl="crystal_modern"] .party-h {
      background: #e0f2fe;
      color: #0369a1;
      font-weight: 800;
      border-bottom: 1.5px solid #bae6fd;
    }
    .page[data-tpl="crystal_modern"] table.items th {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      color: #ffffff;
      border: 0;
      font-weight: 800;
    }
    .page[data-tpl="crystal_modern"] table.items td {
      border: 1px solid #e0f2fe;
    }
    .page[data-tpl="crystal_modern"] table.items tbody tr:nth-child(even) {
      background: #f0f9ff;
    }
    .page[data-tpl="crystal_modern"] .cur-badge {
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #7dd3fc;
    }
    .page[data-tpl="crystal_modern"] table.totals tr.grand td {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      color: #ffffff;
      border-radius: 2.5mm;
      font-weight: 900;
    }

    /* قالب الأفق الهندسي للمشاريع والتوريدات (Apex Engineering & EPC) */
    .page[data-tpl="apex_engineering"] {
      background: #ffffff;
      border: 3px solid #0f172a;
      outline: 1.2px dashed #475569;
      outline-offset: -3.5mm;
      padding: 8mm 10mm;
    }
    .page[data-tpl="apex_engineering"] .head {
      border-bottom: 2.5px solid #0f172a;
      padding-bottom: 4.5mm;
    }
    .page[data-tpl="apex_engineering"] .co {
      color: #0f172a;
      font-weight: 900;
      font-size: 15pt;
    }
    .page[data-tpl="apex_engineering"] .t1 {
      color: #0f172a;
      font-weight: 900;
      letter-spacing: .04em;
    }
    .page[data-tpl="apex_engineering"] table.meta td:first-child {
      background: #e2e8f0;
      color: #0f172a;
      font-weight: 700;
    }
    .page[data-tpl="apex_engineering"] .party {
      border: 2px solid #0f172a;
      border-radius: 0;
      background: #ffffff;
    }
    .page[data-tpl="apex_engineering"] .party-h {
      background: #0f172a;
      color: #f8fafc;
      font-weight: 800;
      border-bottom: 1.5px solid #0f172a;
    }
    .page[data-tpl="apex_engineering"] table.items {
      border: 2px solid #0f172a;
    }
    .page[data-tpl="apex_engineering"] table.items th {
      background: #0f172a;
      color: #ffffff;
      border: 1px solid #334155;
      font-weight: 800;
    }
    .page[data-tpl="apex_engineering"] table.items td {
      border: 1px solid #94a3b8;
    }
    .page[data-tpl="apex_engineering"] table.items tbody tr:nth-child(even) {
      background: #f1f5f9;
    }
    .page[data-tpl="apex_engineering"] .cur-badge {
      background: #e2e8f0;
      color: #0f172a;
      border: 1px solid #94a3b8;
    }
    .page[data-tpl="apex_engineering"] table.totals {
      border: 2px solid #0f172a;
    }
    .page[data-tpl="apex_engineering"] table.totals td {
      border: 1px solid #94a3b8;
    }
    .page[data-tpl="apex_engineering"] table.totals tr.grand td {
      background: #0f172a;
      color: #ffffff;
      font-weight: 900;
    }
    ${printCfg.custom_css || ''}
  `;

  return docShell({
    title: `فاتورة ${invoice.invoice_number}`,
    pageCss: 'size: A4; margin: 0;',
    body: { css, html: Array.from({ length: Math.max(1, copies) }, () => one).join('') },
    autoPrint,
  });
}

/** توليد مستند للمعاينة الحية دون استدعاء نافذة الطباعة تلقائياً. */
export function invoicePreviewDoc({ invoice, issuer, client, copies = 1, printSettings = null, qrSettings = null }) {
  const tplStyle = (printSettings && printSettings.template_style)
    || (issuer.print_settings && issuer.print_settings.template_style)
    || 'standard';
  if (tplStyle === 'thermal' || tplStyle === 'pos_detailed') {
    return invoiceThermal({ invoice, issuer, client, printSettings, qrSettings });
  }
  return invoiceA4({ invoice, issuer, client, copies, printSettings, qrSettings, autoPrint: false });
}

// ------------------------------------------------- فاتورة حرارية 80mm
export function invoiceThermal({ invoice, issuer, client, printSettings = null, qrSettings = null }) {
  const rawQr = qrSettings || issuer.qr_settings;
  const qrCfg = typeof rawQr === 'string' ? JSON.parse(rawQr || '{}') : (rawQr || {});
  const rawPrint = printSettings || issuer.print_settings;
  const printCfg = typeof rawPrint === 'string' ? JSON.parse(rawPrint || '{}') : (rawPrint || {});
  const isDetailed = printCfg.template_style === 'pos_detailed';

  const showQr = qrCfg.show_thermal !== false;
  const qrScale = qrCfg.thermal_scale || (qrCfg.size === 'large' ? 4 : qrCfg.size === 'small' ? 2 : 3);
  const qr = showQr ? qrSvg(invoice.qr_payload, { scale: qrScale, margin: 1 }) : '';
  const isSar = !invoice.currency || invoice.currency === 'SAR' || invoice.currency === 'ر.س' || invoice.currency === '﷼';
  const cur = invoice.currency === 'SAR' ? 'ر.س' : invoice.currency;
  const curSym = isSar ? sarSvg({ size: '0.95em' }) : esc(cur);

  const sellerName = invoice.seller_name || issuer.name_ar;
  const sellerTax = invoice.seller_tax_number || issuer.tax_number;
  const sellerAddr = invoice.seller_address || addressLine(issuer);
  const buyerName = invoice.buyer_name || client.name;
  const buyerTax = invoice.buyer_tax_number || client.tax_number;

  const thermalLines = Array.isArray(invoice.lines) ? invoice.lines : (Array.isArray(invoice.items) ? invoice.items : []);
  const lines = thermalLines.map((l) => `<tr>
      <td colspan="3" class="nm">${esc(l.item_name)}${isDetailed && l.item_code ? ` <span class="muted ltr tiny">(${esc(l.item_code)})</span>` : ''}</td></tr>
    <tr class="dt">
      <td>${num(l.quantity)} × ${money(l.unit_price)}${l.discount ? ` − ${money(l.discount)}` : ''}</td>
      <td class="c">${num(l.tax_rate)}%</td>
      <td class="e"><b>${money(l.total_line)}</b></td>
    </tr>`).join('');

  const html = `<div class="receipt ${isDetailed ? 'detailed' : ''}">
    ${issuer.logo_data ? `<img class="logo" src="${esc(issuer.logo_data)}" alt="" />` : ''}
    <div class="co">${esc(sellerName)}</div>
    ${issuer.name_en ? `<div class="tiny ltr">${esc(issuer.name_en)}</div>` : ''}
    <div class="tiny">${esc(sellerAddr)}</div>
    ${issuer.phone ? `<div class="tiny ltr">${esc(issuer.phone)}</div>` : ''}
    ${sellerTax ? `<div class="tiny">الرقم الضريبي: <span class="ltr">${esc(sellerTax)}</span></div>` : ''}
    <div class="hr"></div>
    <div class="ttl">${invoice.invoice_type === 'SIMPLIFIED' ? 'فاتورة ضريبية مبسطة' : 'فاتورة ضريبية'}</div>
    <table class="head-t">
      <tr><td>رقم الفاتورة</td><td class="e ltr"><b>${esc(invoice.invoice_number)}</b></td></tr>
      <tr><td>التاريخ</td><td class="e ltr">${esc(invoice.issue_date)} ${esc(invoice.issue_time)}</td></tr>
      <tr><td>العميل</td><td class="e">${esc(buyerName)}</td></tr>
      ${buyerTax ? `<tr><td>ر.ض العميل</td><td class="e ltr">${esc(buyerTax)}</td></tr>` : ''}
      <tr><td>الدفع</td><td class="e">${esc(invoice.payment_label || '')}</td></tr>
      ${isDetailed ? `<tr><td>مرحلة الزكاة</td><td class="e">${invoice.zatca_phase === 'PHASE2' ? 'المرحلة 2 (مشفرة)' : 'المرحلة 1 (أساسية)'}</td></tr>` : ''}
    </table>
    <div class="hr"></div>
    <table class="items">${lines}</table>
    <div class="hr"></div>
    <table class="tot">
      <tr><td>الإجمالي قبل الضريبة</td><td class="e">${money(invoice.taxable_amount)}</td></tr>
      ${invoice.discount_amount ? `<tr><td>الخصم</td><td class="e">${money(invoice.discount_amount)}</td></tr>` : ''}
      <tr><td>ضريبة القيمة المضافة</td><td class="e">${money(invoice.tax_amount)}</td></tr>
      <tr class="g"><td>الإجمالي (${curSym})</td><td class="e">${money(invoice.grand_total)}</td></tr>
      ${invoice.paid_amount ? `<tr><td>المسدد</td><td class="e">${money(invoice.paid_amount)}</td></tr>` : ''}
      ${invoice.remaining_amount ? `<tr><td>المتبقي</td><td class="e">${money(invoice.remaining_amount)}</td></tr>` : ''}
    </table>
    ${showQr ? `<div class="qr">${qr}</div>` : ''}
    <div class="tiny c">${esc(issuer.footer_notes || 'شكراً لزيارتكم')}</div>
    <div class="tiny c muted ltr">${esc(invoice.uuid ? invoice.uuid.slice(0, 24) : '')}</div>
  </div>`;

  const css = `
    body { width: 80mm; }
    .receipt { width: 80mm; padding: 3mm 3mm 6mm; font-size: 9pt; }
    .logo { display: block; margin: 0 auto 1.5mm; max-width: 34mm; max-height: 16mm; }
    .co { text-align: center; font-size: 12pt; font-weight: 800; }
    .tiny { font-size: 7.4pt; text-align: center; }
    .hr { border-top: 1px dashed #000; margin: 1.8mm 0; }
    .ttl { text-align: center; font-weight: 800; font-size: 10pt; margin-bottom: 1mm; }
    table { width: 100%; }
    .head-t td, .tot td { font-size: 8.2pt; padding: .3mm 0; }
    .items .nm { font-size: 8.6pt; font-weight: 700; padding-top: 1mm; }
    .items .dt td { font-size: 8pt; color: #111; padding-bottom: .8mm; border-bottom: 1px dotted #cbd5e1; }
    .e { text-align: end; } .c { text-align: center; } .muted { color: #64748b; }
    .tot .g td { font-size: 11pt; font-weight: 800; border-top: 1px solid #000; padding-top: 1mm; }
    .qr { text-align: center; margin: 2.5mm 0 1.5mm; }
    .qr svg { width: 26mm; height: 26mm; }
  `;

  return docShell({
    title: `فاتورة ${invoice.invoice_number}`,
    pageCss: 'size: 80mm auto; margin: 0;',
    body: { css, html },
  });
}

// -------------------------------------------------------- سند قبض A4/A5
// -------------------------------------------------------- قوالب سندات القبض
export const VOUCHER_TEMPLATES = [
  {
    id: 'voucher_saqr_slip',
    name: 'قسيمة تحصيل وسند قبض (توريدات الصقر)',
    name_en: 'Al-Saqr Payment Slip & Receipt Card',
    desc: 'نموذج قسيمة تحصيل الصقر بكروت المؤشرات الأربعة، شريط التفقيط، جدول بيان السند، والتوقيع الثلاثي مع الختم.',
    badge: 'عينة uu (توريدات الصقر)',
    color: '#0284c7',
    dark: '#0369a1',
  },
  {
    id: 'voucher_luxury_receipt',
    name: 'سند قبض تجاري (الإصدار الفاخر وتويوتا)',
    name_en: 'Luxury Edition Commercial Receipt Voucher',
    desc: 'نموذج سند قبض الإصدار الفاخر بشارة المبلغ الكبيرة، شريط التاريخ والمرجع، والاعتماد الثنائي (الصندوق والمحاسب).',
    badge: 'عينة uu (الإصدار الفاخر)',
    color: '#1e3a8a',
    dark: '#172554',
  },
];

export function voucherPrint({ voucher, issuer, client, style = 'voucher_saqr_slip' }) {
  const isSar = !voucher.currency || voucher.currency === 'SAR' || voucher.currency === 'ر.س' || voucher.currency === '﷼';
  const cur = voucher.currency === 'SAR' ? 'ر.س' : (voucher.currency || 'ر.س');
  const curSym = isSar ? sarSvg({ size: '1.05em' }) : esc(cur);
  const isLuxury = style === 'voucher_luxury_receipt';

  const allocs = (voucher.allocations || []).map((a, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="ltr">${esc(a.invoice_number)}</td>
      <td>${esc(dateAr(a.issue_date))}</td>
      <td class="e num">${money(a.invoice_total)}</td>
      <td class="e num"><b>${money(a.allocated_amount)}</b></td>
      <td class="e num">${money(a.invoice_remaining)}</td>
    </tr>`).join('');

  let html = '';
  let css = '';

  if (isLuxury) {
    // ---------------------- طراز الإصدار الفاخر وتويوتا
    html = `<div class="page lux-page">
      ${voucher.status === 'CANCELLED' ? '<div class="watermark">ملغى</div>' : ''}
      <header class="lux-head">
        <div class="lux-head-en">
          <div class="co-en">${esc(issuer.name_en || 'Luxury Edition Trading Establishment')}</div>
          <div class="tiny-en">${esc(issuer.district_en || issuer.district || 'Jeddah - Alfisalia District')}</div>
          <div class="tiny-en">TAX NO. <span class="ltr">${esc(issuer.tax_number || '302284229500003')}</span></div>
          <div class="tiny-en">CR NO. <span class="ltr">${esc(issuer.commercial_register || '7007285526')}</span></div>
        </div>

        <div class="lux-title-box">
          <div class="lux-t1">سند قبض</div>
          <div class="lux-t2 ltr">Receipt</div>
        </div>

        <div class="lux-head-ar">
          <div class="co-ar">${esc(issuer.name_ar || 'مؤسسة الإصدار الفاخر التجارية')}</div>
          <div class="tiny">${esc(issuer.district ? `${issuer.city || 'جدة'} - حي ${issuer.district}` : addressLine(issuer))}</div>
          <div class="tiny">الرقم الضريبي: <span class="ltr">${esc(issuer.tax_number || '302284229500003')}</span></div>
          <div class="tiny">السجل التجاري: <span class="ltr">${esc(issuer.commercial_register || '7007285526')}</span></div>
        </div>
      </header>

      <div class="lux-meta-bar">
        <div>رقم السند: <b class="ltr">${esc(voucher.voucher_number)}</b></div>
        <div>التاريخ: <b>${esc(dateAr(voucher.voucher_date))}</b></div>
      </div>

      <div class="lux-body-card">
        <div class="lux-row">
          <span class="lux-lbl">استلمنا من:</span>
          <span class="lux-val"><b>${esc(client.name)}</b></span>
        </div>

        <div class="lux-amt-box">
          <span class="lux-amt-lbl">المبلغ:</span>
          <span class="lux-amt-val num">${money(voucher.total_amount)}</span>
          <span class="lux-amt-cur">${curSym}</span>
        </div>

        <div class="lux-tafqeet-bar">
          <b>فقط مبلغ وقدره:</b> ${esc(tafqeet(voucher.total_amount, cur))}
        </div>

        <div class="lux-row mt">
          <span class="lux-lbl">وذلك مقابل:</span>
          <span class="lux-val">${esc(voucher.notes || 'سداد فواتير')}</span>
        </div>
      </div>

      ${allocs ? `
      <div class="alloc-box">
        <h4 style="margin:3mm 0 1.5mm;font-size:9.5pt;color:#1e3a8a">الفواتير المسددة بموجب هذا السند</h4>
        <table class="items"><thead><tr>
          <th class="c" style="width:22px">#</th><th>رقم الفاتورة</th><th style="width:70px">تاريخها</th>
          <th class="e" style="width:80px">إجمالي الفاتورة</th><th class="e" style="width:80px">المسدد من السند</th><th class="e" style="width:80px">المتبقي بعدها</th>
        </tr></thead><tbody>${allocs}</tbody>
        <tfoot><tr><td colspan="4" class="e">إجمالي الموزّع</td><td class="e num"><b>${money(voucher.allocated_amount)}</b></td>
          <td class="e num">${voucher.unallocated ? `غير موزّع: ${money(voucher.unallocated)}` : ''}</td></tr></tfoot></table>
      </div>` : ''}

      <div class="lux-sig-zone">
        <div class="lux-sig">
          <div class="lux-sig-title">الصندوق</div>
          <div class="lux-sig-dots">...................................</div>
        </div>
        <div class="lux-sig">
          <div class="lux-sig-title">المحاسب</div>
          <div class="lux-sig-dots">...................................</div>
        </div>
      </div>

      <div class="lux-footer">
        <div>${esc(issuer.name_ar)} - ${esc(addressLine(issuer))}</div>
      </div>
    </div>`;

    css = `
      html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: ${FONT}; }
      .page.lux-page { width: 210mm; min-height: 148mm; padding: 10mm; position: relative; box-sizing: border-box; color: #0f172a; }
      .watermark { position: absolute; inset: 0; display: grid; place-items: center; font-size: 80pt; color: rgba(220,38,38,.12); font-weight: 800; transform: rotate(-18deg); pointer-events: none; }
      .lux-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #1e3a8a; padding-bottom: 3.5mm; margin-bottom: 3.5mm; }
      .lux-head-en { text-align: left; font-size: 8pt; color: #334155; line-height: 1.35; }
      .co-en { font-size: 10.5pt; font-weight: 800; color: #1e3a8a; }
      .lux-head-ar { text-align: right; font-size: 8pt; color: #334155; line-height: 1.35; }
      .co-ar { font-size: 11.5pt; font-weight: 800; color: #1e3a8a; }
      .lux-title-box { text-align: center; padding: 0 4mm; }
      .lux-t1 { font-size: 16pt; font-weight: 900; color: #1e3a8a; }
      .lux-t2 { font-size: 9pt; color: #64748b; font-weight: 700; }
      .lux-meta-bar { display: flex; justify-content: space-between; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 1.5mm; padding: 2mm 4mm; font-size: 9.5pt; margin-bottom: 4mm; }
      .lux-body-card { border: 1.5px solid #1e3a8a; border-radius: 2.5mm; padding: 4mm; background: #fafafa; margin-bottom: 4mm; }
      .lux-row { font-size: 10pt; line-height: 1.8; }
      .lux-lbl { color: #475569; margin-inline-end: 2mm; font-weight: 600; }
      .lux-val { color: #0f172a; }
      .lux-amt-box { display: flex; align-items: center; gap: 3mm; margin: 3mm 0; background: #eff6ff; border: 1.5px solid #1e3a8a; border-radius: 2mm; padding: 2.5mm 4mm; }
      .lux-amt-lbl { font-size: 11pt; font-weight: 800; color: #1e3a8a; }
      .lux-amt-val { font-size: 15pt; font-weight: 900; color: #1e3a8a; }
      .lux-amt-cur { font-size: 10pt; font-weight: 700; color: #475569; }
      .lux-tafqeet-bar { background: #fff; border: 1px dashed #93c5fd; border-radius: 1.5mm; padding: 2mm 3mm; font-size: 9.5pt; color: #1e293b; }
      .lux-sig-zone { display: flex; justify-content: space-around; margin: 10mm 0 4mm; }
      .lux-sig { text-align: center; width: 45mm; }
      .lux-sig-title { font-size: 10pt; font-weight: 800; color: #1e3a8a; margin-bottom: 3mm; }
      .lux-sig-dots { font-size: 8pt; color: #94a3b8; }
      .lux-footer { text-align: center; font-size: 8pt; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 2.5mm; margin-top: 4mm; }
      table.items { font-size: 8.4pt; border-collapse: collapse; width: 100%; margin-top: 2mm; }
      table.items th { background: #1e3a8a; color: #fff; padding: 1.4mm; border: 1px solid #172554; }
      table.items td { border: 1px solid #cbd5e1; padding: 1.2mm; }
      table.items tfoot td { background: #f1f5f9; font-weight: 700; }
      .c { text-align: center; } .e { text-align: end; }
    `;
  } else {
    // ---------------------- طراز قسيمة تحصيل وسند قبض (توريدات الصقر)
    html = `<div class="page saqr-page">
      ${voucher.status === 'CANCELLED' ? '<div class="watermark">ملغى</div>' : ''}
      <header class="saqr-head">
        <div class="saqr-brand-ar">
          <div class="co-ar">${esc(issuer.name_ar || 'شركة توريدات الصقر لقطع غيار السيارات')}</div>
          <div class="tiny">${esc(issuer.district ? `${issuer.city || 'جدة'} - حي ${issuer.district}` : addressLine(issuer))}</div>
          <div class="tiny">الرقم الضريبي: <span class="ltr">${esc(issuer.tax_number || '311198145500003')}</span></div>
          <div class="tiny">السجل التجاري: <span class="ltr">${esc(issuer.commercial_register || '4030367391')}</span></div>
          ${issuer.phone ? `<div class="tiny">جوال: <span class="ltr">${esc(issuer.phone)}</span></div>` : ''}
        </div>

        <div class="saqr-title-box">
          <div class="saqr-badge-top">Payment Slip / قسيمة تحصيل</div>
          <div class="saqr-badge-main">سند قبض / RECEIPT</div>
        </div>

        <div class="saqr-brand-en">
          <div class="co-en">${esc(issuer.name_en || 'Al-Saqr Auto Parts Supplies Company')}</div>
          <div class="tiny-en">${esc(issuer.district_en || issuer.district || 'Al-Nuzlah Al-Sharqiyah District, Jeddah')}</div>
          <div class="tiny-en">TAX NO.: <span class="ltr">${esc(issuer.tax_number || '311198145500003')}</span></div>
          <div class="tiny-en">Commercial Record No: <span class="ltr">${esc(issuer.commercial_register || '4030367391')}</span></div>
          ${issuer.phone ? `<div class="tiny-en">PHONE: <span class="ltr">${esc(issuer.phone)}</span></div>` : ''}
        </div>
      </header>

      <div class="saqr-kpi-grid">
        <div class="saqr-kpi">
          <div class="kpi-lbl">المبلغ المحصل</div>
          <div class="kpi-val num big">${money(voucher.total_amount)}</div>
        </div>
        <div class="saqr-kpi">
          <div class="kpi-lbl">رقم السند</div>
          <div class="kpi-val ltr"><b>${esc(voucher.voucher_number)}</b></div>
        </div>
        <div class="saqr-kpi">
          <div class="kpi-lbl">تاريخ السند</div>
          <div class="kpi-val">${esc(dateAr(voucher.voucher_date))}</div>
        </div>
        <div class="saqr-kpi client-kpi">
          <div class="kpi-lbl">العميل</div>
          <div class="kpi-val"><b>${esc(client.name)}</b></div>
        </div>
      </div>

      <div class="saqr-tafqeet-card">
        فقط مبلغ وقدره ${esc(tafqeet(voucher.total_amount, cur))}
      </div>

      <div class="saqr-section-title">بيان السند</div>
      <table class="saqr-statement-tbl">
        <tr>
          <td class="lbl">استلمنا من</td>
          <td class="val"><b>${esc(client.name)}</b></td>
          <td class="lbl">العملة</td>
          <td class="val">${curSym}</td>
        </tr>
        <tr>
          <td class="lbl">المبلغ</td>
          <td class="val num"><b>${money(voucher.total_amount)}</b></td>
          <td class="lbl">ملاحظات السند</td>
          <td class="val">${esc(voucher.notes || 'سداد فواتير')}</td>
        </tr>
      </table>

      ${allocs ? `
      <div class="alloc-box">
        <div class="saqr-section-title" style="margin-top:3mm">الفواتير المسددة بهذا السند</div>
        <table class="items"><thead><tr>
          <th class="c" style="width:22px">#</th><th>رقم الفاتورة</th><th style="width:70px">تاريخها</th>
          <th class="e" style="width:80px">إجمالي الفاتورة</th><th class="e" style="width:80px">المسدد من السند</th><th class="e" style="width:80px">المتبقي بعد السداد</th>
        </tr></thead><tbody>${allocs}</tbody>
        <tfoot><tr><td colspan="4" class="e">إجمالي الموزّع</td><td class="e num"><b>${money(voucher.allocated_amount)}</b></td>
          <td class="e num">${voucher.unallocated ? `غير موزّع: ${money(voucher.unallocated)}` : ''}</td></tr></tfoot></table>
      </div>` : ''}

      <div class="saqr-sig-zone">
        <div class="saqr-sig">
          <div class="sig-title">الصندوق</div>
          <div class="sig-dots">............................</div>
        </div>
        <div class="saqr-sig">
          <div class="sig-title">توقيع المحاسب</div>
          <div class="sig-dots">............................</div>
        </div>
        <div class="saqr-sig">
          <div class="sig-title">توقيع وختم</div>
          <div class="sig-dots">............................</div>
        </div>
      </div>

      <footer class="saqr-footer">
        <div>${esc(issuer.district ? `${issuer.city || 'جدة'} - حي ${issuer.district} - ` : `${addressLine(issuer)} - `)}</div>
        <div class="ltr">GPJ | RECEIPT CARD</div>
      </footer>
    </div>`;

    css = `
      html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: ${FONT}; }
      .page.saqr-page { width: 210mm; min-height: 148mm; padding: 9mm; position: relative; box-sizing: border-box; color: #0f172a; }
      .watermark { position: absolute; inset: 0; display: grid; place-items: center; font-size: 80pt; color: rgba(220,38,38,.12); font-weight: 800; transform: rotate(-18deg); pointer-events: none; }
      .saqr-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0284c7; padding-bottom: 3.5mm; margin-bottom: 3.5mm; }
      .saqr-brand-ar { text-align: right; font-size: 8pt; color: #334155; line-height: 1.35; width: 33%; }
      .co-ar { font-size: 11pt; font-weight: 800; color: #0284c7; }
      .saqr-brand-en { text-align: left; font-size: 7.5pt; color: #334155; line-height: 1.35; width: 33%; }
      .co-en { font-size: 9.5pt; font-weight: 800; color: #0284c7; }
      .saqr-title-box { text-align: center; width: 34%; }
      .saqr-badge-top { font-size: 9pt; font-weight: 700; color: #0369a1; background: #e0f2fe; border: 1px solid #7dd3fc; border-radius: 1.5mm; padding: 1mm 2mm; margin-bottom: 1.5mm; }
      .saqr-badge-main { font-size: 13pt; font-weight: 900; color: #0284c7; }
      .saqr-kpi-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1.5fr; gap: 2.5mm; margin-bottom: 3.5mm; }
      .saqr-kpi { border: 1px solid #cbd5e1; border-radius: 2mm; padding: 2mm 2.5mm; background: #f8fafc; text-align: center; }
      .kpi-lbl { font-size: 7.5pt; color: #64748b; margin-bottom: 1mm; }
      .kpi-val { font-size: 9.5pt; color: #0f172a; }
      .kpi-val.big { font-size: 12.5pt; font-weight: 900; color: #0284c7; }
      .saqr-tafqeet-card { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 1.5mm; padding: 2mm 3mm; font-size: 9pt; color: #0369a1; font-weight: 600; text-align: center; margin-bottom: 3mm; }
      .saqr-section-title { font-size: 9.5pt; font-weight: 800; color: #0284c7; margin-bottom: 1.5mm; border-bottom: 1px solid #e0f2fe; padding-bottom: 1mm; }
      table.saqr-statement-tbl { width: 100%; border-collapse: collapse; font-size: 8.8pt; margin-bottom: 3.5mm; }
      table.saqr-statement-tbl td { border: 1px solid #cbd5e1; padding: 2mm 2.5mm; }
      table.saqr-statement-tbl td.lbl { background: #f1f5f9; width: 22%; font-weight: 700; color: #475569; }
      table.saqr-statement-tbl td.val { width: 28%; }
      .saqr-sig-zone { display: flex; justify-content: space-between; margin: 8mm 4mm 3mm; }
      .saqr-sig { text-align: center; width: 28%; }
      .sig-title { font-size: 9pt; font-weight: 800; color: #334155; margin-bottom: 3mm; }
      .sig-dots { font-size: 7.5pt; color: #94a3b8; }
      .saqr-footer { display: flex; justify-content: space-between; font-size: 8pt; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 2mm; margin-top: 3mm; }
      table.items { font-size: 8.2pt; border-collapse: collapse; width: 100%; margin-top: 1.5mm; }
      table.items th { background: #0284c7; color: #fff; padding: 1.2mm; border: 1px solid #0369a1; }
      table.items td { border: 1px solid #cbd5e1; padding: 1mm; }
      table.items tfoot td { background: #f1f5f9; font-weight: 700; }
      .c { text-align: center; } .e { text-align: end; }
    `;
  }

  return docShell({
    title: `سند قبض ${voucher.voucher_number}`,
    pageCss: 'size: A4; margin: 0;',
    body: { css, html },
  });
}

// ------------------------------------------------------------ كشف حساب
export function statementPrint({ statement, issuer, client }) {
  const isSar = !issuer || !issuer.currency || issuer.currency === 'SAR' || issuer.currency === 'ر.س' || issuer.currency === '﷼';
  const cur = isSar ? sarSvg({ size: '0.95em' }) : esc(issuer.currency || 'ر.س');
  const periodFrom = statement.period.from ? dateAr(statement.period.from) : 'البداية';
  const periodTo = statement.period.to ? dateAr(statement.period.to) : 'الآن';
  const rows = statement.entries.map((e, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(dateAr(e.transaction_date))}</td>
      <td>${esc(e.doc_type_label)}</td>
      <td class="ltr">${esc(e.doc_number || '')}</td>
      <td class="tiny">${esc(e.issuer_name || '')}</td>
      <td>${esc(e.description || '')}</td>
      <td class="e num">${e.debit ? money(e.debit) : ''}</td>
      <td class="e num">${e.credit ? money(e.credit) : ''}</td>
      <td class="e num"><b>${money(e.balance_after)}</b></td>
    </tr>`).join('');

  const html = `<div class="page">
    <header class="head">
      <div>
        <div class="co">${esc(issuer ? issuer.name_ar : 'كشف حساب موحّد')}</div>
        ${issuer ? `<div class="tiny">${esc(addressLine(issuer))}</div>
          <div class="tiny">${issuer.tax_number ? `الرقم الضريبي: <span class="ltr">${esc(issuer.tax_number)}</span>` : ''}</div>` : '<div class="tiny">يشمل كل الشركات المصدرة</div>'}
      </div>
      <div class="title-box">
        <div class="t1">كشف حساب عميل</div>
        <div class="t2 ltr">STATEMENT OF ACCOUNT</div>
        <div class="tiny">${esc(periodFrom)} — ${esc(periodTo)}</div>
      </div>
    </header>

    <table class="party">
      <tr><td>العميل</td><td><b>${esc(client.name)}</b></td><td>الكود</td><td class="ltr">${esc(client.code || client.client_code || '')}</td></tr>
      <tr><td>الرقم الضريبي</td><td class="ltr">${esc(client.tax_number || '—')}</td><td>الجوال</td><td class="ltr">${esc(client.mobile || '—')}</td></tr>
    </table>

    <table class="items">
      <thead><tr>
        <th class="c" style="width:22px">#</th><th style="width:62px">التاريخ</th><th style="width:60px">النوع</th>
        <th style="width:70px">المستند</th><th style="width:70px">الشركة</th><th>البيان</th>
        <th class="e" style="width:70px">مدين</th><th class="e" style="width:70px">دائن</th><th class="e" style="width:76px">الرصيد</th>
      </tr></thead>
      <tbody>
        <tr class="open"><td colspan="6">الرصيد الافتتاحي في ${esc(periodFrom)}</td>
          <td colspan="2"></td><td class="e num"><b>${money(statement.opening_balance_period)}</b></td></tr>
        ${rows}
      </tbody>
      <tfoot><tr>
        <td colspan="6" class="e">الإجماليات</td>
        <td class="e num">${money(statement.totals.debit)}</td>
        <td class="e num">${money(statement.totals.credit)}</td>
        <td class="e num">${money(statement.totals.closing_balance)}</td>
      </tr></tfoot>
    </table>

    <div class="summary">
      <div class="box"><span>إجمالي المدين (فواتير)</span><b class="num">${money(statement.totals.debit)} ${cur}</b></div>
      <div class="box"><span>إجمالي الدائن (مسدد)</span><b class="num">${money(statement.totals.credit)} ${cur}</b></div>
      <div class="box grand"><span>الرصيد المستحق</span><b class="num">${money(statement.totals.closing_balance)} ${cur}</b></div>
    </div>
    <div class="tiny muted">صدر بتاريخ ${esc(dateAr(new Date().toISOString()))} — هذا الكشف صادر من نظام Raseen.</div>
  </div>`;

  const css = `
    html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: "Segoe UI", Tahoma, "Cairo", Arial, sans-serif; }
    .page { width: 297mm; min-height: 210mm; padding: 9mm; box-sizing: border-box; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #0d9488; padding-bottom: 3mm; }
    .co { font-size: 13pt; font-weight: 800; }
    .tiny { font-size: 7.8pt; }
    .title-box { text-align: center; }
    .t1 { font-size: 14pt; font-weight: 800; color: #0f766e; }
    .t2 { font-size: 8pt; color: #64748b; }
    table.party { margin: 3mm 0; font-size: 9pt; border-collapse: collapse; width: 100%; }
    table.party td { border: 1px solid #cbd5e1; padding: 1.2mm 2mm; }
    table.party td:nth-child(odd) { background: #f1f5f9; width: 24mm; color: #475569; }
    table.items { font-size: 8.4pt; border-collapse: collapse; width: 100%; }
    table.items tr { break-inside: avoid; page-break-inside: avoid; }
    table.items th { background: #0d9488; color: #fff; padding: 1.4mm 1mm; border: 1px solid #0f766e; }
    table.items td { border: 1px solid #cbd5e1; padding: 1.1mm; }
    table.items tbody tr:nth-child(even) { background: #f8fafc; }
    table.items tr.open td { background: #fef3c7; font-weight: 700; }
    table.items tfoot td { background: #f1f5f9; font-weight: 800; }
    .c { text-align: center; } .e { text-align: end; }
    .summary { display: flex; gap: 4mm; margin-top: 4mm; break-inside: avoid; page-break-inside: avoid; }
    .box { flex: 1; border: 1px solid #cbd5e1; border-radius: 2mm; padding: 2.5mm; display: flex; justify-content: space-between; font-size: 9.5pt; }
    .box.grand { background: #0d9488; color: #fff; border-color: #0f766e; font-size: 11pt; }
  `;

  return docShell({
    title: `كشف حساب ${client.name}`,
    pageCss: 'size: A4 landscape; margin: 0;',
    body: { css, html },
  });
}

// ------------------------------------------------------------- تقرير معاينة الدفعة A4
export function bulkPreviewReport({ issuer, client, invoices, summary, options = {}, title = '' }) {
  const isSar = !issuer || !issuer.currency || issuer.currency === 'SAR' || issuer.currency === 'ر.س' || issuer.currency === '﷼';
  const cur = isSar ? sarSvg({ size: '0.95em' }) : esc(issuer.currency || 'SAR');
  const repTitle = title || `تقرير معاينة دفعة فواتير — ${issuer.name_ar}`;

  const rowsHtml = invoices.map((inv, idx) => `<tr>
    <td class="c">${idx + 1}</td>
    <td class="c">${esc(inv.issue_date)}</td>
    <td class="c ltr">${esc(inv.issue_time || '—')}</td>
    <td class="c">${(inv.lines || inv.items || []).length}</td>
    <td>${esc(inv.payment_method === 'CASH' ? 'نقداً' : inv.payment_method === 'CREDIT' ? 'آجل' : inv.payment_method || '—')}</td>
    <td class="e"><span class="num">${money(inv.taxable_amount)}</span></td>
    <td class="e"><span class="num">${money(inv.discount_amount)}</span></td>
    <td class="e"><span class="num">${money(inv.tax_amount)}</span></td>
    <td class="e"><b><span class="num">${money(inv.grand_total)}</span></b></td>
  </tr>`).join('');

  const html = `
    <div class="header">
      <div class="issuer-block">
        <h2>${esc(issuer.name_ar)}</h2>
        <div class="tiny muted">${esc(addressLine(issuer))}</div>
        <div class="tiny">الرقم الضريبي: <span class="num">${esc(issuer.tax_number || '—')}</span></div>
      </div>
      <div class="meta-block">
        <h1 class="title">تقرير معاينة دفعة فواتير</h1>
        <div class="tiny">تاريخ التقرير: <span class="num">${dateAr(new Date().toISOString().slice(0, 10))}</span></div>
        <div class="tiny">العميل: <b>${esc(client ? client.name : '—')}</b> (${esc(client ? client.client_code : '')})</div>
      </div>
    </div>

    <div class="summary-kpis">
      <div class="kpi"><span class="lab">عدد الفواتير</span><b class="num">${num(summary.count)}</b></div>
      <div class="kpi"><span class="lab">قبل الضريبة</span><b class="num">${money(summary.grand_total - summary.tax_total)} ${cur}</b></div>
      <div class="kpi"><span class="lab">إجمالي الخصومات</span><b class="num">${money(summary.discount_total)} ${cur}</b></div>
      <div class="kpi"><span class="lab">إجمالي الضريبة</span><b class="num">${money(summary.tax_total)} ${cur}</b></div>
      <div class="kpi grand"><span class="lab">الإجمالي النهائي</span><b class="num">${money(summary.grand_total)} ${cur}</b></div>
    </div>

    <table class="inv-table">
      <thead>
        <tr>
          <th style="width:30px">#</th>
          <th>التاريخ</th>
          <th>الوقت</th>
          <th>الأصناف</th>
          <th>الدفع</th>
          <th class="e">الوعاء الخاضع</th>
          <th class="e">الخصم</th>
          <th class="e">الضريبة</th>
          <th class="e">الإجمالي (${cur})</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="5"><b>الإجمالي العام (${num(summary.count)} فاتورة)</b></td>
          <td class="e"><b><span class="num">${money(summary.grand_total - summary.tax_total)}</span></b></td>
          <td class="e"><b><span class="num">${money(summary.discount_total)}</span></b></td>
          <td class="e"><b><span class="num">${money(summary.tax_total)}</span></b></td>
          <td class="e"><b><span class="num">${money(summary.grand_total)}</span></b></td>
        </tr>
      </tfoot>
    </table>

    <div class="footer-note">
      * هذه الوثيقة مسودة معاينة ومراجعة داخلية للدفعة قبل الاعتماد النهائي وإصدار الأرقام التسلسلية الرسمية.
    </div>
  `;

  const css = `
    body { font-size: 8.5pt; line-height: 1.35; padding: 6mm 8mm; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f766e; padding-bottom: 3mm; margin-bottom: 4mm; }
    .issuer-block h2 { margin: 0 0 1mm; font-size: 13pt; color: #0f766e; }
    .meta-block { text-align: left; }
    .meta-block .title { font-size: 12pt; margin: 0 0 1.5mm; color: #0f172a; }
    .summary-kpis { display: flex; gap: 3mm; margin-bottom: 4mm; }
    .kpi { flex: 1; border: 1px solid #cbd5e1; border-radius: 1.5mm; padding: 2mm; text-align: center; background: #f8fafc; }
    .kpi .lab { display: block; font-size: 7.5pt; color: #64748b; margin-bottom: 1mm; }
    .kpi.grand { background: #0f766e; color: #fff; border-color: #0f766e; }
    .kpi.grand .lab { color: #ccfbf1; }
    .inv-table { font-size: 8pt; margin-bottom: 4mm; }
    .inv-table th { background: #f1f5f9; border-bottom: 1.5px solid #cbd5e1; padding: 1.5mm 1mm; text-align: right; }
    .inv-table td { border-bottom: 1px solid #e2e8f0; padding: 1.5mm 1mm; }
    .inv-table tfoot td { background: #f8fafc; border-top: 2px solid #cbd5e1; padding: 2mm 1mm; }
    .c { text-align: center; }
    .e { text-align: left; }
    .footer-note { font-size: 7.5pt; color: #64748b; font-style: italic; border-top: 1px dashed #cbd5e1; padding-top: 2mm; }
  `;

  return docShell({
    title: repTitle,
    pageCss: 'size: A4 portrait; margin: 0;',
    body: { css, html },
  });
}

// ------------------------------------------------------- تفقيط المبالغ
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

function under1000(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const o = rest % 10;
      const t = Math.floor(rest / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

function groupWord(n, singular, dual, plural) {
  if (n === 1) return singular;
  if (n === 2) return dual;
  return `${under1000(n)} ${plural}`;
}

/** تفقيط المبلغ بالعربية (ريالات وهللات). */
export function tafqeet(value, currency = 'ر.س') {
  const total = Math.round(Number(value || 0) * 100);
  const riyals = Math.floor(total / 100);
  const halalas = total % 100;
  if (!riyals && !halalas) return `فقط صفر ${currency} لا غير`;

  const chunks = [];
  const millions = Math.floor(riyals / 1000000);
  const thousands = Math.floor((riyals % 1000000) / 1000);
  const units = riyals % 1000;
  if (millions) chunks.push(groupWord(millions, 'مليون', 'مليونان', 'ملايين'));
  if (thousands) chunks.push(groupWord(thousands, 'ألف', 'ألفان', 'آلاف'));
  if (units) chunks.push(under1000(units));

  let text = chunks.filter(Boolean).join(' و');
  const unitName = currency === 'ر.س' || currency === 'SAR' ? 'ريالاً سعودياً' : currency;
  text = `فقط ${text} ${unitName}`;
  if (halalas) text += ` و${under1000(halalas)} هللة`;
  return `${text} لا غير`;
}
