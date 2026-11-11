# P7-5: reimbursements, written before the code

Session continuing Session A, 2026-11-10, on `PHASE_7.md` §9 and the owners' decisions in force (directors are the whole payroll team; no preset values;
money moves only through payroll runs).

1. **Claim types** (directors): name; whether employees may claim it; whether a bill is required; a monthly cap and a cap per financial year (each a
   figure the directors enter, or "no cap" chosen on purpose); the earning pay head the payment is made under (its own "taxable" answer decides tax).
   Every value Not set until chosen; a type with a gap takes no claim. Append-only versions; retiring is a version.
2. **Claims** (the employee's own, Salary → Reimbursement): type, the day the money was spent, the amount, what for, and bills (uploaded through the
   same checked path as other documents). A claim is immutable once made; it is withdrawn, approved or rejected by an append-only decision (one per claim).
3. **Approval by the directors only** (the payroll team), never the claimant: approve the amount or a lower one (with a reason), or reject with a reason.
   At approval the caps are checked against what is already approved for the same person and type in the same month (the month spent) and the same
   financial year; a claim over a cap is refused, naming the cap.
4. **Payment through payroll only:** an approved claim becomes a pending earning adjustment (`REIMBURSEMENT`, sourceRef = the claim) under the type's
   head, paid by the next run and consumed at finalise. The claim shows "Paid in <month>" once its run is final.
5. HR, managers and the Developer role see nothing (no route, menu, count). An employee sees only their own claims and bills.

**Not built:** the Tasks inbox source, a manager step (post-go-live question), a per-run reimbursement statement layout (the employee's claim list shows
the run each claim was paid in).

**Tests:** routes refuse HR, managers, employees on others' claims and the Developer role; the claimant never decides; caps (month and year) against an
independent sum; an approved claim goes through a real run and is consumed; database refuses changes; mutation checks.
