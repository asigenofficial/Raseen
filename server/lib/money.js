'use strict';
/**
 * التعامل مع المبالغ المالية.
 *
 * قرار هندسي: تُخزَّن كل المبالغ في قاعدة البيانات كأعداد صحيحة بالهللات
 * (minor units = 1/100) لمنع أخطاء الفاصلة العائمة في الجمع والضرب والموازنة،
 * ويتم التحويل إلى/من الأرقام العشرية على حدود الـ API فقط.
 */

const MINOR = 100;

/** تحويل قيمة عشرية (ريال) إلى هللات صحيحة. */
function toMinor(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  // Math.round على قيمة مقربة أولاً لتجنب 1.005 * 100 = 100.49999
  return Math.round(Number((n * MINOR).toFixed(4)));
}

/** تحويل الهللات إلى رقم عشري بمنزلتين. */
function toMajor(minor) {
  const n = Number(minor || 0);
  return Math.round(n) / MINOR;
}

/** تنسيق نصي بمنزلتين عشريتين. */
function fmt(minor) {
  return toMajor(minor).toFixed(2);
}

/** ضرب كمية (عشرية) في سعر بالهللات -> هللات صحيحة. */
function mulQty(quantityMajor, unitPriceMinor) {
  const q = Number(quantityMajor || 0);
  return Math.round(q * Number(unitPriceMinor || 0));
}

/** حساب نسبة مئوية من مبلغ بالهللات. */
function pct(amountMinor, ratePercent) {
  const r = Number(ratePercent || 0);
  return Math.round((Number(amountMinor || 0) * r) / 100);
}

/** استخراج المبلغ الصافي من مبلغ شامل للضريبة: net = incl / (1 + r/100). */
function netFromInclusive(inclusiveMinor, ratePercent) {
  const r = Number(ratePercent || 0);
  if (r <= 0) return Math.round(Number(inclusiveMinor || 0));
  return Math.round(Number(inclusiveMinor || 0) / (1 + r / 100));
}

function sum(list) {
  let t = 0;
  for (const v of list) t += Number(v || 0);
  return Math.round(t);
}

function clampMin(value, min) {
  return value < min ? min : value;
}

module.exports = { MINOR, toMinor, toMajor, fmt, mulQty, pct, netFromInclusive, sum, clampMin };
