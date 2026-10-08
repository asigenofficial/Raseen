// ==========================================================================
//  Raseen — نافذة برومبت الذكاء الاصطناعي الموحد لتوليد القوالب
//  AI Prompt Studio for Invoices & Vouchers Templates
// ==========================================================================
import { toastOk, toastErr, copyText } from '../core/util.js';

const DESIGN_RULES = `قواعد الإطار وأيقونات SVG الجديدة:
- ابتكر إطاراً مختلفاً في هندسته وزواياه وتوزيع زخارفه، وليس مجرد تغيير اللون. إذا أُرفق قالب سابق فقارن به وتجنب تكرار الإطار ومسارات الأيقونات.
- التغيير في الإطار والزخارف والأيقونات فقط. حافظ على ترتيب البيانات والجداول وعدد الأعمدة والوسوم وأماكن الشعار والإجماليات.
- اسم المنشأة العربي والإنجليزي أفقيان: writing-mode: horizontal-tb دون تدوير أو حروف عمودية، مع RTL للعربية وLTR للإنجليزية والتفاف النص الطويل. استخدم وسوم الأسماء المتاحة فقط دون اختلاق ترجمة.
- استخدم inline SVG أصلياً للإطار والأيقونات، مع الحفاظ على دلالة الهاتف والبريد وغيرها. لا تستبدل شعار المنشأة أو QR أو رمز العملة المعتمد.
- ضع الزخارف داخل الهوامش بعيداً عن النص والأرقام، مع aria-hidden="true" وpointer-events:none. حافظ على مساحة المحتوى ومقاسات الطباعة واستمرار الجداول وتكرار رؤوسها؛ لا تضف JavaScript أو محرك تقسيم صفحات أو مصادر خارجية.
- توجيه الإطار المرفق يحدد الزخرفة فقط، ولا يغير عقد البيانات والطباعة أدناه.`;

const FRAME_DIRECTIONS = [
  'إطار مفتوح غير متناظر بخطين متقابلين وزوايا قصيرة منفصلة؛ زخارف SVG من خطوط متدرجة وأيقونات خطية بزوايا قائمة.',
  'إطار بأقواس ربع دائرية منفصلة عند الزوايا دون مستطيل كامل؛ زخارف حلقية وأيقونات مستديرة مفتوحة المسارات.',
  'إطار بدرجات هندسية عند أعلى اليمين وأسفل اليسار؛ زخارف مربعات مجوفة وأيقونات بنهايات مربعة.',
  'إطار مزدوج متقطع مع فراغات واسعة عند الزوايا؛ زخارف نقاط وخطوط قصيرة وأيقونات من دوائر وخطوط بسيطة.',
  'إطار بأركان مشطوفة ووصلات قطرية قصيرة؛ زخارف معينات مجوفة وأيقونات مضلعة دون أمواج.',
  'إطار منحني على الحافتين الجانبيتين فقط؛ زخارف بمسارات انسيابية رفيعة وأيقونات بخط متصل ونهايات مستديرة.',
];
let frameIndex = 0;
try { frameIndex = parseInt(localStorage.getItem('ai-template-frame-index'), 10) || 0; } catch { /* Storage is optional. */ }
frameIndex = ((frameIndex % FRAME_DIRECTIONS.length) + FRAME_DIRECTIONS.length) % FRAME_DIRECTIONS.length;
function nextFrameDirection() {
  const direction = FRAME_DIRECTIONS[frameIndex];
  frameIndex = (frameIndex + 1) % FRAME_DIRECTIONS.length;
  try { localStorage.setItem('ai-template-frame-index', String(frameIndex)); } catch { /* Continue in memory. */ }
  return direction;
}

