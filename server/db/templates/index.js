'use strict';
/**
 * نظام قوالب Excel الفردية — Raseen Excel Templates Engine.
 * كل قالب هو ملف Excel مادي (.xlsx أصلي بصيغة OpenXML و .xls بصيغة SpreadsheetML) منفصل على القرص
 * داخل مجلد server/db/templates/ ومفهرس في جدول excel_templates في قاعدة البيانات.
 * 
 * القوالب مصممة كفواتير ضريبية سعودية كاملة الأركان والتنسيق بدقة متناهية مطابقة
 * لنماذج الفواتير الواقعية في مجلد re (رواسي ينبع، الزهراني والمجد، أوتاد البدر،
 * موجة تردد، تركيب، ورواد الاتحاد).
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const TEMPLATES_DIR = __dirname;

const escXml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
  }
  return (~c) >>> 0;
}

function buildZip(files) {
  const localHeaders = [];
  const cdEntries = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const uncompressed = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const compressed = zlib.deflateRawSync(uncompressed, { level: 9 });
    const crc = crc32(uncompressed);

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(uncompressed.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);
    localHeaders.push(lfh, compressed);

    const cde = Buffer.alloc(46 + nameBuf.length);
    cde.writeUInt32LE(0x02014b50, 0);
    cde.writeUInt16LE(20, 4);
    cde.writeUInt16LE(20, 6);
    cde.writeUInt16LE(0, 8);
    cde.writeUInt16LE(8, 10);
    cde.writeUInt16LE(0, 12);
    cde.writeUInt16LE(0, 14);
    cde.writeUInt32LE(crc, 16);
    cde.writeUInt32LE(compressed.length, 20);
    cde.writeUInt32LE(uncompressed.length, 24);
    cde.writeUInt16LE(nameBuf.length, 28);
    cde.writeUInt16LE(0, 30);
    cde.writeUInt16LE(0, 32);
    cde.writeUInt16LE(0, 34);
    cde.writeUInt16LE(0, 36);
    cde.writeUInt32LE(0, 38);
    cde.writeUInt32LE(offset, 42);
    nameBuf.copy(cde, 46);
    cdEntries.push(cde);

    offset += lfh.length + compressed.length;
  }

  const cdBuf = Buffer.concat(cdEntries);
  const cdOffset = offset;
  const cdSize = cdBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

function unzip(buf) {
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Invalid ZIP: EOCD not found');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const files = {};
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const compMethod = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const rawData = buf.subarray(dataStart, dataStart + compSize);

    let data;
    if (compMethod === 0) data = rawData;
    else if (compMethod === 8) data = zlib.inflateRawSync(rawData);
    else throw new Error('Unsupported compression: ' + compMethod);

    files[name] = data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function colName(idx) {
  let name = '';
  let n = idx;
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

function parseColIndex(cellRef) {
  const match = cellRef.match(/^([A-Z]+)/i);
  if (!match) return 0;
  const colStr = match[1].toUpperCase();
  let num = 0;
  for (let i = 0; i < colStr.length; i++) {
    num = num * 26 + (colStr.charCodeAt(i) - 64);
  }
  return num - 1;
}

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * تطبيع ذكي لأسطر ملف الإكسل:
 * - إذا كان الملف جدولاً مسطحاً قياسياً (يبدأ بـ مجموعة_الفاتورة أو كود_أو_اسم_العميل)، يعيده كما هو.
 * - إذا كان الملف فاتورة إكسل ضريبية منسقة بدقة (تتضمن بطاقات العميل وجدول بنود)، يستخرج بيانات الفاتورة والعميل والبنود ويحولها للبنية القياسية للاستيراد الفوري.
 */
function normalizeExtractedRows(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];

  const firstRow = rawRows[0].map((c) => String(c || '').trim().toLowerCase());
  if (
    firstRow.some((c) => c.includes('مجموعة_الفاتورة') || c.includes('group')) ||
    (firstRow.some((c) => c.includes('عميل') || c.includes('client')) &&
      firstRow.some((c) => c.includes('صنف') || c.includes('item')))
  ) {
    return rawRows;
  }

  // البحث عن سطر ترويسة البنود
  let headerRowIdx = -1;
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i].map((c) => String(c || '').trim().toLowerCase());
    if (r.some((c) => c.includes('صنف') || c.includes('البيان') || c.includes('وصف') || c.includes('item'))) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return rawRows;
  }

  // استخراج بيانات الفاتورة والعميل من البطاقات العلوية
  let client = '', invoiceNum = '', date = '', payMethod = 'CREDIT', invType = 'STANDARD';
  for (let i = 0; i < headerRowIdx; i++) {
    const r = rawRows[i];
    for (let j = 0; j < r.length; j++) {
      const cell = String(r[j] || '').trim();
      if ((cell.includes('اسم العميل') || cell === 'العميل:' || (cell.includes('العميل') && !cell.includes('عنوان') && !cell.includes('ضريب'))) && r[j + 1]) {
        client = String(r[j + 1]).trim();
      }
      if ((cell.includes('رقم الفاتورة') || cell.includes('Invoice No')) && r[j + 1]) {
        invoiceNum = String(r[j + 1]).trim();
      }
      if ((cell.includes('تاريخ الفاتورة') || cell.includes('التاريخ') || cell.includes('Date')) && r[j + 1]) {
        date = String(r[j + 1]).trim();
      }
      if (cell.includes('طريقة السداد') && r[j + 1]) {
        const p = String(r[j + 1]);
        if (p.includes('نقدي') || p.includes('CASH')) payMethod = 'CASH';
      }
    }
  }

  // تحديد أعمدة جدول البنود
  const tableHeaders = rawRows[headerRowIdx].map((c) => String(c || '').trim().toLowerCase());
  const colCode = tableHeaders.findIndex((c) => c.includes('رقم الصنف') || c.includes('كود') || c.includes('code'));
  const colName = tableHeaders.findIndex((c) => c.includes('اسم') || c.includes('البيان') || c.includes('وصف') || c.includes('name'));
  const colUnit = tableHeaders.findIndex((c) => c.includes('وحدة') || c.includes('unit'));
  const colQty = tableHeaders.findIndex((c) => c.includes('كمية') || c.includes('qty'));
  const colPrice = tableHeaders.findIndex((c) => c.includes('سعر') || c.includes('price'));
  const colDisc = tableHeaders.findIndex((c) => c.includes('خصم') || c.includes('discount'));

  const standardRows = [
    [
      'مجموعة_الفاتورة', 'كود_أو_اسم_العميل', 'تاريخ_الفاتورة', 'وقت_الفاتورة',
      'نوع_الفاتورة', 'طريقة_الدفع', 'كود_أو_اسم_الصنف', 'الوحدة',
      'الكمية', 'سعر_الوحدة', 'الخصم', 'نسبة_الضريبة', 'ملاحظات'
    ]
  ];

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const firstCell = String(r[0] || '').trim();
    const secondCell = String(r[1] || '').trim();
    if (
      firstCell.includes('المبلغ كتابة') || firstCell.includes('الإجمالي') ||
      firstCell.includes('المجموع') || firstCell.includes('Total') ||
      secondCell.includes('المبلغ كتابة') || secondCell.includes('الإجمالي')
    ) {
      break;
    }
    const itemDesc = (colName !== -1 ? r[colName] : '') || (colCode !== -1 ? r[colCode] : '');
    if (!itemDesc || String(itemDesc).trim() === '') continue;

    standardRows.push([
      invoiceNum || 'INV-1',
      client || 'عميل نقدي',
      date || new Date().toISOString().slice(0, 10),
      '10:00:00',
      invType,
      payMethod,
      String(itemDesc).trim(),
      colUnit !== -1 && r[colUnit] ? String(r[colUnit]).trim() : 'حبة',
      colQty !== -1 && r[colQty] !== undefined && r[colQty] !== '' ? String(r[colQty]).trim() : '1',
      colPrice !== -1 && r[colPrice] !== undefined && r[colPrice] !== '' ? String(r[colPrice]).trim() : '0',
      colDisc !== -1 && r[colDisc] !== undefined && r[colDisc] !== '' ? String(r[colDisc]).trim() : '0',
      '15',
      colCode !== -1 && r[colCode] ? 'كود: ' + String(r[colCode]).trim() : ''
    ]);
  }

  return standardRows;
}

/**
 * تحليل محتوى ملف XLSX واستخراج صفوفه وتطبيعها
 */
function parseXlsxBuffer(buf) {
  const files = unzip(buf);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (!files[sheetPath]) {
    sheetPath = Object.keys(files).find((k) => /^xl\/worksheets\/sheet[0-9]+\.xml$/i.test(k));
  }
  if (!sheetPath || !files[sheetPath]) throw new Error('لم يتم العثور على ورقة عمل بيانات في ملف Excel');

  const sheetDataXml = files[sheetPath].toString('utf8');

  const sharedStrings = [];
  const sstKey = Object.keys(files).find((k) => /sharedstrings\.xml$/i.test(k));
  if (sstKey && files[sstKey]) {
    const sstXml = files[sstKey].toString('utf8');
    const siMatches = sstXml.match(/<si\b[\s\S]*?<\/si>/gi) || [];
    for (const si of siMatches) {
      const tMatches = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi) || [];
      const text = tMatches.map((m) => {
        const val = m.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/i, '$1');
        return decodeXmlEntities(val);
      }).join('');
      sharedStrings.push(text);
    }
  }

  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/gi;
  const rawRows = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sheetDataXml)) !== null) {
    const rowContent = rowMatch[2];
    const cellRegex = /<c\b([^>]*)>(?:<is><t(?:\s[^>]*)?>([\s\S]*?)<\/t><\/is>|<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>/gi;
    const row = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const attrs = cellMatch[1] || '';
      const rMatch = attrs.match(/\br="([A-Z]+[0-9]+)"/i);
      const colIdx = rMatch ? parseColIndex(rMatch[1]) : row.length;
      while (row.length < colIdx) row.push('');

      const tMatch = attrs.match(/\bt="([^"]+)"/i);
      const type = tMatch ? tMatch[1] : '';

      let val = '';
      if (cellMatch[2] !== undefined) {
        val = decodeXmlEntities(cellMatch[2]);
      } else if (cellMatch[3] !== undefined) {
        const rawVal = cellMatch[3];
        if (type === 's') {
          const sIdx = parseInt(rawVal, 10);
          val = sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : rawVal;
        } else {
          val = rawVal;
        }
      }
      row[colIdx] = val;
    }
    if (row.some((c) => String(c).trim() !== '')) {
      rawRows.push(row);
    }
  }

  return normalizeExtractedRows(rawRows);
}

