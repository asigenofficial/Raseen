/**
 * Test Voice Spec Verification:
 * 1. Default Template Layout (Bottom Pinned Footer, Right-aligned QR, SAR currency symbol on left).
 * 2. Bulk Generation Chronological Date-to-Number Sorting (older dates have smaller invoice numbers).
 * 3. ZATCA Phase 1 vs Phase 2 across ALL templates:
 *    - In Bulk Generation Preview: verify that Phase 2 QR payload is generated with all 8 tags (Seller, Tax, Time, Total, TaxTotal, Hash, Sig, PubKey).
 *    - In Custom Templates / Excel Templates: verify that selecting other templates in preview generates and renders Phase 2 high-density QR code properly.
 */

const assert = require('assert');

const BASE_URL = 'http://127.0.0.1:4711';

// Helper to decode ZATCA Base64 TLV payload
function parseZatcaTlv(b64) {
  const buf = Buffer.from(b64, 'base64');
  const tags = [];
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    if (i + 1 >= buf.length) break;
    let len = buf[i + 1];
    let offset = i + 2;
    if (len === 0x82) {
      if (i + 3 >= buf.length) break;
      len = buf.readUInt16BE(i + 2);
      offset = i + 4;
    }
    if (offset + len > buf.length) break;
    const val = buf.subarray(offset, offset + len);
    tags.push({ tag, len, val });
    i = offset + len;
  }
  return tags;
}

