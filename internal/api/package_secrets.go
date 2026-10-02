package api

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"path"
	"strings"

	_ "modernc.org/sqlite"
	"raseen/internal/crypto"
)

// packageMasterKey returns the optional key from a package. Legacy packages
// without a key can still be imported if their secrets use the current key.
func packageMasterKey(files []*zip.File) ([]byte, error) {
	var keyFile *zip.File
	for _, f := range files {
		name := strings.TrimPrefix(path.Clean(strings.ReplaceAll(f.Name, "\\", "/")), "./")
		if name != "secret.key" && name != "data/secret.key" {
			continue
		}
		if keyFile != nil {
			return nil, fmt.Errorf("تحتوي الحزمة على أكثر من ملف مفتاح")
		}
		keyFile = f
	}
	if keyFile == nil {
		return nil, nil
	}
	if keyFile.UncompressedSize64 > 256 {
		return nil, fmt.Errorf("ملف مفتاح الحزمة غير صالح")
	}
	rc, err := keyFile.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	encoded, err := io.ReadAll(io.LimitReader(rc, 257))
	if err != nil || len(encoded) > 256 {
		return nil, fmt.Errorf("تعذر قراءة مفتاح الحزمة")
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encoded)))
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("ملف مفتاح الحزمة غير صالح")
	}
	return key, nil
}

// prepareImportedDatabaseSecrets validates every encrypted issuer credential
// before the live database is touched and re-encrypts it for this installation.
func prepareImportedDatabaseSecrets(dbPath string, sourceKey, currentKey []byte) error {
	if len(sourceKey) != 32 || len(currentKey) != 32 {
		return fmt.Errorf("مفتاح تشفير بيانات الاعتماد غير صالح")
	}
	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer conn.Close()
	var journalMode string
	if err := conn.QueryRow("PRAGMA journal_mode=DELETE").Scan(&journalMode); err != nil || !strings.EqualFold(journalMode, "delete") {
		return fmt.Errorf("تعذر تجهيز قاعدة البيانات المستوردة للفحص: %v", err)
	}
	var tableCount int
	if err := conn.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='issuer_credentials'").Scan(&tableCount); err != nil {
		return err
	}
	if tableCount == 0 {
		return nil
	}
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT issuer_id, compliance_csid_enc, production_csid_enc,
		secret_enc, private_key_enc, certificate_enc FROM issuer_credentials`)
	if err != nil {
		return err
	}
	type update struct {
		issuerID string
		values   [5]sql.NullString
	}
	var updates []update
	for rows.Next() {
		var row update
		if err := rows.Scan(&row.issuerID, &row.values[0], &row.values[1], &row.values[2], &row.values[3], &row.values[4]); err != nil {
			rows.Close()
			return err
		}
		for i, value := range row.values {
			if !value.Valid || value.String == "" {
				continue
			}
			plain, err := crypto.DecryptSecret(value.String, sourceKey)
			if err != nil {
				rows.Close()
				return fmt.Errorf("تعذر فك بيانات الاعتماد المستوردة؛ مفتاح الحزمة مفقود أو غير مطابق: %w", err)
			}
			if !bytes.Equal(sourceKey, currentKey) {
				encrypted, err := crypto.EncryptSecret(plain, currentKey)
				if err != nil {
					rows.Close()
					return err
				}
				row.values[i] = sql.NullString{String: encrypted, Valid: true}
			}
		}
		if !bytes.Equal(sourceKey, currentKey) {
			updates = append(updates, row)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, row := range updates {
		_, err := tx.Exec(`UPDATE issuer_credentials SET compliance_csid_enc=?, production_csid_enc=?,
			secret_enc=?, private_key_enc=?, certificate_enc=? WHERE issuer_id=?`,
			row.values[0], row.values[1], row.values[2], row.values[3], row.values[4], row.issuerID)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