export const INVOICE_AI_PROMPT = `أنت مصمم قوالب HTML للطباعة متخصص في الفواتير العربية. أنشئ قالب عرض للفاتورة، مع مراعاة الحقول الضريبية المتاحة؛ لا تدّعِ أن تصميم HTML وحده يثبت الامتثال لـ ZATCA، فالامتثال يعتمد أيضاً على بيانات الفاتورة وآلية إصدارها.

${DESIGN_RULES}

المطلوب:
صمّم قالب فاتورة ضريبية رسمي وأنيق، واضح عند الطباعة والقراءة، في ملف HTML مستقل مع CSS داخلي. أعطِ البيانات والجدول والإجماليات أولوية على الزخرفة؛ لا تخترع بيانات أو وسوماً غير مدعومة.

═══════════════════════════════════════════════════════════════
قاعدة إلغاء تاريخ الاستحقاق وكود العميل (NO DUE DATE & NO BUYER CODE RULE):
═══════════════════════════════════════════════════════════════
- يُمنع منعاً باتاً ومطلقاً إدراج خانة أو وسم "تاريخ الاستحقاق" (due date) في أي مكان في الفاتورة؛ التاريخ المعتمد هو تاريخ ووقت الإصدار فقط.
- يُمنع منعاً باتاً ومطلقاً إدراج خانة أو وسم "كود العميل" (buyer code) في الفاتورة؛ تقتصر بيانات العميل المعتمدة على: اسم العميل، الرقم الضريبي، العنوان، ورقم الهاتف فقط. يُمنع إدراج السجل التجاري للعميل (buyer_cr) نهائياً في الفاتورة الضريبية.

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
1. الإطار واللمسات الجمالية:
   - اتبع توجيه الإطار المتغير المرفق دون فرض أمواج أو مثلثات أو علامة مائية أو زوايا مقصوصة على جميع القوالب. استخدم أيقونات SVG مدمجة واضحة ومتناسقة مع الإطار الجديد؛ لا تستخدم إيموجي.

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
     justify-content: flex-start;
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

3. حافظ على التقسيم كل 15 صنفاً؛ اجعل حاوية الجدول تتمدد في المساحة المتبقية ووزع ارتفاع صفوف البيانات لملء الفراغ، دون صفوف وهمية. ثبّت الباركود والإجماليات والتذييل أسفل الصفحة الأخيرة حتى عند وجود 6 أو 8 أصناف. لا تمدد الخط أو تغير قيمة البيانات.
   وازن المسافات لتملأ الصفحة بدقة ومنع الفراغات الزائدة: استخدم تباعدات متناسقة (مسافة أسفل الترويسة: 10px، مسافة أسفل صناديق البيانات: 12px، حشو خلايا الجدول: 5px 3px بخط 10px، ومسافة أعلى الملخص السفلي: 4mm) لتستقر الإجماليات قرب أسفل الصفحة دون فراغات مشوهة. إذا زاد عدد الأصناف، اسمح بصفحات إضافية مع تكرار رأس الجدول وعدم قص الصفوف أو الإجماليات.
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
يجب كتابة جدول الأصناف في الكود بالترتيب الإلزامي الصارم التالي للأعمدة (8 أعمدة فقط دون عمود # ودون عمود الخصم):
<section class="items-table-container">
  <table class="items-main-table">
    <thead>
      <tr>
        <th style="width: 12%;">رقم الصنف<br><small>Item No</small></th>
        <th style="width: 28%;">اسم الصنف<br><small>Item Name</small></th>
        <th style="width: 10%;">الوحدة<br><small>Unit</small></th>
        <th style="width: 10%;">الكمية<br><small>Qty</small></th>
        <th style="width: 10%;">السعر<br><small>Price</small></th>
        <th style="width: 10%;">قبل الضريبة<br><small>Taxable</small></th>
        <th style="width: 10%;">مبلغ الضريبة<br><small>VAT</small></th>
        <th style="width: 10%;">شامل الضريبة<br><small>Total</small></th>
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
   - ⚠️ أمر صارم: يُمنع تماماً وضع {{buyer_cr}} أو أي خانة للسجل التجاري للعميل في الفاتورة الضريبية؛ السجل التجاري خاص بالبائع فقط.
   - ⚠️ قاعدة الترتيب الإلزامي للعنوان: الترتيب الجغرافي المعتمد دائماً يبدأ بالمدينة، ثم الحي، ثم الشارع، ثم رقم المبنى (المدينة ثم حي ... ثم شارع ...). يُمنع إطلاقاً تقديم الشارع على الحي.

3. بيانات الفاتورة الأساسية:
   - رقم الفاتورة: {{invoice_number}}
   - تاريخ الإصدار: {{issue_date}}
   - وقت الإصدار: {{issue_time}}
   - نوع الفاتورة: {{payment_method}}
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
   - ترتيب عرض كل مبلغ ثابت بصرياً: رمز الريال السعودي دائماً على يسار الرقم، مثل ﷼ 169.64 (أو SAR 169.64). استخدم ترتيب HTML: <span class="money"><span>{{sar_symbol}}</span><bdi>{{grand_total}}</bdi></span> مع CSS: .money { display: inline-flex; direction: ltr; align-items: center; gap: 3px; white-space: nowrap; }. استبدل {{grand_total}} بوسم المبلغ المناسب في بقية الإجماليات. لا تضع الرمز على يمين الرقم إطلاقاً.

═══════════════════════════════════════════════════════════════
الهيكل المعماري المعتمد للفاتورة (Corporate Invoice Layout Blueprint):
═══════════════════════════════════════════════════════════════
ثبّت ترتيب البيانات التالي، مع ابتكار الإطار والزخارف والأيقونات وفق التوجيه المرفق:

1. الإطار الخارجي العام للصفحة (Page Boundary Frame):
   - الإطار وفق التوجيه المرفق داخل الهوامش الآمنة، دون فرض مستطيل كامل أو تغيير padding الحاوية المحدد سابقاً (8mm 9mm).

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
       - ⚠️ قاعدة أيقونات الهيدر الإنجليزي الصارمة: يجب أن تظهر أيقونات الـ SVG دائماً على يسار النص الإنجليزي بصرياً (order: -1 !important; margin-right: 6px !important; margin-left: 0 !important;) لتطابق الترويسة العربية تماماً بحيث تسبق الأيقونة النص ولا تظهر على يمينه إطلاقاً.

3. صندوقا البيانات المتقابلان (Dual Side-by-Side Metadata Boxes):
   - أسفل الترويسة مباشرة، قسمان متجاوران بتنسيق متناسق مع الإطار الجديد:
     * الصندوق الأيمن (بيانات الفاتورة):
       - رقم الفاتورة: {{invoice_number}}
       - تاريخ الإصدار: {{issue_date}}
       - نوع الفاتورة: {{payment_method}}
     * الصندوق الأيسر (بيانات العميل):
       - العميل: {{buyer_name}}
       - الرقم الضريبي: {{buyer_tax}}
       - العنوان: {{buyer_address}}
        - ⚠️ يُمنع إضافة السجل التجاري للعميل هنا أو في أي مكان بالفاتورة.

4. جدول الأصناف والبنود الشبكي (Items Grid Table):
   - جدول شبكي أنيق برأس ملون هادئ وخطوط فاصلة عمودية وأفقية تفصل الأعمدة بوضوح، ويتضمن إلزامياً وبالترتيب الصارم الـ 8 أعمدة التالية دون تكرار (دون عمود # ولا عمود خصم):
     1. رقم الصنف (Item No)
     2. اسم الصنف (Item Name)
     3. الوحدة (Unit)
     4. الكمية (Qty)
     5. السعر (Price)
     6. قبل الضريبة (Taxable)
     7. مبلغ الضريبة (VAT)
     8. شامل الضريبة (Total)
   - وجسم الجدول يحتوي حصراً على: <tbody>{{items_rows}}</tbody>. لا تضف صفوف حشو؛ يجب أن يطابق عدد الخلايا عناوين الأعمدة الـ 8 بدقة وبنفس الترتيب.

5. القسم السفلي المالي والتحقق (Dual Bottom Summary Section):
   - صندوقان متجاوران أسفل جدول الأصناف مباشرة:
     * الصندوق الأيمن (جدول الإجماليات المالي):
       - شبكة أسطر منظمة: الرمز {{sar_symbol}} دائماً على يسار الرقم في كل سطر:
         - الإجمالي (قبل الضريبة): <span class="money"><span>{{sar_symbol}}</span><bdi>{{subtotal}}</bdi></span>
         - الخصم: <span class="money"><span>{{sar_symbol}}</span><bdi>{{discount}}</bdi></span>
         - مبلغ الضريبة: <span class="money"><span>{{sar_symbol}}</span><bdi>{{tax_amount}}</bdi></span>
         - الصافي / الإجمالي النهائي: <span class="money"><span>{{sar_symbol}}</span><bdi>{{grand_total}}</bdi></span> بخط عريض بارز
     * الصندوق الأيسر (رمز التحقق والملاحظات):
       - مربع رمز الاستجابة السريع النقي: <div class="qr-box">{{qr_code}}</div> بمقاس قياسي ثابت لا يقل عن 125px × 125px (أو 33mm × 33mm) في CSS (.qr-box { width: 125px; height: 125px; min-width: 125px; min-height: 125px; flex-shrink: 0; background: #ffffff; padding: 4px; box-sizing: border-box; }) مع .qr-box svg, .qr-box img { width: 100% !important; height: 100% !important; display: block; } بدون أي نصوص أو كتابات أو شارات أسفله إطلاقاً لضمان القراءة الفورية لكافة تطبيقات فحص ZATCA وكاميرات الجوال.
       - صندوق الملاحظات والشروط: {{notes}} بجانبه مع كلمة "ملاحظات"، مع إعطاء مساحة حرة للملاحظات دون أن تضغط على أبعاد الباركود أو تقلص حجمه إطلاقاً.

المخرج المطلوب:
كود HTML كامل ونظيف واحترافي يبدأ مباشرة بـ <!DOCTYPE html> وينتهي بـ </html> دون أي شروحات نصية خارجية ليكون جاهزاً للنسخ والاستخدام الفوري.`;

