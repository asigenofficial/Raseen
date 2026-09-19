// ==========================================================================
//  Raseen — نقطة انطلاق الواجهة: التخطيط، القائمة، التوجيه، الجلسة.
// ==========================================================================
import { api, setUnauthorizedHandler } from './core/api.js';
import * as router from './core/router.js';
import {
  store, loadMeta, loadSession, loadIssuers, loadLookups, setActiveIssuer,
  can, onChange,
} from './core/store.js';
import { html, raw, esc, initials, toastOk, toastErr, modal, formValues, $, delegate, icon } from './core/util.js';
import * as theme from './core/theme.js';

// تهيئة الثيم فوراً عند تحميل الملف (قبل أي رسم)
theme.init();

const app = document.getElementById('app');

const NAV = [
  { group: 'العمليات اليومية' },
  { name: 'dashboard', label: 'الرئيسية', icon: icon.dashboard(), perm: 'reports.view' },
  { name: 'invoice', label: 'فاتورة جديدة', icon: icon.invoicePlus(), perm: 'invoices.create' },
  { name: 'invoices', label: 'الفواتير', icon: icon.invoice(), perm: 'invoices.view' },
  { name: 'bulk', label: 'التوليد الدفعي', icon: icon.bulk(), perm: 'bulk.generate' },
  { name: 'vouchers', label: 'سندات القبض', icon: icon.receipt(), perm: 'vouchers.view' },
  { name: 'statement', label: 'كشف حساب عميل', icon: icon.statement(), perm: 'ledger.view' },
  { group: 'البيانات الأساسية' },
  { name: 'issuers', label: 'الشركات المصدرة', icon: icon.building(), perm: 'issuers.view' },
  { name: 'templates', label: 'القوالب', icon: icon.palette(), perm: 'invoices.view' },
  { name: 'template-builder', label: 'إنشاء القوالب', icon: icon.fileSpreadsheet(), perm: 'invoices.view' },
  { name: 'clients', label: 'العملاء', icon: icon.users(), perm: 'clients.view' },
  { name: 'items', label: 'الأصناف والمجموعات', icon: icon.package(), perm: 'items.view' },
  { group: 'التقارير والرقابة' },
  { name: 'reports', label: 'التقارير المالية', icon: icon.report(), perm: 'reports.view' },
  { name: 'audit', label: 'سجل التدقيق', icon: icon.shieldCheck(), perm: 'audit.view' },
  { name: 'users', label: 'المستخدمون والصلاحيات', icon: icon.user(), perm: 'users.manage' },
  { name: 'settings', label: 'إعدادات النظام', icon: icon.settings(), perm: 'settings.write' },
];

const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  invoices: () => import('./views/invoices.js'),
  invoice: () => import('./views/invoice-editor.js'),
  'invoice-view': () => import('./views/invoice-view.js'),
  bulk: () => import('./views/bulk.js'),
  vouchers: () => import('./views/vouchers.js'),
  statement: () => import('./views/statement.js'),
  issuers: () => import('./views/issuers.js'),
  templates: () => import('./views/templates.js'),
  'template-builder': () => import('./views/template-builder.js?v=' + Date.now()),
  'doc-reports': () => import('./views/templates.js'),
  clients: () => import('./views/clients.js'),
  items: () => import('./views/items.js'),
  reports: () => import('./views/reports.js'),
  audit: () => import('./views/audit.js'),
  users: () => import('./views/users.js'),
  settings: () => import('./views/settings.js'),
};

// ------------------------------------------------------------------ الدخول
function renderLogin(message) {
  app.className = '';
  app.innerHTML = html`
    <div class="login-wrap">
      <form class="login-card" id="login-form" autocomplete="on">
        <img class="login-logo" src="/img/logo.svg" alt="Raseen" width="72" height="72" />
        <h1>Raseen</h1>
        <div class="sub">نظام إصدار الفواتير وسندات القبض والمحاسبة</div>
        ${raw(message ? `<div class="alert alert-danger">${esc(message)}</div>` : '')}
        <div class="stack">
          <div class="field">
            <label class="req">اسم المستخدم</label>
            <input type="text" name="username" class="ltr" autocomplete="username" required />
          </div>
          <div class="field">
            <label class="req">كلمة المرور</label>
            <input type="password" name="password" class="ltr" autocomplete="current-password" required />
          </div>
          <button class="btn btn-primary btn-block" type="submit">تسجيل الدخول</button>
        </div>
        <p class="tiny muted text-center mt mb0">
          كل البيانات محفوظة محلياً على هذا الجهاز — لا يتم إرسال أي معلومة لأي خدمة خارجية.
        </p>
      </form>
    </div>`;

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'جارٍ التحقق…';
    const values = formValues(e.target);
    try {
      store.user = await api.post('/api/auth/login', values, { silent: true });
      await boot();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'تسجيل الدخول';
      renderLogin(err.message || 'فشل تسجيل الدخول');
    }
  });
}

