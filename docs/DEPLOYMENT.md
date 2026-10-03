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

## History repair after the effective-dating migration (EF1, 2026-10-04)

Migration `20261004090000_effective_dating` adds database rules: no history
row may end before it starts, and none may overlap another for the same
employee or device ID. It **changes no data**.
- If existing rows break those rules, it stops before changing anything,
  and `npm run history:repair` lists each row. Those rows need a person to
  decide.
- Rows with one clear fix (a leaver whose placement was never closed, or
  closed on the last working day itself) are **never fixed automatically**.
  The `migrate` mode logs `HISTORY NEEDS REPAIR` with counts.

The procedure, user decision 2026-10-03 ("show me a preview of every row it
would fix and why, let me approve, then apply"):
1. Run `npm run history:repair` (preview) in a one-off task, the same way
   as `admin:recover`. Save the output.
2. The owner reviews the list and approves that exact output.
3. Run the `--apply --fingerprint <hex> --approved-by "<owner>" --operator
   "<you>" --yes` command the preview printed.
   - It refuses if anything changed since the preview.
   - Each fixed row gets a `history.repaired` audit entry naming the
     approver.

## Security wiring required before staging/production go live (Phase 5 commit E1.1)

Spec §9 ("Break-glass access and its honest limit") and §12 Phase 1.5
list these. They are recorded here so the CDK work can't miss them:

- **Alarm on the break-glass log line.** `admin:recover` and
  `admin:bootstrap` write a JSON log line with
  `"event": "security.breakglass"` (also `security.breakglass.aborted`,
  `.alert_failed`, `.alert_undelivered`). Add a CloudWatch Logs metric
  filter on the backend log group, with an alarm that emails the owners
  through SNS on any occurrence. **This is the control that matters most**:
  the record is outside the database, so whoever ran the tool can't undo
  it.
- **ECS Exec**: allowed only for the owners' IAM identities, with session
  logging (CloudWatch Logs or S3) and CloudTrail capturing
  `ecs:ExecuteCommand`. That records which AWS identity opened a shell; the
  tool's `--operator` is only self-declared.
- **Database roles**: the app connects as a role with no UPDATE, DELETE or
  TRUNCATE on `audit_logs` and `security_events`, and the migrate task uses
  the owning role. This is a second layer under the append-only triggers.
- **RDS log export / pgaudit** for writes to `users` and `audit_logs`. It
  is the only trail for the direct-SQL last resort (GETTING_STARTED §12,
  step 4).
- **`SECURITY_ALERT_EMAIL`**: set to an inbox outside this system.
- **Worker** must be running for queued break-glass alert emails
  (`security-alert-email` queue, retried every 5 minutes for 24 hours).
