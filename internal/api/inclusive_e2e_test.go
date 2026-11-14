package api

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"raseen/internal/config"
	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/services"
)

type jsonInvoiceItem struct {
	ID            string  `json:"id"`
	ItemName      string  `json:"item_name"`
	Quantity      float64 `json:"quantity"`
	UnitPrice     float64 `json:"unit_price"`
	UnitPriceIncl float64 `json:"unit_price_incl"`
	Discount      float64 `json:"discount"`
	DiscountIncl  float64 `json:"discount_incl"`
	TaxRate       float64 `json:"tax_rate"`
	Taxable       float64 `json:"taxable"`
	TaxAmount     float64 `json:"tax_amount"`
	TotalLine     float64 `json:"total_line"`
}

type jsonInvoice struct {
	ID               string            `json:"id"`
	InvoiceNumber    string            `json:"invoice_number"`
	PricesIncludeTax int               `json:"prices_include_tax"`
	Subtotal         float64           `json:"subtotal"`
	DiscountAmount   float64           `json:"discount_amount"`
	TaxableAmount    float64           `json:"taxable_amount"`
	TaxAmount        float64           `json:"tax_amount"`
	GrandTotal       float64           `json:"grand_total"`
	RemainingAmount  float64           `json:"remaining_amount"`
	QrPayload        string            `json:"qr_payload"`
	Items            []jsonInvoiceItem `json:"items"`
}

func approxEq(a, b float64) bool {
	return math.Abs(a-b) < 0.0001
}

func decodeQrTLV(t *testing.T, b64 string) map[byte]string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("decode qr base64 failed: %v", err)
	}
	tags := make(map[byte]string)
	i := 0
	for i < len(raw) {
		tag := raw[i]
		i++
		if i >= len(raw) {
			t.Fatalf("truncated TLV length at tag %d", tag)
		}
		var length int
		if raw[i] == 0x82 {
			if i+2 >= len(raw) {
				t.Fatalf("truncated extended TLV length at tag %d", tag)
			}
			length = int(binary.BigEndian.Uint16(raw[i+1 : i+3]))
			i += 3
		} else {
			length = int(raw[i])
			i++
		}
		if i+length > len(raw) {
			t.Fatalf("truncated TLV value at tag %d", tag)
		}
		tags[tag] = string(raw[i : i+length])
		i += length
	}
	return tags
}

func doJSONReq(t *testing.T, client *http.Client, method, url string, body any, out any) (int, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("new request %s %s: %v", method, url, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s failed: %v", method, url, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	if out != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var env struct {
			OK   bool            `json:"ok"`
			Data json.RawMessage `json:"data"`
		}
		target := raw
		if errEnv := json.Unmarshal(raw, &env); errEnv == nil && len(env.Data) > 0 {
			target = env.Data
		}
		if err := json.Unmarshal(target, out); err != nil {
			t.Fatalf("unmarshal %s %s response: %v\nbody=%s", method, url, err, string(raw))
		}
	}
	return resp.StatusCode, raw
}

