// ==========================================================================
//  قوالب الطباعة: فاتورة A4، فاتورة حرارية 80mm، سند قبض، كشف حساب.
//  كل قالب مستند HTML كامل بأنماطه الخاصة يُطبع داخل إطار مستقل.
// ==========================================================================
import { esc, money, num, dateAr, qrSvg } from '../core/util.js';

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
    id: 'modern',
    name: 'العصري الأنيق (Modern Clean)',
    desc: 'تصميم مالي حديث ببطاقات ناعمة وهوية بصرية أنيقة وألوان مخصصة تناسب المنشآت والشركات التقنية.',
    badge: 'عصري تقني',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    paper: 'A4',
  },
  {
    id: 'classic',
    name: 'الكلاسيكي المحاسبي (Classic Ledger)',
    desc: 'تصميم تجاري رصين بإطار محاسبي وشبكة جداول متكاملة ومساحات توقيع واعتماد واضحة.',
    badge: 'محاسبي رصين',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>',
    paper: 'A4',
  },
  {
    id: 'executive',
    name: 'الملكي التنفيذي (Executive Gold)',
    desc: 'تصميم تنفيذي فاخر برأسية عريضة وشريط ذهبي ملكي، مثالي للشركات الكبرى والمكاتب الاستشارية.',
    badge: 'تنفيذي فاخر',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>',
    paper: 'A4',
  },
  {
    id: 'minimal',
    name: 'البسيط الهادئ (Minimalist Clean)',
    desc: 'تصميم فائق البساطة بخطوط ناعمة ومساحات مريحة خالية من الحواف الداكنة لطباعة سريعة واقتصادية.',
    badge: 'بسيط واقتصادي',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" x2="2" y1="8" y2="22"/><line x1="17.5" x2="9" y1="15" y2="15"/></svg>',
    paper: 'A4',
  },
  {
    id: 'grid',
    name: 'الهندسي للمشاريع (Project Grid)',
    desc: 'شبكة جداول هندسية كاملة ودقيقة تبرز التفاصيل والكميات، مثالي لقطاعات المقاولات والتوريدات.',
    badge: 'مشاريع ومقاولات',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 3 21 21 3 21 3 3"/><circle cx="9" cy="15" r="2"/></svg>',
    paper: 'A4',
  },
  {
    id: 'compact',
    name: 'المدمج للخدمات (Corporate Compact)',
    desc: 'قالب مكثف وأنيق مخصص لفواتير الخدمات والاستشارات والعقود بأقل استهلاك لمساحة الورق.',
    badge: 'مدمج ومكثف',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="7" x2="17" y1="8" y2="8"/><line x1="7" x2="17" y1="12" y2="12"/><line x1="7" x2="17" y1="16" y2="16"/></svg>',
    paper: 'A4',
  },
  {
    id: 'corporate',
    name: 'المؤسسي الحديث (Clean Corporate)',
    desc: 'تصميم مؤسسي عالي التناسق ببطاقات تفصيلية وشريط محاسبي متزن للشركات الكبرى والمؤسسات.',
    badge: 'مؤسسي متقدم',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>',
    paper: 'A4',
  },
  {
    id: 'rawasi',
    name: 'رواسي (اتصالات وتجزئة)',
    desc: 'شريط ترويسة علوي ملون، بطاقة طريقة الدفع، وصندوق تفقيط مدمج لشبكات التوزيع.',
    badge: 'اتصالات وتجزئة',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>',
    paper: 'A4',
  },
  {
    id: 'ledger',
    name: 'سجل المقاولات (إنشاءات)',
    desc: 'شارة رئيسية داكنة فخمة، حقول المستودع وتاريخ الاستحقاق وتقسيم من/إلى لقطاع المقاولات.',
    badge: 'مقاولات وحديد',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
    paper: 'A4',
  },
  {
    id: 'logistics',
    name: 'التوريدات واللوجستيات (شحن)',
    desc: 'إطار هندسي كامل للصفحة، جداول وخلايا متوازية بلون أزرق ناعم مع بيانات النقل والتوريد.',
    badge: 'لوجستي وتوريد',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24a1.78 1.78 0 0 0-2.5 1.55v12.42a1.78 1.78 0 0 0 2.5 1.55L16.5 14.6a1.78 1.78 0 0 0 0-3.2z"/><path d="M21 4v16"/></svg>',
    paper: 'A4',
  },
  {
    id: 'detailed_address',
    name: 'العنوان الوطني والتوريد',
    desc: 'شبكة العنوان الوطني المفصل (المبنى، الشارع، الحي، الرمز)، جدول دقيق مع إجمالي الكميات.',
    badge: 'عنوان وطني مفصل',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    paper: 'A4',
  },
  {
    id: 're_rawasi_telecom',
    name: 'رواسي ينبع (تقرير re)',
    desc: 'مستخرج من فاتورة مؤسسة رواسي ينبع للاتصالات (DOC-20260904-WA0040.pdf) مع السيريال والفرع.',
    badge: 'عينة re',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>',
    paper: 'A4',
  },
  {
    id: 're_alzahraani_contracting',
    name: 'الزهراني والمجد (تقرير re)',
    desc: 'مستخرج من فاتورة الزهراني والمجد رقم 5295 مع مستودع خميس مشيط وأمر الشراء وتاريخ الاستحقاق.',
    badge: 'عينة re',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/></svg>',
    paper: 'A4',
  },
  {
    id: 're_awtad_albadr',
    name: 'أوتاد البدر والحرة (تقرير re)',
    desc: 'مستخرج من فاتورة شركة أوتاد البدر رقم 5548 مع أصناف التوريد الفندقي وبوليصة الشحن.',
    badge: 'عينة re',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>',
    paper: 'A4',
  },
  {
    id: 're_mowjat_taradud',
    name: 'موجة تردد والإصدار الفاخر (تقرير re)',
    desc: 'مستخرج من فاتورة محل موجة تردد رقم 10144 مع أجهزة سامسونج الذكية وفترة الضمان.',
    badge: 'عينة re',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m10 15 5-3-5-3v6z"/></svg>',
    paper: 'A4',
  },
  {
    id: 're_tarkeeb_contracting',
    name: 'تركيب والكثيري (تقرير re)',
    desc: 'مستخرج من فاتورة مؤسسة تركيب رقم 5963 مع دهانات كابلات ومواد عزل المقاولات ومواصفة SASO.',
    badge: 'عينة re',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4 22h16a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><path d="M4 14h6"/><path d="M4 18h4"/></svg>',
    paper: 'A4',
  },
  {
    id: 're_ruwad_alittihad',
    name: 'رواد الاتحاد (تقرير re)',
    desc: 'مستخرج من فاتورة مؤسسة رواد الاتحاد رقم 4523 مع العنوان الوطني السداسي الكامل ومجموع الكميات.',
    badge: 'عينة re',
    category: 'a4',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    paper: 'A4',
  },
];