/**
 * بناء ملف Excel أصلي وعالي الدقة بصيغة XLSX (OpenXML) متوافق 100% مع Microsoft Excel
 * يمثل فاتورة ضريبية سعودية كاملة الأركان والتنسيق والهوية
 */
function buildXlsx(tpl) {
  const pColor = (tpl.primary_color || '#0d9488').replace('#', '').toUpperCase().padStart(6, '0');
  const dColor = (tpl.dark_color || '#0f766e').replace('#', '').toUpperCase().padStart(6, '0');
  const rgbPrimary = 'FF' + pColor;
  const rgbDark = 'FF' + dColor;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <!-- 0: regular 10pt text -->
    <font><sz val="10"/><name val="Segoe UI"/><family val="2"/><color rgb="FF334155"/></font>
    <!-- 1: table header bold white 11pt -->
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/><family val="2"/></font>
    <!-- 2: company title bold primary 14pt -->
    <font><b/><sz val="14"/><color rgb="${rgbPrimary}"/><name val="Segoe UI"/><family val="2"/></font>
    <!-- 3: card label bold 10pt dark -->
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Segoe UI"/><family val="2"/></font>
    <!-- 4: grand total bold white 12pt -->
    <font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/><family val="2"/></font>
    <!-- 5: title badge bold 11pt dark -->
    <font><b/><sz val="11"/><color rgb="${rgbDark}"/><name val="Segoe UI"/><family val="2"/></font>
    <!-- 6: subtext 9pt muted -->
    <font><sz val="9"/><color rgb="FF64748B"/><name val="Segoe UI"/><family val="2"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${rgbPrimary}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    </border>
    <border>
      <left style="medium"><color rgb="${rgbPrimary}"/></left>
      <right style="medium"><color rgb="${rgbPrimary}"/></right>
      <top style="medium"><color rgb="${rgbPrimary}"/></top>
      <bottom style="medium"><color rgb="${rgbPrimary}"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="12">
    <!-- 0: Default regular -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: Table Header (Bold White on Primary) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 2: Table Data Text (Right, Thin border) -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 3: Table Data Centered (Code, Unit, Qty) -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 4: Table Data Number (Currency, 2 decimals) -->
    <xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 5: Table Data Alternating Text -->
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 6: Table Data Alternating Number -->
    <xf numFmtId="4" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 7: Company Main Name (Bold 14pt Primary) -->
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 8: Card Label (Bold Dark with light fill) -->
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 9: Card Value (Regular with border) -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 10: Invoice Title Pill Badge -->
    <xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 11: Grand Total Highlight (Bold White on Primary) -->
    <xf numFmtId="4" fontId="4" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20480" windowHeight="10240"/></bookViews>
  <sheets>
    <sheet name="الفاتورة_الضريبية" sheetId="1" r:id="rId1"/>
    <sheet name="دليل_الاستخدام" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  const addC = (ref, style, val, isNum = false) => {
    if (isNum) return `<c r="${ref}" s="${style}"><v>${val}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escXml(val)}</t></is></c>`;
  };

  let s1 = '';
  // Row 1: Company Header
  s1 += `<row r="1" ht="30" customHeight="1">
    ${addC('B1', 7, tpl.issuer_ar || tpl.name_ar)}
    ${addC('G1', 0, tpl.issuer_en || tpl.name_en)}
  </row>`;
  // Row 2: Addresses and Tax / CR
  s1 += `<row r="2" ht="20" customHeight="1">
    ${addC('B2', 0, tpl.issuer_address || 'المملكة العربية السعودية')}
    ${addC('G2', 0, `الرقم الضريبي: ${tpl.issuer_vat || '300000000000003'}  |  السجل: ${tpl.issuer_cr || '1010000001'}`)}
  </row>`;
  // Row 3: Spacer
  s1 += '<row r="3" ht="10" customHeight="1"></row>';
  // Row 4: Title Badge
  s1 += `<row r="4" ht="26" customHeight="1">
    ${addC('E4', 10, tpl.invoice_title || 'فاتورة مبيعات ضريبية (TAX INVOICE)')}
  </row>`;
  // Row 5: Spacer
  s1 += '<row r="5" ht="10" customHeight="1"></row>';
  // Row 6: Client & Invoice Info Row 1
  s1 += `<row r="6" ht="22" customHeight="1">
    ${addC('B6', 8, 'اسم العميل:')}
    ${addC('C6', 9, tpl.client_name || 'شركة الأمل للتجارة')}
    ${addC('G6', 8, 'رقم الفاتورة:')}
    ${addC('H6', 9, tpl.invoice_number || 'INV-2026-001')}
  </row>`;
  // Row 7: Client & Invoice Info Row 2
  s1 += `<row r="7" ht="22" customHeight="1">
    ${addC('B7', 8, 'الرقم الضريبي للعميل:')}
    ${addC('C7', 9, tpl.client_vat || '310000000000003')}
    ${addC('G7', 8, 'تاريخ الفاتورة:')}
    ${addC('H7', 9, tpl.invoice_date || new Date().toISOString().slice(0, 10))}
  </row>`;
  // Row 8: Client & Invoice Info Row 3
  s1 += `<row r="8" ht="22" customHeight="1">
    ${addC('B8', 8, 'عنوان العميل:')}
    ${addC('C8', 9, tpl.client_address || 'المملكة العربية السعودية')}
    ${addC('G8', 8, 'طريقة السداد / النوع:')}
    ${addC('H8', 9, `${tpl.payment_method || 'آجل (CREDIT)'} (${tpl.invoice_type || 'ضريبية معتمدة'})`)}
  </row>`;
  // Row 9: Spacer
  s1 += '<row r="9" ht="14" customHeight="1"></row>';

  // Row 10: Items Table Headers (10 columns)
  const hdrs = ['#', 'رقم الصنف', 'اسم الصنف والبيان', 'الوحدة', 'الكمية', 'سعر الوحدة', 'الخصم', 'المبلغ قبل الضريبة', 'الضريبة (15%)', 'المجموع شامل الضريبة'];
  s1 += '<row r="10" ht="26" customHeight="1">';
  hdrs.forEach((h, i) => { s1 += addC(colName(i) + '10', 1, h); });
  s1 += '</row>';

  // Table Data Rows
  let curR = 11;
  let totSub = 0, totDisc = 0, totTax = 0, totGrand = 0;
  const items = Array.isArray(tpl.items) && tpl.items.length > 0 ? tpl.items : [
    { code: 'ITM-001', name: `بند توريد معتمد 1 - ${tpl.name_ar}`, unit: 'حبة', qty: 2, price: 450.00, discount: 0 },
    { code: 'ITM-002', name: 'بند توريد معتمد 2', unit: 'حبة', qty: 1, price: 120.00, discount: 10.00 },
    { code: 'ITM-003', name: 'خدمات احترافية ودعم فني', unit: 'خدمة', qty: 1, price: 250.00, discount: 0 },
  ];

  items.forEach((it, idx) => {
    const alt = idx % 2 === 1;
    const sT = alt ? 5 : 2;
    const sC = alt ? 5 : 3;
    const sN = alt ? 6 : 4;

    const q = Number(it.qty || 1);
    const p = Number(it.price || 0);
    const d = Number(it.discount || 0);
    const sub = Number(((q * p) - d).toFixed(2));
    const tx = Number((sub * 0.15).toFixed(2));
    const gr = Number((sub + tx).toFixed(2));

    totSub += sub; totDisc += d; totTax += tx; totGrand += gr;

    s1 += `<row r="${curR}" ht="22" customHeight="1">
      ${addC('A' + curR, sC, String(idx + 1))}
      ${addC('B' + curR, sC, it.code || '')}
      ${addC('C' + curR, sT, it.name || '')}
      ${addC('D' + curR, sC, it.unit || 'حبة')}
      ${addC('E' + curR, sN, q, true)}
      ${addC('F' + curR, sN, p, true)}
      ${addC('G' + curR, sN, d, true)}
      ${addC('H' + curR, sN, sub, true)}
      ${addC('I' + curR, sN, tx, true)}
      ${addC('J' + curR, sN, gr, true)}
    </row>`;
    curR++;
  });

  // Spacer
  s1 += `<row r="${curR}" ht="12" customHeight="1"></row>`;
  curR++;

  // Totals & Footer Rows
  const t1 = curR, t2 = curR + 1, t3 = curR + 2, t4 = curR + 3;
  s1 += `<row r="${t1}" ht="22" customHeight="1">
    ${addC('B' + t1, 8, 'المبلغ كتابةً:')}
    ${addC('C' + t1, 9, tpl.tafqeet || 'فقط خمسة آلاف ومئة ريال سعودي لا غير')}
    ${addC('G' + t1, 8, 'الإجمالي قبل الضريبة:')}
    ${addC('I' + t1, 4, totSub.toFixed(2), true)}
  </row>`;
  s1 += `<row r="${t2}" ht="22" customHeight="1">
    ${addC('B' + t2, 8, 'الحساب البنكي:')}
    ${addC('C' + t2, 9, tpl.bank_info || 'مصرف الراجحي | IBAN: SA0380000123456789012345')}
    ${addC('G' + t2, 8, 'إجمالي الخصم:')}
    ${addC('I' + t2, 4, totDisc.toFixed(2), true)}
  </row>`;
  s1 += `<row r="${t3}" ht="22" customHeight="1">
    ${addC('B' + t3, 8, 'الملاحظات والشروط:')}
    ${addC('C' + t3, 9, tpl.terms || 'البضاعة المباعة خاضعة لضمان الوكيل الرسمي المعتمد سنتين.')}
    ${addC('G' + t3, 8, 'ضريبة القيمة المضافة (15%):')}
    ${addC('I' + t3, 4, totTax.toFixed(2), true)}
  </row>`;
  s1 += `<row r="${t4}" ht="26" customHeight="1">
    ${addC('B' + t4, 8, 'توقيع المستلم والختم:')}
    ${addC('C' + t4, 9, '..........................................')}
    ${addC('G' + t4, 11, 'الإجمالي النهائي المستحق:')}
    ${addC('I' + t4, 11, totGrand.toFixed(2), true)}
  </row>`;

  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0" rightToLeft="1" tabSelected="1"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="5" customWidth="1"/>
    <col min="2" max="2" width="13" customWidth="1"/>
    <col min="3" max="3" width="26" customWidth="1"/>
    <col min="4" max="4" width="8" customWidth="1"/>
    <col min="5" max="5" width="8" customWidth="1"/>
    <col min="6" max="6" width="11" customWidth="1"/>
    <col min="7" max="7" width="12" customWidth="1"/>
    <col min="8" max="8" width="14" customWidth="1"/>
    <col min="9" max="9" width="12" customWidth="1"/>
    <col min="10" max="10" width="15" customWidth="1"/>
  </cols>
  <sheetData>${s1}</sheetData>
  <pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
  <pageSetup orientation="landscape" paperSize="9"/>
</worksheet>`;

  // Sheet 2: دليل_الاستخدام
  const instructions = [
    ['الحقل', 'الوصف والتفاصيل', 'مثال التعبئة', 'إلزامي؟'],
    ['رقم الفاتورة', 'رقم الفاتورة المرجعي الفريد', tpl.invoice_number || 'INV-001', 'نعم'],
    ['اسم العميل', 'اسم العميل أو المؤسسة المشترية', tpl.client_name || 'شركة الأمل', 'نعم'],
    ['تاريخ الفاتورة', 'تاريخ الفاتورة بصيغة YYYY-MM-DD', tpl.invoice_date || '2026-09-14', 'نعم'],
    ['طريقة السداد', 'CASH, CREDIT, TRANSFER, CARD', tpl.payment_method || 'CREDIT', 'لا'],
    ['جدول البنود', 'صفوف المنتجات أو الخدمات مع الكمية وسعر الوحدة', 'سطر 11 فما فوق', 'نعم'],
    ['رقم الصنف', 'كود الصنف المسجل بالنظام أو الباركود', 'ITM-01', 'نعم'],
    ['الكمية', 'كمية الصنف المباعة (رقم موجب)', '5', 'نعم'],
    ['سعر الوحدة', 'سعر الوحدة بالريال بدون ضريبة', '50.00', 'نعم'],
    ['الخصم', 'مبلغ الخصم على السطر (0 إن لم يوجد)', '0.00', 'لا'],
    ['الإجمالي والضريبة', 'الحسابات التلقائية المعتمدة 15%', 'تُحسب بالمعادلات أو النظام', 'تلقائي'],
  ];

  let s2Data = '<row r="1" ht="26" customHeight="1">';
  instructions[0].forEach((h, colIdx) => {
    s2Data += addC(colName(colIdx) + '1', 1, h);
  });
  s2Data += '</row>';

  instructions.slice(1).forEach((r, rowIdx) => {
    const rNum = rowIdx + 2;
    const styleId = rowIdx % 2 === 0 ? 2 : 5;
    s2Data += `<row r="${rNum}" ht="20" customHeight="1">`;
    r.forEach((cell, colIdx) => {
      s2Data += addC(colName(colIdx) + rNum, styleId, cell);
    });
    s2Data += '</row>';
  });

  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0" rightToLeft="1"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="22" customWidth="1"/>
    <col min="2" max="2" width="45" customWidth="1"/>
    <col min="3" max="3" width="28" customWidth="1"/>
    <col min="4" max="4" width="14" customWidth="1"/>
  </cols>
  <sheetData>${s2Data}</sheetData>
</worksheet>`;

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2 },
  ]);
}

