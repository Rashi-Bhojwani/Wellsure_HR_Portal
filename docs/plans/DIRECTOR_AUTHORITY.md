# Director authority — plan

**Status: PLAN, awaiting the owner's approval. Nothing here is built and no guard in code has been changed.**
Branch `feat/hr-payroll-separation`. This plan comes **before H1** of
[HR_PAYROLL_SEPARATION.md](HR_PAYROLL_SEPARATION.md) and amends it (§9). No real figures, names, accounts or
identifiers appear here; employee codes are the made-up seed/demo accounts.

I could not find, in the session I can read, the earlier list of answers to the 24 open questions in
HR_PAYROLL_SEPARATION.md §13. I have read "approved with the answers I gave earlier" as **accepting my stated
recommendation for every question you did not override**; the overrides are Q2, Q14 and Q15 below. If any other
answer differed, say so and I will correct both documents before anything is built.

---

## 1. The decisions (as given) and how I read them

1. **Q2** — directors = everyone holding Super Admin; there are **two**.
2. **Q14** — the Payroll helpdesk queue goes to the directors only.
3. **Q15** — Offer, Appointment, Revision and Increment letters carry pay (`carries_pay = true`).
4. **Payroll roles are held by directors only.** `PAYROLL_ADMIN` and `PAYROLL_APPROVER` cannot be granted to anyone
   without Super Admin — a hard ceiling, same mechanism as the HR keys (HR_PAYROLL_SEPARATION §3.4).
5. **Director authority.** A director's action takes effect **at once** and never waits for the other director. It is
   recorded in the audit log and **the other director is notified**. This covers payroll rules, runs, salary
   revisions, publishing, the bank file and settings. An owner can switch a **second-director check back on, per
   step**. HR's bank and statutory changes still need a director to confirm them.
6. This **changes existing guards**: the Placeholder/Confirmed different-person rule, the maker-checker on the seven
   approval subjects, the hash-bound approval, and "nobody changes their own pay".

