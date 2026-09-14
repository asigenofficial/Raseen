'use strict';
/**
 * محرك التوليد الدفعي الذكي (Smart Bulk Invoice Generator).
 *
 * المبدأ: توليد دفعة فواتير متنوعة تنويعاً واقعياً (أصناف، كميات، أسعار، تواريخ، أوقات)
 * مع القدرة على مطابقة ميزانية إجمالية محددة بدقة الهللة، ثم عرضها للمعاينة قبل الاعتماد.
 *
 * كل المبالغ داخلياً بالهللات (أعداد صحيحة).
 */
const db = require('../db');
const config = require('../config');
const V = require('../lib/validate');
const M = require('../lib/money');
const invoicesSvc = require('./invoices');
const issuersSvc = require('./issuers');
const vouchersSvc = require('./vouchers');
const { uuid } = require('../lib/ids');

// ------------------------------------------------------------ مولد عشوائي بمِفتاح
/** mulberry32 — مولد عشوائي حتمي حتى تكون النتائج قابلة للتكرار بنفس المفتاح. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;
const randFloat = (rng, min, max) => rng() * (max - min) + min;

function pickWeighted(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/** خلط قائمة (Fisher-Yates). */
function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------ التواريخ والأوقات
function dayList(from, to) {
  const days = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (end < start) throw V.bad('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
  const oneDay = 86400000;
  for (let t = start.getTime(); t <= end.getTime(); t += oneDay) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  if (days.length > 4000) throw V.bad('النطاق الزمني كبير جداً');
  return days;
}

/**
 * توزيع الفواتير على النطاق الزمني بأوقات واقعية:
 * - توزيع شبه منتظم على الأيام مع تفاوت عشوائي
 * - أوقات داخل ساعات العمل ولا تتكرر، مع فاصل لا يقل عن 4 دقائق في نفس اليوم
 * - إمكانية استثناء أيام الجمعة/السبت
 */
function distributeTimestamps(rng, count, opts) {
  const days = dayList(opts.date_from, opts.date_to).filter((d) => {
    if (!opts.skip_weekend) return true;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); // 5=الجمعة, 6=السبت
    return dow !== 5 && dow !== 6;
  });
  if (!days.length) throw V.bad('لا توجد أيام عمل متاحة في النطاق الزمني المحدد');

  // عدد الفواتير لكل يوم: توزيع عشوائي متوازن
  const perDay = new Array(days.length).fill(0);
  for (let i = 0; i < count; i++) perDay[Math.floor(rng() * days.length)] += 1;

  const startMin = opts.work_start_minutes;
  const endMin = opts.work_end_minutes;
  const stamps = [];
  for (let d = 0; d < days.length; d++) {
    const n = perDay[d];
    if (!n) continue;
    const span = Math.max(endMin - startMin, 1);
    const used = new Set();
    for (let k = 0; k < n; k++) {
      let minute;
      let guard = 0;
      do {
        // توزيع داخل اليوم مع ميل خفيف للفترات النشطة
        const slot = Math.floor((k + randFloat(rng, 0.05, 0.95)) * (span / Math.max(n, 1)));
        minute = startMin + Math.min(span - 1, Math.max(0, slot));
        if (used.has(minute)) minute = startMin + randInt(rng, 0, span - 1);
      } while (used.has(minute) && ++guard < 200);
      used.add(minute);
      const seconds = randInt(rng, 0, 59);
      const hh = String(Math.floor(minute / 60)).padStart(2, '0');
      const mm = String(minute % 60).padStart(2, '0');
      const ss = String(seconds).padStart(2, '0');
      stamps.push({ date: days[d], time: `${hh}:${mm}:${ss}` });
    }
  }
  stamps.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  return stamps;
}

// ------------------------------------------------------------ حساب البنود
function lineTotals(line) {
  const gross = M.mulQty(line.quantity, line.unit_price);
  const discount = Math.min(line.discount || 0, gross);
  const taxable = gross - discount;
  const tax = M.pct(taxable, line.tax_rate);
  return { gross, discount, taxable, tax, total: taxable + tax };
}

function invoiceTotals(lines) {
  let subtotal = 0; let discount = 0; let taxable = 0; let tax = 0;
  for (const l of lines) {
    const t = lineTotals(l);
    subtotal += t.gross; discount += t.discount; taxable += t.taxable; tax += t.tax;
  }
  return { subtotal, discount_amount: discount, taxable_amount: taxable, tax_amount: tax, grand_total: taxable + tax };
}

/** الوعاء الضريبي لبند. */
function taxableOf(line) {
  return M.mulQty(line.quantity, line.unit_price) - (line.discount || 0);
}

/** إجمالي البند من وعائه الضريبي (مع تقريب الضريبة كما يُحسب فعلياً). */
function totalFromTaxable(taxable, taxRate) {
  return taxable + M.pct(taxable, taxRate);
}

/**
 * ضبط الوعاء الضريبي لبند على قيمة محددة بدقة الهللة.
 * الأسلوب: رفع سعر الوحدة إلى أقرب قيمة كافية، ثم إغلاق الكسر المتبقي بخصم صغير
 * (أقل من قيمة وحدة واحدة) — ويكون الخصم صفراً تماماً إذا كانت الكمية = 1.
 */
