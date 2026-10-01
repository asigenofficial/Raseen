package services

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
	"raseen/internal/db"
)

func TestStatementShowsAllocatedInvoicesAndRunningBalance(t *testing.T) {
	sqlDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	d := &db.DB{DB: sqlDB}
	if _, err := d.Exec(db.SchemaSQL); err != nil {
		t.Fatal(err)
	}
	statements := []string{
		`INSERT INTO issuers(id,code,name_ar,created_at,updated_at) VALUES('iss','I','شركة','2026-01-01','2026-01-01')`,
		`INSERT INTO clients(id,client_code,name,created_at,updated_at) VALUES('client','C-1','عميل','2026-01-01','2026-01-01')`,
		`INSERT INTO invoices(id,issuer_id,client_id,invoice_number,uuid,issue_date,issue_datetime,created_at,updated_at,grand_total,remaining_amount) VALUES('inv','iss','client','INV-00001','uuid','2026-10-01','2026-10-01T12:00:00','2026-10-01','2026-10-01',10000,5000)`,
		`INSERT INTO receipt_vouchers(id,voucher_number,issuer_id,client_id,voucher_date,total_amount,allocated_total,created_at,updated_at) VALUES('v','RV-00001','iss','client','2026-10-02',5000,5000,'2026-10-02','2026-10-02')`,
		`INSERT INTO voucher_allocations(id,voucher_id,invoice_id,allocated_amount,created_at) VALUES('a','v','inv',5000,'2026-10-02')`,
		`INSERT INTO client_ledger(id,client_id,issuer_id,doc_type,doc_id,doc_number,transaction_date,debit,created_at) VALUES('l1','client','iss','INVOICE','inv','INV-00001','2026-10-01',10000,'2026-10-01')`,
		`INSERT INTO client_ledger(id,client_id,issuer_id,doc_type,doc_id,doc_number,transaction_date,credit,created_at) VALUES('l2','client','iss','RECEIPT','v','RV-00001','2026-10-02',5000,'2026-10-02')`,
	}
	for _, query := range statements {
		if _, err := d.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	result, err := NewClientService(d).Statement(StatementParams{ClientID: "client"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Entries) != 2 {
		t.Fatalf("entries = %d", len(result.Entries))
	}
	if result.Entries[0].Description != "فاتورة بيع رقم INV-00001" {
		t.Fatal(result.Entries[0].Description)
	}
	if result.Entries[1].Description != "سداد فاتورة رقم INV-00001" {
		t.Fatal(result.Entries[1].Description)
	}
	if result.Entries[0].BalanceAfter != 100 || result.Entries[1].BalanceAfter != 50 {
		t.Fatalf("balances = %v, %v", result.Entries[0].BalanceAfter, result.Entries[1].BalanceAfter)
	}
}

func TestVoucherNumberContinuesAfterExistingNumbers(t *testing.T) {
	sqlDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	d := &db.DB{DB: sqlDB}
	if _, err := d.Exec(db.SchemaSQL); err != nil {
		t.Fatal(err)
	}
	queries := []string{
		`INSERT INTO issuers(id,code,name_ar,voucher_next_no,created_at,updated_at) VALUES('iss','I','شركة',1,'2026-01-01','2026-01-01')`,
		`INSERT INTO clients(id,client_code,name,created_at,updated_at) VALUES('client','C-1','عميل','2026-01-01','2026-01-01')`,
		`INSERT INTO receipt_vouchers(id,voucher_number,issuer_id,client_id,voucher_date,created_at,updated_at) VALUES('v','RV-00007','iss','client','2026-10-01','2026-10-01','2026-10-01')`,
	}
	for _, query := range queries {
		if _, err := d.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := d.Begin()
	if err != nil {
		t.Fatal(err)
	}
	number, _, err := NewIssuerService(d).NextVoucherNumber(tx, "iss")
	if err != nil {
		t.Fatal(err)
	}
	if number != "RV-00008" {
		t.Fatalf("next number = %s", number)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestVoucherDateUpdateMovesLedgerEntry(t *testing.T) {
	sqlDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	d := &db.DB{DB: sqlDB}
	if _, err := d.Exec(db.SchemaSQL); err != nil {
		t.Fatal(err)
	}
	queries := []string{
		`INSERT INTO issuers(id,code,name_ar,created_at,updated_at) VALUES('iss','I','شركة','2026-01-01','2026-01-01')`,
		`INSERT INTO clients(id,client_code,name,created_at,updated_at) VALUES('client','C-1','عميل','2026-01-01','2026-01-01')`,
		`INSERT INTO receipt_vouchers(id,voucher_number,issuer_id,client_id,voucher_date,total_amount,created_at,updated_at) VALUES('v','RV-00001','iss','client','2026-10-01',5000,'2026-10-01','2026-10-01')`,
		`INSERT INTO client_ledger(id,client_id,issuer_id,doc_type,doc_id,doc_number,transaction_date,credit,created_at) VALUES('l','client','iss','RECEIPT','v','RV-00001','2026-10-01',5000,'2026-10-01')`,
	}
	for _, query := range queries {
		if _, err := d.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	_, err = NewVoucherService(d, NewIssuerService(d)).UpdateVoucher("v", UpdateVoucherInput{VoucherDate: "2026-10-03", PaymentType: "CASH"}, "admin", "")
	if err != nil {
		t.Fatal(err)
	}
	var date string
	if err := d.QueryRow("SELECT transaction_date FROM client_ledger WHERE doc_id = 'v'").Scan(&date); err != nil {
		t.Fatal(err)
	}
	if date != "2026-10-03" {
		t.Fatalf("ledger date = %s", date)
	}
}
