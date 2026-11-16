# Stage 8 — greytHR file readers and the parallel-run kit (Session A, 2026-11-14)

Scope: one company, one city, one payroll run by the two directors. Fixtures: only the synthetic files in `docs/samples/` (fake values, real column layout).
Real greytHR exports have not been tried; they could differ from the synthetic layout.

## 1. What already existed (checked before building)

| Sample file | Existing | What this stage adds |
|---|---|---|
| `attlog_sample.dat` (device log) | **Exists**: Import Center → Punches (`PunchImportTab`, `POST /api/biometric/import/preview` + `/:id/commit`); shared `parseAttlog` reads the sample (18 punches, 0 rejected); duplicates counted and skipped, unmapped IDs go to the unmapped queue (never guessed), punches immutable, audit on commit, the text cleared on commit | The preview lists the unknown device user IDs (it only counted them). No second importer. |
| `Attendance_Swipes_template.xlsx` | Missing | Same screen and same ingestion: the spreadsheet rows become ATTLOG lines for the chosen device, the employee number turned into that person's device user ID in force on the day; unknown numbers listed, not guessed. |
| `Bulk_Salary_Overrides_template.xlsx` | **Exists**: Payroll → Monthly Inputs → Import from a file (`payroll/inputs/importService.ts`): the layout's fixed columns, one column per input head (generated from the configured heads), all-or-nothing unless the director chooses to skip invalid rows, a file applied once | **Second-director rule**: the director who uploaded a file cannot apply it; a different director does. An Import Center entry for directors points to it. |
| Payroll repository / pay items (.xls) | — | **No synthetic sample on the branch**: the reader is deferred (its layout is not guessed). The head mapping the kit needs is built from the salary statement's own head columns instead (match by name, a director chooses where unmatched). |
| `Salary_Statement_template.xls` | Missing (`compare` had a GREYTHR source that refused: "waiting for sample") | A reader for the statement (binary .xls) and the parallel-run kit. |
| `Bank_Transfer_template.xls` | Bank file writer exists, layout typed by directors (Bank and Statutory Layouts), .xlsx/delimited only | A check: the file's headers against the confirmed bank layout, mismatches listed; if they differ, a director can start a draft bank layout from the headers (fields matched only where certain, everything else Not set; a different director confirms as for any layout). The writer is not changed. |

A legacy-Excel reader did not exist (ExcelJS reads .xlsx only; the `xlsx` npm package has open advisories for untrusted files). `lib/xls.ts`: a small read-only BIFF8
reader (compound file, shared strings, numbers, RK, labels, booleans, a formula's cached result only; no formula is evaluated, no macro is read), with size and record limits.

## 2. Parallel-run kit (IE-12, PY-32)

Payroll → Parallel run (directors only). Upload greytHR's statement for a month, choose the portal's finalised (or TEST) run for that month. Match by employee number;
compare every head, gross, total deductions, net, days and LOP. Show: exact matches, differences (amount, which side is higher), people on one side only, heads on one
side only, totals per head and the overall difference; a "likely cause" only where the data proves it (a head on one side only; LOP days differ; a person on one side
only). Export .xlsx/.csv (audited without figures). Tolerance: a director setting (behaviours store), conventional default exact match (0), optional rounding
allowance. Comparisons saved encrypted (a_ migration, field-encryption registry), listed, deletable by a director; retention Not set = kept until a director deletes
it. Bank account and IFSC columns of the statement are never read into the result. The kit writes no payroll data.

## 3. Request 13
The Developer is refused the payroll rule values and the bank and statutory layout list on the backend, even called directly.

## 4. Tests
Synthetic files and generated data only: good, wrong, empty, oversize, duplicates, unknown codes, wrong columns, corrupted. Generated statement pairs: exact, one rupee,
missing person, extra head, different LOP. Property test of the comparison against an independent reference. Mutation checks on match-by-number, tolerance,
all-or-nothing apply, second-director rule. Golden: the existing payroll golden run and attendance replay unchanged.
