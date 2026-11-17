package db

import (
	"database/sql"
	"path/filepath"
	"testing"

	"raseen/internal/config"
)

func TestOpenUpgradesLegacySchemaWithoutCreditNoteColumns(t *testing.T) {
	tmpDir := t.TempDir()
	dbFile := filepath.Join(tmpDir, "zsystem.db")

	// Seed a legacy SQLite database matching pre-366c98d schema (c192713):
	// sessions lacks user_agent/current_view/last_active_at,
	// issuers lacks credit_note_prefix/credit_note_next_no,
	// invoices lacks document_type/ref_invoice_id/show_sar_symbol/etc.,
	// invoice_items lacks unit_price_incl/discount_incl.
	legacyDDL := `
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT
);
CREATE TABLE issuers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  commercial_register TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  street_en TEXT NOT NULL DEFAULT '',
  building_no TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  district_en TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  city_en TEXT NOT NULL DEFAULT '',
  address_en TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'SA',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  logo_data TEXT,
  default_tax_rate REAL NOT NULL DEFAULT 15,
  currency TEXT NOT NULL DEFAULT 'SAR',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  invoice_next_no INTEGER NOT NULL DEFAULT 1,
  invoice_pad INTEGER NOT NULL DEFAULT 5,
  voucher_prefix TEXT NOT NULL DEFAULT 'RV',
  voucher_next_no INTEGER NOT NULL DEFAULT 1,
  zatca_phase TEXT NOT NULL DEFAULT 'PHASE1',
  qr_settings TEXT NOT NULL DEFAULT '{}',
  print_settings TEXT NOT NULL DEFAULT '{}',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_iban TEXT NOT NULL DEFAULT '',
  footer_notes TEXT NOT NULL DEFAULT '',
  legal_terms TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  invoice_type TEXT NOT NULL DEFAULT 'STANDARD',
  zatca_phase TEXT NOT NULL DEFAULT 'PHASE1',
  uuid TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  issue_time TEXT NOT NULL DEFAULT '12:00:00',
  issue_datetime TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  taxable_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  grand_total INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  payment_method TEXT NOT NULL DEFAULT 'CREDIT',
  due_date TEXT,
  cheque_date TEXT,
  cheque_no TEXT NOT NULL DEFAULT '',
  prices_include_tax INTEGER NOT NULL DEFAULT 0,
  batch_id TEXT,
  qr_payload TEXT NOT NULL DEFAULT '',
  invoice_hash TEXT NOT NULL DEFAULT '',
  previous_invoice_hash TEXT NOT NULL DEFAULT '',
  seller_name TEXT NOT NULL DEFAULT '',
  seller_tax_number TEXT NOT NULL DEFAULT '',
  seller_cr TEXT NOT NULL DEFAULT '',
  seller_address TEXT NOT NULL DEFAULT '',
  seller_address_en TEXT NOT NULL DEFAULT '',
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_tax_number TEXT NOT NULL DEFAULT '',
  buyer_cr TEXT NOT NULL DEFAULT '',
  buyer_address TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',
  signature_mode TEXT NOT NULL DEFAULT 'NONE',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (issuer_id, invoice_number)
);
CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  item_id TEXT,
  line_no INTEGER NOT NULL DEFAULT 1,
  item_code TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 15,
  taxable INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total_line INTEGER NOT NULL DEFAULT 0
);
`
	raw, err := sql.Open("sqlite", dbFile)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	if _, err := raw.Exec(legacyDDL); err != nil {
		raw.Close()
		t.Fatalf("seed legacy schema: %v", err)
	}
	if _, err := raw.Exec(`
		INSERT INTO invoices (id, issuer_id, client_id, invoice_number, uuid, issue_date, issue_datetime, created_at, updated_at)
		VALUES ('inv-1', 'iss-1', 'cli-1', 'INV-00001', 'u-1', '2026-11-01', '2026-11-01T12:00:00Z', '2026-11-01T12:00:00Z', '2026-11-01T12:00:00Z')
	`); err != nil {
		raw.Close()
		t.Fatalf("seed legacy invoice: %v", err)
	}
	_ = raw.Close()

	cfg := config.Load()
	cfg.DataDir = tmpDir
	cfg.DbFile = dbFile
	cfg.KeyFile = filepath.Join(tmpDir, "secret.key")
	cfg.BackupDir = filepath.Join(tmpDir, "backups")

	d, err := Open(cfg)
	if err != nil {
		t.Fatalf("Open() on legacy database failed: %v", err)
	}

	// Verify migrated columns exist and existing row preserves defaults
	var docType, refID string
	var showSAR int
	if err := d.QueryRow(`SELECT COALESCE(document_type, ''), COALESCE(ref_invoice_id, ''), show_sar_symbol FROM invoices WHERE id = 'inv-1'`).Scan(&docType, &refID, &showSAR); err != nil {
		d.Close()
		t.Fatalf("migrated invoices columns not queryable: %v", err)
	}
	if docType != "INVOICE" || showSAR != 1 {
		d.Close()
		t.Fatalf("unexpected migrated defaults: document_type=%q show_sar_symbol=%d", docType, showSAR)
	}

	var unitIncl, discIncl float64
	err = d.QueryRow(`SELECT unit_price_incl, discount_incl FROM invoice_items LIMIT 1`).Scan(&unitIncl, &discIncl)
	if err != nil && err != sql.ErrNoRows {
		d.Close()
		t.Fatalf("migrated invoice_items columns not queryable: %v", err)
	}

	// Verify indexes created after column migration exist
	for _, idx := range []string{"idx_invoices_doc_type", "idx_invoices_ref_invoice"} {
		var name string
		if err := d.QueryRow(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`, idx).Scan(&name); err != nil {
			d.Close()
			t.Fatalf("expected index %s to exist: %v", idx, err)
		}
	}
	_ = d.Close()

	// Verify reopening an already-migrated DB is idempotent
	d2, err := Open(cfg)
	if err != nil {
		t.Fatalf("reopening upgraded database failed: %v", err)
	}
	_ = d2.Close()
}

func TestOpenFreshDatabase(t *testing.T) {
	tmpDir := t.TempDir()
	cfg := config.Load()
	cfg.DataDir = tmpDir
	cfg.DbFile = filepath.Join(tmpDir, "fresh.db")
	cfg.KeyFile = filepath.Join(tmpDir, "secret.key")
	cfg.BackupDir = filepath.Join(tmpDir, "backups")

	d, err := Open(cfg)
	if err != nil {
		t.Fatalf("Open() on fresh database failed: %v", err)
	}
	defer d.Close()

	for _, idx := range []string{"idx_invoices_doc_type", "idx_invoices_ref_invoice"} {
		var name string
		if err := d.QueryRow(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`, idx).Scan(&name); err != nil {
			t.Fatalf("expected index %s to exist on fresh DB: %v", idx, err)
		}
	}
}
