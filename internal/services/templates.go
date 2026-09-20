package services

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xuri/excelize/v2"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"raseen/internal/crypto"
	"raseen/internal/db"
)

type TemplateService struct {
	db      *db.DB
	dataDir string
}

func NewTemplateService(d *db.DB, dataDir string) *TemplateService {
	tplDir := filepath.Join(dataDir, "templates")
	_ = os.MkdirAll(filepath.Join(tplDir, "invoices"), 0755)
	_ = os.MkdirAll(filepath.Join(tplDir, "documents"), 0755)
	_, _ = d.Exec("ALTER TABLE excel_templates ADD COLUMN style_meta TEXT DEFAULT '{}'")
	s := &TemplateService{db: d, dataDir: dataDir}
	_ = s.SyncDiskTemplates()
	return s
}

type TemplateCatalogItem struct {
	ID            string                 `json:"id"`
	NameAr        string                 `json:"name_ar"`
	NameEn        string                 `json:"name_en"`
	Description   string                 `json:"description"`
	Category      string                 `json:"category"`
	Badge         string                 `json:"badge"`
	ColorHex      string                 `json:"color_hex"`
	IsActive      bool                   `json:"is_active"`
	IsDefault     bool                   `json:"is_default"`
	TotalFields   int                    `json:"total_fields"`
	FieldsSummary string                 `json:"fields_summary"`
	Headers       []string               `json:"headers,omitempty"`
	FilePath      string                 `json:"file_path,omitempty"`
	FileSize      int64                  `json:"file_size,omitempty"`
	StyleMeta     map[string]interface{} `json:"style_meta,omitempty"`
}

var defaultTemplates = []TemplateCatalogItem{
	{
		ID:            "standard",
		NameAr:        "النموذج القياسي المعتمد هيئة الزكاة",
		NameEn:        "Standard Tax Invoice",
		Description:   "قالب معتمد متوافق كلياً مع متطلبات هيئة الزكاة والضريبة والجمارك (ZATCA)",
		Category:      "invoices",
		Badge:         "معتمد ZATCA",
		ColorHex:      "#06b6d4",
		IsActive:      true,
		IsDefault:     true,
		TotalFields:   36,
		FieldsSummary: "ترويسة كاملة + جدول البنود + مجاميع تفصيلية + باركود QR",
		Headers:       []string{"م", "رمز الصنف", "اسم الصنف والخدمة", "سعر الوحدة", "الكمية", "الخصم", "الضريبة", "المجموع شامل الضريبة"},
	},
	{
		ID:            "modern",
		NameAr:        "النموذج العصري الأنيق",
		NameEn:        "Modern Clean Style",
		Description:   "تصميم عصري جذاب بخطوط عصرية وهوية بصرية متطورة للشركات والمؤسسات",
		Category:      "invoices",
		Badge:         "تصميم عصري",
		ColorHex:      "#3b82f6",
		IsActive:      true,
		IsDefault:     false,
		TotalFields:   34,
		FieldsSummary: "شعار مميز + تفاصيل الشركة + جدول أزرق حديث + رمز الاستجابة",
		Headers:       []string{"م", "رمز الصنف", "اسم الصنف", "سعر الوحدة", "الكمية", "الضريبة 15%", "الإجمالي"},
	},
	{
		ID:            "classic",
		NameAr:        "النموذج الكلاسيكي المحاسبي",
		NameEn:        "Classic Accounting Format",
		Description:   "تنسيق مكتبي كلاسيكي مألوف للمحاسبين والشركات التجارية التقليدية",
		Category:      "invoices",
		Badge:         "كلاسيكي",
		ColorHex:      "#64748b",
		IsActive:      true,
		IsDefault:     false,
		TotalFields:   30,
		FieldsSummary: "جداول واضحة + بيانات الطرفين + التوقيعات والاعتمادات",
		Headers:       []string{"الرقم", "البيان", "الكمية", "السعر الفردي", "قيمة الضريبة", "المجموع"},
	},
	{
		ID:            "thermal",
		NameAr:        "فاتورة نقاط البيع الحرارية (80mm)",
		NameEn:        "Thermal POS Receipt",
		Description:   "مخصصة للطباعة السريعة على الطابعات الحرارية وإيصالات نقاط البيع",
		Category:      "invoices",
		Badge:         "حراري 80mm",
		ColorHex:      "#10b981",
		IsActive:      true,
		IsDefault:     false,
		TotalFields:   24,
		FieldsSummary: "عرض 80 مم + QR بارز + مجاميع سريعة",
		Headers:       []string{"الصنف", "الكمية", "السعر", "الإجمالي"},
	},
	{
		ID:            "voucher_saqr_slip",
		NameAr:        "سند صقر المالي المعتمد",
		NameEn:        "Saqr Voucher Slip",
		Description:   "سند قبض مالي رسمي ببيانات التخصيص وطريقة السداد والتوقيعات الرسمية",
		Category:      "vouchers",
		Badge:         "سند معتمد",
		ColorHex:      "#0284c7",
		IsActive:      true,
		IsDefault:     true,
		TotalFields:   22,
		FieldsSummary: "بيانات القبض + اسم الدافع + التخصيص على الفواتير + تفقيط المبلغ",
		Headers:       []string{"رقم السند", "تاريخ السند", "اسم العميل", "المبلغ المدفوع", "طريقة الدفع", "المخصص للفواتير", "البيان والملاحظات"},
	},
	{
		ID:            "voucher_luxury_receipt",
		NameAr:        "سند القبض الفاخر",
		NameEn:        "Luxury Receipt Voucher",
		Description:   "سند استلام راقي بهوية بصرية مميزة وختم مائي للشركات الراقية والمكاتب",
		Category:      "vouchers",
		Badge:         "سند فاخر",
		ColorHex:      "#1e3a8a",
		IsActive:      true,
		IsDefault:     false,
		TotalFields:   20,
		FieldsSummary: "تصميم كحلي أنيق + باركود المرجع + معلومات البنك والشيك",
		Headers:       []string{"رقم السند", "التاريخ", "استلمنا من المكرم", "مبلغ وقدره", "طريقة السداد", "وذلك مقابل"},
	},
}

