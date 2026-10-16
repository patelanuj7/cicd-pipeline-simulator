# Build from the repo root so the root lockfile is in the context:
#   docker build -f service/Dockerfile -t svc --build-arg GIT_SHA=<sha> .

# --- Stage 1: install the service's production dependencies ---
FROM node:24-alpine AS deps
WORKDIR /app
# npm ci validates the whole workspace tree against package-lock.json, so it needs
# every workspace's package.json, but only the service's dependencies get installed.
COPY package.json package-lock.json ./
COPY service/package.json service/
COPY dashboard/package.json dashboard/
RUN npm ci --omit=dev -w service --no-audit --no-fund && npm cache clean --force

# --- Stage 2: minimal runtime image ---
FROM node:24-alpine
# Same layout as the repo: deps are hoisted to /app/node_modules, and Node finds
# them by walking up from /app/service/src.
WORKDIR /app/service

ENV NODE_ENV=production
ENV PORT=3000

# The commit this image was built from; reported by GET /health.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

# Files stay root-owned (read-only to the app); the process runs as the
# unprivileged `node` user that ships with the official image.
COPY --from=deps /app/node_modules /app/node_modules
COPY service/package.json ./
COPY service/src ./src
USER node

EXPOSE 3000

# Uses Node's built-in fetch, so no curl/wget needed in the image.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
