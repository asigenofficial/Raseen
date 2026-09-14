// ==========================================================================
//  مكتبة الشعارات الرسمية وبدائل العرض لقوالب الفواتير
//  تحتوي على شعارات Vector SVG عالية الدقة لمنشآت النظام ونماذج جاهزة
// ==========================================================================

export function createSvgDataUrl(svgString) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString.trim().replace(/\s+/g, ' '));
}

// 1. شركة الأفق الحديث للأنظمة التقنية (Modern Horizon Tech Systems)
export const LOGO_HORIZON_TECH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
  <defs>
    <linearGradient id="mh-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#0e7490"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
    <linearGradient id="mh-glow" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0d9488"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <filter id="mh-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#06b6d4" flood-opacity="0.4"/>
    </filter>
  </defs>
  <rect x="6" y="6" width="148" height="128" rx="20" fill="url(#mh-bg)" stroke="#38bdf8" stroke-width="2" stroke-opacity="0.5"/>
  <g stroke="#38bdf8" stroke-width="1" stroke-opacity="0.25" fill="none">
    <path d="M22 32h28l14 14"/>
    <circle cx="64" cy="46" r="2.5" fill="#38bdf8" fill-opacity="0.5"/>
    <path d="M138 108h-24l-12-12"/>
    <circle cx="102" cy="96" r="2.5" fill="#38bdf8" fill-opacity="0.5"/>
  </g>
  <g filter="url(#mh-shadow)">
    <path d="M38 72 C50 48, 80 40, 122 56" stroke="#22d3ee" stroke-width="4.5" stroke-linecap="round" fill="none"/>
    <polygon points="52,42 66,28 80,48 66,62" fill="url(#mh-glow)"/>
    <polygon points="80,48 94,28 108,42 94,62" fill="#06b6d4"/>
    <polygon points="66,62 80,48 94,62 80,78" fill="#0284c7"/>
    <polygon points="80,78 94,62 108,76 94,92" fill="url(#mh-glow)"/>
    <polygon points="52,76 66,62 80,78 66,92" fill="#0d9488"/>
  </g>
  <text x="80" y="112" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="11" font-weight="900" fill="#ffffff" letter-spacing="0.5">الأفق الحديث</text>
  <text x="80" y="124" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7" font-weight="700" fill="#7dd3fc" letter-spacing="1">MODERN HORIZON</text>
</svg>`;

// 2. مؤسسة زد للتجارة والتوريدات (Z Trading & Supplies)
export const LOGO_Z_TRADING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
  <defs>
    <linearGradient id="zt-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#064e3b"/>
      <stop offset="60%" stop-color="#047857"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <linearGradient id="zt-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#ca8a04"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="148" height="128" rx="20" fill="url(#zt-bg)" stroke="url(#zt-gold)" stroke-width="2" stroke-opacity="0.7"/>
  <circle cx="80" cy="56" r="32" fill="none" stroke="url(#zt-gold)" stroke-width="2" stroke-dasharray="2.5 2.5"/>
  <circle cx="80" cy="56" r="26" fill="#064e3b" stroke="url(#zt-gold)" stroke-width="1.5"/>
  <path d="M68 44 h24 l-16 24 h18" stroke="url(#zt-gold)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M44 56 c0 12 8 20 18 22" fill="none" stroke="url(#zt-gold)" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M116 56 c0 12 -8 20 -18 22" fill="none" stroke="url(#zt-gold)" stroke-width="1.5" stroke-linecap="round"/>
  <text x="80" y="112" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="11.5" font-weight="900" fill="#fef08a">مؤسسة زاد للتجارة</text>
  <text x="80" y="124" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7.5" font-weight="700" fill="#a7f3d0" letter-spacing="1">Z TRADING &amp; SUPPLIES</text>
</svg>`;

