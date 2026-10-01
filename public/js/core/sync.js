// ==========================================================================
//  Raseen — محرك المزامنة اللحظية وإدارة الجلسات المتعددة (Live Sync Engine)
//  يدعم حتى 50 مستخدماً متزامناً في نفس اللحظة عبر Server-Sent Events (SSE)
// ==========================================================================
import { api } from './api.js';
import { store } from './store.js';
import * as router from './router.js';
import { toastOk, toastErr, modal, html, esc, raw, icon } from './util.js';

let es = null;
let heartbeatTimer = null;
let activeCount = 1;
let isConnected = false;
const listeners = new Map();

/**
 * الاشتراك في نوع معين من أحداث المزامنة
 */
export function onSync(eventType, callback) {
  if (!listeners.has(eventType)) {
    listeners.set(eventType, new Set());
  }
  listeners.get(eventType).add(callback);
  return () => {
    listeners.get(eventType)?.delete(callback);
  };
}

/**
 * نشر الحدث للمشتركين المحليين
 */
function emitLocal(eventType, data) {
  const cbs = listeners.get(eventType);
  if (cbs) {
    cbs.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[SyncEngine] خطأ في معالج الحدث:', err);
      }
    });
  }
  const wildcardCbs = listeners.get('*');
  if (wildcardCbs) {
    wildcardCbs.forEach((cb) => {
      try {
        cb(eventType, data);
      } catch (err) {
        console.error('[SyncEngine] خطأ في معالج الحدث العام:', err);
      }
    });
  }
}

/**
 * تحديث شارة الاتصال في الشريط العلوي (Top bar badge)
 */
export function updateSyncBadge(count, connected = true) {
  if (typeof count === 'number' && count > 0) {
    activeCount = count;
  }
  isConnected = connected;

  const badge = document.getElementById('sync-badge');
  const countEl = document.getElementById('sync-count');
  const labelEl = document.querySelector('#sync-badge .sync-label');

  if (!badge) return;

  if (connected) {
    badge.classList.remove('offline', 'reconnecting');
    badge.classList.add('online');
    if (labelEl) labelEl.textContent = 'متزامن';
    if (countEl) countEl.textContent = `${activeCount} متصل`;
    badge.setAttribute('title', `النظام متصل ومتزامن لحظياً (${activeCount} مستخدم متصل حالياً)`);
  } else {
    badge.classList.remove('online');
    badge.classList.add('reconnecting');
    if (labelEl) labelEl.textContent = 'إعادة الاتصال…';
    if (countEl) countEl.textContent = '—';
    badge.setAttribute('title', 'جارٍ إعادة الاتصال بالمزامنة اللحظية…');
  }
}

/**
 * الحصول على عدد المتصلين حالياً
 */
export function getActiveCount() {
  return activeCount;
}

/**
 * إرسال نبض الاتصال (Heartbeat) وتحديث الشاشة الحالية
 */
export async function sendHeartbeat(currentView) {
  if (!store.user) return;
  try {
    const viewName = currentView || router.currentView() || 'dashboard';
    const res = await api.post('/api/sync/heartbeat', { current_view: viewName }, { silent: true });
    if (res && typeof res.active_count === 'number') {
      updateSyncBadge(res.active_count, es?.readyState === EventSource.OPEN);
    }
  } catch {
    // فشل النبض - قد يكون الاتصال انقطع مؤقتاً
  }
}

/**
 * بدء محرك المزامنة اللحظية
 */
