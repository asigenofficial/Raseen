# قواعد وسلوك الوكيل البرمجي لنظام رصين (Raseen Agent Behavioral Rules)

هذا الملف يحدد القواعد السلوكية الدقيقة والصارمة للوكيل الذكي (AI Agent) عند تعديل أو توليد قوالب الفواتير والسندات أو صيانة الكود:

---

## 1. مبدأ التعديل الجراحي ومنع زيادة الأكواد (Zero Bloat & Surgical Edits)
- **ممنوع منعاً باتاً إضافة كود زائد**: عند تصحيح أو ضبط أي سلوك، ابحث عن الكود السابق أين هو، وعدل على القيم الموجودة سابقاً حصراً.
- لا تضف كتل CSS جديدة أو وسوم مكررة أو دوال زائدة عند إمكانية حل المشكلة بتعديل المتغيرات السابقة بدقة متناهية.

---

## 2. قواعد ترويسة المنشأة الإنجليزية (LTR English Seller Header)
- في القسم الإنجليزي بالهيدر (`.seller-en` / `.seller-en-info`):
  - اتجاه النص دائماً LTR ومحاذاة لليسار: `direction: ltr !important; text-align: left !important;`.
  - أيقونات الـ SVG (الموقع، الرقم الضريبي، السجل التجاري) يجب أن تظهر **دائماً على يسار النص** الإنجليزي بصرياً لتطابق الهيدر العربي.
  - التنسيق الإلزامي للأيقونة:
    ```css
    .seller-en p svg, .seller-en p .icon {
      order: -1 !important;
      margin-right: 6px !important;
      margin-left: 0 !important;
      margin-inline-start: 0 !important;
      margin-inline-end: 0 !important;
      flex-shrink: 0 !important;
    }
    ```
  - لا تستخدم `order: 1` على الأيقونة إطلاقاً؛ لأن النصوص الصريحة بدون وسوم (Anonymous Text Nodes) تأخذ `order: 0` افتراضياً، مما يدفع الأيقونة لليمين إذا كانت `order: 1`.

---

## 3. مقاسات جدول الأصناف وموازنة التباعدات لملء الفراغات (Table Rows & Spacing Balance)
- **منع الفراغات المشوهة**: يجب أن تملأ عناصر الفاتورة صفحة الـ A4 بتناسق مريح وأنيق دون ترك فجوات بيضاء ضخمة ودون التسبب في فيضان لصفحة ثانية (Zero Overflow):
  - **حشو خلايا الجدول**:
    ```css
    .items-main-table th, .items-main-table td {
      height: auto !important;
      padding: 5px 3px !important;
      line-height: 1.3 !important;
      font-size: 10px !important;
    }
    ```
  - **التباعدات الرأسية المتناسقة**:
    - أسفل الترويسة (`.header`): `margin-bottom: 10px !important; padding-bottom: 10px !important;`
    - أسفل صناديق البيانات (`.invoice-metadata`): `margin-bottom: 12px !important;`
    - حشو حقول البيانات (`.field` و `dl`): `margin-bottom: 4px !important; padding-block: 8px !important;`
    - أعلى الملخص السفلي (`.bottom-content-wrap`): `padding-top: 4mm !important;`
    - أسطر الإجماليات (`.total-row`): `padding-block: 4px !important;`

---

## 4. رمز الريال السعودي القياسي (SAR Symbol)
- رمز الريال السعودي دائماً على يسار الرقم بصرياً:
  ```html
  <span class="money"><span>{{sar_symbol}}</span><bdi>{{grand_total}}</bdi></span>
  ```
  مع:
  ```css
  .money { display: inline-flex; direction: ltr; align-items: center; gap: 3px; white-space: nowrap; }
  ```
- لا تضع رمز العملة على يمين الرقم إطلاقاً.
