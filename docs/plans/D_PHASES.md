# Director-authority phases (D-phases) — status

Source: `DIRECTOR_AUTHORITY.md` (approved 2026-10-29). Written at Stage 0.7 of the master build.

| Phase | What | Status | Commit |
|---|---|---|---|
| D1 | Director core: `authority` on approvals, `authorise()`, switches (per step, default = one director acts alone), notices/receipts (append-only), red banner, role ceiling (payroll roles Super-Admin-only), 2FA floor, two directors in both datasets | **Done and pushed** | `77cc7a7` |
| D2 | Wire the payroll flows to director authority: run approval, finalise, publish, bank file, unlock, salary revision, rule/component confirmation, HR's bank/statutory change confirmed by a director; Ready-for-first-run row "every Super Admin has two-step sign-in" (required); notices UI | **Built and pushed** (Stage 2). Not built: IDENTITY_DIRECTOR_ENTRY (needs H2) | see STAGE_REPORTS.md |
| D3 | Docs: `FIRST_REAL_PAYROLL_RUN.md` and `GETTING_STARTED.md` state directors' 2FA as a go-live condition with setup steps | **Done** in the D2 commit (FIRST_REAL_PAYROLL_RUN.md, GETTING_STARTED.md) | |
| H1+ | HR/payroll separation phases from `HR_PAYROLL_SEPARATION.md` (HR hard-locks, capability switches) — master Stages 1, 3–5 | Q-DA-9 said D1–D3 first; the master build prompt (2026-10-29) puts Stage 1 (HR capability switches) before Stage 2 (D2). The later instruction is followed; Stage 1 does not touch the approval wiring. | |

Master-prompt stage → D-phase mapping: Stage 0 = D1 close-out; Stage 2 = D2 (+D3 docs); Stage 1 runs before D2 by the master prompt's order; it is HR-side and independent of the approval wiring.