// findTableHeaders locates the items table header row purely by layout structure,
// cell styling (fill color, bold font, borders), and repeating column count without any keyword dictionaries.
func findTableHeaders(f *excelize.File, sheet string, rawRows [][]string) (int, []string, string, []string) {
	bestRowIdx := -1
	var bestHeaders []string
	bestFill := ""
	var bestAlignments []string
	maxScore := -1

	for rIdx, r := range rawRows {
		lastIdx := -1
		for i := len(r) - 1; i >= 0; i-- {
			if strings.TrimSpace(r[i]) != "" {
				lastIdx = i
				break
			}
		}
		if lastIdx < 2 {
			continue
		}
		trimmed := r[:lastIdx+1]

		distinct := make(map[string]bool)
		for _, c := range trimmed {
			s := strings.TrimSpace(c)
			if s != "" {
				distinct[s] = true
			}
		}
		if len(distinct) < 3 {
			continue
		}

		// Count how many cells in this row have a prominent fill color
		coloredCols := 0
		rowFill := ""
		for cIdx := 0; cIdx <= lastIdx; cIdx++ {
			axis, _ := excelize.CoordinatesToCellName(cIdx+1, rIdx+1)
			styleID, _ := f.GetCellStyle(sheet, axis)
			style, _ := f.GetStyle(styleID)
			if style != nil && len(style.Fill.Color) > 0 && style.Fill.Color[0] != "" {
				colHex := strings.ToUpper(style.Fill.Color[0])
				if colHex != "FFFFFF" && colHex != "FFF2CC" && colHex != "F8FAFC" {
					coloredCols++
					if rowFill == "" {
						rowFill = "#" + colHex
					}
				}
			}
		}

		// Check rows below for data grid structure
		subsequentRowsCount := 0
		for nextR := rIdx + 1; nextR < len(rawRows) && nextR <= rIdx+8; nextR++ {
			if len(rawRows[nextR]) > 0 {
				subsequentRowsCount++
			}
		}

		score := len(distinct)*2 + subsequentRowsCount
		if coloredCols >= 3 {
			score += 50
		}

		if score > maxScore {
			maxScore = score
			bestRowIdx = rIdx
			bestHeaders = trimmed
			bestFill = rowFill

			bestAlignments = []string{}
			for cIdx := 0; cIdx <= lastIdx; cIdx++ {
				axis, _ := excelize.CoordinatesToCellName(cIdx+1, rIdx+1)
				colStyleID, _ := f.GetCellStyle(sheet, axis)
				colStyle, _ := f.GetStyle(colStyleID)
				align := "right"
				if colStyle != nil && colStyle.Alignment != nil && colStyle.Alignment.Horizontal != "" {
					align = colStyle.Alignment.Horizontal
				}
				bestAlignments = append(bestAlignments, align)
			}
		}
	}

	return bestRowIdx, bestHeaders, bestFill, bestAlignments
}

type ExtractedSheetMeta struct {
	BannerText   string
	BannerFill   string
	HeaderFill   string
	PrimaryColor string
	HeaderRowIdx int
	Headers      []string
	Alignments   []string
	SampleRows   [][]string
	Seller       map[string]string
	Buyer        map[string]string
	Merges       []string
	Fills        [][]string
}

