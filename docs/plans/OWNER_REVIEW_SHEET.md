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
