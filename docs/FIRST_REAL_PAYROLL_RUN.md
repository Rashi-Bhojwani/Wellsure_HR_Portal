# Running the first real payroll

**For:** the two directors, who are the company's payroll team. HR helps with attendance and people's records but never sees a salary or any pay figure. The person who built the system (the Developer role) never sees any figure either, and does not need to.

Nothing in this portal pays anyone. At the end it gives you **a file for your bank**; you upload it to your bank's website yourself, as you do today.

**Set the portal up first.** The order, the screens and who does what are in [`ops/FIRST_SETUP.md`](ops/FIRST_SETUP.md). This document covers only payroll itself.

Plain terms:

- **Placeholder**: a value one director typed that the other has not checked yet. A run that uses one is a **TEST** run: stamped TEST everywhere, never submitted, approved, published or turned into a bank file.
- **Confirmed**: a value one director typed and the **other** director checked against the original letter or notification. Only a run made entirely of Confirmed values is a real run.
- **Not set**: nobody has entered it. The portal says so and says where to enter it.

---

## 0. Before you start

**People.** The two directors hold the **Super Admin** role. The roles *Payroll Admin* and *Payroll Approver* exist in the list but are **not given to anyone**. Payroll → Ready for First Run stays red until there are "At least two active directors". Turn on two-step sign-in for both (Account & security); System Settings → Security can make it compulsory.

**Who decides each step.** Admin Tools → System Settings → the **Director authority** tab (directors only). For each payroll step, one director chooses "a different director must decide" or "the acting director decides alone (the other is told)", and the other director confirms it. There is no default. Until both have chosen, the portal refuses that step: "The two directors have not both chosen how … is decided". We recommend "a different director must decide" for approving a run, the bank file, salary revisions and confirming rules.

**There is no CA.** The directors enter every statutory and tax value themselves, each with a **source note** (which letter or government notification it came from). The other director checks it against that source and confirms it.

**Papers to have on the desk:**
1. The company's registration letters: PF, ESI, PT, LWF and TAN.
2. The current government notifications for PF and ESI rates and ceilings, the PT slabs for your state, and the LWF amounts.
3. Your bank's own specification for the salary (bulk transfer) file, and the number of the company account salaries are paid from.
4. Every person's signed salary letter (annual CTC) and their salary structure.
5. Every person's bank account, IFSC and, where PF applies, UAN.
6. Last month's greytHR payroll register, for the comparison.

**Attendance first.** Payroll pays only for finalised days. HR finalises the month under Workforce Management → Attendance → **Attendance Period Finalisation**.

**Never send figures to the developer.** If something goes wrong, send the words of the message, the month and the step you were on. Never send a salary, bank number, registration number or layout.

## 1. The Setup Checklist and Ready for First Run

**Payroll → Setup Checklist** lists everything payroll needs, in eight groups. Each line is Not set, Placeholder or Confirmed, and links to the screen where it is entered. [`ops/FIRST_SETUP.md`](ops/FIRST_SETUP.md), Step 7, walks through the groups.

Points that are easy to miss:

- **Registration numbers and the bank layout are sealed.** Once saved they show only as "entered". The other director confirms by **typing the value again** from the letter; the portal compares, and never shows it.
- **Pre-filled rates are starting points, marked unverified.** Check each against the current notification, correct it, add the source note, and have the other director confirm it.
- **Salaries:**
  - Enter them as **Payroll → Salary Revisions**: one revision per group of people on the same CTC and structure.
  - Or use **Import from a file** on the same screen, with the portal's own template: who, which structure, the annual CTC, from when. It prepares revisions; it does not apply them.
  - Either way, the other director approves each revision before it takes effect.
- **Have the bank accept a test file** in your layout before you rely on it. Nobody can check this from inside the portal.
- **Payroll → Company settings**: the company's registrations and bank account for payroll. Nothing is preset.
- **Payroll → Tax Years** and **Payroll → Opening Figures**: the year's tax values, and if you start mid-year each person's pay and tax so far. Until opening figures are confirmed, a run works out no TDS and says why.

