package services

import (
	"errors"
	"fmt"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
)

type VoucherService struct {
	db      *db.DB
	issuers *IssuerService
}

func NewVoucherService(d *db.DB, iss *IssuerService) *VoucherService {
	return &VoucherService{db: d, issuers: iss}
}

type VoucherAllocationInput struct {
	InvoiceID string  `json:"invoice_id"`
	Amount    float64 `json:"amount"`
}

type CreateVoucherInput struct {
	IssuerID       string                   `json:"issuer_id"`
	ClientID       string                   `json:"client_id"`
	VoucherDate    string                   `json:"voucher_date"`
	TotalAmount    float64                  `json:"total_amount"`
	PaymentType    string                   `json:"payment_type"`
	ReferenceNo    string                   `json:"reference_no"`
	Notes          string                   `json:"notes"`
	AutoAllocate   bool                     `json:"auto_allocate"`
	Allocations    []VoucherAllocationInput `json:"allocations"`
}

type VoucherView struct {
	models.ReceiptVoucher
	TotalAmountMajor    float64                    `json:"total_amount"`
	AllocatedTotalMajor float64                    `json:"allocated_total"`
	UnallocatedMajor    float64                    `json:"unallocated"`
	PaymentLabel        string                     `json:"payment_label"`
	StatusLabel         string                     `json:"status_label"`
	Allocations         []VoucherAllocationView    `json:"allocations"`
}

type VoucherAllocationView struct {
	ID                   string  `json:"id"`
	InvoiceID            string  `json:"invoice_id"`
	InvoiceNumber        string  `json:"invoice_number"`
	IssueDate            string  `json:"issue_date"`
	AllocatedAmountMajor float64 `json:"allocated_amount"`
	InvoiceTotalMajor    float64 `json:"invoice_total"`
	InvoicePaidMajor     float64 `json:"invoice_paid"`
	InvoiceRemainingMajor float64 `json:"invoice_remaining"`
	InvoiceStatus        string  `json:"invoice_status"`
}

var paymentLabels = map[string]string{
	"CASH":     "نقداً",
	"TRANSFER": "تحويل بنكي",
	"CHEQUE":   "شيك",
	"CARD":     "شبكة",
}

