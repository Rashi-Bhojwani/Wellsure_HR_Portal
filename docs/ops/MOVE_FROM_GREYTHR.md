# Moving from greytHR, with a parallel run

**For:** the two directors and HR. greytHR keeps running alongside this portal until the results agree. Nothing here switches greytHR off for you.

The greytHR file readers and the parallel-run kit are built (Session A, Stage 8). They were built and tested with **synthetic** files that copy greytHR's
column layout with made-up values; real greytHR exports have not been tried yet and could differ. Try one real month before relying on them, and keep the
manual way described below as the fallback.

---

## 1. When to start

Start at the beginning of a month. Attendance and leave go live first. Payroll runs in parallel with greytHR for at least one month (two to three is safer) before you rely on it.

## 2. What to export from greytHR, and when

At the end of the last full month in greytHR, export and keep:

1. **Employee master**: codes, names, joining dates, department, designation, branch, reporting manager, contact details.
2. **Bank and statutory details**: account number and IFSC, PAN, UAN, ESI number.
3. **Leave balances** as on the last day of that month, per leave type.
4. **Salary details**: each person's annual CTC and how it is split.
5. **The salary register** for that month, as Excel.
6. **Year-to-date pay and tax** for each person, if you start in the middle of a financial year.

Keep the original files, unchanged, in a safe folder. They are your backup.

## 3. Load the data into the portal

The portal reads **its own templates**, not greytHR's layouts. You copy the columns across.

| What | Where | How |
|---|---|---|
| Branches, departments, designations | Admin Tools → Data Import/Export → **Org Masters** | Download the template, fill it from greytHR, upload, check, commit. |
| Employees | Same screen → **Employees** (or Employee → Bulk Import) | The same. Former employees can be loaded too, with their leaving date. |
| Bank and statutory numbers | Same screen → **Bank**, **Statutory** | The same. Entries made by HR wait for a director to confirm them. |
| Leave balances | Same screen → **Leave Grants** | One row per person and leave type. |
| Salaries | Payroll → Salary Revisions → **Import from a file** | The portal's own template: who, which structure, the annual CTC, from when. It prepares revisions; the other director approves each. |
| Year-to-date pay and tax | Payroll → Opening Figures | One by one, or the template's file. The other director confirms. |
| Attendance before go-live | Not needed | The portal computes attendance from its own start date. |

**greytHR's own files, read directly** (Admin Tools → Data Import/Export, or Employee → Bulk Import):

| greytHR file | Tab | What happens |
|---|---|---|
| Device attendance log (`.dat`) | **Punches (ATTLOG or greytHR swipes)** | Choose the device, upload, look at the preview (new, already on record, unmapped device user IDs listed, rejected lines with reasons), then commit with a reason. Punches already on record are never stored twice. |
| Attendance Swipes export (`.xlsx` or `.xls`) | The same tab | Each employee number becomes that person's device user ID on the day; an unknown number, or a person with no device user ID, is listed and rejected, never guessed. Dates are read day first (05/01/2026 = 5 January). The Developer role cannot load this file. |
| Bulk Salary Overrides (`.xlsx`) | **greytHR salary overrides** (directors; the same screen as Payroll → Monthly Inputs → Import a file) | Preview first. Its pay-head columns must match pay heads that take their value from Monthly Inputs; one invalid row refuses the whole file unless a director chooses to skip invalid rows. **The director who uploaded the file cannot apply it: the other director checks the preview and applies it.** |
| Salary Statement (`.xls`) | **greytHR salary statement** (directors; the same as Payroll → Parallel run) | See section 4. |
| Bank transfer file (`.xls`) | **greytHR bank file** (directors) | The bank file's columns are compared with the portal's bank layout (only the header row is read). If they differ, a director can start a draft bank layout from them; everything uncertain (the debit account, the payment mode code, the remark) stays Not set, and the other director confirms the layout in Payroll → Bank and Statutory Layouts. |

Not built: greytHR's payroll repository (pay items) file. No synthetic sample of it exists, so its layout is not guessed; the kit maps pay heads from the
salary statement's own columns instead.

Check the counts after loading: Admin Tools → Data Import/Export → **Reconciliation Report** shows active headcount by branch and by department. Compare it with greytHR.

## 4. The parallel month

1. Run the month in greytHR as usual. **Pay from greytHR.**
2. In the portal, run the same month to the end: Payroll Run → Calculate → Submit for approval → Approval → Close the period. Do **not** upload its bank file to the bank.
3. Download the portal's salary register from the run.

4. **Payroll → Parallel run** (directors): choose the portal's run for the month (a finalised run, or a run calculated on TEST rules), upload greytHR's
   Salary Statement for the same month, and look at the result: who matched exactly, the differences (amount and which side is higher), people in only
   one of the two, heads in only one, and the totals per head. A likely cause is shown only where the data proves it (a head on one side only, LOP days
   differing, a person on one side only). Where a greytHR column was not matched to a portal head by name, choose it in the mapping table and press
   **Compare again**. Download the differences as .xlsx or .csv. The kit changes nothing in payroll.
5. What counts as a match is a setting: Admin Tools → Default behaviours → **Parallel run: what counts as a match** (default exact match; a rupee of
   rounding can be allowed). How long saved comparisons are kept: **Parallel run: how long a saved comparison is kept** (Not set: until a director
   deletes one). One director proposes a change and the other confirms it.

## 5. Compare line by line (any other register)

**Payroll → Compare Registers**, for a register that is not greytHR's Salary Statement:

1. First register: the portal's (Wellsure register).
2. Second register: greytHR's. Choose **"A plain table (a header row, an Employee code column, amounts)"** and save greytHR's register in that shape:
   - one header row;
   - one column for the employee code;
   - every other column an amount.
   
   For greytHR's Salary Statement itself, use Payroll → Parallel run (section 4) instead: it reads greytHR's layout directly.
3. Set the tolerance, for example 1 rupee.
4. Use the column-name box to match names that differ (for example "Basic Salary" = "BASIC").

**What differences to expect:**
- Rounding of a rupee is normal.
- Loss-of-pay days: the portal pays only for finalised days, so check the attendance first.
- A whole component that differs usually means a rule or a structure differs. Fix it through the normal confirm routine, and calculate again.
- A person in only one register means the joiner, leaver or "Not on Payroll" lists differ.

Write down every difference and how it was settled.

## 6. When it is safe to stop using greytHR

Only when **all** of these are true:

1. At least one full month matched (two to three is safer), with every difference explained.
2. Your bank accepted a test file in the portal's bank layout.
3. The PF, ESI, PT and LWF files were accepted by each portal's validator.
4. Both directors agree, and record it.

Then pay the next month from the portal: Payslips and bank file → Generate the bank file, then upload it to your bank.

## 7. What to keep as a backup

- greytHR's original exports and registers for every parallel month, unchanged.
- The portal's register and comparison result for each parallel month.
- Your notes on every difference.
- Keep read access to greytHR for as long as your records need it.
