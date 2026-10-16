# Phase 1.5 — AWS staging and the greytHR migration: plan

> **PAUSED (2026-10-16, by the user). Commit A is built and approved; commits B to F are on hold and resume after Phase 7.**
> Decision, in the user's words: all AWS work, the migration and connecting the device come last, together, as the final stage.
> Order from here: **Phase 6 (payroll), then Phase 7 (tax and benefits), built and tested locally; then the final stage**: B (CDK
> infrastructure), C (deploy pipeline), D (migration tooling), E (reconciliation, invitations, the ADMS infrastructure gate) and F (the
> first deployment and rehearsal), plus connecting the biometric device (`docs/CONNECTION_DAY.md`).
> Nothing below needs to change for the pause except two things, both tracked: (1) **`docs/plans/LOCAL_ASSUMPTIONS.md`** is the running
> list of everything built locally that assumes a local environment, so the final stage holds no surprises; (2) the migration (D) will now
> also carry payroll data (salary structures, YTD figures: spec §10 item 7), which Phase 6 designs for (its plan names the import shapes).

**Status: approved 2026-10-16 (answers in §1A). Commit A (the app is deployable) is built, see §10A; B to F are paused, see the box above.** It follows the approved Phase 3 close-out and
the brief you gave on 2026-10-16. Spec references: §10 (migration), §12 (Phase 1.5), §15 (AWS), `docs/DEPLOYMENT.md`
(the Phase 1.5 go-live checklist and the security wiring list).

How to read it: §1 is the decisions I need from you before I build; §2 is **everything you have to do yourself**, in
order, with lead times, so you can start the slow items today; §3 is what I found in the app that has to change before
real people's data goes anywhere near AWS (this is the part I would not want you to discover later); §4–§9 are the
design; §10 is the commit split and what I can and cannot verify; §11 is what I am deciding myself.

---

## 0. In one paragraph

Staging in `ap-south-1` (Mumbai), defined as CDK code in `infra/`, deployed by a GitHub Actions workflow that runs only
when CI is green on a push to `main`, with no long-lived AWS keys anywhere (GitHub OIDC). The first two Super Admins are
created with the existing `admin:bootstrap` tool through an audited shell on a running task, details typed at prompts and
never stored. The greytHR migration is a repeatable set of Import Center datasets (the existing ones, plus three new
ones: opening leave balances, historical attendance, and a greytHR-to-template converter you run on your own machine),
followed by a **reconciliation report with an Excel export and a "compare with greytHR's own files" diff**, and a
**sign-off that gates invitations**: nobody can be invited until you have signed the reconciliation for the data as it
now stands. Invitations go out in batches you trigger, paced for SES. ADMS push is off everywhere except development
until the office address allow-list exists at the edge and has been proven from outside.

---

## 1A. Your answers (2026-10-16), and what they changed

- **D1: staging is for rehearsal** (two Super Admins, a pilot group, the migration dry run). Everyone is invited from production in 5.5 by
  re-running the same files. No real employees in staging, so staging does not need production-grade infrastructure. **The
  `dataProtection` switch (`standard` | `production`) is built either way** (commit B). One condition: staging receives real data in the
  rehearsal, so it meets commit A's encryption, secrets and role requirements in full. *Cheap infrastructure, not cheap security.*
- **D2: two AWS accounts** (staging, production).
- **D3:** the domain and who controls DNS to be confirmed by you (same day); plan on delegating **one subdomain to Route 53**.
- **D4/D5:** you will supply anonymised greytHR samples and the cut-off date; **12 months of daily statuses, read-only**. The converter
  is built against the samples only: no guessed column layouts (commit D waits for them).
- **D6:** imported rows may keep a non-Gmail personal email. The rule for imported rows is **a well-formed address and nothing more**.
- **D7 (approved, with an addition):** KMS wrapping a data key held in memory, with a key id on every ciphertext so it can rotate;
  **plus a documented and tested rotation procedure**: "encryption you can't rotate is a liability on the day a key leaks".
- **The invitation gate on your reconciliation sign-off stays.**
- **Cost:** the estimate is from memory and not a quote. **An AWS budget alert goes into the infrastructure from the start** (commit B),
  rather than relying on you to set one.
- **Commit A, beyond the five findings:** the app must refuse to start outside development if *any* secret still has a default value, not
  just today's: built as a registry every `devSecret()` declaration joins, with a test that scans the schema (§10A).

---

## 1. Decisions I need from you first

These change what I build. Each has my recommendation; the plan assumes the recommendation unless you say otherwise.

**D1. Who uses staging?** *This is the one that matters most.* You asked for staging, the migration, the reconciliation and
batched invitations, all in Phase 1.5. Production (Phase 5.5) comes later. If real employees are invited into staging,
**staging is the live system in everything but name**: real PAN, Aadhaar, bank accounts and attendance in it, so it must
be built to production standard now (Multi-AZ database, deletion protection, point-in-time recovery, retain-on-delete),
and "production" in 5.5 becomes a second copy plus a cut-over.
- **A (recommended).** Staging is the rehearsal and the place real data is loaded and reconciled, with the two Super
  Admins and a pilot of a handful of volunteers only. Everything is built to production standard for *data protection*
  (encryption, roles, audit, backups) because the data is real, but without Multi-AZ and the extra tasks. The full
  invitation of everyone happens in 5.5 on production, loaded by re-running the same files, which is the proof the
  migration is repeatable.
