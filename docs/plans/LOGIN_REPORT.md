# Employee-number login: report

Branch `feat/employee-number-login`, cut from `feat/hr-payroll-separation` at `14ff0adf` (clean, rebased, 2026-11-17). For the owner to merge after
Session A. Plan and checklist: `docs/plans/LOGIN_CHECKLIST.md`.

## What was found first (it changed the brief)

- **There was no email login.** Every account, including both directors (1000, 1031) and the Developer, is an employee with a code and has always
  signed in with that code. The owner chose (in this session) **number only**: no email login was added, and the "golden" test locks in today's
  number login instead.
- Forgot password, hashed single-use tokens, Invited accounts and a resend button already existed. The gaps: Invited people could not use Forgot
  password; matching was case-sensitive and untrimmed; the TTL was hard-coded; there was no per-number limit and no "no email" signal.
- The machine ID is a separate, dated mapping (it can be reused after someone leaves; employee numbers never are). The owner chose **default and
  warn**: nothing is forced, and the attendance and biometric engines are untouched.

## Commits

| Commit | What |
|---|---|
| `4029557c` | docs: plan and checklist |
| `9aab194b` | backend: matching, migration `login_employee_number`, Forgot password changes, setup link 7 days, director-only number change, profile fields, settings, tests |
| `f71b2f5d` | frontend: login and Forgot password screens, employee screen (login and machine ID, warnings, director change), setup-link wording, settings, tests |
| `96c913b6` | docs: FIRST_SETUP "Login IDs", this report, checklist |
| `3e1a6156` | fix: machine ID read through `mappingInForceOn`; new route classified in the manager route inventory (both found by the full backend suite) |
| `d99fe878` | fix: "e.g. 1042" placeholder kept for the browser checks; login-screen tests wait for antd timers (CI run 422) |
| `e810b729` | fix: latency simulator accepts the "Employee number" label (CI run 423) |
| (this commit) | docs: CI run 424 green recorded |

## What it does now

1. **Login by employee number.** Matched exactly after trimming spaces, ignoring case. Leading zeros and letters are kept. The lookup is a literal SQL
   `lower(btrim(code)) = lower($1)`, not Prisma's case-insensitive mode, which can compile to `ILIKE` where `%` and `_` are wildcards. A unique index
   on `lower(btrim(employee_code))` stops two numbers that differ only in case or spaces. Lockout reuses `auth.lockout` unchanged.
2. **Forgot password by number.** Every request gets the same reply, "If that account exists, a link has been sent to the email on record." (one shared
   constant used by both server and screen), and is padded to at least 400 ms. Active **and Invited** accounts get a link, so a new person sets their
   first password this way. Using the link activates an Invited account, uses up all their other outstanding links, and makes the same joining post
   as accepting an invitation. The link goes only to the personal email on record (extra fields in the request are ignored). Links are 32 random bytes,
   stored as sha256 only, claimed atomically (single use), and expire after `auth.passwordResetTtlMinutes` (default 60). Suspended or deactivated
   accounts get nothing, and an old link stops working for them. With no email on record: nothing is sent; a `login_email_missing_notices` row is
   written (count, last time); each active HR user gets an in-app notification "No email on record for employee N"; the employee screen shows it in
   red. Rate limits: per IP (existing, 5 an hour) and per number (new `auth.rateLimit.forgotPasswordPerLogin`, 3 an hour), counted the same for
   numbers that exist and numbers that don't, with plain messages.
3. **HR flow.** Creating an employee makes an **Invited** account with no password and sends a setup link, now valid **7 days** by default
   (`auth.invitationTtlHours` 48 → 168; still a setting). The profile shows status **Invited / Active**. The button reads **Send setup link**. With
   no email on record it answers "No email on record for employee N. Add their email, then send the setup link." instead of attempting a send. No
   route returns a password hash or a token. **Directors only** can change an employee number (`POST /api/employees/:id/employee-code`: route needs
   `employee.edit`, the service requires a director and their 2FA when that is enforced). It needs a 3–300 character reason, must be unique ignoring
   case, writes audit `employee.code_changed` with old/new/reason, and warns that the machine must be changed to match.
