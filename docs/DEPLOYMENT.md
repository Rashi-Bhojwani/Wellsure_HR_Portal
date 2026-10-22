# Deployment

_Being written across Phase 1.5 (AWS staging environment; plan in `docs/plans/PHASE_1_5.md`). Commit A (the app made deployable)
wrote the sections marked **[A]** below. The infrastructure (B), the deploy workflow and its human checklist, rollback and database
restore (C), and the migration and invitation runbooks (D, E) are added by the commits that build them._

Sections in this file, in the order a person needs them:

1. [What the app refuses to start without **[A]**](#what-the-app-refuses-to-start-without-a)
2. [Database roles **[A]**](#database-roles-a)
3. [Field encryption keys, and how to rotate them **[A]**](#field-encryption-keys-and-how-to-rotate-them-a)
4. [Before the first administrator: `admin:preflight` **[A]**](#before-the-first-administrator-adminpreflight-a)
5. [The cut-over guard **[A]**](#the-cut-over-guard-a)
6. The go-live checklist, security wiring and attendance notes (older sections, below)

---

## What the app refuses to start without [A]

Outside `development`, `config/env.ts` exits with a list of what is wrong instead of starting (`config/productionGuard.ts`):

- **Any secret that is still a development default, a placeholder (`change-me…`, `dev-local…`), shorter than 32 characters, or the same as
  another secret.** This is not a list of today's variable names: every secret with a development default is declared with `devSecret()`
  in `env.ts`, and that declaration is what puts it under the guard. A test scans the real schema and fails if a variable that looks like
  a secret has a default but was not declared that way, so a secret added later cannot be forgotten.
- Storage must be `s3` (with `S3_BUCKET`), mail must be `ses` (with `SES_FROM`), `SECURITY_ALERT_EMAIL` must be set, field encryption
  must be `kms` with a KMS key id/ARN, and the metrics driver must be `cloudwatch`.
- `DATABASE_URL` must carry `sslmode=require` (or stricter) and not point at the machine itself; `REDIS_URL` must be `rediss://` with the
  auth token in it; `WEB_BASE_URL`, `API_BASE_URL` and `CORS_ORIGIN` must be `https` and not `localhost`.

The messages name the variable and the rule, never the value.

Also at start, outside development: the api, worker and scheduler check that their database role is **least-privilege** (below) and
refuse to start as a role that could rewrite the audit trail. `ADMS_PUSH_ENABLED` is off by default everywhere except development.
`TRUST_PROXY_HOPS` defaults to 1 (the load balancer) outside development, so the client address, and with it the login rate limits and
the audit trail's address column, is the one the ALB saw, and a forged `X-Forwarded-For` cannot change it.

**To verify on the first deploy** (local Redis and Postgres have neither TLS nor a password, so nothing here can prove it ahead of time):
that the app really connects to ElastiCache over `rediss://`, and that Prisma verifies RDS's certificate with `sslmode=require` (the RDS
CA bundle may need to be in the image, or the connection string given the CA with `sslcert=`); the first deploy's smoke test records which.

## Database roles [A]

| Role | Used by | Can |
|---|---|---|
| **Migrate** = the database's master user | only the one-off `migrate` task | change the schema; owns every table |
| **App** (`DB_APP_ROLE`, default `wellsure_app`) | api, worker, scheduler | read and write data; **no** UPDATE, DELETE or TRUNCATE on `audit_logs`, `security_events` or any other append-only table; cannot create or drop anything or touch `_prisma_migrations` |

The `migrate` task creates or refreshes the app role at the end of every run (`lib/dbRoles.ts`, from `DB_APP_PASSWORD`, which only that
task has), grants it the data, sets default privileges so tables a later migration adds are usable immediately, and then revokes writes
again from every table guarded by an append-only trigger (it finds them from the triggers, so a table a new migration makes append-only is
covered the same deploy). This sits under the append-only triggers: the database refuses with "permission denied" before a trigger could
even run. The test `lib/__tests__/dbRoles.test.ts` proves it, including that the refusal is the privilege layer's and not the trigger's.
Recorded decision: there is no third "owner" role distinct from the master user (fewer credentials to hold; the master user's secret is
the migrate task's alone).

## Field encryption keys, and how to rotate them [A]

Bank account, PAN, Aadhaar, UAN and 2FA secrets are AES-256-GCM encrypted by `encryptField`/`decryptField`. The keys:

```
KMS customer-managed key (never leaves KMS; automatic yearly rotation is switched on by the infrastructure)
  └─ wraps data key 1, 2, 3 …  (FIELD_KEYRING: JSON of the *wrapped* keys: useless without kms:Decrypt)
       └─ encrypt the fields; every stored value starts with the id of the data key that made it
```

Each task unwraps the keyring once at start (one `kms:Decrypt` per data key) and holds the keys in memory only. The key id is also
authenticated, so changing it fails the tag check. Development uses one static key (`FIELD_ENCRYPTION_DRIVER=local`); staging and
production refuse to start on it.

**Two honest limits.** (1) A key that leaks decrypts everything it ever encrypted, **including database backups taken before the
rotation**; rotation protects what is written after, and what is re-encrypted in place, not old snapshots (below). (2) The blind-index
**pepper** (`FIELD_HASH_PEPPER`, used for duplicate detection) is not covered by this procedure: it is a separate secret, and changing it
means recomputing every hash. That is not built; if the pepper leaks, say so and it becomes a planned maintenance step.

### The four phases (`npm run field-keys -- …`, from an ECS Exec shell in the api task)

The order matters because a rolling deploy runs old and new tasks together: **a task must be able to read a key before any task writes with it.**

1. **`field-keys status`**: shows the keyring and how many stored values each key made. Read it first and last.
2. **PHASE 1, add**: `field-keys add` (or `add --cmk <arn>` to wrap the new key under a different KMS key, which is what you do when the
   *KMS key itself* is suspect). It prints the new keyring; the new key is **not current**. Put that JSON in the `FIELD_KEYRING` secret,
   deploy, and **wait until every api, worker and scheduler task has restarted**. Nothing has changed yet except that every task can now read the new key.
3. **PHASE 2, promote**: `field-keys promote <id>` prints the keyring with the new key current. Update the secret, deploy. New writes use the new key;
   a task that has not restarted yet can still read them.
4. **PHASE 3, re-encrypt**: `field-keys reencrypt` (a dry run: counts only), then `field-keys reencrypt --apply`. Safe to stop and repeat, safe while
   the app is serving (a value changed in the meantime is skipped, never overwritten, and each new value is read back before it is stored).
   Finish with `field-keys status`: every value should be under the new key.
5. **PHASE 4, retire**: `field-keys retire <old id>` refuses while anything is still encrypted under it, and otherwise prints the keyring without it.
   Update the secret and deploy. Then, **only when no backup you might restore still depends on it**, disable the old KMS key (schedule deletion
   with the longest waiting period). A restored backup older than the rotation needs the old key to be readable.

If a key leaks today: run phases 1 to 4 with `--cmk` pointing at a new KMS key, then treat every backup older than phase 3 as still exposed until
it ages out or is destroyed. This procedure is exercised end to end, including the mixed-fleet step and the refusal to retire a key still in use,
by `lib/__tests__/fieldEncryption.test.ts`. The AWS calls themselves (`GenerateDataKey`, `Decrypt` with the encryption context) are exercised for
the first time on the first deploy.

**Values held inside a record (added in Phase 6).** `reencrypt` rewrites the encrypted *columns* above. Three kinds of ciphertext sit inside a JSON column instead, where
it cannot (or must not) rewrite them: the owners' **sealed payroll values** (company identifiers and the bank layout with the debit account, in append-only version
history), a **profile change request** still waiting for a decision, and an **upload** not yet committed. `field-keys status` lists them and `retire` refuses while any is
still under the key, so a key can never be retired out from under a value that only it can read. To move them: decide or discard the pending requests and uploads, and
have the payroll admin enter each sealed value again as a new version (the approver confirms it as usual). Only the version in force and the latest version count; older
versions are history that nothing decrypts.

## Before the first administrator: `admin:preflight` [A]

From an ECS Exec shell in the api task, after the first `migrate` task has run:

```
npm run admin:preflight             # read-only: migrations applied, permission catalog, field encryption works, database role is least-privilege,
                                    # SECURITY_ALERT_EMAIL set, SES can send from SES_FROM, the alert inbox can receive from SES,
                                    # the break-glass alarm topic has a CONFIRMED subscriber
npm run admin:preflight -- --send-test   # also sends one test message to SECURITY_ALERT_EMAIL: check that inbox, nothing else proves it
```

`admin:bootstrap` runs the **alerting** subset itself and refuses (exit 1, no account created) in an environment that cannot tell anyone a
break-glass account was made. There is no flag to skip that. An SES account still in the sandbox is a warning, not a failure, as long as
the alert address is a verified SES identity; invitations to employees' addresses will not arrive until SES production access is granted.
The task role needs `ses:GetIdentityVerificationAttributes`, `ses:GetSendQuota`, `ses:GetAccountSendingEnabled` and
`sns:ListSubscriptionsByTopic` for these checks (to be put in the task role by the infrastructure commit).

## The cut-over guard [A]

`attendance.engineStartDate` (Attendance Settings → Cycle → "When this system takes over from greytHR") is the first day this system is the
record. Before it, **nothing computes, changes or deletes a day**: not Process Attendance (a range wholly before it is refused, one that
straddles it skips the earlier days and the audit entry says how many), not the nightly job, not a recompute after a correction. Set it
before any greytHR history is imported (commit D). Unset means no guard.

---

## Phase 1.5 go-live checklist

Items that **must be ticked before the thing they guard is used**. Not notes: each one has a switch in the code or the
infrastructure that stays off until it is ticked, so it cannot be forgotten. Tick an item by editing this file in the
commit that does the work, with the date and who did it.

- [ ] **1. ADMS push: restrict `/iclock` to the office's address — BEFORE any PUSH device is created in production.**
  - *Why:* an ADMS device proves who it is by its serial number alone (there is no shared secret in the protocol), the serial is
    printed on the device and shown on the Devices screen, and raw punches cannot be deleted. Anyone who learns a serial could post
    punches as that device and nobody could undo them.
  - *Do:* at the load balancer (or a separate listener), allow `/iclock/*` only from the office's static IP (open question: the
    office's static IP, spec §14) and deny it from everywhere else; put the same allow-list in the WAF; confirm from outside the
    office that `GET /iclock/cdata?SN=anything` is refused at the edge, not just by the app.
  - *Switch:* in production the server does not serve `/iclock` and refuses to create a PUSH device (`ADMS_PUSH_DISABLED`) unless the
    environment sets `ADMS_PUSH_ENABLED=true`. **Setting that variable is the act of ticking this item**, and only after the
    allow-list above is verified. Leave it unset until then; use the sync-agent route, which has its own key.
  - *Ticked:* ☐ date ______ by ______ (allow-list verified from outside the office: ☐)
- [ ] 2. The security wiring in spec §12 "Phase 1.5" (break-glass alarm, ECS Exec limits, separate database roles, RDS audit export,
  `SECURITY_ALERT_EMAIL`), listed under "Security wiring required before staging/production go live" below.
- [ ] 3. SES domain verified, so HR is emailed when a device or agent goes silent (the in-app bell works without it).
- [ ] 4. The scheduler and the worker each run as their own task (no scheduler means no device alerts and no overnight recompute).

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
- **Database roles** (built in Phase 1.5 commit A, see "Database roles" above): the app connects as a role with no UPDATE, DELETE or
  TRUNCATE on `audit_logs` and `security_events`, and the migrate task uses
  the owning role. This is a second layer under the append-only triggers.
- **RDS log export / pgaudit** for writes to `users` and `audit_logs`. It
  is the only trail for the direct-SQL last resort (GETTING_STARTED §12,
  step 4).
- **`SECURITY_ALERT_EMAIL`**: set to an inbox outside this system.
- **Worker** must be running for queued break-glass alert emails
  (`security-alert-email` queue, retried every 5 minutes for 24 hours).

## Attendance (Phase 2): what staging and production need

Added at the end of Phase 2 (P2-I) so Phase 1.5 doesn't have to rediscover it.

- **The scheduler must be running, as its own task.** `scheduler` mode registers the repeatable jobs
  (`attendance-nightly` 02:00 IST, `attendance-manual-reminder`, and `attendance-device-health`
  **every minute**). Without it nothing recomputes overnight and **no device or agent alert ever
  fires**: the minute check is how HR learns a device has gone quiet. It is not part of `npm run dev`
  (start it with `npm run start -- scheduler`, GETTING_STARTED). Run exactly one scheduler task;
  registration is idempotent, so a restart is safe.
- **The worker must be running** too: it runs the jobs the scheduler enqueues and sends the alert emails.
- **Email for alerts goes through SES** (`MAIL_DRIVER=ses`), so the SES domain verification above is a
  prerequisite for HR being emailed about a silent device. The in-app bell works without it. Until SES
  is verified, set the alert recipients knowing the email part is a console log, not a delivery.
- **Settings to review at first deployment**, all in System Settings → Attendance: *Device health*
  (retention warning and alarm shares, drift limit) and *Device alerts* (quiet time before an incident,
  agent heartbeat limit, morning check time, recovery notice wait, whether Super Admins are emailed, and
  the extra email list). Defaults: device quiet 30 min, agent late 5 min, morning check 10:30, Super
  Admins on. The device's real log capacity is set per device on the Devices screen once the model is
  known (the default is pessimistic: 3 days / 20,000 records).
- **`/api/dev/simulator` exists everywhere except production.** `app.ts` mounts it only when `APP_ENV`
  is not `production`; in production it is an ordinary 404 (a test asserts this). It is read-only and
  needs `attendance.devices.manage`. Staging therefore has it; that is intended, since staging is where
  the simulator is exercised.
- **Simulated devices are refused in production.** Registering a device marked simulated returns
  `SIMULATED_IN_PRODUCTION`. The `simulate` command also refuses to run against a server it cannot
  show is local and non-production, and refuses days that already hold punches.
- **The sync agent runs on an office PC, not in AWS.** Install, upgrade and uninstall are in
  `biometric-agent/INSTALL.md`. The PC needs a route to the device on port 4370 and HTTPS out to the
  app; the agent key and the device comm key live in Windows Credential Manager, never in the repo or
  these docs. ADMS push additionally needs a stable public address for the device to reach
  (Phase 1.5, and the office's static IP, both still open).
- **ADMS push is off in production until the go-live checklist item below is ticked** (the server refuses to create a PUSH device and
  does not serve `/iclock`). Use the agent route, which has its own key.
- **Cutover to real punches:** register the real device with `isSimulated` off, map the device user IDs
  (Employee record → Attendance capture; the Devices screen lists the people at device branches
  with none), and watch the Incidents tab on the first day. PHASE_2.md "Connection day: what to watch"
  lists what to look for.
