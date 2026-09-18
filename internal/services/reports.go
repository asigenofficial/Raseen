package services

import (
	"database/sql"
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

func init() {
	// dummy reference to sql if needed
	var _ = sql.ErrNoRows
}
