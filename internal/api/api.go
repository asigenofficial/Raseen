package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"strconv"
	"strings"

	"raseen/internal/config"
	"raseen/internal/db"
	"raseen/internal/excel"
	"raseen/internal/models"
	"raseen/internal/services"
)

type Server struct {
	cfg        *config.Config
	db         *db.DB
	auth       *services.AuthService
	issuers    *services.IssuerService
	clients    *services.ClientService
	items      *services.ItemService
	invoices   *services.InvoiceService
	vouchers   *services.VoucherService
	reports    *services.ReportService
	masterKey  []byte
	publicFS   fs.FS
}

func NewServer(
	cfg *config.Config,
	database *db.DB,
	masterKey []byte,
	publicFS fs.FS,
) *Server {
	authSvc := services.NewAuthService(database)
	issuerSvc := services.NewIssuerService(database)
	clientSvc := services.NewClientService(database)
	itemSvc := services.NewItemService(database)
	invoiceSvc := services.NewInvoiceService(database, issuerSvc, masterKey)
	voucherSvc := services.NewVoucherService(database, issuerSvc)
	reportSvc := services.NewReportService(database)

	return &Server{
		cfg:       cfg,
		db:        database,
		auth:      authSvc,
		issuers:   issuerSvc,
		clients:   clientSvc,
		items:     itemSvc,
		invoices:  invoiceSvc,
		vouchers:  voucherSvc,
		reports:   reportSvc,
		masterKey: masterKey,
		publicFS:  publicFS,
	}
}

func (s *Server) json(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":   true,
		"data": data,
	})
}

func (s *Server) err(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"error": msg,
	})
}

func (s *Server) getSessionUser(r *http.Request) *models.User {
	c, err := r.Cookie("zs_session")
	if err != nil || c.Value == "" {
		return nil
	}
	u, err := s.auth.ValidateSession(c.Value)
	if err != nil {
		return nil
	}
	return u
}

