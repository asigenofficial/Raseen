package api

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"raseen/internal/services"
)

type sessionUserKey struct{}

// Only registered API routes can receive a permission. Unknown routes fail closed.
func routePermission(pattern string) string {
	method, path, ok := strings.Cut(pattern, " ")
	if !ok || !strings.HasPrefix(path, "/api/") { return "!deny" }
	path = strings.TrimPrefix(path, "/api/")
	if path == "auth/me" || path == "auth/logout" || path == "auth/password" { return "" }
	resource, tail, _ := strings.Cut(path, "/")
	switch resource {
	case "users", "roles": return "users.manage"
	case "system", "settings": return "settings.write"
	case "audit": return "audit.view"
	case "reports": return "reports.view"
	case "ledger": return "ledger.view"
	case "templates": if method == "GET" { return "invoices.view" }; return "templates.write"
	case "bulk": if tail == "commit" { return "bulk.approve" }; return "bulk.generate"
	case "pdf": return "export.pdf"
	case "export": return "export.excel"
	case "categories": resource = "items"
	case "issuers", "clients", "items", "invoices", "vouchers":
	default: return "!deny"
	}
	if strings.Contains(tail,"credentials") || strings.HasSuffix(tail,"generate-key") { return "issuers.credentials" }
	if resource == "clients" && strings.HasSuffix(tail,"statement") { return "ledger.view" }
	if strings.HasPrefix(tail,"templates") { if method == "GET" { return "invoices.view" }; return "templates.write" }
	if strings.HasSuffix(tail,"cancel") { return resource+".cancel" }
	if method == "GET" || method == "HEAD" { return resource+".view" }
	if method == "POST" { return resource+".create" }
	if method == "PUT" { return resource+".edit" }
	if method == "DELETE" { return resource+".delete" }
	return "!deny"
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request, mux *http.ServeMux) bool {
	if !strings.HasPrefix(r.URL.Path,"/api/") { return true }
	r.Body = http.MaxBytesReader(w,r.Body,s.cfg.MaxBodyBytes)
	if r.Method != "GET" && r.Method != "HEAD" {
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") { s.err(w,403,"مصدر الطلب غير مسموح"); return false }
		}
	}
	if (r.Method == "POST" && r.URL.Path == "/api/auth/login") || (r.Method == "GET" && (r.URL.Path == "/api/health" || r.URL.Path == "/api/meta" || strings.HasSuffix(r.URL.Path, "/render-html"))) { return true }
	u := s.getSessionUser(r)
	if u == nil { s.err(w,401,"يلزم تسجيل الدخول"); return false }
	_, pattern := mux.Handler(r)
	permission := routePermission(pattern)
	if permission == "!deny" { s.err(w,404,"المسار غير موجود"); return false }
	if permission != "" && !services.HasPermission(u,permission) { s.err(w,403,"ليست لديك صلاحية لهذه العملية"); return false }
	*r = *r.WithContext(context.WithValue(r.Context(),sessionUserKey{},u))
	return true
}