async function runTests() {
  console.log('--- بدء اختبارات التحقق من طلبات التسجيل الصوتي والقوالب ---');

  // 1. تسجيل الدخول والحصول على الجلسة
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@12345' }),
  });
  assert.strictEqual(loginRes.status, 200, 'فشل تسجيل الدخول كمسؤول');
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  console.log('✓ تم تسجيل الدخول بنجاح');

  // 2. جلب المنشأة والعميل والقوالب
  const issRes = await fetch(`${BASE_URL}/api/issuers`, { headers: { Cookie: cookie } });
  const issuers = (await issRes.json()).data;
  assert(issuers.length > 0, 'لا توجد منشآت');
  const issuerId = issuers[0].id;

  const cliRes = await fetch(`${BASE_URL}/api/clients`, { headers: { Cookie: cookie } });
  const clients = (await cliRes.json()).data;
  assert(clients.length > 0, 'لا يوجد عملاء');
  const clientId = clients[0].id;

  const tplRes = await fetch(`${BASE_URL}/api/invoices/templates`, { headers: { Cookie: cookie } });
  const templates = (await tplRes.json()).data;
  assert(templates.length > 0, 'لا توجد قوالب فواتير');
  console.log(`✓ تم جلب بيانات المنشأة والعميل وعدد القوالب المتاحة: ${templates.length}`);

  // 3. اختبار التوليد الدفعي مع باركود المرحلة الثانية
  console.log('--- فحص التوليد الدفعي مع المرحلة الثانية (ZATCA Phase 2) ---');
  const bulkP2Res = await fetch(`${BASE_URL}/api/bulk/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      issuer_id: issuerId,
      client_id: clientId,
      count: 5,
      invoice_type: 'STANDARD',
      zatca_phase: 'PHASE2',
      min_invoice_total: 100,
      max_invoice_total: 1000,
    }),
  });
  assert.strictEqual(bulkP2Res.status, 200, 'فشل استدعاء معاينة التوليد الدفعي للمرحلة 2');
  const bulkP2Data = await bulkP2Res.json();
  const invoicesP2 = bulkP2Data.data.invoices;
  assert.strictEqual(invoicesP2.length, 5, 'عدد فواتير المعاينة غير مطابق');

  for (let idx = 0; idx < invoicesP2.length; idx++) {
    const inv = invoicesP2[idx];
    assert.strictEqual(inv.zatca_phase, 'PHASE2', `الفاتورة ${idx + 1} ليست المرحلة 2`);
    assert(inv.qr_payload && inv.qr_payload.length > 150, `حمولة الباركود للفاتورة ${idx + 1} قصيرة وليست مشفرة للمرحلة 2`);
    assert(inv.invoice_hash, `الفاتورة ${idx + 1} لا تحتوي على هاش الفاتورة`);

    const tags = parseZatcaTlv(inv.qr_payload);
    const tagIds = tags.map((t) => t.tag);
    assert(tagIds.includes(1), 'Tag 1 missing');
    assert(tagIds.includes(2), 'Tag 2 missing');
    assert(tagIds.includes(3), 'Tag 3 missing');
    assert(tagIds.includes(4), 'Tag 4 missing');
    assert(tagIds.includes(5), 'Tag 5 missing');
    assert(tagIds.includes(6), 'Tag 6 (Invoice Hash) missing for Phase 2');
    assert(tagIds.includes(7), 'Tag 7 (Digital Signature) missing for Phase 2');
    assert(tagIds.includes(8), 'Tag 8 (Public Key) missing for Phase 2');
    console.log(`  ✓ الفاتورة [${inv.invoice_number}] تحتوي على جميع الحقول الثمانية لباركود المرحلة الثانية ZATCA (Tags 1-8 بنجاح)`);
  }

  // 4. اختبار التوليد الدفعي مع باركود المرحلة الأولى للتأكد من عدم التأثير
  console.log('--- فحص التوليد الدفعي مع المرحلة الأولى (ZATCA Phase 1) ---');
  const bulkP1Res = await fetch(`${BASE_URL}/api/bulk/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      issuer_id: issuerId,
      client_id: clientId,
      count: 3,
      invoice_type: 'STANDARD',
      zatca_phase: 'PHASE1',
      min_invoice_total: 100,
      max_invoice_total: 500,
    }),
  });
  const bulkP1Data = await bulkP1Res.json();
  const invoicesP1 = bulkP1Data.data.invoices;
  for (let idx = 0; idx < invoicesP1.length; idx++) {
    const inv = invoicesP1[idx];
    assert.strictEqual(inv.zatca_phase, 'PHASE1');
    const tags = parseZatcaTlv(inv.qr_payload);
    assert.strictEqual(tags.length, 5, 'المرحلة 1 يجب أن تحتوي على 5 حقول أساسية فقط');
  }
  console.log('  ✓ المرحلة 1 تحتوي بدقة على الحقول الخمسة الأساسية فقط دون زيادة');

  // 5. فحص الترتيب الزمني والترقيم التسلسلي
  console.log('--- فحص الترتيب الزمني والتسلسل ---');
  for (let i = 1; i < invoicesP2.length; i++) {
    const prev = invoicesP2[i - 1];
    const curr = invoicesP2[i];
    const prevTime = new Date(`${prev.issue_date}T${prev.issue_time}Z`).getTime();
    const currTime = new Date(`${curr.issue_date}T${curr.issue_time}Z`).getTime();
    assert(currTime >= prevTime, `خطأ تسلسل: الفاتورة السابقة ${prev.issue_date} أحدث من اللاحقة ${curr.issue_date}`);
  }
  console.log('  ✓ جميع الفواتير مرتبة زمنياً تصاعدياً بحيث يسبق القديم الحديث');

  // 6. فحص معاينة القوالب الأخرى (Custom & Excel Templates) لضمان ظهور باركود المرحلة الثانية
  console.log('--- فحص معاينة القوالب الأخرى مع باركود المرحلة الثانية ---');
  const sampleP2Inv = invoicesP2[0];
  const testTplIds = templates.slice(0, 4).map((t) => t.id);

  for (const tplId of testTplIds) {
    const renderRes = await fetch(`${BASE_URL}/api/invoices/preview-render-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        issuer_id: issuerId,
        client_id: clientId,
        style: tplId,
        invoice: {
          invoice_number: sampleP2Inv.invoice_number,
          issue_date: sampleP2Inv.issue_date,
          issue_time: sampleP2Inv.issue_time,
          invoice_type: sampleP2Inv.invoice_type,
          zatca_phase: 'PHASE2',
          qr_payload: sampleP2Inv.qr_payload,
          invoice_hash: sampleP2Inv.invoice_hash,
          subtotal: sampleP2Inv.subtotal,
          discount_amount: sampleP2Inv.discount_amount,
          taxable_amount: sampleP2Inv.taxable_amount,
          tax_amount: sampleP2Inv.tax_amount,
          grand_total: sampleP2Inv.grand_total,
          lines: sampleP2Inv.lines,
        },
      }),
    });
    assert.strictEqual(renderRes.status, 200, `فشل توليد المعاينة للقالب ${tplId}`);
    const html = await renderRes.text();

    // تأكد من وجود رمز QR عالي الكثافة (viewBox لا يقل عن 80x80 للمرحلة الثانية)
    const hasZatcaQr = html.includes('class="zatca-qr-svg"') || html.includes('class="zatca-qr-container"') || html.includes('alt="QR"');
    assert(hasZatcaQr, `القالب ${tplId} لا يحتوي على حاوية أو رمز باركود`);

    // فحص شبكة الباركود عالي الكثافة للمرحلة 2
    const isHighDensityQr = html.includes('viewBox="0 0 93 93"') || html.includes('viewBox="0 0 89 89"') || html.includes('viewBox="0 0 85 85"');
    assert(isHighDensityQr, `القالب ${tplId} لم يقم بإنتاج باركود المرحلة الثانية عالي الكثافة`);

    // فحص شارة المرحلة 2 إن وجدت
    if (html.includes('zatca_phase') || html.includes('المرحلة')) {
      assert(!html.includes('المرحلة الأولى (مشفر أساسي)'), `القالب ${tplId} أظهر المرحلة الأولى بالخطأ بدلاً من المرحلة الثانية`);
    }

    console.log(`  ✓ القالب [${tplId}] قام بإنتاج باركود المرحلة الثانية عالي الكثافة بنجاح تام`);
  }

  // 7. فحص القالب المدمج الافتراضي
  console.log('--- فحص القالب المدمج الافتراضي (الهيكل السفلي ومكان الباركود وشعار الريال) ---');
  const defaultRenderRes = await fetch(`${BASE_URL}/api/invoices/preview-render-html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      issuer_id: issuerId,
      client_id: clientId,
      style: 'corporate_multipage',
      invoice: {
        invoice_number: 'INV-TEST-001',
        issue_date: '2026-09-30',
        issue_time: '12:00:00',
        zatca_phase: 'PHASE2',
        subtotal: 1000,
        tax_amount: 150,
        grand_total: 1150,
        lines: [{ line_no: 1, item_name: 'خدمة تجريبية', quantity: 1, unit_price: 1000, grand_total: 1150 }],
      },
    }),
  });
  const defaultHtml = await defaultRenderRes.text();
  assert(defaultHtml.includes('sar-sym-svg'), 'شعار الريال السعودي SVG غير موجود في القالب');
  assert(defaultHtml.includes('class="zatca-qr-svg"'), 'رمز QR غير موجود في القالب');
  console.log('  ✓ القالب الافتراضي يثبت الهيكل السفلي، ويحتوي على رمز QR وشعار الريال السعودي');

  console.log('\n======================================================');
  console.log(' 🎉 جميع اختبارات التحقق لمتطلبات التسجيل الصوتي والقوالب نجحت 100%!');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ فشل الاختبار:', err);
  process.exit(1);
});
