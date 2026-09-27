# الدليل والبرومبت القياسي الموحد لقوالب فواتير وسندات نظام رصين (Raseen)
> **تنبيه هام لوكلاء ومحركات الذكاء الاصطناعي (AI Prompt & System Guidelines)**
> هذا الملف يحدد المعايير الصارمة والمتغيرات الموحدة 100% لتصميم وتوليد أي قالب فاتورة أو سند قبض/صرف جديد لنظام **رصين (Raseen)**.

---

## 1. قائمة المتغيرات القياسية الموحدة (Unified Placeholders)

يتم استبدال هذه الوسوم تلقائياً من قبل محرك الرندر في الخادم ومحرر الطباعة. **يُمنع استخدام أي مرادفات غير مدرجة في هذا الجدول**:

### أ. المنشأة / المورد (Organization / Seller)
| المتغير الموحد | الوصف | مثال للمخرجات |
| :--- | :--- | :--- |
| `{{logo}}` | شعار المنشأة (مُغلّف في كود `<img>` بأبعاد قياسية مناسبة تلقائياً) | `<img src="..." alt="Logo" />` |
| `{{seller_name}}` | اسم المنشأة / الشركة بالعربية | مؤسسة الحلول المتقدمة للتجارة |
| `{{seller_name_en}}` | اسم المنشأة / الشركة بالإنجليزية | Advanced Solutions Trading Est |
| `{{seller_tax}}` | الرقم الضريبي للمنشأة (15 رقماً) | 310123456700003 |
| `{{seller_cr}}` | رقم السجل التجاري | 1010123456 |
| `{{seller_address}}` | عنوان المنشأة بالعربية (الشارع والمدينة) | شارع الملك فهد، الرياض |
| `{{seller_address_en}}` | عنوان المنشأة بالإنجليزية | King Fahd Road, Riyadh |
| `{{seller_phone}}` | رقم هاتف أو جوال المنشأة | 0501234567 |
| `{{seller_email}}` | البريد الإلكتروني للمنشأة | info@company.com |
| `{{seller_city}}` | المدينة | الرياض |
| `{{seller_country}}` | الدولة | المملكة العربية السعودية |
| `{{seller_meta_ar}}` | شريط بيانات مختصر (الضريبي + السجل التجاري) | الرقم الضريبي: 310123456700003 \| س.ت: 1010123456 |
| `{{seller_meta_en}}` | شريط بيانات مختصر إنجليزي | VAT: 310123456700003 \| C.R.: 1010123456 |

---

### ب. العميل / المشتري (Customer / Buyer)
| المتغير الموحد | الوصف | مثال للمخرجات |
| :--- | :--- | :--- |
| `{{buyer_name}}` | اسم العميل / المشتري | شركة الأفق الساطع للمقاولات |
| `{{buyer_tax}}` | الرقم الضريبي للعميل (إن وجد) | 300987654300003 |
| `{{buyer_address}}` | عنوان العميل الكامل | شارع العليا، الرياض |
| `{{buyer_phone}}` | هاتف أو جوال العميل | 0559876543 |
| `{{buyer_city}}` | المدينة | الرياض |
| `{{buyer_street}}` | الشارع | شارع العليا |
| `{{buyer_district}}` | الحي | حي الورود |
| `{{buyer_postal_code}}` | الرمز البريدي | 12214 |
| `{{buyer_building_no}}` | رقم المبنى | 2341 |

---

### ج. بيانات الفاتورة والسند (Invoice & Document Metadata)
| المتغير الموحد | الوصف | مثال للمخرجات |
| :--- | :--- | :--- |
| `{{invoice_number}}` | رقم الفاتورة التسلسلي | INV-2026-0001 |
| `{{issue_date}}` | تاريخ الإصدار (YYYY-MM-DD) | 2026-09-26 |
| `{{issue_time}}` | وقت الإصدار (HH:MM:SS) | 13:45:00 |
| `{{payment_method}}` | طريقة الدفع | نقداً / آجل / تحويل بنكي / مدى |
| `{{qr_code}}` | رمز الاستجابة السريع المعتمد من هيئة الزكاة والضريبة والجمارك (ZATCA QR) كصورة `<img>` Base64 جاهزة | `<img src="data:image/png;base64,..." alt="QR" />` |
| `{{notes}}` | ملاحظات الفاتورة أو البيان | توريد مواد بناء حسب الاتفاقية |

---

