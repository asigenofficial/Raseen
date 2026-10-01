package services

import (
	"database/sql"
	"math"
	"testing"

	_ "modernc.org/sqlite"
	"raseen/internal/db"
	"raseen/internal/models"
)

func setupVoucherTestDB(t *testing.T) (*db.DB, *VoucherService, *IssuerService) {
	sqlDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	d := &db.DB{DB: sqlDB}
	if _, err := d.Exec(db.SchemaSQL); err != nil {
		t.Fatal(err)
	}

	issuers := NewIssuerService(d)
	vouchers := NewVoucherService(d, issuers)

	// Seed basic issuer and client
	_, err = d.Exec(`
		INSERT INTO issuers(id, code, name_ar, voucher_prefix, voucher_next_no, is_active, created_at, updated_at)
		VALUES('iss-test', 'ZS-01', 'شركة الاختبار', 'RV', 10, 1, '2026-01-01', '2026-01-01');

		INSERT INTO clients(id, client_code, name, is_active, created_at, updated_at)
		VALUES('cli-test', 'CLI-01', 'عميل الاختبار', 1, '2026-01-01', '2026-01-01');
	`)
	if err != nil {
		t.Fatal(err)
	}

	return d, vouchers, issuers
}

// TestSingleVoucherAllocation اختبار تخصيص السند العادي وتحديث المتبقي
func TestSingleVoucherAllocation(t *testing.T) {
	d, vouchers, _ := setupVoucherTestDB(t)
	defer d.Close()

	// إدراج فاتورة بمبلغ 1,000 ر.س (100000 هللة) ومتبقي 1,000 ر.س
	_, err := d.Exec(`
		INSERT INTO invoices(id, issuer_id, client_id, invoice_number, uuid, issue_date, issue_datetime, status, grand_total, remaining_amount, created_at, updated_at)
		VALUES('inv-1', 'iss-test', 'cli-test', 'INV-001', 'uuid-1', '2026-10-01', '2026-10-01T10:00:00', 'UNPAID', 100000, 100000, '2026-10-01', '2026-10-01')
	`)
	if err != nil {
		t.Fatal(err)
	}

	// إنشاء سند بمبلغ 400 ر.س مخصص للفاتورة
	v, err := vouchers.CreateVoucher(CreateVoucherInput{
		IssuerID:    "iss-test",
		ClientID:    "cli-test",
		VoucherDate: "2026-10-01",
		TotalAmount: 400.0,
		PaymentType: "TRANSFER",
		Allocations: []VoucherAllocationInput{
			{InvoiceID: "inv-1", Amount: 400.0},
		},
	}, "test-user", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateVoucher failed: %v", err)
	}

	if v.VoucherNumber != "RV-00010" {
		t.Errorf("expected voucher number RV-00010, got %s", v.VoucherNumber)
	}
	if v.TotalAmount != 400.0 {
		t.Errorf("expected total amount 400.0, got %v", v.TotalAmount)
	}

	// التحقق من تحديث الفاتورة إلى 600 ر.س (60000 هللة)
	var remMinor int64
	var status string
	err = d.QueryRow("SELECT remaining_amount, status FROM invoices WHERE id = 'inv-1'").Scan(&remMinor, &status)
	if err != nil {
		t.Fatal(err)
	}
	if remMinor != 60000 || status != "PARTIAL" {
		t.Errorf("expected 60000 PARTIAL, got %d %s", remMinor, status)
	}
}

