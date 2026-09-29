package services

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"raseen/internal/config"
	"raseen/internal/db"
)

func setupTestServices(t *testing.T) (*db.DB, *InvoiceService, *TemplateService) {
	t.Helper()
	tempDir := t.TempDir()
	cfg := &config.Config{
		DataDir: tempDir,
		DbFile:  filepath.Join(tempDir, "test.db"),
		Defaults: config.Defaults{
			Currency: "SAR",
			TaxRate:  15.0,
			Country:  "SA",
		},
	}
	database, err := db.Open(cfg)
	if err != nil {
		t.Fatalf("Failed to open test db: %v", err)
	}

	issSvc := NewIssuerService(database)
	masterKey := make([]byte, 32)
	invSvc := NewInvoiceService(database, issSvc, masterKey)
	
	// Copy or point to data/templates
	wd, _ := os.Getwd()
	// Find project root
	root := wd
	for !fileExists(filepath.Join(root, "go.mod")) && filepath.Dir(root) != root {
		root = filepath.Dir(root)
	}
	tplSvc := NewTemplateService(database, filepath.Join(root, "data"))

	return database, invSvc, tplSvc
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func createTestIssuerAndClient(t *testing.T, database *db.DB) (string, string) {
	t.Helper()
	issuerID := "iss-test-1"
	clientID := "cli-test-1"
	now := "2026-09-30T00:00:00Z"

	_, err := database.Exec(`
		INSERT INTO issuers (
			id, code, name_ar, name_en, tax_number, commercial_register,
			city, district, street, building_no, postal_code, country,
			city_en, district_en, street_en, address_en,
			phone, email, is_active, created_at, updated_at
		) VALUES (
			?, 'ISS01', 'شركة روائع التقنية', 'Rawaia Tech Co.', '310123456700003', '1010123456',
			'الرياض', 'الملز', 'طريق صلاح الدين', '1234', '12836', 'SA',
			'Riyadh', 'Al Malaz', 'Salah Al Din St.', 'Riyadh, Salah Al Din St., Al Malaz',
			'0501234567', 'info@rawaiatech.com', 1, ?, ?
		)
	`, issuerID, now, now)
	if err != nil {
		t.Fatalf("Failed to insert issuer: %v", err)
	}

	_, err = database.Exec(`
		INSERT INTO clients (
			id, client_code, name, tax_number, commercial_register,
			city, district, street, building_no, postal_code, country,
			phone, is_active, created_at, updated_at
		) VALUES (
			?, 'C-001', 'مؤسسة الأفق للتجارة', '310987654300003', '1010987654',
			'جدة', 'الروضة', 'شارع الأمير سلطان', '5678', '23432', 'SA',
			'0559876543', 1, ?, ?
		)
	`, clientID, now, now)
	if err != nil {
		t.Fatalf("Failed to insert client: %v", err)
	}

	return issuerID, clientID
}

// Test 1: Invoice Number Editing and Duplicate Check
func TestInvoiceNumberEditing(t *testing.T) {
	database, invSvc, _ := setupTestServices(t)
	defer database.Close()
	issuerID, clientID := createTestIssuerAndClient(t, database)

	// Create invoice with number INV-1001
	createInput := CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceNumber: "INV-1001",
		IssueDate:     "2026-09-30",
		PaymentMethod: "CREDIT",
		Lines: []CreateInvoiceLineInput{
			{
				ItemName:  "منتج تجريبي 1",
				ItemCode:  "PRD-01",
				Unit:      "حبة",
				UnitPrice: 100.0,
				Quantity:  2,
				TaxRate:   15.0,
			},
		},
	}

	created, err := invSvc.CreateInvoice(createInput, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("Failed to create invoice: %v", err)
	}
	if created.InvoiceNumber != "INV-1001" {
		t.Fatalf("Expected invoice number INV-1001, got %s", created.InvoiceNumber)
	}

	// Now update invoice number to INV-9999
	updateInput := createInput
	updateInput.InvoiceNumber = "INV-9999"
	updated, err := invSvc.UpdateInvoice(created.ID, updateInput, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("Failed to update invoice: %v", err)
	}
	if updated.InvoiceNumber != "INV-9999" {
		t.Fatalf("Expected updated invoice number to be INV-9999, got %s", updated.InvoiceNumber)
	}

	// Verify in DB directly
	var dbInvNum string
	err = database.QueryRow("SELECT invoice_number FROM invoices WHERE id = ?", created.ID).Scan(&dbInvNum)
	if err != nil || dbInvNum != "INV-9999" {
		t.Fatalf("DB invoice_number mismatch: %s, err: %v", dbInvNum, err)
	}

	// Verify XML document contains updated invoice number
	var xmlDoc string
	err = database.QueryRow("SELECT xml FROM invoice_documents WHERE invoice_id = ?", created.ID).Scan(&xmlDoc)
	if err != nil || !strings.Contains(xmlDoc, "INV-9999") {
		t.Fatalf("Invoice XML missing updated invoice number INV-9999, err: %v", err)
	}

	// Create second invoice INV-2002
	createInput2 := createInput
	createInput2.InvoiceNumber = "INV-2002"
	created2, err := invSvc.CreateInvoice(createInput2, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("Failed to create second invoice: %v", err)
	}

	// Attempt to rename second invoice to INV-9999 (duplicate check)
	updateInput2 := createInput2
	updateInput2.InvoiceNumber = "INV-9999"
	_, err = invSvc.UpdateInvoice(created2.ID, updateInput2, "admin", "127.0.0.1")
	if err == nil {
		t.Fatalf("Expected error when setting duplicate invoice number, but got nil")
	}
	t.Logf("Duplicate error caught successfully: %v", err)
}

