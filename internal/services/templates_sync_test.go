package services

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
	"raseen/internal/db"
)

func TestSyncDiskTemplatesKeepsIDsAfterPackageMovesDataDirectory(t *testing.T) {
	sqlDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	database := &db.DB{DB: sqlDB}
	if _, err := database.Exec(db.SchemaSQL); err != nil {
		t.Fatal(err)
	}

	dataDir := t.TempDir()
	categories := []struct {
		category string
		name     string
		id       string
	}{
		{"invoices", "فاتورة-مبيعات.html", "invoice-template-id"},
		{"documents", "سند-قبض.html", "document-template-id"},
		{"reports", "تقرير-مالي.html", "report-template-id"},
		{"statements", "كشف-حساب.html", "statement-template-id"},
	}
	for _, item := range categories {
		categoryDir := filepath.Join(dataDir, "templates", item.category)
		if err := os.MkdirAll(categoryDir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(categoryDir, item.name), []byte("<!doctype html><title>قالب عربي</title>"), 0644); err != nil {
			t.Fatal(err)
		}
		oldPath := filepath.Join("Z:\\previous-installation\\data", "templates", item.category, item.name)
		if _, err := database.Exec(`
			INSERT INTO excel_templates (id, name_ar, category, file_path, color_hex, headers_json, updated_at)
			VALUES (?, ?, ?, ?, '#059669', '[]', '2026-10-02')
		`, item.id, item.name, item.category, oldPath); err != nil {
			t.Fatal(err)
		}
	}

	service := &TemplateService{db: database, dataDir: dataDir}
	for run := 0; run < 2; run++ {
		if err := service.SyncDiskTemplates(); err != nil {
			t.Fatalf("sync %d: %v", run+1, err)
		}
	}

	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM excel_templates").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != len(categories) {
		t.Fatalf("template catalog count = %d, want %d", count, len(categories))
	}
	for _, item := range categories {
		var actualPath string
		if err := database.QueryRow("SELECT file_path FROM excel_templates WHERE id = ?", item.id).Scan(&actualPath); err != nil {
			t.Fatalf("template ID %q was not preserved: %v", item.id, err)
		}
		if actualPath != filepath.Join(dataDir, "templates", item.category, item.name) {
			t.Errorf("%s path = %q", item.category, actualPath)
		}
	}
}
