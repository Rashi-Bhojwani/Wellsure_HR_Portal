# Employee-number login: plan and checklist

Branch: `feat/employee-number-login`, cut from `feat/hr-payroll-separation` at `14ff0adf`. It will be merged by the owner after Session A.
Report: `docs/plans/LOGIN_REPORT.md`.

## Owner decision (2026-11-17)

HR first creates the person's ID in the attendance machine (e.g. 486). That same number is the login ID in the portal. HR creates the employee
in the portal with that number. The employee uses "Forgot password" with the number, a link goes to the email on record, they set a password and
sign in. HR then fills in the rest. The number must be the same in the machine and the portal.

## What already existed (found at the start of the session)

| Asked for | Already in the code | Gap |
|---|---|---|
| Login by employee number | `POST /api/auth/login` takes `employeeCode` + password. **Every** account, directors (1000, 1031) and the Developer included, is an employee with a code. There is **no email login** today. | Matching was exact and case-sensitive; the backend did not trim. |
| Forgot password by number | `POST /api/auth/forgot-password` by code; same reply; 200 ms floor; hashed, single-use token; mail sent to the personal email on record. | Only ACTIVE accounts got a link, so an INVITED person could **not** use Forgot password to set their first password. TTL hard-coded at 60 min. No per-number rate limit. Nothing told HR when there was no email. |
| HR creates employee → Invited, no password | Yes: user row `INVITED`, no hash, invitation (= setup link) emailed, Resend button. | Default TTL 48 h (owner wants 7 days). Button wording. |
| Change employee number | Not possible anywhere (the schema comment says "permanent, never reassigned"). | Director-only change with reason and audit. |
| Machine ID | Separate dated `DeviceUserMapping`; the Add Employee wizard already pre-fills the employee code from the machine ID. The **Unmapped** queue (`/admin/devices`, Unmapped tab) already lists punches whose machine ID matches nobody. | Profile label and a mismatch warning. |

## Owner answers to the two questions asked in this session

1. **Email login: no.** Login and Forgot password take the employee number only, as today. A golden regression test locks today's number login
   in place. (The brief's "existing email login" does not exist; the directors and the Developer already log in by number.)
2. **Machine ID: default and warn.** The machine ID defaults to the employee number in the wizard (already the case); the employee screen labels the
   number "Login ID and attendance machine ID", shows the machine ID and warns when they differ. Nothing is forced; the attendance and biometric
   engines are not touched.

## Plan

### Backend (auth, employee modules only)

- **L1 — matching.** New `backend/src/modules/auth/loginId.ts`: `normaliseLoginId` (trim) and `findEmployeeByLoginId` (exact after trim,
  case-insensitive). Used by login and forgot-password. Migration `login_employee_code_ci_unique` adds a unique index on
  `lower(btrim(employee_code))` so two numbers that differ only in case or spaces cannot both exist; the create path checks the same way and
  stores the trimmed value.
- **L2 — forgot password.** Same reply and floor for every outcome. An INVITED **or** ACTIVE account with an email on record gets a single-use,
  hashed link; TTL from setting `auth.passwordResetTtlMinutes` (default 60). Mail goes only to the personal email on record (the request body
  carries only the number). Setting the password through that link activates an INVITED account (same side effects as accepting an invitation)
  and uses up any outstanding invitation links. SUSPENDED or DEACTIVATED: nothing is sent, and the reset link is refused for them too.
  No email on record: nothing is sent; `login_email_missing_notices` (one row per employee, with a count and the last time) is updated, HR users get
  an in-app notification "No email on record for employee <number>", and the employee screen and pending-invitations list show it.
  Rate limits: per IP (existing `auth.rateLimit.forgotPassword`) plus per number (new `auth.rateLimit.forgotPasswordPerLogin`, default 3 per
  hour), applied whether or not the number exists, with a plain message. Audit entries record who, which outcome, and never the token.
- **L3 — HR flow.** Setup link = the existing invitation; default TTL `auth.invitationTtlHours` goes from 48 h to 168 h (7 days); still a setting.
  The button reads "Send setup link". The account status reads "Invited" / "Active". No route returns a password hash or a token to HR.
  New `POST /api/employees/:id/employee-code` (director only, `requireDirector`; reason 3–300 chars; the new code is unique case-insensitively)
  changes the number, writes `employee.code_changed` with old/new/reason, and returns a warning that the machine ID must be changed to match.
- **L4 — machine match.** The profile gains `deviceUserId` (the machine ID in force) and `loginIdMatchesMachine`. The Unmapped queue is reused,
  unchanged; a test proves a punch from a machine ID that matches no employee number appears there.
- **L5 — security.** Reuses the existing lockout (`auth.lockout`), argon2 hashing and sha256-hashed tokens. Developer: the only new route is
  director-only, so the Developer gets 403; the profile additions hold no personal data.

### Frontend

- Login and Forgot password: label "Employee number", help text "The same number as on the attendance machine". Forgot password: the reply text
  is the owner's sentence, "If that account exists, a link has been sent to the email on record."
- Employee profile: "Login ID and attendance machine ID"; a mismatch warning; "No email on record for employee <number>" banner; directors get a
  "Change employee number" action (modal with a reason and the machine warning).
- InvitationStatus: "Send setup link" wording.
- Add Employee wizard: "Login ID (employee number)" label and a warning when it differs from the machine ID.

### Tests (see the checklist below)

## Checklist

- [x] Plan written (this file)
- [x] L1 matching + migration + golden login test
- [x] L2 forgot password (INVITED, TTL setting, no-email notice, per-number limit, timing)
- [x] L3 setup link TTL 7 days, director-only code change + audit
- [x] L4 profile machine ID + mismatch; unmapped-queue test
- [x] L5 permission matrix (Developer 403, employee cannot read others, HR sees no token/password)
- [x] Mutation checks (differing reply, reusable token, expired token, plaintext token)
- [x] Frontend: labels, forgot-password reply, profile banners, director change modal, tests
- [x] Phase check script green (lint, typecheck, auth/employee tests, frontend tests, build + bundle)
- [x] Migrations on a fresh database
- [x] Browser walk: HR, director, employee, Developer; desktop light + 390 dark; keyboard only
- [x] Full backend suite once (2 failures, both mine, fixed; see LOGIN_REPORT.md)
- [x] FIRST_SETUP.md "Login IDs" section; LOGIN_REPORT.md
- [x] Push to `feat/employee-number-login`; CI green on the final code commit (run 424, `e810b729`; runs 422 and 423 red for explained reasons, see LOGIN_REPORT.md)
