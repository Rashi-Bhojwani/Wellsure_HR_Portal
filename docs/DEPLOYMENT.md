# Deployment

_To be written in Phase 1.5 (AWS staging environment) — see
`docs/PROJECT_SPEC.md` §15.5 and the Phase 1.5 row in `docs/PROGRESS.md`._

Will cover: first-time bootstrap, DNS, SES domain verification, how to
deploy, how to roll back, and how to restore a database backup.

---

## Backend image: size and Chromium (recorded early, Phase 5 commit D2)

Recorded now so it isn't a surprise at Phase 1.5. The backend image
(`backend/Dockerfile`, `node:22-alpine`) carries **Chromium** for PDF
generation: letters now, payslips in Phase 6. Measured on 2026-10-01 with
`docker image inspect … --format '{{.Size}}'`:

| Image | Size |
|---|---|
| Before D2 (commit fba67f0) | **379 MB** |
| D2's npm dependencies, without Chromium | 482 MB (**+103 MB**) |
| D2 with Chromium (`apk add chromium`) | **804 MB** (+322 MB for Chromium) |

So D2 adds about **425 MB** in total, roughly doubling the image.
- **Chromium (+322 MB)** is the bulk.
- **npm dependencies (+103 MB):**
  - `pdfjs-dist` (35 MB) and `socket.io-client` are test-only. They're in
    the image only because it installs dev dependencies (the `migrate` mode
    needs the Prisma CLI);
  - `pdf-lib` (24 MB);
  - `puppeteer-core` and its protocol packages (~28 MB);
  - the Noto Sans font package (8 MB).

  Moving to a multi-stage build with production-only dependencies is part
  of the Phase 5.5 hardening; it would roughly halve the npm share.

What this means for Phase 1.5 / 5.5:
- **ECR storage and pull time** grow accordingly. Expect a slower cold start
  on a fresh Fargate task; nothing else changes.
- **Memory:** spec §15.6 already sizes the worker at 1 GB+ for PDFs.
  Letters render in the worker one at a time (`concurrency: 1`). Template
  *previews* render in the api process, so the api also needs headroom for
  one Chromium (roughly 150–250 MB while rendering). The browser closes
  after 60 s idle.
- **`CHROMIUM_PATH=/usr/bin/chromium`** is set in the image. The build fails
  if Chromium can't start (build-time check).
- **Root + `--no-sandbox`:** the image still runs as root, so Chromium runs
  without its sandbox. Pages are locked down regardless: JavaScript off,
  every network request blocked, and only our own sanitized HTML. Running as
  a non-root user (and re-enabling the sandbox) is Phase 5.5 hardening.
- **Reproducing letters across upgrades:** each letter records the Chromium
  version that rendered it.
  - "Reproduce" is byte-identical while that version is unchanged. This was
    verified: two separate container runs gave the same bytes.
  - After an image rebuild pulls a newer Alpine `chromium`, reproductions
    are honest re-renders, not byte matches. The local Chrome 141 and the
    image's Chromium 152 produced different bytes for the same letter.
  - The stored PDF is always the authoritative record of what was sent.
