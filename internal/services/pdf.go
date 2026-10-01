package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var ErrNoBrowser = errors.New("لم يتم العثور على متصفح Chromium أو Chrome لتحويل المستند إلى PDF")

// FindAvailableBrowser locates Edge, Chrome, or Chromium on the host system (Windows / Linux / Mac)
func FindAvailableBrowser() string {
	candidates := []string{
		`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		`/usr/bin/chromium`,
		`/usr/bin/chromium-browser`,
		`/usr/bin/google-chrome-stable`,
		`/usr/bin/google-chrome`,
		`/snap/bin/chromium`,
		`/usr/local/bin/chromium`,
		`/usr/local/bin/chrome`,
		`/usr/bin/chrome`,
	}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		candidates = append(candidates,
			filepath.Join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
		)
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	names := []string{"chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "chrome", "msedge"}
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}

// RenderHTMLToPDF converts an HTML document string to a PDF byte slice using a headless browser.
func RenderHTMLToPDF(htmlContent string) ([]byte, error) {
	browser := FindAvailableBrowser()
	if browser == "" {
		return nil, ErrNoBrowser
	}

	tmpDir := os.TempDir()
	inPath := filepath.Join(tmpDir, fmt.Sprintf("raseen_%d.html", time.Now().UnixNano()))
	outPath := filepath.Join(tmpDir, fmt.Sprintf("raseen_%d.pdf", time.Now().UnixNano()))

	// التأكد من وجود ترميز utf-8 وحقن الخط العربي Cairo والخطوط البديلة لضمان عدم ظهور المربعات في بيئة الخادم (Linux/Docker)
	fontInjection := `<meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap">
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap');
html, body {
  font-family: 'Cairo', 'Noto Sans Arabic', 'Amiri', 'KacstOne', 'DejaVu Sans', 'Segoe UI', Tahoma, Arial, sans-serif;
}
.mono, .monospace, pre, code {
  font-family: 'Courier New', Courier, monospace !important;
}
</style>`

	if strings.Contains(htmlContent, "<head>") {
		htmlContent = strings.Replace(htmlContent, "<head>", "<head>\n"+fontInjection, 1)
	} else if strings.Contains(htmlContent, "<HEAD>") {
		htmlContent = strings.Replace(htmlContent, "<HEAD>", "<HEAD>\n"+fontInjection, 1)
	} else {
		htmlContent = fontInjection + "\n" + htmlContent
	}

	if err := os.WriteFile(inPath, []byte(htmlContent), 0644); err != nil {
		return nil, fmt.Errorf("تعذر إنشاء ملف مؤقت للطباعة: %w", err)
	}
	defer os.Remove(inPath)
	defer os.Remove(outPath)

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	args := []string{
		"--headless=new",
		"--disable-gpu",
		"--no-pdf-header-footer",
		"--prefer-css-page-size",
		"--disable-extensions",
		"--disable-sync",
		"--allow-file-access-from-files",
		"--disable-web-security",
		"--run-all-compositor-stages-before-draw",
		"--virtual-time-budget=1500",
		fmt.Sprintf("--print-to-pdf=%s", outPath),
		inPath,
	}
	if runtime.GOOS != "windows" {
		args = append(args, "--no-sandbox", "--disable-dev-shm-usage")
	}

	cmd := exec.CommandContext(ctx, browser, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("خطأ أثناء تحويل PDF: %v (مخرجات: %s)", err, string(out))
	}

	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, fmt.Errorf("تعذر قراءة ملف PDF المنشأ: %w", err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("ملف PDF الناتج فارغ")
	}
	return data, nil
}
