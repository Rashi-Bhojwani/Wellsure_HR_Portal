# Peeps checklist

Branch `peeps/foundation`. Plan: `PEEPS_PLAN.md`. Reports: `PEEPS_STAGE_REPORTS.md`. Tick an item only when it
is **done and verified**, with the commit hash. A new session reads these three files and continues at the
first unticked item. No real data in this file. Commit numbers are the rows of `PEEPS_PLAN.md` §G.

## P0 — Planning (this stage)
- [x] Git clean; fetched; base `feat/hr-payroll-separation` at `8979072` merged into `peeps/foundation` (`2a4fad1`, no force-push)
- [x] `PEEPS_PLAN.md` sections A–G, `PEEPS_CHECKLIST.md`, `PEEPS_STAGE_REPORTS.md` — commit: see stage report P0
- [x] Owner reviewed the plan; answers recorded at the top of `PEEPS_PLAN.md` (2026-10-30)
- [x] Plan updated with the answers; base merged again (`0621f82`)
- [ ] **STOP: wait for the first build prompt**

## Waiting on (never guessed)
- [ ] Q0 integration guide **pushed** → commit 2 (chapter mapping). Not on the remote as of 2026-10-30
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
- [ ] 7 schema, catalogue, items
- [ ] 8 assignment/return, single active assignment (race test + mutation)
- [ ] 9 requests, incidents, recovery intents (director-only)
- [ ] 10 screens, sensitive-ui/popovers

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