function setLineTaxable(line, taxable) {
  const target = Math.max(0, Math.round(taxable));
  const q = line.quantity;
  const price = Math.max(1, Math.ceil(target / Math.max(q, 0.000001)));
  line.unit_price = price;
  const gross = M.mulQty(q, price);
  line.discount = Math.max(0, Math.min(gross, gross - target));
  return taxableOf(line);
}

/**
 * إغلاق الفارق بدقة الهللة: يجعل إجمالي الفاتورة مساوياً تماماً للقيمة المستهدفة.
 *
 * لماذا نحتاج خوارزمية خاصة؟ لأن ضريبة كل بند تُقرَّب للهللة، فمجموعة الإجماليات
 * الممكنة لبند واحد ليست متصلة (تتخطى بعض القيم). لذلك نستخدم بنداً رئيسياً للضبط
 * الدقيق، وعند تعذر الوصول نُزيح بنداً ثانوياً بهللات قليلة لتغيير التقريب ثم نعيد الحل.
 *
 * @returns {boolean} هل تحقق التطابق التام
 */
function closeGap(lines, targetTotal) {
  if (!lines.length || targetTotal <= 0) return false;

  // البند الرئيسي: الأقل كمية (ليكون الخصم التصحيحي أصغر ما يمكن، وصفراً عند الكمية 1)
  const order = lines
    .map((l, i) => ({ i, q: l.quantity, gross: M.mulQty(l.quantity, l.unit_price) }))
    .sort((a, b) => (a.q === b.q ? b.gross - a.gross : a.q - b.q));
  const primary = lines[order[0].i];
  const secondaries = order.slice(1).map((o) => lines[o.i]);

  const othersTotal = () => {
    let t = 0;
    for (const l of lines) if (l !== primary) t += lineTotals(l).total;
    return t;
  };

  // إذا استهلكت بقية البنود الهدف بالكامل، نُصغّرها نسبياً ليبقى للبند الرئيسي مساحة للضبط
  if (secondaries.length && othersTotal() >= targetTotal * 0.98) {
    const scale = (targetTotal * 0.85) / Math.max(othersTotal(), 1);
    for (const l of secondaries) {
      l.unit_price = Math.max(1, Math.round(l.unit_price * scale));
      l.discount = Math.min(l.discount || 0, M.mulQty(l.quantity, l.unit_price));
    }
  }

  const tryHit = () => {
    const needed = targetTotal - othersTotal();
    if (needed <= 0) return false;
    const rate = primary.tax_rate;
    const estimate = Math.round(needed / (1 + rate / 100));
    for (let d = 0; d <= 6; d++) {
      for (const candidate of d === 0 ? [estimate] : [estimate + d, estimate - d]) {
        if (candidate < 1) continue;
        if (totalFromTaxable(candidate, rate) === needed) {
          setLineTaxable(primary, candidate);
          return invoiceTotals(lines).grand_total === targetTotal;
        }
      }
    }
    return false;
  };

  if (tryHit()) return true;

  // إزاحة بند ثانوي بهللات قليلة لتغيير حدود التقريب ثم إعادة المحاولة
  for (const sec of secondaries) {
    const originalPrice = sec.unit_price;
    const originalDiscount = sec.discount || 0;
    const baseTaxable = taxableOf(sec);
    for (const delta of [-1, 1, -2, 2, -3, 3, -4, 4]) {
      const candidate = baseTaxable + delta;
      if (candidate < 1) continue;
      setLineTaxable(sec, candidate);
      if (tryHit()) return true;
    }
    sec.unit_price = originalPrice;
    sec.discount = originalDiscount;
  }

  // ملاذ أخير: أقرب قيمة ممكنة عبر البند الرئيسي
  const needed = Math.max(1, targetTotal - othersTotal());
  setLineTaxable(primary, Math.max(1, Math.round(needed / (1 + primary.tax_rate / 100))));
  return invoiceTotals(lines).grand_total === targetTotal;
}

