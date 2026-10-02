package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"raseen/internal/api"
	"raseen/internal/config"
	"raseen/internal/crypto"
	"raseen/internal/db"
)

//go:embed all:public
var embeddedPublic embed.FS

func isCloudOrServerEnv() bool {
	if os.Getenv("NO_BROWSER") != "" {
		return true
	}
	// Cloud hosting and container environments (Railway, Render, Heroku, Docker, etc.)
	if os.Getenv("PORT") != "" ||
		os.Getenv("RAILWAY_ENVIRONMENT") != "" ||
		os.Getenv("RAILWAY_SERVICE_ID") != "" ||
		os.Getenv("DYNO") != "" ||
		os.Getenv("RENDER") != "" ||
		os.Getenv("FLY_APP_NAME") != "" ||
		os.Getenv("APP_ENV") == "production" ||
		os.Getenv("ENVIRONMENT") == "production" {
		return true
	}
	// Headless Linux servers (no desktop GUI)
	if runtime.GOOS == "linux" && os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		return true
	}
	return false
}

func openBrowser(url string) {
	if isCloudOrServerEnv() {
		return
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		if _, err := exec.LookPath("xdg-open"); err != nil {
			return
		}
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func main() {
	log.SetOutput(os.Stdout)
	cfg := config.Load()
	if err := cfg.ValidatePublicAdminPassword(); err != nil {
		log.Printf("[تنبيه أمني] %v (يوصى بتعيين ZS_ADMIN_PASS في لوحة التحكم لحماية الخادم)", err)
	}

	masterKey, err := crypto.GetMasterKey(cfg.KeyFile)
	if err != nil {
		log.Fatalf("فشل تحميل مفتاح التشفير الرئيسي: %v", err)
	}

	ensureDataInitialized(cfg.DataDir)

	database, err := db.Open(cfg)
	if err != nil {
		log.Fatalf("فشل تهيئة قاعدة البيانات: %v", err)
	}
	defer func() { _ = database.Close() }()
	if cfg.IsPublicHost() {
		rows, err := database.Query("SELECT password_hash, password_salt FROM users WHERE role = 'ADMIN' AND is_active = 1")
		if err != nil {
			log.Printf("[تنبيه أمني] فشل التحقق من حسابات المدير: %v", err)
		} else {
			for rows.Next() {
				var hash, salt string
				if err := rows.Scan(&hash, &salt); err != nil {
					log.Printf("[تنبيه أمني] فشل قراءة حساب المدير: %v", err)
					break
				}
				if crypto.VerifyPassword("Admin@12345", salt, hash) {
					log.Println("[تنبيه أمني] تحذير: كلمة مرور حساب المدير هي الكلمة الافتراضية؛ يرجى تغييرها عبر الإعدادات لحماية الخادم العام")
				}
			}
			_ = rows.Close()
		}
	}

	// النسخ الاحتياطي التلقائي الدوري لحماية بيانات الفواتير والعملاء من أي فقدان
	go func() {
		time.Sleep(3 * time.Second)
		if res, err := database.CreateBackup(); err == nil {
			log.Printf("[AutoBackup] تم أخذ نسخة احتياطية أولية تلقائية: %s (%d بايت)", res.Filename, res.SizeBytes)
		}
		ticker := time.NewTicker(2 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if res, err := database.CreateBackup(); err == nil {
				log.Printf("[AutoBackup] تم أخذ نسخة احتياطية دورية تلقائية: %s (%d بايت)", res.Filename, res.SizeBytes)
			}
		}
	}()

	// Prepare public static filesystem (prefer local public folder in dev)
	var publicFS fs.FS
	if fi, err := os.Stat("public"); err == nil && fi.IsDir() {
		publicFS = os.DirFS("public")
	} else {
		var subErr error
		publicFS, subErr = fs.Sub(embeddedPublic, "public")
		if subErr != nil {
			log.Fatalf("فشل تجهيز ملفات الواجهة: %v", subErr)
		}
	}

	server := api.NewServer(cfg, database, masterKey, publicFS)
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	fmt.Println()
	fmt.Println("==================================================================")
	fmt.Println("   Raseen (رسين) — محرك الفواتير والمحاسبة الإلكترونية (ZATCA)")
	fmt.Println("   تم البناء بلغة Go (Golang) — صفر اعتماديات تشغيل خارجية")
	fmt.Println("==================================================================")
	fmt.Printf("   الرابط المحلي:   http://%s\n", addr)
	fmt.Printf("   اسم المستخدم الأولي: %s\n", cfg.BootstrapAdmin.Username)
	fmt.Println("==================================================================")
	fmt.Println("   اضغط Ctrl+C لإيقاف الخادم.")
	fmt.Println()

	// Open browser automatically after 500ms on desktop only
	if !isCloudOrServerEnv() {
		go func() {
			time.Sleep(500 * time.Millisecond)
			target := fmt.Sprintf("http://127.0.0.1:%d", cfg.Port)
			openBrowser(target)
		}()
	}

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 20 * time.Second,
		ReadTimeout:       15 * time.Minute,
		WriteTimeout:      15 * time.Minute,
		IdleTimeout:       300 * time.Second,
	}

	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("خطأ في تشغيل الخادم: %v", err)
	}
}

// ensureDataInitialized copies bundled templates and assets into a fresh data directory.
// The database is created by db.Open so a local database is never shipped as a seed.
func ensureDataInitialized(dataDir string) {
	_ = os.MkdirAll(dataDir, 0755)
	defaultsDir := "data_defaults"
	if fi, err := os.Stat(filepath.Join(defaultsDir, "templates")); err != nil || !fi.IsDir() {
		defaultsDir = "data"
		if fi, err := os.Stat(filepath.Join(defaultsDir, "templates")); err != nil || !fi.IsDir() {
			return
		}
	}

	// Templates: copy any missing templates from defaults.
	for _, sub := range []string{"invoices", "documents", "reports", "statements", "partials"} {
		targetSub := filepath.Join(dataDir, "templates", sub)
		_ = os.MkdirAll(targetSub, 0755)
		srcSub := filepath.Join(defaultsDir, "templates", sub)
		if entries, err := os.ReadDir(srcSub); err == nil {
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				destPath := filepath.Join(targetSub, e.Name())
				if _, errStat := os.Stat(destPath); os.IsNotExist(errStat) {
					if content, errRead := os.ReadFile(filepath.Join(srcSub, e.Name())); errRead == nil {
						_ = os.WriteFile(destPath, content, 0644)
					}
				}
			}
		}
	}

	// Assets: copy svg or other assets if missing.
	for _, f := range []string{"saudi_riyal_symbol.svg"} {
		dest := filepath.Join(dataDir, f)
		if _, err := os.Stat(dest); os.IsNotExist(err) {
			if content, errRead := os.ReadFile(filepath.Join(defaultsDir, f)); errRead == nil {
				_ = os.WriteFile(dest, content, 0644)
			}
		}
	}
}