- **B.** Staging is live until 5.5. Then Multi-AZ, deletion protection and 14-day backups apply now (a CDK switch,
  `dataProtection=production`, which I build either way), at roughly 1.6x the monthly cost, and 5.5 becomes a cut-over.
I build the switch regardless, so you can change your mind after seeing the first reconciliation.

**D2. AWS account structure.** *Recommended: one AWS Organization, two accounts (staging, production),* because the
break-glass story, CloudTrail and IAM boundaries are much cleaner when production's audit trail cannot be touched from
the account staging is deployed into. One account with two environments is cheaper to set up and is what I will do if
you prefer it; the CDK is parameterised by account and region either way. Under D1-A the account split can wait until
5.5 without rework, but it is easier to decide now.

**D3. The domain.** I need the company domain, who controls its DNS, and the hostnames. Proposed names (same registrable
domain, which the refresh-token cookie's `SameSite=Strict` needs): web `hr-staging.<domain>`, API `api-staging.<domain>`;
production later `hr.<domain>` and `api.<domain>`. **Recommendation: delegate one subdomain (`hr-staging.<domain>` and
`api-staging.<domain>`, or a parent such as `aws.<domain>`) to a Route 53 hosted zone**, so CDK creates the certificates'
validation records, the DKIM records and the app's records itself and you add exactly one NS record at your registrar.
If you would rather keep DNS where it is, §2 lists the records you would add by hand (about ten, once).

**D4. How does greytHR data reach us?** I have not seen a greytHR export, and I will not guess its columns. Please plan to
provide **one anonymised sample of each export** (names and identifiers scrambled) for: employee master, statutory,
bank, leave balances at a date, attendance (monthly register or daily swipes: whichever you can get), and leavers.
From them I build a converter **that you run on your own machine** (it turns greytHR's files into our import templates, so
real data never passes through me or the repo). Tell me which of these greytHR can export for you, and the cut-off date
you want balances as at.

**D5. Historical attendance: how, and how far back.** greytHR holds either daily statuses (Present/Absent/Leave per day) or
raw swipes. These are different things:
- *Daily statuses* import as read-only history ("From greytHR" badge, locked, never recomputed). **Recommended**, because
  it reproduces exactly what greytHR said and what employees remember, and our rules are not applied to the past.
- *Raw swipes* can be loaded through the existing punch import and recomputed under our rules, but the days would then
  differ from greytHR's wherever the rules differ (grace, half-day minimum). Only worth it if you want to prove the
  engine against greytHR on real punches.
The spec says 6–12 months, optional. **I recommend 12 months of daily statuses** (it is what a year-end leave
reconciliation needs). Your call on the number.

**D6. Personal email rule.** The Add Employee and import rules require the personal email to be a **gmail.com** address
(it is where the invitation goes). Real greytHR data will have employees with other providers or none. Options: keep the
rule and fix the rows (HR collects Gmail addresses first); or relax it for imported rows only, with invitations to
non-Gmail addresses sent only after you have looked at that list. I recommend the second, with the list shown in the
reconciliation, because blocking an import on 40 addresses is a poor reason to delay a migration.

**D7. Field encryption design.** See §3, item 1: real KMS envelope encryption does not exist yet and must be built before
a single real PAN is stored. I propose a variant of the spec's text (§3 explains). Please approve the variant or tell me
to follow the spec literally (one KMS call per field, async everywhere, a large change across the app).

---

## 2. What you have to do yourself (the whole list, in order)

I have no AWS credentials and will not ask for any: **everything below needs a human with the account, the domain or
the inbox.** The first block has lead times, so start there. Items marked ⏱ are slow because someone else is involved.

### Block 1 — start now (they take days, not minutes)
1. ⏱ **Decide D1–D7** above (this page).
2. ⏱ **Create the AWS account(s).** Root user with a strong password and **MFA on the root user**; billing contact; an
   **AWS Budgets alert** (a monthly amount you are comfortable with, emailing you at 50/80/100%). Under D2-recommended:
   create the Organization and the two accounts (staging, production).
3. ⏱ **Domain and DNS.** Tell me the domain and the DNS provider (D3). If delegating to Route 53: after the first deploy
   gives you four name servers, add one NS record at your registrar. If not: see Block 3.
4. ⏱ **A mailbox outside this system** for `SECURITY_ALERT_EMAIL` (a shared owners' inbox, not an address on the HR
   system itself): break-glass alerts must reach somewhere a compromised Super Admin cannot delete from. Same inbox (or
   another) for CloudWatch alarm emails. You will click an SNS confirmation link in it once.
5. ⏱ **greytHR samples and cut-off date** (D4, D5): anonymised sample exports, and which exports exist.
6. ⏱ **SES production access** (cannot be requested until the domain identity is verified, which needs DNS; see Block 3).
   In the SES console: *Account dashboard → Request production access*, with a plain use-case description (transactional
   invitation, password-reset and notification email to our own employees, a few hundred a month, bounces and complaints
   handled by an SNS topic). **AWS decides in roughly a business day, sometimes longer, and sometimes asks questions.**
   Until it is granted SES is in the sandbox: it can only send to addresses you have verified one by one, **so no invitation
   can reach an employee's Gmail.** I will build and test everything against the sandbox; the pilot cannot start before this.

### Block 2 — one-time bootstrap with an administrator login (about an hour, once)
7. **An administrator identity** for the target account (IAM Identity Center user, or an IAM user with MFA) and the AWS
   CLI v2 on your machine, plus the **Session Manager plugin** (needed for the audited shell in step 15).
8. **CDK bootstrap**, in both regions the app uses: `npx cdk bootstrap aws://<account>/ap-south-1` and
   `npx cdk bootstrap aws://<account>/us-east-1` (us-east-1 is required by AWS for CloudFront's certificate and its WAF; no
   employee data lives there). I will give you the exact commands in `docs/DEPLOYMENT.md`.
9. **Deploy the CI stack once from your machine** (`cdk deploy CiStack`): it creates GitHub's OIDC identity provider and
   the deploy role. This is the chicken-and-egg step; after it, GitHub deploys everything else and you never run `cdk
   deploy` by hand again. I will give you the single command and what it should print.
10. **GitHub settings** (needs repository admin): create an Environment named `staging` (restrict it to the `main` branch);
    add these **repository variables** (none are secrets): `AWS_ACCOUNT_ID`, `AWS_REGION=ap-south-1`, `AWS_DEPLOY_ROLE_ARN`
    (printed by step 9), `APP_DOMAIN`, `HOSTED_ZONE_ID` (if Route 53), `ALARM_EMAIL`, `SECURITY_ALERT_EMAIL`.
    Optionally branch protection on `main` requiring the CI check.

### Block 3 — DNS and email records (if DNS is not delegated to Route 53)
11. After the first deploy prints them, **create by hand** at your DNS provider: the ACM validation CNAME for the web
    certificate (us-east-1) and for the API certificate (ap-south-1); the three SES DKIM CNAMEs; the SES custom MAIL FROM
    MX and SPF TXT; a DMARC TXT (`v=DMARC1; p=none; rua=mailto:<owners inbox>` to start); and the two application records
    (`hr-staging` to the CloudFront name, `api-staging` to the load balancer). I will print the exact list.
12. **Confirm the SNS subscription** emails (alarms, SES bounces/complaints) in the inbox from step 4.
13. **Verify an SES test address** (your own) so the sandbox can be exercised before production access arrives.

### Block 4 — first Super Admins (on the day the environment is up; you, in a terminal)
14. **The two people's details, to hand** (employee code, full name, Gmail, mobile, date of birth, gender, date of joining).
    They are typed at prompts and never stored anywhere: not in the repo, not in a task definition, not in a chat.
    Each person needs an **authenticator app** (TOTP); admin roles will require it.
15. **Run the bootstrap** with the owner's AWS login from your machine through ECS Exec (§5). The first Super Admin is
    created by the tool; the **second is appointed in the app by the first** (profile → Access → Roles).

### Block 5 — the migration (you and HR, with me advising)
16. **Export from greytHR** (the files agreed in D4), **convert them locally** with the converter I will build, and
    **upload through Import Center** in the order in §6. HR fixes row errors from the error report and re-uploads.
17. **Hold the reconciliation report against greytHR** (§7), sign it off, or send it back with the mismatches.
18. **Pilot invitations** to the two Super Admins and a few volunteers (needs SES production access, step 6), then the
    batches (§8), triggered by you.

### Only if ADMS push is ever wanted (later; not needed for the connection day)
19. The **office's static public IP(s)** (spec §14, still open) so the edge can allow `/iclock/*` from the office alone, and a
    decision that the device supports push (its model is unknown until connection day). Until then ADMS stays off; the agent
    route is the plan and needs nothing from AWS but HTTPS.

### What I need from the list as values (none are secrets)
Account ID(s), region, domain and hostnames, hosted-zone ID (if any), the two alert email addresses, the GitHub
Environment name, the D1–D7 answers, the cut-off date and the number of months of history.

---

## 3. What I found in the app that must change before real data goes to AWS

I read the code to see what "deploy it" would really mean. These are not infrastructure; they are gaps that would make a
deployed staging unsafe or broken. Each is part of commit A (§10).

1. **Field encryption is not KMS.** `backend/src/lib/encryption.ts` derives its AES key by hashing the string
   `KMS_FIELD_KEY_ID` with SHA-256; it says "staging/production swap this module for real KMS envelope encryption", and
   that swap has not been built. Deployed as-is, bank accounts, PAN, Aadhaar and UAN would be encrypted under a key that is
   just a string in a task definition. **Design (D7):** a key hierarchy with a KMS customer-managed key at the top. A data
   key is generated with KMS `GenerateDataKey`, stored *encrypted* (in Secrets Manager); each task calls `kms:Decrypt` once
   at start and holds the plaintext data key in memory; fields keep using AES-256-GCM with the same `encryptField` /
   `decryptField` call shape, with a **key-id byte prefixed to every ciphertext** so a new data key (rotation) can be added
   while old ciphertexts still decrypt. This keeps the functions synchronous (no change across the app), makes KMS the root
   of trust (the key never exists at rest unwrapped), and gives rotation. It is **not** the spec's literal "a data key per
   field with the wrapped key stored beside it", which would make every encrypt and decrypt an async KMS call (about 2,000
   per import, one per revealed field). Local development keeps its static key through the same interface; **staging and
   production refuse to start on the local key.** Tests: round trip, rotation (old and new keys), tamper detection, the
   guard.
