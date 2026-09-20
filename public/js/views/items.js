// ==========================================================================
//  الأصناف والمجموعات
// ==========================================================================
import { api, qs } from '../core/api.js';
import {
  store, loadItems, loadCategories, invalidate, can,
  getFilterState, setFilterState, clearFilterState,
} from '../core/store.js';
import {
  html, raw, esc, money, amount, sarSvg, num, modal, formValues, toastOk, toastErr, confirmDialog,
  $, delegate, debounce, exportCsv, exportExcel, icon,
} from '../core/util.js';

const UNITS = ['حبة', 'كرتون', 'كيس', 'علبة', 'كيلو', 'جرام', 'لتر', 'متر', 'متر مربع', 'لفة', 'ساعة', 'خدمة', 'يوم', 'شهر', 'طقم'];

function itemForm(data = {}, categories = []) {
  const v = (k, def = '') => (data[k] === undefined || data[k] === null ? def : data[k]);
  return html`
    <div class="row">
      <div class="field" style="max-width:170px"><label>كود الصنف</label>
        <input type="text" name="item_code" value="${v('item_code')}" class="ltr" placeholder="تلقائي" /></div>
      <div class="field"><label class="req">اسم الصنف</label>
        <input type="text" name="name_ar" value="${v('name_ar')}" /></div>
    </div>
    <div class="row mt">
      <div class="field"><label>الاسم بالإنجليزية</label><input type="text" name="name_en" value="${v('name_en')}" class="ltr" /></div>
      <div class="field"><label>المجموعة</label>
        <select name="category_id">
          <option value="">— بدون مجموعة —</option>
          ${raw(categories.map((c) => `<option value="${esc(c.id)}" ${c.id === v('category_id') ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}
        </select></div>
    </div>
    <div class="row mt">
      <div class="field"><label>الباركود</label><input type="text" name="barcode" value="${v('barcode')}" class="ltr" /></div>
      <div class="field" style="max-width:160px"><label>وحدة القياس</label>
        <input type="text" name="unit" value="${v('unit', 'حبة')}" list="units-list" />
        <datalist id="units-list">${raw(UNITS.map((u) => `<option value="${esc(u)}"></option>`).join(''))}</datalist></div>
    </div>
    <div class="row mt">
      <div class="field"><label>سعر التكلفة</label><input type="number" name="cost_price" value="${v('cost_price', 0)}" step="0.01" min="0" /></div>
      <div class="field"><label class="req">سعر البيع</label><input type="number" name="sale_price" value="${v('sale_price', 0)}" step="0.01" min="0" /></div>
      <div class="field" style="max-width:140px"><label>الضريبة %</label><input type="number" name="tax_rate" value="${v('tax_rate', 15)}" step="0.01" min="0" max="100" /></div>
    </div>
    <div class="field mt"><label>ملاحظات</label><textarea name="notes" style="min-height:52px">${v('notes')}</textarea></div>
    <label class="check mt"><input type="checkbox" name="is_active" ${raw(v('is_active', true) ? 'checked' : '')} /> صنف نشط</label>`;
}

function openItemModal(item, categories, onSaved) {
  const isNew = !item;
  const m = modal({
    title: isNew ? 'إضافة صنف' : `تعديل: ${item.name_ar}`,
    body: itemForm(item || {}, categories),
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn btn-primary" data-save type="button">${isNew ? 'إضافة' : 'حفظ'}</button>`,
  });
  m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
    const values = formValues(m.body);
    if (!values.name_ar) return toastErr('اسم الصنف مطلوب');
    if (!values.category_id) values.category_id = null;
    e.target.disabled = true;
    try {
      if (isNew) await api.post('/api/items', values);
      else await api.put(`/api/items/${item.id}`, values);
      toastOk('تم الحفظ');
      m.close();
      invalidate('items');
      await loadItems(true);
      onSaved();
    } catch { e.target.disabled = false; }
    return undefined;
  });
}

