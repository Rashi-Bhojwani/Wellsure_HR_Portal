# Peeps checklist

Branch `peeps/foundation`. Plan: `PEEPS_PLAN.md`. Reports: `PEEPS_STAGE_REPORTS.md`. Tick an item only when it
is **done and verified**, with the commit hash. A new session reads these three files and continues at the
first unticked item. No real data in this file. Commit numbers are the rows of `PEEPS_PLAN.md` §G.

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
- [x] Ticket desk changes: withdrawn by D-29 (no change)
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
- [ ] Not started (by instruction): recruitment, exits, insights, autofill code
- [ ] **STOP: wait for the owner**

## Ticket desk
- [ ] 11 category visibility (general categories), move between categories
- [ ] CHECKPOINT B

## Leave extension
- [ ] 12 four new leave types: rules prepared by HR, approved by a director; requests
- [ ] 13 HR-only supporting documents; year-end exclusion until rules approved

## Exits
- [ ] 14 resignations → `initiateSeparation`
- [ ] 15 checklist + asset return gate
- [ ] 16 exit interviews (confidential), `ExitSettlementInputs`
- [ ] CHECKPOINT C

## Recruitment and joining
- [ ] 17 requisitions, jobs, pipelines
- [ ] 18 candidates, applications, CVs
- [ ] 19 interviews, feedback (confidential)
- [ ] 20 offers + director-only compensation
- [ ] 21 expiring private links, joining documents, exceptions
- [ ] 22 idempotent conversion
- [ ] 23 screens (`recruitment-01..19`)
- [ ] CHECKPOINT D

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
