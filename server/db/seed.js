'use strict';
/**
 * تهيئة بيانات تجريبية واقعية.
 * الاستخدام:
 *   node server/db/seed.js          → إضافة البيانات إن لم تكن موجودة
 *   node server/db/seed.js --reset  → حذف كل البيانات ثم إعادة التهيئة (تحذير: يمحو كل شيء)
 */
const db = require('../db');
const auth = require('../services/auth');
const issuersSvc = require('../services/issuers');
const clientsSvc = require('../services/clients');
const itemsSvc = require('../services/items');
const logosSvc = require('../services/logos');

const CATEGORIES = [
  { code: 'CAT-FOOD', name: 'مواد غذائية', description: 'أغذية ومشروبات ومواد استهلاكية' },
  { code: 'CAT-ELEC', name: 'أجهزة إلكترونية', description: 'أجهزة وملحقاتها' },
  { code: 'CAT-TEL', name: 'اتصالات', description: 'خدمات وأجهزة اتصالات' },
  { code: 'CAT-ACC', name: 'إكسسوارات', description: 'ملحقات وإكسسوارات متنوعة' },
  { code: 'CAT-SRV', name: 'خدمات', description: 'خدمات مهنية وصيانة' },
  { code: 'CAT-OFF', name: 'مستلزمات مكتبية', description: 'قرطاسية ومستلزمات إدارية' },
];

const ITEMS = [
  ['IT-0001', 'CAT-FOOD', 'أرز بسمتي هندي 10 كجم', 'Basmati Rice 10kg', 'كيس', 62, 78.5],
  ['IT-0002', 'CAT-FOOD', 'زيت دوار الشمس 1.8 لتر', 'Sunflower Oil 1.8L', 'حبة', 14.25, 19.75],
  ['IT-0003', 'CAT-FOOD', 'سكر ناعم 10 كجم', 'Fine Sugar 10kg', 'كيس', 27, 34.9],
  ['IT-0004', 'CAT-FOOD', 'حليب طويل الأجل 1 لتر', 'UHT Milk 1L', 'كرتون', 45, 57.5],
  ['IT-0005', 'CAT-FOOD', 'شاي أحمر فاخر 500 جم', 'Black Tea 500g', 'حبة', 18.5, 24.9],
  ['IT-0006', 'CAT-FOOD', 'قهوة عربية مطحونة 1 كجم', 'Arabic Coffee 1kg', 'كيلو', 52, 68],
  ['IT-0007', 'CAT-FOOD', 'ماء معدني 40×200 مل', 'Mineral Water Pack', 'كرتون', 9.75, 13.5],
  ['IT-0008', 'CAT-FOOD', 'معجون طماطم 800 جم', 'Tomato Paste 800g', 'حبة', 6.4, 9.25],
  ['IT-0009', 'CAT-ELEC', 'شاشة عرض 24 بوصة', '24" Monitor', 'حبة', 420, 549],
  ['IT-0010', 'CAT-ELEC', 'حاسب محمول i5 الجيل 12', 'Laptop i5 Gen12', 'حبة', 2450, 2999],
  ['IT-0011', 'CAT-ELEC', 'طابعة ليزر أحادية', 'Mono Laser Printer', 'حبة', 610, 795],
  ['IT-0012', 'CAT-ELEC', 'قرص صلب SSD 1 تيرا', 'SSD 1TB', 'حبة', 210, 289],
  ['IT-0013', 'CAT-ELEC', 'كاميرا مراقبة داخلية', 'Indoor IP Camera', 'حبة', 135, 189],
  ['IT-0014', 'CAT-TEL', 'راوتر واي فاي 6', 'WiFi 6 Router', 'حبة', 245, 329],
  ['IT-0015', 'CAT-TEL', 'كيبل شبكة Cat6 - 30 متر', 'Cat6 Cable 30m', 'لفة', 48, 69],
  ['IT-0016', 'CAT-TEL', 'سنترال هاتفي 8 خطوط', 'PBX 8 Lines', 'حبة', 890, 1150],
  ['IT-0017', 'CAT-ACC', 'حقيبة حاسب محمول', 'Laptop Bag', 'حبة', 55, 89],
  ['IT-0018', 'CAT-ACC', 'لوحة مفاتيح لاسلكية', 'Wireless Keyboard', 'حبة', 62, 95],
  ['IT-0019', 'CAT-ACC', 'ماوس بصري لاسلكي', 'Wireless Mouse', 'حبة', 28, 45],
  ['IT-0020', 'CAT-ACC', 'شاحن سريع 65 واط', 'Fast Charger 65W', 'حبة', 72, 110],
  ['IT-0021', 'CAT-SRV', 'خدمة صيانة دورية', 'Periodic Maintenance', 'خدمة', 0, 350],
  ['IT-0022', 'CAT-SRV', 'تركيب وتشغيل أنظمة', 'Installation Service', 'خدمة', 0, 500],
  ['IT-0023', 'CAT-SRV', 'استشارة تقنية - ساعة', 'Technical Consulting/hr', 'ساعة', 0, 250],
  ['IT-0024', 'CAT-OFF', 'ورق تصوير A4 - 5 رزم', 'A4 Paper 5 Reams', 'كرتون', 78, 105],
  ['IT-0025', 'CAT-OFF', 'حبر طابعة أسود', 'Printer Toner Black', 'حبة', 165, 219],
  ['IT-0026', 'CAT-OFF', 'دفتر ملاحظات مجلد', 'Hardcover Notebook', 'حبة', 9.5, 15],
  ['IT-0027', 'CAT-OFF', 'أقلام جاف 50 حبة', 'Ball Pens 50pcs', 'علبة', 22, 34.5],
  ['IT-0028', 'CAT-FOOD', 'عصير برتقال 1 لتر', 'Orange Juice 1L', 'حبة', 7.25, 11.5],
  ['IT-0029', 'CAT-FOOD', 'تمر سكري فاخر 1 كجم', 'Sukkari Dates 1kg', 'كيلو', 32, 46 ],
  ['IT-0030', 'CAT-ELEC', 'مكيف سبليت 18000 وحدة', 'Split AC 18000 BTU', 'حبة', 1780, 2290],
];

