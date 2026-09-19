package db

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"

	"raseen/internal/config"
	"raseen/internal/crypto"
)

//go:embed schema.sql
var SchemaSQL string

type DB struct {
	*sql.DB
	cfg *config.Config
}

type BackupResult struct {
	Filename  string `json:"filename"`
	Path      string `json:"path"`
	SizeBytes int64  `json:"sizeBytes"`
	CreatedAt string `json:"createdAt"`
}

func Open(cfg *config.Config) (*DB, error) {
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data dir: %w", err)
	}

	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)", cfg.DbFile)
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite: %w", err)
	}

	sqldb.SetMaxOpenConns(1) // SQLite single-writer WAL safety

	database := &DB{DB: sqldb, cfg: cfg}
	if err := database.initSchema(); err != nil {
		sqldb.Close()
		return nil, fmt.Errorf("failed to init schema: %w", err)
	}

	if err := database.bootstrap(); err != nil {
		sqldb.Close()
		return nil, fmt.Errorf("failed to bootstrap data: %w", err)
	}

	return database, nil
}

func (d *DB) initSchema() error {
	_, err := d.Exec(SchemaSQL)
	return err
}

func (d *DB) bootstrap() error {
	now := NowIso()

	// 1. Bootstrap Admin User if none exists
	var count int
	err := d.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return err
	}

	if count == 0 {
		hash, salt := crypto.HashPassword(d.cfg.BootstrapAdmin.Password, "")
		userId := crypto.UUID()
		_, err = d.Exec(`
			INSERT INTO users (id, username, full_name, password_hash, password_salt, role, permissions, is_active, created_at)
			VALUES (?, ?, ?, ?, ?, 'ADMIN', '["*"]', 1, ?)
		`, userId, d.cfg.BootstrapAdmin.Username, d.cfg.BootstrapAdmin.FullName, hash, salt, now)
		if err != nil {
			return fmt.Errorf("failed to create bootstrap admin: %w", err)
		}
	}

	// 2. Bootstrap default system settings
	defaults := map[string]string{
		"currency":               d.cfg.Defaults.Currency,
		"default_tax_rate":       fmt.Sprintf("%.2f", d.cfg.Defaults.TaxRate),
		"country":                d.cfg.Defaults.Country,
		"bulk_max_invoices":      "2000",
		"invoice_prefix_default": "INV",
		"invoice_pad_default":    "5",
		"voucher_prefix_default": "RV",
		"print_copies_default":   "1",
	}

	for k, v := range defaults {
		_, _ = d.Exec(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`, k, v, now)
	}

	// 3. Bootstrap default issuer if none exists
	var issCount int
	_ = d.QueryRow("SELECT COUNT(*) FROM issuers").Scan(&issCount)
	if issCount == 0 {
		issId := crypto.UUID()
		_, _ = d.Exec(`
			INSERT INTO issuers (
				id, code, name_ar, name_en, tax_number, commercial_register,
				street, building_no, district, city, postal_code, country,
				default_tax_rate, currency, invoice_prefix, invoice_next_no, invoice_pad,
				voucher_prefix, voucher_next_no, zatca_phase, qr_settings, print_settings,
				bank_name, bank_iban, footer_notes, legal_terms, is_active, created_at, updated_at
			) VALUES (
				?, 'ZS-001', 'شركة رسين للتجارة والحلول الرقمية', 'Raseen Trading & Digital Solutions',
				'300000000000003', '1010000000', 'طريق الملك فهد', '2418', 'حي العليا', 'الرياض',
				'12214', 'المملكة العربية السعودية', 15.0, 'SAR', 'INV', 1, 5,
				'RV', 1, 'PHASE1', '{}', '{}',
				'البنك الأهلي السعودي', 'SA0380000000608010167519',
				'شكراً لتعاملكم معنا. الأسعار تشمل ضريبة القيمة المضافة 15%.',
				'تخضع هذه الفاتورة لأحكام نظام ضريبة القيمة المضافة في المملكة العربية السعودية.',
				1, ?, ?
			)
		`, issId, now, now)
	}

	return nil
}

func (d *DB) CreateBackup() (*BackupResult, error) {
	if err := os.MkdirAll(d.cfg.BackupDir, 0755); err != nil {
		return nil, err
	}

	stamp := time.Now().Format("2006-01-02_150405.000000000")
	filename := fmt.Sprintf("raseen_backup_%s.db", stamp)
	destPath := filepath.Join(d.cfg.BackupDir, filename)

	// VACUUM INTO includes committed WAL contents in a consistent snapshot.
	_, err := d.Exec("VACUUM INTO ?", filepath.ToSlash(destPath))
	if err != nil {
		return nil, fmt.Errorf("consistent backup failed: %w",err)
	}

	stat, err := os.Stat(destPath)
	if err != nil {
		return nil, err
	}

	return &BackupResult{
		Filename:  filename,
		Path:      destPath,
		SizeBytes: stat.Size(),
		CreatedAt: NowIso(),
	}, nil
}

func (d *DB) Audit(userName, action, entityType, entityId, issuerId string, details any, ip string) {
	if err := AuditTx(d,userName,action,entityType,entityId,issuerId,details,ip); err != nil { log.Printf("audit write failed (%s): %v",action,err) }
}

func AuditTx(q interface { Exec(string,...any) (sql.Result,error) }, userName, action, entityType, entityId, issuerId string, details any, ip string) error {
	var detailsJson string
	if details == nil {
		detailsJson = "{}"
	} else {
		b, err := json.Marshal(details)
		if err != nil {
			detailsJson = "{}"
		} else {
			detailsJson = string(b)
		}
	}

	var issId *string
	if issuerId != "" {
		issId = &issuerId
	}
	_, err := q.Exec(`
		INSERT INTO audit_logs (id, user_name, action, entity_type, entity_id, issuer_id, details, ip, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, crypto.UUID(), userName, action, entityType, entityId, issId, detailsJson, ip, NowIso())
	return err
}

func NowIso() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func TodayIso() string {
	return time.Now().Format("2006-01-02")
}