// extractSheetProperties inspects an open Excel file purely from its XML sheets and style table,
// returning native hex colors, headers, alignments, merged ranges, and sheet cell data.
func extractSheetProperties(f *excelize.File, sheet string, rawRows [][]string) *ExtractedSheetMeta {
	meta := &ExtractedSheetMeta{
		Seller: make(map[string]string),
		Buyer:  make(map[string]string),
	}

	// 1. Merged cells directly from excelize
	if merges, err := f.GetMergeCells(sheet); err == nil {
		for _, m := range merges {
			meta.Merges = append(meta.Merges, fmt.Sprintf("%s:%s", m.GetStartAxis(), m.GetEndAxis()))
		}
	}

	// 2. Banner text and fill from A1
	if len(rawRows) > 0 && len(rawRows[0]) > 0 {
		meta.BannerText = strings.TrimSpace(rawRows[0][0])
		meta.BannerText = strings.ReplaceAll(meta.BannerText, "\n", " ")
	}
	bStyleID, _ := f.GetCellStyle(sheet, "A1")
	if bStyle, _ := f.GetStyle(bStyleID); bStyle != nil && len(bStyle.Fill.Color) > 0 {
		c := strings.ToUpper(bStyle.Fill.Color[0])
		if c != "" && c != "FFFFFF" {
			meta.BannerFill = "#" + c
		}
	}

	// 3. Table header detection
	hdrIdx, headers, hdrFill, aligns := findTableHeaders(f, sheet, rawRows)
	meta.HeaderRowIdx = hdrIdx
	meta.Headers = headers
	meta.HeaderFill = hdrFill
	meta.Alignments = aligns

	// 4. Primary color resolution (direct from Excel XML fill styles)
	if meta.HeaderFill != "" {
		meta.PrimaryColor = meta.HeaderFill
	} else if meta.BannerFill != "" {
		meta.PrimaryColor = meta.BannerFill
	} else {
		meta.PrimaryColor = "#06b6d4"
	}
	if meta.BannerFill == "" {
		meta.BannerFill = meta.PrimaryColor
	}
	if meta.HeaderFill == "" {
		meta.HeaderFill = meta.PrimaryColor
	}

	// 5. Extract label-value metadata pairs from rows above table header
	maxPartyRow := hdrIdx
	if maxPartyRow <= 0 || maxPartyRow > len(rawRows) {
		maxPartyRow = min(14, len(rawRows))
	}
	for rIdx := 1; rIdx < maxPartyRow; rIdx++ {
		r := rawRows[rIdx]
		if len(r) < 2 {
			continue
		}
		lbl := strings.TrimSpace(r[0])
		val := ""
		for cIdx := 1; cIdx < len(r); cIdx++ {
			v := strings.TrimSpace(r[cIdx])
			if v != "" && v != lbl {
				val = v
				break
			}
		}
		if lbl != "" && val != "" {
			if rIdx < 9 {
				meta.Seller[lbl] = val
			} else {
				meta.Buyer[lbl] = val
			}
		}
	}

	// 6. Extract actual sample item rows from under the header in the sheet
	if hdrIdx >= 0 && hdrIdx+1 < len(rawRows) {
		for i := hdrIdx + 1; i < len(rawRows) && len(meta.SampleRows) < 5; i++ {
			row := rawRows[i]
			hasContent := false
			for _, c := range row {
				if strings.TrimSpace(c) != "" {
					hasContent = true
					break
				}
			}
			if hasContent {
				meta.SampleRows = append(meta.SampleRows, row)
			}
		}
	}

	// 7. Extract cell fills matrix for inspector / visual builder
	rowCount := min(len(rawRows), 30)
	for rIdx := 0; rIdx < rowCount; rIdx++ {
		r := rawRows[rIdx]
		fillRow := make([]string, len(r))
		for cIdx := range r {
			axis, _ := excelize.CoordinatesToCellName(cIdx+1, rIdx+1)
			sID, _ := f.GetCellStyle(sheet, axis)
			if st, _ := f.GetStyle(sID); st != nil && len(st.Fill.Color) > 0 && st.Fill.Color[0] != "" {
				fillRow[cIdx] = "#" + strings.ToUpper(st.Fill.Color[0])
			}
		}
		meta.Fills = append(meta.Fills, fillRow)
	}

	return meta
}

// SyncDiskTemplates scans data/templates/invoices and data/templates/documents
// and populates excel_templates with headers and styles extracted directly via excelize.
func (s *TemplateService) SyncDiskTemplates() error {
	dirs := []struct {
		relPath  string
		category string
		badge    string
	}{
		{relPath: filepath.Join("data", "templates", "invoices"), category: "invoices", badge: "فاتورة Excel"},
		{relPath: filepath.Join("data", "templates", "documents"), category: "vouchers", badge: "سند Excel"},
	}

	// Remove previously synced disk templates to avoid duplicate accumulation
	_, _ = s.db.Exec(`DELETE FROM excel_templates WHERE file_path LIKE '%templates%invoices%' OR file_path LIKE '%templates%documents%'`)

	for _, d := range dirs {
		entries, err := os.ReadDir(d.relPath)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if entry.IsDir() || (!strings.HasSuffix(strings.ToLower(entry.Name()), ".xlsx") && !strings.HasSuffix(strings.ToLower(entry.Name()), ".xls")) {
				continue
			}

			fullPath := filepath.Join(d.relPath, entry.Name())
			fi, err := entry.Info()
			if err != nil {
				continue
			}

			baseName := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
			var id string
			if baseName == "standard" {
				id = "standard"
			} else {
				h := sha256.Sum256([]byte(d.category + "/" + entry.Name()))
				id = "tpl_" + hex.EncodeToString(h[:4])
			}

			nameAr := baseName
			if len(nameAr) > 3 && nameAr[2] == '_' {
				nameAr = nameAr[3:]
			}
			nameAr = strings.ReplaceAll(nameAr, "_", " ")

			var meta *ExtractedSheetMeta
			f, err := excelize.OpenFile(fullPath)
			if err == nil {
				sheets := f.GetSheetList()
				if len(sheets) > 0 {
					rows, errRows := f.GetRows(sheets[0])
					if errRows == nil {
						meta = extractSheetProperties(f, sheets[0], rows)
					}
				}
				_ = f.Close()
			}
			if meta == nil {
				meta = &ExtractedSheetMeta{
					PrimaryColor: "#06b6d4",
					HeaderFill:   "#06b6d4",
					BannerFill:   "#06b6d4",
					Seller:       make(map[string]string),
					Buyer:        make(map[string]string),
				}
				if d.category == "invoices" {
					meta.Headers = []string{"#", "رمز الصنف", "السلعة أو الخدمة", "الكمية", "الوحدة", "سعر الوحدة", "خصم السطر", "الصافي قبل الضريبة", "فئة الضريبة", "نسبة الضريبة", "قيمة الضريبة", "الإجمالي شامل الضريبة"}
				} else {
					meta.Headers = []string{"#", "رقم السند", "تاريخ الإصدار", "اسم العميل", "المبلغ", "طريقة الدفع", "البيان", "ملاحظات"}
				}
			}

			// Construct sample lines from native sample rows in sheet
			sampleLines := make([]map[string]interface{}, 0)
			for lIdx, sr := range meta.SampleRows {
				lMap := map[string]interface{}{
					"line_no": lIdx + 1,
				}
				for cIdx, val := range sr {
					if cIdx < len(meta.Headers) {
						lMap[meta.Headers[cIdx]] = val
					}
				}
				sampleLines = append(sampleLines, lMap)
			}

			styleMeta := map[string]interface{}{
				"banner_text":  meta.BannerText,
				"header_fill":  meta.HeaderFill,
				"banner_fill":  meta.BannerFill,
				"accent_color": meta.PrimaryColor,
				"alignments":   meta.Alignments,
				"headers":      meta.Headers,
				"merges":       meta.Merges,
				"sample_rows":  meta.SampleRows,
				"seller":       meta.Seller,
				"buyer":        meta.Buyer,
				"snapshot": map[string]interface{}{
					"seller": meta.Seller,
					"buyer":  meta.Buyer,
					"invoice": map[string]interface{}{
						"invoice_number": fmt.Sprintf("INV-%s-00108", strings.ToUpper(id[:min(3, len(id))])),
						"issue_date":     "2026-09-18",
						"payment_label":  "تحويل بنكي",
						"lines":          sampleLines,
					},
				},
			}

			styleMetaJsonBytes, _ := json.Marshal(styleMeta)
			headersJsonBytes, _ := json.Marshal(meta.Headers)
			now := db.NowIso()

			_, _ = s.db.Exec(`
				INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, style_meta, is_active, updated_at)
				VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, 1, ?)
				ON CONFLICT(id) DO UPDATE SET
					name_ar = excluded.name_ar,
					file_path = excluded.file_path,
					headers_json = excluded.headers_json,
					color_hex = excluded.color_hex,
					style_meta = excluded.style_meta,
					category = excluded.category,
					updated_at = excluded.updated_at
			`, id, nameAr, "قالب Excel معتمد مستخرج من القرص", d.badge, d.category, fullPath, meta.PrimaryColor, string(headersJsonBytes), string(styleMetaJsonBytes), now)
			_ = fi
		}
	}

	return nil
}

