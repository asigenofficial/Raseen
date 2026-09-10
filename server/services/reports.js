'use strict';
/** التقارير ولوحة المعلومات. */
const db = require('../db');
const M = require('../lib/money');
const V = require('../lib/validate');

function periodFilters(params = {}) {
  return {
    issuer: params.issuer_id || '',
    client: params.client_id || '',
    from: V.date(params.from, 'من تاريخ', { def: '' }) || '',
    to: V.date(params.to, 'إلى تاريخ', { def: '' }) || '',
  };
}

const ACTIVE = "i.status <> 'CANCELLED'";
const WHERE_PERIOD = `
  WHERE ${ACTIVE}
    AND (:issuer = '' OR i.issuer_id = :issuer)
    AND (:client = '' OR i.client_id = :client)
    AND (:from = '' OR i.issue_date >= :from)
    AND (:to = '' OR i.issue_date <= :to)`;

/** لوحة المعلومات الرئيسية. */
function dashboard(params = {}) {
  const f = periodFilters(params);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const counts = db.get(
    `SELECT
       (SELECT COUNT(*) FROM issuers WHERE is_active = 1) AS issuers,
       (SELECT COUNT(*) FROM clients WHERE is_active = 1) AS clients,
       (SELECT COUNT(*) FROM items WHERE is_active = 1) AS items,
       (SELECT COUNT(*) FROM invoices) AS invoices,
       (SELECT COUNT(*) FROM receipt_vouchers WHERE status = 'ACTIVE') AS vouchers,
       (SELECT COUNT(*) FROM invoice_batches) AS batches`,
  );

  const scoped = (extraWhere, extraParams = {}) => db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(i.grand_total),0) AS total,
            COALESCE(SUM(i.tax_amount),0) AS tax, COALESCE(SUM(i.paid_amount),0) AS paid,
            COALESCE(SUM(i.remaining_amount),0) AS remaining
       FROM invoices i WHERE ${ACTIVE} AND (:issuer = '' OR i.issuer_id = :issuer) ${extraWhere}`,
    { issuer: f.issuer, ...extraParams },
  );

  const todayAgg = scoped('AND i.issue_date = :d', { d: today });
  const monthAgg = scoped('AND i.issue_date >= :d', { d: monthStart });
  const allAgg = scoped('');

  const byStatus = db.all(
    `SELECT i.status, COUNT(*) AS count, COALESCE(SUM(i.grand_total),0) AS total
       FROM invoices i WHERE (:issuer = '' OR i.issuer_id = :issuer) GROUP BY i.status`,
    { issuer: f.issuer },
  ).map((r) => ({ status: r.status, count: r.count, total: M.toMajor(r.total) }));

  const monthly = db.all(
    `SELECT substr(i.issue_date, 1, 7) AS month, COUNT(*) AS count,
            COALESCE(SUM(i.grand_total),0) AS total, COALESCE(SUM(i.tax_amount),0) AS tax
       FROM invoices i WHERE ${ACTIVE} AND (:issuer = '' OR i.issuer_id = :issuer)
      GROUP BY month ORDER BY month DESC LIMIT 12`,
    { issuer: f.issuer },
  ).map((r) => ({ month: r.month, count: r.count, total: M.toMajor(r.total), tax: M.toMajor(r.tax) })).reverse();

  const topClients = db.all(
    `SELECT c.id, c.name, c.client_code, COUNT(*) AS invoices,
            COALESCE(SUM(i.grand_total),0) AS total, COALESCE(SUM(i.remaining_amount),0) AS remaining
       FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE ${ACTIVE} AND (:issuer = '' OR i.issuer_id = :issuer)
      GROUP BY c.id ORDER BY total DESC LIMIT 8`,
    { issuer: f.issuer },
  ).map((r) => ({
    client_id: r.id, name: r.name, code: r.client_code, invoices: r.invoices,
    total: M.toMajor(r.total), remaining: M.toMajor(r.remaining),
  }));

  const topItems = db.all(
    `SELECT ii.item_name, ii.item_code, SUM(ii.quantity) AS qty, COALESCE(SUM(ii.total_line),0) AS total
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE ${ACTIVE} AND (:issuer = '' OR i.issuer_id = :issuer)
      GROUP BY ii.item_name ORDER BY total DESC LIMIT 8`,
    { issuer: f.issuer },
  ).map((r) => ({ item_name: r.item_name, item_code: r.item_code, quantity: Math.round(r.qty * 1000) / 1000, total: M.toMajor(r.total) }));

  const byIssuer = db.all(
    `SELECT s.id, s.name_ar AS name, s.code, COUNT(i.id) AS invoices,
            COALESCE(SUM(i.grand_total),0) AS total, COALESCE(SUM(i.remaining_amount),0) AS remaining
       FROM issuers s LEFT JOIN invoices i ON i.issuer_id = s.id AND i.status <> 'CANCELLED'
      GROUP BY s.id ORDER BY total DESC`,
  ).map((r) => ({
    issuer_id: r.id, name: r.name, code: r.code, invoices: r.invoices,
    total: M.toMajor(r.total), remaining: M.toMajor(r.remaining),
  }));

  const recent = db.all(
    `SELECT i.id, i.invoice_number, i.issue_date, i.grand_total, i.status, c.name AS client_name, s.name_ar AS issuer_name
       FROM invoices i JOIN clients c ON c.id = i.client_id JOIN issuers s ON s.id = i.issuer_id
      WHERE (:issuer = '' OR i.issuer_id = :issuer)
      ORDER BY i.created_at DESC LIMIT 10`,
    { issuer: f.issuer },
  ).map((r) => ({ ...r, grand_total: M.toMajor(r.grand_total) }));

  const money = (agg) => ({
    count: agg.count,
    total: M.toMajor(agg.total),
    tax: M.toMajor(agg.tax),
    paid: M.toMajor(agg.paid),
    remaining: M.toMajor(agg.remaining),
  });

  return {
    counts,
    today: money(todayAgg),
    month: money(monthAgg),
    all: money(allAgg),
    by_status: byStatus,
    monthly,
    top_clients: topClients,
    top_items: topItems,
    by_issuer: byIssuer,
    recent_invoices: recent,
    generated_at: db.nowIso(),
  };
}

/** تقرير المبيعات مع تجميع مرن. */
function sales(params = {}) {
  const f = periodFilters(params);
  const groupBy = V.oneOf(params.group_by, 'التجميع', ['day', 'month', 'client', 'issuer', 'item', 'category'], 'month');
  let sql;
  if (groupBy === 'day' || groupBy === 'month') {
    const expr = groupBy === 'day' ? 'i.issue_date' : "substr(i.issue_date, 1, 7)";
    sql = `SELECT ${expr} AS label, COUNT(*) AS count, COALESCE(SUM(i.subtotal),0) AS subtotal,
                  COALESCE(SUM(i.discount_amount),0) AS discount, COALESCE(SUM(i.tax_amount),0) AS tax,
                  COALESCE(SUM(i.grand_total),0) AS total, COALESCE(SUM(i.paid_amount),0) AS paid
             FROM invoices i ${WHERE_PERIOD} GROUP BY label ORDER BY label`;
  } else if (groupBy === 'client') {
    sql = `SELECT c.name AS label, COUNT(*) AS count, COALESCE(SUM(i.subtotal),0) AS subtotal,
                  COALESCE(SUM(i.discount_amount),0) AS discount, COALESCE(SUM(i.tax_amount),0) AS tax,
                  COALESCE(SUM(i.grand_total),0) AS total, COALESCE(SUM(i.paid_amount),0) AS paid
             FROM invoices i JOIN clients c ON c.id = i.client_id ${WHERE_PERIOD}
            GROUP BY c.id ORDER BY total DESC`;
  } else if (groupBy === 'issuer') {
    sql = `SELECT s.name_ar AS label, COUNT(*) AS count, COALESCE(SUM(i.subtotal),0) AS subtotal,
                  COALESCE(SUM(i.discount_amount),0) AS discount, COALESCE(SUM(i.tax_amount),0) AS tax,
                  COALESCE(SUM(i.grand_total),0) AS total, COALESCE(SUM(i.paid_amount),0) AS paid
             FROM invoices i JOIN issuers s ON s.id = i.issuer_id ${WHERE_PERIOD}
            GROUP BY s.id ORDER BY total DESC`;
  } else if (groupBy === 'item') {
    sql = `SELECT ii.item_name AS label, COUNT(DISTINCT i.id) AS count, COALESCE(SUM(ii.taxable),0) AS subtotal,
                  COALESCE(SUM(ii.discount),0) AS discount, COALESCE(SUM(ii.tax_amount),0) AS tax,
                  COALESCE(SUM(ii.total_line),0) AS total, 0 AS paid, SUM(ii.quantity) AS quantity
             FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id ${WHERE_PERIOD}
            GROUP BY ii.item_name ORDER BY total DESC`;
  } else {
    sql = `SELECT COALESCE(cat.name, 'بدون مجموعة') AS label, COUNT(DISTINCT i.id) AS count,
                  COALESCE(SUM(ii.taxable),0) AS subtotal, COALESCE(SUM(ii.discount),0) AS discount,
                  COALESCE(SUM(ii.tax_amount),0) AS tax, COALESCE(SUM(ii.total_line),0) AS total, 0 AS paid,
                  SUM(ii.quantity) AS quantity
             FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
             LEFT JOIN items it ON it.id = ii.item_id
             LEFT JOIN item_categories cat ON cat.id = it.category_id ${WHERE_PERIOD}
            GROUP BY label ORDER BY total DESC`;
  }
  const rows = db.all(sql, f);
  const items = rows.map((r) => ({
    label: r.label,
    count: r.count,
    quantity: r.quantity === undefined ? undefined : Math.round(r.quantity * 1000) / 1000,
    subtotal: M.toMajor(r.subtotal),
    discount: M.toMajor(r.discount),
    tax: M.toMajor(r.tax),
    total: M.toMajor(r.total),
    paid: M.toMajor(r.paid),
  }));
  const totals = items.reduce((acc, r) => ({
    count: acc.count + r.count,
    subtotal: acc.subtotal + r.subtotal,
    discount: acc.discount + r.discount,
    tax: acc.tax + r.tax,
    total: acc.total + r.total,
    paid: acc.paid + r.paid,
  }), { count: 0, subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0 });
  Object.keys(totals).forEach((k) => { totals[k] = Math.round(totals[k] * 100) / 100; });
  return { group_by: groupBy, period: { from: f.from, to: f.to }, items, totals };
}

/** تقرير ضريبة القيمة المضافة (إقرار). */
function vat(params = {}) {
  const f = periodFilters(params);
  const rows = db.all(
    `SELECT s.id AS issuer_id, s.name_ar AS issuer_name, s.tax_number,
            COUNT(*) AS invoices, COALESCE(SUM(i.taxable_amount),0) AS taxable,
            COALESCE(SUM(i.tax_amount),0) AS tax, COALESCE(SUM(i.grand_total),0) AS total
       FROM invoices i JOIN issuers s ON s.id = i.issuer_id ${WHERE_PERIOD}
      GROUP BY s.id ORDER BY total DESC`,
    f,
  ).map((r) => ({
    issuer_id: r.issuer_id,
    issuer_name: r.issuer_name,
    tax_number: r.tax_number,
    invoices: r.invoices,
    taxable: M.toMajor(r.taxable),
    tax: M.toMajor(r.tax),
    total: M.toMajor(r.total),
  }));
  const totals = rows.reduce((a, r) => ({
    invoices: a.invoices + r.invoices,
    taxable: Math.round((a.taxable + r.taxable) * 100) / 100,
    tax: Math.round((a.tax + r.tax) * 100) / 100,
    total: Math.round((a.total + r.total) * 100) / 100,
  }), { invoices: 0, taxable: 0, tax: 0, total: 0 });
  return { period: { from: f.from, to: f.to }, items: rows, totals };
}

/** تقرير أعمار الذمم (Aging). */
function aging(params = {}) {
  const asOf = V.date(params.as_of, 'حتى تاريخ', { def: new Date().toISOString().slice(0, 10) });
  const issuer = params.issuer_id || '';
  const rows = db.all(
    `SELECT c.id AS client_id, c.name, c.client_code, i.issue_date, i.remaining_amount
       FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.status IN ('UNPAID','PARTIAL') AND i.remaining_amount > 0
        AND i.issue_date <= :asOf AND (:issuer = '' OR i.issuer_id = :issuer)`,
    { asOf, issuer },
  );
  const map = new Map();
  const asOfTime = new Date(`${asOf}T00:00:00Z`).getTime();
  for (const r of rows) {
    const days = Math.floor((asOfTime - new Date(`${r.issue_date}T00:00:00Z`).getTime()) / 86400000);
    const bucket = days <= 30 ? 'b0_30' : days <= 60 ? 'b31_60' : days <= 90 ? 'b61_90' : 'b90_plus';
    if (!map.has(r.client_id)) {
      map.set(r.client_id, { client_id: r.client_id, name: r.name, code: r.client_code, b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0, total: 0 });
    }
    const row = map.get(r.client_id);
    row[bucket] += r.remaining_amount;
    row.total += r.remaining_amount;
  }
  const items = Array.from(map.values())
    .map((r) => ({
      ...r,
      b0_30: M.toMajor(r.b0_30), b31_60: M.toMajor(r.b31_60), b61_90: M.toMajor(r.b61_90),
      b90_plus: M.toMajor(r.b90_plus), total: M.toMajor(r.total),
    }))
    .sort((a, b) => b.total - a.total);
  const totals = items.reduce((a, r) => ({
    b0_30: a.b0_30 + r.b0_30, b31_60: a.b31_60 + r.b31_60, b61_90: a.b61_90 + r.b61_90,
    b90_plus: a.b90_plus + r.b90_plus, total: a.total + r.total,
  }), { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0, total: 0 });
  Object.keys(totals).forEach((k) => { totals[k] = Math.round(totals[k] * 100) / 100; });
  return { as_of: asOf, items, totals };
}

/** سجل التدقيق. */
function auditLog(params = {}) {
  const limit = V.int(params.limit, 'limit', { min: 1, max: 1000, def: 200 });
  const offset = V.int(params.offset, 'offset', { min: 0, max: 1e9, def: 0 });
  const filters = {
    q: params.q || '',
    like: `%${params.q || ''}%`,
    action: params.action || '',
    entity: params.entity_type || '',
    user: params.user || '',
    from: params.from || '',
    to: params.to || '',
  };
  const where = `
    WHERE (:q = '' OR user_name LIKE :like OR action LIKE :like OR entity_id LIKE :like OR details LIKE :like)
      AND (:action = '' OR action = :action)
      AND (:entity = '' OR entity_type = :entity)
      AND (:user = '' OR user_name = :user)
      AND (:from = '' OR created_at >= :from)
      AND (:to = '' OR created_at <= :to)`;
  const rows = db.all(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT :lim OFFSET :off`,
    { ...filters, lim: limit, off: offset },
  );
  const count = db.pluck(`SELECT COUNT(*) AS c FROM audit_logs ${where}`, filters);
  return {
    items: rows.map((r) => ({
      id: r.id,
      user_name: r.user_name,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      issuer_id: r.issuer_id,
      details: (() => { try { return JSON.parse(r.details); } catch { return {}; } })(),
      ip: r.ip,
      created_at: r.created_at,
    })),
    total_count: count,
    limit,
    offset,
  };
}

module.exports = { dashboard, sales, vat, aging, auditLog };