export const VOUCHER_AI_PROMPT = `أنت مصمم قوالب HTML للطباعة باللغة العربية. أنشئ قالب سند قبض مالي رسمي وأنيق ومتوافق مع وسوم نظام القوالب أدناه. اجعل التصميم مناسباً لبيانات سند حقيقية، ولا تفترض أن القالب ينشئ أو يتحقق من بيانات غير متاحة له.

${DESIGN_RULES}

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
4. المبلغ الرقمي يسبقه رمز العملة {{sar_symbol}} أو {{currency}} إلى يساره بصرياً، وتحته تفقيط المبلغ {{amount_in_words}}. لا تضف مبلغاً أو نسبة ضريبة من عندك.
5. منطقة اعتماد بسيطة فيها مساحة لتوقيع المستلم والختم؛ يمكن عرض {{receiver_name}} بوصفه اسم المنشأة/المستلم كما يقدمه المحرك، فلا تسمّه اسم المحاسب أو أمين الصندوق تحديداً.

قواعد الوسوم:
- اكتب الوسوم كما هي تماماً، بلا مرادفات ولا قيم ثابتة بديلة. لا تكرر الوسم إلا إذا احتاجه التصميم فعلاً.
- {{logo}} و{{sar_symbol}} ينتجان HTML/SVG جاهزاً؛ ضعهما داخل عنصر HTML، ولا تستخدمهما في src أو في نص خاصية HTML.
- ثبّت ترتيب المبلغ حتى في صفحة RTL: <span class="money"><span>{{sar_symbol}}</span><bdi>{{amount}}</bdi></span> مع CSS: .money { display: inline-flex; direction: ltr; align-items: center; gap: 3px; white-space: nowrap; }. يجب أن يظهر رمز الريال على يسار الرقم دائماً؛ لا تضع الرمز على يمين الرقم إطلاقاً. طبّق ذلك على كل مبلغ ظاهر، ويمكن استخدام {{currency}} بدلاً من {{sar_symbol}} بالترتيب نفسه.
- لا تستخدم {{qr_code}} في سند القبض: المحرك يملؤه من QR الفاتورة، وليس رمز تحقق مستقل للسند. لا تضع باركوداً خطياً أو رمز QR زخرفياً.
- لا تستخدم {{items_rows}} أو {{items_table}} في السند، ولا تضف جدول أصناف فاتورة.

راجع قبل الإخراج: الوسوم مكتوبة بدقة، الوثيقة مقروءة بالأبيض والأسود، النص الطويل لا يخرج عن الصفحة، ولا توجد بيانات مختلقة أو عناصر فارغة بارزة.`;

