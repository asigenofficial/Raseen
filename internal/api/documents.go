package api

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"raseen/internal/db"
	"raseen/internal/services"
)

func (s *Server) pdfStoragePath(kind, id string) string {
	return filepath.Join(s.cfg.DataDir, "storage", "pdfs", kind, id+".pdf")
}

func (s *Server) readStoredPDF(kind, id string) ([]byte, error) {
	path := s.pdfStoragePath(kind, id)
	if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
		return data, nil
	}
	// Fallback to SQLite BLOB if not on disk yet (for backward compatibility during migration)
	var pdf []byte
	err := s.db.QueryRow("SELECT pdf FROM document_pdfs WHERE kind=? AND document_id=?", kind, id).Scan(&pdf)
	if err == nil && len(pdf) > 0 {
		_ = s.saveStoredPDF(kind, id, pdf)
		go func() {
			_, _ = s.db.Exec("UPDATE document_pdfs SET pdf=NULL WHERE kind=? AND document_id=?", kind, id)
		}()
		return pdf, nil
	}
	return nil, err
}

func (s *Server) saveStoredPDF(kind, id string, data []byte) error {
	path := s.pdfStoragePath(kind, id)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func (s *Server) deleteStoredPDF(kind, id string) {
	_ = os.Remove(s.pdfStoragePath(kind, id))
}

// PDF bytes are a replaceable rendering of the current document, not its accounting record.
// A revision check prevents a slow renderer from overwriting a newer edit.
func (s *Server) dirtyDocument(kind, id, issuerID string) error {
	s.deleteStoredPDF(kind, id)
	_, err := s.db.Exec(`INSERT INTO document_pdfs(kind, document_id, issuer_id, updated_at)
		VALUES(?,?,?,?) ON CONFLICT(kind, document_id) DO UPDATE SET
		issuer_id=excluded.issuer_id, revision=revision+1, pdf=NULL,
		status='PENDING', error='', updated_at=excluded.updated_at`, kind, id, issuerID, db.NowIso())
	if err == nil {
		s.wakePDFWorker()
	}
	return err
}

func (s *Server) dirtyIssuerDocuments(issuerID string) error {
	for _, item := range []struct{ kind, table string }{{"invoice", "invoices"}, {"voucher", "receipt_vouchers"}} {
		query := fmt.Sprintf(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
			SELECT ?,id,issuer_id,? FROM %s WHERE issuer_id=?
			ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
			status='PENDING',error='',updated_at=excluded.updated_at`, item.table)
		if _, err := s.db.Exec(query, item.kind, db.NowIso(), issuerID); err != nil {
			return err
		}
	}
	s.wakePDFWorker()
	return nil
}

func (s *Server) enqueueMissingPDFs() {
	for _, item := range []struct{ kind, table string }{{"invoice", "invoices"}, {"voucher", "receipt_vouchers"}} {
		query := fmt.Sprintf(`INSERT OR IGNORE INTO document_pdfs(kind,document_id,issuer_id,updated_at)
			SELECT ?,id,issuer_id,? FROM %s`, item.table)
		_, _ = s.db.Exec(query, item.kind, db.NowIso())
	}
}

func (s *Server) dirtyAllCachedDocuments() {
	_, _ = s.db.Exec(`UPDATE document_pdfs SET revision=revision+1,pdf=NULL,status='PENDING',
		error='',updated_at=?`, db.NowIso())
	// Note: We do NOT wake worker to churn thousands of historic PDFs in background.
	// Documents will render cleanly on-demand when requested.
}

func (s *Server) dirtyBatchDocuments(batchID string) {
	_, _ = s.db.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
		SELECT 'invoice',id,issuer_id,? FROM invoices WHERE batch_id=?
		ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
		status='PENDING',error='',updated_at=excluded.updated_at`, db.NowIso(), batchID)
	_, _ = s.db.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
		SELECT DISTINCT 'voucher',v.id,v.issuer_id,? FROM receipt_vouchers v
		JOIN voucher_allocations a ON a.voucher_id=v.id JOIN invoices i ON i.id=a.invoice_id
		WHERE i.batch_id=? ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
		status='PENDING',error='',updated_at=excluded.updated_at`, db.NowIso(), batchID)
	s.wakePDFWorker()
}

func (s *Server) dirtyInvoiceReceipts(invoiceID string) {
	_, _ = s.db.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
		SELECT DISTINCT 'voucher',v.id,v.issuer_id,? FROM receipt_vouchers v
		JOIN voucher_allocations a ON a.voucher_id=v.id WHERE a.invoice_id=?
		ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
		status='PENDING',error='',updated_at=excluded.updated_at`, db.NowIso(), invoiceID)
	s.wakePDFWorker()
}

func (s *Server) dirtyAllocatedInvoices(voucherID string) {
	_, _ = s.db.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
		SELECT 'invoice',i.id,i.issuer_id,? FROM invoices i
		JOIN voucher_allocations a ON a.invoice_id=i.id WHERE a.voucher_id=?
		ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
		status='PENDING',error='',updated_at=excluded.updated_at`, db.NowIso(), voucherID)
	s.wakePDFWorker()
}

func (s *Server) allocatedInvoiceIDs(voucherID string) []string {
	rows, err := s.db.Query("SELECT DISTINCT invoice_id FROM voucher_allocations WHERE voucher_id=?", voucherID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

func (s *Server) dirtyInvoicesByID(ids []string) {
	for _, id := range ids {
		var issuerID string
		if s.db.QueryRow("SELECT issuer_id FROM invoices WHERE id=?", id).Scan(&issuerID) == nil {
			_ = s.dirtyDocument("invoice", id, issuerID)
		}
	}
}

func (s *Server) deleteDocumentPDF(kind, id string) {
	s.deleteStoredPDF(kind, id)
	_, _ = s.db.Exec("DELETE FROM document_pdfs WHERE kind=? AND document_id=?", kind, id)
}

func (s *Server) pdfStatus(w http.ResponseWriter, kind, id string) {
	var status, renderErr string
	var revision, rendered int64
	err := s.db.QueryRow(`SELECT status,error,revision,rendered_revision FROM document_pdfs
		WHERE kind=? AND document_id=?`, kind, id).Scan(&status, &renderErr, &revision, &rendered)
	if errors.Is(err, sql.ErrNoRows) {
		s.json(w, 200, map[string]any{"status": "PENDING", "revision": 0})
		return
	}
	if err != nil {
		s.err(w, 500, err.Error())
		return
	}
	if status == "FAILED" && revision > rendered {
		// Automatically recover from temporary failures by transitioning back to PENDING and waking worker
		_, _ = s.db.Exec(`UPDATE document_pdfs SET status='PENDING',error='',updated_at=?
			WHERE kind=? AND document_id=?`, db.NowIso(), kind, id)
		s.wakePDFWorker()
		status = "PENDING"
	}
	s.json(w, 200, map[string]any{"status": status, "error": renderErr,
		"revision": revision, "rendered_revision": rendered})
}

func (s *Server) wakePDFWorker() {
	select {
	case s.pdfWake <- struct{}{}:
	default:
	}
}

func (s *Server) startPDFWorker() {
	go func() {
		// Allow server to boot and serve initial HTTP requests first
		time.Sleep(3 * time.Second)

		// Migrate any legacy SQLite PDF blobs to disk storage in background
		s.migrateLegacyPDFBlobs()

		// Clean up orphaned records whose parent documents were deleted
		_, _ = s.db.Exec(`DELETE FROM document_pdfs WHERE
			(kind='invoice' AND document_id NOT IN (SELECT id FROM invoices)) OR
			(kind='voucher' AND document_id NOT IN (SELECT id FROM receipt_vouchers))`)

		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			s.processPendingPDFs()
			select {
			case <-s.pdfWake:
			case <-ticker.C:
			}
		}
	}()
}

func (s *Server) migrateLegacyPDFBlobs() {
	rows, err := s.db.Query("SELECT kind, document_id, pdf FROM document_pdfs WHERE pdf IS NOT NULL AND length(pdf) > 0 LIMIT 5000")
	if err != nil {
		return
	}
	defer rows.Close()

	migrated := 0
	for rows.Next() {
		var kind, id string
		var data []byte
		if err := rows.Scan(&kind, &id, &data); err == nil && len(data) > 0 {
			if err := s.saveStoredPDF(kind, id, data); err == nil {
				_, _ = s.db.Exec("UPDATE document_pdfs SET pdf=NULL WHERE kind=? AND document_id=?", kind, id)
				migrated++
			}
		}
	}
	if migrated > 0 {
		log.Printf("[Storage] Migrated %d legacy PDF files to disk. Running vacuum...", migrated)
		if before, after, err := s.db.Vacuum(); err == nil {
			log.Printf("[Storage] Vacuum completed: %d MB -> %d MB", before/(1024*1024), after/(1024*1024))
		}
	}
}

func (s *Server) processPendingPDFs() {
	// Process at most 5 pending documents per cycle to prevent pegging CPU and monopolizing DB write locks
	for i := 0; i < 5; i++ {
		var kind, id string
		var revision int64
		// Only auto-render recently created or modified documents (last 48 hours).
		// Historic documents render on-demand when viewed or downloaded.
		err := s.db.QueryRow(`SELECT kind,document_id,revision FROM document_pdfs
			WHERE status='PENDING' AND updated_at >= datetime('now', '-48 hours')
			ORDER BY updated_at DESC LIMIT 1`).Scan(&kind, &id, &revision)
		if err != nil {
			return
		}
		_, _ = s.renderAndSavePDF(kind, id, revision, "")
		time.Sleep(200 * time.Millisecond)
	}
}

func (s *Server) pdfStyle(kind, id, override string) string {
	table := "invoices"
	key := "template_style"
	if kind == "voucher" {
		table, key = "receipt_vouchers", "voucher_template_style"
	}
	style := override
	if style == "" {
		var settings string
		if s.db.QueryRow("SELECT issuer.print_settings FROM "+table+" doc JOIN issuers issuer ON issuer.id=doc.issuer_id WHERE doc.id=?", id).Scan(&settings) == nil {
			var cfg map[string]any
			_ = json.Unmarshal([]byte(settings), &cfg)
			style, _ = cfg[key].(string)
		}
	}
	if style != "" && style != "default" && style != "standard" {
		if s.templates == nil {
			return style
		}
		if _, err := s.templates.GetFilePath(style); err == nil {
			return style
		}
	}
	if s.templates == nil {
		return style
	}
	category := "invoices"
	if kind == "voucher" {
		category = "documents"
	}
	if selected, err := s.templates.FirstTemplateID(category); err == nil {
		return selected
	}
	return style
}

func (s *Server) currentPDF(kind, id string, styleOverride ...string) ([]byte, error) {
	requestedStyle := ""
	if len(styleOverride) > 0 {
		requestedStyle = styleOverride[0]
	}
	expectedStyle := s.pdfStyle(kind, id, requestedStyle)
	expectedKey := s.documentPDFStyleKey(kind, expectedStyle)
	var revision, rendered int64
	var storedStyle string
	err := s.db.QueryRow(`SELECT revision,rendered_revision,style FROM document_pdfs
		WHERE kind=? AND document_id=?`, kind, id).Scan(&revision, &rendered, &storedStyle)
	if errors.Is(err, sql.ErrNoRows) {
		var issuerID string
		table := "invoices"
		if kind == "voucher" {
			table = "receipt_vouchers"
		}
		if err = s.db.QueryRow("SELECT issuer_id FROM "+table+" WHERE id=?", id).Scan(&issuerID); err != nil {
			return nil, err
		}
		if err = s.dirtyDocument(kind, id, issuerID); err != nil {
			return nil, err
		}
		return s.currentPDF(kind, id, requestedStyle)
	}
	if err != nil {
		return nil, err
	}
	if rendered == revision && storedStyle == expectedKey {
		if pdfBytes, readErr := s.readStoredPDF(kind, id); readErr == nil && len(pdfBytes) > 0 {
			return pdfBytes, nil
		}
	}
	if rendered == revision && storedStyle != expectedKey {
		var issuerID string
		_ = s.db.QueryRow("SELECT issuer_id FROM document_pdfs WHERE kind=? AND document_id=?", kind, id).Scan(&issuerID)
		if err := s.dirtyDocument(kind, id, issuerID); err != nil {
			return nil, err
		}
		return s.currentPDF(kind, id, requestedStyle)
	}
	return s.renderAndSavePDF(kind, id, revision, "", expectedStyle)
}

func (s *Server) renderAndSavePDF(kind, id string, revision int64, suppliedHTML string, styleOverride ...string) ([]byte, error) {
	style := ""
	if len(styleOverride) > 0 {
		style = styleOverride[0]
	}
	style = s.pdfStyle(kind, id, style)
	renderKey := s.documentPDFStyleKey(kind, style)
	htmlDoc := suppliedHTML
	var err error
	if strings.TrimSpace(htmlDoc) == "" {
		if kind == "invoice" {
			var inv *services.InvoiceView
			inv, err = s.invoices.GetInvoice(id)
			if err == nil {
				htmlDoc, err = s.templates.RenderInvoiceHTML(inv, style)
			}
		} else {
			htmlDoc, err = s.renderVoucherHTML(id, style)
		}
	}
	if err != nil {
		s.failPDF(kind, id, revision, err)
		return nil, err
	}
	pdf, err := services.RenderHTMLToPDF(htmlDoc)
	if err != nil {
		s.failPDF(kind, id, revision, err)
		return nil, err
	}
	// Persist the binary PDF to disk storage outside of SQLite
	if err := s.saveStoredPDF(kind, id, pdf); err != nil {
		s.failPDF(kind, id, revision, err)
		return nil, err
	}
	result, err := s.db.Exec(`UPDATE document_pdfs SET pdf=NULL,rendered_revision=?,style=?,status='READY',error='',updated_at=?
		WHERE kind=? AND document_id=? AND revision=?`, revision, renderKey, db.NowIso(), kind, id, revision)
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return s.currentPDF(kind, id, style)
	}
	return pdf, nil
}

func (s *Server) failPDF(kind, id string, revision int64, renderErr error) {
	_, _ = s.db.Exec(`UPDATE document_pdfs SET status='FAILED',error=?,updated_at=?
		WHERE kind=? AND document_id=? AND revision=?`, renderErr.Error(), db.NowIso(), kind, id, revision)
}

// Invalidate cached PDFs when their rendering rules change.
func (s *Server) documentPDFStyleKey(kind, style string) string {
	if kind == "voucher" {
		key := style + "|amount-grouping-v3|static-pdf-font-v1|address-v2"
		if s.templates != nil {
			if template, err := s.templates.RenderTemplateHTML(style); err == nil {
				checksum := sha256.Sum256([]byte(template))
				key += fmt.Sprintf("|template-%x", checksum[:16])
			}
		}
		return key
	}
	if kind == "invoice" {
		key := style + "|invoice-table-fill-v11|static-pdf-font-v1"
		if s.templates != nil {
			if template, err := s.templates.RenderTemplateHTML(style); err == nil {
				checksum := sha256.Sum256([]byte(template))
				key += fmt.Sprintf("|template-%x", checksum[:16])
			}
		}
		return key
	}
	return style
}

func formatVoucherAmount(amount float64) string {
	parts := strings.SplitN(fmt.Sprintf("%.2f", amount), ".", 2)
	whole := parts[0]
	sign := ""
	if strings.HasPrefix(whole, "-") {
		sign, whole = "-", whole[1:]
	}
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	return sign + whole + "." + parts[1]
}

func (s *Server) renderVoucherHTML(id, style string) (string, error) {
	v, err := s.vouchers.GetVoucher(id)
	if err != nil {
		return "", err
	}
	issuer, err := s.issuers.GetIssuer(v.IssuerID)
	if err != nil {
		return "", err
	}
	if style == "" {
		style, err = s.templates.FirstTemplateID("documents")
		if err != nil {
			return "", err
		}
	}
	tpl, err := s.templates.RenderTemplateHTML(style)
	if err != nil {
		return "", err
	}
	allocations := make([]string, 0, len(v.Allocations))
	for _, a := range v.Allocations {
		allocations = append(allocations, a.InvoiceNumber)
	}
	paidFor := strings.TrimSpace(v.Notes)
	if paidFor == "" && len(allocations) > 0 {
		if len(allocations) == 1 {
			paidFor = "سداد فاتورة رقم " + allocations[0]
		} else {
			paidFor = "سداد فواتير رقم " + strings.Join(allocations, "، ")
		}
	} else if paidFor == "" {
		paidFor = "سداد حساب"
	}
	amount := formatVoucherAmount(v.TotalAmount)
	addressParts := make([]string, 0, 5)
	for _, part := range []string{issuer.City, issuer.District, issuer.Street, issuer.BuildingNo, issuer.PostalCode} {
		if part = strings.TrimSpace(part); part != "" {
			addressParts = append(addressParts, part)
		}
	}
	addressEn := strings.TrimSpace(issuer.AddressEn)
	if addressEn == "" {
		parts := make([]string, 0, 5)
		for _, part := range []string{issuer.CityEn, issuer.DistrictEn, issuer.StreetEn, issuer.BuildingNo, issuer.PostalCode} {
			if part = strings.TrimSpace(part); part != "" {
				parts = append(parts, part)
			}
		}
		addressEn = strings.Join(parts, " - ")
	}
	// Custom templates may use aliases or spaces around the monetary field.
	amountTags := regexp.MustCompile(`(?i)\{\{\s*(amount|total_amount|grand_total|total|net_amount)\s*\}\}`)
	tpl = amountTags.ReplaceAllStringFunc(tpl, func(string) string { return amount })
	sellerMetaArParts := make([]string, 0, 3)
	if tax := strings.TrimSpace(issuer.TaxNumber); tax != "" {
		if strings.Contains(tax, "ضريب") {
			sellerMetaArParts = append(sellerMetaArParts, tax)
		} else {
			sellerMetaArParts = append(sellerMetaArParts, "الرقم الضريبي: "+tax)
		}
	}
	if cr := strings.TrimSpace(issuer.CommercialRegister); cr != "" {
		if strings.Contains(cr, "سجل") || strings.Contains(cr, "س.ت") {
			sellerMetaArParts = append(sellerMetaArParts, cr)
		} else {
			sellerMetaArParts = append(sellerMetaArParts, "س.ت: "+cr)
		}
	}
	if phone := strings.TrimSpace(issuer.Phone); phone != "" {
		if strings.Contains(phone, "هاتف") || strings.Contains(phone, "جوال") {
			sellerMetaArParts = append(sellerMetaArParts, phone)
		} else {
			sellerMetaArParts = append(sellerMetaArParts, "هاتف: "+phone)
		}
	}
	sellerMetaAr := strings.Join(sellerMetaArParts, " | ")

	sellerMetaEnParts := make([]string, 0, 3)
	if tax := strings.TrimSpace(issuer.TaxNumber); tax != "" {
		if strings.Contains(strings.ToUpper(tax), "VAT") || strings.Contains(strings.ToUpper(tax), "TAX") {
			sellerMetaEnParts = append(sellerMetaEnParts, tax)
		} else {
			sellerMetaEnParts = append(sellerMetaEnParts, "VAT: "+tax)
		}
	}
	if cr := strings.TrimSpace(issuer.CommercialRegister); cr != "" {
		if strings.Contains(strings.ToUpper(cr), "CR") || strings.Contains(strings.ToUpper(cr), "C.R.") {
			sellerMetaEnParts = append(sellerMetaEnParts, cr)
		} else {
			sellerMetaEnParts = append(sellerMetaEnParts, "C.R.: "+cr)
		}
	}
	if phone := strings.TrimSpace(issuer.Phone); phone != "" {
		if strings.Contains(strings.ToUpper(phone), "TEL") || strings.Contains(strings.ToUpper(phone), "PHONE") {
			sellerMetaEnParts = append(sellerMetaEnParts, phone)
		} else {
			sellerMetaEnParts = append(sellerMetaEnParts, "Tel: "+phone)
		}
	}
	sellerMetaEn := strings.Join(sellerMetaEnParts, " | ")

	replacements := map[string]string{
		"seller_name": issuer.NameAr, "seller_name_en": issuer.NameEn,
		"seller_tax": issuer.TaxNumber, "seller_phone": issuer.Phone,
		"seller_cr": issuer.CommercialRegister, "seller_address": strings.Join(addressParts, " - "),
		"seller_address_en": addressEn,
		"seller_meta_ar": sellerMetaAr, "seller_meta_en": sellerMetaEn,
		"buyer_name": v.ClientName, "client_name": v.ClientName, "received_from": v.ClientName,
		"voucher_number": v.VoucherNumber, "invoice_number": v.VoucherNumber,
		"voucher_date": v.VoucherDate, "issue_date": v.VoucherDate,
		"payment_method": v.PaymentLabel, "reference_no": v.ReferenceNo,
		"notes": v.Notes, "paid_for": paidFor,
		"amount": amount, "total_amount": amount, "grand_total": amount,
		"qr_code": "", "amount_in_words": services.TafqeetArabic(v.TotalAmount), "tafqeet": services.TafqeetArabic(v.TotalAmount), "receiver_name": issuer.NameAr,
	}
	for key, value := range replacements {
		tpl = strings.ReplaceAll(tpl, "{{"+key+"}}", html.EscapeString(value))
	}
	sarSymbol := s.templates.SARSymbolSVG()
	tpl = strings.ReplaceAll(tpl, "{{sar_symbol}}", sarSymbol)
	tpl = strings.ReplaceAll(tpl, "{{currency_symbol}}", sarSymbol)
	logo := ""
	if issuer.LogoData != nil && strings.HasPrefix(*issuer.LogoData, "data:image/") {
		logo = `<img style="max-width:130px;max-height:80px" src="` + html.EscapeString(*issuer.LogoData) + `">`
	}
	tpl = strings.ReplaceAll(tpl, "{{logo}}", logo)
	tpl = injectVoucherPrintStyle(tpl)
	return tpl, nil
}

func injectVoucherPrintStyle(template string) string {
	style := `<style data-voucher-page>
@page { size: A4 portrait !important; margin: 0 !important; }
html, body {
  height: 297mm !important; max-height: 297mm !important; min-height: 0 !important;
  margin: 0 !important; padding: 0 !important; box-sizing: border-box !important;
  overflow: hidden !important; background: #fff !important;
}
body > .receipt-card, body > .receipt-container, body > .receipt-page, body > .receipt, body > .page, body > .sheet, body > main, .voucher-container {
  width: 210mm !important; max-width: 210mm !important;
  height: 297mm !important; max-height: 297mm !important; min-height: 0 !important;
  margin: 0 auto !important; padding: 10mm 12mm !important; box-sizing: border-box !important;
  display: flex !important; flex-direction: column !important; justify-content: space-between !important;
  overflow: hidden !important; break-inside: avoid !important; page-break-inside: avoid !important;
  break-after: avoid !important; page-break-after: avoid !important;
}
body > .receipt-card > .head, body > .receipt-container > .head, body > .receipt-page > .head, body > main > .header, body > .sheet > .header { margin-bottom: 5px !important; flex-shrink: 0 !important; }
body > .receipt-card > .receipt-box, body > .receipt-container > .receipt-box { margin-top: 0 !important; flex-shrink: 0 !important; }
body > .receipt-card > footer, body > .receipt-container > footer, body > .receipt-container > .foot, body > .receipt-page > footer, body > main > footer, body > .sheet > footer, body > .sheet > .voucher-footer { margin-top: auto !important; flex-shrink: 0 !important; }
body > .receipt-page > .document-heading { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .amount-card { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .ornament { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .bottom-rule { margin-top: 4mm !important; }
body > .receipt-card > *, body > .receipt-container > *, body > .receipt-page > *, body > .receipt > *, body > .page > *, body > main > *, body > .sheet > * { flex-shrink: 0; }
@media print {
  body { margin: 0 !important; background: #fff !important; }
  body > .receipt-card, body > .receipt-container, body > .receipt-page, body > .receipt, body > .page, body > main, body > .sheet { box-shadow: none !important; }
}
</style>`
	if headEnd := strings.LastIndex(strings.ToLower(template), "</head>"); headEnd >= 0 {
		return template[:headEnd] + style + "\n" + template[headEnd:]
	}
	return style + "\n" + template
}
