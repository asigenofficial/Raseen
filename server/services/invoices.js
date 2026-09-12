'use strict';
/**
 * محرك الفواتير: الإصدار الفردي، الحسابات، QR، الهاش والسلسلة، UBL XML،
 * الترقيم التلقائي، الترحيل لكشف الحساب.
 */
const db = require('../db');
const V = require('../lib/validate');
const M = require('../lib/money');
const { uuid, formatSerial } = require('../lib/ids');
const zatca = require('../lib/zatca');
const issuersSvc = require('./issuers');

const STATUS_LABELS = {
  UNPAID: 'غير مسددة',
  PARTIAL: 'مسددة جزئياً',
  PAID: 'مسددة',
  CANCELLED: 'ملغاة',
};

const PAYMENT_LABELS = {
  CASH: 'نقداً',
  CARD: 'شبكة',
  TRANSFER: 'تحويل بنكي',
  CREDIT: 'آجل',
  CHEQUE: 'شيك',
};

// ------------------------------------------------------------- الحسابات
/**
 * حساب إجماليات الفاتورة من البنود.
 * كل المبالغ بالهللات (أعداد صحيحة).
 *
 * pricesIncludeTax: عندما تكون الأسعار المدخلة شاملة الضريبة، يُستخرج المبلغ
 * الصافي بالقسمة على (1 + النسبة) ويُعاد تخزين unit_price صافياً، بحيث تبقى
 * كل الحسابات والفاتورة الإلكترونية على أساس صافٍ موحد كما تتطلبه ZATCA،
 * مع بقاء الإجمالي النهائي مطابقاً لما أدخله المستخدم.
 */
function computeTotals(lines, { pricesIncludeTax = false } = {}) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxableTotal = 0;
  let taxTotal = 0;
  const computed = lines.map((l, idx) => {
    const quantity = Number(l.quantity);
    const taxRate = Number(l.tax_rate || 0);
    let unitPrice = Number(l.unit_price);
    if (pricesIncludeTax) unitPrice = M.netFromInclusive(unitPrice, taxRate);
    const gross = M.mulQty(quantity, unitPrice);
    let discount = Number(l.discount || 0);
    if (pricesIncludeTax && discount) discount = M.netFromInclusive(discount, taxRate);
    if (l.discount_percent) discount = M.pct(gross, l.discount_percent);
    if (discount > gross) discount = gross;
    const taxable = gross - discount;
    const taxAmount = M.pct(taxable, taxRate);
    const totalLine = taxable + taxAmount;
    subtotal += gross;
    discountTotal += discount;
    taxableTotal += taxable;
    taxTotal += taxAmount;
    return {
      ...l,
      line_no: idx + 1,
      quantity,
      unit_price: unitPrice,
      discount,
      tax_rate: taxRate,
      taxable,
      tax_amount: taxAmount,
      total_line: totalLine,
    };
  });
  return {
    lines: computed,
    subtotal,
    discount_amount: discountTotal,
    taxable_amount: taxableTotal,
    tax_amount: taxTotal,
    grand_total: taxableTotal + taxTotal,
  };
}

// ------------------------------------------------------------- الترقيم
function allocateInvoiceNumber(issuerRow) {
  let next = issuerRow.invoice_next_no || 1;
  let number = formatSerial(issuerRow.invoice_prefix, next, issuerRow.invoice_pad);
  let guard = 0;
  while (db.get('SELECT id FROM invoices WHERE issuer_id = :i AND invoice_number = :n', { i: issuerRow.id, n: number })) {
    next += 1;
    number = formatSerial(issuerRow.invoice_prefix, next, issuerRow.invoice_pad);
    if (++guard > 100000) throw V.bad('تعذر توليد رقم فاتورة فريد');
  }
  db.run('UPDATE issuers SET invoice_next_no = :n WHERE id = :id', { n: next + 1, id: issuerRow.id });
  return number;
}

function nextSequenceNo(issuerId) {
  const max = db.pluck('SELECT COALESCE(MAX(sequence_no), 0) AS m FROM invoices WHERE issuer_id = :i', { i: issuerId });
  return Number(max || 0) + 1;
}

function previousHash(issuerId) {
  const row = db.get(
    'SELECT invoice_hash FROM invoices WHERE issuer_id = :i ORDER BY sequence_no DESC LIMIT 1',
    { i: issuerId },
  );
  return row && row.invoice_hash ? row.invoice_hash : zatca.GENESIS_PIH;
}

// ------------------------------------------------------- بناء ZATCA للفاتورة
function displayInvoice(inv, taxRateDisplay) {
  return {
    invoice_number: inv.invoice_number,
    uuid: inv.uuid,
    invoice_type: inv.invoice_type,
    issue_date: inv.issue_date,
    issue_time: inv.issue_time,
    subtotal: M.fmt(inv.subtotal),
    discount_amount: M.fmt(inv.discount_amount),
    taxable_amount: M.fmt(inv.taxable_amount),
    tax_amount: M.fmt(inv.tax_amount),
    grand_total: M.fmt(inv.grand_total),
    tax_rate_display: String(taxRateDisplay),
  };
}

function displayLines(lines) {
  return lines.map((l) => ({
    item_name: l.item_name,
    unit: l.unit,
    quantity: String(l.quantity),
    unit_price: M.fmt(l.unit_price),
    taxable: M.fmt(l.taxable),
    tax_amount: M.fmt(l.tax_amount),
    total_line: M.fmt(l.total_line),
    tax_rate: String(l.tax_rate),
  }));
}

/**
 * توليد مواد الفاتورة الإلكترونية: XML، الهاش، التوقيع، حمولة QR.
 */