export const REPORT_AI_PROMPT = `أنت مصمم قوالب HTML للطباعة للتقارير المالية العربية. أنشئ قالب تقرير مالي قابلاً لإعادة الاستخدام في نظام محاسبي، ولا تفترض بيانات أو مؤشرات غير موجودة في الوسوم.

${DESIGN_RULES}

المخرج: ملف HTML واحد كامل يبدأ بـ <!DOCTYPE html> وينتهي بـ </html>، مع CSS داخلي فقط. أعد الكود وحده دون Markdown أو شرح خارجي.

الوسوم التي يملؤها النظام:
- {{title}} عنوان التقرير.
- {{subtitle}} وصف التقرير أو الفترة والمنشأة.
- {{issuer_name}} اسم المنشأة.
- {{generated_at}} تاريخ ووقت إنشاء التقرير.
- {{page_size}} مقاس الطباعة المناسب، مثل A4 portrait أو A4 landscape.
- {{stats_html}} بطاقات المؤشرات المالية الجاهزة، وقد تكون فارغة.
- {{headers_html}} خلايا رؤوس الجدول الجاهزة داخل <thead>.
- {{rows_html}} صفوف البيانات الجاهزة داخل <tbody>.
- {{footer_html}} صف الإجمالي الجاهز، وقد يكون فارغاً.

قواعد الربط المهمة:
1. اكتب كل وسم كما هو تماماً، ولا تنشئ أسماء وسوم بديلة أو بيانات ثابتة تجريبية.
2. ضع {{stats_html}} و{{headers_html}} و{{rows_html}} و{{footer_html}} في مواضع HTML المناسبة مباشرة؛ هذه الوسوم تحتوي HTML مولداً من بيانات التقرير.
3. لا تضع الوسوم داخل علامات اقتباس أو خصائص HTML أو JavaScript. استخدم {{title}} و{{subtitle}} و{{issuer_name}} و{{generated_at}} كنصوص في الصفحة.
4. اجعل منطقة المؤشرات مرنة إذا كانت {{stats_html}} فارغة، وأخفِ صف التذييل إذا كانت {{footer_html}} فارغة باستخدام :empty أو CSS مناسب.

التصميم والطباعة:
- صفحة عربية lang="ar" dir="rtl"، خط محلي مثل Cairo أو Tahoma، وتسلسل بصري واضح لعنوان التقرير والمنشأة والفترة.
- استخدم خلفية زخرفية SVG مدمجة داخل الملف (inline SVG) بدرجات خفيفة في أطراف الصفحة، بحيث لا تحجب الجدول أو تستهلك الحبر بكثافة.
- أضف بطاقات للمؤشرات حول {{stats_html}} وجدولاً مالياً واضحاً حول الرؤوس والصفوف، مع خطوط وألوان مناسبة للطباعة بالأبيض والأسود.
- اجعل حجم الصفحة ديناميكياً باستخدام @page { size: {{page_size}}; margin: 10mm; }، وأخفِ عناصر الشاشة غير اللازمة في @media print.
- كرر رأس الجدول عند امتداد التقرير إلى صفحات متعددة، واسمح للصفوف بالانتقال دون قصها. لا تستخدم ارتفاعاً ثابتاً أو overflow:hidden على حاوية التقرير.
- أضف تذييلاً بسيطاً لاسم المنشأة ووقت الإنشاء باستخدام الوسوم المتاحة، دون اختراع أرقام صفحات أو أرقام مالية.
- لا تذكر اسم رصين أو Raseen أو أي برنامج في العنوان أو المحتوى أو التذييل. لا تستخدم مصادر أو خطوطاً خارجية أو JavaScript أو إيموجي.

أعد قالباً عاماً يصلح لتقارير المبيعات والضريبة والتحصيل والربحية والأرصدة؛ لا تفترض نوعاً واحداً للأعمدة، لأن النظام يمرر رؤوساً وصفوفاً مختلفة لكل تقرير.`;

