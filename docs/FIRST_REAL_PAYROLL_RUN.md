# Running the first real payroll

Written for the people who run payroll at the company: an owner, the HR person, the person who prepares payroll and the person who checks it. **You do not need the developer for any of this**, and the developer is not meant to see any of the figures you will type. If a screen tells you something is wrong, it says what, in words, and where to fix it.

Nothing in this system pays anyone. When it is all done it gives you **a file for your bank**; you upload that file to your bank's website yourself, exactly as you do today.

Plain terms used below:

- **Placeholder**: a value somebody has typed, that nobody else has checked yet. A payroll run that uses a Placeholder is a **TEST** run: it works, it is stamped TEST on every screen, file and payslip preview, and it can never be approved, published or turned into a bank file.
- **Confirmed**: a value somebody has typed and a *different* person has checked against the original letter or notification and agreed to. Only a run made entirely of Confirmed values is a real run.
- **Maker and checker**: whoever prepares something is never the person who approves it. The system enforces this; it is not a matter of trust.

---

## 0. Before you start

**People.** You need at least these accounts, held by *different* people:

| Who | Role to give them (Admin Tools → Roles) | What they do |
|---|---|---|
| The owner | Super Admin | Unlocks a closed month if ever needed; sees everything |
| The person who prepares payroll | Payroll Admin | Types the company's numbers, the bank layout, salaries; prepares and submits runs |
| The person who checks payroll | Payroll Approver | Confirms what the preparer typed, approves runs and signs off people's details |
| HR | HR Admin | Keeps employee records; does **not** see salaries or bank details unless you also give them those permissions |

The checklist has an item "At least two active directors" (two Super Admin accounts). It stays red until this is true. **Strongly recommended before real salaries (optional, the owners' decision): every director turns on two-step sign-in** (Account Security), and the owners may make it compulsory (System Settings, Security, "Require two-step sign-in for directors"). Directors hold full authority; until it is on, the checklist shows a prominent warning (it does not block the first run). Steps: sign in, open Account Security, choose two-step sign-in, scan the code with an authenticator app, keep the backup codes somewhere safe and separate. A director acts on their own authority by default and the other director is told of each act; the owners may switch any step's second-director check on in System Settings → Director authority.

**The developer** should have the role *Developer / operator* and nothing else. This role is cut off, in the program, from every salary, bank, identifier and layout screen. The checklist has a table, **Payroll → Setup Checklist → "Who can see and change this"**, that names every person who can see each kind of secret. Read it once before you start; if any name there surprises you, fix the roles first.

**Papers to have on the desk** (you type from these; the system does not guess):

1. The company's registration letters: provident fund (PF) establishment code, ESI employer code, professional tax (PT) and labour welfare fund (LWF) registration numbers, and the TAN.
2. Your accountant's (CA's) current figures: PF and ESI rates and ceilings, the PT slabs for each state you have staff in, the LWF amounts and months, how leave is encashed, how arrears are treated.
3. Your **bank's own specification** for the bulk-transfer (salary) file, or a sample file the bank has accepted, and the number of the company account the salaries are paid from.
4. Every person's signed salary letter (annual CTC) and the salary structure they are on.
5. Every person's bank account number and IFSC, and the UAN for people covered by PF.
6. Last month's greytHR payroll register, as an Excel file, for the comparison in step 6.

**Attendance first.** Payroll reads *finalised* attendance. For the month you are about to pay, attendance must be finalised (Attendance Period Finalisation, under Workforce → Attendance) and the exceptions queue empty or resolved. The run screen tells you if it is not.

**Sensitive data stays out of messages.** If anything goes wrong and you need to ask the developer, send a **screenshot of the message only**, or its words. Never send a salary, bank number, registration number or a screenshot of the layout. The developer does not need them to help you.

---

## 1. Open the Setup Checklist

**Payroll → Setup Checklist** (`/admin/payroll/setup`).

Every thing that must be entered before a real run is listed, in plain language, in eight groups. Each line shows:

