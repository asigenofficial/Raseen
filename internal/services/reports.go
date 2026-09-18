package services

import (
	"fmt"
	"math"
	"time"

	"raseen/internal/db"
	"raseen/internal/models"
)

type ReportService struct {
	db *db.DB
}

func NewReportService(d *db.DB) *ReportService {
	return &ReportService{db: d}
}

type DashboardStats struct {
	TotalSalesMajor       float64 `json:"total_sales"`
	TotalCollectionsMajor float64 `json:"total_collections"`
	TotalDueMajor         float64 `json:"total_due"`
	TotalTaxMajor         float64 `json:"total_tax"`
	InvoicesCount         int     `json:"invoices_count"`
	ClientsCount          int     `json:"clients_count"`
	ItemsCount            int     `json:"items_count"`
	VouchersCount         int     `json:"vouchers_count"`
	MonthlySales          []MonthStat `json:"monthly_sales"`
}

type MonthStat struct {
	Month string  `json:"month"`
	Total float64 `json:"total"`
	Tax   float64 `json:"tax"`
}

func (s *ReportService) DashboardStats(issuerID string) (*DashboardStats, error) {
	stats := &DashboardStats{}

	// Invoices stats
	where := "WHERE status <> 'CANCELLED'"
	args := []any{}
	if issuerID != "" {
		where += " AND issuer_id = ?"
		args = append(args, issuerID)
	}

	var sumSales, sumTax, sumDue int64
	var invCount int
	err := s.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(SUM(grand_total), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(remaining_amount), 0)
		FROM invoices %s
	`, where), args...).Scan(&invCount, &sumSales, &sumTax, &sumDue)
	if err == nil {
		stats.InvoicesCount = invCount
		stats.TotalSalesMajor = models.ToMajor(sumSales)
		stats.TotalTaxMajor = models.ToMajor(sumTax)
		stats.TotalDueMajor = models.ToMajor(sumDue)
	}

	// Collections stats
	vWhere := "WHERE status = 'ACTIVE'"
	vArgs := []any{}
	if issuerID != "" {
		vWhere += " AND issuer_id = ?"
		vArgs = append(vArgs, issuerID)
	}
	var sumCol int64
	var vCount int
	_ = s.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
		FROM receipt_vouchers %s
	`, vWhere), vArgs...).Scan(&vCount, &sumCol)
	stats.VouchersCount = vCount
	stats.TotalCollectionsMajor = models.ToMajor(sumCol)

	// Clients & Items count
	_ = s.db.QueryRow("SELECT COUNT(*) FROM clients WHERE is_active = 1").Scan(&stats.ClientsCount)
	_ = s.db.QueryRow("SELECT COUNT(*) FROM items WHERE is_active = 1").Scan(&stats.ItemsCount)

	// Monthly sales for current year
	curYear := time.Now().Format("2006")
	mQuery := fmt.Sprintf(`
		SELECT strftime('%%Y-%%m', issue_date) AS m, COALESCE(SUM(grand_total), 0), COALESCE(SUM(tax_amount), 0)
		FROM invoices
		WHERE status <> 'CANCELLED' AND issue_date >= ? %s
		GROUP BY m ORDER BY m ASC
	`, func() string {
		if issuerID != "" {
			return " AND issuer_id = '" + issuerID + "'"
		}
		return ""
	}())

	rows, err := s.db.Query(mQuery, curYear+"-01-01")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var m string
			var gt, tx int64
			if err := rows.Scan(&m, &gt, &tx); err == nil {
				stats.MonthlySales = append(stats.MonthlySales, MonthStat{
					Month: m,
					Total: models.ToMajor(gt),
					Tax:   models.ToMajor(tx),
				})
			}
		}
	}

	return stats, nil
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
	Label    string  `json:"label"`
	Count    int     `json:"count"`
	Amount   float64 `json:"amount"`
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
