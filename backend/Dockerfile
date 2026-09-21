# Minimal build-verification Dockerfile for backend/.
#
# Built from the REPO ROOT (not backend/) so that ../shared is included in
# the build context — backend imports it through the @shared/* path alias:
#
#   docker build -f backend/Dockerfile -t wellsure-hr-backend .
#
# This is intentionally minimal: it proves backend/ installs and runs
# inside a container with the @shared/* alias resolving correctly. The
# full Phase 0 production image (non-root user, Chromium for Puppeteer,
# and the single api|worker|scheduler|migrate entrypoint) lands in
# Phase 0 — see docs/PROJECT_SPEC.md §12 and §15.2.3.

FROM node:20-alpine

WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY shared ./shared
COPY backend ./backend

WORKDIR /app/backend
RUN npm install

CMD ["npm", "run", "start"]
