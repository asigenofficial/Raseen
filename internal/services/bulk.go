package services

import (
	"crypto/sha256"
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
		if n,err := result.RowsAffected(); err != nil || n!=1 { return nil,errors.New("لا يمكن تعديل مسودة معتمدة أو غير موجودة") }
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
	if err != nil { return err }
	if n,err := result.RowsAffected(); err != nil || n!=1 { return errors.New("لا يمكن حذف مسودة معتمدة أو غير موجودة") };return nil
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
	DiscountEnabled bool `json:"discount_enabled"`
	DiscountMin float64 `json:"discount_min_percent"`
	DiscountMax float64 `json:"discount_max_percent"`
	DiscountProbability float64 `json:"discount_probability"`
	PriceJitter float64 `json:"price_jitter_percent"`
	FractionQty bool `json:"allow_fraction_qty"`
	SkipWeekend bool `json:"skip_weekend"`
	WorkStart int `json:"work_start_minutes"`
	WorkEnd int `json:"work_end_minutes"`
	PaymentMethods []string `json:"payment_methods"`
	InvoiceType string `json:"invoice_type"`
	Seed int64 `json:"seed"`
	Notes string `json:"notes"`
}

type ItemCandidate struct {
	ID *string
	NameAr    string
	ItemCode  string
	Unit      string
	SalePrice float64
	TaxRate   float64
}

