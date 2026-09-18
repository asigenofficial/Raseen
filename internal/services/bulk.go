package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"time"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
)

type BulkService struct {
	db       *db.DB
	invoices *InvoiceService
	vouchers *VoucherService
	issuers  *IssuerService
	clients  *ClientService
	items    *ItemService
}

func NewBulkService(d *db.DB, inv *InvoiceService, vch *VoucherService, iss *IssuerService, cli *ClientService, itm *ItemService) *BulkService {
	return &BulkService{
		db:       d,
		invoices: inv,
		vouchers: vch,
		issuers:  iss,
		clients:  cli,
		items:    itm,
	}
}

type BulkDraftHeader struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	IssuerID     string  `json:"issuer_id"`
	ClientID     string  `json:"client_id"`
	Status       string  `json:"status"`
	InvoiceCount int     `json:"invoice_count"`
	GrandTotal   float64 `json:"grand_total"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

type BulkDraftDetail struct {
	ID           string         `json:"id"`
	Title        string         `json:"title"`
	IssuerID     string         `json:"issuer_id"`
	ClientID     string         `json:"client_id"`
	Status       string         `json:"status"`
	InvoiceCount int            `json:"invoice_count"`
	GrandTotal   float64        `json:"grand_total"`
	Invoices     []any          `json:"invoices"`
	Summary      map[string]any `json:"summary"`
	Options      map[string]any `json:"options"`
	CreatedAt    string         `json:"created_at"`
	UpdatedAt    string         `json:"updated_at"`
}

func (s *BulkService) ListDrafts(issuerID string) ([]BulkDraftHeader, error) {
	where := "WHERE 1=1"
	var args []any
	if issuerID != "" {
		where += " AND issuer_id = ?"
		args = append(args, issuerID)
	}

	q := fmt.Sprintf(`
		SELECT id, title, issuer_id, COALESCE(client_id, ''), status, invoice_count, grand_total, created_at, updated_at
		FROM bulk_drafts
		%s
		ORDER BY updated_at DESC
	`, where)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]BulkDraftHeader, 0)
	for rows.Next() {
		var d BulkDraftHeader
		var totMinor int64
		if err := rows.Scan(&d.ID, &d.Title, &d.IssuerID, &d.ClientID, &d.Status, &d.InvoiceCount, &totMinor, &d.CreatedAt, &d.UpdatedAt); err == nil {
			d.GrandTotal = models.ToMajor(totMinor)
			list = append(list, d)
		}
	}
	return list, nil
}

func (s *BulkService) GetDraft(id string) (*BulkDraftDetail, error) {
	var d BulkDraftDetail
	var totMinor int64
	var payloadStr, paramsStr string

	err := s.db.QueryRow(`
		SELECT id, title, issuer_id, COALESCE(client_id, ''), status, invoice_count, grand_total, payload, params, created_at, updated_at
		FROM bulk_drafts WHERE id = ?
	`, id).Scan(&d.ID, &d.Title, &d.IssuerID, &d.ClientID, &d.Status, &d.InvoiceCount, &totMinor, &payloadStr, &paramsStr, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, errors.New("المسودة غير موجودة")
	}

	d.GrandTotal = models.ToMajor(totMinor)
	d.Invoices = make([]any, 0)
	_ = json.Unmarshal([]byte(payloadStr), &d.Invoices)

	d.Options = make(map[string]any)
	_ = json.Unmarshal([]byte(paramsStr), &d.Options)

	d.Summary = map[string]any{
		"count":       d.InvoiceCount,
		"grand_total": d.GrandTotal,
	}

	return &d, nil
}

type SaveDraftInput struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	IssuerID string `json:"issuer_id"`
	ClientID string `json:"client_id"`
	Invoices []any  `json:"invoices"`
	Options  any    `json:"options"`
}

func (s *BulkService) SaveDraft(input SaveDraftInput) (*BulkDraftDetail, error) {
	if input.IssuerID == "" {
		return nil, errors.New("الشركة المصدرة مطلوبة")
	}
	if input.Title == "" {
		input.Title = fmt.Sprintf("معاينة دفعة (%d فاتورة)", len(input.Invoices))
	}

	id := input.ID
	isNew := false
	if id == "" {
		id = crypto.UUID()
		isNew = true
	}

	payloadJSON, _ := json.Marshal(input.Invoices)
	paramsJSON, _ := json.Marshal(input.Options)

	var totalAmount float64
	for _, rawInv := range input.Invoices {
		if invMap, ok := rawInv.(map[string]any); ok {
			if gt, ok := invMap["grand_total"].(float64); ok {
				totalAmount += gt
			}
		}
	}
	totalMinor := models.ToMinor(totalAmount)
	now := db.NowIso()

	if isNew {
		_, err := s.db.Exec(`
			INSERT INTO bulk_drafts (id, title, issuer_id, client_id, status, params, payload, invoice_count, grand_total, created_at, updated_at)
			VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
		`, id, input.Title, input.IssuerID, input.ClientID, string(paramsJSON), string(payloadJSON), len(input.Invoices), totalMinor, now, now)
		if err != nil {
			return nil, err
		}
	} else {
		_, err := s.db.Exec(`
			UPDATE bulk_drafts SET title = ?, issuer_id = ?, client_id = ?, params = ?, payload = ?, invoice_count = ?, grand_total = ?, updated_at = ?
			WHERE id = ?
		`, input.Title, input.IssuerID, input.ClientID, string(paramsJSON), string(payloadJSON), len(input.Invoices), totalMinor, now, id)
		if err != nil {
			return nil, err
		}
	}

	return &BulkDraftDetail{
		ID:           id,
		Title:        input.Title,
		IssuerID:     input.IssuerID,
		ClientID:     input.ClientID,
		Status:       "DRAFT",
		InvoiceCount: len(input.Invoices),
		GrandTotal:   totalAmount,
		Invoices:     input.Invoices,
		CreatedAt:    now,
		UpdatedAt:    now,
	}, nil
}

func (s *BulkService) DeleteDraft(id string) error {
	_, err := s.db.Exec("DELETE FROM bulk_drafts WHERE id = ?", id)
	return err
}

type CustomItemInput struct {
	NameAr    string  `json:"name_ar"`
	ItemCode  string  `json:"item_code"`
	Unit      string  `json:"unit"`
	SalePrice float64 `json:"sale_price"`
	TaxRate   float64 `json:"tax_rate"`
}

type PreviewRequest struct {
	IssuerID         string            `json:"issuer_id"`
	ClientID         string            `json:"client_id"`
	DateFrom         string            `json:"date_from"`
	DateTo           string            `json:"date_to"`
	Count            int               `json:"count"`
	TargetTotal      float64           `json:"target_total"`
	CategoryIDs      []string          `json:"category_ids"`
	ItemIDs          []string          `json:"item_ids"`
	CustomItems      []CustomItemInput `json:"custom_items"`
	DistributionMode string            `json:"distribution_mode"`
	MinItems         int               `json:"min_items"`
	MaxItems         int               `json:"max_items"`
	MinQty           float64           `json:"min_qty"`
	MaxQty           float64           `json:"max_qty"`
	MinInvoiceTotal  float64           `json:"min_invoice_total"`
	MaxInvoiceTotal  float64           `json:"max_invoice_total"`
}

type ItemCandidate struct {
	NameAr    string
	ItemCode  string
	Unit      string
	SalePrice float64
	TaxRate   float64
}

func (s *BulkService) GeneratePreview(req PreviewRequest) (map[string]any, error) {
	if req.IssuerID == "" {
		return nil, errors.New("يجب تحديد المنشأة المصدرة")
	}
	if req.Count <= 0 {
		req.Count = 10
	}
	if req.Count > 5000 {
		req.Count = 5000
	}

	if req.DateFrom == "" {
		req.DateFrom = db.TodayIso()
	}
	if req.DateTo == "" {
		req.DateTo = db.TodayIso()
	}

	clientName := "عميل نقدي عام"
	clientCode := "CASH-001"
	if req.ClientID != "" {
		cli, err := s.clients.GetClient(req.ClientID)
		if err == nil && cli != nil {
			clientName = cli.Name
			clientCode = cli.ClientCode
		}
	}

	availableItems := make([]ItemCandidate, 0)
	if len(req.CustomItems) > 0 {
		for _, ci := range req.CustomItems {
			rate := ci.TaxRate
			if rate <= 0 {
				rate = 15.0
			}
			availableItems = append(availableItems, ItemCandidate{
				NameAr:    ci.NameAr,
				ItemCode:  ci.ItemCode,
				Unit:      ci.Unit,
				SalePrice: ci.SalePrice,
				TaxRate:   rate,
			})
		}
	} else {
		dbItems, err := s.items.ListItems("", "", true)
		if err == nil {
			for _, it := range dbItems {
				availableItems = append(availableItems, ItemCandidate{
					NameAr:    it.NameAr,
					ItemCode:  it.ItemCode,
					Unit:      it.Unit,
					SalePrice: it.SalePriceMajor,
					TaxRate:   it.TaxRate,
				})
			}
		}
	}

	if len(availableItems) == 0 {
		availableItems = append(availableItems, ItemCandidate{
			NameAr:    "خدمات استشارية وتقنية",
			ItemCode:  "SRV-01",
			Unit:      "خدمة",
			SalePrice: 500.0,
			TaxRate:   15.0,
		})
	}

	minItems := req.MinItems
	if minItems <= 0 {
		minItems = 1
	}
	maxItems := req.MaxItems
	if maxItems < minItems {
		maxItems = minItems
	}

	minQty := req.MinQty
	if minQty <= 0 {
		minQty = 1
	}
	maxQty := req.MaxQty
	if maxQty < minQty {
		maxQty = minQty
	}

	tFrom, errFrom := time.Parse("2006-01-02", req.DateFrom)
	tTo, errTo := time.Parse("2006-01-02", req.DateTo)
	if errFrom != nil || errTo != nil || tTo.Before(tFrom) {
		tFrom = time.Now()
		tTo = time.Now()
	}
	daySpan := int(tTo.Sub(tFrom).Hours() / 24)
	if daySpan < 0 {
		daySpan = 0
	}

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	invoices := make([]map[string]any, 0, req.Count)
	var totalSubtotal, totalDiscount, totalTax, totalGrand float64

	for i := 0; i < req.Count; i++ {
		addDays := 0
		if daySpan > 0 {
			addDays = rng.Intn(daySpan + 1)
		}
		invDate := tFrom.AddDate(0, 0, addDays).Format("2006-01-02")
		invTime := fmt.Sprintf("%02d:%02d:%02d", 8+rng.Intn(10), rng.Intn(60), rng.Intn(60))

		linesCount := minItems
		if maxItems > minItems {
			linesCount = minItems + rng.Intn(maxItems-minItems+1)
		}

		lines := make([]map[string]any, 0, linesCount)
		var invSubtotal, invDiscount, invTax, invTotal float64

		perm := rng.Perm(len(availableItems))
		for l := 0; l < linesCount; l++ {
			it := availableItems[perm[l%len(availableItems)]]
			qty := minQty
			if maxQty > minQty {
				qty = minQty + float64(rng.Intn(int(maxQty-minQty+1)))
			}
			price := it.SalePrice
			if price <= 0 {
				price = 100.0 + float64(rng.Intn(400))
			}
			taxRate := it.TaxRate
			if taxRate <= 0 {
				taxRate = 15.0
			}

			lineSub := math.Round(qty*price*100) / 100
			lineTax := math.Round((lineSub*taxRate/100)*100) / 100
			lineTot := math.Round((lineSub+lineTax)*100) / 100

			lines = append(lines, map[string]any{
				"item_name":   it.NameAr,
				"item_code":   it.ItemCode,
				"unit":        it.Unit,
				"quantity":    qty,
				"unit_price":  price,
				"discount":    0.0,
				"tax_rate":    taxRate,
				"taxable":     lineSub,
				"tax_amount":  lineTax,
				"total_line":  lineTot,
			})

			invSubtotal += lineSub
			invTax += lineTax
			invTotal += lineTot
		}

		invSubtotal = math.Round(invSubtotal*100) / 100
		invTax = math.Round(invTax*100) / 100
		invTotal = math.Round(invTotal*100) / 100

		invoices = append(invoices, map[string]any{
			"temp_id":         fmt.Sprintf("PREV-%04d", i+1),
			"invoice_number":  fmt.Sprintf("معاينة #%d", i+1),
			"issue_date":      invDate,
			"issue_time":      invTime,
			"buyer_name":      clientName,
			"buyer_code":      clientCode,
			"subtotal":        invSubtotal,
			"discount_amount": invDiscount,
			"taxable_amount":  invSubtotal,
			"tax_amount":      invTax,
			"grand_total":     invTotal,
			"items":           lines,
		})

		totalSubtotal += invSubtotal
		totalDiscount += invDiscount
		totalTax += invTax
		totalGrand += invTotal
	}

	summary := map[string]any{
		"count":       req.Count,
		"subtotal":    math.Round(totalSubtotal*100) / 100,
		"discount":    math.Round(totalDiscount*100) / 100,
		"taxable":     math.Round(totalSubtotal*100) / 100,
		"tax":         math.Round(totalTax*100) / 100,
		"grand_total": math.Round(totalGrand*100) / 100,
	}

	return map[string]any{
		"invoices": invoices,
		"summary":  summary,
		"options":  req,
	}, nil
}

type CommitBatchRequest struct {
	DraftID       string `json:"draft_id"`
	IssuerID      string `json:"issuer_id"`
	ClientID      string `json:"client_id"`
	Invoices      []any  `json:"invoices"`
	Options       any    `json:"options"`
	IssueVouchers bool   `json:"issue_vouchers"`
}

func (s *BulkService) CommitBatch(req CommitBatchRequest, username string) (map[string]any, error) {
	if req.IssuerID == "" {
		return nil, errors.New("الشركة المصدرة مطلوبة")
	}
	if len(req.Invoices) == 0 {
		return nil, errors.New("لا توجد فواتير للاعتماد")
	}

	batchID := crypto.UUID()
	now := db.NowIso()

	createdCount := 0
	var totalGrand float64
	vouchersCount := 0

	for _, rawInv := range req.Invoices {
		invMap, ok := rawInv.(map[string]any)
		if !ok {
			continue
		}

		issueDate, _ := invMap["issue_date"].(string)
		if issueDate == "" {
			issueDate = db.TodayIso()
		}

		var itemsInput []CreateInvoiceLineInput
		if rawItems, ok := invMap["items"].([]any); ok {
			for _, ri := range rawItems {
				if im, ok := ri.(map[string]any); ok {
					name, _ := im["item_name"].(string)
					code, _ := im["item_code"].(string)
					unit, _ := im["unit"].(string)
					qty, _ := im["quantity"].(float64)
					price, _ := im["unit_price"].(float64)
					disc, _ := im["discount"].(float64)
					rate, _ := im["tax_rate"].(float64)
					if rate <= 0 {
						rate = 15.0
					}
					itemsInput = append(itemsInput, CreateInvoiceLineInput{
						ItemName:  name,
						ItemCode:  code,
						Unit:      unit,
						Quantity:  qty,
						UnitPrice: price,
						Discount:  disc,
						TaxRate:   rate,
					})
				}
			}
		}

		clientID := req.ClientID
		if cid, ok := invMap["client_id"].(string); ok && cid != "" {
			clientID = cid
		}

		inv, err := s.invoices.CreateInvoice(CreateInvoiceInput{
			IssuerID:      req.IssuerID,
			ClientID:      clientID,
			InvoiceType:   "STANDARD",
			IssueDate:     issueDate,
			PaymentMethod: "CREDIT",
			Lines:         itemsInput,
			Notes:         "توليد دفعي آلي",
		}, username, "")
		if err != nil {
			continue
		}

		createdCount++
		totalGrand += inv.GrandTotalMajor

		if req.IssueVouchers {
			_, errV := s.vouchers.CreateVoucher(CreateVoucherInput{
				IssuerID:    req.IssuerID,
				ClientID:    clientID,
				VoucherDate: issueDate,
				TotalAmount: inv.GrandTotalMajor,
				PaymentType: "TRANSFER",
				Notes:       fmt.Sprintf("سداد آلي للفاتورة %s", inv.InvoiceNumber),
				Allocations: []VoucherAllocationInput{
					{InvoiceID: inv.ID, Amount: inv.GrandTotalMajor},
				},
			}, username, "")
			if errV == nil {
				vouchersCount++
			}
		}
	}

	paramsJSON, _ := json.Marshal(req.Options)
	_, _ = s.db.Exec(`
		INSERT INTO invoice_batches (id, issuer_id, client_id, params, invoice_count, total_amount, status, created_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?, 'COMMITTED', ?, ?)
	`, batchID, req.IssuerID, req.ClientID, string(paramsJSON), createdCount, models.ToMinor(totalGrand), username, now)

	if req.DraftID != "" {
		_, _ = s.db.Exec(`
			UPDATE bulk_drafts SET status = 'COMMITTED', batch_id = ?, updated_at = ? WHERE id = ?
		`, batchID, now, req.DraftID)
	}

	return map[string]any{
		"batch_id":       batchID,
		"count":          createdCount,
		"total_amount":   math.Round(totalGrand*100) / 100,
		"vouchers_count": vouchersCount,
	}, nil
}

func init() {
	var _ = sql.ErrNoRows
}
