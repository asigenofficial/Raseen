'use strict';
/**
 * محرك الفاتورة الإلكترونية (ZATCA) — المرحلة الأولى والثانية.
 *
 * المرحلة الأولى: توليد حمولة QR بترميز TLV ثم Base64 للحقول الخمسة الإلزامية.
 * المرحلة الثانية: إضافة الوسوم 6..9 (هاش الفاتورة SHA-256، التوقيع الرقمي ECDSA،
 *                 المفتاح العام، توقيع الشهادة) + سلسلة الفواتير (PIH) + UBL 2.1 XML.
 *
 * ملاحظة امتثال مهمة: الربط الفعلي والتوقيع المعتمد يتطلبان شهادة CSID صادرة من
 * هيئة الزكاة والضريبة والجمارك عبر واجهاتها. النظام يخزّن الشهادات والمفاتيح مشفّرة
 * ويستخدمها عند توفرها؛ وإذا لم تتوفر شهادة إنتاج يتم التوقيع بمفتاح محلي (وضع محاكاة)
 * ويُعلَّم ذلك بوضوح في الحقل signature_mode.
 */
const crypto = require('node:crypto');

// ---------------------------------------------------------------- TLV / QR

/** ترميز وسم واحد بصيغة Tag-Length-Value مع دعم القيم الطويلة. */
function tlv(tag, value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (buf.length <= 255) {
    return Buffer.concat([Buffer.from([tag, buf.length]), buf]);
  }
  // القيم الأطول من 255 بايت: ترميز الطول على بايتين (نمط ممتد)
  const len = Buffer.alloc(3);
  len[0] = 0x82; // long-form marker
  len.writeUInt16BE(buf.length, 1);
  return Buffer.concat([Buffer.from([tag]), len, buf]);
}

/**
 * بناء حمولة QR.
 * @param {object} p
 * @param {string} p.sellerName        اسم المنشأة المصدرة
 * @param {string} p.vatNumber         الرقم الضريبي للمنشأة
 * @param {string} p.timestamp         ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)
 * @param {string} p.total             إجمالي الفاتورة شاملاً الضريبة (نص بمنزلتين)
 * @param {string} p.vatTotal          إجمالي الضريبة (نص بمنزلتين)
 * @param {string} [p.invoiceHash]     Tag 6 — هاش الفاتورة (base64)
 * @param {string} [p.signature]       Tag 7 — التوقيع الرقمي (base64)
 * @param {string} [p.publicKey]       Tag 8 — المفتاح العام (base64 DER)
 * @param {string} [p.certSignature]   Tag 9 — توقيع الشهادة (base64)
 * @returns {string} base64
 */
function buildQrPayload(p) {
  const parts = [
    tlv(1, p.sellerName || ''),
    tlv(2, p.vatNumber || ''),
    tlv(3, p.timestamp || ''),
    tlv(4, p.total || '0.00'),
    tlv(5, p.vatTotal || '0.00'),
  ];
  if (p.invoiceHash) parts.push(tlv(6, Buffer.from(p.invoiceHash, 'utf8')));
  if (p.signature) parts.push(tlv(7, Buffer.from(p.signature, 'base64')));
  if (p.publicKey) parts.push(tlv(8, Buffer.from(p.publicKey, 'base64')));
  if (p.certSignature) parts.push(tlv(9, Buffer.from(p.certSignature, 'base64')));
  return Buffer.concat(parts).toString('base64');
}

/** فك حمولة QR (يُستخدم في الاختبارات وشاشة التحقق). */
function parseQrPayload(base64) {
  const buf = Buffer.from(String(base64), 'base64');
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    let len = buf[i + 1];
    let off = i + 2;
    if (len === 0x82) {
      len = buf.readUInt16BE(i + 2);
      off = i + 4;
    }
    const value = buf.subarray(off, off + len);
    out.push({ tag, length: len, value });
    i = off + len;
  }
  return out.map((t) => ({
    tag: t.tag,
    length: t.length,
    text: t.tag >= 7 ? t.value.toString('base64') : t.value.toString('utf8'),
  }));
}

// ---------------------------------------------------------------- Hashing / chaining

/** هاش الفاتورة: SHA-256 على تمثيل الفاتورة المُقنّن (canonical) ثم Base64. */
function invoiceHash(canonicalXml) {
  return crypto.createHash('sha256').update(Buffer.from(canonicalXml, 'utf8')).digest('base64');
}

/** قيمة PIH للفاتورة الأولى في السلسلة حسب مواصفات ZATCA. */
const GENESIS_PIH = Buffer.alloc(32, 0).toString('base64');

// ---------------------------------------------------------------- Signing

