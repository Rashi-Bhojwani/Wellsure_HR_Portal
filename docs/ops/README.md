# Operations documents

Plain guides for the people who use the portal: the two directors, HR, managers and employees.

| Document | For | What it covers |
|---|---|---|
| [FIRST_SETUP.md](FIRST_SETUP.md) | Directors and HR | The order to set the portal up before first use, ending with Payroll → Ready for First Run |
| [DAILY_AND_MONTHLY_GUIDE.md](DAILY_AND_MONTHLY_GUIDE.md) | Everyone | HR's day, managers' approvals, the directors' monthly payroll, and what the common refusals mean |
| [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md) | Directors and HR | A tickable list to confirm the portal works, on the demo company and then on real data |
| [MOVE_FROM_GREYTHR.md](MOVE_FROM_GREYTHR.md) | Directors and HR | Moving from greytHR with a parallel run, and when it is safe to stop |

**How to reach them.** They live in the project's repository, in the `docs/ops` folder. Open them on the repository's website: each file shows as a formatted page and can be printed. The person who runs the system can also send them to you as PDFs. They describe only screens that exist today. Where something is not built yet, the document says so.

## Never commit real data

The repository is shared with developers and with every tool that reads it, and anything committed stays in its history even after it is deleted. So nothing real ever goes into it:

- **No exports.** No greytHR export, salary statement, payroll register, bank transfer sheet, punch log (`attlog`), Form 16, PF/ESI file or any spreadsheet, CSV or PDF taken from the live system or from greytHR. Not "just for a moment", not in a branch, not renamed.
- **No identifiers.** No real PAN, Aadhaar, UAN, ESI number, bank account or IFSC, salary figure, phone number or personal email, in code, tests, docs, comments or commit messages.
- **Use made-up data.** Tests use clearly fake values (`DEMO…`, `@example.invalid`, numbers built at run time). The demo company (`npm run seed:demo-company`) shows every screen with made-up people and pay.
- **If a real file is needed to build an importer**, describe its columns in words (or make a synthetic file with the same columns and invented rows), and keep the real file on your own computer.

**The guard.** `node scripts/check-real-data.mjs` fails when a tracked file looks like an export (by name and type, for example `Salary (38).xls`) or holds a PAN-shaped, Aadhaar-shaped (check digit valid) or bank-account-shaped value outside the tests' fake fixtures. It prints the file, line and kind of match, never the value. CI runs it on every push, and so does `scripts/peeps-check.sh`.

**If real data was committed anyway**, stop and tell a director. Deleting the file in a new commit does not remove it from history; removing it from history rewrites every branch that holds it, which is the directors' decision. The audit fix report (`docs/plans/AUDIT_FIX_REPORT.md`, C4) lists where such files still exist.
