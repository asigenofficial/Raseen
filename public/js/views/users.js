// ==========================================================================
//  إدارة المستخدمين والأدوار وتحديد الصلاحيات.
// ==========================================================================
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import {
  html, raw, esc, dateTimeAr, initials, toastOk, toastErr,
  $, $$, delegate, modal, formValues, confirmDialog, icon,
} from '../core/util.js';

const ROLE_TONE = { ADMIN: 'red', ACCOUNTANT: 'blue', VIEWER: 'gray' };

/** التصنيفات المنطقية للصلاحيات مع الأيقونات والوصف العربي الواضح */
const PERM_CATEGORIES = [
  {
    key: 'invoices',
    label: 'الفواتير والعمليات الضريبية',
    iconName: 'invoice',
    items: [
      { key: 'invoices.view', label: 'عرض الفواتير', desc: 'استعراض قائمة الفواتير والبحث والطباعة والباركود' },
      { key: 'invoices.create', label: 'إصدار الفواتير', desc: 'إنشاء وإصدار فواتير ضريبية ومبسطة جديدة' },
      { key: 'invoices.edit', label: 'تعديل وإلغاء الفواتير', desc: 'تعديل بيانات الفواتير وإلغاؤها وإصدار إشعارات دائنة' },
      { key: 'invoices.delete', label: 'حذف الفواتير نهائياً', desc: 'حذف مسودات الفواتير غير المعتمدة نهائياً' },
      { key: 'invoices.backdate', label: 'إصدار بتاريخ سابق', desc: 'إصدار فواتير بتواريخ أو أوقات سابقة لليوم الحالي' },
      { key: 'bulk.generate', label: 'التوليد الدفعي للفواتير', desc: 'توليد دفعات فواتير متعددة آلياً بضغطة زر' },
      { key: 'bulk.approve', label: 'اعتماد الدفعات', desc: 'حفظ الفواتير المعاينة نهائيًا' },
      { key: 'invoices.edit_datetime', label: 'تعديل تاريخ ووقت الإصدار', desc: 'تحديد تاريخ ووقت الفاتورة يدويًا' },
      { key: 'templates.write', label: 'إدارة القوالب', desc: 'إضافة وتعديل قوالب المستندات' },
    ],
  },
  {
    key: 'vouchers',
    label: 'سندات القبض وكشوف الحساب',
    iconName: 'receipt',
    items: [
      { key: 'vouchers.view', label: 'عرض سندات القبض', desc: 'استعراض سندات القبض والدفعات المسجلة' },
      { key: 'vouchers.create', label: 'تسجيل سندات القبض', desc: 'إنشاء سندات قبض جديدة وإلغاؤها' },
      { key: 'vouchers.delete', label: 'حذف سندات القبض', desc: 'حذف سندات القبض نهائياً من النظام' },
      { key: 'vouchers.cancel', label: 'إلغاء سندات القبض', desc: 'عكس السداد والقيود المحاسبية' },
      { key: 'ledger.view', label: 'عرض كشوف الحساب', desc: 'الاطلاع على كشف حساب العملاء والحركات المالية' },
    ],
  },
  {
    key: 'parties',
    label: 'الشركات المصدرة والعملاء',
    iconName: 'building',
    items: [
      { key: 'issuers.view', label: 'عرض الشركات المصدرة', desc: 'عرض بيانات الشركات المصدرة وإعدادات المرحلة والختم' },
      { key: 'issuers.write', label: 'إضافة وتعديل الشركات', desc: 'إنشاء وتعديل بيانات المنشآت والشهادات الرقمية' },
      { key: 'issuers.credentials', label: 'إدارة بيانات الربط', desc: 'تعديل بيانات الربط والمفاتيح الخاصة بالشركة' },
      { key: 'clients.view', label: 'عرض العملاء', desc: 'استعراض قائمة العملاء والأرصدة المدينة والدائنة' },
      { key: 'clients.write', label: 'إضافة وتعديل العملاء', desc: 'إنشاء وتعديل وحذف العملاء وأرصدتهم الافتتاحية' },
    ],
  },
  {
    key: 'items',
    label: 'الأصناف والمجموعات المخزنية',
    iconName: 'package',
    items: [
      { key: 'items.view', label: 'عرض الأصناف والمجموعات', desc: 'استعراض قائمة الأصناف والمجموعات المخزنية والأسعار' },
      { key: 'items.write', label: 'إضافة وتعديل الأصناف', desc: 'إنشاء وتعديل الأصناف والأسعار ونسب الضريبة' },
    ],
  },
  {
    key: 'reports',
    label: 'التقارير وسجل التدقيق',
    iconName: 'report',
    items: [
      { key: 'reports.view', label: 'عرض وتصدير التقارير', desc: 'استعراض تقارير المبيعات والضريبة وتصديرها PDF / Excel' },
      { key: 'export.pdf', label: 'تصدير PDF', desc: 'تنزيل المستندات بصيغة PDF' },
      { key: 'export.excel', label: 'تصدير Excel', desc: 'تنزيل البيانات بصيغة XLSX' },
      { key: 'audit.view', label: 'عرض سجل التدقيق', desc: 'الاطلاع على سجل العمليات ومحاولات الدخول والتعديل' },
    ],
  },
  {
    key: 'system',
    label: 'إدارة النظام والمستخدمين',
    iconName: 'settings',
    items: [
      { key: 'users.manage', label: 'إدارة المستخدمين والصلاحيات', desc: 'إضافة وتعديل المستخدمين والأدوار وتحديد الصلاحيات' },
      { key: 'settings.write', label: 'تعديل إعدادات النظام', desc: 'تعديل الإعدادات العامة والنسخ الاحتياطي والترقيم' },
    ],
  },
];

