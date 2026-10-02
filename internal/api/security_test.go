package api

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	_ "modernc.org/sqlite"
	"raseen/internal/config"
	"raseen/internal/db"
)

func TestSyncRoutePermissions(t *testing.T) {
	tests := []struct{ pattern, want string }{
		{"GET /api/sync/events", ""},
		{"POST /api/sync/heartbeat", ""},
		{"GET /api/admin/sync/sessions", "users.manage"},
		{"GET /api/admin/sync/history", "users.manage"},
		{"POST /api/admin/sync/force", "users.manage"},
		{"POST /api/admin/sync/broadcast", "users.manage"},
		{"POST /api/admin/sync/revoke", "users.manage"},
		{"POST /api/admin/sync/revoke-others", "users.manage"},
		{"POST /api/sync/events", "!deny"},
		{"GET /api/admin/sync/force", "!deny"},
		{"GET /api/admin/sync/unknown", "!deny"},
		{"PATCH /api/vouchers/{id}", "vouchers.edit"},
		{"DELETE /api/bulk/batches/{id}", "invoices.delete"},
		{"POST /api/bulk/batches/{id}/generate-vouchers", "vouchers.create"},
	}
	for _, tt := range tests {
		if got := routePermission(tt.pattern); got != tt.want {
			t.Errorf("routePermission(%q) = %q, want %q", tt.pattern, got, tt.want)
		}
	}
}

func TestRenderRoutesRequireSession(t *testing.T) {
	mux := http.NewServeMux()
	paths := []string{
		"GET /api/invoices/{id}/render-html",
		"GET /api/invoices/templates/{id}/render-html",
		"GET /api/bulk/batches/{id}/render-html",
		"POST /api/invoices/preview-render-html",
	}
	for _, pattern := range paths {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	}
	s := &Server{cfg: &config.Config{MaxBodyBytes: 1024}}
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/invoices/123/render-html"},
		{"GET", "/api/invoices/templates/123/render-html"},
		{"GET", "/api/bulk/batches/123/render-html"},
		{"POST", "/api/invoices/preview-render-html"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, nil)
			w := httptest.NewRecorder()
			if s.authorize(w, r, mux) || w.Code != http.StatusUnauthorized {
				t.Fatalf("unauthenticated request: authorized=%v status=%d", w.Code == http.StatusOK, w.Code)
			}
		})
	}
}

func TestSessionTokenIsNotAcceptedFromURL(t *testing.T) {
	s := &Server{}
	r := httptest.NewRequest(http.MethodGet, "/api/auth/me?token=secret", nil)
	if got := s.getSessionToken(r); got != "" {
		t.Fatalf("session token accepted from URL: %q", got)
	}
}

func TestHealthReflectsDatabaseAvailability(t *testing.T) {
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{
		cfg:      &config.Config{MaxBodyBytes: 1024},
		db:       &db.DB{DB: conn},
		publicFS: fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("ok")}},
	}
	handler := s.Handler()
	request := func() int {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/health", nil))
		return w.Code
	}
	if code := request(); code != http.StatusOK {
		t.Fatalf("healthy database returned %d", code)
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	if code := request(); code != http.StatusServiceUnavailable {
		t.Fatalf("closed database returned %d", code)
	}
}
