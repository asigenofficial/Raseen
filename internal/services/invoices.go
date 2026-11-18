package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
	"raseen/internal/zatca"
)

type InvoiceService struct {
	db        *db.DB
	issuers   *IssuerService
	masterKey []byte
}

func NewInvoiceService(d *db.DB, iss *IssuerService, masterKey []byte) *InvoiceService {
	return &InvoiceService{
		db:        d,
		issuers:   iss,
		masterKey: masterKey,
	}
}

type CreateInvoiceLineInput struct {
	ItemID          *string `json:"item_id"`
	ItemCode        string  `json:"item_code"`
	ItemName        string  `json:"item_name"`
	Unit            string  `json:"unit"`
	Quantity        float64 `json:"quantity"`
	UnitPrice       float64 `json:"unit_price"`
	Discount        float64 `json:"discount"`
	DiscountPercent float64 `json:"discount_percent"`
	TaxRate         float64 `json:"tax_rate"`
	taxRateMissing  bool
}

func (l *CreateInvoiceLineInput) UnmarshalJSON(data []byte) error {
	type plain CreateInvoiceLineInput
	if err := json.Unmarshal(data, (*plain)(l)); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	v, ok := fields["tax_rate"]
	l.taxRateMissing = !ok || string(v) == "null"
	return nil
}

type CreateInvoiceInput struct {
	IssuerID         string                   `json:"issuer_id"`
	ClientID         string                   `json:"client_id"`
	InvoiceNumber    string                   `json:"invoice_number"`
	InvoiceType      string                   `json:"invoice_type"` // STANDARD | SIMPLIFIED
	ZatcaPhase       string                   `json:"zatca_phase"`  // PHASE1 | PHASE2
	PaymentMethod    string                   `json:"payment_method"`
	IssueDate        string                   `json:"issue_date"`
	IssueTime        string                   `json:"issue_time"`
	DueDate          *string                  `json:"due_date"`
	ChequeDate       *string                  `json:"cheque_date"`
	ChequeNo         string                   `json:"cheque_no"`
	PricesIncludeTax bool                     `json:"prices_include_tax"`
	ShowSarSymbol    *models.FlexBool         `json:"show_sar_symbol,omitempty"`
	Notes            string                   `json:"notes"`
	AutoReceipt      bool                     `json:"auto_receipt"`
	Lines            []CreateInvoiceLineInput `json:"lines"`
}