### د. المبالغ والإجماليات والتفقيط والعملة (Totals & Currency)
| المتغير الموحد | الوصف | مثال للمخرجات |
| :--- | :--- | :--- |
| `{{subtotal}}` | المجموع الخاضع للضريبة قبل الضريبة | 1000.00 |
| `{{discount}}` | إجمالي الخصومات | 0.00 |
| `{{tax_amount}}` | ضريبة القيمة المضافة (15%) | 150.00 |
| `{{grand_total}}` | الإجمالي النهائي شامل ضريبة القيمة المضافة | 1150.00 |
| `{{paid_amount}}` | المبلغ المدفوع | 1150.00 |
| `{{remaining_amount}}` | المبلغ المتبقي | 0.00 |
| `{{total_qty}}` | إجمالي كميات الأصناف | 15 |
| `{{amount_in_words}}` | تفقيط المبلغ كتابة بالريال السعودي | فقط ألف ومئة وخمسون ريالاً سعودياً لا غير |
| `{{currency}}` | رمز العملة النصي | SAR |
| `{{currency_symbol}}` أو `{{sar_symbol}}` | أيقونة الريال السعودي القياسية Vector SVG | SVG جاهز لرمز الريال الجديد |

---

### هـ. جدول الأصناف (Items Table)
| المتغير الموحد | الوصف |
| :--- | :--- |
| `{{items_rows}}` | السطور المولدة ديناميكياً لجدول الأصناف (`<tr>...</tr>`) متوافقة تلقائياً مع عدد وأسماء أعمدة الجدول سواء كان (6، 7، أو 8 أعمدة). |
| `{{items_table}}` | جدول الأصناف الكامل المولد جاهزاً في حال عدم تخصيص `<table>` يدوي. |

---

### و. سندات القبض والصرف (Vouchers / Receipts)
| المتغير الموحد | الوصف |
| :--- | :--- |
| `{{voucher_number}}` | رقم السند |
| `{{voucher_date}}` | تاريخ السند |
| `{{amount}}` | مبلغ السند الرقمي |
| `{{received_from}}` | استلمنا من المكرم / السيد |
| `{{paid_for}}` | وذلك مقابل / البيان |
| `{{receiver_name}}` | اسم المستلم / أمين الصندوق |

---

## 2. البرومبت القياسي المعتمد لتوليد القوالب الفاخرة (Production AI Prompt)

انسخ النص التالي كاملاً وأعطه لأي نموذج ذكاء اصطناعي (Claude 3.5 Sonnet, GPT-4o, Gemini Pro) لتوليد قالب متناسق مع أرقى معايير نظام رصين:

