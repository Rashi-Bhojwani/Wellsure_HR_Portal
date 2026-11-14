# First setup: the order to set the portal up before first use

**For:** the two directors and HR. **Takes:** several sittings. Many steps need the *other* director to confirm, so plan for both of you.

Words used here:

- **Not set**: nobody has chosen it yet. The portal refuses what depends on it and says so.
- **Placeholder**: one person entered it; nobody has checked it yet.
- **Confirmed**: a *different* director checked it and agreed. Only Confirmed values make a real payroll.
- **Default, change in settings**: a common starting value the portal already uses. A director can change it; every change is recorded.

Menu paths are written as *Menu → Item*. "Admin" means the HR / Admin portal (the left-hand menu after you sign in as a director or HR).

---

## Step 1. The people who run the portal

| Who | Role (Admin Tools → Roles & Permissions) | What they do |
|---|---|---|
| The two directors | Super Admin | Everything, including payroll. Each checks the other's work. |
| HR | HR Admin, or HR Executive | Employee records, attendance, leave, documents. They **never** see salaries or pay figures. Bank and identity numbers are shown masked (last four digits). |
| Managers | Manager | Nothing at first. HR or a director grants each manager what they need (Admin Tools → Manager Management). |
| The person who built the system | Developer / operator | Keeps it running. Never sees any salary, bank or identity value. |
| Everyone else | Employee | Their own records only. |

The roles Payroll Admin and Payroll Approver still exist in the list. **Do not give them to anyone.** The two directors are the payroll team.

1. A director signs in and opens **Account & security** (the menu under your name). Turn on two-step sign-in. The second director does the same.
2. **Admin Tools → System Settings → Security**: you may make two-step sign-in compulsory for directors.
3. **Payroll → Ready for First Run** shows "At least two active directors". It stays red until both director accounts exist and are active.

## Step 2. Who decides each payroll step (both directors)

**Admin Tools → System Settings → Director authority** (only directors see this tab).

For each step, for example *Approving a payroll run*, *The bank file* or *Salary revisions*, one director chooses either:

- "a different director must decide", or
- "the acting director decides alone (the other is told)".

The **other** director then confirms the choice. There is no default.

**Refused until done:** payroll. The message reads: *"The two directors have not both chosen how "…" is decided … Payroll will not run this until one director has set it and the other has confirmed it."*

## Step 3. The company and its branches (HR or a director)

**Admin Tools → Organisation Setup**. Work through its sections in this order:

1. **Cities**: add your city.
2. **Branches**: add your three branches (for example DEMO North, DEMO Central, DEMO South). Say whether each has a biometric machine.
3. **Departments**, **Designations**, **Grades**, **Cost Centres**.
4. **Divisions** are optional: a way to group departments. With one company in one city you can leave them empty.

**Companies** (Admin Tools → Companies) is for a second legal company. You have one company and one payroll, so leave it as it is.

## Step 4. Holidays, leave and attendance (HR Admin or a director)

1. **Admin Tools → Holiday Calendars**: this year's holidays, and which branches each one applies to.
2. **Admin Tools → Leave Types & Policies**: each leave type and its policy (for example how much PL is earned each month, and when a new joiner becomes eligible).
3. **Admin Tools → Shift Master** and **Week-off Patterns**: the shifts, and the weekly offs.
4. **Workforce Management → Attendance → Attendance Settings**: how a day is worked out (late marks, half-day minimum and the rest).
5. **Admin Tools → Devices**: register each branch's biometric machine and its sync agent. Branches without a machine are marked by hand (Attendance → Mark Attendance in the employee portal, for the people given that permission).

## Step 5. Employees (HR)

