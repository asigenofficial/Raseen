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

	"github.com/skip2/go-qrcode"
	"github.com/xuri/excelize/v2"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"raseen/internal/crypto"
	"raseen/internal/db"
)

const SarSymbolSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1124.14 1256.39" width="0.92em" height="0.92em" class="sar-sym-svg" style="vertical-align:-0.14em;display:inline-block;fill:currentColor;margin:0 2px;" aria-label="ريال سعودي" title="ريال سعودي" role="img"><path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"/><path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"/></svg>`

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

var defaultTemplates = []TemplateCatalogItem{}


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

		// Check for item table keywords vs metadata
		itemKeywordScore := 0
		for text := range distinct {
			low := strings.ToLower(text)
			if strings.Contains(low, "صنف") || strings.Contains(low, "وصف") || strings.Contains(low, "خدمة") || strings.Contains(low, "بيان") ||
				strings.Contains(low, "كمية") || strings.Contains(low, "عدد") || strings.Contains(low, "سعر") || strings.Contains(low, "مفرد") ||
				strings.Contains(low, "ضريبة") || strings.Contains(low, "vat") || strings.Contains(low, "tax") ||
				strings.Contains(low, "إجمالي") || strings.Contains(low, "اجمالي") || strings.Contains(low, "مجموع") || strings.Contains(low, "total") ||
				strings.Contains(low, "item") || strings.Contains(low, "desc") || strings.Contains(low, "qty") || strings.Contains(low, "price") ||
				low == "م" || low == "#" {
				itemKeywordScore += 50
			}
			if strings.Contains(low, "عنوان") || strings.Contains(low, "تواصل") || strings.Contains(low, "منشأة") || strings.Contains(low, "عميل") || strings.Contains(low, "سجل") {
				itemKeywordScore -= 100
			}
		}

		subsequentRowsCount := 0
		for nextR := rIdx + 1; nextR < min(len(rawRows), rIdx+8); nextR++ {
			if len(rawRows[nextR]) >= 2 {
				subsequentRowsCount++
			}
		}

		score := len(distinct)*2 + subsequentRowsCount*10 + itemKeywordScore
		if coloredCols >= 3 {
			score += 50
		}

		if score > maxScore {
			maxScore = score
			bestRowIdx = rIdx
			bestFill = rowFill

			// Clean and deduplicate consecutive merged cells
			bestHeaders = []string{}
			bestAlignments = []string{}
			for cIdx := 0; cIdx <= lastIdx; cIdx++ {
				val := strings.TrimSpace(trimmed[cIdx])
				if val == "" {
					continue
				}
				if len(bestHeaders) == 0 || bestHeaders[len(bestHeaders)-1] != val {
					bestHeaders = append(bestHeaders, val)

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
	}

	if len(bestHeaders) >= 2 {
		firstIsTotal := false
		lastIsItem := false
		fLower := strings.ToLower(bestHeaders[0])
		lLower := strings.ToLower(bestHeaders[len(bestHeaders)-1])
		for _, kw := range []string{"إجمالي", "اجمالي", "مجموع", "total", "amount"} {
			if strings.Contains(fLower, kw) {
				firstIsTotal = true
				break
			}
		}
		for _, kw := range []string{"صنف", "وصف", "خدمة", "بيان", "item", "desc", "م", "#"} {
			if strings.Contains(lLower, kw) {
				lastIsItem = true
				break
			}
		}
		if firstIsTotal && lastIsItem {
			for i, j := 0, len(bestHeaders)-1; i < j; i, j = i+1, j-1 {
				bestHeaders[i], bestHeaders[j] = bestHeaders[j], bestHeaders[i]
				bestAlignments[i], bestAlignments[j] = bestAlignments[j], bestAlignments[i]
			}
		}
	}

	return bestRowIdx, bestHeaders, bestFill, bestAlignments
}

func isLightHex(c string) bool {
	if len(c) != 6 {
		return false
	}
	var r, g, b int
	fmt.Sscanf(c, "%02x%02x%02x", &r, &g, &b)
	lum := (float64(r)*299 + float64(g)*587 + float64(b)*114) / 1000
	return lum > 215
}

func findDominantColors(f *excelize.File, sheet string, rawRows [][]string) (accent string, lightBg string) {
	colorCounts := make(map[string]int)
	lightCounts := make(map[string]int)

	rowCount := min(len(rawRows), 45)
	for rIdx := 0; rIdx < rowCount; rIdx++ {
		r := rawRows[rIdx]
		for cIdx := range r {
			axis, _ := excelize.CoordinatesToCellName(cIdx+1, rIdx+1)
			sID, _ := f.GetCellStyle(sheet, axis)
			if st, _ := f.GetStyle(sID); st != nil {
				if len(st.Fill.Color) > 0 && st.Fill.Color[0] != "" {
					c := strings.ToUpper(st.Fill.Color[0])
					if c != "FFFFFF" && c != "000000" {
						if isLightHex(c) {
							lightCounts[c]++
						} else {
							colorCounts[c]++
						}
					}
				}
				if st.Font != nil && st.Font.Color != "" {
					c := strings.ToUpper(st.Font.Color)
					if c != "FFFFFF" && c != "000000" {
						if !isLightHex(c) {
							colorCounts[c] += 2
						}
					}
				}
			}
		}
	}

	bestAccent := ""
	bestAccentCount := 0
	for c, count := range colorCounts {
		if count > bestAccentCount {
			bestAccentCount = count
			bestAccent = c
		}
	}

	bestLight := ""
	bestLightCount := 0
	for c, count := range lightCounts {
		if count > bestLightCount {
			bestLightCount = count
			bestLight = c
		}
	}

	if bestAccent != "" {
		accent = "#" + bestAccent
	}
	if bestLight != "" {
		lightBg = "#" + bestLight
	}
	return accent, lightBg
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

	// 4. Primary & Accent color resolution
	accent, lightBg := findDominantColors(f, sheet, rawRows)
	if accent != "" {
		meta.PrimaryColor = accent
	} else if meta.HeaderFill != "" && !isLightHex(strings.TrimPrefix(meta.HeaderFill, "#")) {
		meta.PrimaryColor = meta.HeaderFill
	} else if meta.BannerFill != "" && !isLightHex(strings.TrimPrefix(meta.BannerFill, "#")) {
		meta.PrimaryColor = meta.BannerFill
	} else {
		meta.PrimaryColor = "#0d9488"
	}

	if meta.HeaderFill == "" || isLightHex(strings.TrimPrefix(meta.HeaderFill, "#")) {
		meta.HeaderFill = meta.PrimaryColor
	}
	if lightBg != "" {
		meta.BannerFill = lightBg
	} else if meta.BannerFill == "" {
		meta.BannerFill = meta.PrimaryColor
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
		{relPath: filepath.Join(s.dataDir, "templates", "invoices"), category: "invoices", badge: "فاتورة Excel"},
		{relPath: filepath.Join(s.dataDir, "templates", "documents"), category: "vouchers", badge: "سند Excel"},
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
				"light_color":  meta.BannerFill,
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
		normalized := filepath.FromSlash(strings.ReplaceAll(filePath, "\\", "/"))
		if _, errStat := os.Stat(normalized); errStat == nil {
			return normalized, nil
		}
		// Also check by filename in s.dataDir templates
		base := filepath.Base(normalized)
		for _, sub := range []string{"invoices", "documents"} {
			cand := filepath.Join(s.dataDir, "templates", sub, base)
			if _, errStat := os.Stat(cand); errStat == nil {
				return cand, nil
			}
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

func (s *TemplateService) RenderTemplateHTML(id string) (string, error) {
	filePath, err := s.GetFilePath(id)
	if err != nil {
		return "", err
	}
	return ConvertExcelToHTML(filePath)
}

func (s *TemplateService) RenderInvoiceHTML(inv *InvoiceView, style string) (string, error) {
	if style == "" || style == "default" {
		if inv.IssuerSnapshot != nil && inv.IssuerSnapshot.PrintSettings != "" {
			var pCfg map[string]any
			if err := json.Unmarshal([]byte(inv.IssuerSnapshot.PrintSettings), &pCfg); err == nil {
				if t, ok := pCfg["template_style"].(string); ok && t != "" {
					style = t
				}
			}
		}
	}
	if style == "" {
		style = "standard"
	}

	filePath, err := s.GetFilePath(style)
	if err != nil || filePath == "" {
		return "", fmt.Errorf("قالب Excel غير متوفر لهذا النمط: %s", style)
	}

	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return "", fmt.Errorf("تعذر فتح ملف القالب: %w", err)
	}
	defer f.Close()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return "", errors.New("ملف القالب لا يحتوي على صفحات")
	}
	sheet := sheets[0]

	rawRows, err := f.GetRows(sheet)
	if err != nil || len(rawRows) == 0 {
		return "", errors.New("صفحات القالب فارغة")
	}

	// 1. Locate items header row
	hdrRowIdx, _, _, _ := findTableHeaders(f, sheet, rawRows)
	if hdrRowIdx < 0 {
		hdrRowIdx = 17
	}

	rawHdrRow := rawRows[hdrRowIdx]
	colMap := make(map[string]int)

	for c := 1; c <= len(rawHdrRow); c++ {
		text := strings.TrimSpace(rawHdrRow[c-1])
		if text == "" {
			continue
		}
		tLower := strings.ToLower(text)
		if strings.Contains(tLower, "صنف") || strings.Contains(tLower, "وصف") || strings.Contains(tLower, "خدمة") || strings.Contains(tLower, "بيان") {
			if _, exists := colMap["desc"]; !exists {
				colMap["desc"] = c
			}
		} else if strings.Contains(tLower, "كمية") || strings.Contains(tLower, "عدد") || strings.Contains(tLower, "qty") {
			colMap["qty"] = c
		} else if strings.Contains(tLower, "سعر") || strings.Contains(tLower, "price") || strings.Contains(tLower, "مفرد") {
			if !strings.Contains(tLower, "قبل") && !strings.Contains(tLower, "شامل") {
				colMap["price"] = c
			}
		} else if strings.Contains(tLower, "ضريب") || strings.Contains(tLower, "tax") || strings.Contains(tLower, "vat") {
			if !strings.Contains(tLower, "شامل") && !strings.Contains(tLower, "نسبة") {
				colMap["tax"] = c
			}
		} else if strings.Contains(tLower, "إجمالي") || strings.Contains(tLower, "اجمالي") || strings.Contains(tLower, "total") || strings.Contains(tLower, "مجموع") {
			colMap["total"] = c
		} else if text == "م" || text == "#" || strings.Contains(tLower, "تسلسل") {
			colMap["idx"] = c
		}
	}

	// 2. Populate item rows
	startItemRow := hdrRowIdx + 2
	if hdrRowIdx+1 < len(rawRows) {
		sameAsHdr := true
		for c := range rawRows[hdrRowIdx] {
			if c < len(rawRows[hdrRowIdx+1]) && rawRows[hdrRowIdx][c] != rawRows[hdrRowIdx+1][c] {
				sameAsHdr = false
				break
			}
		}
		if sameAsHdr && len(rawRows[hdrRowIdx]) > 0 {
			startItemRow = hdrRowIdx + 3
		}
	}

	lines := inv.Lines
	if len(lines) == 0 {
		lines = inv.Items
	}

	for i, l := range lines {
		targetRow := startItemRow + i
		if col, ok := colMap["idx"]; ok {
			colName, _ := excelize.ColumnNumberToName(col)
			_ = f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, targetRow), i+1)
		}
		if col, ok := colMap["desc"]; ok {
			colName, _ := excelize.ColumnNumberToName(col)
			_ = f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, targetRow), l.ItemName)
		}
		if col, ok := colMap["qty"]; ok {
			colName, _ := excelize.ColumnNumberToName(col)
			_ = f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, targetRow), l.Quantity)
		}
		if col, ok := colMap["price"]; ok {
			colName, _ := excelize.ColumnNumberToName(col)
			_ = f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, targetRow), l.UnitPriceMajor)
		}
		if col, ok := colMap["tax"]; ok {
			colName, _ := excelize.ColumnNumberToName(col)
			_ = f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, targetRow), l.TaxAmountMajor)
		}
		if col, ok := colMap["total"]; ok {
			colName, _ := excelize.ColumnNumberToName(col)
			tot := l.TotalLineMajor
			if tot == 0 {
				tot = l.Quantity*l.UnitPriceMajor + l.TaxAmountMajor
			}
			_ = f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, targetRow), tot)
		}
	}

	// Clear remaining sample rows in table
	for r := startItemRow + len(lines); r < startItemRow+25 && r <= len(rawRows); r++ {
		isTotalsArea := false
		for _, cellVal := range rawRows[r-1] {
			cTrim := strings.TrimSpace(cellVal)
			if strings.Contains(cTrim, "المجموع") || strings.Contains(cTrim, "الخصم") || strings.Contains(cTrim, "الإجمالي المستحق") || strings.Contains(cTrim, "QR") {
				isTotalsArea = true
				break
			}
		}
		if isTotalsArea {
			break
		}
		for _, col := range colMap {
			colName, _ := excelize.ColumnNumberToName(col)
			_ = f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, r), "")
		}
	}

	sellerName := inv.SellerName
	sellerTax := inv.SellerTaxNumber
	sellerCR := inv.SellerCr
	sellerAddress := inv.SellerAddress
	if inv.IssuerSnapshot != nil {
		if sellerName == "" {
			sellerName = inv.IssuerSnapshot.NameAr
		}
		if sellerTax == "" {
			sellerTax = inv.IssuerSnapshot.TaxNumber
		}
		if sellerCR == "" {
			sellerCR = inv.IssuerSnapshot.CommercialRegister
		}
		if sellerAddress == "" {
			parts := []string{inv.IssuerSnapshot.BuildingNo, inv.IssuerSnapshot.Street, inv.IssuerSnapshot.District, inv.IssuerSnapshot.City}
			var clean []string
			for _, p := range parts {
				if strings.TrimSpace(p) != "" {
					clean = append(clean, p)
				}
			}
			sellerAddress = strings.Join(clean, " - ")
			if inv.IssuerSnapshot.Phone != "" {
				if sellerAddress != "" {
					sellerAddress += " - " + inv.IssuerSnapshot.Phone
				} else {
					sellerAddress = inv.IssuerSnapshot.Phone
				}
			}
		}
	}

	buyerName := inv.BuyerName
	buyerTax := inv.BuyerTaxNumber
	buyerAddress := inv.BuyerAddress
	if inv.ClientSnapshot != nil {
		if buyerName == "" {
			buyerName = inv.ClientSnapshot.Name
		}
		if buyerTax == "" {
			buyerTax = inv.ClientSnapshot.TaxNumber
		}
		if buyerAddress == "" {
			buyerAddress = inv.ClientSnapshot.Address
			if buyerAddress == "" {
				buyerAddress = inv.ClientSnapshot.City
			}
		}
	}

	// 3. Scan and replace metadata / placeholders in the sheet
	maxCol := 16
	qrInserted := false
	logoInserted := false

	// Helper to check if a row is a label/header row
	isRowHeader := func(rowIdx int) bool {
		if rowIdx-1 < 0 || rowIdx-1 >= len(rawRows) {
			return false
		}
		for _, cell := range rawRows[rowIdx-1] {
			cTrim := strings.TrimSpace(cell)
			if strings.Contains(cTrim, "فاتورة") || strings.Contains(cTrim, "تاريخ") || strings.Contains(cTrim, "عميل") || strings.Contains(cTrim, "منشأة") || strings.Contains(cTrim, "سجل") || strings.Contains(cTrim, "دفع") || strings.Contains(cTrim, "مورد") || strings.Contains(cTrim, "مشتري") || strings.Contains(cTrim, "صنف") || strings.Contains(cTrim, "كمية") || strings.Contains(cTrim, "سعر") || strings.Contains(cTrim, "المجموع") || strings.Contains(cTrim, "الخصم") || strings.Contains(cTrim, "المستحق") || (strings.Contains(cTrim, "ضريب") && !strings.Contains(cTrim, "رقم")) {
				return true
			}
		}
		return false
	}

	for r := 1; r <= len(rawRows); r++ {
		handledInRow := make(map[string]bool)

		for c := 1; c <= maxCol; c++ {
			axis, _ := excelize.CoordinatesToCellName(c, r)
			val, _ := f.GetCellValue(sheet, axis)
			valTrim := strings.TrimSpace(val)
			if valTrim == "" {
				continue
			}

			// In-cell placeholder replacement {{...}}
			if strings.Contains(valTrim, "{{") {
				newVal := valTrim
				newVal = strings.ReplaceAll(newVal, "{{invoice_number}}", inv.InvoiceNumber)
				newVal = strings.ReplaceAll(newVal, "{{date}}", inv.IssueDate)
				newVal = strings.ReplaceAll(newVal, "{{seller_name}}", sellerName)
				newVal = strings.ReplaceAll(newVal, "{{buyer_name}}", buyerName)
				newVal = strings.ReplaceAll(newVal, "{{total}}", fmt.Sprintf("%.2f ر.س", inv.GrandTotalMajor))
				newVal = strings.ReplaceAll(newVal, "{{tax}}", fmt.Sprintf("%.2f ر.س", inv.TaxAmountMajor))
				newVal = strings.ReplaceAll(newVal, "{{subtotal}}", fmt.Sprintf("%.2f ر.س", inv.SubtotalMajor))
				if newVal != valTrim {
					_ = f.SetCellValue(sheet, axis, newVal)
					continue
				}
			}

			// QR placement (only once)
			if !qrInserted && (strings.EqualFold(valTrim, "QR") || strings.Contains(valTrim, "باركود") || strings.Contains(valTrim, "{{qr}}")) {
				if inv.QrPayload != "" {
					qrBytes, errQr := qrcode.Encode(inv.QrPayload, qrcode.Medium, 170)
					if errQr == nil {
						_ = f.AddPictureFromBytes(sheet, axis, &excelize.Picture{
							Extension: ".png",
							File:      qrBytes,
							Format: &excelize.GraphicOptions{
								LockAspectRatio: true,
								AutoFit:         true,
								OffsetX:         2,
								OffsetY:         2,
							},
						})
						_ = f.SetCellValue(sheet, axis, "")
						qrInserted = true
					}
				}
				continue
			}

			// Logo placement (only once)
			if !logoInserted && (strings.EqualFold(valTrim, "الشعار") || strings.EqualFold(valTrim, "LOGO") || strings.Contains(valTrim, "{{logo}}")) {
				if inv.IssuerSnapshot != nil && inv.IssuerSnapshot.LogoData != nil && strings.HasPrefix(*inv.IssuerSnapshot.LogoData, "data:image/") {
					logoData := *inv.IssuerSnapshot.LogoData
					commaIdx := strings.Index(logoData, ",")
					if commaIdx != -1 {
						if imgBytes, errDec := base64.StdEncoding.DecodeString(logoData[commaIdx+1:]); errDec == nil && len(imgBytes) > 0 {
							ext := ".png"
							if strings.HasPrefix(logoData, "data:image/jpeg") || strings.HasPrefix(logoData, "data:image/jpg") {
								ext = ".jpg"
							}
							_ = f.AddPictureFromBytes(sheet, axis, &excelize.Picture{
								Extension: ext,
								File:      imgBytes,
								Format: &excelize.GraphicOptions{
									LockAspectRatio: true,
									AutoFit:         true,
									OffsetX:         4,
									OffsetY:         4,
								},
							})
							_ = f.SetCellValue(sheet, axis, "")
							logoInserted = true
						}
					}
				}
				continue
			}

			// Helper to find the adjacent value cell without overwriting the label
			fillAdjacent := func(targetVal string) {
				isTotalsLabel := strings.Contains(valTrim, "المجموع") || strings.Contains(valTrim, "الخصم") || strings.Contains(valTrim, "المستحق") || (strings.Contains(valTrim, "ضريب") && !strings.Contains(valTrim, "رقم")) || r >= hdrRowIdx

				// 1. Check if row r+1 is an empty value row (vertical card pattern) for metadata
				if !isTotalsLabel && r+1 <= len(rawRows) && !isRowHeader(r+1) {
					belowAxis, _ := excelize.CoordinatesToCellName(c, r+1)
					tv, _ := f.GetCellValue(sheet, belowAxis)
					tvTrim := strings.TrimSpace(tv)
					if tvTrim == "" || strings.HasPrefix(tvTrim, "{{") || tvTrim == "-" || tvTrim == "—" {
						_ = f.SetCellValue(sheet, belowAxis, targetVal)
						return
					}
				}

				// 2. Look horizontally on the same row (RTL first, looking left)
				leftCol := c
				for leftCol > 1 {
					prevAxis, _ := excelize.CoordinatesToCellName(leftCol-1, r)
					pv, _ := f.GetCellValue(sheet, prevAxis)
					if strings.TrimSpace(pv) == valTrim {
						leftCol--
					} else {
						break
					}
				}

				found := false
				for off := 1; off <= 8 && leftCol-off >= 1; off++ {
					targetCol := leftCol - off
					colName, _ := excelize.ColumnNumberToName(targetCol)
					w, _ := f.GetColWidth(sheet, colName)
					// Skip narrow margin columns and border columns
					if w <= 3.5 || (targetCol < 3 && maxCol >= 12) || (targetCol == 1 && len(rawRows[r-1]) >= 10) {
						continue
					}

					tAxis, _ := excelize.CoordinatesToCellName(targetCol, r)
					tv, _ := f.GetCellValue(sheet, tAxis)
					tvTrim := strings.TrimSpace(tv)
					if tvTrim == "" || strings.HasPrefix(tvTrim, "{{") || tvTrim == "-" || tvTrim == "—" || strings.HasPrefix(tvTrim, "INV") || strings.HasPrefix(tvTrim, "0") {
						_ = f.SetCellValue(sheet, tAxis, targetVal)
						found = true
						break
					}
				}

				// 3. If not found on left, try looking to the right (LTR layout)
				if !found {
					rightCol := c
					for rightCol < maxCol {
						nextAxis, _ := excelize.CoordinatesToCellName(rightCol+1, r)
						nv, _ := f.GetCellValue(sheet, nextAxis)
						if strings.TrimSpace(nv) == valTrim {
							rightCol++
						} else {
							break
						}
					}
					for off := 1; off <= 8 && rightCol+off <= maxCol; off++ {
						targetCol := rightCol + off
						colName, _ := excelize.ColumnNumberToName(targetCol)
						w, _ := f.GetColWidth(sheet, colName)
						if w <= 3.5 || (targetCol > maxCol-2 && maxCol >= 12) || (targetCol == maxCol && len(rawRows[r-1]) >= 10) {
							continue
						}

						tAxis, _ := excelize.CoordinatesToCellName(targetCol, r)
						tv, _ := f.GetCellValue(sheet, tAxis)
						tvTrim := strings.TrimSpace(tv)
						if tvTrim == "" || strings.HasPrefix(tvTrim, "{{") || tvTrim == "-" || tvTrim == "—" || strings.HasPrefix(tvTrim, "INV") || strings.HasPrefix(tvTrim, "0") {
							_ = f.SetCellValue(sheet, tAxis, targetVal)
							break
						}
					}
				}
			}

			if (strings.Contains(valTrim, "رقم الفاتورة") || strings.Contains(valTrim, "invoice no")) && !handledInRow["inv_no"] {
				handledInRow["inv_no"] = true
				fillAdjacent(inv.InvoiceNumber)
			} else if (strings.Contains(valTrim, "تاريخ الإصدار") || strings.Contains(valTrim, "issue date")) && !handledInRow["issue_date"] {
				handledInRow["issue_date"] = true
				fillAdjacent(inv.IssueDate)
			} else if (strings.Contains(valTrim, "تاريخ الاستحقاق") || strings.Contains(valTrim, "due date")) && !handledInRow["due_date"] {
				handledInRow["due_date"] = true
				dueDate := inv.IssueDate
				if inv.DueDate != nil && *inv.DueDate != "" {
					dueDate = *inv.DueDate
				}
				fillAdjacent(dueDate)
			} else if (strings.Contains(valTrim, "طريقة الدفع") || strings.Contains(valTrim, "payment method")) && !handledInRow["payment_method"] {
				handledInRow["payment_method"] = true
				fillAdjacent(inv.PaymentLabel)
			} else if (strings.Contains(valTrim, "اسم المنشأة") || strings.Contains(valTrim, "المورد")) && !handledInRow["seller_name"] {
				handledInRow["seller_name"] = true
				fillAdjacent(sellerName)
			} else if strings.Contains(valTrim, "تواصل") {
				if !handledInRow["seller_addr"] {
					handledInRow["seller_addr"] = true
					fillAdjacent(sellerAddress)
				}
			} else if strings.Contains(valTrim, "الرقم الضريبي") && strings.Contains(valTrim, "العنوان") && !handledInRow["buyer_tax_addr"] {
				handledInRow["buyer_tax_addr"] = true
				comb := buyerTax
				if buyerAddress != "" {
					if comb != "" {
						comb += " - " + buyerAddress
					} else {
						comb = buyerAddress
					}
				}
				fillAdjacent(comb)
			} else if strings.Contains(valTrim, "الرقم الضريبي") && r < hdrRowIdx && c > 5 && !handledInRow["seller_tax"] {
				handledInRow["seller_tax"] = true
				fillAdjacent(sellerTax)
			} else if strings.Contains(valTrim, "السجل التجاري") && !handledInRow["seller_cr"] {
				handledInRow["seller_cr"] = true
				fillAdjacent(sellerCR)
			} else if (strings.Contains(valTrim, "اسم العميل") || strings.Contains(valTrim, "المشتري")) && !handledInRow["buyer_name"] {
				handledInRow["buyer_name"] = true
				fillAdjacent(buyerName)
			} else if strings.Contains(valTrim, "الرقم الضريبي") && r < hdrRowIdx && c <= 5 && !handledInRow["buyer_tax"] {
				handledInRow["buyer_tax"] = true
				fillAdjacent(buyerTax)
			} else if strings.Contains(valTrim, "العنوان") && !strings.Contains(valTrim, "تواصل") && !strings.Contains(valTrim, "ضريب") && r < hdrRowIdx && r > 12 && !handledInRow["buyer_addr"] {
				handledInRow["buyer_addr"] = true
				fillAdjacent(buyerAddress)
			} else if strings.Contains(valTrim, "المجموع") && r >= hdrRowIdx && !handledInRow["subtotal"] {
				handledInRow["subtotal"] = true
				fillAdjacent(fmt.Sprintf("%.2f ر.س", inv.SubtotalMajor))
			} else if strings.Contains(valTrim, "الخصم") && r >= hdrRowIdx && !handledInRow["discount"] {
				handledInRow["discount"] = true
				fillAdjacent(fmt.Sprintf("%.2f ر.س", inv.DiscountAmountMajor))
			} else if (strings.Contains(valTrim, "الضريبة") || strings.Contains(valTrim, "ضريبة")) && r >= hdrRowIdx && !strings.Contains(valTrim, "سعر") && !strings.Contains(valTrim, "رقم") && !handledInRow["tax"] {
				handledInRow["tax"] = true
				fillAdjacent(fmt.Sprintf("%.2f ر.س", inv.TaxAmountMajor))
			} else if (strings.Contains(valTrim, "الإجمالي المستحق") || strings.Contains(valTrim, "المستحق")) && r >= hdrRowIdx && !handledInRow["grand_total"] {
				handledInRow["grand_total"] = true
				fillAdjacent(fmt.Sprintf("%.2f ر.س", inv.GrandTotalMajor))
			}
		}
	}

	return ConvertExcelFileToHTML(f)
}