2. **Dev defaults can boot in staging.** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `KMS_FIELD_KEY_ID`, `FIELD_HASH_PEPPER`
   and `STORAGE_SIGNED_URL_SECRET` all have development defaults ("change-me-…", "dev-local-…"). A misconfigured staging
   would start happily with public, guessable secrets. **Change:** in `staging` and `production` the app refuses to start if
   any is a default or too short, if `STORAGE_DRIVER` is not `s3`, if `MAIL_DRIVER` is not `ses`, or if `SES_FROM`,
   `S3_BUCKET` or `SECURITY_ALERT_EMAIL` is missing.
3. **ADMS push defaults to ON in staging.** `lib/admsGate.ts`: "Development and staging default to on". Staging will hold
   real data on the internet, and an ADMS device is authenticated by its serial alone. **Change:** only `development`
   defaults on; staging and production default off (§9 for the infrastructure half).
4. **The app does not trust the load balancer's client address.** There is no `trust proxy` setting. Behind an ALB, every
   request would appear to come from the ALB, so the per-IP login rate limits would lock *everyone* out after the first few
   failures from anyone, and audit rows would record the ALB's address. **Change:** trust exactly one proxy hop, tested
   with a forged `X-Forwarded-For`.
5. **Database roles.** The app connects as one role. The spec and `DEPLOYMENT.md` require separate roles: a *migrate* role that
   owns the tables and an *app* role with no UPDATE, DELETE or TRUNCATE on `audit_logs` and `security_events` (a second layer
   under the append-only triggers). **Change:** an idempotent step in the `migrate` task, run as the RDS master user, creates
   the roles and grants (default privileges so later migrations stay covered, then the explicit revokes on the two tables);
   a test proves the app role cannot alter an audit row.
