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
| (this commit) | docs: FIRST_SETUP "Login IDs", this report, checklist ticked |

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
| Full backend suite, once | FULL_SUITE_RESULT |
| CI on the final code commit | CI_RESULT |

### Changed existing test

- `backend/src/modules/auth/__tests__/passwordFlow.test.ts`: "does not create a reset token for an INVITED account" became "creates a reset token
  for an INVITED account …, none for a suspended one". **Reason:** the owner decision. A new person sets their first password through Forgot password,
  so Invited accounts must now get a link. The timing test's comment now names the constant instead of "200 ms".

## Decisions taken in this session (owner answers marked)

- **Owner:** number only, no email login. **Owner:** machine ID defaults to the number and is warned about, never forced.
- The email on record is the **personal email** (as today; the official email is not used for links).
- Timing floor raised from 200 ms to 400 ms to leave room for the extra work on known numbers. Mail is sent in the background.
- The Invited-account login message ("Your account hasn't been activated yet …", 403) is unchanged (golden). It does say that a number belongs to an
  invited account. It predates this work and was left as it was; the owners may want it reworded to point at Forgot password.
- `prisma format` was not run (it reformatted 400 unrelated lines); the schema edits are only the lines inside `LOGIN-BEGIN` / `LOGIN-END`.
- The seed reset (`npm run db:seed` = `prisma migrate reset --force`) was **not** run, under the no-destructive-commands rule. Fresh databases were
  seeded with `prisma db seed` after migrating, and the test harness rebuilt its own isolated test database as usual.

## Not verified / for the owners

- **Finding (pre-existing, not pay data):** the Developer role can open an employee's profile and sees the **personal email and addresses**
  (mobile and emergency phone are masked). No new route leaks anything, but CLAUDE.md says the Developer never sees a value. That gate lives in the
  access resolver, which belongs to Session A, so it was not changed here.
- Real email delivery was not tried (console driver; the walk read the link from the `.eml` file).
- Timing is checked as averages over a few samples on one machine; network jitter in production is not measured.
- Directors' 2FA-enforced mode for the number change was not walked in the browser (the service calls the existing `requireDirectorTwoFactor`).
- Existing employees whose numbers differ only in case would make the new unique index fail to build. The seed has none; real data was not checked.
- Not touched: the access resolver, the HR switch framework, payroll, the attendance engine, biometric ingestion, CI files.