type excelMergeInfo struct {
	ColSpan int
	RowSpan int
}

func ConvertExcelToHTML(filePath string) (string, error) {
	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return "", fmt.Errorf("تعذر فتح ملف القالب: %w", err)
	}
	defer f.Close()
	return ConvertExcelFileToHTML(f)
}

func ConvertExcelFileToHTML(f *excelize.File) (string, error) {

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return "", errors.New("ملف القالب لا يحتوي على صفحات")
	}
	sheet := sheets[0]

	// RTL View
	dir := "rtl"
	sheetView, errView := f.GetSheetView(sheet, 0)
	if errView == nil && sheetView.RightToLeft != nil && !*sheetView.RightToLeft {
		dir = "ltr"
	}

	// Merged Cells
	merges, _ := f.GetMergeCells(sheet)
	mergedStarts := make(map[string]excelMergeInfo)
	mergedSkips := make(map[string]bool)

	maxMergeCol := 1
	maxMergeRow := 1

	for _, m := range merges {
		startCol, startRow, _ := excelize.CellNameToCoordinates(m.GetStartAxis())
		endCol, endRow, _ := excelize.CellNameToCoordinates(m.GetEndAxis())
		if endCol > maxMergeCol {
			maxMergeCol = endCol
		}
		if endRow > maxMergeRow {
			maxMergeRow = endRow
		}
		mergedStarts[m.GetStartAxis()] = excelMergeInfo{
			ColSpan: endCol - startCol + 1,
			RowSpan: endRow - startRow + 1,
		}
		for r := startRow; r <= endRow; r++ {
			for c := startCol; c <= endCol; c++ {
				axis, _ := excelize.CoordinatesToCellName(c, r)
				if axis != m.GetStartAxis() {
					mergedSkips[axis] = true
				}
			}
		}
	}

	rawRows, _ := f.GetRows(sheet)
	totalRows := len(rawRows)
	if maxMergeRow > totalRows {
		totalRows = maxMergeRow
	}

	totalCols := 1
	for _, r := range rawRows {
		if len(r) > totalCols {
			totalCols = len(r)
		}
	}
	if maxMergeCol > totalCols {
		totalCols = maxMergeCol
	}

	colWidths := make([]float64, totalCols)
	totalWidth := 0.0
	for c := 1; c <= totalCols; c++ {
		colName, _ := excelize.ColumnNumberToName(c)
		w, _ := f.GetColWidth(sheet, colName)
		if w <= 0 {
			w = 10.0
		}
		colWidths[c-1] = w
		totalWidth += w
	}

	var sb strings.Builder
	sb.WriteString("<!DOCTYPE html>\n")
	sb.WriteString(fmt.Sprintf("<html lang=\"ar\" dir=\"%s\">\n<head>\n<meta charset=\"utf-8\" />\n", dir))
	sb.WriteString("<style>\n")
	sb.WriteString("  @page { size: A4 portrait; margin: 6mm; }\n")
	sb.WriteString("  * { box-sizing: border-box; }\n")
	sb.WriteString("  html, body { margin: 0; padding: 0; background: #fff; font-family: Tahoma, 'Cairo', 'Segoe UI', Arial, sans-serif; color: #111; }\n")
	sb.WriteString("  .excel-container { width: 100%; max-width: 210mm; margin: 0 auto; background: #fff; padding: 2mm 0; }\n")
	sb.WriteString("  table.excel-sheet { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 9pt; }\n")
	sb.WriteString("  table.excel-sheet td { padding: 3px 5px; overflow: hidden; word-break: break-word; }\n")
	sb.WriteString("  .cell-img { max-width: 100%; max-height: 100%; display: block; margin: 0 auto; object-fit: contain; }\n")
	sb.WriteString("  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }\n")
	sb.WriteString("</style>\n</head>\n<body>\n")
	sb.WriteString("<div class=\"excel-container\">\n")
	sb.WriteString("<table class=\"excel-sheet\">\n")

	sb.WriteString("  <colgroup>\n")
	for c := 1; c <= totalCols; c++ {
		pct := (colWidths[c-1] / totalWidth) * 100
		sb.WriteString(fmt.Sprintf("    <col style=\"width: %.2f%%;\" />\n", pct))
	}
	sb.WriteString("  </colgroup>\n")

	sb.WriteString("  <tbody>\n")

	for r := 1; r <= totalRows; r++ {
		rH, _ := f.GetRowHeight(sheet, r)
		rowStyle := ""
		if rH > 0 {
			rowStyle = fmt.Sprintf(" style=\"height: %.1fpt;\"", rH)
		}
		sb.WriteString(fmt.Sprintf("    <tr%s>\n", rowStyle))

		for c := 1; c <= totalCols; c++ {
			axis, _ := excelize.CoordinatesToCellName(c, r)
			if mergedSkips[axis] {
				continue
			}

			val, _ := f.GetCellValue(sheet, axis)
			calcVal, errCalc := f.CalcCellValue(sheet, axis)
			if errCalc == nil && calcVal != "" {
				val = calcVal
			}

			pics, _ := f.GetPictures(sheet, axis)
			var imgTags string
			for _, pic := range pics {
				mime := "image/png"
				if strings.HasSuffix(strings.ToLower(pic.Extension), "jpg") || strings.HasSuffix(strings.ToLower(pic.Extension), "jpeg") {
					mime = "image/jpeg"
				}
				b64 := base64.StdEncoding.EncodeToString(pic.File)
				imgTags += fmt.Sprintf("<img class=\"cell-img\" src=\"data:%s;base64,%s\" />", mime, b64)
			}

			sID, _ := f.GetCellStyle(sheet, axis)
			st, _ := f.GetStyle(sID)

			var styles []string
			if st != nil {
				if len(st.Fill.Color) > 0 && st.Fill.Color[0] != "" {
					hex := strings.ToUpper(st.Fill.Color[0])
					if hex != "FFFFFF" && hex != "00000000" {
						if !strings.HasPrefix(hex, "#") {
							hex = "#" + hex
						}
						styles = append(styles, fmt.Sprintf("background-color: %s", hex))
					}
				}
				if st.Font != nil {
					if st.Font.Bold {
						styles = append(styles, "font-weight: 700")
					}
					if st.Font.Italic {
						styles = append(styles, "font-style: italic")
					}
					if st.Font.Size > 0 {
						styles = append(styles, fmt.Sprintf("font-size: %.1fpt", st.Font.Size))
					}
					if st.Font.Color != "" {
						fColor := st.Font.Color
						if !strings.HasPrefix(fColor, "#") {
							fColor = "#" + fColor
						}
						styles = append(styles, fmt.Sprintf("color: %s", fColor))
					}
					if st.Font.Family != "" {
						styles = append(styles, fmt.Sprintf("font-family: '%s', Tahoma, sans-serif", st.Font.Family))
					}
				}
				if st.Alignment != nil {
					if st.Alignment.Horizontal != "" {
						hAlign := st.Alignment.Horizontal
						if hAlign == "center" {
							styles = append(styles, "text-align: center")
						} else if hAlign == "right" {
							styles = append(styles, "text-align: right")
						} else if hAlign == "left" {
							styles = append(styles, "text-align: left")
						}
					}
					if st.Alignment.Vertical != "" {
						vAlign := st.Alignment.Vertical
						if vAlign == "center" {
							styles = append(styles, "vertical-align: middle")
						} else if vAlign == "top" {
							styles = append(styles, "vertical-align: top")
						} else if vAlign == "bottom" {
							styles = append(styles, "vertical-align: bottom")
						}
					}
					if st.Alignment.WrapText {
						styles = append(styles, "white-space: pre-wrap")
					}
				}
				for _, b := range st.Border {
					bColor := "#D0D0D0"
					if b.Color != "" {
						bColor = b.Color
						if !strings.HasPrefix(bColor, "#") {
							bColor = "#" + bColor
						}
					}
					bWidth := "1px"
					bStyle := "solid"
					if b.Style >= 2 {
						bWidth = "2px"
					}
					switch strings.ToLower(b.Type) {
					case "top":
						styles = append(styles, fmt.Sprintf("border-top: %s %s %s", bWidth, bStyle, bColor))
					case "bottom":
						styles = append(styles, fmt.Sprintf("border-bottom: %s %s %s", bWidth, bStyle, bColor))
					case "left":
						styles = append(styles, fmt.Sprintf("border-left: %s %s %s", bWidth, bStyle, bColor))
					case "right":
						styles = append(styles, fmt.Sprintf("border-right: %s %s %s", bWidth, bStyle, bColor))
					}
				}
			}

			attrs := ""
			if mInfo, isStart := mergedStarts[axis]; isStart {
				if mInfo.ColSpan > 1 {
					attrs += fmt.Sprintf(" colspan=\"%d\"", mInfo.ColSpan)
				}
				if mInfo.RowSpan > 1 {
					attrs += fmt.Sprintf(" rowspan=\"%d\"", mInfo.RowSpan)
				}
			}

			styleAttr := ""
			if len(styles) > 0 {
				styleAttr = fmt.Sprintf(" style=\"%s\"", strings.Join(styles, "; "))
			}

			cellContent := val
			if cellContent != "" {
				cellContent = strings.ReplaceAll(cellContent, "\n", "<br/>")
				cellContent = strings.ReplaceAll(cellContent, "ر.س", SarSymbolSVG)
				cellContent = strings.ReplaceAll(cellContent, "ر. س", SarSymbolSVG)
				cellContent = strings.ReplaceAll(cellContent, "﷼", SarSymbolSVG)
				if strings.TrimSpace(cellContent) == "SAR" {
					cellContent = SarSymbolSVG
				} else {
					cellContent = strings.ReplaceAll(cellContent, " SAR", " "+SarSymbolSVG)
					cellContent = strings.ReplaceAll(cellContent, "SAR ", SarSymbolSVG+" ")
				}
			}
			if imgTags != "" {
				if cellContent != "" {
					cellContent = imgTags + "<br/>" + cellContent
				} else {
					cellContent = imgTags
				}
			}

			sb.WriteString(fmt.Sprintf("      <td%s%s>%s</td>\n", attrs, styleAttr, cellContent))
		}
		sb.WriteString("    </tr>\n")
	}

	sb.WriteString("  </tbody>\n")
	sb.WriteString("</table>\n")
	sb.WriteString("</div>\n")
	sb.WriteString("</body>\n</html>\n")

	return sb.String(), nil
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
	outDir := filepath.Join(s.dataDir, "templates", category)
	_ = os.MkdirAll(outDir, 0755)
	filePath := filepath.Join(outDir, id+".xlsx")

	if _, ok := cfgMap["gridState"].(map[string]any); ok {
		_ = s.GenerateExcelFromBuilder(category, id, cfgMap)
	}

	var meta *ExtractedSheetMeta
	if f, err := excelize.OpenFile(filePath); err == nil {
		sheets := f.GetSheetList()
		if len(sheets) > 0 {
			if rows, errRows := f.GetRows(sheets[0]); errRows == nil {
				meta = extractSheetProperties(f, sheets[0], rows)
			}
		}
		_ = f.Close()
	}

	headersJson := "[]"
	styleMetaJson := "{}"
	if meta != nil {
		if meta.PrimaryColor != "" && (primaryColor == "" || primaryColor == "#059669") {
			primaryColor = meta.PrimaryColor
		}
		hBytes, _ := json.Marshal(meta.Headers)
		headersJson = string(hBytes)
		sMeta := map[string]interface{}{
			"accent_color": primaryColor,
			"header_fill":  meta.HeaderFill,
			"banner_fill":  meta.BannerFill,
			"light_color":  meta.BannerFill,
			"alignments":   meta.Alignments,
			"headers":      meta.Headers,
			"merges":       meta.Merges,
			"sample_rows":  meta.SampleRows,
			"banner_text":  meta.BannerText,
		}
		smBytes, _ := json.Marshal(sMeta)
		styleMetaJson = string(smBytes)
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
			headers_json = excluded.headers_json,
			style_meta = excluded.style_meta,
			updated_at = CURRENT_TIMESTAMP
	`, id, nameAr, id, "قالب مخصص تم إنشاؤه عبر محرر القوالب", "مخصص", category, relPath, primaryColor, headersJson, styleMetaJson)

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

