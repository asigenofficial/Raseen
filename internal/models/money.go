package models

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	MinorFactor = 100
	Dec4Factor  = 10000
)

func roundFloatHalfUp(x float64) int64 {
	if x >= 0 {
		return int64(math.Floor(x + 0.5 + 1e-9))
	}
	return int64(math.Ceil(x - 0.5 - 1e-9))
}

// ToDec4 converts a major currency value (SAR) to Decimal(4) integer units (10^-4 SAR) using Round Half Up.
func ToDec4(major float64) int64 {
	return roundFloatHalfUp(major * float64(Dec4Factor))
}

// ToMajor4 converts Decimal(4) integer units (10^-4 SAR) to a float64 with 4 decimal places.
func ToMajor4(dec4 int64) float64 {
	return float64(dec4) / float64(Dec4Factor)
}

// RoundMajor4 rounds a float64 major currency value to 4 decimal places Decimal(4) using Round Half Up.
func RoundMajor4(major float64) float64 {
	return ToMajor4(ToDec4(major))
}

// RoundDec4ToMinor rounds a Decimal(4) integer value (10^-4 SAR) to minor units (10^-2 SAR, halalas)
// using standard arithmetic Round Half Up (e.g. 926.0850 -> 926.09, 926.0950 -> 926.10).
func RoundDec4ToMinor(dec4 int64) int64 {
	if dec4 >= 0 {
		return (dec4 + 50) / 100
	}
	return (dec4 - 50) / 100
}

// RoundMajor2 rounds a float64 major currency value to 2 decimal places Decimal(2) using Round Half Up.
func RoundMajor2(major float64) float64 {
	return ToMajor(RoundDec4ToMinor(ToDec4(major)))
}

// ToMinor converts a float or numeric value in major currency units (e.g. SAR) to minor units (halalas)
// using standard arithmetic Round Half Up.
func ToMinor(val any) int64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case int:
		return int64(v) * MinorFactor
	case int64:
		return v * MinorFactor
	case float64:
		return RoundDec4ToMinor(ToDec4(v))
	case float32:
		return RoundDec4ToMinor(ToDec4(float64(v)))
	case string:
		clean := strings.TrimSpace(strings.ReplaceAll(v, ",", ""))
		if clean == "" {
			return 0
		}
		f, err := strconv.ParseFloat(clean, 64)
		if err != nil {
			return 0
		}
		return RoundDec4ToMinor(ToDec4(f))
	default:
		return 0
	}
}

// ToMajor converts minor units (halalas) to major decimal units (e.g. SAR).
func ToMajor(minor int64) float64 {
	return float64(minor) / float64(MinorFactor)
}

// FmtMoney formats minor units as string with 2 decimals (e.g. "150.25").
func FmtMoney(minor int64) string {
	return fmt.Sprintf("%.2f", ToMajor(minor))
}

// MulQty multiplies a quantity (float64) by unit price in minor units (int64) using Round Half Up.
func MulQty(qty float64, unitPriceMinor int64) int64 {
	dec4 := roundFloatHalfUp(qty * float64(unitPriceMinor) * 100.0)
	return RoundDec4ToMinor(dec4)
}

// PctDec4 calculates the exact Decimal(4) (10^-4 SAR) percentage of a minor amount (10^-2 SAR) without 2-decimal rounding.
// Since amountMinor is in 10^-2 units and ratePercent is per 100, amountMinor * ratePercent is in 10^-4 units.
func PctDec4(amountMinor int64, ratePercent float64) int64 {
	return roundFloatHalfUp(float64(amountMinor) * ratePercent)
}

// Pct calculates percentage of minor amount rounded to 2 decimal places (minor units) using Round Half Up.
func Pct(amountMinor int64, ratePercent float64) int64 {
	return RoundDec4ToMinor(PctDec4(amountMinor, ratePercent))
}

// NetFromInclusive extracts net taxable amount from inclusive amount: net = incl / (1 + r/100).
func NetFromInclusive(inclusiveMinor int64, ratePercent float64) int64 {
	if ratePercent <= 0 {
		return inclusiveMinor
	}
	dec4 := roundFloatHalfUp((float64(inclusiveMinor) * 100.0) / (1.0 + ratePercent/100.0))
	return RoundDec4ToMinor(dec4)
}

// SumMinor sums a slice of minor units.
func SumMinor(items []int64) int64 {
	var total int64
	for _, v := range items {
		total += v
	}
	return total
}
