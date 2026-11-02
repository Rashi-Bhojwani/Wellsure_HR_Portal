# Stage 7 plan: P7-2 (declarations and proofs) and P7-3 (TDS in the run), stopping at the TDS checkpoint

Written before the code, on the rules in `PHASE_7.md` as amended (no CA; the owners enter and verify every tax value) and the owners' message that asked for this stage.

## A finding first: P7-1 was ticked but not built

`MASTER_CHECKLIST.md` ticked "P7-0, P7-1" as existing. P7-0 is built. **P7-1 (tax foundations) is not in the code**: no financial-year helper, no tax rules, no tax engine, no year-to-date reader, no opening figures. P7-2 and P7-3 stand on all of it, so they cannot exist without it. This stage therefore builds the **smallest part of P7-1 that P7-2 and P7-3 need**, as its own commit group and labelled that way, and corrects the checklist.

| P7-1 piece | This stage | Why |
|---|---|---|
| `financialYearOf` in `shared/` | **built** | every other piece needs one definition of "the year" |
| Tax rules per financial year, governed (source note, effective-from, a different director confirms), everything Not set | **built** as a new governed item kind `TAX_YEAR` | the engine reads nothing else |
| The tax engine (pure, exact) and its independent model | **built** | TDS is its output |
| The section catalogue (labels, caps, regime, proof required) | **built, inside the tax year item** (editable data, no section number or form name in code) | declarations are by section |
| Year-to-date reader (finalised runs only) | **built, small**: taxable earnings and TDS already deducted this year | the TDS line needs "so far" |
| Opening figures (mid-year go-live, previous employer) and the `TAX_OPENING` approval and import shape | **not built** | needs the owners' greytHR mapping; until then a person's income before this system is **not counted** and the TDS explanation says so |
| Company-wide permissions/registry entries | **not needed**: the routes use existing keys plus a director check (decision 17's pattern); employees' own routes are self-scoped | no new key widens anything |

## P7-2: declarations and proof of investment

**Who sees what.** An employee sees and edits only their own. Directors see all and are the only verifiers. **HR sees no tax data** (no route, no menu entry, no count). The Developer role sees none. Nobody verifies a proof of their own declaration (the database holds that too).

**Tables** (one migration; append-only; cleanup classified; route inventory entries):
- `tax_windows` (financial year, kind DECLARATION or PROOF, opens on, closes on, who set it; a new row replaces the old, the newest counts). Not set means closed.
- `tax_declarations` (employee, year, version, regime NEW or OLD, submitted at) and `tax_declaration_lines` (section code, amount). A save is a new version; the latest submitted version counts. The employee edits only while the declaration window is open.
- `tax_proofs` (employee, year, section, file key, name, hash) and `tax_proof_decisions` (accepted with the verified amount, or rejected with a reason, by whom, when).

**Rules built into the code:** the regime is chosen by the person (the year's default regime is a rule that is Not set until entered; with none set and none chosen, TDS cannot be worked out and the run says so). Changing regime is allowed while the declaration window is open. Before the proof cut-off the projection uses declared amounts; after it, **verified amounts only** (an unverified line counts as nothing). Caps come from the catalogue (a line, and a group cap shared by several lines). Never auto-chosen: the screen shows both regimes side by side from the engine and the person chooses.

**Screens** (design system, light, dark, phone): employee Salary > IT Declaration and Proof Of Investment (the menu already lists them as Soon); directors' Tax year settings, Windows, and the proof queue.

## P7-3: TDS in the run

- `TDS_MODE` gains `PROJECTED`. In that mode each person's TDS line = (annual tax projected now − TDS already deducted this year) ÷ pay months left in the year including this one, rounded by the year's rounding rule, never below the year's minimum, **never negative** (no refund through payroll).
- Projection = this year's taxable pay so far (finalised runs) + this month + the remaining months at this month's recurring taxable pay; one-offs (adjustments, arrears, encashment, monthly inputs) are taxed in the month paid. Taxable is the pay head's own `taxable` flag; a head with it Not set blocks the run, naming it.
- The line carries the whole working in its `basis`; the "Why?" drawer explains it. The run pins the tax year item, and the declaration version used is in the run's inputs, so a changed declaration voids an approval like any input.
- **IT Statement** (employee, own): the year's projection month by month, both regimes side by side, tax so far and to come.

## Not built in this stage (and not claimed)
YTD Reports, the payslip YTD column, the Salary Revision page, revision letters and offer-letter figures (the rest of P7-3's list); HRA, LTA and perquisites; rebate and surcharge **marginal relief** (not modelled: the engine says so on its working); opening figures and previous-employer income; Form 16 and the quarterly return (P7-7, which stays DRAFT-only); loans, reimbursements, off-cycle runs (P7-4 onward). **Stop after P7-3.**

## Nothing is a tax rule from memory
No slab, rate, limit, rebate, cess, standard deduction, surcharge, rounding or default regime is in the code or shipped. The tests use made-up numbers that say so. The demo company gets made-up figures labelled DEMO.

## Tests
Engine: hand-worked cases on made-up figures; a property test against an independent exact-fraction (BigInt rational) model over random slabs, rebates, surcharge, cess and deductions; boundary cases; mutation checks on every rule. Declarations: windows, versions, caps, self-scope, HR and Developer 403, employee-cannot-read-others, verifier is never the employee (service and database). Run: TDS line, pins, stale after a declaration change, floor at zero, remaining months, the run refusing when a tax value or a head's taxable flag is Not set.
