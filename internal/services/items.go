package services

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"raseen/internal/crypto"
	"raseen/internal/db"
	"raseen/internal/models"
)

type ItemService struct {
	db *db.DB
}

func NewItemService(d *db.DB) *ItemService {
	return &ItemService{db: d}
}

func (s *ItemService) ListCategories() ([]models.ItemCategory, error) {
	rows, err := s.db.Query(`
		SELECT id, code, name, parent_id, description, created_at
		FROM item_categories ORDER BY name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]models.ItemCategory, 0)
	for rows.Next() {
		var cat models.ItemCategory
		var parent sql.NullString
		if err := rows.Scan(&cat.ID, &cat.Code, &cat.Name, &parent, &cat.Description, &cat.CreatedAt); err == nil {
			if parent.Valid {
				cat.ParentID = &parent.String
			}
			list = append(list, cat)
		}
	}
	return list, nil
}

func (s *ItemService) CreateCategory(c *models.ItemCategory) error {
	if c.Name == "" {
		return errors.New("اسم المجموعة مطلوب")
	}
	if c.ID == "" {
		c.ID = crypto.UUID()
	}
	if c.Code == "" {
		var count int
		_ = s.db.QueryRow("SELECT COUNT(*) + 1 FROM item_categories").Scan(&count)
		c.Code = fmt.Sprintf("CAT-%03d", count)
	}
	c.CreatedAt = db.NowIso()

	_, err := s.db.Exec(`
		INSERT INTO item_categories (id, code, name, parent_id, description, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, c.ID, c.Code, c.Name, c.ParentID, c.Description, c.CreatedAt)
	return err
}

type ItemListItem struct {
	models.Item
	CostPriceMajor float64 `json:"cost_price"`
	SalePriceMajor float64 `json:"sale_price"`
	CategoryName   string  `json:"category_name"`
}

func (s *ItemService) ListItems(search, categoryID string, activeOnly bool) ([]ItemListItem, error) {
	query := `
		SELECT i.id, i.item_code, i.category_id, i.name_ar, i.name_en, i.barcode,
		       i.unit, i.cost_price, i.sale_price, i.tax_rate, i.is_active,
		       i.notes, i.created_at, i.updated_at, COALESCE(c.name, '—') AS category_name
		FROM items i
		LEFT JOIN item_categories c ON c.id = i.category_id
		WHERE (? = 0 OR i.is_active = 1)
		  AND (? = '' OR i.category_id = ?)
		  AND (? = '' OR i.name_ar LIKE ? OR i.name_en LIKE ? OR i.item_code LIKE ? OR i.barcode LIKE ?)
		ORDER BY i.name_ar ASC
	`
	activeParam := 0
	if activeOnly {
		activeParam = 1
	}
	like := "%" + search + "%"

	rows, err := s.db.Query(query, activeParam, categoryID, categoryID, search, like, like, like, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]ItemListItem, 0)
	for rows.Next() {
		var item ItemListItem
		var catID sql.NullString
		if err := rows.Scan(
			&item.ID, &item.ItemCode, &catID, &item.NameAr, &item.NameEn, &item.Barcode,
			&item.Unit, &item.CostPrice, &item.SalePrice, &item.TaxRate, &item.IsActive,
			&item.Notes, &item.CreatedAt, &item.UpdatedAt, &item.CategoryName,
		); err == nil {
			if catID.Valid {
				item.CategoryID = &catID.String
			}
			item.CostPriceMajor = models.ToMajor(item.CostPrice)
			item.SalePriceMajor = models.ToMajor(item.SalePrice)
			list = append(list, item)
		}
	}
	return list, nil
}

func (s *ItemService) GetItem(id string) (*ItemListItem, error) {
	var item ItemListItem
	var catID sql.NullString

	err := s.db.QueryRow(`
		SELECT i.id, i.item_code, i.category_id, i.name_ar, i.name_en, i.barcode,
		       i.unit, i.cost_price, i.sale_price, i.tax_rate, i.is_active,
		       i.notes, i.created_at, i.updated_at, COALESCE(c.name, '—')
		FROM items i
		LEFT JOIN item_categories c ON c.id = i.category_id
		WHERE i.id = ?
	`, id).Scan(
		&item.ID, &item.ItemCode, &catID, &item.NameAr, &item.NameEn, &item.Barcode,
		&item.Unit, &item.CostPrice, &item.SalePrice, &item.TaxRate, &item.IsActive,
		&item.Notes, &item.CreatedAt, &item.UpdatedAt, &item.CategoryName,
	)
	if err != nil {
		return nil, err
	}
	if catID.Valid {
		item.CategoryID = &catID.String
	}
	item.CostPriceMajor = models.ToMajor(item.CostPrice)
	item.SalePriceMajor = models.ToMajor(item.SalePrice)
	return &item, nil
}

