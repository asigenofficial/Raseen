// ==========================================================================
//  Raseen — نافذة برومبت الذكاء الاصطناعي الموحد لتوليد القوالب
//  AI Prompt Studio for Invoices, Credit Notes, Vouchers & Documents
// ==========================================================================
import { copyText } from '../core/util.js';

const DESIGN_RULES = `قواعد التصميم والأسلوب البصري وأيقونات SVG:
- الأولوية الكاملة لطلب المستخدم: إذا أرفق المستخدم صورة قالب مرجعي فالتزم بمحاكاة تخطيطه وألوانه وإطاره وزخارفه وترويسته وجدوله بدقة؛ وإذا وصف ألواناً أو إطاراً أو تفاصيل معينة فنفّذها حرفياً دون فرض أمواج أو مثلثات أو زوايا غير مطلوبة.
- الحفاظ على عقد البيانات والطباعة: التخصيص البصري (الألوان، الإطار، الزوايا، الزخارف، الخطوط) لا يغيّر أسماء الوسوم {{...}} أو بنية الحاويات المعتمدة أو قواعد جدول الأصناف أو الـ QR أو اتجاه العملة.
- أسماء المنشأة ثنائية الاتجاه: اسم المنشأة العربي والإنجليزي يبقيان أفقيين دائماً (writing-mode: horizontal-tb) دون تدوير، مع RTL للعربية وLTR للإنجليزية والتفاف النص الطويل (overflow-wrap: anywhere)، ودون اختلاق ترجمة إنجليزية إذا كان {{seller_name_en}} فارغاً.
- الزخارف والأيقونات: استخدم inline SVG أصلياً فقط للأيقونات والزخارف الخفيفة (ممنوع الإيموجي، الصور الخارجية، الخطوط الخارجية/CDN، أو JavaScript). اجعل الزخارف والشارات الخلفية بـ aria-hidden="true" وpointer-events: none وعلى طبقة خلفية (z-index: -1) مع isolation: isolate على الحاوية الرئيسية حتى لا تغطي النص أو الأرقام.
- لا تستبدل {{logo}} أو {{qr_code}} أو {{sar_symbol}} برسوم ثابتة.`;