function openCategoryModal(category, categories, onSaved) {
  const isNew = !category;
  const v = (k, def = '') => (category && category[k] !== null && category[k] !== undefined ? category[k] : def);
  const m = modal({
    title: isNew ? 'إضافة مجموعة' : `تعديل: ${category.name}`,
    slim: true,
    body: html`
      <div class="field"><label>كود المجموعة</label><input type="text" name="code" value="${v('code')}" class="ltr" placeholder="تلقائي" /></div>
      <div class="field mt"><label class="req">اسم المجموعة</label><input type="text" name="name" value="${v('name')}" /></div>
      <div class="field mt"><label>المجموعة الأم</label>
        <select name="parent_id">
          <option value="">— رئيسية —</option>
          ${raw(categories.filter((c) => !category || c.id !== category.id)
    .map((c) => `<option value="${esc(c.id)}" ${c.id === v('parent_id') ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}
        </select></div>
      <div class="field mt"><label>الوصف</label><textarea name="description" style="min-height:52px">${v('description')}</textarea></div>`,
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn btn-primary" data-save type="button">حفظ</button>`,
  });
  m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
    const values = formValues(m.body);
    if (!values.name) return toastErr('اسم المجموعة مطلوب');
    if (!values.parent_id) values.parent_id = null;
    e.target.disabled = true;
    try {
      if (isNew) await api.post('/api/categories', values);
      else await api.put(`/api/categories/${category.id}`, values);
      toastOk('تم الحفظ');
      m.close();
      invalidate('categories');
      await loadCategories(true);
      onSaved();
    } catch { e.target.disabled = false; }
    return undefined;
  });
}

function openImportModal(onSuccess) {
  const m = modal({
    title: 'استيراد الأصناف من ملف Excel / CSV',
    body: html`
      <div class="stack">
        <p class="tiny muted" style="margin:0">
          يمكنك استيراد آلاف الأصناف دفعة واحدة. يقوم النظام تلقائياً بالتعرف على الأعمدة وتحديث الأصناف المتطابقة وإضافة الأصناف الجديدة.
        </p>
        <div class="row items-center" style="gap:1rem;background:var(--bg-subtle,#f8fafc);padding:.75rem;border-radius:6px;border:1px dashed var(--border,#cbd5e1)">
          <div style="flex:1">
            <label class="btn btn-sm btn-outline" style="cursor:pointer;display:inline-flex;align-items:center;gap:.4rem">
              ${icon.upload({ size: 15 })}
              <span>اختر ملف Excel أو CSV</span>
              <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv" style="display:none" />
            </label>
            <span id="selected-file-name" class="tiny muted" style="margin-right:.5rem">لم يتم اختيار ملف</span>
          </div>
          <a class="btn btn-sm btn-ghost" href="/api/items/template" download="items-import-template.xlsx">
            ${icon.download({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}تحميل نموذج Excel فارغ
          </a>
        </div>
        <div id="import-preview-area" style="display:none"></div>
      </div>
    `,
    footer: `
      <button class="btn" data-close type="button">إلغاء</button>
      <button class="btn btn-primary" id="commit-import-btn" type="button" disabled>اعتماد وإضافة الأصناف</button>
    `,
  });

  const fileInput = m.el.querySelector('#import-file-input');
  const fileNameEl = m.el.querySelector('#selected-file-name');
  const previewArea = m.el.querySelector('#import-preview-area');
  const commitBtn = m.el.querySelector('#commit-import-btn');
  let parsedItems = [];

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    fileNameEl.textContent = file.name;
    previewArea.style.display = 'block';
    previewArea.innerHTML = '<div class="text-center muted" style="padding:1.5rem">جارٍ قراءة وفحص ملف الأصناف…</div>';
    commitBtn.disabled = true;

    try {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const res = r.result || '';
          const commaIdx = res.indexOf(',');
          resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
        };
        r.onerror = reject;
        r.readAsDataURL(file);
      });

      const res = await api.post('/api/items/analyze-excel', { file_base64: b64, filename: file.name });
      parsedItems = (res.rows || []).filter((r) => !r.errors || r.errors.length === 0);

      const errorRows = (res.rows || []).filter((r) => r.errors && r.errors.length > 0);
      let errorsSnippet = '';
      if (errorRows.length) {
        errorsSnippet = `
          <div class="alert alert-danger tiny mt" style="max-height:100px;overflow-y:auto">
            <b>تحذير: تم استبعاد ${errorRows.length} صف لاحتوائها على أخطاء:</b>
            <ul>${errorRows.slice(0, 5).map((er) => `<li>صف ${er.row_index}: ${esc(er.name_ar || 'بدون اسم')} (${er.errors.join('، ')})</li>`).join('')}</ul>
          </div>
        `;
      }

      previewArea.innerHTML = html`
        <div class="card pad0 mt" style="border:1px solid var(--border)">
          <div style="padding:.6rem 1rem;background:var(--bg-subtle);display:flex;justify-content:space-between;align-items:center">
            <b>معاينة الأصناف الجاهزة للاستيراد (${parsedItems.length} صنف)</b>
            <span class="badge blue">${res.total_rows} سطر في الملف</span>
          </div>
          <div class="table-wrap" style="max-height:220px;overflow-y:auto">
            <table class="tbl tiny">
              <thead><tr><th>#</th><th>كود</th><th>اسم الصنف</th><th>المجموعة</th><th>الوحدة</th><th>التكلفة</th><th>سعر البيع</th><th>الضريبة</th></tr></thead>
              <tbody>
                ${parsedItems.slice(0, 20).map((it, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td class="mono">${esc(it.item_code || 'تلقائي')}</td>
                    <td><b>${esc(it.name_ar)}</b></td>
                    <td>${esc(it.category || '—')}</td>
                    <td>${esc(it.unit || 'حبة')}</td>
                    <td class="num">${esc(it.cost_price)}</td>
                    <td class="num"><b>${esc(it.sale_price)}</b></td>
                    <td class="num">${esc(it.tax_rate)}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${parsedItems.length > 20 ? `<div class="tiny muted text-center" style="padding:.4rem">تم عرض أول 20 صنفاً فقط من أصل ${parsedItems.length}…</div>` : ''}
        </div>
        ${raw(errorsSnippet)}
      `;

      if (parsedItems.length > 0) {
        commitBtn.disabled = false;
      } else {
        previewArea.innerHTML += '<div class="alert alert-danger tiny mt">لم يتم العثور على أي أصناف صالحة للاستيراد في الملف</div>';
      }
    } catch (err) {
      previewArea.innerHTML = `<div class="alert alert-danger tiny">${esc(err.message || 'فشل فحص الملف')}</div>`;
    }
  });

  commitBtn.addEventListener('click', async () => {
    if (!parsedItems.length) return;
    commitBtn.disabled = true;
    commitBtn.textContent = 'جارٍ الحفظ في قاعدة البيانات…';
    try {
      const saveRes = await api.post('/api/items/import', { items: parsedItems });
      toastOk(`تم استيراد الأصناف بنجاح (جديد: ${saveRes.created || 0}، محدث: ${saveRes.updated || 0})`);
      m.close();
      invalidate('items');
      invalidate('categories');
      await loadCategories(true);
      await onSuccess();
    } catch (err) {
      commitBtn.disabled = false;
      commitBtn.textContent = 'اعتماد وإضافة الأصناف';
      toastErr(err.message || 'فشل استيراد الأصناف');
    }
  });
}

