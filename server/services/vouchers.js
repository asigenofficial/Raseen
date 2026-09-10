'use strict';
/**
 * سندات القبض والسداد: سند لفاتورة واحدة، سند مجمع لعدة فواتير، سداد جزئي،
 * توزيع آلي (الأقدم أولاً) أو يدوي، والترحيل لكشف الحساب.
 */
const db = require('../db');
const V = require('../lib/validate');
const M = require('../lib/money');
const { uuid, formatSerial } = require('../lib/ids');
const issuersSvc = require('./issuers');
const invoicesSvc = require('./invoices');

const PAYMENT_TYPES = ['CASH', 'TRANSFER', 'CHEQUE', 'CARD'];
const PAYMENT_LABELS = { CASH: 'نقداً', TRANSFER: 'تحويل بنكي', CHEQUE: 'شيك', CARD: 'شبكة' };

function allocateVoucherNumber(issuerRow) {
  let next = issuerRow.voucher_next_no || 1;
  let number = formatSerial(issuerRow.voucher_prefix, next, 5);
  let guard = 0;
  while (db.get('SELECT id FROM receipt_vouchers WHERE issuer_id = :i AND voucher_number = :n', { i: issuerRow.id, n: number })) {
    next += 1;
    number = formatSerial(issuerRow.voucher_prefix, next, 5);
    if (++guard > 100000) throw V.bad('تعذر توليد رقم سند فريد');
  }
  db.run('UPDATE issuers SET voucher_next_no = :n WHERE id = :id', { n: next + 1, id: issuerRow.id });
  return number;
}

function mapVoucher(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    voucher_number: row.voucher_number,
    issuer_id: row.issuer_id,
    issuer_name: row.issuer_name,
    client_id: row.client_id,
    client_name: row.client_name,
    client_code: row.client_code,
    voucher_date: row.voucher_date,
    total_amount: M.toMajor(row.total_amount),
    allocated_total: M.toMajor(row.allocated_total),
    unallocated: M.toMajor(row.total_amount - row.allocated_total),
    payment_type: row.payment_type,
    payment_label: PAYMENT_LABELS[row.payment_type] || row.payment_type,
    reference_no: row.reference_no,
    notes: row.notes,
    status: row.status,
    status_label: row.status === 'ACTIVE' ? 'نشط' : 'ملغى',
    created_by: row.created_by,
    created_at: row.created_at,
    ...extra,
  };
}

const VOUCHER_SELECT = `
  SELECT v.*, s.name_ar AS issuer_name, c.name AS client_name, c.client_code AS client_code
    FROM receipt_vouchers v
    JOIN issuers s ON s.id = v.issuer_id
    JOIN clients c ON c.id = v.client_id`;

function getById(id) {
  const row = db.get(`${VOUCHER_SELECT} WHERE v.id = :id`, { id });
  if (!row) throw V.notFound('سند القبض غير موجود');
  const allocations = db.all(
    `SELECT a.id, a.invoice_id, a.allocated_amount, i.invoice_number, i.issue_date, i.grand_total,
            i.paid_amount, i.remaining_amount, i.status
       FROM voucher_allocations a JOIN invoices i ON i.id = a.invoice_id
      WHERE a.voucher_id = :id ORDER BY i.issue_date`,
    { id },
  ).map((a) => ({
    id: a.id,
    invoice_id: a.invoice_id,
    invoice_number: a.invoice_number,
    issue_date: a.issue_date,
    allocated_amount: M.toMajor(a.allocated_amount),
    invoice_total: M.toMajor(a.grand_total),
    invoice_paid: M.toMajor(a.paid_amount),
    invoice_remaining: M.toMajor(a.remaining_amount),
    invoice_status: a.status,
  }));
  return mapVoucher(row, { allocations });
}

function postLedgerForVoucher(voucher) {
  db.run(
    `INSERT INTO client_ledger (id, client_id, issuer_id, doc_type, doc_id, doc_number, transaction_date,
        debit, credit, description, created_at)
     VALUES (:id, :client_id, :issuer_id, 'RECEIPT', :doc_id, :doc_number, :date, 0, :credit, :description, :created_at)`,
    {
      id: uuid(),
      client_id: voucher.client_id,
      issuer_id: voucher.issuer_id,
      doc_id: voucher.id,
      doc_number: voucher.voucher_number,
      date: voucher.voucher_date,
      credit: voucher.total_amount,
      description: `سند قبض رقم ${voucher.voucher_number}`,
      created_at: db.nowIso(),
    },
  );
}