// TestAdvanceVoucherSeqGap اختبار قفز التسلسل لفجوات الترقيم
func TestAdvanceVoucherSeqGap(t *testing.T) {
	d, vouchers, _ := setupVoucherTestDB(t)
	defer d.Close()

	// القفز 3 أرقام
	_, err := d.Exec("UPDATE issuers SET voucher_next_no = voucher_next_no + ? WHERE id = ?", 3, "iss-test")
	if err != nil {
		t.Fatal(err)
	}

	v, err := vouchers.CreateVoucher(CreateVoucherInput{
		IssuerID:    "iss-test",
		ClientID:    "cli-test",
		VoucherDate: "2026-10-02",
		TotalAmount: 100.0,
		PaymentType: "CASH",
	}, "test-user", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateVoucher failed: %v", err)
	}

	// التالي كان 10 + 3 = 13
	if v.VoucherNumber != "RV-00013" {
		t.Errorf("expected voucher number RV-00013, got %s", v.VoucherNumber)
	}
}

// TestInstallmentAlgorithmAndAllocation اختبار خوارزمية تقسيم الأقساط وجبر السنتات
func TestInstallmentAlgorithmAndAllocation(t *testing.T) {
	total := 1000.00
	count := 3

	base := math.Floor((total/float64(count))*100) / 100
	last := math.Round((total-base*float64(count-1))*100) / 100

	if base != 333.33 {
		t.Errorf("expected base 333.33, got %v", base)
	}
	if last != 333.34 {
		t.Errorf("expected last 333.34, got %v", last)
	}
	if base*float64(count-1)+last != total {
		t.Errorf("installment sum does not equal total: %v vs %v", base*float64(count-1)+last, total)
	}

	// تجربة مع 7 دفعات بمبلغ 2500 ر.س
	total7 := 2500.00
	count7 := 7
	base7 := math.Floor((total7/float64(count7))*100) / 100
	last7 := math.Round((total7-base7*float64(count7-1))*100) / 100

	sum7 := base7*float64(count7-1) + last7
	if math.Abs(sum7-total7) > 0.0001 {
		t.Errorf("sum7 != total7: %v != %v", sum7, total7)
	}
}

// TestCancelVoucherRestoresInvoiceBalance اختبار إلغاء السند واسترجاع رصيد الفاتورة
func TestCancelVoucherRestoresInvoiceBalance(t *testing.T) {
	d, vouchers, _ := setupVoucherTestDB(t)
	defer d.Close()

	_, err := d.Exec(`
		INSERT INTO invoices(id, issuer_id, client_id, invoice_number, uuid, issue_date, issue_datetime, status, grand_total, remaining_amount, created_at, updated_at)
		VALUES('inv-c', 'iss-test', 'cli-test', 'INV-C', 'uuid-c', '2026-10-01', '2026-10-01T10:00:00', 'UNPAID', 50000, 50000, '2026-10-01', '2026-10-01')
	`)
	if err != nil {
		t.Fatal(err)
	}

	v, err := vouchers.CreateVoucher(CreateVoucherInput{
		IssuerID:    "iss-test",
		ClientID:    "cli-test",
		VoucherDate: "2026-10-01",
		TotalAmount: 500.0,
		PaymentType: "TRANSFER",
		Allocations: []VoucherAllocationInput{
			{InvoiceID: "inv-c", Amount: 500.0},
		},
	}, "test-user", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	// التأكد أن الفاتورة أصبحت مسددة بالكامل
	var remMinor int64
	_ = d.QueryRow("SELECT remaining_amount FROM invoices WHERE id = 'inv-c'").Scan(&remMinor)
	if remMinor != 0 {
		t.Fatalf("expected remaining 0, got %d", remMinor)
	}

	// إلغاء السند
	err = vouchers.CancelVoucher(v.ID, "test-user", "127.0.0.1")
	if err != nil {
		t.Fatalf("CancelVoucher failed: %v", err)
	}

	// التأكد أن رصيد الفاتورة عاد إلى 500 ر.س (50000 هللة)
	_ = d.QueryRow("SELECT remaining_amount FROM invoices WHERE id = 'inv-c'").Scan(&remMinor)
	if remMinor != 50000 {
		t.Errorf("expected remaining restored to 50000, got %d", remMinor)
	}
	_ = models.ToMinor(500)
}
