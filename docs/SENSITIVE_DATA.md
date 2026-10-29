# The owners' secrets: who can see them, who can change them, and what the application cannot protect

Written for the company's owners first, and for the developer second. It is checked against the code: the two tables below are generated from it, and a test fails if this
document says something the code does not.

## The rule

The people who build and run this system **do not need, and are not given,** the company's secrets: salaries, bank account numbers, the debit account, the PF/ESI/PT/LWF/TAN
registration numbers and the bank file layout. The **owners enter these themselves.** The system is built so that the developer can finish, test and demonstrate payroll with made-up
data (the demo company), and so that a real company starts from an empty system that only the owners fill.

## The kinds of sensitive data, and who can do what

<!-- BEGIN GENERATED: do not edit by hand; npm run docs:sensitive --prefix backend -->

#### Which permission opens each kind of data

| Kind of data | What it is | See it | Change it | Confirm it |
|---|---|---|---|---|
| Salaries and payroll figures | What each person earns, payroll runs, payslips, the bank transfer batches and the salary and statutory reports. | View salary and payroll; View any payslip; View bank transfer batches; Salary and statutory reports; Leave liability report; View pay documents | Prepare salary revisions; Add payroll adjustments; Prepare payroll runs (maker); Unlock payroll periods; Year End Process | Approve payroll actions (checker) |
| Payroll rules, components and structures | The rates, ceilings and choices that decide how pay is worked out. Not secret, but whoever changes or confirms them decides what people are paid. | nobody by permission | Edit payroll rules | Confirm payroll rules |
| Employees' bank accounts | The account each person is paid into. | View bank details | Edit bank details | nobody by permission |
| Employees' PAN, Aadhaar, UAN and ESI numbers | The government identifiers of each person. | View statutory details | Edit statutory details | nobody by permission |
| The company's PF, ESI, PT, LWF, PAN and TAN identifiers | The company's own registration numbers, printed on statutory files. | Company identifiers: enter and reveal | Company identifiers: enter and reveal | Company identifiers: confirm |
| The bank file layout and the company's debit account | How the bank wants its transfer file laid out, and the company account the salaries are paid from. | Bank file layout and debit account: enter; Bank file layout and debit account: confirm | Bank file layout and debit account: enter | Bank file layout and debit account: confirm |
| Employees' HR-held documents | ID proofs, certificates and letters kept on file for each person. | View employee documents | Manage employee documents | nobody by permission |
| Sensitive helpdesk tickets | Tickets in categories such as Payroll and Salary or Grievance, where people write private things. | Sensitive tickets | nobody by permission | nobody by permission |
| Power over other people's access | Security policy, other people's sign-in and 2FA, individual permission exceptions, and unlocking attendance. Whoever holds these can weaken the protection of everything above. | nobody by permission | Manage others' sign-in security; System settings; Manager permission exceptions; Unlock attendance periods; Unlock payroll periods | nobody by permission |

#### What each default role can do with each kind (S = see, C = change, K = confirm; a role's permissions are the Super Admins' to edit, so this is the starting point)

| Role | Salaries and payroll figures | Payroll rules, components and structures | Employees' bank accounts | Employees' PAN, Aadhaar, UAN and ESI numbers | The company's PF, ESI, PT, LWF, PAN and TAN identifiers | The bank file layout and the company's debit account | Employees' HR-held documents | Sensitive helpdesk tickets | Power over other people's access |
|---|---|---|---|---|---|---|---|---|---|
| Super Admin | SCK | CK | SC | SC | SCK | SCK | SC | S | C |
| HR Admin | C | — | SC | SC | — | — | SC | S | C |
| HR Executive | — | — | — | — | — | — | SC | — | — |
| Payroll Admin | SC | C | S | S | SC | SC | — | — | — |
| Payroll Approver | SK | K | — | — | K | SK | — | — | — |
| Developer / operator | — | — | — | — | — | — | — | — | — |
| Manager | — | — | — | — | — | — | — | — | — |
| Approver | — | — | — | — | — | — | — | — | — |
| Employee | — | — | — | — | — | — | — | — | — |

<!-- END GENERATED -->

*Two things the tables do not show.* (1) A person who holds **Approve profile changes** may decide a change request to someone's name, address or similar, but **cannot approve a change to a
bank account or to PAN/Aadhaar/UAN/ESI numbers** unless they also hold the Edit permission for that kind. (2) The Import Center's bank and statutory datasets need the same Edit permission
to upload and to commit. (Both were gaps found while building this and are closed.)

## What the developer's login can and cannot do

The developer account has the role **Developer / operator**. In code, not by a setting, whoever holds it is cut off from **every permission in the table above** (the ceiling is applied
in the one place access is worked out, so it holds whatever a role definition, a per-user exception or a direct database edit says), and **cannot also be a Super Admin** (the application
refuses to assign both, and the database refuses the row).

**Can:** see the organisation, import non-sensitive data, configure and operate attendance and its devices, set leave policies, see reports that carry no pay, run the helpdesk queue,
read the audit log (which carries no secret), see roles and permissions read-only, and see **where each payroll setup item stands** (Not set, Placeholder, Confirmed, and who did what),
never a value.

