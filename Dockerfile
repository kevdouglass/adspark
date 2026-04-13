# syntax=docker/dockerfile:1.6
#
# AdSpark — multi-stage container build.
#
# Strategy: two stages, no separate prod-deps stage.
#
#   1. `builder`  — installs ALL deps (devDeps needed for `next build`),
#                   runs the build, emits `.next/standalone`.
#   2. `runner`   — copies ONLY the standalone server + public assets.
#                   Standalone's own minimal `node_modules` is bundled
#                   inside `.next/standalone/node_modules`, so we don't
#                   need a separate npm install step in the runner at all.
#
# Why no third stage with `npm ci --omit=dev`: Next.js standalone output
# is already production-pruned. Adding a third stage would duplicate work
# and grow the image without benefit.
#
# Base image: node:22-bookworm-slim
#   - Node 22 is Active LTS; Node 20 hits EOL April 2026.
#   - bookworm-slim (debian, glibc) is required because @napi-rs/canvas
#     does not ship musl prebuilts (alpine would break at runtime).
#   - `-slim` variant strips build-time packages we don't need at runtime.
#
# Tag pinning: the floating `node:22-bookworm-slim` tag is acceptable
# for a take-home deliverable. For production, pin by digest:
#   FROM node:22-bookworm-slim@sha256:<digest>

# ---------------------------------------------------------------------------
# Stage 1: builder — compiles Next.js app
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install deps first in its own layer so edits to source don't invalidate
# the npm cache layer. package.json + package-lock.json are the only
# inputs that affect the dep install.
COPY package.json package-lock.json ./

# BuildKit cache mount — npm downloads persist across builds without
# bloating the image. Requires `# syntax=docker/dockerfile:1.6` at
# the top of the file AND BuildKit enabled in the Docker daemon
# (default on Docker Desktop 4.x+).
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy source AFTER dep install so source edits only bust the build
# layer, not the dep install layer.
COPY . .

# APP_VERSION is injected via docker build --build-arg for healthz
# reporting. Falls back to "dev" if the caller doesn't pass one.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# Disable Next.js anonymous telemetry pings at build time so the
# container build is fully offline-reproducible.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: runner — minimal runtime image
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# CRITICAL: bind Next.js standalone to all interfaces.
#
# The standalone server reads HOSTNAME at startup. When unset, it binds
# to one specific interface (often eth0's container IP like 172.19.0.2),
# NOT to loopback. That means:
#   1. External `docker compose up -d` + host port mapping still works
#      because Docker forwards from the host to the container IP.
#   2. But the container-internal HEALTHCHECK probe fetching
#      `http://localhost:3000` or `http://127.0.0.1:3000` FAILS because
#      nothing is listening on loopback inside the container.
#
# Setting HOSTNAME=0.0.0.0 makes Next.js bind to every interface (eth0
# AND loopback), so the probe works AND external access keeps working.
# This is a Next.js 15 standalone-mode gotcha — not documented clearly
# but reproducible 100% of the time without this line.
ENV HOSTNAME=0.0.0.0

# Absolute path for the local-mode output directory.
#
# CRITICAL: Next.js standalone mode changes the process working
# directory to `/app/.next/standalone` at startup. The files route
# and the LocalStorage factory both resolve `LOCAL_OUTPUT_DIR`
# relative to cwd, which means a relative default like `./output`
# would silently resolve to `/app/.next/standalone/output` — an
# empty directory that isn't volume-mounted.
#
# Setting this to an absolute path pins the directory regardless of
# cwd and matches the volume mount target in docker-compose.yml.
ENV LOCAL_OUTPUT_DIR=/app/output

# Create a dedicated non-root user + group so a container escape
# doesn't have root. UID/GID 1001 are convention for Node container
# images (matches the `node` user baked into the official image).
#
# Creating the output directory here + chowning means the non-root
# user can write into a named volume at runtime without additional
# setup on the host.
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs adspark && \
    mkdir -p /app/output /app/.next/cache && \
    chown -R adspark:nodejs /app

# Copy the standalone server, static assets, and public folder.
# Standalone output requires these three paths in exactly this layout.
COPY --from=builder --chown=adspark:nodejs /app/public ./public
COPY --from=builder --chown=adspark:nodejs /app/.next/standalone ./
COPY --from=builder --chown=adspark:nodejs /app/.next/static ./.next/static

USER adspark

EXPOSE 3000

# Container-level healthcheck. This is redundant with the compose-level
# healthcheck but useful for `docker run` invocations that don't use
# compose. The `node -e` one-liner avoids adding curl/wget to the image
# just for a healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/healthz').then(r => { if (r.status !== 200) process.exit(1); }).catch(() => process.exit(1))"

# Next.js standalone emits `server.js` at the root of the copied
# directory. It reads PORT + HOSTNAME from env. No custom server.
CMD ["node", "server.js"]