func (s *VoucherService) CreateVoucher(input CreateVoucherInput, actor, ip string) (*VoucherView, error) {
	if input.IssuerID == "" || input.ClientID == "" {
		return nil, errors.New("المنشأة المصدرة والعميل مطلوبان")
	}
	if input.TotalAmount <= 0 {
		return nil, errors.New("مبلغ السند يجب أن يكون أكبر من الصفر")
	}

	totalAmountMinor := models.ToMinor(input.TotalAmount)
	voucherDate := input.VoucherDate
	if voucherDate == "" {
		voucherDate = db.TodayIso()
	}
	paymentType := input.PaymentType
	if paymentType == "" {
		paymentType = "CASH"
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	voucherNumber, _, err := s.issuers.NextVoucherNumber(tx, input.IssuerID)
	if err != nil {
		return nil, err
	}

	voucherID := crypto.UUID()
	now := db.NowIso()

	// Process Allocations
	type allocItem struct {
		invoiceID string
		amount    int64
	}
	var finalAllocations []allocItem
	var allocatedTotalMinor int64

	if len(input.Allocations) > 0 {
		for _, a := range input.Allocations {
			amt := models.ToMinor(a.Amount)
			if amt > 0 && a.InvoiceID != "" {
				finalAllocations = append(finalAllocations, allocItem{invoiceID: a.InvoiceID, amount: amt})
				allocatedTotalMinor += amt
			}
		}
	} else if input.AutoAllocate {
		// FIFO oldest unpaid invoices first
		rows, err := tx.Query(`
			SELECT id, remaining_amount FROM invoices
			WHERE client_id = ? AND issuer_id = ? AND status IN ('UNPAID', 'PARTIAL')
			ORDER BY issue_date ASC, sequence_no ASC
		`, input.ClientID, input.IssuerID)
		if err == nil {
			defer rows.Close()
			remBudget := totalAmountMinor
			for rows.Next() && remBudget > 0 {
				var invID string
				var invRem int64
				if err := rows.Scan(&invID, &invRem); err == nil {
					take := remBudget
					if take > invRem {
						take = invRem
					}
					finalAllocations = append(finalAllocations, allocItem{invoiceID: invID, amount: take})
					remBudget -= take
					allocatedTotalMinor += take
				}
			}
		}
	}

	_, err = tx.Exec(`
		INSERT INTO receipt_vouchers (
			id, voucher_number, issuer_id, client_id, voucher_date,
			total_amount, allocated_total, payment_type, reference_no, notes,
			status, created_by, created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			'ACTIVE', ?, ?, ?
		)
	`,
		voucherID, voucherNumber, input.IssuerID, input.ClientID, voucherDate,
		totalAmountMinor, allocatedTotalMinor, paymentType, input.ReferenceNo, input.Notes,
		actor, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert voucher: %w", err)
	}

	// Apply allocations to invoices
	for _, a := range finalAllocations {
		_, err = tx.Exec(`
			INSERT INTO voucher_allocations (id, voucher_id, invoice_id, allocated_amount, created_at)
			VALUES (?, ?, ?, ?, ?)
		`, crypto.UUID(), voucherID, a.invoiceID, a.amount, now)
		if err != nil {
			return nil, err
		}

		// Update invoice
		var grandTotal, paidAmount int64
		_ = tx.QueryRow("SELECT grand_total, paid_amount FROM invoices WHERE id = ?", a.invoiceID).Scan(&grandTotal, &paidAmount)
		newPaid := paidAmount + a.amount
		newRem := grandTotal - newPaid
		if newRem < 0 {
			newRem = 0
		}
		newStatus := "PARTIAL"
		if newRem == 0 {
			newStatus = "PAID"
		}

		_, err = tx.Exec(`
			UPDATE invoices SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ?
			WHERE id = ?
		`, newPaid, newRem, newStatus, now, a.invoiceID)
		if err != nil {
			return nil, err
		}
	}

	// Post credit entry in client_ledger
	_, err = tx.Exec(`
		INSERT INTO client_ledger (
			id, client_id, issuer_id, doc_type, doc_id, doc_number,
			transaction_date, debit, credit, description, created_at
		) VALUES (
			?, ?, ?, 'RECEIPT', ?, ?,
			?, 0, ?, ?, ?
		)
	`, crypto.UUID(), input.ClientID, input.IssuerID, voucherID, voucherNumber, voucherDate, totalAmountMinor, fmt.Sprintf("سند قبض رقم %s", voucherNumber), now)
	if err != nil {
		return nil, fmt.Errorf("failed to post voucher ledger entry: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	s.db.Audit(actor, "VOUCHER_CREATE", "voucher", voucherID, input.IssuerID, map[string]any{
		"voucher_number": voucherNumber,
		"amount":         input.TotalAmount,
	}, ip)

	return s.GetVoucher(voucherID)
}

func (s *VoucherService) GetVoucher(id string) (*VoucherView, error) {
	var v models.ReceiptVoucher
	err := s.db.QueryRow(`
		SELECT v.id, v.voucher_number, v.issuer_id, v.client_id, v.voucher_date,
		       v.total_amount, v.allocated_total, v.payment_type, v.reference_no, v.notes,
		       v.status, v.created_by, v.created_at, v.updated_at,
		       s.name_ar, c.name
		FROM receipt_vouchers v
		JOIN issuers s ON s.id = v.issuer_id
		JOIN clients c ON c.id = v.client_id
		WHERE v.id = ?
	`, id).Scan(
		&v.ID, &v.VoucherNumber, &v.IssuerID, &v.ClientID, &v.VoucherDate,
		&v.TotalAmount, &v.AllocatedTotal, &v.PaymentType, &v.ReferenceNo, &v.Notes,
		&v.Status, &v.CreatedBy, &v.CreatedAt, &v.UpdatedAt,
		&v.IssuerName, &v.ClientName,
	)
	if err != nil {
		return nil, errors.New("سند القبض غير موجود")
	}

	view := &VoucherView{
		ReceiptVoucher:      v,
		TotalAmountMajor:    models.ToMajor(v.TotalAmount),
		AllocatedTotalMajor: models.ToMajor(v.AllocatedTotal),
		UnallocatedMajor:    models.ToMajor(v.TotalAmount - v.AllocatedTotal),
		PaymentLabel:        paymentLabels[v.PaymentType],
		StatusLabel:         "نشط",
	}
	if v.Status == "CANCELLED" {
		view.StatusLabel = "ملغى"
	}

	// Allocations
	rows, err := s.db.Query(`
		SELECT a.id, a.invoice_id, a.allocated_amount, i.invoice_number, i.issue_date,
		       i.grand_total, i.paid_amount, i.remaining_amount, i.status
		FROM voucher_allocations a
		JOIN invoices i ON i.id = a.invoice_id
		WHERE a.voucher_id = ?
	`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var av VoucherAllocationView
			var allocMinor, totalMinor, paidMinor, remMinor int64
			if err := rows.Scan(
				&av.ID, &av.InvoiceID, &allocMinor, &av.InvoiceNumber, &av.IssueDate,
				&totalMinor, &paidMinor, &remMinor, &av.InvoiceStatus,
			); err == nil {
				av.AllocatedAmountMajor = models.ToMajor(allocMinor)
				av.InvoiceTotalMajor = models.ToMajor(totalMinor)
				av.InvoicePaidMajor = models.ToMajor(paidMinor)
				av.InvoiceRemainingMajor = models.ToMajor(remMinor)
				view.Allocations = append(view.Allocations, av)
			}
		}
	}

	return view, nil
}

