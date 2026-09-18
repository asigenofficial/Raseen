package services

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
)

type ClientService struct {
	db *db.DB
}

func NewClientService(d *db.DB) *ClientService {
	return &ClientService{db: d}
}

type ListClientsFilter struct {
	Search       string
	ActiveOnly   bool
	WithBalances bool
	IssuerID     string
	ClientType   string
	City         string
	OnlyDebtors  bool
}

type ClientListItem struct {
	models.Client
	OpeningBalanceMajor float64 `json:"opening_balance"`
	CreditLimitMajor    float64 `json:"credit_limit"`
	TotalInvoicedMajor  float64 `json:"total_invoiced"`
	TotalPaidMajor      float64 `json:"total_paid"`
	BalanceMajor        float64 `json:"balance"`
	InvoicesCount       int     `json:"invoices_count"`
}

func (s *ClientService) ListClients(f ListClientsFilter) ([]ClientListItem, error) {
	query := `
		SELECT c.id, c.client_code, c.name, c.name_en, c.phone, c.mobile, c.email,
		       c.address, c.building_no, c.street, c.district, c.city, c.postal_code,
		       c.country, c.tax_number, c.commercial_register, c.client_type,
		       c.payment_terms_days, c.opening_balance, c.credit_limit, c.notes,
		       c.is_active, c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id AND i.status <> 'CANCELLED'
		           AND (? = '' OR i.issuer_id = ?)) AS invoices_count,
		       (SELECT COALESCE(SUM(i.grand_total), 0) FROM invoices i WHERE i.client_id = c.id AND i.status <> 'CANCELLED'
		           AND (? = '' OR i.issuer_id = ?)) AS total_invoiced,
		       (SELECT COALESCE(SUM(i.paid_amount), 0) FROM invoices i WHERE i.client_id = c.id AND i.status <> 'CANCELLED'
		           AND (? = '' OR i.issuer_id = ?)) AS total_paid
		FROM clients c
		WHERE (? = 0 OR c.is_active = 1)
		  AND (? = '' OR c.client_type = ?)
		  AND (? = '' OR c.city LIKE ?)
		  AND (? = '' OR c.name LIKE ? OR c.client_code LIKE ? OR c.phone LIKE ?
		       OR c.mobile LIKE ? OR c.tax_number LIKE ? OR c.commercial_register LIKE ?
		       OR c.email LIKE ? OR c.address LIKE ?)
		ORDER BY c.name ASC
	`

	activeParam := 0
	if f.ActiveOnly {
		activeParam = 1
	}
	likeSearch := "%" + f.Search + "%"
	cityLike := "%" + f.City + "%"

	rows, err := s.db.Query(query,
		f.IssuerID, f.IssuerID,
		f.IssuerID, f.IssuerID,
		f.IssuerID, f.IssuerID,
		activeParam,
		f.ClientType, f.ClientType,
		f.City, cityLike,
		f.Search, likeSearch, likeSearch, likeSearch,
		likeSearch, likeSearch, likeSearch,
		likeSearch, likeSearch,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ClientListItem
	for rows.Next() {
		var item ClientListItem
		var totalInvoicedMinor, totalPaidMinor int64

		err := rows.Scan(
			&item.ID, &item.ClientCode, &item.Name, &item.NameEn, &item.Phone, &item.Mobile, &item.Email,
			&item.Address, &item.BuildingNo, &item.Street, &item.District, &item.City, &item.PostalCode,
			&item.Country, &item.TaxNumber, &item.CommercialRegister, &item.ClientType,
			&item.PaymentTermsDays, &item.OpeningBalance, &item.CreditLimit, &item.Notes,
			&item.IsActive, &item.CreatedAt, &item.UpdatedAt,
			&item.InvoicesCount, &totalInvoicedMinor, &totalPaidMinor,
		)
		if err != nil {
			continue
		}

		item.OpeningBalanceMajor = models.ToMajor(item.OpeningBalance)
		item.CreditLimitMajor = models.ToMajor(item.CreditLimit)
		item.TotalInvoicedMajor = models.ToMajor(totalInvoicedMinor)
		item.TotalPaidMajor = models.ToMajor(totalPaidMinor)

		// If filtering by issuer, opening balance is not counted towards that specific issuer
		openingForIssuer := item.OpeningBalance
		if f.IssuerID != "" {
			openingForIssuer = 0
		}
		balanceMinor := openingForIssuer + totalInvoicedMinor - totalPaidMinor
		item.BalanceMajor = models.ToMajor(balanceMinor)

		if f.OnlyDebtors && item.BalanceMajor <= 0.004 {
			continue
		}

		list = append(list, item)
	}

	return list, nil
}

func (s *ClientService) GetClient(id string) (*ClientListItem, error) {
	list, err := s.ListClients(ListClientsFilter{Search: "", WithBalances: true})
	if err != nil {
		return nil, err
	}
	for _, c := range list {
		if c.ID == id {
			return &c, nil
		}
	}
	return nil, errors.New("العميل غير موجود")
}

func (s *ClientService) nextClientCode() string {
	var maxNum int
	rows, err := s.db.Query("SELECT client_code FROM clients WHERE client_code LIKE 'C-%'")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var code string
			if err := rows.Scan(&code); err == nil {
				var n int
				if _, err := fmt.Sscanf(code, "C-%d", &n); err == nil && n > maxNum {
					maxNum = n
				}
			}
		}
	}
	return fmt.Sprintf("C-%04d", maxNum+1)
}