export const STATEMENT_AI_PROMPT = `أنت مصمم قوالب HTML للطباعة لكشف حساب عميل عربي. أنشئ كشفاً مالياً واضحاً ودقيقاً؛ لا تخترع حركات أو أرصدة أو بيانات عميل.

${DESIGN_RULES}

المخرج: ملف HTML واحد كامل يبدأ بـ <!DOCTYPE html> وينتهي بـ </html>، مع CSS داخلي فقط. أعد الكود وحده دون Markdown أو شرح خارجي.

الوسوم التي يملؤها النظام:
- {{issuer_name}} اسم المنشأة.
- {{issuer_name_en}} اسم المنشأة بالإنجليزية.
- {{issuer_tax}} الرقم الضريبي.
- {{issuer_cr}} السجل التجاري.
- {{issuer_address}} العنوان الوطني بالعربية.
- {{issuer_address_en}} العنوان بالإنجليزية.
- {{issuer_phone}} رقم الهاتف.
- {{issuer_email}} البريد الإلكتروني.
- {{issuer_city_country}} المدينة والدولة.
- {{logo_html}} عنصر HTML جاهز لشعار المنشأة؛ أدرجه كما هو دون تعديل أو إنشاء شعار بديل.
- {{client_name}} اسم العميل.
- {{client_code}} رقم حساب العميل أو رمزه.
- {{currency_name}} اسم العملة.
- {{period_from}} بداية الفترة.
- {{period_to}} نهاية الفترة.
- {{opening_balance}} رصيد بداية الفترة.
- {{total_debit}} إجمالي الحركة المدينة.
- {{total_credit}} إجمالي الحركة الدائنة.
- {{closing_balance}} الرصيد الختامي.
- {{rows_html}} صفوف الحركات الجاهزة داخل جدول كشف الحساب.

ترتيب أعمدة كل صف داخل {{rows_html}} ثابت كما يلي: رقم الحركة التسلسلي، رقم المستند أو القيد، التاريخ، نوع الحركة، البيان، حركة مدين، حركة دائن، الرصيد مدين، الرصيد دائن. يتضمن الوسم صف الرصيد السابق جاهزاً عند توفره؛ لا تضف صفاً افتتاحياً أو أرقاماً بنفسك. يحتوي الوسم على عناصر <tr> و<td> كاملة؛ ضعه مباشرة داخل <tbody> دون ترميزه أو إحاطته بعلامات اقتباس.

التصميم والطباعة:
- اجعل الصفحة lang="ar" dir="rtl" وباتجاه طباعة A4 عمودي.
- حافظ على ترويسة بثلاثة أعمدة واضحة بإطار وزخارف وفق التوجيه الجديد؛ اسم المنشأة الإنجليزية وعنوانها والرقم الضريبي والسجل التجاري يساراً، {{logo_html}} في الوسط وتحته «كشف حساب عميل» ثم «ACCOUNT STATEMENT»، واسم المنشأة العربية والعنوان والرقم الضريبي والسجل التجاري يميناً. أضف شريط تواصل سفلي داخل الإطار للهاتف والبريد والمدينة، بتنسيق متناسق مع الإطار المختار دون فرض خط ذهبي. حافظ على هذا الترتيب في الشاشات والطباعة.
- ضع فترة الكشف أسفل الترويسة، ثم شريطاً محاطاً بإطار لرقم الحساب واسم الحساب والعملة.
- أظهر شريط بيانات الحساب والفترة، واجعل صف الرصيد السابق المضمّن في {{rows_html}} أول صف في جدول الحركات. لا تضف ملخصات أو أرصدة مكررة.
- اجعل الجدول مطابقاً لترتيب الأعمدة: #، رقم المستند/قيد، التاريخ، النوع، البيان، مجموعة «الحركة» وبداخلها مدين ودائن، ومجموعة «الرصيد» وبداخلها مدين ودائن.
- اختر ألواناً متناسقة عالية التباين؛ الاختلاف المطلوب في هندسة الإطار وأيقونات SVG وليس اللون وحده. لا تضع زخرفة خلف البيانات أو الأرقام.
- استخدم جدولاً واضحاً بأرقام سهلة القراءة، وكرّر رأس الجدول في كل صفحة مطبوعة. اسمح للصفوف بالاستمرار إلى صفحات إضافية وتجنب قص النص الطويل أو استخدام ارتفاع ثابت وoverflow:hidden.
- استخدم @page { size: A4 portrait; margin: 8mm; } وأزل ظلال وأزرار الشاشة عند الطباعة.
- اعرض الأرصدة والإجماليات كما وصلت من الوسوم. لا تغيّر إشارات المبالغ ولا تعكس معنى المدين والدائن، ولا تضع رصيداً أو حركة افتراضية.
- لا تذكر اسم رصين أو Raseen أو أي نظام في العنوان أو المحتوى أو التذييل. لا تستخدم وسوماً غير المذكورة، ولا JavaScript أو مصادر خارجية أو إيموجي.

اجعل القالب مناسباً لكشوف الحساب الطويلة، واحتفظ بمساحة توقيع أو اعتماد اختيارية فقط إذا لم تزاحم الحركات، دون إنشاء بيانات توقيع غير موجودة.`;

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
  // ❌ buyer_cr محذوف — السجل التجاري للعميل لا يُستخدم في الفواتير الضريبية
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
  { cat: 'التقارير المالية', tag: '{{title}}', desc: 'عنوان التقرير' },
  { cat: 'التقارير المالية', tag: '{{subtitle}}', desc: 'الفترة ووصف التقرير' },
  { cat: 'التقارير المالية', tag: '{{issuer_name}}', desc: 'اسم المنشأة' },
  { cat: 'التقارير المالية', tag: '{{generated_at}}', desc: 'وقت إنشاء التقرير' },
  { cat: 'التقارير المالية', tag: '{{page_size}}', desc: 'حجم الصفحة واتجاهها للطباعة' },
  { cat: 'التقارير المالية', tag: '{{stats_html}}', desc: 'بطاقات ملخص التقرير بصيغة HTML' },
  { cat: 'التقارير المالية', tag: '{{headers_html}}', desc: 'رؤوس أعمدة الجدول بصيغة HTML' },
  { cat: 'التقارير المالية', tag: '{{rows_html}}', desc: 'صفوف بيانات التقرير بصيغة HTML' },
  { cat: 'التقارير المالية', tag: '{{footer_html}}', desc: 'صف إجمالي التقرير بصيغة HTML' },
  { cat: 'كشف الحساب', tag: '{{client_name}}', desc: 'اسم العميل' },
  { cat: 'كشف الحساب', tag: '{{client_code}}', desc: 'رقم حساب العميل' },
  { cat: 'كشف الحساب', tag: '{{issuer_name_en}}', desc: 'اسم المنشأة بالإنجليزية' },
  { cat: 'كشف الحساب', tag: '{{issuer_tax}}', desc: 'الرقم الضريبي للمنشأة' },
  { cat: 'كشف الحساب', tag: '{{issuer_cr}}', desc: 'السجل التجاري للمنشأة' },
  { cat: 'كشف الحساب', tag: '{{issuer_address}}', desc: 'عنوان المنشأة بالعربية' },
  { cat: 'كشف الحساب', tag: '{{issuer_address_en}}', desc: 'عنوان المنشأة بالإنجليزية' },
  { cat: 'كشف الحساب', tag: '{{issuer_phone}}', desc: 'هاتف المنشأة' },
  { cat: 'كشف الحساب', tag: '{{issuer_email}}', desc: 'بريد المنشأة' },
  { cat: 'كشف الحساب', tag: '{{issuer_city_country}}', desc: 'المدينة والدولة' },
  { cat: 'كشف الحساب', tag: '{{logo_html}}', desc: 'عنصر شعار المنشأة HTML جاهز' },
  { cat: 'كشف الحساب', tag: '{{currency_name}}', desc: 'اسم العملة' },
  { cat: 'كشف الحساب', tag: '{{period_from}}', desc: 'بداية فترة الكشف' },
  { cat: 'كشف الحساب', tag: '{{period_to}}', desc: 'نهاية فترة الكشف' },
  { cat: 'كشف الحساب', tag: '{{opening_balance}}', desc: 'رصيد بداية الفترة' },
  { cat: 'كشف الحساب', tag: '{{total_debit}}', desc: 'إجمالي الحركة المدينة' },
  { cat: 'كشف الحساب', tag: '{{total_credit}}', desc: 'إجمالي الحركة الدائنة' },
  { cat: 'كشف الحساب', tag: '{{closing_balance}}', desc: 'الرصيد الختامي' },
  { cat: 'كشف الحساب', tag: '{{rows_html}}', desc: 'صفوف الحركات المالية بصيغة HTML' },
];

