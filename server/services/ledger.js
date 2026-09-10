'use strict';
/**
 * كشف حساب العميل (Statement of Account) — موحّد لكل الشركات أو مفلتر لشركة واحدة.
 *
 * الرصيد التراكمي يُحسب لحظياً عند القراءة (وليس مخزّناً) لأن قيمته تعتمد على
 * نطاق العرض والفلاتر، وهذا يضمن دقته في كل الحالات.
 */
const db = require('../db');
const V = require('../lib/validate');
const M = require('../lib/money');

const DOC_LABELS = {
  OPENING_BALANCE: 'رصيد افتتاحي',
  INVOICE: 'فاتورة',
  INVOICE_CANCEL: 'إلغاء فاتورة',
  RECEIPT: 'سند قبض',
  RECEIPT_CANCEL: 'إلغاء سند قبض',
};

/**
 * @param {object} params { client_id, issuer_id, from, to, only_unpaid }
 */
function statement(params = {}) {
  const clientId = V.str(params.client_id, 'العميل', { required: true, max: 40 });
  const client = db.get('SELECT * FROM clients WHERE id = :id', { id: clientId });
  if (!client) throw V.notFound('العميل غير موجود');
  const issuerId = V.str(params.issuer_id, 'الشركة', { max: 40 });
  const from = V.date(params.from, 'من تاريخ', { def: '' }) || '';
  const to = V.date(params.to, 'إلى تاريخ', { def: '' }) || '';
  const issuer = issuerId ? db.get('SELECT id, name_ar, code, tax_number, currency FROM issuers WHERE id = :id', { id: issuerId }) : null;
  if (issuerId && !issuer) throw V.notFound('الشركة المصدرة غير موجودة');

  const baseFilter = `
    WHERE l.client_id = :client
      AND (:issuer = '' OR l.issuer_id = :issuer)`;

  // الرصيد قبل بداية الفترة
  const before = db.get(
    `SELECT COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
       FROM client_ledger l ${baseFilter} AND (:from <> '' AND l.transaction_date < :from)`,
    { client: clientId, issuer: issuerId || '', from },
  );
  const openingMinor = from ? Number(before.debit) - Number(before.credit) : 0;

  const rows = db.all(
    `SELECT l.*, s.name_ar AS issuer_name, s.code AS issuer_code
       FROM client_ledger l LEFT JOIN issuers s ON s.id = l.issuer_id
       ${baseFilter}
        AND (:from = '' OR l.transaction_date >= :from)
        AND (:to = '' OR l.transaction_date <= :to)
      ORDER BY l.transaction_date, CASE l.doc_type WHEN 'OPENING_BALANCE' THEN 0 WHEN 'INVOICE' THEN 1 WHEN 'INVOICE_CANCEL' THEN 2 WHEN 'RECEIPT' THEN 3 WHEN 'RECEIPT_CANCEL' THEN 4 ELSE 5 END, l.created_at`,
    { client: clientId, issuer: issuerId || '', from, to },
  );

  let balance = openingMinor;
  const entries = rows.map((r) => {
    balance += Number(r.debit) - Number(r.credit);
    return {
      id: r.id,
      doc_type: r.doc_type,
      doc_type_label: DOC_LABELS[r.doc_type] || r.doc_type,
      doc_id: r.doc_id,
      doc_number: r.doc_number,
      issuer_id: r.issuer_id,
      issuer_name: r.issuer_name || '—',
      transaction_date: r.transaction_date,
      debit: M.toMajor(r.debit),
      credit: M.toMajor(r.credit),
      balance_after: M.toMajor(balance),
      description: r.description,
    };
  });

  const totalDebit = rows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = rows.reduce((s, r) => s + Number(r.credit), 0);

  // ملخص الفواتير المفتوحة
  const open = db.get(
    `SELECT COUNT(*) AS c, COALESCE(SUM(remaining_amount),0) AS rem
       FROM invoices WHERE client_id = :client AND status IN ('UNPAID','PARTIAL')
         AND (:issuer = '' OR issuer_id = :issuer)`,
    { client: clientId, issuer: issuerId || '' },
  );

  return {
    client: {
      id: client.id,
      code: client.client_code,
      name: client.name,
      phone: client.phone || client.mobile,
      tax_number: client.tax_number,
      city: client.city,
      address: client.address,
      opening_balance: M.toMajor(client.opening_balance),
      credit_limit: M.toMajor(client.credit_limit),
    },
    issuer: issuer ? { id: issuer.id, name: issuer.name_ar, code: issuer.code, tax_number: issuer.tax_number, currency: issuer.currency } : null,
    scope: issuerId ? 'ISSUER' : 'ALL',
    period: { from: from || null, to: to || null },
    opening_balance_period: M.toMajor(openingMinor),
    includes_opening_balance_row: !issuerId,
    entries,
    totals: {
      debit: M.toMajor(totalDebit),
      credit: M.toMajor(totalCredit),
      closing_balance: M.toMajor(balance),
      open_invoices_count: open.c,
      open_invoices_remaining: M.toMajor(open.rem),
    },
    generated_at: db.nowIso(),
  };
}

/** أرصدة كل العملاء (تقرير الأرصدة). */
function balances({ issuerId = '', onlyDebtors = false } = {}) {
  const rows = db.all(
    `SELECT c.id, c.client_code, c.name, c.phone, c.mobile, c.credit_limit,
            COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
       FROM clients c LEFT JOIN client_ledger l
         ON l.client_id = c.id AND (:issuer = '' OR l.issuer_id = :issuer)
      GROUP BY c.id
      ORDER BY (COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)) DESC`,
    { issuer: issuerId || '' },
  );
  const items = rows
    .map((r) => ({
      client_id: r.id,
      client_code: r.client_code,
      name: r.name,
      phone: r.phone || r.mobile,
      debit: M.toMajor(r.debit),
      credit: M.toMajor(r.credit),
      balance: M.toMajor(Number(r.debit) - Number(r.credit)),
      credit_limit: M.toMajor(r.credit_limit),
      over_limit: r.credit_limit > 0 && Number(r.debit) - Number(r.credit) > r.credit_limit,
    }))
    .filter((r) => (onlyDebtors ? r.balance > 0 : true));
  return {
    items,
    totals: {
      debit: items.reduce((s, r) => s + r.debit, 0),
      credit: items.reduce((s, r) => s + r.credit, 0),
      balance: Math.round(items.reduce((s, r) => s + r.balance, 0) * 100) / 100,
    },
  };
}

module.exports = { statement, balances, DOC_LABELS };
