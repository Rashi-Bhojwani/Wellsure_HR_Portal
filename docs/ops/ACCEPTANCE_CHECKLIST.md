# Acceptance checklist

**For:** the two directors and HR. Run it once on the **demo company** (made-up people and figures), then again on your real data before the first real month. Tick each row only when you saw what it says.

**Demo company sign-ins** (development copy only; password `Wellsure@123`):

| Account | Who |
|---|---|
| `DEMO001` | Demo Owner, a director |
| `DEMO013` | Demo Second Owner, the other director |
| `DEMO004` | Demo HR Admin |
| `DEMO005` | Demo Developer |
| `DEMO002`, `DEMO003` | Ordinary employees |

The demo company shows a DEMO COMPANY banner on every screen. On real data, use your own accounts in the same roles.

---

## A. Each role sees only what it should

| # | Do this | You should see | ✓ |
|---|---|---|---|
| A1 | Sign in as HR (`DEMO004`). Open the menu. | No Payroll salary or bank screens. Bank and identity numbers on a profile show only their last four digits. | ☐ |
| A2 | As HR, open any profile's Bank tab and press Reveal, if offered. | The reveal is recorded in Admin Tools → Audit Log. | ☐ |
| A3 | Sign in as the Developer (`DEMO005`). Open Payroll → Setup Checklist. | Where each item stands, but no salary, bank number, layout or registration number. | ☐ |
| A4 | As the Developer, open Admin Tools → Audit Log. | Who did what and when, and the record type. No old or new values, no record id, no IP address. No Export button. | ☐ |
| A5 | Sign in as a manager who has been granted nothing. | No team data, and no approvals. | ☐ |
| A6 | Sign in as an employee (`DEMO002`). | The employee portal, with your own information only. No admin screen opens with your data. | ☐ |

## B. An employee cannot see another's data

| # | Do this | You should see | ✓ |
|---|---|---|---|
| B1 | As `DEMO002`, open Salary → Payslips. | Only your own payslips. | ☐ |
| B2 | As `DEMO002`, open View My Info (`/app/profile`) and press **Download my data**. | A file with only your own data; bank and identity numbers show the last four digits. | ☐ |
| B3 | As `DEMO002`, open People. | The directory: names and work details only, no pay or personal numbers. | ☐ |

## C. Leave and attendance

| # | Do this | You should see | ✓ |
|---|---|---|---|
| C1 | As an employee, Leave → Leave Apply for two days. | The request shows as waiting, and the manager is told within seconds. | ☐ |
| C2 | As the manager (granted leave approval), To do → Review, then Approve. | The employee sees "approved" without refreshing. The balance goes down. | ☐ |
| C3 | As the same employee, try to approve your own request (if you hold approval). | Refused: you cannot decide your own request. | ☐ |
| C4 | As HR, Workforce Management → Attendance → Attendance Muster, then **Upload muster** with a filled-in sheet for a branch without a machine. | The days appear in Attendance Info. | ☐ |
| C5 | As HR, check Who Is In? after a test punch on a branch machine. | The punch shows within seconds. | ☐ |
| C6 | As HR, Attendance Period Finalisation for a past month. | The month is locked; a correction to it is refused. | ☐ |

## D. The second director

| # | Do this | You should see | ✓ |
|---|---|---|---|
| D1 | As `DEMO001`, Admin Tools → Policy settings, then propose a change (for example the probation reminder days). | "Waiting for a different director". Nothing changes yet. | ☐ |
| D2 | As `DEMO001`, try to confirm your own proposal. | No Confirm button is offered for your own proposal. | ☐ |
| D3 | As `DEMO013`, confirm it. | It is in effect, and the Audit Log shows both steps. | ☐ |
| D4 | As HR, enter a new bank account on a profile. | "Waiting for a director". The old account stays in use. | ☐ |
| D5 | As a director (not the one who entered it), confirm it under Employee → Change Requests. | The new account is in effect and audited. | ☐ |

## E. A payroll run, end to end, on the demo company

| # | Do this | You should see | ✓ |
|---|---|---|---|
| E1 | Payroll → Ready for First Run. | Green on the demo company. On real data, red until everything is Confirmed. | ☐ |
| E2 | Payroll → Payroll Run → Start a payroll run, choose a past month, then **Calculate**. | Totals, "Left out" with reasons, and Difference from last month. | ☐ |
| E3 | Submit for approval as `DEMO001`; approve as `DEMO013`. | The approval is recorded. `DEMO001` cannot approve their own submission (if a different director must decide). | ☐ |
| E4 | Close the period, then Publish payslips. | Each person sees only their own payslip under Salary → Payslips. | ☐ |
| E5 | Generate the bank file and download it. | A file in the demo bank format; the download is recorded. | ☐ |
| E6 | **Mark sent to the bank**, then **Record that the bank paid this batch**. | The run shows the batch as paid. | ☐ |
| E7 | As `DEMO002`, Salary → Form 16 (needs a finished financial year with runs; skip on the demo company if it has none). | The figures, marked DRAFT. | ☐ |
| E8 | As the Developer, open the same run. | Refused, or no figures. | ☐ |

## F. Exports are recorded

| # | Do this | You should see | ✓ |
|---|---|---|---|
| F1 | As a director, Reports → Headcount, then export. | A file, and an "export" entry in the Audit Log. | ☐ |
| F2 | As a director, Admin Tools → Audit Log, then **Export to Excel**. | A file, and the export itself recorded in the Audit Log. | ☐ |

## G. Look and feel

| # | Do this | You should see | ✓ |
|---|---|---|---|
| G1 | Switch Light / Dark at the bottom of the menu. | Every screen is readable in both. | ☐ |
| G2 | Open the portal on a phone. | The menu becomes tabs at the bottom; no page scrolls sideways; buttons are easy to tap. | ☐ |
| G3 | Use only the keyboard: Tab, Enter, Escape. | You can reach every button; a form opens with Enter and closes with Escape. | ☐ |

Signed off by (director) ________ and (director) ________   Date ________