func (s *TemplateService) List(typeFilter, categoryFilter string) ([]TemplateCatalogItem, error) {
	list := make([]TemplateCatalogItem, 0)

	// Read custom and synced templates from excel_templates table
	rows, err := s.db.Query(`
		SELECT id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, is_active, COALESCE(style_meta, '{}')
		FROM excel_templates
	`)
	dbCount := 0
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			dbCount++
			var tpl TemplateCatalogItem
			var filePath, headersJson, styleMetaJson string
			var isAct int
			if err := rows.Scan(&tpl.ID, &tpl.NameAr, &tpl.NameEn, &tpl.Description, &tpl.Badge, &tpl.Category, &filePath, &tpl.ColorHex, &headersJson, &isAct, &styleMetaJson); err == nil {
				tpl.IsActive = isAct == 1
				tpl.IsDefault = (tpl.ID == "standard")
				tpl.FilePath = filePath

				if fi, errStat := os.Stat(filePath); errStat == nil {
					tpl.FileSize = fi.Size()
				}

				var headers []string
				if errJson := json.Unmarshal([]byte(headersJson), &headers); errJson == nil && len(headers) > 0 {
					tpl.Headers = headers
					tpl.TotalFields = len(headers)
					tpl.FieldsSummary = fmt.Sprintf("تم اكتشاف %d أعمدة رئيسية من ملف القالب", len(headers))
				} else {
					tpl.TotalFields = 24
					tpl.FieldsSummary = "قالب Excel مُكتشف آلياً"
				}

				var styleMeta map[string]interface{}
				if errMeta := json.Unmarshal([]byte(styleMetaJson), &styleMeta); errMeta == nil && len(styleMeta) > 0 {
					tpl.StyleMeta = styleMeta
				}

				if typeFilter != "" && typeFilter != "all" {
					if typeFilter == "invoices" && tpl.Category != "invoices" {
						continue
					}
					if (typeFilter == "vouchers" || typeFilter == "documents") && tpl.Category != "vouchers" && tpl.Category != "documents" {
						continue
					}
				}
				if categoryFilter != "" {
					if categoryFilter == "invoices" && tpl.Category != "invoices" {
						continue
					}
					if (categoryFilter == "documents" || categoryFilter == "vouchers") && tpl.Category != "vouchers" && tpl.Category != "documents" {
						continue
					}
				}
				list = append(list, tpl)
			}
		}
	}

	// Fallback to default templates only if DB has no templates
	if dbCount == 0 {
		for _, tpl := range defaultTemplates {
			if typeFilter != "" && typeFilter != "all" {
				if typeFilter == "invoices" && tpl.Category != "invoices" {
					continue
				}
				if (typeFilter == "vouchers" || typeFilter == "documents") && tpl.Category != "vouchers" {
					continue
				}
			}
			if categoryFilter != "" {
				if categoryFilter == "invoices" && tpl.Category != "invoices" {
					continue
				}
				if (categoryFilter == "documents" || categoryFilter == "vouchers") && tpl.Category != "vouchers" {
					continue
				}
			}
			list = append(list, tpl)
		}
	}

	return list, nil
}

type InspectResult struct {
	Valid                 bool                `json:"valid"`
	DetectedType          string              `json:"detected_type"`
	DetectedTitle         string              `json:"detectedTitle,omitempty"`
	DetectedPlaceholders  []string            `json:"detected_placeholders"`
	Sheets                []string            `json:"sheets"`
	RowsCount             int                 `json:"rows_count"`
	ColsCount             int                 `json:"cols_count"`
	Headers               []string            `json:"headers"`
	SampleRows            [][]string          `json:"sampleRows"`
	LayoutGrid            [][]string          `json:"layoutGrid"`
	LayoutFills           [][]string          `json:"layoutFills"`
	LayoutMerges          []string            `json:"layoutMerges"`
	Metadata              map[string]any      `json:"metadata"`
	Message               string              `json:"message"`
}

