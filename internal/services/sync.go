package services

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"raseen/internal/crypto"
	"raseen/internal/db"
)

type SyncEvent struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`       // e.g. "invoice:created", "sync:force", "broadcast:alert"
	Entity    string         `json:"entity"`     // "invoice", "voucher", "client", "item", "system"
	Action    string         `json:"action"`     // "create", "update", "cancel", "delete", "alert", "sync"
	Actor     string         `json:"actor"`      // username
	ActorName string         `json:"actor_name"` // full name
	ActorRole string         `json:"actor_role"` // role
	Timestamp string         `json:"timestamp"`  // RFC3339
	Data      map[string]any `json:"data,omitempty"`
}

type ClientSubscriber struct {
	ID           string
	SessionToken string
	UserID       string
	Username     string
	FullName     string
	Role         string
	IP           string
	UserAgent    string
	DeviceName   string
	CurrentView  string
	ConnectedAt  time.Time
	LastSeenAt   time.Time
	ch           chan SyncEvent
}

type ActiveSessionView struct {
	ID               string `json:"id"`
	SessionToken     string `json:"session_token_masked"`
	FullToken        string `json:"-"`
	UserID           string `json:"user_id"`
	Username         string `json:"username"`
	FullName         string `json:"full_name"`
	Role             string `json:"role"`
	IP               string `json:"ip"`
	UserAgent        string `json:"user_agent"`
	DeviceName       string `json:"device_name"`
	CurrentView      string `json:"current_view"`
	ViewLabel        string `json:"view_label"`
	ConnectedAt      string `json:"connected_at"`
	LastSeenAt       string `json:"last_seen_at"`
	IsOnline         bool   `json:"is_online"`
	SecondsSinceSeen int    `json:"seconds_since_seen"`
	IsCurrent        bool   `json:"is_current"`
}

type SyncHub struct {
	db          *db.DB
	subscribers map[string]*ClientSubscriber
	subMu       sync.RWMutex
	history     []SyncEvent
	histMu      sync.RWMutex
	maxHistory  int
}

var viewLabelsMap = map[string]string{
	"dashboard":        "الرئيسية",
	"invoice":          "إصدار فاتورة جديدة",
	"invoices":         "قائمة الفواتير",
	"invoice-view":     "معاينة الفاتورة",
	"bulk":             "التوليد الدفعي",
	"vouchers":         "سندات القبض",
	"statement":        "كشف حساب عميل",
	"issuers":          "الشركات المصدرة",
	"templates":        "القوالب",
	"template-builder": "إنشاء وتصميم القوالب",
	"clients":          "دليل العملاء",
	"items":            "الأصناف والمجموعات",
	"reports":          "التقارير المالية",
	"audit":            "سجل التدقيق والرقابة",
	"users":            "المستخدمون والمزامنة",
	"settings":         "إعدادات النظام",
}

func parseDeviceName(ua string) string {
	if ua == "" {
		return "جهاز غير محدد"
	}
	os := "جهاز غير معروف"
	browser := "متصفح"

	// OS (check mobile devices first as their UAs often contain Mac OS X or Linux tokens)
	if strings.Contains(ua, "iPhone") {
		os = "iPhone"
	} else if strings.Contains(ua, "iPad") {
		os = "iPad"
	} else if strings.Contains(ua, "Android") {
		os = "Android"
	} else if strings.Contains(ua, "Windows NT 10.0") || strings.Contains(ua, "Windows NT 11.0") {
		os = "Windows"
	} else if strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X") {
		os = "macOS"
	} else if strings.Contains(ua, "Linux") {
		os = "Linux"
	}

	// Browser
	if strings.Contains(ua, "Edg/") {
		browser = "Edge"
	} else if strings.Contains(ua, "Chrome/") && !strings.Contains(ua, "Edg/") {
		browser = "Chrome"
	} else if strings.Contains(ua, "Safari/") && !strings.Contains(ua, "Chrome/") {
		browser = "Safari"
	} else if strings.Contains(ua, "Firefox/") {
		browser = "Firefox"
	}

	return fmt.Sprintf("%s · %s", os, browser)
}

func NewSyncHub(d *db.DB) *SyncHub {
	hub := &SyncHub{
		db:          d,
		subscribers: make(map[string]*ClientSubscriber),
		history:     make([]SyncEvent, 0, 100),
		maxHistory:  100,
	}

	// Janitor routine: cleanup disconnected or dead subscribers
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			hub.cleanupStaleSubscribers()
		}
	}()

	return hub
}

func (h *SyncHub) cleanupStaleSubscribers() {
	h.subMu.Lock()
	defer h.subMu.Unlock()

	now := time.Now()
	for id, sub := range h.subscribers {
		// If no heartbeat for > 60 seconds, close and clean up
		if now.Sub(sub.LastSeenAt) > 60*time.Second {
			close(sub.ch)
			delete(h.subscribers, id)
		}
	}
}

// Subscribe registers a live SSE connection
func (h *SyncHub) Subscribe(sessionToken, userID, username, fullName, role, ip, userAgent string) (string, <-chan SyncEvent, func()) {
	h.subMu.Lock()
	defer h.subMu.Unlock()

	subID := crypto.UUID()
	ch := make(chan SyncEvent, 256) // high-capacity buffer so fast bursts never drop events

	sub := &ClientSubscriber{
		ID:           subID,
		SessionToken: sessionToken,
		UserID:       userID,
		Username:     username,
		FullName:     fullName,
		Role:         role,
		IP:           ip,
		UserAgent:    userAgent,
		DeviceName:   parseDeviceName(userAgent),
		CurrentView:  "dashboard",
		ConnectedAt:  time.Now(),
		LastSeenAt:   time.Now(),
		ch:           ch,
	}

	h.subscribers[subID] = sub

	// Update DB session info asynchronously without blocking SSE handshake
	if h.db != nil && sessionToken != "" {
		nowStr := db.NowIso()
		go func(tok, clientIP, ua, t string) {
			_, _ = h.db.Exec(`
				UPDATE sessions 
				SET ip = ?, user_agent = ?, last_active_at = ?
				WHERE token = ?
			`, clientIP, ua, t, tok)
		}(sessionToken, ip, userAgent, nowStr)
	}

	cancel := func() {
		h.subMu.Lock()
		defer h.subMu.Unlock()
		if s, ok := h.subscribers[subID]; ok {
			close(s.ch)
			delete(h.subscribers, subID)
		}
	}

	return subID, ch, cancel
}

// Heartbeat updates current active screen/view and keeps connection fresh
func (h *SyncHub) Heartbeat(sessionToken, currentView string) int {
	h.subMu.Lock()
	now := time.Now()
	count := 0
	viewChanged := false

	for _, sub := range h.subscribers {
		if sub.SessionToken == sessionToken {
			sub.LastSeenAt = now
			if currentView != "" && sub.CurrentView != currentView {
				sub.CurrentView = currentView
				viewChanged = true
			}
		}
		if now.Sub(sub.LastSeenAt) <= 60*time.Second {
			count++
		}
	}
	h.subMu.Unlock()

	// Update DB asynchronously only when view changes, completely avoiding constant disk write locks
	if h.db != nil && sessionToken != "" && viewChanged {
		nowStr := db.NowIso()
		go func(tok, cv, t string) {
			_, _ = h.db.Exec(`
				UPDATE sessions 
				SET current_view = ?, last_active_at = ?
				WHERE token = ?
			`, cv, t, tok)
		}(sessionToken, currentView, nowStr)
	}

	return count
}

// Broadcast dispatches an event to all connected clients
func (h *SyncHub) Broadcast(event SyncEvent) {
	if event.ID == "" {
		event.ID = crypto.UUID()
	}
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	// Record in history buffer
	h.histMu.Lock()
	if len(h.history) >= h.maxHistory {
		h.history = h.history[1:]
	}
	h.history = append(h.history, event)
	h.histMu.Unlock()

	// Send to all subscribers non-blockingly
	h.subMu.RLock()
	defer h.subMu.RUnlock()

	for _, sub := range h.subscribers {
		select {
		case sub.ch <- event:
		default:
			// Buffer full, skip to avoid blocking other concurrent subscribers
		}
	}
}

// BroadcastToUser sends event specifically to one user's active sessions
func (h *SyncHub) BroadcastToUser(userID string, event SyncEvent) {
	if event.ID == "" {
		event.ID = crypto.UUID()
	}
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	h.subMu.RLock()
	defer h.subMu.RUnlock()

	for _, sub := range h.subscribers {
		if sub.UserID == userID {
			select {
			case sub.ch <- event:
			default:
			}
		}
	}
}

// ForceGlobalSync orders all connected clients to reload data immediately
func (h *SyncHub) ForceGlobalSync(actor, actorName string) {
	h.Broadcast(SyncEvent{
		Type:      "sync:force",
		Entity:    "system",
		Action:    "sync",
		Actor:     actor,
		ActorName: actorName,
		Data: map[string]any{
			"message": "تمت مزامنة البيانات بناءً على طلب مسؤول النظام",
		},
	})
}

// BroadcastAlert sends a live flash announcement to all connected clients
func (h *SyncHub) BroadcastAlert(message, level, actor, actorName string) {
	if level == "" {
		level = "info"
	}
	h.Broadcast(SyncEvent{
		Type:      "broadcast:alert",
		Entity:    "system",
		Action:    "alert",
		Actor:     actor,
		ActorName: actorName,
		Data: map[string]any{
			"message": message,
			"level":   level,
		},
	})
}

// RevokeSession terminates a session in DB and disconnects the live client
func (h *SyncHub) RevokeSession(sessionToken string) error {
	// 1. Notify subscriber of termination
	h.subMu.Lock()
	for id, sub := range h.subscribers {
		if sub.SessionToken == sessionToken {
			select {
			case sub.ch <- SyncEvent{
				Type:   "session:revoked",
				Entity: "session",
				Action: "revoke",
				Data: map[string]any{
					"reason": "تم إنهاء جلستك من قِبل مسؤول النظام",
				},
			}:
			default:
			}
			close(sub.ch)
			delete(h.subscribers, id)
		}
	}
	h.subMu.Unlock()

	// 2. Delete from DB
	if h.db != nil {
		_, err := h.db.Exec("DELETE FROM sessions WHERE token = ?", sessionToken)
		return err
	}
	return nil
}

// RevokeAllOtherSessions terminates all sessions except the current admin session
func (h *SyncHub) RevokeAllOtherSessions(keepToken string) (int, error) {
	h.subMu.Lock()
	revokedCount := 0
	for id, sub := range h.subscribers {
		if sub.SessionToken != keepToken {
			select {
			case sub.ch <- SyncEvent{
				Type:   "session:revoked",
				Entity: "session",
				Action: "revoke",
				Data: map[string]any{
					"reason": "تم إنهاء الجلسات النشطة من قِبل مسؤول النظام",
				},
			}:
			default:
			}
			close(sub.ch)
			delete(h.subscribers, id)
			revokedCount++
		}
	}
	h.subMu.Unlock()

	if h.db != nil {
		res, err := h.db.Exec("DELETE FROM sessions WHERE token <> ?", keepToken)
		if err != nil {
			return revokedCount, err
		}
		affected, _ := res.RowsAffected()
		return int(affected), nil
	}
	return revokedCount, nil
}

// GetActiveSessions returns rich real-time sessions view for Admin
func (h *SyncHub) GetActiveSessions(currentSessionToken string) []ActiveSessionView {
	now := time.Now()

	// 1. Fetch DB sessions joined with users
	rows, err := h.db.Query(`
		SELECT s.token, s.user_id, u.username, u.full_name, u.role,
		       COALESCE(s.ip, ''), COALESCE(s.user_agent, ''),
		       COALESCE(s.current_view, 'dashboard'),
		       s.created_at, COALESCE(s.last_active_at, s.created_at)
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		ORDER BY s.last_active_at DESC
	`)
	if err != nil {
		return []ActiveSessionView{}
	}
	defer rows.Close()

	// Map of in-memory active live subscribers
	h.subMu.RLock()
	liveMap := make(map[string]*ClientSubscriber)
	for _, sub := range h.subscribers {
		liveMap[sub.SessionToken] = sub
	}
	h.subMu.RUnlock()

	var result []ActiveSessionView

	for rows.Next() {
		var token, userID, username, fullName, role, ip, ua, curView, createdStr, lastActiveStr string
		if err := rows.Scan(&token, &userID, &username, &fullName, &role, &ip, &ua, &curView, &createdStr, &lastActiveStr); err != nil {
			continue
		}

		isLive := false
		secsSince := 999999

		if liveSub, ok := liveMap[token]; ok {
			isLive = now.Sub(liveSub.LastSeenAt) <= 60*time.Second
			secsSince = int(now.Sub(liveSub.LastSeenAt).Seconds())
			if liveSub.CurrentView != "" {
				curView = liveSub.CurrentView
			}
		} else {
			// Fallback check last active time
			if t, err := time.Parse(time.RFC3339, lastActiveStr); err == nil {
				secsSince = int(now.Sub(t).Seconds())
				isLive = secsSince <= 120
			}
		}

		// Clean device string
		dev := parseDeviceName(ua)
		viewLbl := viewLabelsMap[curView]
		if viewLbl == "" {
			viewLbl = curView
		}

		// Mask token for safety: tok_abc...xyz
		maskedTok := token
		if len(token) > 10 {
			maskedTok = token[:4] + "…" + token[len(token)-4:]
		}

		result = append(result, ActiveSessionView{
			ID:               token,
			SessionToken:     maskedTok,
			FullToken:        token,
			UserID:           userID,
			Username:         username,
			FullName:         fullName,
			Role:             role,
			IP:               ip,
			UserAgent:        ua,
			DeviceName:       dev,
			CurrentView:      curView,
			ViewLabel:        viewLbl,
			ConnectedAt:      createdStr,
			LastSeenAt:       lastActiveStr,
			IsOnline:         isLive,
			SecondsSinceSeen: secsSince,
			IsCurrent:        token == currentSessionToken,
		})
	}

	return result
}

// GetHistory returns recent event history
func (h *SyncHub) GetHistory(limit int) []SyncEvent {
	h.histMu.RLock()
	defer h.histMu.RUnlock()

	n := len(h.history)
	if limit <= 0 || limit > n {
		limit = n
	}

	res := make([]SyncEvent, limit)
	copy(res, h.history[n-limit:])

	// Reverse so latest is first
	for i, j := 0, len(res)-1; i < j; i, j = i+1, j-1 {
		res[i], res[j] = res[j], res[i]
	}
	return res
}

// ActiveCount returns count of active live subscribers
func (h *SyncHub) ActiveCount() int {
	h.subMu.RLock()
	defer h.subMu.RUnlock()

	now := time.Now()
	count := 0
	for _, sub := range h.subscribers {
		if now.Sub(sub.LastSeenAt) <= 60*time.Second {
			count++
		}
	}
	if count == 0 {
		return 1
	}
	return count
}
