# syntax=docker/dockerfile:1

# ---- 1. Bağımlılıklar --------------------------------------------------------
FROM node:22.23.3-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. Kalite kontrolü (typecheck, lint, biçim, birim/entegrasyon testleri) --
FROM deps AS check
COPY . .
RUN npm run check

# ---- 3. Üretim derlemesi ------------------------------------------------------
# `check` aşamasından türetilir; kontroller geçmeden derleme alınamaz.
FROM check AS build
RUN npm run build

# ---- 3b. Yalnızca dist/ çıktısı (Node.js kurmadan statik dosya almak için) -----
#   docker build --target dist --output type=local,dest=./dist .
FROM scratch AS dist
COPY --from=build /app/dist /

# ---- 4. Yayın katmanı: yalnızca statik dosyalar ve Nginx -----------------------
FROM nginx:1.30-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
