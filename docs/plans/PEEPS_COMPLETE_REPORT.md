# Peeps — complete report (end of Stage 4, 2026-11-16)

Branch `peeps/foundation`. This is the hand-over: what Peeps is, what is built and where, what the owners must still choose, what ships as a
default, what Session A needs to know, what is not verified, what I decided myself, and what the independent review found. Details of each
stage are in `PEEPS_STAGE_REPORTS.md`; the owner-facing setup steps are in `docs/PEEPS_SETUP_GUIDE.md`.

**The lateness rule is NOT built.** Lateness (late-in marks, an allowance, a waiver, LOP for repeated lateness) is computed by the attendance
rules engine, which is Session A's. The guide's lateness cutoffs and allowance count are initial values the owners gave, and the standing rule
is that such values stay Not set until the owners confirm them; the engine has no lateness model in the schema to attach a Peeps rule to. Peeps
never reads or sets lateness, and nudges are never created from attendance or lateness. It waits for Session A to add lateness to the
attendance engine (with the owners' confirmed cutoffs); Peeps would then only add an interface if Session A asks for one (PEEPS_PLAN §B.4).

---

## 1. Modules: status and commits

| Module | Status | Main commits |
|---|---|---|
| Peeps settings store (two-director confirm, Not set / Default, withdraw) | Built | `45626da`; withdraw `07c7b6c`, `4588f02`; Stage 4 tests `965ba1b` |
| Wellsure Office (membership propose/confirm, capabilities, grants, scheduled job, drift) | Built | `45626da`, `2c94b6f` |
| Assets (register, issue/return/transfer/lost/damaged/acknowledge, one open assignment) | Built | `51de81a`, `1a244e2`; HR again `b9f0a90`, `03e96fa` |
| Asset requests by employees | Built | `07c7b6c`, `4588f02` |
| Asset recovery of lost/damaged items | **Not built** (money: Session A; interface notes in §4) | — |
| Unmute (booking, hosts, completion only, no notes) | Built | `45626da` |
| Badges (catalogue, reporting line, limits, expiry, revoke) | Built | `6de8b08`, `376e900`, `07c7b6c`, `e78b3e3` |
| Nudge tags (directors only, 7 days, review requests) | Built | `07c7b6c`, `e78b3e3` |
| Private corrective notes | Read-only (no new notes; existing ones visible to the person and audited directors) | `07c7b6c`, `e78b3e3` |
| Avatars and directory contact fields | Built | `1743d6f`, `eb1154a` |
| Four new leave types (menstrual, medical, wedding, bereavement) with HR-only documents | Built; every rule Not set | `00d9a2d`, `b6c3561`, `a89b750`, `082bcc0` |
| Ticket desk category visibility and moves | Built | `0845d17` … `40f0390` |
| Exits (resignations, checklist with live asset gate, private interviews, settlement inputs hand-off) | Built | `d232308` … `bb27005`, `6001b6c` |
| Recruitment (requisitions, jobs, pipelines, candidates, CVs, interviews, feedback, candidate mail, retention) | Built | `d6b91c3`, `620937a`, `a092e25`, `0a13016`, `2f8c082`, `31d7807`, `fad242e`, `7d54727` |
| Offers, director-only pay and expected pay, joiner links, joining documents, conversion, referrals | Built | `c1bcae4`, `eeb7b8e`, `5d1f4ec` |
| Insights (turnover, tenure, exit reasons, hiring funnel; small-group suppression) | Built; every definition Not set | `44c3aef` |
| Document autofill (local OCR, per-field authority, never auto-saves) | Built | `c4872ca`, `4861610` |
| Notifications helper (generic text, ids-only payloads) | Built | `497b527` |
| Lateness rule | **Not built** (see above) | — |
| Directory filters and preferences (item 6) | Not built (not asked for since) | — |

Stage 4 (testing programme): permission matrix `a959db5`; confidentiality scan `154855a`; concurrency `3ddafa4`; core regression `cba74f3`,
`3580124`; mutation table `965ba1b`; browser-walk fixes `d40ba2a`; leave-types test dates `21a310b`; merge of Session A `c9866f8`; seed and
mail safety `1f6f5a2`; independent review fixes `f5c0b3b`, `fddefe2`, `cd32065`, `d9eb0b4`, `cbca2a5`, `8101835`, guide `5978b26`.

## 2. Owner setup checklist — every setting left Not set

Each refuses (and names what is missing) until a director enters a value and a different director confirms it. Full table with who sets what:
`docs/PEEPS_SETUP_GUIDE.md` §2.

- [ ] Wellsure Office members and their capabilities
- [ ] Asset categories, statuses (which can be issued), conditions — also needed before employees can ask for an asset
- [ ] Asset register audience (whether Office members also run the register)
- [ ] Unmute: audience, hosts, session length, availability window, booking window, booking notice, cancellation notice
- [ ] Directory contact fields colleagues see (work email, phone, birthday)
- [ ] Leave: whether wedding/bereavement are named on team calendars; whether menstrual/medical are named to managers
- [ ] Every rule of each of the four new leave types (quota, eligibility, counting, documents, route, year end)
- [ ] Recruitment: sources, retention, scorecard, rejection reasons, candidate e-mail templates, CV file rules, requisition approval route, Office audience, whether HR runs recruitment
- [ ] Joining: joiner link lifetime, required joiner document types, joining exception approver
- [ ] Offers: offer pay, and anything about pay, bank, statutory or tax (directors only, per offer)
- [ ] Exits: notice rules, rejection, reason categories, checklist and owners, interview questions, retention, overdue thresholds, Office audience, exit approval
- [ ] Insights: reporting window, minimum group size, early-attrition threshold, turnover, tenure, exit-reason and hiring-funnel definitions
- [ ] Autofill: retention of uploaded documents
- [ ] Helpdesk: the audience of each new category
- [ ] Mail (new in Stage 4, environment not a setting): `MAIL_ALLOWED_DOMAINS` for any development or staging stack that must send mail

## 3. Defaults shipped (Default, change in settings)

| Module | Setting | Default |
|---|---|---|
| Workspace | Name | Wellsure Office |
| Badges | Catalogue | 12 badges (Launch Star … Problem Solver), each lasting a week, a month or permanently |
| Badges | Limits | 5 a calendar month per giver; 1 a month from the same giver to the same person |
| Badges | Repeats | Allowed (the pair limit still applies) |
| Badges | No manager on record | May give up to the directors |
| Badges | Who gave it and why, in public | Shown (recipient and directors always see both) |
| Nudges | Tags | 8 light-hearted tags (Chai Break Champ …) |
| Nudges | Off-limits words | 35 words about attendance, time, leave, missed work, performance and discipline |
| Recruitment | Hiring stages | Screening, Interview, Offer, Hired, Not moving forward |
| Recruitment | Interview rounds | Screening call, Technical, Hiring manager, Final |
| Recruitment | Offer approval; referrals | Off |
| Recruitment | HR runs onboarding | On |
| Autofill | File types and size | PDF, PNG, JPEG; 10 MB |

Fixed rules (not settings): a badge always needs a reason; badges follow the reporting line; weekly/monthly badges end at the India-time
week/month end; a nudge shows for 7 days; only a director gives or removes a nudge; nudges are never created by the system.

## 4. Interface notes for Session A

- **Offer read function.** `readAcceptedOfferForPayroll(directorUserId, employeeId, meta?)` in `backend/src/modules/recruitment/offers.ts`:
  director-only (refuses anyone else), audited on every read (`recruitment.offer.compensation.opened`, purpose `PAYROLL_READ`), returns
  `null` when the employee did not come through recruitment or the offer is not accepted, else `{ offerId, employeeId, joiningDate,
  employmentType, compensation }`. It writes nothing to payroll; whether to start a salary assignment from it is Session A's decision.
- **Asset recovery hand-off (not built).** Peeps provides the incident (an append-only `asset_events` row of kind `LOST`/`DAMAGED` with
  asset, assignment, holder, condition, note, actor, time) and can add `listAssetIncidents({ employeeId?, since? })`. Session A would own the
  money: a recovery table with a unique foreign key to the incident (one recovery per incident), exact amount, reason, proposer, director
  approval, and the reference of the one adjustment that consumed it. Peeps would show back only "none / proposed / approved / settled",
  never the amount. HR never enters an amount.
- **Exit settlement inputs.** Exits hands a director-only, read-only record of exact leave day counts and clearance facts (no amounts) to the
  settlement; see the exits section of the stage reports.
- **Hand-offs from Stage 4 (Session A's test files, not edited by me):**
  1. `backend/src/modules/payroll/__tests__/payPolicies.test.ts` line 118 picks "the first leave type that is not PL, alphabetically"
     (now `BEREAVEMENT`, one of the four new types) and line 162 takes the first leave-balance line, assuming it is PL. The settlement is
     correct (both balances, days only); find the PL line by its label.
  2. `backend/src/modules/payroll/__tests__/fullMonthRehearsal.test.ts` finalises August 2026 attendance and leaves the append-only FINALISE
     event (`attendance_period_locks`, 2026-08-01..2026-08-31, 62 days) for the rest of the run, so any later test that recomputes August in
     the same run stores nothing (Session A's own golden replay included, when it runs after it). Record an UNLOCK in its cleanup. My core
     regression test now guards itself (records an UNLOCK and restores the FINALISE).

## 5. Not verified

- **The full backend suite alone after the independent-review fixes.** The last full local run was on `1f6f5a2` (before them); after them I
  ran the phase check (lint, typecheck, changed tests) and every affected suite (Peeps, recruitment, exits, Insights, autofill, assets, leave,
  leave rules, recognition, audit log), all green. The whole suite after them ran only in CI (§8).
- `npm run test:peeps-demo` (the confidentiality scan on the demo company) runs locally only; CI does not run it (CI files are not mine).
  It was green on Stage 4 phase 2 and was not re-run after the later fixes.
- The independent reviewer could not determine: whether helpdesk notification bodies (they carry the ticket subject) reach anyone outside a
  restricted category's audience; whether the workforce leave dashboard breaks leave down by type for scoped viewers. I did not trace them.
- Staging: nothing was run against staging or production. The mail guard means a staging stack sends mail only to domains listed in
  `MAIL_ALLOWED_DOMAINS`; I did not change the infrastructure code to set it.
- The base `HelpStrip` "Hide help" link is under 44 px on phones (not Peeps code; left alone).
- Session A's `fullMonthRehearsal.test.ts` leftover (August 2026 finalised for the rest of a run) also fails Session A's own golden replay,
  manual-entry, regularization and correction-limit tests when it runs first in the same batch; CI's sharding hides it today.

## 6. Decided by me

Earlier stages' decisions are listed in each stage's report. Stage 4:

- **Masking in autofill.** HR sees extracted PAN, Aadhaar and account numbers as their last four; directors see them whole; there is no
  separate "reveal" button in autofill: opening the source document (already audited) is the reveal.
- **Another HR person's leave documents are the directors' only.** HR still handle everyone else's (the owners' "HR-only documents").
- **Private Peeps rows in the audit log are the directors' only**: Unmute bookings, nudge review requests, leave-document attach/open,
  and director opens of private items. The audit export, which has no user context, leaves them (and the exit and recruitment rows) out
  for everyone, directors included.
- **Office grants follow the audiences.** A member's recruitment and exits keys exist only while the directors open that module to the
  Office, as the asset keys already did.
- **Settings confirmation.** I did not add a second-director step to the recruitment, joining, exits, Insights and autofill settings
  (they take effect on one director's save, with a reason, audited); I corrected the setup guide instead. Adding it is your call.
- **Mail guard defaults.** Outside production the allowlist is empty (nothing is sent until domains are listed); reserved test domains
  and demo employees are refused in every mode; the console driver (a local file) is not guarded. A refusal is reported as a failed send.
- **Seed addresses.** `…@wellsure.example.invalid` and `…@personal.example.invalid`. API-level tests keep random Gmail addresses because
  the base rule requires Gmail for personal addresses; the guard keeps mail away from them outside production.
- **Core regression test precondition.** If it finds August 2026 finalised by another file, it records an UNLOCK for its run and puts the
  FINALISE back afterwards (append-only events, nothing deleted).
- **Payroll test files.** Kept the earlier `runAuthority.test.ts` catalogue edit and the C-1 `monthlyInputsImport.test.ts` fix through the
  merge; did not edit `payPolicies.test.ts` or `fullMonthRehearsal.test.ts` (hand-offs in §4).

## 7. Independent review findings

A fresh reviewer that had not seen the Stage 4 work, given PEEPS_PLAN, the owner decisions and the setup guide, read the code. Seven findings,
all real, all fixed with a test and a mutation check (details in PEEPS_STAGE_REPORTS, Stage 4 phase 9):

1. High — autofill showed HR whole PAN, Aadhaar and account numbers → masked to the last four (`f5c0b3b`).
2. High — the audit log told HR and the Developer who booked Unmute, asked for a nudge review, attached/opened a leave document → those rows
   for directors only (`fddefe2`).
3. Medium — public tag views showed whether a review was asked for → only the person and the directors (`cd32065`).
4. Medium — any HR could open another HR person's medical documents → directors only (`d9eb0b4`).
5. Medium — balances and the ledger named menstrual/medical leave to managers and delegates → "Leave" (`cbca2a5`).
6. Low — the setup guide overstated two-director confirmation → corrected; the owners decide whether to add it (`5978b26`).
7. Low — Office members held recruitment/exits keys while those audiences were closed → keys follow the audience (`8101835`).

The reviewer found the core confidentiality rules holding: offer pay and expected pay directors only; interview feedback panel and directors
only; exit interview answers employee, interviewer and directors only; Unmute participants only; nudges from directors only; the Developer
refused across the Peeps modules; Insights suppressed and Not set; no preset where the guide requires Not set; every screen reachable.

## 8. Final checks

- **Local, on `1f6f5a2`** (before the review fixes): lint and typecheck (all four projects); frontend 29 files / 165 tests; build and bundle
  budgets (login 232.3 KB, employee home 353.7 KB, admin home 372.6 KB); `check:popovers` and `check:sensitive-ui` (906 pages, no secret) on
  fresh databases with the new seed; full backend suite alone 2,576 / 2,584 — the 8 failures are Session A's `payPolicies.test.ts` (1) and
  the 7 caused by `fullMonthRehearsal.test.ts` running first (§4 hand-offs).
- **After the review fixes**: phase check (lint, typecheck, 5 changed test files / 53 tests) and every affected suite green (§5).
- **CI run 406 on `5978b26`, the final code commit, read to the end of every job**: 10 green — install-lint-typecheck-test (lint,
  typecheck, design tokens and bundle budgets, migrate, schema matches migrations, seed, frontend and agent tests, demo company tests),
  backend shards 1, 2 and 4, both sensitive-ui halves, latency (with `check:popovers`), attendance-replay, agent-windows, docker-build.
  **Red:** `backend-tests (3)` — exactly one test, `payPolicies.test.ts` "…a settlement shows leave in days only" (592 passed), the accepted
  Session A hand-off; and `backend-tests-complete`, which only checks that every shard succeeded. Nothing else is red.