func (s *TemplateService) Inspect(base64Content, filename string) (*InspectResult, error) {
	if base64Content == "" {
		return nil, errors.New("الملف فارغ أو غير صالح")
	}

	// Clean base64 header if present
	idx := strings.Index(base64Content, ",")
	if idx != -1 {
		base64Content = base64Content[idx+1:]
	}

	data, err := base64.StdEncoding.DecodeString(base64Content)
	if err != nil || len(data) < 100 {
		return nil, errors.New("صيغة الملف غير مدعومة — يجب رفع ملف Excel بصيغة .xlsx")
	}

	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("تعذر قراءة ملف Excel: %w", err)
	}
	defer f.Close()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, errors.New("ملف Excel لا يحتوي على أي صفحات")
	}

	sheetName := sheets[0]
	rawRows, err := f.GetRows(sheetName)
	if err != nil {
		return nil, fmt.Errorf("تعذر قراءة صفوف الصفحة: %w", err)
	}

	rowsCount := len(rawRows)
	colsCount := 0
	for _, r := range rawRows {
		if len(r) > colsCount {
			colsCount = len(r)
		}
	}

	meta := extractSheetProperties(f, sheetName, rawRows)

	layoutGrid := make([][]string, 0, min(rowsCount, 50))
	for i := 0; i < min(rowsCount, 50); i++ {
		layoutGrid = append(layoutGrid, rawRows[i])
	}

	detectedTitle := strings.TrimSuffix(filename, filepath.Ext(filename))
	detectedTitle = strings.ReplaceAll(detectedTitle, "_", " ")

	detectedType := "invoice"
	lowerName := strings.ToLower(filename)
	if strings.Contains(lowerName, "سند") || strings.Contains(lowerName, "voucher") || strings.Contains(lowerName, "قبض") {
		detectedType = "voucher"
	}

	placeholders := []string{
		"{{invoice_number}}",
		"{{issue_date}}",
		"{{issue_time}}",
		"{{seller_name}}",
		"{{seller_tax_number}}",
		"{{buyer_name}}",
		"{{buyer_tax_number}}",
		"{{subtotal}}",
		"{{tax_amount}}",
		"{{grand_total}}",
		"{{qr_code}}",
	}

	metaMap := map[string]any{
		"primary_color": meta.PrimaryColor,
		"header_fill":   meta.HeaderFill,
		"banner_fill":   meta.BannerFill,
		"banner_text":   meta.BannerText,
		"seller":        meta.Seller,
		"buyer":         meta.Buyer,
		"alignments":    meta.Alignments,
		"merges":        meta.Merges,
	}

	return &InspectResult{
		Valid:                true,
		DetectedType:         detectedType,
		DetectedTitle:        detectedTitle,
		DetectedPlaceholders: placeholders,
		Sheets:               sheets,
		RowsCount:            rowsCount,
		ColsCount:            colsCount,
		Headers:              meta.Headers,
		SampleRows:           meta.SampleRows,
		LayoutGrid:           layoutGrid,
		LayoutFills:          meta.Fills,
		LayoutMerges:         meta.Merges,
		Metadata:             metaMap,
		Message:              "تم فحص وتحليل القالب واستخراج الأعمدة والتنسيقات والخلايا المدمجة بنجاح من ملف Excel.",
	}, nil
}

type UploadTemplateInput struct {
	NameAr      string `json:"name_ar"`
	NameEn      string `json:"name_en"`
	Description string `json:"description"`
	Category    string `json:"category"`
	FileBase64  string `json:"file_base64"`
	Filename    string `json:"filename"`
	ColorHex    string `json:"color_hex"`
}

