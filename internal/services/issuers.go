package services

import (
	"database/sql"
	"errors"
	"fmt"

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
	return getIssuer(s.db,id)
}

func getIssuer(q interface { QueryRow(string, ...any) *sql.Row }, id string) (*models.Issuer, error) {
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
