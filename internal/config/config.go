package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
)

const defaultAdminPassword = "Admin@12345"

func (c *Config) IsPublicHost() bool {
	if c.Host == "localhost" || c.Host == "127.0.0.1" || c.Host == "::1" {
		return false
	}
	if ip := net.ParseIP(c.Host); ip != nil && ip.IsLoopback() {
		return false
	}
	return true
}

// ValidatePublicAdminPassword refuses a publicly bound server with a known
// bootstrap credential.
func (c *Config) ValidatePublicAdminPassword() error {
	if c.IsPublicHost() && c.BootstrapAdmin.Password == defaultAdminPassword {
		return fmt.Errorf("public server requires ZS_ADMIN_PASS to differ from the default password")
	}
	return nil
}

type Config struct {
	Root            string
	PublicDir       string
	DataDir         string
	DbFile          string
	KeyFile         string
	BackupDir       string
	Host            string
	Port            int
	SessionTtlHours int
	MaxBodyBytes    int64
	Defaults        Defaults
	BootstrapAdmin  AdminCredentials
}

type Defaults struct {
	Currency string
	TaxRate  float64
	Country  string
}

type AdminCredentials struct {
	Username string
	Password string
	FullName string
}

func Load() *Config {
	pwd, err := os.Getwd()
	if err != nil {
		pwd = "."
	}

	dataDir := os.Getenv("ZS_DATA_DIR")
	if dataDir == "" {
		dataDir = os.Getenv("DATA_DIR")
	}
	if dataDir == "" {
		dataDir = filepath.Join(pwd, "data")
	}

	dbFile := os.Getenv("ZS_DB_FILE")
	if dbFile == "" {
		dbFile = filepath.Join(dataDir, "zsystem.db")
	}

	host := os.Getenv("ZS_HOST")
	if host == "" {
		if os.Getenv("PORT") != "" ||
			os.Getenv("NODE_ENV") == "production" ||
			os.Getenv("APP_ENV") == "production" {
			host = "0.0.0.0"
		} else {
			host = "127.0.0.1"
		}
	}

	port := 4711
	if pStr := os.Getenv("PORT"); pStr != "" {
		if p, err := strconv.Atoi(pStr); err == nil {
			port = p
		}
	} else if pStr := os.Getenv("ZS_PORT"); pStr != "" {
		if p, err := strconv.Atoi(pStr); err == nil {
			port = p
		}
	}

	sessionHours := 12
	if sStr := os.Getenv("ZS_SESSION_TTL"); sStr != "" {
		if s, err := strconv.Atoi(sStr); err == nil {
			sessionHours = s
		}
	}

	maxBody := int64(512 * 1024 * 1024) // 512MB default
	if mStr := os.Getenv("ZS_MAX_BODY"); mStr != "" {
		if m, err := strconv.ParseInt(mStr, 10, 64); err == nil {
			maxBody = m
		}
	}

	adminUser := os.Getenv("ZS_ADMIN_USER")
	if adminUser == "" {
		adminUser = "admin"
	}
	adminPass := os.Getenv("ZS_ADMIN_PASS")
	if adminPass == "" {
		adminPass = defaultAdminPassword
	}

	return &Config{
		Root:            pwd,
		PublicDir:       filepath.Join(pwd, "public"),
		DataDir:         dataDir,
		DbFile:          dbFile,
		KeyFile:         filepath.Join(dataDir, "secret.key"),
		BackupDir:       filepath.Join(dataDir, "backups"),
		Host:            host,
		Port:            port,
		SessionTtlHours: sessionHours,
		MaxBodyBytes:    maxBody,
		Defaults: Defaults{
			Currency: "SAR",
			TaxRate:  15.0,
			Country:  "SA",
		},
		BootstrapAdmin: AdminCredentials{
			Username: adminUser,
			Password: adminPass,
			FullName: "مدير النظام",
		},
	}
}