const ISSUERS = [
  {
    code: 'ZS-001',
    name_ar: 'مؤسسة زد للتجارة والتوريدات',
    name_en: 'Z Trading & Supplies Est.',
    tax_number: '310000000000003',
    commercial_register: '1010456789',
    street: 'طريق الملك فهد',
    building_no: '7420',
    district: 'العليا',
    city: 'الرياض',
    postal_code: '12211',
    phone: '0112345678',
    email: 'info@z-trading.example',
    website: 'www.z-trading.example',
    invoice_prefix: 'ZT',
    voucher_prefix: 'ZTR',
    bank_name: 'البنك الأهلي السعودي',
    bank_iban: 'SA0380000000608010167519',
    footer_notes: 'شكراً لتعاملكم معنا. الأسعار تشمل ضريبة القيمة المضافة 15%.',
    legal_terms: 'تخضع هذه الفاتورة لأحكام نظام ضريبة القيمة المضافة في المملكة العربية السعودية.',
    default_tax_rate: 15,
    zatca_phase: 'PHASE1',
    logo_data: logosSvc.LOGO_Z_TRADING_DATA_URL,
  },
  {
    code: 'ZS-002',
    name_ar: 'شركة الأفق الحديث للأنظمة التقنية',
    name_en: 'Modern Horizon Tech Systems Co.',
    tax_number: '311111111111113',
    commercial_register: '4030567891',
    street: 'شارع الأمير سلطان',
    building_no: '1155',
    district: 'الروضة',
    city: 'جدة',
    postal_code: '23434',
    phone: '0126543210',
    email: 'sales@horizon-tech.example',
    website: 'www.horizon-tech.example',
    invoice_prefix: 'MH',
    voucher_prefix: 'MHR',
    bank_name: 'مصرف الراجحي',
    bank_iban: 'SA4420000001234567891234',
    footer_notes: 'يرجى السداد خلال 30 يوماً من تاريخ الفاتورة.',
    legal_terms: 'أي خلاف ينشأ عن هذه الفاتورة يخضع لاختصاص المحاكم التجارية السعودية.',
    default_tax_rate: 15,
    zatca_phase: 'PHASE2',
    logo_data: logosSvc.LOGO_HORIZON_TECH_DATA_URL,
  },
  {
    code: 'ZS-003',
    name_ar: 'مؤسسة درب الشرق للخدمات اللوجستية',
    name_en: 'East Path Logistics Services',
    tax_number: '312222222222223',
    commercial_register: '2050334455',
    street: 'طريق الكورنيش',
    building_no: '308',
    district: 'الشاطئ',
    city: 'الدمام',
    postal_code: '32414',
    phone: '0138887766',
    email: 'ops@eastpath.example',
    website: '',
    invoice_prefix: 'EP',
    voucher_prefix: 'EPR',
    bank_name: 'بنك الرياض',
    bank_iban: 'SA1120000009876543210987',
    footer_notes: 'الفاتورة صالحة كسند قبض بعد اعتمادها من الإدارة المالية.',
    legal_terms: '',
    default_tax_rate: 15,
    zatca_phase: 'PHASE1',
    logo_data: logosSvc.LOGO_DARB_SHARQ_DATA_URL,
  },
];

