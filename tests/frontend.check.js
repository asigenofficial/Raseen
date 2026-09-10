'use strict';
/**
 * تحقق ثابت من الواجهة: كل اسم مستورد بين وحدات public/js يجب أن يكون مُصدَّراً فعلاً،
 * ولا يجب أن تبقى استيرادات غير مستخدمة. يُشغَّل بـ: node tests/frontend.check.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public', 'js');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') && !p.includes(`${path.sep}vendor${path.sep}`)) files.push(p);
  }
}(ROOT));

const exportsOf = new Map();
const importsOf = new Map();

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/gm;
const EXPORT_DECL_RE = /^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]+)\}/gm;
const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
const IMPORT_NS_RE = /import\s*\*\s*as\s*([A-Za-z0-9_$]+)\s*from\s*['"]([^'"]+)['"]/g;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  let m;
  for (const re of [EXPORT_RE, EXPORT_DECL_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(src))) names.add(m[1]);
  }
  EXPORT_LIST_RE.lastIndex = 0;
  while ((m = EXPORT_LIST_RE.exec(src))) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean)
      .forEach((s) => names.add(s.split(/\s+as\s+/).pop().trim()));
  }
  exportsOf.set(file, names);

  const imports = [];
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const target = path.resolve(path.dirname(file), m[2]);
    const list = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
      return { orig, local: alias || orig };
    });
    imports.push({ target, list, spec: m[2] });
  }
  IMPORT_NS_RE.lastIndex = 0;
  while ((m = IMPORT_NS_RE.exec(src))) {
    imports.push({ target: path.resolve(path.dirname(file), m[2]), ns: m[1], list: [], spec: m[2] });
  }
  importsOf.set(file, { src, imports });
}

/** هل الاسم مستخدم فعلاً في الجسم؟ يتعامل مع أسماء مثل $ و$$ التي لا تحدّها \b. */
function isUsed(body, name) {
  const esc = name.replace(/[$]/g, '\\$');
  if (/^[A-Za-z_]/.test(name)) return new RegExp(`\\b${esc}\\b`).test(body);
  return new RegExp(`${esc}\\s*[(.[]`).test(body);
}

const problems = [];
let checkedNames = 0;

for (const [file, { src, imports }] of importsOf) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const body = src.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?/gm, '');
  for (const imp of imports) {
    if (!fs.existsSync(imp.target)) {
      problems.push(`${rel}: ملف غير موجود «${imp.spec}»`);
      continue;
    }
    const available = exportsOf.get(imp.target);
    const targetRel = path.relative(ROOT, imp.target).replace(/\\/g, '/');
    for (const { orig, local } of imp.list) {
      checkedNames++;
      if (available && !available.has(orig)) {
        problems.push(`${rel}: «${orig}» غير مُصدَّر من ${targetRel}`);
      }
      if (!isUsed(body, local)) problems.push(`${rel}: استيراد غير مستخدم «${local}»`);
    }
    if (imp.ns) {
      checkedNames++;
      if (!new RegExp(`\\b${imp.ns}\\.`).test(body)) problems.push(`${rel}: استيراد نطاق غير مستخدم «${imp.ns}»`);
    }
  }
}

// كل شاشة يجب أن تُصدّر render
for (const file of files) {
  if (!file.includes(`${path.sep}views${path.sep}`)) continue;
  if (!exportsOf.get(file).has('render')) {
    problems.push(`${path.relative(ROOT, file)}: لا يصدّر الدالة render`);
  }
}

console.log(`تم فحص ${files.length} وحدة و${checkedNames} اسماً مستورداً.`);
if (problems.length) {
  console.log(`مشاكل (${problems.length}):`);
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
console.log('لا توجد مشاكل في الاستيرادات والتصديرات.');