6. **Redis and Postgres over TLS with authentication** (the connection strings carry `rediss://` and `sslmode=require`;
   verified on the first deploy, since local Redis has neither).
7. **Two-factor for the admin roles is off by default** (`auth.require2faRoles` defaults to none). **Change:** staging and
   production start with Super Admin, HR Admin and Payroll Admin requiring it, so the first Super Admin is made to set it up
   as they accept their invitation.
8. **Metrics the alarms need.** The BullMQ backlog and failed-job counts are not published anywhere. **Change:** the worker
   publishes them as CloudWatch metrics (the spec's custom metric), behind a driver so local dev publishes nothing.
9. **`/ready` and graceful shutdown under ECS** (rolling deploys send SIGTERM): checked, with a test that a task finishes
   in-flight requests before exiting.

Not changed in 1.5, recorded so it is a choice: the image still runs as root with Chromium's sandbox off and one stage
(PHASE 5.5 hardening; pages are rendered with JavaScript and network disabled). If you choose D1-B I would move the
non-root image into 1.5.

---

## 4. Infrastructure (CDK, `infra/`)

Seven stacks for staging, parameterised by `-c env=staging` (production adds `BackupStack` in 5.5). Names follow spec §15.2;
what is new is the detail.

| Stack | What it creates | Notes |
|---|---|---|
| **NetworkStack** | VPC, 2 AZs; public, private-with-egress and isolated subnets; **one NAT gateway** (staging); gateway endpoints for S3, interface endpoints for ECR, Secrets Manager, KMS, CloudWatch Logs | Endpoints keep image pulls and secret reads off the NAT |
| **DataStack** | **RDS PostgreSQL 16**, `db.t4g.small`, single-AZ, 20 GB gp3 autoscaling, encrypted (KMS), 7-day backups, private; **ElastiCache Redis** (cache.t4g.micro, TLS + auth token); **S3 documents bucket** (private, versioned, SSE-KMS, block public access, access logs); **KMS keys**: one for fields (the envelope root), one for storage/RDS; **Secrets Manager** secrets, generated by CDK (JWT access and refresh, signed-URL secret, field-hash pepper, DB master and app and migrate credentials, Redis token) | Under D1-B: Multi-AZ, deletion protection, retain on delete, 14–30 day backups. **Nothing for the two Super Admins is stored here**, ever |
| **AppStack** | ECR repository (scan on push, keep last 20), ECS cluster (Container Insights), Fargate task definitions: **`api`** (0.5 vCPU / 1 GB; ALB target group, health `/ready`, **stickiness on**, websocket transport for Socket.IO), **`worker`** (1 vCPU / 2 GB: Chromium renders letters), **`scheduler`** (0.25 vCPU / 0.5 GB, exactly one task), **`migrate`** (task definition only); ALB with HTTPS listener and HTTP→HTTPS redirect; **WAF** (AWS managed common and known-bad-inputs rule sets, an IP rate limit, a stricter one on `/api/auth/*`) | Secrets injected from Secrets Manager; plain config as env; **ECS Exec enabled only for the owner IAM identities** with session logging to CloudWatch Logs; least-privilege task roles (the S3 prefix, SES send from the one identity, KMS use of the field key, its own secrets, `PutMetricData`) |
| **WebStack** | Private S3 bucket for the React build; CloudFront with Origin Access Control, SPA fallback to `index.html`, security-headers policy (CSP, HSTS, frame, referrer, permissions), CloudFront-scope WAF, ACM certificate in us-east-1, Route 53 alias | `VITE_API_BASE_URL` baked at build time to `https://api-staging.<domain>`; CORS and cookies verified end to end in the first deploy |
| **EmailStack** | SES domain identity with DKIM and custom MAIL FROM, configuration set, bounce/complaint events to SNS | Sandbox until step 6 |
| **ObservabilityStack** | Log groups (14 days staging), dashboard, alarms to SNS to the alarm inbox: ALB 5xx and latency, ECS CPU, memory and restarts, RDS CPU, free storage and connections, Redis memory, BullMQ backlog and failed jobs, SES bounce rate, and **the break-glass alarm** (a metric filter on `security.breakglass`, `.aborted`, `.alert_undelivered`); CloudTrail for the account (including `ecs:ExecuteCommand`); RDS log export (writes to `users` and `audit_logs`); AWS Budgets | The device-silence alarm is 5.5 per spec; the app's own alerts already cover it |
| **CiStack** | The GitHub OIDC provider and one **deploy role** whose trust policy admits only `repo:Rashi-Bhojwani/Wellsure_HR_Portal:ref:refs/heads/main` (and the `staging` environment), allowed only to assume CDK's own bootstrap roles and to run the specific ECS, ECR, S3 and CloudFront actions the workflow uses | No long-lived AWS keys exist anywhere |

**Rough cost, staging (an estimate from memory of AWS pricing, not a quote):** about **USD 180–250 a month**: NAT gateway,
the load balancer, the Fargate tasks, RDS and Redis, two WAF web ACLs, and logs dominate. Fargate can scale to zero outside
office hours (a scheduled action), which saves part of it; the NAT, ALB, RDS and Redis stay. D1-B roughly multiplies the
database share. I will put the AWS calculator's figure in `docs/DEPLOYMENT.md` at build time, and the Budgets alert makes the
surprise impossible.

**Tested without AWS:** `cdk synth` runs in CI on every push (no credentials needed) and CDK assertion tests pin the things
that must never regress: no public RDS, Redis or S3; encryption on; HTTPS only; the OIDC trust condition; ECS Exec scoped; the
ADMS listener absent by default (§9); the break-glass metric filter present. **Not testable without a real account:** that
the stacks actually deploy; the first deploy will be iterative (§10).

---

## 5. Deployment by CI, and the first Super Admins

### 5.1 The workflow
`deploy-staging.yml` triggers on `workflow_run` of the **CI** workflow **completing on `main`**, and its first step refuses
to continue unless that run's conclusion was `success` **and** its commit is the current tip of `main` (so a later push
supersedes an earlier one, and a red run never deploys). It can also be run by hand (`workflow_dispatch`) for a rollback.
Concurrency is serialised and never cancelled mid-deploy. Steps (spec §15.5):
1. Assume the deploy role through OIDC (the `staging` environment gate).
2. Build the backend image from the repo root, tag it with the commit SHA, push to ECR.
3. Build the web bundle, upload to the web bucket.
4. `cdk deploy` the stacks (changes only; a `cdk diff` is posted to the run summary first).
5. Run the **`migrate`** task (roles and grants, then Prisma migrations, then the permission catalog) and **wait for exit 0**; a
   failure stops the deploy before any service is touched.
