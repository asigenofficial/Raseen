package services

import (
	"crypto/sha256"
	"database/sql"
	_ "embed"
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

var (
	moneySarRegex1 = regexp.MustCompile(`([0-9]+(?:\.[0-9]+)?)\s*(?:ر\.س|ر\.\s*س|﷼|SAR)`)
	moneySarRegex2 = regexp.MustCompile(`(?:ر\.س|ر\.\s*س|﷼|SAR)\s*([0-9]+(?:\.[0-9]+)?)`)
)

const ltrIconsStyleTag = `<style>
.seller-en-info, .seller-en, .seller.seller-en, .seller-block.en, td.seller-en {
  direction: ltr !important;
  text-align: left !important;
  justify-items: flex-start !important;
  align-items: flex-start !important;
  unicode-bidi: isolate !important;
}
.seller-en-info .company-name-en, .seller-en .company-name-en, .seller-en .company-name, .seller-block.en .seller-name-en, .seller-en-info h2, .seller-en h2, .seller-block.en h2 {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
}
.seller-en-info .header-info-line, .seller-en .header-info-line, .seller-en .company-line, .seller-block.en .seller-row, .seller-en p, .seller.seller-en p {
  direction: ltr !important;
  text-align: left !important;
  justify-content: flex-start !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 6px !important;
  unicode-bidi: isolate !important;
}
.seller-en-info .header-info-line svg, .seller-en-info .header-info-line .icon-svg, .seller-en .header-info-line svg, .seller-en .company-line svg, .seller-en .company-line .icon, .seller-block.en .seller-row svg, .seller-en p svg, .seller.seller-en p svg, .seller-en p .icon, .seller.seller-en p .icon {
  order: -1 !important;
  margin-right: 6px !important;
  margin-left: 0 !important;
  flex-shrink: 0 !important;
}
.seller-en-info .header-info-line span, .seller-en .company-line span, .seller-block.en .seller-row span, .seller-en p span {
  order: 2 !important;
  text-align: left !important;
  direction: ltr !important;
  unicode-bidi: isolate !important;
}
</style>`

const sarSymbolSizeStyleTag = `<style data-sar-symbol-size>
svg.sar-sym-svg, svg.sar-sym, .sar-sym svg, .currency-symbol svg {
  width: .72em !important;
  height: .82em !important;
  max-width: .72em !important;
  max-height: .82em !important;
  object-fit: contain;
  vertical-align: -.08em;
  flex: 0 0 auto;
}
</style>`

const documentFontStyleTag = `<style data-document-font>
@font-face { font-family: 'Raseen Document'; src: url('/fonts/NotoSansArabic.ttf') format('truetype'); font-weight: 100 900; font-display: block; }
body, body * { font-family: 'Raseen Document', Tahoma, Arial, sans-serif !important; }
</style>`

func injectLtrIconsStyle(h string) string {
	if strings.Contains(h, "</head>") {
		return strings.Replace(h, "</head>", ltrIconsStyleTag+"\n</head>", 1)
	}
	return ltrIconsStyleTag + "\n" + h
}

func injectTemplateStyle(h, style string) string {
	if headEnd := strings.LastIndex(strings.ToLower(h), "</head>"); headEnd >= 0 {
		return h[:headEnd] + style + "\n" + h[headEnd:]
	}
	return style + "\n" + h
}

type TemplateService struct {
	db           *db.DB
	dataDir      string
	itemRowHTML  string
	itemCellHTML string
	sarSymbolSVG string
}

// SARSymbolSVG returns the same inline icon used by invoice and browser previews.
// The XML declaration belongs to a standalone SVG file, not embedded HTML.
func (s *TemplateService) SARSymbolSVG() string {
	if s == nil {
		return ""
	}
	if start := strings.Index(s.sarSymbolSVG, "<svg"); start >= 0 {
		return s.sarSymbolSVG[start:]
	}
	return ""
}

func NewTemplateService(d *db.DB, dataDir string) *TemplateService {
	tplDir := filepath.Join(dataDir, "templates")
	_ = os.MkdirAll(filepath.Join(tplDir, "invoices"), 0755)
	_ = os.MkdirAll(filepath.Join(tplDir, "documents"), 0755)
	_ = os.MkdirAll(filepath.Join(tplDir, "reports"), 0755)
	_ = os.MkdirAll(filepath.Join(tplDir, "statements"), 0755)
	partialsDir := filepath.Join(tplDir, "partials")
	_ = os.MkdirAll(partialsDir, 0755)
	itemRow, _ := os.ReadFile(filepath.Join(partialsDir, "invoice-item-row.html"))
	itemCell, _ := os.ReadFile(filepath.Join(partialsDir, "invoice-item-cell.html"))
	sarSymbol, _ := os.ReadFile(filepath.Join(dataDir, "saudi_riyal_symbol.svg"))
	rowHTML := string(itemRow)
	if rowHTML == "" {
		rowHTML = "<tr>{{cells}}</tr>"
	}
	cellHTML := string(itemCell)
	if cellHTML == "" {
		cellHTML = "<td>{{value}}</td>"
	}
	s := &TemplateService{db: d, dataDir: dataDir, itemRowHTML: rowHTML, itemCellHTML: cellHTML, sarSymbolSVG: string(sarSymbol)}
	_ = s.SyncDiskTemplates()
	return s
}

var templateUnsafeFilenameChars = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)
var templateLatinLetters = regexp.MustCompile(`[A-Za-z]`)

func templateFileName(dir, name, id, existingPath string) string {
	base := strings.TrimSpace(name)
	base = templateUnsafeFilenameChars.ReplaceAllString(base, "-")
	base = strings.Trim(base, " .")
	if base == "" {
		base = "قالب"
	}
	fileName := base + ".html"
	if target := filepath.Join(dir, fileName); filepath.Clean(existingPath) != filepath.Clean(target) {
		if _, err := os.Stat(target); err == nil {
			suffix := strings.Trim(id, "-")
			if len(suffix) > 8 {
				suffix = suffix[:8]
			}
			fileName = base + "-" + suffix + ".html"
		}
	}
	return fileName
}

func isGenericTemplateTitle(title, category string) bool {
	title = strings.ToLower(cleanTemplateDisplayName(title))
	switch category {
	case "invoices":
		return title == "فاتورة ضريبية" || title == "فاتورة مبيعات" || title == "قالب فواتير مخصص" || templateLatinLetters.MatchString(title)
	case "documents", "vouchers":
		return title == "سند قبض" || title == "سند قبض مالي" || title == "قالب سند مالي مخصص" || templateLatinLetters.MatchString(title)
	default:
		return (category == "reports" || category == "statements") && templateLatinLetters.MatchString(title)
	}
}

