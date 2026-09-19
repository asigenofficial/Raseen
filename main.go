package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"

	"raseen/internal/api"
	"raseen/internal/config"
	"raseen/internal/crypto"
	"raseen/internal/db"
)

//go:embed all:public
var embeddedPublic embed.FS

func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = exec.Command("xdg-open", url).Start()
	}
	if err != nil {
		log.Printf("تعذر فتح المتصفح تلقائياً: %v", err)
	}
}

func main() {
	cfg := config.Load()

	masterKey, err := crypto.GetMasterKey(cfg.KeyFile)
	if err != nil {
		log.Fatalf("فشل تحميل مفتاح التشفير الرئيسي: %v", err)
	}

	database, err := db.Open(cfg)
	if err != nil {
		log.Fatalf("فشل تهيئة قاعدة البيانات: %v", err)
	}
	defer database.Close()

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

	// Open browser automatically after 500ms
	if os.Getenv("NO_BROWSER") == "" {
		go func() {
			time.Sleep(500 * time.Millisecond)
			target := fmt.Sprintf("http://127.0.0.1:%d", cfg.Port)
			openBrowser(target)
		}()
	}

	httpServer := &http.Server{
		Addr:         addr,
		Handler:      server.Handler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("خطأ في تشغيل الخادم: %v", err)
	}
}
