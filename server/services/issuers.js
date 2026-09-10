'use strict';
/** إدارة الشركات / المنشآت المصدرة (Multi-Issuer). */
const db = require('../db');
const V = require('../lib/validate');
const { uuid } = require('../lib/ids');
const { encryptSecret, decryptSecret, maskSecret } = require('../lib/crypto');
const zatca = require('../lib/zatca');

function mapIssuer(row, { includeLogo = true } = {}) {
  if (!row) return null;
  let qr = {};
  try { qr = JSON.parse(row.qr_settings || '{}'); } catch { qr = {}; }
  let print = {};
  try { print = JSON.parse(row.print_settings || '{}'); } catch { print = {}; }
  return {
    id: row.id,
    code: row.code,
    name_ar: row.name_ar,
    name_en: row.name_en,
    tax_number: row.tax_number,
    commercial_register: row.commercial_register,
    street: row.street,
    building_no: row.building_no,
    district: row.district,
    city: row.city,
    postal_code: row.postal_code,
    country: row.country,
    phone: row.phone,
    email: row.email,
    website: row.website,
    logo_data: includeLogo ? row.logo_data || '' : undefined,
    has_logo: !!row.logo_data,
    default_tax_rate: row.default_tax_rate,
    currency: row.currency,
    invoice_prefix: row.invoice_prefix,
    invoice_next_no: row.invoice_next_no,
    invoice_pad: row.invoice_pad,
    voucher_prefix: row.voucher_prefix,
    voucher_next_no: row.voucher_next_no,
    zatca_phase: row.zatca_phase,
    qr_settings: qr,
    print_settings: print,
    bank_name: row.bank_name,
    bank_iban: row.bank_iban,
    footer_notes: row.footer_notes,
    legal_terms: row.legal_terms,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function list({ search = '', activeOnly = false } = {}) {
  const rows = db.all(
    `SELECT * FROM issuers
      WHERE (:active = 0 OR is_active = 1)
        AND (:q = '' OR name_ar LIKE :like OR name_en LIKE :like OR code LIKE :like OR tax_number LIKE :like)
      ORDER BY name_ar`,
    { active: activeOnly ? 1 : 0, q: search, like: `%${search}%` },
  );
  return rows.map((r) => mapIssuer(r, { includeLogo: false }));
}

function getRaw(id) {
  const row = db.get('SELECT * FROM issuers WHERE id = :id', { id });
  if (!row) throw V.notFound('الشركة المصدرة غير موجودة');
  return row;
}

function get(id) {
  return mapIssuer(getRaw(id));
}

function validatePayload(payload, { isNew }) {
  const out = {
    code: V.str(payload.code, 'كود الشركة', { required: isNew, max: 30 }),
    name_ar: V.str(payload.name_ar, 'الاسم بالعربية', { required: isNew, max: 200 }),
    name_en: V.str(payload.name_en, 'الاسم بالإنجليزية', { max: 200 }),
    tax_number: payload.tax_number ? V.vatNumber(payload.tax_number) : '',
    commercial_register: V.str(payload.commercial_register, 'السجل التجاري', { max: 30 }),
    street: V.str(payload.street, 'الشارع', { max: 200 }),
    building_no: V.str(payload.building_no, 'رقم المبنى', { max: 20 }),
    district: V.str(payload.district, 'الحي', { max: 120 }),
    city: V.str(payload.city, 'المدينة', { max: 120 }),
    postal_code: V.str(payload.postal_code, 'الرمز البريدي', { max: 12 }),
    country: V.str(payload.country, 'الدولة', { max: 4 }) || 'SA',
    phone: V.str(payload.phone, 'الهاتف', { max: 60 }),
    email: V.str(payload.email, 'البريد الإلكتروني', { max: 120 }),
    website: V.str(payload.website, 'الموقع', { max: 150 }),
    logo_data: V.str(payload.logo_data, 'الشعار', { max: 4 * 1024 * 1024, trim: false }),
    default_tax_rate: V.num(payload.default_tax_rate, 'نسبة الضريبة', { min: 0, max: 100, def: 15 }),
    currency: V.str(payload.currency, 'العملة', { max: 5 }) || 'SAR',
    invoice_prefix: V.str(payload.invoice_prefix, 'بادئة الفاتورة', { max: 12 }) || 'INV',
    invoice_next_no: V.int(payload.invoice_next_no, 'رقم الفاتورة القادم', { min: 1, max: 99999999, def: 1 }),
    invoice_pad: V.int(payload.invoice_pad, 'خانات الترقيم', { min: 1, max: 12, def: 5 }),
    voucher_prefix: V.str(payload.voucher_prefix, 'بادئة السند', { max: 12 }) || 'RV',
    voucher_next_no: V.int(payload.voucher_next_no, 'رقم السند القادم', { min: 1, max: 99999999, def: 1 }),
    zatca_phase: V.oneOf(payload.zatca_phase, 'مرحلة الفاتورة الإلكترونية', ['PHASE1', 'PHASE2'], 'PHASE1'),
    bank_name: V.str(payload.bank_name, 'البنك', { max: 120 }),
    bank_iban: V.str(payload.bank_iban, 'الآيبان', { max: 40 }),
    footer_notes: V.str(payload.footer_notes, 'تذييل الفاتورة', { max: 2000 }),
    legal_terms: V.str(payload.legal_terms, 'الشروط القانونية', { max: 4000 }),
    is_active: V.bool(payload.is_active, true) ? 1 : 0,
  };
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw V.bad('البريد الإلكتروني غير صالح');
  if (payload.qr_settings && typeof payload.qr_settings === 'object') {
    out.qr_settings = JSON.stringify(payload.qr_settings);
  }
  if (payload.print_settings && typeof payload.print_settings === 'object') {
    out.print_settings = JSON.stringify(payload.print_settings);
  }
  return out;
}

function create(payload, actor) {
  const data = validatePayload(payload, { isNew: true });
  if (db.get('SELECT id FROM issuers WHERE code = :c', { c: data.code })) {
    throw V.conflict('كود الشركة مستخدم مسبقاً');
  }
  const id = uuid();
  const now = db.nowIso();
  db.run(
    `INSERT INTO issuers (id, code, name_ar, name_en, tax_number, commercial_register, street, building_no,
        district, city, postal_code, country, phone, email, website, logo_data, default_tax_rate, currency,
        invoice_prefix, invoice_next_no, invoice_pad, voucher_prefix, voucher_next_no, zatca_phase, qr_settings,
        print_settings,
        bank_name, bank_iban, footer_notes, legal_terms, is_active, created_at, updated_at)
     VALUES (:id, :code, :name_ar, :name_en, :tax_number, :commercial_register, :street, :building_no,
        :district, :city, :postal_code, :country, :phone, :email, :website, :logo_data, :default_tax_rate, :currency,
        :invoice_prefix, :invoice_next_no, :invoice_pad, :voucher_prefix, :voucher_next_no, :zatca_phase, :qr_settings,
        :print_settings,
        :bank_name, :bank_iban, :footer_notes, :legal_terms, :is_active, :created_at, :updated_at)`,
    {
      ...data,
      qr_settings: data.qr_settings || '{}',
      print_settings: data.print_settings || '{}',
      id,
      created_at: now,
      updated_at: now,
    },
  );
  db.audit({ user: actor, action: 'ISSUER_CREATE', entityType: 'issuer', entityId: id, issuerId: id, details: { code: data.code, name: data.name_ar } });
  return get(id);
}

function update(id, payload, actor) {
  const current = getRaw(id);
  const data = validatePayload({
    ...current,
    ...payload,
    qr_settings: payload.qr_settings !== undefined ? payload.qr_settings : (current.qr_settings ? JSON.parse(current.qr_settings) : {}),
    print_settings: payload.print_settings !== undefined ? payload.print_settings : (current.print_settings ? JSON.parse(current.print_settings) : {}),
  }, { isNew: false });
  if (data.code && data.code !== current.code) {
    if (db.get('SELECT id FROM issuers WHERE code = :c AND id <> :id', { c: data.code, id })) {
      throw V.conflict('كود الشركة مستخدم مسبقاً');
    }
  }
  db.run(
    `UPDATE issuers SET code = :code, name_ar = :name_ar, name_en = :name_en, tax_number = :tax_number,
        commercial_register = :commercial_register, street = :street, building_no = :building_no, district = :district,
        city = :city, postal_code = :postal_code, country = :country, phone = :phone, email = :email, website = :website,
        logo_data = :logo_data, default_tax_rate = :default_tax_rate, currency = :currency, invoice_prefix = :invoice_prefix,
        invoice_next_no = :invoice_next_no, invoice_pad = :invoice_pad, voucher_prefix = :voucher_prefix,
        voucher_next_no = :voucher_next_no, zatca_phase = :zatca_phase, qr_settings = :qr_settings,
        print_settings = :print_settings,
        bank_name = :bank_name,
        bank_iban = :bank_iban, footer_notes = :footer_notes, legal_terms = :legal_terms, is_active = :is_active,
        updated_at = :updated_at
      WHERE id = :id`,
    {
      ...data,
      qr_settings: data.qr_settings || current.qr_settings || '{}',
      print_settings: data.print_settings || current.print_settings || '{}',
      id,
      updated_at: db.nowIso(),
    },
  );
  db.audit({ user: actor, action: 'ISSUER_UPDATE', entityType: 'issuer', entityId: id, issuerId: id, details: { code: data.code } });
  return get(id);
}

function remove(id, actor) {
  const current = getRaw(id);
  const invoices = db.pluck('SELECT COUNT(*) AS c FROM invoices WHERE issuer_id = :id', { id });
  if (invoices > 0) {
    throw V.conflict(`لا يمكن حذف الشركة لوجود ${invoices} فاتورة مرتبطة بها. يمكنك تعطيلها بدلاً من الحذف.`);
  }
  db.run('DELETE FROM issuers WHERE id = :id', { id });
  db.audit({ user: actor, action: 'ISSUER_DELETE', entityType: 'issuer', entityId: id, details: { code: current.code } });
  return { ok: true };
}

// ------------------------------------------------- بيانات الربط مع ZATCA
function getCredentials(issuerId) {
  getRaw(issuerId);
  const row = db.get('SELECT * FROM issuer_credentials WHERE issuer_id = :id', { id: issuerId });
  if (!row) {
    return {
      issuer_id: issuerId,
      has_compliance_csid: false,
      has_production_csid: false,
      has_secret: false,
      has_private_key: false,
      has_certificate: false,
      certificate_info: null,
      updated_at: null,
    };
  }
  const cert = decryptSecret(row.certificate_enc);
  const info = cert ? zatca.certificateInfo(cert) : null;
  return {
    issuer_id: issuerId,
    has_compliance_csid: !!row.compliance_csid_enc,
    has_production_csid: !!row.production_csid_enc,
    has_secret: !!row.secret_enc,
    has_private_key: !!row.private_key_enc,
    has_certificate: !!row.certificate_enc,
    compliance_csid_masked: maskSecret(decryptSecret(row.compliance_csid_enc)),
    production_csid_masked: maskSecret(decryptSecret(row.production_csid_enc)),
    certificate_info: info
      ? { subject: info.subject, issuer: info.issuer, serial: info.serialNumber, valid_to: info.validTo }
      : null,
    updated_at: row.updated_at,
  };
}

function saveCredentials(issuerId, payload, actor) {
  getRaw(issuerId);
  const existing = db.get('SELECT * FROM issuer_credentials WHERE issuer_id = :id', { id: issuerId });
  const enc = (value, prev) => (value === undefined || value === null || value === '' ? prev || null : encryptSecret(String(value)));
  const certificate = payload.certificate_pem;
  const privateKey = payload.private_key_pem;
  let publicKeyDer = existing ? existing.public_key_der : null;
  if (certificate) {
    const info = zatca.certificateInfo(certificate);
    if (!info) throw V.bad('الشهادة المدخلة ليست شهادة X.509 صالحة');
    publicKeyDer = info.publicKeyDerBase64;
  }
  const row = {
    issuer_id: issuerId,
    compliance_csid_enc: enc(payload.compliance_csid, existing && existing.compliance_csid_enc),
    production_csid_enc: enc(payload.production_csid, existing && existing.production_csid_enc),
    secret_enc: enc(payload.secret, existing && existing.secret_enc),
    private_key_enc: enc(privateKey, existing && existing.private_key_enc),
    certificate_enc: enc(certificate, existing && existing.certificate_enc),
    public_key_der: publicKeyDer,
    updated_at: db.nowIso(),
  };
  db.run(
    `INSERT INTO issuer_credentials (issuer_id, compliance_csid_enc, production_csid_enc, secret_enc,
        private_key_enc, certificate_enc, public_key_der, updated_at)
     VALUES (:issuer_id, :compliance_csid_enc, :production_csid_enc, :secret_enc, :private_key_enc,
        :certificate_enc, :public_key_der, :updated_at)
     ON CONFLICT(issuer_id) DO UPDATE SET
        compliance_csid_enc = :compliance_csid_enc, production_csid_enc = :production_csid_enc,
        secret_enc = :secret_enc, private_key_enc = :private_key_enc, certificate_enc = :certificate_enc,
        public_key_der = :public_key_der, updated_at = :updated_at`,
    row,
  );
  db.audit({ user: actor, action: 'ISSUER_CREDENTIALS_UPDATE', entityType: 'issuer', entityId: issuerId, issuerId });
  return getCredentials(issuerId);
}

/** توليد زوج مفاتيح ECDSA محلي للمنشأة (للتوقيع المحلي / تحضير طلب الشهادة). */
function generateSigningKey(issuerId, actor) {
  getRaw(issuerId);
  const pair = zatca.generateKeyPair();
  saveCredentials(issuerId, { private_key_pem: pair.privateKeyPem }, actor);
  db.run('UPDATE issuer_credentials SET public_key_der = :der WHERE issuer_id = :id', { der: pair.publicKeyDerBase64, id: issuerId });
  db.audit({ user: actor, action: 'ISSUER_KEY_GENERATE', entityType: 'issuer', entityId: issuerId, issuerId });
  return { ok: true, public_key_pem: pair.publicKeyPem, credentials: getCredentials(issuerId) };
}

/** إرجاع مواد التوقيع (تُستخدم داخلياً عند إصدار فاتورة بالمرحلة الثانية). */
function signingMaterial(issuerId) {
  const row = db.get('SELECT * FROM issuer_credentials WHERE issuer_id = :id', { id: issuerId });
  if (!row) return null;
  const privateKeyPem = decryptSecret(row.private_key_enc);
  const certificatePem = decryptSecret(row.certificate_enc);
  const certInfo = certificatePem ? zatca.certificateInfo(certificatePem) : null;
  return {
    privateKeyPem,
    certificatePem,
    publicKeyDerBase64: (certInfo && certInfo.publicKeyDerBase64) || row.public_key_der || null,
    certSignatureBase64: certInfo ? certInfo.certSignatureBase64 : null,
    hasProduction: !!row.production_csid_enc,
  };
}

module.exports = {
  list, get, getRaw, create, update, remove, mapIssuer,
  getCredentials, saveCredentials, generateSigningKey, signingMaterial,
};
