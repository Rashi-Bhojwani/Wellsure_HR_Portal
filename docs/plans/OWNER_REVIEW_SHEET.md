# Owner review sheet

Written for the owners, in plain words. Every choice the build made on its own is here, one line each: **what was chosen**, **what changes for you if you answer differently**, and **what I recommend**. The numbers are the rows of `DECISIONS_FOR_OWNERS.md`, where the detail is. Nothing here changes unless you say so; until then each stands as built.

How to answer: reply with the row number and "keep" or the change you want.

## Pay rules and runs

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 1 | A department or person's special rule counts for the whole month if it applies on the month's last day. | Judging by the first day, or splitting the month at the start date, means a mid-month start would pay part of the month the old way. That is a bigger change to how pay is worked out. | Keep. It is simple to explain and never splits a month. |
| 2 | Day counts (days in the month, working days) are not offered as building blocks for salary parts. | If you want a pay part worked out per day, tell us which one and it will be added for that one. | Keep until you name a pay part that needs it. |
| 4 | When a held salary is released after the month is closed, the held amount is paid as one line and nothing more is taken from it. | The month's deductions would be worked out again at release, which needs your rule on which month a contribution belongs to. | Keep. It cannot change a closed month. |
| 5 | A loss-of-pay correction is typed in by a director (month, person, reference, days), not raised automatically. | An automatic link would need attendance corrections to carry a reference. That is a change to attendance itself. | Keep for now; automate later if the typing becomes a burden. |

## Monthly inputs

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 3 | A pay part that takes its figure from the monthly grid is marked as such on the pay part itself, and can never also be a fixed part of a salary structure. | If a part should be both fixed and entered monthly, the marking would move onto the structure line instead. | Keep. It prevents a part being counted twice. |
| 6 | "Override From" and "Override Till" in the upload file are read as a range of payroll months, and the figures apply to every month in the range. **You have not confirmed this.** | If the dates really mean something else (for example a single effective month), one function changes and the preview text with it. | Please tell us what the two dates mean in your own file. This is the one row that needs a real answer. |
| 7 | Principal Part and Interest Part (the two parts of a loan or advance instalment) are read and shown but not posted to any month until loans are built. | If they should post somewhere sooner, say where. | Keep. Posting them before loans exist would put figures nowhere sensible. |
| 9 | A month can be sent for the second director's confirmation while some cells are still blank; the payroll run itself insists every cell is filled (zero counts). | Making confirmation wait for every cell would stop a director confirming the figures they have while chasing the rest. | Keep. The run is the real gate. |
| 10 | A month opens for figures only when attendance is final for everyone employed in it. | Opening it for the people already final would let figures be entered earlier but mixes finished and unfinished people in one month. | Keep. One clear rule. |
| 11 | A figure of zero is accepted as "entered" but prints no line on the payslip. | Printing zero lines adds noise to every payslip. | Keep. |
| 12 | An upload file holds at most 1,000 rows, and a row covers at most 12 months. | Tell us the real size and it is a one-line change. | Tell us your real largest file. |
| 34 | Each pay part that takes monthly figures has two choices only a director can make: whether it is paid or taken off, and whether a figure may be negative. Both start as Not set, and a part with either Not set takes no figure and stops the run. A negative figure goes the other way on the payslip (a negative payment becomes a deduction of the same size). | If a part's direction may differ from its own type, or a negative should show as a signed line instead, that is a small change. | Keep. Nothing is assumed for you. Set both when you create each part. |
| 35 | None of Slab Salary Bonus, Training Exp, Old Month Discrepancy, Principal Part or Interest Part is built in. Directors create any of them as pay parts, using their ordinary meanings (a bonus by performance slab; an amount tied to training cost; a correction for an earlier month that can add or recover; the two parts of a loan or advance instalment). No tax treatment is assumed for any of them. | Tell us which you want and their direction and negative choice, and they are created for you to confirm. | Keep. Create only the ones you really use. |

