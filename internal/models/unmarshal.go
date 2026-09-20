package models

import (
	"encoding/json"
	"strconv"
	"strings"
)

func (iss *Issuer) UnmarshalJSON(data []byte) error {
	type Alias Issuer
	var aux struct {
		Alias
		IsActive       any `json:"is_active"`
		QrSettings     any `json:"qr_settings"`
		PrintSettings  any `json:"print_settings"`
		DefaultTaxRate any `json:"default_tax_rate"`
		InvoiceNextNo  any `json:"invoice_next_no"`
		InvoicePad     any `json:"invoice_pad"`
		VoucherNextNo  any `json:"voucher_next_no"`
	}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	*iss = Issuer(aux.Alias)

	// IsActive (bool, number, or string)
	iss.IsActive = 1
	if aux.IsActive != nil {
		switch v := aux.IsActive.(type) {
		case bool:
			if v {
				iss.IsActive = 1
			} else {
				iss.IsActive = 0
			}
		case float64:
			iss.IsActive = int(v)
		case string:
			clean := strings.TrimSpace(v)
			if clean == "0" || strings.EqualFold(clean, "false") {
				iss.IsActive = 0
			} else {
				iss.IsActive = 1
			}
		}
	}

	// QrSettings (can be object, string, or nil)
	if aux.QrSettings != nil {
		switch v := aux.QrSettings.(type) {
		case string:
			iss.QrSettings = v
		case map[string]any:
			b, _ := json.Marshal(v)
			iss.QrSettings = string(b)
		}
	}

	// PrintSettings (can be object, string, or nil)
	if aux.PrintSettings != nil {
		switch v := aux.PrintSettings.(type) {
		case string:
			iss.PrintSettings = v
		case map[string]any:
			b, _ := json.Marshal(v)
			iss.PrintSettings = string(b)
		}
	}

	// DefaultTaxRate
	if aux.DefaultTaxRate != nil {
		switch v := aux.DefaultTaxRate.(type) {
		case float64:
			iss.DefaultTaxRate = v
		case string:
			if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
				iss.DefaultTaxRate = f
			}
		}
	}

	// InvoiceNextNo
	if aux.InvoiceNextNo != nil {
		switch v := aux.InvoiceNextNo.(type) {
		case float64:
			iss.InvoiceNextNo = int64(v)
		case string:
			if n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
				iss.InvoiceNextNo = n
			}
		}
	}

	// InvoicePad
	if aux.InvoicePad != nil {
		switch v := aux.InvoicePad.(type) {
		case float64:
			iss.InvoicePad = int(v)
		case string:
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
				iss.InvoicePad = n
			}
		}
	}

	// VoucherNextNo
	if aux.VoucherNextNo != nil {
		switch v := aux.VoucherNextNo.(type) {
		case float64:
			iss.VoucherNextNo = int64(v)
		case string:
			if n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
				iss.VoucherNextNo = n
			}
		}
	}

	return nil
}

func (c *Client) UnmarshalJSON(data []byte) error {
	type Alias Client
	var aux struct {
		Alias
		IsActive       any `json:"is_active"`
		OpeningBalance any `json:"opening_balance"`
		CreditLimit    any `json:"credit_limit"`
		PaymentTerms   any `json:"payment_terms_days"`
	}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	*c = Client(aux.Alias)

	// IsActive (bool, number, or string)
	c.IsActive = 1
	if aux.IsActive != nil {
		switch v := aux.IsActive.(type) {
		case bool:
			if v {
				c.IsActive = 1
			} else {
				c.IsActive = 0
			}
		case float64:
			c.IsActive = int(v)
		case string:
			clean := strings.TrimSpace(v)
			if clean == "0" || strings.EqualFold(clean, "false") {
				c.IsActive = 0
			} else {
				c.IsActive = 1
			}
		}
	}

	// OpeningBalance (Riyals to Halalas conversion via ToMinor)
	if aux.OpeningBalance != nil {
		c.OpeningBalance = ToMinor(aux.OpeningBalance)
	}

	// CreditLimit (Riyals to Halalas conversion via ToMinor)
	if aux.CreditLimit != nil {
		c.CreditLimit = ToMinor(aux.CreditLimit)
	}

	// PaymentTermsDays
	if aux.PaymentTerms != nil {
		switch v := aux.PaymentTerms.(type) {
		case float64:
			c.PaymentTermsDays = int(v)
		case string:
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
				c.PaymentTermsDays = n
			}
		}
	}

	return nil
}

func (it *Item) UnmarshalJSON(data []byte) error {
	type Alias Item
	var aux struct {
		Alias
		IsActive  any `json:"is_active"`
		CostPrice any `json:"cost_price"`
		SalePrice any `json:"sale_price"`
		TaxRate   any `json:"tax_rate"`
	}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	*it = Item(aux.Alias)

	it.IsActive = 1
	if aux.IsActive != nil {
		switch v := aux.IsActive.(type) {
		case bool:
			if v {
				it.IsActive = 1
			} else {
				it.IsActive = 0
			}
		case float64:
			it.IsActive = int(v)
		case string:
			clean := strings.TrimSpace(v)
			if clean == "0" || strings.EqualFold(clean, "false") {
				it.IsActive = 0
			} else {
				it.IsActive = 1
			}
		}
	}

	if aux.CostPrice != nil {
		it.CostPrice = ToMinor(aux.CostPrice)
	}

	if aux.SalePrice != nil {
		it.SalePrice = ToMinor(aux.SalePrice)
	}

	if aux.TaxRate != nil {
		switch v := aux.TaxRate.(type) {
		case float64:
			it.TaxRate = v
		case string:
			if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
				it.TaxRate = f
			}
		}
	}

	return nil
}
