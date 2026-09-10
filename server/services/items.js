'use strict';
/** المجموعات والأصناف. */
const db = require('../db');
const V = require('../lib/validate');
const { uuid } = require('../lib/ids');
const M = require('../lib/money');

// ------------------------------------------------------------- المجموعات
function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parent_id: row.parent_id,
    parent_name: row.parent_name === undefined ? undefined : row.parent_name,
    description: row.description,
    items_count: row.items_count,
    created_at: row.created_at,
  };
}

function listCategories() {
  return db.all(
    `SELECT c.*, p.name AS parent_name,
        (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS items_count
      FROM item_categories c LEFT JOIN item_categories p ON p.id = c.parent_id
      ORDER BY c.name`,
  ).map(mapCategory);
}

function createCategory(payload, actor) {
  const code = V.str(payload.code, 'كود المجموعة', { required: true, max: 30 });
  const name = V.str(payload.name, 'اسم المجموعة', { required: true, max: 150 });
  const parentId = V.str(payload.parent_id, 'المجموعة الرئيسية', { max: 40 }) || null;
  if (db.get('SELECT id FROM item_categories WHERE code = :c', { c: code })) throw V.conflict('كود المجموعة مستخدم مسبقاً');
  if (parentId && !db.get('SELECT id FROM item_categories WHERE id = :id', { id: parentId })) throw V.bad('المجموعة الرئيسية غير موجودة');
  const id = uuid();
  db.run(
    `INSERT INTO item_categories (id, code, name, parent_id, description, created_at)
     VALUES (:id, :code, :name, :parent_id, :description, :created_at)`,
    { id, code, name, parent_id: parentId, description: V.str(payload.description, 'الوصف', { max: 500 }), created_at: db.nowIso() },
  );
  db.audit({ user: actor, action: 'CATEGORY_CREATE', entityType: 'item_category', entityId: id, details: { code, name } });
  return mapCategory(db.get('SELECT * FROM item_categories WHERE id = :id', { id }));
}

function updateCategory(id, payload, actor) {
  const current = db.get('SELECT * FROM item_categories WHERE id = :id', { id });
  if (!current) throw V.notFound('المجموعة غير موجودة');
  const code = V.str(payload.code === undefined ? current.code : payload.code, 'كود المجموعة', { required: true, max: 30 });
  const name = V.str(payload.name === undefined ? current.name : payload.name, 'اسم المجموعة', { required: true, max: 150 });
  let parentId = payload.parent_id === undefined ? current.parent_id : (V.str(payload.parent_id, 'المجموعة الرئيسية', { max: 40 }) || null);
  if (parentId === id) parentId = null;
  if (code !== current.code && db.get('SELECT id FROM item_categories WHERE code = :c AND id <> :id', { c: code, id })) {
    throw V.conflict('كود المجموعة مستخدم مسبقاً');
  }
  db.run(
    'UPDATE item_categories SET code = :code, name = :name, parent_id = :parent_id, description = :description WHERE id = :id',
    { id, code, name, parent_id: parentId, description: V.str(payload.description === undefined ? current.description : payload.description, 'الوصف', { max: 500 }) },
  );
  db.audit({ user: actor, action: 'CATEGORY_UPDATE', entityType: 'item_category', entityId: id, details: { code } });
  return mapCategory(db.get('SELECT * FROM item_categories WHERE id = :id', { id }));
}

function removeCategory(id, actor) {
  const current = db.get('SELECT * FROM item_categories WHERE id = :id', { id });
  if (!current) throw V.notFound('المجموعة غير موجودة');
  const count = db.pluck('SELECT COUNT(*) AS c FROM items WHERE category_id = :id', { id });
  if (count > 0) throw V.conflict(`لا يمكن حذف المجموعة لاحتوائها على ${count} صنف`);
  db.run('DELETE FROM item_categories WHERE id = :id', { id });
  db.audit({ user: actor, action: 'CATEGORY_DELETE', entityType: 'item_category', entityId: id, details: { code: current.code } });
  return { ok: true };
}

// ---------------------------------------------------------------- الأصناف
function mapItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    item_code: row.item_code,
    category_id: row.category_id,
    category_name: row.category_name === undefined ? undefined : row.category_name,
    name_ar: row.name_ar,
    name_en: row.name_en,
    barcode: row.barcode,
    unit: row.unit,
    cost_price: M.toMajor(row.cost_price),
    sale_price: M.toMajor(row.sale_price),
    tax_rate: row.tax_rate,
    is_active: !!row.is_active,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listItems({
  search = '', categoryId = '', activeOnly = false, status = '',
  minPrice = '', maxPrice = '', taxRate = '', limit = 0,
} = {}) {
  let activeVal = -1;
  if (activeOnly || status === 'active') activeVal = 1;
  else if (status === 'inactive') activeVal = 0;

  const minP = minPrice !== '' && minPrice !== undefined ? M.toMinor(Number(minPrice)) : -1;
  const maxP = maxPrice !== '' && maxPrice !== undefined ? M.toMinor(Number(maxPrice)) : -1;
  const tax = taxRate !== '' && taxRate !== undefined ? Number(taxRate) : -1;

  const rows = db.all(
    `SELECT i.*, c.name AS category_name
      FROM items i LEFT JOIN item_categories c ON c.id = i.category_id
      WHERE (:active = -1 OR i.is_active = :active)
        AND (:cat = '' OR i.category_id = :cat)
        AND (:min_p < 0 OR i.sale_price >= :min_p)
        AND (:max_p < 0 OR i.sale_price <= :max_p)
        AND (:tax < 0 OR i.tax_rate = :tax)
        AND (:q = '' OR i.name_ar LIKE :like OR i.name_en LIKE :like OR i.item_code LIKE :like OR i.barcode LIKE :like)
      ORDER BY i.name_ar
      LIMIT CASE WHEN :lim > 0 THEN :lim ELSE -1 END`,
    {
      active: activeVal,
      cat: categoryId || '',
      min_p: minP,
      max_p: maxP,
      tax,
      q: search,
      like: `%${search}%`,
      lim: limit || 0,
    },
  );
  return rows.map(mapItem);
}