func (s *ItemService) nextItemCode() string {
	var maxNum int
	rows, err := s.db.Query("SELECT item_code FROM items WHERE item_code LIKE 'ITM-%'")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var code string
			if err := rows.Scan(&code); err == nil {
				var n int
				if _, err := fmt.Sscanf(code, "ITM-%d", &n); err == nil && n > maxNum {
					maxNum = n
				}
			}
		}
	}
	return fmt.Sprintf("ITM-%04d", maxNum+1)
}

func (s *ItemService) CreateItem(item *models.Item) error {
	if item.NameAr == "" {
		return errors.New("اسم الصنف بالعربية مطلوب")
	}
	if item.ID == "" {
		item.ID = crypto.UUID()
	}
	if item.ItemCode == "" {
		item.ItemCode = s.nextItemCode()
	}
	if item.Unit == "" {
		item.Unit = "حبة"
	}
	if item.TaxRate <= 0 {
		item.TaxRate = 15.0
	}

	now := db.NowIso()
	item.CreatedAt = now
	item.UpdatedAt = now
	item.IsActive = 1

	_, err := s.db.Exec(`
		INSERT INTO items (
			id, item_code, category_id, name_ar, name_en, barcode,
			unit, cost_price, sale_price, tax_rate, is_active, notes,
			created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?,
			?, ?
		)
	`,
		item.ID, item.ItemCode, item.CategoryID, item.NameAr, item.NameEn, item.Barcode,
		item.Unit, item.CostPrice, item.SalePrice, item.TaxRate, item.IsActive, item.Notes,
		item.CreatedAt, item.UpdatedAt,
	)
	return err
}

func (s *ItemService) UpdateItem(id string, item *models.Item) error {
	now := db.NowIso()
	item.UpdatedAt = now

	_, err := s.db.Exec(`
		UPDATE items SET
			category_id = ?, name_ar = ?, name_en = ?, barcode = ?,
			unit = ?, cost_price = ?, sale_price = ?, tax_rate = ?,
			is_active = ?, notes = ?, updated_at = ?
		WHERE id = ?
	`,
		item.CategoryID, item.NameAr, item.NameEn, item.Barcode,
		item.Unit, item.CostPrice, item.SalePrice, item.TaxRate,
		item.IsActive, item.Notes, now, id,
	)
	return err
}

func (s *ItemService) DeleteItem(id string) error {
	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM invoice_items WHERE item_id = ?", id).Scan(&count)
	if count > 0 {
		return errors.New("لا يمكن حذف الصنف لوجود حركات مبيعات وفواتير مسجلة به")
	}
	_, err := s.db.Exec("DELETE FROM items WHERE id = ?", id)
	return err
}

type ImportItemInput struct {
	ItemCode  string  `json:"item_code"`
	NameAr    string  `json:"name_ar"`
	NameEn    string  `json:"name_en"`
	Category  string  `json:"category"`
	Barcode   string  `json:"barcode"`
	Unit      string  `json:"unit"`
	CostPrice float64 `json:"cost_price"`
	SalePrice float64 `json:"sale_price"`
	TaxRate   float64 `json:"tax_rate"`
	Notes     string  `json:"notes"`
}

type ImportItemsResult struct {
	Total     int `json:"total"`
	Created   int `json:"created"`
	Updated   int `json:"updated"`
	Errors    int `json:"errors"`
}

