package services

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"slices"
	"strings"
	"time"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
	"raseen/internal/zatca"
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

	var clientID any
	if input.ClientID != "" {
		clientID = input.ClientID
	}

	if isNew {
		_, err := s.db.Exec(`
			INSERT INTO bulk_drafts (id, title, issuer_id, client_id, status, params, payload, invoice_count, grand_total, created_at, updated_at)
			VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
		`, id, input.Title, input.IssuerID, clientID, string(paramsJSON), string(payloadJSON), len(input.Invoices), totalMinor, now, now)
		if err != nil {
			return nil, err
		}
	} else {
		result, err := s.db.Exec(`
			UPDATE bulk_drafts SET title = ?, issuer_id = ?, client_id = ?, params = ?, payload = ?, invoice_count = ?, grand_total = ?, updated_at = ?
			WHERE id = ? AND status = 'DRAFT'
		`, input.Title, input.IssuerID, clientID, string(paramsJSON), string(payloadJSON), len(input.Invoices), totalMinor, now, id)
		if err != nil {
			return nil, err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return nil, errors.New("لا يمكن تعديل مسودة معتمدة أو غير موجودة")
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
	result, err := s.db.Exec("DELETE FROM bulk_drafts WHERE id = ? AND status = 'DRAFT'", id)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return errors.New("لا يمكن حذف مسودة معتمدة أو غير موجودة")
	}
	return nil
}

type CustomItemInput struct {
	NameAr    string  `json:"name_ar"`
	ItemCode  string  `json:"item_code"`
	Unit      string  `json:"unit"`
	SalePrice float64 `json:"sale_price"`
	TaxRate   float64 `json:"tax_rate"`
}

type PreviewRequest struct {
	IssuerID            string            `json:"issuer_id"`
	ClientID            string            `json:"client_id"`
	DateFrom            string            `json:"date_from"`
	DateTo              string            `json:"date_to"`
	Count               int               `json:"count"`
	TargetTotal         float64           `json:"target_total"`
	CategoryIDs         []string          `json:"category_ids"`
	ItemIDs             []string          `json:"item_ids"`
	CustomItems         []CustomItemInput `json:"custom_items"`
	DistributionMode    string            `json:"distribution_mode"`
	StartInvoiceNumber  string            `json:"start_invoice_number"`
	NumberGapMin        int               `json:"number_gap_min"`
	NumberGapMax        int               `json:"number_gap_max"`
	MinItems            int               `json:"min_items"`
	MaxItems            int               `json:"max_items"`
	MinQty              float64           `json:"min_qty"`
	MaxQty              float64           `json:"max_qty"`
	MinInvoiceTotal     float64           `json:"min_invoice_total"`
	MaxInvoiceTotal     float64           `json:"max_invoice_total"`
	DiscountEnabled     bool              `json:"discount_enabled"`
	DiscountMin         float64           `json:"discount_min_percent"`
	DiscountMax         float64           `json:"discount_max_percent"`
	DiscountProbability float64           `json:"discount_probability"`
	PriceJitter         float64           `json:"price_jitter_percent"`
	FractionQty         bool              `json:"allow_fraction_qty"`
	SkipWeekend         bool              `json:"skip_weekend"`
	WorkStart           int               `json:"work_start_minutes"`
	WorkEnd             int               `json:"work_end_minutes"`
	PaymentMethods      []string          `json:"payment_methods"`
	InvoiceType         string            `json:"invoice_type"`
	ZatcaPhase          string            `json:"zatca_phase"`
	Seed                int64             `json:"seed"`
	Notes               string            `json:"notes"`
}

type ItemCandidate struct {
	ID        *string
	NameAr    string
	ItemCode  string
	Unit      string
	SalePrice float64
	TaxRate   float64
}

// Spread the target over every selected item, with random relative quantities.
// Prices include each item's own tax rate; quantity limits apply to every line.
func bulkTargetQuantities(items []ItemCandidate, target int64, minQty, maxQty float64, fractional bool, rng *rand.Rand) []float64 {
	weights := make([]float64, len(items))
	prices := make([]float64, len(items))
	for i, it := range items {
		weights[i] = 0.75 + rng.Float64()*0.5
		price := it.SalePrice
		if price <= 0 {
			price = 100
		}
		prices[i] = price * (1 + it.TaxRate/100)
	}
	lo, hi := 0.0, maxQty/0.75
	for step := 0; step < 60; step++ {
		scale, total := (lo+hi)/2, 0.0
		for i := range items {
			total += math.Max(minQty, math.Min(maxQty, scale*weights[i])) * prices[i]
		}
		if total < models.ToMajor(target) {
			lo = scale
		} else {
			hi = scale
		}
	}
	quantities := make([]float64, len(items))
	for i := range items {
		qty := math.Max(minQty, math.Min(maxQty, (lo+hi)/2*weights[i]))
		if fractional {
			qty = math.Floor(qty*1000) / 1000
		} else {
			qty = math.Floor(qty)
		}
		quantities[i] = math.Max(minQty, math.Min(maxQty, qty))
	}
	lineTotal := func(i int, qty float64) int64 {
		gross := models.MulQty(qty, models.ToMinor(prices[i]/(1+items[i].TaxRate/100)))
		return gross + models.Pct(gross, items[i].TaxRate)
	}
	var total int64
	for i, qty := range quantities {
		total += lineTotal(i, qty)
	}
	stepSize := 1.0
	if fractional {
		stepSize = 0.001
	}
	// ponytail: bounded rounding refinement; exact combinations depend on catalog prices.
	for step := 0; step < len(items)*2; step++ {
		best, bestDelta, distance := -1, int64(0), math.Abs(float64(target-total))
		for i, qty := range quantities {
			if qty+stepSize > maxQty+1e-9 {
				continue
			}
			delta := lineTotal(i, qty+stepSize) - lineTotal(i, qty)
			if next := math.Abs(float64(target - total - delta)); delta > 0 && next < distance {
				best, bestDelta, distance = i, delta, next
			}
		}
		if best < 0 {
			break
		}
		quantities[best] = math.Round((quantities[best]+stepSize)*1000) / 1000
		total += bestDelta
	}
	return quantities
}