// ------------------------------------------------------------ بناء سلة أصناف
function buildBasket(rng, catalog, opts, targetTotal, usageTracker) {
  const maxAvail = Math.min(opts.max_items, catalog.length);
  const minAvail = Math.min(opts.min_items, maxAvail);
  const itemCount = randInt(rng, minAvail, maxAvail);

  let chosen = [];
  if (opts.distribution_mode === 'BALANCED' && usageTracker && catalog.length > 0) {
    // خوارزمية التوزيع المتوازن: نختار الأصناف الأقل ظهوراً حتى الآن لضمان توزيع كل الأصناف
    const scored = catalog.map((item) => {
      const key = item.id || item.name_ar;
      return {
        item,
        key,
        count: usageTracker.get(key) || 0,
        randomVal: rng(),
      };
    });
    // فرز تصاعدي بالأقل استخداماً، مع كسر التعادل عشوائياً
    scored.sort((a, b) => (a.count - b.count) || (a.randomVal - b.randomVal));

    // ضمان اختيار صنف أو أكثر من الأقل استخداماً
    const guaranteedCount = Math.min(itemCount, Math.max(1, Math.ceil(itemCount / 2)));
    chosen = scored.slice(0, guaranteedCount).map((s) => s.item);

    // ملء باقي السلة عشوائياً من باقي الأصناف المتاحة
    if (chosen.length < itemCount) {
      const remainingPool = shuffle(rng, scored.slice(guaranteedCount).map((s) => s.item));
      chosen.push(...remainingPool.slice(0, itemCount - chosen.length));
    }
  } else {
    chosen = shuffle(rng, catalog).slice(0, Math.max(1, itemCount));
  }

  const lines = [];
  let remaining = targetTotal || 0;

  for (let i = 0; i < chosen.length; i++) {
    const item = chosen[i];
    const jitter = opts.price_jitter_percent
      ? 1 + randFloat(rng, -opts.price_jitter_percent, opts.price_jitter_percent) / 100
      : 1;
    let unitPrice = Math.max(1, Math.round(item.sale_price * jitter));
    if (unitPrice <= 0) unitPrice = Math.max(1, item.sale_price || 100);
    const taxRate = item.tax_rate !== undefined ? item.tax_rate : 15;
    let quantity;

    if (targetTotal) {
      const perUnit = Math.max(1, Math.round(unitPrice * (1 + taxRate / 100)));
      const linesLeft = chosen.length - i;
      const share = linesLeft > 0 ? remaining / linesLeft : remaining;
      quantity = Math.round(share / perUnit);
      quantity = Math.min(Math.max(quantity, opts.min_qty), opts.max_qty);
    } else {
      quantity = randInt(rng, opts.min_qty, opts.max_qty);
    }
    if (opts.allow_fraction_qty && rng() < 0.25) {
      quantity = Math.round((quantity + randFloat(rng, -0.4, 0.4)) * 100) / 100;
      if (quantity < 0.1) quantity = 0.5;
    }
    if (!quantity || quantity <= 0) quantity = opts.min_qty;

    let discount = 0;
    if (opts.discount_enabled && rng() < opts.discount_probability) {
      const gross = M.mulQty(quantity, unitPrice);
      discount = M.pct(gross, randFloat(rng, opts.discount_min_percent, opts.discount_max_percent));
    }
    const line = {
      item_id: item.id || null,
      item_code: item.item_code || '',
      item_name: item.name_ar,
      unit: item.unit || 'حبة',
      quantity,
      unit_price: unitPrice,
      discount,
      tax_rate: taxRate,
    };
    lines.push(line);
    remaining -= lineTotals(line).total;
    if (targetTotal && remaining <= 0 && lines.length >= opts.min_items) break;
  }
  return lines;
}

function basketSignature(lines) {
  return lines
    .map((l) => `${l.item_id || l.item_name}:${l.quantity}:${l.unit_price}`)
    .sort()
    .join('|');
}

