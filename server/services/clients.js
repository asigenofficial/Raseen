'use strict';
/** دليل العملاء المركزي. */
const db = require('../db');
const V = require('../lib/validate');
const { uuid } = require('../lib/ids');
const M = require('../lib/money');

function mapClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_code: row.client_code,
    name: row.name,
    name_en: row.name_en,
    phone: row.phone,
    mobile: row.mobile,
    email: row.email,
    address: row.address,
    city: row.city,
    tax_number: row.tax_number,
    commercial_register: row.commercial_register,
    client_type: row.client_type || 'COMPANY',
    payment_terms_days: row.payment_terms_days || 0,
    opening_balance: M.toMajor(row.opening_balance),
    credit_limit: M.toMajor(row.credit_limit),
    notes: row.notes,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // حقول محسوبة اختيارية
    total_invoiced: row.total_invoiced === undefined ? undefined : M.toMajor(row.total_invoiced),
    total_paid: row.total_paid === undefined ? undefined : M.toMajor(row.total_paid),
    balance: row.balance === undefined ? undefined : M.toMajor(row.balance),
    invoices_count: row.invoices_count,
  };
}

function list({
  search = '', activeOnly = false, withBalances = false, issuerId = '',
  clientType = '', city = '', onlyDebtors = false,
} = {}) {
  const typeFilter = clientType || '';
  const cityFilter = city || '';
  if (!withBalances && !onlyDebtors) {
    const rows = db.all(
      `SELECT * FROM clients
        WHERE (:active = 0 OR is_active = 1)
          AND (:type = '' OR client_type = :type)
          AND (:city = '' OR city LIKE :city_like)
          AND (:q = '' OR name LIKE :like OR client_code LIKE :like OR phone LIKE :like
               OR mobile LIKE :like OR tax_number LIKE :like OR commercial_register LIKE :like
               OR email LIKE :like OR address LIKE :like)
        ORDER BY name`,
      {
        active: activeOnly ? 1 : 0,
        type: typeFilter,
        city: cityFilter,
        city_like: `%${cityFilter}%`,
        q: search,
        like: `%${search}%`,
      },
    );
    return rows.map(mapClient);
  }
  const rows = db.all(
    `SELECT c.*,
        (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id AND i.status <> 'CANCELLED'
            AND (:issuer = '' OR i.issuer_id = :issuer)) AS invoices_count,
        (SELECT COALESCE(SUM(i.grand_total), 0) FROM invoices i WHERE i.client_id = c.id AND i.status <> 'CANCELLED'
            AND (:issuer = '' OR i.issuer_id = :issuer)) AS total_invoiced,
        (SELECT COALESCE(SUM(i.paid_amount), 0) FROM invoices i WHERE i.client_id = c.id AND i.status <> 'CANCELLED'
            AND (:issuer = '' OR i.issuer_id = :issuer)) AS total_paid
      FROM clients c
      WHERE (:active = 0 OR c.is_active = 1)
        AND (:type = '' OR c.client_type = :type)
        AND (:city = '' OR c.city LIKE :city_like)
        AND (:q = '' OR c.name LIKE :like OR c.client_code LIKE :like OR c.phone LIKE :like
             OR c.mobile LIKE :like OR c.tax_number LIKE :like OR c.commercial_register LIKE :like
             OR c.email LIKE :like OR c.address LIKE :like)
      ORDER BY c.name`,
    {
      active: activeOnly ? 1 : 0,
      type: typeFilter,
      city: cityFilter,
      city_like: `%${cityFilter}%`,
      q: search,
      like: `%${search}%`,
      issuer: issuerId || '',
    },
  );
  let mapped = rows.map((r) => mapClient({
    ...r,
    balance: (issuerId ? 0 : r.opening_balance) + r.total_invoiced - r.total_paid,
  }));
  if (onlyDebtors) {
    mapped = mapped.filter((c) => c.balance > 0.004);
  }
  return mapped;
}

function getRaw(id) {
  const row = db.get('SELECT * FROM clients WHERE id = :id', { id });
  if (!row) throw V.notFound('العميل غير موجود');
  return row;
}

function get(id) {
  return mapClient(getRaw(id));
}