4. **Machine match.** The profile shows "Login ID and attendance machine ID", the machine ID in force, and a yellow warning when they differ. Add
   Employee warns as you type. Machine IDs matching nobody already appear in the existing **Unmapped** queue (Devices → Unmapped). Unchanged; proved by
   the existing test `backend/src/modules/biometric/__tests__/ingestion.test.ts` ("lists the unmapped device user ID …").
5. **Audit (never the token).** `auth.forgot_password.requested` (token row id, status, minutes), `auth.link.no_email_on_record`,
   `auth.account.activated_by_reset`, `auth.password.reset`, `employee.code_changed`, plus the existing invitation-email and resend entries. A
   test checks that neither the raw token nor its hash appears in any audit row.

Also hardened on the way: accepting an invitation now claims its token atomically too (two concurrent submissions could both succeed before), and
the admin "send reset link" uses the same TTL setting.

## Tests

| Run | Result |
|---|---|
| New `backend/src/modules/auth/__tests__/employeeNumberLogin.test.ts` | 18/18 (golden number login; trim/case/zeros/letters; `%`/`_` literal; DB refuses case duplicate; identical reply for active, invited, no-email, suspended, unknown; timing; email only to the address on record; hash-only storage, not in audit; single use; expiry; TTL setting; suspended; no-email notice, HR notification, profile, Send setup link 409; per-number and per-IP limits; end to end via Forgot password and via Send setup link; case-duplicate refused on create; director-only change with HR Admin, HR Executive, employee, Developer all 403; employee cannot read another record; no hash or token in any profile) |
| Mutation checks (each applied alone, then reverted; file compared byte for byte) | **all four caught**: reply differs for an unknown number (2 tests fail); reusable token (1); expired token accepted (1); plaintext token stored (2) |
| New `frontend/src/pages/auth/__tests__/loginScreens.test.tsx` | 5/5 (labels, focus, trimmed send, blank refused, server message, the one reply, rate-limit message) |
| Phase check (one script, stops at first failure) | green: backend + frontend lint (incl. check:tokens), both typechecks, **fresh database: migrate + `db:drift` "No difference detected" + seed**, backend auth/employee/settings/access/cleanup 213/213, frontend 140/140, build + bundle (login 232.4 KB / 250; employee home 347.8 / 400; admin home 367.5 / 400) |
| Browser walk (Playwright, local dev DB, made-up fixtures) | **54/54**: desktop 1440 light and 390 dark; login, Forgot password, set password, new person end to end (Forgot password → link → password → sign in → same link refused), HR (labels, mismatch, no-email banner, Send setup link message, Invited, no hash/token in the page), director (change drawer, Esc closes, change to match the machine, second change), employee (another person's record not shown), Developer (no change button; API 403). Keyboard only: focus lands on the number field, Tab order number → password → Forgot password? → Sign in, Enter submits, Enter opens the drawer, Esc closes it. No sideways scroll at 390; no console errors |
| Full backend suite, once | 2313/2315 on the first run. The 2 failures were mine and are fixed in the follow-up commit: `currentRowGuard.test.ts` (the profile read the machine mapping with `validTo: null`; it now uses `mappingInForceOn`, on the same day the attendance-capture line uses) and `routeInventory.test.ts` (the new `POST /api/employees/:id/employee-code` is now classified `admin`). After the fix, those two files plus the employee module and the new login tests: 100/100. The full suite was not re-run (the speed rule allows one run); CI runs it on the final commit |
| CI on the final code commit | **Run 424 on `e810b729`: green**, every job (lint, typecheck, tokens and bundle, migrate, schema drift, seed, frontend and agent tests, demo company tests, all 4 backend shards plus the shard check, both sensitive-UI crawls, popovers, punch-to-screen latency, attendance replay, Docker build, Windows agent). Before it: run 422 (`3e1a6156`) was red in 4 jobs: the new login-screen tests left Ant Design delayed state updates running past jsdom teardown (2 unhandled errors, 140/140 tests passing), and the popovers and both sensitive-UI crawls find the login field by its placeholder "e.g. 1042", which had changed to "e.g. 486". Fixed in `d99fe878` (placeholder restored; the test waits for the timers). Run 423 was then red only in the latency simulator (`biometric-agent/src/simulator/latency/run.ts`), which signed in with the label "Employee Code"; fixed in `e810b729` (accepts "Employee number" or "Employee Code"). All three causes came from this branch's wording change and are explained. A repo-wide search found no other consumer of the old login wording |

### Changed existing test

- `backend/src/modules/auth/__tests__/passwordFlow.test.ts`: "does not create a reset token for an INVITED account" became "creates a reset token
  for an INVITED account …, none for a suspended one". **Reason:** the owner decision. A new person sets their first password through Forgot password,
  so Invited accounts must now get a link. The timing test's comment now names the constant instead of "200 ms".
- (2026-11-18) `backend/src/modules/auth/__tests__/login.test.ts`: "gives a distinct message for an INVITED account" (403 `NOT_ACTIVATED`) became
  "gives an INVITED account the SAME generic reply as an unknown code" (401, identical body). **Reason:** owner decision of 2026-11-18.
- (2026-11-18) `employeeNumberLogin.test.ts` golden test: the failure wording is now "The employee number or password is not correct." and the
  invited case is expected to equal the unknown case. **Reason:** the same decision.
- (2026-11-18) `frontend/src/pages/auth/__tests__/loginScreens.test.tsx`: the mocked failure message uses the new wording.

## Decisions taken in this session (owner answers marked)

- **Owner:** number only, no email login. **Owner:** machine ID defaults to the number and is warned about, never forced.
- The email on record is the **personal email** (as today; the official email is not used for links).
- Timing floor raised from 200 ms to 400 ms to leave room for the extra work on known numbers. Mail is sent in the background.
- ~~The Invited-account login message is unchanged.~~ Superseded by the 2026-11-18 follow-up below: an invited account now gets the one failure reply.
- `prisma format` was not run (it reformatted 400 unrelated lines); the schema edits are only the lines inside `LOGIN-BEGIN` / `LOGIN-END`.
- The seed reset (`npm run db:seed` = `prisma migrate reset --force`) was **not** run, under the no-destructive-commands rule. Fresh databases were
  seeded with `prisma db seed` after migrating, and the test harness rebuilt its own isolated test database as usual.

## Follow-up 2026-11-18: one reply for every failed sign-in

**Owner decision:** an unknown number, a wrong password and an invited account with no password yet must all show the same plain message, with the
same status and timing. The first-time hint moves to the login screen as static text.

- **Server** (`backend/src/modules/auth/service.ts`, `login`): every failure is `401 INVALID_CREDENTIALS` "The employee number or password is not
  correct." (`LOGIN_FAILED_MESSAGE`). Invited, suspended and deactivated accounts take the same path as an unknown number. Each failure path does one
  argon2 verify (the real hash, or a dummy hash made once per process for a person with none) and is padded to at least 400 ms
  (`LOGIN_FAILURE_MIN_DURATION_MS`), so the small database writes a wrong password adds (the failed-attempt counter) do not show. A successful
  sign-in is not padded. The existing lockout (`423 LOCKED` after 5 wrong passwords) keeps its own reply: it was outside this request and is
  unchanged; it does say that a number exists once someone has failed five times on it, which the owners may want to revisit. (Closed by follow-up 2.)
- **Screen** (`frontend/src/pages/auth/login/LoginPage.tsx`): always-visible text under "Forgot password?": "First time, or forgot your password? Use
  Forgot password with your employee number." (design tokens only).
- **Tests:** `employeeNumberLogin.test.ts` "an unknown number, a wrong password and an invited account are indistinguishable": same status (401),
  identical body, every sample at or above the 400 ms floor, and the averages of the three cases within 100 ms of each other (the tolerance already
  used for Forgot password), over 4 samples each. Frontend: the hint is shown before any attempt and still shown after a failed one.
- **Mutation checks** (each applied alone, then reverted; file compared byte for byte): *invited case answered differently* (the old 403
  `NOT_ACTIVATED`): 3 tests fail. *Invited case with the same words but answered at once* (no verify, no padding): the indistinguishability test fails.
- **Results:** auth module 60/60, login screens 6/6, phase check and CI: see below.

- **Phase check (run once):** green: both lints, both typechecks, fresh database migrate + drift ("No difference detected") + seed, backend
  auth/employee/settings/access/cleanup 214/214, frontend 141/141, build + bundle (login 232.5 KB / 250; employee home 347.8 / 400; admin home
  367.5 / 400).
- **CI on the final code commit:** **run 429 on `8b4c5fb6`: green**, every job (read once).

## Follow-up 2 (2026-11-19): no lockout or rate-limit reply names a number

**Owner decision:** count failed sign-ins per employee number as typed (held or not) and per IP; past the limit, every such number gets one
identical reply; no distinct 423, and no per-number or per-IP wording on the sign-in route.

- **Server** (`backend/src/modules/auth/service.ts`):
  - Every failed sign-in increments a counter for the number as typed (trimmed, case ignored, exactly as login matches it) and one for the IP, in
    Redis. Unknown numbers, invited, suspended and deactivated accounts, and wrong passwords all count the same way.
  - Limits: per number = the existing `auth.lockout` (5 failures; the lock lasts 15 minutes from the failure that reaches the limit, and failures
    are counted within that window); per IP = the existing `auth.rateLimit.login` setting (10 failures in 15 minutes; it now counts failed
    attempts only, so successful sign-ins are never counted or slowed).
  - Past either limit, the check runs before any lookup, so the reply cannot depend on the number: `429 TOO_MANY_ATTEMPTS` "Too many attempts. Try
    again later or ask HR to unlock your account." (`LOGIN_TOO_MANY_MESSAGE`), with the same dummy password check and 400 ms floor as every failure.
  - The distinct `423 LOCKED` "Account is locked…" reply is gone. The route-level per-IP middleware ("Too many requests. Please try again later.")
    no longer runs on `/api/auth/login`. The per-number 429 wording ("…for this employee number…") was only ever on Forgot password, and is
    unchanged there: it is counted for every number typed, so it reveals nothing.
  - A real account still records its lock (`failedLoginAttempts` = the number's count, `lockedUntil` set when it reaches the limit) and the audit
    entries (`auth.login.failed`, `auth.login.lockout`), so HR's and directors' Access tab still shows **Locked out** and offers **Unlock**.
  - Unlock: the automatic unlock is the counter expiring together with `lockedUntil`; HR/director unlock (`adminUnlock`, same permission rule as
    before) clears both the record and the counter, audited `auth.unlocked_by_admin` as before. A successful sign-in clears the number's counter.
  - If the Redis counter is lost while an account's recorded lock still runs, the account is still refused, with the same 429 reply.
- **System Settings:** the per-IP sign-in limit is now labelled "Sign-in (failed attempts per address)".
- **Tests** (`employeeNumberLogin.test.ts`):
  - *Over the limit, a real (locked) number and a non-existent number get an identical reply.* Four cases: real with the right password, real with
    a wrong one, unknown, unknown typed in lower case with spaces. All are 429 with an identical body; every sample is at or above the 400 ms
    floor; the case averages are within 100 ms of each other (4 samples each, the tolerance used before). HR and a director see `locked: true`.
  - *The per-IP limit gives the same reply*, for a real number with the right password and for an unknown one, and a successful sign-in afterwards
    is not counted.
  - *Unlock still works.* A director's unlock (audited) lets the right password in at once; the automatic unlock (counter expiry plus the recorded
    lock passing) does too, and resets the count.
- **Mutation checks** (each applied alone, then reverted; file compared byte for byte):
  - *Locked case answered differently* (the old 423 `LOCKED` for a real locked account): 3 tests fail.
  - *Locked case with the same body but answered at once* (no check, no padding): the identical-reply test fails on timing.
- **Changed existing tests:**
  - `login.test.ts` "locks the account after 5 failed attempts…" now expects 429 `TOO_MANY_ATTEMPTS` instead of 423 `LOCKED`.
  - The golden test in `employeeNumberLogin.test.ts` expects the same.
  - The golden test no longer clears every rate-limit key between its five failures, since that would now reset the per-number counter.
  - **Reason:** owner decision of 2026-11-19.
- **Results:** auth + access modules 130/130.

- **Phase check (run once):** green: both lints, both typechecks, fresh database migrate + drift + seed, backend
  auth/employee/settings/access/cleanup 217/217, frontend 141/141, build + bundle (login 232.5 KB / 250; employee home 347.8 / 400; admin home
  367.5 / 400).
- **CI on the final code commit:** **run 440 on `2b47c1e1`: red** (read once; not fixed, per the instruction).
  - Two jobs are red, with one cause. `backend-tests (3)` failed; `backend-tests-complete` only reports that a shard failed. Every other job is
    green.
  - The 3 failing tests are all in `backend/src/middleware/__tests__/trustProxy.test.ts`, which is outside the phase-check script's test set, so
    the local check did not run it. Reproduced locally with `vitest run --shard=3/4` (3 failed, 473 passed).
  - *"keys the limit on the address the ALB appended…"* and *"with no proxy trusted, the header is ignored…"* look for the old route-level key
    `ratelimit:auth.rateLimit.login:<ip>`. The per-IP sign-in counter is now `ratelimit:auth.loginFail.ip:<ip>` (counted in the service), so they
    find no key.
  - *"one person failing does not lock out a different person behind the same ALB"* sends both people's attempts with the same made-up number
    "NOPE". That number now has its own counter, shared across addresses by design, so it reaches 5 and the second person gets 429. The per-IP
    separation the test is about still holds.
  - **Fix needed (not applied):** point the test at the new key and give the two people different numbers. No product code change is needed.
- **Follow-up 2b (2026-11-19), the test-only fix, applied with the owner's go-ahead** (commit `78c536eb`; no sign-in code changed):
  - **Changed tests:** `backend/src/middleware/__tests__/trustProxy.test.ts`, three tests.
    - *"keys the limit on the address the ALB appended, ignoring forged entries to its left"*: now expects the key
      `ratelimit:auth.loginFail.ip:203.0.113.7`.
    - *"one person failing does not lock out a different person behind the same ALB"*: the two people now use different made-up numbers.
    - *"with no proxy trusted, the header is ignored entirely"*: now reads the `ratelimit:auth.loginFail.ip:*` keys.
  - **Reason:** follow-up 2 counts failed sign-ins per IP inside the auth service under the new key. It also counts them per employee number
    across all addresses, so a number reused by every attempt reaches its own limit at 5.
  - Each attempt in the file now uses its own made-up number. That keeps the per-number limit out of the way, so the per-IP limit (10 failures)
    these tests are about is what they actually exercise. All 4 tests in the file pass.
  - **Full backend suite, run alone once before pushing:** 265 files, 2319 tests, all passed. No other test encoded the old rate-limit behaviour,
    so nothing else was changed.
  - **CI on the final commit:** FOLLOWUP2B_CI

## Not verified / for the owners

- **Finding (pre-existing, not pay data):** the Developer role can open an employee's profile and sees the **personal email and addresses**
  (mobile and emergency phone are masked). No new route leaks anything, but CLAUDE.md says the Developer never sees a value. That gate lives in the
  access resolver, which belongs to Session A, so it was not changed here.
- Real email delivery was not tried (console driver; the walk read the link from the `.eml` file).
- Timing is checked as averages over a few samples on one machine; network jitter in production is not measured.
- Directors' 2FA-enforced mode for the number change was not walked in the browser (the service calls the existing `requireDirectorTwoFactor`).
- Existing employees whose numbers differ only in case would make the new unique index fail to build. The seed has none; real data was not checked.
- Not touched: the access resolver, the HR switch framework, payroll, the attendance engine, biometric ingestion, CI files.
