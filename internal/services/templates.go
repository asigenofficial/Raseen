package services

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/skip2/go-qrcode"

	"raseen/internal/crypto"
	"raseen/internal/db"
)

const SarSymbolSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1124.14 1256.39" width="0.92em" height="0.92em" class="sar-sym-svg" style="vertical-align:-0.14em;display:inline-block;fill:currentColor;margin:0 2px;" aria-label="ريال سعودي" title="ريال سعودي" role="img"><path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"/><path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"/></svg>`

var (
	moneySarRegex1 = regexp.MustCompile(`([0-9]+(?:\.[0-9]+)?)\s*(?:ر\.س|ر\.\s*س|﷼|SAR)`)
	moneySarRegex2 = regexp.MustCompile(`(?:ر\.س|ر\.\s*س|﷼|SAR)\s*([0-9]+(?:\.[0-9]+)?)`)
)

type TemplateService struct {
	db      *db.DB
	dataDir string
}

func NewTemplateService(d *db.DB, dataDir string) *TemplateService {
	tplDir := filepath.Join(dataDir, "templates")
	_ = os.MkdirAll(filepath.Join(tplDir, "invoices"), 0755)
	_ = os.MkdirAll(filepath.Join(tplDir, "documents"), 0755)
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

// ─── Disk Sync ────────────────────────────────────────────────────────────────

// SyncDiskTemplates scans data/templates/{invoices,documents} for *.html files
// and registers them in the excel_templates catalog table.
func (s *TemplateService) SyncDiskTemplates() error {
	dirs := []struct {
		relPath  string
		category string
		badge    string
	}{
		{filepath.Join(s.dataDir, "templates", "invoices"), "invoices", "فاتورة HTML"},
		{filepath.Join(s.dataDir, "templates", "documents"), "documents", "سند HTML"},
	}

	_, _ = s.db.Exec(`DELETE FROM excel_templates WHERE file_path LIKE '%templates%invoices%' OR file_path LIKE '%templates%documents%'`)

	for _, d := range dirs {
		entries, err := os.ReadDir(d.relPath)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".html") {
				continue
			}
			fullPath := filepath.Join(d.relPath, entry.Name())
			fi, err := entry.Info()
			if err != nil {
				continue
			}

			baseName := strings.TrimSuffix(entry.Name(), ".html")
			h := sha256.Sum256([]byte(d.category + "/" + entry.Name()))
			id := "tpl_" + hex.EncodeToString(h[:4])
			nameAr := strings.ReplaceAll(baseName, "_", " ")

			contentBytes, _ := os.ReadFile(fullPath)
			tags := extractHtmlPlaceholders(string(contentBytes))
			headersJson, _ := json.Marshal(tags)

			_, _ = s.db.Exec(`
				INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, is_active, updated_at)
				VALUES (?, ?, '', ?, ?, ?, ?, '#059669', ?, 1, ?)
				ON CONFLICT(id) DO UPDATE SET
					name_ar = excluded.name_ar,
					file_path = excluded.file_path,
					category = excluded.category,
					headers_json = excluded.headers_json,
					updated_at = excluded.updated_at
			`, id, nameAr, "قالب HTML معتمد في النظام", d.badge, d.category, fullPath, string(headersJson), db.NowIso())
			_ = fi
		}
	}
	return nil
}