```markdown
أنت مصمم واجهات محترف وخبير ومطور ويب عالمي متخصص في تصميم قوالب الفواتير والمستندات المالية والضريبية الفاخرة متوافقة 100% مع معايير ومتطلبات هيئة الزكاة والضريبة والجمارك السعودية (ZATCA - الفاتورة الضريبية والمبسطة).

المطلوب:
تصميم وتوليد كود قالب فاتورة ضريبية ملكي فائق الفخامة والاحترافية، غني باللمسات الفنية والخلفيات العصرية الجاهزة للطباعة، ومكتمل بكافة التفاصيل المالية والضريبية والوطنية تلقائياً بدون أي نواقص، بصيغة ملف HTML كامل ومستقل (Single-file HTML with internal CSS).

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
   - إعدادات الطباعة A4 بدون أي هوامش مقطوعة:
     @page { size: A4 portrait; margin: 0; }
     -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
     page-break-inside: avoid; للجداول والبطاقات.
   - الحاوية الرئيسية (.invoice-container) بقياس A4 قياسي (width: 210mm; min-height: 297mm; position: relative; background: #fff; margin: 0 auto; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between;).

═══════════════════════════════════════════════════════════════
قاعدة احتواء ورقة A4 الكاملة والتثبيت السفلي الصارمة (STRICT SINGLE-PAGE A4 & BOTTOM-PINNED RULE):
═══════════════════════════════════════════════════════════════
1. أبعاد ورقة A4 القياسية الدقيقة والمطلقة:
   الحاوية الرئيسية (.invoice-container) يجب أن تطابق ورقة A4 كاملة بدقة متناهية:
   .invoice-container {
     width: 210mm;
     height: 297mm;
     min-height: 297mm;
     max-height: 297mm;
     box-sizing: border-box;
     padding: 8mm 9mm;
     overflow: hidden;
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

3. موازنة الارتفاعات لتملأ ورقة A4 كاملة دون أي فيضان (Zero Overflow):
   يجب موازنة ارتفاعات الأقسام والتباعدات (margins & paddings) هندسياً بحيث تشغل الفاتورة مساحة ورقة الـ A4 بالكامل، مع تثبيت القسم السفلي المالي والتذييل في قاع الصفحة عبر (margin-top: auto;) دون أن تتجاوز 297mm أو تفيض لصفحة ثانية في الطباعة والمعاينة إطلاقاً.
   .bottom-content-wrap {
     margin-top: auto;
   }

2. في هيكل HTML:
   يجب تقسيم المحتوى داخل .invoice-container إلى قسمين رئيسيين فقط:
   <div class="invoice-container">
     <!-- 1. القسم العلوي (الترويسة + بيانات الأطراف + جدول الأصناف) -->
     <div class="top-content-wrap">
       <header class="header">...</header>
       <section class="invoice-metadata">...</section>
       <section class="items-table-container">...</section>
     </div>

     <!-- 2. القسم السفلي المثبت في قاع الصفحة (الإجماليات + QR + الملاحظات + التذييل) -->
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
يجب كتابة جدول الأصناف في الكود بنفس هذا الهيكل البرمجي الصارم تماماً دون أي تحريف:
<section class="items-table-container">
  <table class="items-main-table">
    <thead>
      <tr>
        <th style="width: 5%;">#</th>
        <th style="width: 12%;">كود الصنف<br><small>Code</small></th>
        <th style="width: 28%;">البيان (اسم الصنف والخدمة)<br><small>Description</small></th>
        <th style="width: 8%;">الوحدة<br><small>Unit</small></th>
        <th style="width: 8%;">الكمية<br><small>Qty</small></th>
        <th style="width: 11%;">سعر الوحدة<br><small>Price</small></th>
        <th style="width: 12%;">قبل الضريبة<br><small>Taxable</small></th>
        <th style="width: 8%;">الخصم<br><small>Discount</small></th>
        <th style="width: 8%;">الضريبة 15%<br><small>VAT</small></th>
        <th style="width: 14%;">شامل الضريبة<br><small>Total</small></th>
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
   - ضريبة القيمة المضافة 15%: {{tax_amount}}
   - الإجمالي النهائي شامل الضريبة: {{grand_total}}
   - المبلغ المدفوع: {{paid_amount}}
   - المبلغ المتبقي: {{remaining_amount}}
   - تفقيط المبلغ كتابة بالريال السعودي: {{amount_in_words}}
   - رمز العملة أو أيقونة الريال السعودي الفيكتور: {{sar_symbol}} أو {{currency}}
   - ترتيب كل مبلغ في القالب: رمز الريال السعودي دائماً على يسار الرقم بصرياً (مثل ﷼ 169.64). مثال HTML: `<span class="money"><span>{{sar_symbol}}</span><bdi>{{grand_total}}</bdi></span>`، ومعه CSS: `.money { display: inline-flex; direction: ltr; align-items: center; gap: 3px; white-space: nowrap; }`. استبدل وسم المبلغ حسب السطر؛ لا تضع الرمز على يمين الرقم إطلاقاً.

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
       - العنوان: {{buyer_address}}

4. جدول الأصناف والبنود الشبكي (Items Grid Table):
   - جدول شبكي أنيق برأس ملون هادئ وخطوط فاصلة عمودية وأفقية تفصل الأعمدة بوضوح، ويتضمن إلزامياً الأعمدة التالية:
     - م (#)
     - كود الصنف (رقم الصنف / Code) — (عمود إلزامي وصارم في جميع قوالب الفواتير)
     - البيان (اسم الصنف والخدمة والوصف)
     - سعر الوحدة (Unit Price)
     - الكمية (Qty)
     - قبل الضريبة (المبلغ الخاضع للضريبة)
     - الضريبة (15%)
     - شامل الضريبة (الإجمالي النهائي شامل الضريبة)
   - وجسم الجدول يحتوي حصراً على: <tbody>{{items_rows}}</tbody> مع امتداد أسطر الجدول ليملأ ارتفاع الصفحة بتناسق.

5. القسم السفلي المالي والتحقق (Dual Bottom Summary Section):
   - صندوقان متجاوران أسفل جدول الأصناف مباشرة:
     * الصندوق الأيمن (جدول الإجماليات المالي):
       - شبكة أسطر منظمة: الرمز {{sar_symbol}} دائماً على يسار الرقم في كل سطر:
         - الإجمالي (قبل الضريبة): <span class="money"><span>{{sar_symbol}}</span><bdi>{{subtotal}}</bdi></span>
         - الخصم: <span class="money"><span>{{sar_symbol}}</span><bdi>{{discount}}</bdi></span>
         - الضريبة (15%): <span class="money"><span>{{sar_symbol}}</span><bdi>{{tax_amount}}</bdi></span>
         - الصافي / الإجمالي النهائي: <span class="money"><span>{{sar_symbol}}</span><bdi>{{grand_total}}</bdi></span> بخط عريض بارز
     * الصندوق الأيسر (رمز التحقق والملاحظات):
       - مربع رمز الاستجابة السريع النقي: <div class="qr-box">{{qr_code}}</div> بمقاس قياسي ثابت لا يقل عن 125px × 125px (أو 33mm × 33mm) في CSS (.qr-box { width: 125px; height: 125px; min-width: 125px; min-height: 125px; flex-shrink: 0; background: #ffffff; padding: 4px; box-sizing: border-box; }) مع .qr-box svg, .qr-box img { width: 100% !important; height: 100% !important; display: block; } بدون أي نصوص أو كتابات أو شارات أسفله إطلاقاً لضمان القراءة الفورية لكافة تطبيقات فحص ZATCA وكاميرات الجوال.
       - صندوق الملاحظات والشروط: {{notes}} بجانبه مع كلمة "ملاحظات"، مع إعطاء مساحة حرة للملاحظات دون أن تضغط على أبعاد الباركود أو تقلص حجمه إطلاقاً.

المخرج المطلوب:
كود HTML كامل ونظيف واحترافي يبدأ مباشرة بـ <!DOCTYPE html> وينتهي بـ </html> دون أي شروحات نصية خارجية ليكون جاهزاً للنسخ والاستخدام الفوري.
```