// 3. رواسي ينبع للاتصالات (Rawasi Telecom)
export const LOGO_RAWASI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
  <defs>
    <linearGradient id="rw-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="60%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="148" height="128" rx="20" fill="url(#rw-bg)" stroke="#60a5fa" stroke-width="2" stroke-opacity="0.5"/>
  <g transform="translate(80,54)" fill="none" stroke="#38bdf8" stroke-linecap="round">
    <circle cx="0" cy="0" r="7" fill="#38bdf8"/>
    <path d="M-15 -10 C-7 -19, 7 -19, 15 -10" stroke-width="2.8"/>
    <path d="M-22 -17 C-11 -30, 11 -30, 22 -17" stroke-width="2.8"/>
    <path d="M-15 10 C-7 19, 7 19, 15 10" stroke-width="2.8"/>
    <path d="M-22 17 C-11 30, 11 30, 22 17" stroke-width="2.8"/>
  </g>
  <text x="80" y="112" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="11.5" font-weight="900" fill="#ffffff">رواسي للاتصالات</text>
  <text x="80" y="124" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7.5" font-weight="700" fill="#93c5fd" letter-spacing="1">RAWASI TELECOM</text>
</svg>`;

// 4. الزهراني للمقاولات والحديد (Al-Zahrani Contracting)
export const LOGO_ZAHRANI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
  <defs>
    <linearGradient id="zh-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="60%" stop-color="#27272a"/>
      <stop offset="100%" stop-color="#3f3f46"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="148" height="128" rx="20" fill="url(#zh-bg)" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
  <g transform="translate(80,54)">
    <polygon points="0,-24 22,-11 22,15 0,26 -22,15 -22,-11" fill="#27272a" stroke="#f59e0b" stroke-width="2.2"/>
    <path d="M-12 -5 L12 9 M-12 9 L12 -5" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="0" y1="-24" x2="0" y2="26" stroke="#f59e0b" stroke-width="2"/>
  </g>
  <text x="80" y="112" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="11" font-weight="900" fill="#ffffff">الزهراني للمقاولات</text>
  <text x="80" y="124" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7" font-weight="700" fill="#fbbf24" letter-spacing="1">STEEL &amp; CONTRACTING</text>
</svg>`;

// 5. أوتاد البدر للخدمات اللوجستية والنقل (Awtad Logistics)
export const LOGO_AWTAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
  <defs>
    <linearGradient id="aw-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#042f2e"/>
      <stop offset="60%" stop-color="#0f766e"/>
      <stop offset="100%" stop-color="#14b8a6"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="148" height="128" rx="20" fill="url(#aw-bg)" stroke="#5eead4" stroke-width="2" stroke-opacity="0.6"/>
  <g transform="translate(80,52)" fill="none" stroke="#fed7aa" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-22 8 L-6 -14 L10 4 L22 -16" stroke="#f97316" stroke-width="3.5"/>
    <polygon points="22,-16 14,-15 19,-8" fill="#f97316"/>
    <circle cx="-6" cy="14" r="3.5" fill="#5eead4"/>
    <circle cx="10" cy="14" r="3.5" fill="#5eead4"/>
  </g>
  <text x="80" y="112" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="11" font-weight="900" fill="#ffffff">أوتاد للخدمات اللوجستية</text>
  <text x="80" y="124" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7" font-weight="700" fill="#5eead4" letter-spacing="1">AWTAD LOGISTICS</text>
</svg>`;

// 6. رواد الاتحاد للهندسة والتجارة (Rowad Al-Ittihad)
export const LOGO_ROWAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
  <defs>
    <linearGradient id="ri-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#052e16"/>
      <stop offset="60%" stop-color="#15803d"/>
      <stop offset="100%" stop-color="#22c55e"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="148" height="128" rx="20" fill="url(#ri-bg)" stroke="#86efac" stroke-width="2" stroke-opacity="0.6"/>
  <g transform="translate(80,52)" stroke="#fef08a" fill="none" stroke-width="2.5" stroke-linecap="round">
    <!-- Architecture compass & pillar -->
    <path d="M0 -22 L-16 16 M0 -22 L16 16"/>
    <line x1="-10" y1="4" x2="10" y2="4"/>
    <circle cx="0" cy="-22" r="3" fill="#fef08a"/>
  </g>
  <text x="80" y="112" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="11" font-weight="900" fill="#ffffff">رواد الاتحاد للمقاولات</text>
  <text x="80" y="124" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7" font-weight="700" fill="#86efac" letter-spacing="1">ROWAD AL-ITTIHAD</text>
</svg>`;