const FRAME_DIRECTIONS = [
  'إطار مفتوح غير متناظر بخطين متقابلين وزوايا قصيرة منفصلة؛ زخارف SVG من خطوط متدرجة وأيقونات خطية بزوايا قائمة.',
  'إطار بأقواس ربع دائرية منفصلة عند الزوايا دون مستطيل كامل؛ زخارف حلقية وأيقونات مستديرة مفتوحة المسارات.',
  'إطار بدرجات هندسية عند أعلى اليمين وأسفل اليسار؛ زخارف مربعات مجوفة وأيقونات بنهايات مربعة.',
  'إطار مزدوج متقطع مع فراغات واسعة عند الزوايا؛ زخارف نقاط وخطوط قصيرة وأيقونات من دوائر وخطوط بسيطة.',
  'إطار بأركان مشطوفة ووصلات قطرية قصيرة؛ زخارف معينات مجوفة وأيقونات مضلعة نظيفة دون أمواج.',
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

export const INVOICE_AI_PROMPT = `أنت مصمم ومطور قوالب HTML للطباعة متخصص في الفواتير الضريبية العربية وإشعارات الدائن (مرتجع المبيعات). مهمتك إنتاج قالب عرض HTML مستقل مع CSS داخلي دقيق للطباعة على A4 ومتوافق 100% مع محرك القوالب والمحرر في النظام (لا تدّعِ أن تصميم HTML وحده يثبت الامتثال النظامي لـ ZATCA، فالامتثال يعتمد أيضاً على بيانات الفاتورة وآلية إصدارها).

═══════════════════════════════════════════════════════════════
0. بروتوكول البدء التفاعلي الإلزامي (صورة القالب أو وصف التصميم):
═══════════════════════════════════════════════════════════════
قبل أن تكتب أي سطر كود HTML، افحص رسالة المستخدم الحالية ومرفقاتها:
• الحالة (أ) — لم تُرفَق صورة للقالب ولم يُكتب وصف بصري لتفاصيل التصميم (لا في رسالة المستخدم ولا في قسم «مواصفات التصميم المختارة» إن وُجد أسفل هذا البرومبت):
  توقّف ولا تُخرج أي كود HTML الآن! خاطب المستخدم بلطف واختصار واطلب منه أحد خيارين:
  1. إرفاق **صورة لنفس قالب الفاتورة** (أو المستند) الذي يريده، لتقوم بتحليله ومحاكاة ألوانه وإطاره وتوزيع ترويسته وبطاقاته وجدوله بدقة مع ربطه بوسوم وعقد النظام.
  2. أو **إذا لم تتوفر صورة**، اطلب منه **وصف التصميم الذي يريده** عبر النقاط التالية:
     - **الألوان:** اللون الأساسي، اللون الثانوي/المميز، ألوان خلفيات البطاقات ورأس الجدول، ومدى ملاءمته للطباعة الملونة أو بالأبيض والأسود.
     - **الإطار والزخارف:** نوع الإطار/البرواز (بدون إطار، خط رفيع، مزدوج كلاسيكي، أركان/زوايا هندسية، زخارف جانبية، علامة مائية خفيفة بالخلفية) وشكل زوايا الصناديق (حادة أو دائرية).
     - **المزيد من التفاصيل (التصميم العام):** الطابع المطلوب (فخم/رسمي، تجاري كلاسيكي، عصري بسيط، إلخ)، توزيع الترويسة (3 أعمدة عربية/شعار/إنجليزية أو شريط أفقي)، شكل جدول الأصناف (شبكي كامل أو خطوط أفقية هادئة)، نوع وحجم الخط، وأي تفاصيل أو ملاحظات إضافية يريدها في أسفل الفاتورة.
• الحالة (ب) — أرفق المستخدم صورة القالب أو قدّم وصفاً للألوان والإطار والتفاصيل (أو وُجد قسم مواصفات أسفل البرومبت):
  نفّذ تصميمه بدقة كاملة مع الالتزام الصارم بجميع القواعد الفنية والوسوم أدناه، وأخرج كود HTML كاملاً يبدأ مباشرة بـ <!DOCTYPE html> وينتهي بـ </html> دون شروحات نصية خارج الكود ليكون جاهزاً للصق والاستخدام الفوري.

═══════════════════════════════════════════════════════════════
1. قواعد التصميم والعقد البصري المشترك:
═══════════════════════════════════════════════════════════════
${DESIGN_RULES}

═══════════════════════════════════════════════════════════════
2. القواعد المحاسبية الصارمة والوثيقة البيضاء وتوافق إشعار الدائن:
═══════════════════════════════════════════════════════════════
- قاعدة الوثيقة البيضاء (Strict White-Label): يُمنع منعاً باتاً كتابة اسم "رصين" أو "Raseen" أو أي اسم لنظام أو تطبيق محاسبي في <title> أو الترويسة أو التذييل أو العلامة المائية أو التعليقات البرمجية. اجعل عنوان الصفحة: <title>فاتورة ضريبية</title>.
- ممنوعات الحقول:
  1. يُمنع نهائياً إدراج وسم أو خانة "تاريخ الاستحقاق" ({{due_date}})؛ التاريخ المعتمد هو تاريخ ووقت الإصدار فقط.
  2. يُمنع نهائياً إدراج "كود العميل" ({{buyer_code}}) أو "السجل التجاري للعميل" ({{buyer_cr}}) في الفاتورة؛ السجل التجاري خاص بالبائع فقط.
  3. الفواتير الضريبية الإلكترونية لا تحتوي على خانات تواقيع أو أختام للبائع أو المشتري (التواقيع والأختام مخصصة للسندات المالية فقط).
- التوافق التلقائي مع «إشعار دائن (مرتجع مبيعات)»:
  نفس قالب الفاتورة هذا يستخدمه النظام أيضاً لطباعة إشعار الدائن (مرتجع مبيعات) بنفس التصميم مع استبدال العناوين وحقن رقم الفاتورة الأصلية وتاريخها وسبب الإرجاع تلقائياً. لذلك التزم بهذه الصيغ القياسية ليتم التحويل تلقائياً بدقة في كافة القوالب:
  * اجعل عنوان الوثيقة واضحاً بصيغة: فاتورة ضريبية ومعه TAX INVOICE (مثال: <h1 class="document-name">فاتورة ضريبية<small lang="en" dir="ltr">TAX INVOICE</small></h1>).
  * سمِّ بطاقة بيانات الفاتورة: بيانات الفاتورة، واعرض الحقول بنمط .field واضح داخل .info-card.invoice-info مثل:
    <div class="field"><dt>رقم الفاتورة</dt><dd><bdi>{{invoice_number}}</bdi></dd></div>
    <div class="field"><dt>تاريخ الإصدار</dt><dd><bdi>{{issue_date}}</bdi></dd></div>
    (بهذا يتمكّن محرك النظام من حقن «رقم الفاتورة الأصلية» و«تاريخ الفاتورة الأصلية» و«سبب الإرجاع» تلقائياً عند عرض إشعار الدائن).

═══════════════════════════════════════════════════════════════
3. إعدادات الطباعة A4 والبنية المعترف بها في المحرك والمحرر:
═══════════════════════════════════════════════════════════════
- اتجاه الصفحة والخطوط: <html lang="ar" dir="rtl">. النصوص العربية بمحاذاة لليمين وخط مناسب مثل 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif. الأرقام والرموز اللاتينية بخط رقمي واضح (Tahoma, Arial, sans-serif; font-variant-numeric: tabular-nums;).
- متغيرات الألوان: عرّف ألوان التصميم في :root { --primary: ...; --accent: ...; --tint: ...; --border: ...; } حتى يتعرف عليها محرر الألوان التلقائي في النظام.
- منع الأغلفة الخارجية: تبدأ حاوية .invoice-container مباشرة داخل <body> دون أي عنصر تغليف إضافي (wrapper / zoom):
  <body>
    <div class="invoice-container">
      <div class="top-content-wrap">
        <header class="header">...</header>
        <section class="invoice-metadata">...</section>
        <section class="items-table-container">
          <table class="items-main-table">...</table>
        </section>
      </div>
      <div class="bottom-content-wrap">
        <section class="summary-section">...</section>
        <footer class="footer-zone">...</footer>
      </div>
    </div>
  </body>
- إعدادات CSS لورقة A4 والتمدد والصفحات المتعددة:
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .invoice-container { width: 210mm; min-height: 297mm; padding: 10mm; margin: 0 auto; background: #ffffff; position: relative; isolation: isolate; display: flex; flex-direction: column; justify-content: space-between; overflow: visible; }
  .top-content-wrap, .bottom-content-wrap { position: relative; z-index: 1; }
  .bottom-content-wrap { margin-top: auto; padding-top: 4mm; flex-shrink: 0; }
  - لا تضع data-exact-invoice-layout على <html>، ولا تضع height ثابتاً أو overflow: hidden على .invoice-container أو .items-table-container حتى يعمل محرك توزيع الصفحات التلقائي وتمدد الجدول وملء الفراغ لأسفل الصفحة الأخيرة وتكرار رأس الجدول عند زيادة الأصناف.
  - استخدم break-inside: avoid; page-break-inside: avoid; على البطاقات (.info-card، .summary-section، .footer-zone) وصفوف <tr>، مع السماح لـ .items-main-table بالانقسام بين الصفحات وتكرار <thead> { display: table-header-group; }.
  - اجعل الإطارات أو الخلفيات الزخرفية والمائية SVG داخل .invoice-container بـ position: absolute; pointer-events: none; z-index: -1;.

═══════════════════════════════════════════════════════════════
4. قواعد الشعار ورمز QR (ZATCA) ومنع الباركود الخطي وعرض العملة:
═══════════════════════════════════════════════════════════════
- الشعار: يوضع داخل حاوية عادية فقط دون وسوم <img> إضافية لأن النظام يستبدله بوسم الصورة:
  <div class="logo-shell">{{logo}}</div>
  مع CSS: .logo-shell { max-width: 140px; max-height: 75px; display: flex; align-items: center; justify-content: center; margin: 0 auto; } و .logo-shell img, .logo-shell svg { max-width: 100%; max-height: 75px; object-fit: contain; display: block; }
- رمز الاستجابة السريع (QR Only — Clean Square):
  * يوضع مباشرة داخل div: <div class="qr-box">{{qr_code}}</div> (يُمنع وضعه في <img src="...">).
  * مقاس ثابت لا يقل عن 125px × 125px (أو 33mm × 33mm) مع خلفية بيضاء صريحة #ffffff ومنع الانكماش لضمان مسح باركود المرحلة الثانية الكثيف:
    .qr-box { width: 125px; height: 125px; min-width: 125px; min-height: 125px; flex-shrink: 0; background: #ffffff; padding: 4px; box-sizing: border-box; border: 1px solid var(--border, #cbd5e1); border-radius: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .qr-box > div { width: 100%; height: 100%; }
    .qr-box svg, .qr-box img { width: 100% !important; height: 100% !important; display: block; object-fit: contain; }
  * يُمنع وضع أي نصوص أو شارات أسفل أو أعلى مربع الـ QR (مثل: "ZATCA QR" أو "امسح الرمز").
  * يُمنع وضع أي باركود خطي (Code128/Code39/أشرطة) في الفاتورة نهائياً.
- عرض المبالغ ورمز الريال السعودي ({{sar_symbol}}):
  * يجب أن يظهر رمز الريال السعودي دائماً على يسار الرقم بصرياً:
    <span class="money"><span>{{sar_symbol}}</span><bdi>{{grand_total}}</bdi></span>
  * CSS المطلوب:
    .money { display: inline-flex; direction: ltr; align-items: center; gap: 3px; white-space: nowrap; font-family: Tahoma, Arial, sans-serif; font-variant-numeric: tabular-nums; }
    .money svg, .sar-sym svg { width: 0.78em; height: 0.85em; fill: currentColor; flex-shrink: 0; }

═══════════════════════════════════════════════════════════════
5. هيكل جدول الأصناف المتوافق مع توليد الصفوف الذكي (Items Table):
═══════════════════════════════════════════════════════════════
- الهيكل الافتراضي القياسي مكوّن من 8 أعمدة بالترتيب التالي (مع <colgroup> مطابق لنسب <th>):
  1. رقم الصنف (Item No) — width: 12%
  2. اسم الصنف (Item Name) — width: 28% (اجعل محاذاته لليمين عبر td:nth-child(2) { text-align: right; })
  3. الوحدة (Unit) — width: 8%
  4. الكمية (Qty) — width: 8%
  5. السعر (Price) — width: 11%
  6. قبل الضريبة (Taxable) — width: 11%
  7. مبلغ الضريبة (VAT) — width: 10%
  8. شامل الضريبة (Total) — width: 12%
- مرونة محاكاة الصور المرجعية: إذا تضمنت صورة القالب المرفقة عمود تسلسل (#) أو عمود خصم (الخصم / Discount) أو نسبة الضريبة (نسبة الضريبة / VAT %) فيُسمح بإدراجها في <thead> لأن محرك النظام (detectColumnType) يتعرّف عليها تلقائياً عبر أسماء الرؤوس، بشرط ضبط محاذاة td:nth-child(...) لاسم الصنف بدقة وتطابق <colgroup>.
- قواعد <tbody> الصارمة:
  <tbody>
    {{items_rows}}
  </tbody>
  يُمنع وضع أي صفوف <tr> تجريبية أو وهمية داخل <tbody>، ويُمنع كتابة {{items_rows}} في أي مكان خارج <tbody>.

═══════════════════════════════════════════════════════════════
6. الوسوم المعتمدة للفواتير (استخدمها نصاً كما هي دون مرادفات):
═══════════════════════════════════════════════════════════════
1. ترويسة المنشأة (3 أعمدة متوازنة: عربي يمين | شعار وعنوان وسط | إنجليزي يسار + شريط تواصل):
   - الشعار: {{logo}}
   - العربي: {{seller_name}}، {{seller_address}}، {{seller_tax}}، {{seller_cr}}
   - الإنجليزي: {{seller_name_en}}، {{seller_address_en}}، VAT: {{seller_tax}}، CR: {{seller_cr}}
     (في الهيدر الإنجليزي اجعل أيقونات SVG يسار النص بصرياً: order: -1; margin-right: 6px; margin-left: 0;)
   - التواصل: {{seller_city}}، {{seller_country}}، {{seller_phone}}، {{seller_email}}
2. بطاقة بيانات الفاتورة (الصندوق الأيمن):
   - رقم الفاتورة: {{invoice_number}}
   - تاريخ الإصدار: {{issue_date}}
   - وقت الإصدار: {{issue_time}}
   - نوع الفاتورة / طريقة الدفع: {{payment_method}}
   - إجمالي عدد القطع: {{total_qty}}
3. بطاقة بيانات العميل (الصندوق الأيسر — بدون كود العميل وبدون سجل تجاري للعميل):
   - اسم العميل: {{buyer_name}}
   - الرقم الضريبي للعميل: {{buyer_tax}}
   - العنوان الوطني للعميل: {{buyer_address}} (مرتب من البيانات بالمدينة فالحي فالشارع فالمبنى)
   - الهاتف: {{buyer_phone}}
4. القسم السفلي (جدول الإجماليات المالي + صندوق الملاحظات وQR + التذييل):
   - الإجمالي (قبل الخصم والضريبة): {{subtotal}}
   - إجمالي الخصم: {{discount}}
   - المبلغ الخاضع للضريبة (بعد الخصم): {{taxable_amount}}
   - مبلغ ضريبة القيمة المضافة: {{tax_amount}} (لا تكتب نسبة ضريبة ثابتة كـ 15% ما لم يعرضها الجدول)
   - الإجمالي النهائي شامل الضريبة: {{grand_total}}
   - المبلغ المدفوع: {{paid_amount}} | المبلغ المتبقي: {{remaining_amount}}
   - تفقيط المبلغ كتابة: {{amount_in_words}}
   - رمز العملة: {{sar_symbol}}
   - الملاحظات والشروط: {{notes}} (مع مساحة كافية لا تضغط على مقاس مربع QR الـ 125×125)
   - التذييل (.footer-zone): بيانات منشأة مختصرة مثل {{seller_name}} ورقم الفاتورة {{invoice_number}} (دون ذكر أي اسم نظام برمجي).`;

export const VOUCHER_AI_PROMPT = `أنت مصمم ومطور قوالب HTML للطباعة متخصص في قوالب السندات والمستندات المالية العربية (مثل سند القبض وسند الصرف). أنشئ قالب HTML مستقل بـ CSS داخلي متوافق 100% مع محرك طباعة السندات ومحرر القوالب في النظام.

═══════════════════════════════════════════════════════════════
0. بروتوكول البدء التفاعلي الإلزامي (صورة السند أو وصف التصميم):
═══════════════════════════════════════════════════════════════
قبل كتابة أي سطر كود HTML، افحص رسالة المستخدم الحالية ومرفقاتها:
• الحالة (أ) — لم تُرفَق صورة لقالب السند/المستند ولم يُكتب وصف بصري لتفاصيل التصميم (لا في رسالة المستخدم ولا في قسم «مواصفات التصميم المختارة» إن وُجد أسفل هذا البرومبت):
  توقّف ولا تُخرج أي كود HTML الآن! خاطب المستخدم بلطف واختصار واطلب منه أحد خيارين:
  1. إرفاق **صورة لنفس قالب السند أو المستند** الذي يريده، لتقوم بتحليلها وبناء التصميم مطابقاً لها مع ربطها بوسوم النظام.
  2. أو **إذا لم تتوفر صورة**، اطلب منه **وصف التصميم المطلوب**:
     - **الألوان:** اللون الأساسي، اللون الثانوي، تباين الخلفية، وهل يناسب الطباعة الملونة أو بالأبيض والأسود.
     - **الإطار والزخارف:** نوع الإطار (مزدوج كلاسيكي رسمي، إطار عصري ناعم، أركان هندسية، بدون إطار)، العلامة المائية الخفيفة، وزوايا الصناديق.
     - **المزيد من التفاصيل:** نوع السند/المستند (سند قبض عام، إشعار تحصيل، سند بنكي/حوالة...)، توزيع الترويسة، إبراز صندوق المبلغ والتفقيط، وتوزيع خانات التواقيع والختم.
• الحالة (ب) — أرفق المستخدم صورة أو قدّم وصفاً (أو وُجد قسم مواصفات أسفل البرومبت):
  نفّذ التصميم بدقة وأخرج كود HTML كاملاً يبدأ بـ <!DOCTYPE html> وينتهي بـ </html> دون شروحات خارجية.

═══════════════════════════════════════════════════════════════
1. قواعد التصميم والأسلوب والهوية البيضاء:
═══════════════════════════════════════════════════════════════
${DESIGN_RULES}
- الوثيقة بيضاء (White-Label): يُمنع ذكر اسم "رصين" أو "Raseen" أو أي اسم نظام أو برنامج في <title> أو المتن أو التذييل أو العلامة المائية. <title>سند قبض</title>.
- استخدم <html lang="ar" dir="rtl"> وخطوطاً عربية واضحة (Cairo / Segoe UI / Tahoma / Arial).

═══════════════════════════════════════════════════════════════
2. الهيكل والطباعة المتوافقان مع المحرر ومحرك الطباعة (A4):
═══════════════════════════════════════════════════════════════
- اجعل الحاوية الرئيسية مباشرة داخل <body> تحمل الصنف .receipt-container (أو .receipt-card) والتذييل يحمل .voucher-footer حتى يتعرف عليها محرر القوالب (loadRawHtmlIntoCanvas) ومحرك الطباعة (injectVoucherPrintStyle) بسلاسة:
  <body>
    <div class="receipt-container">
      <header class="header">...</header>
      <main class="voucher-body">...</main>
      <footer class="voucher-footer">...</footer>
    </div>
  </body>
- إعدادات CSS الأساسية:
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  :root { --primary: ...; --accent: ...; --tint: ...; --border: ...; }
  .receipt-container { width: 210mm; min-height: 297mm; padding: 10mm 12mm; margin: 0 auto; background: #fff; position: relative; isolation: isolate; display: flex; flex-direction: column; justify-content: space-between; }
  .voucher-footer { margin-top: auto; }
- اجعل النصوص الطويلة قابلة للالتفاف (overflow-wrap: anywhere; white-space: pre-wrap;) في خانات البيان والملاحظات ({{paid_for}}، {{notes}}) وامنع تداخل الزخارف (z-index: -1; pointer-events: none;).

═══════════════════════════════════════════════════════════════
3. الوسوم الحقيقية المعتمدة في محرك السندات والممنوعات:
═══════════════════════════════════════════════════════════════
استخدم الوسوم التالية بدقة كما هي (وهي فقط المدعومة في محرك السندات بالخادم):
1. الترويسة (المنشأة):
   - الشعار داخل div دون img: <div class="logo-shell">{{logo}}</div> (مع max-height: 75px).
   - اسم المنشأة: {{seller_name}} (العربي) و {{seller_name_en}} (الإنجليزي — إن لزم دون اختلاق).
   - البيانات الضريبية والاتصال: {{seller_tax}}، {{seller_cr}}، {{seller_address}}، {{seller_address_en}}، {{seller_phone}} (أو الصيغة الجاهزة {{seller_meta_ar}} و {{seller_meta_en}}).
2. عنوان السند ورقمه وتاريخه وطريقة الدفع:
   - عنوان بارز واضح: «سند قبض» / RECEIPT VOUCHER (أو اسم المستند المطلوب).
   - رقم السند: {{voucher_number}} | التاريخ: {{voucher_date}} | طريقة الدفع: {{payment_method}}
   - رقم المرجع / الحوالة / الشيك (اختياري أو ضمن بيانات السند): {{reference_no}}
3. طرف السند والبيان:
   - استلمنا من: {{received_from}}
   - وذلك مقابل: {{paid_for}} (يملؤه النظام من الملاحظات أو أرقام الفواتير تلقائياً).
   - الملاحظات الإضافية (عند الحاجة لفصلها): {{notes}}
4. المبلغ والتفقيط ورمز العملة:
   - المبلغ الرقمي: {{amount}} (أو {{total_amount}}) | تفقيط المبلغ كتابة: {{amount_in_words}}
   - رمز العملة الحصري: {{sar_symbol}} فقط! (توضع أيقونة الريال دائماً على يسار الرقم):
     <span class="money"><span>{{sar_symbol}}</span><bdi>{{amount}}</bdi></span>
     مع CSS إلزامي لضبط حجم أيقونة الريال:
     .money { display: inline-flex; direction: ltr; align-items: center; gap: 3px; white-space: nowrap; font-variant-numeric: tabular-nums; }
     .money svg, .sar-sym svg { width: 0.78em; height: 0.85em; fill: currentColor; flex-shrink: 0; }
5. منطقة الاعتماد والتواقيع:
   - أضف مساحة واضحة للتوقيع والختم (توقيع المستلم / المحاسب أو أمين الصندوق / الختم الرسمي)، ويمكن عرض {{receiver_name}} بوصفه اسم المنشأة المستلمة كما يمرره المحرك دون نسبته لاسم شخص محدد.

⚠️ ممنوعات صارمة في السندات (تُظهر وسوماً فارغة أو تالفة لو وُجدت):
- يُمنع استخدام {{currency}} نهائياً (غير مدعوم في محرك السندات؛ استخدم {{sar_symbol}} فقط).
- يُمنع استخدام {{seller_email}} أو {{seller_city}} أو {{seller_country}} أو {{buyer_tax}} أو {{buyer_address}} أو {{buyer_phone}} لأنها غير ممررة لمحرك السندات في الخادم.
- يُمنع وضع {{qr_code}} أو أي باركود خطي أو جدول أصناف ({{items_rows}}) في السندات.`;

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
  { cat: 'الشعار والباركود', tag: '{{logo}}', desc: 'شعار المنشأة المعتمد تلقائياً (يوضع داخل <div>)' },
  { cat: 'الشعار والباركود', tag: '{{qr_code}}', desc: 'رمز الاستجابة السريع المعتمد (ZATCA QR) — للفواتير وإشعارات الدائن فقط' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_name}}', desc: 'اسم المنشأة / البائع بالعربي' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_name_en}}', desc: 'اسم المنشأة / البائع بالإنجليزي' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_tax}}', desc: 'الرقم الضريبي للبائع (15 رقماً)' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_cr}}', desc: 'رقم السجل التجاري للبائع' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_address}}', desc: 'العنوان الوطني بالعربي (المدينة - الحي - الشارع - المبنى)' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_address_en}}', desc: 'العنوان الوطني بالإنجليزي' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_city}}', desc: 'مدينة المنشأة (الفواتير فقط)' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_country}}', desc: 'دولة المنشأة (الفواتير فقط)' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_phone}}', desc: 'هاتف المنشأة' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_email}}', desc: 'البريد الإلكتروني للمنشأة (الفواتير فقط)' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_meta_ar}}', desc: 'شريط بيانات المنشأة المنسق بالعربية (مفيد للسندات)' },
  { cat: 'المنشأة (المورد)', tag: '{{seller_meta_en}}', desc: 'شريط بيانات المنشأة المنسق بالإنجليزية (مفيد للسندات)' },
  { cat: 'العميل (المشتري)', tag: '{{buyer_name}}', desc: 'اسم العميل / المشتري (الفواتير؛ وللسندات استخدم {{received_from}})' },
  { cat: 'العميل (المشتري)', tag: '{{buyer_tax}}', desc: 'الرقم الضريبي للعميل إن وجد (الفواتير فقط)' },
  { cat: 'العميل (المشتري)', tag: '{{buyer_address}}', desc: 'العنوان الوطني للعميل (الفواتير فقط)' },
  { cat: 'العميل (المشتري)', tag: '{{buyer_phone}}', desc: 'رقم هاتف / جوال العميل (الفواتير فقط)' },
  // ❌ buyer_cr و buyer_code و due_date محذوفة حسب قواعد الفوترة المعتمدة
  { cat: 'بيانات الفاتورة', tag: '{{invoice_number}}', desc: 'رقم الفاتورة أو الإشعار الدائن التسلسلي' },
  { cat: 'بيانات الفاتورة', tag: '{{issue_date}}', desc: 'تاريخ الإصدار (YYYY-MM-DD)' },
  { cat: 'بيانات الفاتورة', tag: '{{issue_time}}', desc: 'وقت الإصدار' },
  { cat: 'بيانات الفاتورة', tag: '{{payment_method}}', desc: 'نوع الفاتورة / طريقة الدفع (نقدي، آجل، شبكة...)' },
  { cat: 'بيانات الفاتورة', tag: '{{total_qty}}', desc: 'إجمالي عدد القطع في الفاتورة' },
  { cat: 'بيانات الفاتورة', tag: '{{notes}}', desc: 'ملاحظات وشروط الفاتورة أو السند' },
  { cat: 'إشعار الدائن', tag: '{{ref_invoice_number}}', desc: 'رقم الفاتورة الأصلية المرتبطة بإشعار الدائن (اختياري — يُحقن تلقائياً)' },
  { cat: 'إشعار الدائن', tag: '{{ref_invoice_date}}', desc: 'تاريخ الفاتورة الأصلية لإشعار الدائن' },
  { cat: 'إشعار الدائن', tag: '{{return_reason}}', desc: 'سبب الإرجاع في إشعار الدائن' },
  { cat: 'جدول الأصناف', tag: '{{items_rows}}', desc: 'صفوف الأصناف المولدة ديناميكياً داخل <tbody> فقط' },
  { cat: 'الإجماليات', tag: '{{subtotal}}', desc: 'المجموع الفرعي قبل الخصم والضريبة' },
  { cat: 'الإجماليات', tag: '{{discount}}', desc: 'إجمالي الخصم' },
  { cat: 'الإجماليات', tag: '{{taxable_amount}}', desc: 'المبلغ الخاضع للضريبة (الصافي بعد الخصم)' },
  { cat: 'الإجماليات', tag: '{{tax_amount}}', desc: 'مبلغ ضريبة القيمة المضافة' },
  { cat: 'الإجماليات', tag: '{{grand_total}}', desc: 'الإجمالي النهائي شامل الضريبة' },
  { cat: 'الإجماليات', tag: '{{paid_amount}}', desc: 'المبلغ المدفوع' },
  { cat: 'الإجماليات', tag: '{{remaining_amount}}', desc: 'المبلغ المتبقي' },
  { cat: 'التفقيط والعملة', tag: '{{amount_in_words}}', desc: 'تفقيط المبلغ كتابة بالريال السعودي' },
  { cat: 'التفقيط والعملة', tag: '{{sar_symbol}}', desc: 'أيقونة الريال السعودي Vector SVG (المعتمدة للفواتير والسندات)' },
  { cat: 'السندات', tag: '{{voucher_number}}', desc: 'رقم السند' },
  { cat: 'السندات', tag: '{{voucher_date}}', desc: 'تاريخ السند' },
  { cat: 'السندات', tag: '{{payment_method}}', desc: 'طريقة الدفع في السند' },
  { cat: 'السندات', tag: '{{reference_no}}', desc: 'رقم المرجع / الحوالة / الشيك في السند' },
  { cat: 'السندات', tag: '{{amount}}', desc: 'مبلغ السند رقماً' },
  { cat: 'السندات', tag: '{{received_from}}', desc: 'استلمنا من المكرم (طرف السند)' },
  { cat: 'السندات', tag: '{{paid_for}}', desc: 'وذلك مقابل / البيان التلقائي للسند' },
  { cat: 'السندات', tag: '{{receiver_name}}', desc: 'اسم المنشأة/الجهة المستلمة في خانة الاعتماد' },
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
    <div style="background: #111a2e; border: 1px solid #233554; border-radius: 12px; width: 880px; max-width: 96vw; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 25px 60px rgba(0,0,0,0.7); color: #f1f5f9; overflow: hidden; animation: popInModal 0.2s ease-out;">
      
      <!-- Top Modal Header -->
      <div style="background: #0b1322; padding: 14px 20px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, #4f46e5, #7c3aed); display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);">
            ${ICON_SPARKLE}
          </div>
          <div>
            <h3 style="margin: 0; font-size: 15.5px; font-weight: 800; color: #fff;">مساعد توليد القوالب بالذكاء الاصطناعي</h3>
            <div style="font-size: 11.5px; color: #94a3b8;">انسخ البرومبت ليطلب منك صورة القالب المطلوب أو وصف الألوان والإطار والتفاصيل، متوافقاً مع وسوم النظام.</div>
          </div>
        </div>
        <button type="button" id="btn-close-ai-modal" style="background: #1e293b; border: 1px solid #334155; color: #94a3b8; width: 32px; height: 32px; border-radius: 6px; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;" title="إغلاق">&times;</button>
      </div>

      <!-- Tab Switcher (أنواع القوالب / الوسوم) -->
      <div style="background: #0e172a; padding: 8px 18px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button type="button" class="ai-tab-btn" data-tab="invoices" style="padding: 7px 16px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid #334155; background: #1e293b; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_INVOICE} برومبت الفواتير (أساسي)
          </button>
          <button type="button" class="ai-tab-btn" data-tab="vouchers" style="padding: 7px 16px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid #334155; background: #1e293b; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_VOUCHER} برومبت السندات والمستندات
          </button>
          <button type="button" class="ai-tab-btn" data-tab="reports" style="padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid #334155; background: #1e293b; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_REPORT} تقرير مالي
          </button>
          <button type="button" class="ai-tab-btn" data-tab="statements" style="padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid #334155; background: #1e293b; color: #fff; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_STATEMENT} كشف حساب
          </button>
          <button type="button" class="ai-tab-btn" data-tab="tags" style="padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid #334155; background: #1e293b; color: #94a3b8; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;">
            ${ICON_TAGS} دليل المتغيرات الموحدة
          </button>
        </div>

        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" id="btn-next-frame" style="background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 7px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer;">إطار مقترح مختلف</button>
          <button type="button" id="btn-copy-active-prompt" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none; padding: 7px 18px; border-radius: 6px; font-size: 13px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: transform 0.1s;">
            ${ICON_COPY} نسخ البرومبت
          </button>
        </div>
      </div>

      <!-- Main Content Area -->
      <div style="flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- Prompt Box View -->
        <div id="ai-prompt-view" style="display: flex; flex-direction: column; gap: 10px;">
          <!-- Interactive Mode Selector for Invoices & Vouchers -->
          <div id="ai-spec-controls" style="background: #0b1322; border: 1px solid #1e293b; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 12px; font-weight: 800; color: #e2e8f0;">طريقة تحديد الشكل:</span>
                <label style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #38bdf8; cursor: pointer; font-weight: 700;">
                  <input type="radio" name="ai-design-mode" value="ask" checked />
                  تفاعلي: يطلب مني صورة القالب أو وصف الألوان والإطار في المحادثة
                </label>
                <label style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #cbd5e1; cursor: pointer;">
                  <input type="radio" name="ai-design-mode" value="custom" />
                  تعبئة وصف الألوان والإطار هنا قبل النسخ
                </label>
              </div>
            </div>
            <div id="ai-custom-spec-fields" style="display: none; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; padding-top: 4px; border-top: 1px dashed #1e293b;">
              <div style="display: flex; flex-direction: column; gap: 3px;">
                <label style="font-size: 11px; color: #94a3b8; font-weight: 700;">الألوان المطلوبة (الأساسي / الثانوي):</label>
                <input type="text" id="inp-ai-colors" placeholder="مثال: كحلي داكن مع ذهبي هادئ وخلفية بيضاء" style="background: #090e1a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; padding: 6px 9px; font-size: 12px;" />
              </div>
              <div style="display: flex; flex-direction: column; gap: 3px;">
                <label style="font-size: 11px; color: #94a3b8; font-weight: 700;">الإطار والزخارف:</label>
                <input type="text" id="inp-ai-frame" placeholder="مثال: إطار مزدوج بأركان هندسية دون أمواج" style="background: #090e1a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; padding: 6px 9px; font-size: 12px;" />
              </div>
              <div style="display: flex; flex-direction: column; gap: 3px;">
                <label style="font-size: 11px; color: #94a3b8; font-weight: 700;">تفاصيل أكثر (النمط / الترويسة / الخط):</label>
                <input type="text" id="inp-ai-extra" placeholder="مثال: طابع رسمي فخم، جدول شبكي، علامة مائية خفيفة" style="background: #090e1a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; padding: 6px 9px; font-size: 12px;" />
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
            <label id="lbl-active-prompt-title" style="font-weight: 800; font-size: 13px; color: #38bdf8;">
              نص البرومبت المخصص لقوالب الفواتير (جاهز للنسخ):
            </label>
            <span style="font-size: 11px; color: #64748b;">وسوم موحدة وتصميم عربي جاهز للطباعة على A4</span>
          </div>

          <textarea id="txt-ai-prompt" readonly style="width: 100%; height: 265px; background: #090e1a; border: 1px solid #1e293b; border-radius: 8px; color: #e2e8f0; padding: 12px 14px; font-size: 12px; font-family: Consolas, monospace, sans-serif; line-height: 1.6; resize: vertical; outline: none;"></textarea>

          <!-- Quick 3-Step Guide -->
          <div style="background: rgba(30, 41, 59, 0.5); border: 1px dashed #334155; border-radius: 8px; padding: 10px 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; font-size: 11.5px; color: #cbd5e1;">
            <div style="display: flex; align-items: flex-start; gap: 6px;">
              <span style="background: #4f46e5; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; flex-shrink: 0;">1</span>
              <span>انسخ البرومبت بالزر الأخضر أعلاه (أو اكتب مواصفاتك في الحقول الاختيارية أولاً).</span>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 6px;">
              <span style="background: #0284c7; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; flex-shrink: 0;">2</span>
              <span>أرسل البرومبت للذكاء الاصطناعي مع صورة القالب، أو اتركه يسألك عن الألوان والإطار والتفاصيل.</span>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 6px;">
              <span style="background: #10b981; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; flex-shrink: 0;">3</span>
              <span>الصق كود HTML الناتج في زر «لصق كود HTML» داخل محرر القوالب.</span>
            </div>
          </div>
        </div>

        <!-- Tags Cheat Sheet View (مخفي افتراضياً) -->
        <div id="ai-tags-view" style="display: none; flex-direction: column; gap: 10px;">
          <div style="font-weight: 800; font-size: 13px; color: #a855f7;">
            قاموس المتغيرات الموحدة القياسية (Standard Placeholders):
          </div>
          <div style="max-height: 340px; overflow-y: auto; border: 1px solid #1e293b; border-radius: 8px;">
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
  let designMode = 'ask';

  const txtPrompt = overlay.querySelector('#txt-ai-prompt');
  const lblTitle = overlay.querySelector('#lbl-active-prompt-title');
  const promptView = overlay.querySelector('#ai-prompt-view');
  const tagsView = overlay.querySelector('#ai-tags-view');
  const specControls = overlay.querySelector('#ai-spec-controls');
  const customSpecFields = overlay.querySelector('#ai-custom-spec-fields');
  const inpColors = overlay.querySelector('#inp-ai-colors');
  const inpFrame = overlay.querySelector('#inp-ai-frame');
  const inpExtra = overlay.querySelector('#inp-ai-extra');
  const btnNextFrame = overlay.querySelector('#btn-next-frame');
  const tabBtns = overlay.querySelectorAll('.ai-tab-btn');

  function buildCustomSpecBlock(tab) {
    const colorsVal = (inpColors?.value || '').trim();
    const frameVal = (inpFrame?.value || '').trim() || frameDirections[tab] || '';
    const extraVal = (inpExtra?.value || '').trim();

    if (!colorsVal && !frameVal && !extraVal) {
      return '';
    }
    const lines = ['مواصفات التصميم المختارة من المستخدم:'];
    if (colorsVal) lines.push(`- الألوان المطلوبة: ${colorsVal}`);
    if (frameVal) lines.push(`- الإطار والزخارف: ${frameVal}`);
    if (extraVal) lines.push(`- تفاصيل إضافية: ${extraVal}`);
    return '\n\n' + lines.join('\n');
  }

  function updatePromptText() {
    if (activeTab === 'tags') return;
    if (activeTab === 'invoices' || activeTab === 'vouchers') {
      const base = activeTab === 'invoices' ? INVOICE_AI_PROMPT : VOUCHER_AI_PROMPT;
      const suffix = designMode === 'custom' ? buildCustomSpecBlock(activeTab) : '';
      txtPrompt.value = base + suffix;
    } else if (activeTab === 'reports') {
      if (!frameDirections.reports) frameDirections.reports = nextFrameDirection();
      txtPrompt.value = REPORT_AI_PROMPT + '\n\nتوجيه الإطار لهذه النسخة:\n' + frameDirections.reports;
    } else if (activeTab === 'statements') {
      if (!frameDirections.statements) frameDirections.statements = nextFrameDirection();
      txtPrompt.value = STATEMENT_AI_PROMPT + '\n\nتوجيه الإطار لهذه النسخة:\n' + frameDirections.statements;
    }
  }

  function updateActiveTab(tab) {
    activeTab = tab;
    const isInteractiveDoc = tab === 'invoices' || tab === 'vouchers';
    const isTags = tab === 'tags';

    overlay.querySelector('#btn-copy-active-prompt').hidden = isTags;
    specControls.style.display = isInteractiveDoc ? 'flex' : 'none';
    customSpecFields.style.display = (isInteractiveDoc && designMode === 'custom') ? 'grid' : 'none';
    btnNextFrame.hidden = isTags || (isInteractiveDoc && designMode === 'ask');

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

    if (isTags) {
      promptView.style.display = 'none';
      tagsView.style.display = 'flex';
      return;
    }

    promptView.style.display = 'flex';
    tagsView.style.display = 'none';

    if (tab === 'invoices') {
      lblTitle.textContent = 'برومبت إنشاء قوالب الفواتير الضريبية وإشعارات الدائن (التركيز الأساسي):';
      lblTitle.style.color = '#38bdf8';
    } else if (tab === 'vouchers') {
      lblTitle.textContent = 'برومبت إنشاء قوالب السندات والمستندات المالية:';
      lblTitle.style.color = '#0ea5e9';
    } else if (tab === 'reports') {
      lblTitle.textContent = 'برومبت إنشاء قالب تقرير مالي HTML (جاهز للنسخ):';
      lblTitle.style.color = '#10b981';
    } else if (tab === 'statements') {
      lblTitle.textContent = 'برومبت إنشاء قالب كشف حساب عميل HTML (جاهز للنسخ):';
      lblTitle.style.color = '#f59e0b';
    }
    updatePromptText();
  }

  overlay.querySelectorAll('input[name="ai-design-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      designMode = e.target.value === 'custom' ? 'custom' : 'ask';
      if (designMode === 'custom' && !inpFrame.value.trim()) {
        inpFrame.value = frameDirections[activeTab] || nextFrameDirection();
      }
      updateActiveTab(activeTab);
    });
  });

  [inpColors, inpFrame, inpExtra].forEach((inp) => {
    inp?.addEventListener('input', updatePromptText);
  });

  tabBtns.forEach(b => b.addEventListener('click', () => updateActiveTab(b.dataset.tab)));
  updateActiveTab(activeTab);

  btnNextFrame.onclick = () => {
    const suggested = nextFrameDirection();
    frameDirections[activeTab] = suggested;
    if (activeTab === 'invoices' || activeTab === 'vouchers') {
      inpFrame.value = suggested;
    }
    updatePromptText();
  };

  // Copy Prompt Button
  const btnCopy = overlay.querySelector('#btn-copy-active-prompt');
  btnCopy.onclick = async () => {
    if (activeTab === 'tags') return;
    await copyText(txtPrompt.value);
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