export async function render(view) {
  let users = [];
  let rolesList = [];
  let userSearchQ = '';
  const isAdmin = store.user && (store.user.role === 'ADMIN');
  let currentTab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'users';
  let activeSessions = [];
  let syncHistory = [];
  let refreshTimer = null;

  const loadSyncData = async () => {
    if (!isAdmin) return;
    try {
      const res = await api.get('/api/admin/sync/sessions');
      activeSessions = res?.sessions || [];
    } catch {
      activeSessions = [];
    }
    try {
      syncHistory = await api.get('/api/admin/sync/history');
      if (!Array.isArray(syncHistory)) syncHistory = [];
    } catch {
      syncHistory = [];
    }
  };

  const load = async () => {
    try {
      users = await api.get('/api/users');
    } catch {
      users = [];
    }
    const m = store.meta || {};
    const rPerms = m.role_permissions || {};
    rolesList = Object.entries(m.roles || {}).map(([id, label]) => ({
      id,
      label,
      permissions: rPerms[id] || [],
      is_default: ['ADMIN', 'ACCOUNTANT', 'VIEWER'].includes(id),
      user_count: users.filter((u) => u.role === id).length,
    }));
  };

  /** فتح نافذة تعديل صلاحيات دور محدد */
  const editRoleModal = (role) => {
    const currentPerms = new Set(role.permissions || []);
    const isAdmin = role.id === 'ADMIN';

    const renderCategoryGroups = () => PERM_CATEGORIES.map((cat) => {
      const allSelected = cat.items.every((it) => currentPerms.has(it.key));
      const someSelected = cat.items.some((it) => currentPerms.has(it.key));
      const selCount = cat.items.filter((it) => currentPerms.has(it.key)).length;

      return html`
        <div class="card pad0 mt" style="background:rgba(255,255,255,0.02);border:1px solid var(--line);overflow:hidden">
          <div class="flex" style="padding:.65rem .9rem;background:rgba(255,255,255,0.03);border-bottom:1px solid var(--line);align-items:center;justify-content:space-between">
            <div class="flex" style="align-items:center;gap:.5rem">
              ${icon[cat.iconName] ? icon[cat.iconName]({ size: 16, style: 'color:var(--brand)' }) : ''}
              <b style="font-size:.9rem">${esc(cat.label)}</b>
              <span class="badge gray tiny" data-cat-counter="${cat.key}">${selCount} / ${cat.items.length}</span>
            </div>
            <button class="btn btn-sm" data-toggle-cat="${cat.key}" type="button" style="padding:.2rem .6rem;font-size:.78rem">
              ${allSelected ? 'إلغاء القسم' : 'تحديد القسم'}
            </button>
          </div>
          <div class="perm-grid" style="padding:.75rem .9rem;gap:.5rem .8rem">
            ${raw(cat.items.map((it) => {
              const isChecked = currentPerms.has(it.key);
              const isMandatory = isAdmin && it.key === 'users.manage';
              return `
                <label class="check perm ${isChecked ? 'locked' : ''}" style="margin:0;padding:.45rem .6rem;border-radius:var(--radius-sm)">
                  <input type="checkbox" name="role_perm" value="${esc(it.key)}" ${isChecked || isMandatory ? 'checked' : ''} ${isMandatory ? 'disabled data-mandatory="1"' : ''} />
                  <div style="margin-inline-start:.4rem">
                    <b style="display:block;font-size:.85rem">${esc(it.label)}</b>
                    <span class="tiny muted" style="display:block;line-height:1.3">${esc(it.desc)}</span>
                    <code class="tiny ltr" style="display:inline-block;color:var(--brand);margin-top:2px">${esc(it.key)}</code>
                    ${isMandatory ? '<span class="badge red tiny" style="margin-right:4px">إلزامية لمدير النظام</span>' : ''}
                  </div>
                </label>
              `;
            }).join(''))}
          </div>
        </div>
      `;
    }).join('');

    const m = modal({
      title: `تعديل وتحديد صلاحيات: ${role.label}`,
      wide: true,
      body: html`
        <div class="flex" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.8rem;padding-bottom:.8rem;border-bottom:1px solid var(--line)">
          <div>
            <div class="flex" style="align-items:center;gap:.5rem">
              <span class="badge ${ROLE_TONE[role.id] || 'teal'}" style="font-size:.9rem;padding:.25rem .7rem">${esc(role.label)}</span>
              <code class="tiny mono muted ltr">${esc(role.id)}</code>
              <span class="badge gray tiny">${role.user_count} مستخدم مسندين</span>
            </div>
            <p class="tiny muted" style="margin:.35rem 0 0">
              قم بتحديد أو إزالة الصلاحيات لهذا الدور. يتم تطبيق الصلاحيات فوراً على جميع مستخدمي هذا الدور.
            </p>
          </div>
          <div class="flex" style="gap:.4rem;align-items:center">
            <span class="badge blue" id="role-total-badge" style="font-size:.82rem;padding:.3rem .65rem">
              <span id="role-total-count">${currentPerms.size}</span> من 20 صلاحية
            </span>
            <button class="btn btn-sm" id="btn-select-all" type="button">تحديد الكل</button>
            <button class="btn btn-sm" id="btn-deselect-all" type="button">إلغاء الكل</button>
          </div>
        </div>

        <div id="role-categories-wrap" class="mt">
          ${raw(renderCategoryGroups())}
        </div>
      `,
      footer: `
        <button class="btn" data-close type="button">إلغاء</button>
        <button class="btn btn-primary" id="btn-save-role-perms" type="button">
          ${icon.shieldCheck({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}
          حفظ وتطبيق الصلاحيات
        </button>
      `,
    });

    const updateCounters = () => {
      const checkedBoxes = $$('input[name="role_perm"]:checked', m.body);
      const checkedVals = new Set(checkedBoxes.map((cb) => cb.value));
      if (isAdmin) checkedVals.add('users.manage');

      const countEl = $('#role-total-count', m.body);
      if (countEl) countEl.textContent = String(checkedVals.size);

      PERM_CATEGORIES.forEach((cat) => {
        const catCounter = $(`[data-cat-counter="${cat.key}"]`, m.body);
        const catBtn = $(`[data-toggle-cat="${cat.key}"]`, m.body);
        const catChecked = cat.items.filter((it) => checkedVals.has(it.key)).length;
        if (catCounter) catCounter.textContent = `${catChecked} / ${cat.items.length}`;
        if (catBtn) catBtn.textContent = catChecked === cat.items.length ? 'إلغاء القسم' : 'تحديد القسم';
      });

      $$('.perm', m.body).forEach((label) => {
        const cb = label.querySelector('input');
        label.classList.toggle('locked', !!(cb && cb.checked));
      });
    };

    // تبديل اختيار عنصر مفرد
    delegate(m.body, 'change', 'input[name="role_perm"]', () => {
      updateCounters();
    });

    // تبديل اختيار قسم كامل
    delegate(m.body, 'click', '[data-toggle-cat]', (e, btn) => {
      const catKey = btn.dataset.toggleCat;
      const cat = PERM_CATEGORIES.find((c) => c.key === catKey);
      if (!cat) return;
      const inputs = $$(`.perm input[value^="${cat.key}"]`, m.body);
      const allChecked = cat.items.every((it) => {
        const inp = inputs.find((i) => i.value === it.key);
        return inp && inp.checked;
      });
      cat.items.forEach((it) => {
        if (isAdmin && it.key === 'users.manage') return;
        const inp = inputs.find((i) => i.value === it.key);
        if (inp) inp.checked = !allChecked;
      });
      updateCounters();
    });

    // تحديد الكل
    $('#btn-select-all', m.body).addEventListener('click', () => {
      $$('input[name="role_perm"]', m.body).forEach((cb) => { cb.checked = true; });
      updateCounters();
    });

    // إلغاء الكل
    $('#btn-deselect-all', m.body).addEventListener('click', () => {
      $$('input[name="role_perm"]', m.body).forEach((cb) => {
        if (isAdmin && cb.value === 'users.manage') cb.checked = true;
        else cb.checked = false;
      });
      updateCounters();
    });

    // حفظ الصلاحيات للدور
    $('#btn-save-role-perms', m.el).addEventListener('click', async (e) => {
      const checkedBoxes = $$('input[name="role_perm"]:checked', m.body);
      const checkedVals = Array.from(new Set(checkedBoxes.map((cb) => cb.value)));
      if (isAdmin && !checkedVals.includes('users.manage')) {
        checkedVals.push('users.manage');
      }

      e.target.disabled = true;
      try {
        await api.put(`/api/roles/${role.id}`, { permissions: checkedVals });
        await store.loadMeta();
        await load();
        m.close();
        draw();
        toastOk(`تم حفظ وتحديث صلاحيات دور «${role.label}» بنجاح`);
      } catch {
        e.target.disabled = false;
      }
    });
  };

  /** إنشاء دور مخصص جديد */
  const newRoleModal = () => {
    const m = modal({
      title: 'إضافة دور جديد مخصص',
      wide: true,
      body: html`
        <div class="row">
          <div class="field"><label class="req">اسم الدور بالعربية</label>
            <input type="text" name="label" placeholder="مثال: كاشير، مدقق، مدير مبيعات" />
          </div>
          <div class="field"><label class="req">الرمز الإنجليزي (كود الدور)</label>
            <input type="text" name="key" class="ltr" placeholder="مثال: CASHIER, AUDITOR" />
            <span class="hint">حروف إنجليزية كبيرة وأرقام فقط، بدون مسافات</span>
          </div>
        </div>

        <div class="flex mt" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.8rem;padding-bottom:.6rem;border-bottom:1px solid var(--line)">
          <h4 style="margin:0">تحديد صلاحيات الدور الجديد</h4>
          <div class="flex" style="gap:.4rem">
            <button class="btn btn-sm" id="btn-role-new-all" type="button">تحديد الكل</button>
            <button class="btn btn-sm" id="btn-role-new-none" type="button">إلغاء الكل</button>
          </div>
        </div>

        <div id="new-role-perms-wrap" class="mt">
          ${raw(PERM_CATEGORIES.map((cat) => `
            <div class="card pad0 mt" style="background:rgba(255,255,255,0.02);border:1px solid var(--line);overflow:hidden">
              <div class="flex" style="padding:.5rem .8rem;background:rgba(255,255,255,0.03);border-bottom:1px solid var(--line);align-items:center;justify-content:space-between">
                <b style="font-size:.86rem">${esc(cat.label)}</b>
                <button class="btn btn-sm" data-toggle-cat-new="${cat.key}" type="button" style="padding:.15rem .5rem;font-size:.75rem">تحديد القسم</button>
              </div>
              <div class="perm-grid" style="padding:.6rem .8rem;gap:.4rem .8rem">
                ${cat.items.map((it) => `
                  <label class="check perm" style="margin:0;padding:.4rem .55rem">
                    <input type="checkbox" name="new_role_perm" value="${esc(it.key)}" />
                    <div style="margin-inline-start:.4rem">
                      <b style="display:block;font-size:.83rem">${esc(it.label)}</b>
                      <span class="tiny muted" style="display:block;line-height:1.2">${esc(it.desc)}</span>
                      <code class="tiny ltr" style="display:inline-block;color:var(--brand);margin-top:2px">${esc(it.key)}</code>
                    </div>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join(''))}
        </div>
      `,
      footer: `
        <button class="btn" data-close type="button">إلغاء</button>
        <button class="btn btn-primary" id="btn-save-new-role" type="button">
          ${icon.plus({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' })}
          إنشاء الدور
        </button>
      `,
    });

    $('#btn-role-new-all', m.body).addEventListener('click', () => {
      $$('input[name="new_role_perm"]', m.body).forEach((cb) => { cb.checked = true; });
    });
    $('#btn-role-new-none', m.body).addEventListener('click', () => {
      $$('input[name="new_role_perm"]', m.body).forEach((cb) => { cb.checked = false; });
    });

    delegate(m.body, 'click', '[data-toggle-cat-new]', (e, btn) => {
      const catKey = btn.dataset.toggleCatNew;
      const cat = PERM_CATEGORIES.find((c) => c.key === catKey);
      if (!cat) return;
      const inputs = $$(`.perm input[value^="${cat.key}"]`, m.body);
      const allChecked = cat.items.every((it) => {
        const inp = inputs.find((i) => i.value === it.key);
        return inp && inp.checked;
      });
      cat.items.forEach((it) => {
        const inp = inputs.find((i) => i.value === it.key);
        if (inp) inp.checked = !allChecked;
      });
    });

    $('#btn-save-new-role', m.el).addEventListener('click', async (e) => {
      const values = formValues(m.body);
      const label = String(values.label || '').trim();
      const key = String(values.key || '').trim().toUpperCase();
      if (!label) return toastErr('اسم الدور مطلوب بالعربية');
      if (!key || !/^[A-Z0-9_]{3,30}$/.test(key)) return toastErr('الرمز الإنجليزي يجب أن يتكون من 3-30 حرفاً إنجليزياً أو رقماً');

      const checked = $$('input[name="new_role_perm"]:checked', m.body).map((cb) => cb.value);

      e.target.disabled = true;
      try {
        await api.post('/api/roles', { key, label, permissions: checked });
        await store.loadMeta();
        await load();
        m.close();
        draw();
        toastOk(`تم إنشاء الدور الجديد «${label}» بنجاح`);
      } catch {
        e.target.disabled = false;
      }
      return undefined;
    });
  };

  /** نموذج إضافة أو تعديل مستخدم فردي مع إمكانية التخصيص الكامل للصلاحيات */
  const userForm = (user) => {
    const isNew = !user;
    const initialRole = user ? user.role : 'ACCOUNTANT';
    const initialPerms = new Set(user ? user.permissions : (rolesList.find((r) => r.id === initialRole)?.permissions || []));
    const isCustomMode = Boolean(user && user.is_custom_permissions);

    const m = modal({
      title: isNew ? 'مستخدم جديد' : `تعديل المستخدم: ${user.username}`,
      wide: true,
      body: html`
        <div class="row">
          <div class="field"><label class="req">اسم المستخدم</label>
            <input type="text" name="username" class="ltr" value="${user ? esc(user.username) : ''}" ${raw(isNew ? '' : 'disabled')} />
            <span class="hint">حروف إنجليزية وأرقام، 3-40 خانة</span></div>
          <div class="field"><label>الاسم الكامل</label>
            <input type="text" name="full_name" value="${user ? esc(user.full_name) : ''}" /></div>
          <div class="field" style="max-width:200px"><label>الدور الوظيفي</label>
            <select name="role" id="u-role">
              ${raw(rolesList.map((r) => `<option value="${esc(r.id)}" ${r.id === initialRole ? 'selected' : ''}>${esc(r.label)} (${r.permissions.length} صلاحية)</option>`).join(''))}
            </select></div>
        </div>
        <div class="row mt">
          <div class="field"><label ${raw(isNew ? 'class="req"' : '')}>كلمة المرور</label>
            <input type="password" name="password" autocomplete="new-password" placeholder="${raw(isNew ? '8 خانات على الأقل' : 'اتركها فارغة لعدم التغيير')}" />
            <span class="hint">${raw(isNew ? '' : 'تغيير كلمة المرور يُنهي جلسات المستخدم الحالية')}</span></div>
          <div class="field" style="max-width:200px"><label>الحالة</label>
            <label class="check mt"><input type="checkbox" name="is_active" ${raw(!user || user.is_active ? 'checked' : '')} /> مستخدم نشط</label></div>
        </div>

        <div class="card pad0 mt" style="background:rgba(255,255,255,0.015);border:1px solid var(--line);padding:1rem">
          <div class="flex" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.8rem">
            <div>
              <h4 style="margin:0;display:flex;align-items:center;gap:.4rem">
                ${icon.shieldCheck({ size: 16, style: 'color:var(--brand)' })}
                تحديد الصلاحيات الممنوحة
              </h4>
              <p class="tiny muted" style="margin:.25rem 0 0">
                يمكنك تحديد وتخصيص الصلاحيات بدقة لهذا المستخدم، أو تطبيق الصلاحيات الافتراضية للدور.
              </p>
            </div>
            <div class="flex" style="gap:.4rem;align-items:center">
              <span class="badge blue" id="u-perms-count" style="font-size:.82rem">${initialPerms.size} من 20 صلاحية</span>
              <button class="btn btn-sm" id="btn-u-apply-role" type="button" title="تطبيق الصلاحيات التابعة للدور المختار">تطبيق صلاحيات الدور</button>
              <button class="btn btn-sm" id="btn-u-select-all" type="button">تحديد الكل</button>
              <button class="btn btn-sm" id="btn-u-clear-all" type="button">إلغاء الكل</button>
            </div>
          </div>

          <div class="mt" style="padding-top:.8rem;border-top:1px solid var(--line)">
            <label class="check" style="margin-bottom:.8rem;font-weight:600">
              <input type="checkbox" id="u-custom-checkbox" ${isCustomMode ? 'checked' : ''} />
              <span>تخصيص صلاحيات مستقلة لهذا المستخدم (تثبيت الصلاحيات حتى عند تعديل الدور العام)</span>
            </label>

            <div id="u-perms-wrap">
              ${raw(PERM_CATEGORIES.map((cat) => `
                <div style="margin-bottom:.8rem">
                  <div class="flex" style="align-items:center;gap:.4rem;margin-bottom:.4rem">
                    <b style="font-size:.84rem;color:#cbd5e1">${esc(cat.label)}</b>
                  </div>
                  <div class="perm-grid" style="gap:.4rem .8rem">
                    ${cat.items.map((it) => `
                      <label class="check perm" style="margin:0;padding:.35rem .55rem">
                        <input type="checkbox" name="user_perm" value="${esc(it.key)}" ${initialPerms.has(it.key) ? 'checked' : ''} />
                        <span style="margin-inline-start:.35rem">
                          <b style="font-size:.83rem">${esc(it.label)}</b>
                          <code class="tiny muted ltr" style="margin-inline-start:4px">${esc(it.key)}</code>
                        </span>
                      </label>
                    `).join('')}
                  </div>
                </div>
              `).join(''))}
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn" data-close type="button">إلغاء</button>
        <button class="btn btn-primary" data-ok type="button">${isNew ? 'إضافة المستخدم' : 'حفظ التعديلات'}</button>
      `,
    });

    const updatePermsCount = () => {
      const checked = $$('input[name="user_perm"]:checked', m.body);
      const countEl = $('#u-perms-count', m.body);
      if (countEl) countEl.textContent = `${checked.length} من 20 صلاحية`;
    };

    const applyRolePermissions = () => {
      const selectedRoleKey = $('#u-role', m.body).value;
      const rObj = rolesList.find((r) => r.id === selectedRoleKey);
      const targetPerms = new Set(rObj ? rObj.permissions : []);
      $$('input[name="user_perm"]', m.body).forEach((cb) => {
        cb.checked = targetPerms.has(cb.value);
      });
      updatePermsCount();
    };

    $('#btn-u-apply-role', m.body).addEventListener('click', applyRolePermissions);
    $('#u-role', m.body).addEventListener('change', () => {
      // عند تغيير الدور ولم يكن التخصيص مفعلاً، قم بتطبيق الصلاحيات تلقائياً
      const isCustomChecked = $('#u-custom-checkbox', m.body).checked;
      if (!isCustomChecked) {
        applyRolePermissions();
      }
    });

    $('#btn-u-select-all', m.body).addEventListener('click', () => {
      $$('input[name="user_perm"]', m.body).forEach((cb) => { cb.checked = true; });
      $('#u-custom-checkbox', m.body).checked = true;
      updatePermsCount();
    });

    $('#btn-u-clear-all', m.body).addEventListener('click', () => {
      $$('input[name="user_perm"]', m.body).forEach((cb) => { cb.checked = false; });
      $('#u-custom-checkbox', m.body).checked = true;
      updatePermsCount();
    });

    delegate(m.body, 'change', 'input[name="user_perm"]', () => {
      updatePermsCount();
    });

    m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
      const values = formValues(m.body);
      const r = values.role;
      const isCustom = $('#u-custom-checkbox', m.body).checked;
      const checked = $$('input[name="user_perm"]:checked', m.body).map((cb) => cb.value);

      const payload = {
        full_name: values.full_name,
        role: r,
        is_active: !!values.is_active,
        custom_mode: isCustom,
        permissions: checked,
      };

      if (isNew) {
        payload.username = values.username;
        payload.password = values.password;
        if (!payload.username) return toastErr('اسم المستخدم مطلوب');
        if (!payload.password || payload.password.length < 8) return toastErr('كلمة المرور 8 خانات على الأقل');
      } else if (values.password) {
        payload.password = values.password;
      }

      e.target.disabled = true;
      try {
        if (isNew) await api.post('/api/users', payload);
        else await api.put(`/api/users/${user.id}`, payload);
        toastOk(isNew ? 'تمت إضافة المستخدم بنجاح' : 'تم حفظ التعديلات');
        m.close();
        await load();
        draw();
      } catch {
        e.target.disabled = false;
      }
      return undefined;
    });
  };

  const formatSyncAction = (ev) => {
    switch (ev.type) {
      case 'invoice:created': {
        const num = ev.data?.invoice_number || '';
        const client = ev.data?.client_name ? ` للعميل ${ev.data.client_name}` : '';
        const amt = ev.data?.grand_total ? ` بمبلغ ${ev.data.grand_total} ر.س` : '';
        return `إصدار فاتورة جديدة ${num}${client}${amt}`;
      }
      case 'invoice:updated':
        return `تعديل فاتورة رقم ${ev.data?.invoice_number || ''}`;
      case 'invoice:cancelled':
        return `إلغاء فاتورة`;
      case 'invoice:deleted':
        return `حذف مسودة فاتورة`;
      case 'invoice:imported':
        return `استيراد دفعة فواتير Excel (${ev.data?.count || 0} فاتورة)`;
      case 'invoice:bulk_created':
        return `اعتماد وتوليد دفعة فواتير (${ev.data?.count || 0} فاتورة)`;
      case 'voucher:created': {
        const num = ev.data?.voucher_number || '';
        const amt = ev.data?.total_amount ? ` بمبلغ ${ev.data.total_amount} ر.س` : '';
        return `إصدار سند قبض جديد ${num}${amt}`;
      }
      case 'voucher:deleted':
        return `إلغاء/حذف سند قبض`;
      case 'client:updated':
        return `تحديث دليل العملاء`;
      case 'item:updated':
        return `تحديث دليل الأصناف والأسعار`;
      case 'sync:force':
        return `إجبار مزامنة فورية شاملة لكافة الأجهزة`;
      case 'broadcast:alert':
        return `بث رسالة فورية: «${ev.data?.message || ''}»`;
      case 'session:revoked':
        return `إنهاء جلسة مستخدم`;
      default:
        return `${ev.action || 'إجراء'} على ${ev.entity || 'النظام'}`;
    }
  };

  const getDeviceIcon = (devName) => {
    const d = String(devName || '');
    if (d.includes('iPhone') || d.includes('Android') || d.includes('iPad')) {
      return icon.phone ? icon.phone({ size: 14 }) : '📱';
    }
    if (d.includes('Mac')) {
      return icon.laptop ? icon.laptop({ size: 14 }) : '💻';
    }
    return icon.desktop ? icon.desktop({ size: 14 }) : '🖥️';
  };

  const broadcastAlertModal = (targetUser = null) => {
    const m = modal({
      title: targetUser ? `إرسال رسالة فورية إلى: ${targetUser.full_name || targetUser.username}` : 'بث تنبيه عاجل لجميع المتصلين',
      body: html`
        <div class="field">
          <label class="req">نص الرسالة / التنبيه الفوري</label>
          <textarea name="message" rows="3" placeholder="اكتب الرسالة أو التنبيه هنا ليظهر فوراً على شاشات المستخدمين…" required></textarea>
        </div>
        <div class="row mt">
          <div class="field">
            <label>مستوى الأهمية</label>
            <select name="level">
              <option value="info">معلومة عامة (أزرق)</option>
              <option value="warning" selected>تنبيه هام (برتقالي)</option>
              <option value="error">عاجل / حرج (أحمر)</option>
            </select>
          </div>
          ${raw(!targetUser ? `
            <div class="field">
              <label>المستهدفون</label>
              <select name="target_user">
                <option value="">جميع المستخدمين المتصلين حالياً (بث عام)</option>
                ${users.map((u) => `<option value="${esc(u.id)}">${esc(u.full_name || u.username)} (${esc(u.role_label || u.role)})</option>`).join('')}
              </select>
            </div>
          ` : '')}
        </div>
      `,
      footer: `
        <button class="btn" data-close type="button">إلغاء</button>
        <button class="btn btn-primary" id="btn-do-broadcast" type="button">
          ${icon.bell({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}
          بث الرسالة الآن
        </button>
      `,
    });

    m.el.querySelector('#btn-do-broadcast')?.addEventListener('click', async (e) => {
      const vals = formValues(m.body);
      if (!vals.message || !vals.message.trim()) return toastErr('نص الرسالة مطلوب');

      e.target.disabled = true;
      e.target.textContent = 'جارٍ البث…';
      try {
        await api.post('/api/admin/sync/broadcast', {
          message: vals.message.trim(),
          level: vals.level || 'info',
          target_user: targetUser ? targetUser.user_id : (vals.target_user || ''),
        });
        toastOk('تم بث الرسالة بنجاح للأجهزة المستهدفة');
        m.close();
        await loadSyncData();
        draw();
      } catch (err) {
        e.target.disabled = false;
        e.target.textContent = 'بث الرسالة الآن';
      }
      return undefined;
    });
  };

  const revokeSessionAction = async (session) => {
    const ok = await confirmDialog({
      title: 'إنهاء جلسة المستخدم',
      message: `هل أنت متأكد من إنهاء جلسة «${session.full_name || session.username}» على جهاز (${session.device_name})؟ سيتم قطع اتصاله فوراً وإخراجه لصفحة الدخول.`,
      danger: true,
      okText: 'إنهاء الجلسة فوراً',
    });
    if (!ok) return;
    try {
      await api.post('/api/admin/sync/revoke', { session_token: session.id });
      toastOk(`تم إنهاء جلسة ${session.username} بنجاح`);
      await loadSyncData();
      draw();
    } catch (err) {
      toastErr(err.message || 'فشل إنهاء الجلسة');
    }
  };

  const revokeAllOthersAction = async () => {
    const ok = await confirmDialog({
      title: 'طرد كافة الجلسات الأخرى',
      message: 'سيتم إنهاء وتسجيل خروج جميع المستخدمين والأجهزة المتصلة الأخرى بالنظام فوراً، وستبقى أنت فقط متصلاً. هل تريد المتابعة؟',
      danger: true,
      okText: 'طرد الجميع فوراً',
    });
    if (!ok) return;
    try {
      const res = await api.post('/api/admin/sync/revoke-others', {});
      toastOk(res?.message || 'تم إنهاء جميع الجلسات الأخرى بنجاح');
      await loadSyncData();
      draw();
    } catch (err) {
      toastErr(err.message || 'فشل إنهاء الجلسات');
    }
  };

  const forceSyncAction = async (btn) => {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${icon.refresh({ size: 14, style: 'animation:spin 1s linear infinite;margin-left:4px' })} جارٍ المزامنة…`;
    }
    try {
      await api.post('/api/admin/sync/force', {});
      toastOk('تم إرسال أمر المزامنة الفورية لكافة الأجهزة المتصلة بنجاح');
      await loadSyncData();
      draw();
    } catch (err) {
      toastErr(err.message || 'فشل إرسال أمر المزامنة');
      if (btn) btn.disabled = false;
    }
  };

  const renderSessionsRows = () => {
    if (!activeSessions.length) {
      return `<tr><td colspan="7" class="text-center muted pad" style="padding:2rem">لا توجد جلسات نشطة مسجلة حالياً</td></tr>`;
    }
    return activeSessions.map((s) => {
      const isLive = s.is_online;
      const devIco = getDeviceIcon(s.device_name || '');
      return `
        <tr class="${isLive ? '' : 'row-off'}">
          <td>
            <div class="flex" style="gap:.6rem;align-items:center">
              <div class="avatar sm">${esc(initials(s.full_name || s.username))}</div>
              <div>
                <div class="flex" style="align-items:center;gap:.4rem">
                  <b>${esc(s.full_name || s.username)}</b>
                  <span class="badge ${ROLE_TONE[s.role] || 'teal'} tiny">${esc(s.role)}</span>
                </div>
                <div class="tiny muted ltr mono">${esc(s.username)}</div>
              </div>
            </div>
          </td>
          <td>
            <div class="flex" style="align-items:center;gap:.4rem">
              <span style="opacity:0.8">${raw(devIco)}</span>
              <b>${esc(s.device_name || 'جهاز غير محدد')}</b>
            </div>
            <div class="tiny muted mono ltr" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.user_agent)}">${esc(s.user_agent)}</div>
          </td>
          <td>
            <code class="ltr mono tiny" style="background:rgba(255,255,255,0.04);padding:2px 6px;border-radius:4px">${esc(s.ip || '—')}</code>
          </td>
          <td>
            <span class="badge blue" style="font-size:.82rem">${esc(s.view_label || s.current_view || 'الرئيسية')}</span>
          </td>
          <td>
            ${isLive ? `
              <div class="flex" style="align-items:center;gap:.4rem">
                <span class="sync-dot" style="width:8px;height:8px;background:#10b981;box-shadow:0 0 8px #10b981;border-radius:50%;display:inline-block"></span>
                <span class="badge green tiny">متصل الآن</span>
              </div>
              <span class="tiny muted">آخر نبض: ${s.seconds_since_seen} ثانية</span>
            ` : `
              <span class="badge gray tiny">غير نشط</span>
              <div class="tiny muted">منذ ${Math.round(s.seconds_since_seen / 60)} دقيقة</div>
            `}
          </td>
          <td class="tiny muted">${esc(dateTimeAr(s.connected_at))}</td>
          <td class="actions">
            ${s.is_current ? `
              <span class="badge blue tiny" style="padding:.3rem .6rem">جلستك الحالية</span>
            ` : `
              <button class="btn btn-sm" data-session-act="msg" data-session-token="${esc(s.id)}" type="button" title="إرسال رسالة مباشرة لهذا المستخدم">
                ${icon.bell({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}
                رسالة
              </button>
              <button class="btn btn-sm btn-danger" data-session-act="revoke" data-session-token="${esc(s.id)}" type="button" title="إنهاء الجلسة وقطع الاتصال فوراً">
                ${icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}
                طرد
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');
  };

  const filterUsers = (q) => {
    if (!q) return users;
    const term = q.trim().toLowerCase();
    return users.filter((u) => {
      const fn = (u.full_name || '').toLowerCase();
      const un = (u.username || '').toLowerCase();
      const r = (u.role || '').toLowerCase();
      const rl = (u.role_label || '').toLowerCase();
      const st = u.is_active ? 'نشط active' : 'معطل disabled';
      return fn.includes(term) || un.includes(term) || r.includes(term) || rl.includes(term) || st.includes(term);
    });
  };

  const renderUsersRows = (list) => {
    if (!list.length) {
      return `<tr><td colspan="7" class="text-center muted pad" style="padding:2rem">لا يوجد مستخدمون مطابقون للبحث «${esc(userSearchQ)}»</td></tr>`;
    }
    return list.map((u) => {
      const isCustom = Boolean(u.is_custom_permissions);
      return `<tr class="${u.is_active ? '' : 'row-off'}">
        <td><div class="flex" style="gap:.5rem;align-items:center">
          <div class="avatar sm">${esc(initials(u.full_name || u.username))}</div>
          <div><b>${esc(u.full_name || u.username)}</b>
            <div class="tiny muted ltr mono">${esc(u.username)}</div></div>
        </div></td>
        <td><span class="badge ${ROLE_TONE[u.role] || 'teal'}">${esc(u.role_label || u.role)}</span></td>
        <td>${u.is_active ? '<span class="badge green">نشط</span>' : '<span class="badge gray">معطّل</span>'}</td>
        <td class="tiny">
          <span class="badge blue">${(u.permissions || []).length} صلاحية</span>
          ${isCustom ? '<span class="badge amber tiny" style="margin-right:4px">مخصص</span>' : ''}
        </td>
        <td class="tiny">${u.last_login_at ? esc(dateTimeAr(u.last_login_at)) : '—'}</td>
        <td class="tiny muted">${esc(dateTimeAr(u.created_at))}</td>
        <td class="actions">
          <button class="btn btn-sm" data-act="edit" data-id="${esc(u.id)}" type="button">${icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}تعديل</button>
          <button class="btn btn-sm" data-act="perms" data-id="${esc(u.id)}" type="button">${icon.shieldCheck({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}الصلاحيات</button>
          <button class="btn btn-sm btn-danger" data-act="del" data-id="${esc(u.id)}" type="button">${icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}حذف</button>
        </td>
      </tr>`;
    }).join('');
  };

  /** رسم الصفحة الرئيسية للمستخدمين والأدوار أو المزامنة */
  const draw = () => {
    const meta = store.meta || {};
    const permLabels = meta.permission_labels || {};
    const admins = users.filter((u) => u.role === 'ADMIN' && u.is_active).length;
    const onlineCount = activeSessions.filter((s) => s.is_online).length || 1;
    const filteredUsers = filterUsers(userSearchQ);

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>${currentTab === 'sync' ? 'المزامنة اللحظية والتحكم بالجلسات' : 'المستخدمون والصلاحيات'}</h1>
          <p>${currentTab === 'sync'
            ? 'مراقبة وإدارة كافة الأجهزة والمتصلين بالنظام لحظياً مع إمكانية المزامنة الفورية، بث الرسائل، وطرد الجلسات بدقة متناهية.'
            : `${users.length} مستخدم مسجل — ${admins} مدير نظام نشط. الصلاحيات تُطبّق وتُراقب على مستوى الخادم وقاعدة البيانات.`}
          </p>
        </div>
        <div class="page-actions">
          ${raw(currentTab === 'sync' ? `
            <button class="btn btn-primary" id="btn-force-sync" type="button" title="إجبار كافة المتصفحات المتصلة على جلب أحدث البيانات فوراً">
              ${icon.refresh({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}
              إجبار مزامنة فورية
            </button>
            <button class="btn" id="btn-broadcast-alert" type="button" title="بث رسالة أو إشعار فوري لجميع المستخدمين">
              ${icon.bell({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}
              بث تنبيه عاجل
            </button>
            <button class="btn btn-danger" id="btn-revoke-all-others" type="button" title="طرد كافة الجلسات الأخرى فوراً وإبقاء جلستك فقط">
              ${icon.shieldCheck({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}
              طرد كافة الجلسات الأخرى
            </button>
          ` : `
            <button class="btn btn-primary" id="new-u" type="button">
              ${icon.userPlus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}
              مستخدم جديد
            </button>
          `)}
        </div>
      </div>

      ${raw(isAdmin ? `
        <div class="tabs" id="user-mgmt-tabs" style="margin-bottom:1.2rem">
          <button class="tab ${currentTab === 'users' ? 'active' : ''}" data-tab="users" type="button">
            ${icon.users({ size: 15, style: 'vertical-align:text-bottom;margin-left:5px' })}
            المستخدمون والأدوار
          </button>
          <button class="tab ${currentTab === 'sync' ? 'active' : ''}" data-tab="sync" type="button" style="display:inline-flex;align-items:center;gap:6px">
            ${icon.refresh({ size: 14 })}
            <span>المزامنة والجلسات النشطة</span>
            <span class="badge ${onlineCount > 0 ? 'green' : 'gray'} tiny" id="live-online-count" style="margin-right:2px">
              ${onlineCount} متصل الآن
            </span>
          </button>
        </div>
      ` : '')}

      ${raw(currentTab === 'sync' ? `
        <!-- بطاقات مؤشرات المزامنة اللحظية (KPIs) -->
        <div class="grid grid-4" style="margin-bottom:1.2rem">
          <div class="card pad0" style="padding:1rem;background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.25)">
            <div class="flex" style="align-items:center;justify-content:space-between">
              <span class="tiny muted">المتصلون حالياً (Live)</span>
              <span class="sync-dot" style="width:8px;height:8px;background:#10b981;border-radius:50%;box-shadow:0 0 8px #10b981;display:inline-block"></span>
            </div>
            <div style="font-size:1.6rem;font-weight:800;color:#10b981;margin-top:.4rem">${onlineCount} جهاز متصل</div>
            <div class="tiny muted" style="margin-top:.3rem">يدعم العمل المتزامن حتى 50 مستخدماً معاً</div>
          </div>

          <div class="card pad0" style="padding:1rem;background:rgba(255,255,255,0.02)">
            <div class="tiny muted">إجمالي الجلسات المسجلة</div>
            <div style="font-size:1.6rem;font-weight:800;color:var(--text);margin-top:.4rem">${activeSessions.length} جلسة</div>
            <div class="tiny muted" style="margin-top:.3rem">موزعة على الأجهزة والمتصفحات النشطة</div>
          </div>

          <div class="card pad0" style="padding:1rem;background:rgba(255,255,255,0.02)">
            <div class="tiny muted">تقنية المزامنة</div>
            <div style="font-size:1.2rem;font-weight:800;color:var(--brand);margin-top:.4rem">Zero-Latency SSE</div>
            <div class="tiny muted" style="margin-top:.3rem">تحديث تلقائي فور إصدار أي فاتورة أو سند</div>
          </div>

          <div class="card pad0" style="padding:1rem;background:rgba(255,255,255,0.02)">
            <div class="tiny muted">أمان العمليات التزامنية</div>
            <div style="font-size:1.2rem;font-weight:800;color:#38bdf8;margin-top:.4rem">WAL + Mutex Lock</div>
            <div class="tiny muted" style="margin-top:.3rem">تسلسل ترقيم دقيق بدون أي تضارب أو تكرار</div>
          </div>
        </div>

        <!-- جدول الجلسات النشطة والأجهزة المتصلة -->
        <div class="card pad0">
          <div class="flex" style="padding:.9rem 1.2rem;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(255,255,255,0.015)">
            <div class="flex" style="align-items:center;gap:.5rem">
              ${icon.laptop ? icon.laptop({ size: 18, style: 'color:var(--brand)' }) : ''}
              <b style="font-size:1rem">الأجهزة والجلسات المتصلة حالياً</b>
            </div>
            <button class="btn btn-sm" id="btn-refresh-sessions" type="button">
              ${icon.refresh({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' })}
              تحديث القائمة
            </button>
          </div>
          <div class="table-wrap users-table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>الجهاز والمتصفح</th>
                  <th>عنوان IP</th>
                  <th>الشاشة الحالية</th>
                  <th>الحالة</th>
                  <th>تاريخ الاتصال</th>
                  <th>إجراءات الأدمن</th>
                </tr>
              </thead>
              <tbody id="active-sessions-tbody">
                ${raw(renderSessionsRows())}
              </tbody>
            </table>
          </div>
        </div>

        <!-- سجل أحداث المزامنة اللحظية (Live Audit Timeline) -->
        <div class="card mt pad0">
          <div class="flex" style="padding:.9rem 1.2rem;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(255,255,255,0.015)">
            <div class="flex" style="align-items:center;gap:.5rem">
              ${icon.shieldCheck({ size: 18, style: 'color:var(--brand)' })}
              <b style="font-size:1rem">سجل أحداث المزامنة المباشر (آخر 50 عملية تزامنية)</b>
            </div>
            <span class="badge blue tiny">${syncHistory.length} حدث مسجل</span>
          </div>
          <div class="table-wrap users-table-wrap" style="max-height:360px;overflow-y:auto">
            <table class="tbl">
              <thead>
                <tr>
                  <th>الحدث</th>
                  <th>المنفذ</th>
                  <th>التفاصيل والإجراء</th>
                  <th>التوقيت</th>
                </tr>
              </thead>
              <tbody>
                ${raw(syncHistory.length ? syncHistory.map((ev) => `
                  <tr>
                    <td>
                      <span class="badge ${ev.entity === 'invoice' ? 'blue' : ev.entity === 'voucher' ? 'teal' : ev.action === 'alert' ? 'amber' : 'gray'} tiny">
                        ${esc(ev.type)}
                      </span>
                    </td>
                    <td>
                      <b>${esc(ev.actor_name || ev.actor)}</b>
                    </td>
                    <td>
                      ${esc(formatSyncAction(ev))}
                    </td>
                    <td class="tiny muted mono">${esc(dateTimeAr(ev.timestamp))}</td>
                  </tr>
                `).join('') : '<tr><td colspan="4" class="text-center muted pad">لا توجد أحداث مزامنة مسجلة بعد</td></tr>')}
              </tbody>
            </table>
          </div>
        </div>
      ` : `
        ${raw(users.some((u) => u.username === 'admin')
          ? '<div class="alert alert-warn">حساب المدير الافتراضي <b>admin</b> لا يزال موجوداً بكلمة المرور الأولية. غيّر كلمة المرور فوراً من قائمة المستخدم أعلى الشاشة، أو أنشئ حساباً باسمك واحذفه.</div>'
          : '')}

        <!-- فلتر وبحث المستخدمين -->
        <div class="card" style="margin-bottom:0.75rem;padding:0.65rem 1rem">
          <div class="row items-center" style="gap:1rem;flex-wrap:wrap">
            <div class="field" style="flex:1;min-width:240px;margin:0">
              <input type="search" id="users-search" value="${esc(userSearchQ)}" placeholder="بحث في المستخدمين (الاسم، اسم المستخدم، الدور، الحالة…)…" autocomplete="off" />
            </div>
            <span class="tiny muted" id="users-count">${userSearchQ ? `${filteredUsers.length} مطابقة من أصل ` : ''}${users.length} مستخدم</span>
          </div>
        </div>

        <!-- جدول المستخدمين -->
        <div class="card pad0">
          <div class="table-wrap users-table-wrap">
            <table class="tbl">
              <thead><tr><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>الصلاحيات الفعالة</th>
                <th>آخر دخول</th><th>تاريخ الإنشاء</th><th></th></tr></thead>
              <tbody id="users-rows">
                ${raw(renderUsersRows(filteredUsers))}
              </tbody>
            </table>
          </div>
        </div>

        <!-- بطاقات الأدوار وإدارتها وتحديد صلاحياتها -->
        <div class="card mt">
          <div class="flex" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.8rem;margin-bottom:1rem">
            <div>
              <h3 style="margin:0;display:flex;align-items:center;gap:.5rem">
                ${icon.shieldCheck({ size: 20, style: 'color:var(--brand)' })}
                الأدوار والصلاحيات
              </h3>
              <p class="tiny muted" style="margin:.25rem 0 0">
                يمكنك تعديل صلاحيات أي دور من الأدوار أدناه وتحديدها بحرية، أو إضافة دور مخصص جديد للنظام.
              </p>
            </div>
            <button class="btn btn-sm btn-primary" id="btn-add-custom-role" type="button">
              ${icon.plus({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' })}
              إضافة دور مخصص
            </button>
          </div>

          <div class="grid grid-3" id="roles-cards-grid">
            ${raw(rolesList.map((r) => {
              const isDef = r.is_default;
              return `
                <div class="mini-card role-card" style="display:flex;flex-direction:column;justify-content:space-between;background:rgba(255,255,255,0.025);border:1px solid var(--line);border-radius:var(--radius-sm);padding:1rem">
                  <div>
                    <div class="flex" style="align-items:center;justify-content:space-between;margin-bottom:.6rem">
                      <span class="badge ${ROLE_TONE[r.id] || 'teal'}" style="font-size:.85rem;padding:.2rem .65rem">
                        ${esc(r.label)}
                      </span>
                      <span class="badge gray tiny">${r.user_count || 0} مستخدم</span>
                    </div>
                    <div class="flex" style="align-items:center;gap:.4rem;margin-bottom:.8rem">
                      <span class="tiny ${r.permissions.length ? 'badge blue' : 'badge gray'}">${r.permissions.length} من 20 صلاحية</span>
                      <span class="tiny muted mono ltr">${esc(r.id)}</span>
                    </div>
                    <ul class="tiny" style="margin:0 0 1rem;padding-inline-start:1.2rem;line-height:1.7">
                      ${r.permissions.slice(0, 8).map((p) => `<li>${esc(permLabels[p] || p)}</li>`).join('')}
                      ${r.permissions.length > 8 ? `<li class="muted">و${r.permissions.length - 8} صلاحية أخرى…</li>` : ''}
                      ${r.permissions.length === 0 ? `<li class="muted">لا توجد صلاحيات مسندة لهذا الدور</li>` : ''}
                    </ul>
                  </div>
                  <div class="flex" style="gap:.4rem;border-top:1px solid var(--line);padding-top:.8rem;flex-wrap:wrap">
                    <button class="btn btn-sm btn-primary" data-role-act="edit" data-role-id="${esc(r.id)}" type="button" style="flex:1">
                      ${icon.edit({ size: 13, style: 'vertical-align:text-bottom;margin-left:4px' })}
                      تعديل الصلاحيات
                    </button>
                    ${isDef ? `
                      <button class="btn btn-sm" data-role-act="reset" data-role-id="${esc(r.id)}" type="button" title="استعادة الصلاحيات الافتراضية للنظام">
                        ${icon.refresh({ size: 13 })}
                      </button>
                    ` : `
                      <button class="btn btn-sm btn-danger" data-role-act="del" data-role-id="${esc(r.id)}" type="button" title="حذف هذا الدور المخصص">
                        ${icon.trash({ size: 13 })}
                      </button>
                    `}
                  </div>
                </div>
              `;
            }).join(''))}
          </div>
        </div>
      `)}
    `;

    // تبديل التبويبات
    delegate(view, 'click', '[data-tab]', async (e, btn) => {
      const t = btn.dataset.tab;
      if (t === currentTab) return;
      currentTab = t;
      if (currentTab === 'sync') {
        await loadSyncData();
      }
      draw();
    });

    if (currentTab === 'sync') {
      // أحداث تبويب المزامنة
      $('#btn-force-sync', view)?.addEventListener('click', (e) => forceSyncAction(e.target));
      $('#btn-broadcast-alert', view)?.addEventListener('click', () => broadcastAlertModal(null));
      $('#btn-revoke-all-others', view)?.addEventListener('click', revokeAllOthersAction);
      $('#btn-refresh-sessions', view)?.addEventListener('click', async () => {
        await loadSyncData();
        draw();
        toastOk('تم تحديث قائمة الجلسات النشطة');
      });

      delegate(view, 'click', '[data-session-act]', async (e, btn) => {
        const token = btn.dataset.sessionToken;
        const session = activeSessions.find((s) => s.id === token);
        if (!session) return;
        const act = btn.dataset.sessionAct;
        if (act === 'revoke') {
          revokeSessionAction(session);
        } else if (act === 'msg') {
          broadcastAlertModal(session);
        }
      });
    } else {
      // أحداث المستخدمين
      $('#new-u', view)?.addEventListener('click', () => userForm(null));

      const searchInput = $('#users-search', view);
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          userSearchQ = e.target.value;
          const filtered = filterUsers(userSearchQ);
          const tbody = $('#users-rows', view);
          if (tbody) tbody.innerHTML = renderUsersRows(filtered);
          const countEl = $('#users-count', view);
          if (countEl) {
            countEl.textContent = userSearchQ.trim() ? `${filtered.length} مطابقة من أصل ${users.length} مستخدم` : `${users.length} مستخدم`;
          }
        });
      }

      delegate(view, 'click', '[data-act]', async (e, btn) => {
        const user = users.find((u) => u.id === btn.dataset.id);
        if (!user) return;
        if (btn.dataset.act === 'edit' || btn.dataset.act === 'perms') {
          userForm(user);
        } else if (btn.dataset.act === 'del') {
          const ok = await confirmDialog({
            title: 'حذف المستخدم',
            message: `سيتم حذف المستخدم «${user.username}» وإنهاء جلساته. سجل العمليات المرتبط باسمه يبقى محفوظاً. الأفضل تعطيله بدلاً من حذفه.`,
            danger: true,
            okText: 'حذف',
          });
          if (!ok) return;
          try {
            await api.del(`/api/users/${user.id}`);
            toastOk('تم حذف المستخدم');
            await load();
            draw();
          } catch { /* تنبيه تلقائي */ }
        }
      });

      // أحداث الأدوار
      $('#btn-add-custom-role', view)?.addEventListener('click', newRoleModal);

      delegate(view, 'click', '[data-role-act]', async (e, btn) => {
        const roleId = btn.dataset.roleId;
        const role = rolesList.find((r) => r.id === roleId);
        if (!role) return;

        const act = btn.dataset.roleAct;
        if (act === 'edit') {
          editRoleModal(role);
        } else if (act === 'reset') {
          const ok = await confirmDialog({
            title: 'استعادة الصلاحيات الافتراضية',
            message: `هل أنت متأكد من استعادة الصلاحيات الافتراضية القياسية لدور «${role.label}»؟`,
            okText: 'استعادة الافتراضي',
          });
          if (!ok) return;
          try {
            await api.post(`/api/roles/${role.id}/reset`);
            await store.loadMeta();
            await load();
            draw();
            toastOk(`تمت استعادة الصلاحيات الافتراضية لدور «${role.label}»`);
          } catch { /* تنبيه تلقائي */ }
        } else if (act === 'del') {
          const ok = await confirmDialog({
            title: 'حذف الدور المخصص',
            message: `هل أنت متأكد من حذف الدور «${role.label}»؟ لن يتم حذفه إذا كان هناك مستخدمون مسندون إليه.`,
            danger: true,
            okText: 'حذف الدور',
          });
          if (!ok) return;
          try {
            await api.del(`/api/roles/${role.id}`);
            await store.loadMeta();
            await load();
            draw();
            toastOk('تم حذف الدور بنجاح');
          } catch { /* تنبيه تلقائي */ }
        }
      });
    }
  };

  await load();
  if (isAdmin && currentTab === 'sync') {
    await loadSyncData();
  }
  draw();

  // تحديث دوري خفيف لقائمة الجلسات كل 6 ثوانٍ للأدمن في تبويب المزامنة
  if (isAdmin) {
    refreshTimer = setInterval(async () => {
      if (currentTab === 'sync') {
        await loadSyncData();
        const tbody = view.querySelector('#active-sessions-tbody');
        if (tbody) {
          tbody.innerHTML = renderSessionsRows();
        }
        const liveEl = view.querySelector('#live-online-count');
        if (liveEl) {
          const onCount = activeSessions.filter((s) => s.is_online).length || 1;
          liveEl.textContent = `${onCount} متصل الآن`;
        }
      }
    }, 6000);
  }

  return () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };
}