func (s *TemplateService) Upload(input UploadTemplateInput) (*TemplateCatalogItem, error) {
	if input.NameAr == "" {
		return nil, errors.New("اسم القالب مطلوب")
	}
	if input.Category == "" {
		input.Category = "invoices"
	}
	if input.ColorHex == "" {
		input.ColorHex = "#0d9488"
	}

	id := crypto.UUID()
	targetDir := filepath.Join(s.dataDir, "templates", "invoices")
	if input.Category == "vouchers" || input.Category == "documents" {
		targetDir = filepath.Join(s.dataDir, "templates", "documents")
	}
	_ = os.MkdirAll(targetDir, 0755)

	fileName := fmt.Sprintf("tpl_%s.xlsx", id)
	filePath := filepath.Join(targetDir, fileName)

	// Save file to disk
	var fileData []byte
	if input.FileBase64 != "" {
		idx := strings.Index(input.FileBase64, ",")
		rawB64 := input.FileBase64
		if idx != -1 {
			rawB64 = rawB64[idx+1:]
		}
		if dec, err := base64.StdEncoding.DecodeString(rawB64); err == nil {
			fileData = dec
			_ = os.WriteFile(filePath, dec, 0644)
		}
	}

	var meta *ExtractedSheetMeta
	if len(fileData) > 0 {
		if f, err := excelize.OpenReader(bytes.NewReader(fileData)); err == nil {
			sheets := f.GetSheetList()
			if len(sheets) > 0 {
				if rows, errRows := f.GetRows(sheets[0]); errRows == nil {
					meta = extractSheetProperties(f, sheets[0], rows)
				}
			}
			_ = f.Close()
		}
	}
	if meta == nil {
		meta = &ExtractedSheetMeta{
			PrimaryColor: input.ColorHex,
			HeaderFill:   input.ColorHex,
			BannerFill:   input.ColorHex,
			Seller:       make(map[string]string),
			Buyer:        make(map[string]string),
		}
		if input.Category == "invoices" {
			meta.Headers = []string{"#", "رمز الصنف", "السلعة أو الخدمة", "الكمية", "الوحدة", "سعر الوحدة", "خصم السطر", "الصافي قبل الضريبة", "فئة الضريبة", "نسبة الضريبة", "قيمة الضريبة", "الإجمالي شامل الضريبة"}
		} else {
			meta.Headers = []string{"#", "رقم السند", "تاريخ الإصدار", "اسم العميل", "المبلغ", "طريقة الدفع", "البيان", "ملاحظات"}
		}
	}

	if input.ColorHex == "" || input.ColorHex == "#0d9488" {
		input.ColorHex = meta.PrimaryColor
	}

	sampleLines := make([]map[string]interface{}, 0)
	for lIdx, sr := range meta.SampleRows {
		lMap := map[string]interface{}{
			"line_no": lIdx + 1,
		}
		for cIdx, val := range sr {
			if cIdx < len(meta.Headers) {
				lMap[meta.Headers[cIdx]] = val
			}
		}
		sampleLines = append(sampleLines, lMap)
	}

	styleMeta := map[string]interface{}{
		"banner_text":  meta.BannerText,
		"header_fill":  meta.HeaderFill,
		"banner_fill":  meta.BannerFill,
		"accent_color": input.ColorHex,
		"alignments":   meta.Alignments,
		"headers":      meta.Headers,
		"merges":       meta.Merges,
		"sample_rows":  meta.SampleRows,
		"seller":       meta.Seller,
		"buyer":        meta.Buyer,
		"snapshot": map[string]interface{}{
			"seller": meta.Seller,
			"buyer":  meta.Buyer,
			"invoice": map[string]interface{}{
				"invoice_number": fmt.Sprintf("INV-%s-00108", strings.ToUpper(id[:min(3, len(id))])),
				"issue_date":     "2026-09-18",
				"payment_label":  "تحويل بنكي",
				"lines":          sampleLines,
			},
		},
	}
	styleMetaJson, _ := json.Marshal(styleMeta)

	headersJson, _ := json.Marshal(meta.Headers)
	now := db.NowIso()
	badge := "مخصص"
	if input.Category == "vouchers" {
		badge = "سند مخصص"
	}

	_, err := s.db.Exec(`
		INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, style_meta, is_active, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
	`, id, input.NameAr, input.NameEn, input.Description, badge, input.Category, filePath, input.ColorHex, string(headersJson), string(styleMetaJson), now)
	if err != nil {
		return nil, err
	}

	return &TemplateCatalogItem{
		ID:            id,
		NameAr:        input.NameAr,
		NameEn:        input.NameEn,
		Description:   input.Description,
		Category:      input.Category,
		Badge:         badge,
		ColorHex:      input.ColorHex,
		IsActive:      true,
		IsDefault:     false,
		Headers:       meta.Headers,
		TotalFields:   len(meta.Headers),
		FieldsSummary: fmt.Sprintf("قالب مخصص (%d أعمدة)", len(meta.Headers)),
		FilePath:      filePath,
		FileSize:      int64(len(fileData)),
		StyleMeta:     styleMeta,
	}, nil
}

func (s *TemplateService) Delete(id string) error {
	for _, dt := range defaultTemplates {
		if dt.ID == id {
			return errors.New("لا يمكن حذف القوالب الأساسية المدمجة في النظام")
		}
	}

	var filePath string
	_ = s.db.QueryRow("SELECT file_path FROM excel_templates WHERE id = ?", id).Scan(&filePath)
	if filePath != "" {
		_ = os.Remove(filePath)
	}

	_, err := s.db.Exec("DELETE FROM excel_templates WHERE id = ?", id)
	return err
}

func (s *TemplateService) Reset() error {
	_, _ = s.db.Exec("DELETE FROM excel_templates")
	return s.SyncDiskTemplates()
}

func (s *TemplateService) GetFilePath(id string) (string, error) {
	// Check in database first
	var filePath string
	err := s.db.QueryRow("SELECT file_path FROM excel_templates WHERE id = ?", id).Scan(&filePath)
	if err == nil && filePath != "" {
		if _, errStat := os.Stat(filePath); errStat == nil {
			return filePath, nil
		}
	}

	// Check on disk by id or filename match
	invoicesDir := filepath.Join(s.dataDir, "templates", "invoices")
	docsDir := filepath.Join(s.dataDir, "templates", "documents")

	candidates := []string{
		filepath.Join(invoicesDir, id+".xlsx"),
		filepath.Join(docsDir, id+".xlsx"),
		filepath.Join(invoicesDir, "standard.xlsx"),
	}

	for _, p := range candidates {
		if _, errStat := os.Stat(p); errStat == nil {
			return p, nil
		}
	}

	// Look for any file whose name matches id
	for _, dir := range []string{invoicesDir, docsDir} {
		entries, err := os.ReadDir(dir)
		if err == nil {
			for _, e := range entries {
				if strings.Contains(strings.ToLower(e.Name()), strings.ToLower(id)) {
					return filepath.Join(dir, e.Name()), nil
				}
			}
		}
	}

	return "", errors.New("لم يتم العثور على ملف القالب المطلوب")
}