function buildEinvoice({ inv, issuer, client, lines, sequenceNo, pih, phase }) {
  const taxRate = lines.length ? lines[0].tax_rate : issuer.default_tax_rate;
  const dispInv = displayInvoice(inv, taxRate);
  const xml = zatca.buildUblXml(dispInv, issuer, client, displayLines(lines), {
    icv: sequenceNo,
    pih,
    currency: inv.currency || issuer.currency || 'SAR',
  });
  const hash = zatca.invoiceHash(xml);
  const timestamp = `${inv.issue_date}T${inv.issue_time}Z`;

  const qrFields = {
    sellerName: issuer.name_ar || issuer.name_en,
    vatNumber: issuer.tax_number,
    timestamp,
    total: M.fmt(inv.grand_total),
    vatTotal: M.fmt(inv.tax_amount),
  };

  let signature = '';
  let signatureMode = 'NONE';
  const effectivePhase = phase || inv.zatca_phase || issuer.zatca_phase || 'PHASE1';
  if (effectivePhase === 'PHASE2') {
    let material = issuersSvc.signingMaterial(issuer.id);
    if (!material || !material.privateKeyPem) {
      try {
        issuersSvc.generateSigningKey(issuer.id, 'system');
        material = issuersSvc.signingMaterial(issuer.id);
      } catch {}
    }
    if (material && material.privateKeyPem) {
      signature = zatca.signHash(material.privateKeyPem, hash);
      signatureMode = material.hasProduction && material.certificatePem ? 'PRODUCTION' : 'LOCAL';
      qrFields.invoiceHash = hash;
      qrFields.signature = signature;
      if (material.publicKeyDerBase64) qrFields.publicKey = material.publicKeyDerBase64;
      if (material.certSignatureBase64) qrFields.certSignature = material.certSignatureBase64;
    } else {
      // لا يوجد مفتاح: نضيف الهاش فقط (Tag 6) ونوضح أن التوقيع غير متوفر
      qrFields.invoiceHash = hash;
      signatureMode = 'NONE';
    }
  }

  return { xml, hash, signature, signatureMode, qrPayload: zatca.buildQrPayload(qrFields), zatcaPhase: effectivePhase };
}

// ------------------------------------------------------------- الترحيل
function postLedgerForInvoice(inv, clientId) {
  db.run(
    `INSERT INTO client_ledger (id, client_id, issuer_id, doc_type, doc_id, doc_number, transaction_date,
        debit, credit, description, created_at)
     VALUES (:id, :client_id, :issuer_id, 'INVOICE', :doc_id, :doc_number, :date, :debit, 0, :description, :created_at)`,
    {
      id: uuid(),
      client_id: clientId,
      issuer_id: inv.issuer_id,
      doc_id: inv.id,
      doc_number: inv.invoice_number,
      date: inv.issue_date,
      debit: inv.grand_total,
      description: `فاتورة رقم ${inv.invoice_number}`,
      created_at: db.nowIso(),
    },
  );
}

function removeLedgerForInvoice(invoiceId) {
  db.run("DELETE FROM client_ledger WHERE doc_type = 'INVOICE' AND doc_id = :id", { id: invoiceId });
}

/** إعادة حساب حالة الفاتورة من مخصصات السندات. */
function recalcInvoiceStatus(invoiceId) {
  const inv = db.get('SELECT * FROM invoices WHERE id = :id', { id: invoiceId });
  if (!inv) return null;
  const paid = Number(db.pluck(
    `SELECT COALESCE(SUM(a.allocated_amount), 0) AS s
       FROM voucher_allocations a JOIN receipt_vouchers v ON v.id = a.voucher_id
      WHERE a.invoice_id = :id AND v.status = 'ACTIVE'`,
    { id: invoiceId },
  ) || 0);
  const remaining = inv.grand_total - paid;
  let status = inv.status;
  if (inv.status !== 'CANCELLED') {
    if (paid <= 0) status = 'UNPAID';
    else if (remaining > 0) status = 'PARTIAL';
    else status = 'PAID';
  }
  db.run(
    'UPDATE invoices SET paid_amount = :paid, remaining_amount = :rem, status = :status, updated_at = :now WHERE id = :id',
    { paid, rem: remaining < 0 ? 0 : remaining, status, now: db.nowIso(), id: invoiceId },
  );
  return { paid_amount: paid, remaining_amount: remaining, status };
}

// ------------------------------------------------------------- الإنشاء
function normalizeLines(rawLines) {
  const lines = V.arr(rawLines, 'بنود الفاتورة', { required: true, max: 500 });
  if (!lines.length) throw V.bad('يجب إضافة بند واحد على الأقل للفاتورة');
  return lines.map((l, idx) => {
    const field = `البند ${idx + 1}`;
    let itemId = V.str(l.item_id, `${field} - الصنف`, { max: 40 }) || null;
    let itemRow = null;
    if (itemId) {
      itemRow = db.get('SELECT * FROM items WHERE id = :id', { id: itemId });
      if (!itemRow) itemId = null;
    }
    const name = V.str(l.item_name || (itemRow && itemRow.name_ar), `${field} - اسم الصنف`, { required: true, max: 250 });
    const quantity = V.num(l.quantity, `${field} - الكمية`, { required: true, min: 0.0001, max: 1e7 });
    const unitPriceMajor = V.num(
      l.unit_price === undefined || l.unit_price === '' ? (itemRow ? M.toMajor(itemRow.sale_price) : undefined) : l.unit_price,
      `${field} - سعر الوحدة`, { required: true, min: 0, max: 1e9 },
    );
    const taxRate = V.num(
      l.tax_rate === undefined || l.tax_rate === '' ? (itemRow ? itemRow.tax_rate : 15) : l.tax_rate,
      `${field} - نسبة الضريبة`, { min: 0, max: 100, def: 15 },
    );
    return {
      item_id: itemId,
      item_code: V.str(l.item_code || (itemRow && itemRow.item_code), `${field} - الكود`, { max: 40 }),
      item_name: name,
      unit: V.str(l.unit || (itemRow && itemRow.unit), `${field} - الوحدة`, { max: 40 }) || 'حبة',
      quantity: Math.round(quantity * 1000) / 1000,
      unit_price: M.toMinor(unitPriceMajor),
      discount: M.toMinor(V.num(l.discount, `${field} - الخصم`, { min: 0, max: 1e9, def: 0 })),
      discount_percent: V.num(l.discount_percent, `${field} - نسبة الخصم`, { min: 0, max: 100, def: 0 }),
      tax_rate: taxRate,
    };
  });
}

/**
 * إنشاء فاتورة.
 * @param {object} payload
 * @param {object} ctx { actor, user, can(permission) }
 */