const ICON_SPARKLE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`;
const ICON_INVOICE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
const ICON_VOUCHER = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`;
const ICON_REPORT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/><path d="M17 9h2v2"/></svg>`;
const ICON_STATEMENT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
const ICON_TAGS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`;
const ICON_COPY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const ICON_CHECK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;"><polyline points="20 6 9 17 4 12"/></svg>`;

/**
 * فتح نافذة برومبت الذكاء الاصطناعي التفاعلية
 * @param {Object} options
 * @param {string} options.defaultType 'invoices' | 'documents' | 'reports' | 'statements'
 */
export function openAiPromptModal({ defaultType = 'invoices' } = {}) {
  const allowedTabs = ['invoices', 'vouchers', 'reports', 'statements'];
  let activeTab = defaultType === 'documents' ? 'vouchers' : (allowedTabs.includes(defaultType) ? defaultType : 'invoices');

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
      <div style="background: #0b1322; padding: 14px 20px; border-bottom: 1px solid #1e293b; display: flex; justify-content: flex-start; align-items: center;">
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

      <!-- Tab Switcher (أنواع القوالب / الوسوم) -->
      <div style="background: #0e172a; padding: 8px 18px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: flex-start; gap: 8px; flex-wrap: wrap;">
        <div style="display: flex; gap: 6px; flex-wrap:wrap;">
          <button type="button" class="ai-tab-btn" data-tab="invoices" style="padding: 7px 16px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid ${activeTab === 'invoices' ? '#6366f1' : '#334155'}; background: ${activeTab === 'invoices' ? '#4f46e5' : '#1e293b'}; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_INVOICE} برومبت قوالب الفواتير (Invoices)
          </button>
          <button type="button" class="ai-tab-btn" data-tab="vouchers" style="padding: 7px 16px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid ${activeTab === 'vouchers' ? '#0ea5e9' : '#334155'}; background: ${activeTab === 'vouchers' ? '#0284c7' : '#1e293b'}; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_VOUCHER} برومبت قوالب السندات والمستندات (Vouchers)
          </button>
          <button type="button" class="ai-tab-btn" data-tab="reports" style="padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid ${activeTab === 'reports' ? '#10b981' : '#334155'}; background: ${activeTab === 'reports' ? '#059669' : '#1e293b'}; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_REPORT} تقرير مالي
          </button>
          <button type="button" class="ai-tab-btn" data-tab="statements" style="padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid ${activeTab === 'statements' ? '#f59e0b' : '#334155'}; background: ${activeTab === 'statements' ? '#d97706' : '#1e293b'}; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_STATEMENT} كشف حساب
          </button>
          <button type="button" class="ai-tab-btn" data-tab="tags" style="padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid #334155; background: #1e293b; color: #94a3b8; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_TAGS} دليل المتغيرات الموحدة
          </button>
        </div>

        <button type="button" id="btn-next-frame" style="cursor:pointer; padding:7px 12px;">إطار مختلف</button>
        <button type="button" id="btn-copy-active-prompt" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none; padding: 7px 18px; border-radius: 6px; font-size: 13px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: transform 0.1s;">
          ${ICON_COPY} نسخ البرومبت
        </button>
      </div>

      <!-- Main Content Area -->
      <div style="flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px;">
        
        <!-- Prompt Box View -->
        <div id="ai-prompt-view" style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: flex-start; align-items: center;">
            <label id="lbl-active-prompt-title" style="font-weight: 800; font-size: 13px; color: #38bdf8;">
              نص البرومبت المخصص لقوالب الفواتير (جاهز للنسخ):
            </label>
            <span style="font-size: 11px; color: #64748b;">وسوم موحدة وتصميم عربي جاهز للطباعة</span>
          </div>

          <textarea id="txt-ai-prompt" readonly style="width: 100%; height: 280px; background: #090e1a; border: 1px solid #1e293b; border-radius: 8px; color: #e2e8f0; padding: 12px 14px; font-size: 12px; font-family: Consolas, monospace, sans-serif; line-height: 1.6; resize: vertical; outline: none;"></textarea>

          <!-- Quick 3-Step Guide -->
          <div style="background: rgba(30, 41, 59, 0.5); border: 1px dashed #334155; border-radius: 8px; padding: 10px 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; font-size: 11.5px; color: #cbd5e1;">
            <div style="display: flex; align-items: flex-start; gap: 6px;">
              <span style="background: #4f46e5; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; flex-shrink: 0;">1</span>
              <span>انسخ البرومبت بالزر الأخضر أعلاه.</span>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 6px;">
              <span style="background: #0284c7; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; flex-shrink: 0;">2</span>
              <span>الصقه في الوكيل وأرفق القالب السابق للمقارنة؛ استخدم «إطار مختلف» لتغيير التوجيه قبل النسخ.</span>
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

  const frameDirections = {};

  // Tab Handling
  const txtPrompt = overlay.querySelector('#txt-ai-prompt');
  const lblTitle = overlay.querySelector('#lbl-active-prompt-title');
  const promptView = overlay.querySelector('#ai-prompt-view');
  const tagsView = overlay.querySelector('#ai-tags-view');
  const tabBtns = overlay.querySelectorAll('.ai-tab-btn');

  function updateActiveTab(tab) {
    activeTab = tab;
    overlay.querySelector("#btn-next-frame").hidden = tab === "tags";
    overlay.querySelector("#btn-copy-active-prompt").hidden = tab === "tags";
    if (tab !== "tags" && !frameDirections[tab]) frameDirections[tab] = nextFrameDirection();
    tabBtns.forEach(btn => {
      const isSel = btn.dataset.tab === tab;
      if (tab === 'invoices') {
        btn.style.background = isSel ? '#4f46e5' : '#1e293b';
        btn.style.borderColor = isSel ? '#6366f1' : '#334155';
      } else if (tab === 'vouchers') {
        btn.style.background = isSel ? '#0284c7' : '#1e293b';
        btn.style.borderColor = isSel ? '#0ea5e9' : '#334155';
      } else if (tab === 'reports') {
        btn.style.background = isSel ? '#059669' : '#1e293b';
        btn.style.borderColor = isSel ? '#10b981' : '#334155';
      } else if (tab === 'statements') {
        btn.style.background = isSel ? '#d97706' : '#1e293b';
        btn.style.borderColor = isSel ? '#f59e0b' : '#334155';
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
      txtPrompt.value = INVOICE_AI_PROMPT + "\n\nتوجيه الإطار لهذه النسخة:\n" + frameDirections[tab];
    } else if (tab === 'vouchers') {
      promptView.style.display = 'flex';
      tagsView.style.display = 'none';
      lblTitle.textContent = 'نص البرومبت المخصص لقوالب السندات والمستندات المالية (جاهز للنسخ):';
      lblTitle.style.color = '#0284c7';
      txtPrompt.value = VOUCHER_AI_PROMPT + "\n\nتوجيه الإطار لهذه النسخة:\n" + frameDirections[tab];
    } else if (tab === 'reports') {
      promptView.style.display = 'flex';
      tagsView.style.display = 'none';
      lblTitle.textContent = 'برومبت إنشاء قالب تقرير مالي HTML (جاهز للنسخ):';
      lblTitle.style.color = '#10b981';
      txtPrompt.value = REPORT_AI_PROMPT + "\n\nتوجيه الإطار لهذه النسخة:\n" + frameDirections[tab];
    } else if (tab === 'statements') {
      promptView.style.display = 'flex';
      tagsView.style.display = 'none';
      lblTitle.textContent = 'برومبت إنشاء قالب كشف حساب عميل HTML (جاهز للنسخ):';
      lblTitle.style.color = '#f59e0b';
      txtPrompt.value = STATEMENT_AI_PROMPT + "\n\nتوجيه الإطار لهذه النسخة:\n" + frameDirections[tab];
    } else if (tab === 'tags') {
      promptView.style.display = 'none';
      tagsView.style.display = 'flex';
    }
  }

  tabBtns.forEach(b => b.addEventListener('click', () => updateActiveTab(b.dataset.tab)));
  updateActiveTab(activeTab);

  overlay.querySelector("#btn-next-frame").onclick = () => {
    frameDirections[activeTab] = nextFrameDirection();
    updateActiveTab(activeTab);
  };

  // Copy Prompt Button
  const btnCopy = overlay.querySelector('#btn-copy-active-prompt');
  btnCopy.onclick = async () => {
    if (activeTab === "tags") return;
    const textToCopy = txtPrompt.value;
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