- **Not set**: nobody has entered it.
- **Placeholder**: entered, not yet checked.
- **Confirmed**: entered and checked, with *who* entered it, *who* confirmed it and *when*.
- a link, "Where to enter it", that takes you straight to the right screen.

A line marked "not needed for the first run" (for example the statutory file layouts, which matter on the filing date, not on the payment date) says why. It cannot hold you up.

Work down the groups in this order. **Do not try to do everything in one sitting**; each confirmation needs the other person.

### 1.1 The company's registration numbers (Placeholder → Confirmed)

Payroll → Rules and Setup (`/admin/payroll/rules`), the group *The company's registration numbers*.

1. **Preparer** (Payroll Admin) types each number from the company's letter. Once saved, the number is *sealed*: on screen it shows only as "entered", and nobody sees it again unless they press **Reveal** (preparer only; every Reveal is recorded with who and when).
2. **Checker** (Payroll Approver) opens the same line and presses Confirm. They are asked to **type the number again from the letter**. The system compares what they typed to what was saved; it does not show them the saved value. If the two differ the confirmation is refused and nothing is confirmed. This is deliberate: it proves the checker read the letter, not the screen.

### 1.2 Rates and limits set by law

Same screen. Some are pre-filled from memory and marked **unverified**: PF and ESI rates and ceilings, for example. These are *starting points only*. Your CA checks each against the current government notification; the preparer corrects any that differ; the checker confirms. PT and LWF are empty on purpose (they depend on your states); enter the slabs and the list of branches and their states.

One question is still open and is **not** for you to guess: *exactly when ESI coverage starts and stops for someone whose pay crosses the ESI ceiling part-way through a contribution period.* The rule "ESI: coverage period rule" can be set to the simple monthly reading; its half-year option cannot be Confirmed until the developer has written down the answer from your CA. If you are unsure, use the monthly reading and tell the developer to record the question.

### 1.3 Choices for your company

How a month is divided into days, the payment date, how pay is rounded, the treatment of leavers, who is covered by PF/ESI, how negative pay is handled, and so on. Same method: one person enters, a different person confirms.

### 1.4 Salary components and structures

Payroll → Salary Components and Salary Structures. A structure says how a yearly pay is split into basic, allowances and the rest. Every component and every structure that anybody is on must be Confirmed by a person other than its author.

### 1.5 The bank file

Payroll → Bank and Statutory Layouts (`/admin/payroll/layouts`).

1. **Preparer** types the layout from the bank's own specification: file type, column order and widths, date and amount formats, header and trailer rows, and the **company account** the salaries are debited from. The whole layout, debit account included, is sealed exactly like the registration numbers.
2. **Checker** confirms it by retyping the debit account from the bank's letter.
3. **Test it with the bank.** Make a test file for a pretend month with one or two people (Placeholder layouts can be previewed but never produce a real file), and ask your bank, or its net-banking file validator, whether it accepts the format. **Do not rely on the layout until the bank has accepted a file in it.** This is the single thing the developer cannot check for you.

### 1.6 People's pay details

Three lines, each signed off as a *set*:

1. **Every person's salary.** Payroll → Salary Revisions (`/admin/payroll/revisions`). A revision applies one annual CTC and one structure to a group of people. Make one revision per distinct CTC (people on the same CTC and structure go together). Each revision is **checked by a different person** before it takes effect. There is no spreadsheet import for salaries, on purpose: every salary must go past a second pair of eyes.
2. **Every person's bank account** and
3. **Provident fund numbers (UAN)**: entered on each profile, or through the Import Center (Admin Tools → Bulk Import) by someone who holds the permission to edit that kind of data. HR executives cannot.

When all are entered, a **payroll approver who is allowed to see salaries and bank details** opens the line, compares the set against the signed letters and the bank's records, and presses **Sign off**. The sign-off is tied to *exactly that set*: change one person's salary, account or UAN afterwards and the line goes back to Placeholder until it is signed off again. The signer cannot be the person who requested the sign-off or the person who entered any of the rows.

