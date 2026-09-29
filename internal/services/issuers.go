package services

import (
	"crypto/x509"
	"database/sql"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
	"raseen/internal/zatca"
)

type IssuerService struct {
	db *db.DB
}

func NewIssuerService(d *db.DB) *IssuerService {
	return &IssuerService{db: d}
}

func (s *IssuerService) ListIssuers(activeOnly bool) ([]models.Issuer, error) {
	query := `
		SELECT id, code, name_ar, name_en, tax_number, commercial_register,
		       street, street_en, building_no, district, district_en, city, city_en,
		       address_en, postal_code, country, phone, email, website, logo_data,
		       default_tax_rate, currency, invoice_prefix, invoice_next_no, invoice_pad,
		       voucher_prefix, voucher_next_no, zatca_phase, qr_settings, print_settings,
		       bank_name, bank_iban, footer_notes, legal_terms, is_active, created_at, updated_at
		FROM issuers
	`
	if activeOnly {
		query += " WHERE is_active = 1"
	}
	query += " ORDER BY name_ar ASC"

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]models.Issuer, 0)
	for rows.Next() {
		var iss models.Issuer
		var logo sql.NullString
		if err := rows.Scan(
			&iss.ID, &iss.Code, &iss.NameAr, &iss.NameEn, &iss.TaxNumber, &iss.CommercialRegister,
			&iss.Street, &iss.StreetEn, &iss.BuildingNo, &iss.District, &iss.DistrictEn, &iss.City, &iss.CityEn,
			&iss.AddressEn, &iss.PostalCode, &iss.Country, &iss.Phone, &iss.Email, &iss.Website, &logo,
			&iss.DefaultTaxRate, &iss.Currency, &iss.InvoicePrefix, &iss.InvoiceNextNo, &iss.InvoicePad,
			&iss.VoucherPrefix, &iss.VoucherNextNo, &iss.ZatcaPhase, &iss.QrSettings, &iss.PrintSettings,
			&iss.BankName, &iss.BankIban, &iss.FooterNotes, &iss.LegalTerms, &iss.IsActive, &iss.CreatedAt, &iss.UpdatedAt,
		); err == nil {
			if logo.Valid {
				iss.LogoData = &logo.String
			}
			list = append(list, iss)
		}
	}
	return list, nil
}

func (s *IssuerService) GetIssuer(id string) (*models.Issuer, error) {
	return getIssuer(s.db, id)
}

