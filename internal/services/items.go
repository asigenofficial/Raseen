package services

import (
	"database/sql"
	"errors"
	"fmt"

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

	var list []models.ItemCategory
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

	var list []ItemListItem
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