func (s *ClientService) CreateClient(c *models.Client) error {
	if c.Name == "" {
		return errors.New("اسم العميل مطلوب")
	}
	if c.ID == "" {
		c.ID = crypto.UUID()
	}
	if c.ClientCode == "" {
		c.ClientCode = s.nextClientCode()
	}
	if c.Country == "" {
		c.Country = "SA"
	}
	if c.ClientType == "" {
		c.ClientType = "COMPANY"
	}

	now := db.NowIso()
	c.CreatedAt = now
	c.UpdatedAt = now
	c.IsActive = 1

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO clients (
			id, client_code, name, name_en, phone, mobile, email,
			address, building_no, street, district, city, postal_code,
			country, tax_number, commercial_register, client_type,
			payment_terms_days, opening_balance, credit_limit, notes,
			is_active, created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?
		)
	`,
		c.ID, c.ClientCode, c.Name, c.NameEn, c.Phone, c.Mobile, c.Email,
		c.Address, c.BuildingNo, c.Street, c.District, c.City, c.PostalCode,
		c.Country, c.TaxNumber, c.CommercialRegister, c.ClientType,
		c.PaymentTermsDays, c.OpeningBalance, c.CreditLimit, c.Notes,
		c.IsActive, c.CreatedAt, c.UpdatedAt,
	)
	if err != nil {
		return err
	}

	// Insert opening balance entry in ledger if > 0
	if c.OpeningBalance > 0 {
		_, err = tx.Exec(`
			INSERT INTO client_ledger (id, client_id, issuer_id, doc_type, doc_id, doc_number, transaction_date, debit, credit, description, created_at)
			VALUES (?, ?, NULL, 'OPENING_BALANCE', NULL, 'OPENING', ?, ?, 0, 'رصيد افتتاحي', ?)
		`, crypto.UUID(), c.ID, db.TodayIso(), c.OpeningBalance, now)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *ClientService) UpdateClient(id string, c *models.Client) error {
	now := db.NowIso()
	c.UpdatedAt = now

	_, err := s.db.Exec(`
		UPDATE clients SET
			name = ?, name_en = ?, phone = ?, mobile = ?, email = ?,
			address = ?, building_no = ?, street = ?, district = ?,
			city = ?, postal_code = ?, country = ?, tax_number = ?,
			commercial_register = ?, client_type = ?, payment_terms_days = ?,
			credit_limit = ?, notes = ?, is_active = ?, updated_at = ?
		WHERE id = ?
	`,
		c.Name, c.NameEn, c.Phone, c.Mobile, c.Email,
		c.Address, c.BuildingNo, c.Street, c.District,
		c.City, c.PostalCode, c.Country, c.TaxNumber,
		c.CommercialRegister, c.ClientType, c.PaymentTermsDays,
		c.CreditLimit, c.Notes, c.IsActive, now, id,
	)
	return err
}

func (s *ClientService) DeleteClient(id string) error {
	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM invoices WHERE client_id = ?", id).Scan(&count)
	if count > 0 {
		return errors.New("لا يمكن حذف العميل لوجود فواتير مسجلة باسمه")
	}
	_, err := s.db.Exec("DELETE FROM clients WHERE id = ?", id)
	return err
}

type StatementParams struct {
	ClientID string
	IssuerID string
	FromDate string
	ToDate   string
}

type StatementEntry struct {
	ID              string  `json:"id"`
	DocType         string  `json:"doc_type"`
	DocTypeLabel    string  `json:"doc_type_label"`
	DocID           *string `json:"doc_id"`
	DocNumber       string  `json:"doc_number"`
	IssuerID        *string `json:"issuer_id"`
	IssuerName      string  `json:"issuer_name"`
	TransactionDate string  `json:"transaction_date"`
	Debit           float64 `json:"debit"`
	Credit          float64 `json:"credit"`
	BalanceAfter    float64 `json:"balance_after"`
	Description     string  `json:"description"`
}

type StatementResult struct {
	Client struct {
		ID             string  `json:"id"`
		Code           string  `json:"code"`
		Name           string  `json:"name"`
		Phone          string  `json:"phone"`
		TaxNumber      string  `json:"tax_number"`
		City           string  `json:"city"`
		Address        string  `json:"address"`
		OpeningBalance float64 `json:"opening_balance"`
		CreditLimit    float64 `json:"credit_limit"`
	} `json:"client"`
	Issuer *struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Code      string `json:"code"`
		TaxNumber string `json:"tax_number"`
		Currency  string `json:"currency"`
	} `json:"issuer"`
	Scope                     string `json:"scope"`
	PeriodFrom                string `json:"period_from"`
	PeriodTo                  string `json:"period_to"`
	Period                    struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"period"`
	IncludesOpeningBalanceRow bool             `json:"includes_opening_balance_row"`
	OpeningBalancePeriod      float64          `json:"opening_balance_period"`
	Entries                   []StatementEntry `json:"entries"`
	Totals                    struct {
		Debit                 float64 `json:"debit"`
		Credit                float64 `json:"credit"`
		ClosingBalance        float64 `json:"closing_balance"`
		OpenInvoicesCount     int     `json:"open_invoices_count"`
		OpenInvoicesRemaining float64 `json:"open_invoices_remaining"`
	} `json:"totals"`
	GeneratedAt string `json:"generated_at"`
}