function getItemRaw(id) {
  const row = db.get('SELECT * FROM items WHERE id = :id', { id });
  if (!row) throw V.notFound('الصنف غير موجود');
  return row;
}

function getItem(id) {
  return mapItem(db.get('SELECT i.*, c.name AS category_name FROM items i LEFT JOIN item_categories c ON c.id = i.category_id WHERE i.id = :id', { id }));
}

function nextItemCode() {
  const rows = db.all("SELECT item_code FROM items WHERE item_code LIKE 'IT-%'");
  let max = 0;
  for (const r of rows) {
    const n = Number(String(r.item_code).replace(/^IT-/, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `IT-${String(max + 1).padStart(4, '0')}`;
}

function validateItem(payload, { isNew }) {
  const out = {
    item_code: V.str(payload.item_code, 'كود الصنف', { max: 40 }) || (isNew ? nextItemCode() : ''),
    category_id: V.str(payload.category_id, 'المجموعة', { max: 40 }) || null,
    name_ar: V.str(payload.name_ar, 'اسم الصنف', { required: isNew, max: 250 }),
    name_en: V.str(payload.name_en, 'الاسم بالإنجليزية', { max: 250 }),
    barcode: V.str(payload.barcode, 'الباركود', { max: 60 }),
    unit: V.str(payload.unit, 'وحدة القياس', { max: 40 }) || 'حبة',
    cost_price: M.toMinor(V.num(payload.cost_price, 'سعر التكلفة', { min: 0, max: 1e9, def: 0 })),
    sale_price: M.toMinor(V.num(payload.sale_price, 'سعر البيع', { min: 0, max: 1e9, def: 0 })),
    tax_rate: V.num(payload.tax_rate, 'نسبة الضريبة', { min: 0, max: 100, def: 15 }),
    is_active: V.bool(payload.is_active, true) ? 1 : 0,
    notes: V.str(payload.notes, 'الملاحظات', { max: 1000 }),
  };
  if (out.category_id && !db.get('SELECT id FROM item_categories WHERE id = :id', { id: out.category_id })) {
    throw V.bad('المجموعة المحددة غير موجودة');
  }
  return out;
}

function createItem(payload, actor) {
  const data = validateItem(payload, { isNew: true });
  if (db.get('SELECT id FROM items WHERE item_code = :c', { c: data.item_code })) throw V.conflict('كود الصنف مستخدم مسبقاً');
  const id = uuid();
  const now = db.nowIso();
  db.run(
    `INSERT INTO items (id, item_code, category_id, name_ar, name_en, barcode, unit, cost_price, sale_price,
        tax_rate, is_active, notes, created_at, updated_at)
     VALUES (:id, :item_code, :category_id, :name_ar, :name_en, :barcode, :unit, :cost_price, :sale_price,
        :tax_rate, :is_active, :notes, :created_at, :updated_at)`,
    { ...data, id, created_at: now, updated_at: now },
  );
  db.audit({ user: actor, action: 'ITEM_CREATE', entityType: 'item', entityId: id, details: { code: data.item_code, name: data.name_ar } });
  return getItem(id);
}

function updateItem(id, payload, actor) {
  const current = getItemRaw(id);
  const merged = {
    ...current,
    cost_price: M.toMajor(current.cost_price),
    sale_price: M.toMajor(current.sale_price),
    ...payload,
  };
  const data = validateItem(merged, { isNew: false });
  if (!data.item_code) data.item_code = current.item_code;
  if (data.item_code !== current.item_code && db.get('SELECT id FROM items WHERE item_code = :c AND id <> :id', { c: data.item_code, id })) {
    throw V.conflict('كود الصنف مستخدم مسبقاً');
  }
  db.run(
    `UPDATE items SET item_code = :item_code, category_id = :category_id, name_ar = :name_ar, name_en = :name_en,
        barcode = :barcode, unit = :unit, cost_price = :cost_price, sale_price = :sale_price, tax_rate = :tax_rate,
        is_active = :is_active, notes = :notes, updated_at = :updated_at
      WHERE id = :id`,
    { ...data, id, updated_at: db.nowIso() },
  );
  db.audit({ user: actor, action: 'ITEM_UPDATE', entityType: 'item', entityId: id, details: { code: data.item_code } });
  return getItem(id);
}

function removeItem(id, actor) {
  const current = getItemRaw(id);
  db.run('DELETE FROM items WHERE id = :id', { id });
  db.audit({ user: actor, action: 'ITEM_DELETE', entityType: 'item', entityId: id, details: { code: current.item_code } });
  return { ok: true };
}

module.exports = {
  listCategories, createCategory, updateCategory, removeCategory,
  listItems, getItem, getItemRaw, createItem, updateItem, removeItem, mapItem, nextItemCode,
};
