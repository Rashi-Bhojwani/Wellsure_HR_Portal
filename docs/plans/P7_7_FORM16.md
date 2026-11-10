# P7-7: Form 16 data, the challan register and quarterly data — written before the code

Session continuing Session A, 2026-11-10, on `PHASE_7.md` §7 and the owners' decisions (no CA; every tax value owner-entered; Form 16 and tax
statements stay **DRAFT until confirmed**; no official-format file is built until its format is confirmed; nothing talks to a bank or the tax portal).

1. **Challan register** (directors): each TDS deposit the company makes — the month it covers, the deposit date, the amount, the BSR code and challan
   serial (both sealed at rest, shown as their last characters). Immutable. A **different director confirms it by retyping the amount and the serial**;
   a mismatch is refused. A reconciliation lists, month by month, TDS deducted by finalised runs against confirmed deposits.
2. **Quarterly data**: per quarter of the financial year, one row per person (employee number, name, PAN's last four, pay and TDS for each month, the
   confirmed challan of the month) as our own workbook. **The government utility's input format is not built** (its format is not confirmed).
3. **Form 16 Part B data** per person and financial year, only after the year has ended: taxable pay from finalised runs plus confirmed opening figures,
   the deductions that counted (verified after the proof cut-off), the regime, the tax worked out by the engine with the year's confirmed values, and TDS
   deducted. It is shown as **DRAFT** until a different director confirms the year's Form 16 data as a whole (`FORM16_CONFIRM`, bound to a hash of
   every person's figures; any later change voids it). The person sees their own; directors see all. **Part A** comes from the tax department's portal
   and is not generated. A PDF layout is not built in this step (the data and the screen are).

HR, managers and the Developer role see none of it. Tests: routes refuse them; retyping must match; confirmation by a different director; DRAFT until
confirmed; reconciliation sums against an independent model; mutation checks.
