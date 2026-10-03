package services

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

var ErrNoBrowser = errors.New("لم يتم العثور على متصفح Chromium أو Chrome لتحويل المستند إلى PDF")

var documentFontData string

// SetDocumentFont supplies the same bundled font used in HTML previews.
func SetDocumentFont(font []byte) {
	documentFontData = base64.StdEncoding.EncodeToString(font)
}

// FindAvailableBrowser locates Edge, Chrome, or Chromium on the host system (Windows / Linux / Mac)
func FindAvailableBrowser() string {
	candidates := []string{
		`C:\Program Files\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
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

	// Keep template margins, but make every downloaded PDF use A4 paper.
	fontInjection := `<meta charset="utf-8">`

	if strings.Contains(htmlContent, "<head>") {
		htmlContent = strings.Replace(htmlContent, "<head>", "<head>\n"+fontInjection, 1)
	} else if strings.Contains(htmlContent, "<HEAD>") {
		htmlContent = strings.Replace(htmlContent, "<HEAD>", "<HEAD>\n"+fontInjection, 1)
	} else {
		htmlContent = fontInjection + "\n" + htmlContent
	}
	orientation := "portrait"
	if regexp.MustCompile(`(?is)@page[^{}]*\{[^}]*size\s*:\s*[^;}]*\blandscape\b`).MatchString(htmlContent) {
		orientation = "landscape"
	}
	a4Style := `<style>@page { size: A4 ` + orientation + ` !important; }</style>`
	if documentFontData != "" {
		a4Style += `<style data-pdf-document-font>@font-face { font-family: 'Raseen Document'; src: url('data:font/ttf;base64,` + documentFontData + `') format('truetype'); font-weight: 100 900; } body, body * { font-family: 'Raseen Document', Tahoma, Arial, sans-serif !important; }</style>`
	}
	if headEnd := strings.LastIndex(strings.ToLower(htmlContent), "</head>"); headEnd >= 0 {
		htmlContent = htmlContent[:headEnd] + a4Style + "\n" + htmlContent[headEnd:]
	} else {
		htmlContent = a4Style + "\n" + htmlContent
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
		"--no-sandbox",
		"--disable-gpu",
		"--disable-gpu-sandbox",
		"--disable-gpu-compositing",
		"--disable-gpu-shader-disk-cache",
		"--disable-features=Vulkan,CanvasOopRasterization,UseSkiaRenderer",
		"--no-pdf-header-footer",
		"--prefer-css-page-size",
		"--disable-extensions",
		"--disable-sync",
		"--disable-background-networking",
		"--allow-file-access-from-files",
		"--disable-web-security",
		"--run-all-compositor-stages-before-draw",
		"--virtual-time-budget=4000",
		fmt.Sprintf("--print-to-pdf=%s", outPath),
		inPath,
	}
	if runtime.GOOS != "windows" {
		args = append(args, "--disable-dev-shm-usage")
	}

	cmd := exec.CommandContext(ctx, browser, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("خطأ أثناء تحويل PDF: %v (مخرجات: %s)", err, string(out))
	}

	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, fmt.Errorf("تعذر قراءة ملف PDF المنشأ: %w", err)
	}
	if len(data) < 100 {
		return nil, fmt.Errorf("ملف PDF الناتج فارغ أو غير مكتمل")
	}
	if !strings.HasPrefix(string(data[:5]), "%PDF-") {
		return nil, fmt.Errorf("الملف الناتج ليس PDF صالحاً")
	}
	return data, nil
}
