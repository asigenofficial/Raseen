package excel

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

type ParsedRow struct {
	RowIndex      int      `json:"row_index"`
	ClientName    string   `json:"client_name"`
	ItemCode      string   `json:"item_code"`
	ItemName      string   `json:"item_name"`
	Quantity      float64  `json:"quantity"`
	UnitPrice     float64  `json:"unit_price"`
	TaxRate       float64  `json:"tax_rate"`
	InvoiceNumber string   `json:"invoice_number"`
	IssueDate     string   `json:"issue_date"`
	Unit          string   `json:"unit"`
	Notes         string   `json:"notes"`
	Errors        []string `json:"errors"`
}

type AnalyzeResult struct {
	HeadersRowIndex int         `json:"headers_row_index"`
	Headers         []string    `json:"headers"`
	TotalRows       int         `json:"total_rows"`
	ValidRows       int         `json:"valid_rows"`
	ErrorRows       int         `json:"error_rows"`
	InvoicesCount   int         `json:"invoices_count"`
	TotalAmount     float64     `json:"total_amount"`
	Rows            []ParsedRow `json:"rows"`
	RawRows         [][]string  `json:"raw_rows,omitempty"`
}

var arabicDigits = strings.NewReplacer(
	"٠", "0", "١", "1", "٢", "2", "٣", "3", "٤", "4",
	"٥", "5", "٦", "6", "٧", "7", "٨", "8", "٩", "9",
	"٫", ".", "٬", "",
)

func normalizeNumberStr(s string) string {
	s = arabicDigits.Replace(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, ",", "")
	return s
}

func cleanCellText(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "\ufeff")
	s = strings.ReplaceAll(s, "\u0640", "") // tatweel
	return strings.ToLower(strings.TrimSpace(s))
}

func matchesAny(cell string, synonyms []string) bool {
	c := cleanCellText(cell)
	if c == "" {
		return false
	}
	for _, syn := range synonyms {
		syn = strings.ToLower(strings.TrimSpace(syn))
		if syn == "" {
			continue
		}
		if c == syn || strings.Contains(c, syn) {
			return true
		}
	}
	return false
}

// readSpreadsheetRows reads raw rows from an XLSX, CSV or TSV reader safely.
func readSpreadsheetRows(r io.Reader, filename string) ([][]string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("تعذر قراءة بيانات الملف: %w", err)
	}
	if len(data) == 0 {
		return nil, errors.New("الملف فارغ")
	}

	lowerName := strings.ToLower(filename)
	isCsv := strings.HasSuffix(lowerName, ".csv") || strings.HasSuffix(lowerName, ".txt") || strings.HasSuffix(lowerName, ".tsv")

	if isCsv {
		// Strip UTF-8 BOM if present
		if bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
			data = data[3:]
		}

		// Detect delimiter (, or ; or \t)
		firstLine := string(data)
		if idx := strings.IndexAny(firstLine, "\r\n"); idx != -1 {
			firstLine = firstLine[:idx]
		}
		delim := ','
		if strings.Count(firstLine, ";") > strings.Count(firstLine, ",") {
			delim = ';'
		} else if strings.Count(firstLine, "\t") > strings.Count(firstLine, ",") {
			delim = '\t'
		}

		reader := csv.NewReader(bytes.NewReader(data))
		reader.Comma = delim
		reader.FieldsPerRecord = -1
		reader.LazyQuotes = true
		rows, err := reader.ReadAll()
		if err != nil {
			return nil, fmt.Errorf("خطأ في قراءة ملف CSV: %w", err)
		}
		return filterEmptyRows(rows), nil
	}

	// Excel XLSX
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		if strings.HasSuffix(lowerName, ".xls") && !strings.HasSuffix(lowerName, ".xlsx") {
			return nil, errors.New("صيغة .xls القديمة غير مدعومة مباشرة، يرجى حفظ الملف بصيغة Excel الحديثة (.xlsx) أو (.csv)")
		}
		return nil, fmt.Errorf("خطأ في قراءة ملف Excel: %w", err)
	}
	defer f.Close()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, errors.New("الملف لا يحتوي على أي صفحات")
	}

	// Try active sheet first
	activeIdx := f.GetActiveSheetIndex()
	var sheetToUse string
	if activeIdx >= 0 && activeIdx < len(sheets) {
		sheetToUse = sheets[activeIdx]
	} else {
		sheetToUse = sheets[0]
	}

	rows, err := f.GetRows(sheetToUse)
	if err != nil || len(rows) == 0 {
		for _, s := range sheets {
			if rList, errR := f.GetRows(s); errR == nil && len(rList) > 0 {
				rows = rList
				break
			}
		}
	}

	if len(rows) == 0 {
		return nil, errors.New("لم يتم العثور على أي بيانات داخل صفحات الملف")
	}

	return filterEmptyRows(rows), nil
}