func extractHtmlPlaceholders(content string) []string {
	tagRegex := regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_\-\.]+)\s*\}\}`)
	matches := tagRegex.FindAllString(content, -1)
	seen := make(map[string]bool)
	var list []string
	for _, m := range matches {
		clean := strings.TrimSpace(m)
		if !seen[clean] {
			seen[clean] = true
			list = append(list, clean)
		}
	}
	return list
}

// ─── List ─────────────────────────────────────────────────────────────────────

func (s *TemplateService) List(typeFilter, categoryFilter string) ([]TemplateCatalogItem, error) {
	_ = s.SyncDiskTemplates()
	list := make([]TemplateCatalogItem, 0)

	rows, err := s.db.Query(`
		SELECT id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, is_active
		FROM excel_templates
	`)
	if err != nil {
		return list, nil
	}
	defer rows.Close()

	for rows.Next() {
		var tpl TemplateCatalogItem
		var filePath, headersJson string
		var isAct int
		if err := rows.Scan(&tpl.ID, &tpl.NameAr, &tpl.NameEn, &tpl.Description, &tpl.Badge, &tpl.Category, &filePath, &tpl.ColorHex, &headersJson, &isAct); err != nil {
			continue
		}
		tpl.IsActive = isAct == 1
		tpl.IsDefault = tpl.ID == "standard"
		tpl.FilePath = filePath
		if fi, errStat := os.Stat(filePath); errStat == nil {
			tpl.FileSize = fi.Size()
		}
		if headersJson != "" {
			_ = json.Unmarshal([]byte(headersJson), &tpl.Headers)
		}
		if tpl.Headers == nil {
			tpl.Headers = []string{}
		}
		tpl.TotalFields = len(tpl.Headers)
		if tpl.TotalFields > 0 {
			tpl.FieldsSummary = fmt.Sprintf("قالب HTML — تم اكتشاف %d وسم تلقائياً", tpl.TotalFields)
		} else {
			tpl.FieldsSummary = "قالب HTML معتمد"
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
	return list, nil
}

// ─── Inspect ──────────────────────────────────────────────────────────────────

type InspectResult struct {
	Valid                bool           `json:"valid"`
	DetectedType         string         `json:"detected_type"`
	DetectedTitle        string         `json:"detectedTitle,omitempty"`
	DetectedPlaceholders []string       `json:"detected_placeholders"`
	Sheets               []string       `json:"sheets"`
	RowsCount            int            `json:"rows_count"`
	ColsCount            int            `json:"cols_count"`
	Headers              []string       `json:"headers"`
	SampleRows           [][]string     `json:"sampleRows"`
	LayoutGrid           [][]string     `json:"layoutGrid"`
	LayoutFills          [][]string     `json:"layoutFills"`
	LayoutMerges         []string       `json:"layoutMerges"`
	Metadata             map[string]any `json:"metadata"`
	Message              string         `json:"message"`
}

func (s *TemplateService) Inspect(base64Content, filename string) (*InspectResult, error) {
	if base64Content == "" {
		return nil, errors.New("الملف فارغ أو غير صالح")
	}

	idx := strings.Index(base64Content, ",")
	if idx != -1 {
		base64Content = base64Content[idx+1:]
	}
	data, err := base64.StdEncoding.DecodeString(base64Content)
	if err != nil || len(data) == 0 {
		if strings.Contains(base64Content, "<") && strings.Contains(base64Content, ">") {
			data = []byte(base64Content)
		} else {
			return nil, errors.New("صيغة الملف غير مدعومة")
		}
	}

	htmlContent := string(data)
	detectedTitle := strings.TrimSuffix(filename, filepath.Ext(filename))
	detectedTitle = strings.ReplaceAll(detectedTitle, "_", " ")

	detectedType := "invoices"
	lower := strings.ToLower(filename + htmlContent)
	if strings.Contains(lower, "سند") || strings.Contains(lower, "voucher") || strings.Contains(lower, "قبض") {
		detectedType = "documents"
	}

	// Find dynamic tags automatically
	found := extractHtmlPlaceholders(htmlContent)

	return &InspectResult{
		Valid:                true,
		DetectedType:         detectedType,
		DetectedTitle:        detectedTitle,
		DetectedPlaceholders: found,
		Headers:              found,
		Sheets:               []string{"HTML"},
		RowsCount:            strings.Count(htmlContent, "\n"),
		ColsCount:            len(found),
		Message:              fmt.Sprintf("قالب HTML صالح — تم اكتشاف %d وسم ديناميكي تلقائياً.", len(found)),
	}, nil
}

// ─── Upload ───────────────────────────────────────────────────────────────────

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
		input.ColorHex = "#059669"
	}

	id := crypto.UUID()
	subDir := "invoices"
	if input.Category == "vouchers" || input.Category == "documents" {
		subDir = "documents"
		input.Category = "documents"
	}
	targetDir := filepath.Join(s.dataDir, "templates", subDir)
	_ = os.MkdirAll(targetDir, 0755)

	fileName := fmt.Sprintf("tpl_%s.html", id)
	filePath := filepath.Join(targetDir, fileName)

	// Decode and save
	rawB64 := input.FileBase64
	if idx := strings.Index(rawB64, ","); idx != -1 {
		rawB64 = rawB64[idx+1:]
	}
	fileData, err := base64.StdEncoding.DecodeString(rawB64)
	if err != nil || len(fileData) == 0 {
		if strings.Contains(rawB64, "<") && strings.Contains(rawB64, ">") {
			fileData = []byte(rawB64)
		} else {
			return nil, errors.New("بيانات الملف غير صالحة أو فارغة")
		}
	}
	if err := os.WriteFile(filePath, fileData, 0644); err != nil {
		return nil, fmt.Errorf("تعذر حفظ الملف: %w", err)
	}

	badge := "مخصص"
	if input.Category == "documents" {
		badge = "سند مخصص"
	}

	tags := extractHtmlPlaceholders(string(fileData))
	headersJson, _ := json.Marshal(tags)

	_, err = s.db.Exec(`
		INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, is_active, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
	`, id, input.NameAr, input.NameEn, input.Description, badge, input.Category, filePath, input.ColorHex, string(headersJson), db.NowIso())
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
		FilePath:      filePath,
		FileSize:      int64(len(fileData)),
		TotalFields:   len(tags),
		Headers:       tags,
		FieldsSummary: fmt.Sprintf("قالب HTML — تم اكتشاف %d وسم تلقائياً", len(tags)),
	}, nil
}

// ─── Delete / Reset ───────────────────────────────────────────────────────────

func (s *TemplateService) Delete(id string) error {
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

// ─── GetFilePath ──────────────────────────────────────────────────────────────

func (s *TemplateService) GetFilePath(id string) (string, error) {
	var filePath string
	_ = s.db.QueryRow("SELECT file_path FROM excel_templates WHERE id = ?", id).Scan(&filePath)
	if filePath != "" {
		if _, errStat := os.Stat(filePath); errStat == nil {
			return filePath, nil
		}
	}

	// Fallback: search by id in both dirs
	for _, sub := range []string{"invoices", "documents"} {
		for _, ext := range []string{".html"} {
			p := filepath.Join(s.dataDir, "templates", sub, id+ext)
			if _, errStat := os.Stat(p); errStat == nil {
				return p, nil
			}
		}
		// any file containing id
		entries, err := os.ReadDir(filepath.Join(s.dataDir, "templates", sub))
		if err == nil {
			for _, e := range entries {
				if strings.Contains(strings.ToLower(e.Name()), strings.ToLower(id)) {
					return filepath.Join(s.dataDir, "templates", sub, e.Name()), nil
				}
			}
		}
	}
	return "", errors.New("لم يتم العثور على ملف القالب المطلوب")
}

// ─── Render ───────────────────────────────────────────────────────────────────

// RenderTemplateHTML returns the raw HTML of a template file (for preview).
func (s *TemplateService) RenderTemplateHTML(id string) (string, error) {
	filePath, err := s.GetFilePath(id)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("تعذر قراءة القالب: %w", err)
	}
	return string(data), nil
}

// RenderInvoiceHTML loads the HTML template and substitutes invoice data tags.
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
		// Fallback: use built-in default template
		return substituteInvoiceTags(defaultInvoiceHTMLTemplate(), inv), nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return substituteInvoiceTags(defaultInvoiceHTMLTemplate(), inv), nil
	}

	return substituteInvoiceTags(string(data), inv), nil
}

// ─── Tag Substitution Engine ──────────────────────────────────────────────────

func substituteInvoiceTags(tpl string, inv *InvoiceView) string {
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

	buyerPhone := ""
	if inv.ClientSnapshot != nil {
		buyerPhone = inv.ClientSnapshot.Phone
		if buyerPhone == "" {
			buyerPhone = inv.ClientSnapshot.Mobile
		}
	}

	sellerName, sellerTax, sellerAddress, sellerCR := "", "", "", ""
	if inv.IssuerSnapshot != nil {
		sellerName = inv.IssuerSnapshot.NameAr
		sellerTax = inv.IssuerSnapshot.TaxNumber
		sellerAddress = inv.IssuerSnapshot.Street + " " + inv.IssuerSnapshot.City
		sellerCR = inv.IssuerSnapshot.CommercialRegister
	}

	qrB64 := ""
	if inv.QrPayload != "" {
		if qrPNG, err := qrcode.Encode(inv.QrPayload, qrcode.Medium, 120); err == nil {
			qrB64 = `<img src="data:image/png;base64,` + base64.StdEncoding.EncodeToString(qrPNG) + `" alt="QR" style="width:100px;height:100px;" />`
		}
	}

	sellerPhone, sellerEmail := "", ""
	if inv.IssuerSnapshot != nil {
		sellerPhone = inv.IssuerSnapshot.Phone
		sellerEmail = inv.IssuerSnapshot.Email
	}

	result := strings.NewReplacer(
		"{{invoice_number}}", inv.InvoiceNumber,
		"{{issue_date}}", inv.IssueDate,
		"{{due_date}}", func() string {
			if inv.DueDate != nil {
				return *inv.DueDate
			}
			return ""
		}(),
		"{{issue_time}}", inv.IssueTime,
		"{{seller_name}}", sellerName,
		"{{seller_tax}}", sellerTax,
		"{{seller_address}}", sellerAddress,
		"{{seller_cr}}", sellerCR,
		"{{seller_phone}}", sellerPhone,
		"{{seller_email}}", sellerEmail,
		"{{buyer_name}}", buyerName,
		"{{buyer_tax}}", buyerTax,
		"{{buyer_address}}", buyerAddress,
		"{{buyer_phone}}", buyerPhone,
		"{{subtotal}}", fmt.Sprintf("%.2f", inv.SubtotalMajor),
		"{{discount}}", fmt.Sprintf("%.2f", inv.DiscountAmountMajor),
		"{{tax_amount}}", fmt.Sprintf("%.2f", inv.TaxAmountMajor),
		"{{grand_total}}", fmt.Sprintf("%.2f", inv.GrandTotalMajor),
		"{{payment_method}}", inv.PaymentMethod,
		"{{notes}}", inv.Notes,
		"{{items_table}}", generateItemsTable(inv),
		"{{qr_code}}", qrB64,
		"{{voucher_number}}", inv.InvoiceNumber,
		"{{voucher_date}}", inv.IssueDate,
		"{{received_from}}", buyerName,
		"{{amount}}", fmt.Sprintf("%.2f", inv.GrandTotalMajor),
		"{{paid_for}}", inv.Notes,
		"{{receiver_name}}", sellerName,
		"{{currency_symbol}}", SarSymbolSVG,
		"{{sar_symbol}}", SarSymbolSVG,
		"{{currency}}", "SAR",
	).Replace(tpl)

	return result
}

func generateItemsTable(inv *InvoiceView) string {
	var sb strings.Builder
	sb.WriteString(`<table style="width:100%;border-collapse:collapse;font-size:12px;" dir="rtl">`)
	sb.WriteString(`<thead><tr style="background:#059669;color:#fff;">`)
	for _, h := range []string{"#", "الصنف / الخدمة", "الكمية", "سعر الوحدة", "الضريبة", "الإجمالي"} {
		sb.WriteString(`<th style="padding:6px 8px;text-align:right;border:1px solid #ccc;">` + h + `</th>`)
	}
	sb.WriteString(`</tr></thead><tbody>`)

	for i, item := range inv.Lines {
		bg := "#fff"
		if i%2 == 1 {
			bg = "#f0fdf4"
		}
		sb.WriteString(fmt.Sprintf(`<tr style="background:%s;">`, bg))
		sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;border:1px solid #e2e8f0;">%d</td>`, i+1))
		sb.WriteString(`<td style="padding:5px 8px;border:1px solid #e2e8f0;">` + item.ItemName + `</td>`)
		sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:center;">%.2f</td>`, item.Quantity))
		sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;border:1px solid #e2e8f0;">%.2f</td>`, item.UnitPriceMajor))
		sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;border:1px solid #e2e8f0;">%.2f</td>`, item.TaxAmountMajor))
		sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;border:1px solid #e2e8f0;font-weight:700;">%.2f</td>`, item.TotalLineMajor))
		sb.WriteString(`</tr>`)
	}

	sb.WriteString(`</tbody></table>`)
	return sb.String()
}