## Remote attendance

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 13 | "Absent" and "Loss of pay" mean the same thing for attendance and pay: one day of loss of pay. The record remembers which one the director chose. | If Loss of pay should do something different (for example a leave-without-pay entry), tell us what. | Keep. Two names for one result avoids two different pay outcomes. |
| 14 | A half day names which half (first or second); nothing is pre-selected, and the other half is a half day of loss of pay. | The half could come from the check-in and check-out times instead. | Keep. A director decides, not a guess from clock times. |
| 15 | Approving many people at once is allowed for full days only; a half day is decided one at a time. | Allowing half days in bulk is quicker but easier to get wrong. | Keep. |
| 16 | A person can check in only on the day itself; a forgotten check-out is fixed by a request a director accepts. | Letting a person check out the next morning would make a day's record change after it ended. | Keep. |
| 17 | The directors' remote-attendance screens use the existing "unlock attendance" permission plus a check that the person is a director. | A dedicated permission can be added; it changes nothing the user sees. | Keep. The director check already refuses everyone else. |
| 18 | The reminder threshold (in whole hours) and the suggested rejection outcome are both Not set. With no threshold nothing is sent; with no suggestion nothing is suggested. | Tell us the real hours and whether a suggestion is wanted. | Please give a threshold if you want reminders. |
| 19 | A decision's reason is kept in the audit trail (who, when, outcome, reason). Only people allowed to read the audit see it. | The reason could be kept only in the record, not the audit. | Keep. Reasons are exactly what an audit is for. |
| 20 | One review is allowed per remote day, and only after a rejection or a half day. | Allowing a second review after a reopening is a small change. | Keep. |
| 21 | A missed remote day can be recorded after the fact for any past day the person was marked remote, with no limit on how far back. | A limit (say 30 days) is easy to add. | Give a limit if you want one; otherwise keep. |
| 22 | Every decision and reopening tells the other director(s) with the outcome only, not the reason. | Including the reason is easy. | Keep. The reason is one click away on the record. |

## Bank files and payments

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 23 | No bank file is ever made for a test run. A test cannot be finalised, so there is nothing to mark TEST. The demo company is the place to rehearse. | A marked TEST file could be allowed from a calculated run, to check a layout. | Keep. A file that could be mistaken for a real one is the risk. |
| 24 | The payment-mode code (NEFT, RTGS and so on) is a fixed text column you type in the bank layout, not a built-in list. | A list with one code per mode is possible. | Keep until you know which codes your bank wants. |
| 25 | (Replaced by 33.) Nothing reads a file from the bank. | | |
| 26 | A payment sent again after a rejection goes to the person's bank account in force on the new date, for the original amount to the paisa. | It could go to the account in the original file. | Keep. A corrected account is exactly why a payment was rejected. |
| 32 | A director can note that a downloaded bank file was sent to the bank. It records who and when, once, and cannot be changed. Nothing is checked with the bank. | It could also be allowed without a download, or by another role. | Keep. |
| 33 | The feature to attach a "bank response" file was removed along with the return-file import. Bank payments are manual: a rejected payment is typed in by a director with a reason. | A place to file the bank's own papers could be kept. | Keep it removed; file the papers outside the system. |
| 36 | The demo company's bank file is named "DEMO-bank-file" and its first line says it is fictional and not for any bank. The real company's file is never marked, and cannot be released while a rule it used is unconfirmed or changed. | The mark could be a sheet name or footer. | Keep. |