func filterEmptyRows(rows [][]string) [][]string {
	var filtered [][]string
	for _, row := range rows {
		hasData := false
		for _, cell := range row {
			if strings.TrimSpace(cell) != "" {
				hasData = true
				break
			}
		}
		if hasData {
			filtered = append(filtered, row)
		}
	}
	return filtered
}

// AnalyzeSpreadsheet parses uploaded XLSX or CSV stream and extracts normalized invoice lines.
func AnalyzeSpreadsheet(r io.Reader, filename string, defaultTaxRate float64) (*AnalyzeResult, error) {
	rawRows, err := readSpreadsheetRows(r, filename)
	if err != nil {
		return nil, err
	}

	// Find headers row
	headerIdx := -1
	var colClient, colCode, colItem, colQty, colPrice, colVat, colInv, colDate, colUnit int = -1, -1, -1, -1, -1, -1, -1, -1, -1

	clientSynonyms := []string{"العميل", "اسم العميل", "الزبون", "اسم الزبون", "client", "customer", "buyer"}
	codeSynonyms := []string{"رقم الصنف", "كود الصنف", "كود", "رمز", "item code", "item_code", "item no", "code", "sku"}
	itemSynonyms := []string{"الصنف", "اسم الصنف", "البيان", "الوصف", "item", "description", "product", "item_name"}
	qtySynonyms := []string{"الكمية", "العدد", "qty", "quantity", "count"}
	priceSynonyms := []string{"السعر", "سعر الوحدة", "سعر", "price", "unit price", "unit_price", "rate"}
	vatSynonyms := []string{"الضريبة", "نسبة الضريبة", "vat", "tax", "tax_rate"}
	invSynonyms := []string{"رقم الفاتورة", "الفاتورة", "invoice", "invoice no", "inv", "invoice_number"}
	dateSynonyms := []string{"التاريخ", "تاريخ الفاتورة", "date", "issue_date"}
	unitSynonyms := []string{"الوحدة", "unit"}

	matchesSynonym := func(cell string, list []string) bool {
		c := strings.ToLower(strings.TrimSpace(cell))
		for _, s := range list {
			if strings.Contains(c, s) {
				return true
			}
		}
		return false
	}

	for rIdx, row := range rawRows {
		cClient, cItem, cQty, cPrice := -1, -1, -1, -1
		for cIdx, cell := range row {
			if matchesSynonym(cell, clientSynonyms) && cClient == -1 {
				cClient = cIdx
			} else if matchesSynonym(cell, codeSynonyms) && colCode == -1 {
				colCode = cIdx
			} else if matchesSynonym(cell, itemSynonyms) && cItem == -1 && !matchesSynonym(cell, codeSynonyms) {
				cItem = cIdx
			} else if matchesSynonym(cell, qtySynonyms) && cQty == -1 {
				cQty = cIdx
			} else if matchesSynonym(cell, priceSynonyms) && cPrice == -1 {
				cPrice = cIdx
			}
		}
		// If at least item and (price or qty) found, or client found
		if (cItem != -1 && (cPrice != -1 || cQty != -1)) || (cClient != -1 && cItem != -1) {
			headerIdx = rIdx
			colClient = cClient
			colItem = cItem
			colQty = cQty
			colPrice = cPrice

			// find others in same row
			for cIdx, cell := range row {
				if matchesSynonym(cell, vatSynonyms) && colVat == -1 {
					colVat = cIdx
				} else if matchesSynonym(cell, invSynonyms) && colInv == -1 {
					colInv = cIdx
				} else if matchesSynonym(cell, dateSynonyms) && colDate == -1 {
					colDate = cIdx
				} else if matchesSynonym(cell, unitSynonyms) && colUnit == -1 {
					colUnit = cIdx
				} else if matchesSynonym(cell, codeSynonyms) && colCode == -1 {
					colCode = cIdx
				}
			}
			break
		}
	}

	if headerIdx == -1 {
		// Fallback to first row
		headerIdx = 0
		colClient = 0
		colItem = 1
		colQty = 2
		colPrice = 3
	}

	res := &AnalyzeResult{
		HeadersRowIndex: headerIdx,
		Headers:         rawRows[headerIdx],
		RawRows:         rawRows,
	}

	lastClient := ""
	lastInv := ""
	lastDate := ""
	invoicesMap := make(map[string]bool)

	for rIdx := headerIdx + 1; rIdx < len(rawRows); rIdx++ {
		row := rawRows[rIdx]
		if len(row) == 0 {
			continue
		}

		getCell := func(col int) string {
			if col >= 0 && col < len(row) {
				return strings.TrimSpace(row[col])
			}
			return ""
		}

		clientStr := getCell(colClient)
		if clientStr != "" {
			lastClient = clientStr
		} else {
			clientStr = lastClient
		}

		invStr := getCell(colInv)
		if invStr != "" {
			lastInv = invStr
		} else {
			invStr = lastInv
		}

		dateStr := getCell(colDate)
		if dateStr != "" {
			lastDate = dateStr
		} else {
			dateStr = lastDate
		}

		itemStr := getCell(colItem)
		codeStr := getCell(colCode)
		qtyStr := normalizeNumberStr(getCell(colQty))
		priceStr := normalizeNumberStr(getCell(colPrice))
		vatStr := normalizeNumberStr(getCell(colVat))
		unitStr := getCell(colUnit)

		// skip empty rows
		if clientStr == "" && itemStr == "" && qtyStr == "" && priceStr == "" {
			continue
		}

		pRow := ParsedRow{
			RowIndex:      rIdx + 1,
			ClientName:    clientStr,
			ItemCode:      codeStr,
			ItemName:      itemStr,
			InvoiceNumber: invStr,
			IssueDate:     dateStr,
			Unit:          unitStr,
			TaxRate:       defaultTaxRate,
		}
		if pRow.Unit == "" {
			pRow.Unit = "حبة"
		}

		var rowErrors []string
		if pRow.ClientName == "" {
			rowErrors = append(rowErrors, "اسم العميل مفقود")
		}
		if pRow.ItemName == "" {
			rowErrors = append(rowErrors, "اسم الصنف مفقود")
		}

		qty, err := strconv.ParseFloat(qtyStr, 64)
		if err != nil || qty <= 0 {
			if qtyStr == "" {
				qty = 1.0
			} else {
				rowErrors = append(rowErrors, "الكمية غير صالحة")
			}
		}
		pRow.Quantity = qty

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil || price < 0 {
			if priceStr == "" {
				price = 0.0
			} else {
				rowErrors = append(rowErrors, "سعر الوحدة غير صالح")
			}
		}
		pRow.UnitPrice = price

		if vatStr != "" {
			if vr, err := strconv.ParseFloat(vatStr, 64); err == nil && vr >= 0 {
				pRow.TaxRate = vr
			}
		}

		pRow.Errors = rowErrors
		if len(rowErrors) == 0 {
			res.ValidRows++
			subtotal := pRow.Quantity * pRow.UnitPrice
			tax := subtotal * (pRow.TaxRate / 100.0)
			res.TotalAmount += subtotal + tax

			invKey := pRow.InvoiceNumber
			if invKey == "" {
				invKey = fmt.Sprintf("auto-%s-%s", pRow.ClientName, pRow.IssueDate)
			}
			invoicesMap[invKey] = true
		} else {
			res.ErrorRows++
		}

		res.TotalRows++
		res.Rows = append(res.Rows, pRow)
	}

	res.InvoicesCount = len(invoicesMap)
	res.TotalAmount = float64(int64(res.TotalAmount*100)) / 100.0

	return res, nil
}

