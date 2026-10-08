package services

import (
	"database/sql"
	"errors"
	"strings"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
	"raseen/internal/zatca"
)

// Keep locally editable documents and their successors in the same transaction.
// Local signatures can be refreshed; production signatures remain immutable.
func (s *InvoiceService) rebuildInvoiceChainTx(tx *sql.Tx, issuerID string) error {
	rows, err := tx.Query(`SELECT i.id, i.zatca_phase, i.signature_mode, i.previous_invoice_hash, i.invoice_hash,
		i.seller_name, i.seller_tax_number, i.issue_datetime, i.grand_total, i.tax_amount,
		COALESCE(d.xml, '') FROM invoices i LEFT JOIN invoice_documents d ON d.invoice_id=i.id
		WHERE i.issuer_id=? ORDER BY i.sequence_no, i.rowid`, issuerID)
	if err != nil {
		return err
	}
	type document struct {
		id, phase, mode, previous, hash, seller, taxNumber, timestamp, xml string
		total, tax                                                         int64
	}
	var docs []document
	for rows.Next() {
		var d document
		if err = rows.Scan(&d.id, &d.phase, &d.mode, &d.previous, &d.hash, &d.seller, &d.taxNumber, &d.timestamp, &d.total, &d.tax, &d.xml); err != nil {
			rows.Close()
			return err
		}
		docs = append(docs, d)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	previous := zatca.GenesisPIH
	for _, d := range docs {
		if d.previous != previous {
			if d.mode != "LOCAL" && d.mode != "NONE" {
				return errors.New("التعديل يغيّر سلسلة مستند بتوقيع إنتاجي؛ لا يمكن إعادة كتابته")
			}
			marker := "<cbc:ID>PIH</cbc:ID>"
			start := strings.Index(d.xml, marker)
			if start < 0 {
				return errors.New("مستند الفاتورة المحفوظ لا يحتوي على مرجع سلسلة صالح")
			}
			end := strings.Index(d.xml[start:], "</cac:AdditionalDocumentReference>")
			if end < 0 {
				return errors.New("مرجع سلسلة الفاتورة غير مكتمل")
			}
			end += start
			ref := d.xml[start:end]
			old := ">" + d.previous + "</cbc:EmbeddedDocumentBinaryObject>"
			if !strings.Contains(ref, old) {
				return errors.New("مرجع البصمة في المستند لا يطابق الفاتورة")
			}
			d.xml = d.xml[:start] + strings.Replace(ref, old, ">"+previous+"</cbc:EmbeddedDocumentBinaryObject>", 1) + d.xml[end:]
			d.hash = zatca.InvoiceHash(d.xml)
			params := zatca.QrParams{SellerName: d.seller, VatNumber: d.taxNumber,
				Timestamp: d.timestamp, Total: models.FmtMoney(d.total), VatTotal: models.FmtMoney(d.tax), InvoiceHash: d.hash}
			params.Signature = ""
			if d.phase == "PHASE2" {
				params.Signature, params.PublicKey, err = s.signInvoiceHashTx(tx, issuerID, d.hash)
				if err != nil {
					return err
				}
				d.mode = "LOCAL"
			}
			qr := zatca.BuildQrPayload(params)
			if _, err = tx.Exec("UPDATE invoices SET previous_invoice_hash=?,invoice_hash=?,qr_payload=?,signature=?,signature_mode=?,updated_at=? WHERE id=?", previous, d.hash, qr, params.Signature, d.mode, db.NowIso(), d.id); err != nil {
				return err
			}
			if _, err = tx.Exec("UPDATE invoice_documents SET xml=? WHERE invoice_id=?", d.xml, d.id); err != nil {
				return err
			}
			if _, err = tx.Exec("UPDATE document_pdfs SET revision=revision+1,status='PENDING',error='',updated_at=? WHERE kind='invoice' AND document_id=?", db.NowIso(), d.id); err != nil {
				return err
			}
		}
		previous = d.hash
	}
	return nil
}

func (s *InvoiceService) signInvoiceHashTx(tx *sql.Tx, issuerID, hash string) (signature, publicKey string, err error) {
	var encrypted string
	err = tx.QueryRow("SELECT COALESCE(private_key_enc,''),COALESCE(public_key_der,'') FROM issuer_credentials WHERE issuer_id=?", issuerID).Scan(&encrypted, &publicKey)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", "", err
	}
	var privateKey string
	if encrypted == "" && publicKey == "" {
		keys, keyErr := zatca.GenerateKeyPair()
		if keyErr != nil {
			return "", "", keyErr
		}
		privateKey, publicKey = keys.PrivateKeyPem, keys.PublicKeyDerBase64
		encrypted, err = crypto.EncryptSecret(privateKey, s.masterKey)
		if err != nil {
			return "", "", err
		}
		_, err = tx.Exec(`INSERT INTO issuer_credentials(issuer_id,private_key_enc,public_key_der,updated_at)
			VALUES(?,?,?,?) ON CONFLICT(issuer_id) DO UPDATE SET private_key_enc=excluded.private_key_enc,
			public_key_der=excluded.public_key_der,updated_at=excluded.updated_at`, issuerID, encrypted, publicKey, db.NowIso())
		if err != nil {
			return "", "", err
		}
	} else {
		if encrypted == "" || publicKey == "" {
			return "", "", errors.New("بيانات مفتاح توقيع المنشأة غير مكتملة")
		}
		privateKey, err = crypto.DecryptSecret(encrypted, s.masterKey)
		if err != nil {
			return "", "", err
		}
	}
	signature, err = zatca.SignHash(privateKey, hash)
	return signature, publicKey, err
}
