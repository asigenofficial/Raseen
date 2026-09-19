package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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
	taxRateMissing bool
}

func (l *CreateInvoiceLineInput) UnmarshalJSON(data []byte) error {
	type plain CreateInvoiceLineInput
	if err := json.Unmarshal(data,(*plain)(l)); err != nil { return err }
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data,&fields); err != nil { return err }
	v, ok := fields["tax_rate"]; l.taxRateMissing = !ok || string(v) == "null"
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
	Notes            string                   `json:"notes"`
	AutoReceipt      bool                     `json:"auto_receipt"`
	Lines            []CreateInvoiceLineInput `json:"lines"`
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
	IssuerSnapshot *models.Issuer `json:"issuer_snapshot,omitempty"`
	ClientSnapshot *models.Client `json:"client_snapshot,omitempty"`
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
	tx, err := s.db.Begin()
	if err != nil { return nil,err }
	defer tx.Rollback()
	inv, err := s.createInvoiceTx(tx,input,actor,ip)
	if err != nil { return nil,err }
	if err = tx.Commit(); err != nil { return nil,err }
	return s.GetInvoice(inv.ID)
}

func (s *InvoiceService) createInvoiceTx(tx *sql.Tx, input CreateInvoiceInput, actor, ip string) (*InvoiceView, error) {
	if input.IssuerID == "" || input.ClientID == "" {
		return nil, errors.New("المنشأة المصدرة والعميل مطلوبان")
	}
	if len(input.Lines) == 0 || len(input.Lines) > 500 {
		return nil, errors.New("يجب إضافة بند واحد على الأقل للفاتورة")
	}

	issuer, err := getIssuer(tx,input.IssuerID)
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

	nowDt := time.Now()
	issueDate := input.IssueDate
	if issueDate == "" {
		issueDate = nowDt.Format("2006-01-02")
	}
	issueTime := input.IssueTime
	if issueTime == "" {
		issueTime = nowDt.Format("15:04:05")
	}
	if len(issueTime) == 5 { issueTime += ":00" }
	issuedAt, err := time.ParseInLocation("2006-01-02T15:04:05",issueDate+"T"+issueTime,time.Local)
	if err != nil { return nil,errors.New("تاريخ أو وقت الفاتورة غير صالح") }
	issueDatetime := issuedAt.Format(time.RFC3339)

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
	if invoiceType != "STANDARD" && invoiceType != "SIMPLIFIED" { return nil,errors.New("نوع الفاتورة غير صالح") }
	if _, ok := invoicePaymentLabels[paymentMethod]; !ok { return nil,errors.New("طريقة السداد غير صالحة") }
	if zatcaPhase != "PHASE1" && zatcaPhase != "PHASE2" { return nil,errors.New("مرحلة الفوترة غير صالحة") }

	// Compute lines
	type computedLine struct {
		models.InvoiceItem
		taxRateDisplay string
	}
	var computedLines []computedLine
	var subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalMinor int64

	for idx, l := range input.Lines {
		qty := l.Quantity
		if !validAmount(qty) || qty <= 0 || qty > 1e6 || strings.TrimSpace(l.ItemName) == "" || !validAmount(l.UnitPrice) || !validAmount(l.Discount) || !validAmount(l.DiscountPercent) || l.DiscountPercent > 100 { return nil,fmt.Errorf("بيانات البند %d غير صالحة",idx+1) }
		taxRate := l.TaxRate
		if l.taxRateMissing {
			taxRate = issuer.DefaultTaxRate
		}
		if !validAmount(taxRate) || taxRate > 100 || qty*l.UnitPrice > 1e12 { return nil,errors.New("قيمة البند أو نسبة الضريبة غير صالحة") }

		unitPriceMinor := models.ToMinor(l.UnitPrice)
		if input.PricesIncludeTax {
			unitPriceMinor = models.NetFromInclusive(unitPriceMinor, taxRate)
		}

		gross := models.MulQty(qty, unitPriceMinor)
		discountMinor := models.ToMinor(l.Discount)
		if input.PricesIncludeTax && discountMinor > 0 {
			discountMinor = models.NetFromInclusive(discountMinor, taxRate)
		}
		if l.DiscountPercent > 0 {
			discountMinor = models.Pct(gross, l.DiscountPercent)
		}
		if discountMinor > gross {
			return nil,errors.New("الخصم يتجاوز قيمة البند")
		}

		taxable := gross - discountMinor
		taxAmount := models.Pct(taxable, taxRate)
		totalLine := taxable + taxAmount

		subtotalMinor += gross
		discountTotalMinor += discountMinor
		taxableTotalMinor += taxable
		taxTotalMinor += taxAmount

		unit := l.Unit
		if unit == "" {
			unit = "حبة"
		}

		cl := computedLine{
			InvoiceItem: models.InvoiceItem{
				ID:         crypto.UUID(),
				ItemID:     l.ItemID,
				LineNo:     idx + 1,
				ItemCode:   l.ItemCode,
				ItemName:   l.ItemName,
				Unit:       unit,
				Quantity:   qty,
				UnitPrice:  unitPriceMinor,
				Discount:   discountMinor,
				TaxRate:    taxRate,
				Taxable:    taxable,
				TaxAmount:  taxAmount,
				TotalLine:  totalLine,
			},
			taxRateDisplay: fmt.Sprintf("%.2f", taxRate),
		}
		computedLines = append(computedLines, cl)
	}

	grandTotalMinor := taxableTotalMinor + taxTotalMinor

	// Allocate serial and ICV
	invoiceNumber := input.InvoiceNumber
	var sequenceNo int64
	if invoiceNumber != "" {
		if err := tx.QueryRow("SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM invoices WHERE issuer_id = ?", issuer.ID).Scan(&sequenceNo); err != nil { return nil,err }
	} else {
		num, seq, err := s.issuers.NextInvoiceNumber(tx, issuer.ID)
		if err != nil {
			return nil, err
		}
		invoiceNumber = num
		sequenceNo = seq
	}
	if err := tx.QueryRow("SELECT COALESCE(MAX(sequence_no),0)+1 FROM invoices WHERE issuer_id=?",issuer.ID).Scan(&sequenceNo); err != nil { return nil,err }

	// Previous invoice hash
	var pih string
	err = tx.QueryRow(`
		SELECT invoice_hash FROM invoices
		WHERE issuer_id = ? AND status <> 'CANCELLED'
		ORDER BY sequence_no DESC LIMIT 1
	`, issuer.ID).Scan(&pih)
	if err != nil || pih == "" {
		pih = zatca.GenesisPIH
	}

	invoiceID := crypto.UUID()
	invUUID := crypto.UUID()

	// Build UBL and ZATCA fields
	sellerAddr := strings.TrimSpace(strings.Join([]string{issuer.BuildingNo, issuer.Street, issuer.District, issuer.City, issuer.PostalCode, issuer.Country}, " - "))
	buyerAddr := strings.TrimSpace(strings.Join([]string{client.BuildingNo, client.Street, client.District, client.City, client.PostalCode, client.Country}, " - "))
	if buyerAddr == "" {
		buyerAddr = client.Address
	}

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
		SellerName:  issuer.NameAr,
		VatNumber:   issuer.TaxNumber,
		Timestamp:   issueDatetime,
		Total:       models.FmtMoney(grandTotalMinor),
		VatTotal:    models.FmtMoney(taxTotalMinor),
		InvoiceHash: invHash,
	}

	signature := ""
	signatureMode := "NONE"
	if zatcaPhase == "PHASE2" {
		var privKeyEnc sql.NullString
		var pubKeyDer sql.NullString
		_ = tx.QueryRow("SELECT private_key_enc, public_key_der FROM issuer_credentials WHERE issuer_id = ?", issuer.ID).
			Scan(&privKeyEnc, &pubKeyDer)
		if privKeyEnc.Valid && privKeyEnc.String != "" {
			if privPem, err := crypto.DecryptSecret(privKeyEnc.String, s.masterKey); err == nil {
				if sig, err := zatca.SignHash(privPem, invHash); err == nil {
					signature = sig
					signatureMode = "LOCAL"
					qrParams.Signature = sig
					qrParams.PublicKey = pubKeyDer.String
				}
			}
		}
	}

	qrPayload := zatca.BuildQrPayload(qrParams)

	nowIso := db.NowIso()
	pricesIncInt := 0
	if input.PricesIncludeTax {
		pricesIncInt = 1
	}

	_, err = tx.Exec(`
		INSERT INTO invoices (
			id, issuer_id, client_id, invoice_number, sequence_no, invoice_type, zatca_phase,
			uuid, issue_date, issue_time, issue_datetime, currency,
			subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
			paid_amount, remaining_amount, status, payment_method,
			due_date, cheque_date, cheque_no, prices_include_tax,
			seller_name, seller_tax_number, seller_cr, seller_address, seller_address_en,
			buyer_name, buyer_tax_number, buyer_cr, buyer_address,
			qr_payload, invoice_hash, previous_invoice_hash, signature, signature_mode,
			notes, created_by, created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			0, ?, 'UNPAID', ?,
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?
		)
	`,
		invoiceID, issuer.ID, client.ID, invoiceNumber, sequenceNo, invoiceType, zatcaPhase,
		invUUID, issueDate, issueTime, issueDatetime, issuer.Currency,
		subtotalMinor, discountTotalMinor, taxableTotalMinor, taxTotalMinor, grandTotalMinor,
		grandTotalMinor, paymentMethod,
		input.DueDate, input.ChequeDate, input.ChequeNo, pricesIncInt,
		issuer.NameAr, issuer.TaxNumber, issuer.CommercialRegister, sellerAddr, issuer.AddressEn,
		client.Name, client.TaxNumber, client.CommercialRegister, buyerAddr,
		qrPayload, invHash, pih, signature, signatureMode,
		input.Notes, actor, nowIso, nowIso,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert invoice: %w", err)
	}

	// Insert invoice items
	for _, cl := range computedLines {
		_, err = tx.Exec(`
			INSERT INTO invoice_items (
				id, invoice_id, item_id, line_no, item_code, item_name, unit,
				quantity, unit_price, discount, tax_rate, taxable, tax_amount, total_line
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			cl.ID, invoiceID, cl.ItemID, cl.LineNo, cl.ItemCode, cl.ItemName, cl.Unit,
			cl.Quantity, cl.UnitPrice, cl.Discount, cl.TaxRate, cl.Taxable, cl.TaxAmount, cl.TotalLine,
		)
		if err != nil {
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

	// If paid immediately via CASH, CARD, or TRANSFER with AutoReceipt
	if input.AutoReceipt && paymentMethod != "CREDIT" && grandTotalMinor > 0 {
		voucherNumber, _, errV := s.issuers.NextVoucherNumber(tx, issuer.ID)
		if errV != nil { return nil,errV }
		{
			voucherID := crypto.UUID()
			_, err = tx.Exec(`
				INSERT INTO receipt_vouchers (
					id, voucher_number, issuer_id, client_id, voucher_date,
					total_amount, allocated_total, payment_type, reference_no, notes,
					status, created_by, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
			`, voucherID, voucherNumber, issuer.ID, client.ID, issueDate, grandTotalMinor, grandTotalMinor, paymentMethod, invoiceNumber, "سند قبض تلقائي مع الفاتورة", actor, nowIso, nowIso)
			if err != nil { return nil,err }

			_, err = tx.Exec(`
				INSERT INTO voucher_allocations (id, voucher_id, invoice_id, allocated_amount, created_at)
				VALUES (?, ?, ?, ?, ?)
			`, crypto.UUID(), voucherID, invoiceID, grandTotalMinor, nowIso)
			if err != nil { return nil,err }

			_, err = tx.Exec(`
				UPDATE invoices SET paid_amount = ?, remaining_amount = 0, status = 'PAID', updated_at = ? WHERE id = ?
			`, grandTotalMinor, nowIso, invoiceID)
			if err != nil { return nil,err }

			_, err = tx.Exec(`
				INSERT INTO client_ledger (
					id, client_id, issuer_id, doc_type, doc_id, doc_number,
					transaction_date, debit, credit, description, created_at
				) VALUES (?, ?, ?, 'RECEIPT', ?, ?, ?, 0, ?, ?, ?)
			`, crypto.UUID(), client.ID, issuer.ID, voucherID, voucherNumber, issueDate, grandTotalMinor, fmt.Sprintf("سداد فاتورة رقم %s", invoiceNumber), nowIso)
			if err != nil { return nil,err }
			if err = db.AuditTx(tx,actor,"VOUCHER_CREATE","voucher",voucherID,issuer.ID,map[string]any{"invoice_id":invoiceID,"amount":models.ToMajor(grandTotalMinor)},ip); err != nil { return nil,err }
		}
	}

	if err := db.AuditTx(tx,actor, "INVOICE_CREATE", "invoice", invoiceID, issuer.ID, map[string]any{
		"invoice_number": invoiceNumber,
		"grand_total":    models.FmtMoney(grandTotalMinor),
		"client_name":    client.Name,
	}, ip); err != nil { return nil,err }
	if _, err := tx.Exec("INSERT INTO invoice_documents (invoice_id, xml, issuer_json, client_json) VALUES (?,?,?,?)",invoiceID,xml,mustJSON(issuer),mustJSON(client)); err != nil { return nil,err }
	return &InvoiceView{Invoice:models.Invoice{ID:invoiceID,GrandTotal:grandTotalMinor},GrandTotalMajor:models.ToMajor(grandTotalMinor)},nil
}

func mustJSON(v any) string { b,_:=json.Marshal(v);return string(b) }

func (s *InvoiceService) GetInvoice(id string) (*InvoiceView, error) {
	var inv models.Invoice
	var dueDate, chequeDate sql.NullString
	var batchID sql.NullString

	err := s.db.QueryRow(`
		SELECT id, issuer_id, client_id, invoice_number, sequence_no, invoice_type, zatca_phase,
		       uuid, issue_date, issue_time, issue_datetime, currency,
		       subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
		       paid_amount, remaining_amount, status, payment_method,
		       due_date, cheque_date, cheque_no, prices_include_tax, batch_id,
		       seller_name, seller_tax_number, seller_cr, seller_address, seller_address_en,
		       buyer_name, buyer_tax_number, buyer_cr, buyer_address,
		       qr_payload, invoice_hash, previous_invoice_hash, signature, signature_mode,
		       notes, created_by, created_at, updated_at
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
	)
	if err != nil {
		return nil, errors.New("الفاتورة غير موجودة")
	}

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
		PaidAmountMajor:      models.ToMajor(inv.PaidAmount),
		RemainingAmountMajor: models.ToMajor(inv.RemainingAmount),
		Items:                make([]InvoiceItemView, 0),
		Lines:                make([]InvoiceItemView, 0),
	}

	// Fetch items
	rows, err := s.db.Query(`
		SELECT id, invoice_id, item_id, line_no, item_code, item_name, unit,
		       quantity, unit_price, discount, tax_rate, taxable, tax_amount, total_line
		FROM invoice_items WHERE invoice_id = ? ORDER BY line_no ASC
	`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var itm models.InvoiceItem
			var itemID sql.NullString
			if err := rows.Scan(
				&itm.ID, &itm.InvoiceID, &itemID, &itm.LineNo, &itm.ItemCode, &itm.ItemName, &itm.Unit,
				&itm.Quantity, &itm.UnitPrice, &itm.Discount, &itm.TaxRate, &itm.Taxable, &itm.TaxAmount, &itm.TotalLine,
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

	var issuerJSON,clientJSON string
	if err := s.db.QueryRow("SELECT issuer_json,client_json FROM invoice_documents WHERE invoice_id=?",id).Scan(&issuerJSON,&clientJSON); err == nil {
		if err := json.Unmarshal([]byte(issuerJSON),&view.IssuerSnapshot); err != nil { return nil,err }
		if err := json.Unmarshal([]byte(clientJSON),&view.ClientSnapshot); err != nil { return nil,err }
	}
	return view, nil
}

type ListInvoicesFilter struct {
	IssuerID      string
	ClientID      string
	Status        string
	InvoiceType   string
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
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*),
		       COALESCE(SUM(i.grand_total), 0),
		       COALESCE(SUM(i.paid_amount), 0),
		       COALESCE(SUM(i.remaining_amount), 0),
		       COALESCE(SUM(i.tax_amount), 0)
		FROM invoices i
		LEFT JOIN clients c ON c.id = i.client_id
		LEFT JOIN issuers s ON s.id = i.issuer_id
		%s
	`, where)

	var totalCount int
	var sumGrand, sumPaid, sumRem, sumTax int64
	err := s.db.QueryRow(countQuery, args...).Scan(&totalCount, &sumGrand, &sumPaid, &sumRem, &sumTax)
	if err != nil {
		return nil, err
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
		       COALESCE(c.client_code, '')
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
		if err := rows.Scan(
			&inv.ID, &inv.IssuerID, &inv.ClientID, &inv.InvoiceNumber, &inv.SequenceNo, &inv.InvoiceType, &inv.ZatcaPhase,
			&inv.UUID, &inv.IssueDate, &inv.IssueTime, &inv.IssueDatetime, &inv.Currency,
			&inv.Subtotal, &inv.DiscountAmount, &inv.TaxableAmount, &inv.TaxAmount, &inv.GrandTotal,
			&inv.PaidAmount, &inv.RemainingAmount, &inv.Status, &inv.PaymentMethod,
			&inv.SellerName, &inv.BuyerName, &inv.BuyerTaxNumber, &inv.CreatedAt, &inv.BatchID,
			&issName, &cName, &cCode,
		); err == nil {
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
				PaidAmountMajor:      models.ToMajor(inv.PaidAmount),
				RemainingAmountMajor: models.ToMajor(inv.RemainingAmount),
				Items:                make([]InvoiceItemView, 0),
				Lines:                make([]InvoiceItemView, 0),
			}
			res.Items = append(res.Items, view)
		}
	}

	return res, nil
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

	now := db.NowIso()
	result, err := tx.Exec("UPDATE invoices SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status <> 'CANCELLED' AND paid_amount = 0", now, id)
	if err != nil {
		return err
	}
	if n,err := result.RowsAffected(); err != nil || n != 1 { return errors.New("الفاتورة ملغاة أو لها سدادات؛ ألغِ سندات القبض أولًا") }

	// Reversing entry in ledger
	_, err = tx.Exec(`
		INSERT INTO client_ledger (
			id, client_id, issuer_id, doc_type, doc_id, doc_number,
			transaction_date, debit, credit, description, created_at
		) VALUES (?, ?, ?, 'INVOICE_CANCEL', ?, ?, ?, 0, ?, ?, ?)
	`, crypto.UUID(), inv.ClientID, inv.IssuerID, inv.ID, inv.InvoiceNumber, db.TodayIso(), inv.GrandTotal, fmt.Sprintf("إلغاء فاتورة رقم %s", inv.InvoiceNumber), now)
	if err != nil {
		return err
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
	if inv.PaidAmount > 0 {
		return errors.New("لا يمكن حذف فاتورة تم تسجيل سدادات عليها، يرجى إلغاء السندات أولاً أو إلغاء الفاتورة")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, _ = tx.Exec("DELETE FROM invoice_items WHERE invoice_id = ?", id)
	_, _ = tx.Exec("DELETE FROM client_ledger WHERE doc_id = ? AND doc_type IN ('INVOICE', 'INVOICE_CANCEL')", id)
	_, err = tx.Exec("DELETE FROM invoices WHERE id = ?", id)
	if err != nil {
		return err
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
	if err := s.db.QueryRow("SELECT xml FROM invoice_documents WHERE invoice_id=?",id).Scan(&frozen); err == nil { return frozen,nil } else if !errors.Is(err,sql.ErrNoRows) { return "",err }
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
	where := "WHERE client_id = ? AND status IN ('UNPAID', 'PARTIAL')"
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