func (s *ItemService) BatchImportItems(items []ImportItemInput) (*ImportItemsResult, error) {
	if len(items) == 0 {
		return &ImportItemsResult{}, nil
	}

	// Cache or create categories
	cats, err := s.ListCategories()
	if err != nil {
		return nil, err
	}
	catMap := make(map[string]string) // name -> id
	for _, c := range cats {
		catMap[strings.ToLower(strings.TrimSpace(c.Name))] = c.ID
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	stmtFindByName, err := tx.Prepare("SELECT id FROM items WHERE LOWER(TRIM(name_ar)) = LOWER(TRIM(?)) LIMIT 1")
	if err != nil {
		return nil, err
	}
	defer stmtFindByName.Close()

	stmtFindByCode, err := tx.Prepare("SELECT id FROM items WHERE item_code = ? AND item_code != '' LIMIT 1")
	if err != nil {
		return nil, err
	}
	defer stmtFindByCode.Close()

	stmtInsertCat, err := tx.Prepare("INSERT INTO item_categories (id, code, name, description, created_at) VALUES (?, ?, ?, '', ?)")
	if err != nil {
		return nil, err
	}
	defer stmtInsertCat.Close()

	stmtInsertItem, err := tx.Prepare(`
		INSERT INTO items (
			id, item_code, category_id, name_ar, name_en, barcode,
			unit, cost_price, sale_price, tax_rate, is_active, notes,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
	`)
	if err != nil {
		return nil, err
	}
	defer stmtInsertItem.Close()

	stmtUpdateItem, err := tx.Prepare(`
		UPDATE items SET
			item_code = CASE WHEN ? != '' THEN ? ELSE item_code END,
			category_id = COALESCE(?, category_id),
			name_en = CASE WHEN ? != '' THEN ? ELSE name_en END,
			barcode = CASE WHEN ? != '' THEN ? ELSE barcode END,
			unit = CASE WHEN ? != '' THEN ? ELSE unit END,
			cost_price = ?,
			sale_price = ?,
			tax_rate = ?,
			notes = CASE WHEN ? != '' THEN ? ELSE notes END,
			updated_at = ?
		WHERE id = ?
	`)
	if err != nil {
		return nil, err
	}
	defer stmtUpdateItem.Close()

	now := db.NowIso()
	res := &ImportItemsResult{Total: len(items)}

	for _, itm := range items {
		nameAr := strings.TrimSpace(itm.NameAr)
		if nameAr == "" {
			res.Errors++
			continue
		}

		var catID *string
		if itm.Category != "" {
			catKey := strings.ToLower(strings.TrimSpace(itm.Category))
			if cid, exists := catMap[catKey]; exists {
				catID = &cid
			} else {
				newCid := crypto.UUID()
				newCode := fmt.Sprintf("CAT-%03d", len(catMap)+1)
				if _, err := stmtInsertCat.Exec(newCid, newCode, itm.Category, now); err == nil {
					catMap[catKey] = newCid
					catID = &newCid
				}
			}
		}

		// Check if exists by code or by Arabic name
		var existingID string
		if itm.ItemCode != "" {
			_ = stmtFindByCode.QueryRow(itm.ItemCode).Scan(&existingID)
		}
		if existingID == "" {
			_ = stmtFindByName.QueryRow(nameAr).Scan(&existingID)
		}

		unit := itm.Unit
		if unit == "" {
			unit = "حبة"
		}
		taxRate := itm.TaxRate
		if !validAmount(taxRate) || taxRate > 100 || !validAmount(itm.CostPrice) || !validAmount(itm.SalePrice) { return nil,errors.New("سعر أو ضريبة الصنف غير صالح") }
		costMinor := models.ToMinor(itm.CostPrice)
		saleMinor := models.ToMinor(itm.SalePrice)

		if existingID != "" {
			// Update
			_, err := stmtUpdateItem.Exec(
				itm.ItemCode, itm.ItemCode,
				catID,
				itm.NameEn, itm.NameEn,
				itm.Barcode, itm.Barcode,
				unit, unit,
				costMinor, saleMinor, taxRate,
				itm.Notes, itm.Notes,
				now, existingID,
			)
			if err != nil {
				res.Errors++
			} else {
				res.Updated++
			}
		} else {
			// Insert
			itemCode := itm.ItemCode
			if itemCode == "" {
				itemCode = "ITM-" + crypto.UUID()
			}
			newID := crypto.UUID()
			_, err := stmtInsertItem.Exec(
				newID, itemCode, catID, nameAr, itm.NameEn, itm.Barcode,
				unit, costMinor, saleMinor, taxRate, itm.Notes,
				now, now,
			)
			if err != nil {
				res.Errors++
			} else {
				res.Created++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return res, nil
}