// ----------------------------------------------------------------- التخطيط
function navHtml() {
  const current = router.parseHash().name;
  const parts = [];
  let pendingGroup = null;
  for (const entry of NAV) {
    if (entry.group) { pendingGroup = entry.group; continue; }
    if (entry.perm && !can(entry.perm)) continue;
    if (pendingGroup) {
      parts.push(`<div class="nav-group-label">${esc(pendingGroup)}</div>`);
      pendingGroup = null;
    }
    const active = current === entry.name || (current === 'invoice-view' && entry.name === 'invoices');
    parts.push(`<a class="nav-item ${active ? 'active' : ''}" href="#/${entry.name}">
        ${entry.icon ? `<span class="ico">${entry.icon}</span>` : ''}<span>${esc(entry.label)}</span></a>`);
  }
  return parts.join('');
}

function issuerOptions() {
  return (store.issuers || [])
    .filter((i) => i.is_active)
    .map((i) => `<option value="${esc(i.id)}" ${i.id === store.activeIssuerId ? 'selected' : ''}>${esc(i.name_ar)}</option>`)
    .join('');
}

function renderShell() {
  app.className = '';
  app.innerHTML = html`
    <div class="layout">
      <div id="route-progress" class="route-progress" aria-hidden="true"></div>
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-head">
          <img class="sidebar-logo" src="/img/logo.svg" alt="Raseen" width="40" height="40" />
          <div>
            <div class="sidebar-title">Raseen</div>
            <div class="sidebar-sub">الفواتير والمحاسبة</div>
          </div>
        </div>
        <nav class="nav" id="nav">${raw(navHtml())}</nav>
        <button class="sidebar-edge-toggle" id="sidebar-edge-toggle" type="button" aria-label="طي / توسيع القائمة الجانبية" title="طي / توسيع القائمة الجانبية (Ctrl+B)">
          <span class="ico-toggle-arrow">${raw(icon.chevronRight({ size: 16 }))}</span>
        </button>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="burger" id="burger" type="button" aria-label="القائمة"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/></svg></button>
          <button class="sidebar-desk-toggle" id="sidebar-desk-toggle" type="button" aria-label="طي القائمة الجانبية" title="طي / توسيع القائمة الجانبية">
            ${raw(icon.chevronRight({ size: 18 }))}
          </button>
          <div class="issuer-pick">
            <label for="issuer-select">الشركة الحالية</label>
            <select id="issuer-select" style="min-width:230px">${raw(issuerOptions())}</select>
          </div>
          <div class="spacer"></div>
          <button class="theme-toggle" id="theme-toggle" type="button" aria-label="تبديل الثيم" title="تبديل الثيم الداكن / الفاتح">
            ${raw(theme.current() === 'dark' ? icon.moon({ size: 17 }) : icon.sun({ size: 17 }))}
          </button>
          <button class="user-chip" id="user-chip" type="button">
            <span class="avatar">${initials(store.user.full_name || store.user.username)}</span>
            <span class="user-meta">
              <b>${store.user.full_name || store.user.username}</b>
              <span>${store.user.role_label || store.user.role}</span>
            </span>
          </button>
        </header>
        <main class="content" id="view"></main>
      </div>
    </div>`;

  const layoutEl = app.querySelector('.layout');
  const updateToggleIcons = (collapsed) => {
    const edge = $('#sidebar-edge-toggle .ico-toggle-arrow');
    const desk = $('#sidebar-desk-toggle');
    if (edge) edge.innerHTML = collapsed ? icon.chevronLeft({ size: 16 }) : icon.chevronRight({ size: 16 });
    if (desk) desk.innerHTML = collapsed ? icon.chevronLeft({ size: 18 }) : icon.chevronRight({ size: 18 });
  };

  const setCollapsed = (collapsed) => {
    if (!layoutEl) return;
    layoutEl.classList.toggle('sidebar-collapsed', collapsed);
    localStorage.setItem('raseen_sidebar_collapsed', collapsed ? '1' : '0');
    updateToggleIcons(collapsed);
  };

  const isCollapsedInitial = localStorage.getItem('raseen_sidebar_collapsed') === '1';
  if (isCollapsedInitial) {
    setCollapsed(true);
  }

  const toggleDesktopSidebar = () => {
    if (!layoutEl) return;
    const isNow = !layoutEl.classList.contains('sidebar-collapsed');
    setCollapsed(isNow);
  };

  const toggleSidebar = (force) => {
    const sb = $('#sidebar');
    const bd = $('#sidebar-backdrop');
    if (!sb || !bd) return;
    const open = typeof force === 'boolean' ? force : !sb.classList.contains('open');
    sb.classList.toggle('open', open);
    bd.classList.toggle('active', open);
  };

  $('#sidebar-edge-toggle')?.addEventListener('click', toggleDesktopSidebar);
  $('#sidebar-desk-toggle')?.addEventListener('click', toggleDesktopSidebar);

  $('#issuer-select').addEventListener('change', (e) => {
    setActiveIssuer(e.target.value);
    router.render();
  });
  $('#burger').addEventListener('click', () => toggleSidebar());
  $('#sidebar-backdrop').addEventListener('click', () => toggleSidebar(false));
  delegate($('#nav'), 'click', '.nav-item', () => toggleSidebar(false));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleSidebar(false);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleDesktopSidebar();
    }
  });
  $('#user-chip').addEventListener('click', openUserMenu);

  // زر تبديل الثيم
  $('#theme-toggle').addEventListener('click', () => {
    theme.toggle();
    const btn = $('#theme-toggle');
    if (btn) {
      const isDark = theme.current() === 'dark';
      btn.innerHTML = isDark ? icon.moon({ size: 17 }) : icon.sun({ size: 17 });
    }
  });
}

