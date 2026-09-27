// ==========================================================================
//  Raseen — نافذة برومبت الذكاء الاصطناعي الموحد لتوليد القوالب
//  AI Prompt Studio for Invoices & Vouchers Templates
// ==========================================================================
import { toastOk, toastErr, copyText } from '../core/util.js';

export const INVOICE_AI_PROMPT = `أنت مصمم قوالب HTML للطباعة متخصص في الفواتير العربية. أنشئ قالب عرض للفاتورة، مع مراعاة الحقول الضريبية المتاحة؛ لا تدّعِ أن تصميم HTML وحده يثبت الامتثال لـ ZATCA، فالامتثال يعتمد أيضاً على بيانات الفاتورة وآلية إصدارها.

المطلوب:
صمّم قالب فاتورة ضريبية رسمي وأنيق، واضح عند الطباعة والقراءة، في ملف HTML مستقل مع CSS داخلي. أعطِ البيانات والجدول والإجماليات أولوية على الزخرفة؛ لا تخترع بيانات أو وسوماً غير مدعومة.

═══════════════════════════════════════════════════════════════
قاعدة إلغاء تاريخ الاستحقاق وكود العميل (NO DUE DATE & NO BUYER CODE RULE):
═══════════════════════════════════════════════════════════════
- يُمنع منعاً باتاً ومطلقاً إدراج خانة أو وسم "تاريخ الاستحقاق" (due date) في أي مكان في الفاتورة؛ التاريخ المعتمد هو تاريخ ووقت الإصدار فقط.
- يُمنع منعاً باتاً ومطلقاً إدراج خانة أو وسم "كود العميل" (buyer code) في الفاتورة؛ تقتصر بيانات العميل المعتمدة على: اسم العميل، الرقم الضريبي، السجل التجاري إن وجد، العنوان، ورقم الهاتف.

═══════════════════════════════════════════════════════════════
قاعدة الوثيقة البيضاء الصارمة (STRICT WHITE-LABEL MANDATE):
═══════════════════════════════════════════════════════════════
يُمنع منعاً باتاً ومطلقاً كتابة اسم "رصين" أو "Raseen" أو أي اسم لنظام محاسبي أو برمجي في أي مكان داخل الفاتورة!
- لا تذكر اسم رصين أو Raseen في وسم <title> نهائياً (اجعل العنوان فقط: <title>فاتورة ضريبية</title>).
- لا تضعه في الترويسة ولا التذييل ولا العلامة المائية ولا في أي نص إطلاقاً.
- يُمنع تماماً وضع أي كتلة براندينغ أو نص مثل: (رصين - RASEEN INVOICE SYSTEM) أو (تم إنشاء هذا المستند عبر نظام رصين).
- الفاتورة وثيقة رسمية بيضاء (White-Label) خاصة حصراً بالمنشأة البائعة {{seller_name}} وعميلها {{buyer_name}}.
- الفاتورة الضريبية لا تحتوي على خانات تواقيع أو أختام للبائع أو المشتري (خانات التوقيع والختم مخصصة حصراً للسندات المالية فقط).

═══════════════════════════════════════════════════════════════
القواعد الفنية والخلفيات الإبداعية الإلزامية (Aesthetic Standards):
═══════════════════════════════════════════════════════════════
1. الخلفيات واللمسات الجمالية التلقائية:
   - يجب تضمين خلفيات فنية عصرية مدمجة عبر SVG نقي (Pure Inline SVG) تضفي طابعاً ملكياً واحترافياً على الورقة:
     * إما أمواج انسيابية متعددة الطبقات في الزوايا العلوية والسفلية (Corner Waves SVG) بتدرجات لونية هادئة ونسب شفافية ناعمة (0.10 إلى 0.50).
     * أو أشكال هندسية عصرية في الزوايا (Geometric Polygons SVG) تتكون من شرائط ومثلثات مائلة متوازية تفصلها مسافات نقية.
   - علامة مائية خلفية خفيفة جداً في منتصف الصفحة (Watermark) بختم أو شكل هندسي أو زخرفة إسلامية ناعمة لا تتجاوز شفافية 0.035 ليبقى النص مقروءاً بامتياز.
   - أشرطة وعناوين هندسية مقطوعة بزوايا مائلة متميزة بـ clip-path (مثل clip-path: polygon(0 0, 85% 0, 100% 100%, 0 100%)).
   - خطوط تزيينية جانبية للشعار (Flank lines) أو كبسولات ملونة لمعلومات الفاتورة (Info Pills).
   - استخدام أيقونات فيكتور SVG نقية ومدمجة حصراً بجانب العناوين، الهاتف، السجل التجاري، البريد، والرقم الضريبي (يُمنع استخدام أي رموز إيموجي نهائياً).

2. اتجاه الصفحة والطباعة وجودة العرض:
   - الصفحة كاملة تعمل باتجاه اليمين إلى اليسار: dir="rtl" ولغة lang="ar".
   - النصوص والعناوين العربية محاذاة لليمين text-align: right بخط 'Cairo' أو 'Segoe UI', Tahoma.
   - الأرقام والأسعار تكون بخط لاتيني واضح (Tahoma, Arial, sans-serif) ومحاذاة لليسار أو الوسط.
   - إعدادات الطباعة A4 بهوامش داخلية آمنة:
     @page { size: A4 portrait; margin: 0; }
     -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
     page-break-inside: avoid; للبطاقات والصفوف الفردية، مع السماح للجدول الطويل بالاستمرار في صفحة أخرى.
   - الحاوية الرئيسية (.invoice-container) بعرض مناسب لـ A4 مع هوامش طباعة آمنة، وتسمح بزيادة الارتفاع عند كثرة الأصناف.

═══════════════════════════════════════════════════════════════
قاعدة احتواء A4 واستمرار المحتوى عند كثرة الأصناف:
═══════════════════════════════════════════════════════════════
1. استخدم عرض ورقة A4 مع ارتفاع مرن:
   .invoice-container {
     width: 210mm;
     min-height: 297mm;
     box-sizing: border-box;
     padding: 8mm 9mm;
     overflow: visible;
     display: flex;
     flex-direction: column;
     justify-content: space-between;
     position: relative;
     background: #fff;
     margin: 0 auto;
     -webkit-print-color-adjust: exact !important;
     print-color-adjust: exact !important;
   }

2. منع الأغلفة الخارجية نهائياً (No Outer Wrappers):
   يُمنع منعاً باتاً وضع أي حاوية إضافية أو غلاف تكبير/تصغير حول .invoice-container (مثل zoom أو block-content). الحاوية تبدأ مباشرة بعد <body> وتنتهي قبله مباشرة:
   <body>
     <div class="invoice-container">
       ...
     </div>
   </body>

3. وازن المسافات للفاتورة القصيرة بحيث تستقر الإجماليات قرب أسفل الصفحة. إذا زاد عدد الأصناف، اسمح بصفحات إضافية مع تكرار رأس الجدول وعدم قص الصفوف أو الإجماليات. لا تستخدم ارتفاعاً ثابتاً أو overflow: hidden لإجبار المحتوى على صفحة واحدة.
   .bottom-content-wrap {
     margin-top: auto;
   }

4. في هيكل HTML:
   يجب تقسيم المحتوى داخل .invoice-container إلى قسمين رئيسيين فقط:
   <div class="invoice-container">
     <!-- 1. القسم العلوي (الترويسة + بيانات الأطراف + جدول الأصناف) -->
     <div class="top-content-wrap">
       <header class="header">...</header>
       <section class="invoice-metadata">...</section>
       <section class="items-table-container">...</section>
     </div>

     <!-- 2. القسم السفلي (الإجماليات + QR + الملاحظات + التذييل) -->
     <div class="bottom-content-wrap">
       <section class="summary-section">...</section>
       <footer class="footer-zone">...</footer>
     </div>
   </div>

ملاحظة هامة للمصمم:
1. الفاتورة الضريبية الإلكترونية لا تحتوي على خانات تواقيع أو أختام للبائع والمشتري، بل تكتفي بالرمز المشفّر ZATCA QR والإجماليات والملاحظات والتذييل الرسمي (خانات التوقيع والختم مخصصة حصراً لقوالب السندات المالية).
2. قاعدة الوثيقة البيضاء الصارمة (Strict White-Label Rule): يُمنع منعاً باتاً كتابة أي عبارات ترويجية أو إعلانية في التذييل مثل "تم إنشاء وطباعة هذا المستند عبر نظام رصين المالي المعتمد" أو ذكر اسم "رصين / Raseen" أو أي اسم لنظام أو تطبيق برمجي في أي مكان داخل الفاتورة إطلاقاً (لا في العنوان <title>، ولا في الترويسة، ولا في التذييل، ولا العلامة المائية). الفاتورة وثيقة رسمية خالصة خاصة بالمنشأة البائعة {{seller_name}} وعميلها {{buyer_name}} فقط بدون أي اسم لنظام خارجي.

═══════════════════════════════════════════════════════════════
قاعدة منع الباركود الخطي والاعتماد الحصري على رمز QR المربع النظيف (STRICT QR-ONLY & NO LINEAR BARCODE RULE):
═══════════════════════════════════════════════════════════════
0. مقاس رمز الاستجابة السريع (QR Code) الإلزامي وتعميم الأبعاد:
   - يجب أن يكون مقاس حاوية رمز الـ QR ثابتاً لا يقل عن 125px × 125px (أو 33mm × 33mm) نهائياً مع منع الانكماش (flex-shrink: 0; min-width: 125px; min-height: 125px;) وخلفية بيضاء صريحة #ffffff مع حشوة padding: 4px، لضمان قراءة سريعة وموثوقة بنسبة 100% لكافة تطبيقات الهيئة (ZATCA) وكاميرات الجوال عند مسح باركود المرحلة الثانية الكثيف.
   .qr-box { width: 125px; height: 125px; min-width: 125px; min-height: 125px; flex-shrink: 0; background: #ffffff; padding: 4px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border, #cbd5e1); border-radius: 4px; overflow: hidden; }
   .qr-box svg, .qr-box img { width: 100% !important; height: 100% !important; display: block; object-fit: contain; }

1. منع قاطع للباركود الخطي (NO Linear Barcodes):
   يُمنع منعاً باتاً ومطلقاً وضع أي باركود خطي (Barcode / Code128 / Code39) أو خطوط زخرفية أو أشرطة متقطعة تشبه الباركود الخطي في أي مكان في الفاتورة أو التذييل! الفواتير الضريبية تعتمد حصراً على رمز الاستجابة السريع (QR Code) فقط لا غير.

2. قاعدة رمز الاستجابة QR المربع الصارم (Strict Clean Square QR Box):
   - يظهر رمز QR حصراً كمربع مستقل نظيف وأنيق في المنتصف أو في موقعه المخصص بقسم التحقق:
     <div class="qr-box">{{qr_code}}</div>
   - يُمنع منعاً باتاً وضع أي نصوص أو عناوين أو تسميات أو شارات أسفل رمز الـ QR أو حوله (مثل: "رمز الاستجابة السريع"، "ZATCA QR CODE"، "رمز التحقق الإلكتروني"، "امسح الفاتورة"). الرمز يظهر كمربع نقي متناسق دون أي نص توضيحي تحته أو فوقه إطلاقاً.

3. الشعار ورمز QR يوضعان مباشرة في حاوية div دون وسوم img إضافية:
   [خاطئ تماماً]: <img src="{{logo}}"> أو <img src="{{qr_code}}">
   [الصحيح والواجب]:
   <div class="logo-shell">{{logo}}</div>
   <div class="qr-box">{{qr_code}}</div>

4. يتم التحكم بأبعاد وتنسيق الصور داخلياً عبر CSS الحاوية فقط:
   .logo-shell img { max-width: 100%; max-height: 80px; object-fit: contain; }
   .qr-box { width: 125px; height: 125px; min-width: 125px; min-height: 125px; flex-shrink: 0; border: 1px solid var(--border, #cbd5e1); border-radius: 4px; display: flex; align-items: center; justify-content: center; background: #ffffff; overflow: hidden; margin: 0 auto; padding: 4px; box-sizing: border-box; }
   .qr-box img, .qr-box svg { width: 100% !important; height: 100% !important; object-fit: contain; display: block; }

═══════════════════════════════════════════════════════════════
الهيكل البرمجي الإلزامي لجدول الأصناف (Items Table Architecture):
═══════════════════════════════════════════════════════════════
استخدم الهيكل التالي، ويمكن تعديل عرض الأعمدة أو حذف الأعمدة الاختيارية إذا ضاقت الصفحة. اجعل مجموع نسب العرض 100% أو دع المتصفح يوزعها تلقائياً:
<section class="items-table-container">
  <table class="items-main-table">
    <thead>
      <tr>
        <th>#</th>
        <th>كود الصنف</th>
        <th>البيان</th>
        <th>الوحدة</th>
        <th>الكمية</th>
        <th>سعر الوحدة</th>
        <th>قبل الضريبة</th>
        <th>الخصم</th>
        <th>مبلغ الضريبة</th>
        <th>الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      {{items_rows}}
    </tbody>
  </table>
</section>

تحذيرات برمجية صارمة لا تقبل الخطأ:
1. المتغير {{items_rows}} مخصص حصراً وقطعياً ليكون داخل وسوم <tbody> و </tbody> لجدول الأصناف فقط.
2. يُمنع منعاً باتاً كتابة أو تكرار {{items_rows}} في أي عنوان أو فقرة نصية أو في أي مكان خارج <tbody>، لأن وضعه خارج الجدول يتسبب في إفساد التصميم وظهور البيانات كنص مبعثر.
3. لا تضع أي صفوف <tr> وهمية أو بيانات تجريبية داخل <tbody>، فقط اكتب:
   <tbody>
     {{items_rows}}
   </tbody>

═══════════════════════════════════════════════════════════════
قائمة المتغيرات الموحدة الإلزامية (Standard System Placeholders):
═══════════════════════════════════════════════════════════════
يجب توزيع كافة المتغيرات التالية في مواضعها المناسبة:
1. ترويسة المنشأة (المورد / Seller):
   - الشعار: {{logo}} (داخل حاوية div عادية)
   - اسم المنشأة بالعربي: {{seller_name}}
   - اسم المنشأة بالإنجليزي: {{seller_name_en}}
   - الرقم الضريبي: {{seller_tax}}
   - السجل التجاري: {{seller_cr}}
   - العنوان الوطني: {{seller_address}} (مُرتّب قياسياً: المدينة أولاً ثم الحي ثم الشارع ثم رقم المبنى، مثل: جدة - حي الروضة - شارع الأمير سلطان)
   - العنوان بالإنجليزي: {{seller_address_en}} (مُرتّب: City - District - Street - Bldg)
   - المدينة والدولة: {{seller_city}} - {{seller_country}}
   - الهاتف: {{seller_phone}}
   - البريد الإلكتروني: {{seller_email}}

2. بيانات العميل (المشتري / Buyer):
   - اسم العميل: {{buyer_name}}
   - الرقم الضريبي للعميل: {{buyer_tax}}
   - العنوان الوطني للعميل: {{buyer_address}} (مُرتّب قياسياً: المدينة أولاً ثم الحي ثم الشارع ثم رقم المبنى، مثل: جدة - حي الصفا - شارع الأمير ماجد)
   - الهاتف: {{buyer_phone}}
   - ⚠️ قاعدة الترتيب الإلزامي للعنوان: الترتيب الجغرافي المعتمد دائماً يبدأ بالمدينة، ثم الحي، ثم الشارع، ثم رقم المبنى (المدينة ثم حي ... ثم شارع ...). يُمنع إطلاقاً تقديم الشارع على الحي.

3. بيانات الفاتورة الأساسية:
   - رقم الفاتورة: {{invoice_number}}
   - تاريخ الإصدار: {{issue_date}}
   - وقت الإصدار: {{issue_time}}
   - طريقة الدفع: {{payment_method}}
   - إجمالي عدد القطع: {{total_qty}}
   - ⚠️ تنبيه صارم: يُمنع نهائياً وضع "تاريخ الاستحقاق" أو "كود العميل" في القالب.

4. جدول الإجماليات والملخص المالي:
   - المجموع الخاضع للضريبة قبل الضريبة: {{subtotal}}
   - إجمالي الخصم: {{discount}}
   - مبلغ ضريبة القيمة المضافة: {{tax_amount}}؛ لا تفترض نسبة ثابتة ما لم تكن معروضة في البيانات.
   - الإجمالي النهائي شامل الضريبة: {{grand_total}}
   - المبلغ المدفوع: {{paid_amount}}
   - المبلغ المتبقي: {{remaining_amount}}
   - تفقيط المبلغ كتابة بالريال السعودي: {{amount_in_words}}
   - رمز العملة أو أيقونة الريال السعودي الفيكتور: {{sar_symbol}} أو {{currency}}
   - ترتيب عرض كل مبلغ ثابت بصرياً: الرقم أولاً ثم رمز الريال السعودي إلى يمينه، مثل 169.64 ﷼. استخدم ترتيب HTML: <span class="money"><bdi>{{grand_total}}</bdi><span>{{sar_symbol}}</span></span> مع CSS: .money { display: inline-flex; direction: ltr; align-items: center; gap: 3px; white-space: nowrap; }. استبدل {{grand_total}} بوسم المبلغ المناسب في بقية الإجماليات. لا تستخدم flex-direction: row-reverse ولا تضع الرمز قبل الرقم، حتى داخل صفحة RTL.

═══════════════════════════════════════════════════════════════
الهيكل المعماري المعتمد للفاتورة (Corporate Invoice Layout Blueprint):
═══════════════════════════════════════════════════════════════
يجب أن تتطابق تركيبة وهندسة الفاتورة مع التنسيق المعتمد التالي بدقة:

1. الإطار الخارجي العام للصفحة (Page Boundary Frame):
   - إطار مستطيل متقن وواضح يحيط بكامل مساحة ورقة الـ A4 من الداخل (border: 1px solid #71717a; أو border: 1.5px solid var(--primary);) مع هوامش داخلية نظيفة (padding: 12mm-14mm).

2. الترويسة العلوية المتوازنة ثلاثية الأعمدة (3-Column Header):
   - مقسمة إلى 3 أقسام متوازنة (display: grid; grid-template-columns: 1fr auto 1fr; أو flex justify-between):
     * الجهة اليمنى (بيانات المنشأة بالعربي):
       - اسم المنشأة بالعربي بخط كبير عريض 18px-20px: {{seller_name}}
       - العنوان بالعربي: {{seller_address}}
       - الرقم الضريبي: الرقم الضريبي: {{seller_tax}}
       - السجل التجاري: السجل التجاري: {{seller_cr}}
     * المنتصف (الشعار وعنوان الفاتورة):
       - حاوية الشعار في الوسط: <div class="logo-shell">{{logo}}</div>
       - وتحته مباشرة عنوان الفاتورة البارز في المنتصف: فاتورة ضريبية / TAX INVOICE
     * الجهة اليسرى (بيانات المنشأة بالإنجليزي):
       - اسم المنشأة بالإنجليزي بخط عريض: {{seller_name_en}}
       - العنوان بالإنجليزي: {{seller_address_en}}
       - الرقم الضريبي: VAT: {{seller_tax}}
       - السجل التجاري: CR: {{seller_cr}}

3. صندوقا البيانات المتقابلان (Dual Side-by-Side Metadata Boxes):
   - أسفل الترويسة مباشرة، صندوقان مستطيلان متجاوران محاطان بإطار نظيف (border: 1px solid #cbd5e1; border-radius: 4px;):
     * الصندوق الأيمن (بيانات الفاتورة):
       - رقم الفاتورة: {{invoice_number}}
       - تاريخ الإصدار: {{issue_date}}
       - نوع الفاتورة / طريقة الدفع: {{payment_method}}
     * الصندوق الأيسر (بيانات العميل):
       - العميل: {{buyer_name}}
       - الرقم الضريبي: {{buyer_tax}}
       - السجل التجاري: {{buyer_cr}}
       - العنوان: {{buyer_address}}

4. جدول الأصناف والبنود الشبكي (Items Grid Table):
   - جدول شبكي أنيق برأس ملون هادئ وخطوط فاصلة عمودية وأفقية تفصل الأعمدة بوضوح:
     - م (#)
     - البيان (اسم الصنف والخدمة والوصف)
     - سعر الوحدة (Unit Price)
     - الكمية (Qty)
     - قبل الضريبة (المبلغ الخاضع للضريبة)
     - مبلغ الضريبة
     - شامل الضريبة (الإجمالي النهائي شامل الضريبة)
   - وجسم الجدول يحتوي حصراً على: <tbody>{{items_rows}}</tbody>. لا تضف صفوف حشو؛ يجب أن يطابق عدد الخلايا عناوين الأعمدة.

5. القسم السفلي المالي والتحقق (Dual Bottom Summary Section):
   - صندوقان متجاوران أسفل جدول الأصناف مباشرة:
     * الصندوق الأيمن (جدول الإجماليات المالي):
       - شبكة أسطر منظمة: الرقم أولاً ثم {{sar_symbol}} إلى يمينه بصرياً في كل سطر:
         - الإجمالي (قبل الضريبة): {{subtotal}} ثم {{sar_symbol}}
         - الخصم: {{discount}} ثم {{sar_symbol}}
         - مبلغ الضريبة: {{tax_amount}} ثم {{sar_symbol}}
         - الصافي / الإجمالي النهائي: {{grand_total}} ثم {{sar_symbol}} بخط عريض بارز
     * الصندوق الأيسر (رمز التحقق والملاحظات):
       - مربع رمز الاستجابة السريع النقي: <div class="qr-box">{{qr_code}}</div> بمقاس قياسي ثابت لا يقل عن 125px × 125px (أو 33mm × 33mm) في CSS (.qr-box { width: 125px; height: 125px; min-width: 125px; min-height: 125px; flex-shrink: 0; background: #ffffff; padding: 4px; box-sizing: border-box; }) مع .qr-box svg, .qr-box img { width: 100% !important; height: 100% !important; display: block; } بدون أي نصوص أو كتابات أو شارات أسفله إطلاقاً لضمان القراءة الفورية لكافة تطبيقات فحص ZATCA وكاميرات الجوال.
       - صندوق الملاحظات والشروط: {{notes}} بجانبه مع كلمة "ملاحظات"، مع إعطاء مساحة حرة للملاحظات دون أن تضغط على أبعاد الباركود أو تقلص حجمه إطلاقاً.

المخرج المطلوب:
كود HTML كامل ونظيف واحترافي يبدأ مباشرة بـ <!DOCTYPE html> وينتهي بـ </html> دون أي شروحات نصية خارجية ليكون جاهزاً للنسخ والاستخدام الفوري.`;

