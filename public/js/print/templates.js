// محوّل الأرقام إلى كلمات؛ قوالب الطباعة HTML محفوظة في data/templates.
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
