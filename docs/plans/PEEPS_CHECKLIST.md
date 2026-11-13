# Peeps checklist

Branch `peeps/foundation`. Plan: `PEEPS_PLAN.md`. Reports: `PEEPS_STAGE_REPORTS.md`. Tick an item only when it
is **done and verified**, with the commit hash. A new session reads these three files and continues at the
first unticked item. No real data in this file. Commit numbers are the rows of `PEEPS_PLAN.md` §G.

## Speed rule (2026-11-12)
- [x] Recorded in `PEEPS_PLAN.md` ("Speed rule"); `scripts/peeps-check.sh` runs lint, typecheck, changed tests (and `--full` backend
      suite) once per phase and stops on the first failed step
- No per-commit checks; full backend suite alone at stage end and before any merge; CI read once per stage on the final code commit

## P0 — Planning (this stage)
- [x] Git clean; fetched; base `feat/hr-payroll-separation` at `8979072` merged into `peeps/foundation` (`2a4fad1`, no force-push)
- [x] `PEEPS_PLAN.md` sections A–G, `PEEPS_CHECKLIST.md`, `PEEPS_STAGE_REPORTS.md` — commit: see stage report P0
- [x] Owner reviewed the plan; answers recorded at the top of `PEEPS_PLAN.md` (2026-10-30)
- [x] Plan updated with the answers; base merged again (`0621f82`)
- [x] First build prompt received: Module 1, Assets only

## Waiting on (never guessed)
- [x] Q0 integration guide pushed (`ca6e485`) → chapter mapping `d7fa323`
- [x] AS1 confirmed (relationship-based design stays)
- [ ] AS2–AS4 stay settings, Not set (answered: build them as settings)
- [x] Q-F2 answered: me, keys only, inside a PEEPS block
- [x] Q-T1 answered: visibility by category; Payroll category is Session A's
- [x] Q-X2 answered: Session A makes it optional; not touched by me
- [ ] Every module's Not set settings (PEEPS_PLAN §F) — modules refuse to switch on until set and confirmed

## Foundation (checkpoint after 5)
- [x] 3 settings store with Placeholder/Confirmed (Peeps settings) and module readiness — `45626da`
- [ ] 4 confidential-access helper + confidentiality test harness
- [ ] 5 Peeps settings screen
- [ ] CHECKPOINT A: merge latest base, full backend suite alone, report

## Directory and avatars
- [ ] 6 `PersonAvatar`, directory filters (+ preferences if wanted)