function create(payload, ctx = {}) {
  const actor = ctx.actor || 'system';
  const issuerId = V.str(payload.issuer_id, 'الشركة المصدرة', { required: true, max: 40 });
  const clientId = V.str(payload.client_id, 'العميل', { required: true, max: 40 });
  const issuer = issuersSvc.getRaw(issuerId);
  const client = db.get('SELECT * FROM clients WHERE id = :id', { id: clientId });
  if (!client) throw V.notFound('العميل غير موجود');
  if (!issuer.is_active) throw V.bad('الشركة المصدرة غير نشطة');

  const nowDt = new Date();
  const today = nowDt.toISOString().slice(0, 10);
  const currentTime = nowDt.toISOString().slice(11, 19);
  const issueDate = V.date(payload.issue_date, 'تاريخ الفاتورة', { def: today });
  const issueTime = V.time(payload.issue_time, 'وقت الفاتورة', { def: currentTime });
  if (issueDate !== today && ctx.can && !ctx.can('invoices.backdate')) {
    throw V.forbidden('لا تملك صلاحية إصدار فاتورة بتاريخ غير تاريخ اليوم');
  }
  if (payload.issue_time && ctx.can && !ctx.can('invoices.backdate')) {
    throw V.forbidden('لا تملك صلاحية تحديد وقت مخصص للفاتورة');
  }

  const invoiceType = V.oneOf(payload.invoice_type, 'نوع الفاتورة', ['STANDARD', 'SIMPLIFIED'], 'STANDARD');
  const zatcaPhase = V.oneOf(payload.zatca_phase, 'مرحلة باركود الفاتورة', ['PHASE1', 'PHASE2'], issuer.zatca_phase || 'PHASE1');
  const paymentMethod = V.oneOf(payload.payment_method, 'طريقة الدفع', ['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'CHEQUE'], 'CREDIT');
  const notes = V.str(payload.notes, 'الملاحظات', { max: 2000 });
  const manualNumber = V.str(payload.invoice_number, 'رقم الفاتورة', { max: 40 });
  const pricesIncludeTax = V.bool(payload.prices_include_tax, false);
  const chequeNo = V.str(payload.cheque_no, 'رقم الشيك', { max: 60 });
  const chequeDate = V.date(payload.cheque_date, 'تاريخ الشيك', { def: null });
  if (paymentMethod === 'CHEQUE' && !chequeNo) throw V.bad('رقم الشيك مطلوب عند السداد بشيك');
  // تاريخ الاستحقاق: صريح أو محسوب من مهلة السداد المسجلة على العميل
  let dueDate = V.date(payload.due_date, 'تاريخ الاستحقاق', { def: null });
  if (!dueDate) {
    const terms = Number(client.payment_terms_days || 0);
    if (paymentMethod === 'CREDIT' && terms > 0) {
      dueDate = new Date(new Date(`${issueDate}T00:00:00Z`).getTime() + terms * 86400000).toISOString().slice(0, 10);
    } else if (paymentMethod === 'CHEQUE' && chequeDate) {
      dueDate = chequeDate;
    }
  }
  if (dueDate && dueDate < issueDate) throw V.bad('تاريخ الاستحقاق لا يمكن أن يكون قبل تاريخ الفاتورة');

  let lines = normalizeLines(payload.lines);
  const headerDiscountPercent = V.num(payload.discount_percent, 'نسبة الخصم العام', { min: 0, max: 100, def: 0 });
  if (headerDiscountPercent > 0) {
    lines = lines.map((l) => (l.discount || l.discount_percent ? l : { ...l, discount_percent: headerDiscountPercent }));
  }
  const totals = computeTotals(lines, { pricesIncludeTax });

  const sellerAddress = [issuer.building_no, issuer.street, issuer.district, issuer.city, issuer.postal_code, issuer.country].filter(Boolean).join(' - ');
  const buyerAddress = client.address || client.city || '';

  return db.tx(() => {
    let invoiceNumber = manualNumber;
    if (invoiceNumber) {
      if (db.get('SELECT id FROM invoices WHERE issuer_id = :i AND invoice_number = :n', { i: issuerId, n: invoiceNumber })) {
        throw V.conflict(`رقم الفاتورة «${invoiceNumber}» مستخدم مسبقاً لهذه الشركة`);
      }
    } else {
      invoiceNumber = allocateInvoiceNumber(issuer);
    }
    const sequenceNo = nextSequenceNo(issuerId);
    const pih = previousHash(issuerId);
    const id = uuid();
    const now = db.nowIso();
    const inv = {
      id,
      issuer_id: issuerId,
      client_id: clientId,
      invoice_number: invoiceNumber,
      sequence_no: sequenceNo,
      invoice_type: invoiceType,
      zatca_phase: zatcaPhase,
      uuid: uuid(),
      issue_date: issueDate,
      issue_time: issueTime,
      issue_datetime: `${issueDate}T${issueTime}Z`,
      currency: issuer.currency || 'SAR',
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      taxable_amount: totals.taxable_amount,
      tax_amount: totals.tax_amount,
      grand_total: totals.grand_total,
      paid_amount: 0,
      remaining_amount: totals.grand_total,
      status: 'UNPAID',
      payment_method: paymentMethod,
      due_date: dueDate,
      cheque_date: chequeDate,
      cheque_no: chequeNo,
      prices_include_tax: pricesIncludeTax ? 1 : 0,
      batch_id: payload.batch_id || null,
      seller_name: issuer.name_ar || issuer.name_en || '',
      seller_tax_number: issuer.tax_number || '',
      seller_cr: issuer.commercial_register || '',
      seller_address: sellerAddress,
      buyer_name: client.name || '',
      buyer_tax_number: client.tax_number || '',
      buyer_cr: client.commercial_register || '',
      buyer_address: buyerAddress,
      notes,
      created_by: actor,
      created_at: now,
      updated_at: now,
    };

    const ein = buildEinvoice({ inv, issuer, client, lines: totals.lines, sequenceNo, pih, phase: zatcaPhase });
    inv.qr_payload = ein.qrPayload;
    inv.invoice_hash = ein.hash;
    inv.previous_invoice_hash = pih;
    inv.signature = ein.signature;
    inv.signature_mode = ein.signatureMode;

    db.run(
      `INSERT INTO invoices (id, issuer_id, client_id, invoice_number, sequence_no, invoice_type, zatca_phase, uuid, issue_date,
          issue_time, issue_datetime, currency, subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
          paid_amount, remaining_amount, status, payment_method, due_date, cheque_date, cheque_no, prices_include_tax,
          batch_id, seller_name, seller_tax_number, seller_cr,
          seller_address, buyer_name, buyer_tax_number, buyer_cr, buyer_address, qr_payload, invoice_hash,
          previous_invoice_hash, signature, signature_mode, notes, created_by, created_at, updated_at)
       VALUES (:id, :issuer_id, :client_id, :invoice_number, :sequence_no, :invoice_type, :zatca_phase, :uuid, :issue_date,
          :issue_time, :issue_datetime, :currency, :subtotal, :discount_amount, :taxable_amount, :tax_amount, :grand_total,
          :paid_amount, :remaining_amount, :status, :payment_method, :due_date, :cheque_date, :cheque_no, :prices_include_tax,
          :batch_id, :seller_name, :seller_tax_number, :seller_cr,
          :seller_address, :buyer_name, :buyer_tax_number, :buyer_cr, :buyer_address, :qr_payload, :invoice_hash,
          :previous_invoice_hash, :signature, :signature_mode, :notes, :created_by, :created_at, :updated_at)`,
      inv,
    );

    const insertLine = db.conn().prepare(
      `INSERT INTO invoice_items (id, invoice_id, item_id, line_no, item_code, item_name, unit, quantity,
          unit_price, discount, tax_rate, taxable, tax_amount, total_line)
       VALUES (:id, :invoice_id, :item_id, :line_no, :item_code, :item_name, :unit, :quantity,
          :unit_price, :discount, :tax_rate, :taxable, :tax_amount, :total_line)`,
    );
    for (const l of totals.lines) {
      insertLine.run({
        id: uuid(),
        invoice_id: id,
        item_id: l.item_id,
        line_no: l.line_no,
        item_code: l.item_code || '',
        item_name: l.item_name,
        unit: l.unit,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount: l.discount,
        tax_rate: l.tax_rate,
        taxable: l.taxable,
        tax_amount: l.tax_amount,
        total_line: l.total_line,
      });
    }

    postLedgerForInvoice(inv, clientId);
    db.audit({
      user: actor,
      action: 'INVOICE_CREATE',
      entityType: 'invoice',
      entityId: id,
      issuerId,
      details: { invoice_number: invoiceNumber, total: M.fmt(inv.grand_total), client: client.name },
    });

    // سند قبض تلقائي للفواتير النقدية عند الطلب
    if (V.bool(payload.auto_receipt, false) && paymentMethod !== 'CREDIT' && inv.grand_total > 0) {
      // eslint-disable-next-line global-require
      const vouchers = require('./vouchers');
      vouchers.createForInvoice({
        invoice_id: id,
        amount: M.toMajor(inv.grand_total),
        payment_type: paymentMethod === 'CASH' ? 'CASH' : paymentMethod === 'CARD' ? 'CARD' : 'TRANSFER',
        voucher_date: issueDate,
        notes: `سداد تلقائي للفاتورة ${invoiceNumber}`,
      }, { actor });
    }

    return getById(id);
  });
}

// ------------------------------------------------------------- الاستعلامات
function mapInvoice(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    issuer_id: row.issuer_id,
    issuer_name: row.issuer_name,
    issuer_code: row.issuer_code,
    client_id: row.client_id,
    client_name: row.client_name,
    client_code: row.client_code,
    invoice_number: row.invoice_number,
    sequence_no: row.sequence_no,
    invoice_type: row.invoice_type,
    zatca_phase: row.zatca_phase || 'PHASE1',
    uuid: row.uuid,
    issue_date: row.issue_date,
    issue_time: row.issue_time,
    issue_datetime: row.issue_datetime,
    currency: row.currency,
    subtotal: M.toMajor(row.subtotal),
    discount_amount: M.toMajor(row.discount_amount),
    taxable_amount: M.toMajor(row.taxable_amount),
    tax_amount: M.toMajor(row.tax_amount),
    grand_total: M.toMajor(row.grand_total),
    paid_amount: M.toMajor(row.paid_amount),
    remaining_amount: M.toMajor(row.remaining_amount),
    status: row.status,
    status_label: STATUS_LABELS[row.status] || row.status,
    payment_method: row.payment_method,
    payment_label: PAYMENT_LABELS[row.payment_method] || row.payment_method,
    due_date: row.due_date || null,
    cheque_date: row.cheque_date || null,
    cheque_no: row.cheque_no || '',
    prices_include_tax: !!row.prices_include_tax,
    batch_id: row.batch_id,
    seller_name: row.seller_name || row.issuer_name || '',
    seller_tax_number: row.seller_tax_number || '',
    seller_cr: row.seller_cr || '',
    seller_address: row.seller_address || '',
    buyer_name: row.buyer_name || row.client_name || '',
    buyer_tax_number: row.buyer_tax_number || '',
    buyer_cr: row.buyer_cr || '',
    buyer_address: row.buyer_address || '',
    qr_payload: row.qr_payload,
    invoice_hash: row.invoice_hash,
    previous_invoice_hash: row.previous_invoice_hash,
    signature: row.signature,
    signature_mode: row.signature_mode,
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extra,
  };
}

function mapLine(row) {
  return {
    id: row.id,
    item_id: row.item_id,
    line_no: row.line_no,
    item_code: row.item_code,
    item_name: row.item_name,
    unit: row.unit,
    quantity: row.quantity,
    unit_price: M.toMajor(row.unit_price),
    discount: M.toMajor(row.discount),
    tax_rate: row.tax_rate,
    taxable: M.toMajor(row.taxable),
    tax_amount: M.toMajor(row.tax_amount),
    total_line: M.toMajor(row.total_line),
  };
}

const INVOICE_SELECT = `
  SELECT i.*, s.name_ar AS issuer_name, s.code AS issuer_code, c.name AS client_name, c.client_code AS client_code
    FROM invoices i
    JOIN issuers s ON s.id = i.issuer_id
    JOIN clients c ON c.id = i.client_id`;

function getById(id, { withLines = true } = {}) {
  const row = db.get(`${INVOICE_SELECT} WHERE i.id = :id`, { id });
  if (!row) throw V.notFound('الفاتورة غير موجودة');
  const extra = {};
  if (withLines) {
    extra.lines = db.all('SELECT * FROM invoice_items WHERE invoice_id = :id ORDER BY line_no', { id }).map(mapLine);
    extra.allocations = db.all(
      `SELECT a.allocated_amount, v.voucher_number, v.voucher_date, v.payment_type, v.id AS voucher_id
         FROM voucher_allocations a JOIN receipt_vouchers v ON v.id = a.voucher_id
        WHERE a.invoice_id = :id AND v.status = 'ACTIVE' ORDER BY v.voucher_date`,
      { id },
    ).map((a) => ({ ...a, allocated_amount: M.toMajor(a.allocated_amount) }));
  }
  return mapInvoice(row, extra);
}

function search(params = {}) {
  const limit = V.int(params.limit, 'limit', { min: 1, max: 1000, def: 100 });
  const offset = V.int(params.offset, 'offset', { min: 0, max: 1e9, def: 0 });
  const hasRemaining = V.bool(params.has_remaining || params.only_unpaid, false) ? 1 : 0;
  const filters = {
    issuer: params.issuer_id || '',
    client: params.client_id || '',
    status: params.status || '',
    inv_type: params.invoice_type || '',
    has_rem: hasRemaining,
    from: params.from || '',
    to: params.to || '',
    q: params.q || '',
    like: `%${params.q || ''}%`,
    batch: params.batch_id || '',
    min_total: params.min_total === undefined || params.min_total === '' ? -1
      : M.toMinor(V.num(params.min_total, 'أقل قيمة', { min: 0, max: 1e11, def: 0 })),
    max_total: params.max_total === undefined || params.max_total === '' ? -1
      : M.toMinor(V.num(params.max_total, 'أعلى قيمة', { min: 0, max: 1e11, def: 0 })),
    user: params.created_by || '',
    payment: params.payment_method || '',
  };
  const where = `
    WHERE (:issuer = '' OR i.issuer_id = :issuer)
      AND (:client = '' OR i.client_id = :client)
      AND (:status = '' OR i.status = :status)
      AND (:inv_type = '' OR i.invoice_type = :inv_type)
      AND (:has_rem = 0 OR i.remaining_amount > 0)
      AND (:batch = '' OR i.batch_id = :batch)
      AND (:from = '' OR i.issue_date >= :from)
      AND (:to = '' OR i.issue_date <= :to)
      AND (:min_total < 0 OR i.grand_total >= :min_total)
      AND (:max_total < 0 OR i.grand_total <= :max_total)
      AND (:user = '' OR i.created_by = :user)
      AND (:payment = '' OR i.payment_method = :payment)
      AND (:q = '' OR i.invoice_number LIKE :like OR c.name LIKE :like OR c.client_code LIKE :like
           OR c.tax_number LIKE :like OR c.phone LIKE :like OR c.mobile LIKE :like OR i.notes LIKE :like
           OR EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id AND (ii.item_name LIKE :like OR ii.item_code LIKE :like)))`;

  const sortMap = {
    date: 'i.issue_date %DIR%, i.issue_time %DIR%, i.created_at %DIR%',
    issue_date: 'i.issue_date %DIR%, i.issue_time %DIR%, i.created_at %DIR%',
    number: 'i.sequence_no %DIR%',
    invoice_number: 'i.sequence_no %DIR%',
    total: 'i.grand_total %DIR%',
    grand_total: 'i.grand_total %DIR%',
    remaining: 'i.remaining_amount %DIR%',
    remaining_amount: 'i.remaining_amount %DIR%',
    client: 'c.name %DIR%',
    client_name: 'c.name %DIR%',
  };
  const sortDir = String(params.sort_dir || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const sortCol = sortMap[params.sort_by]
    ? sortMap[params.sort_by].replace(/%DIR%/g, sortDir)
    : `i.issue_date ${sortDir}, i.issue_time ${sortDir}, i.created_at ${sortDir}`;

  const rows = db.all(
    `${INVOICE_SELECT} ${where} ORDER BY ${sortCol} LIMIT :lim OFFSET :off`,
    { ...filters, lim: limit, off: offset },
  );
  const agg = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(i.grand_total),0) AS total,
            COALESCE(SUM(i.paid_amount),0) AS paid, COALESCE(SUM(i.remaining_amount),0) AS remaining,
            COALESCE(SUM(i.tax_amount),0) AS tax
       FROM invoices i JOIN clients c ON c.id = i.client_id ${where}`,
    filters,
  );
  return {
    items: rows.map((r) => mapInvoice(r)),
    total_count: agg.count,
    totals: {
      grand_total: M.toMajor(agg.total),
      paid: M.toMajor(agg.paid),
      remaining: M.toMajor(agg.remaining),
      tax: M.toMajor(agg.tax),
    },
    limit,
    offset,
  };
}

/** الفواتير غير المسددة لعميل (لسندات القبض المجمعة). */
function openInvoices(clientId, issuerId) {
  const rows = db.all(
    `${INVOICE_SELECT}
      WHERE i.client_id = :client AND i.status IN ('UNPAID','PARTIAL') AND i.remaining_amount > 0
        AND (:issuer = '' OR i.issuer_id = :issuer)
      ORDER BY i.issue_date, i.created_at`,
    { client: clientId, issuer: issuerId || '' },
  );
  return rows.map((r) => mapInvoice(r));
}

// ------------------------------------------------------------- الإلغاء والحذف
// قرار محاسبي: إلغاء الفاتورة يُسجل كقيد عكسي (INVOICE_CANCEL) دائن في كشف الحساب
// بدلاً من حذف القيد الأصلي، لضمان بقاء السجل التاريخي والتدقيقي غير قابل للتلاعب.
function cancel(id, reason, ctx = {}) {
  const inv = db.get('SELECT * FROM invoices WHERE id = :id', { id });
  if (!inv) throw V.notFound('الفاتورة غير موجودة');
  if (inv.status === 'CANCELLED') throw V.bad('الفاتورة ملغاة مسبقاً');
  const allocated = db.pluck(
    `SELECT COALESCE(SUM(a.allocated_amount),0) AS s FROM voucher_allocations a
       JOIN receipt_vouchers v ON v.id = a.voucher_id WHERE a.invoice_id = :id AND v.status = 'ACTIVE'`,
    { id },
  );
  if (Number(allocated) > 0) throw V.conflict('لا يمكن إلغاء فاتورة عليها سندات قبض. يجب إلغاء السندات أولاً.');
  return db.tx(() => {
    const now = db.nowIso();
    const today = now.slice(0, 10);
    db.run(
      "UPDATE invoices SET status = 'CANCELLED', remaining_amount = 0, notes = :notes, updated_at = :now WHERE id = :id",
      { id, now, notes: `${inv.notes || ''}\n[ملغاة] ${reason || ''}`.trim() },
    );
    // قيد عكسي دائن في كشف الحساب
    db.run(
      `INSERT INTO client_ledger (id, client_id, issuer_id, doc_type, doc_id, doc_number, transaction_date,
          debit, credit, description, created_at)
       VALUES (:id, :client_id, :issuer_id, 'INVOICE_CANCEL', :doc_id, :doc_number, :date, 0, :credit, :description, :created_at)`,
      {
        id: uuid(),
        client_id: inv.client_id,
        issuer_id: inv.issuer_id,
        doc_id: inv.id,
        doc_number: inv.invoice_number,
        date: inv.issue_date || today,
        credit: inv.grand_total,
        description: `إلغاء فاتورة رقم ${inv.invoice_number}${reason ? ` (${reason})` : ''}`,
        created_at: now,
      },
    );
    db.audit({
      user: ctx.actor, action: 'INVOICE_CANCEL', entityType: 'invoice', entityId: id, issuerId: inv.issuer_id,
      details: { invoice_number: inv.invoice_number, reason: reason || '', amount: M.fmt(inv.grand_total) },
    });
    return getById(id);
  });
}

function remove(id, ctx = {}) {
  const user = ctx.user;
  if (user && user.role !== 'ADMIN') {
    throw V.forbidden('حذف الفاتورة نهائياً محصور بمدير النظام فقط');
  }
  const inv = db.get('SELECT * FROM invoices WHERE id = :id', { id });
  if (!inv) throw V.notFound('الفاتورة غير موجودة');
  const allocated = db.pluck(
    'SELECT COUNT(*) AS c FROM voucher_allocations WHERE invoice_id = :id', { id },
  );
  if (Number(allocated) > 0) throw V.conflict('لا يمكن حذف فاتورة مرتبطة بسندات قبض');

  // فحص تسلسل السلسلة: نمنع حذف أي فاتورة ليست الأخيرة في سلسلة المنشأة
  const lastInv = db.get(
    'SELECT id, sequence_no, invoice_number FROM invoices WHERE issuer_id = :i ORDER BY sequence_no DESC LIMIT 1',
    { i: inv.issuer_id },
  );
  if (lastInv && lastInv.id !== id) {
    throw V.conflict(`لا يمكن حذف الفاتورة «${inv.invoice_number}» لأنها ليست الأخيرة في تسلسل المنشأة، وحذفها يكسر سلسلة الهاش (PIH). يرجى إلغاء الفاتورة بدلاً من حذفها.`);
  }

  return db.tx(() => {
    removeLedgerForInvoice(id);
    db.run('DELETE FROM invoices WHERE id = :id', { id });
    const issuer = db.get('SELECT * FROM issuers WHERE id = :id', { id: inv.issuer_id });
    if (issuer && issuer.invoice_next_no > inv.sequence_no) {
      db.run('UPDATE issuers SET invoice_next_no = :n WHERE id = :id', { n: inv.sequence_no, id: inv.issuer_id });
    }
    db.audit({
      user: ctx.actor, action: 'INVOICE_DELETE', entityType: 'invoice', entityId: id, issuerId: inv.issuer_id,
      details: {
        invoice_number: inv.invoice_number,
        total: M.fmt(inv.grand_total),
        sequence_no: inv.sequence_no,
        warning: 'تم حذف الفاتورة الأخيرة في السلسلة لضمان استمرارية الهاش',
      },
    });
    return { ok: true };
  });
}

// ------------------------------------------------------- الفاتورة الإلكترونية
/** إعادة توليد ملف UBL XML للفاتورة (للتصدير أو التحقق). */
function toXml(id) {
  const inv = db.get('SELECT * FROM invoices WHERE id = :id', { id });
  if (!inv) throw V.notFound('الفاتورة غير موجودة');
  const issuer = issuersSvc.getRaw(inv.issuer_id);
  const client = db.get('SELECT * FROM clients WHERE id = :id', { id: inv.client_id });
  const lines = db.all('SELECT * FROM invoice_items WHERE invoice_id = :id ORDER BY line_no', { id });
  const taxRate = lines.length ? lines[0].tax_rate : issuer.default_tax_rate;

  const effIssuer = {
    ...issuer,
    name_ar: inv.seller_name || issuer.name_ar,
    tax_number: inv.seller_tax_number || issuer.tax_number,
    commercial_register: inv.seller_cr || issuer.commercial_register,
  };
  const effClient = {
    ...client,
    name: inv.buyer_name || client.name,
    tax_number: inv.buyer_tax_number || client.tax_number,
    commercial_register: inv.buyer_cr || client.commercial_register,
    address: inv.buyer_address || client.address,
  };

  return zatca.buildUblXml(displayInvoice(inv, taxRate), effIssuer, effClient, displayLines(lines), {
    icv: inv.sequence_no,
    pih: inv.previous_invoice_hash,
    currency: inv.currency,
  });
}

/** التحقق من سلامة السلسلة والهاش والتوقيع لفواتير منشأة. */
function verifyChain(issuerId) {
  const rows = db.all(
    'SELECT id, invoice_number, sequence_no, invoice_hash, previous_invoice_hash, signature FROM invoices WHERE issuer_id = :i ORDER BY sequence_no',
    { i: issuerId },
  );
  const problems = [];
  let expectedPih = zatca.GENESIS_PIH;
  for (const r of rows) {
    if (r.previous_invoice_hash !== expectedPih) {
      problems.push({ invoice_number: r.invoice_number, issue: 'قيمة PIH لا تطابق هاش الفاتورة السابقة' });
    }
    const recomputed = zatca.invoiceHash(toXml(r.id));
    if (recomputed !== r.invoice_hash) {
      problems.push({ invoice_number: r.invoice_number, issue: 'هاش الفاتورة لا يطابق محتواها الحالي' });
    }
    expectedPih = r.invoice_hash;
  }
  return { issuer_id: issuerId, invoices_checked: rows.length, ok: problems.length === 0, problems };
}

// ---------------------------------------------------- قوالب واستيراد Excel
/**
 * توليد نموذج Excel / CSV لاستيراد الفواتير.
 */
function generateTemplate({ format = 'xls' } = {}) {
  const headers = [
    'مجموعة_الفاتورة', 'كود_أو_اسم_العميل', 'تاريخ_الفاتورة', 'وقت_الفاتورة',
    'نوع_الفاتورة', 'طريقة_الدفع', 'كود_أو_اسم_الصنف', 'الوحدة',
    'الكمية', 'سعر_الوحدة', 'الخصم', 'نسبة_الضريبة', 'ملاحظات',
  ];

  const todayStr = new Date().toISOString().slice(0, 10);
  const sampleRows = [
    ['1', 'C001', todayStr, '09:30:00', 'STANDARD', 'CREDIT', 'أرز بسمتي 5 كجم', 'كيس', '2', '45.00', '0', '15', 'فاتورة تجريبية - بند 1'],
    ['1', 'C001', todayStr, '09:30:00', 'STANDARD', 'CREDIT', 'زيت نباتي 1.5 لتر', 'حبة', '3', '18.50', '2.00', '15', 'فاتورة تجريبية - بند 2'],
    ['2', 'عميل نقدي', todayStr, '11:15:00', 'SIMPLIFIED', 'CASH', 'سكر أبيض ناعم', 'كيس', '1', '35.00', '0', '15', 'فاتورة مبسطة نقدية'],
  ];

  if (format === 'csv') {
    const csvCell = (v) => {
      const s = String(v ?? '');
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(csvCell).join(',')];
    for (const r of sampleRows) lines.push(r.map(csvCell).join(','));
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: 'invoices_import_template.csv',
      content: '\uFEFF' + lines.join('\r\n'),
    };
  }

  // صيغة SpreadsheetML (XML Spreadsheet 2003) يفتحها Excel أصلياً بدون تحذيرات
  const escXml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const headerCells = headers.map((h) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escXml(h)}</Data></Cell>`).join('');
  const dataRowsXml = sampleRows.map((r, idx) => {
    const style = idx % 2 === 0 ? 'DataRow' : 'DataRowAlt';
    return `<Row>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[0])}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[1])}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[2])}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[3])}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[4])}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[5])}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[6])}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[7])}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${r[8]}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${r[9]}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${r[10]}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${r[11]}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(r[12])}</Data></Cell>
    </Row>`;
  }).join('\n');

  const instructions = [
    ['الحقل', 'الوصف', 'مثال', 'إلزامي؟'],
    ['مجموعة_الفاتورة', 'رمز أو رقم يجمع أسطر الفاتورة الواحدة معاً', '1 أو INV-01', 'نعم'],
    ['كود_أو_اسم_العميل', 'كود العميل المسجل في النظام أو اسمه الدقيق', 'C001 أو شركة الأمل', 'نعم'],
    ['تاريخ_الفاتورة', 'تاريخ الفاتورة بصيغة YYYY-MM-DD', todayStr, 'نعم'],
    ['وقت_الفاتورة', 'وقت الفاتورة بصيغة HH:MM:SS (اختياري، يملأ آلياً)', '14:30:00', 'لا'],
    ['نوع_الفاتورة', 'STANDARD (ضريبية عادية) أو SIMPLIFIED (مبسطة)', 'STANDARD', 'لا'],
    ['طريقة_الدفع', 'CASH, CARD, TRANSFER, CREDIT, CHEQUE', 'CREDIT', 'لا'],
    ['كود_أو_اسم_الصنف', 'كود الصنف المسجل أو اسمه في الفاتورة', 'ITM-01 أو أرز بسمتي', 'نعم'],
    ['الوحدة', 'وحدة القياس (حبة، كرتون، كجم، إلخ)', 'حبة', 'لا'],
    ['الكمية', 'كمية الصنف (عدد موجب)', '5', 'نعم'],
    ['سعر_الوحدة', 'سعر الوحدة بالريال بدون ضريبة', '25.50', 'نعم'],
    ['الخصم', 'مبلغ الخصم على هذا السطر (0 إن لم يوجد)', '0', 'لا'],
    ['نسبة_الضريبة', 'نسبة الضريبة المئوية (الافتراضي 15)', '15', 'لا'],
    ['ملاحظات', 'ملاحظات الفاتورة', 'طلب رقم 102', 'لا'],
  ];

  const instructionRowsXml = instructions.map((r, idx) => {
    const style = idx === 0 ? 'Header' : (idx % 2 === 0 ? 'DataRow' : 'DataRowAlt');
    return `<Row>${r.map((c) => `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(c)}</Data></Cell>`).join('')}</Row>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0F766E"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0F766E"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0F766E"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0F766E"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#0D9488" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataRow">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataRowAlt">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataRowNumber">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="DataRowAltNumber">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="بيانات_الفواتير">
  <Table ss:DefaultColumnWidth="110" ss:DefaultRowHeight="24">
   <Column ss:Width="100"/>
   <Column ss:Width="130"/>
   <Column ss:Width="95"/>
   <Column ss:Width="85"/>
   <Column ss:Width="95"/>
   <Column ss:Width="95"/>
   <Column ss:Width="150"/>
   <Column ss:Width="65"/>
   <Column ss:Width="65"/>
   <Column ss:Width="80"/>
   <Column ss:Width="65"/>
   <Column ss:Width="85"/>
   <Column ss:Width="150"/>
   <Row ss:Height="26">
    ${headerCells}
   </Row>
   ${dataRowsXml}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DisplayRightToLeft/>
  </WorksheetOptions>
 </Worksheet>
 <Worksheet ss:Name="تعليمات_الاستيراد">
  <Table ss:DefaultColumnWidth="140" ss:DefaultRowHeight="22">
   <Column ss:Width="130"/>
   <Column ss:Width="260"/>
   <Column ss:Width="140"/>
   <Column ss:Width="80"/>
   ${instructionRowsXml}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DisplayRightToLeft/>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

  return {
    contentType: 'application/vnd.ms-excel; charset=utf-8',
    filename: 'invoices_import_template.xls',
    content: xml,
  };
}

/**
 * استيراد فواتير مجمعة من مصفوفة أسطر تم رفعها أو استخراجها من ملف Excel.
 * تدعم المعاينة (dry_run: true) أو الحفظ النهائي (dry_run: false).
 */
function importInvoices(payload, ctx = {}) {
  const issuerId = V.str(payload.issuer_id, 'الشركة المصدرة', { required: true, max: 40 });
  const issuer = issuersSvc.getRaw(issuerId);
  if (!issuer.is_active) throw V.bad('الشركة المصدرة غير نشطة');

  const rawRows = V.arr(payload.rows, 'أسطر الفواتير', { required: true, max: 2000 });
  if (!rawRows.length) throw V.bad('لم يتم إرسال أي أسطر للاستيراد');
  const isDryRun = V.bool(payload.dry_run, false);

  // فهرسة العملاء والأصناف لسرعة المطابقة
  const clientRows = db.all('SELECT id, client_code, name FROM clients');
  const clientMap = new Map();
  for (const c of clientRows) {
    if (c.client_code) clientMap.set(c.client_code.trim().toLowerCase(), c);
    if (c.name) clientMap.set(c.name.trim().toLowerCase(), c);
  }

  const itemRows = db.all('SELECT id, item_code, name_ar, sale_price, unit, tax_rate FROM items');
  const itemMap = new Map();
  for (const it of itemRows) {
    if (it.item_code) itemMap.set(it.item_code.trim().toLowerCase(), it);
    if (it.name_ar) itemMap.set(it.name_ar.trim().toLowerCase(), it);
  }

  const errors = [];
  const groups = new Map();

  rawRows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const groupKey = String(row.group || row.invoice_group || row.invoice_number || `row_${rowNum}`).trim();
    const clientKey = String(row.client || row.client_code_or_name || row.client_code || row.client_name || '').trim();
    if (!clientKey) {
      errors.push({ row: rowNum, group: groupKey, field: 'client', message: 'اسم العميل أو كوده مطلوب' });
      return;
    }
    const client = clientMap.get(clientKey.toLowerCase());
    if (!client) {
      errors.push({ row: rowNum, group: groupKey, field: 'client', message: `العميل «${clientKey}» غير مسجل بالنظام` });
      return;
    }

    const issueDate = String(row.date || row.issue_date || new Date().toISOString().slice(0, 10)).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      errors.push({ row: rowNum, group: groupKey, field: 'date', message: 'صيغة التاريخ غير صالحة (يجب أن تكون YYYY-MM-DD)' });
      return;
    }

    const itemName = String(row.item || row.item_code_or_name || row.item_name || '').trim();
    if (!itemName) {
      errors.push({ row: rowNum, group: groupKey, field: 'item', message: 'اسم الصنف أو كوده مطلوب' });
      return;
    }
    const matchedItem = itemMap.get(itemName.toLowerCase());

    const qty = Number(row.quantity !== undefined && row.quantity !== '' ? row.quantity : 1);
    if (isNaN(qty) || qty <= 0) {
      errors.push({ row: rowNum, group: groupKey, field: 'quantity', message: 'الكمية يجب أن تكون رقماً موجباً أكبر من الصفر' });
      return;
    }

    let unitPrice = row.unit_price !== undefined && row.unit_price !== '' ? Number(row.unit_price) : (matchedItem ? M.toMajor(matchedItem.sale_price) : undefined);
    if (unitPrice === undefined || isNaN(unitPrice) || unitPrice < 0) {
      errors.push({ row: rowNum, group: groupKey, field: 'unit_price', message: 'سعر الوحدة مطلوب كرقم غير سالب' });
      return;
    }

    const discount = Number(row.discount || 0);
    if (isNaN(discount) || discount < 0 || discount > (qty * unitPrice)) {
      errors.push({ row: rowNum, group: groupKey, field: 'discount', message: 'مبلغ الخصم غير صالح أو يتجاوز قيمة السطر' });
      return;
    }

    const taxRate = Number(row.tax_rate !== undefined && row.tax_rate !== '' ? row.tax_rate : (matchedItem ? matchedItem.tax_rate : (issuer.default_tax_rate || 15)));

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        client_id: client.id,
        client_name: client.name,
        client_code: client.client_code,
        issue_date: issueDate,
        issue_time: String(row.time || row.issue_time || '').trim() || undefined,
        invoice_type: String(row.type || row.invoice_type || 'STANDARD').toUpperCase() === 'SIMPLIFIED' ? 'SIMPLIFIED' : 'STANDARD',
        payment_method: ['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'CHEQUE'].includes(String(row.payment_method || '').toUpperCase()) ? String(row.payment_method).toUpperCase() : 'CREDIT',
        notes: String(row.notes || '').trim(),
        lines: [],
      });
    }

    const invGroup = groups.get(groupKey);
    invGroup.lines.push({
      item_id: matchedItem ? matchedItem.id : null,
      item_code: matchedItem ? matchedItem.item_code : (row.item_code || ''),
      item_name: matchedItem ? matchedItem.name_ar : itemName,
      unit: String(row.unit || (matchedItem ? matchedItem.unit : 'حبة') || 'حبة').trim(),
      quantity: Math.round(qty * 1000) / 1000,
      unit_price: unitPrice,
      discount,
      tax_rate: taxRate,
    });
  });

  // احتساب المعاينة والإجماليات
  let totalGrand = 0;
  let totalTax = 0;
  const previewInvoices = [];

  for (const [gKey, invData] of groups.entries()) {
    const totals = computeTotals(invData.lines.map((l) => ({
      ...l,
      unit_price: M.toMinor(l.unit_price),
      discount: M.toMinor(l.discount),
    })));
    totalGrand += totals.grand_total;
    totalTax += totals.tax_amount;

    previewInvoices.push({
      group: gKey,
      client_name: invData.client_name,
      client_code: invData.client_code,
      issue_date: invData.issue_date,
      invoice_type: invData.invoice_type,
      payment_method: invData.payment_method,
      items_count: invData.lines.length,
      subtotal: M.toMajor(totals.subtotal),
      discount_amount: M.toMajor(totals.discount_amount),
      taxable_amount: M.toMajor(totals.taxable_amount),
      tax_amount: M.toMajor(totals.tax_amount),
      grand_total: M.toMajor(totals.grand_total),
      lines: invData.lines,
    });
  }

  if (isDryRun || errors.length > 0) {
    return {
      valid: errors.length === 0,
      dry_run: true,
      invoices_count: previewInvoices.length,
      lines_count: rawRows.length,
      errors_count: errors.length,
      errors,
      totals: {
        tax_amount: M.toMajor(totalTax),
        grand_total: M.toMajor(totalGrand),
      },
      preview: previewInvoices,
    };
  }

  // التنفيذ الفعلي داخل معاملة قاعدة بيانات متماسكة
  return db.tx(() => {
    const createdInvoices = [];
    for (const invData of groups.values()) {
      const created = create({
        issuer_id: issuerId,
        client_id: invData.client_id,
        issue_date: invData.issue_date,
        issue_time: invData.issue_time,
        invoice_type: invData.invoice_type,
        payment_method: invData.payment_method,
        notes: invData.notes,
        lines: invData.lines,
      }, ctx);
      createdInvoices.push({
        id: created.id,
        invoice_number: created.invoice_number,
        client_name: created.client_name,
        grand_total: created.grand_total,
      });
    }

    db.audit({
      user: ctx.actor,
      action: 'INVOICES_IMPORT',
      entityType: 'invoice',
      issuerId,
      details: {
        count: createdInvoices.length,
        total: M.toMajor(totalGrand),
        first_invoice: createdInvoices[0]?.invoice_number,
        last_invoice: createdInvoices[createdInvoices.length - 1]?.invoice_number,
      },
    });

    return {
      ok: true,
      imported_count: createdInvoices.length,
      total_amount: M.toMajor(totalGrand),
      invoices: createdInvoices,
    };
  });
}

module.exports = {
  STATUS_LABELS, PAYMENT_LABELS,
  computeTotals, normalizeLines, allocateInvoiceNumber, nextSequenceNo, previousHash,
  buildEinvoice, postLedgerForInvoice, removeLedgerForInvoice, recalcInvoiceStatus,
  create, getById, search, openInvoices, cancel, remove, toXml, verifyChain,
  generateTemplate, importInvoices,
  mapInvoice, mapLine,
};
