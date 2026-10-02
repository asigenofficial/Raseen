package api

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"raseen/internal/config"
	"raseen/internal/crypto"
	"raseen/internal/db"
)

func TestPackageMasterKey(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	f, err := zw.Create("secret.key")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte(base64.StdEncoding.EncodeToString(key))); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	got, err := packageMasterKey(zr.File)
	if err != nil || !bytes.Equal(got, key) {
		t.Fatalf("package key mismatch: %v", err)
	}
}

func TestExportImportPackagePreservesEncryptedCredentials(t *testing.T) {
	newInstallation := func(keyByte byte) (*Server, *db.DB, *http.Cookie) {
		t.Helper()
		dir := t.TempDir()
		cfg := config.Load()
		cfg.Host = "127.0.0.1"
		cfg.DataDir = dir
		cfg.DbFile = filepath.Join(dir, "zsystem.db")
		cfg.BackupDir = filepath.Join(dir, "backups")
		cfg.KeyFile = filepath.Join(dir, "secret.key")
		cfg.BootstrapAdmin.Password = "integration-test-password"
		key := bytes.Repeat([]byte{keyByte}, 32)
		if err := os.WriteFile(cfg.KeyFile, []byte(base64.StdEncoding.EncodeToString(key)), 0600); err != nil {
			t.Fatal(err)
		}
		database, err := db.Open(cfg)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = database.Close() })
		s := NewServer(cfg, database, key, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("ok")}})
		loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"integration-test-password"}`))
		login := httptest.NewRecorder()
		s.Handler().ServeHTTP(login, loginReq)
		if login.Code != http.StatusOK || len(login.Result().Cookies()) == 0 {
			t.Fatalf("login failed: %d %s", login.Code, login.Body.String())
		}
		return s, database, login.Result().Cookies()[0]
	}

	source, sourceDB, sourceCookie := newInstallation(0x31)
	var issuerID string
	if err := sourceDB.QueryRow("SELECT id FROM issuers LIMIT 1").Scan(&issuerID); err != nil {
		t.Fatal(err)
	}
	secret, err := crypto.EncryptSecret("exported-credential", source.masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sourceDB.Exec("INSERT INTO issuer_credentials(issuer_id, secret_enc, updated_at) VALUES (?, ?, ?)", issuerID, secret, db.NowIso()); err != nil {
		t.Fatal(err)
	}
	exportReq := httptest.NewRequest(http.MethodGet, "/api/system/export-package", nil)
	exportReq.AddCookie(sourceCookie)
	exported := httptest.NewRecorder()
	source.handleExportPackage(exported, exportReq)
	if exported.Code != http.StatusOK {
		t.Fatalf("export failed: %d %s", exported.Code, exported.Body.String())
	}
	zr, err := zip.NewReader(bytes.NewReader(exported.Body.Bytes()), int64(exported.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	archivedKey, err := packageMasterKey(zr.File)
	if err != nil || !bytes.Equal(archivedKey, source.masterKey) {
		t.Fatalf("exported package has no matching key: %v", err)
	}

	target, targetDB, targetCookie := newInstallation(0x72)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("package_file", "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(part, bytes.NewReader(exported.Body.Bytes())); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	importReq := httptest.NewRequest(http.MethodPost, "/api/system/import-package", &body)
	importReq.Header.Set("Content-Type", form.FormDataContentType())
	importReq.AddCookie(targetCookie)
	imported := httptest.NewRecorder()
	target.handleImportSystemPackage(imported, importReq)
	if imported.Code != http.StatusOK {
		t.Fatalf("import failed: %d %s", imported.Code, imported.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(imported.Body.Bytes(), &result); err != nil || result["ok"] != true {
		t.Fatalf("import result invalid: %s %v", imported.Body.String(), err)
	}
	var restored string
	if err := targetDB.QueryRow("SELECT secret_enc FROM issuer_credentials WHERE issuer_id=?", issuerID).Scan(&restored); err != nil {
		t.Fatal(err)
	}
	plain, err := crypto.DecryptSecret(restored, target.masterKey)
	if err != nil || plain != "exported-credential" {
		t.Fatalf("imported credential unreadable: %v", err)
	}
	if _, err := crypto.DecryptSecret(restored, source.masterKey); err == nil {
		t.Fatal("imported credential still uses source key")
	}
}

func TestPrepareImportedDatabaseSecretsReencryptsAndRejectsWrongKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "import.db")
	sourceKey := bytes.Repeat([]byte{0x11}, 32)
	targetKey := bytes.Repeat([]byte{0x22}, 32)
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(`CREATE TABLE issuer_credentials (
		issuer_id TEXT PRIMARY KEY, compliance_csid_enc TEXT, production_csid_enc TEXT,
		secret_enc TEXT, private_key_enc TEXT, certificate_enc TEXT)`); err != nil {
		t.Fatal(err)
	}
	secret, err := crypto.EncryptSecret("sensitive-credential", sourceKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec("INSERT INTO issuer_credentials(issuer_id, secret_enc) VALUES (?, ?)", "issuer-1", secret); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := prepareImportedDatabaseSecrets(path, targetKey, targetKey); err == nil || !strings.Contains(err.Error(), "مفتاح") {
		t.Fatalf("wrong key accepted: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("database changed after wrong key: %v", err)
	}
	if err := prepareImportedDatabaseSecrets(path, sourceKey, targetKey); err != nil {
		t.Fatal(err)
	}
	conn, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var rotated string
	if err := conn.QueryRow("SELECT secret_enc FROM issuer_credentials WHERE issuer_id='issuer-1'").Scan(&rotated); err != nil {
		t.Fatal(err)
	}
	plain, err := crypto.DecryptSecret(rotated, targetKey)
	if err != nil || plain != "sensitive-credential" {
		t.Fatalf("re-encrypted credential unreadable: %v", err)
	}
	if _, err := crypto.DecryptSecret(rotated, sourceKey); err == nil {
		t.Fatal("credential still decrypts with source key")
	}
}
