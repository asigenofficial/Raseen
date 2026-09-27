package services

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/skip2/go-qrcode"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/zatca"
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
// and registers them in the excel_templates catalog table without overwriting
// custom template names or IDs.
func (s *TemplateService) SyncDiskTemplates() error {
	dirs := []struct {
		relPath  string
		category string
		badge    string
	}{
		{filepath.Join(s.dataDir, "templates", "invoices"), "invoices", "فاتورة HTML"},
		{filepath.Join(s.dataDir, "templates", "documents"), "documents", "سند HTML"},
	}

	type existingTpl struct {
		id       string
		nameAr   string
		badge    string
		category string
		filePath string
		colorHex string
	}
	existingByPath := make(map[string]existingTpl)
	existingByID := make(map[string]existingTpl)

	rows, err := s.db.Query(`SELECT id, name_ar, badge, category, file_path, color_hex FROM excel_templates`)
	if err == nil {
		for rows.Next() {
			var t existingTpl
			if errScan := rows.Scan(&t.id, &t.nameAr, &t.badge, &t.category, &t.filePath, &t.colorHex); errScan == nil {
				existingByPath[filepath.Clean(t.filePath)] = t
				existingByID[t.id] = t
			}
		}
		rows.Close()
	}

	seenPathsOnDisk := make(map[string]bool)

	isUuidStr := func(s string) bool {
		s = strings.TrimSpace(s)
		if len(s) == 36 && strings.Count(s, "-") == 4 {
			return true
		}
		if strings.HasPrefix(s, "tpl_") && len(s) > 30 {
			return true
		}
		return false
	}

	for _, d := range dirs {
		entries, err := os.ReadDir(d.relPath)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".html") {
				continue
			}
			fullPath := filepath.Clean(filepath.Join(d.relPath, entry.Name()))
			seenPathsOnDisk[fullPath] = true

			baseName := strings.TrimSuffix(entry.Name(), ".html")
			contentBytes, _ := os.ReadFile(fullPath)
			htmlStr := string(contentBytes)
			tags := extractHtmlPlaceholders(htmlStr)
			headersJson, _ := json.Marshal(tags)

			// Try to extract title from HTML if available
			titleFromHtml := ""
			titleRegex := regexp.MustCompile(`(?i)<title>(.*?)</title>`)
			if m := titleRegex.FindStringSubmatch(htmlStr); len(m) > 1 {
				titleFromHtml = strings.TrimSpace(m[1])
			}

			// Check if we have an existing record for this path or baseName
			ex, hasExisting := existingByPath[fullPath]
			if !hasExisting {
				ex, hasExisting = existingByID[baseName]
			}

			// Check if this template has a saved builder config in meta table
			var metaNameAr string
			var metaColor string
			var metaType string
			var metaVal string
			if errMeta := s.db.QueryRow("SELECT value FROM meta WHERE key = ? OR key = ?", "tpl_builder_config_"+baseName, "tpl_builder_config_"+ex.id).Scan(&metaVal); errMeta == nil && metaVal != "" {
				var bc map[string]any
				if errJson := json.Unmarshal([]byte(metaVal), &bc); errJson == nil {
					if n, ok := bc["name_ar"].(string); ok && strings.TrimSpace(n) != "" {
						metaNameAr = strings.TrimSpace(n)
					}
					if c, ok := bc["primary_color"].(string); ok && strings.TrimSpace(c) != "" {
						metaColor = strings.TrimSpace(c)
					}
					if tp, ok := bc["type"].(string); ok && strings.TrimSpace(tp) != "" {
						metaType = strings.TrimSpace(tp)
					}
				}
			}

			var id, nameAr, category, badge, colorHex string

			if isUuidStr(baseName) {
				// Custom template created via template-builder
				id = baseName
				if hasExisting && ex.id != "" && ex.id != baseName {
					// Clean up legacy hash ID row to avoid duplicate entries
					_, _ = s.db.Exec("DELETE FROM excel_templates WHERE id = ?", ex.id)
				}

				if hasExisting && !isUuidStr(ex.nameAr) && strings.TrimSpace(ex.nameAr) != "" && ex.nameAr != "قالب مخصص" {
					nameAr = ex.nameAr
				} else if metaNameAr != "" {
					nameAr = metaNameAr
				} else if titleFromHtml != "" && !isUuidStr(titleFromHtml) && titleFromHtml != "قالب فواتير مخصص" && titleFromHtml != "قالب سند مالي مخصص" {
					nameAr = titleFromHtml
				} else if hasExisting && ex.nameAr != "" && !isUuidStr(ex.nameAr) {
					nameAr = ex.nameAr
				} else {
					nameAr = "قالب مخصص"
				}

				category = d.category
				if metaType != "" {
					category = metaType
				}
				badge = "مخصص"
				if category == "documents" {
					badge = "سند مخصص"
				}
				colorHex = "#059669"
				if metaColor != "" {
					colorHex = metaColor
				} else if hasExisting && ex.colorHex != "" {
					colorHex = ex.colorHex
				}
			} else {
				// Preset / default file
				if hasExisting && !isUuidStr(ex.nameAr) && strings.TrimSpace(ex.nameAr) != "" {
					id = ex.id
					nameAr = ex.nameAr
					category = ex.category
					badge = ex.badge
					colorHex = ex.colorHex
				} else if titleFromHtml != "" && !isUuidStr(titleFromHtml) {
					h := sha256.Sum256([]byte(d.category + "/" + entry.Name()))
					id = "tpl_" + hex.EncodeToString(h[:4])
					nameAr = titleFromHtml
					badge = d.badge
					colorHex = "#059669"
					category = d.category
				} else {
					h := sha256.Sum256([]byte(d.category + "/" + entry.Name()))
					id = "tpl_" + hex.EncodeToString(h[:4])
					nameAr = strings.ReplaceAll(baseName, "_", " ")
					badge = d.badge
					colorHex = "#059669"
					category = d.category
				}
			}

			_, _ = s.db.Exec(`
				INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, is_active, updated_at)
				VALUES (?, ?, '', 'قالب معتمد في النظام', ?, ?, ?, ?, ?, 1, ?)
				ON CONFLICT(id) DO UPDATE SET
					name_ar = excluded.name_ar,
					file_path = excluded.file_path,
					category = excluded.category,
					badge = excluded.badge,
					color_hex = excluded.color_hex,
					headers_json = excluded.headers_json,
					updated_at = excluded.updated_at
			`, id, nameAr, badge, category, fullPath, colorHex, string(headersJson), db.NowIso())
		}
	}

	// Clean up templates whose files were removed from disk (only for disk templates)
	for p, t := range existingByPath {
		if strings.Contains(p, "templates") && !seenPathsOnDisk[p] {
			_, _ = s.db.Exec("DELETE FROM excel_templates WHERE id = ?", t.id)
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
	if id == "" {
		return "", errors.New("empty template id")
	}

	cleanId := strings.TrimSuffix(id, ".html")

	// 1. Direct query by id, name_ar, or file_path in DB
	var filePath string
	err := s.db.QueryRow(`
		SELECT file_path FROM excel_templates 
		WHERE id = ? OR name_ar = ? OR file_path LIKE ? OR file_path LIKE ?
		LIMIT 1
	`, id, cleanId, "%"+id+"%", "%"+cleanId+"%").Scan(&filePath)
	if err == nil && filePath != "" {
		if _, errStat := os.Stat(filePath); errStat == nil {
			return filePath, nil
		}
	}

	// 2. Direct search on disk by filename in templates/invoices and templates/documents
	for _, sub := range []string{"invoices", "documents"} {
		// exact match
		exact := filepath.Join(s.dataDir, "templates", sub, cleanId+".html")
		if _, errStat := os.Stat(exact); errStat == nil {
			return exact, nil
		}
		// case/space insensitive match
		entries, err := os.ReadDir(filepath.Join(s.dataDir, "templates", sub))
		if err == nil {
			for _, e := range entries {
				base := strings.TrimSuffix(e.Name(), ".html")
				if strings.EqualFold(base, cleanId) || strings.EqualFold(strings.ReplaceAll(base, " ", "_"), strings.ReplaceAll(cleanId, " ", "_")) {
					return filepath.Join(s.dataDir, "templates", sub, e.Name()), nil
				}
				if strings.Contains(strings.ToLower(e.Name()), strings.ToLower(cleanId)) {
					return filepath.Join(s.dataDir, "templates", sub, e.Name()), nil
				}
			}
		}
	}

	// 3. Resync from disk and retry DB
	_ = s.SyncDiskTemplates()
	err = s.db.QueryRow(`
		SELECT file_path FROM excel_templates 
		WHERE id = ? OR name_ar = ? OR file_path LIKE ? OR file_path LIKE ?
		LIMIT 1
	`, id, cleanId, "%"+id+"%", "%"+cleanId+"%").Scan(&filePath)
	if err == nil && filePath != "" {
		if _, errStat := os.Stat(filePath); errStat == nil {
			return filePath, nil
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

// GenerateQRSVG generates an ultra-sharp, high-resolution vector SVG representation of the ZATCA QR code.
// Being pure vector SVG with shape-rendering="crispEdges", it never loses modules or suffers nearest-neighbor
// resampling artifacts when scaled or printed, allowing all phone cameras and ZATCA scanners to scan it easily.
func GenerateQRSVG(payload string) string {
	qr, err := qrcode.New(payload, qrcode.Medium)
	if err != nil {
		return ""
	}
	bm := qr.Bitmap()
	n := len(bm)
	if n == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges" class="zatca-qr-svg" style="width:125px;height:125px;max-width:100%%;max-height:100%%;display:block;margin:0 auto;">`, n, n))
	sb.WriteString(fmt.Sprintf(`<rect width="%d" height="%d" fill="#ffffff"/>`, n, n))
	sb.WriteString(`<path fill="#000000" d="`)
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			if bm[y][x] {
				sb.WriteString(fmt.Sprintf("M%d,%dh1v1h-1z", x, y))
			}
		}
	}
	sb.WriteString(`"/></svg>`)
	return sb.String()
}

// formatNationalAddress يُنسق العنوان الوطني بالترتيب المعتمد: المدينة - الحي - الشارع - رقم المبنى - الرمز البريدي
func formatNationalAddress(city, district, street, buildingNo, postalCode string) string {
	parts := []string{}
	if c := strings.TrimSpace(city); c != "" {
		parts = append(parts, c)
	}
	if d := strings.TrimSpace(district); d != "" {
		if !strings.HasPrefix(d, "حي") {
			parts = append(parts, "حي "+d)
		} else {
			parts = append(parts, d)
		}
	}
	if s := strings.TrimSpace(street); s != "" {
		if !strings.HasPrefix(s, "شارع") && !strings.HasPrefix(s, "طريق") {
			parts = append(parts, "شارع "+s)
		} else {
			parts = append(parts, s)
		}
	}
	if b := strings.TrimSpace(buildingNo); b != "" {
		if !strings.HasPrefix(b, "مبنى") && !strings.HasPrefix(b, "رقم") {
			parts = append(parts, "مبنى "+b)
		} else {
			parts = append(parts, b)
		}
	}
	if p := strings.TrimSpace(postalCode); p != "" {
		parts = append(parts, p)
	}
	return strings.Join(parts, " - ")
}

// formatNationalAddressEn formats the national address in English: City - District - Street - Building No - Postal Code
func formatNationalAddressEn(cityEn, districtEn, streetEn, buildingNo, postalCode string) string {
	parts := []string{}
	if c := strings.TrimSpace(cityEn); c != "" {
		parts = append(parts, c)
	}
	if d := strings.TrimSpace(districtEn); d != "" {
		low := strings.ToLower(d)
		if !strings.Contains(low, "district") && !strings.Contains(low, "dist") {
			parts = append(parts, d+" Dist.")
		} else {
			parts = append(parts, d)
		}
	}
	if s := strings.TrimSpace(streetEn); s != "" {
		low := strings.ToLower(s)
		if !strings.Contains(low, "st") && !strings.Contains(low, "street") && !strings.Contains(low, "rd") {
			parts = append(parts, s+" St.")
		} else {
			parts = append(parts, s)
		}
	}
	if b := strings.TrimSpace(buildingNo); b != "" {
		low := strings.ToLower(b)
		if !strings.HasPrefix(low, "bldg") {
			parts = append(parts, "Bldg. "+b)
		} else {
			parts = append(parts, b)
		}
	}
	if p := strings.TrimSpace(postalCode); p != "" {
		parts = append(parts, p)
	}
	return strings.Join(parts, " - ")
}

// ─── Tag Substitution Engine ──────────────────────────────────────────────────

func substituteInvoiceTags(tpl string, inv *InvoiceView) string {
	buyerName := inv.BuyerName
	buyerTax := inv.BuyerTaxNumber
	buyerAddress := inv.BuyerAddress
	buyerPhone, buyerCode, buyerCity, buyerStreet, buyerDistrict, buyerPostalCode, buyerBuildingNo := "", "", "", "", "", "", ""
	if inv.ClientSnapshot != nil {
		if buyerName == "" {
			buyerName = inv.ClientSnapshot.Name
		}
		if buyerTax == "" {
			buyerTax = inv.ClientSnapshot.TaxNumber
		}
		buyerCode = inv.ClientSnapshot.ClientCode
		buyerCity = inv.ClientSnapshot.City
		buyerStreet = inv.ClientSnapshot.Street
		buyerDistrict = inv.ClientSnapshot.District
		buyerPostalCode = inv.ClientSnapshot.PostalCode
		buyerBuildingNo = inv.ClientSnapshot.BuildingNo
		buyerPhone = inv.ClientSnapshot.Phone
		if buyerPhone == "" {
			buyerPhone = inv.ClientSnapshot.Mobile
		}
		formattedBuyer := formatNationalAddress(buyerCity, buyerDistrict, buyerStreet, buyerBuildingNo, buyerPostalCode)
		if formattedBuyer != "" {
			buyerAddress = formattedBuyer
		} else if buyerAddress == "" {
			buyerAddress = inv.ClientSnapshot.Address
			if buyerAddress == "" {
				buyerAddress = inv.ClientSnapshot.City
			}
		}
	}
	if buyerCode == "" {
		buyerCode = inv.ClientCode
	}

	sellerName, sellerTax, sellerAddress, sellerCR, sellerCity, sellerCountry := "", "", "", "", "", ""
	sellerNameEn, sellerAddressEn, sellerPhone, sellerEmail := "", "", "", ""
	sellerLogoHtml := ""
	if inv.IssuerSnapshot != nil {
		sellerName = inv.IssuerSnapshot.NameAr
		sellerNameEn = inv.IssuerSnapshot.NameEn
		sellerTax = inv.IssuerSnapshot.TaxNumber
		sellerCity = inv.IssuerSnapshot.City
		sellerCountry = inv.IssuerSnapshot.Country
		sellerCR = inv.IssuerSnapshot.CommercialRegister
		sellerPhone = inv.IssuerSnapshot.Phone
		sellerEmail = inv.IssuerSnapshot.Email

		sellerAddress = formatNationalAddress(inv.IssuerSnapshot.City, inv.IssuerSnapshot.District, inv.IssuerSnapshot.Street, inv.IssuerSnapshot.BuildingNo, inv.IssuerSnapshot.PostalCode)
		if sellerAddress == "" {
			sellerAddress = strings.TrimSpace(inv.IssuerSnapshot.Street + " " + inv.IssuerSnapshot.City)
		}
		sellerAddressEn = formatNationalAddressEn(inv.IssuerSnapshot.CityEn, inv.IssuerSnapshot.DistrictEn, inv.IssuerSnapshot.StreetEn, inv.IssuerSnapshot.BuildingNo, inv.IssuerSnapshot.PostalCode)
		if sellerAddressEn == "" {
			sellerAddressEn = inv.IssuerSnapshot.AddressEn
			if sellerAddressEn == "" {
				sellerAddressEn = strings.TrimSpace(inv.IssuerSnapshot.StreetEn + " " + inv.IssuerSnapshot.CityEn)
			}
		}
		if inv.IssuerSnapshot.LogoData != nil && *inv.IssuerSnapshot.LogoData != "" {
			sellerLogoHtml = fmt.Sprintf(`<img src="%s" alt="Logo" style="max-height:75px;max-width:140px;object-fit:contain;" />`, *inv.IssuerSnapshot.LogoData)
		}
	}
	if sellerLogoHtml == "" {
		sellerLogoHtml = `<span style="font-size:26px;font-weight:900;color:#94a3b8;">شعار</span>`
	}

	qrB64 := ""
	payload := inv.QrPayload
	if payload == "" {
		sName := sellerName
		if sName == "" {
			sName = "شركة تجريبية للتقنية"
		}
		sTax := sellerTax
		if sTax == "" || len(sTax) != 15 {
			sTax = "300000000000003"
		}
		issDate := inv.IssueDate
		if issDate == "" {
			issDate = time.Now().Format("2006-01-02")
		}
		issTime := inv.IssueTime
		if issTime == "" {
			issTime = "12:00:00"
		}
		if len(issTime) == 5 {
			issTime += ":00"
		}
		tot := fmt.Sprintf("%.2f", inv.GrandTotalMajor)
		if tot == "0.00" {
			tot = "1150.00"
		}
		vat := fmt.Sprintf("%.2f", inv.TaxAmountMajor)
		if vat == "0.00" {
			vat = "150.00"
		}
		sampleParams := zatca.QrParams{
			SellerName: sName,
			VatNumber:  sTax,
			Timestamp:  issDate + "T" + issTime + "Z",
			Total:      tot,
			VatTotal:   vat,
		}
		payload = zatca.BuildQrPayload(sampleParams)
	}

	if svg := GenerateQRSVG(payload); svg != "" {
		qrB64 = svg
	} else if qrPNG, err := qrcode.Encode(payload, qrcode.Medium, 512); err == nil {
		qrB64 = `<img src="data:image/png;base64,` + base64.StdEncoding.EncodeToString(qrPNG) + `" alt="QR" style="width:125px;height:125px;display:block;margin:0 auto;" />`
	}

	totalQty := 0.0
	for _, it := range inv.Lines {
		totalQty += it.Quantity
	}

	paidAmount := inv.PaidAmountMajor
	if paidAmount == 0 && inv.GrandTotalMajor > 0 && (strings.Contains(inv.PaymentMethod, "نقد") || strings.Contains(strings.ToLower(inv.PaymentMethod), "cash")) {
		paidAmount = inv.GrandTotalMajor
	}
	remainingAmount := inv.RemainingAmountMajor
	if remainingAmount == 0 && inv.GrandTotalMajor > paidAmount {
		remainingAmount = inv.GrandTotalMajor - paidAmount
	}

	tpl = ensureItemsRowsInTbody(tpl)
	smartRows := generateSmartRows(tpl, inv)

	sellerMetaAr := ""
	if sellerTax != "" || sellerCR != "" {
		parts := []string{}
		if sellerTax != "" {
			parts = append(parts, "الرقم الضريبي: "+sellerTax)
		}
		if sellerCR != "" {
			parts = append(parts, "س.ت: "+sellerCR)
		}
		sellerMetaAr = strings.Join(parts, " | ")
	}

	sellerMetaEn := ""
	if sellerTax != "" || sellerCR != "" {
		parts := []string{}
		if sellerTax != "" {
			parts = append(parts, "VAT: "+sellerTax)
		}
		if sellerCR != "" {
			parts = append(parts, "C.R.: "+sellerCR)
		}
		sellerMetaEn = strings.Join(parts, " | ")
	}

	amountInWords := tafqeetArabic(inv.GrandTotalMajor)

	// تنظيف ذاتي: إذا قام الذكاء الاصطناعي أو المستخدم بتغليف وسم الشعار أو الباركود داخل <img src="{{logo}}">
	cleanImgLogoRegex := regexp.MustCompile(`(?i)<img\b[^>]*src=["']\{\{\s*(logo|seller_logo|company_logo|شعار|الشعار)\s*\}\}["'][^>]*>`)
	tpl = cleanImgLogoRegex.ReplaceAllString(tpl, "{{logo}}")

	cleanImgQrRegex := regexp.MustCompile(`(?i)<img\b[^>]*src=["']\{\{\s*(qr_code|qr|qrcode|barcode|zatca_qr|zatca_code|zatca_payload|رمز_الاستجابة|الباركود|باركود)\s*\}\}["'][^>]*>`)
	tpl = cleanImgQrRegex.ReplaceAllString(tpl, "{{qr_code}}")

	result := strings.NewReplacer(
		// ─── بيانات الفاتورة والمستند الأساسية ───
		"{{invoice_number}}", inv.InvoiceNumber,
		"{{issue_date}}", inv.IssueDate,
		"{{due_date}}", func() string {
			if inv.DueDate != nil {
				return *inv.DueDate
			}
			return ""
		}(),
		"{{issue_time}}", inv.IssueTime,
		"{{payment_method}}", inv.PaymentMethod,
		"{{notes}}", inv.Notes,

		// ─── المنشأة / المورد (الشعار وبيانات البائع) ───
		"{{logo}}", sellerLogoHtml,
		"{{seller_name}}", sellerName,
		"{{seller_name_en}}", sellerNameEn,
		"{{seller_tax}}", sellerTax,
		"{{seller_address}}", sellerAddress,
		"{{seller_address_en}}", sellerAddressEn,
		"{{seller_cr}}", sellerCR,
		"{{seller_city}}", sellerCity,
		"{{seller_country}}", sellerCountry,
		"{{seller_phone}}", sellerPhone,
		"{{seller_email}}", sellerEmail,
		"{{seller_meta_ar}}", sellerMetaAr,
		"{{seller_meta_en}}", sellerMetaEn,

		// ─── العميل / المشتري ───
		"{{buyer_name}}", buyerName,
		"{{buyer_code}}", buyerCode,
		"{{buyer_tax}}", buyerTax,
		"{{buyer_address}}", buyerAddress,
		"{{buyer_city}}", buyerCity,
		"{{buyer_street}}", buyerStreet,
		"{{buyer_district}}", buyerDistrict,
		"{{buyer_postal_code}}", buyerPostalCode,
		"{{buyer_building_no}}", buyerBuildingNo,
		"{{buyer_phone}}", buyerPhone,

		// ─── المبالغ والإجماليات والعملة ───
		"{{subtotal}}", fmt.Sprintf("%.2f", inv.SubtotalMajor),
		"{{discount}}", fmt.Sprintf("%.2f", inv.DiscountAmountMajor),
		"{{tax_amount}}", fmt.Sprintf("%.2f", inv.TaxAmountMajor),
		"{{grand_total}}", fmt.Sprintf("%.2f", inv.GrandTotalMajor),
		"{{paid_amount}}", fmt.Sprintf("%.2f", paidAmount),
		"{{remaining_amount}}", fmt.Sprintf("%.2f", remainingAmount),
		"{{amount_in_words}}", amountInWords,
		"{{tafqeet}}", amountInWords,
		"{{total_qty}}", func() string {
			if totalQty == float64(int64(totalQty)) {
				return fmt.Sprintf("%.0f", totalQty)
			}
			return fmt.Sprintf("%.2f", totalQty)
		}(),
		"{{currency}}", "SAR",
		"{{sar_symbol}}", SarSymbolSVG,
		"{{currency_symbol}}", SarSymbolSVG,

		// ─── جدول الأصناف والباركود ───
		"{{items_rows}}", smartRows,
		"{{items_table}}", generateItemsTable(inv),
		"{{qr_code}}", qrB64,

		// ─── سندات القبض والصرف والمستندات ───
		"{{voucher_number}}", inv.InvoiceNumber,
		"{{voucher_date}}", inv.IssueDate,
		"{{amount}}", fmt.Sprintf("%.2f", inv.GrandTotalMajor),
		"{{received_from}}", buyerName,
		"{{paid_for}}", inv.Notes,
		"{{receiver_name}}", sellerName,
	).Replace(tpl)

	// استبدال أي وسم صفوف أصناف مهما كان اسمه
	itemsRowsRegex := regexp.MustCompile(`\{\{\s*(items_rows[a-zA-Z0-9_-]*|items_table_body[a-zA-Z0-9_-]*|items_body[a-zA-Z0-9_-]*|table_rows[a-zA-Z0-9_-]*)\s*\}\}`)
	result = itemsRowsRegex.ReplaceAllString(result, smartRows)

	// استبدال ذكي لجميع وسوم الباركود ورمز الاستجابة السريع بكافة الصيغ الممكنة
	qrTagRegex := regexp.MustCompile(`(?i)\{\{\s*(qr_code|qr|qrcode|barcode|zatca_qr|zatca_code|zatca_payload|رمز_الاستجابة|الباركود|باركود)\s*\}\}`)
	result = qrTagRegex.ReplaceAllString(result, qrB64)

	// استبدال ذكي لجميع وسوم الشعار بكافة الصيغ الممكنة
	logoTagRegex := regexp.MustCompile(`(?i)\{\{\s*(logo|seller_logo|company_logo|شعار|الشعار)\s*\}\}`)
	result = logoTagRegex.ReplaceAllString(result, sellerLogoHtml)

	// إذا لم يحتوِ القالب على وسم باركود صريح ولكنه يحتوي على حاوية باركود في الكود (كلاس أو آيدي)
	if !strings.Contains(tpl, "{{qr") && !strings.Contains(tpl, "{{barcode") && !strings.Contains(tpl, "{{zatca") && !strings.Contains(tpl, "{{باركود") {
		qrContainerRegex := regexp.MustCompile(`(?i)(<div\b[^>]*(?:class|id)=["'][^"']*(?:qr-img-placeholder|qr-box|qr-frame|qr-wrap|qr-container|qr-code|qrcode)[^"']*["'][^>]*>)([\s\S]*?)(</div>)`)
		if qrContainerRegex.MatchString(result) {
			result = qrContainerRegex.ReplaceAllString(result, "${1}"+qrB64+"${3}")
		}
	}

	// إذا لم يحتوِ القالب على وسم شعار صريح ولكنه يحتوي على حاوية شعار في الكود
	if !strings.Contains(tpl, "{{logo") && !strings.Contains(tpl, "{{شعار") && !strings.Contains(tpl, "{{seller_logo") && !strings.Contains(tpl, "{{company_logo") {
		logoContainerRegex := regexp.MustCompile(`(?i)(<div\b[^>]*(?:class|id)=["'][^"']*(?:logo-container|logo-slot|logo-placeholder|company-logo|seller-logo)[^"']*["'][^>]*>)([\s\S]*?)(</div>)`)
		if logoContainerRegex.MatchString(result) {
			result = logoContainerRegex.ReplaceAllString(result, "${1}"+sellerLogoHtml+"${3}")
		}
	}

	// استبدال ذكي إضافي إذا كان القالب يحتوي على tbody ثابت أو فارغ بدون وسوم
	tbodyRegex := regexp.MustCompile(`(?i)(<tbody\b[^>]*>)([\s\S]*?)(</tbody>)`)
	if tbodyRegex.MatchString(result) && !strings.Contains(tpl, "{{items_rows") && !strings.Contains(tpl, "{{items_table") {
		result = tbodyRegex.ReplaceAllString(result, "${1}"+smartRows+"${3}")
	}

	return result
}

type colType int

const (
	colIndex colType = iota
	colCode
	colName
	colUnit
	colPrice
	colQty
	colTaxable
	colDiscount
	colTaxRate
	colTaxAmount
	colTotal
	colNotes
)

func detectColumnType(th string) colType {
	clean := strings.ToLower(stripHtmlTags(th))
	clean = strings.Join(strings.Fields(clean), " ")

	if strings.Contains(clean, "شامل") || strings.Contains(clean, "مع الضريبة") || strings.Contains(clean, "صافي") || strings.Contains(clean, "with vat") || strings.Contains(clean, "total with") || strings.Contains(clean, "gross") {
		return colTotal
	}
	if strings.Contains(clean, "رقم الصنف") || strings.Contains(clean, "رقم البند") || strings.Contains(clean, "كود") || strings.Contains(clean, "رمز") || strings.Contains(clean, "item code") || strings.Contains(clean, "item_code") || strings.Contains(clean, "sku") || strings.Contains(clean, "barcode") || strings.Contains(clean, "item no") || strings.Contains(clean, "item_no") || strings.Contains(clean, "part no") {
		return colCode
	}
	if clean == "#" || clean == "م" || clean == "ت" || clean == "م." || strings.Contains(clean, "تسلسل") || clean == "no" || clean == "no." || clean == "sr" || clean == "sn" {
		return colIndex
	}
	if strings.Contains(clean, "سعر") || strings.Contains(clean, "price") {
		return colPrice
	}
	if strings.Contains(clean, "كمية") || strings.Contains(clean, "qty") || strings.Contains(clean, "quantity") || strings.Contains(clean, "عدد") {
		return colQty
	}
	if strings.Contains(clean, "وحدة") || strings.Contains(clean, "unit") || strings.Contains(clean, "uom") {
		return colUnit
	}
	if strings.Contains(clean, "خصم") || strings.Contains(clean, "discount") {
		return colDiscount
	}
	if strings.Contains(clean, "نسبة") || strings.Contains(clean, "rate") || clean == "%" || clean == "15%" {
		return colTaxRate
	}
	if strings.Contains(clean, "ضريبة") || strings.Contains(clean, "vat") || strings.Contains(clean, "tax") {
		return colTaxAmount
	}
	if strings.Contains(clean, "قبل") || strings.Contains(clean, "خاضع") || strings.Contains(clean, "taxable") || strings.Contains(clean, "إجمالي") || strings.Contains(clean, "subtotal") || strings.Contains(clean, "total") || strings.Contains(clean, "مبلغ") {
		return colTaxable
	}
	if strings.Contains(clean, "ملاحظ") || strings.Contains(clean, "note") {
		return colNotes
	}
	return colName
}

func stripHtmlTags(s string) string {
	re := regexp.MustCompile(`<[^>]*>`)
	return re.ReplaceAllString(s, " ")
}

func extractTableHeaders(htmlSnippet string) []string {
	tableRegex := regexp.MustCompile(`(?i)<table\b[^>]*>([\s\S]*?)</table>`)
	tableMatches := tableRegex.FindAllString(htmlSnippet, -1)
	targetTableHtml := ""
	for _, tbl := range tableMatches {
		if strings.Contains(tbl, "items_rows") || strings.Contains(tbl, "items_table_body") || strings.Contains(tbl, "items_body") || strings.Contains(tbl, "table_rows") {
			targetTableHtml = tbl
			break
		}
	}
	if targetTableHtml == "" {
		for _, tbl := range tableMatches {
			lower := strings.ToLower(tbl)
			if strings.Contains(lower, "وصف") || strings.Contains(lower, "صنف") || strings.Contains(lower, "بيان") || strings.Contains(lower, "كمية") || strings.Contains(lower, "سعر") || strings.Contains(lower, "item") || strings.Contains(lower, "qty") || strings.Contains(lower, "price") {
				targetTableHtml = tbl
				break
			}
		}
	}
	if targetTableHtml == "" {
		targetTableHtml = htmlSnippet
	}

	thRegex := regexp.MustCompile(`(?i)<th\b[^>]*>([\s\S]*?)</th>`)
	matches := thRegex.FindAllStringSubmatch(targetTableHtml, -1)
	if len(matches) > 0 {
		headers := make([]string, 0, len(matches))
		for _, m := range matches {
			if len(m) > 1 {
				headers = append(headers, m[1])
			}
		}
		return headers
	}

	// Try <td> in the first <tr>
	trRegex := regexp.MustCompile(`(?i)<tr\b[^>]*>([\s\S]*?)</tr>`)
	if trMatch := trRegex.FindStringSubmatch(targetTableHtml); len(trMatch) > 1 {
		tdRegex := regexp.MustCompile(`(?i)<td\b[^>]*>([\s\S]*?)</td>`)
		tdMatches := tdRegex.FindAllStringSubmatch(trMatch[1], -1)
		if len(tdMatches) > 0 {
			headers := make([]string, 0, len(tdMatches))
			for _, m := range tdMatches {
				if len(m) > 1 {
					headers = append(headers, m[1])
				}
			}
			return headers
		}
	}

	return nil
}

func ensureItemsRowsInTbody(tpl string) string {
	tbodyRegex := regexp.MustCompile(`(?i)<tbody\b[^>]*>([\s\S]*?)</tbody>`)
	hasInTbody := false
	for _, m := range tbodyRegex.FindAllStringSubmatch(tpl, -1) {
		if len(m) > 1 && strings.Contains(m[1], "items_rows") {
			hasInTbody = true
			break
		}
	}

	if hasInTbody {
		// الوسم موجود داخل tbody بالفعل، لكن قد يكون الذكاء الاصطناعي كتبه أيضاً خارج الجدول بالخطأ
		// نحمي الوسم الموجود داخل tbody ونحذف أي وسم شارد خارج أي tbody
		cleanTpl := tbodyRegex.ReplaceAllStringFunc(tpl, func(tb string) string {
			return strings.ReplaceAll(tb, "{{items_rows}}", "___SAFE_ITEMS_ROWS___")
		})
		strayRegex := regexp.MustCompile(`\{\{\s*(items_rows[a-zA-Z0-9_-]*|items_table_body[a-zA-Z0-9_-]*|items_body[a-zA-Z0-9_-]*|table_rows[a-zA-Z0-9_-]*)\s*\}\}`)
		cleanTpl = strayRegex.ReplaceAllString(cleanTpl, "")
		return strings.ReplaceAll(cleanTpl, "___SAFE_ITEMS_ROWS___", "{{items_rows}}")
	}

	// إذا لم يكن موجوداً داخل أي tbody على الإطلاق:
	// 1. نحذف أي وسم شارد خارج الجداول حتى لا يظهر مبعثراً كسطر نصي
	strayRegex := regexp.MustCompile(`\{\{\s*(items_rows[a-zA-Z0-9_-]*|items_table_body[a-zA-Z0-9_-]*|items_body[a-zA-Z0-9_-]*|table_rows[a-zA-Z0-9_-]*)\s*\}\}`)
	tpl = strayRegex.ReplaceAllString(tpl, "")

	// 2. نبحث عن جدول الأصناف الرئيسي (الذي يحتوي على كلمات دالة كالأصناف والأسعار) ونضع {{items_rows}} داخل tbody فيه
	tableRegex := regexp.MustCompile(`(?i)(<table\b[^>]*>[\s\S]*?)(<tbody\b[^>]*>)([\s\S]*?)(</tbody>)([\s\S]*?</table>)`)
	replaced := false
	tpl = tableRegex.ReplaceAllStringFunc(tpl, func(tbl string) string {
		if replaced {
			return tbl
		}
		lower := strings.ToLower(tbl)
		if strings.Contains(lower, "صنف") || strings.Contains(lower, "وصف") || strings.Contains(lower, "بيان") || strings.Contains(lower, "كمية") || strings.Contains(lower, "سعر") || strings.Contains(lower, "item") || strings.Contains(lower, "qty") || strings.Contains(lower, "price") {
			replaced = true
			subMatch := tableRegex.FindStringSubmatch(tbl)
			if len(subMatch) >= 6 {
				return subMatch[1] + subMatch[2] + "\n{{items_rows}}\n" + subMatch[4] + subMatch[5]
			}
		}
		return tbl
	})

	if !replaced {
		firstTbodyRegex := regexp.MustCompile(`(?i)(<tbody\b[^>]*>)([\s\S]*?)(</tbody>)`)
		tpl = firstTbodyRegex.ReplaceAllString(tpl, "${1}\n{{items_rows}}\n${3}")
	}

	footerBrandRegex := regexp.MustCompile(`(?i)<div\b[^>]*class=["'][^"']*footer-brand[^"']*["'][^>]*>[\s\S]*?</div>`)
	tpl = footerBrandRegex.ReplaceAllString(tpl, "")

	promoRegex := regexp.MustCompile(`(?i)<div\b[^>]*>\s*تم إنشاء وطباعة هذا المستند عبر نظام رصين[^<]*</div>`)
	tpl = promoRegex.ReplaceAllString(tpl, "")

	return tpl
}

func generateSmartRows(tpl string, inv *InvoiceView) string {
	headers := extractTableHeaders(tpl)
	var cols []colType
	hasCodeCol := false
	if len(headers) > 0 {
		cols = make([]colType, len(headers))
		for i, h := range headers {
			cols[i] = detectColumnType(h)
			if cols[i] == colCode {
				hasCodeCol = true
			}
		}
	} else {
		cols = []colType{colIndex, colName, colQty, colUnit, colPrice, colTaxable, colDiscount, colTaxAmount, colTaxRate, colTotal}
	}

	var sb strings.Builder
	for i, item := range inv.Lines {
		bg := "#fff"
		if i%2 == 1 {
			bg = "#fafafa"
		}
		sb.WriteString(fmt.Sprintf(`<tr style="background:%s;">`, bg))
		for _, col := range cols {
			switch col {
			case colIndex:
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;">%d</td>`, i+1))
			case colCode:
				code := item.ItemCode
				if code == "" {
					code = "—"
				}
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;">%s</td>`, html.EscapeString(code)))
			case colName:
				nameHtml := html.EscapeString(item.ItemName)
				if !hasCodeCol && item.ItemCode != "" {
					nameHtml += fmt.Sprintf(`<div style="font-size:0.75rem;color:#6b7280;font-family:Tahoma,sans-serif;direction:ltr;text-align:right;">%s</div>`, html.EscapeString(item.ItemCode))
				}
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;font-weight:600;text-align:right;">%s</td>`, nameHtml))
			case colUnit:
				u := item.Unit
				if u == "" {
					u = "حبة"
				}
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;">%s</td>`, html.EscapeString(u)))
			case colPrice:
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;">%.2f</td>`, item.UnitPriceMajor))
			case colQty:
				if item.Quantity == float64(int64(item.Quantity)) {
					sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;">%.0f</td>`, item.Quantity))
				} else {
					sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;">%.2f</td>`, item.Quantity))
				}
			case colTaxable:
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;">%.2f</td>`, item.TaxableMajor))
			case colDiscount:
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;">%.2f</td>`, item.DiscountMajor))
			case colTaxRate:
				sb.WriteString(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;">15%</td>`)
			case colTaxAmount:
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;">%.2f</td>`, item.TaxAmountMajor))
			case colTotal:
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 6px;text-align:center;font-family:Tahoma,sans-serif;font-weight:700;">%.2f</td>`, item.TotalLineMajor))
			case colNotes:
				sb.WriteString(`<td style="padding:5px 6px;text-align:center;"></td>`)
			default:
				sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;text-align:right;">%s</td>`, html.EscapeString(item.ItemName)))
			}
		}
		sb.WriteString(`</tr>`)
	}

	return sb.String()
}

func generateItemsTable(inv *InvoiceView) string {
	var sb strings.Builder
	sb.WriteString(`<table style="width:100%;border-collapse:collapse;font-size:12px;" dir="rtl">`)
	sb.WriteString(`<thead><tr style="background:#059669;color:#fff;">`)
	for _, h := range []string{"#", "كود الصنف", "الصنف / الخدمة", "الكمية", "سعر الوحدة", "الضريبة", "الإجمالي"} {
		sb.WriteString(`<th style="padding:6px 8px;text-align:right;border:1px solid #ccc;">` + h + `</th>`)
	}
	sb.WriteString(`</tr></thead><tbody>`)

	for i, item := range inv.Lines {
		bg := "#fff"
		if i%2 == 1 {
			bg = "#f0fdf4"
		}
		code := item.ItemCode
		if code == "" {
			code = "—"
		}
		sb.WriteString(fmt.Sprintf(`<tr style="background:%s;">`, bg))
		sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:center;">%d</td>`, i+1))
		sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:center;font-family:Tahoma,sans-serif;">%s</td>`, html.EscapeString(code)))
		sb.WriteString(fmt.Sprintf(`<td style="padding:5px 8px;border:1px solid #e2e8f0;font-weight:600;">%s</td>`, html.EscapeString(item.ItemName)))
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
	cleanId := strings.TrimSuffix(strings.TrimSpace(id), ".html")
	var val string
	err := s.db.QueryRow("SELECT value FROM meta WHERE key = ? OR key = ?", "tpl_builder_config_"+cleanId, "tpl_builder_config_"+id).Scan(&val)
	if err == nil && val != "" {
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

	// Fallback: Check excel_templates and read HTML file from disk
	var filePath, nameAr, category, colorHex string
	rowErr := s.db.QueryRow("SELECT file_path, name_ar, category, color_hex FROM excel_templates WHERE id = ? OR id = ?", cleanId, id).Scan(&filePath, &nameAr, &category, &colorHex)
	if rowErr == nil && filePath != "" {
		if contentBytes, readErr := os.ReadFile(filePath); readErr == nil {
			htmlStr := string(contentBytes)
			cfg := map[string]any{
				"id":            cleanId,
				"name_ar":       nameAr,
				"type":          category,
				"category":      category,
				"primary_color": colorHex,
				"html_content":  htmlStr,
				"editor_content": htmlStr,
			}
			return map[string]any{"builder_config": cfg}, nil
		}
	}

	return map[string]any{}, err
}

// SaveBuilderConfig saves the builder config, writes the HTML template to disk,
// and registers it in the catalog.
func (s *TemplateService) SaveBuilderConfig(id string, config any) error {
	id = strings.TrimSuffix(strings.TrimSpace(id), ".html")

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
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return err
	}
	filePath := filepath.Join(outDir, id+".html")

	htmlContent := ""
	if h, ok := cfgMap["html_content"].(string); ok {
		htmlContent = h
	}
	if htmlContent == "" {
		// Generate a minimal default HTML template
		htmlContent = buildDefaultHTMLFromConfig(cfgMap, category)
	}
	htmlContent = ensureItemsRowsInTbody(htmlContent)

	// Ensure <title> matches nameAr
	titleRegex := regexp.MustCompile(`(?i)<title>(.*?)</title>`)
	if titleRegex.MatchString(htmlContent) {
		htmlContent = titleRegex.ReplaceAllString(htmlContent, "<title>"+nameAr+"</title>")
	} else if strings.Contains(strings.ToLower(htmlContent), "<head>") {
		htmlContent = strings.Replace(htmlContent, "<head>", "<head>\n<title>"+nameAr+"</title>", 1)
	} else {
		htmlContent = "<title>" + nameAr + "</title>\n" + htmlContent
	}

	if err := os.WriteFile(filePath, []byte(htmlContent), 0644); err != nil {
		return err
	}

	badge := "مخصص"
	if category == "documents" {
		badge = "سند مخصص"
	}

	tags := extractHtmlPlaceholders(htmlContent)
	headersJson, _ := json.Marshal(tags)

	// 2. Upsert in catalog
	_, err = s.db.Exec(`
		INSERT INTO excel_templates (id, name_ar, name_en, description, badge, category, file_path, color_hex, headers_json, is_active, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
		ON CONFLICT(id) DO UPDATE SET
			name_ar = excluded.name_ar,
			category = excluded.category,
			badge = excluded.badge,
			file_path = excluded.file_path,
			color_hex = excluded.color_hex,
			headers_json = excluded.headers_json,
			updated_at = excluded.updated_at
	`, id, nameAr, id, "قالب HTML من محرر القوالب", badge, category, filePath, primaryColor, string(headersJson), db.NowIso())
	if err != nil {
		return err
	}

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

var (
	arabicOnes     = []string{"", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"}
	arabicTens     = []string{"", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"}
	arabicHundreds = []string{"", "مئة", "مئتان", "ثلاثمئة", "أربعمئة", "خمسمئة", "ستمئة", "سبعمئة", "ثمانمئة", "تسعمئة"}
)

func tafqeetUnder1000(n int64) string {
	parts := []string{}
	h := n / 100
	rest := n % 100
	if h > 0 && h < int64(len(arabicHundreds)) {
		parts = append(parts, arabicHundreds[h])
	}
	if rest > 0 {
		if rest < 20 {
			parts = append(parts, arabicOnes[rest])
		} else {
			o := rest % 10
			t := rest / 10
			if o > 0 {
				parts = append(parts, arabicOnes[o]+" و"+arabicTens[t])
			} else {
				parts = append(parts, arabicTens[t])
			}
		}
	}
	return strings.Join(parts, " و")
}

func tafqeetArabic(val float64) string {
	total := int64(math.Round(val * 100))
	riyals := total / 100
	halalas := total % 100

	if riyals == 0 && halalas == 0 {
		return "فقط صفر ريال سعودي لا غير"
	}

	var chunks []string
	millions := riyals / 1000000
	thousands := (riyals % 1000000) / 1000
	units := riyals % 1000

	if millions > 0 {
		if millions == 1 {
			chunks = append(chunks, "مليون")
		} else if millions == 2 {
			chunks = append(chunks, "مليونان")
		} else if millions >= 3 && millions <= 10 {
			chunks = append(chunks, tafqeetUnder1000(millions)+" ملايين")
		} else {
			chunks = append(chunks, tafqeetUnder1000(millions)+" مليون")
		}
	}
	if thousands > 0 {
		if thousands == 1 {
			chunks = append(chunks, "ألف")
		} else if thousands == 2 {
			chunks = append(chunks, "ألفان")
		} else if thousands >= 3 && thousands <= 10 {
			chunks = append(chunks, tafqeetUnder1000(thousands)+" آلاف")
		} else {
			chunks = append(chunks, tafqeetUnder1000(thousands)+" ألف")
		}
	}
	if units > 0 {
		chunks = append(chunks, tafqeetUnder1000(units))
	}

	text := strings.Join(chunks, " و")
	res := "فقط " + text + " ريالاً سعودياً"
	if halalas > 0 {
		res += " و" + tafqeetUnder1000(halalas) + " هللة"
	}
	return res + " لا غير"
}

func init() {
	var _ = sql.ErrNoRows
	_ = moneySarRegex1
	_ = moneySarRegex2
	_ = SarSymbolSVG
}