**Cannot:** see or change any salary, payslip, payroll run or bank batch; any bank account, PAN, Aadhaar, UAN or ESI number; the company's identifiers; the bank layout or the debit
account; employees' HR-held documents; sensitive helpdesk tickets; the security policy, anyone's 2FA, or anyone's permissions; confirm anything; carry out a payroll act.

You do not have to take this on trust. **Payroll → Setup Checklist → "Who can see and change this"** lists, from live access, the named people who can see, change and confirm each kind,
with any developer account in red if it ever appeared on a line.

On a development machine the seeded sign-in `1000` is a Super Admin of a **made-up** company; it sees only made-up data. To see exactly what the production developer login sees, sign in as
`DEMO005` (the demo company's developer).

## How a secret is protected

| Where | What is done |
|---|---|
| **Stored** | Bank accounts, PAN, Aadhaar, UAN and ESI numbers are AES-256-GCM encrypted (a key held in KMS in production). The company's identifiers (PF, ESI, PT, LWF, PAN and TAN) and the whole bank layout (including the debit account) are **sealed**: encrypted, with a keyed hash so a short code cannot be guessed back from it. |
| **Shown** | Lists and profiles show the last four characters at most. A secret is shown in full only by an explicit **Reveal**, to someone who may, and each Reveal is recorded (who, when, never what). The person who **confirms** a company identifier types it again from the company's own letter and never needs to see it. |
| **Audit log** | Records that something changed, by whom and when. The value is never in it. |
| **Logs and errors** | The logger masks the sensitive keys wherever they appear and scrubs account-like numbers and PAN-shaped words out of any error text; a validation error never carries back what was typed; a 500 message is scrubbed too. |
| **Exports and screens** | Every route is permission-checked; the scan below proves that what a developer, an HR executive without these rights and an ordinary employee can reach contains none of it. |
| **Screenshots** | Anything captured from the demo company carries a permanent **DEMO COMPANY** banner (and payslips a watermark), so it cannot be taken for real. Real screens are not captured. |
| **Email** | Payslip emails carry no figure; they link to the sign-in. |

## What proves it

- `developerCeiling.test.ts`: every permission is classified; the Developer role holds none; a grant, a raw SQL role edit, a raw SQL second role cannot give a developer a secret; the API refuses the developer at every secret.
- `sealedIdentifiers.test.ts`: entering, revealing and confirming a company identifier; the value is in no response, audit row, event or table.
- `releases.test.ts` (the scan): signed in as a developer, an HR executive without the rights and an employee, **every GET route** is called with real ids; no response (JSON or the cells of an Excel file) contains a bank account, PAN, Aadhaar, UAN, ESI number, the debit account, the bank layout's text or a company identifier; error responses never echo what was sent; **no column of any table** holds the debit account, the layout text or an identifier in the clear. Breaking a gate on purpose makes it fail (checked).
- `demoCompany.demo.test.ts` (`npm run test:demo`): the same crawl on the demo company as its developer.
- `check:sensitive-ui` (a browser): the developer and an employee open every page of both portals; no secret on any, and the DEMO COMPANY banner on every one.
- `redact.test.ts`: the logger prints no sensitive key and scrubs numbers out of error text.

## What no change to the application can protect

Be clear about these. They are about who holds the keys to the house, not the locks on the doors inside it.

1. **Salaries are stored as plain exact numbers in the database** (the calculation needs to add and order them). Anyone with direct database access can read them. Protect the database credentials: the production database user the application uses cannot change the audit trail, but **a person who is given a database login can read salaries**. The developer must not be given production database credentials, a database console, or a copy of a production backup.
2. **Employees' ESI numbers are encrypted** like UANs since Phase 7 (P7-0, the owners' decision). Before that they were stored as plain text and shown whole on the HR profile and on payslips; payslips published before then are immutable and keep the number in their stored content (the screen shows only its last four). No real payslip existed when this changed.
3. **The encryption key is the lock on everything encrypted.** In production it lives in AWS KMS, and **who may use the key** is an AWS policy, not something in this application. Set the key policy so the developer's AWS identity cannot call Decrypt. The application cannot enforce that.
4. **Whoever holds the AWS account's administrator rights** can, by definition, reach everything in it. The owners should hold those; the developer should have the narrower rights deployment needs.
5. **A Super Admin holds every permission.** The owners are Super Admins; keep the number small. Anyone who is made a Super Admin can see all of the above.
6. **People can copy what they are allowed to see.** A payroll admin can screenshot a payslip. Reveal is recorded, but a photo of a screen is not.
7. **The developer writes the code that runs.** A developer could in principle change the application to leak a secret. The defences are the two-person rule on the owners' side (every deployed change is reviewed), the ceiling and scans above running in CI on every change, and the audit of who deployed what. They make it visible, not impossible.

## How to set the accounts up

1. The developer runs `admin:bootstrap` with **the owner's** name and Gmail address (not their own). The invitation goes to the owner, who sets their own password and 2FA; the developer never sees either.
2. The owner signs in, and (Employee profile → Access) gives the **developer** the role **Developer / operator**, and gives the people who will run payroll the roles **Payroll Admin** and **Payroll Approver**, two different people. Nobody can be both a developer and a Super Admin.
3. The owner checks **Payroll → Setup Checklist → Who can see and change this**. The developer should be on none of the lines.
4. The owners enter their secrets (Setup Checklist shows where). The developer is never told them.
