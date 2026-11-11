# Recruitment — D1

Directors choose settings at `/admin/recruitment/settings`. Normal seed leaves
all values Not set. Required choices are explained beside their blocked action.
HR recruitment management requires the MANAGE_RECRUITMENT switch explicitly ON.
Office also requires membership capability and its director audience choice.
Neither grants feedback access. A named interviewer keeps their own relationship
while an HR management switch is off.

Open Recruitment in the admin menu for jobs, candidates and requisitions. Create
a job draft using its stepper, select a pipeline and open it with a reason. Add a
candidate with recorded consent, upload their CV in the drawer, then apply them
to an open job. The job page offers a stage board and table. The candidate drawer
contains stage history, scheduling and chosen-template mail receipts. Console
mail is labelled Prepared locally; it does not send email.

Managers with the owner-granted requisition key use Hiring requests in their own
portal. Interviewers use My interviews. Their own submission unlocks the current
panel's feedback. Directors opening outside their panel leave a read audit.
Candidates, CVs and encrypted answers are never Developer-readable. Candidate
contacts and stage notes stay out of manager/interviewer summaries. Private
queries expire on leaving and clear on account/access change.

The guarded DEMO seed chooses fictional rules and creates DEMO-C4-CANDIDATE,
a fictional PDF and a two-person panel (DEMO011 submitted; DEMO004 unsubmitted).
DEMO009 is the requesting manager. DEMO007 is unrelated. All four prepared leave
types remain off. No normal seed values change.

C-4B (offers, pay, joining, conversion, referrals): `offers.ts`, `joining.ts`,
`conversion.ts`, `referrals.ts`, routes in `offerRoutes.ts`, audiences in
`offerAccess.ts`. Office/directors manage offers; only directors see pay (offer
compensation and candidate expected pay, encrypted, every open audited). HR
onboarding (RUN_ONBOARDING, default on) runs joining and conversion. Joiner links
are token-only, hashed, expiring, revocable and rate-limited. Payroll interface:
`readAcceptedOfferForPayroll(directorUserId, employeeId)` — director-only, audited,
read-only; no payroll code here. There is still no public application form.
