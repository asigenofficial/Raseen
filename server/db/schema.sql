-- ============================================================================
--  Raseen — مخطط قاعدة البيانات (SQLite)
--  كل المبالغ المالية تُخزَّن كأعداد صحيحة بالهللات (1 ريال = 100).
--  الكميات تُخزَّن كأرقام عشرية (REAL) لدعم الوحدات القابلة للتجزئة.
-- ============================================================================

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------------------------------------------------------------- المستخدمون
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'ACCOUNTANT',  -- ADMIN | ACCOUNTANT | VIEWER
  permissions   TEXT NOT NULL DEFAULT '[]',          -- JSON array للصلاحيات الإضافية
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------- الشركات المصدرة
CREATE TABLE IF NOT EXISTS issuers (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name_ar             TEXT NOT NULL,
  name_en             TEXT NOT NULL DEFAULT '',
  tax_number          TEXT NOT NULL DEFAULT '',
  commercial_register TEXT NOT NULL DEFAULT '',
  street              TEXT NOT NULL DEFAULT '',
  building_no         TEXT NOT NULL DEFAULT '',
  district            TEXT NOT NULL DEFAULT '',
  city                TEXT NOT NULL DEFAULT '',
  postal_code         TEXT NOT NULL DEFAULT '',
  country             TEXT NOT NULL DEFAULT 'SA',
  phone               TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  website             TEXT NOT NULL DEFAULT '',
  logo_data           TEXT,                              -- data URL للشعار
  default_tax_rate    REAL NOT NULL DEFAULT 15,
  currency            TEXT NOT NULL DEFAULT 'SAR',
  invoice_prefix      TEXT NOT NULL DEFAULT 'INV',
  invoice_next_no     INTEGER NOT NULL DEFAULT 1,
  invoice_pad         INTEGER NOT NULL DEFAULT 5,
  voucher_prefix      TEXT NOT NULL DEFAULT 'RV',
  voucher_next_no     INTEGER NOT NULL DEFAULT 1,
  zatca_phase         TEXT NOT NULL DEFAULT 'PHASE1',    -- PHASE1 | PHASE2
  qr_settings         TEXT NOT NULL DEFAULT '{}',        -- JSON
  print_settings      TEXT NOT NULL DEFAULT '{}',        -- JSON: الخطوط والأحجام ووضع القالب الجاهز
  bank_name           TEXT NOT NULL DEFAULT '',
  bank_iban           TEXT NOT NULL DEFAULT '',
  footer_notes        TEXT NOT NULL DEFAULT '',
  legal_terms         TEXT NOT NULL DEFAULT '',
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- بيانات الربط الحساسة (مشفّرة AES-256-GCM)
CREATE TABLE IF NOT EXISTS issuer_credentials (
  issuer_id           TEXT PRIMARY KEY REFERENCES issuers(id) ON DELETE CASCADE,
  compliance_csid_enc TEXT,
  production_csid_enc TEXT,
  secret_enc          TEXT,
  private_key_enc     TEXT,
  certificate_enc     TEXT,
  public_key_der      TEXT,
  updated_at          TEXT NOT NULL
);

-- ---------------------------------------------------------------- العملاء
CREATE TABLE IF NOT EXISTS clients (
  id                  TEXT PRIMARY KEY,
  client_code         TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  name_en             TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  mobile              TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  address             TEXT NOT NULL DEFAULT '',
  city                TEXT NOT NULL DEFAULT '',
  tax_number          TEXT NOT NULL DEFAULT '',
  commercial_register TEXT NOT NULL DEFAULT '',
  client_type         TEXT NOT NULL DEFAULT 'COMPANY',
  payment_terms_days  INTEGER NOT NULL DEFAULT 0,
  opening_balance     INTEGER NOT NULL DEFAULT 0,
  credit_limit        INTEGER NOT NULL DEFAULT 0,
  notes               TEXT NOT NULL DEFAULT '',
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_search ON clients(is_active, name);
CREATE INDEX IF NOT EXISTS idx_clients_code ON clients(client_code);

-- ------------------------------------------------------- مجموعات الأصناف
CREATE TABLE IF NOT EXISTS item_categories (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES item_categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------- الأصناف
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  item_code   TEXT NOT NULL UNIQUE,
  category_id TEXT REFERENCES item_categories(id) ON DELETE SET NULL,
  name_ar     TEXT NOT NULL,
  name_en     TEXT NOT NULL DEFAULT '',
  barcode     TEXT NOT NULL DEFAULT '',
  unit        TEXT NOT NULL DEFAULT 'حبة',
  cost_price  INTEGER NOT NULL DEFAULT 0,
  sale_price  INTEGER NOT NULL DEFAULT 0,
  tax_rate    REAL NOT NULL DEFAULT 15,
  is_active   INTEGER NOT NULL DEFAULT 1,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name_ar);
CREATE INDEX IF NOT EXISTS idx_items_search ON items(is_active, category_id, name_ar);

-- ------------------------------------------------------------ دفعات التوليد
CREATE TABLE IF NOT EXISTS invoice_batches (
  id            TEXT PRIMARY KEY,
  issuer_id     TEXT NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  params        TEXT NOT NULL DEFAULT '{}',
  invoice_count INTEGER NOT NULL DEFAULT 0,
  total_amount  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'COMMITTED',
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------- الفواتير
CREATE TABLE IF NOT EXISTS invoices (
  id                    TEXT PRIMARY KEY,
  issuer_id             TEXT NOT NULL REFERENCES issuers(id) ON DELETE RESTRICT,
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number        TEXT NOT NULL,
  sequence_no           INTEGER NOT NULL DEFAULT 1,       -- ICV داخل سلسلة المنشأة
  invoice_type          TEXT NOT NULL DEFAULT 'STANDARD', -- STANDARD | SIMPLIFIED
  uuid                  TEXT NOT NULL,
  issue_date            TEXT NOT NULL,
  issue_time            TEXT NOT NULL DEFAULT '12:00:00',
  issue_datetime        TEXT NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'SAR',
  subtotal              INTEGER NOT NULL DEFAULT 0,
  discount_amount       INTEGER NOT NULL DEFAULT 0,
  taxable_amount        INTEGER NOT NULL DEFAULT 0,
  tax_amount            INTEGER NOT NULL DEFAULT 0,
  grand_total           INTEGER NOT NULL DEFAULT 0,
  paid_amount           INTEGER NOT NULL DEFAULT 0,
  remaining_amount      INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'UNPAID',   -- UNPAID | PARTIAL | PAID | CANCELLED
  payment_method        TEXT NOT NULL DEFAULT 'CREDIT',   -- CASH | CARD | TRANSFER | CREDIT | CHEQUE
  due_date              TEXT,                             -- تاريخ الاستحقاق (للآجل والشيك)
  cheque_date           TEXT,                             -- تاريخ الشيك عند السداد بشيك
  cheque_no             TEXT NOT NULL DEFAULT '',         -- رقم الشيك / المرجع
  prices_include_tax    INTEGER NOT NULL DEFAULT 0,       -- 1 = الأسعار المدخلة شاملة الضريبة
  batch_id              TEXT REFERENCES invoice_batches(id) ON DELETE SET NULL,
  qr_payload            TEXT NOT NULL DEFAULT '',
  invoice_hash          TEXT NOT NULL DEFAULT '',
  previous_invoice_hash TEXT NOT NULL DEFAULT '',
  seller_name           TEXT NOT NULL DEFAULT '',
  seller_tax_number     TEXT NOT NULL DEFAULT '',
  seller_cr             TEXT NOT NULL DEFAULT '',
  seller_address        TEXT NOT NULL DEFAULT '',
  buyer_name            TEXT NOT NULL DEFAULT '',
  buyer_tax_number      TEXT NOT NULL DEFAULT '',
  buyer_cr              TEXT NOT NULL DEFAULT '',
  buyer_address         TEXT NOT NULL DEFAULT '',
  signature             TEXT NOT NULL DEFAULT '',
  signature_mode        TEXT NOT NULL DEFAULT 'NONE',     -- NONE | LOCAL | PRODUCTION
  notes                 TEXT NOT NULL DEFAULT '',
  created_by            TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (issuer_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issuer ON invoices(issuer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_batch ON invoices(batch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_seq ON invoices(issuer_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_invoices_search_compound ON invoices(issuer_id, status, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_client_date ON invoices(client_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_payment ON invoices(payment_method);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(invoice_type);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id     TEXT REFERENCES items(id) ON DELETE SET NULL,
  line_no     INTEGER NOT NULL DEFAULT 1,
  item_code   TEXT NOT NULL DEFAULT '',
  item_name   TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT '',
  quantity    REAL NOT NULL DEFAULT 1,
  unit_price  INTEGER NOT NULL DEFAULT 0,
  discount    INTEGER NOT NULL DEFAULT 0,
  tax_rate    REAL NOT NULL DEFAULT 15,
  taxable     INTEGER NOT NULL DEFAULT 0,
  tax_amount  INTEGER NOT NULL DEFAULT 0,
  total_line  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_search ON invoice_items(invoice_id, item_name);

-- ----------------------------------------------------------- سندات القبض
CREATE TABLE IF NOT EXISTS receipt_vouchers (
  id              TEXT PRIMARY KEY,
  voucher_number  TEXT NOT NULL,
  issuer_id       TEXT NOT NULL REFERENCES issuers(id) ON DELETE RESTRICT,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  voucher_date    TEXT NOT NULL,
  total_amount    INTEGER NOT NULL DEFAULT 0,
  allocated_total INTEGER NOT NULL DEFAULT 0,
  payment_type    TEXT NOT NULL DEFAULT 'CASH',  -- CASH | TRANSFER | CHEQUE | CARD
  reference_no    TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | CANCELLED
  created_by      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (issuer_id, voucher_number)
);
CREATE INDEX IF NOT EXISTS idx_vouchers_client ON receipt_vouchers(client_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_date ON receipt_vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_search_compound ON receipt_vouchers(issuer_id, status, voucher_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_type ON receipt_vouchers(payment_type);

CREATE TABLE IF NOT EXISTS voucher_allocations (
  id               TEXT PRIMARY KEY,
  voucher_id       TEXT NOT NULL REFERENCES receipt_vouchers(id) ON DELETE CASCADE,
  invoice_id       TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  allocated_amount INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alloc_voucher ON voucher_allocations(voucher_id);
CREATE INDEX IF NOT EXISTS idx_alloc_invoice ON voucher_allocations(invoice_id);

-- ------------------------------------------------- قيود كشف حساب العميل
-- ملاحظة: لا يتم تخزين balance_after لأن الرصيد التراكمي يعتمد على نطاق
-- العرض (موحّد لكل الشركات أو مفلتر لشركة واحدة)؛ يُحسب لحظياً عند القراءة
-- لضمان صحته في كل الحالات.
CREATE TABLE IF NOT EXISTS client_ledger (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  issuer_id        TEXT REFERENCES issuers(id) ON DELETE CASCADE,
  doc_type         TEXT NOT NULL,  -- OPENING_BALANCE | INVOICE | RECEIPT
  doc_id           TEXT,
  doc_number       TEXT NOT NULL DEFAULT '',
  transaction_date TEXT NOT NULL,
  debit            INTEGER NOT NULL DEFAULT 0,
  credit           INTEGER NOT NULL DEFAULT 0,
  description      TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_client ON client_ledger(client_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_ledger_issuer ON client_ledger(issuer_id);
CREATE INDEX IF NOT EXISTS idx_ledger_doc ON client_ledger(doc_type, doc_id);

-- ---------------------------------------------------------- سجل التدقيق
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  user_name   TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  issuer_id   TEXT,
  details     TEXT NOT NULL DEFAULT '{}',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------- إعدادات النظام
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------ مسودات الدفعات (المعاينة)
-- تُحفظ معاينة الدفعة كمسودة قابلة لإعادة الفتح والتعديل فاتورة بفاتورة
-- قبل الاعتماد النهائي. payload يحتوي الفواتير المعاينة كاملة بصيغة JSON.
CREATE TABLE IF NOT EXISTS bulk_drafts (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL DEFAULT '',
  issuer_id      TEXT NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
  client_id      TEXT REFERENCES clients(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT | PARTIAL | COMMITTED
  params         TEXT NOT NULL DEFAULT '{}',      -- معاملات التوليد الأصلية
  payload        TEXT NOT NULL DEFAULT '[]',      -- الفواتير المعاينة (JSON)
  invoice_count  INTEGER NOT NULL DEFAULT 0,
  grand_total    INTEGER NOT NULL DEFAULT 0,
  committed_ids  TEXT NOT NULL DEFAULT '[]',      -- معرفات الفواتير المُصدرة فعلاً
  batch_id       TEXT REFERENCES invoice_batches(id) ON DELETE SET NULL,
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_issuer ON bulk_drafts(issuer_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON bulk_drafts(status, updated_at);