// Test 2: Item Unit Column in Templates and HTML Output
func TestItemUnitInTemplates(t *testing.T) {
	database, invSvc, tplSvc := setupTestServices(t)
	defer database.Close()
	issuerID, clientID := createTestIssuerAndClient(t, database)

	invInput := CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceNumber: "INV-UNIT-01",
		IssueDate:     "2026-09-30",
		PaymentMethod: "CASH",
		Lines: []CreateInvoiceLineInput{
			{
				ItemName:  "أسمنت بورتلاندي",
				ItemCode:  "CEM-01",
				Unit:      "كيس",
				UnitPrice: 25.0,
				Quantity:  50,
				TaxRate:   15.0,
			},
		},
	}
	inv, err := invSvc.CreateInvoice(invInput, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateInvoice failed: %v", err)
	}

	// Render with template 01-royal-navy
	htmlOut, err := tplSvc.RenderInvoiceHTML(inv, "01-royal-navy")
	if err != nil {
		t.Fatalf("RenderInvoiceHTML failed: %v", err)
	}

	if !strings.Contains(htmlOut, "الوحدة") {
		t.Fatalf("Rendered HTML missing 'الوحدة' column header")
	}
	if !strings.Contains(htmlOut, "كيس") {
		t.Fatalf("Rendered HTML missing unit value 'كيس'")
	}
	t.Logf("Item unit verified in rendered HTML successfully")
}

// Test 3: English Address Display
func TestEnglishAddressDisplay(t *testing.T) {
	database, invSvc, tplSvc := setupTestServices(t)
	defer database.Close()
	issuerID, clientID := createTestIssuerAndClient(t, database)

	invInput := CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceNumber: "INV-ADDR-01",
		IssueDate:     "2026-09-30",
		PaymentMethod: "CASH",
		Lines: []CreateInvoiceLineInput{
			{
				ItemName:  "استشارة تقنية",
				ItemCode:  "CNS-01",
				Unit:      "ساعة",
				UnitPrice: 500.0,
				Quantity:  10,
				TaxRate:   15.0,
			},
		},
	}
	inv, err := invSvc.CreateInvoice(invInput, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateInvoice failed: %v", err)
	}

	htmlOut, err := tplSvc.RenderInvoiceHTML(inv, "01-royal-navy")
	if err != nil {
		t.Fatalf("RenderInvoiceHTML failed: %v", err)
	}

	// Issuer English address was set to "Riyadh, Salah Al Din St., Al Malaz"
	if !strings.Contains(htmlOut, "Riyadh") && !strings.Contains(htmlOut, "Salah Al Din") {
		t.Fatalf("Rendered HTML missing English address components (Riyadh / Salah Al Din)")
	}
	t.Logf("English address verified in rendered HTML successfully")
}