export const VOUCHER_AI_PROMPT = `أنت مصمم قوالب HTML للطباعة باللغة العربية. أنشئ قالب سند قبض مالي رسمي وأنيق ومتوافق مع وسوم نظام القوالب أدناه. اجعل التصميم مناسباً لبيانات سند حقيقية، ولا تفترض أن القالب ينشئ أو يتحقق من بيانات غير متاحة له.

المخرج: ملف HTML واحد يبدأ بـ <!DOCTYPE html> وينتهي بـ </html>، مع CSS داخلي فقط. أعد الكود وحده بلا مقدمة أو Markdown أو بيانات تجريبية.

الهوية والتصميم:
- الوثيقة خاصة بالمنشأة: لا تذكر اسم رصين أو Raseen أو اسم أي برنامج في <title> أو المتن أو التذييل أو العلامة المائية.
- استخدم <html lang="ar" dir="rtl">، خطاً عربياً متاحاً محلياً، وتبايناً واضحاً. ميّز الرقم والمبلغ والتفقيط بصرياً مع إبقاء الفراغات مريحة.
- اختر لوحة لونين أو ثلاثة وأضف زخرفة هندسية أو SVG مدمجاً بقدر لا يزاحم النص. تجنب الإيموجي والصور والخطوط والسكريبتات الخارجية.
- اجعل الطباعة على A4 عمودي بهوامش آمنة: @page { size: A4 portrait; margin: 10mm; }. أزل خلفية الشاشة والظل عند الطباعة، وتجنب قص المحتوى باستخدام overflow: hidden أو ارتفاع ثابت. امنع فصل صندوق المبلغ ومنطقة التواقيع بين صفحتين قدر الإمكان.

البيانات التي يجب عرضها:
1. الترويسة: <div class="logo-box">{{logo}}</div>، {{seller_name}}، {{seller_address}}، {{seller_phone}}؛ أضف {{seller_name_en}} و{{seller_cr}} و{{seller_tax}} فقط إذا كانت مناسبة لتنسيقك، دون اختلاق قيمة عند الفراغ.
2. عنوان واضح «سند قبض»، ثم رقم السند {{voucher_number}} وتاريخه {{voucher_date}} وطريقة الدفع {{payment_method}}.
3. طرف السند: «استلمنا من» {{received_from}}، و«وذلك مقابل» {{paid_for}}. اترك النص الديناميكي قابلاً للالتفاف عند الطول.
4. المبلغ الرقمي {{amount}} ثم {{sar_symbol}} أو {{currency}} إلى يمينه بصرياً، وتحته تفقيط المبلغ {{amount_in_words}}. لا تضف مبلغاً أو نسبة ضريبة من عندك.
5. منطقة اعتماد بسيطة فيها مساحة لتوقيع المستلم والختم؛ يمكن عرض {{receiver_name}} بوصفه اسم المنشأة/المستلم كما يقدمه المحرك، فلا تسمّه اسم المحاسب أو أمين الصندوق تحديداً.

قواعد الوسوم:
- اكتب الوسوم كما هي تماماً، بلا مرادفات ولا قيم ثابتة بديلة. لا تكرر الوسم إلا إذا احتاجه التصميم فعلاً.
- {{logo}} و{{sar_symbol}} ينتجان HTML/SVG جاهزاً؛ ضعهما داخل عنصر HTML، ولا تستخدمهما في src أو في نص خاصية HTML.
- ثبّت ترتيب المبلغ حتى في صفحة RTL: <span class="money"><bdi>{{amount}}</bdi><span>{{sar_symbol}}</span></span> مع CSS: .money { display: inline-flex; direction: ltr; align-items: center; gap: 3px; white-space: nowrap; }. يجب أن يظهر الرقم أولاً والرمز على يمينه؛ لا تستخدم flex-direction: row-reverse ولا تضع الرمز قبل الرقم. طبّق ذلك على كل مبلغ ظاهر، ويمكن استخدام {{currency}} بدلاً من {{sar_symbol}} بالترتيب نفسه.
- لا تستخدم {{qr_code}} في سند القبض: المحرك يملؤه من QR الفاتورة، وليس رمز تحقق مستقل للسند. لا تضع باركوداً خطياً أو رمز QR زخرفياً.
- لا تستخدم {{items_rows}} أو {{items_table}} في السند، ولا تضف جدول أصناف فاتورة.

راجع قبل الإخراج: الوسوم مكتوبة بدقة، الوثيقة مقروءة بالأبيض والأسود، النص الطويل لا يخرج عن الصفحة، ولا توجد بيانات مختلقة أو عناصر فارغة بارزة.`;