// ------------------------------------------------------------ المدخلات
function normalizeOptions(payload) {
  const customItemsRaw = V.arr(payload.custom_items, 'الأصناف المخصصة', { max: 1000 });
  const custom_items = customItemsRaw.map((ci, idx) => {
    const field = `الصنف المخصص ${idx + 1}`;
    const name = V.str(ci.name_ar || ci.item_name, `${field} - الاسم`, { required: true, max: 250 });
    const salePriceMajor = V.num(ci.sale_price !== undefined ? ci.sale_price : ci.unit_price, `${field} - السعر`, { required: true, min: 0.0001, max: 1e9 });
    const taxRate = V.num(ci.tax_rate !== undefined ? ci.tax_rate : 15, `${field} - الضريبة`, { min: 0, max: 100, def: 15 });
    return {
      id: V.str(ci.id, `${field} - المعرف`, { max: 40 }) || null,
      item_code: V.str(ci.item_code, `${field} - الكود`, { max: 40 }) || '',
      name_ar: name,
      unit: V.str(ci.unit, `${field} - الوحدة`, { max: 40 }) || 'حبة',
      sale_price: M.toMinor(salePriceMajor),
      tax_rate: taxRate,
    };
  });

  const opts = {
    issuer_id: V.str(payload.issuer_id, 'الشركة المصدرة', { required: true, max: 40 }),
    client_id: V.str(payload.client_id, 'العميل', { required: true, max: 40 }),
    date_from: V.date(payload.date_from, 'من تاريخ', { required: true }),
    date_to: V.date(payload.date_to, 'إلى تاريخ', { required: true }),
    count: V.int(payload.count, 'عدد الفواتير', { min: 0, max: 5000, def: 0 }),
    target_total: M.toMinor(V.num(payload.target_total, 'الميزانية الإجمالية', { min: 0, max: 1e12, def: 0 })),
    category_ids: V.arr(payload.category_ids, 'المجموعات', { max: 200 }).map(String),
    item_ids: V.arr(payload.item_ids, 'الأصناف', { max: 2000 }).map(String),
    custom_items,
    distribution_mode: V.oneOf(payload.distribution_mode, 'طريقة التوزيع', ['BALANCED', 'RANDOM'], 'BALANCED'),
    min_items: V.int(payload.min_items, 'أقل عدد أصناف', { min: 1, max: 100, def: 2 }),
    max_items: V.int(payload.max_items, 'أكثر عدد أصناف', { min: 1, max: 100, def: 6 }),
    min_qty: V.num(payload.min_qty, 'أقل كمية', { min: 0.01, max: 100000, def: 1 }),
    max_qty: V.num(payload.max_qty, 'أكثر كمية', { min: 0.01, max: 100000, def: 20 }),
    min_invoice_total: M.toMinor(V.num(payload.min_invoice_total, 'أقل قيمة فاتورة', { min: 0, max: 1e11, def: 0 })),
    max_invoice_total: M.toMinor(V.num(payload.max_invoice_total, 'أعلى قيمة فاتورة', { min: 0, max: 1e11, def: 0 })),
    discount_enabled: V.bool(payload.discount_enabled, false),
    discount_min_percent: V.num(payload.discount_min_percent, 'أقل نسبة خصم', { min: 0, max: 90, def: 2 }),
    discount_max_percent: V.num(payload.discount_max_percent, 'أعلى نسبة خصم', { min: 0, max: 90, def: 10 }),
    discount_probability: V.num(payload.discount_probability, 'احتمال الخصم', { min: 0, max: 1, def: 0.3 }),
    price_jitter_percent: V.num(payload.price_jitter_percent, 'تفاوت السعر', { min: 0, max: 50, def: 3 }),
    allow_fraction_qty: V.bool(payload.allow_fraction_qty, false),
    skip_weekend: V.bool(payload.skip_weekend, false),
    work_start_minutes: V.int(payload.work_start_minutes, 'بداية العمل', { min: 0, max: 1439, def: 9 * 60 }),
    work_end_minutes: V.int(payload.work_end_minutes, 'نهاية العمل', { min: 1, max: 1439, def: 22 * 60 }),
    payment_methods: V.arr(payload.payment_methods, 'طرق الدفع', { max: 4 })
      .map(String).filter((p) => ['CASH', 'CARD', 'TRANSFER', 'CREDIT'].includes(p)),
    invoice_type: V.oneOf(payload.invoice_type, 'نوع الفاتورة', ['STANDARD', 'SIMPLIFIED'], 'STANDARD'),
    seed: V.int(payload.seed, 'مفتاح التوليد', { min: 0, max: 2 ** 31, def: 0 }) || (Date.now() % 2147483647),
    notes: V.str(payload.notes, 'ملاحظات', { max: 500 }),
  };

  if (opts.custom_items && opts.custom_items.length) {
    if (opts.min_items > opts.custom_items.length) opts.min_items = opts.custom_items.length;
    if (opts.max_items > opts.custom_items.length) opts.max_items = opts.custom_items.length;
  }
  if (opts.min_items > opts.max_items) throw V.bad('أقل عدد أصناف يجب أن يكون أصغر من أو يساوي الأكثر');
  if (opts.min_qty > opts.max_qty) throw V.bad('أقل كمية يجب أن تكون أصغر من أو تساوي الأكثر');
  if (opts.work_start_minutes >= opts.work_end_minutes) throw V.bad('وقت بداية العمل يجب أن يكون قبل وقت النهاية');
  if (opts.max_invoice_total && opts.min_invoice_total && opts.min_invoice_total > opts.max_invoice_total) {
    throw V.bad('أقل قيمة فاتورة يجب أن تكون أصغر من أعلى قيمة');
  }
  if (!opts.count && !opts.target_total) throw V.bad('يجب تحديد عدد الفواتير أو الميزانية الإجمالية (أو كلاهما)');
  if (!opts.payment_methods.length) opts.payment_methods = ['CREDIT'];
  if (opts.discount_min_percent > opts.discount_max_percent) {
    throw V.bad('أقل نسبة خصم يجب أن تكون أصغر من أعلى نسبة');
  }
  return opts;
}

function loadCatalog(opts) {
  if (opts.custom_items && opts.custom_items.length) {
    return opts.custom_items;
  }
  const rows = db.all(
    `SELECT * FROM items
      WHERE is_active = 1 AND sale_price > 0
        AND (:hasCats = 0 OR category_id IN (SELECT value FROM json_each(:cats)))
        AND (:hasItems = 0 OR id IN (SELECT value FROM json_each(:items)))
      ORDER BY name_ar`,
    {
      hasCats: opts.category_ids.length ? 1 : 0,
      cats: JSON.stringify(opts.category_ids),
      hasItems: opts.item_ids.length ? 1 : 0,
      items: JSON.stringify(opts.item_ids),
    },
  );
  if (!rows.length) throw V.bad('لا توجد أصناف نشطة بأسعار بيع مطابقة للمعايير المحددة');
  return rows;
}

// ------------------------------------------------------------ التوليد
/**
 * توليد معاينة دفعة فواتير (بدون حفظ).
 * @returns {{ options, invoices: [], summary }}
 */