var docLabels = map[string]string{
	"OPENING_BALANCE": "رصيد افتتاحي",
	"INVOICE":         "فاتورة",
	"INVOICE_CANCEL":  "إلغاء فاتورة",
	"RECEIPT":         "سند قبض",
	"RECEIPT_CANCEL":  "إلغاء سند قبض",
}

func (s *ClientService) Statement(p StatementParams) (*StatementResult, error) {
	client, err := s.GetClient(p.ClientID)
	if err != nil {
		return nil, err
	}

	res := &StatementResult{
		Scope:                     "ALL",
		PeriodFrom:                p.FromDate,
		PeriodTo:                  p.ToDate,
		IncludesOpeningBalanceRow: (p.IssuerID == ""),
		Entries:                   make([]StatementEntry, 0),
		GeneratedAt:               db.NowIso(),
	}
	res.Period.From = p.FromDate
	res.Period.To = p.ToDate
	res.Client.ID = client.ID
	res.Client.Code = client.ClientCode
	res.Client.Name = client.Name
	res.Client.Phone = client.Phone
	if res.Client.Phone == "" {
		res.Client.Phone = client.Mobile
	}
	res.Client.TaxNumber = client.TaxNumber
	res.Client.City = client.City
	res.Client.Address = client.Address
	res.Client.OpeningBalance = client.OpeningBalanceMajor
	res.Client.CreditLimit = client.CreditLimitMajor

	if p.IssuerID != "" {
		res.Scope = "ISSUER"
		var iss models.Issuer
		err := s.db.QueryRow("SELECT id, name_ar, code, tax_number, currency FROM issuers WHERE id = ?", p.IssuerID).
			Scan(&iss.ID, &iss.NameAr, &iss.Code, &iss.TaxNumber, &iss.Currency)
		if err == nil {
			res.Issuer = &struct {
				ID        string `json:"id"`
				Name      string `json:"name"`
				Code      string `json:"code"`
				TaxNumber string `json:"tax_number"`
				Currency  string `json:"currency"`
			}{
				ID:        iss.ID,
				Name:      iss.NameAr,
				Code:      iss.Code,
				TaxNumber: iss.TaxNumber,
				Currency:  iss.Currency,
			}
		}
	}

	// Calculate opening balance before period
	var beforeDebit, beforeCredit int64
	queryBefore := `
		SELECT COALESCE(SUM(l.debit), 0), COALESCE(SUM(l.credit), 0)
		FROM client_ledger l
		WHERE l.client_id = ?
		  AND (? = '' OR l.issuer_id = ?)
		  AND (? <> '' AND l.transaction_date < ?)
	`
	_ = s.db.QueryRow(queryBefore, p.ClientID, p.IssuerID, p.IssuerID, p.FromDate, p.FromDate).Scan(&beforeDebit, &beforeCredit)

	openingMinor := int64(0)
	if p.FromDate != "" {
		openingMinor = beforeDebit - beforeCredit
	}
	res.OpeningBalancePeriod = models.ToMajor(openingMinor)

	queryRows := `
		SELECT l.id, l.doc_type, l.doc_id, l.doc_number, l.issuer_id, COALESCE(s.name_ar, '—'),
		       l.transaction_date, l.debit, l.credit, l.description
		FROM client_ledger l
		LEFT JOIN issuers s ON s.id = l.issuer_id
		WHERE l.client_id = ?
		  AND (? = '' OR l.issuer_id = ?)
		  AND (? = '' OR l.transaction_date >= ?)
		  AND (? = '' OR l.transaction_date <= ?)
		ORDER BY l.transaction_date ASC, l.created_at ASC
	`
	rows, err := s.db.Query(queryRows, p.ClientID, p.IssuerID, p.IssuerID, p.FromDate, p.FromDate, p.ToDate, p.ToDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	runningBalance := openingMinor
	var totalDebitMinor, totalCreditMinor int64

	for rows.Next() {
		var entry StatementEntry
		var debitMinor, creditMinor int64

		if err := rows.Scan(
			&entry.ID, &entry.DocType, &entry.DocID, &entry.DocNumber, &entry.IssuerID, &entry.IssuerName,
			&entry.TransactionDate, &debitMinor, &creditMinor, &entry.Description,
		); err == nil {
			runningBalance += debitMinor - creditMinor
			totalDebitMinor += debitMinor
			totalCreditMinor += creditMinor

			entry.Debit = models.ToMajor(debitMinor)
			entry.Credit = models.ToMajor(creditMinor)
			entry.BalanceAfter = models.ToMajor(runningBalance)
			label := docLabels[entry.DocType]
			if label == "" {
				label = entry.DocType
			}
			entry.DocTypeLabel = label
			res.Entries = append(res.Entries, entry)
		}
	}

	res.Totals.Debit = models.ToMajor(totalDebitMinor)
	res.Totals.Credit = models.ToMajor(totalCreditMinor)
	res.Totals.ClosingBalance = models.ToMajor(runningBalance)

	// Open invoices count and remaining
	var openCount int
	var openRemMinor int64
	_ = s.db.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(remaining_amount), 0)
		FROM invoices
		WHERE client_id = ? AND status IN ('UNPAID', 'PARTIAL')
		  AND (? = '' OR issuer_id = ?)
	`, p.ClientID, p.IssuerID, p.IssuerID).Scan(&openCount, &openRemMinor)

	res.Totals.OpenInvoicesCount = openCount
	res.Totals.OpenInvoicesRemaining = models.ToMajor(openRemMinor)

	return res, nil
}

type ClientBalanceItem struct {
	ClientID    string  `json:"client_id"`
	ClientCode  string  `json:"client_code"`
	Name        string  `json:"name"`
	Phone       string  `json:"phone"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Balance     float64 `json:"balance"`
	CreditLimit float64 `json:"credit_limit"`
	OverLimit   bool    `json:"over_limit"`
}

