package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
)

type AuthService struct {
	db *db.DB
	ttl time.Duration
}

func NewAuthService(d *db.DB, hours ...int) *AuthService {
	ttl := 12 * time.Hour
	if len(hours) > 0 && hours[0] > 0 { ttl = time.Duration(hours[0]) * time.Hour }
	return &AuthService{db: d, ttl: ttl}
}

func (s *AuthService) permissions(user *models.User) {
	_, roles := s.GetRolesAndPermissions()
	user.EffectivePermissions = append([]string{}, roles[user.Role]...)
	var extra []string
	if json.Unmarshal([]byte(user.Permissions), &extra) == nil {
		user.EffectivePermissions = append(user.EffectivePermissions, extra...)
	}
	if user.Role == "ADMIN" { user.EffectivePermissions = []string{"*"} }
}

func HasPermission(user *models.User, permission string) bool {
	if user == nil { return false }
	if slices.Contains(user.EffectivePermissions, "*") || slices.Contains(user.EffectivePermissions, permission) { return true }
	resource, action, _ := strings.Cut(permission, ".")
	return (action == "create" || action == "edit" || action == "delete") && slices.Contains(user.EffectivePermissions, resource+".write")
}

func (s *AuthService) Login(username, password, ip string) (*models.User, string, error) {
	var user models.User
	var hash, salt string
	var lastLogin sql.NullString

	err := s.db.QueryRow(`
		SELECT id, username, full_name, password_hash, password_salt, role, permissions, is_active, created_at, last_login_at
		FROM users WHERE username = ?
	`, username).Scan(
		&user.ID, &user.Username, &user.FullName, &hash, &salt, &user.Role,
		&user.Permissions, &user.IsActive, &user.CreatedAt, &lastLogin,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, "", errors.New("اسم المستخدم أو كلمة المرور غير صحيحة")
		}
		return nil, "", err
	}

	if user.IsActive != 1 {
		return nil, "", errors.New("الحساب معطّل، يرجى مراجعة مدير النظام")
	}

	if !crypto.VerifyPassword(password, salt, hash) {
		return nil, "", errors.New("اسم المستخدم أو كلمة المرور غير صحيحة")
	}

	// Create session
	token := crypto.Token(32)
	now := db.NowIso()
	expiresAt := time.Now().UTC().Add(s.ttl).Format(time.RFC3339)

	_, err = s.db.Exec(`
		INSERT INTO sessions (token, user_id, created_at, expires_at, ip)
		VALUES (?, ?, ?, ?, ?)
	`, token, user.ID, now, expiresAt, ip)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create session: %w", err)
	}

	_, _ = s.db.Exec("UPDATE users SET last_login_at = ? WHERE id = ?", now, user.ID)
	if lastLogin.Valid {
		user.LastLoginAt = &lastLogin.String
	}

	s.db.Audit(user.Username, "LOGIN", "user", user.ID, "", nil, ip)
	s.permissions(&user)
	return &user, token, nil
}

func (s *AuthService) ValidateSession(token string) (*models.User, error) {
	if token == "" {
		return nil, errors.New("no session token")
	}

	var user models.User
	var expiresAt string
	var lastLogin sql.NullString

	err := s.db.QueryRow(`
		SELECT u.id, u.username, u.full_name, u.role, u.permissions, u.is_active, u.created_at, u.last_login_at, s.expires_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token = ?
	`, token).Scan(
		&user.ID, &user.Username, &user.FullName, &user.Role,
		&user.Permissions, &user.IsActive, &user.CreatedAt, &lastLogin, &expiresAt,
	)
	if err != nil {
		return nil, err
	}

	if user.IsActive != 1 {
		return nil, errors.New("account disabled")
	}

	exp, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil || !time.Now().UTC().Before(exp) {
		_, _ = s.db.Exec("DELETE FROM sessions WHERE token = ?", token)
		return nil, errors.New("session expired")
	}

	if lastLogin.Valid {
		user.LastLoginAt = &lastLogin.String
	}

	s.permissions(&user)
	return &user, nil
}

func (s *AuthService) Logout(token string) {
	if token != "" {
		_, _ = s.db.Exec("DELETE FROM sessions WHERE token = ?", token)
	}
}

func (s *AuthService) ChangePassword(userID, oldPass, newPass string) error {
	if len(newPass) < 6 {
		return errors.New("كلمة المرور يجب أن تكون 6 أحرف على الأقل")
	}

	var hash, salt string
	err := s.db.QueryRow("SELECT password_hash, password_salt FROM users WHERE id = ?", userID).Scan(&hash, &salt)
	if err != nil {
		return err
	}

	if !crypto.VerifyPassword(oldPass, salt, hash) {
		return errors.New("كلمة المرور الحالية غير صحيحة")
	}

	newHash, newSalt := crypto.HashPassword(newPass, "")
	_, err = s.db.Exec("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?", newHash, newSalt, userID)
	return err
}