1. Add people one at a time with **Employee → Add Employee**, or many at once with **Employee → Bulk Import**.
2. The Import Center (**Admin Tools → Data Import/Export**) has these tabs: Org Masters, Employees, Statutory, Bank and Leave Grants. Download each tab's template, fill it and upload it. Every row is checked before you commit it.
3. **Bank accounts and PAN, Aadhaar, UAN or ESI numbers entered by HR wait for a director.** They show under **Employee → Change Requests** in "Bank and statutory changes waiting for a director". A director other than the person who entered them confirms. (Setting: *A director confirms HR's bank and statutory changes*. It is on by default, under Default behaviours.)
4. **Admin Tools → Manager Management**: give each person their reporting manager, and grant managers what they need (for example leave approval).
5. Opening leave balances: **Workforce Management → Leave → Leave Granter**, or the Leave Grants import tab.
6. Invitations: each new account gets a link to set a password. You can resend it from the person's profile.

## Step 6. Director settings (one director proposes, the other confirms)

1. **Admin Tools → Default behaviours**. Four settings already have a value, marked "Default, change in settings":
   - the loan shortfall rule;
   - leave accrual in the month of leaving;
   - whether the Developer sees Employee Swipes (off);
   - whether HR's bank and statutory changes wait for a director (on).

   Two others start empty:
   - the rounding of a pro-rata leave figure (Not set);
   - the most that a month's deductions may take (Not set).
2. **Admin Tools → Policy settings**. These are grouped by area:
   - **People.** Probation is 3 months, with a reminder 15 days before the end. Onboarding has a six-step checklist. Feedback may be sent without a name. HR's update import is covered here too. All of these are defaults.
   - **Attendance and Leave.** Correction limits, overtime, work-from-home requests, leave request limits, the sandwich rule and encashment requests. All of these are **off** until one director turns them on and the other confirms.
   - **Data.** Retention periods for former employees: **Not set**. Nothing is erased until the directors choose a period.
   - **Messages.** The SMS / WhatsApp provider: **Not set**. Nothing is sent until the directors choose one at deployment.
3. **Admin Tools → Letter Settings**, and **Email & Letter Templates**: your letter templates and who may prepare them.
4. **Admin Tools → Custom fields** (optional): extra details you want on each employee record.
5. **Admin Tools → What HR Can Do**: switch HR's narrower powers on or off.

## Step 7. Payroll (the two directors)

Open **Payroll → Setup Checklist**. It lists everything payroll needs, in eight groups. Each line shows Not set, Placeholder or Confirmed, with a link to the screen where you enter it. Work down it:

| Group | Screen | How |
|---|---|---|
| The company's registration numbers | Payroll → Rules and Setup (also Payroll → Company settings) | One director types each number from the letter. The other confirms by typing it again from the letter. |
| Rates and limits set by law | Payroll → Rules and Setup | Some rates arrive pre-filled and marked unverified. Check each one against the current government notification, correct it if needed, and confirm. PT and LWF start empty. |
| Choices for your company | Payroll → Rules and Setup | Rounding, payment date, how a month is divided into days, and similar. |
| Salary structures and their components | Payroll → Salary Components (your pay heads), then Salary Structures | One director creates; the other confirms. |
| The bank file | Payroll → Bank and Statutory Layouts | Type the layout from your bank's own specification, plus the company account salaries are paid from. The other director confirms by typing the account again. **Then have your bank accept a test file.** |
| Statutory files | Payroll → Bank and Statutory Layouts | PF, ESI, PT and LWF layouts. Not needed for the first payment; needed by the filing date. |
| People's pay details | Payroll → Salary Revisions; each profile's Bank and Statutory tabs | Salaries go in as revisions. "Import from a file" on Salary Revisions prepares them from the portal's own template. The other director approves each one. When everyone is entered, a director signs off the set. |
| Safety setup | (checked automatically) | Two directors, two-step sign-in (recommended), real email, and no developer account with access to secrets. |

Also:

- **Payroll → Tax Years**: the year's income-tax values, each with where it came from, confirmed by the other director.
- **Payroll → Opening Figures**: if you start in the middle of a financial year, each person's pay and tax so far. Until these are confirmed, a run works out no TDS and says why.

## Step 8. The checklist that tells you you are ready

**Payroll → Ready for First Run** is **red** until every required item is Confirmed by someone other than the person who entered it. It names each missing item, with a link to fix it. It is worked out again every time you open it.

What it blocks:

- **Off-cycle runs** are refused outright while it is red.
- **A monthly run** made while something is still a Placeholder is a **TEST** run. It is stamped TEST everywhere. It cannot be submitted, approved, published or turned into a bank file. The refusal reads: *"This cannot be submitted while a rule it used is still a Placeholder: … A different person has to confirm it. A run on placeholder rules is a test."*
- **Before any run,** the month's attendance must be finalised (Workforce Management → Attendance → Attendance Period Finalisation).

When Ready for First Run is green, run one practice month alongside greytHR (see [MOVE_FROM_GREYTHR.md](MOVE_FROM_GREYTHR.md)). Then follow [DAILY_AND_MONTHLY_GUIDE.md](DAILY_AND_MONTHLY_GUIDE.md).