func getIssuer(q interface{ QueryRow(string, ...any) *sql.Row }, id string) (*models.Issuer, error) {
	var iss models.Issuer
	var logo sql.NullString

	err := q.QueryRow(`
		SELECT id, code, name_ar, name_en, tax_number, commercial_register,
		       street, street_en, building_no, district, district_en, city, city_en,
		       address_en, postal_code, country, phone, email, website, logo_data,
		       default_tax_rate, currency, invoice_prefix, invoice_next_no, invoice_pad,
		       voucher_prefix, voucher_next_no, zatca_phase, qr_settings, print_settings,
		       bank_name, bank_iban, footer_notes, legal_terms, is_active, created_at, updated_at
		FROM issuers WHERE id = ?
	`, id).Scan(
		&iss.ID, &iss.Code, &iss.NameAr, &iss.NameEn, &iss.TaxNumber, &iss.CommercialRegister,
		&iss.Street, &iss.StreetEn, &iss.BuildingNo, &iss.District, &iss.DistrictEn, &iss.City, &iss.CityEn,
		&iss.AddressEn, &iss.PostalCode, &iss.Country, &iss.Phone, &iss.Email, &iss.Website, &logo,
		&iss.DefaultTaxRate, &iss.Currency, &iss.InvoicePrefix, &iss.InvoiceNextNo, &iss.InvoicePad,
		&iss.VoucherPrefix, &iss.VoucherNextNo, &iss.ZatcaPhase, &iss.QrSettings, &iss.PrintSettings,
		&iss.BankName, &iss.BankIban, &iss.FooterNotes, &iss.LegalTerms, &iss.IsActive, &iss.CreatedAt, &iss.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if logo.Valid {
		iss.LogoData = &logo.String
	}
	return &iss, nil
}

func (s *IssuerService) CreateIssuer(iss *models.Issuer) error {
	if iss.NameAr == "" {
		return errors.New("اسم المنشأة بالعربية مطلوب")
	}
	if iss.ID == "" {
		iss.ID = crypto.UUID()
	}
	if iss.Code == "" {
		var nextNum int
		_ = s.db.QueryRow("SELECT COUNT(*) + 1 FROM issuers").Scan(&nextNum)
		iss.Code = fmt.Sprintf("ISS-%03d", nextNum)
	}
	if iss.InvoicePrefix == "" {
		iss.InvoicePrefix = "INV"
	}
	if iss.InvoiceNextNo <= 0 {
		iss.InvoiceNextNo = 1
	}
	if iss.InvoicePad <= 0 {
		iss.InvoicePad = 5
	}
	if iss.VoucherPrefix == "" {
		iss.VoucherPrefix = "RV"
	}
	if iss.VoucherNextNo <= 0 {
		iss.VoucherNextNo = 1
	}
	if iss.DefaultTaxRate <= 0 {
		iss.DefaultTaxRate = 15.0
	}
	if iss.Currency == "" {
		iss.Currency = "SAR"
	}
	if iss.Country == "" {
		iss.Country = "SA"
	}
	if iss.ZatcaPhase == "" {
		iss.ZatcaPhase = "PHASE1"
	}
	if iss.QrSettings == "" {
		iss.QrSettings = "{}"
	}
	if iss.PrintSettings == "" {
		iss.PrintSettings = "{}"
	}

	now := db.NowIso()
	iss.CreatedAt = now
	iss.UpdatedAt = now
	iss.IsActive = 1

	_, err := s.db.Exec(`
		INSERT INTO issuers (
			id, code, name_ar, name_en, tax_number, commercial_register,
			street, street_en, building_no, district, district_en, city, city_en,
			address_en, postal_code, country, phone, email, website, logo_data,
			default_tax_rate, currency, invoice_prefix, invoice_next_no, invoice_pad,
			voucher_prefix, voucher_next_no, zatca_phase, qr_settings, print_settings,
			bank_name, bank_iban, footer_notes, legal_terms, is_active, created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?, ?
		)
	`,
		iss.ID, iss.Code, iss.NameAr, iss.NameEn, iss.TaxNumber, iss.CommercialRegister,
		iss.Street, iss.StreetEn, iss.BuildingNo, iss.District, iss.DistrictEn, iss.City, iss.CityEn,
		iss.AddressEn, iss.PostalCode, iss.Country, iss.Phone, iss.Email, iss.Website, iss.LogoData,
		iss.DefaultTaxRate, iss.Currency, iss.InvoicePrefix, iss.InvoiceNextNo, iss.InvoicePad,
		iss.VoucherPrefix, iss.VoucherNextNo, iss.ZatcaPhase, string(iss.QrSettings), string(iss.PrintSettings),
		iss.BankName, iss.BankIban, iss.FooterNotes, iss.LegalTerms, iss.IsActive, iss.CreatedAt, iss.UpdatedAt,
	)
	return err
}

func (s *IssuerService) UpdateIssuer(id string, iss *models.Issuer) error {
	now := db.NowIso()
	iss.UpdatedAt = now

	qrJSON := string(iss.QrSettings)
	if qrJSON == "" {
		qrJSON = "{}"
	}
	printJSON := string(iss.PrintSettings)
	if printJSON == "" {
		printJSON = "{}"
	}

	_, err := s.db.Exec(`
		UPDATE issuers SET
			name_ar = ?, name_en = ?, tax_number = ?, commercial_register = ?,
			street = ?, street_en = ?, building_no = ?, district = ?, district_en = ?,
			city = ?, city_en = ?, address_en = ?, postal_code = ?, country = ?,
			phone = ?, email = ?, website = ?, logo_data = ?, default_tax_rate = ?,
			currency = ?, invoice_prefix = ?, invoice_pad = ?, voucher_prefix = ?,
			zatca_phase = ?, qr_settings = ?, print_settings = ?, bank_name = ?,
			bank_iban = ?, footer_notes = ?, legal_terms = ?, is_active = ?, updated_at = ?
		WHERE id = ?
	`,
		iss.NameAr, iss.NameEn, iss.TaxNumber, iss.CommercialRegister,
		iss.Street, iss.StreetEn, iss.BuildingNo, iss.District, iss.DistrictEn,
		iss.City, iss.CityEn, iss.AddressEn, iss.PostalCode, iss.Country,
		iss.Phone, iss.Email, iss.Website, iss.LogoData, iss.DefaultTaxRate,
		iss.Currency, iss.InvoicePrefix, iss.InvoicePad, iss.VoucherPrefix,
		iss.ZatcaPhase, qrJSON, printJSON, iss.BankName,
		iss.BankIban, iss.FooterNotes, iss.LegalTerms, iss.IsActive, now, id,
	)
	return err
}

func (s *IssuerService) DeleteIssuer(id string) error {
	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM invoices WHERE issuer_id = ?", id).Scan(&count)
	if count > 0 {
		return errors.New("لا يمكن حذف المنشأة لوجود فواتير مرتبطة بها")
	}
	_, err := s.db.Exec("DELETE FROM issuers WHERE id = ?", id)
	return err
}

// NextInvoiceNumber atomically increments invoice_next_no and formats the invoice number.
func (s *IssuerService) NextInvoiceNumber(tx *sql.Tx, issuerID string) (number string, seq int64, err error) {
	var prefix string
	var nextNo int64
	var pad int

	row := tx.QueryRow(`
		SELECT invoice_prefix, invoice_next_no, invoice_pad
		FROM issuers WHERE id = ?
	`, issuerID)
	if err := row.Scan(&prefix, &nextNo, &pad); err != nil {
		return "", 0, err
	}

	_, err = tx.Exec(`
		UPDATE issuers SET invoice_next_no = invoice_next_no + 1 WHERE id = ?
	`, issuerID)
	if err != nil {
		return "", 0, err
	}

	number = crypto.FormatSerial(prefix, nextNo, pad)
	return number, nextNo, nil
}

// NextVoucherNumber atomically increments voucher_next_no and formats the receipt voucher number.
func (s *IssuerService) NextVoucherNumber(tx *sql.Tx, issuerID string) (number string, nextNo int64, err error) {
	var prefix string
	var pad int = 5

	row := tx.QueryRow(`
		SELECT voucher_prefix, voucher_next_no
		FROM issuers WHERE id = ?
	`, issuerID)
	if err := row.Scan(&prefix, &nextNo); err != nil {
		return "", 0, err
	}

	_, err = tx.Exec(`
		UPDATE issuers SET voucher_next_no = voucher_next_no + 1 WHERE id = ?
	`, issuerID)
	if err != nil {
		return "", 0, err
	}

	number = crypto.FormatSerial(prefix, nextNo, pad)
	return number, nextNo, nil
}

func (s *IssuerService) GenerateKeys(issuerID string, masterKey []byte) (*zatca.KeyPair, error) {
	kp, err := zatca.GenerateKeyPair()
	if err != nil {
		return nil, err
	}

	privEnc, err := crypto.EncryptSecret(kp.PrivateKeyPem, masterKey)
	if err != nil {
		return nil, err
	}

	now := db.NowIso()
	_, err = s.db.Exec(`
		INSERT INTO issuer_credentials (issuer_id, private_key_enc, public_key_der, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(issuer_id) DO UPDATE SET
			private_key_enc = excluded.private_key_enc,
			public_key_der = excluded.public_key_der,
			updated_at = excluded.updated_at
	`, issuerID, privEnc, kp.PublicKeyDerBase64, now)
	if err != nil {
		return nil, err
	}

	return kp, nil
}

type CertificateInfo struct {
	Subject string `json:"subject"`
	Issuer  string `json:"issuer"`
	ValidTo string `json:"valid_to"`
}

type IssuerCredentialsView struct {
	HasPrivateKey        bool             `json:"has_private_key"`
	HasCertificate       bool             `json:"has_certificate"`
	HasComplianceCsid    bool             `json:"has_compliance_csid"`
	ComplianceCsidMasked string           `json:"compliance_csid_masked"`
	HasProductionCsid    bool             `json:"has_production_csid"`
	ProductionCsidMasked string           `json:"production_csid_masked"`
	UpdatedAt            string           `json:"updated_at"`
	CertificateInfo      *CertificateInfo `json:"certificate_info,omitempty"`
}

type UpdateCredentialsInput struct {
	ComplianceCsid string `json:"compliance_csid"`
	ProductionCsid string `json:"production_csid"`
	Secret         string `json:"secret"`
	CertificatePem string `json:"certificate_pem"`
}

func maskSecret(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) <= 8 {
		return "****"
	}
	return "****" + s[len(s)-4:]
}