function refreshNav() {
  const nav = $('#nav');
  if (nav) nav.innerHTML = navHtml();
  const sel = $('#issuer-select');
  if (sel) sel.innerHTML = issuerOptions();
}

function openUserMenu() {
  const m = modal({
    title: 'الحساب',
    slim: true,
    body: html`
      <dl class="kv">
        <dt>المستخدم</dt><dd>${store.user.username}</dd>
        <dt>الاسم</dt><dd>${store.user.full_name || '—'}</dd>
        <dt>الدور</dt><dd>${store.user.role_label || store.user.role}</dd>
        <dt>آخر دخول</dt><dd class="mono tiny">${store.user.last_login_at || '—'}</dd>
      </dl>
      <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0" />
      <h4 style="margin:0 0 .5rem">تغيير كلمة المرور</h4>
      <div class="stack">
        <div class="field"><label>كلمة المرور الحالية</label><input type="password" name="current_password" class="ltr" /></div>
        <div class="field"><label>كلمة المرور الجديدة (8 أحرف على الأقل)</label><input type="password" name="new_password" class="ltr" /></div>
        <button class="btn" id="chg-pass" type="button">تحديث كلمة المرور</button>
      </div>`,
    footer: `<button class="btn" data-close type="button">إغلاق</button>
             <button class="btn btn-danger" id="logout-btn" type="button">تسجيل الخروج</button>`,
  });
  m.el.querySelector('#logout-btn').addEventListener('click', async () => {
    await api.post('/api/auth/logout', {}, { silent: true });
    store.user = null;
    m.close();
    renderLogin();
  });
  m.el.querySelector('#chg-pass').addEventListener('click', async () => {
    const values = formValues(m.body);
    if (!values.current_password || !values.new_password) return toastErr('أدخل كلمة المرور الحالية والجديدة');
    try {
      await api.post('/api/auth/password', values);
      toastOk('تم تحديث كلمة المرور، يرجى تسجيل الدخول من جديد');
      m.close();
      store.user = null;
      renderLogin('تم تغيير كلمة المرور — سجّل الدخول بكلمة المرور الجديدة');
    } catch { /* التنبيه يظهر تلقائياً */ }
    return undefined;
  });
}

// ------------------------------------------------------------------ التوجيه
function guard(perm) {
  if (!perm || can(perm)) return true;
  $('#view').innerHTML = html`
    <div class="card"><div class="empty">
      <h3>لا تملك صلاحية الوصول لهذه الشاشة</h3>
      <p class="muted">الصلاحية المطلوبة: <span class="mono">${perm}</span></p>
    </div></div>`;
  return false;
}

const ROUTE_PERMS = {
  dashboard: 'reports.view',
  invoices: 'invoices.view',
  invoice: 'invoices.create',
  'invoice-view': 'invoices.view',
  bulk: 'bulk.generate',
  vouchers: 'vouchers.view',
  statement: 'ledger.view',
  issuers: 'issuers.view',
  templates: 'invoices.view',
  'template-builder': 'invoices.view',
  clients: 'clients.view',
  items: 'items.view',
  reports: 'reports.view',
  audit: 'audit.view',
  users: 'users.manage',
  settings: 'settings.write',
};