func roleLabel(role string) string {
	switch role {
	case "ADMIN":
		return "مدير النظام"
	case "ACCOUNTANT":
		return "محاسب"
	case "VIEWER":
		return "مراقب (قراءة فقط)"
	default:
		return role
	}
}

func (s *AuthService) ListUsers() ([]models.User, error) {
	rows, err := s.db.Query(`
		SELECT id, username, full_name, role, permissions, is_active, created_at, last_login_at
		FROM users ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]models.User, 0)
	for rows.Next() {
		var u models.User
		var lastLogin sql.NullString
		if err := rows.Scan(&u.ID, &u.Username, &u.FullName, &u.Role, &u.Permissions, &u.IsActive, &u.CreatedAt, &lastLogin); err == nil {
			if lastLogin.Valid {
				u.LastLoginAt = &lastLogin.String
			}
			u.RoleLabel = roleLabel(u.Role)
			list = append(list, u)
		}
	}
	return list, nil
}

type CreateUserInput struct {
	Username    string   `json:"username"`
	FullName    string   `json:"full_name"`
	Password    string   `json:"password"`
	Role        string   `json:"role"`
	Permissions []string `json:"permissions"`
}

func (s *AuthService) CreateUser(input CreateUserInput) (*models.User, error) {
	if input.Username == "" || input.Password == "" {
		return nil, errors.New("اسم المستخدم وكلمة المرور مطلوبة")
	}
	if input.Role == "" {
		input.Role = "ACCOUNTANT"
	}

	permsJSON, _ := json.Marshal(input.Permissions)
	if len(input.Permissions) == 0 {
		permsJSON = []byte("[]")
	}

	hash, salt := crypto.HashPassword(input.Password, "")
	id := crypto.UUID()
	now := db.NowIso()

	_, err := s.db.Exec(`
		INSERT INTO users (id, username, full_name, password_hash, password_salt, role, permissions, is_active, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
	`, id, input.Username, input.FullName, hash, salt, input.Role, string(permsJSON), now)
	if err != nil {
		return nil, fmt.Errorf("اسم المستخدم مستخدم بالفعل أو غير صالح")
	}

	return &models.User{
		ID:          id,
		Username:    input.Username,
		FullName:    input.FullName,
		Role:        input.Role,
		RoleLabel:   roleLabel(input.Role),
		Permissions: string(permsJSON),
		IsActive:    1,
		CreatedAt:   now,
	}, nil
}

type UpdateUserInput struct {
	FullName    string   `json:"full_name"`
	Password    string   `json:"password"`
	Role        string   `json:"role"`
	Permissions []string `json:"permissions"`
	IsActive    *bool    `json:"is_active"`
}

func (u *UpdateUserInput) UnmarshalJSON(data []byte) error {
	type Alias UpdateUserInput
	var aux struct {
		Alias
		IsActive any `json:"is_active"`
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*u = UpdateUserInput(aux.Alias)
	if aux.IsActive != nil {
		switch v := aux.IsActive.(type) {
		case bool:
			u.IsActive = &v
		case float64:
			b := v != 0
			u.IsActive = &b
		case string:
			clean := strings.TrimSpace(v)
			b := clean != "0" && !strings.EqualFold(clean, "false")
			u.IsActive = &b
		}
	}
	return nil
}

func (s *AuthService) UpdateUser(id string, input UpdateUserInput) (*models.User, error) {
	var current models.User
	err := s.db.QueryRow(`
		SELECT id, username, full_name, role, permissions, is_active, created_at
		FROM users WHERE id = ?
	`, id).Scan(&current.ID, &current.Username, &current.FullName, &current.Role, &current.Permissions, &current.IsActive, &current.CreatedAt)
	if err != nil {
		return nil, errors.New("المستخدم غير موجود")
	}

	if input.FullName != "" {
		current.FullName = input.FullName
	}
	if input.Role != "" {
		current.Role = input.Role
	}
	if input.IsActive != nil {
		if *input.IsActive {
			current.IsActive = 1
		} else {
			current.IsActive = 0
		}
	}
	if input.Permissions != nil {
		b, _ := json.Marshal(input.Permissions)
		current.Permissions = string(b)
	}

	if input.Password != "" {
		if len(input.Password) < 6 {
			return nil, errors.New("كلمة المرور يجب ألا تقل عن 6 أحرف")
		}
		hash, salt := crypto.HashPassword(input.Password, "")
		_, err = s.db.Exec(`
			UPDATE users SET full_name = ?, role = ?, permissions = ?, is_active = ?, password_hash = ?, password_salt = ?
			WHERE id = ?
		`, current.FullName, current.Role, current.Permissions, current.IsActive, hash, salt, id)
	} else {
		_, err = s.db.Exec(`
			UPDATE users SET full_name = ?, role = ?, permissions = ?, is_active = ?
			WHERE id = ?
		`, current.FullName, current.Role, current.Permissions, current.IsActive, id)
	}
	if err != nil {
		return nil, err
	}

	current.RoleLabel = roleLabel(current.Role)
	return &current, nil
}

func (s *AuthService) DeleteUser(id, currentUserID string) error {
	if id == currentUserID {
		return errors.New("لا يمكنك حذف حسابك الشخصي الحالي")
	}

	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND id <> ?", id).Scan(&count)
	if count == 0 {
		return errors.New("لا يمكن حذف آخر مدير نظام في البرنامج")
	}

	_, err := s.db.Exec("DELETE FROM users WHERE id = ?", id)
	return err
}

// ------------------------------------------------------------------ أدوار النظام
func (s *AuthService) GetRolesAndPermissions() (map[string]string, map[string][]string) {
	roles := map[string]string{
		"ADMIN":      "مدير النظام",
		"ACCOUNTANT": "محاسب",
		"VIEWER":     "مراقب (قراءة فقط)",
	}
	rolePerms := map[string][]string{
		"ADMIN":      {"*"},
		"ACCOUNTANT": {"invoices.view", "invoices.create", "invoices.edit", "invoices.cancel", "vouchers.view", "vouchers.create", "vouchers.cancel", "ledger.view", "clients.view", "clients.create", "clients.edit", "items.view", "items.create", "items.edit", "reports.view", "bulk.generate", "bulk.approve", "issuers.view", "export.pdf", "export.excel", "templates.write"},
		"VIEWER":     {"invoices.view", "vouchers.view", "ledger.view", "clients.view", "items.view", "reports.view", "issuers.view"},
	}

	// Read overrides from meta table
	var customRolesJSON string
	if err := s.db.QueryRow("SELECT value FROM meta WHERE key = 'custom_roles'").Scan(&customRolesJSON); err == nil && customRolesJSON != "" {
		var cr map[string]string
		if json.Unmarshal([]byte(customRolesJSON), &cr) == nil {
			for k, v := range cr {
				roles[k] = v
			}
		}
	}

	rows, err := s.db.Query("SELECT key, value FROM meta WHERE key LIKE 'role_perms_%'")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var k, v string
			if rows.Scan(&k, &v) == nil {
				roleKey := strings.TrimPrefix(k, "role_perms_")
				var perms []string
				if json.Unmarshal([]byte(v), &perms) == nil {
					rolePerms[roleKey] = perms
				}
			}
		}
	}

	return roles, rolePerms
}

func (s *AuthService) UpdateRolePermissions(roleID string, perms []string) error {
	b, err := json.Marshal(perms)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
		INSERT INTO meta (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, "role_perms_"+roleID, string(b))
	return err
}

func (s *AuthService) CreateRole(key, label string, perms []string) error {
	if key == "" || label == "" {
		return errors.New("كود الدور واسم الدور مطلوبان")
	}
	roles, _ := s.GetRolesAndPermissions()
	roles[key] = label
	b, _ := json.Marshal(roles)
	_, err := s.db.Exec(`
		INSERT INTO meta (key, value) VALUES ('custom_roles', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, string(b))
	if err != nil {
		return err
	}
	return s.UpdateRolePermissions(key, perms)
}

func (s *AuthService) DeleteRole(roleID string) error {
	if roleID == "ADMIN" || roleID == "ACCOUNTANT" || roleID == "VIEWER" {
		return errors.New("لا يمكن حذف الأدوار الافتراضية للنظام")
	}
	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM users WHERE role = ?", roleID).Scan(&count)
	if count > 0 {
		return errors.New("لا يمكن حذف الدور لوجود مستخدمين مرتبطين به")
	}

	roles, _ := s.GetRolesAndPermissions()
	delete(roles, roleID)
	b, _ := json.Marshal(roles)
	_, _ = s.db.Exec("UPDATE meta SET value = ? WHERE key = 'custom_roles'", string(b))
	_, _ = s.db.Exec("DELETE FROM meta WHERE key = ?", "role_perms_"+roleID)
	return nil
}

func (s *AuthService) ResetRole(roleID string) error {
	_, err := s.db.Exec("DELETE FROM meta WHERE key = ?", "role_perms_"+roleID)
	return err
}
