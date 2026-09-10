#!/usr/bin/env bash
# ==============================================================================
#  Raseen — سكربت النسخ الاحتياطي الدوري لقاعدة بيانات SQLite بأمان
#  يقوم بعمل نسخة متسقة وغير قابلة للتلف، ثم ضغطها وحذف النسخ الأقدم من 30 يوماً
# ==============================================================================
set -euo pipefail

DATA_DIR="${ZS_DATA_DIR:-./data}"
BACKUP_DIR="${DATA_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
TARGET_FILE="${BACKUP_DIR}/zsystem_backup_${TIMESTAMP}.db"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] بدء عملية النسخ الاحتياطي لقاعدة البيانات..."

# تنفيذ النسخ المتسق باستخدام node و VACUUM INTO
node --no-warnings -e "
  const db = require('./server/db');
  db.open();
  const res = db.createBackup('${TARGET_FILE}');
  console.log('تم إنشاء النسخة بنجاح:', res.filename, 'الحجم:', res.sizeBytes, 'بايت');
  db.close();
"

# ضغط ملف النسخة الاحتياطية لتوفير المساحة
if command -v gzip >/dev/null 2>&1; then
    gzip -f "${TARGET_FILE}"
    echo "[$(date)] تم ضغط النسخة الاحتياطية: ${TARGET_FILE}.gz"
fi

# حذف النسخ الأقدم من 30 يوماً
find "${BACKUP_DIR}" -type f -name "zsystem_backup_*.db*" -mtime +30 -delete
echo "[$(date)] اكتملت عملية النسخ الاحتياطي بنجاح."
