# ==============================================================================
#  Raseen — Dockerfile للنشر السحابي والإنتاج
#  مبني على Node.js 22 Alpine خفيف وسريع، بصفر اعتماديات خارجية (Zero-Dependencies)
# ==============================================================================
FROM node:22-alpine

# ضبط بيئة التشغيل للإنتاج
ENV NODE_ENV=production \
    PORT=4711 \
    ZS_HOST=0.0.0.0 \
    ZS_DATA_DIR=/app/data

# مجلد العمل
WORKDIR /app

# نسخ ملفات المشروع وملفات الخادم والواجهة
COPY package.json ./
COPY server/ ./server/
COPY public/ ./public/

# إنشاء مجلد البيانات ومنح صلاحيات الكتابة لمستخدم node
RUN mkdir -p /app/data && chown -R node:node /app

# التبديل إلى مستخدم غير جذري لتعزيز الأمان
USER node

# ملاحظة: تم إزالة تعليمة VOLUME لأن منصات مثل Railway لا تدعمها في Dockerfile.
# يمكن إضافة قرص تخزين دائم (Railway Volume) من لوحة التحكم مع مسار: /app/data

# المنفذ
EXPOSE 4711

# فحص صحة الحاوية التلقائي (Healthcheck)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4711) + '/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# أمر التشغيل المباشر
CMD ["node", "--no-warnings", "server/index.js"]