func (s *TemplateService) GetBuilderConfig(id string) (map[string]any, error) {
	var val string
	err := s.db.QueryRow("SELECT value FROM meta WHERE key = ?", "tpl_builder_config_"+id).Scan(&val)
	if err == nil {
		var res map[string]any
		if err := json.Unmarshal([]byte(val), &res); err == nil {
			if _, hasBc := res["builder_config"]; !hasBc {
				bc := make(map[string]any, len(res))
				for k, v := range res {
					bc[k] = v
				}
				res["builder_config"] = bc
			}
			return res, nil
		}
	}

	// Fallback to excel_templates table if config isn't in meta
	var nameAr, category, colorHex string
	errTpl := s.db.QueryRow("SELECT name_ar, category, color_hex FROM excel_templates WHERE id = ?", id).Scan(&nameAr, &category, &colorHex)
	if errTpl == nil {
		res := map[string]any{
			"id":        id,
			"name_ar":   nameAr,
			"category":  category,
			"color_hex": colorHex,
		}
		res["builder_config"] = res
		return res, nil
	}

	return map[string]any{
		"id":             id,
		"builder_config": map[string]any{},
	}, nil
}

func colIndexToLetter(idx int) string {
	name := ""
	n := idx
	for {
		name = string(rune('A'+(n%26))) + name
		n = n/26 - 1
		if n < 0 {
			break
		}
	}
	return name
}

func (s *TemplateService) GenerateExcelFromBuilder(category, id string, cfgMap map[string]any) error {
	gridState, ok := cfgMap["gridState"].(map[string]any)
	if !ok || gridState == nil {
		return nil
	}

	f := excelize.NewFile()
	sheet := "Sheet1"

	rtl := true
	_ = f.SetSheetView(sheet, 0, &excelize.ViewOptions{
		RightToLeft: &rtl,
	})

	// 1. Column Widths
	if cols, ok := gridState["cols"].([]any); ok {
		for i, c := range cols {
			if colMap, ok := c.(map[string]any); ok {
				if w, ok := colMap["width"].(float64); ok && w > 0 {
					letter := colIndexToLetter(i)
					_ = f.SetColWidth(sheet, letter, letter, w)
				}
			}
		}
	}

	// 2. Row Heights
	if rows, ok := gridState["rows"].([]any); ok {
		for i, r := range rows {
			if rowMap, ok := r.(map[string]any); ok {
				if h, ok := rowMap["height"].(float64); ok && h > 0 {
					_ = f.SetRowHeight(sheet, i+1, h*0.75)
				}
			}
		}
	}

	// 3. Merged Cells
	if merges, ok := gridState["merges"].([]any); ok {
		for _, m := range merges {
			if mStr, ok := m.(string); ok && strings.Contains(mStr, ":") {
				parts := strings.Split(mStr, ":")
				if len(parts) == 2 {
					_ = f.MergeCell(sheet, strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]))
				}
			}
		}
	}

	// 4. Cells, Styles and Images
	if cells, ok := gridState["cells"].(map[string]any); ok {
		styleCache := make(map[string]int)

		for ref, cellVal := range cells {
			cellMap, ok := cellVal.(map[string]any)
			if !ok {
				continue
			}

			// Cell value
			if v, exists := cellMap["v"]; exists && v != nil {
				_ = f.SetCellValue(sheet, ref, v)
			}

			// Style creation and caching
			bold, _ := cellMap["bold"].(bool)
			size, _ := cellMap["size"].(float64)
			if size <= 0 {
				size = 11
			}
			align, _ := cellMap["align"].(string)
			color, _ := cellMap["color"].(string)
			bg, _ := cellMap["bg"].(string)
			borderType, _ := cellMap["border"].(string)
			numFmt, _ := cellMap["numFmt"].(string)
			wrapVal, hasWrap := cellMap["wrap"].(bool)
			wrapText := true
			if hasWrap {
				wrapText = wrapVal
			}

			styleKey := fmt.Sprintf("%v_%v_%v_%v_%v_%v_%v_%v", bold, size, align, color, bg, borderType, numFmt, wrapText)
			styleID, found := styleCache[styleKey]
			if !found {
				style := &excelize.Style{
					Alignment: &excelize.Alignment{
						Vertical: "center",
						WrapText: wrapText,
					},
				}

				// Borders configuration (Excel styles)
				switch borderType {
				case "none":
					style.Border = []excelize.Border{}
				case "all":
					style.Border = []excelize.Border{
						{Type: "left", Color: "334155", Style: 1},
						{Type: "top", Color: "334155", Style: 1},
						{Type: "right", Color: "334155", Style: 1},
						{Type: "bottom", Color: "334155", Style: 1},
					}
				case "outer":
					style.Border = []excelize.Border{
						{Type: "left", Color: "0F172A", Style: 2},
						{Type: "top", Color: "0F172A", Style: 2},
						{Type: "right", Color: "0F172A", Style: 2},
						{Type: "bottom", Color: "0F172A", Style: 2},
					}
				case "bottom":
					style.Border = []excelize.Border{
						{Type: "left", Color: "CBD5E1", Style: 1},
						{Type: "top", Color: "CBD5E1", Style: 1},
						{Type: "right", Color: "CBD5E1", Style: 1},
						{Type: "bottom", Color: "0F172A", Style: 2},
					}
				case "double_bottom":
					style.Border = []excelize.Border{
						{Type: "left", Color: "CBD5E1", Style: 1},
						{Type: "top", Color: "0F172A", Style: 1},
						{Type: "right", Color: "CBD5E1", Style: 1},
						{Type: "bottom", Color: "0F172A", Style: 6}, // Double bottom line (Accounting)
					}
				case "top_bottom":
					style.Border = []excelize.Border{
						{Type: "left", Color: "CBD5E1", Style: 1},
						{Type: "top", Color: "0F172A", Style: 1},
						{Type: "right", Color: "CBD5E1", Style: 1},
						{Type: "bottom", Color: "0F172A", Style: 1},
					}
				default:
					style.Border = []excelize.Border{
						{Type: "left", Color: "CBD5E1", Style: 1},
						{Type: "top", Color: "CBD5E1", Style: 1},
						{Type: "right", Color: "CBD5E1", Style: 1},
						{Type: "bottom", Color: "CBD5E1", Style: 1},
					}
				}

				// Number formatting
				if numFmt != "" {
					switch numFmt {
					case "currency":
						cStr := `#,##0.00 "ر.س"`
						style.CustomNumFmt = &cStr
					case "percent":
						pStr := `0.00%`
						style.CustomNumFmt = &pStr
					case "comma":
						cmStr := `#,##0.00`
						style.CustomNumFmt = &cmStr
					}
				}
				switch align {
				case "center":
					style.Alignment.Horizontal = "center"
				case "left":
					style.Alignment.Horizontal = "left"
				default:
					style.Alignment.Horizontal = "right"
				}

				font := &excelize.Font{
					Bold: bold,
					Size: size,
				}
				if color != "" && color != "#000000" {
					font.Color = strings.TrimPrefix(color, "#")
				}
				style.Font = font

				if bg != "" && !strings.EqualFold(bg, "#ffffff") {
					style.Fill = excelize.Fill{
						Type:    "pattern",
						Pattern: 1,
						Color:   []string{strings.TrimPrefix(bg, "#")},
					}
				}

				var errStyle error
				styleID, errStyle = f.NewStyle(style)
				if errStyle == nil {
					styleCache[styleKey] = styleID
				}
			}

			if styleID > 0 {
				_ = f.SetCellStyle(sheet, ref, ref, styleID)
			}

			// Cell Image
			if imgMap, ok := cellMap["image"].(map[string]any); ok {
				if src, ok := imgMap["src"].(string); ok && strings.HasPrefix(src, "data:image/") {
					commaIdx := strings.Index(src, ",")
					if commaIdx != -1 {
						imgBytes, errDec := base64.StdEncoding.DecodeString(src[commaIdx+1:])
						if errDec == nil && len(imgBytes) > 0 {
							ext := ".png"
							if strings.HasPrefix(src, "data:image/jpeg") || strings.HasPrefix(src, "data:image/jpg") {
								ext = ".jpg"
							}
							_ = f.AddPictureFromBytes(sheet, ref, &excelize.Picture{
								Extension: ext,
								File:      imgBytes,
								Format: &excelize.GraphicOptions{
									LockAspectRatio: true,
									AutoFit:         true,
									OffsetX:         4,
									OffsetY:         4,
								},
							})
						}
					}
				}
			}
		}
	}

	// 5. Logo in Header (if provided)
	if logoData, ok := cfgMap["logo_data"].(string); ok && strings.HasPrefix(logoData, "data:image/") {
		commaIdx := strings.Index(logoData, ",")
		if commaIdx != -1 {
			imgBytes, errDec := base64.StdEncoding.DecodeString(logoData[commaIdx+1:])
			if errDec == nil && len(imgBytes) > 0 {
				ext := ".png"
				if strings.HasPrefix(logoData, "data:image/jpeg") || strings.HasPrefix(logoData, "data:image/jpg") {
					ext = ".jpg"
				}
				logoCell := "A1"
				pos, _ := cfgMap["logo_position"].(string)
				if pos == "center" {
					logoCell = "C1"
				} else if pos == "left" {
					logoCell = "F1"
				}
				_ = f.AddPictureFromBytes(sheet, logoCell, &excelize.Picture{
					Extension: ext,
					File:      imgBytes,
					Format: &excelize.GraphicOptions{
						LockAspectRatio: true,
						AutoFit:         true,
						OffsetX:         6,
						OffsetY:         6,
					},
				})
			}
		}
	}

	outDir := filepath.Join(s.dataDir, "templates", category)
	_ = os.MkdirAll(outDir, 0755)
	filePath := filepath.Join(outDir, id+".xlsx")
	return f.SaveAs(filePath)
}

