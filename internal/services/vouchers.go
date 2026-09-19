package services

import (
	"errors"
	"fmt"
	"math"
	"time"

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
	ID             string                  `json:"id"`
	VoucherNumber  string                  `json:"voucher_number"`
	IssuerID       string                  `json:"issuer_id"`
	IssuerName     string                  `json:"issuer_name"`
	ClientID       string                  `json:"client_id"`
	ClientName     string                  `json:"client_name"`
	ClientCode     string                  `json:"client_code"`
	VoucherDate    string                  `json:"voucher_date"`
	TotalAmount    float64                 `json:"total_amount"`
	AllocatedTotal float64                 `json:"allocated_total"`
	Unallocated    float64                 `json:"unallocated"`
	PaymentType    string                  `json:"payment_type"`
	PaymentLabel   string                  `json:"payment_label"`
	ReferenceNo    string                  `json:"reference_no"`
	Notes          string                  `json:"notes"`
	Status         string                  `json:"status"`
	StatusLabel    string                  `json:"status_label"`
	CreatedBy      string                  `json:"created_by"`
	CreatedAt      string                  `json:"created_at"`
	UpdatedAt      string                  `json:"updated_at"`
	Allocations    []VoucherAllocationView `json:"allocations"`
}

type VoucherAllocationView struct {
	ID               string  `json:"id"`
	InvoiceID        string  `json:"invoice_id"`
	InvoiceNumber    string  `json:"invoice_number"`
	IssueDate        string  `json:"issue_date"`
	AllocatedAmount  float64 `json:"allocated_amount"`
	InvoiceTotal     float64 `json:"invoice_total"`
	InvoicePaid      float64 `json:"invoice_paid"`
	InvoiceRemaining float64 `json:"invoice_remaining"`
	InvoiceStatus    string  `json:"invoice_status"`
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
	if !validAmount(input.TotalAmount) || models.ToMinor(input.TotalAmount) <= 0 {
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
	if _, err := time.Parse("2006-01-02", voucherDate); err != nil { return nil, errors.New("تاريخ السند غير صالح") }
	if _, ok := paymentLabels[paymentType]; !ok { return nil, errors.New("طريقة السداد غير صالحة") }

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
		seen := map[string]bool{}
		for _, a := range input.Allocations {
			amt := models.ToMinor(a.Amount)
			if !validAmount(a.Amount) || amt <= 0 || a.InvoiceID == "" || seen[a.InvoiceID] { return nil, errors.New("تخصيص غير صالح أو فاتورة مكررة") }
			seen[a.InvoiceID] = true
			if amt > totalAmountMinor-allocatedTotalMinor { return nil, errors.New("مجموع التخصيصات يتجاوز مبلغ السند") }
			finalAllocations = append(finalAllocations, allocItem{invoiceID: a.InvoiceID, amount: amt})
			allocatedTotalMinor += amt
		}
	} else if input.AutoAllocate {
		// FIFO oldest unpaid invoices first
		rows, err := tx.Query(`
			SELECT id, remaining_amount FROM invoices
			WHERE client_id = ? AND issuer_id = ? AND status IN ('UNPAID', 'PARTIAL')
			ORDER BY issue_date ASC, sequence_no ASC
		`, input.ClientID, input.IssuerID)
		if err != nil { return nil, err }
		{
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
			if err := rows.Err(); err != nil { return nil, err }
			if err := rows.Close(); err != nil { return nil, err }
		}
	}
	for _, a := range finalAllocations {
		var remaining int64
		if err := tx.QueryRow("SELECT remaining_amount FROM invoices WHERE id=? AND issuer_id=? AND client_id=? AND status IN ('UNPAID','PARTIAL')",a.invoiceID,input.IssuerID,input.ClientID).Scan(&remaining); err != nil || a.amount > remaining {
			return nil, errors.New("الفاتورة لا تخص الشركة والعميل أو أن التخصيص يتجاوز المتبقي")
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
		if err = tx.QueryRow("SELECT grand_total, paid_amount FROM invoices WHERE id = ?", a.invoiceID).Scan(&grandTotal, &paidAmount); err != nil { return nil, err }
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
	var idVal, vNum, issID, clientID, vDate, pType, refNo, notes, status, createdBy, createdAt, updatedAt, issName, clientName, clientCode string
	var totalAmt, allocTotal int64
	err := s.db.QueryRow(`
		SELECT v.id, v.voucher_number, v.issuer_id, v.client_id, v.voucher_date,
		       v.total_amount, v.allocated_total, v.payment_type, v.reference_no, v.notes,
		       v.status, v.created_by, v.created_at, v.updated_at,
		       s.name_ar, c.name, c.client_code
		FROM receipt_vouchers v
		JOIN issuers s ON s.id = v.issuer_id
		JOIN clients c ON c.id = v.client_id
		WHERE v.id = ?
	`, id).Scan(
		&idVal, &vNum, &issID, &clientID, &vDate,
		&totalAmt, &allocTotal, &pType, &refNo, &notes,
		&status, &createdBy, &createdAt, &updatedAt,
		&issName, &clientName, &clientCode,
	)
	if err != nil {
		return nil, errors.New("سند القبض غير موجود")
	}

	pLabel := paymentLabels[pType]
	sLabel := "نشط"
	if status == "CANCELLED" {
		sLabel = "ملغى"
	}

	totalMajor := models.ToMajor(totalAmt)
	allocMajor := models.ToMajor(allocTotal)
	unallocMajor := models.ToMajor(totalAmt - allocTotal)

	view := &VoucherView{
		ID:             idVal,
		VoucherNumber:  vNum,
		IssuerID:       issID,
		IssuerName:     issName,
		ClientID:       clientID,
		ClientName:     clientName,
		ClientCode:     clientCode,
		VoucherDate:    vDate,
		TotalAmount:    totalMajor,
		AllocatedTotal: allocMajor,
		Unallocated:    unallocMajor,
		PaymentType:    pType,
		PaymentLabel:   pLabel,
		ReferenceNo:    refNo,
		Notes:          notes,
		Status:         status,
		StatusLabel:    sLabel,
		CreatedBy:      createdBy,
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
		Allocations:    make([]VoucherAllocationView, 0),
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
				av.AllocatedAmount = models.ToMajor(allocMinor)
				av.InvoiceTotal = models.ToMajor(totalMinor)
				av.InvoicePaid = models.ToMajor(paidMinor)
				av.InvoiceRemaining = models.ToMajor(remMinor)
				view.Allocations = append(view.Allocations, av)
			}
		}
	}

	return view, nil
}

