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
- [ ] 3 settings store with Placeholder/Confirmed, module readiness, module switches
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
- [ ] **STOPPED:** the HR switch framework cannot take Founder's Office switches additively (PEEPS_STAGE_REPORTS, "Scope change D-28 / D-29"); owner to choose an option
- [ ] Step 0 part 2: Assets adjusted to D-28/D-29 (Founder's Office + directors manage; HR onboarding-only issue; director-sees-all test; audience setting)
- [ ] Pair 1 / Module 1: Founder's Office role + switches + Unmute
- [ ] Pair 1 / Module 2: badges and private nudges
- [ ] Ticket desk changes: withdrawn by D-29 (no change)

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
- [ ] 24 badges
- [ ] 25 private nudges (confidential)
- [ ] 26 Unmute: scheduling + completion only, participants only, no notes/topic (double-booking race test)
- [ ] 27 Insights: turnover, tenure, exit reasons, hiring funnel (definitions Not set, small-group minimum)

## Close-out
- [ ] 28 seed + demo (DEMO labels), GETTING_STARTED, UI_SCREEN_MAP
- [ ] CHECKPOINT E: merge latest base, full suite, final report, merge order confirmed (PEEPS_PLAN §C.3)

## Document autofill
- [ ] Nothing until PEEPS_PLAN §E is answered