6. Update `api`, `worker` and `scheduler` to the new image; wait for stable.
7. Invalidate CloudFront.
8. **Smoke test:** `/health`, `/ready`, the web root, and a login attempt with a wrong password returning 401 and **not 429**
   (proves the proxy trust fix), and, from the runner (which is outside the office), that `/iclock/cdata?SN=x` is refused.
Rollback: run the workflow by hand with a previous image tag (migrations are written expand → migrate → contract so the
previous image still runs; the rule is already in the project and I will add a CI check that a migration does not drop or
rename a column the previous release reads).

### 5.2 The two Super Admins
The tool exists and is good (`backend/scripts/admin-bootstrap.ts`, `docs/GETTING_STARTED.md` §12): it refuses once any active
Super Admin exists, takes details only from prompts, flags or environment (never the repo), never handles a password (the
person sets their own through the invitation), writes an audit row, and is **loud**: a `security.breakglass` log line, an
email to `SECURITY_ALERT_EMAIL`, a banner for the new admin. What Phase 1.5 adds is the *environment* it needs, and one
procedure change:
- The run is `aws ecs execute-command` on a running `api` task with the owner's IAM identity; the session is logged; CloudTrail
  records who opened it; the alarm fires; **nothing is placed in the task definition** (the doc already warns against
  `run-task` environment overrides, because those are readable by anyone who can describe tasks).
- The **second** Super Admin is appointed in the app by the first (profile → Access → Roles), which the existing guard
  allows and audits. The "last Super Admin can never be lost" rule is in the code and in database triggers already.
- **Details are never in the repo, the seed, the plan, a task definition, a ticket or a chat.** Their personal Gmail is where
  the invitation goes, which needs SES (sandbox: the address must be verified, step 13; production access removes that).
- Before the bootstrap I add a **pre-flight command** (`admin:preflight`, read-only) the operator runs first: it checks the
  migrate task ran, the permission catalog exists, SES can send, `SECURITY_ALERT_EMAIL` is set and deliverable, the break-glass
  alarm is subscribed, and prints which of those is not ready. A bootstrap on an environment that cannot alert is refused.

---

## 6. The migration

The Import Center already exists (upload → staging table → validate → row-level error report → commit in one transaction).
What exists, what is new:

