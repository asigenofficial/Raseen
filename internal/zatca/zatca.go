package zatca

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/pem"
	"fmt"
	"strings"
)

var GenesisPIH = base64.StdEncoding.EncodeToString(make([]byte, 32))

// TLV encodes a single Tag-Length-Value entry conforming to ZATCA specs.
func TLV(tag byte, val []byte) []byte {
	l := len(val)
	if l <= 255 {
		res := make([]byte, 2+l)
		res[0] = tag
		res[1] = byte(l)
		copy(res[2:], val)
		return res
	}
	// Extended length format (0x82 followed by 2 bytes BigEndian length)
	res := make([]byte, 4+l)
	res[0] = tag
	res[1] = 0x82
	binary.BigEndian.PutUint16(res[2:4], uint16(l))
	copy(res[4:], val)
	return res
}

type QrParams struct {
	SellerName    string
	VatNumber     string
	Timestamp     string
	Total         string
	VatTotal      string
	InvoiceHash   string
	Signature     string
	PublicKey     string
	CertSignature string
}

// BuildQrPayload constructs the TLV payload and returns it as a Base64 string.
func BuildQrPayload(p QrParams) string {
	var buf bytes.Buffer
	buf.Write(TLV(1, []byte(p.SellerName)))
	buf.Write(TLV(2, []byte(p.VatNumber)))
	buf.Write(TLV(3, []byte(p.Timestamp)))
	buf.Write(TLV(4, []byte(p.Total)))
	buf.Write(TLV(5, []byte(p.VatTotal)))

	if p.InvoiceHash != "" {
		buf.Write(TLV(6, []byte(p.InvoiceHash)))
	}
	if p.Signature != "" {
		if sigBytes, err := base64.StdEncoding.DecodeString(p.Signature); err == nil {
			buf.Write(TLV(7, sigBytes))
		}
	}
	if p.PublicKey != "" {
		if pkBytes, err := base64.StdEncoding.DecodeString(p.PublicKey); err == nil {
			buf.Write(TLV(8, pkBytes))
		}
	}
	if p.CertSignature != "" {
		if csBytes, err := base64.StdEncoding.DecodeString(p.CertSignature); err == nil {
			buf.Write(TLV(9, csBytes))
		}
	}

	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

type QrTag struct {
	Tag    byte   `json:"tag"`
	Length int    `json:"length"`
	Text   string `json:"text"`
}

// ParseQrPayload decodes a base64 TLV QR string into parsed tags.
func ParseQrPayload(b64 string) ([]QrTag, error) {
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		return nil, err
	}

	var tags []QrTag
	i := 0
	for i < len(data) {
		tag := data[i]
		if i+1 >= len(data) {
			break
		}
		l := int(data[i+1])
		offset := i + 2
		if l == 0x82 {
			if i+3 >= len(data) {
				break
			}
			l = int(binary.BigEndian.Uint16(data[i+2 : i+4]))
			offset = i + 4
		}
		if offset+l > len(data) {
			break
		}
		val := data[offset : offset+l]
		text := ""
		if tag >= 7 {
			text = base64.StdEncoding.EncodeToString(val)
		} else {
			text = string(val)
		}
		tags = append(tags, QrTag{
			Tag:    tag,
			Length: l,
			Text:   text,
		})
		i = offset + l
	}
	return tags, nil
}

// InvoiceHash computes SHA-256 of XML then base64 encodes it.
func InvoiceHash(xmlStr string) string {
	h := sha256.Sum256([]byte(xmlStr))
	return base64.StdEncoding.EncodeToString(h[:])
}

type KeyPair struct {
	PrivateKeyPem      string
	PublicKeyPem       string
	PublicKeyDerBase64 string
}

// GenerateKeyPair generates a standard ECDSA P-256 (secp256r1) key pair.
func GenerateKeyPair() (*KeyPair, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}

	privBytes, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, err
	}
	privPem := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privBytes})

	pubBytes, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		return nil, err
	}
	pubPem := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})

	return &KeyPair{
		PrivateKeyPem:      string(privPem),
		PublicKeyPem:       string(pubPem),
		PublicKeyDerBase64: base64.StdEncoding.EncodeToString(pubBytes),
	}, nil
}

// SignHash signs the base64 invoice hash using ECDSA and returns ASN.1 DER in base64.
func SignHash(privateKeyPem, hashBase64 string) (string, error) {
	block, _ := pem.Decode([]byte(privateKeyPem))
	if block == nil {
		return "", fmt.Errorf("invalid private key PEM")
	}

	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// try EC private key
		key, err = x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return "", err
		}
	}

	ecKey, ok := key.(*ecdsa.PrivateKey)
	if !ok {
		return "", fmt.Errorf("not an ECDSA private key")
	}

	digest := sha256.Sum256([]byte(hashBase64))
	sig, err := ecdsa.SignASN1(rand.Reader, ecKey, digest[:])
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(sig), nil
}

