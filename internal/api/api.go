package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"raseen/internal/config"
	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/excel"
	"raseen/internal/models"
	"raseen/internal/services"
)

type Server struct {
	cfg       *config.Config
	db        *db.DB
	auth      *services.AuthService
	issuers   *services.IssuerService
	clients   *services.ClientService
	items     *services.ItemService
	invoices  *services.InvoiceService
	vouchers  *services.VoucherService
	reports   *services.ReportService
	bulk      *services.BulkService
	templates *services.TemplateService
	masterKey []byte
	publicFS  fs.FS
}

func NewServer(
	cfg *config.Config,
	database *db.DB,
	masterKey []byte,
	publicFS fs.FS,
) *Server {
	authSvc := services.NewAuthService(database, cfg.SessionTtlHours)
	issuerSvc := services.NewIssuerService(database)
	clientSvc := services.NewClientService(database)
	itemSvc := services.NewItemService(database)
	invoiceSvc := services.NewInvoiceService(database, issuerSvc, masterKey)
	voucherSvc := services.NewVoucherService(database, issuerSvc)
	reportSvc := services.NewReportService(database)
	bulkSvc := services.NewBulkService(database, invoiceSvc, voucherSvc, issuerSvc, clientSvc, itemSvc)
	templateSvc := services.NewTemplateService(database, cfg.DataDir)

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
		bulk:      bulkSvc,
		templates: templateSvc,
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
	if user, ok := r.Context().Value(sessionUserKey{}).(*models.User); ok {
		return user
	}
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
		roles, rolePerms := s.auth.GetRolesAndPermissions()
		s.json(w, 200, map[string]any{
			"name":             "Raseen",
			"version":          "1.1.0",
			"currency":         s.cfg.Defaults.Currency,
			"default_tax_rate": s.cfg.Defaults.TaxRate,
			"country":          s.cfg.Defaults.Country,
			"roles":            roles,
			"role_permissions": rolePerms,
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
			Secure:   r.TLS != nil,
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

	// ---------------------------------------------------- المستخدمون والأدوار
	mux.HandleFunc("GET /api/users", func(w http.ResponseWriter, r *http.Request) {
		users, err := s.auth.ListUsers()
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, users)
	})

	mux.HandleFunc("POST /api/users", func(w http.ResponseWriter, r *http.Request) {
		var input services.CreateUserInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		u, err := s.auth.CreateUser(input)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 201, u)
	})

	mux.HandleFunc("PUT /api/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var input services.UpdateUserInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		u, err := s.auth.UpdateUser(id, input)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, u)
	})

	mux.HandleFunc("DELETE /api/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		currUser := s.getSessionUser(r)
		currID := ""
		if currUser != nil {
			currID = currUser.ID
		}
		if err := s.auth.DeleteUser(id, currID); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/roles", func(w http.ResponseWriter, r *http.Request) {
		roles, rolePerms := s.auth.GetRolesAndPermissions()
		s.json(w, 200, map[string]any{
			"roles":            roles,
			"role_permissions": rolePerms,
		})
	})

	mux.HandleFunc("POST /api/roles", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Key         string   `json:"key"`
			Label       string   `json:"label"`
			Permissions []string `json:"permissions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.auth.CreateRole(input.Key, input.Label, input.Permissions); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 201, map[string]any{"ok": true})
	})

	mux.HandleFunc("PUT /api/roles/{id}", func(w http.ResponseWriter, r *http.Request) {
		roleID := r.PathValue("id")
		var input struct {
			Permissions []string `json:"permissions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.auth.UpdateRolePermissions(roleID, input.Permissions); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("DELETE /api/roles/{id}", func(w http.ResponseWriter, r *http.Request) {
		roleID := r.PathValue("id")
		if err := s.auth.DeleteRole(roleID); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/roles/{id}/reset", func(w http.ResponseWriter, r *http.Request) {
		roleID := r.PathValue("id")
		if err := s.auth.ResetRole(roleID); err != nil {
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
			s.err(w, 400, "بيانات المنشأة غير صالحة: "+err.Error())
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
			s.err(w, 400, "بيانات المنشأة غير صالحة: "+err.Error())
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

	mux.HandleFunc("POST /api/issuers/{id}/generate-key", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		kp, err := s.issuers.GenerateKeys(id, s.masterKey)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, map[string]any{
			"public_key_pem": kp.PublicKeyPem,
		})
	})

	mux.HandleFunc("GET /api/issuers/{id}/credentials", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		creds, err := s.issuers.GetCredentials(id, s.masterKey)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, creds)
	})

	mux.HandleFunc("PUT /api/issuers/{id}/credentials", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var input services.UpdateCredentialsInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.issuers.UpdateCredentials(id, input, s.masterKey); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/issuers/{id}/verify-chain", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		res, err := s.invoices.VerifyChain(id)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
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
			s.err(w, 400, "بيانات العميل غير صالحة: "+err.Error())
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
			s.err(w, 400, "بيانات العميل غير صالحة: "+err.Error())
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

	mux.HandleFunc("GET /api/clients/template", func(w http.ResponseWriter, r *http.Request) {
		b, err := excel.GenerateClientTemplateExcel()
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", "attachment; filename=\"clients-import-template.xlsx\"")
		w.WriteHeader(200)
		_, _ = w.Write(b)
	})

	mux.HandleFunc("POST /api/clients/analyze-excel", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			FileBase64 string `json:"file_base64"`
			Filename   string `json:"filename"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		data, err := base64.StdEncoding.DecodeString(req.FileBase64)
		if err != nil {
			data, err = base64.RawStdEncoding.DecodeString(req.FileBase64)
			if err != nil {
				s.err(w, 400, "ترميز الملف غير صالح")
				return
			}
		}
		res, err := excel.AnalyzeClientsSpreadsheet(bytes.NewReader(data), req.Filename)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("POST /api/clients/import", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Clients []services.ImportClientInput `json:"clients"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		res, err := s.clients.BatchImportClients(req.Clients)
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

	mux.HandleFunc("PUT /api/categories/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var cat models.ItemCategory
		if err := json.NewDecoder(r.Body).Decode(&cat); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.items.UpdateCategory(id, &cat); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		cat.ID = id
		s.json(w, 200, cat)
	})

	mux.HandleFunc("DELETE /api/categories/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.items.DeleteCategory(id); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
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

	mux.HandleFunc("GET /api/items/template", func(w http.ResponseWriter, r *http.Request) {
		b, err := excel.GenerateItemTemplateExcel()
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", "attachment; filename=\"items-import-template.xlsx\"")
		w.WriteHeader(200)
		_, _ = w.Write(b)
	})

	mux.HandleFunc("POST /api/items/analyze-excel", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			FileBase64 string `json:"file_base64"`
			Filename   string `json:"filename"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		data, err := base64.StdEncoding.DecodeString(req.FileBase64)
		if err != nil {
			data, err = base64.RawStdEncoding.DecodeString(req.FileBase64)
			if err != nil {
				s.err(w, 400, "ترميز الملف غير صالح")
				return
			}
		}
		res, err := excel.AnalyzeItemsSpreadsheet(bytes.NewReader(data), req.Filename, s.cfg.Defaults.TaxRate)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("POST /api/items/import", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Items []services.ImportItemInput `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		res, err := s.items.BatchImportItems(req.Items)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	// ---------------------------------------------------- الفواتير
	mux.HandleFunc("GET /api/invoices", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		page, _ := strconv.Atoi(q.Get("page"))
		limit, _ := strconv.Atoi(q.Get("limit"))
		offset, _ := strconv.Atoi(q.Get("offset"))
		minTotal, _ := strconv.ParseFloat(q.Get("min_total"), 64)
		maxTotal, _ := strconv.ParseFloat(q.Get("max_total"), 64)
		hasRemaining := q.Get("has_remaining") == "1" || q.Get("has_remaining") == "true"

		res, err := s.invoices.ListInvoices(services.ListInvoicesFilter{
			IssuerID:      q.Get("issuer_id"),
			ClientID:      q.Get("client_id"),
			Status:        q.Get("status"),
			InvoiceType:   q.Get("invoice_type"),
			PaymentMethod: q.Get("payment_method"),
			BatchID:       q.Get("batch_id"),
			HasRemaining:  hasRemaining,
			MinTotal:      minTotal,
			MaxTotal:      maxTotal,
			FromDate:      q.Get("from"),
			ToDate:        q.Get("to"),
			Search:        q.Get("q"),
			Page:          page,
			Limit:         limit,
			Offset:        offset,
		})
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/invoices/open", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		clientID := q.Get("client_id")
		issuerID := q.Get("issuer_id")
		res, err := s.invoices.GetOpenInvoices(clientID, issuerID)
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

	mux.HandleFunc("PUT /api/invoices/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		id := r.PathValue("id")
		var input services.CreateInvoiceInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات الفاتورة غير صالحة")
			return
		}
		inv, err := s.invoices.UpdateInvoice(id, input, actor, s.clientIP(r))
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

	mux.HandleFunc("GET /api/invoices/{id}/render-html", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		inv, err := s.invoices.GetInvoice(id)
		if err != nil {
			s.err(w, 404, "الفاتورة غير موجودة")
			return
		}
		style := r.URL.Query().Get("style")
		htmlStr, err := s.templates.RenderInvoiceHTML(inv, style)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(htmlStr))
	})

	mux.HandleFunc("GET /api/invoices/{id}/pdf", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		inv, err := s.invoices.GetInvoice(id)
		if err != nil {
			s.err(w, 404, "الفاتورة غير موجودة")
			return
		}
		style := r.URL.Query().Get("style")
		htmlStr, err := s.templates.RenderInvoiceHTML(inv, style)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		pdfBytes, err := services.RenderHTMLToPDF(htmlStr)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		filename := fmt.Sprintf("invoice_%s.pdf", inv.InvoiceNumber)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(pdfBytes)
	})

	mux.HandleFunc("POST /api/invoices/{id}/pdf", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			HTML string `json:"html"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)

		htmlStr := body.HTML
		var invNum string
		if strings.TrimSpace(htmlStr) == "" {
			inv, err := s.invoices.GetInvoice(id)
			if err != nil {
				s.err(w, 404, "الفاتورة غير موجودة")
				return
			}
			invNum = inv.InvoiceNumber
			style := r.URL.Query().Get("style")
			htmlStr, err = s.templates.RenderInvoiceHTML(inv, style)
			if err != nil {
				s.err(w, 500, err.Error())
				return
			}
		} else {
			if inv, err := s.invoices.GetInvoice(id); err == nil && inv != nil {
				invNum = inv.InvoiceNumber
			}
		}

		pdfBytes, err := services.RenderHTMLToPDF(htmlStr)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		if invNum == "" {
			invNum = id
		}
		filename := fmt.Sprintf("invoice_%s.pdf", invNum)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(pdfBytes)
	})

	mux.HandleFunc("POST /api/pdf/render", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			HTML     string `json:"html"`
			Filename string `json:"filename"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.HTML) == "" {
			s.err(w, 400, "محتوى المستند HTML مطلوب")
			return
		}
		pdfBytes, err := services.RenderHTMLToPDF(req.HTML)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		filename := req.Filename
		if filename == "" {
			filename = "document.pdf"
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(pdfBytes)
	})

	mux.HandleFunc("GET /api/invoices/template", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		style := q.Get("style")
		if style == "" {
			style = q.Get("id")
		}

		// If a specific template style or ID is requested, stream that template file
		if style != "" {
			filePath, err := s.templates.GetFilePath(style)
			if err == nil && filePath != "" {
				fileName := filepath.Base(filePath)
				if strings.HasSuffix(strings.ToLower(filePath), ".html") || strings.HasSuffix(strings.ToLower(filePath), ".htm") {
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
				} else {
					w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
				}
				w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
				http.ServeFile(w, r, filePath)
				return
			}
		}

		// Default: return the standard invoice import template
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

	mux.HandleFunc("POST /api/invoices/import", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		username := "system"
		if u != nil {
			username = u.Username
		}

		var req struct {
			IssuerID string           `json:"issuer_id"`
			Rows     []map[string]any `json:"rows"`
			DryRun   bool             `json:"dry_run"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}

		if req.IssuerID == "" {
			s.err(w, 400, "يجب تحديد المنشأة المصدرة")
			return
		}

		type rowErr struct {
			Row     int    `json:"row"`
			Message string `json:"message"`
		}
		var errs []rowErr

		type invGroup struct {
			Key         string
			ClientName  string
			IssueDate   string
			InvoiceType string
			Lines       []services.CreateInvoiceLineInput
			GrandTotal  float64
		}
		groupsMap := make(map[string]*invGroup)
		var groupOrder []string

		for idx, row := range req.Rows {
			rowNum := idx + 1

			clientName, _ := row["client_name"].(string)
			if clientName == "" {
				clientName, _ = row["buyer_name"].(string)
			}
			itemName, _ := row["item_name"].(string)
			if clientName == "" {
				errs = append(errs, rowErr{Row: rowNum, Message: "اسم العميل مطلوب"})
			}
			if itemName == "" {
				errs = append(errs, rowErr{Row: rowNum, Message: "اسم الصنف / البيان مطلوب"})
			}

			qty := 1.0
			if qVal, ok := row["quantity"].(float64); ok && qVal > 0 {
				qty = qVal
			}
			price := 0.0
			if pVal, ok := row["unit_price"].(float64); ok && pVal >= 0 {
				price = pVal
			}
			disc := 0.0
			if dVal, ok := row["discount"].(float64); ok && dVal >= 0 {
				disc = dVal
			}
			taxRate := s.cfg.Defaults.TaxRate
			if trVal, ok := row["tax_rate"].(float64); ok && trVal >= 0 {
				taxRate = trVal
			}

			sub := qty*price - disc
			if sub < 0 {
				sub = 0
			}
			tax := sub * taxRate / 100
			tot := sub + tax

			groupKey, _ := row["group"].(string)
			if groupKey == "" {
				groupKey, _ = row["invoice_number"].(string)
			}
			if groupKey == "" {
				groupKey = fmt.Sprintf("INV-%s-%d", clientName, rowNum)
			}

			issueDate, _ := row["issue_date"].(string)
			if issueDate == "" {
				issueDate = db.TodayIso()
			}
			invType, _ := row["invoice_type"].(string)
			if invType == "" {
				invType = "STANDARD"
			}
			unit, _ := row["unit"].(string)
			if unit == "" {
				unit = "حبة"
			}
			itemCode, _ := row["item_code"].(string)

			g, exists := groupsMap[groupKey]
			if !exists {
				g = &invGroup{
					Key:         groupKey,
					ClientName:  clientName,
					IssueDate:   issueDate,
					InvoiceType: invType,
					Lines:       make([]services.CreateInvoiceLineInput, 0),
				}
				groupsMap[groupKey] = g
				groupOrder = append(groupOrder, groupKey)
			}

			g.Lines = append(g.Lines, services.CreateInvoiceLineInput{
				ItemName:  itemName,
				ItemCode:  itemCode,
				Unit:      unit,
				Quantity:  qty,
				UnitPrice: price,
				Discount:  disc,
				TaxRate:   taxRate,
			})
			g.GrandTotal += tot
		}

		var grandTotalAll float64
		previewList := make([]map[string]any, 0, len(groupOrder))
		for _, key := range groupOrder {
			g := groupsMap[key]
			grandTotalAll += g.GrandTotal
			previewList = append(previewList, map[string]any{
				"group":        g.Key,
				"client_name":  g.ClientName,
				"issue_date":   g.IssueDate,
				"invoice_type": g.InvoiceType,
				"items_count":  len(g.Lines),
				"grand_total":  math.Round(g.GrandTotal*100) / 100,
			})
		}

		if req.DryRun || len(errs) > 0 {
			s.json(w, 200, map[string]any{
				"valid":          len(errs) == 0,
				"errors":         errs,
				"invoices_count": len(groupOrder),
				"lines_count":    len(req.Rows),
				"totals": map[string]any{
					"grand_total": math.Round(grandTotalAll*100) / 100,
				},
				"preview": previewList,
			})
			return
		}

		// Commit import
		importedCount := 0
		var importedTotal float64
		for _, key := range groupOrder {
			g := groupsMap[key]
			client, err := s.clients.FindOrCreateByName(req.IssuerID, g.ClientName)
			clientID := ""
			if err == nil && client != nil {
				clientID = client.ID
			}

			inv, err := s.invoices.CreateInvoice(services.CreateInvoiceInput{
				IssuerID:      req.IssuerID,
				ClientID:      clientID,
				InvoiceType:   g.InvoiceType,
				IssueDate:     g.IssueDate,
				PaymentMethod: "CREDIT",
				Lines:         g.Lines,
				Notes:         "استيراد من ملف Excel",
			}, username, s.clientIP(r))
			if err == nil && inv != nil {
				importedCount++
				importedTotal += models.ToMajor(inv.GrandTotal)
			}
		}

		s.json(w, 200, map[string]any{
			"success":        true,
			"imported_count": importedCount,
			"total_amount":   math.Round(importedTotal*100) / 100,
		})
	})

	// ---------------------------------------------------- قوالب الفواتير والمستندات
	mux.HandleFunc("GET /api/invoices/templates", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		list, err := s.templates.List(q.Get("type"), q.Get("category"))
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, list)
	})

	mux.HandleFunc("POST /api/invoices/templates/inspect", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			FileBase64 string `json:"file_base64"`
			Filename   string `json:"filename"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		res, err := s.templates.Inspect(req.FileBase64, req.Filename)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("POST /api/invoices/templates/upload", func(w http.ResponseWriter, r *http.Request) {
		var req services.UploadTemplateInput
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		res, err := s.templates.Upload(req)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 201, res)
	})

	mux.HandleFunc("DELETE /api/invoices/templates/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.templates.Delete(id); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/invoices/templates/reset", func(w http.ResponseWriter, r *http.Request) {
		if err := s.templates.Reset(); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/invoices/templates/{id}/render-html", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		htmlStr, err := s.templates.RenderTemplateHTML(id)
		if err != nil {
			s.err(w, 404, err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(htmlStr))
	})

	mux.HandleFunc("GET /api/templates/builder/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		res, err := s.templates.GetBuilderConfig(id)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/templates/builder/{id}/config", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		res, err := s.templates.GetBuilderConfig(id)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("POST /api/templates/builder", func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		id, _ := req["id"].(string)
		if id == "" {
			id = crypto.UUID()
		}
		_ = s.templates.SaveBuilderConfig(id, req)
		s.json(w, 201, map[string]any{"id": id, "saved": true})
	})

	mux.HandleFunc("PUT /api/templates/builder/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		_ = s.templates.SaveBuilderConfig(id, req)
		s.json(w, 200, map[string]any{"id": id, "updated": true})
	})

	// ---------------------------------------------------- سندات القبض
	mux.HandleFunc("GET /api/vouchers", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		page, _ := strconv.Atoi(q.Get("page"))
		limit, _ := strconv.Atoi(q.Get("limit"))
		offset, _ := strconv.Atoi(q.Get("offset"))
		minAmt, _ := strconv.ParseFloat(q.Get("min_amount"), 64)
		maxAmt, _ := strconv.ParseFloat(q.Get("max_amount"), 64)

		res, err := s.vouchers.ListVouchers(services.ListVouchersFilter{
			IssuerID:    q.Get("issuer_id"),
			ClientID:    q.Get("client_id"),
			Status:      q.Get("status"),
			PaymentType: q.Get("payment_type"),
			FromDate:    q.Get("from"),
			ToDate:      q.Get("to"),
			MinAmount:   minAmt,
			MaxAmount:   maxAmt,
			Search:      q.Get("q"),
			Page:        page,
			Limit:       limit,
			Offset:      offset,
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

	mux.HandleFunc("DELETE /api/vouchers/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		id := r.PathValue("id")
		if err := s.vouchers.DeleteVoucher(id, actor, s.clientIP(r)); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/vouchers/template", func(w http.ResponseWriter, r *http.Request) {
		b, err := excel.GenerateVoucherTemplateExcel()
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", "attachment; filename=\"voucher-template.xlsx\"")
		w.WriteHeader(200)
		_, _ = w.Write(b)
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

	mux.HandleFunc("GET /api/reports/sales", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res, err := s.reports.SalesReport(q.Get("issuer_id"), q.Get("from"), q.Get("to"), q.Get("client_id"), q.Get("group_by"))
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/reports/vat", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res, err := s.reports.VatReport(q.Get("issuer_id"), q.Get("from"), q.Get("to"))
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/reports/tax", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res, err := s.reports.VatReport(q.Get("issuer_id"), q.Get("from"), q.Get("to"))
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/reports/collections", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res, err := s.reports.CollectionsReport(q.Get("issuer_id"), q.Get("from"), q.Get("to"), q.Get("client_id"), q.Get("group_by"))
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/reports/profitability", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res, err := s.reports.ProfitabilityReport(q.Get("issuer_id"), q.Get("from"), q.Get("to"), q.Get("client_id"), q.Get("group_by"))
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/reports/aging", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res, err := s.reports.AgingDetailedReport(q.Get("issuer_id"), q.Get("as_of"))
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

	// ---------------------------------------------------- كشف الحساب والأستاذ العام
	mux.HandleFunc("GET /api/ledger/statement", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		clientID := q.Get("client_id")
		if clientID == "" {
			s.err(w, 400, "client_id مطلوب")
			return
		}
		res, err := s.clients.Statement(services.StatementParams{
			ClientID: clientID,
			IssuerID: q.Get("issuer_id"),
			FromDate: q.Get("from"),
			ToDate:   q.Get("to"),
		})
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/ledger/balances", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		onlyDebtors := q.Get("only_debtors") == "1" || q.Get("only_debtors") == "true"
		res, err := s.clients.Balances(q.Get("issuer_id"), onlyDebtors)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	// ---------------------------------------------------- دفعات التوليد
	mux.HandleFunc("GET /api/bulk/batches", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		issuerID := q.Get("issuer_id")
		limit, _ := strconv.Atoi(q.Get("limit"))
		if limit <= 0 {
			limit = 100
		}
		where := "WHERE 1=1"
		var args []any
		if issuerID != "" {
			where += " AND b.issuer_id = ?"
			args = append(args, issuerID)
		}
		args = append(args, limit)
		rows, err := s.db.Query(fmt.Sprintf(`
			SELECT b.id, b.issuer_id, b.client_id, b.params, b.invoice_count, b.total_amount,
			       b.status, b.created_by, b.created_at,
			       COALESCE(s.name_ar, ''), COALESCE(c.name, '')
			FROM invoice_batches b
			LEFT JOIN issuers s ON s.id = b.issuer_id
			LEFT JOIN clients c ON c.id = b.client_id
			%s
			ORDER BY b.created_at DESC LIMIT ?
		`, where), args...)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		defer rows.Close()

		list := make([]map[string]any, 0)
		for rows.Next() {
			var id, issID, cID, paramsStr, status, createdBy, createdAt, issName, cName string
			var invCount, totAmt int64
			if err := rows.Scan(&id, &issID, &cID, &paramsStr, &invCount, &totAmt, &status, &createdBy, &createdAt, &issName, &cName); err == nil {
				var paramsObj any
				_ = json.Unmarshal([]byte(paramsStr), &paramsObj)
				list = append(list, map[string]any{
					"id":            id,
					"issuer_id":     issID,
					"issuer_name":   issName,
					"client_id":     cID,
					"client_name":   cName,
					"invoice_count": invCount,
					"total_amount":  models.ToMajor(totAmt),
					"status":        status,
					"created_by":    createdBy,
					"created_at":    createdAt,
					"params":        paramsObj,
				})
			}
		}
		s.json(w, 200, list)
	})

	mux.HandleFunc("GET /api/bulk/drafts", func(w http.ResponseWriter, r *http.Request) {
		issuerID := r.URL.Query().Get("issuer_id")
		list, err := s.bulk.ListDrafts(issuerID)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, list)
	})

	mux.HandleFunc("GET /api/bulk/drafts/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		draft, err := s.bulk.GetDraft(id)
		if err != nil {
			s.err(w, 404, err.Error())
			return
		}
		s.json(w, 200, draft)
	})

	mux.HandleFunc("POST /api/bulk/drafts", func(w http.ResponseWriter, r *http.Request) {
		var input services.SaveDraftInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		draft, err := s.bulk.SaveDraft(input)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 201, draft)
	})

	mux.HandleFunc("DELETE /api/bulk/drafts/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.bulk.DeleteDraft(id); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/bulk/preview", func(w http.ResponseWriter, r *http.Request) {
		var req services.PreviewRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		res, err := s.bulk.GeneratePreview(req)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("POST /api/bulk/commit", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		username := "system"
		if u != nil {
			username = u.Username
		}
		var req services.CommitBatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		res, err := s.bulk.CommitBatch(req, username)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	// ---------------------------------------------------- إعدادات النظام
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.db.Query("SELECT key, value FROM settings")
		res := map[string]any{
			"currency":               s.cfg.Defaults.Currency,
			"default_tax_rate":       s.cfg.Defaults.TaxRate,
			"country":                s.cfg.Defaults.Country,
			"bulk_max_invoices":      2000,
			"invoice_prefix_default": "INV",
			"invoice_pad_default":    5,
			"voucher_prefix_default": "RV",
			"print_copies_default":   1,
		}
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var k, v string
				if rows.Scan(&k, &v) == nil {
					if k == "default_tax_rate" {
						var f float64
						_, _ = fmt.Sscanf(v, "%f", &f)
						res[k] = f
					} else if k == "bulk_max_invoices" || k == "invoice_pad_default" || k == "print_copies_default" {
						var n int
						_, _ = fmt.Sscanf(v, "%d", &n)
						res[k] = n
					} else {
						res[k] = v
					}
				}
			}
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		now := db.NowIso()
		for k, v := range body {
			valStr := fmt.Sprintf("%v", v)
			_, _ = s.db.Exec(`
				INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
			`, k, valStr, now)
		}
		s.json(w, 200, map[string]any{"ok": true})
	})

	// ---------------------------------------------------- سجل التدقيق
	mux.HandleFunc("GET /api/audit", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit, _ := strconv.Atoi(q.Get("limit"))
		if limit <= 0 || limit > 500 {
			limit = 100
		}
		offset, _ := strconv.Atoi(q.Get("offset"))
		if offset < 0 {
			offset = 0
		}

		where := "WHERE 1=1"
		var args []any

		if search := strings.TrimSpace(q.Get("q")); search != "" {
			like := "%" + search + "%"
			where += " AND (user_name LIKE ? OR action LIKE ? OR entity_type LIKE ? OR entity_id LIKE ? OR details LIKE ?)"
			args = append(args, like, like, like, like, like)
		}
		if action := strings.TrimSpace(q.Get("action")); action != "" {
			where += " AND action = ?"
			args = append(args, action)
		}
		if entityType := strings.TrimSpace(q.Get("entity_type")); entityType != "" {
			where += " AND entity_type = ?"
			args = append(args, entityType)
		}
		if user := strings.TrimSpace(q.Get("user")); user != "" {
			where += " AND user_name = ?"
			args = append(args, user)
		}
		if from := strings.TrimSpace(q.Get("from")); from != "" {
			where += " AND created_at >= ?"
			args = append(args, from)
		}
		if to := strings.TrimSpace(q.Get("to")); to != "" {
			where += " AND created_at <= ?"
			args = append(args, to+"T23:59:59Z")
		}

		var totalCount int
		countQ := fmt.Sprintf("SELECT COUNT(*) FROM audit_logs %s", where)
		_ = s.db.QueryRow(countQ, args...).Scan(&totalCount)

		queryQ := fmt.Sprintf(`
			SELECT id, user_name, action, entity_type, COALESCE(entity_id, ''), details, ip, created_at
			FROM audit_logs %s ORDER BY created_at DESC LIMIT ? OFFSET ?
		`, where)
		queryArgs := append(args, limit, offset)

		rows, err := s.db.Query(queryQ, queryArgs...)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		defer rows.Close()

		list := make([]map[string]any, 0)
		for rows.Next() {
			var id, u, act, et, eid, det, ip, cat string
			if err := rows.Scan(&id, &u, &act, &et, &eid, &det, &ip, &cat); err == nil {
				var detObj any
				if det != "" {
					_ = json.Unmarshal([]byte(det), &detObj)
				}
				if detObj == nil {
					detObj = map[string]any{}
				}

				list = append(list, map[string]any{
					"id":          id,
					"user_name":   u,
					"action":      act,
					"entity_type": et,
					"entity_id":   eid,
					"details":     detObj,
					"ip":          ip,
					"created_at":  cat,
				})
			}
		}

		s.json(w, 200, map[string]any{
			"items":       list,
			"total_count": totalCount,
		})
	})

	// ---------------------------------------------------- واجهة الويب الثابتة (Public SPA)
	fileServer := http.FileServer(http.FS(s.publicFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			s.err(w, 404, "المسار غير موجود")
			return
		}

		if strings.HasPrefix(r.URL.Path, "/data/templates/") {
			rel := strings.TrimPrefix(r.URL.Path, "/data/templates/")
			rel = filepath.Clean(rel)
			targetFile := filepath.Join(s.cfg.DataDir, "templates", rel)
			if fi, errStat := os.Stat(targetFile); errStat == nil && !fi.IsDir() {
				w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
				w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(targetFile)))
				http.ServeFile(w, r, targetFile)
				return
			}
			http.NotFound(w, r)
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
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
			_, _ = io.Copy(w, fIndex)
			return
		}
		defer f.Close()

		// Set anti-stale cache control for ES module scripts and html
		if strings.HasSuffix(path, ".js") {
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		} else if strings.HasSuffix(path, ".html") || strings.HasSuffix(path, ".css") {
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		}

		fileServer.ServeHTTP(w, r)
	})

	// Wrap with standard middleware
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "same-origin")
		if !s.authorize(w, r, mux) {
			return
		}
		mux.ServeHTTP(w, r)
	})
}