type BalancesResult struct {
	Items  []ClientBalanceItem `json:"items"`
	Totals struct {
		Debit   float64 `json:"debit"`
		Credit  float64 `json:"credit"`
		Balance float64 `json:"balance"`
	} `json:"totals"`
}

func (s *ClientService) Balances(issuerID string, onlyDebtors bool) (*BalancesResult, error) {
	query := `
		SELECT c.id, c.client_code, c.name, c.phone, c.mobile, c.credit_limit,
		       COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
		FROM clients c
		LEFT JOIN client_ledger l ON l.client_id = c.id AND (? = '' OR l.issuer_id = ?)
		GROUP BY c.id
		ORDER BY (COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)) DESC
	`
	rows, err := s.db.Query(query, issuerID, issuerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := &BalancesResult{}
	var sumDebit, sumCredit, sumBal float64

	for rows.Next() {
		var item ClientBalanceItem
		var mobile string
		var debitMinor, creditMinor, limitMinor int64

		if err := rows.Scan(
			&item.ClientID, &item.ClientCode, &item.Name, &item.Phone, &mobile, &limitMinor,
			&debitMinor, &creditMinor,
		); err == nil {
			if item.Phone == "" {
				item.Phone = mobile
			}
			item.Debit = models.ToMajor(debitMinor)
			item.Credit = models.ToMajor(creditMinor)
			item.Balance = models.ToMajor(debitMinor - creditMinor)
			item.CreditLimit = models.ToMajor(limitMinor)
			item.OverLimit = limitMinor > 0 && (debitMinor-creditMinor) > limitMinor

			if onlyDebtors && item.Balance <= 0 {
				continue
			}

			sumDebit += item.Debit
			sumCredit += item.Credit
			sumBal += item.Balance

			res.Items = append(res.Items, item)
		}
	}

	res.Totals.Debit = math.Round(sumDebit*100) / 100
	res.Totals.Credit = math.Round(sumCredit*100) / 100
	res.Totals.Balance = math.Round(sumBal*100) / 100

	return res, nil
}

func (s *ClientService) FindOrCreateByName(issuerID, name string) (*models.Client, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "عميل نقدي عام"
	}

	var c models.Client
	err := s.db.QueryRow("SELECT id, name, client_code, client_type, country, is_active, created_at, updated_at FROM clients WHERE name = ? COLLATE NOCASE LIMIT 1", name).Scan(
		&c.ID, &c.Name, &c.ClientCode, &c.ClientType, &c.Country, &c.IsActive, &c.CreatedAt, &c.UpdatedAt,
	)
	if err == nil && c.ID != "" {
		return &c, nil
	}

	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM clients").Scan(&count)
	code := fmt.Sprintf("C-%04d", count+1)

	now := db.NowIso()
	newID := crypto.UUID()
	newClient := &models.Client{
		ID:         newID,
		Name:       name,
		ClientCode: code,
		ClientType: "COMPANY",
		Country:    "SA",
		IsActive:   1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := s.CreateClient(newClient); err != nil {
		return nil, err
	}
	return newClient, nil
}

