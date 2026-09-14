'use strict';
/**
 * الشعارات الرسمية الافتراضية لمنشآت النظام وبديل الشعار لعرض PDF والطباعة.
 */

function createSvgDataUrl(svgString) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString.trim().replace(/\s+/g, ' '));
}

const LOGO_HORIZON_TECH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
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

const LOGO_Z_TRADING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
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

const LOGO_DARB_SHARQ_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140" width="160" height="140">
  <defs>
    <linearGradient id="ds-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#172554"/>
      <stop offset="60%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="148" height="128" rx="20" fill="url(#ds-bg)" stroke="#60a5fa" stroke-width="2" stroke-opacity="0.6"/>
  <g transform="translate(80,52)" fill="none" stroke="#f97316" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-20 10 L0 -18 L20 10 L0 2 Z"/>
    <circle cx="0" cy="-6" r="3.5" fill="#f97316"/>
  </g>
  <text x="80" y="112" text-anchor="middle" font-family="'Cairo', 'Segoe UI', sans-serif" font-size="11" font-weight="900" fill="#ffffff">درب الشرق اللوجستية</text>
  <text x="80" y="124" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7.5" font-weight="700" fill="#93c5fd" letter-spacing="1">DARB AL-SHARQ LOGISTICS</text>
</svg>`;

function buildLogoPlaceholderSvg({ brandColor = '#06b6d4', brandDark = '#0891b2' } = {}) {
  return `<svg viewBox="0 0 110 88" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;max-height:100%;max-width:100%;overflow:visible;">
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
  </svg>`;
}

module.exports = {
  createSvgDataUrl,
  LOGO_HORIZON_TECH_SVG,
  LOGO_Z_TRADING_SVG,
  LOGO_DARB_SHARQ_SVG,
  LOGO_HORIZON_TECH_DATA_URL: createSvgDataUrl(LOGO_HORIZON_TECH_SVG),
  LOGO_Z_TRADING_DATA_URL: createSvgDataUrl(LOGO_Z_TRADING_SVG),
  LOGO_DARB_SHARQ_DATA_URL: createSvgDataUrl(LOGO_DARB_SHARQ_SVG),
  buildLogoPlaceholderSvg,
};