## Assets
- [x] 7 schema, settings (Placeholder/Confirmed, Not set), register — `51de81a`
- [x] 8 issue/return/transfer/lost/damaged/acknowledge, single open assignment (race test + mutation M1–M3) — `51de81a`
- [x] 9 incidents recorded as events only; **no recovery, no payroll hook** (owner's brief); interface notes in PEEPS_STAGE_REPORTS — `51de81a`
- [x] 10 screens, DEMO data, check:sensitive-ui / check:popovers extended — `1a244e2`
- [ ] Asset requests by employees (plan §B.2) — not in this brief
- [ ] Follow-ups from the guide: unacknowledged-asset HR task, IMEI/SIM, asset import, profile Assets tab, recovery (Session A + directors)
- [x] Next build prompt received (scope change D-28/D-29, Pair 1)
- [x] Step 0 part 1: Assets full suite (1,737 passed) and CI run 206 green recorded — `923a0de`
- [x] Owner chose option 1 and the "Wellsure Office" workspace (D-30)
- [x] Step 0.1: base merged — `9686c8e`, `75fb655`
- [x] Step 0.2: Assets under D-29/Q-14 (members + directors manage; HR keys removed; HR onboarding-only issue; director-sees-all test; audience setting) — `45626da`, `2c94b6f`
- [x] Module 1: Wellsure Office membership (propose/confirm, grants, scheduled job, drift) + Peeps settings + Unmute — `45626da`, `2c94b6f`
- [x] Module 2: badges and private nudges — `6de8b08`
- [x] Final merge of the base — `1dc28af`, then `162f03f` (Session A's `832947f`); full suite alone and CI: see PEEPS_STAGE_REPORTS
- [x] Full suite alone after `162f03f`: 195 files, 1,951 tests passed; frontend checks pass
- [x] CI flake (Session A's bankRepayment hash assertion) fixed by the merge; scan made to run its Peeps checks inside `visit()` — `7d761a0` (845 → 570 loads)
- [x] CI sensitive-ui time limit: handed to Session A (final instructions); noted in each CI read
- [x] Earlier ticket-desk withdrawal superseded by C-2 authorization (2026-11-03; see Ticket desk below)
- [ ] Follow-ups: badge counts in the directory list; withdrawing a pending proposal/setting; manager-member menu entries (see deviations)
- [x] Stopped after the workspace/Unmute/badges stage (superseded by the final instructions)

## Final instructions (2026-11-01)
- [x] 0.1 Merge `feat/hr-payroll-separation` — `f5f0506`
- [x] 0.2 Assets back to HR and the directors (Q-14), audience setting, onboarding path retired — `b9f0a90`, `03e96fa`
- [x] 0.3 Badges/nudges directors only, badges company-wide (Q-16) — `e0cf2d3`
- [x] Module 1: avatars and directory — `1743d6f`
- [x] Module 2: the four new leave types — `fdb69bf` (plan), `00d9a2d`, `b6c3561`
- [x] Document autofill: planning note in PEEPS_PLAN.md only (no code) — `fdb69bf`
- [x] Mutation checks, frontend checks, screens, full suite alone, CI read — see PEEPS_STAGE_REPORTS
- [ ] Owner to confirm the "Decided by me" list in PEEPS_STAGE_REPORTS (stage of 2026-11-01)
- [ ] Still not started: recruitment, insights, autofill code. Exits was authorized separately in C-3.
- [ ] **STOP: wait for the owner**

## Ticket desk
- [x] 11 category visibility (general categories), move between categories — `0845d17` through `40f0390`
- [x] CHECKPOINT B — full backend 205 files / 2,072 tests; frontend 80; agent 166; lint/typecheck/build/budgets; 4/4 mutations; 16 browser cases; CI all seven jobs green on `40f0390` (run `41621430072`)

## Leave extension
- [ ] 12 four new leave types: rules prepared by HR, approved by a director; requests
- [ ] 13 HR-only supporting documents; year-end exclusion until rules approved

## Exits
- [x] 14 resignations → unchanged `initiateSeparation`; notice snapshots, concurrency/recovery and cancellation/date-move tests
- [x] 15 checklist + live asset return gate; audited director override; assigned-owner Tasks
- [x] 16 encrypted relationship-scoped interviews, default-off HR management, director-only `ExitSettlementInputs`, internal callback and letter requests
- [ ] CHECKPOINT C — implementation `d232308` through `bb27005`; payroll merged through `bbd14e6`. Local checks passed: backend **218 files / 2,154 tests** alone, frontend **89**, agent **166**, lint/typecheck/build/budgets, **5/5 mutations**, sensitive scans and browser walkthroughs. Four leave types off. **CI pending owner paste**; see the C-3 stage report. No next module authorized.

## Recruitment and joining
- [x] 17 requisitions, jobs, pipelines (C-4A)
- [x] 18 candidates, applications, CVs (C-4A)
- [x] 19 interviews, feedback (confidential; C-4A)
- [x] CHECKPOINT D1 — local checks passed; 227 backend files / 2,201 tests; 5 mutations; 454 admin + 228 employee scan pages. CI and owner acceptance pending. Stop; C-4B waits.
- [x] 20 offers + director-only compensation; director-only expected pay — `c1bcae4`
- [x] 21 expiring private links, joining documents, exceptions — `c1bcae4`
- [x] 22 idempotent conversion (race test) — `c1bcae4`
- [x] 23 screens: Offers and joining, candidate Offer tab, public upload page, Referrals, settings — `eeb7b8e`
- [x] Referrals (optional, off by default) — `c1bcae4`, `eeb7b8e`
- [ ] CHECKPOINT D — local checks and CI recorded in the C-4B stage report; owner acceptance pending

## Badges, nudges, Unmute, Insights
- [x] 24 badges — `6de8b08`
- [x] 25 private nudges (sender, recipient, directors audited) — `6de8b08`
- [x] 26 Unmute: scheduling + completion only, booker/host/directors (audited), no notes/topic, race test — `45626da`
- [ ] 27 Insights: turnover, tenure, exit reasons, hiring funnel (definitions Not set, small-group minimum)

## Close-out
- [ ] 28 seed + demo (DEMO labels), GETTING_STARTED, UI_SCREEN_MAP
- [ ] CHECKPOINT E: merge latest base, full suite, final report, merge order confirmed (PEEPS_PLAN §C.3)

## Document autofill
- [ ] Nothing until PEEPS_PLAN §E is answered

## B-1 (2026-11-02/03): sync, reporting-line badges (D-36/D-37), avatar dialog and My profile (D-35)
- [x] Step 0.1 merge latest Session A branch — `179533d`; split sensitive-data scan passes both halves (CI runs 239 and 240)
- [x] Step 0.3 recorded-gender eligibility; menstrual/medical shown as "Leave" to managers; own document open (audited) — `a89b750`
- [x] D-36 badges/cheers follow the reporting line; starter catalogue one click, never preloaded; revoke with reason — `376e900`
- [x] D-37 corrective notes directors only, private, behind nudges.enabled (Not set) — `376e900`
- [x] D-35 avatar dialog (upload, initials, Surprise me, 24 characters, 26 fun picks), one shared avatar, My profile — `eb1154a`
- [x] Idempotent give/note race under serializable isolation (found by CI run 240) — `2fa8886`
- [x] B-1 full backend suite alone and CI reverified in C-1 on `e5826d2` (the original `2fa8886` checks had been skipped at the owner's instruction); see the C-1 report

## C-1 (2026-11-03): verification and attendance leave-label privacy
- [x] Clean start; fetched and switched to `peeps/foundation` at `3e6e4ce`; one coding agent
- [x] Root agent rules and required document links — `cb361fc` (`WORKING_RULES.md` absent, optional)
- [x] Lint, typecheck, frontend 77 tests, build and bundle budgets — see C-1 stage report
- [x] Verify badge and corrective-note P2002/P2034 handling; real same-key races and deterministic conflict coverage (23 recognition tests) — `082bcc0`
- [x] Attendance labels reuse `leaveTypeNamer`; 11 privacy tests; exact shared-file handoff in the stage report — `082bcc0`
- [x] Preserve manager/Developer attendance access rules; no access resolver or payroll application change — `082bcc0`
- [x] Fix the named failing monthly-input audit test's hash substring flake, with deterministic regression fixture — `e5826d2` (step 2.4 exception, test file only)
- [x] 11 mutation checks caught and restored — see C-1 stage report
- [x] Four new leave types inactive on scratch database; no activation or settings changes outside fixtures
- [x] Final full backend suite alone on `e5826d2` — 203 files / 2,057 tests passed; zero skipped/todo
- [x] CI per job on `e5826d2` — all seven jobs passed, including admin and employee sensitive-ui halves (run `41607364573`)
- [x] Final report and Unverified list; STOP after C-1

## Stage 1 of 4 (2026-11-11): sync, clean-up, C-4B
- [x] 0.1 `docs/samples/` removed unread — `63dc34e`; no code, test or doc depended on it (only older plan notes name it)
- [x] 0.2 merged `feat/hr-payroll-separation` `64d3246` — `c6dda07`; payroll catalogue test edit kept; full suite alone 243 files / 2,278 tests; CI run 290 all seven jobs green
- [x] 0.3 CI per job: C-3 run 255 and C-4A run 256 all seven green; C-4A reviewed (findings in the C-4B report)
- [x] 0.4 guide mapping already in PEEPS_PLAN §A.1 (`d7fa323`); no new commit needed
- [x] C-4B backend `c1bcae4`, screens/scans/docs `eeb7b8e`; mutations 3/3 caught
- [x] Final full backend suite alone on `eeb7b8e`: 244 files / 2,288 tests passed
- [ ] CI run 301 on `eeb7b8e`: six jobs green; install-lint-typecheck-test red twice by its 18-minute step limit (slow runners, no failing test) — owner/Session A to raise the limit in ci.yml
- [ ] Owner: choose link lifetime, required joining documents, exception approver; decide the C-4A defaults finding
- [ ] **STOP: wait for the owner (stage 2 not started)**

## Stage 2 of 4 (2026-11-12): sync, carry-overs, Insights, document autofill
- [x] Step 0: merged `feat/hr-payroll-separation` `f915ba3` (CI sharding present) — `92d28d6`; full suite alone 254 files / 2,332 tests; CI run 313 all 12 jobs green to the end
- [x] 1.1 default stages (pipeline v0) and interview rounds, Default, change in settings; changed tests recorded — `5d1f4ec`
- [x] 1.2 joining documents copied once into the restricted category at conversion — `5d1f4ec`
- [x] 1.3 employee code refusal, race-safe (DB unique) — `5d1f4ec`
- [x] 1.4a DEMO Office member with offer + Insights capability; 1.4b log-capture test; 1.4c scan toggles RUN_ONBOARDING — `5d1f4ec`
- [x] 1.4d scan pay rule proven by a temporary break (fired 3 times, nothing else; restored)
- [x] Step 2 Insights — `44c3aef` (property test, matrix, Not-set refusal, leak test, 2/2 mutations)
- [x] Step 3 document autofill — `c4872ca` (local OCR, synthetic documents, field authority, 3/3 mutations)
- [x] Fix CI run 323/327 findings — `4861610`
- [x] Finish: browser walkthrough (56 visits + states), fresh DB no drift, full suite alone on `4861610` 257 files / 2,355 tests, CI run 330 all 12 jobs green, stage report
- [ ] Owner: choose Insights settings, autofill retention, joining settings; review "Decided by me" in the stage 2 report
- [ ] **STOP: wait for the owner (stage 3 not started)**

## Stage 2 prompt received again (2026-11-13): re-sync only
- [x] Steps 1–3 already done (not redone); Step 0 repeated: `feat/hr-payroll-separation` `1aedbb0` merged (`caf368b`), both sides kept
- [x] Typecheck, lint, drift clean; frontend 102/102; CI run 341 all 12 jobs green to the end (sharding present)
- [x] Full backend suite alone: 2,435/2,436. The one failure is a Session A order interaction (profileAndReveal leaves `employee.view` on the
      MANAGER role; customFields expects 403). Reproduced with the two files alone; both identical to Session A's branch; left for Session A
- [ ] Session A: remove the MANAGER grant in `profileAndReveal.test.ts` afterAll (not mine to change)