func (s *IssuerService) GetCredentials(issuerID string, masterKey []byte) (*IssuerCredentialsView, error) {
	row := s.db.QueryRow(`
		SELECT COALESCE(compliance_csid_enc, ''),
		       COALESCE(production_csid_enc, ''),
		       COALESCE(private_key_enc, ''),
		       COALESCE(certificate_enc, ''),
		       COALESCE(updated_at, '')
		FROM issuer_credentials WHERE issuer_id = ?
	`, issuerID)

	var compEnc, prodEnc, privEnc, certEnc, updatedAt string
	err := row.Scan(&compEnc, &prodEnc, &privEnc, &certEnc, &updatedAt)
	if err == sql.ErrNoRows {
		return &IssuerCredentialsView{}, nil
	}
	if err != nil {
		return nil, err
	}

	view := &IssuerCredentialsView{
		HasPrivateKey:  privEnc != "",
		HasCertificate: certEnc != "",
		UpdatedAt:      updatedAt,
	}

	if compEnc != "" {
		if plain, err := crypto.DecryptSecret(compEnc, masterKey); err == nil && plain != "" {
			view.HasComplianceCsid = true
			view.ComplianceCsidMasked = maskSecret(plain)
		}
	}

	if prodEnc != "" {
		if plain, err := crypto.DecryptSecret(prodEnc, masterKey); err == nil && plain != "" {
			view.HasProductionCsid = true
			view.ProductionCsidMasked = maskSecret(plain)
		}
	}

	if certEnc != "" {
		if plainCert, err := crypto.DecryptSecret(certEnc, masterKey); err == nil && plainCert != "" {
			block, _ := pem.Decode([]byte(plainCert))
			if block != nil {
				if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
					subj := cert.Subject.CommonName
					if subj == "" {
						subj = cert.Subject.String()
					}
					iss := cert.Issuer.CommonName
					if iss == "" {
						iss = cert.Issuer.String()
					}
					view.CertificateInfo = &CertificateInfo{
						Subject: subj,
						Issuer:  iss,
						ValidTo: cert.NotAfter.Format("2006-01-02 15:04:05"),
					}
				}
			}
		}
	}

	return view, nil
}

