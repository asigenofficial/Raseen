// ==========================================================================
//  إدارة المستخدمين والصلاحيات.
// ==========================================================================
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import {
  html, raw, esc, dateTimeAr, initials, toastOk, toastErr,
  $, $$, delegate, modal, formValues, confirmDialog, icon,
} from '../core/util.js';

const ROLE_TONE = { ADMIN: 'red', ACCOUNTANT: 'blue', VIEWER: 'gray' };

export async function render(view) {
  const meta = store.meta;
  const rolePerms = meta.role_permissions || {};
  const permLabels = meta.permission_labels || {};
  let users = [];

  const load = async () => { users = await api.get('/api/users'); };

  const userForm = (user) => {
    const isNew = !user;
    const role = user ? user.role : 'ACCOUNTANT';
    const base = rolePerms[role] || [];
    const extras = user ? user.permissions.filter((p) => !base.includes(p)) : [];

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
          <div class="field" style="max-width:180px"><label>الدور</label>
            <select name="role" id="u-role">
              ${raw(Object.entries(meta.roles).map(([k, v]) => `<option value="${esc(k)}" ${k === role ? 'selected' : ''}>${esc(v)}</option>`).join(''))}
            </select></div>
        </div>
        <div class="row mt">
          <div class="field"><label ${raw(isNew ? 'class="req"' : '')}>كلمة المرور</label>
            <input type="password" name="password" autocomplete="new-password" placeholder="${raw(isNew ? '8 خانات على الأقل' : 'اتركها فارغة لعدم التغيير')}" />
            <span class="hint">${raw(isNew ? '' : 'تغيير كلمة المرور يُنهي جلسات المستخدم الحالية')}</span></div>
          <div class="field" style="max-width:200px"><label>الحالة</label>
            <label class="check mt"><input type="checkbox" name="is_active" ${raw(!user || user.is_active ? 'checked' : '')} /> مستخدم نشط</label></div>
        </div>
        <h4 class="mt">الصلاحيات</h4>
        <p class="tiny muted">الصلاحيات المظللة ممنوحة تلقائياً من الدور، ويمكنك منح صلاحيات إضافية فوقها.</p>
        <div class="perm-grid" id="u-perms">
          ${raw(meta.permissions.map((p) => `<label class="check perm" data-perm="${esc(p)}">
            <input type="checkbox" value="${esc(p)}" ${base.includes(p) || extras.includes(p) ? 'checked' : ''} ${base.includes(p) ? 'data-base="1"' : ''} />
            <span>${esc(permLabels[p] || p)}<code class="tiny muted ltr"> ${esc(p)}</code></span>
          </label>`).join(''))}
        </div>`,
      footer: `<button class="btn" data-close type="button">إلغاء</button>
               <button class="btn btn-primary" data-ok type="button">${isNew ? 'إضافة المستخدم' : 'حفظ التعديلات'}</button>`,
    });

    const syncBase = () => {
      const r = $('#u-role', m.body).value;
      const rb = rolePerms[r] || [];
      $$('.perm', m.body).forEach((label) => {
        const cb = label.querySelector('input');
        const isBase = rb.includes(label.dataset.perm);
        label.classList.toggle('locked', isBase);
        if (isBase) {
          cb.checked = true;
          cb.dataset.base = '1';
          cb.disabled = true;
        } else {
          delete cb.dataset.base;
          cb.disabled = false;
        }
      });
    };
    syncBase();
    $('#u-role', m.body).addEventListener('change', syncBase);

    m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
      const values = formValues(m.body);
      const r = values.role;
      const rb = rolePerms[r] || [];
      const checked = $$('#u-perms input:checked', m.body).map((cb) => cb.value);
      const payload = {
        full_name: values.full_name,
        role: r,
        is_active: !!values.is_active,
        permissions: checked.filter((p) => !rb.includes(p)),
      };
      if (isNew) {
        payload.username = values.username;
        payload.password = values.password;
        if (!payload.username) return toastErr('اسم المستخدم مطلوب');
        if (!payload.password || payload.password.length < 8) return toastErr('كلمة المرور 8 خانات على الأقل');
      } else if (values.password) payload.password = values.password;

      e.target.disabled = true;
      try {
        if (isNew) await api.post('/api/users', payload);
        else await api.put(`/api/users/${user.id}`, payload);
        toastOk(isNew ? 'تمت إضافة المستخدم' : 'تم حفظ التعديلات');
        m.close();
        await load();
        draw();
      } catch { e.target.disabled = false; }
      return undefined;
    });
  };

  const draw = () => {
    const admins = users.filter((u) => u.role === 'ADMIN' && u.is_active).length;
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>المستخدمون والصلاحيات</h1>
          <p>${users.length} مستخدم — ${admins} مدير نظام نشط. الصلاحيات تُطبَّق على الخادم وليس في الواجهة فقط.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="new-u" type="button">${icon.userPlus({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}مستخدم جديد</button>
        </div>
      </div>

      ${raw(users.some((u) => u.username === 'admin')
    ? '<div class="alert alert-warn">حساب المدير الافتراضي <b>admin</b> لا يزال موجوداً بكلمة المرور الأولية. غيّر كلمة المرور فوراً من قائمة المستخدم أعلى الشاشة، أو أنشئ حساباً باسمك واحذفه.</div>'
    : '')}

      <div class="card pad0">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>عدد الصلاحيات</th>
              <th>آخر دخول</th><th>تاريخ الإنشاء</th><th></th></tr></thead>
            <tbody>
              ${raw(users.map((u) => {
    const base = rolePerms[u.role] || [];
    const extra = u.permissions.filter((p) => !base.includes(p)).length;
    return `<tr class="${u.is_active ? '' : 'row-off'}">
      <td><div class="flex" style="gap:.5rem;align-items:center">
        <div class="avatar sm">${esc(initials(u.full_name || u.username))}</div>
        <div><b>${esc(u.full_name || u.username)}</b>
          <div class="tiny muted ltr mono">${esc(u.username)}</div></div>
      </div></td>
      <td><span class="badge ${ROLE_TONE[u.role] || 'gray'}">${esc(u.role_label)}</span></td>
      <td>${u.is_active ? '<span class="badge green">نشط</span>' : '<span class="badge gray">معطّل</span>'}</td>
      <td class="tiny">${u.permissions.length}${extra ? ` <span class="badge blue tiny">+${extra} إضافية</span>` : ''}</td>
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

      <div class="card">
        <h3>الأدوار الجاهزة</h3>
        <div class="grid grid-3">
          ${raw(Object.entries(meta.roles).map(([k, label]) => `<div class="mini-card">
            <div class="flex"><span class="badge ${ROLE_TONE[k] || 'gray'}">${esc(label)}</span>
              <div class="spacer"></div><span class="tiny muted">${(rolePerms[k] || []).length} صلاحية</span></div>
            <ul class="tiny mt" style="margin:0;padding-inline-start:1rem">
              ${(rolePerms[k] || []).slice(0, 8).map((p) => `<li>${esc(permLabels[p] || p)}</li>`).join('')}
              ${(rolePerms[k] || []).length > 8 ? `<li class="muted">و${(rolePerms[k] || []).length - 8} صلاحية أخرى…</li>` : ''}
            </ul>
          </div>`).join(''))}
        </div>
      </div>`;

    $('#new-u', view).addEventListener('click', () => userForm(null));
    delegate(view, 'click', '[data-act]', async (e, btn) => {
      const user = users.find((u) => u.id === btn.dataset.id);
      if (!user) return;
      if (btn.dataset.act === 'edit' || btn.dataset.act === 'perms') userForm(user);
      else if (btn.dataset.act === 'del') {
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
  };

  await load();
  draw();
  return undefined;
}