/**
 * إنشاء سند قبض.
 * payload: { issuer_id, client_id, voucher_date, total_amount, payment_type, reference_no, notes,
 *            allocations: [{ invoice_id, amount }], auto_allocate: bool }
 */
function create(payload, ctx = {}) {
  const actor = ctx.actor || 'system';
  const issuerId = V.str(payload.issuer_id, 'الشركة المصدرة', { required: true, max: 40 });
  const clientId = V.str(payload.client_id, 'العميل', { required: true, max: 40 });
  const issuer = issuersSvc.getRaw(issuerId);
  const client = db.get('SELECT * FROM clients WHERE id = :id', { id: clientId });
  if (!client) throw V.notFound('العميل غير موجود');

  const voucherDate = V.date(payload.voucher_date, 'تاريخ السند', { def: new Date().toISOString().slice(0, 10) });
  const paymentType = V.oneOf(payload.payment_type, 'طريقة السداد', PAYMENT_TYPES, 'CASH');
  const referenceNo = V.str(payload.reference_no, 'المرجع', { max: 60 });
  const notes = V.str(payload.notes, 'الملاحظات', { max: 1000 });
  const totalMinor = M.toMinor(V.num(payload.total_amount, 'المبلغ', { required: true, min: 0.01, max: 1e11 }));
  const manualNumber = V.str(payload.voucher_number, 'رقم السند', { max: 40 });

  return db.tx(() => {
    // تحديد التوزيع
    let allocations = [];
    if (V.bool(payload.auto_allocate, false)) {
      let remaining = totalMinor;
      const open = db.all(
        `SELECT id, remaining_amount FROM invoices
          WHERE client_id = :c AND issuer_id = :i AND status IN ('UNPAID','PARTIAL') AND remaining_amount > 0
          ORDER BY issue_date, created_at`,
        { c: clientId, i: issuerId },
      );
      for (const inv of open) {
        if (remaining <= 0) break;
        const amount = Math.min(remaining, inv.remaining_amount);
        allocations.push({ invoice_id: inv.id, amount });
        remaining -= amount;
      }
    } else {
      allocations = V.arr(payload.allocations, 'التوزيع', { max: 1000 }).map((a, idx) => ({
        invoice_id: V.str(a.invoice_id, `التوزيع ${idx + 1} - الفاتورة`, { required: true, max: 40 }),
        amount: M.toMinor(V.num(a.amount, `التوزيع ${idx + 1} - المبلغ`, { required: true, min: 0, max: 1e11 })),
      })).filter((a) => a.amount > 0);
    }

    let allocatedTotal = 0;
    for (const a of allocations) {
      const inv = db.get('SELECT * FROM invoices WHERE id = :id', { id: a.invoice_id });
      if (!inv) throw V.bad('إحدى الفواتير المحددة غير موجودة');
      if (inv.client_id !== clientId) throw V.bad(`الفاتورة ${inv.invoice_number} لا تنتمي لهذا العميل`);
      if (inv.issuer_id !== issuerId) throw V.bad(`الفاتورة ${inv.invoice_number} صادرة من شركة أخرى`);
      if (inv.status === 'CANCELLED') throw V.bad(`الفاتورة ${inv.invoice_number} ملغاة`);
      if (a.amount > inv.remaining_amount) {
        throw V.bad(`المبلغ الموزّع على الفاتورة ${inv.invoice_number} (${M.fmt(a.amount)}) يتجاوز المتبقي عليها (${M.fmt(inv.remaining_amount)})`);
      }
      allocatedTotal += a.amount;
    }
    if (allocatedTotal > totalMinor) throw V.bad('مجموع التوزيع يتجاوز مبلغ السند');

    const voucherNumber = manualNumber || allocateVoucherNumber(issuer);
    if (manualNumber && db.get('SELECT id FROM receipt_vouchers WHERE issuer_id = :i AND voucher_number = :n', { i: issuerId, n: manualNumber })) {
      throw V.conflict(`رقم السند «${manualNumber}» مستخدم مسبقاً لهذه الشركة`);
    }

    const id = uuid();
    const now = db.nowIso();
    const voucher = {
      id,
      voucher_number: voucherNumber,
      issuer_id: issuerId,
      client_id: clientId,
      voucher_date: voucherDate,
      total_amount: totalMinor,
      allocated_total: allocatedTotal,
      payment_type: paymentType,
      reference_no: referenceNo,
      notes,
      status: 'ACTIVE',
      created_by: actor,
      created_at: now,
      updated_at: now,
    };
    db.run(
      `INSERT INTO receipt_vouchers (id, voucher_number, issuer_id, client_id, voucher_date, total_amount,
          allocated_total, payment_type, reference_no, notes, status, created_by, created_at, updated_at)
       VALUES (:id, :voucher_number, :issuer_id, :client_id, :voucher_date, :total_amount,
          :allocated_total, :payment_type, :reference_no, :notes, :status, :created_by, :created_at, :updated_at)`,
      voucher,
    );
    for (const a of allocations) {
      db.run(
        `INSERT INTO voucher_allocations (id, voucher_id, invoice_id, allocated_amount, created_at)
         VALUES (:id, :voucher_id, :invoice_id, :amount, :created_at)`,
        { id: uuid(), voucher_id: id, invoice_id: a.invoice_id, amount: a.amount, created_at: now },
      );
      invoicesSvc.recalcInvoiceStatus(a.invoice_id);
    }
    postLedgerForVoucher(voucher);
    db.audit({
      user: actor, action: 'VOUCHER_CREATE', entityType: 'receipt_voucher', entityId: id, issuerId,
      details: { voucher_number: voucherNumber, amount: M.fmt(totalMinor), invoices: allocations.length, client: client.name },
    });
    return getById(id);
  });
}

