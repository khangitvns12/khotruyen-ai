# ============================================================
# KhoTruyện AI — Engine service (Bun)
# Dùng cho Railway / Render / Fly.io / VPS có Docker.
#
# Railway:  New Project → Deploy from GitHub repo →
#           Settings → Root Directory = mini-services/engine-service
#           (Railway tự nhận diện Dockerfile này)
# Volume:   Variables → Volume → mount tại /data (SQLite bền vững)
# ============================================================
FROM oven/bun:1

# curl cần cho module fetch của engine (đứng đầu Cloudflare TLS fingerprint
# khi cào 69shuba & bạn — fetch thuần của Bun dễ bị chặn 403).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài dependencies trước để tận dụng layer cache
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy mã nguồn
COPY . .

# Thư mục dữ liệu — mount volume của platform vào đây
RUN mkdir -p /data

# SQLite bền vững qua volume; PORT do platform tự gán (mặc định 3002)
ENV ENGINE_DB=/data/custom.db

EXPOSE 3002

CMD ["bun", "index.ts"]