/**
 * تعريفات القوالب الـ 18 الغنية والمطابقة لعينات فواتير re السعودية الحقيقية
 */
const TEMPLATES_CATALOG = [
  {
    id: 'standard',
    name_ar: 'الرسمي المعتمد (Standard)',
    name_en: 'Official Standard Invoice',
    description: 'نموذج الفاتورة الضريبية القياسي العام المتوافق مع هيئة الزكاة والضريبة والجمارك لكافة الأنشطة.',
    badge: 'الافتراضي العام',
    category: 'general',
    primary_color: '#0d9488',
    dark_color: '#0f766e',
    issuer_ar: 'شركة تقنية الأعمال والتجارة المحدودة',
    issuer_en: 'Business Tech & Trading Co. Ltd',
    issuer_address: 'الرياض - طريق الملك فهد - حي الصحافة',
    issuer_vat: '300000000000003',
    issuer_cr: '1010000001',
    invoice_title: 'فاتورة مبيعات ضريبية (TAX INVOICE)',
    invoice_number: 'INV-2026-001',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'شركة البناء الحديث للتجارة العامة',
    client_vat: '310998877600003',
    client_address: 'الدمام - حي الشاطئ - طريق الخليج',
    tafqeet: 'فقط سبعة عشر ألفاً ومئتان وخمسون ريالاً سعودياً لا غير',
    bank_info: 'البنك الأهلي السعودي  |  IBAN: SA4410000001234567890123',
    terms: 'تعتبر الفاتورة معتمدة وسارية من تاريخ إصدارها وتخضع لشروط التوريد القياسية.',
    items: [
      { code: 'ITM-STD-01', name: 'توريد حواسيب مكتبية عالية الأداء مع الشاشات', unit: 'طقم', qty: 5, price: 2400.00, discount: 0 },
      { code: 'ITM-STD-02', name: 'طابعات ليزر متعددة الوظائف شبكية سريعة', unit: 'حبة', qty: 2, price: 1150.00, discount: 50.00 },
      { code: 'ITM-STD-03', name: 'راوترات وشبكات اتصال احترافية CISCO', unit: 'حبة', qty: 3, price: 480.00, discount: 0 },
    ],
    extra_headers: [],
    sample_extra: [],
  },
  {
    id: 'modern',
    name_ar: 'العصري الأنيق (Modern Clean)',
    name_en: 'Modern Clean Invoice',
    description: 'نموذج مالي تقني للشركات والمؤسسات التجارية الحديثة بتنسيق أنيق وألوان نيلية عصرية.',
    badge: 'تقني وعصري',
    category: 'tech',
    primary_color: '#2563eb',
    dark_color: '#1d4ed8',
    issuer_ar: 'سحابة الحلول الرقمية لتقنية المعلومات',
    issuer_en: 'Digital Solutions Cloud IT',
    issuer_address: 'الرياض - حي الملقا - طريق أنس بن مالك',
    issuer_vat: '310987654300003',
    issuer_cr: '1010776655',
    invoice_title: 'فاتورة خدمات تقنية وبرمجية (TAX INVOICE)',
    invoice_number: 'DIG-2026-88',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'تحويل بنكي (TRANSFER)',
    client_name: 'شركة الابتكار المالي للتقنية',
    client_vat: '300445566700003',
    client_address: 'الرياض - حي النرجس - طريق أبي بكر الصديق',
    tafqeet: 'فقط ثمانية عشر ألفاً وتسعمائة وخمسة وسبعون ريالاً سعودياً لا غير',
    bank_info: 'مصرف الراجحي  |  IBAN: SA0380000554433221100998',
    terms: 'تراخيص الاستخدام والخدمات السحابية تضمن استمرارية التشغيل على مدار الساعة.',
    items: [
      { code: 'CLD-SRV-01', name: 'ترخيص سحابي سنوي للنظام المالي والمحاسبي ERP', unit: 'ترخيص', qty: 1, price: 12500.00, discount: 500.00 },
      { code: 'CLD-SRV-02', name: 'خدمات استضافة خوادم مدارة سريعة NVMe', unit: 'شهر', qty: 3, price: 850.00, discount: 0 },
      { code: 'CLD-SRV-03', name: 'خدمات تكامل برمجي API وربط بوابات الدفع', unit: 'ساعة', qty: 10, price: 200.00, discount: 0 },
    ],
    extra_headers: ['الرقم_المرجعي_للطلب'],
    sample_extra: ['ORD-98214'],
  },
  {
    id: 'classic',
    name_ar: 'الكلاسيكي المحاسبي (Classic Ledger)',
    name_en: 'Classic Ledger Invoice',
    description: 'نموذج محاسبي تجاري رصين بشبكة حقول متكاملة وحقول قيود اليومية ومراكز السداد.',
    badge: 'محاسبي رصين',
    category: 'accounting',
    primary_color: '#334155',
    dark_color: '#1e293b',
    issuer_ar: 'شركة الركائز المالية للتجارة العامة',
    issuer_en: 'Financial Pillars General Trading',
    issuer_address: 'جدة - شارع الستين - تقاطع صاري',
    issuer_vat: '301234567800003',
    issuer_cr: '1010223344',
    invoice_title: 'فاتورة مبيعات محاسبية (TAX INVOICE)',
    invoice_number: 'FIN-2026-402',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'مجموعة الفلاح للاستثمار والتجارة',
    client_vat: '302889911200003',
    client_address: 'مكة المكرمة - العزيزية - طريق المسجد الحرام',
    tafqeet: 'فقط ستة عشر ألفاً ومائتان وثمانون ريالاً سعودياً لا غير',
    bank_info: 'بنك الرياض  |  IBAN: SA5520000003322114455667',
    terms: 'سداد الفاتورة مستحق خلال 30 يوماً من تاريخ استلام الإشعار الضريبي.',
    items: [
      { code: 'ACC-ITM-101', name: 'توريدات أدوات مكتبية وقرطاسية شاملة للشركات', unit: 'طقم', qty: 20, price: 180.00, discount: 0 },
      { code: 'ACC-ITM-102', name: 'خزائن حديدية رقمية مقاومة للحريق والسرقة', unit: 'حبة', qty: 2, price: 3200.00, discount: 100.00 },
      { code: 'ACC-ITM-103', name: 'آلات عد النقود وكشف التزوير متعددة العملات', unit: 'حبة', qty: 3, price: 1450.00, discount: 0 },
    ],
    extra_headers: ['رقم_القيد_المحاسبي', 'تاريخ_الاستحقاق'],
    sample_extra: ['JV-2026-081', '2026-08-30'],
  },
  {
    id: 'executive',
    name_ar: 'الملكي التنفيذي (Executive Gold)',
    name_en: 'Executive Gold Invoice',
    description: 'نموذج تنفيذي فاخر للمكاتب الاستشارية والصفقات الكبرى باللون الذهبي الملكي.',
    badge: 'تنفيذي فاخر',
    category: 'consulting',
    primary_color: '#854d0e',
    dark_color: '#713f12',
    issuer_ar: 'نخبة الأعمال للاستشارات الإدارية والاستثمار',
    issuer_en: 'Business Elite Advisory & Investment',
    issuer_address: 'الرياض - برج المملكة - الدور 32',
    issuer_vat: '310555666700003',
    issuer_cr: '1010998877',
    invoice_title: 'فاتورة استشارات وإدارة صفقات (EXECUTIVE INVOICE)',
    invoice_number: 'EXEC-2026-101',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'تحويل سريع (TRANSFER)',
    client_name: 'شركة آفاق المستقبل القابضة',
    client_vat: '300778899000003',
    client_address: 'الرياض - طريق الأمير تركي الأول - حي حطين',
    tafqeet: 'فقط سبعون ألفاً ومئة وخمسون ريالاً سعودياً لا غير',
    bank_info: 'البنك السعودي البريطاني (SAB)  |  IBAN: SA1240000009988776655443',
    terms: 'تسري مخرجات التقرير الاستشاري وفق بنود العقد الموقع بين الطرفين.',
    items: [
      { code: 'ADV-PKG-01', name: 'دراسة جدوى استراتيجية وتطوير حوكمة الشركات', unit: 'استشارة', qty: 1, price: 35000.00, discount: 2000.00 },
      { code: 'ADV-PKG-02', name: 'تقييم مالي وفحص نافي للجهالة لصفقة الاستحواذ', unit: 'تقرير', qty: 1, price: 28000.00, discount: 0 },
    ],
    extra_headers: ['اسم_المشروع_أو_العقد', 'رقم_الاعتماد'],
    sample_extra: ['مشروع التوسعة الإدارية', 'APR-770'],
  },
  {
    id: 'minimal',
    name_ar: 'البسيط الهادئ (Minimalist Clean)',
    name_en: 'Minimalist Clean Invoice',
    description: 'نموذج خفيف ومبسط بتنسيق مريح واقتصادي للعمليات والمبيعات السريعة.',
    badge: 'اقتصادي سريع',
    category: 'retail',
    primary_color: '#475569',
    dark_color: '#334155',
    issuer_ar: 'مركز الأفق السريع للمبيعات والخدمات',
    issuer_en: 'Horizon Fast Sales & Services',
    issuer_address: 'المدينة المنورة - طريق سلطانة',
    issuer_vat: '300112233400003',
    issuer_cr: '1010334455',
    invoice_title: 'فاتورة مبيعات نقدية مبسطة (SIMPLIFIED INVOICE)',
    invoice_number: 'RET-2026-550',
    invoice_date: '2026-09-14',
    invoice_type: 'فاتورة ضريبية مبسطة',
    payment_method: 'نقدي (CASH)',
    client_name: 'عميل نقدي (مبيعات مباشرة)',
    client_vat: '',
    client_address: 'المدينة المنورة',
    tafqeet: 'فقط ستمائة وسبعة ريالات وخمسون هللة لا غير',
    bank_info: 'مدى / نقدي  |  نظام سداد فوري',
    terms: 'الاسترجاع والاستبدال خلال 7 أيام بموجب أصل الفاتورة.',
    items: [
      { code: 'RTL-01', name: 'بطاقات شحن واشتراكات رقمية فورية معتمدة', unit: 'حبة', qty: 4, price: 100.00, discount: 0 },
      { code: 'RTL-02', name: 'ملحقات وإكسسوارات هواتف سريعة متنوعة', unit: 'حبة', qty: 2, price: 65.00, discount: 5.00 },
    ],
    extra_headers: [],
    sample_extra: [],
  },
  {
    id: 'grid',
    name_ar: 'الهندسي للمشاريع (Project Grid)',
    name_en: 'Project Grid Invoice',
    description: 'شبكة هندسية دقيقة للمشاريع والمقاولات تبرز كميات البنود وتفاصيل التوريدات.',
    badge: 'مشاريع ومقاولات',
    category: 'projects',
    primary_color: '#0284c7',
    dark_color: '#0369a1',
    issuer_ar: 'شركة الأبعاد الهندسية للمقاولات العامة',
    issuer_en: 'Engineering Dimensions Contracting',
    issuer_address: 'الخبر - حي الحزام الذهبي',
    issuer_vat: '310443322100003',
    issuer_cr: '1010554433',
    invoice_title: 'مستخلص وتوريدات مشاريع (PROJECT INVOICE)',
    invoice_number: 'ENG-2026-90',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'شركة التطوير العمراني الراقي',
    client_vat: '300332211400003',
    client_address: 'الدمام - طريق الملك فهد',
    tafqeet: 'فقط تسعة وثلاثون ألفاً وخمسمائة وواحد وعشرون ريالاً سعودياً لا غير',
    bank_info: 'البنك السعودي الفرنسي  |  IBAN: SA8855000007788991122334',
    terms: 'المواد خاضعة لفحص واعتماد المهندس المشرف في الموقع.',
    items: [
      { code: 'ENG-CON-01', name: 'توريد وصب خرسانة جاهزة مقاومة للكبريتات عيار 350', unit: 'متر مكعب', qty: 45, price: 220.00, discount: 0 },
      { code: 'ENG-CON-02', name: 'أعمال حديد تسليح مقاس 14 ملم سابك مع التقطيع', unit: 'طن', qty: 6, price: 2850.00, discount: 300.00 },
      { code: 'ENG-CON-03', name: 'عوازل مائية وحرارية للأسطح مع طبقة الحماية', unit: 'متر مربع', qty: 120, price: 48.00, discount: 0 },
    ],
    extra_headers: ['موقع_المشروع', 'المستودع_المغذي'],
    sample_extra: ['موقع برج الرياض - فهد', 'مستودع السلي'],
  },
  {
    id: 'compact',
    name_ar: 'المدمج للخدمات (Corporate Compact)',
    name_en: 'Corporate Compact Invoice',
    description: 'قالب مكثف وأنيق لفواتير الخدمات والاستشارات والعقود الدورية بأقل مساحة.',
    badge: 'خدمات واستشارات',
    category: 'services',
    primary_color: '#4f46e5',
    dark_color: '#4338ca',
    issuer_ar: 'مؤسسة المسار الموثوق لخدمات الصيانة والتشغيل',
    issuer_en: 'Reliable Path Operations & Maintenance',
    issuer_address: 'جدة - حي الرويس - شارع المعادي',
    issuer_vat: '300998877600003',
    issuer_cr: '1010665544',
    invoice_title: 'فاتورة عقود صيانة وتشغيل دورية (SERVICES INVOICE)',
    invoice_number: 'CMP-2026-31',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'مجمع أبراج البحر التجاري',
    client_vat: '302114455600003',
    client_address: 'جدة - طريق الكورنيش - حي الشاطئ',
    tafqeet: 'فقط أحد عشر ألفاً ومائتان وخمسة وسبعون ريالاً سعودياً لا غير',
    bank_info: 'بنك الجزيرة  |  IBAN: SA6660000001122334455667',
    terms: 'يشمل العقد الزيارات الدورية وقطع الغيار الاستهلاكية الأساسية.',
    items: [
      { code: 'SVC-CMP-01', name: 'صيانة دورية شاملة للمصاعد والتكييف المركزي للمبنى', unit: 'شهر', qty: 1, price: 6800.00, discount: 0 },
      { code: 'SVC-CMP-02', name: 'تبديل فلاتر وسيور ومضخات مياه إيطالية أصلية', unit: 'طقم', qty: 4, price: 750.00, discount: 100.00 },
    ],
    extra_headers: ['فترة_الخدمة'],
    sample_extra: ['عن شهر سبتمبر 2026'],
  },
  {
    id: 'corporate',
    name_ar: 'المؤسسي الحديث (Clean Corporate)',
    name_en: 'Clean Corporate Invoice',
    description: 'تصميم مؤسسي رفيع للشركات الكبرى والمجموعات التجارية مع مراكز التكلفة.',
    badge: 'مؤسسي متقدم',
    category: 'corporate',
    primary_color: '#0891b2',
    dark_color: '#0e7490',
    issuer_ar: 'مجموعة القمة المتحدة القابضة',
    issuer_en: 'United Summit Holding Group',
    issuer_address: 'الرياض - طريق مكة المكرمة - حي العليا',
    issuer_vat: '300887766500003',
    issuer_cr: '1010887766',
    invoice_title: 'فاتورة توريد مؤسسي وحلول أساطيل (CORPORATE INVOICE)',
    invoice_number: 'CORP-2026-77',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'شركة النقل والخدمات المتقدمة',
    client_vat: '300991122300003',
    client_address: 'الرياض - حي السلي الصناعي',
    tafqeet: 'فقط سبعة عشر ألفاً ومئة واثنان وثلاثون ريالاً سعودياً لا غير',
    bank_info: 'البنك الأول (SAB)  |  IBAN: SA9910000008877665544332',
    terms: 'الضمان ساري لمدة ثلاث سنوات مع التحديثات السحابية المجانية.',
    items: [
      { code: 'CRP-FLEET-01', name: 'تجهيزات سيارات أسطول وتتبع GPS الذكي مع حساسات الوزن', unit: 'جهاز', qty: 12, price: 520.00, discount: 240.00 },
      { code: 'CRP-FLEET-02', name: 'منصة إدارة الحركة والمسارات سنوي مع لوحة تحكم ذكية', unit: 'ترخيص', qty: 1, price: 8900.00, discount: 0 },
    ],
    extra_headers: ['مركز_التكلفة', 'الفرع_المصدر'],
    sample_extra: ['CC-102 (المبيعات المركزية)', 'فرع العليا'],
  },
  {
    id: 'rawasi',
    name_ar: 'رواسي ينبع - اتصالات وتجزئة (Rawasi Enterprise)',
    name_en: 'Rawasi Telecom & Retail Invoice',
    description: 'قالب مستوحى من فواتير الاتصالات والتجزئة وشبكات التوزيع مع بيانات الفرع والـ IMEI والبيع الآجل.',
    badge: 'اتصالات وتجزئة',
    category: 'telecom',
    primary_color: '#1e3a8a',
    dark_color: '#172554',
    issuer_ar: 'مؤسسة رواسي ينبع للاتصالات وتقنية المعلومات',
    issuer_en: 'Rawasi Yanbu Telecom & IT',
    issuer_address: 'السعودية - ينبع - طريق الملك عبدالعزيز - حي الزهور',
    issuer_vat: '302186150800003',
    issuer_cr: '7204077252',
    invoice_title: 'فاتورة مبيعات أجهزة واتصالات ضريبية (TAX INVOICE)',
    invoice_number: 'ROASI-YNB-904',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'مركز التقنية الذكية للاتصالات',
    client_vat: '310556677800003',
    client_address: 'ينبع الصناعية - حي النواة - الهيئة الملكية',
    tafqeet: 'فقط عشرة آلاف وثمانمائة وثلاثة وسبعون ريالاً سعودياً لا غير',
    bank_info: 'مصرف الراجحي  |  IBAN: SA0380000123456789012345',
    terms: 'ضمان الأجهزة الذكية والراوترات خاضع لوكلاء المملكة الرسميين سنتين.',
    items: [
      { code: 'TEL-5G-01', name: 'راوتر الجيل الخامس المنزلي فائق السرعة ZTE 5G مع شريحة بيانات', unit: 'حبة', qty: 4, price: 799.00, discount: 0 },
      { code: 'TEL-SM-02', name: 'أجهزة ذكية لوحية تابلت سامسونج 11 بوصة واي فاي وشريحة', unit: 'حبة', qty: 3, price: 1650.00, discount: 150.00 },
      { code: 'TEL-ACC-03', name: 'شواحن وبطاريات متنقلة 20000 ملي أمبير أنكر تدعم الشحن السريع', unit: 'حبة', qty: 10, price: 130.00, discount: 0 },
    ],
    extra_headers: ['الفرع_أو_المستودع', 'الرقم_التسلسلي_IMEI', 'مندوب_المبيعات'],
    sample_extra: ['مستودع ينبع المركزي', '864209048123456', 'أحمد الجهني'],
  },
  {
    id: 'ledger',
    name_ar: 'سجل المقاولات والإنشاءات (Contracting Ledger)',
    name_en: 'Contracting Ledger Invoice',
    description: 'قالب مخصص للمقاولات والحديد والتوريد مع حقول المستودع وتاريخ الاستحقاق ورقم المشروع.',
    badge: 'مقاولات وتوريد',
    category: 'contracting',
    primary_color: '#111827',
    dark_color: '#030712',
    issuer_ar: 'شركة الأساسات المتينة للمقاولات المعمارية',
    issuer_en: 'Solid Foundations Contracting',
    issuer_address: 'الرياض - مخرج 18 - طريق الخرج الصناعي',
    issuer_vat: '310119988700003',
    issuer_cr: '1010445566',
    invoice_title: 'فاتورة توريد مواد بناء وإنشاءات (CONTRACTING INVOICE)',
    invoice_number: 'BLD-2026-670',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'مؤسسة البناء والتعمير الحديثة',
    client_vat: '300667788900003',
    client_address: 'الرياض - الدائري الجنوبي - حي الشفاء',
    tafqeet: 'فقط سبعة وأربعون ألفاً وخمسمائة وواحد وتسعون ريالاً سعودياً لا غير',
    bank_info: 'البنك الأهلي السعودي  |  IBAN: SA2210000009988771122334',
    terms: 'التوريد تم مطابقاً لشهادات المنشأ والاختبارات المعملية المعتمدة.',
    items: [
      { code: 'BLD-ST-16', name: 'حديد تسليح عالي المقاومة مقاس 16 ملم سابك معتمد', unit: 'طن', qty: 10, price: 2920.00, discount: 200.00 },
      { code: 'BLD-CM-01', name: 'أسمنت بورتلاندي عادي 50 كجم مقاوم للأملاح والتربة', unit: 'كيس', qty: 250, price: 18.50, discount: 0 },
      { code: 'BLD-BLK-20', name: 'بلك إسمنتي مصمت عازل مقاس 20 سم توريد موقع العميل', unit: 'ألف حبة', qty: 4, price: 1850.00, discount: 0 },
    ],
    extra_headers: ['رقم_المشروع_أو_المستخلص', 'المستودع_أو_الموقع', 'تاريخ_الاستحقاق'],
    sample_extra: ['PRJ-2026-44', 'مستودع طريق الخرج', '2026-10-15'],
  },
  {
    id: 'logistics',
    name_ar: 'التوريد واللوجستيات (Framed Logistics)',
    name_en: 'Logistics & Supply Invoice',
    description: 'قالب مخصص لشركات النقل والتوريد والشحن مع حقول بوليصة الشحن والسائق ولوحة الشاحنة.',
    badge: 'نقل ولوجستي',
    category: 'logistics',
    primary_color: '#0f766e',
    dark_color: '#134e4a',
    issuer_ar: 'أسطول الشرق للخدمات اللوجستية والشحن المبرد',
    issuer_en: 'East Fleet Logistics & Cargo',
    issuer_address: 'الدمام - ميناء الملك عبدالعزيز - بوابة 4',
    issuer_vat: '302334455600003',
    issuer_cr: '2050112233',
    invoice_title: 'فاتورة خدمات نقل وتخزين لوجستي (LOGISTICS INVOICE)',
    invoice_number: 'LOG-2026-1080',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'شركة الأغذية والتوزيع المتحدة',
    client_vat: '300448899100003',
    client_address: 'الرياض - مستودعات طريق الخرج المركزية',
    tafqeet: 'فقط عشرة آلاف وستمائة وثلاثة وتسعون ريالاً وسبعون هللة لا غير',
    bank_info: 'البنك العربي الوطني  |  IBAN: SA7740000003322119988776',
    terms: 'الشحنات مؤمنة بالكامل ومحمية بجداول تسجيل درجات الحرارة الرقمية.',
    items: [
      { code: 'LOG-FRT-01', name: 'نقل شاحنة مبردة كاملة تريلا FTL مسار الدمام - الرياض', unit: 'رحلة', qty: 3, price: 2400.00, discount: 0 },
      { code: 'LOG-WRH-02', name: 'تخزين مستودعي مبرد ومناولة طبليات بضائع غذائية', unit: 'طبلية', qty: 40, price: 35.00, discount: 0 },
      { code: 'LOG-INS-03', name: 'تأمين بضائع وتتبع حراري حي طوال مسار الرحلة', unit: 'رحلة', qty: 3, price: 250.00, discount: 50.00 },
    ],
    extra_headers: ['رقم_بوليصة_الشحن', 'اسم_السائق_أو_الناقل', 'رقم_لوحة_الشاحنة', 'موقع_التسليم'],
    sample_extra: ['BOL-9021', 'خالد الدوسري', 'أ ب ج 4321', 'مستودعات ميناء الملك عبدالعزيز'],
  },
  {
    id: 'detailed_address',
    name_ar: 'العنوان الوطني المفصل (National Address Detailed)',
    name_en: 'National Address Detailed Invoice',
    description: 'قالب تفصيلي يبرز خلايا العنوان الوطني الستة للعميل (المبنى، الشارع، الحي، المدينة، الرمز، الإضافي).',
    badge: 'عنوان وطني مفصل',
    category: 'government',
    primary_color: '#15803d',
    dark_color: '#166534',
    issuer_ar: 'شركة البنية الوطنية للتوريدات والمقاولات',
    issuer_en: 'National Infrastructure Supplies',
    issuer_address: 'الرياض - مبنى 2410، طريق التخصصي، حي المؤتمرات، الرياض 12711، إضافي 7821',
    issuer_vat: '300776655400003',
    issuer_cr: '1010123456',
    invoice_title: 'فاتورة ضريبية بالعنوان الوطني المعتمد (TAX INVOICE)',
    invoice_number: 'NAT-2026-552',
    invoice_date: '2026-09-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'شركة إعمار العاصمة للتطوير والاستثمار',
    client_vat: '310887766500003',
    client_address: 'الرياض - مبنى 4520، طريق الملك فهد، حي المروج، الرياض 12282، إضافي 6912',
    tafqeet: 'فقط أربعة وعشرون ألفاً وتسعمائة وسبعة وسبعون ريالاً سعودياً لا غير',
    bank_info: 'مصرف الإنماء  |  IBAN: SA1105000001234567890123',
    terms: 'العناوين الوطنية للطرفين مسجلة ومطابقة في منصة سبل الرسمية.',
    items: [
      { code: 'NAT-ADR-01', name: 'توريد كابلات كهربائية نحاسية مسلحة 4*16 ملم توريد موقع', unit: 'متر', qty: 300, price: 42.00, discount: 0 },
      { code: 'NAT-ADR-02', name: 'لوحات توزيع كهربائية رئيسية 250 أمبير متكاملة القواطع', unit: 'لوحة', qty: 2, price: 3800.00, discount: 100.00 },
      { code: 'NAT-ADR-03', name: 'قواطع دوائر آلية وحماية تفاضلية شنايدر إلكتريك أصلية', unit: 'حبة', qty: 12, price: 185.00, discount: 0 },
    ],
    extra_headers: [
      'رقم_مبنى_العميل', 'شارع_العميل', 'حي_العميل',
      'مدينة_العميل', 'الرمز_البريدي', 'الرقم_الإضافي'
    ],
    sample_extra: ['2321', 'طريق الملك عبدالعزيز', 'حي الزهور', 'ينبع', '46424', '7712'],
  },
  {
    id: 're_rawasi_telecom',
    name_ar: 'رواسي ينبع - اتصالات وأجهزة ذكية (عينة re)',
    name_en: 'Rawasi Yanbu Telecom & Devices',
    description: 'قالب مستخرج بدقة من فاتورة مؤسسة رواسي ينبع للاتصالات (DOC-20260904-WA0040.pdf): بيع آجل، أجهزة سامسونج الترا، شواحن واكسسوارات.',
    badge: 'عينة re (اتصالات)',
    category: 'telecom',
    primary_color: '#1e3a8a',
    dark_color: '#172554',
    issuer_ar: 'مؤسسة رواسي ينبع للاتصالات',
    issuer_en: 'Rawasi Yanbu Telecommunications Est.',
    issuer_address: 'السعودية - ينبع - طريق الملك عبدالعزيز - حي الزهور',
    issuer_vat: '302186150800003',
    issuer_cr: '7204077252',
    invoice_title: 'فاتورة ضريبية (TAX INVOICE)',
    invoice_number: 'ROASI/2026/25866',
    invoice_date: '2026-07-23',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'أجل (CREDIT)',
    client_name: 'محل موجة تردد لبيع الجوالات وصيانتها',
    client_vat: '310122313700003',
    client_address: 'Saudi Arabia, Jeddah, Zip Code 23218, plastin street, alsharqeh dist.',
    tafqeet: 'فقط خمسة آلاف ومئة ريال سعودي لا غير',
    bank_info: 'مصرف الراجحي  |  IBAN: SA0380000123456789012345',
    terms: 'البضاعة المباعة خاضعة لضمان الوكيل الرسمي المعتمد سنتين.',
    items: [
      { code: 'G3-C8-00281', name: 'جوال سامسونج اس 25 الترا ازرق (512GB)', unit: 'حبة', qty: 1, price: 4434.78, discount: 0 },
      { code: 'ACC-SAM-01', name: 'كفر حماية أصلي شفاف مقاوم للصدمات', unit: 'حبة', qty: 2, price: 45.00, discount: 10.00 },
      { code: 'CHG-45W', name: 'رأس شاحن سريع سامسونج 45 واط أصلي', unit: 'حبة', qty: 1, price: 110.00, discount: 0 },
    ],
    extra_headers: ['الفرع_المصدر', 'الرقم_التسلسلي_IMEI', 'طريقة_السداد_المفصلة'],
    sample_extra: ['فرع ينبع - طريق الملك عبدالعزيز', 'G3-C8-00281-IMEI901', 'آجل - تحويل مصرف الراجحي'],
  },
  {
    id: 're_alzahraani_contracting',
    name_ar: 'الزهراني والمجد - مقاولات وحديد تسليح (عينة re)',
    name_en: 'Al-Zahrani & Al-Majd Steel & Contracting',
    description: 'قالب مستخرج بدقة من فاتورة الزهراني رقم 5295 (مؤسسة المجد للتجارة والمقاولات): مبيعات حديد التسليح بالأطنان، مستودع خميس مشيط، وتاريخ الاستحقاق.',
    badge: 'عينة re (حديد ومقاولات)',
    category: 'contracting',
    primary_color: '#111827',
    dark_color: '#030712',
    issuer_ar: 'مؤسسة المجد للتجارة والمقاولات العامة',
    issuer_en: 'Al-Majd Trading & General Contracting',
    issuer_address: 'السعودية - خميس مشيط - المنطقة الصناعية',
    issuer_vat: '300259841200003',
    issuer_cr: '5855023914',
    invoice_title: 'فاتورة مبيعات حديد ومواد بناء (TAX INVOICE)',
    invoice_number: '5295',
    invoice_date: '2026-08-14',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجل (CREDIT)',
    client_name: 'مؤسسة عبدالله الزهراني للمقاولات العامة',
    client_vat: '310245678900003',
    client_address: 'عسير - أبها - حي المنسك',
    tafqeet: 'فقط تسعة وسبعون ألفاً وثلاثمائة وثمانية وستون ريالاً سعودياً لا غير',
    bank_info: 'البنك الأهلي السعودي  |  IBAN: SA5510000005855023914001',
    terms: 'سداد الفاتورة مستحق خلال 45 يوماً من تاريخ التوريد المعتمد.',
    items: [
      { code: 'STL-16-SBK', name: 'حديد تسليح سابك مقاس 16 ملم شد بلد', unit: 'طن', qty: 15, price: 2850.00, discount: 0 },
      { code: 'STL-12-RJH', name: 'حديد تسليح الراجحي مقاس 12 ملم عالي المتانة', unit: 'طن', qty: 8, price: 2830.00, discount: 240.00 },
      { code: 'STL-TIE-01', name: 'سلك رباط حديد مجلفن شد مصنع معتمد', unit: 'لفة', qty: 25, price: 45.00, discount: 0 },
    ],
    extra_headers: ['مستودع_التسليم', 'رقم_أمر_الشراء_PO', 'تاريخ_الاستحقاق', 'اسم_السائق_والشاحنة'],
    sample_extra: ['مستودع خميس مشيط المركزي', 'PO-5295-STEEL', '2026-09-30', 'سالم القحطاني - نقل ثقيل 592'],
  },
  {
    id: 're_awtad_albadr',
    name_ar: 'أوتاد البدر والحرة - خدمات لوجستية وتوريد (عينة re)',
    name_en: 'Awtad Al-Badr & Al-Hurra Logistics',
    description: 'قالب مستخرج بدقة من فاتورة شركة أوتاد البدر رقم 5548 (شركة الحرة المتحدة للخدمات اللوجستية): توريدات فندقية ومفارش ومنظفات، جدة ومكة.',
    badge: 'عينة re (لوجستي وتوريد)',
    category: 'logistics',
    primary_color: '#0f766e',
    dark_color: '#134e4a',
    issuer_ar: 'شركة الحرة المتحدة للخدمات اللوجستية',
    issuer_en: 'Al-Hurra United Logistics Services Company',
    issuer_address: 'جدة - حي الفيصلية - طريق الملك فهد',
    issuer_vat: '311261032200003',
    issuer_cr: '7028658511',
    invoice_title: 'فاتورة مبيعات ضريبية (TAX INVOICE)',
    invoice_number: '5548',
    invoice_date: '2026-04-20',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجلة (CREDIT)',
    client_name: 'شركة أوتاد البدر للتجارة والتوريدات الفندقية',
    client_vat: '312744658900003',
    client_address: 'مكة المكرمة - حي الشرائع',
    tafqeet: 'فقط ستة وعشرون ألفاً وثلاثمائة وتسعة وعشرون ريالاً وربع لا غير',
    bank_info: 'مصرف الراجحي  |  IBAN: SA038000070286585110001',
    terms: 'التوريد تم لمستودعات العميل بمكة المكرمة مع شهادات المطابقة.',
    items: [
      { code: 'DWN-2L', name: 'منعم ملابس Downy سعة 2 لتر مركز', unit: 'كرتون', qty: 60, price: 26.00, discount: 0 },
      { code: 'TOW-HOTEL', name: 'منشفة حمام قطن فندقي فاخر 100%', unit: 'حبة', qty: 75, price: 35.00, discount: 0 },
      { code: 'BED-SHT', name: 'شرشف سرير فندقي مزدوج أبيض ناصع', unit: 'حبة', qty: 50, price: 65.00, discount: 0 },
      { code: 'PLW-HTL', name: 'مخدة فندقية مايكروفايبر مضادة للحساسية', unit: 'حبة', qty: 68, price: 55.00, discount: 0 },
      { code: 'BLK-HTL', name: 'بطانية سرير فاخرة دافئة ناعمة', unit: 'حبة', qty: 48, price: 90.00, discount: 0 },
    ],
    extra_headers: ['وجهة_التسليم', 'رقم_بوليصة_الشحن', 'شروط_التوريد'],
    sample_extra: ['مكة المكرمة - حي الشرائع', 'BL-5548-HURRA', 'تسليم موقع العميل خلال 48 ساعة'],
  },
  {
    id: 're_mowjat_taradud',
    name_ar: 'موجة تردد والإصدار الفاخر - إلكترونيات وصيانة (عينة re)',
    name_en: 'Mowjat Taradud & Luxury Edition Tech',
    description: 'قالب مستخرج بدقة من فاتورة محل موجة تردد رقم 10144 (مؤسسة الإصدار الفاخر): مبيعات أجهزة سامسونج الترا وضمان وصيانة.',
    badge: 'عينة re (أجهزة وصيانة)',
    category: 'retail',
    primary_color: '#0284c7',
    dark_color: '#0369a1',
    issuer_ar: 'مؤسسة الإصدار الفاخر التجارية',
    issuer_en: 'Luxury Edition Trading Establishment',
    issuer_address: 'جدة - حي الفيصلية - طريق الملك فهد',
    issuer_vat: '302284229500003',
    issuer_cr: '7007285526',
    invoice_title: 'فاتورة ضريبية - فاتورة بيع (TAX INVOICE)',
    invoice_number: '10144',
    invoice_date: '2026-07-25',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجلة (CREDIT)',
    client_name: 'محل موجة تردد لبيع الجوالات وصيانتها',
    client_vat: '311116929600003',
    client_address: 'جدة - حي الشرفية',
    tafqeet: 'فقط ثلاثة آلاف وخمسمائة وخمسون ريالاً سعودياً لا غير',
    bank_info: 'البنك الأهلي السعودي  |  IBAN: SA4410000007007285526001',
    terms: 'الجهاز مغلف ومشمول بضمان الوكيل الرسمي المعتمد سنتين.',
    items: [
      { code: 'SAM-S25U-NAT', name: 'سامسونج اس 25 الترا لون طبيعي (512GB)', unit: 'حبة', qty: 1, price: 3086.96, discount: 0 },
      { code: 'SAM-CASE-PR', name: 'كفر سيليكون أصلي فخم مقاوم للصدمات', unit: 'حبة', qty: 3, price: 65.00, discount: 15.00 },
      { code: 'SCR-PRT-01', name: 'حماية زجاجية نانو سيراميك للشاشة مع التركيب', unit: 'حبة', qty: 4, price: 40.00, discount: 0 },
    ],
    extra_headers: ['الرقم_التسلسلي_للجهاز', 'مدة_الضمان', 'فرع_الصيانة'],
    sample_extra: ['SN-S25-ULTRA-NAT-98', 'سنتان ضمان الوكيل', 'فرع جدة - الشرفية'],
  },
  {
    id: 're_tarkeeb_contracting',
    name_ar: 'مؤسسة تركيب والكثيري - دهانات ومواد عزل ومقاولات (عينة re)',
    name_en: 'Tarkeeb & Al-Katheeri Contracting',
    description: 'قالب مستخرج بدقة من فاتورة مؤسسة تركيب للمقاولات رقم 5963 (مؤسسة محمد الكثيري): دهانات كابلات، مواد عزل، توريدات مقاولات، جدة.',
    badge: 'عينة re (مواد مقاولات)',
    category: 'contracting',
    primary_color: '#b45309',
    dark_color: '#92400e',
    issuer_ar: 'مؤسسة محمد كمال محمد الكثيري التجارية',
    issuer_en: 'Al-Katheeri Trading Establishment',
    issuer_address: 'جدة - حي العزيزية - طريق الملك فهد',
    issuer_vat: '300645181300003',
    issuer_cr: '4030499958',
    invoice_title: 'فاتورة بيع ومواد عزل (TAX INVOICE)',
    invoice_number: '5963',
    invoice_date: '2025-12-18',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجلة (CREDIT)',
    client_name: 'مؤسسة تركيب للمقاولات العامة',
    client_vat: '310576130700003',
    client_address: 'جدة - حي مشرفة - طريق الملك فهد',
    tafqeet: 'فقط سبعة وعشرون ألفاً ومئتان وثمانون ريالاً وثلاثون هللة لا غير',
    bank_info: 'بنك الرياض  |  IBAN: SA5520000004030499958001',
    terms: 'المواد خاضعة لشهادات مطابقة المواصفات القياسية السعودية SASO.',
    items: [
      { code: 'CB-606-WHT', name: 'سي بي 606 أبيض 310 مل مواد لواصق عزل', unit: 'حبة', qty: 8, price: 76.50, discount: 0 },
      { code: 'CB-679-PNT', name: 'دهان كابلات سي بي 679 مقاوم للحرارة والحريق', unit: 'برميل', qty: 3, price: 5340.00, discount: 0 },
      { code: 'CF-RED-PNT', name: 'سي اف دهان أحمر صناعي وقائي للعزل', unit: 'برميل', qty: 2, price: 2850.00, discount: 0 },
      { code: 'FS-ONE-20', name: 'اف اس وان 20 أوز مواد عزل حراري ومطاطي', unit: 'حبة', qty: 10, price: 139.00, discount: 0 },
    ],
    extra_headers: ['موقع_المشروع', 'رقم_المستخلص_أو_الدفعة', 'المواصفة_الفنية'],
    sample_extra: ['جدة - حي مشرفة طريق الملك فهد', 'مستخلص رقم 3 - عزل كابلات', 'مطابق للمواصفات السعودية SASO'],
  },
  {
    id: 're_ruwad_alittihad',
    name_ar: 'رواد الاتحاد - العنوان الوطني والمقاولات (عينة re)',
    name_en: 'Ruwad Al-Ittihad National Address & Contracting',
    description: 'قالب مستخرج بدقة من فاتورة مؤسسة رواد الاتحاد رقم 4523 (حياة فهد الحربي): العنوان الوطني السداسي الكامل، ومجموع بنود المقاولات والألمنيوم.',
    badge: 'عينة re (عنوان وطني مفصل)',
    category: 'contracting',
    primary_color: '#15803d',
    dark_color: '#166534',
    issuer_ar: 'مؤسسة رواد الاتحاد للمقاولات والتجارة',
    issuer_en: 'Ruwad Al-Ittihad Contracting Est.',
    issuer_address: 'جدة - مبنى 4523، شارع حراء، حي النزهة، جدة 23532، إضافي 8910',
    issuer_vat: '301984521000003',
    issuer_cr: '4030612984',
    invoice_title: 'فاتورة مقاولات وألمنيوم ضريبية (TAX INVOICE)',
    invoice_number: '4523',
    invoice_date: '2026-06-12',
    invoice_type: 'ضريبية معتمدة',
    payment_method: 'آجلة (CREDIT)',
    client_name: 'حياة فهد الحربي للمقاولات والتوريدات',
    client_vat: '310334455600003',
    client_address: 'جدة - حي الزهراء - شارع البترجي',
    tafqeet: 'فقط سبعة عشر ألفاً وخمسمائة واثنان وستون ريالاً سعودياً لا غير',
    bank_info: 'مصرف الراجحي  |  IBAN: SA03800004030612984001',
    terms: 'الضمان على الهياكل والألمنيوم خمس سنوات شامل التركيب والصيانة.',
    items: [
      { code: 'RWD-ALM-01', name: 'توريد وتركيب قواطع ألمنيوم معزولة حرارياً للواجهات', unit: 'متر مربع', qty: 18, price: 350.00, discount: 0 },
      { code: 'RWD-SEC-02', name: 'أبواب زجاج سيكوريت معالجة ضد الكسر 12 ملم', unit: 'باب', qty: 4, price: 1800.00, discount: 200.00 },
      { code: 'RWD-HND-03', name: 'مقابض وإكسسوارات ستانلس ستيل إيطالية فاخرة', unit: 'طقم', qty: 6, price: 160.00, discount: 0 },
    ],
    extra_headers: ['رقم_المبنى', 'اسم_الشارع', 'اسم_الحي', 'المدينة', 'الرمز_البريدي', 'الرقم_الإضافي'],
    sample_extra: ['4523', 'شارع حراء', 'حي النزهة', 'جدة', '23532', '8910'],
  },
];