### 1.7 Safety setup

Two different people for payroll (see Section 0), two-step sign-in for all of them (strongly recommended, optional), real email switched on (payslip notices go out by email; with no mail driver they are only written to a file) and no developer account with access to any of the above. These are checked from the live system, not by a tick box.

---

## 2. "Ready for first real run"

**Payroll → Ready for First Run** (`/admin/payroll/ready`).

This screen is **red** until *every required item is Confirmed by someone other than the person who entered it*, and it says exactly what is missing, by name, with a link to fix each one. It is worked out again from the data every time you open it; there is no switch to flip. It also re-checks the "different person" rule itself instead of trusting that the Confirm button enforced it.

Below the red/green it lists the items that are **not required** for a first run and why, so that nothing is hidden.

**Do not start a real run while this screen is red.** (The system would stop you anyway: a run on anything unconfirmed is a TEST run.)

---

## 3. A practice run, then the comparison

Before the first real month, make a practice run for a past month you have a greytHR register for:

1. **Payroll → Payroll Run → Start a payroll run**, choose the month. It is a **TEST** run if anything is still a Placeholder and a real one if everything is Confirmed.
2. Press **Calculate**. The run screen lists any person who would be left out, with the reason, and every blocking problem (for example "no bank account on the payment date").
3. Download the **salary register** (Excel).
4. **Payroll → Compare Registers** (`/admin/payroll/compare`): upload *our* register as A and greytHR's register as B.
   - People are matched by **employee code**.
   - You see who is only in one register, and for everyone in both, every amount that differs by more than the tolerance you set (a rupee amount, a percentage, or both).
   - Rounding differences of a rupee are normal; a whole component differing is a conversation with your CA.
   - **The greytHR file layout is not read automatically yet.** Until the developer has seen a sample of your register, save it as a plain table (one header row; one column for the employee code; every other column an amount) and choose "Generic table". Use the column-name box to line up names that differ ("Basic Salary" = "BASIC"). Names with a sample go in as parsers later.
5. Explain every difference. Fix rules or salaries (through the normal confirm routine) and run again. Repeat until the only differences are ones you can explain and accept.

---

## 4. The real run, step by step

Payroll → Payroll Run → open the month.

| # | Step | Who | What to check |
|---|---|---|---|
| 1 | **Calculate** | Preparer | "Who is left out" at the top, every blocking problem, the totals. The **variance** table shows who changed most compared with last month and why (joiner, leaver, revision, loss of pay, arrears). Read it. |
| 2 | **Submit for approval** | Preparer | The submit screen lists, first, everyone left out of the run and why; then rules that changed since calculation. Confirming sends the fingerprint of *exactly what you saw*; if anything moved since, it refuses and you look again. |
| 3 | **Approve** | Checker (not the preparer, and not anyone who changed the figures since submission) | The checker sees the same preview and approves *that exact content*. If any figure changes later the approval is voided. |
| 4 | **Close the period (finalise)** | A third action, done by someone other than the approver | The month is **locked**: attendance, joining/leaving, salary, leave and bank changes dated inside the month are refused. Late corrections go through **Adjustments** in the next month's run. |
| 5 | **Publish payslips** | Preparer asks, checker approves, then someone else carries it out | **At the top of this screen: everyone who will get no payslip and why** (held for no bank account, zero net pay, and so on), with what to do. Read it before approving. After publishing, each person reads *only their own* payslip under Salary → Payslips; the email contains no figures, only a link to sign in. |
| 6 | **Bank file** | Preparer asks, checker approves, then someone else generates | The preview names everyone in the file and, **by name**, anyone payable who has no bank account on the payment date. The file is made in the confirmed layout. The approval is tied to the rows, the accounts and the layout; a change voids it. |
| 7 | **Upload the file to your bank** | You, on the bank's website | The system never talks to a bank. |
| 8 | **Record that it was paid** | HR | Type the bank's reference. This is HR's own statement. No file comes back from the bank; a rejected payment is entered by hand by a director (a reason for each), and a downloaded file can be noted as sent to the bank by a director. |
| 9 | **Statutory files** | Preparer | PF, ESI, PT and LWF files need their own confirmed layouts; until a layout is entered and confirmed its button is disabled. Take each file to its government portal's validator before filing. |