export const UNIFIED_TAGS_LIST = [
  { cat: 'الشعار والباركود', tag: '{{logo}}', desc: 'شعار المنشأة المعتمد تلقائياً' },
  { cat: 'الشعار والباركود', tag: '{{qr_code}}', desc: 'رمز الاستجابة السريع المعتمد (ZATCA QR)' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_name}}', desc: 'اسم المنشأة / البائع بالعربي' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_tax}}', desc: 'الرقم الضريبي للبائع (15 رقماً)' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_cr}}', desc: 'رقم السجل التجاري' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_address}}', desc: 'العنوان الوطني للمنشأة' },
  { cat: 'العميل (المشتري)', tag: '{{buyer_name}}', desc: 'اسم العميل / المشتري' },
  { cat: 'العميل (المشتري)', tag: '{{buyer_tax}}', desc: 'الرقم الضريبي للعميل (إن وجد)' },
  { cat: 'العميل (المشتري)', tag: '{{buyer_address}}', desc: 'عنوان العميل' },
  { cat: 'العميل (المشتري)', tag: '{{buyer_phone}}', desc: 'رقم هاتف / جوال العميل' },
  { cat: 'بيانات الفاتورة', tag: '{{invoice_number}}', desc: 'رقم الفاتورة التسلسلي' },
  { cat: 'بيانات الفاتورة', tag: '{{issue_date}}', desc: 'تاريخ الإصدار (YYYY-MM-DD)' },
  { cat: 'جدول الأصناف', tag: '{{items_rows}}', desc: 'صفوف الأصناف المولدة ديناميكياً داخل <tbody>' },
  { cat: 'الإجماليات', tag: '{{subtotal}}', desc: 'المجموع قبل الضريبة' },
  { cat: 'الإجماليات', tag: '{{tax_amount}}', desc: 'قيمة الضريبة' },
  { cat: 'الإجماليات', tag: '{{grand_total}}', desc: 'الإجمالي النهائي شامل الضريبة' },
  { cat: 'التفقيط والعملة', tag: '{{amount_in_words}}', desc: 'تفقيط المبلغ كتابة بالريال السعودي' },
  { cat: 'التفقيط والعملة', tag: '{{sar_symbol}}', desc: 'أيقونة الريال السعودي Vector SVG' },
  { cat: 'السندات', tag: '{{voucher_number}}', desc: 'رقم السند' },
  { cat: 'السندات', tag: '{{amount}}', desc: 'مبلغ السند رقماً' },
  { cat: 'السندات', tag: '{{received_from}}', desc: 'استلمنا من المكرم' },
  { cat: 'السندات', tag: '{{paid_for}}', desc: 'وذلك مقابل / البيان' },
];