func cleanTemplateDisplayName(title string) string {
	title = regexp.MustCompile(`\{\{[^}]*\}\}`).ReplaceAllString(title, "")
	title = regexp.MustCompile(`\s+`).ReplaceAllString(title, " ")
	return strings.TrimSpace(strings.Trim(title, " —–-"))
}

func containsArabicText(value string) bool {
	for _, r := range value {
		if r >= 0x0600 && r <= 0x06ff || r >= 0x0750 && r <= 0x077f || r >= 0x08a0 && r <= 0x08ff {
			return true
		}
	}
	return false
}

func localizedPresetName(baseName, category string) string {
	labels := map[string]string{
		"01-royal-navy":           "فاتورة ضريبية — الكحلي الملكي",
		"02-emerald-corners":      "فاتورة ضريبية — الزمرد والزوايا",
		"03-burgundy-classic":     "فاتورة ضريبية — العنابي الكلاسيكي",
		"04-charcoal-ledger":      "فاتورة ضريبية — الدفتر الفحمي",
		"05-sand-arch":            "فاتورة ضريبية — القوس الرملي",
		"06-teal-current":         "فاتورة ضريبية — التيار الفيروزي",
		"07-violet-facets":        "فاتورة ضريبية — الأوجه البنفسجية",
		"08-copper-lines":         "فاتورة ضريبية — الخطوط النحاسية",
		"09-cobalt-precision":     "فاتورة ضريبية — الأزرق الدقيق",
		"10-olive-manuscript":     "فاتورة ضريبية — المخطوطة الزيتونية",
		"11-slate-editorial":      "فاتورة ضريبية — الأردوازي التحريري",
		"12-petrol-ribbon":        "فاتورة ضريبية — الشريط البترولي",
		"13-plum-contour":         "فاتورة ضريبية — المحيط البرقوقي",
		"14-indigo-origami":       "فاتورة ضريبية — الأوريغامي النيلي",
		"15-terracotta-horizon":   "فاتورة ضريبية — أفق الطين المحروق",
		"16-forest-estate":        "فاتورة ضريبية — الغابة العقارية",
		"17-steel-blueprint":      "فاتورة ضريبية — المخطط الفولاذي",
		"18-midnight-gold":        "فاتورة ضريبية — الذهب الليلي",
		"19-azure-flow":           "فاتورة ضريبية — التدفق السماوي",
		"20-graphite-diamond":     "فاتورة ضريبية — الماس الجرافيتي",
		"21-ivory-atelier":        "فاتورة ضريبية — المرسم العاجي",
		"22-jade-pavilion":        "فاتورة ضريبية — الجناح اليشمي",
		"23-obsidian-fold":        "فاتورة ضريبية — الطيات البركانية",
		"24-lapis-orbit":          "فاتورة ضريبية — المدار اللازوردي",
		"25-aubergine-prism":      "فاتورة ضريبية — المنشور الباذنجاني",
		"26-pearl-architecture":   "فاتورة ضريبية — العمارة اللؤلؤية",
		"thermal":                 "فاتورة حرارية",
		"legacy-default":          "فاتورة ضريبية افتراضية",
		"قالب_سند_قبض_رسمي_معتمد": "سند قبض رسمي معتمد",
		"قالب_سند_قبض_أزرق":       "سند قبض أزرق",
		"قالب_سند_قبض":            "سند قبض مالي",
	}
	if category == "documents" || category == "vouchers" {
		if baseName == "legacy-default" {
			return "سند قبض افتراضي"
		}
		if labels[baseName] != "" {
			return labels[baseName]
		}
		if containsArabicText(baseName) {
			return strings.ReplaceAll(baseName, "_", " ")
		}
		return "قالب سند مالي مخصص"
	}
	if containsArabicText(baseName) {
		return strings.ReplaceAll(baseName, "_", " ")
	}
	if category != "invoices" {
		if category == "reports" {
			return "قالب تقرير مالي مخصص"
		}
		if category == "statements" {
			return "قالب كشف حساب مخصص"
		}
		return ""
	}
	if labels[baseName] != "" {
		return labels[baseName]
	}
	return "قالب فاتورة ضريبية مخصص"
}