/**
 * توليد محتوى SpreadsheetML لملف Excel التوافقي (.xls)
 * يتضمن تصميم الفاتورة الكامل مع الترويسة والبطاقات والجدول والإجماليات
 */
function buildSpreadsheetXml(tpl) {
  const items = Array.isArray(tpl.items) && tpl.items.length > 0 ? tpl.items : [
    { code: 'ITM-001', name: `بند توريد 1 - ${tpl.name_ar}`, unit: 'حبة', qty: 2, price: 450.00, discount: 0 },
    { code: 'ITM-002', name: 'بند توريد 2', unit: 'حبة', qty: 1, price: 120.00, discount: 10.00 },
    { code: 'ITM-003', name: 'خدمات مساندة', unit: 'خدمة', qty: 1, price: 250.00, discount: 0 },
  ];

  let totSub = 0, totDisc = 0, totTax = 0, totGrand = 0;
  const itemRowsXml = items.map((it, idx) => {
    const q = Number(it.qty || 1);
    const p = Number(it.price || 0);
    const d = Number(it.discount || 0);
    const sub = Number(((q * p) - d).toFixed(2));
    const tx = Number((sub * 0.15).toFixed(2));
    const gr = Number((sub + tx).toFixed(2));
    totSub += sub; totDisc += d; totTax += tx; totGrand += gr;
    const style = idx % 2 === 0 ? 'DataRow' : 'DataRowAlt';
    return `<Row ss:Height="22">
      <Cell ss:StyleID="${style}Center"><Data ss:Type="Number">${idx + 1}</Data></Cell>
      <Cell ss:StyleID="${style}Center"><Data ss:Type="String">${escXml(it.code)}</Data></Cell>
      <Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(it.name)}</Data></Cell>
      <Cell ss:StyleID="${style}Center"><Data ss:Type="String">${escXml(it.unit || 'حبة')}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${q}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${p}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${d}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${sub}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${tx}</Data></Cell>
      <Cell ss:StyleID="${style}Number"><Data ss:Type="Number">${gr}</Data></Cell>
    </Row>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#334155"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${tpl.dark_color || '#0f766e'}"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${tpl.dark_color || '#0f766e'}"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${tpl.dark_color || '#0f766e'}"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${tpl.dark_color || '#0f766e'}"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="${tpl.primary_color || '#0d9488'}" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CompanyTitle">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="14" ss:Color="${tpl.primary_color || '#0d9488'}" ss:Bold="1"/>
  </Style>
  <Style ss:ID="CardLabel">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#0F172A" ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CardValue">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#334155"/>
  </Style>
  <Style ss:ID="DataRow">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataRowCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataRowNumber">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="DataRowAlt">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataRowAltCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataRowAltNumber">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="GrandTotal">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="${tpl.primary_color || '#0d9488'}"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="${tpl.primary_color || '#0d9488'}"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="${tpl.primary_color || '#0d9488'}"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="${tpl.primary_color || '#0d9488'}"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="12" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="${tpl.primary_color || '#0d9488'}" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="بيانات_الفواتير">
  <Table ss:DefaultColumnWidth="90" ss:DefaultRowHeight="22">
   <Column ss:Index="1" ss:Width="35"/>
   <Column ss:Index="2" ss:Width="95"/>
   <Column ss:Index="3" ss:Width="190"/>
   <Column ss:Index="4" ss:Width="60"/>
   <Column ss:Index="5" ss:Width="60"/>
   <Column ss:Index="6" ss:Width="80"/>
   <Column ss:Index="7" ss:Width="90"/>
   <Column ss:Index="8" ss:Width="105"/>
   <Column ss:Index="9" ss:Width="90"/>
   <Column ss:Index="10" ss:Width="110"/>
   <Row ss:Height="28">
    <Cell ss:Index="2" ss:StyleID="CompanyTitle"><Data ss:Type="String">${escXml(tpl.issuer_ar || tpl.name_ar)}</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="Default"><Data ss:Type="String">${escXml(tpl.issuer_en || tpl.name_en)}</Data></Cell>
   </Row>
   <Row ss:Height="20">
    <Cell ss:Index="2" ss:StyleID="Default"><Data ss:Type="String">${escXml(tpl.issuer_address || 'المملكة العربية السعودية')}</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="Default"><Data ss:Type="String">الرقم الضريبي: ${escXml(tpl.issuer_vat || '300000000000003')} | السجل: ${escXml(tpl.issuer_cr || '1010000001')}</Data></Cell>
   </Row>
   <Row ss:Height="10"/>
   <Row ss:Height="24">
    <Cell ss:Index="5" ss:StyleID="Header"><Data ss:Type="String">${escXml(tpl.invoice_title || 'فاتورة مبيعات ضريبية (TAX INVOICE)')}</Data></Cell>
   </Row>
   <Row ss:Height="10"/>
   <Row ss:Height="22">
    <Cell ss:Index="2" ss:StyleID="CardLabel"><Data ss:Type="String">اسم العميل:</Data></Cell>
    <Cell ss:Index="3" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.client_name || 'شركة الأمل للتجارة')}</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="CardLabel"><Data ss:Type="String">رقم الفاتورة:</Data></Cell>
    <Cell ss:Index="8" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.invoice_number || 'INV-2026-001')}</Data></Cell>
   </Row>
   <Row ss:Height="22">
    <Cell ss:Index="2" ss:StyleID="CardLabel"><Data ss:Type="String">الرقم الضريبي للعميل:</Data></Cell>
    <Cell ss:Index="3" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.client_vat || '310000000000003')}</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="CardLabel"><Data ss:Type="String">تاريخ الفاتورة:</Data></Cell>
    <Cell ss:Index="8" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.invoice_date || new Date().toISOString().slice(0, 10))}</Data></Cell>
   </Row>
   <Row ss:Height="22">
    <Cell ss:Index="2" ss:StyleID="CardLabel"><Data ss:Type="String">عنوان العميل:</Data></Cell>
    <Cell ss:Index="3" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.client_address || 'المملكة العربية السعودية')}</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="CardLabel"><Data ss:Type="String">طريقة السداد / النوع:</Data></Cell>
    <Cell ss:Index="8" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.payment_method || 'آجل')} (${escXml(tpl.invoice_type || 'STANDARD')})</Data></Cell>
   </Row>
   <Row ss:Height="14"/>
   <Row ss:Height="26">
    <Cell ss:StyleID="Header"><Data ss:Type="String">#</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">رقم الصنف</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">اسم الصنف والبيان</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">الوحدة</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">الكمية</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">سعر الوحدة</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">الخصم</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">المبلغ قبل الضريبة</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">الضريبة (15%)</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">المجموع شامل الضريبة</Data></Cell>
   </Row>
   ${itemRowsXml}
   <Row ss:Height="12"/>
   <Row ss:Height="22">
    <Cell ss:Index="2" ss:StyleID="CardLabel"><Data ss:Type="String">المبلغ كتابةً:</Data></Cell>
    <Cell ss:Index="3" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.tafqeet || 'فقط خمسة آلاف ومئة ريال سعودي لا غير')}</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="CardLabel"><Data ss:Type="String">الإجمالي قبل الضريبة:</Data></Cell>
    <Cell ss:Index="9" ss:StyleID="DataRowNumber"><Data ss:Type="Number">${totSub.toFixed(2)}</Data></Cell>
   </Row>
   <Row ss:Height="22">
    <Cell ss:Index="2" ss:StyleID="CardLabel"><Data ss:Type="String">الحساب البنكي:</Data></Cell>
    <Cell ss:Index="3" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.bank_info || 'مصرف الراجحي | IBAN: SA0380000123456789012345')}</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="CardLabel"><Data ss:Type="String">إجمالي الخصم:</Data></Cell>
    <Cell ss:Index="9" ss:StyleID="DataRowNumber"><Data ss:Type="Number">${totDisc.toFixed(2)}</Data></Cell>
   </Row>
   <Row ss:Height="22">
    <Cell ss:Index="2" ss:StyleID="CardLabel"><Data ss:Type="String">الملاحظات والشروط:</Data></Cell>
    <Cell ss:Index="3" ss:StyleID="CardValue"><Data ss:Type="String">${escXml(tpl.terms || 'البضاعة المباعة خاضعة لضمان الوكيل الرسمي المعتمد سنتين.')}</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="CardLabel"><Data ss:Type="String">ضريبة القيمة المضافة (15%):</Data></Cell>
    <Cell ss:Index="9" ss:StyleID="DataRowNumber"><Data ss:Type="Number">${totTax.toFixed(2)}</Data></Cell>
   </Row>
   <Row ss:Height="26">
    <Cell ss:Index="2" ss:StyleID="CardLabel"><Data ss:Type="String">توقيع المستلم والختم:</Data></Cell>
    <Cell ss:Index="3" ss:StyleID="CardValue"><Data ss:Type="String">..........................................</Data></Cell>
    <Cell ss:Index="7" ss:StyleID="GrandTotal"><Data ss:Type="String">الإجمالي النهائي المستحق:</Data></Cell>
    <Cell ss:Index="9" ss:StyleID="GrandTotal"><Data ss:Type="Number">${totGrand.toFixed(2)}</Data></Cell>
   </Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DisplayRightToLeft/>
  </WorksheetOptions>
 </Worksheet>
 <Worksheet ss:Name="دليل_الاستخدام">
  <Table ss:DefaultColumnWidth="140" ss:DefaultRowHeight="22">
   <Column ss:Width="140"/>
   <Column ss:Width="280"/>
   <Column ss:Width="160"/>
   <Column ss:Width="90"/>
   <Row ss:Height="24">
    <Cell ss:StyleID="Header"><Data ss:Type="String">الحقل</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">الوصف والتفاصيل</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">مثال التعبئة</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">إلزامي؟</Data></Cell>
   </Row>
   <Row ss:Height="20">
    <Cell ss:StyleID="DataRow"><Data ss:Type="String">مجموعة_الفاتورة</Data></Cell>
    <Cell ss:StyleID="DataRow"><Data ss:Type="String">رقم أو معرّف يجمع أسطر وبنود الفاتورة الواحدة</Data></Cell>
    <Cell ss:StyleID="DataRow"><Data ss:Type="String">1 أو ${escXml(tpl.invoice_number || 'INV-001')}</Data></Cell>
    <Cell ss:StyleID="DataRowCenter"><Data ss:Type="String">نعم</Data></Cell>
   </Row>
   <Row ss:Height="20">
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">رقم الفاتورة</Data></Cell>
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">رقم الفاتورة المرجعي الفريد</Data></Cell>
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">${escXml(tpl.invoice_number || 'INV-001')}</Data></Cell>
    <Cell ss:StyleID="DataRowAltCenter"><Data ss:Type="String">نعم</Data></Cell>
   </Row>
   <Row ss:Height="20">
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">اسم العميل</Data></Cell>
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">اسم العميل أو المؤسسة المشترية</Data></Cell>
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">${escXml(tpl.client_name || 'شركة الأمل')}</Data></Cell>
    <Cell ss:StyleID="DataRowAltCenter"><Data ss:Type="String">نعم</Data></Cell>
   </Row>
   <Row ss:Height="20">
    <Cell ss:StyleID="DataRow"><Data ss:Type="String">تاريخ الفاتورة</Data></Cell>
    <Cell ss:StyleID="DataRow"><Data ss:Type="String">تاريخ الإصدار بصيغة YYYY-MM-DD</Data></Cell>
    <Cell ss:StyleID="DataRow"><Data ss:Type="String">${escXml(tpl.invoice_date || '2026-09-14')}</Data></Cell>
    <Cell ss:StyleID="DataRowCenter"><Data ss:Type="String">نعم</Data></Cell>
   </Row>
   <Row ss:Height="20">
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">جدول البنود</Data></Cell>
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">صفوف المنتجات أو الخدمات مع الكمية وسعر الوحدة</Data></Cell>
    <Cell ss:StyleID="DataRowAlt"><Data ss:Type="String">سطر 11 فما فوق</Data></Cell>
    <Cell ss:StyleID="DataRowAltCenter"><Data ss:Type="String">نعم</Data></Cell>
   </Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DisplayRightToLeft/>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

/**
 * التأكد من وجود وتوليد كافة ملفات الـ Excel الـ 18 على القرص بصيغتي XLSX و XLS
 */
function ensureAllExcelFilesExist(force = false) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  for (const tpl of TEMPLATES_CATALOG) {
    const xlsxPath = path.join(TEMPLATES_DIR, `${tpl.id}.xlsx`);
    if (force || !fs.existsSync(xlsxPath)) {
      const buf = buildXlsx(tpl);
      fs.writeFileSync(xlsxPath, buf);
    }
    const xlsPath = path.join(TEMPLATES_DIR, `${tpl.id}.xls`);
    if (force || !fs.existsSync(xlsPath)) {
      const xml = buildSpreadsheetXml(tpl);
      fs.writeFileSync(xlsPath, xml, 'utf8');
    }
  }
}

/**
 * جلب قائمة القوالب كاملة
 */
function getTemplatesList() {
  return TEMPLATES_CATALOG.map((t) => ({
    id: t.id,
    name_ar: t.name_ar,
    name_en: t.name_en,
    description: t.description,
    badge: t.badge,
    category: t.category,
    primary_color: t.primary_color,
    file_name: `${t.id}.xlsx`,
    file_path: path.join(TEMPLATES_DIR, `${t.id}.xlsx`),
  }));
}

/**
 * جلب قالب محدد بواسطة المعرّف (يدعم xlsx الافتراضي و xls التوافقي)
 */
function getTemplate(id, format = 'xlsx') {
  const tpl = TEMPLATES_CATALOG.find((t) => t.id === id) || TEMPLATES_CATALOG[0];
  const isXls = String(format).toLowerCase() === 'xls';

  if (isXls) {
    const xlsPath = path.join(TEMPLATES_DIR, `${tpl.id}.xls`);
    if (!fs.existsSync(xlsPath)) {
      fs.writeFileSync(xlsPath, buildSpreadsheetXml(tpl), 'utf8');
    }
    const content = fs.readFileSync(xlsPath, 'utf8');
    return {
      ...tpl,
      filename: `invoice_template_${tpl.id}.xls`,
      filePath: xlsPath,
      content,
      contentType: 'application/vnd.ms-excel; charset=utf-8',
    };
  }

  const xlsxPath = path.join(TEMPLATES_DIR, `${tpl.id}.xlsx`);
  if (!fs.existsSync(xlsxPath)) {
    fs.writeFileSync(xlsxPath, buildXlsx(tpl));
  }
  const content = fs.readFileSync(xlsxPath);
  return {
    ...tpl,
    filename: `invoice_template_${tpl.id}.xlsx`,
    filePath: xlsxPath,
    content,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/**
 * مزامنة قوالب الـ Excel مع جدول excel_templates في قاعدة البيانات
 */
function syncExcelTemplatesToDb(db) {
  ensureAllExcelFilesExist(true);
  const now = new Date().toISOString();

  db.exec(`
    CREATE TABLE IF NOT EXISTS excel_templates (
      id            TEXT PRIMARY KEY,
      name_ar       TEXT NOT NULL,
      name_en       TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      badge         TEXT NOT NULL DEFAULT '',
      category      TEXT NOT NULL DEFAULT 'general',
      file_path     TEXT NOT NULL,
      color_hex     TEXT NOT NULL DEFAULT '#0d9488',
      headers_json  TEXT NOT NULL DEFAULT '[]',
      is_active     INTEGER NOT NULL DEFAULT 1,
      updated_at    TEXT NOT NULL
    );
  `);

  const stmt = db.prepare(`
    INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, is_active, updated_at)
    VALUES (:id, :name_ar, :name_en, :description, :badge, :category, :file_path, :color_hex, :headers_json, 1, :updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name_ar = excluded.name_ar,
      name_en = excluded.name_en,
      description = excluded.description,
      badge = excluded.badge,
      category = excluded.category,
      file_path = excluded.file_path,
      color_hex = excluded.color_hex,
      headers_json = excluded.headers_json,
      updated_at = excluded.updated_at
  `);

  for (const tpl of TEMPLATES_CATALOG) {
    const filePath = path.join(TEMPLATES_DIR, `${tpl.id}.xlsx`);
    const allHeaders = [
      'مجموعة_الفاتورة', 'كود_أو_اسم_العميل', 'تاريخ_الفاتورة', 'وقت_الفاتورة',
      'نوع_الفاتورة', 'طريقة_الدفع', ...(tpl.extra_headers || []),
      'كود_أو_اسم_الصنف', 'الوحدة', 'الكمية', 'سعر_الوحدة', 'الخصم', 'نسبة_الضريبة', 'ملاحظات'
    ];
    stmt.run({
      id: tpl.id,
      name_ar: tpl.name_ar,
      name_en: tpl.name_en,
      description: tpl.description,
      badge: tpl.badge,
      category: tpl.category,
      file_path: filePath,
      color_hex: tpl.primary_color,
      headers_json: JSON.stringify(allHeaders),
      updated_at: now,
    });
  }
}

module.exports = {
  TEMPLATES_CATALOG,
  buildXlsx,
  buildSpreadsheetXml,
  parseXlsxBuffer,
  normalizeExtractedRows,
  ensureAllExcelFilesExist,
  getTemplatesList,
  getTemplate,
  syncExcelTemplatesToDb,
};
