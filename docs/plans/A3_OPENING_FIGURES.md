# A-3: opening figures (pay and tax before this system), written before the code

Session continuing Session A, branch `feat/hr-payroll-separation`, 2026-11-06. Source: the owner's message ("opening figures: build the screens and the
director-entered import for opening balances and tax already deducted this year; nothing preloaded; real income tax stays blocked until the owners enter
them") and `PHASE_7.md` §3 ("Opening figures", the `TAX_OPENING` maker-checker). The letter-figures hook (`letterFigureFields()`, named "A-3" in
`GREYTHR_PARITY_EMPLOYEE_ADMIN.md`) is a different piece and stays a hook here.

## What an opening figure is

For one person and one financial year, two kinds, each a pair of exact amounts (taxable pay, tax deducted) with a source note:

* **GO_LIVE** — what greytHR (or any earlier system) paid this person this year before the first run here, and the tax it deducted.
* **PREVIOUS_EMPLOYER** — for someone who joined this year: the salary and tax of their earlier employer this year, as the person declares it.

Nothing is preloaded, for anyone. No figure comes from a file in the repository.

## Rules

1. **Directors only.** HR, managers, employees and the Developer role have no route, no menu entry and no count. (Pay data.)
2. **Append-only.** Every entry is a new row (`tax_openings`); the latest row per person, year and kind counts; clearing is a row with `cleared`.
   The database refuses UPDATE and DELETE.
3. **Always two directors.** The year's figures are confirmed as a whole by a different director (`TAX_OPENING` in the existing approvals core,
   subject id = the year label, bound to a hash of the year's figures). Any later entry voids the confirmation. No "act alone" path: every tax value
   is confirmed by a different director (owner decision). A director's own row needs no special handling beyond that (directors may set their own pay).
4. **Confirming an empty year is a deliberate act.** A company that starts here on the first day of the year confirms "no opening figures".
5. **Real income tax is blocked until confirmed.** With `TDS_MODE = PROJECTED`, a run refuses unless the year's opening figures are confirmed and
   unchanged since, naming the reason. A test run is not affected.
6. **The year-to-date reader adds them.** `yearToDate` adds the confirmed figures of both kinds to taxable pay and tax already deducted, and says so.
   Unconfirmed figures are never added.
7. **Import.** The directors upload a CSV or an Excel file (employee number, kind, taxable pay, tax deducted, source note); a preview lists each row
   and each problem (unknown person, bad figure, negative, missing note, the same person and kind twice); applying writes the valid rows as one batch
   with a reason. A template is downloadable. The real greytHR layout waits for its sample; this is our own layout.

## Screens

Directors' Payroll → Opening Figures: choose the year; the list (person, kind, taxable pay, tax deducted, note, who, when); enter or clear one;
upload a file (preview, apply); the confirmation card (ask a different director; that director approves or rejects). Light, dark, phone.

## Tests

Routes refuse HR, managers, employees and the Developer role; an employee cannot read anyone's; the database refuses UPDATE/DELETE; a change voids the
confirmation; the same director cannot confirm their own request; the run refuses without a confirmed year in PROJECTED mode; `yearToDate` adds only
confirmed figures (independent-model property test of the sums); the import's parser rejects each bad row; mutation checks on each rule.
