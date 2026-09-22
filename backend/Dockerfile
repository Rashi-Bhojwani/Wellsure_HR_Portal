# Phase 0 Dockerfile for backend/ — runs the api|worker|scheduler|migrate
# entrypoint (src/index.ts, mode via APP_MODE or the first CLI arg).
#
# Built from the REPO ROOT (not backend/) so that ../shared is included in
# the build context — backend imports it through the @shared/* path alias:
#
#   docker build -f backend/Dockerfile -t wellsure-hr-backend .
#   docker run --rm -e APP_MODE=worker wellsure-hr-backend
#
# Not yet hardened for production: still root, no Chromium (needed once
# Puppeteer-based PDF generation lands), single stage (no separate
# build/runtime layers). See docs/PROJECT_SPEC.md §12 and §15.2.3.

FROM node:20-alpine

WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY shared ./shared
COPY backend ./backend

WORKDIR /app/backend
RUN npm install

# Invoke tsx directly (not via `npm run start`) so the Node process is
# PID 1 and receives SIGTERM directly — `npm run` does not reliably
# forward signals to the script it spawns, which would otherwise break
# graceful shutdown (see src/modes/*.ts).
CMD ["node_modules/.bin/tsx", "src/index.ts"]
