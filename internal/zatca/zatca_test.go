package zatca_test

import (
	"testing"

	"raseen/internal/zatca"
)

func TestZatcaQrPayload(t *testing.T) {
	p := zatca.QrParams{
		SellerName: "شركة رسين للتجارة",
		VatNumber:  "310123456700003",
		Timestamp:  "2026-09-18T12:00:00Z",
		Total:      "115.00",
		VatTotal:   "15.00",
	}

	payload := zatca.BuildQrPayload(p)
	if payload == "" {
		t.Fatalf("expected non-empty QR payload")
	}

	tags, err := zatca.ParseQrPayload(payload)
	if err != nil {
		t.Fatalf("failed to parse QR payload: %v", err)
	}

	if len(tags) != 5 {
		t.Fatalf("expected 5 tags in Phase 1 QR payload, got %d", len(tags))
	}

	if tags[0].Text != p.SellerName {
		t.Errorf("Tag 1 expected %q, got %q", p.SellerName, tags[0].Text)
	}
	if tags[1].Text != p.VatNumber {
		t.Errorf("Tag 2 expected %q, got %q", p.VatNumber, tags[1].Text)
	}
}

func TestZatcaCryptoSigning(t *testing.T) {
	kp, err := zatca.GenerateKeyPair()
	if err != nil {
		t.Fatalf("failed to generate keypair: %v", err)
	}

	hash := zatca.InvoiceHash("<Invoice>test</Invoice>")
	sig, err := zatca.SignHash(kp.PrivateKeyPem, hash)
	if err != nil {
		t.Fatalf("failed to sign hash: %v", err)
	}

	valid := zatca.VerifyHashSignature(kp.PublicKeyPem, hash, sig)
	if !valid {
		t.Fatalf("signature verification failed")
	}
}