export async function render(view, ctx) {
  const initial = getFilterState('items', {
    tab: (ctx && ctx.query && ctx.query.tab) || 'items',
    q: '',
    categoryId: (ctx && ctx.query && ctx.query.cat) || '',
    status: '',
  });
  if (ctx && ctx.query && ctx.query.tab) initial.tab = ctx.query.tab;
  if (ctx && ctx.query && ctx.query.cat) initial.categoryId = ctx.query.cat;

  const state = {
    ...initial,
    items: [],
    categories: [],
  };
  const writable = can('items.write');

  const load = async () => {
    const params = { q: state.q, category_id: state.categoryId };
    if (state.status) params.status = state.status;
    try {
      const [itemsRes, catsRes] = await Promise.all([
        api.get(qs('/api/items', params)),
        api.get('/api/categories'),
      ]);
      state.items = Array.isArray(itemsRes) ? itemsRes : [];
      state.categories = Array.isArray(catsRes) ? catsRes : [];
    } catch {
      state.items = [];
      state.categories = [];
    }
    store.items = state.items;
    store.categories = state.categories;
    setFilterState('items', {
      tab: state.tab,
      q: state.q,
      categoryId: state.categoryId,
      status: state.status,
    });
  };

  const itemsRows = () => {
    const list = Array.isArray(state.items) ? state.items : [];
    if (!list.length) return '<tr><td colspan="9" class="text-center muted" style="padding:1.5rem">لا توجد أصناف</td></tr>';
    return list.map((i) => `<tr>
      <td class="mono tiny">${esc(i.item_code)}</td>
      <td><b>${esc(i.name_ar)}</b>${i.name_en ? `<div class="tiny muted ltr">${esc(i.name_en)}</div>` : ''}</td>
      <td class="tiny">${esc(i.category_name || '—')}</td>
      <td class="tiny">${esc(i.unit)}</td>
      <td class="mono tiny">${esc(i.barcode || '—')}</td>
      <td class="text-end num">${amount(i.cost_price)}</td>
      <td class="text-end num"><b>${amount(i.sale_price)}</b></td>
      <td class="text-center tiny">${i.tax_rate}%</td>
      <td class="actions">
        <span class="badge ${i.is_active ? 'green' : 'gray'}">${i.is_active ? 'نشط' : 'موقوف'}</span>
        ${writable ? `<button class="btn btn-sm" data-act="edit-item" data-id="${esc(i.id)}" type="button" title="تعديل">${icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}تعديل</button>` : ''}
        ${writable ? `<button class="btn btn-sm btn-danger" data-act="del-item" data-id="${esc(i.id)}" type="button" title="حذف">${icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}حذف</button>` : ''}
      </td>
    </tr>`).join('');
  };

  const catRows = () => {
    const list = Array.isArray(state.categories) ? state.categories : [];
    if (!list.length) return '<tr><td colspan="5" class="text-center muted" style="padding:1.5rem">لا توجد مجموعات</td></tr>';
    return list.map((c) => `<tr>
      <td class="mono tiny">${esc(c.code)}</td>
      <td><b>${esc(c.name)}</b></td>
      <td class="tiny">${esc(c.parent_name || '—')}</td>
      <td class="tiny">${esc(c.description || '')}</td>
      <td class="actions">
        <span class="badge gray">${num(c.items_count)} صنف</span>
        <a class="btn btn-sm" href="#/items?tab=items&cat=${esc(c.id)}" title="أصناف المجموعة">${icon.eye({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}الأصناف</a>
        ${writable ? `<button class="btn btn-sm" data-act="edit-cat" data-id="${esc(c.id)}" type="button" title="تعديل">${icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}تعديل</button>` : ''}
        ${writable ? `<button class="btn btn-sm btn-danger" data-act="del-cat" data-id="${esc(c.id)}" type="button" title="حذف">${icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}حذف</button>` : ''}
      </td>
    </tr>`).join('');
  };

  const draw = () => {
    const itemsList = Array.isArray(state.items) ? state.items : [];
    const catList = Array.isArray(state.categories) ? state.categories : [];

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>الأصناف والمجموعات</h1>
          <p>كتالوج موحد يُستخدم في الفواتير الفردية والتوليد الدفعي.</p>
        </div>
        <div class="page-actions">
          ${raw(writable ? `<button class="btn btn-primary" id="add-item" type="button">${icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}إضافة صنف</button>` : '')}
          ${raw(writable ? `<button class="btn btn-outline" id="import-items-btn" type="button">${icon.upload({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}استيراد Excel</button>` : '')}
          ${raw(writable ? `<button class="btn" id="add-cat" type="button">${icon.plus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}إضافة مجموعة</button>` : '')}
          <button class="btn" id="exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn" id="exp-csv" type="button">${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}CSV</button>
        </div>
      </div>

      <div class="tabs">
        <div class="tab ${state.tab === 'items' ? 'active' : ''}" data-tab="items">الأصناف (${itemsList.length})</div>
        <div class="tab ${state.tab === 'cats' ? 'active' : ''}" data-tab="cats">المجموعات (${catList.length})</div>
      </div>

      ${raw(state.tab === 'items' ? `
        <div class="card">
          <div class="row">
            <div class="field" style="flex:2"><label>بحث الأصناف</label>
              <input type="search" id="q" value="${esc(state.q)}" placeholder="اسم، كود، باركود…" /></div>
            <div class="field" style="max-width:220px"><label>المجموعة</label>
              <select id="cat-filter">
                <option value="">كل المجموعات</option>
                ${catList.map((c) => `<option value="${esc(c.id)}" ${c.id === state.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select></div>
            <div class="field" style="max-width:160px"><label>الحالة</label>
              <select id="status-filter">
                <option value="" ${!state.status ? 'selected' : ''}>كل الحالات</option>
                <option value="active" ${state.status === 'active' ? 'selected' : ''}>نشط فقط</option>
                <option value="inactive" ${state.status === 'inactive' ? 'selected' : ''}>موقوف فقط</option>
              </select></div>
            <div class="field-actions" style="align-self:flex-end">
              <button class="btn btn-sm" id="clear-filters" type="button" title="إعادة ضبط الفلاتر">مسح</button>
            </div>
          </div>
        </div>
        <div class="card pad0">
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>الكود</th><th>الصنف</th><th>المجموعة</th><th>الوحدة</th><th>الباركود</th>
              <th class="text-end">التكلفة <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th class="text-end">سعر البيع <span class="cur-sym">${sarSvg({ size: 11 })}</span></th><th class="text-center">الضريبة</th><th></th></tr></thead>
            <tbody>${itemsRows()}</tbody>
          </table></div>
        </div>` : `
        <div class="card pad0">
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>الكود</th><th>المجموعة</th><th>المجموعة الأم</th><th>الوصف</th><th></th></tr></thead>
            <tbody>${catRows()}</tbody>
          </table></div>
        </div>`)}`;

    delegate(view, 'click', '.tab', (e, tab) => {
      state.tab = tab.dataset.tab;
      setFilterState('items', {
        tab: state.tab,
        q: state.q,
        categoryId: state.categoryId,
        status: state.status,
      });
      draw();
    });

    if (state.tab === 'items') {
      $('#q', view).addEventListener('input', debounce(async (e) => {
        state.q = e.target.value;
        await load();
        draw();
      }, 300));
      $('#cat-filter', view).addEventListener('change', async (e) => {
        state.categoryId = e.target.value;
        await load();
        draw();
      });
      $('#status-filter', view).addEventListener('change', async (e) => {
        state.status = e.target.value;
        await load();
        draw();
      });
      $('#clear-filters', view).addEventListener('click', async () => {
        clearFilterState('items');
        state.q = '';
        state.categoryId = '';
        state.status = '';
        await load();
        draw();
      });
    }

    const addItemBtn = $('#add-item', view);
    if (addItemBtn) addItemBtn.addEventListener('click', () => openItemModal(null, state.categories, async () => { await load(); draw(); }));
    const importItemsBtn = $('#import-items-btn', view);
    if (importItemsBtn) importItemsBtn.addEventListener('click', () => openImportModal(async () => { await load(); draw(); }));
    const addCatBtn = $('#add-cat', view);
    if (addCatBtn) addCatBtn.addEventListener('click', () => openCategoryModal(null, state.categories, async () => { await load(); draw(); }));

    $('#exp-csv', view).addEventListener('click', () => {
      if (state.tab === 'items') {
        exportCsv('الأصناف', ['الكود', 'الصنف', 'الإنجليزي', 'المجموعة', 'الوحدة', 'الباركود', 'التكلفة', 'سعر البيع', 'الضريبة%'],
          state.items.map((i) => [i.item_code, i.name_ar, i.name_en || '', i.category_name || '', i.unit, i.barcode || '', i.cost_price, i.sale_price, i.tax_rate]));
      } else {
        exportCsv('المجموعات', ['الكود', 'المجموعة', 'الأم', 'الوصف', 'عدد الأصناف'],
          state.categories.map((c) => [c.code, c.name, c.parent_name || '', c.description || '', c.items_count]));
      }
    });
    $('#exp-xls', view).addEventListener('click', () => {
      if (state.tab === 'items') {
        exportExcel('الأصناف', 'كتالوج الأصناف', ['الكود', 'الصنف', 'المجموعة', 'الوحدة', 'التكلفة', 'سعر البيع', 'الضريبة%'],
          state.items.map((i) => [i.item_code, i.name_ar, i.category_name || '', i.unit, i.cost_price, i.sale_price, i.tax_rate]));
      } else {
        exportExcel('المجموعات', 'مجموعات الأصناف', ['الكود', 'المجموعة', 'الأم', 'عدد الأصناف'],
          state.categories.map((c) => [c.code, c.name, c.parent_name || '', c.items_count]));
      }
    });

    delegate(view, 'click', '[data-act]', async (e, btn) => {
      const id = btn.dataset.id;
      const reload = async () => { await load(); draw(); };
      switch (btn.dataset.act) {
        case 'edit-item': openItemModal(await api.get(`/api/items/${id}`), state.categories, reload); break;
        case 'edit-cat': openCategoryModal(state.categories.find((c) => c.id === id), state.categories, reload); break;
        case 'del-item': {
          const item = state.items.find((x) => x.id === id);
          if (!await confirmDialog({ title: 'حذف صنف', message: `حذف «${item.name_ar}»؟ لا يمكن الحذف إذا كان مستخدماً في فواتير.`, danger: true, okText: 'حذف' })) return;
          try { await api.del(`/api/items/${id}`); toastOk('تم الحذف'); invalidate('items'); await reload(); } catch { /* تنبيه */ }
          break;
        }
        case 'del-cat': {
          const cat = state.categories.find((x) => x.id === id);
          if (!await confirmDialog({ title: 'حذف مجموعة', message: `حذف «${cat.name}»؟ لا يمكن الحذف إذا كانت تحتوي أصنافاً.`, danger: true, okText: 'حذف' })) return;
          try { await api.del(`/api/categories/${id}`); toastOk('تم الحذف'); invalidate('categories'); await reload(); } catch { /* تنبيه */ }
          break;
        }
        default: break;
      }
    });
  };

  await load();
  draw();
  return undefined;
}