export function startSync() {
  if (!store.user) return;
  if (es) {
    es.close();
    es = null;
  }

  // 1. الاتصال المباشر عبر Server-Sent Events
  try {
    es = new EventSource('/api/sync/events');

    es.onopen = () => {
      isConnected = true;
      updateSyncBadge(activeCount, true);
    };

    es.onerror = () => {
      isConnected = false;
      updateSyncBadge(activeCount, false);
    };

    // استقبال رسالة الاتصال الأولي
    es.addEventListener('connected', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.active_count) {
          activeCount = d.active_count;
        }
        updateSyncBadge(activeCount, true);
      } catch {}
    });

    // استقبال أحداث الفواتير
    const handleInvoiceEvent = (e) => {
      try {
        const ev = JSON.parse(e.data);
        emitLocal(ev.type, ev);

        const isActor = store.user && (store.user.username === ev.actor);
        const curView = router.currentView();

        // إشعار لطيف بالعمليات التي يقوم بها مستخدمون آخرون
        if (!isActor) {
          if (ev.type === 'invoice:created') {
            const num = ev.data?.invoice_number || '';
            const client = ev.data?.client_name ? ` للعميل ${ev.data.client_name}` : '';
            toastOk(`قام ${ev.actor_name || ev.actor} بإصدار فاتورة جديدة (${num})${client}`);
          } else if (ev.type === 'invoice:bulk_created') {
            toastOk(`قام ${ev.actor_name || ev.actor} باعتماد دفعة فواتير جديدة (${ev.data?.count || ''} فاتورة)`);
          } else if (ev.type === 'invoice:cancelled') {
            toastOk(`قام ${ev.actor_name || ev.actor} بإلغاء فاتورة`);
          }
        }

        // تحديث الشاشة الحالية إذا كانت معنية بالفواتير
        if (['invoices', 'dashboard', 'statement', 'reports'].includes(curView)) {
          router.render();
        }
      } catch (err) {
        console.error('[SyncEngine] فشل معالجة حدث الفاتورة:', err);
      }
    };

    es.addEventListener('invoice:created', handleInvoiceEvent);
    es.addEventListener('invoice:updated', handleInvoiceEvent);
    es.addEventListener('invoice:cancelled', handleInvoiceEvent);
    es.addEventListener('invoice:deleted', handleInvoiceEvent);
    es.addEventListener('invoice:imported', handleInvoiceEvent);
    es.addEventListener('invoice:bulk_created', handleInvoiceEvent);

    // استقبال أحداث سندات القبض
    const handleVoucherEvent = (e) => {
      try {
        const ev = JSON.parse(e.data);
        emitLocal(ev.type, ev);

        const isActor = store.user && (store.user.username === ev.actor);
        const curView = router.currentView();

        if (!isActor && ev.type === 'voucher:created') {
          const num = ev.data?.voucher_number || '';
          toastOk(`قام ${ev.actor_name || ev.actor} بإصدار سند قبض جديد (${num})`);
        }

        if (['vouchers', 'invoices', 'dashboard', 'statement', 'reports'].includes(curView)) {
          router.render();
        }
      } catch (err) {
        console.error('[SyncEngine] فشل معالجة حدث السند:', err);
      }
    };

    es.addEventListener('voucher:created', handleVoucherEvent);
    es.addEventListener('voucher:deleted', handleVoucherEvent);

    // استقبال أحداث العملاء والأصناف
    const handleMasterDataEvent = (e) => {
      try {
        const ev = JSON.parse(e.data);
        emitLocal(ev.type, ev);
        const curView = router.currentView();
        if (['clients', 'items', 'invoice'].includes(curView)) {
          router.render();
        }
      } catch {}
    };

    es.addEventListener('client:updated', handleMasterDataEvent);
    es.addEventListener('item:updated', handleMasterDataEvent);

    // إجبار المزامنة الفورية من الأدمن
    es.addEventListener('sync:force', (e) => {
      try {
        const ev = JSON.parse(e.data);
        emitLocal('sync:force', ev);
        toastOk(`مزامنة فورية: ${ev.data?.message || 'تم تحديث البيانات بناءً على طلب مسؤول النظام'}`);
        router.render();
      } catch {}
    });

    // بث تنبيه أو رسالة فورية من الأدمن
    es.addEventListener('broadcast:alert', (e) => {
      try {
        const ev = JSON.parse(e.data);
        emitLocal('broadcast:alert', ev);
        const msg = ev.data?.message || '';
        const level = ev.data?.level || 'info';

        modal({
          title: `رسالة فورية من مسؤول النظام (${ev.actor_name || ev.actor})`,
          body: html`
            <div style="padding:1rem 0;font-size:1.05rem;line-height:1.7;color:var(--text)">
              <div class="alert ${level === 'error' ? 'alert-danger' : level === 'warning' ? 'alert-warn' : 'alert-info'}" style="margin:0;font-size:1rem">
                ${raw(icon.bell({ size: 18, style: 'vertical-align:text-bottom;margin-left:6px' }))}
                <b>تنبيه عاجل:</b> ${esc(msg)}
              </div>
            </div>
          `,
          footer: '<button class="btn btn-primary" data-close type="button">حسناً، فهمت</button>',
        });
      } catch {}
    });

    // إنهاء الجلسة أو الطرد من قبل الأدمن
    es.addEventListener('session:revoked', (e) => {
      try {
        stopSync();
        modal({
          title: 'تم إنهاء جلستك',
          body: html`
            <div style="padding:1.5rem 0;text-align:center">
              <div style="color:var(--danger);font-size:2.5rem;margin-bottom:.5rem">
                ${raw(icon.shieldCheck({ size: 48 }))}
              </div>
              <h3>تم إنهاء جلستك النشطة من قِبل مسؤول النظام</h3>
              <p class="muted">يرجى التواصل مع مسؤول النظام أو تسجيل الدخول مرة أخرى للمتابعة.</p>
            </div>
          `,
          footer: '<button class="btn btn-primary btn-block" id="btn-force-logout" type="button">الانتقال لصفحة تسجيل الدخول</button>',
        });

        document.getElementById('btn-force-logout')?.addEventListener('click', () => {
          location.reload();
        });
      } catch {}
    });

  } catch (err) {
    console.warn('[SyncEngine] فشل تشغيل SSE:', err);
  }

  // 2. تفعيل نبض الاتصال الدوري كل 20 ثانية
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  sendHeartbeat();
  heartbeatTimer = setInterval(() => {
    sendHeartbeat();
  }, 20000);
}

