# syntax=docker/dockerfile:1

# ---- builder: install prod deps + compile native modules ------------------
# The full (non-slim) node image is buildpack-deps based, so it has the g++/
# python3/make toolchain that better-sqlite3 and sharp fall back to if a
# prebuilt binary isn't available. Building here (Linux) also means the native
# binaries match the runtime, regardless of what OS you develop on.
FROM node:24-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime: slim image + ffmpeg -----------------------------------------
FROM node:24-bookworm-slim AS runtime

# ffmpeg powers video probing + gallery preview generation. services/video.js
# finds it on PATH, so no FFMPEG_PATH needed in the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Linux node_modules from the builder stage (never the host's — see .dockerignore).
COPY --from=builder /app/node_modules ./node_modules

# Application source. .dockerignore keeps node_modules/uploads/data/.env out.
COPY . .

# These are also bind-mounted as volumes in compose; create them so the app can
# write even if run without the mounts.
RUN mkdir -p data uploads

EXPOSE 3000

# Uses node (curl isn't in the slim image); see server/scripts/healthcheck.js.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "server/scripts/healthcheck.js"]

CMD ["node", "server/index.js"]
