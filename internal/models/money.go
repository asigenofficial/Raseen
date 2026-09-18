package models

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const MinorFactor = 100

// ToMinor converts a float or numeric value in major currency units (e.g. SAR) to minor units (halalas).
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
		return int64(math.Round(v * float64(MinorFactor)))
	case float32:
		return int64(math.Round(float64(v) * float64(MinorFactor)))
	case string:
		clean := strings.TrimSpace(strings.ReplaceAll(v, ",", ""))
		if clean == "" {
			return 0
		}
		f, err := strconv.ParseFloat(clean, 64)
		if err != nil {
			return 0
		}
		return int64(math.Round(f * float64(MinorFactor)))
	default:
		return 0
	}
}

// ToMajor converts minor units (halalas) to major decimal units (e.g. SAR).
func ToMajor(minor int64) float64 {
	return math.Round(float64(minor)) / float64(MinorFactor)
}

// FmtMoney formats minor units as string with 2 decimals (e.g. "150.25").
func FmtMoney(minor int64) string {
	return fmt.Sprintf("%.2f", ToMajor(minor))
}

// MulQty multiplies a quantity (float64) by unit price in minor units (int64).
func MulQty(qty float64, unitPriceMinor int64) int64 {
	return int64(math.Round(qty * float64(unitPriceMinor)))
}

// Pct calculates percentage of minor amount: round((amount * rate) / 100).
func Pct(amountMinor int64, ratePercent float64) int64 {
	return int64(math.Round((float64(amountMinor) * ratePercent) / 100.0))
}

// NetFromInclusive extracts net taxable amount from inclusive amount: net = incl / (1 + r/100).
func NetFromInclusive(inclusiveMinor int64, ratePercent float64) int64 {
	if ratePercent <= 0 {
		return inclusiveMinor
	}
	return int64(math.Round(float64(inclusiveMinor) / (1.0 + ratePercent/100.0)))
}

// SumMinor sums a slice of minor units.
func SumMinor(items []int64) int64 {
	var total int64
	for _, v := range items {
		total += v
	}
	return total
}