// GenerateTemplateExcel creates a styled blank Excel template for invoice import.
func GenerateTemplateExcel() ([]byte, error) {
	f := excelize.NewFile()
	sheet := "الفواتير"
	f.SetSheetName("Sheet1", sheet)

	headers := []string{"اسم العميل", "رقم الفاتورة", "تاريخ الفاتورة", "رقم الصنف", "اسم الصنف", "الوحدة", "الكمية", "سعر الوحدة", "نسبة الضريبة"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}

	// Sample row
	sample := []any{"شركة الأفق المتميزة", "INV-0001", "2026-09-18", "ITM-001", "خدمات استشارية محاسبية", "ساعة", 10, 250.0, 15}
	for i, v := range sample {
		cell, _ := excelize.CoordinatesToCellName(i+1, 2)
		f.SetCellValue(sheet, cell, v)
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// GenerateVoucherTemplateExcel creates a styled blank Excel template for receipt vouchers.
func GenerateVoucherTemplateExcel() ([]byte, error) {
	f := excelize.NewFile()
	sheet := "سندات_القبض"
	f.SetSheetName("Sheet1", sheet)

	headers := []string{"اسم العميل", "رقم السند", "تاريخ السند", "المبلغ", "طريقة الدفع", "رقم المرجع", "ملاحظات"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}

	// Sample row
	sample := []any{"مؤسسة الأفق التقنية", "RV-0001", "2026-09-18", 5000.0, "تحويل بنكي", "TRX-98214", "دفعة من الحساب"}
	for i, v := range sample {
		cell, _ := excelize.CoordinatesToCellName(i+1, 2)
		f.SetCellValue(sheet, cell, v)
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ------------------------------------------------------------------ استيراد الأصناف
type ParsedItemRow struct {
	RowIndex    int      `json:"row_index"`
	ItemCode    string   `json:"item_code"`
	NameAr      string   `json:"name_ar"`
	NameEn      string   `json:"name_en"`
	Category    string   `json:"category"`
	Barcode     string   `json:"barcode"`
	Unit        string   `json:"unit"`
	CostPrice   float64  `json:"cost_price"`
	SalePrice   float64  `json:"sale_price"`
	TaxRate     float64  `json:"tax_rate"`
	Notes       string   `json:"notes"`
	Errors      []string `json:"errors"`
}

type AnalyzeItemsResult struct {
	TotalRows int             `json:"total_rows"`
	ValidRows int             `json:"valid_rows"`
	ErrorRows int             `json:"error_rows"`
	Rows      []ParsedItemRow `json:"rows"`
}

func AnalyzeItemsSpreadsheet(r io.Reader, filename string, defaultTaxRate float64) (*AnalyzeItemsResult, error) {
	rawRows, err := readSpreadsheetRows(r, filename)
	if err != nil {
		return nil, err
	}

	codeSyn := []string{"كود الصنف", "رقم الصنف", "رمز الصنف", "كود", "رمز", "الرمز", "item_code", "item code", "code", "sku", "product_code"}
	nameEnSyn := []string{"اسم الصنف بالإنجليزي", "اسم الصنف بالانجليزي", "اسم انجليزي", "بالانجليزي", "انجليزي", "name_en", "english_name", "english"}
	nameArSyn := []string{"اسم الصنف بالعربي", "اسم الصنف", "اسم المنتج", "الصنف", "المنتج", "الاسم", "اسم المادة", "المادة", "البيان", "الوصف", "item_name", "product_name", "name", "description"}
	catSyn := []string{"المجموعة", "تصنيف", "التصنيف", "القسم", "الفئة", "category", "group"}
	barSyn := []string{"باركود", "بار كود", "الباركود", "barcode", "upc", "ean"}
	unitSyn := []string{"الوحدة", "وحدة القياس", "وحدة", "unit", "uom"}
	costSyn := []string{"سعر التكلفة", "التكلفة", "سعر الشراء", "شراء", "cost_price", "cost", "purchase_price"}
	saleSyn := []string{"سعر البيع", "سعر", "السعر", "مبيع", "سعر التجزئة", "sale_price", "price", "sale"}
	taxSyn := []string{"نسبة الضريبة", "ضريبة", "الضريبة", "tax_rate", "tax", "vat"}
	notesSyn := []string{"ملاحظات", "ملاحظة", "notes", "remark"}

	bestHeaderIdx := -1
	bestScore := 0
	var cCode, cName, cNameEn, cCat, cBar, cUnit, cCost, cSale, cTax, cNotes int = -1, -1, -1, -1, -1, -1, -1, -1, -1, -1

	maxScan := len(rawRows)
	if maxScan > 15 {
		maxScan = 15
	}

	for rIdx := 0; rIdx < maxScan; rIdx++ {
		row := rawRows[rIdx]
		curCode, curName, curNameEn, curCat, curBar, curUnit, curCost, curSale, curTax, curNotes := -1, -1, -1, -1, -1, -1, -1, -1, -1, -1
		score := 0

		for cIdx, cell := range row {
			trimmed := strings.TrimSpace(cell)
			if trimmed == "" {
				continue
			}
			if curCode == -1 && matchesAny(cell, codeSyn) {
				curCode = cIdx
				score += 2
			} else if curNameEn == -1 && matchesAny(cell, nameEnSyn) {
				curNameEn = cIdx
				score += 2
			} else if curCost == -1 && matchesAny(cell, costSyn) {
				curCost = cIdx
				score += 2
			} else if curSale == -1 && matchesAny(cell, saleSyn) {
				curSale = cIdx
				score += 2
			} else if curCat == -1 && matchesAny(cell, catSyn) {
				curCat = cIdx
				score += 2
			} else if curBar == -1 && matchesAny(cell, barSyn) {
				curBar = cIdx
				score += 2
			} else if curUnit == -1 && matchesAny(cell, unitSyn) {
				curUnit = cIdx
				score += 1
			} else if curTax == -1 && matchesAny(cell, taxSyn) {
				curTax = cIdx
				score += 1
			} else if curNotes == -1 && matchesAny(cell, notesSyn) {
				curNotes = cIdx
				score += 1
			} else if curName == -1 && matchesAny(cell, nameArSyn) {
				curName = cIdx
				score += 3
			}
		}

		if curName != -1 && score > bestScore {
			bestScore = score
			bestHeaderIdx = rIdx
			cCode, cName, cNameEn = curCode, curName, curNameEn
			cCat, cBar, cUnit = curCat, curBar, curUnit
			cCost, cSale, cTax, cNotes = curCost, curSale, curTax, curNotes
		}
	}

	if bestHeaderIdx == -1 {
		if len(rawRows) > 0 && len(rawRows[0]) >= 2 {
			bestHeaderIdx = 0
			cName = 0
			if len(rawRows[0]) > 1 {
				cSale = 1
			}
		} else {
			return nil, errors.New("لم يتم العثور على عمود اسم الصنف في رأس الجدول. يرجى التأكد من وجود عمود (اسم الصنف) أو (الصنف)")
		}
	}

	res := &AnalyzeItemsResult{Rows: make([]ParsedItemRow, 0)}
	for i := bestHeaderIdx + 1; i < len(rawRows); i++ {
		row := rawRows[i]
		getCell := func(col int) string {
			if col >= 0 && col < len(row) {
				return strings.TrimSpace(row[col])
			}
			return ""
		}

		nameAr := getCell(cName)
		if nameAr == "" {
			continue // Skip completely empty rows
		}

		var rowErrs []string
		pRow := ParsedItemRow{
			RowIndex: i + 1,
			NameAr:   nameAr,
			NameEn:   getCell(cNameEn),
			ItemCode: getCell(cCode),
			Category: getCell(cCat),
			Barcode:  getCell(cBar),
			Unit:     getCell(cUnit),
			Notes:    getCell(cNotes),
			TaxRate:  defaultTaxRate,
		}

		if pRow.Unit == "" {
			pRow.Unit = "حبة"
		}

		if costStr := normalizeNumberStr(getCell(cCost)); costStr != "" {
			if cp, err := strconv.ParseFloat(costStr, 64); err == nil && cp >= 0 {
				pRow.CostPrice = cp
			} else {
				rowErrs = append(rowErrs, "سعر التكلفة غير صالح")
			}
		}

		if saleStr := normalizeNumberStr(getCell(cSale)); saleStr != "" {
			if sp, err := strconv.ParseFloat(saleStr, 64); err == nil && sp >= 0 {
				pRow.SalePrice = sp
			} else {
				rowErrs = append(rowErrs, "سعر البيع غير صالح")
			}
		}

		if taxStr := normalizeNumberStr(getCell(cTax)); taxStr != "" {
			if tr, err := strconv.ParseFloat(taxStr, 64); err == nil && tr >= 0 {
				pRow.TaxRate = tr
			}
		}

		pRow.Errors = rowErrs
		if len(rowErrs) == 0 {
			res.ValidRows++
		} else {
			res.ErrorRows++
		}
		res.TotalRows++
		res.Rows = append(res.Rows, pRow)
	}

	return res, nil
}

func GenerateItemTemplateExcel() ([]byte, error) {
	f := excelize.NewFile()
	sheet := "الأصناف"
	f.SetSheetName("Sheet1", sheet)

	headers := []string{"كود الصنف", "اسم الصنف بالعربي", "اسم الصنف بالإنجليزي", "المجموعة", "الباركود", "الوحدة", "سعر التكلفة", "سعر البيع", "نسبة الضريبة", "ملاحظات"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}

	samples := [][]any{
		{"ITM-0001", "شاشة سامسونج 27 بوصة 4K", "Samsung Monitor 27 4K", "أجهزة", "880609123456", "حبة", 850.0, 1150.0, 15, "ضمان سنتين"},
		{"ITM-0002", "ماوس لاسلكي لوجيتك", "Logitech Wireless Mouse", "إكسسوارات", "097855123456", "حبة", 45.0, 75.0, 15, ""},
		{"ITM-0003", "خدمة استشارة تقنية", "Technical Consulting Service", "خدمات", "", "ساعة", 0, 350.0, 15, "حسب طلب العميل"},
	}

	for rIdx, sample := range samples {
		for cIdx, v := range sample {
			cell, _ := excelize.CoordinatesToCellName(cIdx+1, rIdx+2)
			f.SetCellValue(sheet, cell, v)
		}
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ------------------------------------------------------------------ استيراد العملاء
type ParsedClientRow struct {
	RowIndex           int      `json:"row_index"`
	ClientCode         string   `json:"client_code"`
	Name               string   `json:"name"`
	NameEn             string   `json:"name_en"`
	Phone              string   `json:"phone"`
	Email              string   `json:"email"`
	TaxNumber          string   `json:"tax_number"`
	CommercialRegister string   `json:"commercial_register"`
	City               string   `json:"city"`
	Street             string   `json:"street"`
	OpeningBalance     float64  `json:"opening_balance"`
	Notes              string   `json:"notes"`
	Errors             []string `json:"errors"`
}

type AnalyzeClientsResult struct {
	TotalRows int               `json:"total_rows"`
	ValidRows int               `json:"valid_rows"`
	ErrorRows int               `json:"error_rows"`
	Rows      []ParsedClientRow `json:"rows"`
}

func AnalyzeClientsSpreadsheet(r io.Reader, filename string) (*AnalyzeClientsResult, error) {
	rawRows, err := readSpreadsheetRows(r, filename)
	if err != nil {
		return nil, err
	}

	codeSyn := []string{"كود العميل", "رمز العميل", "رقم العميل", "كود", "رمز", "معرف العميل", "client_code", "client code", "customer_code", "customer code", "code"}
	nameEnSyn := []string{"اسم انجليزي", "الاسم بالانجليزي", "بالانجليزي", "انجليزي", "name_en", "english_name", "english", "latin_name"}
	nameSyn := []string{"اسم العميل", "العميل", "الاسم", "اسم الزبون", "الزبون", "اسم الشركة", "اسم المؤسسة", "اسم المنشأة", "الشركة", "المؤسسة", "المشتري", "اسم المشتري", "client", "customer", "buyer", "client_name", "customer_name", "name"}
	phoneSyn := []string{"رقم الجوال", "جوال", "هاتف", "رقم الهاتف", "تلفون", "موبايل", "رقم التواصل", "تواصل", "phone", "mobile", "tel", "cell"}
	emailSyn := []string{"البريد الإلكتروني", "البريد الالكتروني", "بريد", "ايميل", "الإيميل", "الايميل", "email", "mail", "e-mail"}
	taxSyn := []string{"الرقم الضريبي", "الرقم الضريبي للعميل", "ضريبي", "رقم ضريبي", "الضريبة", "tax_number", "tax number", "vat", "vat_number", "vat_no", "trn"}
	crSyn := []string{"السجل التجاري", "رقم السجل التجاري", "سجل تجاري", "سجل", "رقم السجل", "cr", "commercial_register", "cr_number"}
	citySyn := []string{"المدينة", "مدينة", "city"}
	streetSyn := []string{"العنوان", "الشارع", "الحي", "street", "address", "district", "location"}
	balSyn := []string{"الرصيد الافتتاحي", "رصيد افتتاحي", "الرصيد", "رصيد", "افتتاحي", "opening_balance", "opening balance", "balance"}
	notesSyn := []string{"ملاحظات", "ملاحظة", "وصف", "بيان", "notes", "remark", "description"}

	bestHeaderIdx := -1
	bestScore := 0
	var cCode, cName, cNameEn, cPhone, cEmail, cTax, cCR, cCity, cStreet, cBal, cNotes int = -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1

	maxScan := len(rawRows)
	if maxScan > 15 {
		maxScan = 15
	}

	for rIdx := 0; rIdx < maxScan; rIdx++ {
		row := rawRows[rIdx]
		curCode, curName, curNameEn, curPhone, curEmail, curTax, curCR, curCity, curStreet, curBal, curNotes := -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1
		score := 0

		for cIdx, cell := range row {
			trimmed := strings.TrimSpace(cell)
			if trimmed == "" {
				continue
			}
			if curCode == -1 && matchesAny(cell, codeSyn) {
				curCode = cIdx
				score += 2
			} else if curNameEn == -1 && matchesAny(cell, nameEnSyn) {
				curNameEn = cIdx
				score += 2
			} else if curPhone == -1 && matchesAny(cell, phoneSyn) {
				curPhone = cIdx
				score += 2
			} else if curEmail == -1 && matchesAny(cell, emailSyn) {
				curEmail = cIdx
				score += 2
			} else if curTax == -1 && matchesAny(cell, taxSyn) {
				curTax = cIdx
				score += 2
			} else if curCR == -1 && matchesAny(cell, crSyn) {
				curCR = cIdx
				score += 2
			} else if curCity == -1 && matchesAny(cell, citySyn) {
				curCity = cIdx
				score += 1
			} else if curStreet == -1 && matchesAny(cell, streetSyn) {
				curStreet = cIdx
				score += 1
			} else if curBal == -1 && matchesAny(cell, balSyn) {
				curBal = cIdx
				score += 2
			} else if curNotes == -1 && matchesAny(cell, notesSyn) {
				curNotes = cIdx
				score += 1
			} else if curName == -1 && matchesAny(cell, nameSyn) {
				curName = cIdx
				score += 3
			}
		}

		if curName != -1 && score > bestScore {
			bestScore = score
			bestHeaderIdx = rIdx
			cCode, cName, cNameEn, cPhone, cEmail = curCode, curName, curNameEn, curPhone, curEmail
			cTax, cCR, cCity, cStreet, cBal, cNotes = curTax, curCR, curCity, curStreet, curBal, curNotes
		}
	}

	if bestHeaderIdx == -1 {
		if len(rawRows) > 0 && len(rawRows[0]) >= 1 {
			bestHeaderIdx = 0
			cName = 0
			if len(rawRows[0]) > 1 {
				cPhone = 1
			}
		} else {
			return nil, errors.New("لم يتم العثور على عمود اسم العميل في رأس الجدول. يرجى التأكد من وجود عمود (اسم العميل) أو (الاسم)")
		}
	}

	res := &AnalyzeClientsResult{Rows: make([]ParsedClientRow, 0)}
	for i := bestHeaderIdx + 1; i < len(rawRows); i++ {
		row := rawRows[i]
		getCell := func(col int) string {
			if col >= 0 && col < len(row) {
				return strings.TrimSpace(row[col])
			}
			return ""
		}

		name := getCell(cName)
		if name == "" {
			continue
		}

		var rowErrs []string
		pRow := ParsedClientRow{
			RowIndex:           i + 1,
			Name:               name,
			NameEn:             getCell(cNameEn),
			ClientCode:         getCell(cCode),
			Phone:              getCell(cPhone),
			Email:              getCell(cEmail),
			TaxNumber:          getCell(cTax),
			CommercialRegister: getCell(cCR),
			City:               getCell(cCity),
			Street:             getCell(cStreet),
			Notes:              getCell(cNotes),
		}

		if balStr := normalizeNumberStr(getCell(cBal)); balStr != "" {
			if b, err := strconv.ParseFloat(balStr, 64); err == nil {
				pRow.OpeningBalance = b
			} else {
				rowErrs = append(rowErrs, "الرصيد الافتتاحي غير صالح")
			}
		}

		pRow.Errors = rowErrs
		if len(rowErrs) == 0 {
			res.ValidRows++
		} else {
			res.ErrorRows++
		}
		res.TotalRows++
		res.Rows = append(res.Rows, pRow)
	}

	return res, nil
}

func GenerateClientTemplateExcel() ([]byte, error) {
	f := excelize.NewFile()
	sheet := "العملاء"
	f.SetSheetName("Sheet1", sheet)

	headers := []string{"كود العميل", "اسم العميل", "الاسم بالإنجليزي", "رقم الجوال", "البريد الإلكتروني", "الرقم الضريبي", "السجل التجاري", "المدينة", "العنوان", "الرصيد الافتتاحي", "ملاحظات"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}

	samples := [][]any{
		{"C-0001", "شركة المستقبل للتقنية", "Future Tech Co", "0501234567", "info@future.sa", "300123456700003", "1010123456", "الرياض", "طريق الملك فهد", 0.0, "عميل رئيسي"},
		{"C-0002", "مؤسسة النماء للتجارة", "Al-Namaa Trading", "0559876543", "namaa@gmail.com", "", "", "جدة", "حي الروضة", 1500.0, ""},
	}

	for rIdx, sample := range samples {
		for cIdx, v := range sample {
			cell, _ := excelize.CoordinatesToCellName(cIdx+1, rIdx+2)
			f.SetCellValue(sheet, cell, v)
		}
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}