let navSeq = 0;

function startRouteProgress() {
  const bar = $('#route-progress');
  if (!bar) return;
  bar.classList.remove('finish');
  bar.classList.add('active');
}

function finishRouteProgress() {
  const bar = $('#route-progress');
  if (!bar) return;
  bar.classList.add('finish');
  setTimeout(() => {
    if (bar) bar.classList.remove('active', 'finish');
  }, 220);
}

function registerRoutes() {
  Object.keys(VIEWS).forEach((name) => {
    router.route(name, async (ctx) => {
      const seq = ++navSeq;
      refreshNav();
      const view = $('#view');
      if (!view) return undefined;
      if (!guard(ROUTE_PERMS[name])) {
        finishRouteProgress();
        return undefined;
      }

      startRouteProgress();
      const isInitial = !view.firstElementChild || view.querySelector('.boot-skeleton');

      if (isInitial) {
        view.innerHTML = html`
          <div class="skeleton-view boot-skeleton">
            <div class="skeleton-head">
              <div class="skeleton-title"></div>
              <div class="skeleton-sub"></div>
            </div>
            <div class="grid grid-4 mt">
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
            </div>
            <div class="skeleton-table mt"></div>
          </div>`;
      } else {
        view.classList.add('view-switching');
      }

      try {
        const mod = await VIEWS[name]();
        if (seq !== navSeq) return undefined;

        const cleanup = await mod.render(view, ctx);
        if (seq !== navSeq) {
          if (typeof cleanup === 'function') cleanup();
          queueMicrotask(() => router.render());
          return undefined;
        }

        view.classList.remove('view-switching');
        view.classList.remove('view-enter');
        void view.offsetWidth;
        view.classList.add('view-enter');

        window.scrollTo({ top: 0, behavior: 'instant' });
        finishRouteProgress();
        return cleanup;
      } catch (err) {
        if (seq !== navSeq) return undefined;
        console.error(err);
        view.classList.remove('view-switching');
        finishRouteProgress();
        view.innerHTML = html`<div class="card"><div class="alert alert-danger" style="display:flex;flex-direction:column;gap:6px;">
          <div style="font-weight:700;">تعذر تحميل الشاشة: ${err.message || err}</div>
          ${raw(err.stack ? `<details style="opacity:0.8;font-size:0.75rem;"><summary style="cursor:pointer;">تفاصيل الخطأ التقني</summary><pre class="mono" style="margin-top:6px;padding:8px;background:rgba(0,0,0,0.3);border-radius:4px;font-size:0.72rem;overflow-x:auto;direction:ltr;text-align:left;">${esc(err.stack)}</pre></details>` : '')}
        </div></div>`;
        return undefined;
      }
    });
  });

  router.setNotFound(() => {
    refreshNav();
    finishRouteProgress();
    const view = $('#view');
    if (!view) return;
    view.classList.remove('view-switching');
    view.innerHTML = html`<div class="card"><div class="empty">
      <h3>الصفحة غير موجودة</h3>
      <p><a href="#/dashboard">العودة إلى لوحة المعلومات</a></p></div></div>`;
  });
}

function preloadViews() {
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
  idle(() => {
    Object.values(VIEWS).forEach((loader) => {
      try { loader().catch(() => { }); } catch { /* ignore */ }
    });
  });
}

// -------------------------------------------------------------------- البدء
async function boot() {
  await loadMeta();
  if (!store.user) await loadSession();
  if (!store.user) {
    renderLogin();
    return;
  }
  await loadIssuers(true);
  loadLookups().catch(() => { });
  renderShell();
  registerRoutes();
  if (!store.issuers.length && can('issuers.write')) {
    location.hash = '#/issuers';
  }
  router.start();
  preloadViews();
}

setUnauthorizedHandler(() => {
  if (store.user) {
    store.user = null;
    renderLogin('انتهت الجلسة، يرجى تسجيل الدخول من جديد');
  }
});

onChange(() => refreshNav());

window.addEventListener('error', (e) => console.error('خطأ غير متوقع:', e.error || e.message));

boot().catch((err) => {
  console.error(err);
  app.innerHTML = html`<div class="login-wrap"><div class="login-card">
    <div class="alert alert-danger">تعذر تشغيل النظام: ${err.message || err}</div>
    <button class="btn btn-primary btn-block" onclick="location.reload()">إعادة المحاولة</button>
  </div></div>`;
});
