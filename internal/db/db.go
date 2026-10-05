package db

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"raseen/internal/config"
	"raseen/internal/crypto"
)

//go:embed schema.sql
var SchemaSQL string

type DB struct {
	*sql.DB
	cfg     *config.Config
	writeMu sync.Mutex
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

	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(15000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)&_pragma=cache_size(-128000)&_pragma=mmap_size(268435456)&_pragma=temp_store(MEMORY)&_pragma=wal_autocheckpoint(1000)", cfg.DbFile)
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite: %w", err)
	}

	maxConns := runtime.NumCPU() * 4
	if maxConns < 10 {
		maxConns = 10
	} else if maxConns > 50 {
		maxConns = 50
	}
	sqldb.SetMaxOpenConns(maxConns)
	sqldb.SetMaxIdleConns(maxConns)
	sqldb.SetConnMaxLifetime(1 * time.Hour)
	sqldb.SetConnMaxIdleTime(15 * time.Minute)

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

func (d *DB) WithWriteLock(fn func() error) error {
	d.writeMu.Lock()
	defer d.writeMu.Unlock()
	return fn()
}

func (d *DB) WriteLock() {
	d.writeMu.Lock()
}

func (d *DB) WriteUnlock() {
	d.writeMu.Unlock()
}

func (d *DB) initSchema() error {
	_, err := d.Exec(SchemaSQL)
	if err != nil {
		return err
	}
	// Migrate sessions columns if missing
	_, _ = d.Exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT DEFAULT ''")
	_, _ = d.Exec("ALTER TABLE sessions ADD COLUMN current_view TEXT DEFAULT ''")
	_, _ = d.Exec("ALTER TABLE sessions ADD COLUMN last_active_at TEXT DEFAULT ''")
	return nil
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

	// 4. Ensure legacy cash invoices have remaining_amount = 0, paid_amount = grand_total, status = PAID
	_, _ = d.Exec(`
		UPDATE invoices 
		SET paid_amount = grand_total, remaining_amount = 0, status = 'PAID' 
		WHERE (payment_method LIKE '%CASH%' OR payment_method LIKE '%نقد%') 
		  AND remaining_amount > 0
	`)

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
		return nil, fmt.Errorf("consistent backup failed: %w", err)
	}

	stat, err := os.Stat(destPath)
	if err != nil {
		return nil, err
	}
	keyBytes, err := os.ReadFile(d.cfg.KeyFile)
	if err != nil {
		_ = os.Remove(destPath)
		return nil, fmt.Errorf("failed to read backup encryption key: %w", err)
	}
	keyPath := strings.TrimSuffix(destPath, ".db") + ".key"
	if err := os.WriteFile(keyPath, keyBytes, 0600); err != nil {
		_ = os.Remove(destPath)
		return nil, fmt.Errorf("failed to back up encryption key: %w", err)
	}

	// Keep latest 5 backups to prevent disk overflow while ensuring safety
	pruneOldBackups(d.cfg.BackupDir, 5)

	return &BackupResult{
		Filename:  filename,
		Path:      destPath,
		SizeBytes: stat.Size(),
		CreatedAt: NowIso(),
	}, nil
}

func pruneOldBackups(dir string, keepCount int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	var backupFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), "raseen_backup_") && strings.HasSuffix(entry.Name(), ".db") {
			backupFiles = append(backupFiles, entry.Name())
		}
	}

	if len(backupFiles) <= keepCount {
		return
	}

	sort.Strings(backupFiles)
	toDelete := len(backupFiles) - keepCount
	for i := 0; i < toDelete; i++ {
		_ = os.Remove(filepath.Join(dir, backupFiles[i]))
		_ = os.Remove(filepath.Join(dir, strings.TrimSuffix(backupFiles[i], ".db")+".key"))
	}
}