func TestTaxInclusiveInvoiceLifecycleE2E(t *testing.T) {
	tmpDir := t.TempDir()
	cfg := &config.Config{
		Root:            tmpDir,
		PublicDir:       filepath.Join(tmpDir, "public"),
		DataDir:         filepath.Join(tmpDir, "data"),
		DbFile:          filepath.Join(tmpDir, "data", "test.db"),
		KeyFile:         filepath.Join(tmpDir, "data", "secret.key"),
		BackupDir:       filepath.Join(tmpDir, "data", "backups"),
		Host:            "127.0.0.1",
		Port:            0,
		SessionTtlHours: 12,
		MaxBodyBytes:    16 * 1024 * 1024,
		Defaults: config.Defaults{
			Currency: "SAR",
			TaxRate:  15.0,
			Country:  "SA",
		},
		BootstrapAdmin: config.AdminCredentials{
			Username: "admin",
			Password: "TestAdmin@12345",
			FullName: "مدير الاختبار",
		},
	}

	masterKey, err := crypto.GetMasterKey(cfg.KeyFile)
	if err != nil {
		t.Fatalf("GetMasterKey: %v", err)
	}
	database, err := db.Open(cfg)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	defer database.Close()

	tplPath := filepath.Join(cfg.DataDir, "test-invoice-tpl.html")
	tplHTML := `<html><body>
		<table class="items-main-table">
			<thead><tr><th>الصنف</th><th>السعر</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
			<tbody><tr><td>{{item_name}}</td><td>{{unit_price}}</td><td>{{taxable}}</td><td>{{tax_amount}}</td><td>{{total}}</td></tr></tbody>
		</table>
		<div id="totals"><span>{{taxable_amount}}</span> | <span>{{tax_amount}}</span> | <span>{{grand_total}}</span></div>
	</body></html>`
	if err := os.WriteFile(tplPath, []byte(tplHTML), 0644); err != nil {
		t.Fatalf("write test template: %v", err)
	}
	if _, err := database.Exec(`
		INSERT INTO excel_templates (id, name_ar, category, file_path, is_active, updated_at)
		VALUES ('tpl-test-inv', 'قالب اختبار', 'invoices', ?, 1, '2026-11-14T00:00:00Z')
	`, tplPath); err != nil {
		t.Fatalf("seed excel_templates: %v", err)
	}

	mockPublic := fstest.MapFS{
		"index.html": {Data: []byte("<html><body>Raseen</body></html>")},
	}
	srv := NewServer(cfg, database, masterKey, mockPublic)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar: %v", err)
	}
	client := &http.Client{Jar: jar}

	// 1. Authenticate
	code, raw := doJSONReq(t, client, http.MethodPost, ts.URL+"/api/auth/login", map[string]string{
		"username": cfg.BootstrapAdmin.Username,
		"password": cfg.BootstrapAdmin.Password,
	}, nil)
	if code != 200 {
		t.Fatalf("login failed status=%d body=%s", code, string(raw))
	}

	// 2. Fetch bootstrapped issuer and create client
	var issuers []struct {
		ID string `json:"id"`
	}
	code, raw = doJSONReq(t, client, http.MethodGet, ts.URL+"/api/issuers", nil, &issuers)
	if code != 200 || len(issuers) == 0 {
		t.Fatalf("GET /api/issuers failed status=%d body=%s", code, string(raw))
	}
	issuerID := issuers[0].ID

	var createdClient struct {
		ID string `json:"id"`
	}
	code, raw = doJSONReq(t, client, http.MethodPost, ts.URL+"/api/clients", map[string]any{
		"name":       "عميل اختبار الضريبة الشاملة",
		"tax_number": "310000000000003",
		"city":       "الرياض",
	}, &createdClient)
	if code != 201 && code != 200 {
		t.Fatalf("POST /api/clients failed status=%d body=%s", code, string(raw))
	}

	// 3. Create tax-inclusive invoice with qty=1 @ 3600 (15% VAT)
	var inv jsonInvoice
	code, raw = doJSONReq(t, client, http.MethodPost, ts.URL+"/api/invoices", map[string]any{
		"issuer_id":          issuerID,
		"client_id":          createdClient.ID,
		"issue_date":         "2026-11-14",
		"invoice_type":       "STANDARD",
		"payment_method":     "CREDIT",
		"prices_include_tax": true,
		"lines": []map[string]any{
			{
				"item_code":  "ITM-3600",
				"item_name":  "خدمة استشارية شاملة الضريبة",
				"unit":       "حبة",
				"quantity":   1,
				"unit_price": 3600,
				"discount":   0,
				"tax_rate":   15,
			},
		},
	}, &inv)
	if code != 201 && code != 200 {
		t.Fatalf("POST /api/invoices failed status=%d body=%s", code, string(raw))
	}
	if inv.PricesIncludeTax != 1 {
		t.Fatalf("PricesIncludeTax = %d, want 1", inv.PricesIncludeTax)
	}
	if !approxEq(inv.TaxableAmount, 3130.43) || !approxEq(inv.TaxAmount, 469.57) || !approxEq(inv.GrandTotal, 3600.00) {
		t.Fatalf("invoice totals mismatch: taxable=%.2f tax=%.2f grand=%.2f", inv.TaxableAmount, inv.TaxAmount, inv.GrandTotal)
	}
	if len(inv.Items) != 1 || !approxEq(inv.Items[0].UnitPrice, 3130.43) || !approxEq(inv.Items[0].UnitPriceIncl, 3600) {
		t.Fatalf("invoice item mismatch: %+v", inv.Items)
	}

	// 4. Verify ZATCA QR barcode TLV tags match displayed/printed numbers (3600.00 & 469.57)
	tlv := decodeQrTLV(t, inv.QrPayload)
	if tlv[4] != "3600.00" || tlv[5] != "469.57" {
		t.Fatalf("QR TLV mismatch: total=%q vat=%q, want 3600.00 and 469.57", tlv[4], tlv[5])
	}

	// Verify GET /api/invoices/{id} returns unit_price_incl & prices_include_tax for editing
	var fetched jsonInvoice
	code, raw = doJSONReq(t, client, http.MethodGet, ts.URL+"/api/invoices/"+inv.ID, nil, &fetched)
	if code != 200 || fetched.PricesIncludeTax != 1 || len(fetched.Items) != 1 || !approxEq(fetched.Items[0].UnitPriceIncl, 3600) {
		t.Fatalf("GET /api/invoices/{id} mismatch: code=%d %+v body=%s", code, fetched, string(raw))
	}

	// Verify UBL XML reflects 3130.43 / 469.57 / 3600.00
	respXML, err := client.Get(ts.URL + "/api/invoices/" + inv.ID + "/xml")
	if err != nil {
		t.Fatalf("GET xml failed: %v", err)
	}
	xmlBytes, _ := io.ReadAll(respXML.Body)
	respXML.Body.Close()
	xmlStr := string(xmlBytes)
	for _, needle := range []string{">3130.43<", ">469.57<", ">3600.00<"} {
		if !strings.Contains(xmlStr, needle) {
			t.Fatalf("UBL XML missing %q", needle)
		}
	}

	// 5. Verify rendered print HTML shows normal 2-decimal figures (3,130.43 | 469.57 | 3,600.00)
	respHTML, err := client.Get(ts.URL + "/api/invoices/" + inv.ID + "/render-html")
	if err != nil {
		t.Fatalf("GET render-html failed: %v", err)
	}
	htmlBytes, _ := io.ReadAll(respHTML.Body)
	respHTML.Body.Close()
	if respHTML.StatusCode != 200 {
		t.Fatalf("GET render-html status=%d body=%s", respHTML.StatusCode, string(htmlBytes))
	}
	htmlStr := string(htmlBytes)
	for _, needle := range []string{"3,130.43", "469.57", "3,600.00"} {
		if !strings.Contains(htmlStr, needle) {
			t.Fatalf("rendered HTML missing %q in:\n%s", needle, htmlStr)
		}
	}

	// 6. Verify preview-render-html with raw inclusive line (before save) renders 3,130.43 | 469.57 | 3,600.00
	code, prevHTML := doJSONReq(t, client, http.MethodPost, ts.URL+"/api/invoices/preview-render-html", map[string]any{
		"issuer_id": issuerID,
		"client_id": createdClient.ID,
		"invoice": map[string]any{
			"invoice_number":     "PREVIEW-01",
			"invoice_type":       "STANDARD",
			"issue_date":         "2026-11-14",
			"prices_include_tax": true,
			"lines": []map[string]any{
				{
					"item_code":  "ITM-1",
					"item_name":  "صنف معاينة",
					"unit":       "حبة",
					"quantity":   1,
					"unit_price": 3600,
					"tax_rate":   15,
				},
			},
		},
	}, nil)
	if code != 200 {
		t.Fatalf("preview-render-html failed status=%d body=%s", code, string(prevHTML))
	}
	for _, needle := range []string{"3,130.43", "469.57", "3,600.00"} {
		if !strings.Contains(string(prevHTML), needle) {
			t.Fatalf("preview HTML missing %q", needle)
		}
	}

	// 7. Edit invoice (PUT) to multi-line Excel sheet case totaling 103,560.00 inclusive
	multiLines := []map[string]any{
		{"item_name": "بند 1", "unit": "حبة", "quantity": 2, "unit_price": 4250, "tax_rate": 15},   // 8500
		{"item_name": "بند 2", "unit": "حبة", "quantity": 1, "unit_price": 6300, "tax_rate": 15},   // 6300
		{"item_name": "بند 3", "unit": "حبة", "quantity": 1, "unit_price": 40330, "tax_rate": 15},  // 40330
		{"item_name": "بند 4", "unit": "حبة", "quantity": 1, "unit_price": 7100, "tax_rate": 15},   // 7100
		{"item_name": "بند 5", "unit": "حبة", "quantity": 5, "unit_price": 6315, "tax_rate": 15},   // 31575 (5491.30 * 5 => 27456.52 + 4118.48)
		{"item_name": "بند 6", "unit": "حبة", "quantity": 1, "unit_price": 1655, "tax_rate": 15},   // 1655
		{"item_name": "بند 7", "unit": "حبة", "quantity": 1, "unit_price": 3600, "tax_rate": 15},   // 3600
		{"item_name": "بند 8", "unit": "حبة", "quantity": 1, "unit_price": 4500, "tax_rate": 15},   // 4500
	}
	var updated jsonInvoice
	code, raw = doJSONReq(t, client, http.MethodPut, ts.URL+"/api/invoices/"+inv.ID, map[string]any{
		"issuer_id":          issuerID,
		"client_id":          createdClient.ID,
		"issue_date":         "2026-11-14",
		"invoice_type":       "STANDARD",
		"payment_method":     "CREDIT",
		"prices_include_tax": true,
		"lines":              multiLines,
	}, &updated)
	if code != 200 {
		t.Fatalf("PUT /api/invoices failed status=%d body=%s", code, string(raw))
	}
	if !approxEq(updated.TaxableAmount, 90052.16) || !approxEq(updated.TaxAmount, 13507.84) || !approxEq(updated.GrandTotal, 103560.00) {
		t.Fatalf("updated multi-line totals mismatch: taxable=%.2f tax=%.2f grand=%.2f, want 90052.16 / 13507.84 / 103560.00",
			updated.TaxableAmount, updated.TaxAmount, updated.GrandTotal)
	}
	if !approxEq(updated.Items[4].UnitPrice, 5491.30) || !approxEq(updated.Items[4].Taxable, 27456.52) || !approxEq(updated.Items[4].TaxAmount, 4118.48) || !approxEq(updated.Items[4].TotalLine, 31575.00) {
		t.Fatalf("line 5 (qty=5 @ 6315) mismatch: %+v", updated.Items[4])
	}
	tlvUpdated := decodeQrTLV(t, updated.QrPayload)
	if tlvUpdated[4] != "103560.00" || tlvUpdated[5] != "13507.84" {
		t.Fatalf("updated QR TLV mismatch: total=%q vat=%q", tlvUpdated[4], tlvUpdated[5])
	}

	// 8. Check returnable items expose inclusive pricing and issue Credit Note for line 7 (3600)
	var retItems []services.ReturnableItem
	code, raw = doJSONReq(t, client, http.MethodGet, ts.URL+"/api/invoices/"+inv.ID+"/returnable-items", nil, &retItems)
	if code != 200 || len(retItems) != 8 {
		t.Fatalf("GET returnable-items failed status=%d len=%d body=%s", code, len(retItems), string(raw))
	}
	if !retItems[6].PricesIncludeTax || !approxEq(retItems[6].UnitPriceIncl, 3600) {
		t.Fatalf("returnable item[6] inclusive fields missing: %+v", retItems[6])
	}

	var cn jsonInvoice
	code, raw = doJSONReq(t, client, http.MethodPost, ts.URL+"/api/invoices/"+inv.ID+"/credit-note", map[string]any{
		"return_date": "2026-11-14",
		"reason":      "مرتجع تجربة شامل الضريبة",
		"items": []map[string]any{
			{"invoice_item_id": retItems[6].InvoiceItemID, "quantity": 1},
		},
	}, &cn)
	if code != 201 && code != 200 {
		t.Fatalf("POST credit-note failed status=%d body=%s", code, string(raw))
	}
	if cn.PricesIncludeTax != 1 || !approxEq(cn.TaxableAmount, 3130.43) || !approxEq(cn.TaxAmount, 469.57) || !approxEq(cn.GrandTotal, 3600.00) {
		t.Fatalf("credit note inclusive totals mismatch: prices_incl=%d taxable=%.2f tax=%.2f grand=%.2f",
			cn.PricesIncludeTax, cn.TaxableAmount, cn.TaxAmount, cn.GrandTotal)
	}
	tlvCN := decodeQrTLV(t, cn.QrPayload)
	if tlvCN[4] != "3600.00" || tlvCN[5] != "469.57" {
		t.Fatalf("credit note QR TLV mismatch: total=%q vat=%q", tlvCN[4], tlvCN[5])
	}
}