// ─── Builder Config (Save / Load) ─────────────────────────────────────────────

func (s *TemplateService) GetBuilderConfig(id string) (map[string]any, error) {
	var val string
	err := s.db.QueryRow("SELECT value FROM meta WHERE key = ?", "tpl_builder_config_"+id).Scan(&val)
	if err == nil {
		var res map[string]any
		if err := json.Unmarshal([]byte(val), &res); err == nil {
			// Normalise: wrap raw keys into builder_config if needed
			if _, hasBc := res["builder_config"]; !hasBc {
				bc := make(map[string]any, len(res))
				for k, v := range res {
					bc[k] = v
				}
				return map[string]any{"builder_config": bc}, nil
			}
			return res, nil
		}
	}
	return map[string]any{}, err
}

// SaveBuilderConfig saves the builder config, writes the HTML template to disk,
// and registers it in the catalog.
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

	// 1. Save HTML to disk
	outDir := filepath.Join(s.dataDir, "templates", category)
	_ = os.MkdirAll(outDir, 0755)
	filePath := filepath.Join(outDir, id+".html")

	htmlContent := ""
	if h, ok := cfgMap["html_content"].(string); ok {
		htmlContent = h
	}
	if htmlContent == "" {
		// Generate a minimal default HTML template
		htmlContent = buildDefaultHTMLFromConfig(cfgMap, category)
	}
	_ = os.WriteFile(filePath, []byte(htmlContent), 0644)

	badge := "مخصص"
	if category == "documents" {
		badge = "سند مخصص"
	}

	// 2. Upsert in catalog
	_, _ = s.db.Exec(`
		INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, is_active, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			name_ar = excluded.name_ar,
			category = excluded.category,
			file_path = excluded.file_path,
			color_hex = excluded.color_hex,
			updated_at = CURRENT_TIMESTAMP
	`, id, nameAr, id, "قالب HTML من محرر القوالب", badge, category, filePath, primaryColor)

	// 3. Save full builder config in meta table
	_, err = s.db.Exec(`
		INSERT INTO meta (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, "tpl_builder_config_"+id, string(b))
	return err
}

// buildDefaultHTMLFromConfig generates a minimal invoice/voucher HTML template
// from builder cfg when the user didn't provide html_content.
func buildDefaultHTMLFromConfig(cfg map[string]any, category string) string {
	color := "#059669"
	if c, ok := cfg["primary_color"].(string); ok && c != "" {
		color = c
	}
	name := "قالب مخصص"
	if n, ok := cfg["name_ar"].(string); ok && n != "" {
		name = n
	}
	if category == "documents" {
		return defaultVoucherHTMLTemplate()
	}
	_ = name
	_ = color
	return defaultInvoiceHTMLTemplate()
}

// ─── Default Built-in HTML Templates ─────────────────────────────────────────

func defaultInvoiceHTMLTemplate() string {
	return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Tahoma, 'Cairo', Arial, sans-serif; font-size: 13px; color: #1e293b; background: #fff; margin: 0; padding: 10mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #059669; padding-bottom: 10px; margin-bottom: 14px; }
  .header-title { font-size: 22px; font-weight: 900; color: #059669; }
  .header-meta { font-size: 11px; line-height: 1.9; }
  .section { margin-bottom: 12px; }
  .section-title { font-weight: 700; font-size: 12px; color: #fff; background: #059669; padding: 4px 10px; border-radius: 4px; display: inline-block; margin-bottom: 6px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; }
  .info-row { display: flex; gap: 6px; }
  .info-label { color: #64748b; font-size: 11px; min-width: 90px; }
  .info-value { font-weight: 600; }
  .totals { margin-top: 10px; border-top: 2px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: flex-end; }
  .totals-table { font-size: 12px; border-collapse: collapse; min-width: 280px; }
  .totals-table td { padding: 4px 10px; }
  .totals-table tr:last-child td { font-weight: 900; font-size: 14px; color: #059669; border-top: 2px solid #059669; }
  .footer { margin-top: 14px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  .qr-wrap { text-align: left; margin-top: 10px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="header-title">{{seller_name}}</div>
    <div style="font-size:11px;color:#64748b;">الرقم الضريبي: {{seller_tax}}</div>
    <div style="font-size:11px;color:#64748b;">{{seller_address}}</div>
  </div>
  <div class="header-meta">
    <div><strong>فاتورة ضريبية</strong></div>
    <div>رقم الفاتورة: <strong>{{invoice_number}}</strong></div>
    <div>تاريخ الإصدار: <strong>{{issue_date}}</strong></div>
    <div>تاريخ الاستحقاق: <strong>{{due_date}}</strong></div>
    <div>طريقة الدفع: <strong>{{payment_method}}</strong></div>
  </div>
</div>

<div class="section">
  <div class="section-title">بيانات العميل</div>
  <div class="info-grid">
    <div class="info-row"><span class="info-label">الاسم:</span><span class="info-value">{{buyer_name}}</span></div>
    <div class="info-row"><span class="info-label">الرقم الضريبي:</span><span class="info-value">{{buyer_tax}}</span></div>
    <div class="info-row"><span class="info-label">العنوان:</span><span class="info-value">{{buyer_address}}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">الأصناف والخدمات</div>
  {{items_table}}
</div>

<div class="totals">
  <table class="totals-table">
    <tr><td>المجموع قبل الضريبة</td><td style="text-align:left;">{{subtotal}} ر.س</td></tr>
    <tr><td>الخصم</td><td style="text-align:left;">{{discount}} ر.س</td></tr>
    <tr><td>ضريبة القيمة المضافة (15%)</td><td style="text-align:left;">{{tax_amount}} ر.س</td></tr>
    <tr><td>الإجمالي المستحق</td><td style="text-align:left;">{{grand_total}} ر.س</td></tr>
  </table>
</div>

<div class="qr-wrap">{{qr_code}}</div>

<div class="footer">
  {{notes}}<br/>
  هذه الفاتورة صادرة إلكترونياً ولا تحتاج إلى توقيع يدوي
</div>
</body>
</html>`
}