func (s *IssuerService) UpdateCredentials(issuerID string, input UpdateCredentialsInput, masterKey []byte) error {
	now := db.NowIso()

	// Ensure row exists
	_, err := s.db.Exec(`
		INSERT INTO issuer_credentials (issuer_id, updated_at)
		VALUES (?, ?)
		ON CONFLICT(issuer_id) DO NOTHING
	`, issuerID, now)
	if err != nil {
		return err
	}

	if input.ComplianceCsid != "" {
		enc, err := crypto.EncryptSecret(input.ComplianceCsid, masterKey)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec("UPDATE issuer_credentials SET compliance_csid_enc = ?, updated_at = ? WHERE issuer_id = ?", enc, now, issuerID); err != nil {
			return err
		}
	}

	if input.ProductionCsid != "" {
		enc, err := crypto.EncryptSecret(input.ProductionCsid, masterKey)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec("UPDATE issuer_credentials SET production_csid_enc = ?, updated_at = ? WHERE issuer_id = ?", enc, now, issuerID); err != nil {
			return err
		}
	}

	if input.Secret != "" {
		enc, err := crypto.EncryptSecret(input.Secret, masterKey)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec("UPDATE issuer_credentials SET secret_enc = ?, updated_at = ? WHERE issuer_id = ?", enc, now, issuerID); err != nil {
			return err
		}
	}

	if input.CertificatePem != "" {
		enc, err := crypto.EncryptSecret(input.CertificatePem, masterKey)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec("UPDATE issuer_credentials SET certificate_enc = ?, updated_at = ? WHERE issuer_id = ?", enc, now, issuerID); err != nil {
			return err
		}
	}

	return nil
}