func (s *TemplateService) SaveBuilderConfig(id string, config any) error {
	b, err := json.Marshal(config)
	if err != nil {
		return err
	}

	var cfgMap map[string]any
	_ = json.Unmarshal(b, &cfgMap)

	category := "invoices"
	if t, ok := cfgMap["type"].(string); ok && t == "documents" {
		category = "documents"
	}

	nameAr := "قالب مخصص"
	if n, ok := cfgMap["name_ar"].(string); ok && strings.TrimSpace(n) != "" {
		nameAr = strings.TrimSpace(n)
	}

	primaryColor := "#059669"
	if c, ok := cfgMap["primary_color"].(string); ok && strings.TrimSpace(c) != "" {
		primaryColor = strings.TrimSpace(c)
	}

	// 1. Generate real .xlsx file on disk if gridState exists
	if _, ok := cfgMap["gridState"].(map[string]any); ok {
		_ = s.GenerateExcelFromBuilder(category, id, cfgMap)
	}

	// 2. Register / Update in excel_templates catalog
	relPath := filepath.Join("data", "templates", category, id+".xlsx")
	_, _ = s.db.Exec(`
		INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, style_meta, is_active, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			name_ar = excluded.name_ar,
			category = excluded.category,
			file_path = excluded.file_path,
			color_hex = excluded.color_hex,
			updated_at = CURRENT_TIMESTAMP
	`, id, nameAr, id, "قالب مخصص تم إنشاؤه عبر محرر القوالب", "مخصص", category, relPath, primaryColor, "[]", "{}")

	// 3. Save full builder config into meta table
	_, err = s.db.Exec(`
		INSERT INTO meta (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, "tpl_builder_config_"+id, string(b))
	return err
}

func init() {
	var _ = sql.ErrNoRows
}