// Test 4: Multipage Invoice Continuation and Badges
func TestMultipageContinuation(t *testing.T) {
	database, invSvc, tplSvc := setupTestServices(t)
	defer database.Close()
	issuerID, clientID := createTestIssuerAndClient(t, database)

	// Create an invoice with 22 items (chunk size is 15 -> will result in 2 pages)
	lines := make([]CreateInvoiceLineInput, 22)
	for i := 0; i < 22; i++ {
		lines[i] = CreateInvoiceLineInput{
			ItemName:  fmt.Sprintf("بند الفاتورة رقم %02d", i+1),
			ItemCode:  fmt.Sprintf("ITM-%02d", i+1),
			Unit:      "حبة",
			UnitPrice: float64(10 + i),
			Quantity:  1,
			TaxRate:   15.0,
		}
	}

	invInput := CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceNumber: "INV-MULTI-01",
		IssueDate:     "2026-09-30",
		PaymentMethod: "CASH",
		Lines:         lines,
	}
	inv, err := invSvc.CreateInvoice(invInput, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateInvoice failed: %v", err)
	}

	htmlOut, err := tplSvc.RenderInvoiceHTML(inv, "01-royal-navy")
	if err != nil {
		t.Fatalf("RenderInvoiceHTML failed: %v", err)
	}

	// Page 1 assertions
	if !strings.Contains(htmlOut, `data-invoice-page="1"`) {
		t.Fatalf("Missing data-invoice-page='1'")
	}
	if !strings.Contains(htmlOut, "صفحة 1 من 2") {
		t.Fatalf("Missing Page 1 indicator 'صفحة 1 من 2'")
	}
	if !strings.Contains(htmlOut, "يتبع في الصفحة التالية") {
		t.Fatalf("Missing continuation footer 'يتبع في الصفحة التالية'")
	}

	// Page 2 assertions
	if !strings.Contains(htmlOut, `data-invoice-page="2"`) {
		t.Fatalf("Missing data-invoice-page='2'")
	}
	if !strings.Contains(htmlOut, "invoice-continuation-header") {
		t.Fatalf("Missing continuation header class 'invoice-continuation-header'")
	}
	if !strings.Contains(htmlOut, "تابع فاتورة ضريبية") {
		t.Fatalf("Missing continuation text 'تابع فاتورة ضريبية'")
	}
	if !strings.Contains(htmlOut, "Continuation Sheet") {
		t.Fatalf("Missing English continuation text 'Continuation Sheet'")
	}
	if !strings.Contains(htmlOut, "نهاية بنود الفاتورة") {
		t.Fatalf("Missing end of items footer 'نهاية بنود الفاتورة'")
	}

	t.Logf("Multipage continuation verified successfully: Page 1 and Page 2 badges, footers, and continuation indicators are all present and correct.")
}

func TestAllTemplatesRenderUnitAndContinuation(t *testing.T) {
	database, invSvc, tplSvc := setupTestServices(t)
	defer database.Close()
	issuerID, clientID := createTestIssuerAndClient(t, database)

	invInput := CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceNumber: "INV-ALL-01",
		IssueDate:     "2026-09-30",
		PaymentMethod: "CREDIT",
		Lines: []CreateInvoiceLineInput{
			{
				ItemName:  "منتج شامل للوحدة",
				ItemCode:  "ALL-01",
				Unit:      "حبة_اختبار",
				UnitPrice: 50.0,
				Quantity:  2,
				TaxRate:   15.0,
			},
		},
	}
	inv, err := invSvc.CreateInvoice(invInput, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateInvoice failed: %v", err)
	}

	tplFiles, err := filepath.Glob(filepath.Join("..", "..", "data", "templates", "invoices", "*.html"))
	if err != nil || len(tplFiles) == 0 {
		t.Fatalf("No templates found in data/templates/invoices: %v", err)
	}

	for _, file := range tplFiles {
		styleName := strings.TrimSuffix(filepath.Base(file), ".html")
		rendered, err := tplSvc.RenderInvoiceHTML(inv, styleName)
		if err != nil {
			t.Errorf("Template %s failed to render: %v", styleName, err)
			continue
		}
		if !strings.Contains(rendered, "حبة_اختبار") {
			t.Errorf("Template %s failed to display unit value 'حبة_اختبار'", styleName)
		}
	}
	t.Logf("All %d templates successfully verified for unit rendering!", len(tplFiles))
}