type ImportIssuerInput struct {
	Code               string  `json:"code"`
	NameAr             string  `json:"name_ar"`
	NameEn             string  `json:"name_en"`
	TaxNumber          string  `json:"tax_number"`
	CommercialRegister string  `json:"commercial_register"`
	City               string  `json:"city"`
	District           string  `json:"district"`
	Street             string  `json:"street"`
	BuildingNo         string  `json:"building_no"`
	PostalCode         string  `json:"postal_code"`
	Phone              string  `json:"phone"`
	Email              string  `json:"email"`
	Website            string  `json:"website"`
	DefaultTaxRate     float64 `json:"default_tax_rate"`
	InvoicePrefix      string  `json:"invoice_prefix"`
	VoucherPrefix      string  `json:"voucher_prefix"`
}

type ImportIssuersResult struct {
	Total   int `json:"total"`
	Created int `json:"created"`
	Updated int `json:"updated"`
	Errors  int `json:"errors"`
}

func (s *IssuerService) BatchImportIssuers(issuers []ImportIssuerInput) (*ImportIssuersResult, error) {
	if len(issuers) == 0 {
		return &ImportIssuersResult{}, nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	stmtFindByCode, err := tx.Prepare("SELECT id FROM issuers WHERE code = ? AND code != '' LIMIT 1")
	if err != nil {
		return nil, err
	}
	defer stmtFindByCode.Close()

	stmtFindByTax, err := tx.Prepare("SELECT id FROM issuers WHERE tax_number = ? AND tax_number != '' LIMIT 1")
	if err != nil {
		return nil, err
	}
	defer stmtFindByTax.Close()

	stmtFindByName, err := tx.Prepare("SELECT id FROM issuers WHERE LOWER(TRIM(name_ar)) = LOWER(TRIM(?)) LIMIT 1")
	if err != nil {
		return nil, err
	}
	defer stmtFindByName.Close()

	stmtInsert, err := tx.Prepare(`
		INSERT INTO issuers (
			id, code, name_ar, name_en, tax_number, commercial_register,
			street, street_en, building_no, district, district_en, city, city_en,
			address_en, postal_code, country, phone, email, website, logo_data,
			default_tax_rate, currency, invoice_prefix, invoice_next_no, invoice_pad,
			voucher_prefix, voucher_next_no, zatca_phase, qr_settings, print_settings,
			bank_name, bank_iban, footer_notes, legal_terms, is_active, created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?,
			?, '', ?, ?, '', ?, '',
			'', ?, 'SA', ?, ?, ?, NULL,
			?, 'SAR', ?, 1, 5,
			?, 1, 'PHASE1', '{}', '{}',
			'', '', '', '', 1, ?, ?
		)
	`)
	if err != nil {
		return nil, err
	}
	defer stmtInsert.Close()

	stmtUpdate, err := tx.Prepare(`
		UPDATE issuers SET
			name_ar = CASE WHEN ? != '' THEN ? ELSE name_ar END,
			name_en = CASE WHEN ? != '' THEN ? ELSE name_en END,
			tax_number = CASE WHEN ? != '' THEN ? ELSE tax_number END,
			commercial_register = CASE WHEN ? != '' THEN ? ELSE commercial_register END,
			city = CASE WHEN ? != '' THEN ? ELSE city END,
			district = CASE WHEN ? != '' THEN ? ELSE district END,
			street = CASE WHEN ? != '' THEN ? ELSE street END,
			building_no = CASE WHEN ? != '' THEN ? ELSE building_no END,
			postal_code = CASE WHEN ? != '' THEN ? ELSE postal_code END,
			phone = CASE WHEN ? != '' THEN ? ELSE phone END,
			email = CASE WHEN ? != '' THEN ? ELSE email END,
			website = CASE WHEN ? != '' THEN ? ELSE website END,
			default_tax_rate = CASE WHEN ? > 0 THEN ? ELSE default_tax_rate END,
			invoice_prefix = CASE WHEN ? != '' THEN ? ELSE invoice_prefix END,
			voucher_prefix = CASE WHEN ? != '' THEN ? ELSE voucher_prefix END,
			updated_at = ?
		WHERE id = ?
	`)
	if err != nil {
		return nil, err
	}
	defer stmtUpdate.Close()

	now := db.NowIso()
	res := &ImportIssuersResult{Total: len(issuers)}

	for idx, iss := range issuers {
		nameAr := strings.TrimSpace(iss.NameAr)
		if nameAr == "" {
			res.Errors++
			continue
		}

		taxRate := iss.DefaultTaxRate
		if taxRate <= 0 {
			taxRate = 15.0
		}
		invPrefix := strings.TrimSpace(iss.InvoicePrefix)
		if invPrefix == "" {
			invPrefix = "INV"
		}
		vouchPrefix := strings.TrimSpace(iss.VoucherPrefix)
		if vouchPrefix == "" {
			vouchPrefix = "RV"
		}

		var existingID string
		if iss.Code != "" {
			_ = stmtFindByCode.QueryRow(strings.TrimSpace(iss.Code)).Scan(&existingID)
		}
		if existingID == "" && iss.TaxNumber != "" {
			_ = stmtFindByTax.QueryRow(strings.TrimSpace(iss.TaxNumber)).Scan(&existingID)
		}
		if existingID == "" {
			_ = stmtFindByName.QueryRow(nameAr).Scan(&existingID)
		}

		if existingID != "" {
			_, err := stmtUpdate.Exec(
				nameAr, nameAr,
				strings.TrimSpace(iss.NameEn), strings.TrimSpace(iss.NameEn),
				strings.TrimSpace(iss.TaxNumber), strings.TrimSpace(iss.TaxNumber),
				strings.TrimSpace(iss.CommercialRegister), strings.TrimSpace(iss.CommercialRegister),
				strings.TrimSpace(iss.City), strings.TrimSpace(iss.City),
				strings.TrimSpace(iss.District), strings.TrimSpace(iss.District),
				strings.TrimSpace(iss.Street), strings.TrimSpace(iss.Street),
				strings.TrimSpace(iss.BuildingNo), strings.TrimSpace(iss.BuildingNo),
				strings.TrimSpace(iss.PostalCode), strings.TrimSpace(iss.PostalCode),
				strings.TrimSpace(iss.Phone), strings.TrimSpace(iss.Phone),
				strings.TrimSpace(iss.Email), strings.TrimSpace(iss.Email),
				strings.TrimSpace(iss.Website), strings.TrimSpace(iss.Website),
				iss.DefaultTaxRate, iss.DefaultTaxRate,
				invPrefix, invPrefix,
				vouchPrefix, vouchPrefix,
				now, existingID,
			)
			if err != nil {
				res.Errors++
			} else {
				res.Updated++
			}
		} else {
			code := strings.TrimSpace(iss.Code)
			if code == "" {
				var count int
				_ = tx.QueryRow("SELECT COUNT(*) FROM issuers").Scan(&count)
				code = fmt.Sprintf("ISS-%03d", count+idx+1)
			}
			newID := crypto.UUID()
			_, err := stmtInsert.Exec(
				newID, code, nameAr, strings.TrimSpace(iss.NameEn),
				strings.TrimSpace(iss.TaxNumber), strings.TrimSpace(iss.CommercialRegister),
				strings.TrimSpace(iss.Street), strings.TrimSpace(iss.BuildingNo),
				strings.TrimSpace(iss.District), strings.TrimSpace(iss.City),
				strings.TrimSpace(iss.PostalCode), strings.TrimSpace(iss.Phone),
				strings.TrimSpace(iss.Email), strings.TrimSpace(iss.Website),
				taxRate, invPrefix, vouchPrefix, now, now,
			)
			if err != nil {
				res.Errors++
			} else {
				res.Created++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return res, nil
}
