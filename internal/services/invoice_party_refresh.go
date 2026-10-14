package services

import (
	"database/sql"
	"errors"
	"raseen/internal/db"
	"raseen/internal/models"
	"raseen/internal/zatca"
	"strings"
)

// RefreshPartyInvoicesTx changes party details without recalculating any monetary values.
func (s *InvoiceService) RefreshPartyInvoicesTx(tx *sql.Tx, id string, issuer *models.Issuer, client *models.Client) error {
	column, partyTag := "issuer_id", "AccountingSupplierParty"
	var party zatca.UblPartyInfo
	if issuer != nil {
		issuer.ID = id
		party = zatca.UblPartyInfo{Name: issuer.NameAr, TaxNumber: issuer.TaxNumber, CommercialRegister: issuer.CommercialRegister, Street: issuer.Street, BuildingNo: issuer.BuildingNo, District: issuer.District, City: issuer.City, PostalCode: issuer.PostalCode, Country: issuer.Country}
	} else {
		column, partyTag = "client_id", "AccountingCustomerParty"
		client.ID = id
		party = zatca.UblPartyInfo{Name: client.Name, TaxNumber: client.TaxNumber, CommercialRegister: client.CommercialRegister, Street: client.Street, BuildingNo: client.BuildingNo, District: client.District, City: client.City, PostalCode: client.PostalCode, Country: client.Country}
	}
	sample := zatca.BuildUblXml(zatca.UblInvoiceInfo{}, party, party, nil, zatca.UblChainInfo{})
	open, close := "<cac:"+partyTag+">", "</cac:"+partyTag+">"
	extract := func(xml string) (string, error) {
		start := strings.Index(xml, open)
		end := strings.Index(xml, close)
		if start < 0 || end < start {
			return "", errors.New("بيانات طرف الفاتورة في XML غير مكتملة")
		}
		return xml[start : end+len(close)], nil
	}
	replacement, err := extract(sample)
	if err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT i.id,i.issuer_id,i.signature_mode,i.zatca_phase,i.seller_name,i.seller_tax_number,i.issue_datetime,i.grand_total,i.tax_amount,COALESCE(d.xml,'') FROM invoices i LEFT JOIN invoice_documents d ON d.invoice_id=i.id WHERE i.`+column+`=? ORDER BY i.sequence_no,i.rowid`, id)
	if err != nil {
		return err
	}
	type document struct {
		id, issuer, mode, phase, seller, taxNumber, timestamp, xml string
		total, tax                                                 int64
	}
	var docs []document
	for rows.Next() {
		var d document
		if err = rows.Scan(&d.id, &d.issuer, &d.mode, &d.phase, &d.seller, &d.taxNumber, &d.timestamp, &d.total, &d.tax, &d.xml); err != nil {
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
	chains := map[string]bool{}
	for _, d := range docs {
		if d.mode != "NONE" && d.mode != "LOCAL" {
			return errors.New("توجد فواتير بتوقيع إنتاجي؛ لا يمكن إعادة كتابة بياناتها")
		}
		old, err := extract(d.xml)
		if err != nil {
			return err
		}
		d.xml = strings.Replace(d.xml, old, replacement, 1)
		if issuer != nil {
			address := formatNationalAddress(issuer.City, issuer.District, issuer.Street, issuer.BuildingNo, issuer.PostalCode)
			addressEn := issuer.AddressEn
			if addressEn == "" {
				addressEn = formatNationalAddressEn(issuer.CityEn, issuer.DistrictEn, issuer.StreetEn, issuer.BuildingNo, issuer.PostalCode)
			}
			_, err = tx.Exec(`UPDATE invoices SET seller_name=?,seller_tax_number=?,seller_cr=?,seller_address=?,seller_address_en=? WHERE id=?`, issuer.NameAr, issuer.TaxNumber, issuer.CommercialRegister, address, addressEn, d.id)
			if err == nil {
				_, err = tx.Exec(`UPDATE invoice_documents SET issuer_json=? WHERE invoice_id=?`, mustJSON(issuer), d.id)
			}
			d.seller, d.taxNumber = issuer.NameAr, issuer.TaxNumber
		} else {
			_, err = tx.Exec(`UPDATE invoices SET buyer_name=?,buyer_tax_number=?,buyer_cr=?,buyer_address=? WHERE id=?`, client.Name, client.TaxNumber, client.CommercialRegister, invoiceBuyerAddress(*client), d.id)
			if err == nil {
				_, err = tx.Exec(`UPDATE invoice_documents SET client_json=? WHERE invoice_id=?`, mustJSON(client), d.id)
			}
		}
		if err != nil {
			return err
		}
		hash := zatca.InvoiceHash(d.xml)
		params := zatca.QrParams{SellerName: d.seller, VatNumber: d.taxNumber, Timestamp: d.timestamp, Total: models.FmtMoney(d.total), VatTotal: models.FmtMoney(d.tax), InvoiceHash: hash}
		if d.phase == "PHASE2" {
			params.Signature, params.PublicKey, err = s.signInvoiceHashTx(tx, d.issuer, hash)
			if err != nil {
				return err
			}
		}
		if _, err = tx.Exec(`UPDATE invoices SET invoice_hash=?,qr_payload=?,signature=?,updated_at=? WHERE id=?`, hash, zatca.BuildQrPayload(params), params.Signature, db.NowIso(), d.id); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE invoice_documents SET xml=? WHERE invoice_id=?`, d.xml, d.id); err != nil {
			return err
		}
		chains[d.issuer] = true
	}
	for chain := range chains {
		if err = s.rebuildInvoiceChainTx(tx, chain); err != nil {
			return err
		}
	}
	for _, kind := range []struct{ name, table string }{{"invoice", "invoices"}, {"voucher", "receipt_vouchers"}} {
		_, err = tx.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at) SELECT ?,id,issuer_id,? FROM `+kind.table+` WHERE `+column+`=? ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,status='PENDING',error='',updated_at=excluded.updated_at`, kind.name, db.NowIso(), id)
		if err != nil {
			return err
		}
	}
	return nil
}
