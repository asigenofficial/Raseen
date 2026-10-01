package api

import "testing"

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