function generate(payload) {
  const opts = normalizeOptions(payload);
  const issuer = issuersSvc.getRaw(opts.issuer_id);
  const client = db.get('SELECT * FROM clients WHERE id = :id', { id: opts.client_id });
  if (!client) throw V.notFound('العميل غير موجود');
  const catalog = loadCatalog(opts);
  const rng = makeRng(opts.seed);

  // تحديد عدد الفواتير
  let count = opts.count;
  if (!count) {
    const avgItemTotal = catalog.reduce((s, i) => s + i.sale_price * (1 + i.tax_rate / 100), 0) / catalog.length;
    const avgQty = (opts.min_qty + opts.max_qty) / 2;
    const avgItems = (opts.min_items + opts.max_items) / 2;
    const avgInvoice = Math.max(1, Math.round(avgItemTotal * avgQty * avgItems));
    count = Math.max(1, Math.round(opts.target_total / avgInvoice));
  }
  // سقف الدفعة من إعدادات النظام (قابل للتعديل من شاشة الإعدادات) مع حد أقصى صلب
  const sysCap = Number(db.get("SELECT value FROM settings WHERE key = 'bulk_max_invoices'")?.value)
    || config.bulk.maxInvoicesPerBatch;
  const hardCap = Math.min(5000, Math.max(1, sysCap));
  if (count > hardCap) throw V.bad(`عدد الفواتير المطلوب كبير جداً (الحد ${hardCap} حسب إعدادات النظام)`);

  const stamps = distributeTimestamps(rng, count, opts);

  // حصص المبالغ عند وجود ميزانية إجمالية
  let shares = null;
  if (opts.target_total) {
    const weights = [];
    for (let i = 0; i < count; i++) weights.push(randFloat(rng, 0.55, 1.45));
    let wsum = weights.reduce((a, b) => a + b, 0);
    shares = weights.map((w) => Math.max(1, Math.round((w / wsum) * opts.target_total)));
    // ضبط الحدود الدنيا/العليا لقيمة الفاتورة
    if (opts.min_invoice_total || opts.max_invoice_total) {
      for (let i = 0; i < shares.length; i++) {
        if (opts.min_invoice_total && shares[i] < opts.min_invoice_total) shares[i] = opts.min_invoice_total;
        if (opts.max_invoice_total && shares[i] > opts.max_invoice_total) shares[i] = opts.max_invoice_total;
      }
    }
    // تصحيح الفارق ليكون المجموع مساوياً للميزانية بدقة
    let diff = opts.target_total - shares.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (diff !== 0 && guard++ < count * 20) {
      const i = Math.floor(rng() * shares.length);
      const step = diff > 0 ? Math.min(diff, Math.max(1, Math.round(Math.abs(diff) / count) || 1)) : Math.max(diff, -Math.max(1, Math.round(Math.abs(diff) / count) || 1));
      const candidate = shares[i] + step;
      if (candidate < 1) continue;
      if (opts.max_invoice_total && candidate > opts.max_invoice_total) continue;
      if (opts.min_invoice_total && candidate < opts.min_invoice_total) continue;
      shares[i] = candidate;
      diff -= step;
    }
    if (diff !== 0) shares[shares.length - 1] += diff;
    void wsum;
  }

  const usageTracker = new Map();
  for (const it of catalog) {
    usageTracker.set(it.id || it.name_ar, 0);
  }

  const signatures = new Set();
  const invoices = [];
  for (let i = 0; i < count; i++) {
    const stamp = stamps[i] || stamps[stamps.length - 1];
    const targetTotal = shares ? shares[i] : 0;
    let lines = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = buildBasket(rng, catalog, opts, targetTotal, usageTracker);
      if (!candidate.length) continue;
      if (targetTotal) closeGap(candidate, targetTotal);
      const totals = invoiceTotals(candidate);
      if (!targetTotal) {
        if (opts.min_invoice_total && totals.grand_total < opts.min_invoice_total) continue;
        if (opts.max_invoice_total && totals.grand_total > opts.max_invoice_total) continue;
      }
      const sig = basketSignature(candidate);
      if (signatures.has(sig) && attempt < 11) continue;
      signatures.add(sig);
      lines = candidate;
      break;
    }
    if (!lines) {
      // احتياطي: سلة بسيطة تحترم الحدود
      lines = buildBasket(rng, catalog, opts, targetTotal || opts.min_invoice_total || 0, usageTracker);
      if (targetTotal) closeGap(lines, targetTotal);
    }

    // تحديث تكرار ظهور الأصناف لتوزيع متوازن على مدار الدفعة
    for (const l of lines) {
      const k = l.item_id || l.item_name;
      usageTracker.set(k, (usageTracker.get(k) || 0) + 1);
    }

    const totals = invoiceTotals(lines);
    invoices.push({
      temp_id: `tmp-${i + 1}`,
      issue_date: stamp.date,
      issue_time: stamp.time,
      invoice_type: opts.invoice_type,
      payment_method: pickWeighted(rng, opts.payment_methods),
      lines: lines.map((l) => ({
        item_id: l.item_id,
        item_code: l.item_code,
        item_name: l.item_name,
        unit: l.unit,
        quantity: l.quantity,
        unit_price: M.toMajor(l.unit_price),
        discount: M.toMajor(l.discount),
        tax_rate: l.tax_rate,
      })),
      subtotal: M.toMajor(totals.subtotal),
      discount_amount: M.toMajor(totals.discount_amount),
      taxable_amount: M.toMajor(totals.taxable_amount),
      tax_amount: M.toMajor(totals.tax_amount),
      grand_total: M.toMajor(totals.grand_total),
    });
  }

  // تصحيح نهائي للمجموع الكلي مقابل الميزانية
  if (opts.target_total) {
    const totalMinor = invoices.reduce((s, inv) => s + M.toMinor(inv.grand_total), 0);
    const diff = opts.target_total - totalMinor;
    if (diff !== 0 && invoices.length) {
      const last = invoices[invoices.length - 1];
      const rawLines = last.lines.map((l) => ({ ...l, unit_price: M.toMinor(l.unit_price), discount: M.toMinor(l.discount) }));
      const newTarget = M.toMinor(last.grand_total) + diff;
      if (newTarget > 0) {
        closeGap(rawLines, newTarget);
        const t = invoiceTotals(rawLines);
        last.lines = rawLines.map((l) => ({ ...l, unit_price: M.toMajor(l.unit_price), discount: M.toMajor(l.discount) }));
        last.subtotal = M.toMajor(t.subtotal);
        last.discount_amount = M.toMajor(t.discount_amount);
        last.taxable_amount = M.toMajor(t.taxable_amount);
        last.tax_amount = M.toMajor(t.tax_amount);
        last.grand_total = M.toMajor(t.grand_total);
      }
    }
  }

  const summary = summarize(invoices);
  return {
    options: {
      ...opts,
      target_total: M.toMajor(opts.target_total),
      min_invoice_total: M.toMajor(opts.min_invoice_total),
      max_invoice_total: M.toMajor(opts.max_invoice_total),
      custom_items: (opts.custom_items || []).map((ci) => ({ ...ci, sale_price: M.toMajor(ci.sale_price) })),
    },
    issuer: { id: issuer.id, name: issuer.name_ar, code: issuer.code, currency: issuer.currency },
    client: { id: client.id, name: client.name, code: client.client_code },
    invoices,
    summary,
  };
}

