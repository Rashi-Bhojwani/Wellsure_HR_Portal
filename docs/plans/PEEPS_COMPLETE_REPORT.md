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
mail safety: TO FILL; review fixes: TO FILL.

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

TO FILL after the final full run, CI read and review.

- `npm run test:peeps-demo` (the confidentiality scan) runs locally only; CI does not run it (CI files are not mine to change).
- The base `HelpStrip` "Hide help" link is under 44 px on phones (not Peeps code; left alone).

## 6. Decided by me

TO FILL (see also each stage's "Decided by me" list in PEEPS_STAGE_REPORTS).

## 7. Independent review findings

TO FILL.
