package services

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"raseen/internal/config"
	"raseen/internal/db"
)

func TestBulkGenerationVaried(t *testing.T) {
	dataDir, err := filepath.Abs(filepath.Join("..", "..", "data"))
	if err != nil {
		t.Fatalf("failed to get data dir: %v", err)
	}
	dbFile := filepath.Join(dataDir, "zsystem.db")
	if _, err := os.Stat(dbFile); os.IsNotExist(err) {
		t.Skip("skipping test; zsystem.db not found")
	}
	cfg := &config.Config{
		DataDir: dataDir,
		DbFile:  dbFile,
	}
	database, err := db.Open(cfg)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	itemsSvc := NewItemService(database)
	cats, err := itemsSvc.ListCategories()
	if err != nil {
		t.Fatalf("failed to list categories: %v", err)
	}
	fmt.Printf("--- FOUND %d CATEGORIES ---\n", len(cats))
	for _, c := range cats {
		fmt.Printf("Category: ID=%s Code=%s Name=%s ItemsCount=%d\n", c.ID, c.Code, c.Name, c.ItemsCount)
	}

	issSvc := NewIssuerService(database)
	issuers, _ := issSvc.ListIssuers(false)
	if len(issuers) == 0 {
		t.Fatalf("no issuers found")
	}
	cliSvc := NewClientService(database)
	clients, _ := cliSvc.ListClients(ListClientsFilter{All: true})
	if len(clients.Items) == 0 {
		t.Fatalf("no clients found")
	}

	bulkSvc := NewBulkService(database, nil, nil, issSvc, cliSvc, itemsSvc)

	req := PreviewRequest{
		IssuerID:         issuers[0].ID,
		ClientID:         clients.Items[0].ID,
		Count:            10,
		TargetTotal:      150000,
		MinItems:         10,
		MaxItems:         25,
		DistributionMode: "random",
		DateFrom:         "2026-01-01",
		DateTo:           "2026-11-04",
		PriceJitter:      3,
	}

	res, err := bulkSvc.GeneratePreview(req)
	if err != nil {
		t.Fatalf("GeneratePreview failed: %v", err)
	}

	invoicesRaw, ok := res["invoices"].([]map[string]any)
	if !ok {
		t.Fatalf("invoices is not []map[string]any")
	}

	fmt.Printf("\n--- GENERATED %d INVOICES ---\n", len(invoicesRaw))
	var grandTotal float64
	lineCounts := make([]int, len(invoicesRaw))
	for i, inv := range invoicesRaw {
		lines := inv["lines"].([]map[string]any)
		tot := inv["grand_total"].(float64)
		grandTotal += tot
		lineCounts[i] = len(lines)
		fmt.Printf("Invoice #%d (%s): Lines=%d, Total=%.2f SAR\n", i+1, inv["invoice_number"], len(lines), tot)
	}
	fmt.Printf("Total Batch Sum: %.2f SAR (Target: %.2f SAR)\n", grandTotal, req.TargetTotal)

	// Check that line counts are varied and not all the same
	allSame := true
	for i := 1; i < len(lineCounts); i++ {
		if lineCounts[i] != lineCounts[0] {
			allSame = false
			break
		}
	}
	if allSame {
		t.Errorf("FAIL: All invoices have identical line count: %d", lineCounts[0])
	} else {
		fmt.Printf("SUCCESS: Line counts are varied: %v\n", lineCounts)
	}
}