func invoiceBuyerAddress(client models.Client) string {
	if address := strings.TrimSpace(client.Address); address != "" {
		return address
	}
	parts := []string{}
	for _, part := range []string{client.City, client.District, client.Street, client.BuildingNo, client.PostalCode, client.Country} {
		if part = strings.TrimSpace(part); part != "" {
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, " - ")
}

var invoicePaymentLabels = map[string]string{
	"CASH":     "نقداً",
	"CARD":     "شبكة",
	"TRANSFER": "تحويل بنكي",
	"CREDIT":   "آجل",
	"CHEQUE":   "شيك",
}

var invoiceStatusLabels = map[string]string{
	"UNPAID":    "غير مسددة",
	"PARTIAL":   "مسددة جزئياً",
	"PAID":      "مسددة",
	"CANCELLED": "ملغاة",
}

type InvoiceView struct {
	models.Invoice
	IssuerSnapshot       *models.Issuer    `json:"issuer_snapshot,omitempty"`
	ClientSnapshot       *models.Client    `json:"client_snapshot,omitempty"`
	ClientCode           string            `json:"client_code"`
	PaymentLabel         string            `json:"payment_label"`
	StatusLabel          string            `json:"status_label"`
	SubtotalMajor        float64           `json:"subtotal"`
	DiscountAmountMajor  float64           `json:"discount_amount"`
	TaxableAmountMajor   float64           `json:"taxable_amount"`
	TaxAmountMajor       float64           `json:"tax_amount"`
	GrandTotalMajor      float64           `json:"grand_total"`
	PaidAmountMajor      float64           `json:"paid_amount"`
	RemainingAmountMajor float64           `json:"remaining_amount"`
	Items                []InvoiceItemView `json:"items"`
	Lines                []InvoiceItemView `json:"lines"`
}

type InvoiceItemView struct {
	models.InvoiceItem
	UnitPriceMajor float64 `json:"unit_price"`
	DiscountMajor  float64 `json:"discount"`
	TaxableMajor   float64 `json:"taxable"`
	TaxAmountMajor float64 `json:"tax_amount"`
	TotalLineMajor float64 `json:"total_line"`
}

func (s *InvoiceService) CreateInvoice(input CreateInvoiceInput, actor, ip string) (*InvoiceView, error) {
	var invID string
	err := s.db.WithWriteLock(func() error {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		inv, err := s.createInvoiceTx(tx, input, actor, ip)
		if err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		invID = inv.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetInvoice(invID)
}

func (s *InvoiceService) createInvoiceTx(tx *sql.Tx, input CreateInvoiceInput, actor, ip string) (*InvoiceView, error) {
	if input.IssuerID == "" || input.ClientID == "" {
		return nil, errors.New("المنشأة المصدرة والعميل مطلوبان")
	}
	if len(input.Lines) == 0 || len(input.Lines) > 500 {
		return nil, errors.New("يجب إضافة بند واحد على الأقل للفاتورة")
	}

	issuer, err := getIssuer(tx, input.IssuerID)
	if err != nil {
		return nil, errors.New("المنشأة المصدرة غير موجودة")
	}

	var client models.Client
	err = tx.QueryRow(`
		SELECT id, client_code, name, tax_number, commercial_register, address, street, building_no, district, city, postal_code, country, payment_terms_days
		FROM clients WHERE id = ?
	`, input.ClientID).Scan(
		&client.ID, &client.ClientCode, &client.Name, &client.TaxNumber, &client.CommercialRegister,
		&client.Address, &client.Street, &client.BuildingNo, &client.District, &client.City, &client.PostalCode, &client.Country,
		&client.PaymentTermsDays,
	)
	if err != nil {
		return nil, errors.New("العميل غير موجود")
	}

	riyadhLoc := time.FixedZone("Asia/Riyadh", 3*3600)
	nowDt := time.Now().In(riyadhLoc)
	issueDate := input.IssueDate
	if issueDate == "" {
		issueDate = nowDt.Format("2006-01-02")
	}
	issueTime := input.IssueTime
	if issueTime == "" {
		issueTime = nowDt.Format("15:04:05")
	}
	if len(issueTime) == 5 {
		issueTime += ":00"
	}
	_, err = time.ParseInLocation("2006-01-02T15:04:05", issueDate+"T"+issueTime, riyadhLoc)
	if err != nil {
		return nil, errors.New("تاريخ أو وقت الفاتورة غير صالح")
	}
	issueDatetime := fmt.Sprintf("%sT%sZ", issueDate, issueTime)

	invoiceType := input.InvoiceType
	if invoiceType == "" {
		invoiceType = "STANDARD"
	}
	zatcaPhase := input.ZatcaPhase
	if zatcaPhase == "" {
		zatcaPhase = issuer.ZatcaPhase
	}
	if zatcaPhase == "" {
		zatcaPhase = "PHASE1"
	}
	paymentMethod := input.PaymentMethod
	if paymentMethod == "" {
		paymentMethod = "CREDIT"
	}
	if invoiceType != "STANDARD" && invoiceType != "SIMPLIFIED" {
		return nil, errors.New("نوع الفاتورة غير صالح")
	}
	if _, ok := invoicePaymentLabels[paymentMethod]; !ok {
		return nil, errors.New("طريقة السداد غير صالحة")
	}
	if zatcaPhase != "PHASE1" && zatcaPhase != "PHASE2" {
		return nil, errors.New("مرحلة الفوترة غير صالحة")
	}

	computedLines, subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalMinor, grandTotalMinor, err := computeInvoiceLines(input.Lines, input.PricesIncludeTax, issuer.DefaultTaxRate)
	if err != nil {
		return nil, err
	}

	// Auto-assign sequential ITM-XXXX code for any free items without an item code
	var maxItmNum int
	_ = tx.QueryRow(`
		SELECT COALESCE(MAX(CAST(SUBSTR(item_code, 5) AS INTEGER)), 0)
		FROM (
			SELECT item_code FROM items WHERE item_code LIKE 'ITM-%'
			UNION ALL
			SELECT item_code FROM invoice_items WHERE item_code LIKE 'ITM-%'
		)
	`).Scan(&maxItmNum)

	for i := range computedLines {
		if strings.TrimSpace(computedLines[i].ItemCode) == "" {
			maxItmNum++
			computedLines[i].ItemCode = fmt.Sprintf("ITM-%04d", maxItmNum)
		}
	}

	// Allocate serial and ICV
	invoiceNumber := input.InvoiceNumber
	var sequenceNo int64
	if invoiceNumber == "" {
		num, _, err := s.issuers.NextInvoiceNumber(tx, issuer.ID)
		if err != nil {
			return nil, err
		}
		invoiceNumber = num
	}
	// The chain counter is independent of editable invoice numbering.
	if err := tx.QueryRow("SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM invoices WHERE issuer_id = ?", issuer.ID).Scan(&sequenceNo); err != nil {
		return nil, err
	}

	// Previous invoice hash
	var pih string
	err = tx.QueryRow(`
		SELECT invoice_hash FROM invoices
		WHERE issuer_id = ?
		ORDER BY sequence_no DESC LIMIT 1
	`, issuer.ID).Scan(&pih)
	if err != nil || pih == "" {
		pih = zatca.GenesisPIH
	}

	invoiceID := crypto.UUID()
	invUUID := crypto.UUID()

	// Build UBL and ZATCA fields
	sellerParts := []string{}
	for _, p := range []string{issuer.City, issuer.District, issuer.Street, issuer.BuildingNo, issuer.PostalCode, issuer.Country} {
		if strings.TrimSpace(p) != "" {
			sellerParts = append(sellerParts, strings.TrimSpace(p))
		}
	}
	sellerAddr := strings.Join(sellerParts, " - ")

	buyerAddr := invoiceBuyerAddress(client)

	var ublLines []zatca.UblLineItem
	for _, cl := range computedLines {
		ublLines = append(ublLines, zatca.UblLineItem{
			Name:        cl.ItemName,
			Unit:        cl.Unit,
			Quantity:    fmt.Sprintf("%.3f", cl.Quantity),
			UnitPrice:   models.FmtMoney(cl.UnitPrice),
			TaxRate:     cl.taxRateDisplay,
			Taxable:     models.FmtMoney(cl.Taxable),
			TaxAmount:   models.FmtMoney(cl.TaxAmount),
			RoundingAmt: models.FmtMoney(cl.TotalLine),
		})
	}

	ublInv := zatca.UblInvoiceInfo{
		InvoiceNumber:  invoiceNumber,
		UUID:           invUUID,
		IssueDate:      issueDate,
		IssueTime:      issueTime,
		InvoiceType:    invoiceType,
		Subtotal:       models.FmtMoney(subtotalMinor),
		DiscountAmount: models.FmtMoney(discountTotalMinor),
		TaxableAmount:  models.FmtMoney(taxableTotalMinor),
		TaxAmount:      models.FmtMoney(taxTotalMinor),
		GrandTotal:     models.FmtMoney(grandTotalMinor),
		TaxRateDisplay: fmt.Sprintf("%.2f", issuer.DefaultTaxRate),
	}

	ublIssuer := zatca.UblPartyInfo{
		Name:               issuer.NameAr,
		TaxNumber:          issuer.TaxNumber,
		CommercialRegister: issuer.CommercialRegister,
		Street:             issuer.Street,
		BuildingNo:         issuer.BuildingNo,
		District:           issuer.District,
		City:               issuer.City,
		PostalCode:         issuer.PostalCode,
		Country:            issuer.Country,
	}

	ublClient := zatca.UblPartyInfo{
		Name:               client.Name,
		TaxNumber:          client.TaxNumber,
		CommercialRegister: client.CommercialRegister,
		Street:             client.Street,
		BuildingNo:         client.BuildingNo,
		District:           client.District,
		City:               client.City,
		PostalCode:         client.PostalCode,
		Country:            client.Country,
	}

	xml := zatca.BuildUblXml(ublInv, ublIssuer, ublClient, ublLines, zatca.UblChainInfo{
		ICV:      sequenceNo,
		PIH:      pih,
		Currency: issuer.Currency,
	})

	invHash := zatca.InvoiceHash(xml)

	qrParams := zatca.QrParams{
		SellerName: issuer.NameAr,
		VatNumber:  issuer.TaxNumber,
		Timestamp:  issueDatetime,
		Total:      models.FmtMoney(grandTotalMinor),
		VatTotal:   models.FmtMoney(taxTotalMinor),
	}

	signature := ""
	signatureMode := "NONE"
	if zatcaPhase == "PHASE2" {
		qrParams.InvoiceHash = invHash
		signature, qrParams.PublicKey, err = s.signInvoiceHashTx(tx, issuer.ID, invHash)
		if err != nil {
			return nil, err
		}
		signatureMode = "LOCAL"
		qrParams.Signature = signature
	}

	qrPayload := zatca.BuildQrPayload(qrParams)

	nowIso := db.NowIso()
	pricesIncInt := 0
	if input.PricesIncludeTax {
		pricesIncInt = 1
	}
	showSarInt := 1
	if input.ShowSarSymbol != nil && !*input.ShowSarSymbol {
		showSarInt = 0
	}

	initPaidMinor := int64(0)
	initRemMinor := grandTotalMinor
	initStatus := "UNPAID"
	isCashInvoice := strings.Contains(paymentMethod, "نقد") || strings.EqualFold(paymentMethod, "CASH") || strings.Contains(strings.ToLower(paymentMethod), "cash")
	if isCashInvoice {
		initPaidMinor = grandTotalMinor
		initRemMinor = 0
		initStatus = "PAID"
	}

	sellerAddressEn := issuer.AddressEn
	if sellerAddressEn == "" {
		sellerAddressEn = formatNationalAddressEn(issuer.CityEn, issuer.DistrictEn, issuer.StreetEn, issuer.BuildingNo, issuer.PostalCode)
	}

	var dueDateVal *string
	if input.DueDate != nil && strings.TrimSpace(*input.DueDate) != "" {
		d := strings.TrimSpace(*input.DueDate)
		dueDateVal = &d
	}
	var chequeDateVal *string
	if input.ChequeDate != nil && strings.TrimSpace(*input.ChequeDate) != "" {
		c := strings.TrimSpace(*input.ChequeDate)
		chequeDateVal = &c
	}
	chequeNoVal := strings.TrimSpace(input.ChequeNo)

	_, err = tx.Exec(`
		INSERT INTO invoices (
			id, issuer_id, client_id, invoice_number, sequence_no, invoice_type, zatca_phase,
			uuid, issue_date, issue_time, issue_datetime, currency,
			subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
			paid_amount, remaining_amount, status, payment_method,
			due_date, cheque_date, cheque_no, prices_include_tax, show_sar_symbol,
			seller_name, seller_tax_number, seller_cr, seller_address, seller_address_en,
			buyer_name, buyer_tax_number, buyer_cr, buyer_address,
			qr_payload, invoice_hash, previous_invoice_hash, signature, signature_mode,
			notes, created_by, created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?
		)
	`,
		invoiceID, issuer.ID, client.ID, invoiceNumber, sequenceNo, invoiceType, zatcaPhase,
		invUUID, issueDate, issueTime, issueDatetime, issuer.Currency,
		subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalMinor, grandTotalMinor,
		initPaidMinor, initRemMinor, initStatus, paymentMethod,
		dueDateVal, chequeDateVal, chequeNoVal, pricesIncInt, showSarInt,
		issuer.NameAr, issuer.TaxNumber, issuer.CommercialRegister, sellerAddr, sellerAddressEn,
		client.Name, client.TaxNumber, client.CommercialRegister, buyerAddr,
		qrPayload, invHash, pih, signature, signatureMode,
		input.Notes, actor, nowIso, nowIso,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert invoice: %w", err)
	}

	// Insert invoice items
	for _, cl := range computedLines {
		cl.InvoiceID = invoiceID
		if err = insertInvoiceItemTx(tx, cl.InvoiceItem); err != nil {
			return nil, fmt.Errorf("failed to insert invoice item: %w", err)
		}
	}

	// Post debit entry in client_ledger
	_, err = tx.Exec(`
		INSERT INTO client_ledger (
			id, client_id, issuer_id, doc_type, doc_id, doc_number,
			transaction_date, debit, credit, description, created_at
		) VALUES (?, ?, ?, 'INVOICE', ?, ?, ?, ?, 0, ?, ?)
	`, crypto.UUID(), client.ID, issuer.ID, invoiceID, invoiceNumber, issueDate, grandTotalMinor, fmt.Sprintf("فاتورة رقم %s", invoiceNumber), nowIso)
	if err != nil {
		return nil, fmt.Errorf("failed to post ledger entry: %w", err)
	}

	// Every invoice marked as paid needs an actual receipt and a matching ledger credit.
	if (input.AutoReceipt || isCashInvoice) && paymentMethod != "CREDIT" && grandTotalMinor > 0 {
		if err = s.createInvoiceReceiptTx(tx, models.Invoice{ID: invoiceID, IssuerID: issuer.ID, ClientID: client.ID, InvoiceNumber: invoiceNumber, IssueDate: issueDate, PaymentMethod: paymentMethod}, grandTotalMinor, actor); err != nil {
			return nil, err
		}
	}

	if err := db.AuditTx(tx, actor, "INVOICE_CREATE", "invoice", invoiceID, issuer.ID, map[string]any{
		"invoice_number": invoiceNumber,
		"grand_total":    models.FmtMoney(grandTotalMinor),
		"client_name":    client.Name,
	}, ip); err != nil {
		return nil, err
	}
	if _, err := tx.Exec("INSERT INTO invoice_documents (invoice_id, xml, issuer_json, client_json) VALUES (?,?,?,?)", invoiceID, xml, mustJSON(issuer), mustJSON(client)); err != nil {
		return nil, err
	}
	return &InvoiceView{Invoice: models.Invoice{ID: invoiceID, InvoiceNumber: invoiceNumber, GrandTotal: grandTotalMinor}, GrandTotalMajor: models.ToMajor(grandTotalMinor)}, nil
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func (s *InvoiceService) createInvoiceReceiptTx(tx *sql.Tx, inv models.Invoice, amount int64, actor string) error {
	number, _, err := s.issuers.NextVoucherNumber(tx, inv.IssuerID)
	if err != nil {
		return err
	}
	id, now := crypto.UUID(), db.NowIso()
	if _, err = tx.Exec(`INSERT INTO receipt_vouchers
		(id,voucher_number,issuer_id,client_id,voucher_date,total_amount,allocated_total,payment_type,reference_no,notes,status,created_by,created_at,updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?)`, id, number, inv.IssuerID, inv.ClientID, inv.IssueDate, amount, amount, inv.PaymentMethod, inv.InvoiceNumber, "سند قبض تلقائي مع الفاتورة", actor, now, now); err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO voucher_allocations (id,voucher_id,invoice_id,allocated_amount,created_at) VALUES (?,?,?,?,?)", crypto.UUID(), id, inv.ID, amount, now); err != nil {
		return err
	}
	if _, err = tx.Exec("UPDATE invoices SET paid_amount=grand_total,remaining_amount=0,status='PAID',updated_at=? WHERE id=?", now, inv.ID); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO client_ledger
		(id,client_id,issuer_id,doc_type,doc_id,doc_number,transaction_date,debit,credit,description,created_at)
		VALUES (?,?,?,'RECEIPT',?,?,?,0,?,?,?)`, crypto.UUID(), inv.ClientID, inv.IssuerID, id, number, inv.IssueDate, amount, fmt.Sprintf("سداد فاتورة رقم %s", inv.InvoiceNumber), now); err != nil {
		return err
	}
	return db.AuditTx(tx, actor, "VOUCHER_CREATE", "voucher", id, inv.IssuerID, map[string]any{"invoice_id": inv.ID, "amount": models.ToMajor(amount)}, "")
}

// normalizedSettlementDisplay returns major paid and remaining amounts while honoring both
// receipt payments and credit-note reductions persisted in remaining_amount.
func normalizedSettlementDisplay(inv *models.Invoice) (float64, float64) {
	if inv == nil || inv.DocumentType == "CREDIT_NOTE" {
		return 0, 0
	}
	grandMajor := models.ToMajor(inv.GrandTotal)
	paidMajor := models.ToMajor(inv.PaidAmount)
	remMajor := models.ToMajor(inv.RemainingAmount)

	isCash := strings.Contains(inv.PaymentMethod, "نقد") || strings.EqualFold(inv.PaymentMethod, "CASH") || strings.Contains(strings.ToLower(inv.PaymentMethod), "cash")
	if isCash || (paidMajor > 0 && paidMajor >= grandMajor) || strings.EqualFold(inv.Status, "PAID") {
		remMajor = 0
		if paidMajor == 0 || isCash {
			paidMajor = grandMajor
		}
		return paidMajor, remMajor
	}

	maxRem := grandMajor - paidMajor
	if maxRem < 0 {
		maxRem = 0
	}
	if remMajor < 0 {
		remMajor = 0
	} else if remMajor > maxRem {
		remMajor = maxRem
	}
	return paidMajor, remMajor
}

func normalizePhase1QrPayload(inv *models.Invoice) {
	if inv == nil || inv.ZatcaPhase == "PHASE2" || (inv.SignatureMode != "" && inv.SignatureMode != "NONE") {
		return
	}
	if tags, err := zatca.ParseQrPayload(inv.QrPayload); err == nil && len(tags) == 5 {
		return
	}
	ts := inv.IssueDatetime
	if ts == "" {
		issTime := inv.IssueTime
		if issTime == "" {
			issTime = "12:00:00"
		} else if len(issTime) == 5 {
			issTime += ":00"
		}
		ts = inv.IssueDate + "T" + issTime + "Z"
	}
	inv.QrPayload = zatca.BuildQrPayload(zatca.QrParams{
		SellerName: inv.SellerName,
		VatNumber:  inv.SellerTaxNumber,
		Timestamp:  ts,
		Total:      models.FmtMoney(inv.GrandTotal),
		VatTotal:   models.FmtMoney(inv.TaxAmount),
	})
}

func (s *InvoiceService) GetInvoice(id string) (*InvoiceView, error) {
	var inv models.Invoice
	var dueDate, chequeDate sql.NullString
	var batchID sql.NullString
	var showSarSymbol int

	err := s.db.QueryRow(`
		SELECT id, issuer_id, client_id, invoice_number, sequence_no, invoice_type, zatca_phase,
		       uuid, issue_date, issue_time, issue_datetime, currency,
		       subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
		       paid_amount, remaining_amount, status, payment_method,
		       due_date, cheque_date, cheque_no, prices_include_tax, batch_id,
		       seller_name, seller_tax_number, seller_cr, seller_address, seller_address_en,
		       buyer_name, buyer_tax_number, buyer_cr, buyer_address,
		       qr_payload, invoice_hash, previous_invoice_hash, signature, signature_mode,
		       notes, created_by, created_at, updated_at,
		       COALESCE(document_type, 'INVOICE'), COALESCE(ref_invoice_id, ''),
		       COALESCE(ref_invoice_number, ''), COALESCE(ref_invoice_date, ''), COALESCE(return_reason, ''),
		       COALESCE(show_sar_symbol, 1)
		FROM invoices WHERE id = ?
	`, id).Scan(
		&inv.ID, &inv.IssuerID, &inv.ClientID, &inv.InvoiceNumber, &inv.SequenceNo, &inv.InvoiceType, &inv.ZatcaPhase,
		&inv.UUID, &inv.IssueDate, &inv.IssueTime, &inv.IssueDatetime, &inv.Currency,
		&inv.Subtotal, &inv.DiscountAmount, &inv.TaxableAmount, &inv.TaxAmount, &inv.GrandTotal,
		&inv.PaidAmount, &inv.RemainingAmount, &inv.Status, &inv.PaymentMethod,
		&dueDate, &chequeDate, &inv.ChequeNo, &inv.PricesIncludeTax, &batchID,
		&inv.SellerName, &inv.SellerTaxNumber, &inv.SellerCr, &inv.SellerAddress, &inv.SellerAddressEn,
		&inv.BuyerName, &inv.BuyerTaxNumber, &inv.BuyerCr, &inv.BuyerAddress,
		&inv.QrPayload, &inv.InvoiceHash, &inv.PreviousInvoiceHash, &inv.Signature, &inv.SignatureMode,
		&inv.Notes, &inv.CreatedBy, &inv.CreatedAt, &inv.UpdatedAt,
		&inv.DocumentType, &inv.RefInvoiceID, &inv.RefInvoiceNumber, &inv.RefInvoiceDate, &inv.ReturnReason,
		&showSarSymbol,
	)
	if err != nil {
		return nil, errors.New("الفاتورة غير موجودة")
	}
	inv.ShowSarSymbol = &showSarSymbol
	normalizePhase1QrPayload(&inv)

	if dueDate.Valid {
		inv.DueDate = &dueDate.String
	}
	if chequeDate.Valid {
		inv.ChequeDate = &chequeDate.String
	}
	if batchID.Valid {
		inv.BatchID = &batchID.String
	}

	pLabel := invoicePaymentLabels[inv.PaymentMethod]
	if pLabel == "" {
		pLabel = inv.PaymentMethod
	}
	sLabel := invoiceStatusLabels[inv.Status]
	if sLabel == "" {
		sLabel = inv.Status
	}
	if inv.DocumentType == "CREDIT_NOTE" && inv.Status != "CANCELLED" {
		sLabel = "إشعار دائن"
	}

	var issName, cCode string
	_ = s.db.QueryRow(`
		SELECT COALESCE(s.name_ar, ''), COALESCE(c.client_code, '')
		FROM invoices i
		LEFT JOIN issuers s ON s.id = i.issuer_id
		LEFT JOIN clients c ON c.id = i.client_id
		WHERE i.id = ?
	`, id).Scan(&issName, &cCode)

	inv.IssuerName = issName
	inv.ClientName = inv.BuyerName

	paidMajor, remMajor := normalizedSettlementDisplay(&inv)

	view := &InvoiceView{
		Invoice:              inv,
		ClientCode:           cCode,
		PaymentLabel:         pLabel,
		StatusLabel:          sLabel,
		SubtotalMajor:        models.ToMajor(inv.Subtotal),
		DiscountAmountMajor:  models.ToMajor(inv.DiscountAmount),
		TaxableAmountMajor:   models.ToMajor(inv.TaxableAmount),
		TaxAmountMajor:       models.ToMajor(inv.TaxAmount),
		GrandTotalMajor:      models.ToMajor(inv.GrandTotal),
		PaidAmountMajor:      paidMajor,
		RemainingAmountMajor: remMajor,
		Items:                make([]InvoiceItemView, 0),
		Lines:                make([]InvoiceItemView, 0),
	}

	// Fetch items
	rows, err := s.db.Query(`
		SELECT id, invoice_id, item_id, line_no, item_code, item_name, unit,
		       quantity, unit_price, COALESCE(unit_price_incl, 0), discount, COALESCE(discount_incl, 0),
		       tax_rate, taxable, tax_amount, total_line
		FROM invoice_items WHERE invoice_id = ? ORDER BY line_no ASC
	`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var itm models.InvoiceItem
			var itemID sql.NullString
			if err := rows.Scan(
				&itm.ID, &itm.InvoiceID, &itemID, &itm.LineNo, &itm.ItemCode, &itm.ItemName, &itm.Unit,
				&itm.Quantity, &itm.UnitPrice, &itm.UnitPriceIncl, &itm.Discount, &itm.DiscountIncl,
				&itm.TaxRate, &itm.Taxable, &itm.TaxAmount, &itm.TotalLine,
			); err == nil {
				if itemID.Valid {
					itm.ItemID = &itemID.String
				}
				view.Items = append(view.Items, InvoiceItemView{
					InvoiceItem:    itm,
					UnitPriceMajor: models.ToMajor(itm.UnitPrice),
					DiscountMajor:  models.ToMajor(itm.Discount),
					TaxableMajor:   models.ToMajor(itm.Taxable),
					TaxAmountMajor: models.ToMajor(itm.TaxAmount),
					TotalLineMajor: models.ToMajor(itm.TotalLine),
				})
			}
		}
	}
	view.Lines = view.Items

	var issuerJSON, clientJSON string
	if err := s.db.QueryRow("SELECT issuer_json,client_json FROM invoice_documents WHERE invoice_id=?", id).Scan(&issuerJSON, &clientJSON); err == nil {
		if err := json.Unmarshal([]byte(issuerJSON), &view.IssuerSnapshot); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(clientJSON), &view.ClientSnapshot); err != nil {
			return nil, err
		}
	}
	if view.IssuerSnapshot == nil {
		if freshIss, issErr := getIssuer(s.db, inv.IssuerID); issErr == nil && freshIss != nil {
			view.IssuerSnapshot = freshIss
		}
	}
	if view.IssuerSnapshot == nil || view.IssuerSnapshot.LogoData == nil || *view.IssuerSnapshot.LogoData == "" {
		var lData sql.NullString
		if err := s.db.QueryRow("SELECT logo_data FROM issuers WHERE id = ?", inv.IssuerID).Scan(&lData); err == nil && lData.Valid && lData.String != "" {
			if view.IssuerSnapshot == nil {
				view.IssuerSnapshot = &models.Issuer{}
			}
			view.IssuerSnapshot.LogoData = &lData.String
		}
	}
	return view, nil
}

type ListInvoicesFilter struct {
	IssuerID      string
	ClientID      string
	Status        string
	InvoiceType   string
	DocumentType  string
	PaymentMethod string
	BatchID       string
	HasRemaining  bool
	MinTotal      float64
	MaxTotal      float64
	FromDate      string
	ToDate        string
	Search        string
	Page          int
	Limit         int
	Offset        int
}

type InvoiceTotals struct {
	GrandTotal float64 `json:"grand_total"`
	Paid       float64 `json:"paid"`
	Remaining  float64 `json:"remaining"`
	Tax        float64 `json:"tax"`
}

type ListInvoicesResult struct {
	Items      []InvoiceView `json:"items"`
	TotalCount int           `json:"total_count"`
	Total      int           `json:"total"`
	Page       int           `json:"page"`
	Limit      int           `json:"limit"`
	Totals     InvoiceTotals `json:"totals"`
}

func (s *InvoiceService) ListInvoices(f ListInvoicesFilter) (*ListInvoicesResult, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	offset := f.Offset
	if offset <= 0 && f.Page > 1 {
		offset = (f.Page - 1) * limit
	}

	where := `WHERE 1=1`
	var args []any

	if f.IssuerID != "" {
		where += ` AND i.issuer_id = ?`
		args = append(args, f.IssuerID)
	}
	if f.ClientID != "" {
		where += ` AND i.client_id = ?`
		args = append(args, f.ClientID)
	}
	if f.Status != "" {
		where += ` AND i.status = ?`
		args = append(args, f.Status)
	}
	if f.InvoiceType != "" {
		where += ` AND i.invoice_type = ?`
		args = append(args, f.InvoiceType)
	}
	if f.DocumentType != "" && f.DocumentType != "ALL" {
		where += ` AND i.document_type = ?`
		args = append(args, f.DocumentType)
	}
	if f.PaymentMethod != "" {
		where += ` AND i.payment_method = ?`
		args = append(args, f.PaymentMethod)
	}
	if f.BatchID != "" {
		where += ` AND i.batch_id = ?`
		args = append(args, f.BatchID)
	}
	if f.HasRemaining {
		where += ` AND i.remaining_amount > 0`
	}
	if f.MinTotal > 0 {
		where += ` AND i.grand_total >= ?`
		args = append(args, models.ToMinor(f.MinTotal))
	}
	if f.MaxTotal > 0 {
		where += ` AND i.grand_total <= ?`
		args = append(args, models.ToMinor(f.MaxTotal))
	}
	if f.FromDate != "" {
		where += ` AND i.issue_date >= ?`
		args = append(args, f.FromDate)
	}
	if f.ToDate != "" {
		where += ` AND i.issue_date <= ?`
		args = append(args, f.ToDate)
	}
	if f.Search != "" {
		where += ` AND (i.invoice_number LIKE ? OR i.buyer_name LIKE ? OR c.name LIKE ? OR c.client_code LIKE ? OR i.buyer_tax_number LIKE ?)`
		like := "%" + f.Search + "%"
		args = append(args, like, like, like, like, like)
	}

	// Count and Totals
	var countQuery string
	if f.DocumentType == "CREDIT_NOTE" {
		countQuery = fmt.Sprintf(`
			SELECT COUNT(*),
			       COALESCE(SUM(i.grand_total), 0),
			       0,
			       0,
			       COALESCE(SUM(i.tax_amount), 0)
			FROM invoices i
			LEFT JOIN clients c ON c.id = i.client_id
			LEFT JOIN issuers s ON s.id = i.issuer_id
			%s
		`, where)
	} else {
		countQuery = fmt.Sprintf(`
			SELECT COUNT(*),
			       COALESCE(SUM(CASE WHEN COALESCE(i.document_type, 'INVOICE') = 'CREDIT_NOTE' THEN -i.grand_total ELSE i.grand_total END), 0),
			       COALESCE(SUM(CASE WHEN COALESCE(i.document_type, 'INVOICE') = 'INVOICE' THEN i.paid_amount ELSE 0 END), 0),
			       COALESCE(SUM(CASE WHEN COALESCE(i.document_type, 'INVOICE') = 'INVOICE' THEN i.remaining_amount ELSE 0 END), 0),
			       COALESCE(SUM(CASE WHEN COALESCE(i.document_type, 'INVOICE') = 'CREDIT_NOTE' THEN -i.tax_amount ELSE i.tax_amount END), 0)
			FROM invoices i
			LEFT JOIN clients c ON c.id = i.client_id
			LEFT JOIN issuers s ON s.id = i.issuer_id
			%s
		`, where)
	}

	var totalCount int
	var sumGrand, sumPaid, sumRem, sumTax int64
	err := s.db.QueryRow(countQuery, args...).Scan(&totalCount, &sumGrand, &sumPaid, &sumRem, &sumTax)
	if err != nil {
		return nil, err
	}

	if offset >= totalCount && totalCount > 0 {
		offset = ((totalCount - 1) / limit) * limit
		f.Page = (offset / limit) + 1
	}

	// Query rows
	query := fmt.Sprintf(`
		SELECT i.id, i.issuer_id, i.client_id, i.invoice_number, i.sequence_no, i.invoice_type, i.zatca_phase,
		       i.uuid, i.issue_date, i.issue_time, i.issue_datetime, i.currency,
		       i.subtotal, i.discount_amount, i.taxable_amount, i.tax_amount, i.grand_total,
		       i.paid_amount, i.remaining_amount, i.status, i.payment_method,
		       i.seller_name, i.buyer_name, i.buyer_tax_number, i.created_at, i.batch_id,
		       COALESCE(s.name_ar, i.seller_name),
		       COALESCE(c.name, i.buyer_name),
		       COALESCE(c.client_code, ''),
		       COALESCE(i.document_type, 'INVOICE'),
		       COALESCE(i.ref_invoice_id, ''),
		       COALESCE(i.ref_invoice_number, ''),
		       COALESCE(i.ref_invoice_date, ''),
		       COALESCE(i.return_reason, ''),
		       COALESCE(i.show_sar_symbol, 1)
		FROM invoices i
		LEFT JOIN clients c ON c.id = i.client_id
		LEFT JOIN issuers s ON s.id = i.issuer_id
		%s
		ORDER BY i.issue_date DESC, i.sequence_no DESC
		LIMIT ? OFFSET ?
	`, where)

	queryArgs := append(args, limit, offset)
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := f.Page
	if page <= 0 {
		page = (offset / limit) + 1
	}

	res := &ListInvoicesResult{
		Items:      make([]InvoiceView, 0),
		TotalCount: totalCount,
		Total:      totalCount,
		Page:       page,
		Limit:      limit,
		Totals: InvoiceTotals{
			GrandTotal: models.ToMajor(sumGrand),
			Paid:       models.ToMajor(sumPaid),
			Remaining:  models.ToMajor(sumRem),
			Tax:        models.ToMajor(sumTax),
		},
	}

	for rows.Next() {
		var inv models.Invoice
		var issName, cName, cCode string
		var showSarSymbol int
		if err := rows.Scan(
			&inv.ID, &inv.IssuerID, &inv.ClientID, &inv.InvoiceNumber, &inv.SequenceNo, &inv.InvoiceType, &inv.ZatcaPhase,
			&inv.UUID, &inv.IssueDate, &inv.IssueTime, &inv.IssueDatetime, &inv.Currency,
			&inv.Subtotal, &inv.DiscountAmount, &inv.TaxableAmount, &inv.TaxAmount, &inv.GrandTotal,
			&inv.PaidAmount, &inv.RemainingAmount, &inv.Status, &inv.PaymentMethod,
			&inv.SellerName, &inv.BuyerName, &inv.BuyerTaxNumber, &inv.CreatedAt, &inv.BatchID,
			&issName, &cName, &cCode,
			&inv.DocumentType, &inv.RefInvoiceID, &inv.RefInvoiceNumber, &inv.RefInvoiceDate, &inv.ReturnReason,
			&showSarSymbol,
		); err == nil {
			inv.ShowSarSymbol = &showSarSymbol
			normalizePhase1QrPayload(&inv)
			inv.IssuerName = issName
			inv.ClientName = cName
			pLabel := invoicePaymentLabels[inv.PaymentMethod]
			if pLabel == "" {
				pLabel = inv.PaymentMethod
			}
			sLabel := invoiceStatusLabels[inv.Status]
			if sLabel == "" {
				sLabel = inv.Status
			}
			if inv.DocumentType == "CREDIT_NOTE" && inv.Status != "CANCELLED" {
				sLabel = "إشعار دائن"
			}

			paidMajor, remMajor := normalizedSettlementDisplay(&inv)

			view := InvoiceView{
				Invoice:              inv,
				ClientCode:           cCode,
				PaymentLabel:         pLabel,
				StatusLabel:          sLabel,
				SubtotalMajor:        models.ToMajor(inv.Subtotal),
				DiscountAmountMajor:  models.ToMajor(inv.DiscountAmount),
				TaxableAmountMajor:   models.ToMajor(inv.TaxableAmount),
				TaxAmountMajor:       models.ToMajor(inv.TaxAmount),
				GrandTotalMajor:      models.ToMajor(inv.GrandTotal),
				PaidAmountMajor:      paidMajor,
				RemainingAmountMajor: remMajor,
				Items:                make([]InvoiceItemView, 0),
				Lines:                make([]InvoiceItemView, 0),
			}
			res.Items = append(res.Items, view)
		}
	}

	return res, nil
}

// recalcInvoiceSettlementTx recalculates an original invoice's remaining amount and status
// from paid receipts and active linked credit notes.
func recalcInvoiceSettlementTx(tx *sql.Tx, invoiceID, now string, flipCashToCredit bool) error {
	var grandTotal, paidAmount int64
	var status, docType string
	if err := tx.QueryRow(`
		SELECT grand_total, paid_amount, status, COALESCE(document_type, 'INVOICE')
		FROM invoices WHERE id = ?
	`, invoiceID).Scan(&grandTotal, &paidAmount, &status, &docType); err != nil {
		return err
	}
	if docType == "CREDIT_NOTE" {
		return nil
	}

	var creditedMinor int64
	if err := tx.QueryRow(`
		SELECT COALESCE(SUM(grand_total), 0)
		FROM invoices
		WHERE ref_invoice_id = ? AND document_type = 'CREDIT_NOTE' AND status <> 'CANCELLED'
	`, invoiceID).Scan(&creditedMinor); err != nil {
		return err
	}

	newRem := grandTotal - paidAmount - creditedMinor
	if newRem < 0 {
		newRem = 0
	}
	newStatus := "UNPAID"
	if status == "CANCELLED" {
		newStatus = "CANCELLED"
	} else if newRem == 0 {
		newStatus = "PAID"
	} else if paidAmount > 0 || creditedMinor > 0 {
		newStatus = "PARTIAL"
	}

	if flipCashToCredit {
		_, err := tx.Exec(`
			UPDATE invoices
			SET remaining_amount = ?, status = ?, updated_at = ?,
			    payment_method = CASE WHEN payment_method = 'CASH' AND ? > 0 THEN 'CREDIT' ELSE payment_method END
			WHERE id = ?
		`, newRem, newStatus, now, newRem, invoiceID)
		return err
	}
	_, err := tx.Exec(`UPDATE invoices SET remaining_amount = ?, status = ?, updated_at = ? WHERE id = ?`,
		newRem, newStatus, now, invoiceID)
	return err
}

func (s *InvoiceService) CancelInvoice(id, actor, ip string) error {
	inv, err := s.GetInvoice(id)
	if err != nil {
		return err
	}
	if inv.Status == "CANCELLED" {
		return errors.New("الفاتورة ملغاة بالفعل")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if inv.DocumentType != "CREDIT_NOTE" {
		var cnCount int
		if err := tx.QueryRow("SELECT COUNT(*) FROM invoices WHERE ref_invoice_id = ? AND status <> 'CANCELLED'", id).Scan(&cnCount); err != nil {
			return err
		}
		if cnCount > 0 {
			return errors.New("لا يمكن إلغاء فاتورة مرتبط بها إشعارات دائنة؛ ألغِ الإشعارات الدائنة أولاً")
		}
	}

	now := db.NowIso()
	result, err := tx.Exec("UPDATE invoices SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status <> 'CANCELLED' AND (paid_amount = 0 OR COALESCE(document_type, 'INVOICE') = 'CREDIT_NOTE')", now, id)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return errors.New("الفاتورة ملغاة أو لها سدادات؛ ألغِ سندات القبض أولًا")
	}

	// Reversing entry in ledger
	if inv.DocumentType == "CREDIT_NOTE" {
		_, err = tx.Exec(`
			INSERT INTO client_ledger (
				id, client_id, issuer_id, doc_type, doc_id, doc_number,
				transaction_date, debit, credit, description, created_at
			) VALUES (?, ?, ?, 'CREDIT_NOTE_CANCEL', ?, ?, ?, ?, 0, ?, ?)
		`, crypto.UUID(), inv.ClientID, inv.IssuerID, inv.ID, inv.InvoiceNumber, db.TodayIso(), inv.GrandTotal, fmt.Sprintf("إلغاء إشعار دائن رقم %s", inv.InvoiceNumber), now)
		if err != nil {
			return err
		}
		if inv.RefInvoiceID != "" {
			if err := recalcInvoiceSettlementTx(tx, inv.RefInvoiceID, now, false); err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
	} else {
		_, err = tx.Exec(`
			INSERT INTO client_ledger (
				id, client_id, issuer_id, doc_type, doc_id, doc_number,
				transaction_date, debit, credit, description, created_at
			) VALUES (?, ?, ?, 'INVOICE_CANCEL', ?, ?, ?, 0, ?, ?, ?)
		`, crypto.UUID(), inv.ClientID, inv.IssuerID, inv.ID, inv.InvoiceNumber, db.TodayIso(), inv.GrandTotal, fmt.Sprintf("إلغاء فاتورة رقم %s", inv.InvoiceNumber), now)
		if err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	s.db.Audit(actor, "INVOICE_CANCEL", "invoice", id, inv.IssuerID, map[string]any{
		"invoice_number": inv.InvoiceNumber,
		"amount":         models.FmtMoney(inv.GrandTotal),
	}, ip)

	return nil
}

func (s *InvoiceService) DeleteInvoice(id, actor, ip string) error {
	inv, err := s.GetInvoice(id)
	if err != nil {
		return err
	}
	if inv.DocumentType != "CREDIT_NOTE" && inv.PaidAmount > 0 {
		return errors.New("لا يمكن حذف فاتورة تم تسجيل سدادات عليها، يرجى إلغاء السندات أولاً أو إلغاء الفاتورة")
	}
	if inv.SignatureMode != "LOCAL" && inv.SignatureMode != "NONE" {
		return errors.New("لا يمكن حذف مستند بتوقيع إنتاجي؛ استخدم الإلغاء")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if inv.DocumentType != "CREDIT_NOTE" {
		var cnCount int
		if err := tx.QueryRow("SELECT COUNT(*) FROM invoices WHERE ref_invoice_id = ?", id).Scan(&cnCount); err != nil {
			return err
		}
		if cnCount > 0 {
			return errors.New("لا يمكن حذف فاتورة مرتبط بها إشعارات دائنة؛ احذف الإشعارات الدائنة أولاً")
		}
	}

	if _, err = tx.Exec("DELETE FROM client_ledger WHERE doc_id = ? AND doc_type IN ('INVOICE', 'INVOICE_CANCEL', 'CREDIT_NOTE', 'CREDIT_NOTE_CANCEL')", id); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM document_pdfs WHERE kind='invoice' AND document_id=?", id); err != nil {
		return err
	}
	_, err = tx.Exec("DELETE FROM invoices WHERE id = ?", id)
	if err != nil {
		return err
	}
	if inv.DocumentType == "CREDIT_NOTE" && inv.RefInvoiceID != "" {
		if err := recalcInvoiceSettlementTx(tx, inv.RefInvoiceID, db.NowIso(), false); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
	}
	if err = s.rebuildInvoiceChainTx(tx, inv.IssuerID); err != nil {
		return err
	}
	if inv.BatchID != nil && *inv.BatchID != "" {
		if _, err = tx.Exec(`UPDATE invoice_batches SET
			invoice_count = (SELECT COUNT(*) FROM invoices WHERE batch_id = ?),
			total_amount = (SELECT COALESCE(SUM(grand_total), 0) FROM invoices WHERE batch_id = ?)
			WHERE id = ?`, *inv.BatchID, *inv.BatchID, *inv.BatchID); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	s.db.Audit(actor, "INVOICE_DELETE", "invoice", id, inv.IssuerID, map[string]any{
		"invoice_number": inv.InvoiceNumber,
	}, ip)

	return nil
}

func (s *InvoiceService) GetXml(id string) (string, error) {
	var frozen string
	if err := s.db.QueryRow("SELECT xml FROM invoice_documents WHERE invoice_id=?", id).Scan(&frozen); err == nil {
		return frozen, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	inv, err := s.GetInvoice(id)
	if err != nil {
		return "", err
	}

	issuer, err := s.issuers.GetIssuer(inv.IssuerID)
	if err != nil {
		return "", err
	}

	var client models.Client
	_ = s.db.QueryRow("SELECT id, name, tax_number, commercial_register, street, city FROM clients WHERE id = ?", inv.ClientID).
		Scan(&client.ID, &client.Name, &client.TaxNumber, &client.CommercialRegister, &client.Street, &client.City)

	var ublLines []zatca.UblLineItem
	for _, itm := range inv.Items {
		ublLines = append(ublLines, zatca.UblLineItem{
			Name:        itm.ItemName,
			Unit:        itm.Unit,
			Quantity:    fmt.Sprintf("%.3f", itm.Quantity),
			UnitPrice:   models.FmtMoney(itm.UnitPrice),
			TaxRate:     fmt.Sprintf("%.2f", itm.TaxRate),
			Taxable:     models.FmtMoney(itm.Taxable),
			TaxAmount:   models.FmtMoney(itm.TaxAmount),
			RoundingAmt: models.FmtMoney(itm.TotalLine),
		})
	}

	xml := zatca.BuildUblXml(
		zatca.UblInvoiceInfo{
			InvoiceNumber:  inv.InvoiceNumber,
			UUID:           inv.UUID,
			IssueDate:      inv.IssueDate,
			IssueTime:      inv.IssueTime,
			InvoiceType:    inv.InvoiceType,
			Subtotal:       models.FmtMoney(inv.Subtotal),
			DiscountAmount: models.FmtMoney(inv.DiscountAmount),
			TaxableAmount:  models.FmtMoney(inv.TaxableAmount),
			TaxAmount:      models.FmtMoney(inv.TaxAmount),
			GrandTotal:     models.FmtMoney(inv.GrandTotal),
			TaxRateDisplay: fmt.Sprintf("%.2f", issuer.DefaultTaxRate),
		},
		zatca.UblPartyInfo{
			Name:               issuer.NameAr,
			TaxNumber:          issuer.TaxNumber,
			CommercialRegister: issuer.CommercialRegister,
			Street:             issuer.Street,
			BuildingNo:         issuer.BuildingNo,
			District:           issuer.District,
			City:               issuer.City,
			PostalCode:         issuer.PostalCode,
			Country:            issuer.Country,
		},
		zatca.UblPartyInfo{
			Name:               client.Name,
			TaxNumber:          client.TaxNumber,
			CommercialRegister: client.CommercialRegister,
			Street:             client.Street,
			City:               client.City,
			Country:            "SA",
		},
		ublLines,
		zatca.UblChainInfo{
			ICV:      inv.SequenceNo,
			PIH:      inv.PreviousInvoiceHash,
			Currency: inv.Currency,
		},
	)
	return xml, nil
}

type OpenInvoiceItem struct {
	ID              string  `json:"id"`
	InvoiceNumber   string  `json:"invoice_number"`
	IssueDate       string  `json:"issue_date"`
	GrandTotal      float64 `json:"grand_total"`
	RemainingAmount float64 `json:"remaining_amount"`
}

func (s *InvoiceService) GetOpenInvoices(clientID, issuerID string) ([]OpenInvoiceItem, error) {
	where := "WHERE client_id = ? AND COALESCE(document_type, 'INVOICE') = 'INVOICE' AND status IN ('UNPAID', 'PARTIAL')"
	args := []any{clientID}
	if issuerID != "" {
		where += " AND issuer_id = ?"
		args = append(args, issuerID)
	}

	query := fmt.Sprintf(`
		SELECT id, invoice_number, issue_date, grand_total, remaining_amount
		FROM invoices
		%s
		ORDER BY issue_date ASC, sequence_no ASC
	`, where)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]OpenInvoiceItem, 0)
	for rows.Next() {
		var itm OpenInvoiceItem
		var grandMinor, remMinor int64
		if err := rows.Scan(&itm.ID, &itm.InvoiceNumber, &itm.IssueDate, &grandMinor, &remMinor); err == nil {
			itm.GrandTotal = models.ToMajor(grandMinor)
			itm.RemainingAmount = models.ToMajor(remMinor)
			items = append(items, itm)
		}
	}
	return items, nil
}

type computedInvoiceLine struct {
	models.InvoiceItem
	taxRateDisplay string
}

func insertInvoiceItemTx(tx *sql.Tx, it models.InvoiceItem) error {
	var itemID *string
	if it.ItemID != nil && strings.TrimSpace(*it.ItemID) != "" {
		trimmed := strings.TrimSpace(*it.ItemID)
		var exists int
		if errCheck := tx.QueryRow("SELECT 1 FROM items WHERE id = ?", trimmed).Scan(&exists); errCheck == nil && exists == 1 {
			itemID = &trimmed
		}
	}
	id := it.ID
	if id == "" {
		id = crypto.UUID()
	}
	_, err := tx.Exec(`
		INSERT INTO invoice_items (
			id, invoice_id, item_id, line_no, item_code, item_name, unit,
			quantity, unit_price, unit_price_incl, discount, discount_incl, tax_rate, taxable, tax_amount, total_line
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		id, it.InvoiceID, itemID, it.LineNo, it.ItemCode, it.ItemName, it.Unit,
		it.Quantity, it.UnitPrice, it.UnitPriceIncl, it.Discount, it.DiscountIncl,
		it.TaxRate, it.Taxable, it.TaxAmount, it.TotalLine,
	)
	return err
}

func computeInvoiceLines(lines []CreateInvoiceLineInput, pricesIncludeTax bool, defaultTaxRate float64) ([]computedInvoiceLine, int64, int64, int64, int64, int64, error) {
	var computedLines []computedInvoiceLine
	var subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalDec4, inclusiveTaxTotalMinor int64

	for idx, l := range lines {
		qty := l.Quantity
		if !validAmount(qty) || qty <= 0 || qty > 1e6 || strings.TrimSpace(l.ItemName) == "" || !validAmount(l.UnitPrice) || !validAmount(l.Discount) || !validAmount(l.DiscountPercent) || l.DiscountPercent > 100 {
			return nil, 0, 0, 0, 0, 0, fmt.Errorf("بيانات البند %d غير صالحة", idx+1)
		}
		taxRate := l.TaxRate
		if l.taxRateMissing {
			taxRate = defaultTaxRate
		}
		if !validAmount(taxRate) || taxRate > 100 || qty*l.UnitPrice > 1e12 {
			return nil, 0, 0, 0, 0, 0, errors.New("قيمة البند أو نسبة الضريبة غير صالحة")
		}

		var unitPriceMinor, gross, discountMinor, taxable, lineTaxDec4, taxAmount, totalLine int64
		var unitPriceIncl, discountIncl float64

		if pricesIncludeTax {
			unitPriceIncl = l.UnitPrice
			discountIncl = l.Discount
			factor := 1.0 + taxRate/100.0
			grossExact := (qty * l.UnitPrice) / factor
			discExact := l.Discount / factor
			if l.DiscountPercent > 0 {
				discountIncl = (qty * l.UnitPrice) * (l.DiscountPercent / 100.0)
				discExact = grossExact * (l.DiscountPercent / 100.0)
			}
			if discExact > grossExact+1e-6 {
				return nil, 0, 0, 0, 0, 0, errors.New("الخصم يتجاوز قيمة البند")
			}
			inc := models.ComputeInclusiveLine(qty, l.UnitPrice, l.Discount, l.DiscountPercent, taxRate)
			unitPriceMinor = inc.UnitPriceExclMinor
			gross = inc.GrossExclMinor
			discountMinor = inc.DiscountExclMinor
			taxable = inc.TaxableExclMinor
			lineTaxDec4 = inc.TaxDec4
			taxAmount = inc.TaxAmountMinor
			totalLine = inc.TotalLineMinor
		} else {
			unitPriceMinor = models.ToMinor(l.UnitPrice)
			gross = models.MulQty(qty, unitPriceMinor)
			discountMinor = models.ToMinor(l.Discount)
			if l.DiscountPercent > 0 {
				discountMinor = models.Pct(gross, l.DiscountPercent)
			}
			if discountMinor > gross {
				return nil, 0, 0, 0, 0, 0, errors.New("الخصم يتجاوز قيمة البند")
			}

			taxable = gross - discountMinor
			// احتساب ضريبة الصنف بدقة Decimal(4) بدون تقريب داخلي، وتجميعها للمجموع النهائي
			lineTaxDec4 = models.PctDec4(taxable, taxRate)
			taxAmount = models.RoundDec4ToMinor(lineTaxDec4)
			totalLine = taxable + taxAmount
		}

		subtotalMinor += gross
		discountTotalMinor += discountMinor
		taxableTotalMinor += taxable
		taxTotalDec4 += lineTaxDec4
		inclusiveTaxTotalMinor += taxAmount

		unit := l.Unit
		if unit == "" {
			unit = "حبة"
		}

		// sanitize item_id: تجاهل أي قيمة فارغة أو تحتوي مسافات فقط
		var itemID *string
		if l.ItemID != nil {
			t := strings.TrimSpace(*l.ItemID)
			if t != "" {
				itemID = &t
			}
		}

		cl := computedInvoiceLine{
			InvoiceItem: models.InvoiceItem{
				ID:            crypto.UUID(),
				ItemID:        itemID,
				LineNo:        idx + 1,
				ItemCode:      l.ItemCode,
				ItemName:      l.ItemName,
				Unit:          unit,
				Quantity:      qty,
				UnitPrice:     unitPriceMinor,
				UnitPriceIncl: unitPriceIncl,
				Discount:      discountMinor,
				DiscountIncl:  discountIncl,
				TaxRate:       taxRate,
				Taxable:       taxable,
				TaxAmount:     taxAmount,
				TotalLine:     totalLine,
			},
			taxRateDisplay: fmt.Sprintf("%.2f", taxRate),
		}
		computedLines = append(computedLines, cl)
	}

	var taxTotalMinor int64
	if pricesIncludeTax {
		taxTotalMinor = inclusiveTaxTotalMinor
	} else {
		// التقريب الرياضي الطبيعي (Round Half Up) إلى خانتين عشريتين فقط عند المجموع النهائي للضريبة
		taxTotalMinor = models.RoundDec4ToMinor(taxTotalDec4)
	}
	grandTotalMinor := taxableTotalMinor + taxTotalMinor
	return computedLines, subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalMinor, grandTotalMinor, nil
}

func (s *InvoiceService) UpdateInvoice(id string, input CreateInvoiceInput, actor, ip string) (*InvoiceView, error) {
	inv, err := s.GetInvoice(id)
	if err != nil {
		return nil, err
	}
	if inv.DocumentType == "CREDIT_NOTE" {
		return nil, errors.New("لا يمكن تعديل إشعار الدائن عبر شاشة تعديل الفاتورة")
	}
	if inv.Status == "CANCELLED" {
		return nil, errors.New("لا يمكن تعديل فاتورة ملغاة")
	}
	if inv.SignatureMode != "LOCAL" && inv.SignatureMode != "NONE" {
		return nil, errors.New("لا يمكن إعادة كتابة مستند بتوقيع إنتاجي؛ استخدم الإلغاء وإصدار مستند جديد")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	issuerID := input.IssuerID
	if issuerID == "" {
		issuerID = inv.IssuerID
	}
	issuer, err := getIssuer(tx, issuerID)
	if err != nil {
		return nil, fmt.Errorf("المنشأة غير موجودة: %w", err)
	}
	if issuerID != inv.IssuerID {
		if err = tx.QueryRow("SELECT COALESCE(MAX(sequence_no),0)+1 FROM invoices WHERE issuer_id=?", issuerID).Scan(&inv.SequenceNo); err != nil {
			return nil, err
		}
		inv.PreviousInvoiceHash = zatca.GenesisPIH
		err = tx.QueryRow("SELECT invoice_hash FROM invoices WHERE issuer_id=? ORDER BY sequence_no DESC LIMIT 1", issuerID).Scan(&inv.PreviousInvoiceHash)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}

	clientID := input.ClientID
	if clientID == "" {
		clientID = inv.ClientID
	}
	if issuerID != inv.IssuerID || clientID != inv.ClientID {
		var allocations int
		if err := tx.QueryRow("SELECT COUNT(*) FROM voucher_allocations a JOIN receipt_vouchers v ON v.id = a.voucher_id WHERE a.invoice_id = ? AND v.status = 'ACTIVE'", id).Scan(&allocations); err != nil {
			return nil, err
		}
		if allocations > 0 {
			return nil, errors.New("ألغِ تخصيص السندات لهذه الفاتورة قبل تغيير المنشأة أو العميل")
		}
	}
	var client models.Client
	err = tx.QueryRow(`
		SELECT id, client_code, name, COALESCE(tax_number,''), COALESCE(commercial_register,''),
		       COALESCE(address,''), COALESCE(street,''), COALESCE(building_no,''),
		       COALESCE(district,''), COALESCE(city,''), COALESCE(postal_code,''), COALESCE(country,'SA'),
		       COALESCE(payment_terms_days, 0)
		FROM clients WHERE id = ?
	`, clientID).Scan(
		&client.ID, &client.ClientCode, &client.Name, &client.TaxNumber, &client.CommercialRegister,
		&client.Address, &client.Street, &client.BuildingNo, &client.District, &client.City,
		&client.PostalCode, &client.Country, &client.PaymentTermsDays,
	)
	if err != nil {
		return nil, errors.New("العميل غير موجود")
	}

	issueDate := input.IssueDate
	if issueDate == "" {
		issueDate = inv.IssueDate
	}
	issueTime := input.IssueTime
	if issueTime == "" {
		issueTime = inv.IssueTime
	}
	if len(issueTime) == 5 {
		issueTime += ":00"
	}
	riyadhLoc := time.FixedZone("Asia/Riyadh", 3*3600)
	_, err = time.ParseInLocation("2006-01-02T15:04:05", issueDate+"T"+issueTime, riyadhLoc)
	if err != nil {
		return nil, errors.New("تاريخ أو وقت الفاتورة غير صالح")
	}
	issueDatetime := fmt.Sprintf("%sT%sZ", issueDate, issueTime)

	invoiceType := input.InvoiceType
	if invoiceType == "" {
		invoiceType = inv.InvoiceType
	}
	zatcaPhase := input.ZatcaPhase
	if zatcaPhase == "" {
		zatcaPhase = inv.ZatcaPhase
	}
	paymentMethod := input.PaymentMethod
	if paymentMethod == "" {
		paymentMethod = inv.PaymentMethod
	}
	if invoiceType != "STANDARD" && invoiceType != "SIMPLIFIED" {
		return nil, errors.New("نوع الفاتورة غير صالح")
	}
	if _, ok := invoicePaymentLabels[paymentMethod]; !ok {
		return nil, errors.New("طريقة السداد غير صالحة")
	}
	if zatcaPhase != "PHASE1" && zatcaPhase != "PHASE2" {
		return nil, errors.New("مرحلة الفوترة غير صالحة")
	}

	computedLines, subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalMinor, grandTotalMinor, err := computeInvoiceLines(input.Lines, input.PricesIncludeTax, issuer.DefaultTaxRate)
	if err != nil {
		return nil, err
	}

	// Auto-assign sequential ITM-XXXX code for any free items without an item code
	var maxItmNumUpdate int
	_ = tx.QueryRow(`
		SELECT COALESCE(MAX(CAST(SUBSTR(item_code, 5) AS INTEGER)), 0)
		FROM (
			SELECT item_code FROM items WHERE item_code LIKE 'ITM-%'
			UNION ALL
			SELECT item_code FROM invoice_items WHERE item_code LIKE 'ITM-%'
		)
	`).Scan(&maxItmNumUpdate)

	for i := range computedLines {
		if strings.TrimSpace(computedLines[i].ItemCode) == "" {
			maxItmNumUpdate++
			computedLines[i].ItemCode = fmt.Sprintf("ITM-%04d", maxItmNumUpdate)
		}
	}

	sellerPartsUpdate := []string{}
	for _, p := range []string{issuer.City, issuer.District, issuer.Street, issuer.BuildingNo, issuer.PostalCode, issuer.Country} {
		if strings.TrimSpace(p) != "" {
			sellerPartsUpdate = append(sellerPartsUpdate, strings.TrimSpace(p))
		}
	}
	sellerAddr := strings.Join(sellerPartsUpdate, " - ")

	buyerAddr := invoiceBuyerAddress(client)

	var ublLines []zatca.UblLineItem
	for _, cl := range computedLines {
		ublLines = append(ublLines, zatca.UblLineItem{
			Name:        cl.ItemName,
			Unit:        cl.Unit,
			Quantity:    fmt.Sprintf("%.3f", cl.Quantity),
			UnitPrice:   models.FmtMoney(cl.UnitPrice),
			TaxRate:     cl.taxRateDisplay,
			Taxable:     models.FmtMoney(cl.Taxable),
			TaxAmount:   models.FmtMoney(cl.TaxAmount),
			RoundingAmt: models.FmtMoney(cl.TotalLine),
		})
	}

	invoiceNumber := inv.InvoiceNumber
	if strings.TrimSpace(input.InvoiceNumber) != "" {
		cleanedNum := strings.TrimSpace(input.InvoiceNumber)
		if cleanedNum != inv.InvoiceNumber {
			var dupCount int
			_ = tx.QueryRow("SELECT COUNT(*) FROM invoices WHERE issuer_id = ? AND invoice_number = ? AND id != ?", issuer.ID, cleanedNum, id).Scan(&dupCount)
			if dupCount > 0 {
				return nil, fmt.Errorf("رقم الفاتورة «%s» مستخدم بالفعل في فاتورة أخرى لهذه المنشأة", cleanedNum)
			}
			invoiceNumber = cleanedNum
		}
	}

	ublInv := zatca.UblInvoiceInfo{
		InvoiceNumber:  invoiceNumber,
		UUID:           inv.UUID,
		IssueDate:      issueDate,
		IssueTime:      issueTime,
		InvoiceType:    invoiceType,
		Subtotal:       models.FmtMoney(subtotalMinor),
		DiscountAmount: models.FmtMoney(discountTotalMinor),
		TaxableAmount:  models.FmtMoney(taxableTotalMinor),
		TaxAmount:      models.FmtMoney(taxTotalMinor),
		GrandTotal:     models.FmtMoney(grandTotalMinor),
		TaxRateDisplay: fmt.Sprintf("%.2f", issuer.DefaultTaxRate),
	}

	ublIssuer := zatca.UblPartyInfo{
		Name:               issuer.NameAr,
		TaxNumber:          issuer.TaxNumber,
		CommercialRegister: issuer.CommercialRegister,
		Street:             issuer.Street,
		BuildingNo:         issuer.BuildingNo,
		District:           issuer.District,
		City:               issuer.City,
		PostalCode:         issuer.PostalCode,
		Country:            issuer.Country,
	}

	ublClient := zatca.UblPartyInfo{
		Name:               client.Name,
		TaxNumber:          client.TaxNumber,
		CommercialRegister: client.CommercialRegister,
		Street:             client.Street,
		BuildingNo:         client.BuildingNo,
		District:           client.District,
		City:               client.City,
		PostalCode:         client.PostalCode,
		Country:            client.Country,
	}

	xml := zatca.BuildUblXml(ublInv, ublIssuer, ublClient, ublLines, zatca.UblChainInfo{
		ICV:      inv.SequenceNo,
		PIH:      inv.PreviousInvoiceHash,
		Currency: issuer.Currency,
	})

	invHash := zatca.InvoiceHash(xml)

	qrParams := zatca.QrParams{
		SellerName: issuer.NameAr,
		VatNumber:  issuer.TaxNumber,
		Timestamp:  issueDatetime,
		Total:      models.FmtMoney(grandTotalMinor),
		VatTotal:   models.FmtMoney(taxTotalMinor),
	}

	signature := ""
	signatureMode := "NONE"
	if zatcaPhase == "PHASE2" {
		qrParams.InvoiceHash = invHash
		signature, qrParams.PublicKey, err = s.signInvoiceHashTx(tx, issuer.ID, invHash)
		if err != nil {
			return nil, err
		}
		signatureMode = "LOCAL"
		qrParams.Signature = signature
	}

	qrPayload := zatca.BuildQrPayload(qrParams)

	pricesIncInt := 0
	if input.PricesIncludeTax {
		pricesIncInt = 1
	}
	nowIso := db.NowIso()

	updatePaidMinor := int64(0)
	updateRemMinor := grandTotalMinor
	updateStatus := "UNPAID"
	var allocatedVouchersSum int64
	if err = tx.QueryRow(`SELECT COALESCE(SUM(a.allocated_amount), 0) FROM voucher_allocations a JOIN receipt_vouchers v ON v.id = a.voucher_id WHERE a.invoice_id = ? AND v.status = 'ACTIVE'`, id).Scan(&allocatedVouchersSum); err != nil {
		return nil, err
	}
	if allocatedVouchersSum > grandTotalMinor {
		return nil, errors.New("قيمة الفاتورة أقل من السندات المخصصة لها؛ ألغِ تخصيص السداد الزائد أولاً")
	}

	isCashUpdate := strings.Contains(paymentMethod, "نقد") || strings.EqualFold(paymentMethod, "CASH") || strings.Contains(strings.ToLower(paymentMethod), "cash")
	if isCashUpdate {
		updatePaidMinor = grandTotalMinor
		updateRemMinor = 0
		updateStatus = "PAID"
	} else {
		// إذا تم تغيير الفاتورة إلى آجل (CREDIT)، يتم التحقق من وجود أي سندات قبض مخصصة فعلياً
		if allocatedVouchersSum > 0 {
			updatePaidMinor = allocatedVouchersSum
			updateRemMinor = grandTotalMinor - allocatedVouchersSum
			if updateRemMinor <= 0 {
				updateRemMinor = 0
				updateStatus = "PAID"
			} else {
				updateStatus = "PARTIAL"
			}
		} else {
			updatePaidMinor = 0
			updateRemMinor = grandTotalMinor
			updateStatus = "UNPAID"
		}
	}

	sellerAddressEn := issuer.AddressEn
	if sellerAddressEn == "" {
		sellerAddressEn = formatNationalAddressEn(issuer.CityEn, issuer.DistrictEn, issuer.StreetEn, issuer.BuildingNo, issuer.PostalCode)
	}

	var dueDateVal *string
	if input.DueDate != nil && strings.TrimSpace(*input.DueDate) != "" {
		d := strings.TrimSpace(*input.DueDate)
		dueDateVal = &d
	}
	var chequeDateVal *string
	if input.ChequeDate != nil && strings.TrimSpace(*input.ChequeDate) != "" {
		c := strings.TrimSpace(*input.ChequeDate)
		chequeDateVal = &c
	}
	chequeNoVal := strings.TrimSpace(input.ChequeNo)
	showSarInt := 1
	if !inv.HasSarSymbol() {
		showSarInt = 0
	}
	if input.ShowSarSymbol != nil {
		if *input.ShowSarSymbol {
			showSarInt = 1
		} else {
			showSarInt = 0
		}
	}

	_, err = tx.Exec(`
		UPDATE invoices SET
			invoice_number = ?,
			issuer_id = ?, client_id = ?, invoice_type = ?, zatca_phase = ?,
			batch_id = CASE WHEN ? THEN NULL ELSE batch_id END,
			issue_date = ?, issue_time = ?, issue_datetime = ?,
			subtotal = ?, discount_amount = ?, taxable_amount = ?, tax_amount = ?, grand_total = ?,
			paid_amount = ?, remaining_amount = ?, status = ?, payment_method = ?,
			due_date = ?, cheque_date = ?, cheque_no = ?, prices_include_tax = ?, show_sar_symbol = ?,
			seller_name = ?, seller_tax_number = ?, seller_cr = ?, seller_address = ?, seller_address_en = ?,
			buyer_name = ?, buyer_tax_number = ?, buyer_cr = ?, buyer_address = ?,
			qr_payload = ?, invoice_hash = ?, previous_invoice_hash = ?, sequence_no = ?, signature = ?, signature_mode = ?, notes = ?, updated_at = ?
		WHERE id = ?
	`,
		invoiceNumber,
		issuer.ID, client.ID, invoiceType, zatcaPhase,
		issuer.ID != inv.IssuerID || client.ID != inv.ClientID,
		issueDate, issueTime, issueDatetime,
		subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalMinor, grandTotalMinor,
		updatePaidMinor, updateRemMinor, updateStatus, paymentMethod,
		dueDateVal, chequeDateVal, chequeNoVal, pricesIncInt, showSarInt,
		issuer.NameAr, issuer.TaxNumber, issuer.CommercialRegister, sellerAddr, sellerAddressEn,
		client.Name, client.TaxNumber, client.CommercialRegister, buyerAddr,
		qrPayload, invHash, inv.PreviousInvoiceHash, inv.SequenceNo, signature, signatureMode, input.Notes, nowIso, id,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update invoice: %w", err)
	}

	_, err = tx.Exec(`
		INSERT INTO invoice_documents (invoice_id, xml, issuer_json, client_json)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(invoice_id) DO UPDATE SET
			xml = excluded.xml,
			issuer_json = excluded.issuer_json,
			client_json = excluded.client_json
	`, id, xml, mustJSON(issuer), mustJSON(client))
	if err != nil {
		return nil, fmt.Errorf("failed to update invoice document: %w", err)
	}

	if _, err := tx.Exec("DELETE FROM invoice_items WHERE invoice_id = ?", id); err != nil {
		return nil, fmt.Errorf("failed to delete old invoice items: %w", err)
	}

	for _, cl := range computedLines {
		cl.InvoiceID = id
		cl.ID = crypto.UUID()
		if err = insertInvoiceItemTx(tx, cl.InvoiceItem); err != nil {
			return nil, fmt.Errorf("failed to insert invoice line: %w", err)
		}
	}

	// Update client ledger
	_, err = tx.Exec(`
		UPDATE client_ledger SET
			issuer_id = ?, client_id = ?, doc_number = ?, debit = ?, transaction_date = ?, description = ?
		WHERE doc_id = ? AND doc_type = 'INVOICE'
	`, issuer.ID, client.ID, invoiceNumber, grandTotalMinor, issueDate, fmt.Sprintf("فاتورة رقم %s", invoiceNumber), id)
	if err != nil {
		return nil, fmt.Errorf("failed to update ledger: %w", err)
	}
	if (isCashUpdate || input.AutoReceipt) && paymentMethod != "CREDIT" && grandTotalMinor > allocatedVouchersSum {
		if err = s.createInvoiceReceiptTx(tx, models.Invoice{ID: id, IssuerID: issuer.ID, ClientID: client.ID, InvoiceNumber: invoiceNumber, IssueDate: issueDate, PaymentMethod: paymentMethod}, grandTotalMinor-allocatedVouchersSum, actor); err != nil {
			return nil, err
		}
	}

	if inv.BatchID != nil && *inv.BatchID != "" {
		_, _ = tx.Exec(`
			UPDATE invoice_batches 
			SET total_amount = (SELECT COALESCE(SUM(grand_total), 0) FROM invoices WHERE batch_id = ?),
			    invoice_count = (SELECT COUNT(*) FROM invoices WHERE batch_id = ?)
			WHERE id = ?
		`, *inv.BatchID, *inv.BatchID, *inv.BatchID)
	}
	if err = s.rebuildInvoiceChainTx(tx, inv.IssuerID); err != nil {
		return nil, err
	}
	if issuer.ID != inv.IssuerID {
		if err = s.rebuildInvoiceChainTx(tx, issuer.ID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	s.db.Audit(actor, "INVOICE_UPDATE", "invoice", id, issuer.ID, map[string]any{
		"invoice_number": invoiceNumber,
		"grand_total":    models.FmtMoney(grandTotalMinor),
	}, ip)

	return s.GetInvoice(id)
}

func (s *InvoiceService) VerifyChain(issuerID string) (map[string]any, error) {
	rows, err := s.db.Query(`
		SELECT i.id, i.sequence_no, i.invoice_hash, i.previous_invoice_hash, d.xml
		FROM invoices i LEFT JOIN invoice_documents d ON d.invoice_id=i.id
		WHERE i.issuer_id = ?
		ORDER BY i.sequence_no ASC
	`, issuerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	count := 0
	prevHash := zatca.GenesisPIH
	valid := true
	var lastSequence int64

	for rows.Next() {
		var id string
		var seq int64
		var invHash, pih string
		var xml sql.NullString
		if err := rows.Scan(&id, &seq, &invHash, &pih, &xml); err != nil {
			return nil, err
		}
		count++
		if pih != prevHash || seq <= lastSequence || (xml.Valid && zatca.InvoiceHash(xml.String) != invHash) {
			valid = false
		}
		prevHash = invHash
		lastSequence = seq
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"ok":               valid,
		"invoices_checked": count,
	}, nil
}

// ─── Credit Notes / Sales Returns (إشعار دائن / مرتجع مبيعات) ─────────────────────

type ReturnableItem struct {
	InvoiceItemID    string  `json:"invoice_item_id"`
	ItemID           *string `json:"item_id,omitempty"`
	ItemCode         string  `json:"item_code"`
	ItemName         string  `json:"item_name"`
	Unit             string  `json:"unit"`
	UnitPrice        float64 `json:"unit_price"`
	UnitPriceIncl    float64 `json:"unit_price_incl"`
	TaxRate          float64 `json:"tax_rate"`
	Discount         float64 `json:"discount"`
	DiscountIncl     float64 `json:"discount_incl"`
	PricesIncludeTax bool    `json:"prices_include_tax"`
	OriginalQty      float64 `json:"original_qty"`
	ReturnedQty      float64 `json:"returned_qty"`
	AvailableQty     float64 `json:"available_qty"`
}

type CreateCreditNoteInput struct {
	OriginalInvoiceID string                `json:"original_invoice_id"`
	ReturnDate        string                `json:"return_date"`
	Reason            string                `json:"reason"`
	Notes             string                `json:"notes"`
	Items             []CreditNoteItemInput `json:"items"`
}

type CreditNoteItemInput struct {
	InvoiceItemID *string `json:"invoice_item_id,omitempty"`
	ItemID        *string `json:"item_id,omitempty"`
	ItemCode      string  `json:"item_code"`
	ItemName      string  `json:"item_name"`
	Unit          string  `json:"unit"`
	Quantity      float64 `json:"quantity"` // الكمية المرتجعة
	UnitPrice     float64 `json:"unit_price"`
	UnitPriceIncl float64 `json:"unit_price_incl"`
	Discount      float64 `json:"discount"`
	DiscountIncl  float64 `json:"discount_incl"`
	TaxRate       float64 `json:"tax_rate"`
	taxRateSet    bool
}

func (c *CreditNoteItemInput) UnmarshalJSON(data []byte) error {
	type plain CreditNoteItemInput
	if err := json.Unmarshal(data, (*plain)(c)); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	v, ok := fields["tax_rate"]
	c.taxRateSet = ok && string(v) != "null"
	return nil
}

func (s *InvoiceService) GetReturnableItems(invoiceID string) ([]ReturnableItem, error) {
	var docType string
	var pricesIncludeTaxInt int
	_ = s.db.QueryRow("SELECT COALESCE(document_type, 'INVOICE'), COALESCE(prices_include_tax, 0) FROM invoices WHERE id = ?", invoiceID).Scan(&docType, &pricesIncludeTaxInt)
	if docType == "CREDIT_NOTE" {
		return []ReturnableItem{}, nil
	}
	pricesIncludeTax := pricesIncludeTaxInt == 1

	rows, err := s.db.Query(`
		SELECT id, item_id, item_code, item_name, unit, unit_price, tax_rate, discount, quantity,
		       COALESCE(unit_price_incl, 0), COALESCE(discount_incl, 0)
		FROM invoice_items
		WHERE invoice_id = ?
		ORDER BY line_no ASC
	`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ReturnableItem
	for rows.Next() {
		var it ReturnableItem
		var upMinor, discMinor int64
		if err := rows.Scan(&it.InvoiceItemID, &it.ItemID, &it.ItemCode, &it.ItemName, &it.Unit, &upMinor, &it.TaxRate, &discMinor, &it.OriginalQty, &it.UnitPriceIncl, &it.DiscountIncl); err == nil {
			it.UnitPrice = models.ToMajor(upMinor)
			it.Discount = models.ToMajor(discMinor)
			it.PricesIncludeTax = pricesIncludeTax
			items = append(items, it)
		}
	}

	for i := range items {
		var retQty float64
		_ = s.db.QueryRow(`
			SELECT COALESCE(SUM(ci.quantity), 0)
			FROM invoice_items ci
			JOIN invoices c ON c.id = ci.invoice_id
			WHERE c.ref_invoice_id = ?
			  AND c.document_type = 'CREDIT_NOTE'
			  AND c.status <> 'CANCELLED'
			  AND (
			    (? <> '' AND ci.item_code = ? AND ci.item_name = ?)
			    OR (? = '' AND COALESCE(ci.item_code, '') = '' AND ci.item_name = ?)
			  )
		`, invoiceID, items[i].ItemCode, items[i].ItemCode, items[i].ItemName, items[i].ItemCode, items[i].ItemName).Scan(&retQty)
		items[i].ReturnedQty = retQty
		items[i].AvailableQty = items[i].OriginalQty - items[i].ReturnedQty
		if items[i].AvailableQty < 0 {
			items[i].AvailableQty = 0
		}
	}

	return items, nil
}

func (s *InvoiceService) GetCreditNotesForInvoice(invoiceID string) ([]InvoiceView, error) {
	rows, err := s.db.Query(`
		SELECT id FROM invoices WHERE ref_invoice_id = ? AND document_type = 'CREDIT_NOTE' AND status <> 'CANCELLED' ORDER BY created_at DESC
	`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []InvoiceView
	for rows.Next() {
		var cnID string
		if err := rows.Scan(&cnID); err == nil {
			if cnView, errGet := s.GetInvoice(cnID); errGet == nil && cnView != nil {
				list = append(list, *cnView)
			}
		}
	}
	return list, nil
}

func (s *InvoiceService) CreateCreditNote(input CreateCreditNoteInput, actor, ip string) (*InvoiceView, error) {
	if strings.TrimSpace(input.OriginalInvoiceID) == "" {
		return nil, errors.New("معرف الفاتورة الأصلية مطلوب")
	}

	orig, err := s.GetInvoice(input.OriginalInvoiceID)
	if err != nil {
		return nil, fmt.Errorf("الفاتورة الأصلية غير موجودة: %w", err)
	}
	if orig.DocumentType == "CREDIT_NOTE" {
		return nil, errors.New("لا يمكن إصدار إشعار دائن لإشعار دائن آخر")
	}
	if orig.Status == "CANCELLED" {
		return nil, errors.New("لا يمكن إصدار إشعار دائن لفاتورة ملغاة")
	}

	returnable, err := s.GetReturnableItems(input.OriginalInvoiceID)
	if err != nil {
		return nil, fmt.Errorf("تعذر جلب بنود الفاتورة الأصلية: %w", err)
	}

	var creditNoteID string
	err = s.db.WithWriteLock(func() error {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		returnableMap := make(map[string]ReturnableItem)
		for _, r := range returnable {
			if r.InvoiceItemID != "" {
				returnableMap["inv_item:"+r.InvoiceItemID] = r
			}
			if r.ItemID != nil && *r.ItemID != "" {
				returnableMap["item:"+*r.ItemID] = r
			}
			if r.ItemCode != "" {
				returnableMap["code:"+r.ItemCode] = r
			}
			if r.ItemName != "" {
				returnableMap["name:"+r.ItemName] = r
			}
		}

		type preparedLine struct {
			itemID        *string
			itemCode      string
			itemName      string
			unit          string
			qty           float64
			upMinor       int64
			unitPriceIncl float64
			discMinor     int64
			discountIncl  float64
			taxRate       float64
			lineTaxable   int64
			lineTax       int64
			lineTotal     int64
		}

		var validLines []preparedLine
		var subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalDec4, inclusiveTaxTotalMinor int64
		origPricesIncludeTax := orig.PricesIncludeTax == 1

		for _, item := range input.Items {
			if item.Quantity <= 0 {
				continue
			}
			var r ReturnableItem
			var exists bool

			if item.InvoiceItemID != nil && *item.InvoiceItemID != "" {
				r, exists = returnableMap["inv_item:"+*item.InvoiceItemID]
			}
			if !exists && item.ItemID != nil && *item.ItemID != "" {
				r, exists = returnableMap["item:"+*item.ItemID]
			}
			if !exists && item.ItemCode != "" {
				r, exists = returnableMap["code:"+item.ItemCode]
			}
			if !exists && item.ItemName != "" {
				r, exists = returnableMap["name:"+item.ItemName]
			}
			if !exists && (item.InvoiceItemID == nil || *item.InvoiceItemID == "") && (item.ItemID == nil || *item.ItemID == "") && item.ItemCode == "" && item.ItemName == "" && len(returnable) == 1 {
				r = returnable[0]
				exists = true
			}
			if !exists {
				return fmt.Errorf("الصنف '%s' غير موجود في الفاتورة الأصلية", item.ItemName)
			}
			if item.Quantity > r.AvailableQty+0.0001 {
				return fmt.Errorf("الكمية المرتجعة للصنف '%s' (%.2f) تتجاوز الكمية المتاحة للإرجاع (%.2f)", r.ItemName, item.Quantity, r.AvailableQty)
			}

			unitPrice := item.UnitPrice
			if unitPrice <= 0 {
				unitPrice = r.UnitPrice
			}
			taxRate := r.TaxRate
			if item.taxRateSet || item.TaxRate > 0 {
				taxRate = item.TaxRate
			}
			if taxRate < 0 {
				taxRate = 15.0
			}
			unit := item.Unit
			if unit == "" {
				unit = r.Unit
			}
			itemName := item.ItemName
			if itemName == "" {
				itemName = r.ItemName
			}
			itemCode := item.ItemCode
			if itemCode == "" {
				itemCode = r.ItemCode
			}
			discount := item.Discount
			if discount <= 0 && r.OriginalQty > 0 && r.Discount > 0 {
				discount = (r.Discount / r.OriginalQty) * item.Quantity
			}

			var upMinor, gross, discMinor, lineTaxable, lineTaxDec4, lineTax, lineTotal int64
			var unitPriceIncl, discountIncl float64

			if origPricesIncludeTax {
				unitPriceIncl = item.UnitPriceIncl
				if unitPriceIncl <= 0 {
					if r.UnitPriceIncl > 0 && (item.UnitPrice <= 0 || math.Abs(item.UnitPrice-r.UnitPrice) <= 0.005 || math.Abs(item.UnitPrice-r.UnitPriceIncl) <= 0.005) {
						unitPriceIncl = r.UnitPriceIncl
					} else if item.UnitPrice > 0 {
						unitPriceIncl = item.UnitPrice
					} else {
						unitPriceIncl = r.UnitPrice * (1.0 + taxRate/100.0)
					}
				}
				discountIncl = item.DiscountIncl
				if discountIncl <= 0 {
					var propDiscIncl float64
					if r.OriginalQty > 0 && r.DiscountIncl > 0 {
						propDiscIncl = (r.DiscountIncl / r.OriginalQty) * item.Quantity
					} else if r.OriginalQty > 0 && r.Discount > 0 {
						propDiscIncl = ((r.Discount / r.OriginalQty) * item.Quantity) * (1.0 + taxRate/100.0)
					}
					if item.Discount <= 0 || (r.OriginalQty > 0 && r.Discount > 0 && math.Abs(item.Discount-(r.Discount/r.OriginalQty)*item.Quantity) <= 0.005) || (propDiscIncl > 0 && math.Abs(item.Discount-propDiscIncl) <= 0.005) {
						discountIncl = propDiscIncl
					} else {
						discountIncl = item.Discount
					}
				}
				inc := models.ComputeInclusiveLine(item.Quantity, unitPriceIncl, discountIncl, 0, taxRate)
				upMinor = inc.UnitPriceExclMinor
				gross = inc.GrossExclMinor
				discMinor = inc.DiscountExclMinor
				if discMinor > gross {
					discMinor = gross
				}
				lineTaxable = inc.TaxableExclMinor
				lineTaxDec4 = inc.TaxDec4
				lineTax = inc.TaxAmountMinor
				lineTotal = inc.TotalLineMinor
				inclusiveTaxTotalMinor += lineTax
			} else {
				upMinor = models.ToMinor(unitPrice)
				gross = models.MulQty(item.Quantity, upMinor)
				discMinor = models.ToMinor(discount)
				if discMinor > gross {
					discMinor = gross
				}
				lineTaxable = gross - discMinor
				lineTaxDec4 = models.PctDec4(lineTaxable, taxRate)
				lineTax = models.RoundDec4ToMinor(lineTaxDec4)
				lineTotal = lineTaxable + lineTax
			}

			subtotalMinor += gross
			discountTotalMinor += discMinor
			taxableTotalMinor += lineTaxable
			taxTotalDec4 += lineTaxDec4

			validLines = append(validLines, preparedLine{
				itemID:        r.ItemID,
				itemCode:      itemCode,
				itemName:      itemName,
				unit:          unit,
				qty:           item.Quantity,
				upMinor:       upMinor,
				unitPriceIncl: unitPriceIncl,
				discMinor:     discMinor,
				discountIncl:  discountIncl,
				taxRate:       taxRate,
				lineTaxable:   lineTaxable,
				lineTax:       lineTax,
				lineTotal:     lineTotal,
			})
		}

		if len(validLines) == 0 {
			return errors.New("يجب تحديد صنف واحد على الأقل بكمية أكبر من صفر للإرجاع")
		}

		taxTotalMinor := models.RoundDec4ToMinor(taxTotalDec4)
		if origPricesIncludeTax {
			taxTotalMinor = inclusiveTaxTotalMinor
		}
		grandTotalMinor := taxableTotalMinor + taxTotalMinor

		creditNoteNumber, _, err := s.issuers.NextCreditNoteNumber(tx, orig.IssuerID)
		if err != nil {
			return fmt.Errorf("فشل توليد رقم الإشعار الدائن: %w", err)
		}

		var sequenceNo int64
		if err := tx.QueryRow("SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM invoices WHERE issuer_id = ?", orig.IssuerID).Scan(&sequenceNo); err != nil {
			return err
		}
		var pih string
		if err := tx.QueryRow("SELECT invoice_hash FROM invoices WHERE issuer_id = ? ORDER BY sequence_no DESC LIMIT 1", orig.IssuerID).Scan(&pih); err != nil || pih == "" {
			pih = zatca.GenesisPIH
		}

		issuerSnap, err := getIssuer(tx, orig.IssuerID)
		if err != nil || issuerSnap == nil {
			issuerSnap = orig.IssuerSnapshot
			if issuerSnap == nil {
				issuerSnap = &models.Issuer{ID: orig.IssuerID, NameAr: orig.SellerName, TaxNumber: orig.SellerTaxNumber, CommercialRegister: orig.SellerCr}
			}
		}
		clientSnap := orig.ClientSnapshot
		if clientSnap == nil {
			var c models.Client
			_ = tx.QueryRow(`
				SELECT id, COALESCE(client_code,''), name, COALESCE(name_en,''), COALESCE(phone,''), COALESCE(mobile,''),
				       COALESCE(email,''), COALESCE(address,''), COALESCE(building_no,''), COALESCE(street,''),
				       COALESCE(district,''), COALESCE(city,''), COALESCE(postal_code,''), COALESCE(country,'SA'),
				       COALESCE(tax_number,''), COALESCE(commercial_register,''), COALESCE(client_type,'')
				FROM clients WHERE id = ?
			`, orig.ClientID).Scan(
				&c.ID, &c.ClientCode, &c.Name, &c.NameEn, &c.Phone, &c.Mobile, &c.Email,
				&c.Address, &c.BuildingNo, &c.Street, &c.District, &c.City, &c.PostalCode, &c.Country,
				&c.TaxNumber, &c.CommercialRegister, &c.ClientType,
			)
			if c.ID == "" {
				c = models.Client{ID: orig.ClientID, Name: orig.BuyerName, TaxNumber: orig.BuyerTaxNumber, CommercialRegister: orig.BuyerCr, Address: orig.BuyerAddress}
			}
			clientSnap = &c
		}

		cnID := crypto.UUID()
		cnUUID := crypto.UUID()
		creditNoteID = cnID
		nowIso := db.NowIso()
		returnDate := strings.TrimSpace(input.ReturnDate)
		if returnDate == "" {
			returnDate = db.TodayIso()
		}
		nowDt := time.Now().In(time.FixedZone("Asia/Riyadh", 3*3600))
		issueTime := nowDt.Format("15:04:05")
		issueDatetime := fmt.Sprintf("%sT%sZ", returnDate, issueTime)

		var ublLines []zatca.UblLineItem
		for _, cl := range validLines {
			ublLines = append(ublLines, zatca.UblLineItem{
				Name:        cl.itemName,
				Unit:        cl.unit,
				Quantity:    fmt.Sprintf("%.3f", cl.qty),
				UnitPrice:   models.FmtMoney(cl.upMinor),
				TaxRate:     fmt.Sprintf("%.2f", cl.taxRate),
				Taxable:     models.FmtMoney(cl.lineTaxable),
				TaxAmount:   models.FmtMoney(cl.lineTax),
				RoundingAmt: models.FmtMoney(cl.lineTotal),
			})
		}
		xmlDoc := zatca.BuildUblXml(
			zatca.UblInvoiceInfo{
				InvoiceNumber:  creditNoteNumber,
				UUID:           cnUUID,
				IssueDate:      returnDate,
				IssueTime:      issueTime,
				InvoiceType:    orig.InvoiceType,
				Subtotal:       models.FmtMoney(subtotalMinor),
				DiscountAmount: models.FmtMoney(discountTotalMinor),
				TaxableAmount:  models.FmtMoney(taxableTotalMinor),
				TaxAmount:      models.FmtMoney(taxTotalMinor),
				GrandTotal:     models.FmtMoney(grandTotalMinor),
				TaxRateDisplay: fmt.Sprintf("%.2f", issuerSnap.DefaultTaxRate),
			},
			zatca.UblPartyInfo{
				Name: issuerSnap.NameAr, TaxNumber: issuerSnap.TaxNumber, CommercialRegister: issuerSnap.CommercialRegister,
				Street: issuerSnap.Street, BuildingNo: issuerSnap.BuildingNo, District: issuerSnap.District,
				City: issuerSnap.City, PostalCode: issuerSnap.PostalCode, Country: issuerSnap.Country,
			},
			zatca.UblPartyInfo{
				Name: clientSnap.Name, TaxNumber: clientSnap.TaxNumber, CommercialRegister: clientSnap.CommercialRegister,
				Street: clientSnap.Street, BuildingNo: clientSnap.BuildingNo, District: clientSnap.District,
				City: clientSnap.City, PostalCode: clientSnap.PostalCode, Country: clientSnap.Country,
			},
			ublLines,
			zatca.UblChainInfo{ICV: sequenceNo, PIH: pih, Currency: orig.Currency},
		)
		invHash := zatca.InvoiceHash(xmlDoc)

		qrParams := zatca.QrParams{
			SellerName: orig.SellerName,
			VatNumber:  orig.SellerTaxNumber,
			Timestamp:  issueDatetime,
			Total:      models.FmtMoney(grandTotalMinor),
			VatTotal:   models.FmtMoney(taxTotalMinor),
		}
		signature := ""
		signatureMode := "NONE"
		if orig.ZatcaPhase == "PHASE2" {
			qrParams.InvoiceHash = invHash
			signature, qrParams.PublicKey, err = s.signInvoiceHashTx(tx, orig.IssuerID, invHash)
			if err != nil {
				return err
			}
			signatureMode = "LOCAL"
			qrParams.Signature = signature
		}
		qrPayload := zatca.BuildQrPayload(qrParams)

		reason := strings.TrimSpace(input.Reason)
		if reason == "" {
			reason = "مرتجع مبيعات"
		}
		notes := strings.TrimSpace(input.Notes)
		origSarInt := 1
		if !orig.HasSarSymbol() {
			origSarInt = 0
		}

		_, err = tx.Exec(`
			INSERT INTO invoices (
				id, issuer_id, client_id, invoice_number, sequence_no, invoice_type, document_type,
				ref_invoice_id, ref_invoice_number, ref_invoice_date, return_reason, zatca_phase,
				uuid, issue_date, issue_time, issue_datetime, currency,
				subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
				paid_amount, remaining_amount, status, payment_method, show_sar_symbol, prices_include_tax,
				seller_name, seller_tax_number, seller_cr, seller_address, seller_address_en,
				buyer_name, buyer_tax_number, buyer_cr, buyer_address,
				qr_payload, invoice_hash, previous_invoice_hash, signature, signature_mode,
				notes, created_by, created_at, updated_at
			) VALUES (
				?, ?, ?, ?, ?, ?, 'CREDIT_NOTE',
				?, ?, ?, ?, ?,
				?, ?, ?, ?, ?,
				?, ?, ?, ?, ?,
				0, 0, 'PAID', ?, ?, ?,
				?, ?, ?, ?, ?,
				?, ?, ?, ?,
				?, ?, ?, ?, ?,
				?, ?, ?, ?
			)
		`,
			cnID, orig.IssuerID, orig.ClientID, creditNoteNumber, sequenceNo, orig.InvoiceType,
			orig.ID, orig.InvoiceNumber, orig.IssueDate, reason, orig.ZatcaPhase,
			cnUUID, returnDate, issueTime, issueDatetime, orig.Currency,
			subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalMinor, grandTotalMinor,
			orig.PaymentMethod, origSarInt, orig.PricesIncludeTax,
			orig.SellerName, orig.SellerTaxNumber, orig.SellerCr, orig.SellerAddress, orig.SellerAddressEn,
			orig.BuyerName, orig.BuyerTaxNumber, orig.BuyerCr, orig.BuyerAddress,
			qrPayload, invHash, pih, signature, signatureMode,
			notes, actor, nowIso, nowIso,
		)
		if err != nil {
			return fmt.Errorf("فشل حفظ إشعار الدائن: %w", err)
		}

		if _, err := tx.Exec(
			"INSERT INTO invoice_documents (invoice_id, xml, issuer_json, client_json) VALUES (?,?,?,?)",
			cnID, xmlDoc, mustJSON(issuerSnap), mustJSON(clientSnap),
		); err != nil {
			return fmt.Errorf("فشل حفظ مستند الإشعار الدائن: %w", err)
		}

		for idx, l := range validLines {
			err = insertInvoiceItemTx(tx, models.InvoiceItem{
				InvoiceID:     cnID,
				ItemID:        l.itemID,
				LineNo:        idx + 1,
				ItemCode:      l.itemCode,
				ItemName:      l.itemName,
				Unit:          l.unit,
				Quantity:      l.qty,
				UnitPrice:     l.upMinor,
				UnitPriceIncl: l.unitPriceIncl,
				Discount:      l.discMinor,
				DiscountIncl:  l.discountIncl,
				TaxRate:       l.taxRate,
				Taxable:       l.lineTaxable,
				TaxAmount:     l.lineTax,
				TotalLine:     l.lineTotal,
			})
			if err != nil {
				return fmt.Errorf("فشل حفظ بنود إشعار الدائن: %w", err)
			}
		}

		ledgerDesc := fmt.Sprintf("إشعار دائن مرتجع مبيعات رقم %s للفاتورة رقم %s", creditNoteNumber, orig.InvoiceNumber)
		if reason != "" && reason != "مرتجع مبيعات" {
			ledgerDesc += fmt.Sprintf(" (%s)", reason)
		}
		_, err = tx.Exec(`
			INSERT INTO client_ledger (
				id, client_id, issuer_id, doc_type, doc_id, doc_number,
				transaction_date, debit, credit, description, created_at
			) VALUES (?, ?, ?, 'CREDIT_NOTE', ?, ?, ?, 0, ?, ?, ?)
		`, crypto.UUID(), orig.ClientID, orig.IssuerID, cnID, creditNoteNumber, returnDate, grandTotalMinor, ledgerDesc, nowIso)
		if err != nil {
			return fmt.Errorf("فشل قيد إشعار الدائن في دفتر الأستاذ: %w", err)
		}

		if err := recalcInvoiceSettlementTx(tx, orig.ID, nowIso, false); err != nil {
			return fmt.Errorf("فشل تحديث رصيد الفاتورة الأصلية: %w", err)
		}

		if err := db.AuditTx(tx, actor, "CREDIT_NOTE_CREATE", "invoice", cnID, orig.IssuerID, map[string]any{
			"credit_note_number": creditNoteNumber,
			"original_invoice":   orig.InvoiceNumber,
			"grand_total":        models.FmtMoney(grandTotalMinor),
			"client_name":        orig.BuyerName,
		}, ip); err != nil {
			return err
		}

		return tx.Commit()
	})

	if err != nil {
		return nil, err
	}

	return s.GetInvoice(creditNoteID)
}

// SetShowSarSymbol updates whether the 2025 Saudi Riyal currency symbol appears when rendering the invoice.
func (s *InvoiceService) SetShowSarSymbol(id string, show bool, actor, ip string) (*InvoiceView, error) {
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("معرف الفاتورة مطلوب")
	}
	inv, err := s.GetInvoice(id)
	if err != nil {
		return nil, err
	}
	val := 0
	if show {
		val = 1
	}
	nowIso := db.NowIso()
	err = s.db.WithWriteLock(func() error {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.Exec("UPDATE invoices SET show_sar_symbol = ?, updated_at = ? WHERE id = ?", val, nowIso, id); err != nil {
			return err
		}
		if err := db.AuditTx(tx, actor, "INVOICE_SAR_SYMBOL_UPDATE", "invoice", id, inv.IssuerID, map[string]any{
			"invoice_number":  inv.InvoiceNumber,
			"show_sar_symbol": show,
		}, ip); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil {
		return nil, err
	}
	return s.GetInvoice(id)
}