type ListVouchersFilter struct {
	IssuerID string
	ClientID string
	Status   string
	FromDate string
	ToDate   string
	Search   string
	Page     int
	Limit    int
}

type ListVouchersResult struct {
	Items []VoucherView `json:"items"`
	Total int           `json:"total"`
	Page  int           `json:"page"`
	Limit int           `json:"limit"`
}

func (s *VoucherService) ListVouchers(f ListVouchersFilter) (*ListVouchersResult, error) {
	if f.Page <= 0 {
		f.Page = 1
	}
	if f.Limit <= 0 {
		f.Limit = 50
	}
	offset := (f.Page - 1) * f.Limit

	where := `WHERE 1=1`
	var args []any

	if f.IssuerID != "" {
		where += ` AND v.issuer_id = ?`
		args = append(args, f.IssuerID)
	}
	if f.ClientID != "" {
		where += ` AND v.client_id = ?`
		args = append(args, f.ClientID)
	}
	if f.Status != "" {
		where += ` AND v.status = ?`
		args = append(args, f.Status)
	}
	if f.FromDate != "" {
		where += ` AND v.voucher_date >= ?`
		args = append(args, f.FromDate)
	}
	if f.ToDate != "" {
		where += ` AND v.voucher_date <= ?`
		args = append(args, f.ToDate)
	}
	if f.Search != "" {
		where += ` AND (v.voucher_number LIKE ? OR c.name LIKE ? OR v.reference_no LIKE ?)`
		like := "%" + f.Search + "%"
		args = append(args, like, like, like)
	}

	var count int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM receipt_vouchers v JOIN clients c ON c.id = v.client_id %s`, where)
	_ = s.db.QueryRow(countQuery, args...).Scan(&count)

	query := fmt.Sprintf(`
		SELECT v.id, v.voucher_number, v.issuer_id, v.client_id, v.voucher_date,
		       v.total_amount, v.allocated_total, v.payment_type, v.reference_no, v.notes,
		       v.status, v.created_by, v.created_at, v.updated_at,
		       s.name_ar, c.name
		FROM receipt_vouchers v
		JOIN issuers s ON s.id = v.issuer_id
		JOIN clients c ON c.id = v.client_id
		%s
		ORDER BY v.voucher_date DESC, v.created_at DESC
		LIMIT ? OFFSET ?
	`, where)

	queryArgs := append(args, f.Limit, offset)
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := &ListVouchersResult{
		Total: count,
		Page:  f.Page,
		Limit: f.Limit,
	}

	for rows.Next() {
		var v models.ReceiptVoucher
		if err := rows.Scan(
			&v.ID, &v.VoucherNumber, &v.IssuerID, &v.ClientID, &v.VoucherDate,
			&v.TotalAmount, &v.AllocatedTotal, &v.PaymentType, &v.ReferenceNo, &v.Notes,
			&v.Status, &v.CreatedBy, &v.CreatedAt, &v.UpdatedAt,
			&v.IssuerName, &v.ClientName,
		); err == nil {
			view := VoucherView{
				ReceiptVoucher:      v,
				TotalAmountMajor:    models.ToMajor(v.TotalAmount),
				AllocatedTotalMajor: models.ToMajor(v.AllocatedTotal),
				UnallocatedMajor:    models.ToMajor(v.TotalAmount - v.AllocatedTotal),
				PaymentLabel:        paymentLabels[v.PaymentType],
				StatusLabel:         "نشط",
			}
			if v.Status == "CANCELLED" {
				view.StatusLabel = "ملغى"
			}
			res.Items = append(res.Items, view)
		}
	}

	return res, nil
}

func (s *VoucherService) CancelVoucher(id, actor, ip string) error {
	v, err := s.GetVoucher(id)
	if err != nil {
		return err
	}
	if v.Status == "CANCELLED" {
		return errors.New("سند القبض ملغى بالفعل")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := db.NowIso()
	_, err = tx.Exec("UPDATE receipt_vouchers SET status = 'CANCELLED', updated_at = ? WHERE id = ?", now, id)
	if err != nil {
		return err
	}

	// Rollback allocations from invoices
	for _, a := range v.Allocations {
		allocMinor := models.ToMinor(a.AllocatedAmountMajor)
		var grandTotal, paidAmount int64
		_ = tx.QueryRow("SELECT grand_total, paid_amount FROM invoices WHERE id = ?", a.InvoiceID).Scan(&grandTotal, &paidAmount)
		newPaid := paidAmount - allocMinor
		if newPaid < 0 {
			newPaid = 0
		}
		newRem := grandTotal - newPaid
		newStatus := "UNPAID"
		if newPaid > 0 && newRem > 0 {
			newStatus = "PARTIAL"
		} else if newPaid >= grandTotal {
			newStatus = "PAID"
		}

		_, _ = tx.Exec(`
			UPDATE invoices SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ?
			WHERE id = ?
		`, newPaid, newRem, newStatus, now, a.InvoiceID)
	}

	// Reverse entry in client_ledger
	_, err = tx.Exec(`
		INSERT INTO client_ledger (
			id, client_id, issuer_id, doc_type, doc_id, doc_number,
			transaction_date, debit, credit, description, created_at
		) VALUES (
			?, ?, ?, 'RECEIPT_CANCEL', ?, ?,
			?, ?, 0, ?, ?
		)
	`, crypto.UUID(), v.ClientID, v.IssuerID, v.ID, v.VoucherNumber, db.TodayIso(), v.TotalAmount, fmt.Sprintf("إلغاء سند قبض رقم %s", v.VoucherNumber), now)
	if err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	s.db.Audit(actor, "VOUCHER_CANCEL", "voucher", id, v.IssuerID, map[string]any{
		"voucher_number": v.VoucherNumber,
		"amount":         v.TotalAmountMajor,
	}, ip)

	return nil
}