// VerifyHashSignature verifies the ASN.1 DER signature against hash and public key.
func VerifyHashSignature(publicKeyPem, hashBase64, signatureBase64 string) bool {
	block, _ := pem.Decode([]byte(publicKeyPem))
	if block == nil {
		return false
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return false
	}
	ecPub, ok := pub.(*ecdsa.PublicKey)
	if !ok {
		return false
	}

	sig, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil {
		return false
	}

	digest := sha256.Sum256([]byte(hashBase64))
	return ecdsa.VerifyASN1(ecPub, digest[:], sig)
}

func escXml(s string) string {
	r := strings.ReplaceAll(s, "&", "&amp;")
	r = strings.ReplaceAll(r, "<", "&lt;")
	r = strings.ReplaceAll(r, ">", "&gt;")
	r = strings.ReplaceAll(r, "\"", "&quot;")
	r = strings.ReplaceAll(r, "'", "&apos;")
	return r
}

type UblInvoiceInfo struct {
	InvoiceNumber  string
	UUID           string
	IssueDate      string
	IssueTime      string
	InvoiceType    string
	Subtotal       string
	TaxableAmount  string
	TaxAmount      string
	GrandTotal     string
	DiscountAmount string
	TaxRateDisplay string
}

type UblPartyInfo struct {
	Name               string
	TaxNumber          string
	CommercialRegister string
	Street             string
	BuildingNo         string
	District           string
	City               string
	PostalCode         string
	Country            string
}

type UblLineItem struct {
	Name        string
	Unit        string
	Quantity    string
	UnitPrice   string
	TaxRate     string
	Taxable     string
	TaxAmount   string
	RoundingAmt string
}

type UblChainInfo struct {
	ICV      int64
	PIH      string
	Currency string
}

// BuildUblXml generates standard UBL 2.1 XML format for ZATCA e-invoices.
func BuildUblXml(inv UblInvoiceInfo, issuer UblPartyInfo, client UblPartyInfo, lines []UblLineItem, chain UblChainInfo) string {
	currency := chain.Currency
	if currency == "" {
		currency = "SAR"
	}
	pih := chain.PIH
	if pih == "" {
		pih = GenesisPIH
	}
	icv := chain.ICV
	if icv <= 0 {
		icv = 1
	}

	typeCode := "388"
	typeName := "0100000" // Standard Tax Invoice
	if inv.InvoiceType == "SIMPLIFIED" {
		typeName = "0200000" // Simplified Tax Invoice
	}

	var lineXml strings.Builder
	for idx, l := range lines {
		unit := l.Unit
		if unit == "" {
			unit = "PCE"
		}
		lineXml.WriteString(fmt.Sprintf(`
  <cac:InvoiceLine>
    <cbc:ID>%d</cbc:ID>
    <cbc:InvoicedQuantity unitCode="%s">%s</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="%s">%s</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="%s">%s</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="%s">%s</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>%s</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>%s</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="%s">%s</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`, idx+1, escXml(unit), escXml(l.Quantity), currency, escXml(l.Taxable),
			currency, escXml(l.TaxAmount), currency, escXml(l.RoundingAmt),
			escXml(l.Name), escXml(l.TaxRate), currency, escXml(l.UnitPrice)))
	}

	country := issuer.Country
	if country == "" {
		country = "SA"
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>%s</cbc:ID>
  <cbc:UUID>%s</cbc:UUID>
  <cbc:IssueDate>%s</cbc:IssueDate>
  <cbc:IssueTime>%s</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="%s">%s</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>%s</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>%s</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>%d</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">%s</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">%s</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>%s</cbc:StreetName>
        <cbc:BuildingNumber>%s</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>%s</cbc:CitySubdivisionName>
        <cbc:CityName>%s</cbc:CityName>
        <cbc:PostalZone>%s</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>%s</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>%s</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>%s</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>%s</cbc:StreetName>
        <cbc:CityName>%s</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>%s</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>%s</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="%s">%s</cbc:Amount>
  </cac:AllowanceCharge>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="%s">%s</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="%s">%s</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="%s">%s</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>%s</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="%s">%s</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="%s">%s</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="%s">%s</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="%s">%s</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="%s">%s</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>%s
</Invoice>
`, escXml(inv.InvoiceNumber), escXml(inv.UUID), escXml(inv.IssueDate), escXml(inv.IssueTime),
		typeName, typeCode, currency, currency, icv, escXml(pih),
		escXml(issuer.CommercialRegister), escXml(issuer.Street), escXml(issuer.BuildingNo),
		escXml(issuer.District), escXml(issuer.City), escXml(issuer.PostalCode), escXml(country),
		escXml(issuer.TaxNumber), escXml(issuer.Name),
		escXml(client.Street), escXml(client.City), escXml(client.TaxNumber), escXml(client.Name),
		currency, escXml(inv.DiscountAmount),
		currency, escXml(inv.TaxAmount),
		currency, escXml(inv.TaxableAmount), currency, escXml(inv.TaxAmount), escXml(inv.TaxRateDisplay),
		currency, escXml(inv.Subtotal), currency, escXml(inv.TaxableAmount), currency, escXml(inv.GrandTotal),
		currency, escXml(inv.DiscountAmount), currency, escXml(inv.GrandTotal), lineXml.String())
}