func defaultVoucherHTMLTemplate() string {
	return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Tahoma, 'Cairo', Arial, sans-serif; font-size: 13px; color: #1e293b; background: #fff; margin: 0; padding: 10mm; }
  .header { text-align: center; border-bottom: 3px solid #7c3aed; padding-bottom: 10px; margin-bottom: 16px; }
  .header-title { font-size: 24px; font-weight: 900; color: #7c3aed; }
  .voucher-box { border: 2px solid #7c3aed; border-radius: 8px; padding: 16px; margin-bottom: 14px; }
  .info-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 13px; }
  .info-row:last-child { border-bottom: none; }
  .info-label { color: #64748b; }
  .info-value { font-weight: 700; }
  .amount-box { text-align: center; background: #f5f3ff; border-radius: 6px; padding: 14px; margin: 14px 0; }
  .amount-value { font-size: 28px; font-weight: 900; color: #7c3aed; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 30px; }
  .sig-line { width: 40%; border-top: 1px solid #64748b; text-align: center; padding-top: 6px; font-size: 11px; color: #64748b; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="header">
  <div class="header-title">سند قبض</div>
  <div style="font-size:12px;color:#64748b;">{{seller_name}} — الرقم الضريبي: {{seller_tax}}</div>
</div>

<div class="voucher-box">
  <div class="info-row"><span class="info-label">رقم السند:</span><span class="info-value">{{invoice_number}}</span></div>
  <div class="info-row"><span class="info-label">التاريخ:</span><span class="info-value">{{issue_date}}</span></div>
  <div class="info-row"><span class="info-label">استلمنا من:</span><span class="info-value">{{buyer_name}}</span></div>
  <div class="info-row"><span class="info-label">البيان:</span><span class="info-value">{{notes}}</span></div>
  <div class="info-row"><span class="info-label">طريقة الدفع:</span><span class="info-value">{{payment_method}}</span></div>
</div>

<div class="amount-box">
  <div style="font-size:13px;color:#64748b;margin-bottom:4px;">المبلغ المستلم</div>
  <div class="amount-value">{{grand_total}} ر.س</div>
</div>

<div class="qr-wrap" style="text-align:left;">{{qr_code}}</div>

<div class="sig-row">
  <div class="sig-line">توقيع المستلم</div>
  <div class="sig-line">توقيع المسلّم</div>
</div>
</body>
</html>`
}

func init() {
	var _ = sql.ErrNoRows
	_ = moneySarRegex1
	_ = moneySarRegex2
	_ = SarSymbolSVG
}