// ------------------------------------------------------------- فاتورة A4
export function invoiceA4({ invoice, issuer, client, copies = 1, printSettings = null, qrSettings = null, autoPrint = true }) {
  const qrCfg = qrSettings || (typeof issuer.qr_settings === 'string' ? JSON.parse(issuer.qr_settings || '{}') : (issuer.qr_settings || {}));
  const printCfg = printSettings || (typeof issuer.print_settings === 'string' ? JSON.parse(issuer.print_settings || '{}') : (issuer.print_settings || {}));

  const brandColor = printCfg.primary_color || '#0d9488';
  const brandDark = printCfg.dark_color || (brandColor === '#0d9488' ? '#0f766e' : brandColor);
  const brandLight = printCfg.light_color || '#f0fdfa';
  const tplStyle = printCfg.template_style || 'standard';
  const fontFamily = printCfg.font_family ? `"${printCfg.font_family}", ${FONT}` : FONT;
  const fontSize = printCfg.font_size === 'compact' ? '8pt' : printCfg.font_size === 'large' ? '9.2pt' : '8.4pt';

  const showItemCode = printCfg.show_item_code !== false;
  const showUnit = printCfg.show_unit !== false;
  const showDiscount = printCfg.show_discount !== false;
  const showTaxable = printCfg.show_taxable !== false;
  const showTaxRate = printCfg.show_tax_rate !== false;
  const showTaxAmount = printCfg.show_tax_amount !== false;
  const showBank = printCfg.show_bank !== false;
  const showTafqeet = printCfg.show_tafqeet !== false;
  const showSignatures = printCfg.show_signatures !== false;
  const showNotes = printCfg.show_notes !== false;
  const stripedRows = printCfg.striped_rows !== false;
  const logoPos = printCfg.logo_position || 'right';
  const logoSize = printCfg.logo_size || 'medium';
  const logoWidth = logoSize === 'small' ? '20mm' : logoSize === 'large' ? '38mm' : '26mm';
  const logoHeight = logoSize === 'small' ? '16mm' : logoSize === 'large' ? '28mm' : '20mm';

  const showQr = qrCfg.show_a4 !== false;
  const qrScale = qrCfg.scale || (qrCfg.size === 'large' ? 5 : qrCfg.size === 'small' ? 3 : 4);
  const qr = showQr ? qrSvg(invoice.qr_payload, { scale: qrScale, margin: 1 }) : '';
  const cur = invoice.currency === 'SAR' ? 'ر.س' : invoice.currency;
  const isCancelled = invoice.status === 'CANCELLED';

  const sellerName = invoice.seller_name || issuer.name_ar;
  const sellerTax = invoice.seller_tax_number || issuer.tax_number;
  const sellerCr = invoice.seller_cr || issuer.commercial_register;
  const sellerAddr = invoice.seller_address || addressLine(issuer);

  const buyerName = invoice.buyer_name || client.name;
  const buyerTax = invoice.buyer_tax_number || client.tax_number;
  const buyerAddr = invoice.buyer_address || client.address || client.city || '—';

  const taxGroups = new Map();
  for (const l of invoice.lines) {
    const key = String(l.tax_rate);
    const g = taxGroups.get(key) || { rate: l.tax_rate, taxable: 0, tax: 0 };
    g.taxable += l.taxable;
    g.tax += l.tax_amount;
    taxGroups.set(key, g);
  }

  const linesHtml = invoice.lines.map((l, idx) => `<tr>
      <td class="c">${idx + 1}</td>
      <td>${esc(l.item_name)}${showItemCode && l.item_code ? `<div class="tiny muted ltr">${esc(l.item_code)}</div>` : ''}</td>
      ${showUnit ? `<td class="c">${esc(l.unit || '')}</td>` : ''}
      <td class="e"><span class="num">${num(l.quantity)}</span></td>
      <td class="e"><span class="num">${money(l.unit_price)}</span></td>
      ${showDiscount ? `<td class="e"><span class="num">${money(l.discount)}</span></td>` : ''}
      ${showTaxable ? `<td class="e"><span class="num">${money(l.taxable)}</span></td>` : ''}
      ${showTaxRate ? `<td class="c"><span class="num">${num(l.tax_rate)}%</span></td>` : ''}
      ${showTaxAmount ? `<td class="e"><span class="num">${money(l.tax_amount)}</span></td>` : ''}
      <td class="e"><b class="num">${money(l.total_line)}</b></td>
    </tr>`).join('');

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
    ? `<img class="logo" src="${esc(issuer.logo_data)}" alt="" style="max-width:${logoWidth};max-height:${logoHeight};" />`
    : logoFallback);

  const one = `
  <div class="page"${tplStyle && tplStyle !== 'standard' ? ` data-tpl="${esc(tplStyle)}"` : ''}>
    ${isCancelled ? '<div class="watermark">ملغاة</div>' : ''}
    <header class="head">
      <div class="brand brand-${esc(logoPos)}">
        ${logoHtml}
        <div>
          <div class="co">${esc(sellerName)}</div>
          ${issuer.name_en ? `<div class="co-en ltr">${esc(issuer.name_en)}</div>` : ''}
          <div class="tiny">${esc(sellerAddr)}</div>
          <div class="tiny">
            ${issuer.phone ? `هاتف: <span class="ltr">${esc(issuer.phone)}</span> ` : ''}
            ${issuer.email ? `— ${esc(issuer.email)}` : ''}
          </div>
          <div class="tiny">
            ${sellerTax ? `الرقم الضريبي: <b class="ltr">${esc(sellerTax)}</b>` : ''}
            ${sellerCr ? ` — س.ت: <span class="ltr">${esc(sellerCr)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="title-box">
        <div class="t1">فاتورة ضريبية</div>
        <div class="t2 ltr">TAX INVOICE</div>
        <table class="meta">
          <tr><td>رقم الفاتورة</td><td class="ltr"><b>${esc(invoice.invoice_number)}</b></td></tr>
          <tr><td>التاريخ</td><td>${esc(dateAr(invoice.issue_date))}</td></tr>
          <tr><td>الوقت</td><td class="ltr">${esc(invoice.issue_time)}</td></tr>
          <tr><td>طريقة الدفع</td><td>${esc(invoice.payment_label || '')}</td></tr>
        </table>
      </div>
    </header>

    <section class="parties">
      <div class="party">
        <div class="party-h">بيانات العميل / المشتري</div>
        <table class="kv">
          <tr><td>الاسم</td><td><b>${esc(buyerName)}</b></td></tr>
          <tr><td>الرقم الضريبي</td><td class="ltr">${esc(buyerTax || '—')}</td></tr>
          <tr><td>العنوان</td><td>${esc(buyerAddr)}</td></tr>
          <tr><td>الجوال</td><td class="ltr">${esc(client.mobile || client.phone || '—')}</td></tr>
        </table>
      </div>
      <div class="party">
        <div class="party-h">بيانات المستند</div>
        <table class="kv">
          <tr><td>نوع الفاتورة</td><td>${invoice.invoice_type === 'SIMPLIFIED' ? 'فاتورة ضريبية مبسطة' : 'فاتورة ضريبية'}</td></tr>
          <tr><td>المعرّف الفريد</td><td class="ltr tiny">${esc(invoice.uuid)}</td></tr>
          <tr><td>التسلسل</td><td class="ltr">${esc(String(invoice.sequence_no))}</td></tr>
          <tr><td>الحالة</td><td>${esc(invoice.status_label || invoice.status)}</td></tr>
        </table>
      </div>
    </section>

    <table class="items ${stripedRows ? 'striped' : ''}">
      <thead><tr>
        <th class="c" style="width:26px">#</th>
        <th>الصنف / الوصف</th>
        ${showUnit ? '<th class="c" style="width:48px">الوحدة</th>' : ''}
        <th class="e" style="width:52px">الكمية</th>
        <th class="e" style="width:70px">السعر</th>
        ${showDiscount ? '<th class="e" style="width:58px">الخصم</th>' : ''}
        ${showTaxable ? '<th class="e" style="width:78px">الإجمالي قبل الضريبة</th>' : ''}
        ${showTaxRate ? '<th class="c" style="width:42px">الضريبة</th>' : ''}
        ${showTaxAmount ? '<th class="e" style="width:70px">قيمة الضريبة</th>' : ''}
        <th class="e" style="width:84px">الإجمالي</th>
      </tr></thead>
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
          <tr><td>الإجمالي قبل الخصم</td><td class="e num">${money(invoice.subtotal)}</td></tr>
          <tr><td>الخصم</td><td class="e num">${money(invoice.discount_amount)}</td></tr>
          <tr><td>الإجمالي الخاضع للضريبة</td><td class="e num">${money(invoice.taxable_amount)}</td></tr>
          ${Array.from(taxGroups.values()).map((g) => `<tr><td>ضريبة القيمة المضافة (${num(g.rate)}%)</td><td class="e num">${money(g.tax)}</td></tr>`).join('')}
          <tr class="grand"><td>الإجمالي المستحق (${esc(cur)})</td><td class="e num">${money(invoice.grand_total)}</td></tr>
          <tr><td>المسدد</td><td class="e num">${money(invoice.paid_amount)}</td></tr>
          <tr class="rem"><td>المتبقي</td><td class="e num">${money(invoice.remaining_amount)}</td></tr>
        </table>
        ${showTafqeet ? `<div class="words">${esc(tafqeet(invoice.grand_total, cur))}</div>` : ''}
      </div>
    </section>

    <footer class="foot">
      <div>${esc(issuer.footer_notes || 'شكراً لتعاملكم معنا')}</div>
      ${showSignatures ? `<div class="sig">
        <div>توقيع المستلم: ................................</div>
        <div style="border:1.5px dashed #cbd5e1;border-radius:50%;width:22mm;height:22mm;display:grid;place-items:center;font-size:7pt;color:#64748b;margin:0 auto">ختم المنشأة</div>
        <div>عن ${esc(sellerName)}: ................................</div>
      </div>` : ''}
      <div class="tiny muted c">
        ${invoice.zatca_phase === 'PHASE2' || (invoice.signature_mode && invoice.signature_mode !== 'NONE')
      ? `فاتورة إلكترونية معتمدة — المرحلة الثانية (الربط والتكامل المشفر) — بصمة الفاتورة: <span class="ltr">${esc(String(invoice.invoice_hash).slice(0, 32))}…</span>`
      : 'فاتورة إلكترونية — المرحلة الأولى (رمز QR بالحقول الخمسة الأساسية)'}
      </div>
    </footer>
  </div>`;

  const css = `
    html, body { font-family: ${fontFamily}; font-size: ${fontSize}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 210mm; min-height: 297mm; padding: 10mm 9mm; position: relative; page-break-after: always; box-sizing: border-box; }
    .page:last-child { page-break-after: auto; }
    .watermark { position: absolute; inset: 0; display: grid; place-items: center; font-size: 90pt; color: rgba(220,38,38,.13); font-weight: 800; transform: rotate(-20deg); pointer-events: none; z-index: 0; }
    .head { display: flex; gap: 8mm; justify-content: space-between; border-bottom: 2px solid ${brandColor}; padding-bottom: 4mm; }
    .brand { display: flex; gap: 4mm; align-items: flex-start; }
    .logo { object-fit: contain; }
    .logo-fallback { border-radius: 2.5mm; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; vertical-align: middle; background: transparent; }
    .co { font-size: 14pt; font-weight: 800; color: #0f172a; }
    .co-en { font-size: 9pt; color: #475569; }
    .tiny { font-size: 7.6pt; line-height: 1.5; }
    .title-box { text-align: center; min-width: 62mm; }
    .t1 { font-size: 13pt; font-weight: 800; color: ${brandDark}; }
    .t2 { font-size: 8pt; letter-spacing: .08em; color: #64748b; margin-bottom: 2mm; }
    table.meta { font-size: 8pt; border-collapse: collapse; width: 100%; }
    table.meta td { border: 1px solid #cbd5e1; padding: 1mm 2mm; }
    table.meta td:first-child { background: #f1f5f9; color: #475569; white-space: nowrap; }
    .parties { display: flex; gap: 4mm; margin: 4mm 0; }
    .party { flex: 1; border: 1px solid #cbd5e1; border-radius: 2mm; overflow: hidden; }
    .party-h { background: #f1f5f9; padding: 1.4mm 2mm; font-size: 8.5pt; font-weight: 700; border-bottom: 1px solid #cbd5e1; }
    table.kv { font-size: 8.4pt; border-collapse: collapse; width: 100%; }
    table.kv td { padding: 1mm 2mm; border-bottom: 1px solid #eef2f7; }
    table.kv td:first-child { color: #64748b; width: 26mm; }
    table.items { font-size: 8.4pt; margin-top: 2mm; border-collapse: collapse; width: 100%; }
    table.items thead tr { break-inside: avoid; page-break-inside: avoid; }
    table.items th { background: ${brandColor}; color: #fff; padding: 1.6mm 1mm; font-size: 7.8pt; border: 1px solid ${brandDark}; }
    table.items td { border: 1px solid #cbd5e1; padding: 1.3mm 1mm; vertical-align: top; }
    table.items tr { break-inside: avoid; page-break-inside: avoid; }
    table.items.striped tbody tr:nth-child(even) { background: #f8fafc; }
    .c { text-align: center; } .e { text-align: end; }
    .bottom { display: flex; gap: 4mm; margin-top: 4mm; align-items: flex-start; break-inside: avoid; page-break-inside: avoid; }
    .left-col { flex: 1; }
    .right-col { width: 84mm; }
    .qr { text-align: center; }
    .qr svg { width: 30mm; height: 30mm; }
    .notes { margin-top: 3mm; }
    .note { font-size: 8pt; border-inline-start: 2px solid ${brandColor}; padding-inline-start: 2mm; margin-bottom: 1.5mm; }
    table.totals { font-size: 9pt; border-collapse: collapse; width: 100%; }
    table.totals td { padding: 1.3mm 2mm; border-bottom: 1px solid #e2e8f0; }
    table.totals tr.grand td { background: ${brandColor}; color: #fff; font-size: 11pt; font-weight: 800; border: 0; }
    table.totals tr.rem td { font-weight: 700; color: #b91c1c; }
    .words { margin-top: 2mm; font-size: 8.4pt; background: #f1f5f9; padding: 1.6mm 2mm; border-radius: 1.5mm; }
    .foot { margin-top: 5mm; border-top: 1px solid #cbd5e1; padding-top: 2.5mm; font-size: 8.4pt; }
    .sig { display: flex; justify-content: space-between; margin: 6mm 0 2mm; font-size: 8.4pt; }

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
  const cur = invoice.currency === 'SAR' ? 'ر.س' : invoice.currency;

  const sellerName = invoice.seller_name || issuer.name_ar;
  const sellerTax = invoice.seller_tax_number || issuer.tax_number;
  const sellerAddr = invoice.seller_address || addressLine(issuer);
  const buyerName = invoice.buyer_name || client.name;
  const buyerTax = invoice.buyer_tax_number || client.tax_number;

  const lines = invoice.lines.map((l) => `<tr>
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
      <tr class="g"><td>الإجمالي (${esc(cur)})</td><td class="e">${money(invoice.grand_total)}</td></tr>
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
export function voucherPrint({ voucher, issuer, client }) {
  const cur = voucher.currency === 'SAR' ? 'ر.س' : (voucher.currency || 'ر.س');
  const allocs = (voucher.allocations || []).map((a, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="ltr">${esc(a.invoice_number)}</td>
      <td>${esc(dateAr(a.issue_date))}</td>
      <td class="e num">${money(a.invoice_total)}</td>
      <td class="e num"><b>${money(a.allocated_amount)}</b></td>
      <td class="e num">${money(a.invoice_remaining)}</td>
    </tr>`).join('');

  const html = `<div class="page">
    ${voucher.status === 'CANCELLED' ? '<div class="watermark">ملغى</div>' : ''}
    <header class="head">
      <div class="brand">
        ${issuer.logo_data ? `<img class="logo" src="${esc(issuer.logo_data)}" alt="" />` : ''}
        <div>
          <div class="co">${esc(issuer.name_ar)}</div>
          <div class="tiny">${esc(addressLine(issuer))}</div>
          <div class="tiny">${issuer.tax_number ? `الرقم الضريبي: <span class="ltr">${esc(issuer.tax_number)}</span>` : ''}</div>
        </div>
      </div>
      <div class="title-box">
        <div class="t1">سند قبض</div>
        <div class="t2 ltr">RECEIPT VOUCHER</div>
        <table class="meta">
          <tr><td>رقم السند</td><td class="ltr"><b>${esc(voucher.voucher_number)}</b></td></tr>
          <tr><td>التاريخ</td><td>${esc(dateAr(voucher.voucher_date))}</td></tr>
        </table>
      </div>
    </header>

    <div class="amount-box">
      <div>استلمنا من السيد / السادة: <b>${esc(client.name)}</b></div>
      <div class="big">مبلغاً وقدره: <span class="num">${money(voucher.total_amount)}</span> ${esc(cur)}</div>
      <div>${esc(tafqeet(voucher.total_amount, cur))}</div>
      <div>وذلك عن: ${esc(voucher.notes || 'سداد فواتير')}</div>
      <div>طريقة السداد: <b>${esc(voucher.payment_label || voucher.payment_type)}</b>
        ${voucher.reference_no ? ` — المرجع: <span class="ltr">${esc(voucher.reference_no)}</span>` : ''}
        ${voucher.bank_name ? ` — ${esc(voucher.bank_name)}` : ''}</div>
    </div>

    ${allocs ? `<h4>الفواتير المسددة بهذا السند</h4>
    <table class="items"><thead><tr>
      <th class="c" style="width:22px">#</th><th>رقم الفاتورة</th><th style="width:70px">تاريخها</th>
      <th class="e" style="width:80px">إجمالي الفاتورة</th><th class="e" style="width:80px">المسدد من السند</th><th class="e" style="width:80px">المتبقي بعد السداد</th>
    </tr></thead><tbody>${allocs}</tbody>
    <tfoot><tr><td colspan="4" class="e">إجمالي الموزّع</td><td class="e num"><b>${money(voucher.allocated_amount)}</b></td>
      <td class="e num">${voucher.unallocated ? `غير موزّع: ${money(voucher.unallocated)}` : ''}</td></tr></tfoot></table>` : ''}

    <div class="sig">
      <div>المستلم: ................................</div>
      <div style="border:1.5px dashed #cbd5e1;border-radius:50%;width:22mm;height:22mm;display:grid;place-items:center;font-size:7pt;color:#64748b;margin:0 auto">ختم الخزينة</div>
      <div>أمين الصندوق: ................................</div>
      <div>المحاسب: ................................</div>
    </div>
    <div class="tiny muted c">${esc(issuer.footer_notes || '')}</div>
  </div>`;

  const css = `
    html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: "Segoe UI", Tahoma, "Cairo", Arial, sans-serif; }
    .page { width: 210mm; min-height: 148mm; padding: 10mm; position: relative; box-sizing: border-box; }
    .watermark { position: absolute; inset: 0; display: grid; place-items: center; font-size: 80pt; color: rgba(220,38,38,.12); font-weight: 800; transform: rotate(-18deg); pointer-events: none; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #0d9488; padding-bottom: 4mm; }
    .brand { display: flex; gap: 4mm; }
    .logo { max-width: 24mm; max-height: 18mm; object-fit: contain; }
    .co { font-size: 13pt; font-weight: 800; }
    .tiny { font-size: 7.8pt; }
    .title-box { text-align: center; }
    .t1 { font-size: 15pt; font-weight: 800; color: #0f766e; }
    .t2 { font-size: 8pt; color: #64748b; margin-bottom: 2mm; }
    table.meta { font-size: 8.5pt; border-collapse: collapse; }
    table.meta td { border: 1px solid #cbd5e1; padding: 1mm 2mm; }
    table.meta td:first-child { background: #f1f5f9; }
    .amount-box { margin: 5mm 0; border: 1px solid #cbd5e1; border-radius: 2mm; padding: 4mm; font-size: 10pt; line-height: 2; background: #fafafa; }
    .amount-box .big { font-size: 13pt; font-weight: 800; color: #0f766e; }
    h4 { margin: 4mm 0 1.5mm; font-size: 10pt; }
    table.items { font-size: 8.6pt; border-collapse: collapse; width: 100%; }
    table.items tr { break-inside: avoid; page-break-inside: avoid; }
    table.items th { background: #0d9488; color: #fff; padding: 1.4mm; border: 1px solid #0f766e; }
    table.items td { border: 1px solid #cbd5e1; padding: 1.2mm; }
    table.items tfoot td { background: #f1f5f9; font-weight: 700; }
    .c { text-align: center; } .e { text-align: end; }
    .sig { display: flex; justify-content: space-between; align-items: center; margin: 12mm 0 4mm; font-size: 9pt; }
  `;

  return docShell({
    title: `سند قبض ${voucher.voucher_number}`,
    pageCss: 'size: A4; margin: 0;',
    body: { css, html },
  });
}

// ------------------------------------------------------------ كشف حساب
export function statementPrint({ statement, issuer, client }) {
  const cur = 'ر.س';
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
  const cur = issuer.currency === 'SAR' ? 'ر.س' : issuer.currency;
  const repTitle = title || `تقرير معاينة دفعة فواتير — ${issuer.name_ar}`;

  const rowsHtml = invoices.map((inv, idx) => `<tr>
    <td class="c">${idx + 1}</td>
    <td class="c">${esc(inv.issue_date)}</td>
    <td class="c ltr">${esc(inv.issue_time || '—')}</td>
    <td class="c">${inv.lines.length}</td>
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
