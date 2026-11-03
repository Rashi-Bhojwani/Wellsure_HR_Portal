# Coding-agent rules

Before work, read [CLAUDE.md](CLAUDE.md),
[WORKING_RULES.md](docs/plans/WORKING_RULES.md) if present,
[PROJECT_SPEC.md](docs/PROJECT_SPEC.md), [PROGRESS.md](docs/PROGRESS.md),
[PEEPS_PLAN.md](docs/plans/PEEPS_PLAN.md),
[PEEPS_CHECKLIST.md](docs/plans/PEEPS_CHECKLIST.md) and
[PEEPS_STAGE_REPORTS.md](docs/plans/PEEPS_STAGE_REPORTS.md).
The owner's current instructions win over older plans. Do not guess unresolved
settings or decisions. Record plans and verification in the repository.

- **One agent per branch.** Peeps work belongs on `peeps/foundation` only;
  no concurrent coding session may touch it. Work for
  `feat/hr-payroll-separation` waits for its own session. Start with a clean
  working tree; otherwise stop and tell the owner. Never commit Peeps work to
  main or the payroll branch. Stage files by name, never `git add -A`.
- No force-push, pull request, staging or production changes. Never run
  `prisma migrate reset` or drop a database. Use fresh local scratch databases;
  ask the owner before any reset. Preserve existing data and files.
- **Public repository:** add no real data, real person's or company's name,
  address, URL, bank, PAN, UAN or Aadhaar number. Fixtures must be fictional;
  demo data is labelled DEMO. Never commit secrets.
- **No preset business values:** every quota, duration, window, catalogue,
  limit and approval route is a setting, **Not set** until a director chooses.
  A feature refuses activation while required settings are missing. Use exact
  decimals, effective-dated records and append-only audit logs and ledgers.
- Every route requires validation, authentication, permission and data scope,
  plus an access-scan entry. Test employee-cannot-read-others and Developer-403
  on every route. The two directors are the only Super Admins. HR never sees
  pay data. Keep private data out of unrelated responses, logs, notifications,
  search, exports and sockets.
- Respect the Peeps plan's ownership map and shared-file boundaries. Do not
  change attendance, payroll or the access resolver without specific owner
  authorization. Reuse shared privacy rules rather than copying them.
  Menstrual and medical leave stay generic for managers until a director
  setting permits disclosure. New leave types stay off until required checks
  and approved rules permit activation.
- Follow existing schema-driven fixture cleanup and the design system.
  Do not skip tests or final checks: lint, typecheck, frontend tests, build and
  bundle budget; run the full backend suite **alone**, never two suites on one
  database. For fixes, break the guard, observe a named test fail, then restore.
- Claim a check passed only after running it and seeing it pass. Read CI per
  job, including both sensitive-data scan halves. If a required command or
  tool is unavailable, say so and request the needed result; never guess.
  Report unrun checks under **Unverified**, update the Peeps checklist and
  stage report with commits, counts, fixes and mutations, then stop at the
  owner's checkpoint. Do not start another module without its prompt.