**Payroll → Ready for First Run** is **red** until every required item is Confirmed by someone other than the person who entered it. It names each missing item with a link. Off-cycle runs are refused while it is red. A monthly run made while anything is a Placeholder is a TEST run.

## 2. A practice run and the comparison

Before the first real month, run a past month you have a greytHR register for:

1. **Payroll → Payroll Run → Start a payroll run**, choose the month, then **Calculate**.
2. Download the salary register from the run.
3. **Payroll → Compare Registers**:
   - first register: the portal's own register;
   - second register: greytHR's, saved as "A plain table (a header row, an Employee code column, amounts)";
   - set the tolerance (for example 1 rupee), and match column names that differ.

   The option "greytHR's own register layout" waits for a real sample.
4. Explain every difference. Fix rules or salaries through the normal confirm routine, then calculate again.

The full parallel-run plan is in [`ops/MOVE_FROM_GREYTHR.md`](ops/MOVE_FROM_GREYTHR.md).

## 3. The real run, step by step

Payroll → Payroll Run, then open the month.

| # | Step | Who | What to check |
|---|---|---|---|
| 1 | **Calculate** | A director | "Left out" (who is not paid and why), the totals, **Difference from last month** |
| 2 | **Submit for approval** | A director | Everyone left out is listed first. If anything moved since you looked, it refuses and you look again. |
| 3 | **Approval** | The other director, if you chose "a different director must decide" | Approves exactly what was shown. A later change voids it. |
| 4 | **Close the period** | As set in Director authority | The month locks. Late corrections go into the next month as **Adjustments**. |
| 5 | **Publish payslips** | As set | The top of the page names everyone who will get no payslip, and why. Each person reads only their own (Salary → Payslips); the email has no figures, only a link. |
| 6 | **Generate the bank file** | As set | Made in your confirmed layout. It names anyone payable who has no bank account on the payment date. |
| 7 | Upload the file to your bank | You, on the bank's website | The portal never talks to a bank. |
| 8 | **Mark sent to the bank**, then **Record that the bank paid this batch** | A director | No file comes back from the bank. A rejected payment is entered by hand (**Enter rejected payments**), with a reason. |
| 9 | Statutory files | A director | PF, ESI, PT and LWF files come from the final run once each layout is confirmed. Check each on its government portal before filing. Record deposits under **Payroll → Statutory challans**. |

Once payslips are published or a bank file exists, the period can no longer be unlocked.

**Outside the monthly run:**
- **Payroll → Off-cycle runs**: pay a held salary, a confirmed settlement, or a correction that cannot wait. Refused while Ready for First Run is red.
- **Payroll → Settlements**: a leaver's full and final.
- **Payroll → Held Salaries**: hold or release someone's pay.

Each follows the same rules: one director acts, and the other confirms where you chose that.

## 4. The parallel months

greytHR keeps running alongside the portal for two to three months. Each month, run the month here, compare it with greytHR's register, and note every difference and how it was settled. **Do not switch greytHR off** until both directors agree that the months matched (see [`ops/MOVE_FROM_GREYTHR.md`](ops/MOVE_FROM_GREYTHR.md), section 6).

## 5. When something looks wrong

The common messages and what to do about each are in [`ops/DAILY_AND_MONTHLY_GUIDE.md`](ops/DAILY_AND_MONTHLY_GUIDE.md), "It won't let me". Two more:

| You see | What it means | What to do |
|---|---|---|
| The bank rejects the file | The layout is not what the bank expects | Ask the bank for the exact error. Correct the layout from its specification, have the other director confirm it again, and make a new file. |
| A figure looks wrong | — | Open the person's line in the run. The side panel shows how each figure was worked out. |

## 6. What nobody can check from inside the portal

Do each of these once, on the first real month, with someone watching, and write down the result:

- that your **bank accepts** a file in your layout;
- that each **government portal accepts** the PF, ESI, PT and LWF files;
- that the **statutory values** you typed are what the law says (the arithmetic is tested; the values are yours, with their source notes);
- that a full month at your real headcount runs in comfortable time on the production servers;
- that payslip **emails arrive**.
