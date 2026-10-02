package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"raseen/internal/config"
	"raseen/internal/crypto"
)

func TestRestoreRejectsIncompleteDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "incomplete.db")
	source, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec("CREATE TABLE users(id TEXT)"); err != nil {
		t.Fatal(err)
	}
	source.Close()
	d := &DB{cfg: &config.Config{Host: "127.0.0.1"}}
	if _, err := d.RestoreFrom(path); err == nil || !strings.Contains(err.Error(), "جداول") {
		t.Fatalf("incomplete database accepted: %v", err)
	}
}

func TestRestoreRejectsDefaultAdminOnPublicHost(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unsafe.db")
	source, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = source.Exec(`
		CREATE TABLE users(role TEXT, is_active INTEGER, password_hash TEXT, password_salt TEXT);
		CREATE TABLE invoices(id TEXT);
		CREATE TABLE issuers(id TEXT);
		CREATE TABLE settings(key TEXT);
	`)
	if err != nil {
		t.Fatal(err)
	}
	hash, salt := crypto.HashPassword("Admin@12345", "")
	if _, err := source.Exec("INSERT INTO users VALUES ('ADMIN', 1, ?, ?)", hash, salt); err != nil {
		t.Fatal(err)
	}
	source.Close()
	d := &DB{cfg: &config.Config{Host: "0.0.0.0"}}
	if _, err := d.RestoreFrom(path); err == nil || !strings.Contains(err.Error(), "الافتراضية") {
		t.Fatalf("unsafe admin accepted: %v", err)
	}
}

func TestRestoreRollsBackWhenBootstrapFails(t *testing.T) {
	dir := t.TempDir()
	cfg := config.Load()
	cfg.Host = "127.0.0.1"
	cfg.DataDir = dir
	cfg.DbFile = filepath.Join(dir, "live.db")
	cfg.BackupDir = filepath.Join(dir, "backups")
	cfg.KeyFile = filepath.Join(dir, "secret.key")
	if err := os.WriteFile(cfg.KeyFile, []byte("test-backup-key"), 0600); err != nil {
		t.Fatal(err)
	}
	d, err := Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = d.Close() }()
	if _, err := d.Exec("INSERT INTO settings(key, value, updated_at) VALUES ('restore_marker', 'kept', 'now')"); err != nil {
		t.Fatal(err)
	}

	sourcePath := filepath.Join(dir, "broken.db")
	source, err := sql.Open("sqlite", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = source.Exec(`
		CREATE TABLE users(id TEXT);
		CREATE TABLE invoices(id TEXT);
		CREATE TABLE issuers(id TEXT);
		CREATE TABLE settings(key TEXT);
	`)
	if err != nil {
		t.Fatal(err)
	}
	source.Close()
	if _, err := d.RestoreFrom(sourcePath); err == nil {
		t.Fatal("malformed restore reported success")
	}
	var marker string
	if err := d.QueryRow("SELECT value FROM settings WHERE key = 'restore_marker'").Scan(&marker); err != nil || marker != "kept" {
		t.Fatalf("backup was not restored: marker=%q err=%v", marker, err)
	}
	backups, err := filepath.Glob(filepath.Join(cfg.BackupDir, "raseen_backup_*.key"))
	if err != nil || len(backups) != 1 {
		t.Fatalf("backup key missing: files=%v err=%v", backups, err)
	}
	key, err := os.ReadFile(backups[0])
	if err != nil || string(key) != "test-backup-key" {
		t.Fatalf("backup key mismatch: err=%v", err)
	}
}
