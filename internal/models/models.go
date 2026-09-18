package models

type User struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	FullName    string  `json:"full_name"`
	Role        string  `json:"role"`
	RoleLabel   string  `json:"role_label"`
	Permissions string  `json:"permissions"`
	IsActive    int     `json:"is_active"`
	CreatedAt   string  `json:"created_at"`
	LastLoginAt *string `json:"last_login_at"`
}

type Issuer struct {
	ID                 string  `json:"id"`
	Code               string  `json:"code"`
	NameAr             string  `json:"name_ar"`
	NameEn             string  `json:"name_en"`
	TaxNumber          string  `json:"tax_number"`
	CommercialRegister string  `json:"commercial_register"`
	Street             string  `json:"street"`
	StreetEn           string  `json:"street_en"`
	BuildingNo         string  `json:"building_no"`
	District           string  `json:"district"`
	DistrictEn         string  `json:"district_en"`
	City               string  `json:"city"`
	CityEn             string  `json:"city_en"`
	AddressEn          string  `json:"address_en"`
	PostalCode         string  `json:"postal_code"`
	Country            string  `json:"country"`
	Phone              string  `json:"phone"`
	Email              string  `json:"email"`
	Website            string  `json:"website"`
	LogoData           *string `json:"logo_data"`
	DefaultTaxRate     float64 `json:"default_tax_rate"`
	Currency           string  `json:"currency"`
	InvoicePrefix      string  `json:"invoice_prefix"`
	InvoiceNextNo      int64   `json:"invoice_next_no"`
	InvoicePad         int     `json:"invoice_pad"`
	VoucherPrefix      string  `json:"voucher_prefix"`
	VoucherNextNo      int64   `json:"voucher_next_no"`
	ZatcaPhase         string  `json:"zatca_phase"`
	QrSettings         string  `json:"qr_settings"`
	PrintSettings      string  `json:"print_settings"`
	BankName           string  `json:"bank_name"`
	BankIban           string  `json:"bank_iban"`
	FooterNotes        string  `json:"footer_notes"`
	LegalTerms         string  `json:"legal_terms"`
	IsActive           int     `json:"is_active"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

type Client struct {
	ID                 string  `json:"id"`
	ClientCode         string  `json:"client_code"`
	Name               string  `json:"name"`
	NameEn             string  `json:"name_en"`
	Phone              string  `json:"phone"`
	Mobile             string  `json:"mobile"`
	Email              string  `json:"email"`
	Address            string  `json:"address"`
	BuildingNo         string  `json:"building_no"`
	Street             string  `json:"street"`
	District           string  `json:"district"`
	City               string  `json:"city"`
	PostalCode         string  `json:"postal_code"`
	Country            string  `json:"country"`
	TaxNumber          string  `json:"tax_number"`
	CommercialRegister string  `json:"commercial_register"`
	ClientType         string  `json:"client_type"`
	PaymentTermsDays   int     `json:"payment_terms_days"`
	OpeningBalance     int64   `json:"opening_balance"` // halalas
	CreditLimit        int64   `json:"credit_limit"`    // halalas
	CurrentBalance     int64   `json:"current_balance"` // calculated
	Notes              string  `json:"notes"`
	IsActive           int     `json:"is_active"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

type ItemCategory struct {
	ID          string  `json:"id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	ParentID    *string `json:"parent_id"`
	Description string  `json:"description"`
	CreatedAt   string  `json:"created_at"`
}

type Item struct {
	ID         string  `json:"id"`
	ItemCode   string  `json:"item_code"`
	CategoryID *string `json:"category_id"`
	NameAr     string  `json:"name_ar"`
	NameEn     string  `json:"name_en"`
	Barcode    string  `json:"barcode"`
	Unit       string  `json:"unit"`
	CostPrice  int64   `json:"cost_price"`
	SalePrice  int64   `json:"sale_price"`
	TaxRate    float64 `json:"tax_rate"`
	IsActive   int     `json:"is_active"`
	Notes      string  `json:"notes"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

type Invoice struct {
	ID                  string        `json:"id"`
	IssuerID            string        `json:"issuer_id"`
	ClientID            string        `json:"client_id"`
	InvoiceNumber       string        `json:"invoice_number"`
	SequenceNo          int64         `json:"sequence_no"`
	InvoiceType         string        `json:"invoice_type"`
	ZatcaPhase          string        `json:"zatca_phase"`
	UUID                string        `json:"uuid"`
	IssueDate           string        `json:"issue_date"`
	IssueTime           string        `json:"issue_time"`
	IssueDatetime       string        `json:"issue_datetime"`
	Currency            string        `json:"currency"`
	Subtotal            int64         `json:"subtotal"`
	DiscountAmount      int64         `json:"discount_amount"`
	TaxableAmount       int64         `json:"taxable_amount"`
	TaxAmount           int64         `json:"tax_amount"`
	GrandTotal          int64         `json:"grand_total"`
	PaidAmount          int64         `json:"paid_amount"`
	RemainingAmount     int64         `json:"remaining_amount"`
	Status              string        `json:"status"`
	PaymentMethod       string        `json:"payment_method"`
	DueDate             *string       `json:"due_date"`
	ChequeDate          *string       `json:"cheque_date"`
	ChequeNo            string        `json:"cheque_no"`
	PricesIncludeTax    int           `json:"prices_include_tax"`
	BatchID             *string       `json:"batch_id"`
	QrPayload           string        `json:"qr_payload"`
	InvoiceHash         string        `json:"invoice_hash"`
	PreviousInvoiceHash string        `json:"previous_invoice_hash"`
	SellerName          string        `json:"seller_name"`
	SellerTaxNumber     string        `json:"seller_tax_number"`
	SellerCr            string        `json:"seller_cr"`
	SellerAddress       string        `json:"seller_address"`
	SellerAddressEn     string        `json:"seller_address_en"`
	BuyerName           string        `json:"buyer_name"`
	BuyerTaxNumber      string        `json:"buyer_tax_number"`
	BuyerCr             string        `json:"buyer_cr"`
	BuyerAddress        string        `json:"buyer_address"`
	Signature           string        `json:"signature"`
	SignatureMode       string        `json:"signature_mode"`
	Notes               string        `json:"notes"`
	CreatedBy           string        `json:"created_by"`
	CreatedAt           string        `json:"created_at"`
	UpdatedAt           string        `json:"updated_at"`
	ClientName          string        `json:"client_name,omitempty"`
	IssuerName          string        `json:"issuer_name,omitempty"`
	Items               []InvoiceItem `json:"items,omitempty"`
}

type InvoiceItem struct {
	ID          string  `json:"id"`
	InvoiceID   string  `json:"invoice_id"`
	ItemID      *string `json:"item_id"`
	LineNo      int     `json:"line_no"`
	ItemCode    string  `json:"item_code"`
	ItemName    string  `json:"item_name"`
	Unit        string  `json:"unit"`
	Quantity    float64 `json:"quantity"`
	UnitPrice   int64   `json:"unit_price"`
	Discount    int64   `json:"discount"`
	TaxRate     float64 `json:"tax_rate"`
	Taxable     int64   `json:"taxable"`
	TaxAmount   int64   `json:"tax_amount"`
	TotalLine   int64   `json:"total_line"`
}

type ReceiptVoucher struct {
	ID             string              `json:"id"`
	VoucherNumber  string              `json:"voucher_number"`
	IssuerID       string              `json:"issuer_id"`
	ClientID       string              `json:"client_id"`
	VoucherDate    string              `json:"voucher_date"`
	TotalAmount    int64               `json:"total_amount"`
	AllocatedTotal int64               `json:"allocated_total"`
	PaymentType    string              `json:"payment_type"`
	ReferenceNo    string              `json:"reference_no"`
	Notes          string              `json:"notes"`
	Status         string              `json:"status"`
	CreatedBy      string              `json:"created_by"`
	CreatedAt      string              `json:"created_at"`
	UpdatedAt      string              `json:"updated_at"`
	ClientName     string              `json:"client_name,omitempty"`
	IssuerName     string              `json:"issuer_name,omitempty"`
	Allocations    []VoucherAllocation `json:"allocations,omitempty"`
}

type VoucherAllocation struct {
	ID              string `json:"id"`
	VoucherID       string `json:"voucher_id"`
	InvoiceID       string `json:"invoice_id"`
	InvoiceNumber   string `json:"invoice_number,omitempty"`
	AllocatedAmount int64  `json:"allocated_amount"`
	CreatedAt       string `json:"created_at"`
}

type ClientLedgerEntry struct {
	ID              string  `json:"id"`
	ClientID        string  `json:"client_id"`
	IssuerID        *string `json:"issuer_id"`
	DocType         string  `json:"doc_type"`
	DocID           *string `json:"doc_id"`
	DocNumber       string  `json:"doc_number"`
	TransactionDate string  `json:"transaction_date"`
	Debit           int64   `json:"debit"`
	Credit          int64   `json:"credit"`
	Balance         int64   `json:"balance"` // calculated running balance
	Description     string  `json:"description"`
	CreatedAt       string  `json:"created_at"`
}

type AuditLog struct {
	ID         string  `json:"id"`
	UserName   string  `json:"user_name"`
	Action     string  `json:"action"`
	EntityType string  `json:"entity_type"`
	EntityID   *string `json:"entity_id"`
	IssuerID   *string `json:"issuer_id"`
	Details    string  `json:"details"`
	IP         string  `json:"ip"`
	CreatedAt  string  `json:"created_at"`
}

type ExcelTemplate struct {
	ID          string `json:"id"`
	NameAr      string `json:"name_ar"`
	NameEn      string `json:"name_en"`
	Description string `json:"description"`
	Badge       string `json:"badge"`
	Category    string `json:"category"`
	FilePath    string `json:"file_path"`
	ColorHex    string `json:"color_hex"`
	HeadersJSON string `json:"headers_json"`
	IsActive    int    `json:"is_active"`
	UpdatedAt   string `json:"updated_at"`
}
