package services

import (
	"path/filepath"
	"testing"

	"raseen/internal/config"
	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
	"raseen/internal/zatca"
)

func setupZatcaTestEnv(t *testing.T) (*db.DB, *InvoiceService, *TemplateService, string, string) {
	t.Helper()
	tmpDir := t.TempDir()
	cfg := config.Load()
	cfg.DataDir = tmpDir
	cfg.DbFile = filepath.Join(tmpDir, "test.db")
	cfg.KeyFile = filepath.Join(tmpDir, "secret.key")
	cfg.BackupDir = filepath.Join(tmpDir, "backups")

	masterKey, err := crypto.GetMasterKey(cfg.KeyFile)
	if err != nil {
		t.Fatalf("GetMasterKey: %v", err)
	}
	database, err := db.Open(cfg)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	issuerSvc := NewIssuerService(database)
	clientSvc := NewClientService(database)
	invSvc := NewInvoiceService(database, issuerSvc, masterKey)
	tplSvc := NewTemplateService(database, tmpDir)

	var issuerID string
	if err := database.QueryRow(`SELECT id FROM issuers LIMIT 1`).Scan(&issuerID); err != nil {
		t.Fatalf("query default issuer: %v", err)
	}
	client := &models.Client{
		Name: "عميل اختبار",
	}
	if err := clientSvc.CreateClient(client); err != nil {
		t.Fatalf("create client: %v", err)
	}
	return database, invSvc, tplSvc, issuerID, client.ID
}

func TestPhase1AndPhase2QRCodeGeneration(t *testing.T) {
	_, invSvc, tplSvc, issuerID, clientID := setupZatcaTestEnv(t)

	// 1. Create PHASE1 invoice -> QR MUST have strictly 5 TLV tags (Tags 1-5 only)
	p1Inv, err := invSvc.CreateInvoice(CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceType:   "STANDARD",
		ZatcaPhase:    "PHASE1",
		PaymentMethod: "CASH",
		IssueDate:     "2026-11-19",
		IssueTime:     "10:00:00",
		Lines: []CreateInvoiceLineInput{
			{ItemName: "صنف اختبار", Quantity: 1, UnitPrice: 100, TaxRate: 15},
		},
	}, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("create PHASE1 invoice: %v", err)
	}
	p1Tags, err := zatca.ParseQrPayload(p1Inv.QrPayload)
	if err != nil {
		t.Fatalf("parse PHASE1 QR: %v", err)
	}
	if len(p1Tags) != 5 {
		t.Fatalf("PHASE1 invoice QR has %d tags, want 5 (Tags 1-5 only)", len(p1Tags))
	}

	// 2. Update PHASE1 invoice -> QR MUST still have strictly 5 TLV tags
	p1Updated, err := invSvc.UpdateInvoice(p1Inv.ID, CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceType:   "STANDARD",
		ZatcaPhase:    "PHASE1",
		PaymentMethod: "CASH",
		IssueDate:     "2026-11-19",
		IssueTime:     "10:05:00",
		Lines: []CreateInvoiceLineInput{
			{ItemName: "صنف اختبار معدل", Quantity: 2, UnitPrice: 100, TaxRate: 15},
		},
	}, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("update PHASE1 invoice: %v", err)
	}
	p1UpdTags, err := zatca.ParseQrPayload(p1Updated.QrPayload)
	if err != nil {
		t.Fatalf("parse updated PHASE1 QR: %v", err)
	}
	if len(p1UpdTags) != 5 {
		t.Fatalf("updated PHASE1 invoice QR has %d tags, want 5", len(p1UpdTags))
	}

	// 3. Credit note for PHASE1 invoice -> QR MUST have strictly 5 TLV tags
	p1CN, err := invSvc.CreateCreditNote(CreateCreditNoteInput{
		OriginalInvoiceID: p1Inv.ID,
		Reason:            "مرتجع اختبار",
		Items: []CreditNoteItemInput{
			{ItemName: "صنف اختبار معدل", Quantity: 1, UnitPrice: 100, TaxRate: 15},
		},
	}, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("create PHASE1 credit note: %v", err)
	}
	p1CNTags, err := zatca.ParseQrPayload(p1CN.QrPayload)
	if err != nil {
		t.Fatalf("parse PHASE1 credit note QR: %v", err)
	}
	if len(p1CNTags) != 5 {
		t.Fatalf("PHASE1 credit note QR has %d tags, want 5", len(p1CNTags))
	}

	// 4. Create PHASE2 invoice -> QR MUST have 8 TLV tags (Tags 1-8)
	p2Inv, err := invSvc.CreateInvoice(CreateInvoiceInput{
		IssuerID:      issuerID,
		ClientID:      clientID,
		InvoiceType:   "STANDARD",
		ZatcaPhase:    "PHASE2",
		PaymentMethod: "CASH",
		IssueDate:     "2026-11-19",
		IssueTime:     "10:10:00",
		Lines: []CreateInvoiceLineInput{
			{ItemName: "صنف مرحلة ثانية", Quantity: 1, UnitPrice: 200, TaxRate: 15},
		},
	}, "admin", "127.0.0.1")
	if err != nil {
		t.Fatalf("create PHASE2 invoice: %v", err)
	}
	p2Tags, err := zatca.ParseQrPayload(p2Inv.QrPayload)
	if err != nil {
		t.Fatalf("parse PHASE2 QR: %v", err)
	}
	if len(p2Tags) < 8 {
		t.Fatalf("PHASE2 invoice QR has %d tags, want >= 8", len(p2Tags))
	}

	// 5. Template rendering for a PHASE1 invoice whose stored QR was polluted with Phase 2 tags
	//    must regenerate a clean 5-tag Phase 1 QR payload.
	pollutedView := &InvoiceView{
		Invoice: models.Invoice{
			InvoiceNumber:   "INV-99999",
			ZatcaPhase:      "PHASE1",
			SignatureMode:   "NONE",
			QrPayload:       p2Inv.QrPayload, // polluted with 8 Phase 2 tags
			InvoiceHash:     p2Inv.InvoiceHash,
			SellerName:      "شركة رسين",
			SellerTaxNumber: "300000000000003",
			IssueDate:       "2026-11-19",
			IssueTime:       "10:00:00",
		},
		GrandTotalMajor: 115.00,
		TaxAmountMajor:  15.00,
	}
	_ = tplSvc.substituteInvoiceTags("<div>{{qr_code}}</div>", pollutedView)
	cleanTags, err := zatca.ParseQrPayload(pollutedView.QrPayload)
	if err != nil {
		t.Fatalf("parse regenerated PHASE1 QR: %v", err)
	}
	if len(cleanTags) != 5 {
		t.Fatalf("template regenerated PHASE1 QR has %d tags, want 5", len(cleanTags))
	}
}