Once payslips are published or a bank file exists, **the period can no longer be unlocked.** Corrections after that go into the next month as adjustments.

**There are no off-cycle runs yet.** A run outside the monthly cycle (to pay someone the month's run held, a correction that cannot wait, a final settlement) arrives with Phase 7 (step P7-6). Until then:
- **a held person is not paid automatically later.** Nothing carries their held pay into the next month. The preparer adds it by hand as an **Adjustment** (Payroll → Adjustments) in the next month's run, using the figures the held run shows for them, and the checker sees it in that run's approval;
- **a final settlement for a leaver** is worked out and paid as greytHR does it today.

If you need to unlock a month *before* payslips are published (for example a salary was wrongly entered): only a Super Admin can ask, a second person approves, and it is carried out by someone other than the approver; the reason is recorded.

---

## 5. After the first run: the parallel months

greytHR keeps running alongside this system for two to three months. Each month:

1. Finish the run here as above (it need not be paid from here).
2. Compare it with greytHR's register (Section 3, step 4).
3. Keep a short note of every difference and how it was settled.

**Do not switch greytHR off** until your CA agrees, in writing, that three months in a row matched. Phase 7 (tax deducted at source, declarations, full and final settlements, off-cycle runs, loans, reimbursements) is being built step by step; until a step is finished, what it covers is still done in greytHR.

---

## 6. When something looks wrong

| You see | What it means | What to do |
|---|---|---|
| The run says **TEST** | A rule, component, structure or layout it used is still a Placeholder | Open the line named, have it confirmed by the second person |
| "Left out of this run" lists a person | The run cannot pay them: no salary, not active, attendance not final… | Read the reason; fix it; calculate again |
| A person is **held** (no payslip) | Zero or negative net, or no bank account on the payment date | Fix the cause; then add what they were owed as an **Adjustment** in the next month's run (nothing carries it over automatically, and there are no off-cycle runs until Phase 7, P7-6) |
| The approval disappeared | Something the approval covered changed after it was given | Submit again; this is the safety working |
| "Only X can approve this" | You are the only person who could; the system will not let you approve your own work | Give the Payroll Approver role to a second person |
| The bank rejects the file | The layout is not what the bank expects | Do not edit by guess. Ask the bank for the exact error, correct the layout from the specification, have it confirmed again, and make a new file |
| You think a number is wrong | | Open the person's line in the run; the side panel shows every step of how the figure was worked out |

**To report a problem to the developer** send the words of the message, the run's month and the step you were on. Do not send figures, numbers or layouts.

---

## 7. What nobody can check from here

These cannot be proved without your real data and real bank and portals; the developer's tests prove the mechanics, not the facts.

- That your **bank accepts** a file in the layout you typed.
- That each **government portal accepts** the PF, ESI, PT and LWF files.
- That the **statutory rules** as typed are what the law says: the arithmetic is checked against an independent calculation, but the figures are your CA's word.
- That a **full month at your real headcount** runs in comfortable time on the production servers (measured on a made-up company of the same size in development).
- That payslip **emails arrive** (the production mail service, its sending limits and its bounce handling are set up last).

Do each of these once, on the first real month, with someone watching, and write down the result.


## Before anything else: who decides each payroll step
Open Admin Tools, System Settings, **Director authority**. For each of the eight payroll steps one director chooses "a different director must decide" or "the acting director decides alone (the other is told)", and the **other** director confirms it. There is no default. Until all eight are set and confirmed, payroll will not run and **Ready for first real run** is red. We recommend "a different director must decide" for approving a run, the bank file, salary revisions and confirming rules.
