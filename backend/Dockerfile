# Dockerfile for backend/ — runs the api|worker|scheduler|migrate
# entrypoint (src/index.ts, mode via APP_MODE or the first CLI arg).
#
# Built from the REPO ROOT (not backend/) so that ../shared is included in
# the build context — backend imports it through the @shared/* path alias:
#
#   docker build -f backend/Dockerfile -t wellsure-hr-backend .
#   docker run --rm -e APP_MODE=worker wellsure-hr-backend
#
# Node 22, not 20: argon2 0.45.1's prebuilt binaries segfault on Node 20
# (glibc and musl alike), so npm fell back to compiling argon2 from source
# and the build failed (no Python/toolchain in the image). They load fine on
# Node 22 — and Node 20 reached end-of-life in April 2026 anyway. Found
# 2026-09-30; see docs/PROGRESS.md.
#
# Not yet hardened for production: still root, no Chromium (needed once
# Puppeteer-based PDF generation lands), single stage (no separate
# build/runtime layers).
# See docs/PROJECT_SPEC.md §12 and §15.2.3.

FROM node:22-alpine

# Prisma's query engine needs OpenSSL, which the Alpine base doesn't ship.
RUN apk add --no-cache openssl

WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY shared ./shared
COPY backend ./backend

WORKDIR /app/backend
# npm ci, not npm install: installs exactly what package-lock.json says and
# fails loudly rather than resolving afresh.
RUN npm ci && npx prisma generate

# Fail the build — not the first request in production — if any native
# module or the generated Prisma client is missing or can't load. (A
# half-installed image once passed `docker build` because npm crashed yet
# exited 0.)
RUN node -e "require('argon2'); require('sharp'); new (require('@prisma/client').PrismaClient)(); console.log('native modules and Prisma client OK')"

# Invoke tsx directly (not via `npm run start`) so the Node process is
# PID 1 and receives SIGTERM directly — `npm run` does not reliably
# forward signals to the script it spawns, which would otherwise break
# graceful shutdown (see src/modes/*.ts).
CMD ["node_modules/.bin/tsx", "src/index.ts"]
