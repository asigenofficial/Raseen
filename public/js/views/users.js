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

  /** رسم الصفحة الرئيسية للمستخدمين والأدوار */
  const draw = () => {
    const meta = store.meta || {};
    const permLabels = meta.permission_labels || {};
    const admins = users.filter((u) => u.role === 'ADMIN' && u.is_active).length;

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>المستخدمون والصلاحيات</h1>
          <p>${users.length} مستخدم مسجل — ${admins} مدير نظام نشط. الصلاحيات تُطبّق وتُراقب على مستوى الخادم وقاعدة البيانات.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="new-u" type="button">
            ${icon.userPlus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}
            مستخدم جديد
          </button>
        </div>
      </div>

      ${raw(users.some((u) => u.username === 'admin')
        ? '<div class="alert alert-warn">حساب المدير الافتراضي <b>admin</b> لا يزال موجوداً بكلمة المرور الأولية. غيّر كلمة المرور فوراً من قائمة المستخدم أعلى الشاشة، أو أنشئ حساباً باسمك واحذفه.</div>'
        : '')}

      <!-- جدول المستخدمين -->
      <div class="card pad0">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>الصلاحيات الفعالة</th>
              <th>آخر دخول</th><th>تاريخ الإنشاء</th><th></th></tr></thead>
            <tbody>
              ${raw(users.map((u) => {
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
                    <span class="badge blue">${u.permissions.length} صلاحية</span>
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
              }).join(''))}
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
    `;

    // أحداث المستخدمين
    $('#new-u', view).addEventListener('click', () => userForm(null));

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
    $('#btn-add-custom-role', view).addEventListener('click', newRoleModal);

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
  };

  await load();
  draw();
  return undefined;
}