const ICON_SPARKLE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`;
const ICON_INVOICE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
const ICON_VOUCHER = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`;
const ICON_TAGS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`;
const ICON_COPY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const ICON_CHECK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;"><polyline points="20 6 9 17 4 12"/></svg>`;

/**
 * فتح نافذة برومبت الذكاء الاصطناعي التفاعلية
 * @param {Object} options
 * @param {string} options.defaultType 'invoices' | 'documents'
 */
export function openAiPromptModal({ defaultType = 'invoices' } = {}) {
  let activeTab = defaultType === 'documents' || defaultType === 'vouchers' ? 'vouchers' : 'invoices';

  const existing = document.getElementById('modal-ai-prompt-studio');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-ai-prompt-studio';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(8, 14, 26, 0.78);
    backdrop-filter: blur(6px); z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    padding: 16px; direction: rtl; font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
  `;

  overlay.innerHTML = `
    <div style="background: #111a2e; border: 1px solid #233554; border-radius: 12px; width: 850px; max-width: 96vw; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 25px 60px rgba(0,0,0,0.7); color: #f1f5f9; overflow: hidden; animation: popInModal 0.2s ease-out;">
      
      <!-- Top Modal Header -->
      <div style="background: #0b1322; padding: 14px 20px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, #4f46e5, #7c3aed); display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);">
            ${ICON_SPARKLE}
          </div>
          <div>
            <h3 style="margin: 0; font-size: 15.5px; font-weight: 800; color: #fff;">مساعد توليد القوالب بالذكاء الاصطناعي</h3>
            <div style="font-size: 11.5px; color: #94a3b8;">انسخ البرومبت وأعطه لنموذج ذكاء اصطناعي لصناعة قالب متوافق مع وسوم النظام.</div>
          </div>
        </div>
        <button type="button" id="btn-close-ai-modal" style="background: #1e293b; border: 1px solid #334155; color: #94a3b8; width: 32px; height: 32px; border-radius: 6px; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;" title="إغلاق">&times;</button>
      </div>

      <!-- Tab Switcher (فواتير / سندات / وسوم) -->
      <div style="background: #0e172a; padding: 8px 18px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        <div style="display: flex; gap: 6px;">
          <button type="button" class="ai-tab-btn" data-tab="invoices" style="padding: 7px 16px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid ${activeTab === 'invoices' ? '#6366f1' : '#334155'}; background: ${activeTab === 'invoices' ? '#4f46e5' : '#1e293b'}; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_INVOICE} برومبت قوالب الفواتير (Invoices)
          </button>
          <button type="button" class="ai-tab-btn" data-tab="vouchers" style="padding: 7px 16px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid ${activeTab === 'vouchers' ? '#0ea5e9' : '#334155'}; background: ${activeTab === 'vouchers' ? '#0284c7' : '#1e293b'}; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_VOUCHER} برومبت قوالب السندات والمستندات (Vouchers)
          </button>
          <button type="button" class="ai-tab-btn" data-tab="tags" style="padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid #334155; background: #1e293b; color: #94a3b8; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_TAGS} دليل المتغيرات الموحدة
          </button>
        </div>

        <button type="button" id="btn-copy-active-prompt" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none; padding: 7px 18px; border-radius: 6px; font-size: 13px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: transform 0.1s;">
          ${ICON_COPY} نسخ البرومبت
        </button>
      </div>

      <!-- Main Content Area -->
      <div style="flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px;">
        
        <!-- Prompt Box View -->
        <div id="ai-prompt-view" style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label id="lbl-active-prompt-title" style="font-weight: 800; font-size: 13px; color: #38bdf8;">
              نص البرومبت المخصص لقوالب الفواتير (جاهز للنسخ):
            </label>
            <span style="font-size: 11px; color: #64748b;">مضبوط بقواعد ZATCA واللغة العربية وعناصر A4</span>
          </div>

          <textarea id="txt-ai-prompt" readonly style="width: 100%; height: 280px; background: #090e1a; border: 1px solid #1e293b; border-radius: 8px; color: #e2e8f0; padding: 12px 14px; font-size: 12px; font-family: Consolas, monospace, sans-serif; line-height: 1.6; resize: vertical; outline: none;"></textarea>

          <!-- Quick 3-Step Guide -->
          <div style="background: rgba(30, 41, 59, 0.5); border: 1px dashed #334155; border-radius: 8px; padding: 10px 14px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 11.5px; color: #cbd5e1;">
            <div style="display: flex; align-items: flex-start; gap: 6px;">
              <span style="background: #4f46e5; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; flex-shrink: 0;">1</span>
              <span>انسخ البرومبت بالزر الأخضر أعلاه.</span>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 6px;">
              <span style="background: #0284c7; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; flex-shrink: 0;">2</span>
              <span>الصقه في ChatGPT أو Claude واطلب الألوان التي تحبها.</span>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 6px;">
              <span style="background: #10b981; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; flex-shrink: 0;">3</span>
              <span>الصق الكود الناتج في زر «لصق كود HTML» في المحرر.</span>
            </div>
          </div>
        </div>

        <!-- Tags Cheat Sheet View (مخفي افتراضياً) -->
        <div id="ai-tags-view" style="display: none; flex-direction: column; gap: 10px;">
          <div style="font-weight: 800; font-size: 13px; color: #a855f7;">
            قاموس المتغيرات الموحدة القياسية (Standard Placeholders):
          </div>
          <div style="max-height: 320px; overflow-y: auto; border: 1px solid #1e293b; border-radius: 8px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: right;">
              <thead>
                <tr style="background: #0f172a; color: #94a3b8; border-bottom: 1px solid #334155;">
                  <th style="padding: 8px 12px;">المتغير الموحد</th>
                  <th style="padding: 8px 12px;">التصنيف</th>
                  <th style="padding: 8px 12px;">الوصف والاستخدام</th>
                </tr>
              </thead>
              <tbody>
                ${UNIFIED_TAGS_LIST.map((t, i) => `
                  <tr style="border-bottom: 1px solid #1e293b; background: ${i % 2 === 0 ? 'rgba(15,23,42,0.4)' : 'transparent'};">
                    <td style="padding: 6px 12px;"><code style="color: #38bdf8; background: #0f172a; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${t.tag}</code></td>
                    <td style="padding: 6px 12px; color: #94a3b8;">${t.cat}</td>
                    <td style="padding: 6px 12px; color: #e2e8f0;">${t.desc}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  // Tab Handling
  const txtPrompt = overlay.querySelector('#txt-ai-prompt');
  const lblTitle = overlay.querySelector('#lbl-active-prompt-title');
  const promptView = overlay.querySelector('#ai-prompt-view');
  const tagsView = overlay.querySelector('#ai-tags-view');
  const tabBtns = overlay.querySelectorAll('.ai-tab-btn');

  function updateActiveTab(tab) {
    activeTab = tab;
    tabBtns.forEach(btn => {
      const isSel = btn.dataset.tab === tab;
      if (tab === 'invoices') {
        btn.style.background = isSel ? '#4f46e5' : '#1e293b';
        btn.style.borderColor = isSel ? '#6366f1' : '#334155';
      } else if (tab === 'vouchers') {
        btn.style.background = isSel ? '#0284c7' : '#1e293b';
        btn.style.borderColor = isSel ? '#0ea5e9' : '#334155';
      } else {
        btn.style.background = isSel ? '#7c3aed' : '#1e293b';
        btn.style.borderColor = isSel ? '#a855f7' : '#334155';
      }
      btn.style.color = isSel ? '#fff' : '#94a3b8';
    });

    if (tab === 'invoices') {
      promptView.style.display = 'flex';
      tagsView.style.display = 'none';
      lblTitle.textContent = 'نص البرومبت المخصص لقوالب الفواتير الضريبية (جاهز للنسخ):';
      lblTitle.style.color = '#38bdf8';
      txtPrompt.value = INVOICE_AI_PROMPT;
    } else if (tab === 'vouchers') {
      promptView.style.display = 'flex';
      tagsView.style.display = 'none';
      lblTitle.textContent = 'نص البرومبت المخصص لقوالب السندات والمستندات المالية (جاهز للنسخ):';
      lblTitle.style.color = '#0284c7';
      txtPrompt.value = VOUCHER_AI_PROMPT;
    } else if (tab === 'tags') {
      promptView.style.display = 'none';
      tagsView.style.display = 'flex';
    }
  }

  tabBtns.forEach(b => b.addEventListener('click', () => updateActiveTab(b.dataset.tab)));
  updateActiveTab(activeTab);

  // Copy Prompt Button
  const btnCopy = overlay.querySelector('#btn-copy-active-prompt');
  btnCopy.onclick = async () => {
    const textToCopy = activeTab === 'vouchers' ? VOUCHER_AI_PROMPT : INVOICE_AI_PROMPT;
    await copyText(textToCopy);
    btnCopy.innerHTML = `${ICON_CHECK} تم نسخ البرومبت بنجاح!`;
    btnCopy.style.background = '#059669';
    setTimeout(() => {
      btnCopy.innerHTML = `${ICON_COPY} نسخ البرومبت`;
      btnCopy.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    }, 2500);
  };

  // Close Button & Overlay click
  const closeModal = () => overlay.remove();
  overlay.querySelector('#btn-close-ai-modal').onclick = closeModal;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}
