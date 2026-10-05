package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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
	sync      *services.SyncHub
	masterKey []byte
	publicFS  fs.FS
	pdfWake   chan struct{}
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
	syncSvc := services.NewSyncHub(database)

	server := &Server{
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
		sync:      syncSvc,
		masterKey: masterKey,
		publicFS:  publicFS,
		pdfWake:   make(chan struct{}, 1),
	}
	server.enqueueMissingPDFs()
	server.startPDFWorker()
	return server
}

func (s *Server) broadcastTemplateChange(r *http.Request, action, id string) {
	event := services.SyncEvent{Type: "template:updated", Entity: "templates", Action: action, Data: map[string]any{"id": id}}
	if user := s.getSessionUser(r); user != nil {
		event.Actor, event.ActorName = user.Username, user.FullName
	}
	s.sync.Broadcast(event)
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

func (s *Server) getSessionToken(r *http.Request) string {
	if c, err := r.Cookie("zs_session"); err == nil && c.Value != "" {
		return c.Value
	}
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}
	return ""
}

func (s *Server) getSessionUser(r *http.Request) *models.User {
	if user, ok := r.Context().Value(sessionUserKey{}).(*models.User); ok {
		return user
	}
	tok := s.getSessionToken(r)
	if tok == "" {
		return nil
	}
	u, err := s.auth.ValidateSession(tok)
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
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.db.PingContext(ctx); err != nil {
			s.err(w, http.StatusServiceUnavailable, "قاعدة البيانات غير متاحة")
			return
		}
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

	// تصدير حزمة النظام الشاملة كملف مضغوط (.zip) تحتوي على قاعدة البيانات + القوالب + الملفات
	mux.HandleFunc("GET /api/system/export-package", s.handleExportPackage)

	// تصدير وتحميل قاعدة البيانات فقط كملف SQLite (.db) (خاص بالمدير فقط)
	mux.HandleFunc("GET /api/system/export-db", s.handleExportDB)

	// استيراد واستعادة حزمة النظام أو قاعدة البيانات (.zip أو .db) (خاص بالمدير فقط)
	mux.HandleFunc("POST /api/system/import-package", s.handleImportSystemPackage)
	mux.HandleFunc("POST /api/system/import-db", s.handleImportSystemPackage)

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
			Secure:   r.TLS != nil || s.cfg.IsPublicHost(),
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
			OldPassword     string `json:"old_password"`
			CurrentPassword string `json:"current_password"`
			NewPassword     string `json:"new_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		oldPass := req.OldPassword
		if oldPass == "" {
			oldPass = req.CurrentPassword
		}
		if err := s.auth.ChangePassword(u.ID, oldPass, req.NewPassword); err != nil {
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

	// ---------------------------------------------------- المزامنة اللحظية وإدارة الجلسات النشطة (SSE & Admin Sync Control)
	// تيار الأحداث المباشر SSE للمتصفحات النشطة
	mux.HandleFunc("GET /api/sync/events", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح - يرجى تسجيل الدخول")
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			s.err(w, 500, "التدفق المباشر غير مدعوم في هذا الخادم")
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		tok := s.getSessionToken(r)
		ip := s.clientIP(r)
		ua := r.UserAgent()

		subID, ch, cancel := s.sync.Subscribe(tok, u.ID, u.Username, u.FullName, u.Role, ip, ua)
		defer cancel()

		initData, _ := json.Marshal(map[string]any{
			"status":       "connected",
			"sub_id":       subID,
			"active_count": s.sync.ActiveCount(),
			"user":         u.Username,
			"role":         u.Role,
		})
		fmt.Fprintf(w, "event: connected\ndata: %s\n\n", initData)
		flusher.Flush()

		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
			case ev, ok := <-ch:
				if !ok {
					return
				}
				data, err := json.Marshal(ev)
				if err == nil {
					fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, data)
					flusher.Flush()
				}
			}
		}
	})

	// نبض الاتصال الدوري وتحديث الشاشة الحالية
	mux.HandleFunc("POST /api/sync/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		tok := s.getSessionToken(r)
		var body struct {
			CurrentView string `json:"current_view"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)

		count := s.sync.Heartbeat(tok, body.CurrentView)
		s.json(w, 200, map[string]any{
			"active_count": count,
		})
	})

	// عرض الجلسات النشطة لجميع المستخدمين المتصلين حالياً (للأدمن)
	mux.HandleFunc("GET /api/admin/sync/sessions", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil || u.Role != "ADMIN" {
			s.err(w, 403, "لوحة التحكم بالجلسات والمزامنة محصورة بمدير النظام")
			return
		}
		tok := s.getSessionToken(r)
		sessions := s.sync.GetActiveSessions(tok)
		s.json(w, 200, map[string]any{
			"sessions":     sessions,
			"active_count": s.sync.ActiveCount(),
		})
	})

	// إجبار مزامنة فورية شاملة لكافة الأجهزة والمستخدمين
	mux.HandleFunc("POST /api/admin/sync/force", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil || u.Role != "ADMIN" {
			s.err(w, 403, "إجبار المزامنة محصور بمدير النظام")
			return
		}
		s.sync.ForceGlobalSync(u.Username, u.FullName)
		s.db.Audit(u.Username, "FORCE_SYNC", "system", "", "إجبار مزامنة فورية لكافة المتصلين", nil, s.clientIP(r))
		s.json(w, 200, map[string]any{
			"message": "تم إرسال أمر المزامنة الفورية لكافة الأجهزة المتصلة بنجاح",
		})
	})

	// بث تنبيه أو رسالة فورية لكافة المستخدمين أو مستخدم محدد
	mux.HandleFunc("POST /api/admin/sync/broadcast", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil || u.Role != "ADMIN" {
			s.err(w, 403, "بث الرسائل الفورية محصور بمدير النظام")
			return
		}
		var req struct {
			Message    string `json:"message"`
			Level      string `json:"level"`       // "info", "warning", "error"
			TargetUser string `json:"target_user"` // empty = everyone
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Message) == "" {
			s.err(w, 400, "نص الرسالة مطلوب")
			return
		}
		if req.Level == "" {
			req.Level = "info"
		}

		if req.TargetUser != "" {
			s.sync.BroadcastToUser(req.TargetUser, services.SyncEvent{
				Type:      "broadcast:alert",
				Entity:    "system",
				Action:    "alert",
				Actor:     u.Username,
				ActorName: u.FullName,
				Data: map[string]any{
					"message": req.Message,
					"level":   req.Level,
				},
			})
		} else {
			s.sync.BroadcastAlert(req.Message, req.Level, u.Username, u.FullName)
		}

		s.db.Audit(u.Username, "BROADCAST_ALERT", "system", "", req.Message, nil, s.clientIP(r))
		s.json(w, 200, map[string]any{
			"message": "تم بث الرسالة بنجاح",
		})
	})

	// إنهاء/طرد جلسة مستخدم محدد
	mux.HandleFunc("POST /api/admin/sync/revoke", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil || u.Role != "ADMIN" {
			s.err(w, 403, "إنهاء الجلسات محصور بمدير النظام")
			return
		}
		var req struct {
			SessionToken string `json:"session_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SessionToken == "" {
			s.err(w, 400, "رمز الجلسة مطلوب")
			return
		}

		if err := s.sync.RevokeSession(req.SessionToken); err != nil {
			s.err(w, 500, err.Error())
			return
		}

		s.db.Audit(u.Username, "REVOKE_SESSION", "session", req.SessionToken, "إنهاء جلسة مستخدم عن بُعد", nil, s.clientIP(r))
		s.json(w, 200, map[string]any{
			"message": "تم إنهاء الجلسة وقطع اتصال المستخدم فوراً",
		})
	})

	// إنهاء كافة الجلسات الأخرى بضغطة واحدة (طرد الجميع باستثناء المدير الحالي)
	mux.HandleFunc("POST /api/admin/sync/revoke-others", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil || u.Role != "ADMIN" {
			s.err(w, 403, "إنهاء الجلسات محصور بمدير النظام")
			return
		}
		tok := s.getSessionToken(r)
		count, err := s.sync.RevokeAllOtherSessions(tok)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.db.Audit(u.Username, "REVOKE_ALL_SESSIONS", "session", "", fmt.Sprintf("إنهاء %d جلسة نشطة أخرى", count), nil, s.clientIP(r))
		s.json(w, 200, map[string]any{
			"revoked_count": count,
			"message":       fmt.Sprintf("تم إنهاء %d جلسة بنجاح، أنت الآن الوحيد المتصل بالنظام", count),
		})
	})

	// سجل أحداث المزامنة اللحظية
	mux.HandleFunc("GET /api/admin/sync/history", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil || u.Role != "ADMIN" {
			s.err(w, 403, "سجل المزامنة محصور بمدير النظام")
			return
		}
		history := s.sync.GetHistory(50)
		s.json(w, 200, history)
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

	mux.HandleFunc("GET /api/issuers/template", func(w http.ResponseWriter, r *http.Request) {
		b, err := excel.GenerateIssuerTemplateExcel()
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", "attachment; filename=\"issuers-import-template.xlsx\"")
		w.WriteHeader(200)
		_, _ = w.Write(b)
	})

	mux.HandleFunc("POST /api/issuers/analyze-excel", func(w http.ResponseWriter, r *http.Request) {
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
		res, err := excel.AnalyzeIssuersSpreadsheet(bytes.NewReader(data), req.Filename)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
	})

	mux.HandleFunc("POST /api/issuers/import", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Issuers []services.ImportIssuerInput `json:"issuers"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		res, err := s.issuers.BatchImportIssuers(req.Issuers)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.json(w, 200, res)
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
		_ = s.dirtyIssuerDocuments(id)
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

	// تقدم تسلسل سند القبض بعدد خطوات محددة (لإنشاء فجوات في ترقيم السندات)
	mux.HandleFunc("POST /api/issuers/{id}/advance-voucher-seq", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		id := r.PathValue("id")
		var body struct {
			Steps int `json:"steps"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Steps < 1 || body.Steps > 50 {
			s.err(w, 400, "عدد الخطوات يجب أن يكون بين 1 و50")
			return
		}
		var nextNo int64
		err := s.db.QueryRow("SELECT voucher_next_no FROM issuers WHERE id = ?", id).Scan(&nextNo)
		if err != nil {
			s.err(w, 404, "المنشأة غير موجودة")
			return
		}
		_, err = s.db.Exec("UPDATE issuers SET voucher_next_no = voucher_next_no + ? WHERE id = ?", body.Steps, id)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, map[string]any{"ok": true, "skipped": body.Steps, "next_no": nextNo + int64(body.Steps)})
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
		s.sync.Broadcast(services.SyncEvent{
			Type:      "client:updated",
			Entity:    "client",
			Action:    "create",
			Actor:     u.Username,
			ActorName: u.FullName,
		})
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
		s.sync.Broadcast(services.SyncEvent{
			Type:      "client:updated",
			Entity:    "client",
			Action:    "update",
			Actor:     u.Username,
			ActorName: u.FullName,
		})
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
		s.sync.Broadcast(services.SyncEvent{
			Type:      "client:updated",
			Entity:    "client",
			Action:    "delete",
			Actor:     u.Username,
			ActorName: u.FullName,
		})
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
		u := s.getSessionUser(r)
		var itm models.Item
		if err := json.NewDecoder(r.Body).Decode(&itm); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.items.CreateItem(&itm); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		actor := "system"
		actorName := "النظام"
		if u != nil {
			actor = u.Username
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "item:updated",
			Entity:    "item",
			Action:    "create",
			Actor:     actor,
			ActorName: actorName,
		})
		s.json(w, 200, itm)
	})

	mux.HandleFunc("PUT /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
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
		actor := "system"
		actorName := "النظام"
		if u != nil {
			actor = u.Username
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "item:updated",
			Entity:    "item",
			Action:    "update",
			Actor:     actor,
			ActorName: actorName,
		})
		s.json(w, 200, itm)
	})

	mux.HandleFunc("DELETE /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		id := r.PathValue("id")
		if err := s.items.DeleteItem(id); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		actor := "system"
		actorName := "النظام"
		if u != nil {
			actor = u.Username
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "item:updated",
			Entity:    "item",
			Action:    "delete",
			Actor:     actor,
			ActorName: actorName,
		})
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
			Items           []services.ImportItemInput `json:"items"`
			ReplaceExisting bool                       `json:"replace_existing"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		res, err := s.items.BatchImportItems(req.Items, req.ReplaceExisting)
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
		_ = s.dirtyDocument("invoice", inv.ID, inv.IssuerID)
		s.dirtyInvoiceReceipts(inv.ID)
		actorName := actor
		actorRole := ""
		if u != nil {
			actorName = u.FullName
			actorRole = u.Role
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "invoice:created",
			Entity:    "invoice",
			Action:    "create",
			Actor:     actor,
			ActorName: actorName,
			ActorRole: actorRole,
			Data: map[string]any{
				"id":             inv.ID,
				"invoice_number": inv.InvoiceNumber,
				"grand_total":    inv.GrandTotalMajor,
				"client_name":    inv.ClientName,
			},
		})
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
		_ = s.dirtyDocument("invoice", inv.ID, inv.IssuerID)
		s.dirtyInvoiceReceipts(inv.ID)
		actorName := actor
		if u != nil {
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "invoice:updated",
			Entity:    "invoice",
			Action:    "update",
			Actor:     actor,
			ActorName: actorName,
			Data: map[string]any{
				"id":             inv.ID,
				"invoice_number": inv.InvoiceNumber,
				"grand_total":    inv.GrandTotalMajor,
			},
		})
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
		if inv, e := s.invoices.GetInvoice(id); e == nil {
			_ = s.dirtyDocument("invoice", id, inv.IssuerID)
		}
		actorName := actor
		if u != nil {
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "invoice:cancelled",
			Entity:    "invoice",
			Action:    "cancel",
			Actor:     actor,
			ActorName: actorName,
			Data: map[string]any{
				"id": id,
			},
		})
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
		s.deleteDocumentPDF("invoice", id)
		actorName := actor
		if u != nil {
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "invoice:deleted",
			Entity:    "invoice",
			Action:    "delete",
			Actor:     actor,
			ActorName: actorName,
			Data: map[string]any{
				"id": id,
			},
		})
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
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(htmlStr))
	})

	mux.HandleFunc("POST /api/invoices/preview-render-html", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			IssuerID string `json:"issuer_id"`
			ClientID string `json:"client_id"`
			Style    string `json:"style"`
			Invoice  struct {
				InvoiceNumber   string  `json:"invoice_number"`
				InvoiceType     string  `json:"invoice_type"`
				ZatcaPhase      string  `json:"zatca_phase"`
				QrPayload       string  `json:"qr_payload"`
				InvoiceHash     string  `json:"invoice_hash"`
				IssueDate       string  `json:"issue_date"`
				IssueTime       string  `json:"issue_time"`
				PaymentMethod   string  `json:"payment_method"`
				Notes           string  `json:"notes"`
				Subtotal        float64 `json:"subtotal"`
				DiscountAmount  float64 `json:"discount_amount"`
				TaxableAmount   float64 `json:"taxable_amount"`
				TaxAmount       float64 `json:"tax_amount"`
				GrandTotal      float64 `json:"grand_total"`
				PaidAmount      float64 `json:"paid_amount"`
				RemainingAmount float64 `json:"remaining_amount"`
				Lines           []struct {
					LineNo        int     `json:"line_no"`
					ItemCode      string  `json:"item_code"`
					ItemName      string  `json:"item_name"`
					Unit          string  `json:"unit"`
					Quantity      float64 `json:"quantity"`
					UnitPrice     float64 `json:"unit_price"`
					Discount      float64 `json:"discount"`
					TaxRate       float64 `json:"tax_rate"`
					TaxableAmount float64 `json:"taxable_amount"`
					TaxAmount     float64 `json:"tax_amount"`
					GrandTotal    float64 `json:"grand_total"`
				} `json:"lines"`
			} `json:"invoice"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}

		invNum := req.Invoice.InvoiceNumber
		if strings.TrimSpace(invNum) == "" {
			invNum = "INV-PREVIEW-01"
		}
		issDate := req.Invoice.IssueDate
		if strings.TrimSpace(issDate) == "" {
			issDate = time.Now().Format("2006-01-02")
		}
		issTime := req.Invoice.IssueTime
		if strings.TrimSpace(issTime) == "" {
			issTime = "10:00:00"
		}
		zp := req.Invoice.ZatcaPhase
		if zp == "" {
			zp = "PHASE1"
		}
		it := req.Invoice.InvoiceType
		if it == "" {
			it = "STANDARD"
		}

		invView := &services.InvoiceView{
			Invoice: models.Invoice{
				InvoiceNumber:  invNum,
				InvoiceType:    it,
				ZatcaPhase:     zp,
				QrPayload:      req.Invoice.QrPayload,
				InvoiceHash:    req.Invoice.InvoiceHash,
				IssueDate:      issDate,
				IssueTime:      issTime,
				PaymentMethod:  req.Invoice.PaymentMethod,
				Notes:          req.Invoice.Notes,
				Subtotal:       models.ToMinor(req.Invoice.Subtotal),
				DiscountAmount: models.ToMinor(req.Invoice.DiscountAmount),
				TaxableAmount:  models.ToMinor(req.Invoice.TaxableAmount),
				TaxAmount:      models.ToMinor(req.Invoice.TaxAmount),
				GrandTotal:     models.ToMinor(req.Invoice.GrandTotal),
				Currency:       "SAR",
				Status:         "ISSUED",
			},
			SubtotalMajor:        req.Invoice.Subtotal,
			DiscountAmountMajor:  req.Invoice.DiscountAmount,
			TaxableAmountMajor:   req.Invoice.TaxableAmount,
			TaxAmountMajor:       req.Invoice.TaxAmount,
			GrandTotalMajor:      req.Invoice.GrandTotal,
			PaidAmountMajor:      req.Invoice.PaidAmount,
			RemainingAmountMajor: req.Invoice.RemainingAmount,
			Items:                make([]services.InvoiceItemView, 0, len(req.Invoice.Lines)),
			Lines:                make([]services.InvoiceItemView, 0, len(req.Invoice.Lines)),
		}

		if req.IssuerID != "" {
			if iss, err := s.issuers.GetIssuer(req.IssuerID); err == nil && iss != nil {
				invView.IssuerSnapshot = iss
				invView.IssuerID = iss.ID
				invView.IssuerName = iss.NameAr
				invView.SellerName = iss.NameAr
				invView.SellerTaxNumber = iss.TaxNumber
				invView.SellerCr = iss.CommercialRegister
				addrParts := []string{iss.City, iss.District, iss.Street, iss.BuildingNo, iss.PostalCode}
				var cleanParts []string
				for _, p := range addrParts {
					if strings.TrimSpace(p) != "" {
						cleanParts = append(cleanParts, strings.TrimSpace(p))
					}
				}
				invView.SellerAddress = strings.Join(cleanParts, " - ")
				invView.SellerAddressEn = iss.AddressEn
			}
		}

		if req.ClientID != "" {
			if cl, err := s.clients.GetClient(req.ClientID); err == nil && cl != nil {
				invView.ClientSnapshot = &cl.Client
				invView.ClientID = cl.ID
				invView.ClientCode = cl.ClientCode
				invView.ClientName = cl.Name
				invView.BuyerName = cl.Name
				invView.BuyerTaxNumber = cl.TaxNumber
				invView.BuyerCr = cl.CommercialRegister
				invView.BuyerAddress = cl.Address
			}
		}

		var calcSubtotal, calcDiscount, calcTaxable, calcTax, calcGrand float64
		for i, l := range req.Invoice.Lines {
			lineNo := l.LineNo
			if lineNo <= 0 {
				lineNo = i + 1
			}
			taxRate := l.TaxRate
			if taxRate == 0 {
				taxRate = 15
			}
			taxable := l.TaxableAmount
			if taxable == 0 && l.Quantity > 0 {
				taxable = (l.Quantity * l.UnitPrice) - l.Discount
			}
			taxAmt := l.TaxAmount
			if taxAmt == 0 {
				taxAmt = taxable * (taxRate / 100.0)
			}
			tot := l.GrandTotal
			if tot == 0 {
				tot = taxable + taxAmt
			}

			calcSubtotal += l.Quantity * l.UnitPrice
			calcDiscount += l.Discount
			calcTaxable += taxable
			calcTax += taxAmt
			calcGrand += tot

			iv := services.InvoiceItemView{
				InvoiceItem: models.InvoiceItem{
					LineNo:    lineNo,
					ItemCode:  l.ItemCode,
					ItemName:  l.ItemName,
					Unit:      l.Unit,
					Quantity:  l.Quantity,
					UnitPrice: models.ToMinor(l.UnitPrice),
					Discount:  models.ToMinor(l.Discount),
					TaxRate:   taxRate,
					Taxable:   models.ToMinor(taxable),
					TaxAmount: models.ToMinor(taxAmt),
					TotalLine: models.ToMinor(tot),
				},
				UnitPriceMajor: l.UnitPrice,
				DiscountMajor:  l.Discount,
				TaxableMajor:   taxable,
				TaxAmountMajor: taxAmt,
				TotalLineMajor: tot,
			}
			invView.Lines = append(invView.Lines, iv)
		}
		invView.Items = invView.Lines

		if invView.GrandTotalMajor == 0 && len(invView.Lines) > 0 {
			invView.SubtotalMajor = calcSubtotal
			invView.DiscountAmountMajor = calcDiscount
			invView.TaxableAmountMajor = calcTaxable
			invView.TaxAmountMajor = calcTax
			invView.GrandTotalMajor = calcGrand
			invView.Subtotal = models.ToMinor(calcSubtotal)
			invView.DiscountAmount = models.ToMinor(calcDiscount)
			invView.TaxableAmount = models.ToMinor(calcTaxable)
			invView.TaxAmount = models.ToMinor(calcTax)
			invView.GrandTotal = models.ToMinor(calcGrand)
		}

		style := req.Style
		htmlStr, err := s.templates.RenderInvoiceHTML(invView, style)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(htmlStr))
	})

	mux.HandleFunc("GET /api/invoices/{id}/pdf", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		id := r.PathValue("id")
		inv, err := s.invoices.GetInvoice(id)
		if err != nil {
			s.err(w, 404, "الفاتورة غير موجودة")
			return
		}
		pdfBytes, err := s.currentPDF("invoice", id, r.URL.Query().Get("style"))
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
	mux.HandleFunc("GET /api/invoices/{id}/pdf-status", func(w http.ResponseWriter, r *http.Request) {
		s.pdfStatus(w, "invoice", r.PathValue("id"))
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
			pdfBytes, pdfErr := s.currentPDF("invoice", id, r.URL.Query().Get("style"))
			if pdfErr != nil {
				s.err(w, 500, pdfErr.Error())
				return
			}
			filename := fmt.Sprintf("فاتورة_%s.pdf", invNum)
			encodedFilename := url.PathEscape(filename)
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"invoice_%s.pdf\"; filename*=UTF-8''%s", invNum, encodedFilename))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(pdfBytes)
			return
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
		filename := fmt.Sprintf("فاتورة_%s.pdf", invNum)
		encodedFilename := url.PathEscape(filename)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"invoice_%s.pdf\"; filename*=UTF-8''%s", invNum, encodedFilename))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(pdfBytes)
	})

	mux.HandleFunc("GET /api/vouchers/{id}/pdf", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		id := r.PathValue("id")
		v, err := s.vouchers.GetVoucher(id)
		if err != nil {
			s.err(w, 404, "السند غير موجود")
			return
		}
		pdfBytes, err := s.currentPDF("voucher", id)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		filename := fmt.Sprintf("سند_قبض_%s.pdf", v.VoucherNumber)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"voucher_%s.pdf\"; filename*=UTF-8''%s", v.VoucherNumber, url.PathEscape(filename)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(pdfBytes)
	})
	mux.HandleFunc("GET /api/vouchers/{id}/pdf-status", func(w http.ResponseWriter, r *http.Request) {
		s.pdfStatus(w, "voucher", r.PathValue("id"))
	})

	mux.HandleFunc("POST /api/vouchers/{id}/pdf", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			HTML string `json:"html"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)

		htmlStr := body.HTML
		var vNum string
		if v, err := s.vouchers.GetVoucher(id); err == nil && v != nil {
			vNum = v.VoucherNumber
		}
		if vNum == "" {
			vNum = id
		}

		if strings.TrimSpace(htmlStr) == "" {
			s.err(w, 400, "محتوى السند HTML مطلوب")
			return
		}

		pdfBytes, err := services.RenderHTMLToPDF(htmlStr)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}

		filename := fmt.Sprintf("سند_قبض_%s.pdf", vNum)
		encodedFilename := url.PathEscape(filename)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"voucher_%s.pdf\"; filename*=UTF-8''%s", vNum, encodedFilename))
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
		encodedFilename := url.PathEscape(filename)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"document.pdf\"; filename*=UTF-8''%s", encodedFilename))
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
				_ = s.dirtyDocument("invoice", inv.ID, inv.IssuerID)
				importedCount++
				importedTotal += models.ToMajor(inv.GrandTotal)
			}
		}

		if importedCount > 0 {
			actorName := username
			if u != nil {
				actorName = u.FullName
			}
			s.sync.Broadcast(services.SyncEvent{
				Type:      "invoice:imported",
				Entity:    "invoice",
				Action:    "import",
				Actor:     username,
				ActorName: actorName,
				Data: map[string]any{
					"count": importedCount,
					"total": importedTotal,
				},
			})
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
		s.dirtyAllCachedDocuments()
		s.broadcastTemplateChange(r, "upload", res.ID)
		s.json(w, 201, res)
	})

	mux.HandleFunc("DELETE /api/invoices/templates/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.templates.Delete(id); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.dirtyAllCachedDocuments()
		s.broadcastTemplateChange(r, "delete", id)
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/invoices/templates/reset", func(w http.ResponseWriter, r *http.Request) {
		if err := s.templates.Reset(); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.dirtyAllCachedDocuments()
		s.broadcastTemplateChange(r, "reset", "")
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
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(htmlStr))
	})

	handleTemplateDownload := func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		filePath, err := s.templates.GetFilePath(id)
		if err != nil {
			s.err(w, 404, err.Error())
			return
		}
		data, err := os.ReadFile(filePath)
		if err != nil {
			s.err(w, 500, "تعذر قراءة ملف القالب")
			return
		}
		filename := filepath.Base(filePath)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		if strings.HasSuffix(strings.ToLower(filename), ".html") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		} else if strings.HasSuffix(strings.ToLower(filename), ".xlsx") {
			w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		} else {
			w.Header().Set("Content-Type", "application/octet-stream")
		}
		w.WriteHeader(http.StatusOK)
		w.Write(data)
	}
	mux.HandleFunc("GET /api/invoices/templates/{id}/download", handleTemplateDownload)


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
		if err := s.templates.SaveBuilderConfig(id, req); err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.dirtyAllCachedDocuments()
		s.broadcastTemplateChange(r, "save", id)
		s.json(w, 201, map[string]any{"id": id, "saved": true})
	})

	mux.HandleFunc("PUT /api/templates/builder/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		if err := s.templates.SaveBuilderConfig(id, req); err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.dirtyAllCachedDocuments()
		s.broadcastTemplateChange(r, "save", id)
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
		_ = s.dirtyDocument("voucher", v.ID, v.IssuerID)
		s.dirtyAllocatedInvoices(v.ID)
		actorName := actor
		if u != nil {
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "voucher:created",
			Entity:    "voucher",
			Action:    "create",
			Actor:     actor,
			ActorName: actorName,
			Data: map[string]any{
				"id":             v.ID,
				"voucher_number": v.VoucherNumber,
				"total_amount":   v.TotalAmount,
			},
		})
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

		vDate := strings.TrimSpace(req.VoucherDate)
		if vDate == "" {
			vDate = db.TodayIso()
		}
		notes := strings.TrimSpace(req.Notes)
		if notes == "" {
			notes = fmt.Sprintf("وذلك مقابل سداد فاتورة رقم %s", inv.InvoiceNumber)
		}

		v, err := s.vouchers.CreateVoucher(services.CreateVoucherInput{
			IssuerID:    inv.IssuerID,
			ClientID:    inv.ClientID,
			VoucherDate: vDate,
			TotalAmount: req.Amount,
			PaymentType: req.PaymentType,
			Notes:       notes,
			Allocations: []services.VoucherAllocationInput{
				{InvoiceID: inv.ID, Amount: req.Amount},
			},
		}, actor, s.clientIP(r))
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		_ = s.dirtyDocument("voucher", v.ID, v.IssuerID)
		s.dirtyAllocatedInvoices(v.ID)
		actorName := actor
		if u != nil {
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "voucher:created",
			Entity:    "voucher",
			Action:    "create",
			Actor:     actor,
			ActorName: actorName,
			Data: map[string]any{
				"id":             v.ID,
				"voucher_number": v.VoucherNumber,
				"total_amount":   v.TotalAmount,
				"invoice_id":     inv.ID,
				"invoice_number": inv.InvoiceNumber,
			},
		})
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
		if v, e := s.vouchers.GetVoucher(id); e == nil {
			_ = s.dirtyDocument("voucher", id, v.IssuerID)
		}
		s.dirtyAllocatedInvoices(id)
		actorName := actor
		if u != nil {
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "voucher:deleted",
			Entity:    "voucher",
			Action:    "delete",
			Actor:     actor,
			ActorName: actorName,
			Data: map[string]any{
				"id": id,
			},
		})
		s.json(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("DELETE /api/vouchers/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		actor := "system"
		if u != nil {
			actor = u.Username
		}
		id := r.PathValue("id")
		allocatedInvoices := s.allocatedInvoiceIDs(id)
		if err := s.vouchers.DeleteVoucher(id, actor, s.clientIP(r)); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.deleteDocumentPDF("voucher", id)
		s.dirtyInvoicesByID(allocatedInvoices)
		actorName := actor
		if u != nil {
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "voucher:deleted",
			Entity:    "voucher",
			Action:    "delete",
			Actor:     actor,
			ActorName: actorName,
			Data: map[string]any{
				"id": id,
			},
		})
		s.json(w, 200, map[string]any{"ok": true})
	})

	// تعديل السند (التاريخ، طريقة السداد، المرجع، الملاحظات)
	mux.HandleFunc("PATCH /api/vouchers/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		if u == nil {
			s.err(w, 401, "غير مصرح")
			return
		}
		actor := u.Username
		id := r.PathValue("id")
		var input services.UpdateVoucherInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات غير صالحة")
			return
		}
		updated, err := s.vouchers.UpdateVoucher(id, input, actor, s.clientIP(r))
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		_ = s.dirtyDocument("voucher", id, updated.IssuerID)
		s.sync.Broadcast(services.SyncEvent{
			Type:      "voucher:updated",
			Entity:    "voucher",
			Action:    "update",
			Actor:     actor,
			ActorName: u.FullName,
			Data:      map[string]any{"id": id, "voucher_number": updated.VoucherNumber},
		})
		s.json(w, 200, updated)
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
		if batchID, ok := res["batch_id"].(string); ok {
			s.dirtyBatchDocuments(batchID)
		}
		actorName := username
		if u != nil {
			actorName = u.FullName
		}
		s.sync.Broadcast(services.SyncEvent{
			Type:      "invoice:bulk_created",
			Entity:    "invoice",
			Action:    "create",
			Actor:     username,
			ActorName: actorName,
			Data: map[string]any{
				"batch_id": res["batch_id"],
				"count":    res["success_count"],
			},
		})
		s.json(w, 200, res)
	})

	mux.HandleFunc("GET /api/bulk/batches/{id}/render-html", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		style := r.URL.Query().Get("style")
		rows, err := s.db.Query("SELECT id FROM invoices WHERE batch_id = ? ORDER BY issue_date ASC, sequence_no ASC, invoice_number ASC", id)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		defer rows.Close()

		var invIDs []string
		for rows.Next() {
			var invID string
			if err := rows.Scan(&invID); err == nil {
				invIDs = append(invIDs, invID)
			}
		}
		if len(invIDs) == 0 {
			s.err(w, 404, "لا توجد فواتير لهذه الدفعة")
			return
		}

		var docs []string
		for _, invID := range invIDs {
			inv, err := s.invoices.GetInvoice(invID)
			if err != nil {
				continue
			}
			htmlStr, err := s.templates.RenderInvoiceHTML(inv, style)
			if err != nil {
				continue
			}
			docs = append(docs, htmlStr)
		}

		combined := s.templates.CombineHTMLDocuments(docs)
		if combined == "" {
			s.err(w, 500, "تعذر قراءة قالب طباعة الدفعات من مجلد البيانات")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(combined))
	})

	mux.HandleFunc("GET /api/bulk/batches/{id}/pdf", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		style := r.URL.Query().Get("style")
		rows, err := s.db.Query("SELECT id FROM invoices WHERE batch_id = ? ORDER BY issue_date ASC, sequence_no ASC, invoice_number ASC", id)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		defer rows.Close()

		var invIDs []string
		for rows.Next() {
			var invID string
			if err := rows.Scan(&invID); err == nil {
				invIDs = append(invIDs, invID)
			}
		}
		if len(invIDs) == 0 {
			s.err(w, 404, "لا توجد فواتير لهذه الدفعة")
			return
		}

		var docs []string
		for _, invID := range invIDs {
			inv, err := s.invoices.GetInvoice(invID)
			if err != nil {
				continue
			}
			htmlStr, err := s.templates.RenderInvoiceHTML(inv, style)
			if err != nil {
				continue
			}
			docs = append(docs, htmlStr)
		}

		combined := s.templates.CombineHTMLDocuments(docs)
		if combined == "" {
			s.err(w, 500, "تعذر قراءة قالب طباعة الدفعات من مجلد البيانات")
			return
		}
		pdfBytes, err := services.RenderHTMLToPDF(combined)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		shortID := id
		if len(shortID) > 8 {
			shortID = shortID[:8]
		}
		filename := fmt.Sprintf("batch_%s.pdf", shortID)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(pdfBytes)
	})

	mux.HandleFunc("GET /api/bulk/batches/{id}/vouchers", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rows, err := s.db.Query(`
			SELECT DISTINCT v.id 
			FROM receipt_vouchers v
			JOIN voucher_allocations va ON va.voucher_id = v.id
			JOIN invoices i ON i.id = va.invoice_id
			WHERE i.batch_id = ?
			ORDER BY v.voucher_date ASC, v.voucher_number ASC
		`, id)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		defer rows.Close()

		var vIDs []string
		for rows.Next() {
			var vID string
			if err := rows.Scan(&vID); err == nil {
				vIDs = append(vIDs, vID)
			}
		}
		rows.Close()

		list := make([]*services.VoucherView, 0, len(vIDs))
		for _, vID := range vIDs {
			if vView, errV := s.vouchers.GetVoucher(vID); errV == nil && vView != nil {
				list = append(list, vView)
			}
		}
		s.json(w, 200, list)
	})

	mux.HandleFunc("DELETE /api/bulk/batches/{id}", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		username := "system"
		if u != nil {
			username = u.Username
		}
		id := r.PathValue("id")
		if err := s.bulk.DeleteBatch(id, username, s.clientIP(r)); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		_, _ = s.db.Exec(`DELETE FROM document_pdfs WHERE
			(kind='invoice' AND document_id NOT IN (SELECT id FROM invoices)) OR
			(kind='voucher' AND document_id NOT IN (SELECT id FROM receipt_vouchers))`)
		s.sync.Broadcast(services.SyncEvent{
			Type: "invoice:deleted", Entity: "invoice", Action: "delete",
			Actor: username, Data: map[string]any{"batch_id": id},
		})
		s.json(w, 200, map[string]any{"ok": true, "message": "تم حذف الدفعة وجميع فواتيرها وسنداتها بنجاح"})
	})

	mux.HandleFunc("POST /api/bulk/batches/{id}/generate-vouchers", func(w http.ResponseWriter, r *http.Request) {
		u := s.getSessionUser(r)
		username := "system"
		if u != nil {
			username = u.Username
		}
		id := r.PathValue("id")
		var body struct {
			PaymentType string `json:"payment_type"`
			VoucherDate string `json:"voucher_date"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		res, err := s.bulk.GenerateBatchVouchers(id, body.PaymentType, body.VoucherDate, username, s.clientIP(r))
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.dirtyBatchDocuments(id)
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

// ─── إدارة النظام: تصدير واستيراد الحزمة الشاملة وقاعدة البيانات ─────────

func (s *Server) handleExportDB(w http.ResponseWriter, r *http.Request) {
	u := s.getSessionUser(r)
	if u == nil || u.Role != "ADMIN" {
		s.err(w, 403, "تصدير قاعدة البيانات محصور بمدير النظام فقط")
		return
	}

	res, err := s.db.CreateBackup()
	if err != nil {
		s.err(w, 500, "فشل إنشاء ملف التصدير: "+err.Error())
		return
	}

	s.db.Audit(u.Username, "DATABASE_EXPORT", "system", "", "", map[string]any{
		"backup_file": res.Filename,
		"size_bytes":  res.SizeBytes,
	}, s.clientIP(r))

	exportName := fmt.Sprintf("raseen_database_%s.db", time.Now().Format("2006-01-02_150405"))
	w.Header().Set("Content-Type", "application/x-sqlite3")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", exportName))
	w.Header().Set("Content-Length", strconv.FormatInt(res.SizeBytes, 10))
	http.ServeFile(w, r, res.Path)
}

func (s *Server) handleExportPackage(w http.ResponseWriter, r *http.Request) {
	u := s.getSessionUser(r)
	if u == nil || u.Role != "ADMIN" {
		s.err(w, 403, "تصدير حزمة النظام محصور بمدير النظام فقط")
		return
	}

	res, err := s.db.CreateBackup()
	if err != nil {
		s.err(w, 500, "فشل إنشاء نسخة متناسقة من قاعدة البيانات: "+err.Error())
		return
	}
	keyBackupPath := strings.TrimSuffix(res.Path, ".db") + ".key"
	keyData, err := os.ReadFile(keyBackupPath)
	if err != nil {
		s.err(w, 500, "فشل قراءة مفتاح النسخة الاحتياطية: "+err.Error())
		return
	}

	exportFile, err := os.CreateTemp(s.cfg.BackupDir, "raseen_export_*.zip")
	if err != nil {
		s.err(w, 500, "فشل تجهيز ملف التصدير: "+err.Error())
		return
	}
	exportPath := exportFile.Name()
	defer os.Remove(exportPath)
	defer exportFile.Close()
	zw := zip.NewWriter(exportFile)

	addFileToZip := func(diskPath, zipRelPath string) error {
		src, err := os.Open(diskPath)
		if err != nil {
			return err
		}
		defer src.Close()

		f, err := zw.Create(filepath.ToSlash(zipRelPath))
		if err != nil {
			return err
		}
		_, err = io.Copy(f, src)
		return err
	}

	// 1. إضافة قاعدة البيانات zsystem.db من النسخة الاحتياطية المتناسقة
	if err := addFileToZip(res.Path, "zsystem.db"); err != nil {
		s.err(w, 500, "فشل إضافة قاعدة البيانات إلى الحزمة: "+err.Error())
		return
	}
	if keyEntry, err := zw.Create("secret.key"); err != nil {
		s.err(w, 500, "فشل إضافة مفتاح التشفير إلى الحزمة: "+err.Error())
		return
	} else if _, err := keyEntry.Write(keyData); err != nil {
		s.err(w, 500, "فشل كتابة مفتاح التشفير في الحزمة: "+err.Error())
		return
	}

	// 2. إضافة رمز الريال السعودي saudi_riyal_symbol.svg
	sarSvg := filepath.Join(s.cfg.DataDir, "saudi_riyal_symbol.svg")
	if _, err := os.Stat(sarSvg); err == nil {
		if err := addFileToZip(sarSvg, "saudi_riyal_symbol.svg"); err != nil {
			s.err(w, 500, "فشل إضافة رمز العملة إلى الحزمة: "+err.Error())
			return
		}
	}

	// 3. إضافة مجلد القوالب templates
	tplBaseDir := filepath.Join(s.cfg.DataDir, "templates")
	var invoiceCount, docCount, reportCount, statementCount int
	if err := filepath.Walk(tplBaseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(s.cfg.DataDir, path)
		if err != nil {
			return err
		}
		relSlash := filepath.ToSlash(rel)
		if strings.HasSuffix(strings.ToLower(relSlash), ".html") {
			if strings.Contains(relSlash, "invoices") {
				invoiceCount++
			} else if strings.Contains(relSlash, "documents") {
				docCount++
			} else if strings.Contains(relSlash, "reports") {
				reportCount++
			} else if strings.Contains(relSlash, "statements") {
				statementCount++
			}
		}
		return addFileToZip(path, relSlash)
	}); err != nil && !os.IsNotExist(err) {
		s.err(w, 500, "فشل إضافة القوالب إلى الحزمة: "+err.Error())
		return
	}

	// 4. ملف manifest.json
	manifest := map[string]any{
		"app":                 "Raseen",
		"version":             "1.0",
		"created_at":          time.Now().Format(time.RFC3339),
		"database_file":       "zsystem.db",
		"database_size":       res.SizeBytes,
		"invoice_templates":   invoiceCount,
		"document_templates":  docCount,
		"report_templates":    reportCount,
		"statement_templates": statementCount,
	}
	mb, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		s.err(w, 500, "فشل تجهيز بيانات الحزمة: "+err.Error())
		return
	}
	mf, err := zw.Create("manifest.json")
	if err != nil {
		s.err(w, 500, "فشل إضافة بيان الحزمة: "+err.Error())
		return
	}
	if _, err := mf.Write(mb); err != nil {
		s.err(w, 500, "فشل كتابة بيان الحزمة: "+err.Error())
		return
	}
	if err := zw.Close(); err != nil {
		s.err(w, 500, "فشل إكمال ملف الحزمة: "+err.Error())
		return
	}
	if err := exportFile.Close(); err != nil {
		s.err(w, 500, "فشل حفظ ملف الحزمة: "+err.Error())
		return
	}

	exportName := fmt.Sprintf("raseen_package_%s.zip", time.Now().Format("2006-01-02_150405"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", exportName))
	http.ServeFile(w, r, exportPath)
	s.db.Audit(u.Username, "PACKAGE_EXPORT", "system", "", "", manifest, s.clientIP(r))
}

func (s *Server) handleImportSystemPackage(w http.ResponseWriter, r *http.Request) {
	u := s.getSessionUser(r)
	if u == nil || u.Role != "ADMIN" {
		s.err(w, 403, "استيراد واستعادة بيانات النظام محصور بمدير النظام فقط")
		return
	}

	// سقف حجم الملف 2GB لضمان رفع أضخم قواعد البيانات وحزم الأرشيف
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		s.err(w, 400, "تعذر قراءة الملف المرفوع أو تجاوز الحد المسموح: "+err.Error())
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	var file multipart.File
	var header *multipart.FileHeader
	var err error

	for _, field := range []string{"package_file", "database_file", "file"} {
		file, header, err = r.FormFile(field)
		if err == nil && file != nil {
			break
		}
	}
	if file == nil || header == nil {
		s.err(w, 400, "يرجى تحديد ملف الحزمة المضغوطة (.zip) أو ملف قاعدة البيانات (.db) المراد استيراده")
		return
	}
	defer file.Close()

	tempDir := s.cfg.BackupDir
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		s.err(w, 500, "فشل تجهيز مجلد الاستيراد: "+err.Error())
		return
	}

	tempPath := filepath.Join(tempDir, fmt.Sprintf("import_upload_%d.tmp", time.Now().UnixNano()))
	tempFile, err := os.Create(tempPath)
	if err != nil {
		s.err(w, 500, "تعذر إنشاء ملف الاستيراد المؤقت: "+err.Error())
		return
	}
	_, copyErr := io.Copy(tempFile, file)
	tempFile.Close()
	defer os.Remove(tempPath)

	if copyErr != nil {
		s.err(w, 500, "فشل حفظ محتويات الملف المرفوع: "+copyErr.Error())
		return
	}

	// فحص ما إذا كان الملف المرفوع أرشيف مضغوط ZIP
	zipReader, zipErr := zip.OpenReader(tempPath)
	if zipErr == nil {
		defer zipReader.Close()
		archiveKey, err := packageMasterKey(zipReader.File)
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}

		var dbRestored bool
		var preBackupFilename string
		var templatesCount int
		var foundDbInZip *zip.File

		// البحث الذكي عن أي ملف قاعدة بيانات SQLite داخل الـ ZIP مهما كان المجلد أو التسمية
		// المسار 1: الأولوية لـ zsystem.db أو database.db أو أي قاعدة خارج مجلد النسخ الاحتياطية
		for _, f := range zipReader.File {
			cleanName := filepath.ToSlash(f.Name)
			lower := strings.ToLower(cleanName)
			if strings.HasPrefix(lower, "__macosx") || strings.HasPrefix(filepath.Base(lower), ".") || f.FileInfo().IsDir() {
				continue
			}
			if strings.HasSuffix(lower, ".db") || strings.HasSuffix(lower, ".sqlite") || strings.HasSuffix(lower, ".sqlite3") {
				if strings.Contains(lower, "zsystem.db") || strings.Contains(lower, "database.db") {
					foundDbInZip = f
					break
				}
				if !strings.Contains(lower, "/backups/") && foundDbInZip == nil {
					foundDbInZip = f
				}
			}
		}

		// المسار 2: إذا لم يُعثر عليها، ابحث عن أي ملف قاعدة بيانات .db داخل الأرشيف
		if foundDbInZip == nil {
			for _, f := range zipReader.File {
				cleanName := filepath.ToSlash(f.Name)
				lower := strings.ToLower(cleanName)
				if strings.HasPrefix(lower, "__macosx") || strings.HasPrefix(filepath.Base(lower), ".") || f.FileInfo().IsDir() {
					continue
				}
				if strings.HasSuffix(lower, ".db") || strings.HasSuffix(lower, ".sqlite") || strings.HasSuffix(lower, ".sqlite3") {
					foundDbInZip = f
					break
				}
			}
		}

		if foundDbInZip != nil {
			if foundDbInZip.UncompressedSize64 > 2*1024*1024*1024 {
				s.err(w, 400, "قاعدة البيانات داخل الحزمة تتجاوز الحد المسموح")
				return
			}
			rc, err := foundDbInZip.Open()
			if err != nil {
				s.err(w, 500, "تعذر فتح ملف قاعدة البيانات داخل الحزمة: "+err.Error())
				return
			}
			tempDbPath := filepath.Join(tempDir, fmt.Sprintf("extracted_db_%d.tmp", time.Now().UnixNano()))
			outDb, err := os.Create(tempDbPath)
			if err != nil {
				rc.Close()
				s.err(w, 500, "تعذر إنشاء ملف قاعدة البيانات المؤقت: "+err.Error())
				return
			}
			copiedDbBytes, copyDbErr := io.Copy(outDb, io.LimitReader(rc, 2*1024*1024*1024+1))
			rc.Close()
			outDb.Close()
			defer os.Remove(tempDbPath)

			if copyDbErr != nil {
				s.err(w, 500, "فشل استخراج قاعدة البيانات من الأرشيف: "+copyDbErr.Error())
				return
			}
			if copiedDbBytes > 2*1024*1024*1024 {
				s.err(w, 400, "قاعدة البيانات داخل الحزمة تتجاوز الحد المسموح")
				return
			}

			sourceKey := s.masterKey
			if archiveKey != nil {
				sourceKey = archiveKey
			}
			if err := prepareImportedDatabaseSecrets(tempDbPath, sourceKey, s.masterKey); err != nil {
				s.err(w, 400, err.Error())
				return
			}
			preBackup, restoreErr := s.db.RestoreFrom(tempDbPath)
			if restoreErr != nil {
				s.err(w, 400, "فشل استعادة قاعدة البيانات من الحزمة: "+restoreErr.Error())
				return
			}
			dbRestored = true
			if preBackup != nil {
				preBackupFilename = preBackup.Filename
			}
		}

		// فحص ما إذا كانت الحزمة تحتوي على قوالب HTML
		templateCategory := func(name string) string {
			parts := strings.Split(strings.Trim(strings.ToLower(filepath.ToSlash(name)), "/"), "/")
			for i, part := range parts {
				if part == "templates" && i+1 < len(parts) {
					part = parts[i+1]
				}
				switch part {
				case "partials", "reports", "statements", "invoices":
					return part
				case "documents", "vouchers":
					return "documents"
				}
			}
			return "invoices"
		}
		archiveCategories := map[string]bool{}
		for _, f := range zipReader.File {
			cleanName := filepath.ToSlash(f.Name)
			lower := strings.ToLower(cleanName)
			if strings.HasPrefix(lower, "__macosx") || strings.HasPrefix(filepath.Base(lower), ".") || f.FileInfo().IsDir() {
				continue
			}
			baseName := filepath.Base(cleanName)
			if strings.HasSuffix(lower, ".html") && baseName != "index.html" && f.UncompressedSize64 > 0 {
				archiveCategories[templateCategory(cleanName)] = true
			}
		}

		// استعادة الفئات الموجودة في الحزمة فقط.
		for category := range archiveCategories {
			dir := filepath.Join(s.cfg.DataDir, "templates", category)
			_ = os.RemoveAll(dir)
			_ = os.MkdirAll(dir, 0755)
		}

		// استخراج قوالب HTML والملفات التابعة
		installedTemplatePaths := map[string]bool{}
		for _, f := range zipReader.File {
			cleanName := filepath.ToSlash(f.Name)
			lower := strings.ToLower(cleanName)
			if strings.HasPrefix(lower, "__macosx") || strings.HasPrefix(filepath.Base(lower), ".") || f.FileInfo().IsDir() {
				continue
			}
			// حماية من Zip-Slip
			if strings.Contains(cleanName, "..") {
				continue
			}

			// رمز الريال السعودي SVG
			if filepath.Base(lower) == "saudi_riyal_symbol.svg" {
				if f.UncompressedSize64 > 2<<20 {
					continue
				}
				rc, err := f.Open()
				if err == nil {
					svgData, _ := io.ReadAll(rc)
					rc.Close()
					if len(svgData) > 0 {
						_ = os.WriteFile(filepath.Join(s.cfg.DataDir, "saudi_riyal_symbol.svg"), svgData, 0644)
					}
				}
				continue
			}

			// قوالب HTML
			if strings.HasSuffix(lower, ".html") {
				if f.UncompressedSize64 > 10<<20 {
					continue
				}
				baseName := filepath.Base(cleanName)
				if baseName == "index.html" || strings.HasPrefix(baseName, ".") || f.UncompressedSize64 == 0 {
					continue
				}

				targetSub := templateCategory(cleanName)

				targetDir := filepath.Join(s.cfg.DataDir, "templates", targetSub)
				_ = os.MkdirAll(targetDir, 0755)
				targetPath := filepath.Join(targetDir, baseName)

				rc, err := f.Open()
				if err != nil {
					continue
				}
				content, err := io.ReadAll(rc)
				rc.Close()
				if err == nil && len(content) > 0 {
					if errWrite := os.WriteFile(targetPath, content, 0644); errWrite == nil {
						cleanTarget := strings.ToLower(filepath.Clean(targetPath))
						if !installedTemplatePaths[cleanTarget] {
							installedTemplatePaths[cleanTarget] = true
							templatesCount++
						}
					}
				}
			}
		}

		if templatesCount > 0 || dbRestored {
			_ = s.templates.SyncDiskTemplates()
		}

		if !dbRestored && templatesCount == 0 {
			s.err(w, 400, "الملف المضغوط لا يحتوي على قاعدة بيانات SQLite (.db) أو قوالب HTML صالحة")
			return
		}

		msg := fmt.Sprintf("تم استيراد واستعادة الحزمة بنجاح: تم تحديث وتثبيت %d قالب", templatesCount)
		if dbRestored && templatesCount > 0 {
			msg = fmt.Sprintf("تم استيراد واستعادة الحزمة بالكامل بنجاح: تم استرجاع قاعدة البيانات وتثبيت وتحديث %d قالب", templatesCount)
		} else if dbRestored {
			msg = "تم استيراد واستعادة قاعدة البيانات بالكامل بنجاح"
		}

		s.db.Audit(u.Username, "PACKAGE_IMPORT", "system", "", "", map[string]any{
			"original_filename":  header.Filename,
			"db_restored":        dbRestored,
			"templates_count":    templatesCount,
			"pre_restore_backup": preBackupFilename,
		}, s.clientIP(r))

		s.json(w, 200, map[string]any{
			"ok":                 true,
			"message":            msg,
			"db_restored":        dbRestored,
			"templates_count":    templatesCount,
			"pre_restore_backup": preBackupFilename,
		})
		return
	}

	// في حال لم يكن أرشيف ZIP، يتم التعامل معه كملف قاعدة بيانات SQLite مباشر
	if err := prepareImportedDatabaseSecrets(tempPath, s.masterKey, s.masterKey); err != nil {
		s.err(w, 400, err.Error())
		return
	}
	preBackup, restoreErr := s.db.RestoreFrom(tempPath)
	if restoreErr != nil {
		s.err(w, 400, restoreErr.Error())
		return
	}

	_ = s.templates.SyncDiskTemplates()

	var preBackupFilename string
	if preBackup != nil {
		preBackupFilename = preBackup.Filename
	}

	s.db.Audit(u.Username, "DATABASE_IMPORT", "system", "", "", map[string]any{
		"original_filename":  header.Filename,
		"pre_restore_backup": preBackupFilename,
	}, s.clientIP(r))

	s.json(w, 200, map[string]any{
		"ok":                 true,
		"message":            "تم استيراد واستعادة كافة بيانات النظام بنجاح تام",
		"db_restored":        true,
		"templates_count":    0,
		"pre_restore_backup": preBackupFilename,
	})
}
