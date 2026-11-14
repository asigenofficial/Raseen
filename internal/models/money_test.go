package models

import (
	"math"
	"testing"
)

func TestComputeInclusiveLineExactExamples(t *testing.T) {
	// Customer example: 3600 inclusive @ 15% -> 3130.43 + 469.57 = 3600.00
	got := ComputeInclusiveLine(1, 3600, 0, 0, 15)
	if got.UnitPriceExclMinor != 313043 {
		t.Fatalf("UnitPriceExclMinor = %d, want 313043 (3130.43)", got.UnitPriceExclMinor)
	}
	if got.TaxableExclMinor != 313043 {
		t.Fatalf("TaxableExclMinor = %d, want 313043 (3130.43)", got.TaxableExclMinor)
	}
	if got.TaxAmountMinor != 46957 {
		t.Fatalf("TaxAmountMinor = %d, want 46957 (469.57)", got.TaxAmountMinor)
	}
	if got.TotalLineMinor != 360000 {
		t.Fatalf("TotalLineMinor = %d, want 360000 (3600.00)", got.TotalLineMinor)
	}

	// Excel screenshot row: qty=5, inclusive unit price=6315 @ 15%
	// unit_price_excl = 5491.30, taxable = 27456.52 (NOT 5*5491.30), tax = 4118.48, total = 31575.00
	excelRow := ComputeInclusiveLine(5, 6315, 0, 0, 15)
	if excelRow.UnitPriceExclMinor != 549130 {
		t.Fatalf("excel UnitPriceExclMinor = %d, want 549130 (5491.30)", excelRow.UnitPriceExclMinor)
	}
	if excelRow.TaxableExclMinor != 2745652 {
		t.Fatalf("excel TaxableExclMinor = %d, want 2745652 (27456.52)", excelRow.TaxableExclMinor)
	}
	if excelRow.TaxAmountMinor != 411848 {
		t.Fatalf("excel TaxAmountMinor = %d, want 411848 (4118.48)", excelRow.TaxAmountMinor)
	}
	if excelRow.TotalLineMinor != 3157500 {
		t.Fatalf("excel TotalLineMinor = %d, want 3157500 (31575.00)", excelRow.TotalLineMinor)
	}
}

func TestComputeInclusiveLineDiscountsAndZeroTax(t *testing.T) {
	// Inclusive flat discount: 4600 - 1000 = 3600 inclusive -> 3130.43 + 469.57 = 3600.00
	withDisc := ComputeInclusiveLine(1, 4600, 1000, 0, 15)
	if withDisc.TaxableExclMinor != 313043 || withDisc.TaxAmountMinor != 46957 || withDisc.TotalLineMinor != 360000 {
		t.Fatalf("flat inclusive discount mismatch: %+v", withDisc)
	}

	// Inclusive percent discount: 10% off 4000 inclusive -> 3600 inclusive
	withPct := ComputeInclusiveLine(1, 4000, 0, 10, 15)
	if withPct.TaxableExclMinor != 313043 || withPct.TaxAmountMinor != 46957 || withPct.TotalLineMinor != 360000 {
		t.Fatalf("percent inclusive discount mismatch: %+v", withPct)
	}

	// 0% VAT inclusive
	zeroVat := ComputeInclusiveLine(2, 1500, 0, 0, 0)
	if zeroVat.UnitPriceExclMinor != 150000 || zeroVat.TaxableExclMinor != 300000 || zeroVat.TaxAmountMinor != 0 || zeroVat.TotalLineMinor != 300000 {
		t.Fatalf("zero VAT inclusive mismatch: %+v", zeroVat)
	}
}

func TestComputeInclusiveLineZeroDriftAcrossHalalaSweep(t *testing.T) {
	// Every cent/halala from 0.01 to 200.00 SAR with qty=1 @ 15% VAT must reconstruct exact entered total
	for halalas := int64(1); halalas <= 20000; halalas++ {
		priceIncl := float64(halalas) / 100.0
		got := ComputeInclusiveLine(1, priceIncl, 0, 0, 15)
		if got.TotalLineMinor != halalas {
			t.Fatalf("drift at priceIncl=%.2f: taxable=%d tax=%d total=%d want=%d",
				priceIncl, got.TaxableExclMinor, got.TaxAmountMinor, got.TotalLineMinor, halalas)
		}
		if got.TaxableExclMinor+got.TaxAmountMinor != got.TotalLineMinor {
			t.Fatalf("invariant broken at %.2f: taxable+tax != total", priceIncl)
		}
	}

	// Multi-quantity sweep
	qtys := []float64{2, 3, 5, 7, 12}
	prices := []float64{100, 469.57, 1655, 3600, 6315, 7100, 8500, 40330}
	for _, q := range qtys {
		for _, p := range prices {
			wantMinor := int64(math.Floor(q*p*100 + 0.5 + 1e-9))
			got := ComputeInclusiveLine(q, p, 0, 0, 15)
			if got.TotalLineMinor != wantMinor {
				t.Fatalf("multi-qty drift qty=%.0f price=%.2f: got=%d want=%d", q, p, got.TotalLineMinor, wantMinor)
			}
		}
	}
}
