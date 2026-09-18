package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
)

type AuthService struct {
	db *db.DB
}

func NewAuthService(d *db.DB) *AuthService {
	return &AuthService{db: d}
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
	expiresAt := time.Now().UTC().Add(12 * time.Hour).Format(time.RFC3339)

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
	if err == nil && time.Now().UTC().After(exp) {
		_, _ = s.db.Exec("DELETE FROM sessions WHERE token = ?", token)
		return nil, errors.New("session expired")
	}

	if lastLogin.Valid {
		user.LastLoginAt = &lastLogin.String
	}

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

func (s *AuthService) ListUsers() ([]models.User, error) {
	rows, err := s.db.Query(`
		SELECT id, username, full_name, role, permissions, is_active, created_at, last_login_at
		FROM users ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.User
	for rows.Next() {
		var u models.User
		var lastLogin sql.NullString
		if err := rows.Scan(&u.ID, &u.Username, &u.FullName, &u.Role, &u.Permissions, &u.IsActive, &u.CreatedAt, &lastLogin); err == nil {
			if lastLogin.Valid {
				u.LastLoginAt = &lastLogin.String
			}
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
		Permissions: string(permsJSON),
		IsActive:    1,
		CreatedAt:   now,
	}, nil
}
