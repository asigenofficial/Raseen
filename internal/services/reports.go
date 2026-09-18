package services

import (
	"fmt"
	"math"

	"raseen/internal/db"
	"raseen/internal/models"
)

type ReportService struct {
	db *db.DB
}

func NewReportService(d *db.DB) *ReportService {
	return &ReportService{db: d}
}

type DashboardSummary struct {
	Total float64 `json:"total"`
	Count int     `json:"count"`
}

type DashboardAllSummary struct {
	Total     float64 `json:"total"`
	Count     int     `json:"count"`
	Tax       float64 `json:"tax"`
	Remaining float64 `json:"remaining"`
}

type DashboardStatusItem struct {
	Status string  `json:"status"`
	Count  int     `json:"count"`
	Total  float64 `json:"total"`
}

type DashboardCounts struct {
	Issuers int `json:"issuers"`
	Clients int `json:"clients"`
	Items   int `json:"items"`
	Batches int `json:"batches"`
}

type DashboardMonthItem struct {
	Month string  `json:"month"`
	Total float64 `json:"total"`
	Count int     `json:"count"`
}

type DashboardTopClient struct {
	ClientID  string  `json:"client_id"`
	Name      string  `json:"name"`
	Code      string  `json:"code"`
	Invoices  int     `json:"invoices"`
	Total     float64 `json:"total"`
	Remaining float64 `json:"remaining"`
}

type DashboardTopItem struct {
	ItemName string  `json:"item_name"`
	ItemCode string  `json:"item_code"`
	Quantity float64 `json:"quantity"`
	Total    float64 `json:"total"`
}

type DashboardIssuerSummary struct {
	Name      string  `json:"name"`
	Code      string  `json:"code"`
	Invoices  int     `json:"invoices"`
	Total     float64 `json:"total"`
	Remaining float64 `json:"remaining"`
}

type DashboardRecentInvoice struct {
	ID            string  `json:"id"`
	InvoiceNumber string  `json:"invoice_number"`
	IssueDate     string  `json:"issue_date"`
	ClientName    string  `json:"client_name"`
	IssuerName    string  `json:"issuer_name"`
	GrandTotal    float64 `json:"grand_total"`
	Status        string  `json:"status"`
}

type DashboardData struct {
	Month          DashboardSummary         `json:"month"`
	Today          DashboardSummary         `json:"today"`
	All            DashboardAllSummary      `json:"all"`
	ByStatus       []DashboardStatusItem    `json:"by_status"`
	Counts         DashboardCounts          `json:"counts"`
	Monthly        []DashboardMonthItem     `json:"monthly"`
	TopClients     []DashboardTopClient     `json:"top_clients"`
	TopItems       []DashboardTopItem       `json:"top_items"`
	ByIssuer       []DashboardIssuerSummary `json:"by_issuer"`
	RecentInvoices []DashboardRecentInvoice `json:"recent_invoices"`
}

