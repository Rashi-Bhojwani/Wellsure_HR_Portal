# Moving from greytHR, with a parallel run

**For:** the two directors and HR. greytHR keeps running alongside this portal until the results agree. Nothing here switches greytHR off for you.

Steps marked **waiting for build** depend on something not built yet:
- the **greytHR file readers**: reading greytHR's own export and register layouts directly;
- the **parallel-run kit**.

Until those are built, do those steps the manual way described here.

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

**Waiting for build:** loading greytHR's export files directly, without copying columns into the templates.

Check the counts after loading: Admin Tools → Data Import/Export → **Reconciliation Report** shows active headcount by branch and by department. Compare it with greytHR.

## 4. The parallel month

1. Run the month in greytHR as usual. **Pay from greytHR.**
2. In the portal, run the same month to the end: Payroll Run → Calculate → Submit for approval → Approval → Close the period. Do **not** upload its bank file to the bank.
3. Download the portal's salary register from the run.

**Waiting for build:** the parallel-run kit, which would do steps 2 to 4 of this section for you.

## 5. Compare line by line

**Payroll → Compare Registers**:

1. First register: the portal's (Wellsure register).
2. Second register: greytHR's. Choose **"A plain table (a header row, an Employee code column, amounts)"** and save greytHR's register in that shape:
   - one header row;
   - one column for the employee code;
   - every other column an amount.
   
   The option "greytHR's own register layout" is **waiting for build**: it needs a real sample first.
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