## Payslips and people

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 27 | The link in the payslip email lasts a number of days a director sets. Until set, the email has no link and tells the person to sign in. | Tell us the number of days, or that a link should always be there. | Please set a number (7 to 14 days is common). |
| 28 | The password-protected payslip PDF is switched off and cannot be turned on until you approve it. It shows as "Needs owner approval". | Tell us when approved and what the password should be. | Keep off until you decide the password rule. |
| 29 | A payslip question goes to a director chosen automatically (the Payroll category's default if that is a director, else the first available director who is not the person asking). | Tell us who should receive them. | Name one or two directors. |
| 30 | A person is left out of a month's run if they are marked "not on payroll" and a second director confirmed it on the month's last day. | A part-month mark could pay the days outside it. | Keep for whole-month cases; tell us if part months matter. |
| 31 | Marking a person not on payroll always needs a different director to confirm, whatever the second-director switches say, and cannot reach a month already closed. | It could follow the switches like other steps. | Keep. It takes someone off pay. |

## Income tax (declarations, proofs and TDS)

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 37 | The first part of the tax groundwork (it had been ticked as done but was not built) was built here in its smallest form. Pay from before this system started is not counted in anyone's tax. | When greytHR's mid-year figures are ready, a further step adds them; until then a person's tax for the year is under-counted for the months before the first run here. | Do not switch income tax on for a real run mid-year until that step is built, or until you accept the under-count. |
| 38 | A tax year is entered as a whole, each value with where it came from and its start date; a different director confirms the whole. | Confirming each value on its own is possible but slower. | Keep. |
| 39 | Taxable pay is whatever each pay head says: taxable or not. A head that has not answered stops the run and is named. | Tax treatment could be decided somewhere else. | Keep; answer it on every earning head. |
| 40 | A bonus, arrears or any one-off is taxed in the month it is paid; ordinary pay is taken at this month's amount for every month left. | Spreading one-offs over the months left is a later choice. | Keep until you tell us how your accountant treats them. |
| 41 | Each person chooses their own regime; if they have not, the year's default applies (a value you enter); if neither exists the run stops. The system never chooses. | A change of regime after the proof window could be allowed or refused. | Set a default regime in the tax year. |
| 42 | After the proof window closes, only what a director verified counts for lines that need proof. | A late proof could still be accepted. | Keep, and set the proof window's last day deliberately. |
| 43 | Only directors verify proofs, never their own. HR sees no tax data at all and cannot reopen a declaration. | HR could be shown who has not declared, without amounts. | Keep. |
| 44 | Monthly tax is what is still due for the year divided by the months left; never below zero; nothing is refunded through a run. | A refund through payroll is possible but needs your rule. | Keep. |
| 45 | The small relief near the tax-free threshold (marginal relief) is not worked out. | Tell us the rule and it can be added. | Tell us if any employee is near the threshold. |
| 46 | The sections people can declare under (with their limits) are entered by you inside the tax year. | They could be kept apart from the year. | Keep. |
| 47 | The income tax switch matters to a run only when it is on. | You could be made to choose on or off before a first run. | Keep. |
| 48 | The IT Statement shows paid months from finished runs and projects the rest, marked as a projection and as a draft until the year is confirmed. | | Keep. |

## A-10 (attendance and leave tools)

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 49 | Directors are not stopped by an attendance lock. | Locks could stop directors too. | Keep. |
| 50 | A lock for a segment takes its people at the moment the lock is made. | It could follow the segment as it changes. | Keep (what was locked stays clear). |
| 51 | A roster change that starts before a locked range ends is refused. | Only rosters starting inside the range could be refused. | Keep. |
| 52 | A holiday for some locations goes to whoever works at one of them that day. | It could follow a home branch. | Keep. |
| 53 | Weekend overrides change attendance only; leave counting is unchanged. | Leave counting could follow each person's week-offs. | Keep for now. |
| 54 | A leave reviewer is an extra decider for one leave type; they need the Approve leave key. | A reviewer could replace the manager. | Keep. |
| 55 | Rejecting a swipe needs the Biometric devices key and a reason; the swipe is kept, never used. | HR's correction key could be the one. | Keep. |
| 56 | A device sync request is done when the agent has re-queued the punches. | It could wait for the server to store them. | Keep. |
| 57 | Leavers: no leave accrues for a month that starts after the last working day. The leaving month now follows the D-37 setting (row 70). | — | Answered by D-37 (row 70). |
| 58 | Only company-wide viewers see "Waiting on others". | Managers could monitor their teams. | Keep. |
| 59 | Leave type and reason are shown as entered; one function is ready for a privacy rule. | Name the leave types to hide. | Tell us when the privacy rule is decided. |

## Opening figures, payslip year to date, letters with pay, loans

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 60 | Opening figures always need the other director; an empty year is confirmed on purpose; income tax waits until then. | A run could go ahead without them. | Keep. |
| 61 | Openings are two totals per person (pay, tax). | Line-by-line openings need greytHR's layout. | Keep until the layout is sent. |
| 62 | New payslips show year to date from this system only. | Openings could be added in. | Keep. |
| 63 | Revision/offer letters print the salary's own figures; directors only. | Deductions could be listed. | Keep. |
| 64 | A different director sanctions every loan; never one's own. | A director could act alone. | Keep. |
| 65 | Reducing-balance instalments, exact to the paisa. | Another method. | Keep. |
| 66 | A loan is paid and recovered only through payroll runs; what happens when net pay is too low now follows the D-37 setting (row 69). | — | Answered by D-37 (row 69). |
| 67 | No perquisite on cheap loans yet. | Give the rule. | Ask your accountant. |

## Off-cycle runs, new screens and the three D-37 defaults (2026-11-11)

The three defaults below are the owners' D-37 exception to "no preset values": each shows as "Default, change in settings" (System Settings → Default behaviours),
appears as an information row on Ready for First Run (never blocking), and any change is audited and confirmed by the other director.

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 68 | Off-cycle runs pay a confirmed settlement or held pay on the same road as a monthly run (your run-approval and bank-file choices, the approver never carries it out, the real company only when Ready is green, DEMO files for the demo). Each settlement or held month can be paid once. A director's hold release and a period unlock are refused once an off-cycle run paid that month. | — | Keep. |
| 69 | **D-37 default 1 — loan instalment when net pay is too low:** skip the instalment and carry it forward, with a warning naming the loan. Per loan type you can instead stop the run, or recover what is possible and carry the rest. A loan never pushes net pay below zero. | Choose per loan type on Default behaviours. | Keep the default unless a loan type should stop the run. |
| 70 | **D-37 default 2 — leave in the month of leaving:** pro-rata by days worked. Alternatives: none, a full month, or a full month only if at least N days were worked (you choose N). | Choose on Default behaviours. | Keep. |
| 71 | **D-37 default 3 — the Developer role does not see Employee Swipes.** A switch turns it on. | Turn it on if the developer needs the punch log to diagnose devices. | Keep off. |
| 72 | Most a month's deductions may take (percentage of gross): **Not set** (no limit). | Enter a percentage with its source. | Decide before the first loan. |
| 73 | Rounding of a pro-rata leave figure: **Not set** (the leave policy has none). An exact figure (15 of 30 days = 0.5) is applied; others wait. | Choose a mode and decimals. | Decide before the first leaver whose figure is not exact. |
| 74 | Loan and claim types are set on their own screen (Payroll → Loan and claim types); every value starts Not set. | — | Enter your types. |

## Demo history, the content walk and the end-to-end check (2026-11-11)

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 75 | There is no "paused" loan. A loan's remaining instalments can be cancelled (two directors); its balance then stays owed and is recovered at exit. Loans now show "Recovering", "Recovery stopped", "Fully recovered" or "Recovered at exit". | Ask for a real pause (stop now, resume later with the schedule moved on). | Tell us if you need a pause. |
| 76 | Only one off-cycle run can be open for the same settlement or held month; a second one (a double click, or the other director) is refused until the first is finalised or rejected. | Several drafts could be allowed (only one can ever be paid either way). | Keep. |
| 77 | Quarterly TDS data opens on the last quarter that has ended. | It could open on the current quarter. | Keep. |
| 78 | The demo company now has a made-up pay history. Its loan requests are written as if made months ago (the one step not done through the screens); everything after that goes through the screens' rules. | — | Keep (demo only). |

## Payroll reports and the payroll rows of the parity audit (2026-11-12)

Report layouts are the D-37 kind of default ("Default, change in settings"); nothing below sets a tax figure, a statutory rate or anything that changes pay.

| # | What was chosen | If you answer differently | Recommendation |
|---|---|---|---|
| 79 | Payroll reports read **finalised** runs only (people paid and people held); a draft run never appears on a report. | Drafts could be shown, marked. | Keep. |
| 80 | Each report starts with a conventional set of columns marked **"Default, change in settings"**. A director can save the company's own layout (with a reason; recorded; the history is kept). | — | Save your layouts once you have used them. |
| 81 | Variance between months: change % = change × 100 ÷ the compared month, rounded half up to two places; no % when the compared month is zero. | Another base or rounding. | Keep. |
| 82 | The bank-transfer summary report and the bank summary PDF group rows by the IFSC's bank code (its first four letters) and never show an account number or a person. | — | Keep. |
| 83 | Form 16: a PDF of Part B in our own layout, marked **DRAFT** until a second director confirms the year (and the tax year is confirmed). Part A is not made here (it comes from the tax portal); pairing them is not built. | — | Confirm the format with your accountant before issuing. |
| 84 | Settlement guide: service counts both the joining day and the last working day; months are calendar months (31 Jan + 1 month = end of February). The gratuity rule, notice period and encashment rate stay **Not set**; the guide proposes no amount. | — | Give the three rules (spec §14). |
| 85 | PF and ESI challans: "worked out" is the statute's own lines in finalised runs (employee and employer); administration charges are not added. A different director confirms each challan by retyping it. | Add the charges as their own line once you give the rule. | Keep. |
| 86 | Salary import uses **our own template** (employee number, structure, version, annual CTC, effective from). One revision per structure, CTC and date; each waits for the other director; one bad row or blocked group stops the whole file. greytHR's file is not read. | — | Keep. |
| 87 | The reimbursement statement lists claims paid by monthly runs; a claim paid by an off-cycle run shows on that run, not in the statement. Loan "reschedule" is not built (prepaid, waived and stop-the-instalments are). | Ask for either. | Keep for now. |

## Part 2: mechanisms with every value Not set (2026-11-13)

| # | What was built | What you give | Recommendation |
|---|---|---|---|
| 88 | PT and LWF deposits go in the same challan register as PF and ESI (Payroll → Statutory challans). The state PT return is not built. | The return format, if you want it. | Use it from the first month. |
| 89 | Compliance calendar: you enter each due date (statute, what, day of month, days before to remind, source). None is preset. The directors are reminded once a month inside the window; a date is marked done per month. | Every due date. | Enter them before go-live. |
| 90 | Minimum wages check: you enter each rate (state as written on your branches, category, monthly amount, from, source), each person's category and which pay heads are compared. Until then the check says Not set. It never changes pay. | Rates, categories, the compared heads. | Ask your accountant which heads count. |
| 91 | Form 16 Part A: you upload each person's Part A as the tax portal issued it; they download it beside Part B. Nothing is read from the file. | The files, each year. | — |
| 92 | Accounting journal: you map each journal key (a head's earning, deduction, rounding, employer expense and liability, and net pay) to a ledger account; none is preset. A negative net pay posts as a debit. No accounting package's format is built. | The chart of accounts. | Ask your accountant for the account names. |

## Part 3: dated statutory IDs, overtime and encashment pay, payroll per company, registers (2026-11-13)

| # | What was built or chosen | What you give | Recommendation |
|---|---|---|---|
| 93 | **Statutory IDs are effective-dated** (your decision): payslips, the PF/ESI files and Form 16 use the PAN, UAN and ESI number in force on their own date; older months keep the ones they had. An ID missing on a date is taken from the first value later known (an ID entered late counts for older months). | — | Keep. |
| 94 | A change is detected by the PAN's keyed hash or by a change in a last four; a new UAN or ESI number with the same last four as the old one is not recorded as a change (they have no keyed hash). | Whether to store a keyed hash for UAN and ESI. | Add one later if it matters. |
| 95 | **Overtime pay**: Not set. You choose the pay head and a flat rate per hour, or a multiplier of an hourly rate (chosen salary heads ÷ hours a month), and the rounding; a second director confirms. Nothing is paid unless overtime is also turned on. A director pays a month's approved overtime as one adjustment per person for the next run. | The rate rule. | Ask your accountant (the Factories Act basis, if it applies). |
| 96 | **Leave encashment** (in the year and at exit): Not set. You choose the pay head, the salary heads for the per-day basis, the divisor (fixed days or the month's calendar days), the rounding and which leave types are encashed at exit; a second director confirms. In-year requests are paid with the leave-ledger entry, once; at exit the settlement's leave line gets its amount. | The formula (spec §14). | Decide before the first leaver. |
| 97 | **Payroll per company, first steps**: a run is for one company (no company = the main one); one live run per month per company. Each company's registrations and bank account: Not set, two directors. Bank and statutory files for a run of another company are refused until they are built. | Each company's registrations and account; whether a period lock should be per company. | Enter them before using a second company. |
| 98 | Finalising any company's run locks that month's attendance for everyone (the lock is per month, as before). | Whether it should be per company. | Keep until you run a second company. |
| 99 | **Registers** (wages with a column per pay head, deductions, overtime) from finalised runs, in our own layouts marked "Default, change in settings". No official form is claimed. | The official formats, if a state requires them. | — |