/** توليد زوج مفاتيح ECDSA (prime256v1) للاستخدام المحلي / طلب الشهادة. */
function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    publicKeyDerBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

/** التوقيع الرقمي على هاش الفاتورة. يعيد base64. */
function signHash(privateKeyPem, hashBase64) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign('sha256', Buffer.from(hashBase64, 'utf8'), {
    key,
    dsaEncoding: 'der',
  });
  return sig.toString('base64');
}

function verifyHashSignature(publicKeyPem, hashBase64, signatureBase64) {
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(hashBase64, 'utf8'),
      { key: crypto.createPublicKey(publicKeyPem), dsaEncoding: 'der' },
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

/** استخراج المفتاح العام (DER base64) وتوقيع الشهادة من شهادة X.509 إن وُجدت. */
function certificateInfo(certPem) {
  try {
    const cert = new crypto.X509Certificate(certPem);
    return {
      publicKeyDerBase64: cert.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      serialNumber: cert.serialNumber,
      issuer: cert.issuer,
      subject: cert.subject,
      validTo: cert.validTo,
      // توقيع الشهادة: يُستخرج من بنية الشهادة (آخر عنصر في DER)
      certSignatureBase64: extractCertSignature(cert.raw),
    };
  } catch {
    return null;
  }
}

/** استخراج قيمة BIT STRING الأخيرة (signatureValue) من DER الشهادة. */
function extractCertSignature(der) {
  try {
    let i = der.length - 1;
    // البحث عن آخر وسم BIT STRING (0x03) بطول معقول
    for (let p = der.length - 80; p > 0; p--) {
      if (der[p] === 0x03 && der[p + 1] > 0x40 && der[p + 2] === 0x00) {
        const len = der[p + 1];
        return der.subarray(p + 3, p + 2 + len).toString('base64');
      }
    }
    void i;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- UBL 2.1 XML

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * بناء ملف UBL 2.1 XML للفاتورة.
 * @param {object} inv   صف الفاتورة (بمبالغ عشرية جاهزة كنص)
 * @param {object} issuer بيانات المنشأة المصدرة
 * @param {object} client بيانات العميل
 * @param {Array}  lines  بنود الفاتورة
 * @param {object} chain  { icv, pih, currency }
 */
function buildUblXml(inv, issuer, client, lines, chain) {
  const currency = (chain && chain.currency) || 'SAR';
  const icv = (chain && chain.icv) || 1;
  const pih = (chain && chain.pih) || GENESIS_PIH;
  const typeCode = inv.invoice_type === 'SIMPLIFIED' ? '388' : '388';
  const typeName = inv.invoice_type === 'SIMPLIFIED' ? '0200000' : '0100000';

  const lineXml = lines
    .map((l, idx) => `
  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(l.unit || 'PCE')}">${esc(l.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${esc(l.taxable)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currency}">${esc(l.tax_amount)}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="${currency}">${esc(l.total_line)}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${esc(l.item_name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${esc(l.tax_rate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${esc(l.unit_price)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.invoice_number)}</cbc:ID>
  <cbc:UUID>${esc(inv.uuid)}</cbc:UUID>
  <cbc:IssueDate>${esc(inv.issue_date)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(inv.issue_time)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeName}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${currency}</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${esc(icv)}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(pih)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${esc(issuer.commercial_register)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(issuer.street)}</cbc:StreetName>
        <cbc:BuildingNumber>${esc(issuer.building_no)}</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>${esc(issuer.district)}</cbc:CitySubdivisionName>
        <cbc:CityName>${esc(issuer.city)}</cbc:CityName>
        <cbc:PostalZone>${esc(issuer.postal_code)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${esc(issuer.country || 'SA')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(issuer.tax_number)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(issuer.name_ar || issuer.name_en)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(client.address)}</cbc:StreetName>
        <cbc:CityName>${esc(client.city)}</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(client.tax_number)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(client.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="${currency}">${esc(inv.discount_amount)}</cbc:Amount>
  </cac:AllowanceCharge>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${esc(inv.tax_amount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${esc(inv.taxable_amount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${esc(inv.tax_amount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${esc(inv.tax_rate_display)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${esc(inv.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${esc(inv.taxable_amount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${esc(inv.grand_total)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${currency}">${esc(inv.discount_amount)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${currency}">${esc(inv.grand_total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineXml}
</Invoice>
`;
}

module.exports = {
  tlv,
  buildQrPayload,
  parseQrPayload,
  invoiceHash,
  GENESIS_PIH,
  generateKeyPair,
  signHash,
  verifyHashSignature,
  certificateInfo,
  buildUblXml,
};