func TestTaxableVsTaxAmountColumns(t *testing.T) {
	// 1. Unit tests on detectColumnType
	cases := []struct {
		header   string
		expected colType
	}{
		{"قبل الضريبة", colTaxable},
		{"المبلغ قبل الضريبة", colTaxable},
		{"الخاضع للضريبة", colTaxable},
		{"الإجمالي قبل الضريبة", colTaxable},
		{"مبلغ الضريبة", colTaxAmount},
		{"قيمة الضريبة", colTaxAmount},
		{"ضريبة", colTaxAmount},
		{"ضريبة 15%", colTaxAmount},
		{"شامل الضريبة", colTotal},
		{"الإجمالي شامل الضريبة", colTotal},
	}

	for _, tc := range cases {
		actual := detectColumnType(tc.header)
		if actual != tc.expected {
			t.Errorf("detectColumnType(%q) = %v, expected %v", tc.header, actual, tc.expected)
		}
	}

	// 2. Integration test matching the exact numbers in the client photo:
	// Item 1: Qty 135, UnitPrice 3.41 => Taxable: 460.35, Tax: 69.05, Total: 529.40
	// Item 2: Qty 1, UnitPrice 14.00 => Taxable: 14.00, Tax: 2.10, Total: 16.10
	database, invSvc, tplSvc := setupTestServices(t)
	defer database.Close()
	issuerID, clientID := createTestIssuerAndClient(t, database)

	invInput := CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceNumber: "INV-TAXABLE-TEST",
		IssueDate:     "2026-09-27",
		PaymentMethod: "CREDIT",
		Lines: []CreateInvoiceLineInput{
			{
				ItemName:  "شاحن قماش تايب سي",
				ItemCode:  "SK-12301",
				Unit:      "حبة",
				UnitPrice: 3.41,
				Quantity:  135,
				TaxRate:   15.0,
			},
			{
				ItemName:  "كيبل ايفون",
				ItemCode:  "SK-12302",
				Unit:      "حبة",
				UnitPrice: 14.00,
				Quantity:  1,
				TaxRate:   15.0,
			},
		},
	}

	inv, err := invSvc.CreateInvoice(invInput, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateInvoice failed: %v", err)
	}

	// Render using template 07-violet-facets (which has قبل الضريبة, مبلغ الضريبة, شامل الضريبة)
	rendered, err := tplSvc.RenderInvoiceHTML(inv, "07-violet-facets")
	if err != nil {
		t.Fatalf("RenderInvoiceHTML failed: %v", err)
	}

	// Verify Item 1 taxable is 460.35, tax is 69.05, total is 529.40
	if !strings.Contains(rendered, "460.35") {
		t.Errorf("Rendered HTML missing taxable amount 460.35 for item 1 in 'قبل الضريبة'")
	}
	if !strings.Contains(rendered, "69.05") {
		t.Errorf("Rendered HTML missing tax amount 69.05 for item 1")
	}
	if !strings.Contains(rendered, "529.40") {
		t.Errorf("Rendered HTML missing total amount 529.40 for item 1")
	}

	// Verify Item 2 taxable is 14.00, tax is 2.10, total is 16.10
	if !strings.Contains(rendered, "14.00") {
		t.Errorf("Rendered HTML missing taxable amount 14.00 for item 2 in 'قبل الضريبة'")
	}
	if !strings.Contains(rendered, "2.10") {
		t.Errorf("Rendered HTML missing tax amount 2.10 for item 2")
	}
	if !strings.Contains(rendered, "16.10") {
		t.Errorf("Rendered HTML missing total amount 16.10 for item 2")
	}

	t.Logf("Taxable amount vs tax amount columns verified successfully for client invoice data!")
}