| Dataset | Today | Phase 1.5 |
|---|---|---|
| Org masters (branches, departments, designations, grades, cost centres) | built | unchanged |
| **Employees** (identity, job, device ID, **ex-employees**) | built: `lastWorkingDate` and `exitReason` import a leaver **already separated**, with no Separation row, account deactivated and never invitable, placement and device mapping ended on the last working day, their device ID allowed to be reused (§3 of the spec); **import never sends an invitation** (`sendInvitation: false`) | add the converter (below); **non-Gmail personal email** per D6; a stricter manager-order check (a manager must exist before their reports; cycles reported, not looped) |
| **Statutory** (PAN, Aadhaar, UAN, ESI) | built, encrypted with last-4 and blind index, format-checked | duplicates across people reported rather than silently stored |
| **Bank** | built, encrypted, IFSC-checked | the same |
| **Leave balances** | partial: the `leave-grants` dataset writes signed **GRANT/DEBIT** entries | **new `leave-opening` dataset** that writes proper **`OPENING`** ledger entries (an entry type that already exists and is unused) dated the cut-off, one per person per leave type; re-importing **supersedes by reversal** rather than stacking; comp-off lots with their expiry if greytHR has any |
| **Historical attendance** | none | **new `attendance-history` dataset** (D5): read-only daily statuses in their own table, shown with a "From greytHR" badge in Attendance Info and the muster for dates before the start date, **never recomputed, never finalisable, never counted as device or corrected**; reports include them labelled |
| **Cut-over guard** | none | **new setting `attendance.engineStartDate`** (the go-live date): the engine, Process Attendance and the nightly job **never write a day before it**. Without it, the first Process Attendance over a past month would write hundreds of `NM`/absent rows for every migrated employee and contradict greytHR |
| Leave accrual cut-over | accrual job exists | a test that the first accrual after the cut-off credits the first period only (no double credit on top of `OPENING`), and that carry-forward for PL follows the confirmed policy (the PL eligibility boundary is still an open question in the spec; **the migration does not guess it**: balances come across as greytHR has them) |

**Order** (each step is a committed batch with its own error report; none depends on a later one): org masters → employees
(managers first) → statutory → bank → leave opening → attendance history → device-ID mappings checked.

**The converter.** greytHR's own export layouts are unknown to me (D4). I build `tools/greythr-convert` (a standalone script in
the repo with **no data in it**, tested on synthetic files shaped like the anonymised samples you give me) that you run
locally on the exported files. It writes our Import Center templates and a **conversion log** (rows read, rows written,
rows rejected and why). Real data never passes through me, the repo or CI.

**Rehearsable and repeatable.** The whole sequence can be run into an empty database (a *rehearsal*: `reset` is allowed only
on an environment marked rehearsal, never production, and never when any invitation has been sent) as often as needed
until the reconciliation is clean. Every committed batch records the file's SHA-256, row counts and who committed it, so
production in 5.5 can be loaded from the same files and shown to give the same totals.

**Real-data safeguards.** Uploaded files are processed in memory and the staging rows are deleted after commit (a retention
of 7 days for the error report only, then purged by a job); the upload never lands on disk unencrypted; the audit log records
who imported what and when, never the contents (redaction already exists for the audit log).

---

## 7. The reconciliation report

Today `reconciliationReport` returns active headcount by branch and by department, which is a start and nowhere near enough
to hold against greytHR. The new report lives in Import Center → Reconciliation, prints cleanly, **exports to Excel** (a
summary sheet, then one sheet per section, each with the file and batch it came from), and has two halves.

**Our side, computed from what was loaded:**
1. **People:** total, by branch, by department, by employment type, by status (active, separated); joiners and **leavers by
   month for the last 12 months** (so missing ex-employees are caught before attrition is trusted, as the spec already says);
   people with no branch, no manager, no date of joining or a manager cycle; **possible duplicates** (same PAN, Aadhaar,
   mobile or personal email on two records).
2. **Leave:** per leave type, the number of people with a balance, the sum of balances, the sum of positive and of negative
   balances, and the largest; by branch; the list of negative balances.
3. **Statutory and bank:** how many people have each identifier and an active bank account; format failures; duplicates.
4. **Attendance history:** per month, per branch: people, days, and the totals by status class (present, absent, half day,
   leave by type, holiday, week-off, LOP); employees with gaps (fewer days than the calendar); and a **cross-check of attendance
   leave days against the leave balances** for the same period.
5. **Devices and invitations:** people at device branches with no device ID; device IDs in use by two current people;
   leavers whose ID has been reused (expected under the convention, listed so it is a choice); how many people **can be invited**
   (valid personal email, not separated) and how many cannot, and why.
6. **Provenance:** every batch: dataset, file name and SHA-256, rows, errors, who and when. So "what did we load, from what"
   is provable.

**The other half: compare with greytHR's own files.** You upload greytHR's equivalent reports (headcount by branch, leave
balances per person at the cut-off, the attendance monthly summary), converted by the same tool, and the system produces a
**diff**: matched, only in greytHR, only in ours, and value mismatches with the difference, per person where the report is
per person. A mismatch is a row you can click, not a total you have to hunt for.

**Sign-off (a real gate).** You record a sign-off on the reconciliation (who, when, a note, and a fingerprint of the data it
covers: the batch ids and totals). Any later import or edit of those datasets **invalidates it**. **The invitation screen
refuses to send anything without a current sign-off**, and says why. (I am proposing this gate; you asked that nobody be
invited before you have held the report against greytHR, and a rule in the software is the only form of that which survives a
busy week.)

---

## 8. Invitations in batches, triggered by you