/**
 * إيقاف محرك المزامنة
 */
export function stopSync() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (es) {
    es.close();
    es = null;
  }
  isConnected = false;
  updateSyncBadge(1, false);
}

// نافذة معلومات المزامنة الفورية عند النقر على الشارة
export function openSyncStatusModal() {
  const isAdmin = store.user && (store.user.role === 'ADMIN');
  if (isAdmin) {
    // للأدمن: الانتقال مباشرة لتبويب المزامنة والتحكم الدقيق بالجلسات
    router.go('/users?tab=sync');
    return;
  }

  // للمستخدم العادي: نافذة معلومات المزامنة
  modal({
    title: 'حالة المزامنة والاتصال المباشر',
    slim: true,
    body: html`
      <div style="text-align:center;padding:.5rem 0">
        <div style="display:inline-flex;align-items:center;gap:.5rem;padding:.4rem 1rem;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:999px;color:#10b981;font-weight:600;margin-bottom:1rem">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981"></span>
          المزامنة اللحظية نشطة وتعمل بكفاءة
        </div>
        <p class="muted" style="margin:0 0 1rem;line-height:1.6">
          أنت متصل بالخادم المحلي وتتلقى كافة تحديثات الفواتير وسندات القبض وحركات الحسابات لحظياً فور حدوثها دون الحاجة لتحديث الصفحة يدوياً.
        </p>
        <div class="row" style="text-align:start;gap:.6rem">
          <div class="card pad0" style="flex:1;padding:.75rem;background:rgba(255,255,255,0.02)">
            <div class="tiny muted">المتصلون حالياً</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--text);margin-top:.2rem">${activeCount} مستخدم</div>
          </div>
          <div class="card pad0" style="flex:1;padding:.75rem;background:rgba(255,255,255,0.02)">
            <div class="tiny muted">تقنية التزامن</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--brand);margin-top:.2rem">Zero Latency SSE</div>
          </div>
        </div>
      </div>
    `,
    footer: '<button class="btn btn-primary btn-block" data-close type="button">إغلاق</button>',
  });
}