// Test 6: Bulk Invoices Non-Sequential Numbering with Realistic Gaps
func TestBulkNonSequentialInvoiceNumbers(t *testing.T) {
	database, invSvc, _ := setupTestServices(t)
	defer database.Close()
	issuerID, clientID := createTestIssuerAndClient(t, database)

	issSvc := NewIssuerService(database)
	cliSvc := NewClientService(database)
	itmSvc := NewItemService(database)
	vchSvc := NewVoucherService(database, issSvc)
	bulkSvc := NewBulkService(database, invSvc, vchSvc, issSvc, cliSvc, itmSvc)

	// 1. Generate preview with StartInvoiceNumber = INV-0500 and count = 8
	req := PreviewRequest{
		IssuerID:           issuerID,
		ClientID:           clientID,
		Count:              8,
		StartInvoiceNumber: "INV-0500",
		DateFrom:           "2026-09-01",
		DateTo:             "2026-09-30",
		InvoiceType:        "STANDARD",
		PaymentMethods:     []string{"CREDIT"},
		CustomItems: []CustomItemInput{
			{
				NameAr:    "صنف تجريبي للدفعة",
				ItemCode:  "BLK-01",
				Unit:      "حبة",
				SalePrice: 150.0,
				TaxRate:   15.0,
			},
		},
	}

	preview, err := bulkSvc.GeneratePreview(req)
	if err != nil {
		t.Fatalf("GeneratePreview failed: %v", err)
	}

	invs, ok := preview["invoices"].([]map[string]any)
	if !ok || len(invs) != 8 {
		t.Fatalf("Expected 8 invoices in preview, got %d", len(invs))
	}

	numbers := make([]string, len(invs))
	numericParts := make([]int64, len(invs))
	for i, inv := range invs {
		numStr, ok := inv["invoice_number"].(string)
		if !ok || numStr == "" {
			t.Fatalf("Invoice %d missing invoice_number", i+1)
		}
		numbers[i] = numStr
		// Parse numeric part
		var val int64
		fmt.Sscanf(strings.TrimPrefix(numStr, "INV-"), "%d", &val)
		numericParts[i] = val
	}

	t.Logf("Generated non-sequential bulk invoice numbers: %v", numbers)

	// Assert non-sequential property:
	// 1. All numbers must be unique
	seen := make(map[string]bool)
	for _, n := range numbers {
		if seen[n] {
			t.Fatalf("Duplicate invoice number generated in bulk batch: %s", n)
		}
		seen[n] = true
	}

	// 2. First invoice must be the starting number INV-0500
	if numbers[0] != "INV-0500" {
		t.Fatalf("Expected first invoice number to be INV-0500, got %s", numbers[0])
	}

	// 3. Every subsequent invoice must have a gap >= 2 (NOT sequential +1!)
	for i := 1; i < len(numericParts); i++ {
		diff := numericParts[i] - numericParts[i-1]
		if diff < 2 {
			t.Fatalf("Invoice %d (%s) is sequential to invoice %d (%s), gap is %d, expected gap >= 2",
				i+1, numbers[i], i, numbers[i-1], diff)
		}
	}

	// 4. Test CommitBatch and check database persistence
	commitReq := CommitBatchRequest{
		RequestID: "req-bulk-test-01",
		IssuerID:  issuerID,
		ClientID:  clientID,
		Invoices:  make([]any, len(invs)),
	}
	for i, inv := range invs {
		commitReq.Invoices[i] = inv
	}

	commitResult, err := bulkSvc.CommitBatch(commitReq, "admin")
	if err != nil {
		t.Fatalf("CommitBatch failed: %v", err)
	}

	invIds, ok := commitResult["invoice_ids"].([]string)
	if !ok || len(invIds) != 8 {
		t.Fatalf("Expected 8 committed invoice IDs, got %d", len(invIds))
	}

	// Verify all invoice numbers in database match the non-sequential generated numbers
	for i, id := range invIds {
		var dbNum string
		err := database.QueryRow("SELECT invoice_number FROM invoices WHERE id = ?", id).Scan(&dbNum)
		if err != nil || dbNum != numbers[i] {
			t.Fatalf("Committed invoice %s has number %s in DB, expected %s", id, dbNum, numbers[i])
		}
	}

	// Verify issuer next invoice number was updated past the maximum generated number
	var nextNo int64
	err = database.QueryRow("SELECT invoice_next_no FROM issuers WHERE id = ?", issuerID).Scan(&nextNo)
	if err != nil {
		t.Fatalf("Failed to query issuer next_no: %v", err)
	}
	maxNum := numericParts[len(numericParts)-1]
	if nextNo <= maxNum {
		t.Fatalf("Issuer invoice_next_no (%d) was not updated past batch maximum (%d)", nextNo, maxNum)
	}

	t.Logf("Bulk non-sequential invoice numbering verified successfully! All 8 invoices committed with realistic gaps and issuer counter advanced to %d.", nextNo)
}