function summarize(invoices) {
  const totalMinor = invoices.reduce((s, i) => s + M.toMinor(i.grand_total), 0);
  const taxMinor = invoices.reduce((s, i) => s + M.toMinor(i.tax_amount), 0);
  const discountMinor = invoices.reduce((s, i) => s + M.toMinor(i.discount_amount), 0);
  const values = invoices.map((i) => M.toMinor(i.grand_total));
  const uniqueSignatures = new Set(invoices.map((i) => basketSignature(i.lines.map((l) => ({
    item_id: l.item_id, quantity: l.quantity, unit_price: M.toMinor(l.unit_price),
  }))))).size;

  const itemCounts = {};
  for (const inv of invoices) {
    for (const l of inv.lines) {
      const k = l.item_name || 'غير محدد';
      itemCounts[k] = (itemCounts[k] || 0) + (l.quantity || 1);
    }
  }

  return {
    count: invoices.length,
    grand_total: M.toMajor(totalMinor),
    tax_total: M.toMajor(taxMinor),
    discount_total: M.toMajor(discountMinor),
    average: invoices.length ? M.toMajor(Math.round(totalMinor / invoices.length)) : 0,
    min_invoice: values.length ? M.toMajor(Math.min(...values)) : 0,
    max_invoice: values.length ? M.toMajor(Math.max(...values)) : 0,
    unique_baskets: uniqueSignatures,
    date_from: invoices.length ? invoices[0].issue_date : null,
    date_to: invoices.length ? invoices[invoices.length - 1].issue_date : null,
    item_distribution: itemCounts,
  };
}

/**
 * اعتماد الدفعة وحفظها فعلياً.
 * payload: { issuer_id, client_id, invoices: [...], options }
 */