func (s *Server) clientIP(r *http.Request) string {
	fwd := r.Header.Get("X-Forwarded-For")
	if fwd != "" {
		parts := strings.Split(fwd, ",")
		return strings.TrimSpace(parts[0])
	}
	return r.RemoteAddr
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// ---------------------------------------------------- العامة والنظام
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, 200, map[string]any{
			"service":  "Raseen",
			"database": "connected",
			"time":     db.NowIso(),
		})
	})

	mux.HandleFunc("GET /api/meta", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, 200, map[string]any{
			"name":             "Raseen",
			"version":          "1.1.0",
			"currency":         s.cfg.Defaults.Currency,
			"default_tax_rate": s.cfg.Defaults.TaxRate,
			"country":          s.cfg.Defaults.Country,
			"invoice_statuses": map[string]string{
				"UNPAID":    "غير مسددة",
				"PARTIAL":   "مسددة جزئياً",
				"PAID":      "مسددة",
				"CANCELLED": "ملغاة",
			},
			"payment_methods": map[string]string{
				"CASH":     "نقداً",
				"CARD":     "شبكة",
				"TRANSFER": "تحويل بنكي",
				"CREDIT":   "آجل",
				"CHEQUE":   "شيك",
			},
			"payment_types": map[string]string{
				"CASH":     "نقداً",
				"TRANSFER": "تحويل بنكي",
				"CHEQUE":   "شيك",
				"CARD":     "شبكة",
			},
		})
	})

	mux.HandleFunc("GET /api/system/backup", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil || u.Role != "ADMIN" {
			s.err(w, 403, "أخذ النسخ الاحتياطية محصور بمدير النظام")
			return
		}
		res, err := s.db.CreateBackup()
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.db.Audit(u.Username, "DATABASE_BACKUP", "system", "", "", nil, s.clientIP(r))
		s.json(w, 200, res)
	})

	// ---------------------------------------------------- المصادقة
	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات الدخول غير صالحة")
			return
		}
		user, token, err := s.auth.Login(req.Username, req.Password, s.clientIP(r))
		if err != nil {
			s.err(w, 401, err.Error())
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name:     "zs_session",
			Value:    token,
			Path:     "/",
			MaxAge:   s.cfg.SessionTtlHours * 3600,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
		s.json(w, 200, user)
	})

	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie("zs_session"); err == nil {
			s.auth.Logout(c.Value)
		}
		http.SetCookie(w, &http.Cookie{
			Name:     "zs_session",
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
		})
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		s.json(w, 200, u)
	})

	mux.HandleFunc("POST /api/auth/password", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		var req struct {
			OldPassword string `json:"old_password"`
			NewPassword string `json:"new_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.auth.ChangePassword(u.ID, req.OldPassword, req.NewPassword); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	// ---------------------------------------------------- الشركات المصدرة
	mux.HandleFunc("GET /api/issuers", func(w http.ResponseWriter, r *http.Request) {
		activeOnly := r.URL.Query().Get("active_only") == "1" || r.URL.Query().Get("active_only") == "true"
		list, err := s.issuers.ListIssuers(activeOnly)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, list)
	})

	mux.HandleFunc("GET /api/issuers/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		iss, err := s.issuers.GetIssuer(id)
		if err != nil {
			s.err(w, 404, "المنشأة غير موجودة")
			return
		}
		s.json(w, 200, iss)
	})

	mux.HandleFunc("POST /api/issuers", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		var iss models.Issuer
		if err := json.NewDecoder(r.Body).Decode(&iss); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.issuers.CreateIssuer(&iss); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, iss)
	})

	mux.HandleFunc("PUT /api/issuers/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		id := r.PathValue("id")
		var iss models.Issuer
		if err := json.NewDecoder(r.Body).Decode(&iss); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.issuers.UpdateIssuer(id, &iss); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, iss)
	})

	mux.HandleFunc("DELETE /api/issuers/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil || u.Role != "ADMIN" {
			s.err(w, 403, "الحذف محصور بمدير النظام")
			return
		}
		id := r.PathValue("id")
		if err := s.issuers.DeleteIssuer(id); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	// ---------------------------------------------------- العملاء
	mux.HandleFunc("GET /api/clients", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		list, err := s.clients.ListClients(services.ListClientsFilter{
			Search:       q.Get("q"),
			ActiveOnly:   q.Get("active_only") == "1" || q.Get("active_only") == "true",
			WithBalances: true,
			IssuerID:     q.Get("issuer_id"),
			ClientType:   q.Get("client_type"),
			City:         q.Get("city"),
			OnlyDebtors:  q.Get("only_debtors") == "1" || q.Get("only_debtors") == "true",
		})
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, list)
	})

	mux.HandleFunc("GET /api/clients/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		c, err := s.clients.GetClient(id)
		if err != nil {
			s.err(w, 404, "العميل غير موجود")
			return
		}
		s.json(w, 200, c)
	})

	mux.HandleFunc("POST /api/clients", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		var c models.Client
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.clients.CreateClient(&c); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, c)
	})

	mux.HandleFunc("PUT /api/clients/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		id := r.PathValue("id")
		var c models.Client
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.clients.UpdateClient(id, &c); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, c)
	})

	mux.HandleFunc("DELETE /api/clients/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		id := r.PathValue("id")
		if err := s.clients.DeleteClient(id); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/clients/{id}/statement", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		q := r.URL.Query()
		res, err := s.clients.Statement(services.StatementParams{
			ClientID: id,
			IssuerID: q.Get("issuer_id"),
			FromDate: q.Get("from"),
			ToDate:   q.Get("to"),
		})
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	// ---------------------------------------------------- الأصناف والمجموعات
	mux.HandleFunc("GET /api/categories", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.items.ListCategories()
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, list)
	})

	mux.HandleFunc("POST /api/categories", func(w http.ResponseWriter, r *http.Request) {
		var cat models.ItemCategory
		if err := json.NewDecoder(r.Body).Decode(&cat); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.items.CreateCategory(&cat); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, cat)
	})

	mux.HandleFunc("GET /api/items", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		activeOnly := q.Get("active_only") == "1" || q.Get("active_only") == "true"
		list, err := s.items.ListItems(q.Get("q"), q.Get("category_id"), activeOnly)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, list)
	})

	mux.HandleFunc("GET /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		itm, err := s.items.GetItem(id)
		if err != nil {
			s.err(w, 404, "الصنف غير موجود")
			return
		}
		s.json(w, 200, itm)
	})

	mux.HandleFunc("POST /api/items", func(w http.ResponseWriter, r *http.Request) {
		var itm models.Item
		if err := json.NewDecoder(r.Body).Decode(&itm); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.items.CreateItem(&itm); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, itm)
	})

	mux.HandleFunc("PUT /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var itm models.Item
		if err := json.NewDecoder(r.Body).Decode(&itm); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.items.UpdateItem(id, &itm); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, itm)
	})

	mux.HandleFunc("DELETE /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.items.DeleteItem(id); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	// ---------------------------------------------------- الفواتير
	mux.HandleFunc("GET /api/invoices", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		page, _ := strconv.Atoi(q.Get("page"))
		limit, _ := strconv.Atoi(q.Get("limit"))
		res, err := s.invoices.ListInvoices(services.ListInvoicesFilter{
			IssuerID: q.Get("issuer_id"),
			ClientID: q.Get("client_id"),
			Status:   q.Get("status"),
			FromDate: q.Get("from"),
			ToDate:   q.Get("to"),
			Search:   q.Get("q"),
			Page:     page,
			Limit:    limit,
		})
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/invoices/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		inv, err := s.invoices.GetInvoice(id)
		if err != nil {
			s.err(w, 404, "الفاتورة غير موجودة")
			return
		}
		s.json(w, 200, inv)
	})

	mux.HandleFunc("POST /api/invoices", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		var input services.CreateInvoiceInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات الفاتورة غير صالحة")
			return
		}
		inv, err := s.invoices.CreateInvoice(input, actor, s.clientIP(r))
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, inv)
	})

	mux.HandleFunc("POST /api/invoices/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		id := r.PathValue("id")
		if err := s.invoices.CancelInvoice(id, actor, s.clientIP(r)); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("DELETE /api/invoices/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		id := r.PathValue("id")
		if err := s.invoices.DeleteInvoice(id, actor, s.clientIP(r)); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/invoices/{id}/xml", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		xmlStr, err := s.invoices.GetXml(id)
		if err != nil {
			s.err(w, 404, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(xmlStr))
	})

	mux.HandleFunc("GET /api/invoices/template", func(w http.ResponseWriter, r *http.Request) {
		b, err := excel.GenerateTemplateExcel()
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", "attachment; filename=\"invoice-import-template.xlsx\"")
		w.WriteHeader(200)
		_, _ = w.Write(b)
	})

	mux.HandleFunc("POST /api/invoices/parse-file", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			FileBase64 string `json:"file_base64"`
			Filename   string `json:"filename"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات الملف غير صالحة")
			return
		}
		data, err := base64.StdEncoding.DecodeString(req.FileBase64)
		if err != nil {
			// try raw url encoding if base64 failed
			data, err = base64.RawStdEncoding.DecodeString(req.FileBase64)
			if err != nil {
				s.err(w, 400, "ترميز الملف غير صالح")
				return
			}
		}

		res, err := excel.AnalyzeSpreadsheet(bytes.NewReader(data), req.Filename, s.cfg.Defaults.TaxRate)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	// ---------------------------------------------------- سندات القبض
	mux.HandleFunc("GET /api/vouchers", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		page, _ := strconv.Atoi(q.Get("page"))
		limit, _ := strconv.Atoi(q.Get("limit"))
		res, err := s.vouchers.ListVouchers(services.ListVouchersFilter{
			IssuerID: q.Get("issuer_id"),
			ClientID: q.Get("client_id"),
			Status:   q.Get("status"),
			FromDate: q.Get("from"),
			ToDate:   q.Get("to"),
			Search:   q.Get("q"),
			Page:     page,
			Limit:    limit,
		})
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/vouchers/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		v, err := s.vouchers.GetVoucher(id)
		if err != nil {
			s.err(w, 404, "سند القبض غير موجود")
			return
		}
		s.json(w, 200, v)
	})

	mux.HandleFunc("POST /api/vouchers", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		var input services.CreateVoucherInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات السند غير صالحة")
			return
		}
		v, err := s.vouchers.CreateVoucher(input, actor, s.clientIP(r))
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, v)
	})

	mux.HandleFunc("POST /api/vouchers/for-invoice", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		var req struct {
			InvoiceID   string  `json:"invoice_id"`
			Amount      float64 `json:"amount"`
			PaymentType string  `json:"payment_type"`
			VoucherDate string  `json:"voucher_date"`
			Notes       string  `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		inv, err := s.invoices.GetInvoice(req.InvoiceID)
		if err != nil {
			s.err(w, 404, "الفاتورة غير موجودة")
			return
		}

		v, err := s.vouchers.CreateVoucher(services.CreateVoucherInput{
			IssuerID:    inv.IssuerID,
			ClientID:    inv.ClientID,
			VoucherDate: req.VoucherDate,
			TotalAmount: req.Amount,
			PaymentType: req.PaymentType,
			Notes:       req.Notes,
			Allocations: []services.VoucherAllocationInput{
				{InvoiceID: inv.ID, Amount: req.Amount},
			},
		}, actor, s.clientIP(r))
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, v)
	})

	mux.HandleFunc("POST /api/vouchers/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		id := r.PathValue("id")
		if err := s.vouchers.CancelVoucher(id, actor, s.clientIP(r)); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	// ---------------------------------------------------- التقارير
	mux.HandleFunc("GET /api/reports/dashboard", func(w http.ResponseWriter, r *http.Request) {
		issuerID := r.URL.Query().Get("issuer_id")
		stats, err := s.reports.DashboardStats(issuerID)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, stats)
	})

	mux.HandleFunc("GET /api/reports/tax", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res, err := s.reports.TaxReport(q.Get("issuer_id"), q.Get("from"), q.Get("to"))
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/reports/aging", func(w http.ResponseWriter, r *http.Request) {
		issuerID := r.URL.Query().Get("issuer_id")
		res, err := s.reports.AgingReport(issuerID)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/reports/client-balances", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		onlyDebtors := q.Get("only_debtors") == "1" || q.Get("only_debtors") == "true"
		res, err := s.clients.Balances(q.Get("issuer_id"), onlyDebtors)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	// ---------------------------------------------------- سجل التدقيق
	mux.HandleFunc("GET /api/audit", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.db.Query(`
			SELECT id, user_name, action, entity_type, COALESCE(entity_id, ''), details, ip, created_at
			FROM audit_logs ORDER BY created_at DESC LIMIT 100
		`)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		defer rows.Close()

		var list []map[string]any
		for rows.Next() {
			var id, u, act, et, eid, det, ip, cat string
			if err := rows.Scan(&id, &u, &act, &et, &eid, &det, &ip, &cat); err == nil {
				list = append(list, map[string]any{
					"id":          id,
					"user_name":   u,
					"action":      act,
					"entity_type": et,
					"entity_id":   eid,
					"details":     det,
					"ip":          ip,
					"created_at":  cat,
				})
			}
		}
		s.json(w, 200, list)
	})

	// ---------------------------------------------------- واجهة الويب الثابتة (Public SPA)
	fileServer := http.FileServer(http.FS(s.publicFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			s.err(w, 404, "المسار غير موجود")
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// Try opening file from publicFS
		f, err := s.publicFS.Open(path)
		if err != nil {
			// SPA Fallback to index.html
			fIndex, errIndex := s.publicFS.Open("index.html")
			if errIndex != nil {
				http.NotFound(w, r)
				return
			}
			defer fIndex.Close()
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.Copy(w, fIndex)
			return
		}
		defer f.Close()

		fileServer.ServeHTTP(w, r)
	})

	// Wrap with standard middleware
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "same-origin")
		mux.ServeHTTP(w, r)
	})
}
