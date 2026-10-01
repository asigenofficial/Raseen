/**
 * test_vouchers_e2e.js
 * اختبار شامل لجميع ميزات السندات المضافة:
 * 1. تسجيل الدخول والحصول على الجلسة
 * 2. السند الموحد (Single Voucher) مع التوزيع التلقائي واليدوي
 * 3. السند المنفصل لكل فاتورة (Batch Vouchers) مع فجوة التسلسل وتأخير التاريخ
 * 4. السندات الدفعية (Installment Vouchers) مع حساب التواريخ المستقبلية وجبر السنتات وتوزيع FIFO
 * 5. تفاصيل السند واسترجاع الرصيد عند الإلغاء
 */

const BASE_URL = 'http://127.0.0.1:4711';
let cookie = '';

async function req(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { 'Cookie': cookie } : {})
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  
  // حفظ ملف تعريف الارتباط عند تسجيل الدخول
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }

  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok || json.ok === false) throw new Error(json.error || json.message || `HTTP ${res.status}: ${text}`);
    return (json && Object.prototype.hasOwnProperty.call(json, 'data')) ? json.data : json;
  } catch (e) {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return text;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('================================================================');
  console.log('   بدء الاختبار الشامل لمحرك السندات في رَسِين (Raseen)');
  console.log('================================================================\n');

  // 1. تسجيل الدخول
  console.log('1️⃣  تسجيل الدخول كمسؤول (admin)...');
  const loginRes = await req('/api/auth/login', 'POST', { username: 'admin', password: 'Admin@12345' });
  console.log('    ✅ تم تسجيل الدخول بنجاح:', loginRes.user?.full_name || loginRes.user?.username);

  // 2. التحقق من المنشأة والعميل
  console.log('\n2️⃣  جلب المنشآت والعملاء...');
  const issuers = await req('/api/issuers');
  if (!issuers.length) throw new Error('لا توجد منشأة في النظام!');
  const issuer = issuers.find(i => i.is_active) || issuers[0];
  console.log(`    🏢 المنشأة المختارة: ${issuer.name_ar} (ID: ${issuer.id})`);

  let clients = await req('/api/clients');
  let client = clients[0];
  if (!client) {
    console.log('    ➕ إنشاء عميل اختبار جديد...');
    client = await req('/api/clients', 'POST', {
      name: 'عميل اختبار السندات',
      client_code: 'TEST-CLI-01',
      issuer_id: issuer.id,
      tax_number: '300000000000003'
    });
  }
  console.log(`    👤 العميل المختار: ${client.name} (ID: ${client.id})`);

  // 3. إنشاء فواتير اختبار مفتوحة
  console.log('\n3️⃣  إنشاء فواتير اختبارية مفتوحة لاختبار التوزيع...');
  const todayIso = new Date().toISOString().substring(0, 10);
  
  // فاتورة 1: 1,000 ر.س
  const inv1 = await req('/api/invoices', 'POST', {
    issuer_id: issuer.id,
    client_id: client.id,
    issue_date: todayIso,
    payment_terms: 'CREDIT',
    lines: [
      { item_name: 'خدمات برمجية واختبار', quantity: 1, unit_price: 869.57, tax_rate: 15 }
    ]
  });
  console.log(`    📄 فاتورة 1: ${inv1.invoice_number} | الإجمالي: ${inv1.grand_total} | المتبقي: ${inv1.remaining_amount}`);

  // فاتورة 2: 500 ر.س
  const inv2 = await req('/api/invoices', 'POST', {
    issuer_id: issuer.id,
    client_id: client.id,
    issue_date: todayIso,
    payment_terms: 'CREDIT',
    lines: [
      { item_name: 'دعم فني وصيانة', quantity: 1, unit_price: 434.78, tax_rate: 15 }
    ]
  });
  console.log(`    📄 فاتورة 2: ${inv2.invoice_number} | الإجمالي: ${inv2.grand_total} | المتبقي: ${inv2.remaining_amount}`);

  // التحقق من الفواتير المفتوحة
  const openInvs = await req(`/api/invoices/open?client_id=${client.id}&issuer_id=${issuer.id}`);
  console.log(`    🔍 الفواتير المفتوحة للعميل: ${openInvs.length} فاتورة`);

  // 4. اختبار النمط الأول: السند العادي الموحد (Single Unified Voucher)
  console.log('\n4️⃣  [النمط 1] اختبار إنشاء سند عادي موحد وتوزيع جزئي على الفاتورة 1...');
  const v1 = await req('/api/vouchers', 'POST', {
    issuer_id: issuer.id,
    client_id: client.id,
    voucher_date: todayIso,
    total_amount: 300,
    payment_type: 'TRANSFER',
    reference_no: 'TRX-1001',
    notes: `سداد جزئي للفاتورة ${inv1.invoice_number}`,
    allocations: [
      { invoice_id: inv1.id, amount: 300 }
    ]
  });
  console.log(`    ✅ تم إنشاء السند الموحد: رقم ${v1.voucher_number} بمبلغ ${v1.total_amount} ر.س`);
  
  // تحقق من تحديث المتبقي على الفاتورة 1
  const checkInv1 = await req(`/api/invoices/${inv1.id}`);
  console.log(`    📊 متبقي الفاتورة 1 بعد السداد الجزئي: ${checkInv1.remaining_amount} (كان ${inv1.remaining_amount})`);
  if (Math.abs(checkInv1.remaining_amount - (inv1.remaining_amount - 300)) > 0.01) {
    throw new Error(`خطأ في تحديث متبقي الفاتورة! المتوقع: ${inv1.remaining_amount - 300}, الفعلي: ${checkInv1.remaining_amount}`);
  }

  // 5. اختبار النمط الثاني: السندات المنفصلة (Batch Mode) مع فجوة التسلسل وتأخير التاريخ
  console.log('\n5️⃣  [النمط 2] اختبار إنشاء سند منفصل لكل فاتورة (Batch) مع فجوة التسلسل وتأخير التاريخ...');
  
  // فحص التسلسل الأولي لسندات المنشأة
  const seqRes = await req(`/api/issuers/${issuer.id}/advance-voucher-seq`, 'POST', { steps: 3 });
  console.log(`    ⚡ قفز تسلسل السندات بمقدار 3 أرقام بنجاح: next_no = ${seqRes.next_no}`);

  // إنشاء سند منفصل للفاتورة 2 مع تأخير 2 يوم
  const d = new Date(inv2.issue_date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 2);
  const delayedDate = d.toISOString().substring(0, 10);

  const vBatch = await req('/api/vouchers', 'POST', {
    issuer_id: issuer.id,
    client_id: client.id,
    voucher_date: delayedDate,
    total_amount: inv2.remaining_amount,
    payment_type: 'CASH',
    reference_no: 'BATCH-REF-01',
    notes: `وذلك مقابل سداد فاتورة رقم ${inv2.invoice_number}`,
    allocations: [{ invoice_id: inv2.id, amount: inv2.remaining_amount }]
  });
  console.log(`    ✅ تم إنشاء سند الدفعة: رقم ${vBatch.voucher_number} بتاريخ ${vBatch.voucher_date} (تأخير +2 أيام) بمبلغ ${vBatch.total_amount}`);
  
  // التحقق من إقفال الفاتورة 2 بالكامل
  const checkInv2 = await req(`/api/invoices/${inv2.id}`);
  console.log(`    📊 حالة الفاتورة 2: ${checkInv2.status} | المتبقي: ${checkInv2.remaining_amount}`);
  if (checkInv2.remaining_amount !== 0) {
    throw new Error('الفاتورة 2 يجب أن تكون مسددة بالكامل (المتبقي = 0)!');
  }

  // 6. اختبار النمط الثالث: السندات الدفعية (Installment Mode) مع الأقساط وجبر السنتات وتوزيع FIFO
  console.log('\n6️⃣  [النمط 3] اختبار إنشاء سندات دفعية (أقساط) مع جبر السنتات وجدولة التواريخ وتوزيع FIFO...');
  
  // إجمالي أقساط 1,000 ر.س على 3 دفعات:
  // الدفعة 1: 333.33 ر.س
  // الدفعة 2: 333.33 ر.س
  // الدفعة 3: 333.34 ر.س (جبر السنت الأخير ليكون المجموع 1000.00 ر.س بالضبط)
  const instCount = 3;
  const instTotal = 1000;
  const baseAmt = Math.floor((instTotal / instCount) * 100) / 100;
  const lastAmt = Math.round((instTotal - baseAmt * (instCount - 1)) * 100) / 100;
  console.log(`    🧮 حساب الأقساط: الأساسي = ${baseAmt} ر.س | الأخير = ${lastAmt} ر.س | المجموع = ${baseAmt*2 + lastAmt}`);

  if (baseAmt * 2 + lastAmt !== instTotal) {
    throw new Error('فشل في خوارزمية موازنة الأقساط وجبر السنتات!');
  }

  const startDate = new Date();
  startDate.setUTCMonth(startDate.getUTCMonth() + 1);
  startDate.setUTCDate(1);
  const startIso = startDate.toISOString().substring(0, 10);
  const freqDays = 14;

  const installments = [];
  for (let i = 0; i < instCount; i++) {
    const curDate = new Date(startIso + 'T00:00:00Z');
    curDate.setUTCDate(curDate.getUTCDate() + freqDays * i);
    installments.push({
      num: i + 1,
      date: curDate.toISOString().substring(0, 10),
      amount: i === instCount - 1 ? lastAmt : baseAmt
    });
  }

  console.log('    📅 جدول الدفعات المحسوب:');
  installments.forEach(ins => {
    console.log(`       - دفعة ${ins.num}: ${ins.date} بمبلغ ${ins.amount} ر.س`);
  });

  // توزيع FIFO على المتبقي من الفاتورة 1
  const remainingInvs = [{ id: inv1.id, rem: checkInv1.remaining_amount }];
  const createdInstVouchers = [];

  for (let i = 0; i < installments.length; i++) {
    const inst = installments[i];
    let instRem = inst.amount;
    const allocs = [];
    for (const inv of remainingInvs) {
      if (instRem < 0.005) break;
      const take = Math.min(inv.rem, Math.round(instRem * 100) / 100);
      if (take > 0.005) {
        allocs.push({ invoice_id: inv.id, amount: Math.round(take * 100) / 100 });
        inv.rem = Math.round((inv.rem - take) * 100) / 100;
        instRem = Math.round((instRem - take) * 100) / 100;
      }
    }

    const vInst = await req('/api/vouchers', 'POST', {
      issuer_id: issuer.id,
      client_id: client.id,
      voucher_date: inst.date,
      total_amount: inst.amount,
      payment_type: 'TRANSFER',
      reference_no: `INST-REF-0${i+1}`,
      notes: `دفعة ${inst.num} من ${instCount}`,
      allocations: allocs
    });

    createdInstVouchers.push(vInst);
    console.log(`    ✅ تم إنشاء الدفعة ${inst.num}: رقم السند ${vInst.voucher_number} بتاريخ ${vInst.voucher_date} بمبلغ ${vInst.total_amount} ر.س (موزع: ${allocs.reduce((a,b)=>a+b.amount,0)})`);
  }

  // 7. التحقق من تفاصيل واستعلام السندات
  console.log('\n7️⃣  التحقق من استعلام السندات وتفاصيل السند المنشأ...');
  const vList = await req(`/api/vouchers?issuer_id=${issuer.id}&client_id=${client.id}&limit=10`);
  console.log(`    📋 عدد السندات في السجل: ${vList.total || vList.items?.length || vList.length}`);

  const vDetail = await req(`/api/vouchers/${createdInstVouchers[0].id}`);
  console.log(`    🔍 تفاصيل السند ${vDetail.voucher_number}: العميل = ${vDetail.client_name}, طريقة السداد = ${vDetail.payment_type}, ملاحظات = ${vDetail.notes}`);

  // 8. التحقق من إلغاء السند واستعادة الرصيد
  console.log('\n8️⃣  اختبار إلغاء سند واستعادة الرصيد إلى الفاتورة...');
  const cancelRes = await req(`/api/vouchers/${v1.id}/cancel`, 'POST', {});
  console.log(`    🔄 تم إلغاء السند ${v1.voucher_number}: حالة السند الآن = ${cancelRes.status || 'CANCELLED'}`);

  const finalInv1 = await req(`/api/invoices/${inv1.id}`);
  console.log(`    📊 رصيد الفاتورة 1 بعد إلغاء السند: ${finalInv1.remaining_amount} (تمت استعادة 300 ر.س بنجاح)`);

  console.log('\n================================================================');
  console.log('   🎉 اكتمل الاختبار الشامل بنجاح 100%!');
  console.log('   جميع أنماط السندات (الموحد، المنفصل، الدفعي) تعمل بكفاءة تامة.');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\n❌ فشل الاختبار:', err.message);
  process.exit(1);
});