/** سند قبض سريع لفاتورة واحدة (كامل أو جزئي). */
function createForInvoice(payload, ctx = {}) {
  const invoiceId = V.str(payload.invoice_id, 'الفاتورة', { required: true, max: 40 });
  const inv = db.get('SELECT * FROM invoices WHERE id = :id', { id: invoiceId });
  if (!inv) throw V.notFound('الفاتورة غير موجودة');
  if (inv.status === 'CANCELLED') throw V.bad('الفاتورة ملغاة');
  if (inv.remaining_amount <= 0) throw V.bad('الفاتورة مسددة بالكامل');
  const amountMajor = payload.amount === undefined || payload.amount === '' || payload.amount === null
    ? M.toMajor(inv.remaining_amount)
    : V.num(payload.amount, 'المبلغ', { required: true, min: 0.01, max: 1e11 });
  return create({
    issuer_id: inv.issuer_id,
    client_id: inv.client_id,
    voucher_date: payload.voucher_date,
    total_amount: amountMajor,
    payment_type: payload.payment_type,
    reference_no: payload.reference_no,
    notes: payload.notes,
    voucher_number: payload.voucher_number,
    allocations: [{ invoice_id: invoiceId, amount: amountMajor }],
  }, ctx);
}

function search(params = {}) {
  const limit = V.int(params.limit, 'limit', { min: 1, max: 1000, def: 100 });
  const offset = V.int(params.offset, 'offset', { min: 0, max: 1e9, def: 0 });
  const minAmt = params.min_amount === undefined || params.min_amount === '' ? -1
    : M.toMinor(V.num(params.min_amount, 'أقل مبلغ', { min: 0, max: 1e11, def: 0 }));
  const maxAmt = params.max_amount === undefined || params.max_amount === '' ? -1
    : M.toMinor(V.num(params.max_amount, 'أعلى مبلغ', { min: 0, max: 1e11, def: 0 }));

  const filters = {
    issuer: params.issuer_id || '',
    client: params.client_id || '',
    status: params.status || '',
    pay_type: params.payment_type || '',
    from: params.from || '',
    to: params.to || '',
    min_amt: minAmt,
    max_amt: maxAmt,
    q: params.q || '',
    like: `%${params.q || ''}%`,
  };
  const where = `
    WHERE (:issuer = '' OR v.issuer_id = :issuer)
      AND (:client = '' OR v.client_id = :client)
      AND (:status = '' OR v.status = :status)
      AND (:pay_type = '' OR v.payment_type = :pay_type)
      AND (:from = '' OR v.voucher_date >= :from)
      AND (:to = '' OR v.voucher_date <= :to)
      AND (:min_amt < 0 OR v.total_amount >= :min_amt)
      AND (:max_amt < 0 OR v.total_amount <= :max_amt)
      AND (:q = '' OR v.voucher_number LIKE :like OR v.reference_no LIKE :like OR c.name LIKE :like OR c.client_code LIKE :like OR v.notes LIKE :like)`;

  const sortMap = {
    date: 'v.voucher_date %DIR%, v.created_at %DIR%',
    number: 'v.voucher_number %DIR%',
    amount: 'v.total_amount %DIR%',
    client: 'c.name %DIR%',
  };
  const sortDir = String(params.sort_dir || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const sortCol = sortMap[params.sort_by]
    ? sortMap[params.sort_by].replace(/%DIR%/g, sortDir)
    : `v.voucher_date ${sortDir}, v.created_at ${sortDir}`;

  const rows = db.all(
    `${VOUCHER_SELECT} ${where} ORDER BY ${sortCol} LIMIT :lim OFFSET :off`,
    { ...filters, lim: limit, off: offset },
  );
  const agg = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(v.total_amount),0) AS total
       FROM receipt_vouchers v JOIN clients c ON c.id = v.client_id ${where}`,
    filters,
  );
  return {
    items: rows.map((r) => mapVoucher(r)),
    total_count: agg.count,
    totals: { total_amount: M.toMajor(agg.total) },
    limit,
    offset,
  };
}

function cancel(id, reason, ctx = {}) {
  const row = db.get('SELECT * FROM receipt_vouchers WHERE id = :id', { id });
  if (!row) throw V.notFound('سند القبض غير موجود');
  if (row.status === 'CANCELLED') throw V.bad('السند ملغى مسبقاً');
  return db.tx(() => {
    const invoiceIds = db.all('SELECT invoice_id FROM voucher_allocations WHERE voucher_id = :id', { id }).map((r) => r.invoice_id);
    const now = db.nowIso();
    const today = now.slice(0, 10);
    db.run(
      "UPDATE receipt_vouchers SET status = 'CANCELLED', notes = :notes, updated_at = :now WHERE id = :id",
      { id, now, notes: `${row.notes || ''}\n[ملغى] ${reason || ''}`.trim() },
    );
    // قيد عكسي بدلاً من الحذف لضمان عدم التلاعب وبقاء السجل التاريخي لكشف الحساب
    db.run(
      `INSERT INTO client_ledger (id, client_id, issuer_id, doc_type, doc_id, doc_number, transaction_date,
          debit, credit, description, created_at)
       VALUES (:id, :client_id, :issuer_id, 'RECEIPT_CANCEL', :doc_id, :doc_number, :date, :debit, 0, :description, :created_at)`,
      {
        id: uuid(),
        client_id: row.client_id,
        issuer_id: row.issuer_id,
        doc_id: row.id,
        doc_number: row.voucher_number,
        date: row.voucher_date || today,
        debit: row.total_amount,
        description: `إلغاء سند قبض رقم ${row.voucher_number}${reason ? ` (${reason})` : ''}`,
        created_at: now,
      },
    );
    for (const invId of invoiceIds) invoicesSvc.recalcInvoiceStatus(invId);
    db.audit({
      user: ctx.actor, action: 'VOUCHER_CANCEL', entityType: 'receipt_voucher', entityId: id, issuerId: row.issuer_id,
      details: { voucher_number: row.voucher_number, reason: reason || '', amount: M.fmt(row.total_amount) },
    });
    return getById(id);
  });
}

function remove(id, ctx = {}) {
  const row = db.get('SELECT * FROM receipt_vouchers WHERE id = :id', { id });
  if (!row) throw V.notFound('سند القبض غير موجود');
  return db.tx(() => {
    const invoiceIds = db.all('SELECT invoice_id FROM voucher_allocations WHERE voucher_id = :id', { id }).map((r) => r.invoice_id);
    db.run("DELETE FROM client_ledger WHERE doc_type = 'RECEIPT' AND doc_id = :id", { id });
    db.run('DELETE FROM receipt_vouchers WHERE id = :id', { id });
    for (const invId of invoiceIds) invoicesSvc.recalcInvoiceStatus(invId);
    db.audit({
      user: ctx.actor, action: 'VOUCHER_DELETE', entityType: 'receipt_voucher', entityId: id, issuerId: row.issuer_id,
      details: { voucher_number: row.voucher_number, amount: M.fmt(row.total_amount) },
    });
    return { ok: true };
  });
}

module.exports = { PAYMENT_TYPES, PAYMENT_LABELS, create, createForInvoice, getById, search, cancel, remove, mapVoucher };
