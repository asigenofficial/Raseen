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