func setTemplateHTMLTitle(content, title string) string {
	escapedTitle := html.EscapeString(strings.TrimSpace(title))
	titleRegex := regexp.MustCompile(`(?is)<title(?:\s[^>]*)?>.*?</title\s*>`)
	if titleRegex.MatchString(content) {
		return titleRegex.ReplaceAllStringFunc(content, func(string) string { return "<title>" + escapedTitle + "</title>" })
	}
	headRegex := regexp.MustCompile(`(?i)<head(?:\s[^>]*)?>`)
	if match := headRegex.FindString(content); match != "" {
		return headRegex.ReplaceAllString(content, match+"\n<title>"+escapedTitle+"</title>")
	}
	return "<title>" + escapedTitle + "</title>\n" + content
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

// ─── Disk Sync ────────────────────────────────────────────────────────────────

// SyncDiskTemplates scans the four data/templates categories for HTML files
// and registers them in the excel_templates catalog table without overwriting
// custom template names or IDs.
func (s *TemplateService) SyncDiskTemplates() error {
	if s == nil || s.db == nil {
		return nil
	}
	dirs := []struct {
		relPath  string
		category string
		badge    string
	}{
		{filepath.Join(s.dataDir, "templates", "invoices"), "invoices", "فاتورة HTML"},
		{filepath.Join(s.dataDir, "templates", "documents"), "documents", "سند HTML"},
		{filepath.Join(s.dataDir, "templates", "reports"), "reports", "تقرير مالي HTML"},
		{filepath.Join(s.dataDir, "templates", "statements"), "statements", "كشف حساب HTML"},
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
	existingByCategoryAndName := make(map[string]existingTpl)

	rows, err := s.db.Query(`SELECT id, name_ar, badge, category, file_path, color_hex FROM excel_templates`)
	if err == nil {
		for rows.Next() {
			var t existingTpl
			if errScan := rows.Scan(&t.id, &t.nameAr, &t.badge, &t.category, &t.filePath, &t.colorHex); errScan == nil {
				existingByPath[filepath.Clean(t.filePath)] = t
				existingByID[t.id] = t
				matchCategory := t.category
				if matchCategory == "vouchers" {
					matchCategory = "documents"
				}
				key := matchCategory + "\x00" + strings.ToLower(filepath.Base(t.filePath))
				if _, exists := existingByCategoryAndName[key]; !exists {
					existingByCategoryAndName[key] = t
				}
			}
		}
		rows.Close()
	}

	seenPathsOnDisk := make(map[string]bool)
	seenTemplateIDs := make(map[string]bool)

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
				titleFromHtml = cleanTemplateDisplayName(m[1])
			}

			// Match by current path first, then stable ID, then category and filename.
			// Filename matching preserves template IDs when a package is restored on a
			// different computer where the saved absolute data directory has changed.
			ex, hasExisting := existingByPath[fullPath]
			if !hasExisting {
				ex, hasExisting = existingByID[baseName]
			}
			if !hasExisting {
				ex, hasExisting = existingByCategoryAndName[d.category+"\x00"+strings.ToLower(entry.Name())]
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
					if isGenericTemplateTitle(nameAr, ex.category) {
						if localized := localizedPresetName(baseName, ex.category); localized != "" {
							nameAr = localized
						}
					}
					category = ex.category
					badge = ex.badge
					colorHex = ex.colorHex
				} else if titleFromHtml != "" && !isUuidStr(titleFromHtml) {
					h := sha256.Sum256([]byte(d.category + "/" + entry.Name()))
					id = "tpl_" + hex.EncodeToString(h[:4])
					nameAr = titleFromHtml
					if isGenericTemplateTitle(titleFromHtml, d.category) {
						if localized := localizedPresetName(baseName, d.category); localized != "" {
							nameAr = localized
						}
					}
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

			if _, err := s.db.Exec(`
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
			`, id, nameAr, badge, category, fullPath, colorHex, string(headersJson), db.NowIso()); err == nil {
				seenTemplateIDs[id] = true
			}
		}
	}

	// Clean up templates whose files were removed from disk (only for disk templates)
	for p, t := range existingByPath {
		if strings.Contains(p, "templates") && !seenPathsOnDisk[p] && !seenTemplateIDs[t.id] {
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
		if strings.TrimSpace(tpl.NameAr) == "" {
			tpl.NameAr = localizedPresetName(strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath)), tpl.Category)
			if tpl.NameAr == "" {
				tpl.NameAr = "قالب مخصص"
			}
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
			if typeFilter == "invoices" && tpl.Category != "invoices" && tpl.Category != "custom" && tpl.Category != "custom_invoices" {
				continue
			}
			if (typeFilter == "vouchers" || typeFilter == "documents") && tpl.Category != "vouchers" && tpl.Category != "documents" && tpl.Category != "custom_vouchers" {
				continue
			}
			if (typeFilter == "reports" || typeFilter == "statements") && tpl.Category != typeFilter {
				continue
			}
		}
		if categoryFilter != "" {
			if categoryFilter == "invoices" && tpl.Category != "invoices" && tpl.Category != "custom" && tpl.Category != "custom_invoices" {
				continue
			}
			if (categoryFilter == "documents" || categoryFilter == "vouchers") && tpl.Category != "vouchers" && tpl.Category != "documents" && tpl.Category != "custom_vouchers" {
				continue
			}
			if (categoryFilter == "reports" || categoryFilter == "statements") && tpl.Category != categoryFilter {
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
	input.NameAr = strings.TrimSpace(input.NameAr)
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
	} else if input.Category == "reports" || input.Category == "statements" {
		if !strings.HasSuffix(strings.ToLower(input.Filename), ".html") && !strings.HasSuffix(strings.ToLower(input.Filename), ".htm") {
			return nil, errors.New("قوالب التقارير وكشوف الحساب يجب أن تكون ملفات HTML")
		}
		subDir = input.Category
	} else {
		input.Category = "invoices"
	}
	targetDir := filepath.Join(s.dataDir, "templates", subDir)
	_ = os.MkdirAll(targetDir, 0755)

	fileName := templateFileName(targetDir, input.NameAr, id, "")
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
	fileData = []byte(setTemplateHTMLTitle(string(fileData), input.NameAr))
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
		_ = os.Remove(filePath)
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

	var filePath string
	if s.db != nil {
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
	}

	// 2. Direct search on disk by filename in templates/invoices and templates/documents
	for _, sub := range []string{"invoices", "documents", "reports", "statements"} {
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
	if s.db != nil {
		_ = s.SyncDiskTemplates()
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
	html := injectLtrIconsStyle(string(data))
	html = injectTemplateStyle(html, sarSymbolSizeStyleTag)
	html = injectTemplateStyle(html, documentFontStyleTag)
	if filepath.Base(filepath.Dir(filePath)) == "invoices" {
		html = normalizeInvoiceMeasurements(html)
	}
	return html, nil
}

func (s *TemplateService) FirstTemplateID(category string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM excel_templates WHERE category=? AND is_active=1
		ORDER BY CASE WHEN file_path LIKE '%legacy-default.html' THEN 0 ELSE 1 END,name_ar,id LIMIT 1`, category).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("لا يوجد قالب HTML محفوظ للفئة %s: %w", category, err)
	}
	return id, nil
}

// RenderInvoiceHTML loads the HTML template and substitutes invoice data tags.
func (s *TemplateService) RenderInvoiceHTML(inv *InvoiceView, style string) (string, error) {
	if s.itemRowHTML == "" {
		s.itemRowHTML = "<tr>{{cells}}</tr>"
	}
	if s.itemCellHTML == "" {
		s.itemCellHTML = "<td>{{value}}</td>"
	}
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
	if style == "" || style == "standard" || style == "default" {
		var err error
		style, err = s.FirstTemplateID("invoices")
		if err != nil {
			return "", err
		}
	}

	filePath, err := s.GetFilePath(style)
	if err != nil || filePath == "" {
		// Fallback to first available invoice template if the requested style is missing or moved
		if fallback, firstErr := s.FirstTemplateID("invoices"); firstErr == nil {
			style = fallback
			filePath, err = s.GetFilePath(style)
		}
	}
	if err != nil || filePath == "" {
		return "", fmt.Errorf("قالب الفاتورة غير موجود: %s", style)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("تعذر قراءة قالب الفاتورة: %w", err)
	}

	return injectTemplateStyle(normalizeInvoiceMeasurements(s.substituteInvoiceTags(string(data), inv)), documentFontStyleTag), nil
}

// Apply the reference invoice's element sizes at render time, leaving each
// template's colors, structure, source file, and page decorations intact.
//
//go:embed invoice-layout.js
var invoiceLayoutScript string

func normalizeInvoiceMeasurements(html string) string {
	if !strings.Contains(html, "data-invoice-layout-runtime") {
		html = injectTemplateStyle(html, `<script data-invoice-layout-runtime>`+invoiceLayoutScript+`</script>`)
	}
	const marker = "data-invoice-measurements"
	if strings.Contains(html, marker) {
		return html
	}
	const style = `<style data-invoice-measurements>
.items-main-table tbody td, table.items-table tbody td, .items-table-wrapper > table > tbody > tr > td { vertical-align: top !important; }
.invoice-container, .invoice-frame { display: flex !important; flex-direction: column !important; justify-content: flex-start !important; }
.top-content-wrap { flex: 0 0 auto !important; }
.invoice-container > .items-table-container, .invoice-container > .items-table-wrapper, .invoice-container > .items-main-table { flex: 0 0 auto !important; margin-top: 0 !important; }
.bottom-content-wrap, .invoice-container > .bottom, .invoice-container > .summary-section, .invoice-container > .totals, .invoice-container > .footer-zone { margin-top: auto !important; flex-shrink: 0 !important; }
.invoice-container, .invoice-frame { box-sizing: border-box !important; min-height: 281mm !important; padding: 8mm !important; }
.invoice-container .header { margin-bottom: 10px !important; padding-bottom: 10px !important; }
.invoice-metadata, .metadata { margin-bottom: 12px !important; }
.invoice-container .masthead { padding-block: 10px !important; }
.invoice-container .contact-strip { margin-block: 10px !important; }
.invoice-container .field { margin-bottom: 4px !important; }
.invoice-container dl { padding-top: 8px !important; padding-bottom: 8px !important; }
.bottom-content-wrap { padding-top: 4mm !important; }
.total-row { padding-top: 4px !important; padding-bottom: 4px !important; }

.items-main-table th, .items-main-table td, .items-table th, .items-table td, .items-table-wrapper th, .items-table-wrapper td {
 height: auto !important; padding: 5px 3px !important; line-height: 1.3 !important; font-size: 10px !important;
}

.invoice-container { width: 210mm !important; min-height: 297mm !important; height: 297mm !important; max-height: 297mm !important; box-sizing: border-box !important; }
.invoice-container .top-content-wrap, .invoice-container .top-wrap { flex: 1 1 auto !important; display: flex !important; flex-direction: column !important; min-height: 0 !important; }
.invoice-container .top-content-wrap > :not(.items-table-container):not(.items-table-wrapper):not(.items-main-table):not(.items-table) { flex-shrink: 0; }
.invoice-container .items-table-container, .invoice-container .items-table-wrapper, .invoice-container .items-container, .invoice-container .items-section, .invoice-container .section:has(> table.items-table) { flex: 1 1 auto !important; display: flex !important; flex-direction: column !important; min-height: 0 !important; margin-top: 0 !important; }
.invoice-container .items-main-table, .invoice-container table.items-table, .invoice-container .items-table-wrapper > table { height: auto !important; flex: 0 0 auto !important; }
.invoice-container .items-main-table thead, .invoice-container table.items-table thead, .invoice-container .items-table-wrapper > table thead { height: 1px; }
.invoice-container .invoice-body-content { display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; min-height: 0 !important; }
.invoice-container > footer, .invoice-container > .bottom-wrap { margin-top: auto !important; flex-shrink: 0 !important; }

@page { size: A4 portrait !important; margin: 0 !important; }
html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; max-height: none !important; }
body { width: 210mm !important; max-width: 210mm !important; box-sizing: border-box !important; }
body { font-size: 11px; }
.seller h2, .seller-ar .company-name, .seller-info .seller-title { font-size: 14.5px; }
.seller-en h2, .seller-en .company-name { font-size: 13px; }
.title-pill, .tax-invoice-badge { font-size: 12px; }
.logo-shell { height: 75px; max-width: 140px; }
.logo-shell img, .logo-shell svg,
.logo-slot img, .logo-slot svg,
.logo-placeholder img, .logo-placeholder svg,
.seller-logo-box img, .seller-logo-box svg,
img[class*="logo"], svg[class*="logo"] {
  max-width: 140px !important; max-height: 75px !important;
  width: auto; height: auto; object-fit: contain;
}
.qr-box, .qr-box-wrap { width: 130px; min-width: 130px; min-height: 130px; }
svg.zatca-qr-svg, .qr-frame img, .qr-frame svg,
.qr-box img, .qr-box svg, .qr-frame-box img, .qr-frame-box svg {
  width: 120px !important; height: 120px !important; max-width: 120px !important; max-height: 120px !important;
}
svg.sar-sym-svg, svg.sar-sym, .sar-sym svg, .currency-symbol svg {
  width: .72em !important; height: .82em !important;
  max-width: .72em !important; max-height: .82em !important;
  object-fit: contain; vertical-align: -.08em; flex: 0 0 auto;
}
.items-main-table, .items-table, .items-table-wrapper table,
.totals-table, .totals-box-table { font-size: 10.5px; }
.footer-zone, .invoice-footer { font-size: 9.5px; }
</style>`
	if end := strings.LastIndex(strings.ToLower(html), "</head>"); end >= 0 {
		return html[:end] + style + html[end:]
	}
	return style + html
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

func translateCityArToEn(cityAr string) string {
	c := strings.TrimSpace(cityAr)
	switch c {
	case "جدة", "جده":
		return "Jeddah"
	case "الرياض":
		return "Riyadh"
	case "مكة", "مكة المكرمة", "مكه", "مكه المكرمه":
		return "Makkah"
	case "المدينة", "المدينة المنورة", "المدينه", "المدينه المنوره":
		return "Madinah"
	case "الدمام":
		return "Dammam"
	case "الخبر":
		return "Khobar"
	case "الظهران":
		return "Dhahran"
	case "الجبيل":
		return "Jubail"
	case "الأحساء", "الاحساء", "الهفوف":
		return "Al-Ahsa"
	case "الطائف":
		return "Taif"
	case "تبوك":
		return "Tabuk"
	case "بريدة", "بريده":
		return "Buraidah"
	case "عنيزة", "عنيزه":
		return "Unaizah"
	case "حائل":
		return "Hail"
	case "أبها", "ابها":
		return "Abha"
	case "خميس مشيط":
		return "Khamis Mushait"
	case "جازان", "جيزان":
		return "Jazan"
	case "نجران":
		return "Najran"
	case "ينبع":
		return "Yanbu"
	case "القطيف":
		return "Qatif"
	}
	if strings.Contains(c, "جدة") || strings.Contains(c, "جده") {
		return "Jeddah"
	}
	if strings.Contains(c, "الرياض") {
		return "Riyadh"
	}
	if strings.Contains(c, "مكة") || strings.Contains(c, "مكه") {
		return "Makkah"
	}
	if strings.Contains(c, "الدمام") {
		return "Dammam"
	}
	return c
}

// formatNationalAddressEn formats the national address in English: City - District - Street - Building No - Postal Code
func formatNationalAddressEn(cityEn, districtEn, streetEn, buildingNo, postalCode string, arFallback ...string) string {
	c := strings.TrimSpace(cityEn)
	if c == "" && len(arFallback) > 0 && arFallback[0] != "" {
		c = translateCityArToEn(arFallback[0])
	}
	d := strings.TrimSpace(districtEn)
	if d == "" && len(arFallback) > 1 && arFallback[1] != "" {
		d = arFallback[1]
		d = strings.TrimPrefix(d, "حي ")
		if strings.Contains(d, "بني مالك") {
			d = "Bani Malik"
		}
		if !strings.Contains(strings.ToLower(d), "dist") {
			d = d + " Dist."
		}
	}
	s := strings.TrimSpace(streetEn)
	if s == "" && len(arFallback) > 2 && arFallback[2] != "" {
		s = arFallback[2]
		s = strings.TrimPrefix(s, "شارع ")
		s = strings.TrimPrefix(s, "طريق ")
		if strings.Contains(s, "الأمير ماجد") || strings.Contains(s, "الامير ماجد") {
			s = "Prince Majid"
		}
		if !strings.Contains(strings.ToLower(s), "st") && !strings.Contains(strings.ToLower(s), "street") && !strings.Contains(strings.ToLower(s), "rd") {
			s = s + " St."
		}
	}

	parts := []string{}
	if c != "" {
		parts = append(parts, c)
	}
	if d != "" {
		parts = append(parts, d)
	}
	if s != "" {
		parts = append(parts, s)
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

func (s *TemplateService) SubstituteInvoiceTags(tpl string, inv *InvoiceView) string {
	return s.substituteInvoiceTags(tpl, inv)
}

func (s *TemplateService) substituteInvoiceTags(tpl string, inv *InvoiceView) string {
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
		sellerAddressEn = formatNationalAddressEn(
			inv.IssuerSnapshot.CityEn,
			inv.IssuerSnapshot.DistrictEn,
			inv.IssuerSnapshot.StreetEn,
			inv.IssuerSnapshot.BuildingNo,
			inv.IssuerSnapshot.PostalCode,
			inv.IssuerSnapshot.City,
			inv.IssuerSnapshot.District,
			inv.IssuerSnapshot.Street,
		)
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

	if sellerName == "" && inv.SellerName != "" {
		sellerName = inv.SellerName
	}
	if sellerTax == "" && inv.SellerTaxNumber != "" {
		sellerTax = inv.SellerTaxNumber
	}
	if sellerCR == "" && inv.SellerCr != "" {
		sellerCR = inv.SellerCr
	}

	// استرجاع العنوان الوطني والعنوان الإنجليزي في حال لم يتواجد في النسخة المحفوظة للفاتورة
	if sellerAddress == "" && inv.SellerAddress != "" {
		sellerAddress = inv.SellerAddress
	}
	if sellerAddressEn == "" && inv.SellerAddressEn != "" {
		sellerAddressEn = inv.SellerAddressEn
	}
	if (sellerAddress == "" || sellerAddressEn == "") && inv.IssuerID != "" && s != nil && s.db != nil {
		var aEn, cEn, dEn, sEn, bNo, pCode, cityAr, distAr, strtAr, bldAr, postAr sql.NullString
		_ = s.db.QueryRow(`
			SELECT address_en, city_en, district_en, street_en, building_no, postal_code,
			       city, district, street, building_no, postal_code
			FROM issuers WHERE id = ?
		`, inv.IssuerID).Scan(&aEn, &cEn, &dEn, &sEn, &bNo, &pCode, &cityAr, &distAr, &strtAr, &bldAr, &postAr)
		if sellerAddress == "" && cityAr.Valid {
			sellerAddress = formatNationalAddress(cityAr.String, distAr.String, strtAr.String, bldAr.String, postAr.String)
		}
		if sellerAddressEn == "" {
			if aEn.Valid && aEn.String != "" {
				sellerAddressEn = aEn.String
			} else if cEn.Valid {
				sellerAddressEn = formatNationalAddressEn(cEn.String, dEn.String, sEn.String, bNo.String, pCode.String)
			}
		}
	}
	if sellerLogoHtml == "" {
		sellerLogoHtml = `<span style="font-size:26px;font-weight:900;color:#94a3b8;">شعار</span>`
	}

	qrB64 := ""
	payload := inv.QrPayload

	isPhase2 := inv.ZatcaPhase == "PHASE2" || (inv.SignatureMode != "" && inv.SignatureMode != "NONE")
	needRegen := payload == ""
	if !needRegen && isPhase2 {
		tags, err := zatca.ParseQrPayload(payload)
		if err != nil || len(tags) < 6 {
			needRegen = true
		}
	}

	if needRegen {
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
			SellerName:  sName,
			VatNumber:   sTax,
			Timestamp:   issDate + "T" + issTime + "Z",
			Total:       tot,
			VatTotal:    vat,
			InvoiceHash: inv.InvoiceHash,
		}
		if isPhase2 {
			sampleParams = zatca.BuildPhase2Params(sampleParams, inv.InvoiceNumber)
			if inv.InvoiceHash == "" {
				inv.InvoiceHash = sampleParams.InvoiceHash
			}
		}
		payload = zatca.BuildQrPayload(sampleParams)
		inv.QrPayload = payload
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
	isCash := strings.Contains(inv.PaymentMethod, "نقد") || strings.EqualFold(inv.PaymentMethod, "CASH") || strings.Contains(strings.ToLower(inv.PaymentMethod), "cash")
	var remainingAmount float64
	if isCash || (paidAmount > 0 && paidAmount >= inv.GrandTotalMajor) || strings.EqualFold(inv.Status, "PAID") {
		remainingAmount = 0
		if paidAmount == 0 || isCash {
			paidAmount = inv.GrandTotalMajor
		}
	} else if paidAmount > 0 {
		remainingAmount = inv.GrandTotalMajor - paidAmount
		if remainingAmount < 0 {
			remainingAmount = 0
		}
	} else {
		if inv.RemainingAmountMajor > 0 {
			remainingAmount = inv.RemainingAmountMajor
		} else {
			remainingAmount = inv.GrandTotalMajor
		}
	}

	tpl = ensureItemsRowsInTbody(tpl)
	smartRows := s.generateSmartRows(tpl, inv)

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

	paymentMethodAr := "نقداً"
	if inv.PaymentMethod != "" {
		pm := strings.ToUpper(strings.TrimSpace(inv.PaymentMethod))
		switch pm {
		case "CREDIT":
			paymentMethodAr = "آجلة"
		case "CASH":
			paymentMethodAr = "نقداً"
		case "CARD", "POS", "MADA":
			paymentMethodAr = "شبكة"
		case "TRANSFER", "BANK":
			paymentMethodAr = "تحويل بنكي"
		case "CHEQUE", "CHECK":
			paymentMethodAr = "شيك"
		default:
			paymentMethodAr = inv.PaymentMethod
		}
	}

	// تنظيف ذاتي: إذا قام الذكاء الاصطناعي أو المستخدم بتغليف وسم الشعار أو الباركود داخل <img src="{{logo}}">
	cleanImgLogoRegex := regexp.MustCompile(`(?i)<img\b[^>]*src=["']\{\{\s*(logo|seller_logo|company_logo|شعار|الشعار)\s*\}\}["'][^>]*>`)
	tpl = cleanImgLogoRegex.ReplaceAllString(tpl, "{{logo}}")

	cleanImgQrRegex := regexp.MustCompile(`(?i)<img\b[^>]*src=["']\{\{\s*(qr_code|qr|qrcode|barcode|zatca_qr|zatca_code|zatca_payload|رمز_الاستجابة|الباركود|باركود)\s*\}\}["'][^>]*>`)
	tpl = cleanImgQrRegex.ReplaceAllString(tpl, "{{qr_code}}")

	// استبدال أي رمز قديم تسبب في إظهار "جل جلاله" بدلاً من رمز الريال
	tpl = strings.ReplaceAll(tpl, "&#xFDFB;", "{{sar_symbol}}")
	tpl = strings.ReplaceAll(tpl, "&#xfdfb;", "{{sar_symbol}}")
	tpl = strings.ReplaceAll(tpl, "\uFDFB", "{{sar_symbol}}")

	sellerCityEn := ""
	if inv.IssuerSnapshot != nil {
		sellerCityEn = inv.IssuerSnapshot.CityEn
		if sellerCityEn == "" && inv.IssuerSnapshot.City != "" {
			sellerCityEn = translateCityArToEn(inv.IssuerSnapshot.City)
		}
	}
	if sellerCityEn == "" && sellerCity != "" {
		sellerCityEn = translateCityArToEn(sellerCity)
	}

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
		"{{payment_method}}", paymentMethodAr,
		"{{payment_method_label}}", paymentMethodAr,
		"{{payment_label}}", paymentMethodAr,
		"{{payment_type}}", paymentMethodAr,
		"{{invoice_type}}", func() string {
			if inv.InvoiceType == "SIMPLIFIED" {
				return "فاتورة ضريبية مبسطة"
			}
			return "فاتورة ضريبية"
		}(),
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
		"{{seller_city_en}}", sellerCityEn,
		"{{seller_country}}", sellerCountry,
		"{{seller_phone}}", sellerPhone,
		"{{seller_email}}", sellerEmail,
		"{{seller_meta_ar}}", sellerMetaAr,
		"{{seller_meta_en}}", sellerMetaEn,

		// ─── العميل / المشتري ───
		"{{buyer_name}}", buyerName,
		"{{buyer_code}}", buyerCode,
		"{{buyer_tax}}", buyerTax,
		"{{buyer_cr}}", "", // السجل التجاري للعميل لا يظهر في الفواتير الضريبية
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
		"{{sar_symbol}}", s.sarSymbolSVG,
		"{{currency_symbol}}", s.sarSymbolSVG,

		// ─── مرحلة الفوترة وبيانات الزكاة ───
		"{{zatca_phase}}", inv.ZatcaPhase,
		"{{zatca_phase_name}}", func() string {
			if isPhase2 {
				return "المرحلة الثانية"
			}
			return "المرحلة الأولى"
		}(),
		"{{zatca_phase_label}}", func() string {
			if isPhase2 {
				return "المرحلة الثانية (الربط والتكامل المشفر)"
			}
			return "المرحلة الأولى (الأساسية)"
		}(),
		"{{zatca_phase_badge}}", func() string {
			if isPhase2 {
				return "م2 — مشفر وموقّع ZATCA"
			}
			return "م1 — أساسي"
		}(),
		"{{invoice_hash}}", inv.InvoiceHash,

		// ─── جدول الأصناف والباركود ───
		"{{items_rows}}", smartRows,
		"{{items_table}}", smartRows,
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

	// استبدال ذكي لوسوم شارة ومرحلة الفوترة
	zatcaBadgeRegex := regexp.MustCompile(`(?i)\{\{\s*(zatca_phase_badge|zatca_badge|شارة_المرحلة)\s*\}\}`)
	phaseBadge := "م1 — أساسي"
	if isPhase2 {
		phaseBadge = "م2 — مشفر وموقّع ZATCA"
	}
	result = zatcaBadgeRegex.ReplaceAllString(result, phaseBadge)

	zatcaPhaseRegex := regexp.MustCompile(`(?i)\{\{\s*(zatca_phase|مرحلة_الزكاة|مرحلة_الفوترة)\s*\}\}`)
	result = zatcaPhaseRegex.ReplaceAllString(result, inv.ZatcaPhase)

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

	if strings.Contains(result, "overflow: hidden") || strings.Contains(result, "overflow:hidden") {
		result = strings.ReplaceAll(result, "overflow: hidden", "overflow: visible")
		result = strings.ReplaceAll(result, "overflow:hidden", "overflow:visible")
	}

	totalLinesCount := len(inv.Lines)
	if totalLinesCount == 0 && len(inv.Items) > 0 {
		totalLinesCount = len(inv.Items)
	}

	if totalLinesCount > 15 {
		result = s.paginateInvoiceHtml(result, inv, 15)
	}

	dupNoOtherRegex := regexp.MustCompile(`(لا غير\s*)+لا غير`)
	result = dupNoOtherRegex.ReplaceAllString(result, "لا غير")
	dupFaqatRegex := regexp.MustCompile(`(فقط\s*)+فقط`)
	result = dupFaqatRegex.ReplaceAllString(result, "فقط")
	result = strings.ReplaceAll(result, "فقط مبلغ وقدره فقط", "فقط مبلغ وقدره")

	return injectLtrIconsStyle(result)
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
	if strings.Contains(clean, "مبلغ الضريبة") || strings.Contains(clean, "مبلغ ضريبة") || strings.Contains(clean, "قيمة الضريبة") || strings.Contains(clean, "vat amount") || strings.Contains(clean, "tax amount") {
		return colTaxAmount
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
	// فحص "قبل الضريبة" أو "الخاضع للضريبة" قبل كلمة "ضريبة" لأن عبارة "قبل الضريبة" تحتوي على لفظ "ضريبة"
	if strings.Contains(clean, "قبل") || strings.Contains(clean, "خاضع") || strings.Contains(clean, "taxable") || strings.Contains(clean, "subtotal") || strings.Contains(clean, "amount before") {
		return colTaxable
	}
	if (strings.Contains(clean, "ضريبة") || strings.Contains(clean, "vat") || strings.Contains(clean, "tax")) && !strings.Contains(clean, "شامل") {
		return colTaxAmount
	}
	if strings.Contains(clean, "إجمالي") || strings.Contains(clean, "total") || strings.Contains(clean, "مبلغ") {
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

func (s *TemplateService) generateSmartRows(tpl string, inv *InvoiceView) string {
	return s.generateSmartRowsSlice(tpl, inv.Lines, 0)
}

func (s *TemplateService) generateSmartRowsSlice(tpl string, lines []InvoiceItemView, offset int) string {
	headers := extractTableHeaders(tpl)
	var cols []colType
	if len(headers) > 0 {
		cols = make([]colType, len(headers))
		for i, h := range headers {
			cols[i] = detectColumnType(h)
		}
	} else {
		cols = []colType{colIndex, colName, colQty, colUnit, colPrice, colTaxable, colDiscount, colTaxAmount, colTaxRate, colTotal}
	}

	var rows strings.Builder
	for i, item := range lines {
		var cells strings.Builder
		for _, col := range cols {
			value := ""
			switch col {
			case colIndex:
				value = fmt.Sprint(offset + i + 1)
			case colCode:
				value = item.ItemCode
				if value == "" {
					value = "—"
				}
			case colName:
				value = item.ItemName
				hasUnitColumn := false
				for _, c := range cols {
					if c == colUnit {
						hasUnitColumn = true
						break
					}
				}
				if !hasUnitColumn && item.Unit != "" {
					value += " (" + item.Unit + ")"
				}
			case colUnit:
				value = item.Unit
				if value == "" {
					value = "حبة"
				}
			case colPrice:
				value = fmt.Sprintf("%.2f", item.UnitPriceMajor)
			case colQty:
				if item.Quantity == float64(int64(item.Quantity)) {
					value = fmt.Sprintf("%.0f", item.Quantity)
				} else {
					value = fmt.Sprintf("%.2f", item.Quantity)
				}
			case colTaxable:
				value = fmt.Sprintf("%.2f", item.TaxableMajor)
			case colDiscount:
				value = fmt.Sprintf("%.2f", item.DiscountMajor)
			case colTaxRate:
				value = "15%"
			case colTaxAmount:
				value = fmt.Sprintf("%.2f", item.TaxAmountMajor)
			case colTotal:
				value = fmt.Sprintf("%.2f", item.TotalLineMajor)
			case colNotes:
				value = ""
			default:
				value = item.ItemName
			}
			cells.WriteString(strings.ReplaceAll(s.itemCellHTML, "{{value}}", html.EscapeString(value)))
		}
		rows.WriteString(strings.ReplaceAll(s.itemRowHTML, "{{cells}}", cells.String()))
	}

	return rows.String()
}

func (s *TemplateService) paginateInvoiceHtml(htmlStr string, inv *InvoiceView, chunkSize int) string {
	if len(inv.Lines) == 0 && len(inv.Items) > 0 {
		copy := *inv
		copy.Lines = inv.Items
		inv = &copy
	}
	if len(inv.Lines) <= chunkSize {
		return htmlStr
	}

	totalPages := (len(inv.Lines) + chunkSize - 1) / chunkSize

	bodyRegex := regexp.MustCompile(`(?is)(<body\b[^>]*>)([\s\S]*?)(</body>)`)
	bodyMatch := bodyRegex.FindStringSubmatch(htmlStr)
	if len(bodyMatch) < 4 {
		return htmlStr
	}
	bodyOpen := bodyMatch[1]
	bodyInner := strings.TrimSpace(bodyMatch[2])
	bodyClose := bodyMatch[3]

	// 1. Locate outer page container: look for invoice-container or invoice-frame
	contTargetRegex := regexp.MustCompile(`(?i)<div\b[^>]*class=["'][^"']*(?:invoice-container|invoice-frame)[^"']*["'][^>]*>`)
	contLoc := contTargetRegex.FindStringIndex(bodyInner)

	var contOpen, contInner, contClose, prefix, suffix string
	if contLoc != nil {
		prefix = bodyInner[:contLoc[0]]
		contOpen = bodyInner[contLoc[0]:contLoc[1]]
		rest := bodyInner[contLoc[1]:]
		lastCloseIdx := strings.LastIndex(rest, "</div>")
		if lastCloseIdx != -1 {
			contInner = rest[:lastCloseIdx]
			suffix = rest[lastCloseIdx+6:]
		} else {
			contInner = rest
		}
		contClose = "</div>"
	} else {
		// Fallback to first <div and last </div>
		firstDivIdx := strings.Index(bodyInner, "<div")
		lastDivIdx := strings.LastIndex(bodyInner, "</div>")
		if firstDivIdx == -1 || lastDivIdx <= firstDivIdx {
			return htmlStr
		}
		tagCloseIdx := strings.Index(bodyInner[firstDivIdx:], ">")
		if tagCloseIdx == -1 {
			return htmlStr
		}
		prefix = bodyInner[:firstDivIdx]
		contOpen = bodyInner[firstDivIdx : firstDivIdx+tagCloseIdx+1]
		contInner = bodyInner[firstDivIdx+tagCloseIdx+1 : lastDivIdx]
		contClose = "</div>"
		suffix = bodyInner[lastDivIdx+6:]
	}

	// 2. Locate the items table
	tableRegex := regexp.MustCompile(`(?is)(<table\b[\s\S]*?)(<tbody\b[^>]*>)([\s\S]*?)(</tbody>)([\s\S]*?</table>)`)
	tableMatch := tableRegex.FindStringSubmatch(contInner)
	if len(tableMatch) < 6 {
		return htmlStr
	}

	tblIdx := strings.Index(contInner, tableMatch[0])
	beforeTable := contInner[:tblIdx]
	tableOpen := tableMatch[1] + tableMatch[2]
	tableClose := tableMatch[4] + tableMatch[5]
	afterTableRaw := contInner[tblIdx+len(tableMatch[0]):]

	// 3. Locate bottom section
	bottomRegex := regexp.MustCompile(`(?i)<(?:div|section|table)\b[^>]*(?:class|id)=["'][^"']*(?:bottom|summary)[^"']*["']`)
	bottomLoc := bottomRegex.FindStringIndex(afterTableRaw)
	tableWrapClose := ""
	bottomContent := afterTableRaw
	if bottomLoc != nil {
		tableWrapClose = afterTableRaw[:bottomLoc[0]]
		bottomContent = afterTableRaw[bottomLoc[0]:]
	}

	divOpenRegex := regexp.MustCompile(`(?i)<div\b`)
	divCloseRegex := regexp.MustCompile(`(?i)</div\s*>`)
	var pages []string
	for p := 1; p <= totalPages; p++ {
		start := (p - 1) * chunkSize
		end := start + chunkSize
		if end > len(inv.Lines) {
			end = len(inv.Lines)
		}
		chunk := inv.Lines[start:end]
		rowsHtml := s.generateSmartRowsSlice(htmlStr, chunk, start)

		pageInner := beforeTable + tableOpen + rowsHtml + tableClose + tableWrapClose
		if p == totalPages {
			pageInner += bottomContent
		}
		// Some templates wrap the items table in an unnamed div. On continuation
		// pages the bottom section is omitted, so its closing div must stay here.
		openDivs := len(divOpenRegex.FindAllStringIndex(pageInner, -1))
		closedDivs := len(divCloseRegex.FindAllStringIndex(pageInner, -1))
		if openDivs > closedDivs {
			pageInner += strings.Repeat("</div>", openDivs-closedDivs)
		}

		pOpen := strings.Replace(contOpen, "<div", fmt.Sprintf(`<div data-invoice-page="%d"`, p), 1)
		continuation := "تابع الفاتورة"
		if p < totalPages {
			continuation = "متابعة الفاتورة في الصفحة التالية"
		}
		pageLabel := fmt.Sprintf(`<div class="invoice-page-label" style="flex-shrink:0;font-size:11px;text-align:center;margin-top:auto;padding-top:3mm">%s — صفحة %d من %d</div>`, continuation, p, totalPages)
		pages = append(pages, fmt.Sprintf("%s\n%s\n%s\n%s", pOpen, pageInner, pageLabel, contClose))
	}

	allPages := prefix + strings.Join(pages, "\n") + suffix
	return injectTemplateStyle(strings.Replace(htmlStr, bodyMatch[0], bodyOpen+"\n"+allPages+"\n"+bodyClose, 1), `<style data-invoice-pages-print>
@media print {
 @page { size: A4 portrait; margin: 0 !important; }
 html, body { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; }
 [data-invoice-page] { width: 210mm !important; min-height: 297mm !important; height: 297mm !important; max-height: none !important; box-sizing: border-box !important; margin: 0 !important; overflow: visible !important; break-after: page !important; page-break-after: always !important; }
 [data-invoice-page]:last-child { break-after: auto !important; page-break-after: auto !important; }
 [data-invoice-page] .invoice-frame:not([data-invoice-page]) { position: absolute !important; inset: 5mm !important; width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important; display: block !important; break-after: auto !important; page-break-after: auto !important; }
}
</style>`)
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
				"id":             cleanId,
				"name_ar":        nameAr,
				"type":           category,
				"category":       category,
				"primary_color":  colorHex,
				"html_content":   htmlStr,
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
	if t, ok := cfgMap["type"].(string); ok {
		switch t {
		case "documents", "vouchers":
			category = "documents"
		case "reports", "statements":
			category = t
		}
	} else if t, ok := cfgMap["category"].(string); ok {
		switch t {
		case "documents", "vouchers":
			category = "documents"
		case "reports", "statements":
			category = t
		}
	}

	nameAr := ""
	if n, ok := cfgMap["name_ar"].(string); ok && strings.TrimSpace(n) != "" {
		nameAr = strings.TrimSpace(n)
	}
	if nameAr == "" {
		return errors.New("اسم القالب مطلوب")
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
	var oldPath string
	_ = s.db.QueryRow("SELECT file_path FROM excel_templates WHERE id = ?", id).Scan(&oldPath)
	fileName := templateFileName(outDir, nameAr, id, oldPath)
	filePath := filepath.Join(outDir, fileName)

	htmlContent := ""
	if h, ok := cfgMap["html_content"].(string); ok {
		htmlContent = h
	}
	if htmlContent == "" {
		return errors.New("محتوى قالب HTML مطلوب؛ ارفع أو أنشئ ملف القالب قبل الحفظ")
	}
	htmlContent = ensureItemsRowsInTbody(htmlContent)

	htmlContent = setTemplateHTMLTitle(htmlContent, nameAr)
	cfgMap["name_ar"] = nameAr
	cfgMap["type"] = category
	cfgMap["category"] = category
	cfgMap["html_content"] = htmlContent
	b, err = json.Marshal(cfgMap)
	if err != nil {
		return err
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
		if filepath.Clean(oldPath) != filepath.Clean(filePath) {
			_ = os.Remove(filePath)
		}
		return err
	}

	// 3. Save full builder config in meta table
	_, err = s.db.Exec(`
		INSERT INTO meta (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, "tpl_builder_config_"+id, string(b))
	if err != nil {
		return err
	}
	if oldPath != "" && filepath.Clean(oldPath) != filepath.Clean(filePath) {
		root, _ := filepath.Abs(filepath.Join(s.dataDir, "templates"))
		oldAbs, _ := filepath.Abs(oldPath)
		rel, relErr := filepath.Rel(root, oldAbs)
		if relErr == nil && rel != "." && !filepath.IsAbs(rel) && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			_ = os.Remove(oldAbs)
		}
	}
	return nil
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

func TafqeetArabic(val float64) string { return tafqeetArabic(val) }

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
}

// CombineHTMLDocuments applies the HTML wrapper stored in data/templates/partials.
func (s *TemplateService) CombineHTMLDocuments(docs []string) string {
	if len(docs) == 0 {
		return ""
	}
	if len(docs) == 1 {
		return docs[0]
	}

	wrapperBytes, err := os.ReadFile(filepath.Join(s.dataDir, "templates", "partials", "batch-documents.html"))
	if err != nil {
		return ""
	}
	itemBytes, err := os.ReadFile(filepath.Join(s.dataDir, "templates", "partials", "batch-document-item.html"))
	if err != nil {
		return ""
	}
	wrapper := string(wrapperBytes)
	itemTemplate := string(itemBytes)

	var allStyles strings.Builder
	var allBodies strings.Builder
	styleRegex := regexp.MustCompile(`(?is)<style\b[^>]*>(.*?)</style>`)
	bodyRegex := regexp.MustCompile(`(?is)<body\b[^>]*>(.*?)</body>`)

	seenStyles := make(map[string]bool)

	for _, doc := range docs {
		// Extract and deduplicate styles
		styleMatches := styleRegex.FindAllStringSubmatch(doc, -1)
		for _, sm := range styleMatches {
			if len(sm) > 1 {
				trimmed := strings.TrimSpace(sm[1])
				h := fmt.Sprintf("%x", sha256.Sum256([]byte(trimmed)))
				if !seenStyles[h] {
					seenStyles[h] = true
					allStyles.WriteString(trimmed)
					allStyles.WriteString("\n")
				}
			}
		}

		// Extract body content
		bMatch := bodyRegex.FindStringSubmatch(doc)
		content := ""
		if len(bMatch) > 1 {
			content = strings.TrimSpace(bMatch[1])
		} else {
			content = doc
		}

		allBodies.WriteString(strings.ReplaceAll(itemTemplate, "{{content}}", content))
	}

	wrapper = strings.ReplaceAll(wrapper, "{{styles}}", allStyles.String())
	return strings.ReplaceAll(wrapper, "{{documents}}", allBodies.String())
}