export const PRESET_LOGOS = [
  {
    id: 'logo-horizon',
    name: 'الأفق للأنظمة التقنية',
    name_en: 'Modern Horizon Tech',
    color: '#06b6d4',
    badge: 'تقني رقمي',
    svg: LOGO_HORIZON_TECH_SVG,
    dataUrl: createSvgDataUrl(LOGO_HORIZON_TECH_SVG),
  },
  {
    id: 'logo-z-trading',
    name: 'زاد للتجارة والتوريدات',
    name_en: 'Z Trading & Supplies',
    color: '#059669',
    badge: 'تجاري رسمي',
    svg: LOGO_Z_TRADING_SVG,
    dataUrl: createSvgDataUrl(LOGO_Z_TRADING_SVG),
  },
  {
    id: 'logo-rawasi',
    name: 'رواسي ينبع للاتصالات',
    name_en: 'Rawasi Telecom',
    color: '#2563eb',
    badge: 'اتصالات وتجزئة',
    svg: LOGO_RAWASI_SVG,
    dataUrl: createSvgDataUrl(LOGO_RAWASI_SVG),
  },
  {
    id: 'logo-zahrani',
    name: 'الزهراني للمقاولات والحديد',
    name_en: 'Al-Zahrani Contracting',
    color: '#f59e0b',
    badge: 'حديد ومقاولات',
    svg: LOGO_ZAHRANI_SVG,
    dataUrl: createSvgDataUrl(LOGO_ZAHRANI_SVG),
  },
  {
    id: 'logo-awtad',
    name: 'أوتاد البدر اللوجستية',
    name_en: 'Awtad Logistics',
    color: '#0f766e',
    badge: 'نقل وشحن',
    svg: LOGO_AWTAD_SVG,
    dataUrl: createSvgDataUrl(LOGO_AWTAD_SVG),
  },
  {
    id: 'logo-rowad',
    name: 'رواد الاتحاد للمقاولات',
    name_en: 'Rowad Al-Ittihad',
    color: '#15803d',
    badge: 'هندسي وعمراني',
    svg: LOGO_ROWAD_SVG,
    dataUrl: createSvgDataUrl(LOGO_ROWAD_SVG),
  },
];

/**
 * بديل احترافي للشعار عند عدم رفعه؛ بدلاً من النص الخام (شر).
 */
export function buildLogoPlaceholderSvg({
  brandColor = '#06b6d4',
  brandDark = '#0891b2',
  width = '26mm',
  height = '22mm',
} = {}) {
  return `<div class="logo-fallback" style="width:${width};height:${height};" title="شعار المنشأة">
    <svg viewBox="0 0 110 88" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;max-height:100%;max-width:100%;overflow:visible;">
      <defs>
        <linearGradient id="lfb-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${brandColor}" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="${brandDark}" stop-opacity="0.22"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="106" height="84" rx="8" fill="url(#lfb-grad)" stroke="${brandColor}" stroke-width="1.6" stroke-dasharray="3.5 2.5"/>
      <g transform="translate(55, 32)" stroke="${brandDark}" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="-18" y="-13" width="36" height="26" rx="4.5" />
        <circle cx="-6" cy="-3" r="3.2" fill="${brandDark}" />
        <path d="M-15 9 L-5 -2 L4 6 L10 0 L15 9" />
      </g>
      <text x="55" y="65" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="8.8" font-weight="700" fill="${brandDark}">شعار المنشأة</text>
      <text x="55" y="76" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="6.5" font-weight="600" fill="#64748b" letter-spacing="0.5">LOGO AREA</text>
    </svg>
  </div>`;
}