---

## 3. هيكل القالب المرجعي الأدنى (Minimal Template Skeleton)

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>فاتورة مبيعات ضريبية — {{invoice_number}}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; text-align: right; margin: 0; padding: 0; color: #1e293b; background: #fff; }
    .invoice-card { width: 100%; max-width: 210mm; margin: 0 auto; }
    .header-grid { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
    .logo-box { width: 130px; }
    .logo-box img { max-width: 100%; max-height: 75px; object-fit: contain; }
    .qr-box { width: 125px; height: 125px; min-width: 125px; min-height: 125px; flex-shrink: 0; background: #fff; padding: 4px; box-sizing: border-box; }
    .qr-box img, .qr-box svg { width: 100% !important; height: 100% !important; display: block; }
    .meta-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; margin-bottom: 16px; font-size: 12px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11.5px; }
    .items-table th, .items-table td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; }
    .items-table th { background: #f8fafc; font-weight: 800; }
    .totals-box { width: 320px; margin-right: auto; margin-left: 0; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #f1f5f9; }
    .totals-row.grand { font-size: 14px; font-weight: 900; background: #f8fafc; border-bottom: none; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .invoice-card { box-shadow: none; border: none; }
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <header class="header-grid">
      <div class="logo-box">{{logo}}</div>
      <div style="text-align:center;">
        <h2 style="margin:0;">فاتورة ضريبية</h2>
        <div style="font-size:12px;color:#64748b;">TAX INVOICE</div>
        <div style="font-size:13px;font-weight:bold;margin-top:4px;">{{invoice_number}}</div>
      </div>
      <div class="qr-box">{{qr_code}}</div>
    </header>

    <div class="meta-box">
      <!-- بيانات المورد والعميل -->
      <div><strong>المورد:</strong> {{seller_name}} | <strong>الرقم الضريبي:</strong> {{seller_tax}}</div>
      <div><strong>العميل:</strong> {{buyer_name}} | <strong>الرقم الضريبي:</strong> {{buyer_tax}}</div>
      <div><strong>التاريخ:</strong> {{issue_date}} {{issue_time}} | <strong>طريقة الدفع:</strong> {{payment_method}}</div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width:5%;">#</th>
          <th>الصنف / Description</th>
          <th style="width:10%;">الكمية</th>
          <th style="width:14%;">السعر</th>
          <th style="width:14%;">الضريبة (15%)</th>
          <th style="width:16%;">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        {{items_rows}}
      </tbody>
    </table>

    <div class="totals-box">
      <div class="totals-row"><span>المجموع قبل الضريبة:</span><span>{{subtotal}} {{currency}}</span></div>
      <div class="totals-row"><span>ضريبة القيمة المضافة (15%):</span><span>{{tax_amount}} {{currency}}</span></div>
      <div class="totals-row grand"><span>الإجمالي النهائي:</span><span>{{grand_total}} {{currency}}</span></div>
    </div>
    <div style="font-size:11px;margin-top:8px;color:#475569;">{{amount_in_words}}</div>
  </div>
</body>
</html>
```
