# Peeps checklist

Branch `peeps/foundation`. Plan: `PEEPS_PLAN.md`. Reports: `PEEPS_STAGE_REPORTS.md`. Tick an item only when it
is **done and verified**, with the commit hash. A new session reads these three files and continues at the
first unticked item. No real data in this file. Commit numbers are the rows of `PEEPS_PLAN.md` §G.

## P0 — Planning (this stage)
- [x] Git clean; fetched; base `feat/hr-payroll-separation` at `8979072` merged into `peeps/foundation` (`2a4fad1`, no force-push)
- [x] `PEEPS_PLAN.md` sections A–G, `PEEPS_CHECKLIST.md`, `PEEPS_STAGE_REPORTS.md` — commit: see stage report P0
- [ ] **STOP: owner reviews the plan and answers §F** (at least Q0, Q-F1..Q-F3 before commit 3)

## Waiting on (never guessed)
- [ ] Q0 integration guide committed → commit 2 (chapter mapping)
- [ ] AS1–AS4 confirmed by the owners
- [ ] Q-F2 Peeps HR capabilities: who edits `hrCapabilities.ts`
- [ ] Q-T1 helpdesk queue split agreed with the other session
- [ ] Q-X2 two-step sign-in for directors (not mine)
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
- [ ] 11 queues HR/DIRECTORS, escalation, "concerns HR"
- [ ] CHECKPOINT B

## Leave extension
- [ ] 12 extension requests
- [ ] 13 medical document store (confidential)

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
- [ ] 26 Unmute (double-booking race test)
- [ ] 27 Insights (cohort minimum)

## Close-out
- [ ] 28 seed + demo (DEMO labels), GETTING_STARTED, UI_SCREEN_MAP
- [ ] CHECKPOINT E: merge latest base, full suite, final report, merge order confirmed (PEEPS_PLAN §C.3)

## Document autofill
- [ ] Nothing until PEEPS_PLAN §E is answered