// RestoreFrom safely replaces the live database with an imported SQLite database.
// It verifies the SQLite header and schema integrity, takes a pre-restore backup,
// closes the current database, overwrites the DB file, and reopens the connection cleanly.
func (d *DB) RestoreFrom(sourcePath string) (*BackupResult, error) {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("ملف الاستيراد غير موجود: %w", err)
	}
	if info.Size() < 100 {
		return nil, fmt.Errorf("حجم الملف صغير جداً وغير صالح كقاعدة بيانات")
	}

	f, err := os.Open(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("تعذر فتح ملف الاستيراد: %w", err)
	}
	header := make([]byte, 16)
	_, _ = f.Read(header)
	f.Close()
	if !strings.HasPrefix(string(header), "SQLite format 3\x00") {
		return nil, fmt.Errorf("الملف المرفوع ليس ملف قاعدة بيانات SQLite صالح")
	}

	testDsn := fmt.Sprintf("%s?_pragma=busy_timeout(3000)", filepath.ToSlash(sourcePath))
	testDb, err := sql.Open("sqlite", testDsn)
	if err != nil {
		return nil, fmt.Errorf("فشل فحص ملف قاعدة البيانات: %w", err)
	}
	var integrity string
	err = testDb.QueryRow("PRAGMA integrity_check").Scan(&integrity)
	if err != nil || integrity != "ok" {
		testDb.Close()
		return nil, fmt.Errorf("فحص سلامة قاعدة البيانات المرفوعة لم ينجح: %s", integrity)
	}
	var tableCount int
	_ = testDb.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users', 'invoices', 'issuers', 'settings')").Scan(&tableCount)
	if tableCount != 4 {
		testDb.Close()
		return nil, fmt.Errorf("ملف قاعدة البيانات لا يحتوي على جميع جداول رسين الأساسية")
	}
	if d.cfg.IsPublicHost() {
		rows, err := testDb.Query("SELECT password_hash, password_salt FROM users WHERE role = 'ADMIN' AND is_active = 1")
		if err != nil {
			testDb.Close()
			return nil, fmt.Errorf("تعذر التحقق من حسابات المدير المستوردة: %w", err)
		}
		for rows.Next() {
			var hash, salt string
			if err := rows.Scan(&hash, &salt); err != nil {
				rows.Close()
				testDb.Close()
				return nil, fmt.Errorf("تعذر قراءة حساب المدير المستورد: %w", err)
			}
			if crypto.VerifyPassword("Admin@12345", salt, hash) {
				rows.Close()
				testDb.Close()
				return nil, fmt.Errorf("قاعدة البيانات المستوردة تحتوي كلمة مرور المدير الافتراضية")
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			testDb.Close()
			return nil, fmt.Errorf("تعذر التحقق من حسابات المدير المستوردة: %w", err)
		}
		rows.Close()
	}
	testDb.Close()

	// 1. أخذ نسخة احتياطية وقائية فورية من قاعدة البيانات الحالية لضمان عدم ضياع أي بيانات
	preBackup, err := d.CreateBackup()
	if err != nil {
		return nil, fmt.Errorf("فشل أخذ نسخة احتياطية وقائية قبل الاستيراد: %w", err)
	}

	// 2. إغلاق الاتصال الحالي
	if err := d.DB.Close(); err != nil {
		return nil, fmt.Errorf("تعذر إغلاق قاعدة البيانات الحالية: %w", err)
	}

	// 3. حذف ملفات WAL و SHM المؤقتة لضمان نظافة الاستبدال
	_ = os.Remove(d.cfg.DbFile + "-wal")
	_ = os.Remove(d.cfg.DbFile + "-shm")

	// 4. نسخ ملف قاعدة البيانات المستورد فوق DbFile
	if err := copyFile(sourcePath, d.cfg.DbFile); err != nil {
		_ = copyFile(preBackup.Path, d.cfg.DbFile)
		_ = d.reopen()
		return nil, fmt.Errorf("فشل استبدال ملف قاعدة البيانات: %w", err)
	}

	// 5. إعادة فتح الاتصال
	if err := d.reopen(); err != nil {
		_ = copyFile(preBackup.Path, d.cfg.DbFile)
		_ = d.reopen()
		return nil, fmt.Errorf("فشل إعادة فتح قاعدة البيانات بعد الاستيراد: %w", err)
	}

	// 6. تشغيل المخطط والتجهيزات، والتراجع إذا تعذر استخدام البيانات المستوردة.
	if err := d.initSchema(); err != nil {
		return nil, d.rollbackFailedRestore(preBackup, err)
	}
	if err := d.bootstrap(); err != nil {
		return nil, d.rollbackFailedRestore(preBackup, err)
	}

	return preBackup, nil
}

func (d *DB) rollbackFailedRestore(backup *BackupResult, cause error) error {
	_ = d.DB.Close()
	_ = os.Remove(d.cfg.DbFile + "-wal")
	_ = os.Remove(d.cfg.DbFile + "-shm")
	if err := copyFile(backup.Path, d.cfg.DbFile); err != nil {
		return fmt.Errorf("فشل تجهيز البيانات المستوردة: %v؛ وفشل إرجاع النسخة الوقائية: %w", cause, err)
	}
	if err := d.reopen(); err != nil {
		return fmt.Errorf("فشل تجهيز البيانات المستوردة: %v؛ وفشل فتح النسخة الوقائية: %w", cause, err)
	}
	return fmt.Errorf("فشل تجهيز البيانات المستوردة، وأُعيدت النسخة الوقائية: %w", cause)
}

func (d *DB) reopen() error {
	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(15000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)&_pragma=cache_size(-128000)&_pragma=mmap_size(268435456)&_pragma=temp_store(MEMORY)&_pragma=wal_autocheckpoint(1000)", d.cfg.DbFile)
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return err
	}
	maxConns := runtime.NumCPU() * 4
	if maxConns < 10 {
		maxConns = 10
	} else if maxConns > 50 {
		maxConns = 50
	}
	sqldb.SetMaxOpenConns(maxConns)
	sqldb.SetMaxIdleConns(maxConns)
	sqldb.SetConnMaxLifetime(1 * time.Hour)
	sqldb.SetConnMaxIdleTime(15 * time.Minute)
	if err := sqldb.Ping(); err != nil {
		sqldb.Close()
		return err
	}
	d.DB = sqldb
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err = io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func (d *DB) Audit(userName, action, entityType, entityId, issuerId string, details any, ip string) {
	if err := AuditTx(d, userName, action, entityType, entityId, issuerId, details, ip); err != nil {
		log.Printf("audit write failed (%s): %v", action, err)
	}
}

func AuditTx(q interface {
	Exec(string, ...any) (sql.Result, error)
}, userName, action, entityType, entityId, issuerId string, details any, ip string) error {
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