type ListVouchersFilter struct {
	IssuerID    string
	ClientID    string
	Status      string
	PaymentType string
	FromDate    string
	ToDate      string
	MinAmount   float64
	MaxAmount   float64
	Search      string
	Page        int
	Limit       int
	Offset      int
}

type VoucherTotals struct {
	TotalAmount      float64 `json:"total_amount"`
	AllocatedTotal   float64 `json:"allocated_total"`
	UnallocatedTotal float64 `json:"unallocated_total"`
}

type ListVouchersResult struct {
	Items      []VoucherView `json:"items"`
	TotalCount int           `json:"total_count"`
	Total      int           `json:"total"`
	Page       int           `json:"page"`
	Limit      int           `json:"limit"`
	Totals     VoucherTotals `json:"totals"`
}

func (s *VoucherService) ListVouchers(f ListVouchersFilter) (*ListVouchersResult, error) {
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
	if f.PaymentType != "" {
		where += ` AND v.payment_type = ?`
		args = append(args, f.PaymentType)
	}
	if f.FromDate != "" {
		where += ` AND v.voucher_date >= ?`
		args = append(args, f.FromDate)
	}
	if f.ToDate != "" {
		where += ` AND v.voucher_date <= ?`
		args = append(args, f.ToDate)
	}
	if f.MinAmount > 0 {
		where += ` AND v.total_amount >= ?`
		args = append(args, models.ToMinor(f.MinAmount))
	}
	if f.MaxAmount > 0 {
		where += ` AND v.total_amount <= ?`
		args = append(args, models.ToMinor(f.MaxAmount))
	}
	if f.Search != "" {
		where += ` AND (v.voucher_number LIKE ? OR c.name LIKE ? OR c.client_code LIKE ? OR v.reference_no LIKE ? OR v.notes LIKE ?)`
		like := "%" + f.Search + "%"
		args = append(args, like, like, like, like, like)
	}

	totalsQuery := fmt.Sprintf(`
		SELECT COUNT(*),
		       COALESCE(SUM(v.total_amount), 0),
		       COALESCE(SUM(v.allocated_total), 0)
		FROM receipt_vouchers v
		JOIN issuers s ON s.id = v.issuer_id
		JOIN clients c ON c.id = v.client_id
		%s
	`, where)

	var totalCount int
	var sumTotalMinor, sumAllocMinor int64
	_ = s.db.QueryRow(totalsQuery, args...).Scan(&totalCount, &sumTotalMinor, &sumAllocMinor)

	sumTotal := models.ToMajor(sumTotalMinor)
	sumAlloc := models.ToMajor(sumAllocMinor)
	sumUnalloc := models.ToMajor(sumTotalMinor - sumAllocMinor)

	query := fmt.Sprintf(`
		SELECT v.id, v.voucher_number, v.issuer_id, v.client_id, v.voucher_date,
		       v.total_amount, v.allocated_total, v.payment_type, v.reference_no, v.notes,
		       v.status, v.created_by, v.created_at, v.updated_at,
		       s.name_ar, c.name, c.client_code
		FROM receipt_vouchers v
		JOIN issuers s ON s.id = v.issuer_id
		JOIN clients c ON c.id = v.client_id
		%s
		ORDER BY v.voucher_date DESC, v.created_at DESC
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

	res := &ListVouchersResult{
		Items:      make([]VoucherView, 0),
		TotalCount: totalCount,
		Total:      totalCount,
		Page:       page,
		Limit:      limit,
		Totals: VoucherTotals{
			TotalAmount:      sumTotal,
			AllocatedTotal:   sumAlloc,
			UnallocatedTotal: sumUnalloc,
		},
	}

	for rows.Next() {
		var idVal, vNum, issID, clientID, vDate, pType, refNo, notes, status, createdBy, createdAt, updatedAt, issName, clientName, clientCode string
		var totalAmt, allocTotal int64
		if err := rows.Scan(
			&idVal, &vNum, &issID, &clientID, &vDate,
			&totalAmt, &allocTotal, &pType, &refNo, &notes,
			&status, &createdBy, &createdAt, &updatedAt,
			&issName, &clientName, &clientCode,
		); err == nil {
			pLabel := paymentLabels[pType]
			sLabel := "نشط"
			if status == "CANCELLED" {
				sLabel = "ملغى"
			}
			totMaj := models.ToMajor(totalAmt)
			allocMaj := models.ToMajor(allocTotal)
			unallocMaj := models.ToMajor(totalAmt - allocTotal)

			view := VoucherView{
				ID:             idVal,
				VoucherNumber:  vNum,
				IssuerID:       issID,
				IssuerName:     issName,
				ClientID:       clientID,
				ClientName:     clientName,
				ClientCode:     clientCode,
				VoucherDate:    vDate,
				TotalAmount:    totMaj,
				AllocatedTotal: allocMaj,
				Unallocated:    unallocMaj,
				PaymentType:    pType,
				PaymentLabel:   pLabel,
				ReferenceNo:    refNo,
				Notes:          notes,
				Status:         status,
				StatusLabel:    sLabel,
				CreatedBy:      createdBy,
				CreatedAt:      createdAt,
				UpdatedAt:      updatedAt,
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
	result, err := tx.Exec("UPDATE receipt_vouchers SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status = 'ACTIVE'", now, id)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 { return errors.New("سند القبض ملغى بالفعل") }

	// Rollback allocations from invoices
	for _, a := range v.Allocations {
		allocMinor := models.ToMinor(a.AllocatedAmount)
		var grandTotal, paidAmount int64
		var status string
		if err := tx.QueryRow("SELECT grand_total, paid_amount, status FROM invoices WHERE id = ?", a.InvoiceID).Scan(&grandTotal, &paidAmount, &status); err != nil { return err }
		newPaid := paidAmount - allocMinor
		if newPaid < 0 {
			return errors.New("السدادات الحالية لا تطابق التخصيصات؛ يلزم مراجعة السند")
		}
		newRem := grandTotal - newPaid
		newStatus := "UNPAID"
		if newPaid > 0 && newRem > 0 {
			newStatus = "PARTIAL"
		} else if newPaid >= grandTotal {
			newStatus = "PAID"
		}

		if status == "CANCELLED" { newStatus = "CANCELLED" }
		_, err = tx.Exec(`
			UPDATE invoices SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ?
			WHERE id = ?
		`, newPaid, newRem, newStatus, now, a.InvoiceID)
		if err != nil { return err }
	}

	// Reverse entry in client_ledger
	totalAmountMinor := models.ToMinor(v.TotalAmount)
	_, err = tx.Exec(`
		INSERT INTO client_ledger (
			id, client_id, issuer_id, doc_type, doc_id, doc_number,
			transaction_date, debit, credit, description, created_at
		) VALUES (
			?, ?, ?, 'RECEIPT_CANCEL', ?, ?,
			?, ?, 0, ?, ?
		)
	`, crypto.UUID(), v.ClientID, v.IssuerID, v.ID, v.VoucherNumber, db.TodayIso(), totalAmountMinor, fmt.Sprintf("إلغاء سند قبض رقم %s", v.VoucherNumber), now)
	if err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	s.db.Audit(actor, "VOUCHER_CANCEL", "voucher", id, v.IssuerID, map[string]any{
		"voucher_number": v.VoucherNumber,
		"amount":         v.TotalAmount,
	}, ip)

	return nil
}

// Bound monetary inputs before conversion, arithmetic and accumulation.
func validAmount(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v,0) && v >= 0 && v <= 1e12 }