func (s *ReportService) DashboardStats(issuerID string) (*DashboardData, error) {
	data := &DashboardData{
		ByStatus:       make([]DashboardStatusItem, 0),
		Monthly:        make([]DashboardMonthItem, 0),
		TopClients:     make([]DashboardTopClient, 0),
		TopItems:       make([]DashboardTopItem, 0),
		ByIssuer:       make([]DashboardIssuerSummary, 0),
		RecentInvoices: make([]DashboardRecentInvoice, 0),
	}

	today := db.TodayIso()
	curMonth := today[:7] // YYYY-MM

	whereBase := "WHERE 1=1"
	var argsBase []any
	if issuerID != "" {
		whereBase += " AND issuer_id = ?"
		argsBase = append(argsBase, issuerID)
	}

	// 1. All Non-Cancelled summary
	var allTotal, allTax, allRem int64
	var allCount int
	_ = s.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(SUM(grand_total), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(remaining_amount), 0)
		FROM invoices %s AND status <> 'CANCELLED'
	`, whereBase), argsBase...).Scan(&allCount, &allTotal, &allTax, &allRem)

	data.All = DashboardAllSummary{
		Count:     allCount,
		Total:     models.ToMajor(allTotal),
		Tax:       models.ToMajor(allTax),
		Remaining: models.ToMajor(allRem),
	}

	// 2. Month summary
	var mTotal int64
	var mCount int
	mArgs := append(argsBase, curMonth)
	_ = s.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(SUM(grand_total), 0)
		FROM invoices %s AND status <> 'CANCELLED' AND strftime('%%Y-%%m', issue_date) = ?
	`, whereBase), mArgs...).Scan(&mCount, &mTotal)

	data.Month = DashboardSummary{
		Count: mCount,
		Total: models.ToMajor(mTotal),
	}

	// 3. Today summary
	var tTotal int64
	var tCount int
	tArgs := append(argsBase, today)
	_ = s.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(SUM(grand_total), 0)
		FROM invoices %s AND status <> 'CANCELLED' AND issue_date = ?
	`, whereBase), tArgs...).Scan(&tCount, &tTotal)

	data.Today = DashboardSummary{
		Count: tCount,
		Total: models.ToMajor(tTotal),
	}

	// 4. By Status (PAID, PARTIAL, UNPAID, CANCELLED)
	statusRows, err := s.db.Query(fmt.Sprintf(`
		SELECT status, COUNT(*), COALESCE(SUM(grand_total), 0)
		FROM invoices %s
		GROUP BY status
	`, whereBase), argsBase...)
	statusMap := map[string]DashboardStatusItem{
		"PAID":      {Status: "PAID"},
		"PARTIAL":   {Status: "PARTIAL"},
		"UNPAID":    {Status: "UNPAID"},
		"CANCELLED": {Status: "CANCELLED"},
	}
	if err == nil {
		defer statusRows.Close()
		for statusRows.Next() {
			var st string
			var cnt int
			var tot int64
			if err := statusRows.Scan(&st, &cnt, &tot); err == nil {
				statusMap[st] = DashboardStatusItem{
					Status: st,
					Count:  cnt,
					Total:  models.ToMajor(tot),
				}
			}
		}
	}
	for _, k := range []string{"PAID", "PARTIAL", "UNPAID", "CANCELLED"} {
		data.ByStatus = append(data.ByStatus, statusMap[k])
	}

	// 5. Counts (Issuers, Clients, Items, Batches)
	_ = s.db.QueryRow("SELECT COUNT(*) FROM issuers WHERE is_active = 1").Scan(&data.Counts.Issuers)
	_ = s.db.QueryRow("SELECT COUNT(*) FROM clients WHERE is_active = 1").Scan(&data.Counts.Clients)
	_ = s.db.QueryRow("SELECT COUNT(*) FROM items WHERE is_active = 1").Scan(&data.Counts.Items)
	_ = s.db.QueryRow("SELECT COUNT(*) FROM invoice_batches").Scan(&data.Counts.Batches)

	// 6. Monthly (last 12 months)
	mRows, err := s.db.Query(fmt.Sprintf(`
		SELECT strftime('%%Y-%%m', issue_date) AS m, COUNT(*), COALESCE(SUM(grand_total), 0)
		FROM invoices %s AND status <> 'CANCELLED' AND issue_date >= date('now', '-12 month')
		GROUP BY m ORDER BY m ASC
	`, whereBase), argsBase...)
	if err == nil {
		defer mRows.Close()
		for mRows.Next() {
			var m string
			var cnt int
			var tot int64
			if err := mRows.Scan(&m, &cnt, &tot); err == nil {
				data.Monthly = append(data.Monthly, DashboardMonthItem{
					Month: m,
					Count: cnt,
					Total: models.ToMajor(tot),
				})
			}
		}
	}
	if len(data.Monthly) == 0 {
		// at least provide current month so chart doesn't divide by zero
		data.Monthly = append(data.Monthly, DashboardMonthItem{
			Month: curMonth,
			Count: 0,
			Total: 0,
		})
	}

	// 7. Top Clients
	tcRows, err := s.db.Query(fmt.Sprintf(`
		SELECT c.id, c.name, c.client_code, COUNT(i.id), COALESCE(SUM(i.grand_total), 0), COALESCE(SUM(i.remaining_amount), 0)
		FROM clients c
		JOIN invoices i ON i.client_id = c.id
		%s AND i.status <> 'CANCELLED'
		GROUP BY c.id
		ORDER BY SUM(i.grand_total) DESC LIMIT 5
	`, func() string {
		if issuerID != "" {
			return "WHERE i.issuer_id = '" + issuerID + "'"
		}
		return "WHERE 1=1"
	}()))
	if err == nil {
		defer tcRows.Close()
		for tcRows.Next() {
			var tc DashboardTopClient
			var tot, rem int64
			if err := tcRows.Scan(&tc.ClientID, &tc.Name, &tc.Code, &tc.Invoices, &tot, &rem); err == nil {
				tc.Total = models.ToMajor(tot)
				tc.Remaining = models.ToMajor(rem)
				data.TopClients = append(data.TopClients, tc)
			}
		}
	}

	// 8. Top Items
	tiRows, err := s.db.Query(fmt.Sprintf(`
		SELECT ii.item_name, ii.item_code, COALESCE(SUM(ii.quantity), 0), COALESCE(SUM(ii.total_line), 0)
		FROM invoice_items ii
		JOIN invoices i ON i.id = ii.invoice_id
		%s AND i.status <> 'CANCELLED'
		GROUP BY ii.item_name
		ORDER BY SUM(ii.total_line) DESC LIMIT 5
	`, func() string {
		if issuerID != "" {
			return "WHERE i.issuer_id = '" + issuerID + "'"
		}
		return "WHERE 1=1"
	}()))
	if err == nil {
		defer tiRows.Close()
		for tiRows.Next() {
			var ti DashboardTopItem
			var tot int64
			if err := tiRows.Scan(&ti.ItemName, &ti.ItemCode, &ti.Quantity, &tot); err == nil {
				ti.Total = models.ToMajor(tot)
				data.TopItems = append(data.TopItems, ti)
			}
		}
	}

	// 9. By Issuer
	biRows, err := s.db.Query(`
		SELECT s.name_ar, s.code, COUNT(i.id), COALESCE(SUM(i.grand_total), 0), COALESCE(SUM(i.remaining_amount), 0)
		FROM issuers s
		LEFT JOIN invoices i ON i.issuer_id = s.id AND i.status <> 'CANCELLED'
		GROUP BY s.id
		ORDER BY s.name_ar ASC
	`)
	if err == nil {
		defer biRows.Close()
		for biRows.Next() {
			var bi DashboardIssuerSummary
			var tot, rem int64
			if err := biRows.Scan(&bi.Name, &bi.Code, &bi.Invoices, &tot, &rem); err == nil {
				bi.Total = models.ToMajor(tot)
				bi.Remaining = models.ToMajor(rem)
				data.ByIssuer = append(data.ByIssuer, bi)
			}
		}
	}

	// 10. Recent Invoices
	riRows, err := s.db.Query(fmt.Sprintf(`
		SELECT i.id, i.invoice_number, i.issue_date, i.buyer_name, i.seller_name, i.grand_total, i.status
		FROM invoices i
		%s
		ORDER BY i.issue_date DESC, i.sequence_no DESC LIMIT 10
	`, whereBase), argsBase...)
	if err == nil {
		defer riRows.Close()
		for riRows.Next() {
			var ri DashboardRecentInvoice
			var tot int64
			if err := riRows.Scan(&ri.ID, &ri.InvoiceNumber, &ri.IssueDate, &ri.ClientName, &ri.IssuerName, &tot, &ri.Status); err == nil {
				ri.GrandTotal = models.ToMajor(tot)
				data.RecentInvoices = append(data.RecentInvoices, ri)
			}
		}
	}

	return data, nil
}

type TaxReportResult struct {
	TotalSalesTaxable float64 `json:"total_sales_taxable"`
	TotalSalesTax     float64 `json:"total_sales_tax"`
	TotalGrandSales   float64 `json:"total_grand_sales"`
	StandardInvoices  struct {
		Count   int     `json:"count"`
		Taxable float64 `json:"taxable"`
		Tax     float64 `json:"tax"`
		Total   float64 `json:"total"`
	} `json:"standard_invoices"`
	SimplifiedInvoices struct {
		Count   int     `json:"count"`
		Taxable float64 `json:"taxable"`
		Tax     float64 `json:"tax"`
		Total   float64 `json:"total"`
	} `json:"simplified_invoices"`
	PeriodFrom string `json:"period_from"`
	PeriodTo   string `json:"period_to"`
}

func (s *ReportService) TaxReport(issuerID, fromDate, toDate string) (*TaxReportResult, error) {
	res := &TaxReportResult{
		PeriodFrom: fromDate,
		PeriodTo:   toDate,
	}

	where := "WHERE status <> 'CANCELLED'"
	var args []any
	if issuerID != "" {
		where += " AND issuer_id = ?"
		args = append(args, issuerID)
	}
	if fromDate != "" {
		where += " AND issue_date >= ?"
		args = append(args, fromDate)
	}
	if toDate != "" {
		where += " AND issue_date <= ?"
		args = append(args, toDate)
	}

	query := fmt.Sprintf(`
		SELECT invoice_type, COUNT(*),
		       COALESCE(SUM(taxable_amount), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(grand_total), 0)
		FROM invoices %s
		GROUP BY invoice_type
	`, where)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var invType string
		var count int
		var taxable, tax, total int64
		if err := rows.Scan(&invType, &count, &taxable, &tax, &total); err == nil {
			if invType == "SIMPLIFIED" {
				res.SimplifiedInvoices.Count = count
				res.SimplifiedInvoices.Taxable = models.ToMajor(taxable)
				res.SimplifiedInvoices.Tax = models.ToMajor(tax)
				res.SimplifiedInvoices.Total = models.ToMajor(total)
			} else {
				res.StandardInvoices.Count = count
				res.StandardInvoices.Taxable = models.ToMajor(taxable)
				res.StandardInvoices.Tax = models.ToMajor(tax)
				res.StandardInvoices.Total = models.ToMajor(total)
			}
			res.TotalSalesTaxable += models.ToMajor(taxable)
			res.TotalSalesTax += models.ToMajor(tax)
			res.TotalGrandSales += models.ToMajor(total)
		}
	}

	res.TotalSalesTaxable = math.Round(res.TotalSalesTaxable*100) / 100
	res.TotalSalesTax = math.Round(res.TotalSalesTax*100) / 100
	res.TotalGrandSales = math.Round(res.TotalGrandSales*100) / 100

	return res, nil
}

type AgingBucket struct {
	Label  string  `json:"label"`
	Count  int     `json:"count"`
	Amount float64 `json:"amount"`
}

type AgingReportResult struct {
	Buckets []AgingBucket `json:"buckets"`
	Total   float64       `json:"total"`
}

func (s *ReportService) AgingReport(issuerID string) (*AgingReportResult, error) {
	today := db.TodayIso()
	query := `
		SELECT
			CASE
				WHEN CAST(julianday(?) - julianday(COALESCE(due_date, issue_date)) AS INT) <= 30 THEN '0-30'
				WHEN CAST(julianday(?) - julianday(COALESCE(due_date, issue_date)) AS INT) <= 60 THEN '31-60'
				WHEN CAST(julianday(?) - julianday(COALESCE(due_date, issue_date)) AS INT) <= 90 THEN '61-90'
				ELSE '90+'
			END AS bucket,
			COUNT(*),
			COALESCE(SUM(remaining_amount), 0)
		FROM invoices
		WHERE status IN ('UNPAID', 'PARTIAL')
		  AND (? = '' OR issuer_id = ?)
		GROUP BY bucket
	`

	rows, err := s.db.Query(query, today, today, today, issuerID, issuerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	bucketMap := map[string]AgingBucket{
		"0-30":  {Label: "0 - 30 يوم"},
		"31-60": {Label: "31 - 60 يوم"},
		"61-90": {Label: "61 - 90 يوم"},
		"90+":   {Label: "أكثر من 90 يوماً"},
	}

	var grandTotal float64
	for rows.Next() {
		var b string
		var count int
		var remMinor int64
		if err := rows.Scan(&b, &count, &remMinor); err == nil {
			amt := models.ToMajor(remMinor)
			bucket := bucketMap[b]
			bucket.Count = count
			bucket.Amount = amt
			bucketMap[b] = bucket
			grandTotal += amt
		}
	}

	order := []string{"0-30", "31-60", "61-90", "90+"}
	var buckets []AgingBucket
	for _, k := range order {
		buckets = append(buckets, bucketMap[k])
	}

	return &AgingReportResult{
		Buckets: buckets,
		Total:   math.Round(grandTotal*100) / 100,
	}, nil
}

// ------------------------------------------------------------------ تقرير المبيعات
type SalesReportTotals struct {
	Count    int     `json:"count"`
	Subtotal float64 `json:"subtotal"`
	Discount float64 `json:"discount"`
	Tax      float64 `json:"tax"`
	Total    float64 `json:"total"`
}

type SalesReportItem struct {
	Label    string   `json:"label"`
	Count    int      `json:"count"`
	Quantity *float64 `json:"quantity,omitempty"`
	Subtotal float64  `json:"subtotal"`
	Discount float64  `json:"discount"`
	Tax      float64  `json:"tax"`
	Total    float64  `json:"total"`
}

type SalesReportResult struct {
	Totals SalesReportTotals `json:"totals"`
	Items  []SalesReportItem `json:"items"`
}

func (s *ReportService) SalesReport(issuerID, fromDate, toDate, clientID, groupBy string) (*SalesReportResult, error) {
	res := &SalesReportResult{
		Items: make([]SalesReportItem, 0),
	}

	where := "WHERE i.status <> 'CANCELLED'"
	var args []any
	if issuerID != "" {
		where += " AND i.issuer_id = ?"
		args = append(args, issuerID)
	}
	if clientID != "" {
		where += " AND i.client_id = ?"
		args = append(args, clientID)
	}
	if fromDate != "" {
		where += " AND i.issue_date >= ?"
		args = append(args, fromDate)
	}
	if toDate != "" {
		where += " AND i.issue_date <= ?"
		args = append(args, toDate)
	}

	var groupExpr string
	switch groupBy {
	case "month":
		groupExpr = "substr(i.issue_date, 1, 7)"
	case "client":
		groupExpr = "i.buyer_name"
	case "issuer":
		groupExpr = "i.seller_name"
	case "type":
		groupExpr = "CASE WHEN i.invoice_type = 'SIMPLIFIED' THEN 'مبسطة (B2C)' ELSE 'ضريبية (B2B)' END"
	case "item":
		// Group by item from invoice_items
		q := fmt.Sprintf(`
			SELECT ii.item_name, COUNT(DISTINCT i.id), COALESCE(SUM(ii.quantity), 0),
			       COALESCE(SUM(ii.taxable), 0), COALESCE(SUM(ii.discount), 0), COALESCE(SUM(ii.tax_amount), 0), COALESCE(SUM(ii.total_line), 0)
			FROM invoice_items ii
			JOIN invoices i ON i.id = ii.invoice_id
			%s
			GROUP BY ii.item_name
			ORDER BY COALESCE(SUM(ii.total_line), 0) DESC
		`, where)
		rows, err := s.db.Query(q, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var label string
			var count int
			var qty float64
			var sub, disc, tax, tot int64
			if err := rows.Scan(&label, &count, &qty, &sub, &disc, &tax, &tot); err == nil {
				subM := models.ToMajor(sub)
				discM := models.ToMajor(disc)
				taxM := models.ToMajor(tax)
				totM := models.ToMajor(tot)
				res.Items = append(res.Items, SalesReportItem{
					Label:    label,
					Count:    count,
					Quantity: &qty,
					Subtotal: subM,
					Discount: discM,
					Tax:      taxM,
					Total:    totM,
				})
				res.Totals.Count += count
				res.Totals.Subtotal += subM
				res.Totals.Discount += discM
				res.Totals.Tax += taxM
				res.Totals.Total += totM
			}
		}
		res.Totals.Subtotal = math.Round(res.Totals.Subtotal*100) / 100
		res.Totals.Discount = math.Round(res.Totals.Discount*100) / 100
		res.Totals.Tax = math.Round(res.Totals.Tax*100) / 100
		res.Totals.Total = math.Round(res.Totals.Total*100) / 100
		return res, nil
	default:
		groupExpr = "i.issue_date"
	}

	q := fmt.Sprintf(`
		SELECT %s, COUNT(*),
		       COALESCE(SUM(i.subtotal), 0), COALESCE(SUM(i.discount_amount), 0), COALESCE(SUM(i.tax_amount), 0), COALESCE(SUM(i.grand_total), 0)
		FROM invoices i
		%s
		GROUP BY %s
		ORDER BY %s ASC
	`, groupExpr, where, groupExpr, groupExpr)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var label string
		var count int
		var sub, disc, tax, tot int64
		if err := rows.Scan(&label, &count, &sub, &disc, &tax, &tot); err == nil {
			subM := models.ToMajor(sub)
			discM := models.ToMajor(disc)
			taxM := models.ToMajor(tax)
			totM := models.ToMajor(tot)
			res.Items = append(res.Items, SalesReportItem{
				Label:    label,
				Count:    count,
				Subtotal: subM,
				Discount: discM,
				Tax:      taxM,
				Total:    totM,
			})
			res.Totals.Count += count
			res.Totals.Subtotal += subM
			res.Totals.Discount += discM
			res.Totals.Tax += taxM
			res.Totals.Total += totM
		}
	}
	res.Totals.Subtotal = math.Round(res.Totals.Subtotal*100) / 100
	res.Totals.Discount = math.Round(res.Totals.Discount*100) / 100
	res.Totals.Tax = math.Round(res.Totals.Tax*100) / 100
	res.Totals.Total = math.Round(res.Totals.Total*100) / 100

	return res, nil
}

// ------------------------------------------------------------------ تقرير ضريبة القيمة المضافة
type VatReportTotals struct {
	Invoices int     `json:"invoices"`
	Taxable  float64 `json:"taxable"`
	Tax      float64 `json:"tax"`
	Total    float64 `json:"total"`
}

type VatReportItem struct {
	IssuerName string  `json:"issuer_name"`
	TaxNumber  string  `json:"tax_number"`
	Invoices   int     `json:"invoices"`
	Taxable    float64 `json:"taxable"`
	Tax        float64 `json:"tax"`
	Total      float64 `json:"total"`
}

type VatReportResult struct {
	Totals VatReportTotals `json:"totals"`
	Items  []VatReportItem `json:"items"`
}

func (s *ReportService) VatReport(issuerID, fromDate, toDate string) (*VatReportResult, error) {
	res := &VatReportResult{
		Items: make([]VatReportItem, 0),
	}

	where := "WHERE i.status <> 'CANCELLED'"
	var args []any
	if issuerID != "" {
		where += " AND i.issuer_id = ?"
		args = append(args, issuerID)
	}
	if fromDate != "" {
		where += " AND i.issue_date >= ?"
		args = append(args, fromDate)
	}
	if toDate != "" {
		where += " AND i.issue_date <= ?"
		args = append(args, toDate)
	}

	q := fmt.Sprintf(`
		SELECT iss.name_ar, iss.tax_number, COUNT(i.id),
		       COALESCE(SUM(i.taxable_amount), 0), COALESCE(SUM(i.tax_amount), 0), COALESCE(SUM(i.grand_total), 0)
		FROM invoices i
		JOIN issuers iss ON iss.id = i.issuer_id
		%s
		GROUP BY iss.id, iss.name_ar, iss.tax_number
		ORDER BY iss.name_ar ASC
	`, where)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var name, taxNo string
		var invs int
		var taxable, tax, tot int64
		if err := rows.Scan(&name, &taxNo, &invs, &taxable, &tax, &tot); err == nil {
			taxableM := models.ToMajor(taxable)
			taxM := models.ToMajor(tax)
			totM := models.ToMajor(tot)
			res.Items = append(res.Items, VatReportItem{
				IssuerName: name,
				TaxNumber:  taxNo,
				Invoices:   invs,
				Taxable:    taxableM,
				Tax:        taxM,
				Total:      totM,
			})
			res.Totals.Invoices += invs
			res.Totals.Taxable += taxableM
			res.Totals.Tax += taxM
			res.Totals.Total += totM
		}
	}

	res.Totals.Taxable = math.Round(res.Totals.Taxable*100) / 100
	res.Totals.Tax = math.Round(res.Totals.Tax*100) / 100
	res.Totals.Total = math.Round(res.Totals.Total*100) / 100

	return res, nil
}

// ------------------------------------------------------------------ تقرير التحصيلات
type CollectionsReportTotals struct {
	Count       int     `json:"count"`
	Amount      float64 `json:"amount"`
	Allocated   float64 `json:"allocated"`
	Unallocated float64 `json:"unallocated"`
}

type CollectionsReportItem struct {
	Label       string  `json:"label"`
	Count       int     `json:"count"`
	Amount      float64 `json:"amount"`
	Allocated   float64 `json:"allocated"`
	Unallocated float64 `json:"unallocated"`
}

type CollectionsReportResult struct {
	Totals CollectionsReportTotals `json:"totals"`
	Items  []CollectionsReportItem `json:"items"`
}

func (s *ReportService) CollectionsReport(issuerID, fromDate, toDate, clientID, groupBy string) (*CollectionsReportResult, error) {
	res := &CollectionsReportResult{
		Items: make([]CollectionsReportItem, 0),
	}

	where := "WHERE v.status <> 'CANCELLED'"
	var args []any
	if issuerID != "" {
		where += " AND v.issuer_id = ?"
		args = append(args, issuerID)
	}
	if clientID != "" {
		where += " AND v.client_id = ?"
		args = append(args, clientID)
	}
	if fromDate != "" {
		where += " AND v.voucher_date >= ?"
		args = append(args, fromDate)
	}
	if toDate != "" {
		where += " AND v.voucher_date <= ?"
		args = append(args, toDate)
	}

	var groupExpr string
	switch groupBy {
	case "month":
		groupExpr = "substr(v.voucher_date, 1, 7)"
	case "client":
		groupExpr = "c.name"
	case "type":
		groupExpr = "CASE v.payment_type WHEN 'CASH' THEN 'نقداً' WHEN 'TRANSFER' THEN 'تحويل بنكي' WHEN 'CHEQUE' THEN 'شيك' WHEN 'CARD' THEN 'شبكة' ELSE v.payment_type END"
	default:
		groupExpr = "v.voucher_date"
	}

	q := fmt.Sprintf(`
		SELECT %s, COUNT(*),
		       COALESCE(SUM(v.total_amount), 0), COALESCE(SUM(v.allocated_total), 0)
		FROM receipt_vouchers v
		JOIN clients c ON c.id = v.client_id
		%s
		GROUP BY %s
		ORDER BY %s ASC
	`, groupExpr, where, groupExpr, groupExpr)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var label string
		var count int
		var tot, alloc int64
		if err := rows.Scan(&label, &count, &tot, &alloc); err == nil {
			totM := models.ToMajor(tot)
			allocM := models.ToMajor(alloc)
			unallocM := math.Round((totM-allocM)*100) / 100
			res.Items = append(res.Items, CollectionsReportItem{
				Label:       label,
				Count:       count,
				Amount:      totM,
				Allocated:   allocM,
				Unallocated: unallocM,
			})
			res.Totals.Count += count
			res.Totals.Amount += totM
			res.Totals.Allocated += allocM
			res.Totals.Unallocated += unallocM
		}
	}

	res.Totals.Amount = math.Round(res.Totals.Amount*100) / 100
	res.Totals.Allocated = math.Round(res.Totals.Allocated*100) / 100
	res.Totals.Unallocated = math.Round(res.Totals.Unallocated*100) / 100

	return res, nil
}

// ------------------------------------------------------------------ تقرير الربحية
type ProfitabilityReportTotals struct {
	Revenue  float64 `json:"revenue"`
	Cost     float64 `json:"cost"`
	Profit   float64 `json:"profit"`
	Margin   float64 `json:"margin"`
	Invoices int     `json:"invoices"`
}

type ProfitabilityReportItem struct {
	Label    string  `json:"label"`
	Invoices int     `json:"invoices"`
	Quantity float64 `json:"quantity"`
	Revenue  float64 `json:"revenue"`
	Cost     float64 `json:"cost"`
	Profit   float64 `json:"profit"`
	Margin   float64 `json:"margin"`
}

type ProfitabilityReportResult struct {
	Totals ProfitabilityReportTotals `json:"totals"`
	Items  []ProfitabilityReportItem `json:"items"`
	Note   string                    `json:"note"`
}

func (s *ReportService) ProfitabilityReport(issuerID, fromDate, toDate, clientID, groupBy string) (*ProfitabilityReportResult, error) {
	res := &ProfitabilityReportResult{
		Items: make([]ProfitabilityReportItem, 0),
		Note:  "يتم احتساب الربحية بناء على سعر البيع مطروحاً منه سعر التكلفة المسجل للصنف في النظام.",
	}

	where := "WHERE i.status <> 'CANCELLED'"
	var args []any
	if issuerID != "" {
		where += " AND i.issuer_id = ?"
		args = append(args, issuerID)
	}
	if clientID != "" {
		where += " AND i.client_id = ?"
		args = append(args, clientID)
	}
	if fromDate != "" {
		where += " AND i.issue_date >= ?"
		args = append(args, fromDate)
	}
	if toDate != "" {
		where += " AND i.issue_date <= ?"
		args = append(args, toDate)
	}

	var groupExpr string
	switch groupBy {
	case "client":
		groupExpr = "i.buyer_name"
	case "month":
		groupExpr = "substr(i.issue_date, 1, 7)"
	default:
		groupExpr = "ii.item_name"
	}

	q := fmt.Sprintf(`
		SELECT %s, COUNT(DISTINCT i.id), COALESCE(SUM(ii.quantity), 0),
		       COALESCE(SUM(ii.taxable), 0),
		       COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.cost_price, 0))), 0)
		FROM invoice_items ii
		JOIN invoices i ON i.id = ii.invoice_id
		LEFT JOIN items it ON it.id = ii.item_id
		%s
		GROUP BY %s
		ORDER BY COALESCE(SUM(ii.taxable), 0) DESC
	`, groupExpr, where, groupExpr)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var label string
		var invs int
		var qty float64
		var revMinor, costMinor int64
		if err := rows.Scan(&label, &invs, &qty, &revMinor, &costMinor); err == nil {
			revM := models.ToMajor(revMinor)
			costM := models.ToMajor(costMinor)
			profitM := math.Round((revM-costM)*100) / 100
			margin := 0.0
			if revM > 0 {
				margin = math.Round((profitM/revM)*1000) / 10
			}
			res.Items = append(res.Items, ProfitabilityReportItem{
				Label:    label,
				Invoices: invs,
				Quantity: qty,
				Revenue:  revM,
				Cost:     costM,
				Profit:   profitM,
				Margin:   margin,
			})
			res.Totals.Invoices += invs
			res.Totals.Revenue += revM
			res.Totals.Cost += costM
			res.Totals.Profit += profitM
		}
	}

	res.Totals.Revenue = math.Round(res.Totals.Revenue*100) / 100
	res.Totals.Cost = math.Round(res.Totals.Cost*100) / 100
	res.Totals.Profit = math.Round(res.Totals.Profit*100) / 100
	if res.Totals.Revenue > 0 {
		res.Totals.Margin = math.Round((res.Totals.Profit/res.Totals.Revenue)*1000) / 10
	}

	return res, nil
}

// ------------------------------------------------------------------ تقرير أعمار الديون المفصل للواجهة
type AgingDetailedTotals struct {
	B0_30   float64 `json:"b0_30"`
	B31_60  float64 `json:"b31_60"`
	B61_90  float64 `json:"b61_90"`
	B90Plus float64 `json:"b90_plus"`
	Total   float64 `json:"total"`
}

type AgingDetailedItem struct {
	ClientName string  `json:"client_name"`
	ClientCode string  `json:"client_code"`
	B0_30      float64 `json:"b0_30"`
	B31_60     float64 `json:"b31_60"`
	B61_90     float64 `json:"b61_90"`
	B90Plus    float64 `json:"b90_plus"`
	Total      float64 `json:"total"`
}

type AgingDetailedResult struct {
	Totals AgingDetailedTotals `json:"totals"`
	Items  []AgingDetailedItem `json:"items"`
}

func (s *ReportService) AgingDetailedReport(issuerID, asOf string) (*AgingDetailedResult, error) {
	if asOf == "" {
		asOf = db.TodayIso()
	}
	where := "WHERE i.status IN ('UNPAID', 'PARTIAL')"
	var args []any
	args = append(args, asOf, asOf, asOf, asOf)
	if issuerID != "" {
		where += " AND i.issuer_id = ?"
		args = append(args, issuerID)
	}

	q := fmt.Sprintf(`
		SELECT c.name, c.client_code,
		       COALESCE(SUM(CASE WHEN CAST(julianday(?) - julianday(COALESCE(i.due_date, i.issue_date)) AS INT) <= 30 THEN i.remaining_amount ELSE 0 END), 0) AS b0_30,
		       COALESCE(SUM(CASE WHEN CAST(julianday(?) - julianday(COALESCE(i.due_date, i.issue_date)) AS INT) BETWEEN 31 AND 60 THEN i.remaining_amount ELSE 0 END), 0) AS b31_60,
		       COALESCE(SUM(CASE WHEN CAST(julianday(?) - julianday(COALESCE(i.due_date, i.issue_date)) AS INT) BETWEEN 61 AND 90 THEN i.remaining_amount ELSE 0 END), 0) AS b61_90,
		       COALESCE(SUM(CASE WHEN CAST(julianday(?) - julianday(COALESCE(i.due_date, i.issue_date)) AS INT) > 90 THEN i.remaining_amount ELSE 0 END), 0) AS b90_plus,
		       COALESCE(SUM(i.remaining_amount), 0) AS total
		FROM invoices i
		JOIN clients c ON c.id = i.client_id
		%s
		GROUP BY c.id, c.name, c.client_code
		HAVING total > 0
		ORDER BY total DESC
	`, where)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := &AgingDetailedResult{
		Items: make([]AgingDetailedItem, 0),
	}

	for rows.Next() {
		var name, code string
		var b0, b31, b61, b90, tot int64
		if err := rows.Scan(&name, &code, &b0, &b31, &b61, &b90, &tot); err == nil {
			b0M := models.ToMajor(b0)
			b31M := models.ToMajor(b31)
			b61M := models.ToMajor(b61)
			b90M := models.ToMajor(b90)
			totM := models.ToMajor(tot)
			res.Items = append(res.Items, AgingDetailedItem{
				ClientName: name,
				ClientCode: code,
				B0_30:      b0M,
				B31_60:     b31M,
				B61_90:     b61M,
				B90Plus:    b90M,
				Total:      totM,
			})
			res.Totals.B0_30 += b0M
			res.Totals.B31_60 += b31M
			res.Totals.B61_90 += b61M
			res.Totals.B90Plus += b90M
			res.Totals.Total += totM
		}
	}

	res.Totals.B0_30 = math.Round(res.Totals.B0_30*100) / 100
	res.Totals.B31_60 = math.Round(res.Totals.B31_60*100) / 100
	res.Totals.B61_90 = math.Round(res.Totals.B61_90*100) / 100
	res.Totals.B90Plus = math.Round(res.Totals.B90Plus*100) / 100
	res.Totals.Total = math.Round(res.Totals.Total*100) / 100

	return res, nil
}