const CLIENTS = [
  ['C-0001', 'شركة النخبة للمقاولات العامة', '0555123456', 'الرياض', '310123456700003', 0, 500000],
  ['C-0002', 'مؤسسة البيان للتجارة', '0566987654', 'جدة', '310987654300003', 12500, 200000],
  ['C-0003', 'شركة الواحة الخضراء للتشغيل والصيانة', '0533445566', 'الدمام', '311223344500003', 0, 350000],
  ['C-0004', 'مجموعة الفهد التجارية', '0501122334', 'الرياض', '', -4300, 150000],
  ['C-0005', 'مستشفى الرعاية المتقدمة', '0122334455', 'جدة', '313344556600003', 0, 800000],
  ['C-0006', 'مدارس المستقبل الأهلية', '0114455667', 'الرياض', '314455667700003', 8750, 120000],
  ['C-0007', 'مؤسسة الرمال الذهبية للنقل', '0577889900', 'بريدة', '', 0, 90000],
  ['C-0008', 'شركة أطياف للضيافة والتشغيل', '0509988776', 'الخبر', '315566778800003', 22400, 250000],
];

function resetAll() {
  const tables = [
    'voucher_allocations', 'receipt_vouchers', 'client_ledger', 'invoice_items', 'invoices',
    'invoice_batches', 'items', 'item_categories', 'clients', 'issuer_credentials', 'issuers',
    'audit_logs', 'sessions',
  ];
  db.tx(() => {
    for (const t of tables) db.run(`DELETE FROM ${t}`);
  });
  console.log('تم حذف كل البيانات التشغيلية.');
}

function seed({ reset = false } = {}) {
  db.open();
  if (reset) resetAll();

  const bootstrap = auth.ensureBootstrapAdmin();
  if (bootstrap) console.log(`مستخدم أولي: ${bootstrap.username} / ${bootstrap.password}`);

  const catIds = new Map();
  for (const c of CATEGORIES) {
    const existing = db.get('SELECT id FROM item_categories WHERE code = :c', { c: c.code });
    if (existing) { catIds.set(c.code, existing.id); continue; }
    const created = itemsSvc.createCategory(c, 'seed');
    catIds.set(c.code, created.id);
  }
  console.log(`المجموعات: ${catIds.size}`);

  let itemCount = 0;
  for (const [code, cat, nameAr, nameEn, unit, cost, sale] of ITEMS) {
    if (db.get('SELECT id FROM items WHERE item_code = :c', { c: code })) continue;
    itemsSvc.createItem({
      item_code: code,
      category_id: catIds.get(cat),
      name_ar: nameAr,
      name_en: nameEn,
      barcode: `62${String(600000000 + itemCount * 7919).slice(0, 9)}`,
      unit,
      cost_price: cost,
      sale_price: sale,
      tax_rate: 15,
    }, 'seed');
    itemCount += 1;
  }
  console.log(`الأصناف المضافة: ${itemCount}`);

  let issuerCount = 0;
  for (const iss of ISSUERS) {
    if (db.get('SELECT id FROM issuers WHERE code = :c', { c: iss.code })) continue;
    const created = issuersSvc.create(iss, 'seed');
    if (iss.zatca_phase === 'PHASE2') issuersSvc.generateSigningKey(created.id, 'seed');
    issuerCount += 1;
  }
  console.log(`الشركات المصدرة المضافة: ${issuerCount}`);

  let clientCount = 0;
  for (const [code, name, phone, city, vat, opening, limit] of CLIENTS) {
    if (db.get('SELECT id FROM clients WHERE client_code = :c', { c: code })) continue;
    clientsSvc.create({
      client_code: code,
      name,
      mobile: phone,
      city,
      address: `${city} - المملكة العربية السعودية`,
      tax_number: vat,
      opening_balance: opening,
      credit_limit: limit,
    }, 'seed');
    clientCount += 1;
  }
  console.log(`العملاء المضافون: ${clientCount}`);
  console.log('تمت التهيئة بنجاح.');
}

if (require.main === module) {
  seed({ reset: process.argv.includes('--reset') });
  db.close();
}

module.exports = { seed, resetAll };
