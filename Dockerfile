# ─── مرحلة البناء ─────────────────────────────────────────────────────────────
FROM golang:bookworm AS builder
ENV GOTOOLCHAIN=auto

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -ldflags="-w -s" -o raseen .

# ─── مرحلة التشغيل ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# تثبيت Chromium والخطوط العربية (Kacst, Amiri, Noto) وأدوات الخطوط لمنع ظهور النصوص كمربعات في الـ PDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-kacst \
    fonts-hosny-amiri \
    fonts-noto-core \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fontconfig \
    libglib2.0-0 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    ca-certificates \
    curl \
    && fc-cache -f -v \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# نسخ الـ binary من مرحلة البناء
COPY --from=builder /app/raseen .

# نسخ الملفات الثابتة (قوالب، JS، CSS، إلخ)
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data

EXPOSE 8080

CMD ["./raseen"]