func parseInvoicePattern(pattern string, defaultPrefix string, defaultStartNo int64, defaultPad int) (prefix string, startNo int64, pad int) {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		p := defaultPrefix
		if p == "" {
			p = "INV"
		}
		s := defaultStartNo
		if s <= 0 {
			s = 1
		}
		pd := defaultPad
		if pd <= 0 {
			pd = 5
		}
		return p, s, pd
	}

	i := len(pattern) - 1
	for i >= 0 && pattern[i] >= '0' && pattern[i] <= '9' {
		i--
	}
	prefix = strings.TrimSuffix(pattern[:i+1], "-")
	digitsStr := pattern[i+1:]
	if digitsStr == "" {
		p := strings.TrimSuffix(pattern, "-")
		s := defaultStartNo
		if s <= 0 {
			s = 1
		}
		pd := defaultPad
		if pd <= 0 {
			pd = 5
		}
		return p, s, pd
	}

	var num int64
	fmt.Sscanf(digitsStr, "%d", &num)
	return prefix, num, len(digitsStr)
}

func (s *BulkService) GeneratePreview(req PreviewRequest) (map[string]any, error) {
	if req.IssuerID == "" || req.ClientID == "" {
		return nil, errors.New("يجب تحديد المنشأة المصدرة")
	}
	issuer, err := s.issuers.GetIssuer(req.IssuerID)
	if err != nil {
		return nil, err
	}
	if req.Count <= 0 || req.Count > 5000 {
		return nil, errors.New("عدد الفواتير يجب أن يكون من 1 إلى 5000")
	}
	distMode := strings.ToLower(strings.TrimSpace(req.DistributionMode))
	if distMode != "" && distMode != "random" && distMode != "balanced" && distMode != "uniform" && distMode != "sequential" {
		return nil, errors.New("نمط توزيع غير مدعوم")
	}
	if !validAmount(req.MinInvoiceTotal) || !validAmount(req.MaxInvoiceTotal) || !validAmount(req.TargetTotal) || (req.MaxInvoiceTotal > 0 && req.MinInvoiceTotal > req.MaxInvoiceTotal) {
		return nil, errors.New("حدود المبالغ غير صالحة")
	}
	if !validAmount(req.DiscountMin) || !validAmount(req.DiscountMax) || req.DiscountMin > req.DiscountMax || req.DiscountMax > 100 || !validAmount(req.DiscountProbability) || req.DiscountProbability > 1 || !validAmount(req.PriceJitter) || req.PriceJitter > 100 {
		return nil, errors.New("إعدادات الخصومات والأسعار غير صالحة")
	}
	if req.WorkEnd == 0 {
		req.WorkStart, req.WorkEnd = 8*60, 18*60
	}
	if req.WorkStart < 0 || req.WorkEnd > 24*60 || req.WorkEnd <= req.WorkStart {
		return nil, errors.New("نطاق ساعات العمل غير صالح")
	}
	if req.InvoiceType == "" {
		req.InvoiceType = "STANDARD"
	}
	if req.InvoiceType != "STANDARD" && req.InvoiceType != "SIMPLIFIED" {
		return nil, errors.New("نوع فاتورة غير صالح")
	}
	if req.ZatcaPhase == "" {
		req.ZatcaPhase = issuer.ZatcaPhase
	}
	if req.ZatcaPhase == "" {
		req.ZatcaPhase = "PHASE1"
	}
	if req.ZatcaPhase != "PHASE1" && req.ZatcaPhase != "PHASE2" {
		return nil, errors.New("مرحلة الفوترة غير صالحة")
	}
	if len(req.PaymentMethods) == 0 {
		req.PaymentMethods = []string{"CREDIT"}
	}
	for _, p := range req.PaymentMethods {
		if _, ok := invoicePaymentLabels[p]; !ok {
			return nil, errors.New("طريقة سداد غير صالحة")
		}
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
		if err != nil {
			return nil, err
		}
		if cli != nil {
			clientName = cli.Name
			clientCode = cli.ClientCode
		}
	}

	availableItems := make([]ItemCandidate, 0)
	if len(req.CustomItems) > 0 {
		var autoCodeIdx int = 1
		for _, ci := range req.CustomItems {
			rate := ci.TaxRate
			if strings.TrimSpace(ci.NameAr) == "" || !validAmount(ci.SalePrice) || !validAmount(rate) || rate > 100 {
				return nil, errors.New("بيانات الصنف المخصص غير صالحة")
			}
			code := strings.TrimSpace(ci.ItemCode)
			if code == "" {
				code = fmt.Sprintf("ITM-%04d", autoCodeIdx)
				autoCodeIdx++
			}
			availableItems = append(availableItems, ItemCandidate{
				NameAr:    ci.NameAr,
				ItemCode:  code,
				Unit:      ci.Unit,
				SalePrice: ci.SalePrice,
				TaxRate:   rate,
			})
		}
	} else {
		dbItems, err := s.items.ListItems("", "", true)
		if err != nil {
			return nil, err
		}
		for _, it := range dbItems {
			if len(req.CategoryIDs) > 0 && (it.CategoryID == nil || !slices.Contains(req.CategoryIDs, *it.CategoryID)) {
				continue
			}
			if len(req.ItemIDs) > 0 && !slices.Contains(req.ItemIDs, it.ID) {
				continue
			}
			id := it.ID
			availableItems = append(availableItems, ItemCandidate{
				ID:        &id,
				NameAr:    it.NameAr,
				ItemCode:  it.ItemCode,
				Unit:      it.Unit,
				SalePrice: it.SalePriceMajor,
				TaxRate:   it.TaxRate,
			})
		}
	}

	if len(availableItems) == 0 {
		return nil, errors.New("لا توجد أصناف مطابقة للاختيار")
	}

	minItems := req.MinItems
	if minItems <= 0 {
		minItems = 1
	}
	maxItems := req.MaxItems
	if maxItems == 0 {
		maxItems = minItems
	}
	if maxItems < minItems || minItems > len(availableItems) || maxItems > 100 || req.Count*maxItems > 100000 {
		return nil, errors.New("حدود عدد البنود غير صالحة أو تتجاوز حجم الدفعة المسموح")
	}
	maxItems = min(maxItems, len(availableItems))

	minQty := req.MinQty
	if minQty <= 0 {
		minQty = 1
	}
	maxQty := req.MaxQty
	if maxQty == 0 {
		maxQty = minQty
	}
	if !validAmount(minQty) || !validAmount(maxQty) || maxQty < minQty || maxQty > 1e6 {
		return nil, errors.New("حدود الكميات غير صالحة")
	}
	if !req.FractionQty && (math.Trunc(minQty) != minQty || math.Trunc(maxQty) != maxQty) {
		return nil, errors.New("فعّل الكميات الكسرية أو أدخل كميات صحيحة")
	}

	tFrom, errFrom := time.Parse("2006-01-02", req.DateFrom)
	tTo, errTo := time.Parse("2006-01-02", req.DateTo)
	if errFrom != nil || errTo != nil || tTo.Before(tFrom) {
		return nil, errors.New("الفترة الزمنية غير صالحة")
	}
	daySpan := int(tTo.Sub(tFrom).Hours() / 24)
	if daySpan < 0 {
		daySpan = 0
	}

	if daySpan > 3660 {
		return nil, errors.New("الفترة تتجاوز عشر سنوات")
	}
	var days []time.Time
	for day := tFrom; !day.After(tTo); day = day.AddDate(0, 0, 1) {
		if !req.SkipWeekend || (day.Weekday() != time.Friday && day.Weekday() != time.Saturday) {
			days = append(days, day)
		}
	}
	if len(days) == 0 {
		return nil, errors.New("الفترة لا تحتوي أيام عمل")
	}
	seed := req.Seed
	if seed == 0 {
		seed = time.Now().UnixNano()
	}
	rng := rand.New(rand.NewSource(seed))

	minGap := req.NumberGapMin
	maxGap := req.NumberGapMax
	if minGap <= 0 && maxGap <= 0 {
		// فوارق أرقام واقعية غير متسلسلة تلقائياً (بين 2 و 7 أرقام بين كل فاتورة)
		minGap = 2
		maxGap = 7
	} else if minGap <= 0 {
		minGap = 1
	} else if maxGap < minGap {
		maxGap = minGap
	}

	prefix, currInvoiceNo, pad := parseInvoicePattern(req.StartInvoiceNumber, issuer.InvoicePrefix, issuer.InvoiceNextNo, issuer.InvoicePad)

	// Pre-allocate invoice targets if TargetTotal is specified
	targetPerInv := make([]int64, req.Count)
	if req.TargetTotal > 0 {
		totalTargetMinor := models.ToMinor(req.TargetTotal)
		base := totalTargetMinor / int64(req.Count)
		rem := totalTargetMinor % int64(req.Count)
		for idx := range targetPerInv {
			targetPerInv[idx] = base
		}
		for idx := int64(0); idx < rem; idx++ {
			targetPerInv[idx]++
		}
		// Move random amounts between random invoices, preserving the batch target.
		// Explicit invoice bounds take precedence over the default wider spread.
		lower, upper := max(int64(1), base*55/100), base*145/100
		if req.MinInvoiceTotal > 0 {
			lower = models.ToMinor(req.MinInvoiceTotal)
		}
		if req.MaxInvoiceTotal > 0 {
			upper = models.ToMinor(req.MaxInvoiceTotal)
		}
		if base < lower || base > upper || (rem > 0 && base+1 > upper) {
			return nil, errors.New("المبلغ المستهدف لا يتوافق مع عدد الفواتير وحدود مبلغ الفاتورة")
		}
		if req.Count > 1 && distMode != "uniform" {
			for step := 0; step < req.Count*8; step++ {
				a, b := rng.Intn(req.Count), rng.Intn(req.Count)
				if a == b {
					continue
				}
				room := min(targetPerInv[a]-lower, upper-targetPerInv[b])
				if room > 0 {
					transfer := rng.Int63n(room + 1)
					targetPerInv[a] -= transfer
					targetPerInv[b] += transfer
				}
			}
		}
	}

	type invDateTime struct {
		DateStr string
		TimeStr string
		TimeVal time.Time
	}

	dateTimes := make([]invDateTime, req.Count)
	for i := 0; i < req.Count; i++ {
		var dayIndex int
		if req.DistributionMode == "uniform" || req.DistributionMode == "balanced" {
			dayIndex = i * len(days) / req.Count
		} else {
			dayIndex = rng.Intn(len(days))
		}
		day := days[dayIndex]
		minute := req.WorkStart + rng.Intn(req.WorkEnd-req.WorkStart)
		sec := rng.Intn(60)
		tVal := time.Date(day.Year(), day.Month(), day.Day(), minute/60, minute%60, sec, 0, day.Location())
		dateTimes[i] = invDateTime{
			DateStr: day.Format("2006-01-02"),
			TimeStr: fmt.Sprintf("%02d:%02d:%02d", minute/60, minute%60, sec),
			TimeVal: tVal,
		}
	}

	// فرز التواريخ والأوقات تصاعدياً من الأقدم للأحدث لضمان التوافق الزمني التام مع أرقام الفواتير
	// بحيث تكون الفاتورة الأقدم تاريخاً ذات رقم تسلسلي أسبق، والفاتورة الأحدث ذات رقم تسلسلي لاحق
	slices.SortFunc(dateTimes, func(a, b invDateTime) int {
		if a.TimeVal.Before(b.TimeVal) {
			return -1
		}
		if a.TimeVal.After(b.TimeVal) {
			return 1
		}
		return 0
	})

	invoices := make([]map[string]any, 0, req.Count)
	var totalSubtotal, totalDiscount, totalTax, totalGrand float64

	for i := 0; i < req.Count; i++ {
		invDate := dateTimes[i].DateStr
		invTime := dateTimes[i].TimeStr

		linesCount := minItems + rng.Intn(maxItems-minItems+1)

		lines := make([]map[string]any, 0, linesCount)
		var invSubtotal, invDiscount, invTax, invTotal float64

		perm := rng.Perm(len(availableItems))
		invTargetMinor := int64(0)
		if req.TargetTotal > 0 {
			if i == req.Count-1 {
				// Last invoice gets exactly whatever is remaining to hit target
				invTargetMinor = models.ToMinor(req.TargetTotal) - models.ToMinor(totalGrand)
			} else {
				invTargetMinor = targetPerInv[i]
			}
		}

		selected := make([]ItemCandidate, linesCount)
		for l := range selected {
			if distMode == "sequential" {
				selected[l] = availableItems[(i*linesCount+l)%len(availableItems)]
			} else {
				selected[l] = availableItems[perm[l]]
			}
		}
		var targetQuantities []float64
		if invTargetMinor > 0 {
			minimumCost := func(it ItemCandidate) int64 {
				price := it.SalePrice
				if price <= 0 {
					price = 100
				}
				gross := models.MulQty(minQty, models.ToMinor(price))
				return gross + models.Pct(gross, it.TaxRate)
			}
			var minimumTotal int64
			for _, it := range selected {
				minimumTotal += minimumCost(it)
			}
			if minimumTotal > invTargetMinor {
				// Start with the cheapest items to fit as many distinct items as possible.
				slices.SortStableFunc(perm, func(a, b int) int {
					return int(minimumCost(availableItems[a]) - minimumCost(availableItems[b]))
				})
				selected, minimumTotal = selected[:0], 0
				for _, index := range perm {
					cost := minimumCost(availableItems[index])
					if len(selected) == linesCount || minimumTotal+cost > invTargetMinor {
						break
					}
					selected = append(selected, availableItems[index])
					minimumTotal += cost
				}
				if len(selected) < minItems {
					return nil, fmt.Errorf("مبلغ الفاتورة %d لا يكفي للحد الأدنى من الأصناف والكميات؛ خفّض الحدود أو ارفع المبلغ", i+1)
				}
				rng.Shuffle(len(selected), func(a, b int) { selected[a], selected[b] = selected[b], selected[a] })
				linesCount = len(selected)
			}
			var maximumTotal float64
			for _, it := range selected {
				price := it.SalePrice
				if price <= 0 {
					price = 100
				}
				maximumTotal += maxQty * price * (1 + it.TaxRate/100) * (1 + req.PriceJitter/100)
			}
			if models.ToMajor(invTargetMinor) > maximumTotal+0.01 {
				return nil, fmt.Errorf("مبلغ الفاتورة %d يتجاوز ما تسمح به أسعار الأصناف وحدود الكميات؛ ارفع الحد الأعلى للكميات أو عدد الأصناف", i+1)
			}
			targetQuantities = bulkTargetQuantities(selected, invTargetMinor, minQty, maxQty, req.FractionQty, rng)
		} else if req.TargetTotal > 0 {
			return nil, errors.New("المبلغ المستهدف لا يكفي لتوزيعه على الفواتير المحددة")
		}
		for l, it := range selected {

			price := it.SalePrice
			if price <= 0 {
				price = 100.0
			}
			taxRate := it.TaxRate

			var qty float64
			isLastLine := (l == linesCount-1)

			if invTargetMinor > 0 && isLastLine {
				// Balance the final line so invoice approaches invTargetMinor
				remainingInvMinor := invTargetMinor - models.ToMinor(invTotal)
				if remainingInvMinor > 0 {
					remTaxable := float64(remainingInvMinor) / (1.0 + taxRate/100.0) / 100.0
					if remTaxable > 0 {
						calcQty := remTaxable / price
						if req.FractionQty {
							qty = math.Round(calcQty*1000) / 1000
						} else {
							qty = math.Round(calcQty)
						}
						qty = math.Max(minQty, math.Min(maxQty, qty))
						// Keep the existing target-price adjustment within quantity limits.
						price = math.Round((remTaxable/qty)*100) / 100
						if math.Abs(price-it.SalePrice) > it.SalePrice*req.PriceJitter/100+0.005 {
							// Keep catalog prices when the target is not representable within the configured range.
							price = it.SalePrice
							qty = targetQuantities[l]
						}
					} else {
						qty = minQty
					}
				} else {
					qty = minQty
				}
			} else if invTargetMinor > 0 {
				qty = targetQuantities[l]
			} else {
				qty = minQty
				if maxQty > minQty {
					qty = minQty + float64(rng.Intn(int(maxQty-minQty+1)))
					if req.FractionQty {
						qty = math.Round((minQty+rng.Float64()*(maxQty-minQty))*1000) / 1000
					}
				}
				if req.PriceJitter > 0 {
					price = math.Round(price*(1+(rng.Float64()*2-1)*req.PriceJitter/100)*100) / 100
				}
			}

			price = models.ToMajor(models.ToMinor(price))
			gross := models.MulQty(qty, models.ToMinor(price))
			discount := int64(0)
			if req.DiscountEnabled && rng.Float64() < req.DiscountProbability && !isLastLine {
				discount = models.Pct(gross, req.DiscountMin+rng.Float64()*(req.DiscountMax-req.DiscountMin))
			}
			taxable := gross - discount
			lineSub := models.ToMajor(taxable)
			lineTax := models.ToMajor(models.Pct(taxable, taxRate))
			lineTot := models.ToMajor(taxable + models.Pct(taxable, taxRate))

			lines = append(lines, map[string]any{
				"item_id":    it.ID,
				"item_name":  it.NameAr,
				"item_code":  it.ItemCode,
				"unit":       it.Unit,
				"quantity":   qty,
				"unit_price": price,
				"discount":   models.ToMajor(discount),
				"tax_rate":   taxRate,
				"taxable":    lineSub,
				"tax_amount": lineTax,
				"total_line": lineTot,
			})

			invSubtotal += models.ToMajor(gross)
			invDiscount += models.ToMajor(discount)
			invTax += lineTax
			invTotal += lineTot
		}

		invSubtotal = math.Round(invSubtotal*100) / 100
		invDiscount = math.Round(invDiscount*100) / 100
		invTax = math.Round(invTax*100) / 100
		invTotal = math.Round(invTotal*100) / 100
		if (req.MinInvoiceTotal > 0 && invTotal < req.MinInvoiceTotal) || (req.MaxInvoiceTotal > 0 && invTotal > req.MaxInvoiceTotal) {
			return nil, fmt.Errorf("الفاتورة %d خارج حدود القيمة المحددة؛ عدّل الأصناف أو الكميات أو المبلغ المستهدف", i+1)
		}

		if i > 0 {
			gap := minGap
			if maxGap > minGap {
				gap = minGap + rng.Intn(maxGap-minGap+1)
			}
			currInvoiceNo += int64(gap)
		}
		invNumber := crypto.FormatSerial(prefix, currInvoiceNo, pad)

		issTimeClean := invTime
		if len(issTimeClean) == 5 {
			issTimeClean += ":00"
		}
		timestamp := invDate + "T" + issTimeClean + "Z"
		totStr := fmt.Sprintf("%.2f", invTotal)
		vatStr := fmt.Sprintf("%.2f", invTax)
		sName := issuer.NameAr
		if sName == "" {
			sName = "شركة تجريبية للتقنية"
		}
		sTax := issuer.TaxNumber
		if sTax == "" || len(sTax) != 15 {
			sTax = "300000000000003"
		}
		qrParams := zatca.QrParams{
			SellerName: sName,
			VatNumber:  sTax,
			Timestamp:  timestamp,
			Total:      totStr,
			VatTotal:   vatStr,
		}
		invHash := ""
		if req.ZatcaPhase == "PHASE2" {
			qrParams = zatca.BuildPhase2Params(qrParams, invNumber)
			invHash = qrParams.InvoiceHash
		}
		qrPayload := zatca.BuildQrPayload(qrParams)

		invoices = append(invoices, map[string]any{
			"temp_id":         fmt.Sprintf("PREV-%04d", i+1),
			"invoice_number":  invNumber,
			"invoice_type":    req.InvoiceType,
			"zatca_phase":     req.ZatcaPhase,
			"qr_payload":      qrPayload,
			"invoice_hash":    invHash,
			"payment_method":  req.PaymentMethods[rng.Intn(len(req.PaymentMethods))],
			"notes":           req.Notes,
			"issue_date":      invDate,
			"issue_time":      invTime,
			"buyer_name":      clientName,
			"buyer_code":      clientCode,
			"subtotal":        invSubtotal,
			"discount_amount": invDiscount,
			"taxable_amount":  math.Round((invSubtotal-invDiscount)*100) / 100,
			"tax_amount":      invTax,
			"grand_total":     invTotal,
			"items":           lines,
			"lines":           lines,
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
		"taxable":     math.Round((totalSubtotal-totalDiscount)*100) / 100,
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
	RequestID     string `json:"request_id"`
	DraftID       string `json:"draft_id"`
	IssuerID      string `json:"issuer_id"`
	ClientID      string `json:"client_id"`
	Invoices      []any  `json:"invoices"`
	Options       any    `json:"options"`
	IssueVouchers bool   `json:"issue_vouchers"`
}

func (s *BulkService) CommitBatch(req CommitBatchRequest, username string) (map[string]any, error) {
	if req.IssuerID == "" || req.ClientID == "" || len(req.Invoices) == 0 || len(req.Invoices) > 5000 {
		return nil, errors.New("الشركة والعميل ودفعة من 1 إلى 5000 فاتورة مطلوبة")
	}
	key := req.RequestID
	if req.DraftID != "" {
		key = "draft:" + req.DraftID
	}
	if key == "" || len(key) > 200 {
		return nil, errors.New("معرف طلب الاعتماد مطلوب")
	}
	key = username + ":" + key
	encoded, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(encoded))
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var oldHash, oldResult string
	err = tx.QueryRow("SELECT request_hash,result_json FROM batch_requests WHERE request_key=?", key).Scan(&oldHash, &oldResult)
	if err == nil {
		if oldHash != hash {
			return nil, errors.New("معرف الطلب مستخدم لدفعة مختلفة")
		}
		var result map[string]any
		if err = json.Unmarshal([]byte(oldResult), &result); err != nil {
			return nil, err
		}
		return result, nil
	}
	if req.DraftID != "" {
		var issuerID, clientID, status string
		if err = tx.QueryRow("SELECT issuer_id,COALESCE(client_id,''),status FROM bulk_drafts WHERE id=?", req.DraftID).Scan(&issuerID, &clientID, &status); err != nil {
			return nil, err
		}
		if issuerID != req.IssuerID || clientID != req.ClientID || status != "DRAFT" {
			return nil, errors.New("المسودة معتمدة أو لا تطابق الشركة والعميل")
		}
	}
	batchID, now := crypto.UUID(), db.NowIso()
	if _, err = tx.Exec("INSERT INTO invoice_batches (id,issuer_id,client_id,params,status,created_by,created_at) VALUES (?,?,?,?,'COMMITTED',?,?)", batchID, req.IssuerID, req.ClientID, mustJSON(req.Options), username, now); err != nil {
		return nil, err
	}
	var total int64
	vouchers := 0
	ids := []string{}
	var maxGenNo int64
	for idx, raw := range req.Invoices {
		b, err := json.Marshal(raw)
		if err != nil {
			return nil, err
		}
		var row struct {
			CreateInvoiceInput
			Items []CreateInvoiceLineInput `json:"items"`
		}
		if err = json.Unmarshal(b, &row); err != nil {
			return nil, err
		}
		if (row.ClientID != "" && row.ClientID != req.ClientID) || (row.IssuerID != "" && row.IssuerID != req.IssuerID) {
			return nil, errors.New("فواتير الدفعة يجب أن تخص الشركة والعميل المحددين")
		}
		row.IssuerID, row.ClientID = req.IssuerID, req.ClientID
		if len(row.Items) > 0 && len(row.Lines) == 0 {
			row.Lines = row.Items
		}
		row.AutoReceipt = req.IssueVouchers
		if req.IssueVouchers && (row.PaymentMethod == "" || row.PaymentMethod == "CREDIT") {
			row.PaymentMethod = "TRANSFER"
		}
		if row.ZatcaPhase == "" {
			if optMap, ok := req.Options.(map[string]any); ok {
				if zp, ok := optMap["zatca_phase"].(string); ok && zp != "" {
					row.ZatcaPhase = zp
				}
			}
		}
		inv, err := s.invoices.createInvoiceTx(tx, row.CreateInvoiceInput, username, "")
		if err != nil {
			return nil, fmt.Errorf("الفاتورة %d: %w", idx+1, err)
		}
		if _, err = tx.Exec("UPDATE invoices SET batch_id=? WHERE id=?", batchID, inv.ID); err != nil {
			return nil, err
		}
		total += inv.GrandTotal
		ids = append(ids, inv.ID)
		if req.IssueVouchers && inv.GrandTotal > 0 {
			vouchers++
		}

		if inv.InvoiceNumber != "" {
			j := len(inv.InvoiceNumber) - 1
			for j >= 0 && inv.InvoiceNumber[j] >= '0' && inv.InvoiceNumber[j] <= '9' {
				j--
			}
			var parsed int64
			if _, errScan := fmt.Sscanf(inv.InvoiceNumber[j+1:], "%d", &parsed); errScan == nil && parsed > maxGenNo {
				maxGenNo = parsed
			}
		}
	}
	if maxGenNo > 0 {
		_, _ = tx.Exec("UPDATE issuers SET invoice_next_no = MAX(invoice_next_no, ?) WHERE id = ?", maxGenNo+1, req.IssuerID)
	}
	if _, err = tx.Exec("UPDATE invoice_batches SET invoice_count=?,total_amount=? WHERE id=?", len(ids), total, batchID); err != nil {
		return nil, err
	}
	if req.DraftID != "" {
		if _, err = tx.Exec("UPDATE bulk_drafts SET status='COMMITTED',batch_id=?,committed_ids=?,updated_at=? WHERE id=?", batchID, mustJSON(ids), now, req.DraftID); err != nil {
			return nil, err
		}
	}
	result := map[string]any{"batch_id": batchID, "count": len(ids), "total_amount": models.ToMajor(total), "vouchers_count": vouchers, "invoice_ids": ids}
	if _, err = tx.Exec("INSERT INTO batch_requests (request_key,request_hash,result_json) VALUES (?,?,?)", key, hash, mustJSON(result)); err != nil {
		return nil, err
	}
	if err = db.AuditTx(tx, username, "BULK_COMMIT", "batch", batchID, req.IssuerID, result, ""); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *BulkService) DeleteBatch(batchID, actor, ip string) error {
	if batchID == "" {
		return errors.New("معرف الدفعة مطلوب")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var issuerID string
	var invCount int
	err = tx.QueryRow("SELECT issuer_id, invoice_count FROM invoice_batches WHERE id = ?", batchID).Scan(&issuerID, &invCount)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("الدفعة غير موجودة")
		}
		return err
	}
	var signed int
	if err = tx.QueryRow("SELECT COUNT(*) FROM invoices WHERE batch_id=? AND signature_mode NOT IN ('LOCAL','NONE')", batchID).Scan(&signed); err != nil {
		return err
	}
	if signed > 0 {
		return errors.New("الدفعة تحتوي على مستندات بتوقيع إنتاجي؛ لا يمكن حذفها")
	}

	rows, err := tx.Query("SELECT id FROM invoices WHERE batch_id = ?", batchID)
	if err != nil {
		return err
	}
	var invIDs []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		invIDs = append(invIDs, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	// A receipt may also settle invoices outside this batch. Never remove it implicitly.
	var sharedVouchers int
	if err = tx.QueryRow(`SELECT COUNT(DISTINCT a.voucher_id)
		FROM voucher_allocations a JOIN invoices i ON i.id = a.invoice_id
		WHERE i.batch_id = ? AND EXISTS (
			SELECT 1 FROM voucher_allocations other
			LEFT JOIN invoices oi ON oi.id = other.invoice_id
			WHERE other.voucher_id = a.voucher_id AND (oi.id IS NULL OR oi.batch_id IS NULL OR oi.batch_id <> ?)
		)`, batchID, batchID).Scan(&sharedVouchers); err != nil {
		return err
	}
	if sharedVouchers > 0 {
		return errors.New("توجد سندات مرتبطة بفواتير خارج الدفعة؛ ألغِ تلك التخصيصات أولاً")
	}

	for _, id := range invIDs {
		vRows, errV := tx.Query("SELECT voucher_id FROM voucher_allocations WHERE invoice_id = ?", id)
		if errV != nil {
			return errV
		}
		var vIDs []string
		for vRows.Next() {
			var vid string
			if err = vRows.Scan(&vid); err != nil {
				vRows.Close()
				return err
			}
			vIDs = append(vIDs, vid)
		}
		err = vRows.Err()
		vRows.Close()
		if err != nil {
			return err
		}

		for _, vid := range vIDs {
			if _, err = tx.Exec("DELETE FROM client_ledger WHERE doc_id = ? AND doc_type IN ('RECEIPT', 'RECEIPT_CANCEL', 'PAYMENT')", vid); err != nil {
				return err
			}
			if _, err = tx.Exec("DELETE FROM document_pdfs WHERE kind='voucher' AND document_id=?", vid); err != nil {
				return err
			}
			if _, err = tx.Exec("DELETE FROM receipt_vouchers WHERE id = ?", vid); err != nil {
				return err
			}
		}

		if _, err = tx.Exec("DELETE FROM client_ledger WHERE doc_id = ? AND doc_type IN ('INVOICE', 'INVOICE_CANCEL')", id); err != nil {
			return err
		}
		if _, err = tx.Exec("DELETE FROM document_pdfs WHERE kind='invoice' AND document_id=?", id); err != nil {
			return err
		}
	}

	if _, err := tx.Exec("DELETE FROM invoices WHERE batch_id = ?", batchID); err != nil {
		return err
	}
	if err = s.invoices.rebuildInvoiceChainTx(tx, issuerID); err != nil {
		return err
	}

	if _, err := tx.Exec("DELETE FROM invoice_batches WHERE id = ?", batchID); err != nil {
		return err
	}

	_, _ = tx.Exec("DELETE FROM batch_requests WHERE result_json LIKE ?", "%"+batchID+"%")

	now := db.NowIso()
	_, _ = tx.Exec("UPDATE bulk_drafts SET status = 'DRAFT', batch_id = NULL, committed_ids = NULL, updated_at = ? WHERE batch_id = ?", now, batchID)

	if err := db.AuditTx(tx, actor, "BULK_BATCH_DELETE", "batch", batchID, issuerID, map[string]any{
		"deleted_invoices_count": len(invIDs),
	}, ip); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *BulkService) GenerateBatchVouchers(batchID string, paymentType, voucherDate, actor, ip string) (map[string]any, error) {
	if batchID == "" {
		return nil, errors.New("معرف الدفعة مطلوب")
	}
	if paymentType == "" {
		paymentType = "TRANSFER"
	}
	if voucherDate == "" {
		voucherDate = time.Now().Format("2006-01-02")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var issuerID, clientID string
	err = tx.QueryRow("SELECT issuer_id, client_id FROM invoice_batches WHERE id = ?", batchID).Scan(&issuerID, &clientID)
	if err != nil {
		return nil, errors.New("الدفعة غير موجودة")
	}

	rows, err := tx.Query(`
		SELECT id, invoice_number, remaining_amount, grand_total, issue_date
		FROM invoices
		WHERE batch_id = ? AND status != 'CANCELLED' AND remaining_amount > 0
		ORDER BY sequence_no ASC, invoice_number ASC
	`, batchID)
	if err != nil {
		return nil, err
	}

	type invRow struct {
		id        string
		invNo     string
		remaining int64
		grand     int64
		date      string
	}
	var invoices []invRow
	for rows.Next() {
		var r invRow
		if errScan := rows.Scan(&r.id, &r.invNo, &r.remaining, &r.grand, &r.date); errScan == nil {
			invoices = append(invoices, r)
		}
	}
	rows.Close()

	if len(invoices) == 0 {
		return nil, errors.New("لا توجد فواتير متبقية بدون سداد في هذه الدفعة")
	}

	nowIso := db.NowIso()
	var totalVoucherAmount int64
	vouchersCount := 0

	for _, inv := range invoices {
		voucherNo, _, errV := s.issuers.NextVoucherNumber(tx, issuerID)
		if errV != nil {
			return nil, errV
		}
		voucherID := crypto.UUID()
		allocID := crypto.UUID()
		ledgerID := crypto.UUID()
		amount := inv.remaining

		vDate := voucherDate
		if vDate == "" {
			vDate = inv.date
		}

		notes := fmt.Sprintf("سند قبض للدفعة — سداد فاتورة رقم %s", inv.invNo)

		_, err = tx.Exec(`
			INSERT INTO receipt_vouchers (
				id, voucher_number, issuer_id, client_id, voucher_date,
				total_amount, allocated_total, payment_type, reference_no, notes,
				status, created_by, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
		`, voucherID, voucherNo, issuerID, clientID, vDate, amount, amount, paymentType, inv.invNo, notes, actor, nowIso, nowIso)
		if err != nil {
			return nil, err
		}

		_, err = tx.Exec(`
			INSERT INTO voucher_allocations (id, voucher_id, invoice_id, allocated_amount, created_at)
			VALUES (?, ?, ?, ?, ?)
		`, allocID, voucherID, inv.id, amount, nowIso)
		if err != nil {
			return nil, err
		}

		_, err = tx.Exec(`
			UPDATE invoices
			SET paid_amount = grand_total, remaining_amount = 0, status = 'PAID', updated_at = ?
			WHERE id = ?
		`, nowIso, inv.id)
		if err != nil {
			return nil, err
		}

		_, err = tx.Exec(`
			INSERT INTO client_ledger (
				id, client_id, issuer_id, doc_type, doc_id, doc_number,
				transaction_date, debit, credit, description, created_at
			) VALUES (?, ?, ?, 'RECEIPT', ?, ?, ?, 0, ?, ?, ?)
		`, ledgerID, clientID, issuerID, voucherID, voucherNo, vDate, amount, notes, nowIso)
		if err != nil {
			return nil, err
		}

		totalVoucherAmount += amount
		vouchersCount++
	}

	res := map[string]any{
		"ok":           true,
		"count":        vouchersCount,
		"total_amount": models.ToMajor(totalVoucherAmount),
		"batch_id":     batchID,
	}

	_ = db.AuditTx(tx, actor, "BULK_BATCH_GENERATE_VOUCHERS", "batch", batchID, issuerID, res, ip)

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return res, nil
}