func (s *BulkService) GeneratePreview(req PreviewRequest) (map[string]any, error) {
	if req.IssuerID == "" || req.ClientID == "" {
		return nil, errors.New("يجب تحديد المنشأة المصدرة")
	}
	if _,err:=s.issuers.GetIssuer(req.IssuerID);err!=nil{return nil,err}
	if req.Count <= 0 || req.Count > 5000 { return nil,errors.New("عدد الفواتير يجب أن يكون من 1 إلى 5000") }
	if req.DistributionMode != "" && req.DistributionMode != "random" && req.DistributionMode != "balanced" && req.DistributionMode != "uniform" { return nil,errors.New("نمط توزيع غير مدعوم") }
	if !validAmount(req.MinInvoiceTotal)||!validAmount(req.MaxInvoiceTotal)||!validAmount(req.TargetTotal) || (req.MaxInvoiceTotal>0 && req.MinInvoiceTotal>req.MaxInvoiceTotal) {return nil,errors.New("حدود المبالغ غير صالحة")}
	if !validAmount(req.DiscountMin)||!validAmount(req.DiscountMax)||req.DiscountMin>req.DiscountMax||req.DiscountMax>100||!validAmount(req.DiscountProbability)||req.DiscountProbability>1||!validAmount(req.PriceJitter)||req.PriceJitter>100{return nil,errors.New("إعدادات الخصومات والأسعار غير صالحة")}
	if req.WorkEnd==0 {req.WorkStart,req.WorkEnd=8*60,18*60}
	if req.WorkStart<0||req.WorkEnd>24*60||req.WorkEnd<=req.WorkStart{return nil,errors.New("نطاق ساعات العمل غير صالح")}
	if req.InvoiceType==""{req.InvoiceType="STANDARD"}
	if req.InvoiceType!="STANDARD"&&req.InvoiceType!="SIMPLIFIED"{return nil,errors.New("نوع فاتورة غير صالح")}
	if len(req.PaymentMethods)==0{req.PaymentMethods=[]string{"CREDIT"}}
	for _,p:=range req.PaymentMethods{if _,ok:=invoicePaymentLabels[p];!ok{return nil,errors.New("طريقة سداد غير صالحة")}}

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
		if err != nil {return nil,err}
		if err == nil && cli != nil {
			clientName = cli.Name
			clientCode = cli.ClientCode
		}
	}

	availableItems := make([]ItemCandidate, 0)
	if len(req.CustomItems) > 0 {
		for _, ci := range req.CustomItems {
			rate := ci.TaxRate
			if strings.TrimSpace(ci.NameAr)==""||!validAmount(ci.SalePrice)||!validAmount(rate)||rate>100{return nil,errors.New("بيانات الصنف المخصص غير صالحة")}
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
		if err != nil {return nil,err}
		if err == nil {
			for _, it := range dbItems {
				if len(req.CategoryIDs)>0&&(it.CategoryID==nil||!slices.Contains(req.CategoryIDs,*it.CategoryID)){continue}
				if len(req.ItemIDs)>0&&!slices.Contains(req.ItemIDs,it.ID){continue}
				id:=it.ID
				availableItems = append(availableItems, ItemCandidate{
					ID: &id,
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
		return nil,errors.New("لا توجد أصناف مطابقة للاختيار")
	}

	minItems := req.MinItems
	if minItems <= 0 {
		minItems = 1
	}
	maxItems := req.MaxItems
	if maxItems == 0 {
		maxItems = minItems
	}
	if maxItems<minItems||minItems>len(availableItems)||maxItems>100||req.Count*maxItems>100000{return nil,errors.New("حدود عدد البنود غير صالحة أو تتجاوز حجم الدفعة المسموح")}
	maxItems=min(maxItems,len(availableItems))

	minQty := req.MinQty
	if minQty <= 0 {
		minQty = 1
	}
	maxQty := req.MaxQty
	if maxQty == 0 {
		maxQty = minQty
	}
	if !validAmount(minQty)||!validAmount(maxQty)||maxQty<minQty||maxQty>1e6{return nil,errors.New("حدود الكميات غير صالحة")}
	if !req.FractionQty&&(math.Trunc(minQty)!=minQty||math.Trunc(maxQty)!=maxQty){return nil,errors.New("فعّل الكميات الكسرية أو أدخل كميات صحيحة")}

	tFrom, errFrom := time.Parse("2006-01-02", req.DateFrom)
	tTo, errTo := time.Parse("2006-01-02", req.DateTo)
	if errFrom != nil || errTo != nil || tTo.Before(tFrom) {
		return nil,errors.New("الفترة الزمنية غير صالحة")
	}
	daySpan := int(tTo.Sub(tFrom).Hours() / 24)
	if daySpan < 0 {
		daySpan = 0
	}

	if daySpan>3660{return nil,errors.New("الفترة تتجاوز عشر سنوات")}
	var days []time.Time
	for day:=tFrom;!day.After(tTo);day=day.AddDate(0,0,1){if !req.SkipWeekend||(day.Weekday()!=time.Friday&&day.Weekday()!=time.Saturday){days=append(days,day)}}
	if len(days)==0{return nil,errors.New("الفترة لا تحتوي أيام عمل")}
	seed:=req.Seed;if seed==0{seed=time.Now().UnixNano()}
	rng := rand.New(rand.NewSource(seed))

	invoices := make([]map[string]any, 0, req.Count)
	var totalSubtotal, totalDiscount, totalTax, totalGrand float64
	seen:=map[string]bool{}
	attempts:=0

	for i := 0; i < req.Count; i++ {
		attempts++
		if attempts>max(1000,req.Count*100){return nil,errors.New("تعذر تحقيق القيود والمجموع ضمن المحاولات المحددة؛ وسّع الحدود أو عدّل الأصناف")}
		dayIndex:=rng.Intn(len(days));if req.DistributionMode=="uniform"||req.DistributionMode=="balanced"{dayIndex=i*len(days)/req.Count}
		invDate := days[dayIndex].Format("2006-01-02")
		minute:=req.WorkStart+rng.Intn(req.WorkEnd-req.WorkStart)
		invTime := fmt.Sprintf("%02d:%02d:%02d",minute/60,minute%60,rng.Intn(60))

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
				if req.FractionQty {qty=math.Round((minQty+rng.Float64()*(maxQty-minQty))*1000)/1000}
			}
			price := it.SalePrice
			if req.PriceJitter>0{price=math.Round(price*(1+(rng.Float64()*2-1)*req.PriceJitter/100)*100)/100}
			taxRate := it.TaxRate
			price=models.ToMajor(models.ToMinor(price))
			gross:=models.MulQty(qty,models.ToMinor(price))
			discount:=int64(0)
			if req.DiscountEnabled&&rng.Float64()<req.DiscountProbability{discount=models.Pct(gross,req.DiscountMin+rng.Float64()*(req.DiscountMax-req.DiscountMin))}
			taxable:=gross-discount
			lineSub:=models.ToMajor(taxable)
			lineTax:=models.ToMajor(models.Pct(taxable,taxRate))
			lineTot:=models.ToMajor(taxable+models.Pct(taxable,taxRate))

			lines = append(lines, map[string]any{
				"item_id": it.ID,
				"item_name":   it.NameAr,
				"item_code":   it.ItemCode,
				"unit":        it.Unit,
				"quantity":    qty,
				"unit_price":  price,
				"discount":    models.ToMajor(discount),
				"tax_rate":    taxRate,
				"taxable":     lineSub,
				"tax_amount":  lineTax,
				"total_line":  lineTot,
			})

			invSubtotal += models.ToMajor(gross)
			invDiscount += models.ToMajor(discount)
			invTax += lineTax
			invTotal += lineTot
		}

		invSubtotal = math.Round(invSubtotal*100) / 100
		invTax = math.Round(invTax*100) / 100
		invTotal = math.Round(invTotal*100) / 100
		if invTotal<req.MinInvoiceTotal||(req.MaxInvoiceTotal>0&&invTotal>req.MaxInvoiceTotal){i--;continue}
		if req.TargetTotal>0 {
			remaining:=models.ToMinor(req.TargetTotal)-models.ToMinor(totalGrand)-models.ToMinor(invTotal)
			left:=req.Count-i-1
			if remaining<0||(left==0&&remaining!=0)||(left>0&&(remaining<int64(left)*models.ToMinor(req.MinInvoiceTotal)||(req.MaxInvoiceTotal>0&&remaining>int64(left)*models.ToMinor(req.MaxInvoiceTotal)))){i--;continue}
		}
		fingerprints:=make([]string,0,len(lines));for _,line:=range lines{fingerprints=append(fingerprints,mustJSON(line))};slices.Sort(fingerprints)
		fingerprint:=strings.Join(fingerprints,"|")
		if seen[fingerprint]&&attempts < (i+1)*10 {i--;continue};seen[fingerprint]=true

		invoices = append(invoices, map[string]any{
			"temp_id":         fmt.Sprintf("PREV-%04d", i+1),
			"invoice_number":  "",
			"invoice_type": req.InvoiceType,
			"payment_method": req.PaymentMethods[rng.Intn(len(req.PaymentMethods))],
			"notes": req.Notes,
			"issue_date":      invDate,
			"issue_time":      invTime,
			"buyer_name":      clientName,
			"buyer_code":      clientCode,
			"subtotal":        invSubtotal,
			"discount_amount": invDiscount,
			"taxable_amount":  math.Round((invSubtotal-invDiscount)*100)/100,
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
	if req.IssuerID == "" || req.ClientID == "" || len(req.Invoices) == 0 || len(req.Invoices) > 5000 { return nil,errors.New("الشركة والعميل ودفعة من 1 إلى 5000 فاتورة مطلوبة") }
	key := req.RequestID
	if req.DraftID != "" { key = "draft:"+req.DraftID }
	if key == "" || len(key)>200 { return nil,errors.New("معرف طلب الاعتماد مطلوب") }
	key = username+":"+key
	encoded,err:=json.Marshal(req);if err!=nil{return nil,err}
	hash:=fmt.Sprintf("%x",sha256.Sum256(encoded))
	tx,err:=s.db.Begin();if err!=nil{return nil,err};defer tx.Rollback()
	var oldHash, oldResult string
	err=tx.QueryRow("SELECT request_hash,result_json FROM batch_requests WHERE request_key=?",key).Scan(&oldHash,&oldResult)
	if err==nil {
		if oldHash!=hash{return nil,errors.New("معرف الطلب مستخدم لدفعة مختلفة")}
		var result map[string]any
		if err=json.Unmarshal([]byte(oldResult),&result);err!=nil{return nil,err};return result,nil
	}
	if req.DraftID!="" {
		var issuerID,clientID,status string
		if err=tx.QueryRow("SELECT issuer_id,COALESCE(client_id,''),status FROM bulk_drafts WHERE id=?",req.DraftID).Scan(&issuerID,&clientID,&status);err!=nil{return nil,err}
		if issuerID!=req.IssuerID || clientID!=req.ClientID || status!="DRAFT" {return nil,errors.New("المسودة معتمدة أو لا تطابق الشركة والعميل")}
	}
	batchID,now:=crypto.UUID(),db.NowIso()
	if _,err=tx.Exec("INSERT INTO invoice_batches (id,issuer_id,client_id,params,status,created_by,created_at) VALUES (?,?,?,?,'COMMITTED',?,?)",batchID,req.IssuerID,req.ClientID,mustJSON(req.Options),username,now);err!=nil{return nil,err}
	var total int64; vouchers:=0; ids:=[]string{}
	for idx,raw:=range req.Invoices {
		b,err:=json.Marshal(raw);if err!=nil{return nil,err}
		var row struct {
			CreateInvoiceInput
			Items []CreateInvoiceLineInput `json:"items"`
		}
		if err=json.Unmarshal(b,&row);err!=nil{return nil,err}
		if (row.ClientID!="" && row.ClientID!=req.ClientID) || (row.IssuerID!="" && row.IssuerID!=req.IssuerID) {return nil,errors.New("فواتير الدفعة يجب أن تخص الشركة والعميل المحددين")}
		row.IssuerID,row.ClientID=req.IssuerID,req.ClientID
		row.Lines=row.Items
		row.AutoReceipt=req.IssueVouchers
		if req.IssueVouchers && (row.PaymentMethod=="" || row.PaymentMethod=="CREDIT") {row.PaymentMethod="TRANSFER"}
		inv,err:=s.invoices.createInvoiceTx(tx,row.CreateInvoiceInput,username,"");if err!=nil{return nil,fmt.Errorf("الفاتورة %d: %w",idx+1,err)}
		if _,err=tx.Exec("UPDATE invoices SET batch_id=? WHERE id=?",batchID,inv.ID);err!=nil{return nil,err}
		total+=inv.GrandTotal;ids=append(ids,inv.ID)
		if req.IssueVouchers && inv.GrandTotal>0{vouchers++}
	}
	if _,err=tx.Exec("UPDATE invoice_batches SET invoice_count=?,total_amount=? WHERE id=?",len(ids),total,batchID);err!=nil{return nil,err}
	if req.DraftID!="" {
		if _,err=tx.Exec("UPDATE bulk_drafts SET status='COMMITTED',batch_id=?,committed_ids=?,updated_at=? WHERE id=?",batchID,mustJSON(ids),now,req.DraftID);err!=nil{return nil,err}
	}
	result:=map[string]any{"batch_id":batchID,"count":len(ids),"total_amount":models.ToMajor(total),"vouchers_count":vouchers,"invoice_ids":ids}
	if _,err=tx.Exec("INSERT INTO batch_requests (request_key,request_hash,result_json) VALUES (?,?,?)",key,hash,mustJSON(result));err!=nil{return nil,err}
	if err=db.AuditTx(tx,username,"BULK_COMMIT","batch",batchID,req.IssuerID,result,"");err!=nil{return nil,err}
	if err=tx.Commit();err!=nil{return nil,err};return result,nil
}
