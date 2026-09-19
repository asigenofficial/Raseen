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
	RowIndex      int     `json:"row_index"`
	ClientName    string  `json:"client_name"`
	ItemName      string  `json:"item_name"`
	Quantity      float64 `json:"quantity"`
	UnitPrice     float64 `json:"unit_price"`
	TaxRate       float64 `json:"tax_rate"`
	InvoiceNumber string  `json:"invoice_number"`
	IssueDate     string  `json:"issue_date"`
	Unit          string  `json:"unit"`
	Notes         string  `json:"notes"`
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

// AnalyzeSpreadsheet parses uploaded XLSX or CSV stream and extracts normalized invoice lines.
func AnalyzeSpreadsheet(r io.Reader, filename string, defaultTaxRate float64) (*AnalyzeResult, error) {
	var rawRows [][]string

	isCsv := strings.HasSuffix(strings.ToLower(filename), ".csv")
	if isCsv {
		csvReader := csv.NewReader(r)
		csvReader.FieldsPerRecord = -1
		var err error
		rawRows, err = csvReader.ReadAll()
		if err != nil {
			return nil, fmt.Errorf("failed to read CSV: %w", err)
		}
	} else {
		f, err := excelize.OpenReader(r)
		if err != nil {
			return nil, fmt.Errorf("failed to read Excel file: %w", err)
		}
		defer f.Close()

		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			return nil, errors.New("الملف لا يحتوي على أي صفحات")
		}
		var errSheet error
		rawRows, errSheet = f.GetRows(sheets[0])
		if errSheet != nil {
			return nil, fmt.Errorf("failed to read sheet rows: %w", errSheet)
		}
	}

	if len(rawRows) == 0 {
		return nil, errors.New("الملف فارغ")
	}

	// Find headers row
	headerIdx := -1
	var colClient, colItem, colQty, colPrice, colVat, colInv, colDate, colUnit int = -1, -1, -1, -1, -1, -1, -1, -1

	clientSynonyms := []string{"العميل", "اسم العميل", "الزبون", "اسم الزبون", "client", "customer", "buyer"}
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
			} else if matchesSynonym(cell, itemSynonyms) && cItem == -1 {
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

	headers := []string{"اسم العميل", "رقم الفاتورة", "تاريخ الفاتورة", "اسم الصنف", "الوحدة", "الكمية", "سعر الوحدة", "نسبة الضريبة"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}

	// Sample row
	sample := []any{"شركة الأفق المتميزة", "INV-0001", "2026-09-18", "خدمات استشارية محاسبية", "ساعة", 10, 250.0, 15}
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
	var rawRows [][]string
	isCsv := strings.HasSuffix(strings.ToLower(filename), ".csv")
	if isCsv {
		csvReader := csv.NewReader(r)
		csvReader.FieldsPerRecord = -1
		var err error
		rawRows, err = csvReader.ReadAll()
		if err != nil {
			return nil, fmt.Errorf("خطأ في قراءة ملف CSV: %w", err)
		}
	} else {
		f, err := excelize.OpenReader(r)
		if err != nil {
			return nil, fmt.Errorf("خطأ في قراءة ملف Excel: %w", err)
		}
		defer f.Close()
		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			return nil, errors.New("الملف لا يحتوي على أي صفحات")
		}
		var errSheet error
		rawRows, errSheet = f.GetRows(sheets[0])
		if errSheet != nil {
			return nil, fmt.Errorf("تعذر قراءة بيانات الورقة: %w", errSheet)
		}
	}

	if len(rawRows) == 0 {
		return nil, errors.New("الملف فارغ")
	}

	codeSyn := []string{"كود", "رمز", "رقم الصنف", "كود الصنف", "code", "item_code", "sku"}
	nameSyn := []string{"اسم الصنف", "الصنف", "البيان", "اسم المنتج", "item", "name", "product", "description"}
	nameEnSyn := []string{"اسم انجليزي", "بالانجليزي", "name_en", "english"}
	catSyn := []string{"المجموعة", "التصنيف", "القسم", "category", "group"}
	barSyn := []string{"باركود", "بار كود", "barcode", "upc", "ean"}
	unitSyn := []string{"الوحدة", "وحدة القياس", "unit"}
	costSyn := []string{"سعر التكلفة", "التكلفة", "سعر الشراء", "شراء", "cost", "cost_price"}
	saleSyn := []string{"سعر البيع", "سعر", "السعر", "مبيع", "price", "sale_price"}
	taxSyn := []string{"الضريبة", "نسبة الضريبة", "vat", "tax", "tax_rate"}
	notesSyn := []string{"ملاحظات", "وصف", "notes", "remark"}

	matches := func(cell string, list []string) bool {
		c := strings.ToLower(strings.TrimSpace(cell))
		for _, s := range list {
			if strings.Contains(c, s) {
				return true
			}
		}
		return false
	}

	headerIdx := -1
	var cCode, cName, cNameEn, cCat, cBar, cUnit, cCost, cSale, cTax, cNotes int = -1, -1, -1, -1, -1, -1, -1, -1, -1, -1

	for rIdx, row := range rawRows {
		for cIdx, cell := range row {
			if matches(cell, nameSyn) && cName == -1 {
				cName = cIdx
			}
		}
		if cName != -1 {
			headerIdx = rIdx
			for cIdx, cell := range row {
				if cIdx == cName {
					continue
				}
				if matches(cell, nameEnSyn) && cNameEn == -1 {
					cNameEn = cIdx
				} else if matches(cell, codeSyn) && cCode == -1 {
					cCode = cIdx
				} else if matches(cell, catSyn) && cCat == -1 {
					cCat = cIdx
				} else if matches(cell, barSyn) && cBar == -1 {
					cBar = cIdx
				} else if matches(cell, unitSyn) && cUnit == -1 {
					cUnit = cIdx
				} else if matches(cell, costSyn) && cCost == -1 {
					cCost = cIdx
				} else if matches(cell, saleSyn) && cSale == -1 {
					cSale = cIdx
				} else if matches(cell, taxSyn) && cTax == -1 {
					cTax = cIdx
				} else if matches(cell, notesSyn) && cNotes == -1 {
					cNotes = cIdx
				}
			}
			break
		}
	}

	if headerIdx == -1 {
		return nil, errors.New("لم يتم العثور على عمود اسم الصنف في رأس الجدول")
	}

	res := &AnalyzeItemsResult{Rows: make([]ParsedItemRow, 0)}
	for i := headerIdx + 1; i < len(rawRows); i++ {
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
	var rawRows [][]string
	isCsv := strings.HasSuffix(strings.ToLower(filename), ".csv")
	if isCsv {
		csvReader := csv.NewReader(r)
		csvReader.FieldsPerRecord = -1
		var err error
		rawRows, err = csvReader.ReadAll()
		if err != nil {
			return nil, fmt.Errorf("خطأ في قراءة ملف CSV: %w", err)
		}
	} else {
		f, err := excelize.OpenReader(r)
		if err != nil {
			return nil, fmt.Errorf("خطأ في قراءة ملف Excel: %w", err)
		}
		defer f.Close()
		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			return nil, errors.New("الملف لا يحتوي على أي صفحات")
		}
		var errSheet error
		rawRows, errSheet = f.GetRows(sheets[0])
		if errSheet != nil {
			return nil, fmt.Errorf("تعذر قراءة بيانات الورقة: %w", errSheet)
		}
	}

	if len(rawRows) == 0 {
		return nil, errors.New("الملف فارغ")
	}

	codeSyn := []string{"كود", "رمز", "كود العميل", "رقم العميل", "code", "client_code"}
	nameSyn := []string{"اسم العميل", "العميل", "الزبون", "client", "name", "customer"}
	nameEnSyn := []string{"انجليزي", "بالانجليزي", "name_en", "english"}
	phoneSyn := []string{"جوال", "هاتف", "تلفون", "موبايل", "phone", "mobile"}
	emailSyn := []string{"بريد", "ايميل", "email"}
	taxSyn := []string{"الرقم الضريبي", "ضريبي", "tax_number", "vat"}
	crSyn := []string{"السجل التجاري", "سجل", "cr", "commercial_register"}
	citySyn := []string{"المدينة", "city"}
	streetSyn := []string{"الشارع", "العنوان", "الحي", "street", "address"}
	balSyn := []string{"الرصيد الافتتاحي", "رصيد", "opening_balance", "balance"}
	notesSyn := []string{"ملاحظات", "notes"}

	matches := func(cell string, list []string) bool {
		c := strings.ToLower(strings.TrimSpace(cell))
		for _, s := range list {
			if strings.Contains(c, s) {
				return true
			}
		}
		return false
	}

	headerIdx := -1
	var cCode, cName, cNameEn, cPhone, cEmail, cTax, cCR, cCity, cStreet, cBal, cNotes int = -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1

	for rIdx, row := range rawRows {
		for cIdx, cell := range row {
			if matches(cell, nameSyn) && cName == -1 {
				cName = cIdx
			}
		}
		if cName != -1 {
			headerIdx = rIdx
			for cIdx, cell := range row {
				if cIdx == cName {
					continue
				}
				if matches(cell, nameEnSyn) && cNameEn == -1 {
					cNameEn = cIdx
				} else if matches(cell, codeSyn) && cCode == -1 {
					cCode = cIdx
				} else if matches(cell, phoneSyn) && cPhone == -1 {
					cPhone = cIdx
				} else if matches(cell, emailSyn) && cEmail == -1 {
					cEmail = cIdx
				} else if matches(cell, taxSyn) && cTax == -1 {
					cTax = cIdx
				} else if matches(cell, crSyn) && cCR == -1 {
					cCR = cIdx
				} else if matches(cell, citySyn) && cCity == -1 {
					cCity = cIdx
				} else if matches(cell, streetSyn) && cStreet == -1 {
					cStreet = cIdx
				} else if matches(cell, balSyn) && cBal == -1 {
					cBal = cIdx
				} else if matches(cell, notesSyn) && cNotes == -1 {
					cNotes = cIdx
				}
			}
			break
		}
	}

	if headerIdx == -1 {
		return nil, errors.New("لم يتم العثور على عمود اسم العميل في رأس الجدول")
	}

	res := &AnalyzeClientsResult{Rows: make([]ParsedClientRow, 0)}
	for i := headerIdx + 1; i < len(rawRows); i++ {
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