- **Never automatic.** Import already creates every user as `INVITED` with **no token and no email**; the new screen
  (*Employee → Invitations*) is the only way to send one in bulk. The single "resend invite" on a profile stays.
- **The screen** lists who can be invited and their state (never invited, invited and when, expired, accepted, bounced),
  filterable by branch, department and state. You choose a selection (a branch, a department, or ticked people), see a
  **preview** (who, which email, and who is excluded and why: no valid email, separated, already active), and **confirm** it with
  the usual fingerprint of the previewed set, exactly as the attendance bulk actions work.
- **Gated by the reconciliation sign-off** (§7), and by SES being out of the sandbox in production (in the sandbox, only verified
  addresses can receive, and the screen says so rather than failing silently).
- **Paced for SES:** a batch is a queue of jobs the worker sends at the account's allowed rate (the sandbox is typically 1 a second and
  200 a day; production access typically starts far higher, around 14 a second, and AWS states the exact figures on the account
  page, which I will read rather than assume); a **batch size cap** (default 25, configurable) so you can stage a pilot, then
  larger groups; a **pause** and a **cancel** for what has not yet been sent.
- **Results are visible:** sent, delivered, bounced, complained (from SES events), and accepted (the person set a password),
  per batch; bounces are listed so HR can correct an address and re-invite; expired invitations can be re-sent in a new batch.
- **Audit:** one row per invitation, plus one per batch (who triggered, the selection, the count).
- **Pilot first:** the plan is the two Super Admins, then a handful of volunteers, then the batches by branch.

---

## 9. ADMS push: a real gate

`DEPLOYMENT.md`'s item 1 says "restrict `/iclock` to the office's address before any PUSH device is created in production",
and the code half exists (the server refuses to create a PUSH device and serves no `/iclock` unless `ADMS_PUSH_ENABLED=true`).
What turns it from a note into a gate:
1. **Off by default everywhere but development** (§3, item 3), so the staging default is safe.
2. **The infrastructure cannot enable it without the allow-list.** The ADMS listener (the dedicated plain-HTTP port that forwards
   only `/iclock/*`) **does not exist in the CDK app** unless the deploy sets `admsPush=true` **and** a non-empty list of office
   addresses; `cdk synth` fails on one without the other, and a CDK assertion test proves the listener is absent by default.
   `ADMS_PUSH_ENABLED=true` is set by the same switch and by nothing else.
3. **Proven from outside.** The deploy workflow's smoke test runs from a GitHub runner (outside the office) and **fails the
   deploy** if `GET /iclock/cdata?SN=anything` is not refused at the edge on every listener, whatever the app would have said.
4. **Ticked in the repo** as the checklist already says: item 1 in `docs/DEPLOYMENT.md` is ticked in the commit that enables it,
   with the date and who, and the commit also needs the verified output of step 3.
The agent route, the plan for connection day, needs none of this.

---

## 10. How I would build it, in commits, pausing after each

| Commit | Contents | Verified by |
|---|---|---|
| **A. The app is deployable** | §3 items 1–9: KMS envelope encryption with rotation; the production config guard; ADMS default; trust proxy; database roles; two-factor defaults; the BullMQ metrics; `admin:preflight`; the cut-over guard `attendance.engineStartDate` | the full suite plus new tests per item; a local Postgres run of the role/grant step |
| **B. The infrastructure as code** | the seven stacks, CDK assertion tests, `cdk synth` in CI | synth and assertions in CI; **not deployable-proven** |
| **C. Deployment** | `deploy-staging.yml`, the smoke tests, rollback, `docs/DEPLOYMENT.md` (the human checklist of §2 with exact commands, restore from backup, rollback), the ticked/unticked go-live list | a dry run of the workflow's logic with a fake deploy target; **the real first deploy needs your Block 2** |
| **D. The migration** | `leave-opening` and `attendance-history` datasets, the converter, the real-data safeguards, the rehearsal reset | tests on a synthetic greytHR-shaped dataset (hundreds of people, a few leavers, awkward rows) |
| **E. Reconciliation and invitations** | the report, the export, the compare-with-greytHR diff, the sign-off gate, the invitation batches, the ADMS infrastructure gate and its external check | tests incl. gate refusals; a live walk-through |
| **F. First deployment and rehearsal** | with you: Block 2, then the first deploy (iterating on what AWS says), the Super Admin bootstrap, a rehearsal migration, the first reconciliation | **the deploy logs are the evidence** |

**What I can and cannot verify.** Everything in A, D and E runs locally and in CI, and I will test it properly. B I can only
prove by synth and assertions. **I cannot touch AWS**: no credentials, no console, and the plan keeps it that way. Commit C
and F are where it meets the real account, and **the channel is GitHub itself**: the deploy runs in Actions through the OIDC
role, and I can read its job logs (as I read CI), so when AWS rejects something I see the exact error and fix it, without
anyone pasting anything. Expect F to take several iterations, because the first deploy of seven stacks always does.

---

## 10A. Commit A as built (2026-10-16)