function commit(payload, ctx = {}) {
  const actor = ctx.actor || 'system';
  const issuerId = V.str(payload.issuer_id, 'الشركة المصدرة', { required: true, max: 40 });
  const clientId = V.str(payload.client_id, 'العميل', { required: true, max: 40 });
  const invoices = V.arr(payload.invoices, 'الفواتير', { required: true, max: 5000 });
  if (!invoices.length) throw V.bad('لا توجد فواتير للاعتماد');
  issuersSvc.getRaw(issuerId);
  if (!db.get('SELECT id FROM clients WHERE id = :id', { id: clientId })) throw V.notFound('العميل غير موجود');

  const issueVouchers = V.bool(payload.issue_vouchers !== undefined ? payload.issue_vouchers : (payload.options && payload.options.issue_vouchers), false);
  const paymentMethod = V.oneOf(payload.payment_method || (payload.options && payload.options.payment_method), 'طريقة الدفع', ['CREDIT', 'CASH', 'TRANSFER', 'CHEQUE', 'CARD'], 'CREDIT');

  const sorted = invoices.slice().sort((a, b) => {
    const ka = `${a.issue_date} ${a.issue_time || '00:00:00'}`;
    const kb = `${b.issue_date} ${b.issue_time || '00:00:00'}`;
    return ka.localeCompare(kb);
  });

  return db.tx(() => {
    const batchId = uuid();
    db.run(
      `INSERT INTO invoice_batches (id, issuer_id, client_id, params, invoice_count, total_amount, status, created_by, created_at)
       VALUES (:id, :issuer_id, :client_id, :params, 0, 0, 'COMMITTED', :created_by, :created_at)`,
      {
        id: batchId,
        issuer_id: issuerId,
        client_id: clientId,
        params: JSON.stringify(payload.options || {}),
        created_by: actor,
        created_at: db.nowIso(),
      },
    );

    const created = [];
    const createdVouchers = [];
    let totalMinor = 0;
    for (const inv of sorted) {
      const result = invoicesSvc.create({
        issuer_id: issuerId,
        client_id: clientId,
        issue_date: inv.issue_date,
        issue_time: inv.issue_time,
        invoice_type: inv.invoice_type || 'STANDARD',
        payment_method: inv.payment_method || paymentMethod,
        notes: inv.notes || (payload.options && payload.options.notes) || '',
        batch_id: batchId,
        lines: inv.lines,
      }, { actor, can: () => true });

      created.push({ id: result.id, invoice_number: result.invoice_number, grand_total: result.grand_total, issue_date: result.issue_date });
      totalMinor += M.toMinor(result.grand_total);

      // توليد سند قبض مرافق تلقائياً إن طُلب ذلك
      if (issueVouchers) {
        const voucher = vouchersSvc.create({
          issuer_id: issuerId,
          client_id: clientId,
          voucher_date: result.issue_date,
          total_amount: result.grand_total,
          payment_type: paymentMethod === 'CREDIT' ? 'CASH' : paymentMethod,
          reference_no: result.invoice_number,
          notes: `سند قبض آلي للفاتورة ${result.invoice_number}`,
          allocations: [{ invoice_id: result.id, amount: result.grand_total }],
        }, { actor, can: () => true });
        createdVouchers.push({ id: voucher.id, voucher_number: voucher.voucher_number, total_amount: voucher.total_amount });
      }
    }

    db.run('UPDATE invoice_batches SET invoice_count = :c, total_amount = :t WHERE id = :id', {
      c: created.length, t: totalMinor, id: batchId,
    });

    // تحديث حالة المسودة إن تم تمرير draft_id
    if (payload.draft_id) {
      db.run(
        `UPDATE bulk_drafts
            SET status = 'COMMITTED', batch_id = :batch_id,
                committed_ids = :ids, updated_at = :now
          WHERE id = :draft_id`,
        {
          batch_id: batchId,
          ids: JSON.stringify(created.map((i) => i.id)),
          now: db.nowIso(),
          draft_id: payload.draft_id,
        },
      );
    }

    db.audit({
      user: actor, action: 'BULK_COMMIT', entityType: 'invoice_batch', entityId: batchId, issuerId,
      details: { count: created.length, total: M.fmt(totalMinor), vouchers_count: createdVouchers.length },
    });

    return {
      batch_id: batchId,
      count: created.length,
      total_amount: M.toMajor(totalMinor),
      invoices: created,
      vouchers_count: createdVouchers.length,
      vouchers: createdVouchers,
    };
  });
}

function listBatches({ issuerId = '', clientId = '', limit = 100 } = {}) {
  return db.all(
    `SELECT b.*, s.name_ar AS issuer_name, c.name AS client_name
       FROM invoice_batches b
       JOIN issuers s ON s.id = b.issuer_id
       JOIN clients c ON c.id = b.client_id
      WHERE (:issuer = '' OR b.issuer_id = :issuer) AND (:client = '' OR b.client_id = :client)
      ORDER BY b.created_at DESC LIMIT :lim`,
    { issuer: issuerId || '', client: clientId || '', lim: limit },
  ).map((b) => ({
    id: b.id,
    issuer_id: b.issuer_id,
    issuer_name: b.issuer_name,
    client_id: b.client_id,
    client_name: b.client_name,
    invoice_count: b.invoice_count,
    total_amount: M.toMajor(b.total_amount),
    status: b.status,
    created_by: b.created_by,
    created_at: b.created_at,
    params: (() => { try { return JSON.parse(b.params); } catch { return {}; } })(),
  }));
}

