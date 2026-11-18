# Trial merge report (rehearsal, 2026-11-18)

Branch `integration/trial`, cut from `feat/hr-payroll-separation` at `090fbbb` (Session A's latest pushed commit; working tree clean,
up to date with origin). **This is a rehearsal: nothing here is merged anywhere, and `integration/trial` must not be merged into any branch.**
`feat/hr-payroll-separation` and every other branch were not committed to or pushed.

## 1. Merge order and result

| # | Branch | Head merged | Merge commit | Conflicts |
|---|---|---|---|---|
| 1 | `feat/employee-number-login` | `de435ac` (10 commits, base `14ff0ad`) | `1862993` | none (10 files edited by both sides, auto-merged) |
| 2 | `feat/lateness-rule` | `940c58e` (5 commits, base `9350060`) | `e4f02fd` | 1: `backend/prisma/schema.prisma` |
| 3 | `feat/wellsure-theme` | `f164eb7` (3 commits, base `03462da`) | `346aca9` | none |
| 4 | `docs/ops-and-decisions` | — | — | **skipped: the branch does not exist on origin yet** |

Each merge is a normal `--no-ff` merge commit: no rebase, no squash.

Note on setup: the clone was shallow, so `feat/wellsure-theme` at first looked like 355 commits with no shared history. After
`git fetch --unshallow` it is 3 commits on top of `03462da`.

### Files both sides edited that merged without conflict (merge 1, login)
`backend/prisma/schema.prisma`, `backend/prisma/seed.ts`, `backend/src/modules/employee/service.ts`,
`backend/src/modules/managers/__tests__/routeInventory.ts`, `backend/src/modules/settings/{service,types,validators}.ts`,
`frontend/src/api/employee.ts`, `frontend/src/api/settings.ts`, `frontend/src/pages/admin/settings/SystemSettingsPage.tsx`.
Session A's `090fbbb` removed some settings from these files, and login added `auth.passwordResetTtlMinutes` and the
`forgotPasswordPerLogin` rate limit. The edits sit in separate places, and typecheck plus the tests confirm the merged code is consistent.

## 2. Every conflict and its resolution

### C1: `backend/prisma/schema.prisma` (merge 2, lateness)
- **HEAD (Session A + login):** login appended the model `LoginEmailMissingNotice` (`login_email_missing_notices`) at the end of the file, between
  `// LOGIN-BEGIN` and `// LOGIN-END`.
- **lateness:** appended the model `LateWaiver` (`late_waivers`) at the same spot, between `// LATE-BEGIN` and `// LATE-END`.
- **Resolution:** kept both models, the login block first and then the lateness block. Neither model refers to the other. The back-relations on
  `Employee` (`loginEmailMissingNotice` and `lateWaivers`) had already merged cleanly next to each other.

### Migrations
All of them were kept. Order on a fresh database (folder timestamps):
`…20261116150000_a_statutory_pack_reviews` → `20261117090000_login_employee_number` → `20261118090000_a_leave_policy_year_end` →
`20261118100000_a_employee_personal_view` → `20261118120000_late_waivers`. No two prefixes collide and none depends on a later one. Checked:
`db:migrate` on an empty database, `db:drift` (schema = migrations) and the seed all pass.

No conflict touched the access resolver, the HR switch framework, payroll rule files or CI files.

## 3. Theme check of the login and lateness screens

The theme renamed no token. It changed values and added `primaryActive` and `focusRingInner`. The new screens (`LoginPage`, `ForgotPasswordPage`,
`LoginIdPanel` on the HR employee screen, `LatenessPage`, `LatenessWaiversPage`, `LatenessRulePage`) use only tokens and Ant Design components,
so the theme reaches them without edits. Browser walk results are in §5. **No styling fix was needed, and none was made.**

## 4. Checks

