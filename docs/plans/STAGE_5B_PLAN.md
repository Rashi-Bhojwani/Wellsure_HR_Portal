# Stage 5b: bank files, rejected rows, payslip links, payslip queries, not-on-payroll

Written before the code. Every value here is a setting a director enters (Not set until then); nothing ships a bank's format, an account, a payment-mode code, a link lifetime or a return-file layout. The sample `docs/samples/Bank_Transfer_template.xls` named in the instruction **is not in the repository or on `origin/main`**; the only bank layout sample there is `ORTHO (14).xls` (columns: From A/C No., A/C no., Beneficiary Name, Amount, Payment Mode, Date, IFSC code, Payable Location, Print Location, Mobile No). It is not used to preset anything: the directors type the layout in from the bank's own specification.

## What already exists (Phase 6, P6-5, checked in the code, not from memory)
| Item | Status |
|---|---|
| B1 layout setup | **Built.** A governed layout item `BANK_TEMPLATE` (sealed, with the debit account encrypted and shown as its last four digits only): column mapping (field, constant or pattern), date format, header and trailer rows, delimited, fixed-width or `.xlsx`; **a legacy `.xls` is refused**; starts Not set; confirmed by a different person; a change makes a new unconfirmed version. A payment-mode code is a constant (or pattern) column the owner types. Tests: `layout.test.ts`, `layoutAuthorConfirm.test.ts`, `releases.test.ts`. Gap: the maker-never-equals-checker and change-voids tests are not aimed at the *bank layout* in one place; added in 5b with mutation checks. |
| B2 bank file generation | **Built.** Only for a final run whose rules are real (a run on Placeholder rules cannot be finalised), after a `BANK_FILE` approval bound to the hash of the figures and the confirmed layout; consumed once; the batch keeps only last-four digits; every account read is audited; download is a signed link, audited, behind `payroll.bank.view` (held by directors only). Gap: nothing pins "a test run never yields a file" and "download is directors only"; added with tests. A test run cannot have a bank file, so there is no file to watermark; this is a deliberate choice (decision 1). |
| B3 rejected rows | **Not built.** The batch can be marked paid and a bank response file attached as an opaque document; nothing is recorded per row. |
| B4 payslip links | **Partly.** The email carries no figure and a fixed link to the sign-in route. Gap: a single-purpose, expiring link that re-checks access on open. |
| B5 Raise a query | **Not built** (the Payroll helpdesk category is directors-only since fe69991). |
| B6 not-on-payroll | **Not built.** |

## B1. Bank layout (verification and the missing tests)
No new mechanism. New: `bankLayoutConfirm.test.ts` aimed at `BANK_TEMPLATE`: the author cannot confirm (service, approvals table and confirmations table all refuse); a change after a confirmation creates a new version that is not confirmed and the file cannot be made from it; `.xls` refused; Not set by default. Mutation checks on the author rule and the version rule.

## B2. Bank file
Tests only: a run that is not final (or is on Placeholder rules) yields no batch; the download needs `payroll.bank.view`, refuses HR, a manager, an employee and the Developer role, and writes an audit row naming the person and the file hash; the file's hash equals the batch's; the batch stays bound to the run hash.

## B3. Rejected rows and the repayment batch
* **Record a rejection** (directors only): on a row of a bank batch, with a reason, entered by hand or **imported from the bank's return file**. The return file's layout is a governed layout item of its own, `BANK_RETURN_TEMPLATE`, set up like B1 (typed in by a director, Not set until then, confirmed by a different director, a change voids the confirmation): which columns hold the employee code, the amount, the status and the reason, and **which status values mean "rejected"** (the owners' words, not guessed). Only `.xlsx` and `.csv` are read.
* A rejection is one append-only row per bank row (unique), written only by a Super Admin (database trigger), with the reason, how it was recorded and, for an import, the file's hash. An import is idempotent by that hash. A rejected row stays unpaid and shows to directors only.
* **Repayment batch.** A director picks rejected rows; the plan uses each person's bank account **in force on the new payment date** (so a corrected account is used), the original amount to the paisa, and refuses a row whose original was not rejected, or that is already in a repayment batch (a unique key on the source row holds this whatever the code does: nothing is paid twice). It needs the same approvals as a bank file (a new approval subject `BANK_REPAYMENT`, the same director step `BANK_FILE`, bound to the hash of the plan), then the file is written with the confirmed bank layout; every account read is audited. The batch and its rows are append-only.

## B4. Payslip links
After a run is published, the email carries a link only. The link is a random token whose hash is stored (the token is shown once, in the email), is for one payslip and one person, **expires after a number of days a director sets (Not set: then the email carries no link and says to sign in)**, requires sign-in, and **re-checks on open** that the signed-in person is the owner, the payslip is published and the token is unexpired and unrevoked; a wrong person gets the same answer as an unknown token. A director sets the lifetime and can revoke the links of a run. **Password-protected PDF** stays OFF and is shown as "Needs owner approval"; the API refuses to switch it on.

## B5. Raise a query
On a payslip, the employee presses *Raise a query* and writes a message; a ticket is opened in the Payroll category (directors only), assigned to a director (the category's default assignee, else the first active director who is not the person). The ticket names the payslip's month, never a figure. HR, managers and the Developer role never see these tickets or their counts (the existing directors-only category rule, tested again for the new path and for the counts). The employee sees their own ticket and its status in their tickets.

## B6. Not on payroll
`payroll_exclusions`: person, from date, optional to date, reason (required), made by a director; append-only; **a different director confirms** (a trigger refuses the same person, and refuses a change after confirmation); ending an exclusion is another row. A run for a cycle skips a person who is excluded and confirmed on the cycle's last day, and the run's readiness and detail name each skipped person ("skipped" list). HR sees nothing: the routes and the run screens are directors' only, and a test pins that the HR role gets 403 and that no HR-visible payload carries the flag. The run hash changes when an exclusion changes, so an approved run cannot silently drift.

## Decided by me (to confirm; listed in `DECISIONS_FOR_OWNERS.md`)
1. A bank file is never made for a test run (a run on Placeholder rules cannot be finalised), so there is nothing to watermark TEST; a bank file inside a watermark would also break the bank's layout.
2. The payment-mode code is a constant column the owner types, not a built-in list.
3. The return-file layout reuses the layout machinery (columns by title, a list of "rejected" status words).
4. A repayment uses the person's bank account in force on the new payment date.
5. The payslip link lifetime is a setting, Not set; with it Not set the email has no link.
6. A person excluded for part of a cycle is judged on the cycle's last day (as overrides are).

## Commit groups (each: tests, mutation checks, full suite alone, CI per job)
B1+B2 tests; B3; B4; B5; B6.