**My reading of "takes effect at once":** the director's single act performs what two people performed before. It does
**not** mean the safeguards that protect the *content* of what is done are removed. Only the *second human* is
removed (and only while the step's switch is off). §3 lists what I keep regardless; if you want any of it dropped
too, that is a separate decision.

**My reading of "directors"** is the Super Admin role — who already holds every permission in code
(`lib/permissions.ts`). So once payroll roles are director-only, `PAYROLL_ADMIN`/`PAYROLL_APPROVER` are no longer a
separation of duties; they become **markers** (and ceiling targets). §8.

## 2. The model

Every guarded step has an **authority mode**, read from a setting at the moment the step is taken:

| Mode | Meaning | Default |
|---|---|---|
| `DIRECTOR_AUTHORITY` | One director prepares and decides in one act. Recorded; the other director notified. | **every step** |
| `SECOND_DIRECTOR` | The old behaviour: a *different* Super Admin must decide (maker ≠ checker). Nobody but a Super Admin can be the second person. | off, switchable per step |

The mode in force is **copied onto the record at submission** (`payroll_approvals.authority`), so switching a step later
changes new records only and an old record can always be audited under the rules that applied to it.

### 2.1 Steps (the units of the switch)

| Step key | What it covers | Today's subject / code |
|---|---|---|
| `RULE_CONFIRM` | confirming a rule, component, structure, layout, owner's secret (identifiers, bank layout, debit account) | `RULE_CONFIRM` |
| `RUN_APPROVAL` | approving a calculated run | `RUN_APPROVAL` |
| `PERIOD_FINALISE` | closing the period | `PERIOD_FINALISE` |
| `PERIOD_UNLOCK` | unlocking a closed period | `PERIOD_UNLOCK` |
| `SALARY_REVISION` | making, cancelling and applying a salary revision | `SALARY_REVISION` |
| `PAYSLIP_PUBLISH` | publishing payslips | `PAYSLIP_PUBLISH` |
| `BANK_FILE` | generating the bank file | `BANK_FILE` |
| `SETUP_SIGNOFF` | signing off people's pay details | `setup/signoffs.ts` (not an approval subject) |
| `IDENTITY_DIRECTOR_ENTRY` | a *director's own entry* of an employee's bank/statutory data (HR's entries are never switchable: always a director confirms) | new in H2 |
| `SETTINGS` | changes to System Settings | `modules/settings` (single-person today) |

Nine of ten correspond to a guard that exists; `SETTINGS` has none today (one person edits them), so for it the change is
only the notification (§6), and the switch lets an owner add a second-director check.

## 3. What does NOT change (kept in both modes)

These are not "the second person", so decision 5 does not touch them. Dropping any is a separate decision.

1. **Preview, then explicit confirmation.** The preview fingerprint (`previewFingerprint`/`PREVIEW_STALE`) is still
   required: a director confirms the exact thing on screen.
2. **Hash-bound execution.** The action that carries a step out re-computes the content hash and **refuses** if the
   figures moved since the preview (`consume` in `approvals.ts:196`). With `DIRECTOR_AUTHORITY` the approval is
   created, decided and consumed inside one request, so there is no waiting period in which to be "voided by
   change" — but the re-check inside the transaction remains, and a concurrent edit still stops the action.
3. **Single use, one live approval per subject**, rejection/void reasons, append-only records, DB triggers that make
   them append-only.
4. **Audit log and payroll events** for every step, with the hash, the mode and the actor.
5. **The notification** to the other director (§6) — not switchable.
6. **No self-dealing on pay** — decision 3 changes "nobody changes their own pay" only in the way §5.6 proposes
   (Option A: it stays absolute). Needs your answer (Q-DA-2).
7. **Unlock hard blocks**: once payslips are published or a bank file generated the period cannot be unlocked (DB
   trigger, `finaliser.ts:81`); an unlock needs a written reason.
8. **TEST watermark / `assertRunIsReal`**: a run that used an unconfirmed (Placeholder) value is TEST and cannot be
   finalised, published or paid. Confirmation still has to *happen* — a director does it — it just no longer needs a
   different person. Statutory figures are still confirmed by **typing the figure again**, and every confirmation
   still carries a note of what it was checked against (≥ 5 characters).
9. **Developer ceiling**, owner's-secret sealing/reveal audit, **HR can never confirm** (ceiling).
10. **Nothing moves money**: the bank file is still only a file.
11. **Bank/statutory changes entered by HR still need a director to confirm** (decision 5, last sentence): not
    switchable, enforced as H2 designed.

## 4. Every existing guard this touches

Paths are relative to `backend/` unless noted. "Switch OFF" = `DIRECTOR_AUTHORITY` (the default). "Switch ON" =
`SECOND_DIRECTOR`. Line numbers are as of `58a6e13`+docs.

### 4.1 The maker-checker core — `src/modules/payroll/approvals.ts`

| # | Guard | Where | Today | Switch OFF (default) | Switch ON |
|---|---|---|---|---|---|
| G1 | Maker must hold the maker permission | `submit` `:90` | `holds(maker, adapter.makerPermission)` | unchanged (director holds all) | unchanged |
| G2 | Maker is not a person affected (own pay) | `submit` `:91-93` `MAKER_IS_AFFECTED` | refuses | **unchanged — kept** (Option A, §5.6) | unchanged |
| G3 | Checker must hold the checker permission | `decide` `:129` | `holds(checker, checkerPermission)` | n/a — no separate checker; the same director's decision is recorded with `authority = DIRECTOR_AUTHORITY` | checker must be a Super Admin other than the maker |
| G4 | **Checker ≠ maker** | `decide` `:130` `CHECKER_IS_MAKER` | refuses | **removed for this mode only**: allowed when `authority = DIRECTOR_AUTHORITY` and the actor is a Super Admin | kept |
| G5 | Checker is not affected (own pay) | `decide` `:131-133` `CHECKER_IS_AFFECTED` | refuses | kept | kept |
| G6 | Checker did not change the figures since submission | `decide` `:134-135` `CHECKER_EDITED_FIGURES`; `events.ts figureEditorsSince` | refuses | not applicable (no gap between submit and decide); `noteFiguresChanged` still records the actor | kept |
| G7 | Hash re-check at decision; `PREVIEW_STALE`; void on mismatch | `decide` `:138-146` | refuses/voids | **kept** (§3.2) | kept |
| G8 | **DB: checker ≠ maker** | `prisma/migrations/20261016090000_payroll_foundations` `payroll_approvals_checker_not_maker` | CHECK `checker <> maker` | **rewritten**: `checker IS NULL OR checker <> maker OR authority = 'DIRECTOR_AUTHORITY'`; plus a trigger that `DIRECTOR_AUTHORITY` is only accepted when the (single) actor holds Super Admin at that moment | CHECK holds as before (`authority = 'SECOND_DIRECTOR'` rows) |
| G9 | One live approval per subject | unique index `payroll_approvals_one_live` | unchanged | unchanged | unchanged |
| G10 | `consume`: single use + hash re-check | `consume` `:196-214` | refuses when none approved | **kept**; an authority approval is created, decided and consumed in the same transaction | kept |
| G11 | `recordCompletedApproval` (rule confirmation as an approval record) — different person | `:216-227` `CHECKER_IS_MAKER` | refuses | allowed when `authority = DIRECTOR_AUTHORITY` | kept |
| G12 | `checkerAvailability` / `availabilityFrom`: "Nobody can approve this right now… no way around this step" | `:230-279` | counts holders ≠ maker | **rewritten**: in OFF mode there is nothing to wait for; the message becomes "You can do this yourself; the other director will be told." In ON mode it counts Super Admins other than the maker | as today, restricted to Super Admins |

### 4.2 The seven approval subjects (adapters registered with `registerSubject`)

All `makerPermission`/`checkerPermission` pairs collapse to "a Super Admin" in OFF mode; the permission keys stay in the
catalog so ON mode (and the audit trail) keep working.

| Subject | Adapter | Maker / checker today | Other guard attached |
|---|---|---|---|
| `RULE_CONFIRM` | `src/modules/payroll/items.ts:116` | `payroll.rules.manage` / `payroll.rules.confirm` (owner secrets: `payroll.identifiers.*`, `payroll.banklayout.*` via `gates.ts`) | G13–G16 below |
| `RUN_APPROVAL` | `src/modules/payroll/run/closing.ts:64` | `payroll.run` / `payroll.approve`; `onVoided` returns the run to CALCULATED and voids `PERIOD_FINALISE` | G18 |
| `PERIOD_FINALISE` | `closing.ts:81` | `payroll.run` / `payroll.approve` | G18 |
| `PERIOD_UNLOCK` | `closing.ts:93` | `payroll.unlock` (Super Admin only) / `payroll.approve` | G18, §3.7 |
| `PAYSLIP_PUBLISH` | `closing.ts:105` | `payroll.run` / `payroll.approve`; hash = every payslip's content hash | G19 |
| `BANK_FILE` | `closing.ts:121` | `payroll.run` / `payroll.approve`; hash = rows + accounts (by hash) + date + layout | G19 |
| `SALARY_REVISION` | `src/modules/payroll/salary/revisions.ts:803` | `payroll.salary.edit` → (H5) `payroll.salary.revise` / `payroll.approve`; `affectedUserIds` | G20–G22 |

### 4.3 Placeholder / Confirmed (different-person rule) — four layers today

`src/modules/payroll/__tests__/selfConfirmLayers.test.ts` proves each layer on its own.

| # | Layer | Where | Today | Switch OFF | Switch ON |
|---|---|---|---|---|---|
| G13 | Service preview | `items.ts previewConfirmation` `:198-204` ("You wrote this value…") | blocks the author | no block for a Super Admin author | blocks the author |
| G14 | Service confirm | `items.ts confirmVersion` `:235` `CHECKER_IS_MAKER`; and `rules/governed.ts confirmRule`, `salary/components.ts`, `salary/structures.ts`, `run/layouts.ts`, owner-secret services | refuses | allowed, recorded `self_confirmed = true` | refuses |
| G15 | Approval core | `approvals.recordCompletedApproval` (= G11) | refuses | allowed in `DIRECTOR_AUTHORITY` | refuses |
| G16 | DB constraint + trigger | `payroll_approvals_checker_not_maker` (G8) and `payroll_item_confirmations_guard` (`PAYROLL_CONFIRM_SAME_PERSON`, `20261016090000_payroll_foundations:58-70`) | refuse | trigger rewritten: same person allowed only if the new column `payroll_item_confirmations.self_confirmed = true` **and** the confirmer holds Super Admin | unchanged behaviour |
| G17 | Setup checklist re-derivation | `setup/status.ts:38-40` (`problem`: "confirmed by the person who entered it. That should be impossible") | flags a self-confirmation as a **problem** and keeps the item red | must not flag a `self_confirmed` row recorded under authority mode (otherwise the checklist stays red forever); still flags a self-confirmation with **no** `self_confirmed` record (= bypass) | unchanged |

Also affected: the "Placeholder" **meaning** in the UI (`components/payroll/PlaceholderBanner.tsx`, `RulesPage`,
`LayoutsPage`, `StructuresPage`, `ComponentsPage`): copy changes from "a different person has to confirm" to "a
director has to confirm" (and, when the step's switch is on, "a different director").

### 4.4 "Carried out by someone other than the person who decided"

| # | Guard | Where | Today | Switch OFF | Switch ON |
|---|---|---|---|---|---|
| G18 | Finalise and unlock | `run/finaliser.ts:50-ish` (finalise: `CHECKER_IS_EXECUTOR`), `:76` (unlock) | executor ≠ any checker | removed in this mode (decider = executor is the point) | kept |
| G19 | Publish payslips / bank file | `run/release.ts:48-56 decidedBy` `CHECKER_IS_EXECUTOR`; routes `payroll/routes.ts:120` | executor ≠ checker | removed in this mode; the re-check of the approval hash (the second half of `decidedBy`) stays | kept |

### 4.5 Own pay — "nobody changes their own pay"

| # | Guard | Where | Today | Under this plan |
|---|---|---|---|---|
| G20 | `assertNotOwnPay` | `salary/guards.ts:18`; used at `revisions.ts:331,456,466,494,616` and `adjustments.ts:48,101` | refuses, Super Admin included | **kept (Option A)** — see §5.6 |
| G21 | Revision preview drops the actor's own record ("Your own pay: somebody else has to prepare…") | `revisions.ts:325-340` | skips | kept |
| G22 | `affectedUserIds` on the `SALARY_REVISION` adapter | `revisions.ts:811` → G2/G5 | refuses maker/checker who is affected | kept |

### 4.6 Sign-offs, readiness and roles

| # | Guard | Where | Today | Switch OFF | Switch ON |
|---|---|---|---|---|---|
| G23 | Setup sign-off: signer ≠ person who entered the rows | `setup/signoffs.ts:84-93 blockReason` (`SIGNER_ENTERED_THIS`), `setup/status.ts:104` | refuses | a director may sign off rows they entered or confirmed; **recorded** with `authority`; HR-entered rows never qualify as "entered by the signer" since HR cannot sign | refuses the author, **and** (Q-DA-4) the confirmer of the rows |
| G24 | Signer needs `payroll.approve` + the area's view permission | `signoffs.ts:85-86` | refuses | unchanged (director holds them) | unchanged |
| G25 | Ready-for-first-run "At least two different people can prepare and approve payroll" | `setup/status.ts:184-188` (`safety:two-people`) | needs maker ≠ checker holders | **rewritten**: "At least two active directors" (so each can be notified of the other's acts and one can set the other's pay) | same, plus "…for each step whose switch is on" |
| G26 | "Everyone who handles payroll uses two-step sign-in" | `setup/status.ts:190-196` | all holders of payroll keys | keeps; now = every Super Admin | keeps |
| G27 | Role split: `PAYROLL_ADMIN` (maker set) vs `PAYROLL_APPROVER` (checker set) so "the same person cannot hold both halves by default" | `src/lib/systemRoles.ts:106-136` | two roles, separate people | **director-only ceiling** (§8) | same |
| G28 | `payroll.unlock` Super Admin only | `finaliser.ts:70`, `PERIOD_UNLOCK` adapter | Super Admin asks, a second person approves | Super Admin acts alone (reason required; hard blocks stay) | second Super Admin approves |
| G29 | Checker lookup endpoint | `payroll/routes.ts:45` `GET /approvals/checkers` | lists eligible checkers | returns "no second person needed" in OFF mode, Super Admins ≠ actor in ON mode | as today restricted |

### 4.7 Frontend (copy and behaviour, no new design)

`components/payroll/RunApprovalPanel.tsx`, `CancelScheduledModal.tsx`, `PlaceholderBanner.tsx`; pages `RulesPage`,
`LayoutsPage`, `StructuresPage`, `ComponentsPage`, `SalaryRevisionsPage`, `EmployeeSalariesPage`, `RunStepPage`,
`SetupChecklistPage` (under `frontend/src/pages/admin/payroll/`). In OFF mode the "Request approval → wait → decide →
carry out" sequence collapses to one **"Confirm and do it"** button that still shows the preview and requires the
fingerprint; the panel says "recorded; the other director will be told". In ON mode nothing changes visually. The
run's state machine (CALCULATED → SUBMITTED → APPROVED → FINALISED) is **kept** — the transitions simply happen in
one request — so reports, exports and the register keep reading the same states.

### 4.8 Documents that state the old rules

`docs/plans/PHASE_6.md` (§6 maker-checker, §14B own pay, §14J owner's secrets), `PHASE_6_REVIEW.md`,
`docs/FIRST_REAL_PAYROLL_RUN.md` ("checked by a different person", "unlock… a second person approves"),
`docs/GETTING_STARTED.md` (the `1025`/`1027` walkthrough), `docs/SENSITIVE_DATA.md`, `docs/plans/PHASE_7.md` (every
step that says "different person"/"maker-checker"), `docs/plans/HR_PAYROLL_SEPARATION.md` (§9 below).

## 5. Design

### 5.1 Schema (one migration, in commit D1)

- `payroll_approvals.authority` enum `SECOND_DIRECTOR | DIRECTOR_AUTHORITY`, `NOT NULL DEFAULT 'SECOND_DIRECTOR'`
  (every existing row is, truthfully, `SECOND_DIRECTOR`).
- `payroll_item_confirmations.self_confirmed boolean NOT NULL DEFAULT false`.
- `payroll_setup_signoffs.authority` (same enum), default `SECOND_DIRECTOR`.
- Constraint/trigger rewrites as in G8 and G16. Both new columns are written by the service from the **setting read
  inside the transaction**, never from the request body.
- `director_action_notices` (append-only) — §6.
- A DB trigger on `user_roles`: `PAYROLL_ADMIN`/`PAYROLL_APPROVER` may be inserted only for a user who already holds
  `SUPER_ADMIN`, and `SUPER_ADMIN` cannot be removed from a holder of either (it must remove them first), plus the
  resolve-time strip in `lib/permissions.ts` (§8). Existing non-director holders: the migration lists them and **fails
  loudly** (no silent revoke of someone who may be mid-payroll); the owner resolves them first (Q-DA-8).

### 5.2 The setting

- Stored in `system_settings` (existing table, `settings.manage`): key `payroll.secondDirector` →
  `{ RULE_CONFIRM: false, RUN_APPROVAL: false, … }` (all ten steps). **Default: every step `false`** (a director acts
  alone). Read through one function (`lib/directorAuthority.ts`) used by every guard above; a missing key means OFF.
- UI: Admin Tools → System Settings → a "Second-director check" panel (owner only, with the rest of System Settings),
  one toggle per step, each saying what it covers.
- Every change: audit row (before/after, actor), and the other director is notified (§6) — **in both directions**.
- **Who may change it and how it is protected is Q-DA-5**: as written it is itself a director act that takes effect at
  once, which means one director can switch a check *off* that the other director switched *on*.

### 5.3 What "at once" looks like in code (OFF mode)

`submit()` and `decide()` become one `authorise()` call: inside one transaction it reads the setting, writes the
approval row with `authority`, `maker = checker = actor`, status `APPROVED`, `hashAtDecision = liveHash`, writes the
event rows (`SUBMITTED`, `APPROVED`) and the notice row; the carrying-out action then calls `consume()` in the same
or the next request as today. If the setting is ON the same call writes a `PENDING` row exactly as now.

### 5.4 Bank/statutory (H2) under this model

HR entries: always `PENDING` until a director confirms (requester ≠ confirmer, ≠ subject, HR cannot confirm). A
director's own entry: `DIRECTOR_AUTHORITY` applies at once with a notice, **except** a change to the director's *own*
account or numbers, which the other director must confirm (same reasoning as §5.6). The step's switch
(`IDENTITY_DIRECTOR_ENTRY`) can make every director entry wait for the other director.

### 5.5 Q3 and Q7 under the new model

- **Q3 (who checks a salary revision)** — *old:* maker director, checker `payroll.approve` holder. *Now:* no
  checker by default; the director who prepared it decides it in the same act; the other director is notified. When
  `SALARY_REVISION` is switched on, the checker is **the other Super Admin** (never a payroll role — they no longer
  exist outside directors). A director's **own** revision is made by the other director (§5.6) in either mode.
- **Q7 (setup sign-off independence)** — *old:* bar the requester and also the confirmer of bank/statutory rows. *Now:*
  HR cannot sign off (no `payroll.approve`), so "the signer entered the rows" can only mean a director who entered
  or confirmed them. OFF: allowed and recorded (`authority`). ON: a director who entered **or confirmed** any of
  the rows cannot sign — with two directors that means the sign-off needs the director who did neither, so if both
  confirmed some rows the area cannot be signed off until the rows are re-confirmed by one (Q-DA-4 asks you to
  choose between "bar both", "bar only the entrant", and "bar nobody").

### 5.6 A director changing their own pay

This is the risk that decision 6 opens. The two options:

- **Option A (my recommendation): keep it absolute.** `assertNotOwnPay` and the affected-person guards (G2, G5, G20–G22)
  stay in both modes. With two directors this is always satisfiable: each director's pay is set by the *other*
  (who acts at once and is not "notified of themselves" — the affected director is the notified one, which is the
  right person to know). A one-director period is impossible (Q2 says two); the Ready check requires two active
  directors (G25).
- **Option B: allow it under authority**, audited and notified after the fact. A director could raise their own pay,
  publish the payslip, and generate the file in one sitting; the only control left is a notice the other director
  reads *afterwards* (and in a firm of two owners who hold equal power, it also means each can set the other's pay
  without the other's consent either way). I do not recommend it; if you choose it I would still want `SALARY_REVISION`
  for **own pay** to stay switched to `SECOND_DIRECTOR` regardless of the setting.

### 5.7 Related checks that stay person-independent

`payroll.approve`-style checks that test **who is affected** are *not* "second person" checks; they protect against
self-dealing and survive the model change (G2, G5, G20–G22, and G9/§5.4 for own bank account).

## 6. Notification design

**Rule:** every director action taken in `DIRECTOR_AUTHORITY` mode (and every change to the switch itself, and every
System Settings change by a director) notifies **every other active Super Admin**, from the same transaction as the
action, never blocking it.

- **Record first (outbox):** `director_action_notices` (append-only, DB trigger like other audit tables): `id`,
  `step`, `subject_type`, `subject_id`, `subject_label` (e.g. "the payroll run for October", never a figure),
  `actor_user_id`, `approval_id?`, `authority`, `created_at`, plus per recipient `director_action_receipts`
  (`notice_id`, `recipient_user_id`, `delivered_at?`, `seen_at?`, `acknowledged_at?`, `failed_reason?`).
  Written in the **same transaction** as the action, so an act without a notice cannot exist.
- **Delivery after commit** (queue job modelled on `jobs/securityAlertQueue.ts`): (1) in-app bell notification via
  `notifyEmployee` (+ realtime `notification.new`), (2) a Tasks-inbox entry "Director action to review" until the
  recipient opens it, (3) an e-mail through `MailService` (retry 24 h on failure). A failed delivery is recorded on
  the receipt and shows as a banner for the actor and the recipient; it does **not** undo the act.
- **Content:** who, what step, which subject label, when, a link to the audit/payroll record, and the mode. **No
  amounts, names of employees beyond the subject label, or any identifier** — the e-mail leaves the system. For a
  salary revision the label is "a salary revision for N people" (N, not who).
- **Own-pay case:** the affected director is the recipient of the notice for their own revision (they are the "other
  director"), with the label "your pay was revised" — never the amount.
- **No other active director** (e.g. one deactivated): the notice is stored with zero receipts and a Ready/dashboard
  warning ("N director actions were taken with nobody to tell"); also blocked at the Ready check (G25).
- **Escalation:** an unacknowledged notice older than the configured days (setting, default off) raises the same
  red banner the break-glass events use (`security_events` pattern) — Q-DA-6.
- **Digest:** none by default; the Audit Log (owner-only) lists every authority act, filterable by step.
- Also notified, same mechanism: HR's pending bank/statutory changes keep going to directors (H2), unchanged.

## 7. Tests

### 7.1 Existing tests that change (all in `backend/src/modules/payroll/__tests__/` unless stated)

| File | Assertions that encode the old rule (approx. count) | Change |
|---|---|---|
| `approvals.test.ts` | 3 + lifecycle (`:53-70`, `:96`, `:108`, `:175`) | run each subject twice: `authority` ON (old expectations) and OFF (new); "checker is never the maker" holds only in ON mode; DB-constraint test splits into two |
| `selfConfirmLayers.test.ts` | 8 (the four layers) | keep the four-layer structure **for ON mode**; add four OFF-mode tests proving each layer now *allows* a Super Admin and still refuses a non-Super-Admin; the DB trigger test uses `self_confirmed` |
| `rules.test.ts` | 2 | OFF: a director confirms their own rule and the run stops being TEST; ON: refuses |
| `salary.test.ts` | 11 | split ON/OFF; **own-pay tests unchanged** (Option A) |
| `salaryCancel.test.ts` | 3 | same |
| `runClosing.test.ts` | 2 | OFF: a director finalises their own approval; ON: `CHECKER_IS_EXECUTOR` kept |
| `releases.test.ts` | 4 | same for publish and bank file |
| `setupChecklist.test.ts` | 2 | `safety:two-people` → two directors; self-confirmed row not flagged in OFF, flagged when unrecorded |
| `demoCompany.demo.test.ts`, `backend/scripts/demo/seedDemoCompany.ts` | – | demo uses authority mode; second director added (also needed by HR separation) |
| `src/modules/access/__tests__/*` | – | payroll-role ceiling tests |
| frontend: `RunApprovalPanel`, `CancelScheduledModal`, `PlaceholderBanner` tests | – | one-button flow and copy |
| `payrollGuards.test.ts` | – | unchanged (no literal rates, no floats, no clock reads); the new code must pass it |

### 7.2 New tests

- A **mode matrix test** over all ten steps: default OFF, each switch independently ON, and the setting read inside
  the transaction (flip it mid-request → the record carries the mode that was read).
- DB: `authority = DIRECTOR_AUTHORITY` is refused when the actor is not a Super Admin; `self_confirmed = true`
  likewise; `payroll_approvals` rows remain append-only.
- Hash-binding in OFF mode: change the figures between preview and action → refused (`APPROVAL_VOIDED`/`PREVIEW_STALE`).
- Notice: created in the same transaction (kill the process after commit → the notice exists; roll back the action →
  no notice); delivered to the other director only; no amounts anywhere in the notice, e-mail body or socket payload
  (sentinel crawl); failure to deliver does not undo the act; zero-director case warns.
- Role ceiling: granting `PAYROLL_ADMIN`/`PAYROLL_APPROVER` to a non-Super-Admin is refused by the service, the
  resolver and the trigger.
- Own pay: a director cannot prepare, decide, apply or cancel a change to their own pay in either mode; the other
  director can; a director's own bank/statutory change needs the other director.

### 7.3 Planned mutation checks

1. delete the `authority = 'DIRECTOR_AUTHORITY'` clause from the rewritten CHECK → "DB refuses non-Super-Admin authority" fails;
2. let the service pass `authority` from the request body → "mode is read inside the transaction" fails;
3. skip the hash re-check in `authorise()` → "figures changed between preview and action" fails;
4. stop writing the notice → "no act without a notice" fails;
5. send the notice to the actor too / to nobody → "other director only" fails;
6. remove `assertNotOwnPay` from one revision path (five call sites, one by one) → the named own-pay test per site fails;
7. let ON mode accept maker = checker → the ON-mode `CHECKER_IS_MAKER` test fails;
8. drop `self_confirmed` from the confirmation trigger → the OFF/ON trigger tests fail;
9. let a non-director hold `PAYROLL_ADMIN` (remove the trigger) → the ceiling test fails;
10. let the Setup checklist ignore an unrecorded self-confirmation → the "bypass is flagged" test fails.

## 8. Roles and the ceiling (decision 4)

- `PAYROLL_ADMIN` and `PAYROLL_APPROVER` stay in `SYSTEM_ROLES` (their permission sets are the checklist of what
  payroll work needs, and ON mode and the audit trail refer to them) but can be held **only with `SUPER_ADMIN`**:
  service refusal (`modules/access/service.ts`), resolve-time strip in `lib/permissions.ts` for anyone without Super
  Admin, and a DB trigger on `user_roles` (the pattern of `20261023090000_developer_not_super_admin`). A
  per-user GRANT of any `payroll.*` key to a non-Super-Admin is refused the same way. This is the same mechanism as
  `HR_FORBIDDEN_KEYS` (HR_PAYROLL_SEPARATION §3.4), so I would implement both in H1 as one `PAY_CEILING` set.
- Consequence to be aware of: a Super Admin already holds every key, so the roles add nothing to what a director
  can do. They remain useful as labels in the Roles page, in the setup checklist rows, and for the room names
  (`perm:payroll.*`) the sockets use. If you would rather delete the two roles, say so and I will migrate their
  permissions into a documentation-only list instead (Q-DA-8).
- Also follows: the demo accounts `1025`/`1027` and `DEMO002`/`DEMO003` can no longer be payroll staff who are not
  directors (§9).

## 9. Amendments to HR_PAYROLL_SEPARATION.md (applied in the same commit as the change they describe)

| Section | Was | Becomes |
|---|---|---|
| §3.5 default holders | confirm/revise/payroll-helpdesk keys to PAYROLL_ADMIN/APPROVER and SA | **Super Admin only** (payroll roles are director-only) |
| §4 migration | grants new keys to payroll roles | grants to SA only; **plus** a pre-flight that fails if a non-director holds a payroll role |
| §7 helpdesk | `helpdesk.payroll.manage` for PAYROLL_ADMIN + directors | **Q14: directors only** — the Payroll queue is `helpdesk.directors.manage`; `helpdesk.payroll.manage` is not created, `queue = PAYROLL` is merged into `DIRECTORS` or kept as a label (decide at H3; recommend merging) |
| §6 / Q15 | Offer only | Offer, Appointment, Revision, Increment: `carries_pay = true` (the latter two are created as templates with currency fields in H4, since they do not exist yet) |
| §9 demo | `DEMO003` approves `DEMO002`'s work | no payroll staff; two directors; HR + directors only |
| §10 tests / §11 commits | H5 re-gates revisions to `payroll.salary.revise` held by SA | H5 stays (revise is SA-only already), but is reduced to the key split; the ON/OFF logic lives in D1–D3 |
| Q3, Q7 | open | answered in §5.5 above (pending Q-DA-4) |

## 10. Risks

1. **One person can now do the whole chain** (prepare → approve → finalise → publish → bank file) in minutes. The
   only after-the-fact control is the notice + audit log. Mitigations: preview/fingerprint, hash re-check, TEST
   watermark, the unlock hard blocks, two-step sign-in required for every director (G26), and the per-step
   switches. A compromised director account is therefore the highest-impact event in the system; I recommend
   **mandatory 2FA for Super Admin** be enforced before real use (it is a Ready check today for payroll holders).
2. **A director changing their own pay** — §5.6. Option B would remove the only structural barrier to self-dealing.
3. **The switch can be turned off by the director it was meant to constrain** (§5.2). Without a rule such as "turning
   a check *off* needs the other director" the switch is advisory.
4. **Notice is advisory, and can fail.** E-mail down, notice unread, or the other director on leave: the act stands.
   The red-banner escalation (Q-DA-6) and the zero-recipient warning mitigate; they do not prevent.
5. **Placeholder/Confirmed loses its "second pair of eyes" meaning.** A director can type a rate, confirm it at once
   and a real run will use it. The CA-letter note (≥ 5 chars) and typed-again statutory figures stay, but a wrong
   figure is now caught only by the variance report and the human reading the preview.
6. **Weakened forensic story.** Old approvals proved two people agreed. New records say one director acted and was
   announced. The `authority` column keeps the two eras distinguishable; reports must not call an authority record
   "approved by a second person" (the UI copy changes accordingly).
7. **Migration risk on live data.** Rewriting two constraints/triggers on `payroll_approvals` and
   `payroll_item_confirmations`: forward-only, tested on a scratch DB loaded with old-style rows; rollback is a new
   forward migration restoring the strict versions (valid only if no `DIRECTOR_AUTHORITY` rows exist, otherwise they
   must be re-labelled first — I will say so in the migration).
8. **Hidden coupling:** the run state machine, `reverifyRun` (voids on figure change), the `onVoided` hooks, socket
   events and the setup checklist all assume a time gap between request and decision. OFF mode keeps the states but
   collapses the gap; I will test every transition and each `onVoided` path.
9. **Two directors = a single point of failure.** If one is unavailable, ON-mode steps stop (by design); OFF mode
   continues. A director leaving the company means the Ready check goes red until another is appointed.
10. **Scope creep in the HR plan:** H3/H4/H5 text changes (§9). I will not build any until you approve both
    documents.

## 11. Proposed commit plan (after approval; each reviewable, I pause after each)

Standing rules for every step: fresh scratch database, full backend and frontend suites run alone, lint, typecheck,
migration drift clean, the mutation checks listed for that step, a browser walkthrough as more than one role, CI read
after each push and reported honestly, `main` untouched.

| # | Commit | Contents |
|---|---|---|
| D1 | Authority core | `lib/directorAuthority.ts`, setting + panel (all OFF), migration (columns, rewritten constraint/triggers), `authorise()` in `approvals.ts`, notice tables + delivery job, role ceiling, unit/DB tests, mode-matrix test |
| D2 | Subjects | wire the ten steps (`items.ts` + governed services, `run/closing.ts`, `finaliser.ts`, `release.ts`, `revisions.ts`, `signoffs.ts`, `setup/status.ts`, settings notices), update the existing tests (ON expectations kept, OFF added) |
| D3 | UI, copy and docs | panels/pages in §4.7, `FIRST_REAL_PAYROLL_RUN.md`, `GETTING_STARTED.md`, `PHASE_6.md`/`PHASE_7.md` notes, `SENSITIVE_DATA.md`, demo seed with two directors, walkthrough as both directors and as HR |

Then **H1…H8 of HR_PAYROLL_SEPARATION** with §9 applied. Whether D1–D3 precede H1 or are merged into it is Q-DA-9.

## 12. Open questions (each with my recommendation; no default chosen for you)

**Q-DA-1. Is "takes effect at once" meant to drop the content safeguards too?** I kept preview + fingerprint, hash
re-check, audit, TEST watermark and the unlock hard blocks (§3). *Recommend:* keep them.

**Q-DA-2. A director's own pay (§5.6).** Option A (absolute, the other director sets it) or B (allowed under
authority)? *Recommend:* A. Same question for a director's own bank/statutory (§5.4): *recommend* the other director
confirms.

**Q-DA-3. Is the audit-and-notice model enough for the riskiest steps?** `PERIOD_UNLOCK`, `BANK_FILE`, and
`SETTINGS` carry the most damage. *Recommend:* leave all OFF as you said, but ship the three with their switches
visible, and consider turning on `BANK_FILE` first once real payroll starts.

**Q-DA-4. Setup sign-off in ON mode** — bar both the entrant and the confirmer, only the entrant, or nobody?
*Recommend:* bar the entrant only; the confirmer already is a different person from HR, and barring both can make
the area impossible to sign with two directors.

**Q-DA-5. Protecting the switch.** (a) any director can switch any step either way at once (notified), (b) switching a
check **on** is immediate but switching it **off** needs the other director to accept, (c) the switch can only be
changed by the director who is not currently the actor of a pending step. *Recommend:* (b) — it is the one place a
second director is worth keeping; it does not conflict with your instruction because the switch is a setting about
the system, and you can overrule me.

**Q-DA-6. Escalation of unread notices:** raise a red banner if a director action is not acknowledged within N days
(*recommend* 3), and e-mail `SECURITY_ALERT_EMAIL` as well? *Recommend:* banner yes, extra e-mail no.

**Q-DA-7. Do notices carry any detail beyond the subject label** (e.g. "N payslips", "N people")? *Recommend:* counts
only; no amounts, no names.

**Q-DA-8. The roles themselves.** Keep `PAYROLL_ADMIN`/`PAYROLL_APPROVER` as director-only markers (my plan), or
remove them and keep only Super Admin? And what do we do about any existing non-director holder (the dev seed's
`1025`/`1027`, the demo company's `DEMO002`/`DEMO003`) — convert them to ordinary employees and add a second
director? *Recommend:* keep as markers; convert; add the second director to both datasets.

**Q-DA-9. Order.** D1–D3 before H1, or fold the ceiling into H1 and the authority logic into H5? *Recommend:* D1–D3
first: the HR work (H2's confirmation, H3/H4's director-only queues and issuing) depends on the director model.

**Q-DA-10. `SETTINGS`.** Which settings changes notify the other director — all of System Settings (auth, mail,
encashment default rate, helpdesk…) or only a named payroll-sensitive subset? *Recommend:* all; it is one line of
code and the audit log already records them.

**Q-DA-11. Existing records.** Old approvals stay `SECOND_DIRECTOR` (truthful). Do you want a one-off report "records
made before director authority" for the CA? *Recommend:* no; the `authority` column suffices.