| Check | Result |
|---|---|
| Check script (CI build job's steps, local isolated Postgres 16 / Redis 7) | lint ✅, tokens ✅, build + bundle budgets ✅, services ✅, migrate ✅, drift ✅, frontend tests ✅ 19 files / 144 tests, agent tests ✅, demo company tests ✅ |
| Typecheck | ✅ all four projects. The first attempt died with *JavaScript heap out of memory* at Node's default ~2 GB heap in this container (not a type error). Rerun with `NODE_OPTIONS=--max-old-space-size=6144`: clean |
| Seed | ✅ 33 employees. `npm run db:seed` runs `prisma migrate reset`, and Prisma's own AI-agent guard refused it without the owner's typed consent. It was not bypassed. Instead `prisma/seed.ts` was run directly on the freshly migrated, empty scratch database |
| Full backend suite (alone, once) | 866 files, **2,392 / 2,395 passed, 3 failed, none caused by the merge** (below) |
| CI on the final commit | see §6 |

### The 3 backend failures (none caused by the merge, none fixed here)
1. `src/config/__tests__/testDatabaseIsolation.test.ts`: **my own test setup.** I pointed `DATABASE_URL` straight at the test database, so the
   test treated `wellsure_trial_test` as "dev" and looked for `wellsure_trial_test_test`. Not a code problem. CI runs it the normal way.
2. `src/lib/__tests__/sensitiveDocs.test.ts`: the generated tables in `docs/SENSITIVE_DATA.md` are out of date.
3. `src/modules/hrCapabilities/__tests__/hrCapabilities.test.ts`: `DEVELOPER employee.personal.view: expected false to be true`.

Every file behind failures 2 and 3 (`shared/constants/{sensitiveData,hrCapabilities,permissions}.ts`, `backend/src/lib/{hrCapabilities,systemRoles,sensitiveDocs}.ts`,
`docs/SENSITIVE_DATA.md`, the test files) is **identical to Session A's `090fbbb`**. They come from Session A's audit-fix item 7 (Developer personal
data), not from any merged branch. **Session A should fix them:** run `npm run docs:sensitive --prefix backend`, and decide whether
`employee.personal.view` is a split key that DEVELOPER should hold.

### Fixes made because of the merge
**None were needed.** The only edit to branch content was the C1 schema resolution.

## 5. Browser walk (keyboard only)

Stack: `npm run dev` on the scratch database, made-up seed data only. Roles: employee `1006`, manager `1002`, HR `1001`, director `1000`, and Developer
`1030`. The ordinary seed has no Developer, so seeded employee 1030's EMPLOYEE role was switched to DEVELOPER, in the scratch database only.
Two modes: desktop 1440 light, and 390 phone dark. Sign-in by keyboard (type the number, Tab, type the password, Enter). On every page: Tab through
30 stops, checking each focused element has a visible ring and is on screen; check WCAG AA contrast of every visible text element; check horizontal
overflow.

| Page | Result in both modes |
|---|---|
| Login, Forgot password (submitted by Enter) | ✅ 0 contrast failures, a ring on every stop, no overflow; the same reply for any number |
| HR employee screen (Login ID / machine ID panel) | ✅ HR, director and manager (team) see it; the employee gets the forbidden state; the Developer sees employee number, machine ID and official email, no personal phone (matches audit item 7) |
| Late Arrivals (`/app/attendance/lateness`) | ✅ employee, manager, HR and director; the Developer is refused |
| Lateness Waivers | ✅ HR and director; employee, manager and Developer get "This is not switched on for you" |
| Lateness Rule | ✅ director only; everyone else gets the forbidden state |
| Ready for First Run | ✅ director only; everyone else gets the forbidden state |

All 54 page loads: 0 low-contrast text, 0 focus stops without a ring, 0 focused elements off screen, 0 horizontal overflow at 390.
Light focus ring = black outline plus a yellow inner ring. Dark = yellow outline plus a dark inner ring.
**Not exercised:** Esc closing the waiver drawer. The seed has no late arrivals, so no waiver drawer could be opened (the lateness branch's own
screen test covers focus in that drawer).

Seen but left alone, because it is the global theme, not a new screen: at rest, Ant Design default buttons and the active tab show a brand-yellow
outline on the cream page. That is low contrast as decoration only; focus is still shown by the black ring.

## 6. CI

CI run 434 (`44296828286`) on `46121fb`, read once with every job to the end:

| Job | Result |
|---|---|
| install-lint-typecheck-test (lint, typecheck, tokens + bundle, migrate, drift, seed, frontend + agent tests, demo company) | ✅ |
| backend-tests (2), (4) | ✅ |
| backend-tests (1) | ❌ 1 file: `src/lib/__tests__/sensitiveDocs.test.ts` (67 of 68 files pass) |
| backend-tests (3) | ❌ 1 file: `src/modules/hrCapabilities/__tests__/hrCapabilities.test.ts` (67 of 68 files pass) |
| backend-tests-complete | ❌ only because shards 1 and 3 failed; the shard-coverage check was skipped |
| docker-build, agent-windows, latency (popovers + punch latency), attendance-replay, sensitive-ui (admin portal), sensitive-ui (employee portal) | ✅ |

CI fails on exactly the two tests from Session A's `090fbbb` that failed locally (§4). `testDatabaseIsolation` passes in CI, which confirms
the local failure came from my test setup. **No CI failure comes from the merge.** This report update is a docs-only commit after run 434;
its CI run was not read.

## 7. Where Session A's unmerged work is likely to conflict

Session A's open areas: leave, payroll settings (the 42 hidden defaults, `AUDIT_FIXES.md` items 5–6), the access resolver, and Developer field
masking. Below are the files the three merged branches changed that Session A is likely to touch again:

**High: edited by both, in the same regions**
- `backend/prisma/schema.prisma`: the end-of-file model block (both login and lateness append there) and the `Employee` relation list (near `// M-END`).
  Any new Session A model or relation will conflict textually, as C1 did.
- `backend/src/modules/settings/service.ts`, `settings/types.ts`, `settings/validators.ts`: login added `passwordResetTtlMinutes` and the
  `forgotPasswordPerLogin` rate limit, in the same arrays and objects Session A's `090fbbb` cut down. Hidden defaults moving into settings will
  land here.
- `frontend/src/api/settings.ts`, `frontend/src/pages/admin/settings/SystemSettingsPage.tsx`: same reason, frontend side.
- `backend/src/modules/payroll/setup/status.ts`: lateness added rows to Ready for First Run / Setup Checklist (`lateness/setupRows.ts`).
  Payroll-settings work edits the same row list.
- `backend/src/modules/employee/service.ts` (and `employee/controller.ts`, `employee/routes.ts`, `frontend/src/api/employee.ts`,
  `frontend/src/pages/admin/employee/EmployeeProfilePage.tsx`): login added `loginIdMatchesMachine`, `noEmailOnRecord`, `emailMissingRequestedAt`
  and `deviceUserId` to the profile, in the same function Session A edited for Developer masking. **Meaning, not only text:** the Developer
  masking list (`DEVELOPER_FORBIDDEN_KEYS` / `shared/constants/sensitiveData.ts`) should decide on these new profile fields. In the walk, the Developer
  saw the machine ID (equal to the employee number). Whether the Developer also gets the "no email on record" banner was not checked.

**Medium**
- `backend/prisma/seed.ts`: login and Session A both edit the employee/user seeding loop.
- `backend/src/modules/managers/__tests__/routeInventory.ts`: every branch adds routes there (lateness adds 12 `/api/lateness/*` routes; login adds the
  employee-code route). Session A's `090fbbb` removed 2 lines from it.
- `frontend/src/routes/adminMenu.config.tsx`, `frontend/src/routes/employeeMenu.config.tsx`: lateness added menu entries under Workforce →
  Attendance. Any new leave or payroll-settings screen goes in the same files.
- `frontend/src/components/leave/LeaveMonthCalendar.tsx`: the theme changed 2 lines (colour tokens). Leave UI work may touch it.
- Access resolver (`backend/src/lib/permissions.ts`, `backend/src/modules/access/service.ts`, `backend/src/lib/redact.ts`): **no merged branch
  edits these files**, so no textual conflict. But `backend/src/modules/lateness/service.ts` and `routes.ts` check roles themselves ("directors only",
  `attendance.override.manage`, "Developer refused"). A change to permission keys or to how the resolver treats the Developer must be checked
  against them.

**Low**
- `backend/src/app.ts` (lateness route mount), `backend/src/modules/attendance/compute.ts` (lateness day hook; leave's week-off now reads
  attendance settings), and docs: `docs/ops/FIRST_SETUP.md`, `docs/ops/DAILY_AND_MONTHLY_GUIDE.md`, `docs/STATUTORY_DEFAULTS.md`.