function nextCode() {
  const rows = db.all("SELECT client_code FROM clients WHERE client_code LIKE 'C-%'");
  let max = 0;
  for (const r of rows) {
    const n = Number(String(r.client_code).replace(/^C-/, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `C-${String(max + 1).padStart(4, '0')}`;
}

function validatePayload(payload, { isNew }) {
  const out = {
    client_code: V.str(payload.client_code, 'كود العميل', { max: 30 }) || (isNew ? nextCode() : ''),
    name: V.str(payload.name, 'اسم العميل', { required: isNew, max: 200 }),
    name_en: V.str(payload.name_en, 'الاسم بالإنجليزية', { max: 200 }),
    phone: V.str(payload.phone, 'الهاتف', { max: 40 }),
    mobile: V.str(payload.mobile, 'الجوال', { max: 40 }),
    email: V.str(payload.email, 'البريد الإلكتروني', { max: 120 }),
    address: V.str(payload.address, 'العنوان', { max: 300 }),
    city: V.str(payload.city, 'المدينة', { max: 120 }),
    tax_number: payload.tax_number ? V.vatNumber(payload.tax_number) : '',
    commercial_register: V.str(payload.commercial_register, 'السجل التجاري', { max: 30 }),
    client_type: V.oneOf(payload.client_type, 'نوع العميل', ['COMPANY', 'INDIVIDUAL'], 'COMPANY'),
    payment_terms_days: V.int(payload.payment_terms_days, 'مدة السداد', { min: 0, max: 3650, def: 0 }),
    opening_balance: M.toMinor(V.num(payload.opening_balance, 'الرصيد الافتتاحي', { min: -1e11, max: 1e11, def: 0 })),
    credit_limit: M.toMinor(V.num(payload.credit_limit, 'حد الائتمان', { min: 0, max: 1e11, def: 0 })),
    notes: V.str(payload.notes, 'الملاحظات', { max: 2000 }),
    is_active: V.bool(payload.is_active, true) ? 1 : 0,
  };
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw V.bad('البريد الإلكتروني غير صالح');
  return out;
}

/** إعادة بناء قيد الرصيد الافتتاحي في كشف الحساب. */
function syncOpeningBalance(clientId, amountMinor, date) {
  db.run("DELETE FROM client_ledger WHERE client_id = :id AND doc_type = 'OPENING_BALANCE'", { id: clientId });
  if (!amountMinor) return;
  db.run(
    `INSERT INTO client_ledger (id, client_id, issuer_id, doc_type, doc_id, doc_number, transaction_date,
        debit, credit, description, created_at)
     VALUES (:id, :client_id, NULL, 'OPENING_BALANCE', :client_id, '', :date, :debit, :credit, 'رصيد افتتاحي', :created_at)`,
    {
      id: uuid(),
      client_id: clientId,
      date: date || db.nowIso().slice(0, 10),
      debit: amountMinor > 0 ? amountMinor : 0,
      credit: amountMinor < 0 ? -amountMinor : 0,
      created_at: db.nowIso(),
    },
  );
}

function create(payload, actor) {
  const data = validatePayload(payload, { isNew: true });
  if (db.get('SELECT id FROM clients WHERE client_code = :c', { c: data.client_code })) {
    throw V.conflict('كود العميل مستخدم مسبقاً');
  }
  const id = uuid();
  const now = db.nowIso();
  return db.tx(() => {
    db.run(
      `INSERT INTO clients (id, client_code, name, name_en, phone, mobile, email, address, city, tax_number,
          commercial_register, client_type, payment_terms_days, opening_balance, credit_limit, notes, is_active, created_at, updated_at)
       VALUES (:id, :client_code, :name, :name_en, :phone, :mobile, :email, :address, :city, :tax_number,
          :commercial_register, :client_type, :payment_terms_days, :opening_balance, :credit_limit, :notes, :is_active, :created_at, :updated_at)`,
      { ...data, id, created_at: now, updated_at: now },
    );
    syncOpeningBalance(id, data.opening_balance, now.slice(0, 10));
    db.audit({ user: actor, action: 'CLIENT_CREATE', entityType: 'client', entityId: id, details: { code: data.client_code, name: data.name } });
    return get(id);
  });
}

function update(id, payload, actor) {
  const current = getRaw(id);
  const merged = {
    ...current,
    opening_balance: M.toMajor(current.opening_balance),
    credit_limit: M.toMajor(current.credit_limit),
    ...payload,
  };
  const data = validatePayload(merged, { isNew: false });
  if (!data.client_code) data.client_code = current.client_code;
  if (data.client_code !== current.client_code
      && db.get('SELECT id FROM clients WHERE client_code = :c AND id <> :id', { c: data.client_code, id })) {
    throw V.conflict('كود العميل مستخدم مسبقاً');
  }
  return db.tx(() => {
    db.run(
      `UPDATE clients SET client_code = :client_code, name = :name, name_en = :name_en, phone = :phone, mobile = :mobile,
          email = :email, address = :address, city = :city, tax_number = :tax_number, commercial_register = :commercial_register,
          client_type = :client_type, payment_terms_days = :payment_terms_days,
          opening_balance = :opening_balance, credit_limit = :credit_limit, notes = :notes, is_active = :is_active,
          updated_at = :updated_at
        WHERE id = :id`,
      { ...data, id, updated_at: db.nowIso() },
    );
    if (data.opening_balance !== current.opening_balance) {
      syncOpeningBalance(id, data.opening_balance, current.created_at.slice(0, 10));
    }
    db.audit({ user: actor, action: 'CLIENT_UPDATE', entityType: 'client', entityId: id, details: { code: data.client_code } });
    return get(id);
  });
}

function remove(id, actor) {
  const current = getRaw(id);
  const invoices = db.pluck('SELECT COUNT(*) AS c FROM invoices WHERE client_id = :id', { id });
  if (invoices > 0) {
    throw V.conflict(`لا يمكن حذف العميل لوجود ${invoices} فاتورة مرتبطة به. يمكنك تعطيله بدلاً من الحذف.`);
  }
  db.run('DELETE FROM clients WHERE id = :id', { id });
  db.audit({ user: actor, action: 'CLIENT_DELETE', entityType: 'client', entityId: id, details: { code: current.client_code } });
  return { ok: true };
}

module.exports = { list, get, getRaw, create, update, remove, mapClient, nextCode, syncOpeningBalance };