| Item | What exists | Proved by |
|---|---|---|
| Default-secret guard | `config/productionGuard.ts`; `env.ts` declares each secret with `devSecret()`. Outside development: refuses a default, a placeholder, a secret under 32 characters or two secrets alike; local drivers; missing S3/SES/alert inbox; non-TLS Postgres/Redis; non-https URLs | `config/__tests__/productionGuard.test.ts` incl. a schema scan (a secret-looking variable with a default that is not under the guard fails the test) and a real boot of a staging process on the defaults |
| Field encryption | `lib/fieldKeys.ts` (keyring, KMS wrapper, in-memory test wrapper), `lib/encryption.ts` (key id byte first, authenticated), `lib/fieldKeyRotation.ts`, `scripts/field-keys.ts` (`status`, `add`, `promote`, `reencrypt`, `retire`) | `lib/__tests__/fieldEncryption.test.ts`: round trip, tamper (body, tag, iv, key id), the four-phase rotation on real rows incl. a mixed fleet, a concurrent-change skip, retire refused while in use, and a scan that every `Bytes` column is known to the tooling. Procedure: `DEPLOYMENT.md` |
| ADMS | `lib/admsGate.ts`: only development defaults on | `modules/biometric/__tests__/ingestion.test.ts` |
| Trust proxy | `app.ts`: `TRUST_PROXY_HOPS`, default 1 outside development | `middleware/__tests__/trustProxy.test.ts`: forged `X-Forwarded-For` cannot dodge or frame the login limit |
| Database roles | `lib/dbRoles.ts`, run by the `migrate` mode; apps refuse to start as a role that can rewrite the audit trail | `lib/__tests__/dbRoles.test.ts`: the database (not the trigger) refuses UPDATE/DELETE/TRUNCATE on every append-only table; a table added later is covered; idempotent; password change |
| TLS | `rediss://` + token and `sslmode=require` are required by the guard | pinned client behaviour (`connectionTls.test.ts`); **first real proof is the first deploy** |
| Two-factor | `lib/authDefaults.ts`: Super Admin, HR Admin, Payroll Admin outside development | `authDefaults.test.ts` |
| Metrics | `integrations/metrics` (local publishes nothing, CloudWatch), `jobs/queueMetrics.ts`: waiting/active/delayed/failed per queue + heartbeat | `jobs/__tests__/queueMetrics.test.ts` incl. real BullMQ counts |
| Shutdown | `lib/lifecycle.ts`: `/ready` fails and `Connection: close` while draining, in-flight requests finish, hard limit | `modes/__tests__/shutdown.test.ts`: a real api process, a real SIGTERM, a request held open across the drain |
| Preflight | `lib/preflight.ts`, `scripts/admin-preflight.ts`; `admin:bootstrap` refuses where it cannot alert | `lib/__tests__/preflight.test.ts` |
| Cut-over guard | `attendance.engineStartDate` (setting, endpoint, Attendance Settings card): the engine never computes, writes or deletes before it; Process Attendance refuses a range wholly before it | `attendance/__tests__/engineStartDate.test.ts` |

Things the work found, recorded here so they are choices and not accidents:
- **Local role.** The new database-roles test needs a Postgres user with `CREATEROLE` (CI's is a superuser). GETTING_STARTED §3 now says so.
- **RDS and PostgreSQL 16.** The RDS master user is not a true superuser, and PostgreSQL 16 refuses it any statement that names the SUPERUSER,
  REPLICATION or BYPASSRLS attributes, so the role step creates the role with them off and afterwards only sets the password. Caught by running
  the step as a non-superuser; confirmed on RDS at the first deploy.
- **No separate "owner" role** beyond the master user (§3 item 5 said a migrate role owns the tables): the master user is that role, and its
  credential belongs to the migrate task alone. One fewer credential to keep.
- **Old ciphertexts.** The new layout (key id first) is not readable from the old one. Nothing real exists yet, so local databases are re-seeded.
- **Not built, said plainly:** rotating `FIELD_HASH_PEPPER` (it needs every hash recomputed); the task role's IAM for `kms:Decrypt`,
  `kms:GenerateDataKey`, `ses:Get*`, `sns:ListSubscriptionsByTopic`, `cloudwatch:PutMetricData` (commit B); the break-glass alarm and
  its subscription (commit B); the RDS CA bundle question (§ "To verify on the first deploy" in DEPLOYMENT.md).

---

## 11. Rules I am deciding myself (veto any)

1. The key-hierarchy variant of envelope encryption (D7), not one KMS call per field.
2. Staging **and** production refuse to boot on development defaults, or without S3, SES and the alert inbox.
3. ADMS defaults off outside development, including staging.
4. The reconciliation sign-off is a hard gate on invitations, invalidated by any later change to the data it covers.
5. Historical attendance is read-only daily statuses in its own table, never recomputed (D5), and the engine never writes before
   `attendance.engineStartDate`.
6. Opening balances use the `OPENING` ledger type, and re-importing supersedes by reversal.
7. Rehearsal resets are allowed only on an environment marked rehearsal and never once an invitation has been sent.
8. The deploy refuses to run for anything but a green CI run that is the current tip of `main`.
9. The first deploy of the CI stack is by hand with an administrator (the one chicken-and-egg step); after that nobody runs
   `cdk deploy` by hand.
10. Real data passes only through your machine, the converter and Import Center over HTTPS: never through me, the repo or CI.

## 12. Open questions carried (spec §14; not guessed)

The company domain and DNS provider (D3); the AWS account structure (D2); the office's static IP (only for push); the actual
headcount and branch list (the import shows it); the PL eligibility boundary and encashment formula (the migration carries
balances as greytHR has them and does not decide either); PT/LWF applicability and the bank file format (Phase 6).