// ------------------------------------------------------------- إدارة المسودات
function saveDraft(payload, ctx = {}) {
  const actor = ctx.actor || 'system';
  const issuerId = V.str(payload.issuer_id, 'الشركة المصدرة', { required: true, max: 40 });
  const clientId = V.str(payload.client_id, 'العميل', { max: 40 }) || null;
  const invoices = V.arr(payload.invoices, 'الفواتير', { required: true, max: 5000 });
  if (!invoices.length) throw V.bad('لا توجد فواتير لحفظها في المسودة');

  issuersSvc.getRaw(issuerId);
  if (clientId && !db.get('SELECT id FROM clients WHERE id = :id', { id: clientId })) {
    throw V.notFound('العميل غير موجود');
  }

  const now = db.nowIso();
  const id = payload.id ? V.str(payload.id, 'معرف المسودة', { max: 40 }) : uuid();
  const existing = db.get('SELECT id FROM bulk_drafts WHERE id = :id', { id });

  const totalMinor = invoices.reduce((s, i) => s + M.toMinor(i.grand_total), 0);
  const title = V.str(payload.title, 'عنوان المسودة', { max: 200 }) || `معاينة دفعة ${now.slice(0, 19).replace('T', ' ')}`;
  const params = JSON.stringify(payload.options || payload.params || {});
  const payloadJson = JSON.stringify(invoices);

  if (existing) {
    db.run(
      `UPDATE bulk_drafts
          SET title = :title, issuer_id = :issuer_id, client_id = :client_id,
              params = :params, payload = :payload, invoice_count = :count,
              grand_total = :total, updated_at = :now
        WHERE id = :id`,
      {
        id, title, issuer_id: issuerId, client_id: clientId,
        params, payload: payloadJson, count: invoices.length,
        total: totalMinor, now,
      },
    );
  } else {
    db.run(
      `INSERT INTO bulk_drafts (id, title, issuer_id, client_id, status, params, payload, invoice_count, grand_total, created_by, created_at, updated_at)
       VALUES (:id, :title, :issuer_id, :client_id, 'DRAFT', :params, :payload, :count, :total, :created_by, :now, :now)`,
      {
        id, title, issuer_id: issuerId, client_id: clientId,
        params, payload: payloadJson, count: invoices.length,
        total: totalMinor, created_by: actor, now,
      },
    );
  }

  db.audit({
    user: actor, action: 'BULK_DRAFT_SAVE', entityType: 'bulk_draft', entityId: id, issuerId,
    details: { title, count: invoices.length, total: M.fmt(totalMinor) },
  });

  return getDraft(id);
}

function listDrafts({ issuerId = '', clientId = '', limit = 50, offset = 0 } = {}) {
  const rows = db.all(
    `SELECT d.id, d.title, d.issuer_id, d.client_id, d.status, d.invoice_count,
            d.grand_total, d.batch_id, d.created_by, d.created_at, d.updated_at,
            s.name_ar AS issuer_name, s.code AS issuer_code,
            c.name AS client_name, c.client_code AS client_code
       FROM bulk_drafts d
       JOIN issuers s ON s.id = d.issuer_id
       LEFT JOIN clients c ON c.id = d.client_id
      WHERE (:issuer = '' OR d.issuer_id = :issuer)
        AND (:client = '' OR d.client_id = :client)
      ORDER BY d.updated_at DESC
      LIMIT :lim OFFSET :off`,
    { issuer: issuerId || '', client: clientId || '', lim: limit, off: offset },
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    issuer_id: r.issuer_id,
    issuer_name: r.issuer_name,
    issuer_code: r.issuer_code,
    client_id: r.client_id,
    client_name: r.client_name,
    client_code: r.client_code,
    status: r.status,
    invoice_count: r.invoice_count,
    grand_total: M.toMajor(r.grand_total),
    batch_id: r.batch_id,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function getDraft(id) {
  const row = db.get(
    `SELECT d.*, s.name_ar AS issuer_name, s.code AS issuer_code,
            c.name AS client_name, c.client_code AS client_code
       FROM bulk_drafts d
       JOIN issuers s ON s.id = d.issuer_id
       LEFT JOIN clients c ON c.id = d.client_id
      WHERE d.id = :id`,
    { id },
  );
  if (!row) throw V.notFound('المسودة غير موجودة');

  let params = {};
  let invoices = [];
  try { params = JSON.parse(row.params); } catch { /* ignore */ }
  try { invoices = JSON.parse(row.payload); } catch { /* ignore */ }

  return {
    id: row.id,
    title: row.title,
    issuer_id: row.issuer_id,
    issuer_name: row.issuer_name,
    issuer_code: row.issuer_code,
    client_id: row.client_id,
    client_name: row.client_name,
    client_code: row.client_code,
    status: row.status,
    invoice_count: row.invoice_count,
    grand_total: M.toMajor(row.grand_total),
    options: params,
    invoices,
    summary: summarize(invoices),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function deleteDraft(id, ctx = {}) {
  const actor = ctx.actor || 'system';
  const row = db.get('SELECT * FROM bulk_drafts WHERE id = :id', { id });
  if (!row) throw V.notFound('المسودة غير موجودة');

  db.run('DELETE FROM bulk_drafts WHERE id = :id', { id });
  db.audit({
    user: actor, action: 'BULK_DRAFT_DELETE', entityType: 'bulk_draft', entityId: id, issuerId: row.issuer_id,
    details: { title: row.title },
  });
  return { id, deleted: true };
}

module.exports = {
  generate,
  commit,
  listBatches,
  saveDraft,
  listDrafts,
  getDraft,
  deleteDraft,
  normalizeOptions,
  makeRng,
  invoiceTotals,
  closeGap,
  summarize,
};
