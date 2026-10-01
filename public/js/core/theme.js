// ==========================================================================
//  نظام الثيمات — داكن (Dark) وفاتح (Light)
//  يحفظ الاختيار في localStorage ويطبّقه فوراً على عنصر <html>.
// ==========================================================================

const STORAGE_KEY = 'raseen_theme';
const DARK  = 'dark';
const LIGHT = 'light';

/** القيمة الحالية للثيم. */
export function current() {
  return localStorage.getItem(STORAGE_KEY) || DARK;
}

/** تطبيق الثيم على الصفحة. */
export function apply(theme) {
  const t = theme === LIGHT ? LIGHT : DARK;
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('color-scheme', t);
  localStorage.setItem(STORAGE_KEY, t);

  // تحديث لون شريط المتصفح على الهواتف الذكية فوراً
  const themeMeta = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', t === LIGHT ? '#f4f6f8' : '#090d16');
  }
}

/** تبديل الثيم بين الداكن والفاتح. */
export function toggle() {
  apply(current() === DARK ? LIGHT : DARK);
}

/** تهيئة الثيم عند تحميل الصفحة. */
export function init() {
  apply(current());
}
