# Wellsure HR Portal — Peeps Integration Guide

**Planning baseline v1.0 · 23 October 2026 · Asia/Kolkata**

**Purpose:** integrate the Peeps feature set into the existing Wellsure HR Portal, preserve its working core and deliver the redesigned experience using Wellsure’s Figma designs.

**Delivery decision:** finish the core portal, including Phase 7, and obtain HR acceptance before beginning Peeps implementation. Build the integration in internal work packages, then launch all agreed integration features together in one company-wide release. There is no planned partial production rollout. External calendar integration is deferred; resume, identity and bank-document autofill are included in the initial integration scope.

This is a developer handoff and acceptance guide. It does not authorise implementation before the readiness gate, certify production readiness or set statutory policy. No application code was changed while preparing it.

## 1. How to read this guide

Three labels distinguish the authority of requirements:

- **Confirmed:** a decision explicitly made during the requirements discussion. These are the initial business defaults, with configuration support as requested.
- **Proposed:** an engineering design, workflow detail or safeguard recommended to make those decisions reliable. It still requires technical/product review.
- **Open:** an input not supplied. Store it as **Not configured** where relevant; do not invent an entitlement, approval, provider or legal rule.

Later explicit user decisions take precedence over the Peeps PDF and older repository documents. Configurable business rules must remain subject to security boundaries, historical integrity and the agreed approval controls. “Configurable” does not mean any administrator can reveal confidential information or silently rewrite finalised payroll.

### Sources and review boundary

| Source | Reviewed baseline | Use |
|---|---|---|
| [Wellsure HR Portal repository](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal) | Main commit `6bd738600f19cad195d39269b6d676283e45fd5c`; branch head rechecked on 23 October 2026 | Existing implementation and integration points |
| [Phase 7 preparatory branch](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/tree/cc950371603cce9ed94393cc0a49610a19d0927f) | `claude/optimistic-sagan-9xw3y9`, commit `cc950371603cce9ed94393cc0a49610a19d0927f`; head rechecked on 23 October 2026 | Phase 7 plan/preparation; not equivalent to completed Phase 7 |
| [Peeps by Wellsure — Feature Guide](sandbox:/workspace/scratch/715332a5b12b/upload/01-Peeps-by-Wellsure-Feature-Guide.pdf) | All 22 pages read, including visual inspection | Desired feature coverage; sample UI is a reference, not proof of a working backend |
| Requirements discussion | Decisions through the final scheduling/import/launch answers | Business authority for this guide |
| Wellsure Figma designs | Link and approved frames not yet supplied | Required before detailed UI implementation |

The PDF cover says 18 features, but its chapters run from 1 to 19. This guide tracks all 19, including mobile/PWA and autofill. Recheck the repository against this baseline after core completion; work performed meanwhile may close or change some gaps.

## 2. Where the existing portal stands

**Assessment:** the portal has a substantial working core. It is ready to support detailed integration planning, but has not met the agreed prerequisite for Peeps implementation or demonstrated full production readiness.

“Built” below means present in the reviewed implementation. It does not mean accepted by HR, proven with the real biometric machine or deployed successfully to AWS.

| Area | Present in reviewed code | Remaining boundary |
|---|---|---|
| Foundation and authentication | Express API, React app, database, queues, audit, password/invitation/reset flows, refresh rotation, 2FA and permissions | Preserve and extend; complete operational hardening |
| Organisation and employees | Employee records, departments, reporting lines, effective-dated history, imports and granular access | Add recruitment conversion, lifecycle views and explicit business approval capabilities |
| Attendance | Common ingestion path, immutable raw punches, deduplication, mapping, day engine, corrections, manual entries, finalisation and live updates | Add the revised configurable lateness policy; resolve delivery/reconnection concerns; verify the real device |
| Leave | Ledger, accrual, policies, balances, approvals, comp-off, year-end and recalculation | Extend leave types, routing and medical-document privacy; confirm new entitlements |
| Employee experience | Home/dashboard foundations, tasks, directory, Engage/kudos, notifications, documents, helpdesk and PWA foundations | Extend existing modules and replace their presentation using Figma |
| Phase 6 payroll | Salary history, governed rules, calculation, checker approvals, finalisation, payslips, bank/statutory outputs and comparison tools | Core acceptance and real-data validation; preserve every payroll control during integration |
| Phase 7 | Approved plan and preparatory work visible on the newer branch | Main tax-and-benefits implementation remains: tax declarations/proofs/TDS, loans/advances, reimbursements, off-cycle/F&F and associated outputs, according to the approved Phase 7 scope |
| AWS and migration | Preparatory controls; Phase 1.5 commit A | Remaining infrastructure/deployment/migration work and production hardening are pending; actual greytHR samples/reconciliation are required |
| Real biometric operation | Agent, service packaging and simulator/CI evidence | Real device, office network, clock/timezone and recovery acceptance |
| Peeps additions | Useful foundations exist | Recruitment, asset register, full exit workflow, Unmute, persistent badges and document autofill need substantial implementation |

Do not publish a single completion percentage: phases differ greatly in scope, and code completion, HR acceptance and production validation are separate measures.

### Evidence already obtained

- Frontend production build and lint passed locally; 21 tests across 5 files passed.
- Biometric agent lint/typecheck and 160 tests across 15 files passed locally.
- The reviewed main GitHub CI run had green jobs covering backend checks, Docker build, Windows agent, attendance simulation/replay and browser checks: [CI run](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/actions/runs/39838297777).
- The backend’s full integration suite was **not** rerun locally during the review. Repository-reported test totals are not a substitute for that distinction.
- Synthetic attendance tests and 500-employee simulations are useful evidence; they do not establish 500 concurrent users or real-office/device reliability.

### Core findings to resolve or revalidate

These are review findings, not changes made by this guide.

| Finding | Evidence level | Required treatment |
|---|---|---|
| Invitation/reset tokens can survive request-log URL sanitisation | Code trace and synthetic sanitiser reproduction; not a full HTTP test | Redact path-based secrets and verify actual request/error logs |
| Raw attendance commit can succeed before recompute enqueue fails; duplicate retry can skip enqueue | Actual ingestion function reproduced with mocked database/queue | Durable handoff/outbox or equivalent idempotent recovery; prove historical punches eventually recompute |
| Payroll setup readiness/signoffs appear disconnected from run/submission/finalisation enforcement | Code-level trace; no full live bypass test | Decide the mandatory prerequisites and enforce them on the server, not only in the readiness screen |
| Socket reconnect can reuse the original access token after REST token refresh | Frontend/backend code review | Refresh socket authentication and test expired-token reconnect; verify deactivation/revocation handling |
| Frontend eagerly bundles most routes; approximately 3.2 MB main JS in the reviewed build | Local production build | Add route-level loading where useful and define a mobile performance budget |
| Some status documents contain historical/stale summaries | Documentation review | Publish one current status ledger with accepted/pending distinctions |
| Held pay is not automatically carried forward in the reviewed core | Payroll review and newer branch documentation | Ensure Phase 7/F&F and held-pay handling are explicit and tested |
| Production container, infrastructure, real formats and real device remain unproven | Source/docs and review environment limits | Close the operational launch checklist; obtain actual outputs and acceptance evidence |

## 3. Gates and launch model

### Gate A — permission to begin Peeps implementation

**Confirmed:** core features, including Phase 7, must be completed and accepted by HR.

**Proposed evidence:** a signed core acceptance record referencing the exact commit, tested environment, accepted workflows and unresolved issues. Include Phase 6 payroll, Phase 7 benefits/tax/F&F, attendance, leave and employee records. Resolve critical correctness/security findings rather than carrying them into a larger integration.

This gate does not require all unrelated Phase 8 extras. AWS/real-device work must follow the agreed core project sequence and be completed where required for launch; do not silently redefine Gate A as “production already live.”

### Gate B — implementation and design readiness

Before the relevant work package starts, obtain its approved Figma frames, data contracts, permission rules and required policy settings. Provider procurement or missing values may be resolved alongside unrelated implementation. Do not activate a feature whose mandatory settings are incomplete.

### Gate C — single company-wide launch

**Confirmed:** all agreed integration features are complete before one launch. Internal development stages, staging deployments and UAT are still necessary; they are not partial company-wide releases.

All 19 feature areas must be covered, including reviewed autofill for resumes, identity and bank documents. External calendar integration remains outside this launch. Final production readiness also includes deployment, backups/restore, private document storage, scheduler/worker health, real device verification, data reconciliation, HR training and an approved rollback plan.

## 4. Feature coverage and reuse map

| PDF chapter | Target capability | Existing foundation | Integration action |
|---|---|---|---|
| 1. Wellsure Today | Headcount, presence, team health, workflow counts, birthdays and hiring funnel | Home, reports, dashboards, org and attendance | Extend scoped metrics; add hiring/exit data; redesign using Figma |
| 2. My Tasks | One actionable inbox | Existing tasks/inbox and notifications | Add vacancy, offer, onboarding, asset, exit, waiver and policy approvals |
| 3. My Attendance & Leave | Calendar, punches, balances, applications and corrections | Attendance and leave services | Reuse calculations; add new leave presentation and revised lateness explanation |
| 4. Ticket Desk | Office issues and confidential complaints | Existing helpdesk and sensitive categories | HR-first routing, handler closure, requester reopening and correct restricted views |
| 5. Directory | Searchable people, departments and reporting relationships | Directory and org history | Redesign; protect personal and sensitive fields |
| 6. Avatars | Photo/avatar selection and profile presentation | Employee/profile infrastructure | Add approved catalogue, choice/upload controls and badges; exact art from design handoff |
| 7. Cheers & Badges | Persistent positive awards and private corrective feedback | Engage/kudos | Add badge lifecycle and permissions; keep corrective feedback private |
| 8. Unmute | Private conversation scheduling | Authentication and scheduling primitives | New module with participant-only bookings and metadata-only retention |
| 9. All Teams | Team attendance and leave summaries | Org, attendance and leave reports | Scoped team views; no broadening of manager permissions |
| 10. Hiring | Vacancies, referrals, pipeline, interviews, offers and joining | Employees, documents, approvals and notifications | New recruitment domain with HR control and Director gates |
| 11. Autofill | Resume, identity and bank-document extraction | Upload/storage/worker foundations | New provider adapter and human review workflow; included at launch |
| 12. All Employees | Current/probation/notice/alumni views and profile history | Employee records and effective-dated history | Add lifecycle views and linked assets/recruitment/exits; preserve authentication |
| 13. Attendlog | Biometric truth, imports, manual reasons and lateness policy | Raw punches, ingestion and attendance engine | Extend one authoritative engine; add policy versioning and LOP integration |
| 14. Assets | Inventory, issue, acknowledgement, return and condition | Employee identity and documents | New asset domain controlled by HR |
| 15. Moving On | Resignation/termination, notice, clearance, interviews and documents | Employee status, documents and Phase 7 F&F | New exit orchestration; reuse payroll settlement services |
| 16. Insights | Turnover, tenure, exit reasons and hiring funnel | Reports and effective-dated history | Add defined, scoped metrics and clear date windows |
| 17. Payroll Overview | Salary/cost summaries and own payslips | Phase 6/7 payroll | Reuse payroll; limit salary visibility to the agreed authorised users |
| 18. Compliance | Traceable approvals, documents and lifecycle controls | Audit, sensitive documents, permissions and locks | Extend evidence and checks; UI labels do not certify legal compliance |
| 19. Mobile/PWA | Usable phone experience and installable portal | Existing responsive/PWA foundation | Redesign and verify every new workflow on mobile; preserve light/dark support |

## 5. Terminology, authority and confidentiality

### Confirmed mappings

| Peeps term | Portal meaning |
|---|---|
| Function | Department; use the existing department identity |
| Function Manager | Employee’s reporting manager; do not create a second manager relationship |
| Annual Leave | Existing Privilege Leave balance, displayed as **Annual Leave / PL** |
| Director | Explicit business approval authority; mapping to accounts must be configured |
| Authorised Unmute host | An explicitly authorised person from any department |

**Proposed implementation rule:** a department and a reporting team remain distinct scopes. An employee’s manager can have reports across departments, and a department can contain multiple reporting teams. Do not grant a manager every employee in a department merely because functions map to departments.

### Confirmed business access

| Actor | Allowed initial scope | Restrictions |
|---|---|---|
| Employee | Own attendance, leave, tasks, profile, issued assets and submitted tickets; referrals and own interview/session participation where applicable | Referrers get basic candidate status only; no candidate scores, salary or rejection details |
| Reporting manager | Own team dashboards; hiring recommendations; resignation recommendations; lateness waiver requests; positive team badges | Interview feedback remains their own only when assigned; no automatic salary/bank or confidential-case access |
| HR | Recruitment pipeline, joining checks, inventory, ordinary ticket intake/assignment, leave administration and exit processing | Salary access is a separate explicit grant; medical/menstrual supporting documents remain HR-restricted |
| Director | Vacancy/offer/exit/policy/recovery approvals and company dashboards | Unmute booking visibility remains participant-only; corrective nudges remain limited to employee, manager and HR |
| Payroll preparer/checker | Explicitly authorised salary and payroll duties | Preserve existing maker/checker separation and sensitive-data controls |
| Assigned interviewer | Assigned interview and their own feedback | No access to other interviewers’ feedback; HR and Directors have recruitment-wide visibility subject to salary controls |
| Unmute host | Their own bookings and completion status | No access to other hosts’ bookings; no conversation content stored |
| Former employee | No portal self-service | Requests own payslips and exit documents from HR |

**Salary visibility is confirmed for Directors plus explicitly authorised payroll preparers/checkers.** Employees retain access to their own payslips while active. HR membership, recruitment responsibility or a manager title does not itself grant salary access.

### Proposed enforcement design

- Extend the central permission resolver and server-side scoping. Menus, totals, exports, attachments, search, task previews, emails and socket events must follow the same rules as detail APIs.
- Map Director approvals to explicit capabilities. Do not automatically treat `SUPER_ADMIN`, a developer account or `HR_ADMIN` as a Director. Existing Super Admin blanket access needs review against the newly confirmed confidentiality boundaries.
- Reconcile existing broad HR/pay document grants with the agreed salary audience. An HR account that needs compensation access must be explicitly authorised for the relevant payroll duty; an inherited role default is not sufficient business approval.
- Preserve the manager model: new team capabilities must be deliberately added to the permitted ceiling and granted per person. Do not silently populate the currently empty/locked manager role with new powers.
- Treat medical evidence as a protected document class. Existing General/Pay/Statutory categories alone do not express the confirmed medical-document restriction.
- Keep bank-document review and acceptance restricted to users authorised for bank data, even when an HR user starts onboarding. Identity-document review likewise requires statutory-data authority.
- Protect private nudges, interview feedback and Unmute metadata from broad admin reports and generic “view all” permissions. No global Director override for Unmute bookings is implied.
- Require separate actors for approval where proposed maker/checker safeguards apply; define a substitute approver rather than allowing self-approval or stranding a task.

## 6. Configurable policy structure

**Confirmed:** the current rules are initial defaults. Build editable policy structures rather than hardcoded cutoffs, counts, leave amounts or routing rules. HR prepares leave-entitlement and attendance-deduction policy changes; a Director approves them before activation.

**Proposed policy lifecycle:** Draft → Submitted → Approved → Scheduled/Active → Retired. A rejected draft returns for editing. Edits to submitted/approved content invalidate approval. Store an immutable approved version with effective dates, applicability, proposer, approver and reasons.

| Policy area | Configurable fields | Agreed initial setting / unresolved input |
|---|---|---|
| Lateness | Timezone, grace, allowance threshold, immediate penalty threshold, monthly allowance, LOP fraction, applicability | Asia/Kolkata; 10:10, 10:20, 10:30; 3 occasions; 0.5 day LOP; fixed cutoffs for everyone |
| Daily deductions | Combination method | Higher of lateness and insufficient-hours deduction; do not add |
| Waivers | Request/approval capabilities, reason, evidence and effective dates | Reporting manager requests; HR approves; reason required |
| Leave | Type, paid/unpaid treatment, quota/accrual, eligibility, reset/carry-forward, evidence, application unit and route | Annual Leave / PL uses existing balance; new-type values not yet configured |
| Recruitment | Vacancy stages, interview rounds, scorecards, required feedback, approval routes and document checklist | HR-controlled pipeline; Director approval for vacancies and every offer |
| Documents/autofill | Accepted types, size, required fields, confidence handling, review authority, link lifetime and retention | Expiring candidate upload link; HR review; all three autofill classes included |
| Helpdesk | Categories, priority, assignees, restricted handlers, reopening window and escalation timing | HR intake/assignment; HR+Directors for confidential complaints; handler closes |
| Assets | Categories, condition/status catalogue, acknowledgement, recovery route | HR-only inventory; employee receipt; HR return confirmation; Director recovery approval |
| Exits | Notice rules, clearance checklist, routes, access end date and required documents | Employee→manager→HR→Director; HR proposes notice/date changes; Director approves |
| Badges | Catalogue, issuer capabilities, team scope, limits, duration and revocation | HR/Directors company-wide; managers team-only; corrective feedback private |
| Unmute | Host roster, session length, availability, booking/cancellation windows | Authorised hosts; portal-only scheduling; participant-only metadata |
| Notifications | Event subscriptions, templates, reminder timing and delivery preferences | In-app plus email; confidentiality rules apply to both |
| Insights | Date windows and metric definitions | Early attrition/tenure definitions require confirmation; no sample labels treated as policy |
| Imports | Templates, field mapping, dedupe keys and validation | HR-reviewed spreadsheet imports plus manual entry |

Configuration is typed and validated. Reject inverted thresholds, negative limits, overlapping active rules, missing approvers and incompatible pay/leave treatment. Evaluate permissions and policy on the server. Display “Not configured” and prevent activation when required settings are absent.

**Proposed historical protection:** preview affected people, open attendance periods and payroll before approval. Policy changes do not silently recalculate closed periods or overwrite finalised runs. Corrections to closed periods use the core’s authorised reopening/adjustment process. Audit old/new versions without copying sensitive content into logs.

## 7. Attendance and lateness — exact initial rules

**Confirmed fixed cutoffs in Asia/Kolkata, for everyone:**

| Arrival time | Attendance label | Monthly allowance use | Lateness LOP |
|---|---|---|---|
| At or before 10:10 | Within grace for this lateness rule | None | None |
| After 10:10, at or before 10:20 | Late | None | None |
| After 10:20, at or before 10:30 | Late; qualifying allowance occasion | First three qualifying occasions use the three monthly allowances | None for occasions 1–3; 0.5 day on occasion 4 and every subsequent qualifying occasion |
| After 10:30 | Late; immediate penalty | Does **not** use or count toward the three monthly allowances | 0.5 day each occurrence, even if allowances remain or sufficient hours are worked |

The later 10:20 instruction supersedes the original assumption that every post-10:10 late arrival consumes an allowance. “Late” and “uses an allowance” are separate facts.

The penalty is **loss of pay**, not a leave deduction. Leave balances stay unchanged. If both lateness and insufficient working hours produce a deduction, use the **higher deduction**, never their sum. Other approved payroll adjustments are outside this combination rule.

Examples:

| Situation | Result |
|---|---|
| Arrival 10:15 on ten working days | All ten marked late; none consumes the three allowances |
| Arrivals 10:25 on four qualifying days | First three use allowances; fourth incurs 0.5 day LOP |
| First late arrival of the month is 10:35 | Immediate 0.5 day LOP; all three allowances remain available |
| 10:35 arrival plus 0.5 day insufficient-hours deduction | Combined deduction is 0.5 day |
| 10:35 arrival plus 1 day insufficient-hours deduction | Combined deduction is 1 day |

**Waiver:** the reporting manager requests an exception; HR approves it with a recorded reason. A request alone does not remove a penalty. Store the original calculation and the approved adjustment distinctly.

### Proposed engine integration

1. Keep immutable raw biometric punches and existing mapping/deduplication. Do not mutate punches to “fix” lateness.
2. Resolve the workday, existing holiday/week-off/leave/manual/override rules and applicable approved policy version.
3. Identify the authoritative arrival using the existing attendance engine; then calculate late status, allowance qualification and lateness deduction separately.
4. Rebuild monthly qualifying occasions chronologically with a deterministic tie-breaker. Backdated punches/corrections must not depend on import order or decrement a mutable counter twice.
5. Apply approved waiver semantics, calculate the maximum of lateness and insufficient-hours deductions and retain reason components for explanation.
6. Recompute affected later days in the month when an earlier qualifying event changes. Respect finalisation locks and surface required payroll corrections.
7. Let payroll read finalised attendance through the existing integration. Do not create an independent LOP ledger that can diverge from attendance.

**Open edge settings before activation:** whether a waived qualifying occasion restores an allowance, precision/rounding of punch times, treatment of approved half-day/fieldwork arrangements, policy changes within a month, month-reset semantics and handling employees without a reporting manager. The fixed-cutoff decision remains intact; alternate shift-relative rules must not be enabled implicitly.

## 8. Leave extension

**Confirmed:** Annual Leave / PL is one balance. Menstrual, medical, wedding and bereavement leave need configurable rules and separately configurable approval routes. Managers may see medical/menstrual type and dates; supporting documents are restricted to HR. HR prepares entitlement changes and a Director approves before activation.

**Proposed:** extend the existing leave catalogue, policy resolver and append-only ledger. Use stable type identifiers; changing a display name must not create a new balance or duplicate accrual. Keep existing PL eligibility/accrual/carry/encashment behaviour until a separately approved policy changes it.

Each new type needs paid/unpaid treatment, quota/accrual, eligibility, application units, overlap rules, supporting-document requirements, approval route and reset/carry-forward rules before activation. These values have **not** been agreed. No automatic quota such as “one menstrual day per month” or “six medical days per year” is authorised by this discussion.

Respect employee-only information in notifications. Medical evidence must not appear in manager download links, email attachments, export cells, task previews, logs or generic employee documents.

## 9. Recruitment and joining

### Confirmed workflow

| Step | Responsibility and gate |
|---|---|
| Vacancy request | HR or a manager requests; a Director approves before opening |
| Candidate entry | Employee referral or HR entry; **no public application form** |
| Pipeline management | HR manages shortlisting, scheduling and stage changes; hiring managers recommend changes |
| Interview feedback | Assigned interviewer sees only their own feedback; HR and Directors have the recruitment-wide view, subject to separate salary permissions |
| Referral progress | Employee sees basic status only; no scores, salary or rejection detail |
| Offer | A Director approves every offer before issue |
| Joining documents | Candidate uses a private, expiring upload link; HR reviews before acceptance, subject to document-specific sensitive-data authority |
| Missing mandatory documents | Block activation unless HR records an approved exception |
| Employee activation | HR confirms actual joining, then activates the employee and portal access |

### Proposed domain and behaviour

Maintain separate Vacancy, Candidate and Application identities: a person can apply to more than one vacancy without duplicate people records. Add Referral, InterviewRound, InterviewAssignment, Feedback, OfferVersion, JoiningChecklist and JoiningDocument records. Store status transition history and decisions with actors and reasons.

Use configurable role-specific stages and scorecards. Screening/interview/offer/joined/rejected/withdrawn are starting design concepts, not a fixed mandatory pipeline. Retain rejected applications under the approved retention policy; reapplication starts a new application history rather than erasing a rejection.

Vacancy approval binds the relevant role, headcount and requisition version. Offer approval binds the exact offer version, amounts, terms and attachments; changing them invalidates approval. Only salary-authorised staff prepare or inspect compensation fields. A generic HR recruiting role must not gain salary access merely because it can move an application to Offer.

Use portal-only interview scheduling initially. Detect overlapping assignments and preserve rescheduling/cancellation history. External calendars are a later integration.

Candidate links are scoped to one candidate/checklist, time-limited and revocable, with secrets stored safely. An unauthenticated upload link cannot browse employee records, previous documents or other candidates. Uploads need validation and private storage. Link expiry/renewal and upload limits are configurable.

HR document acceptance is distinct from document upload, OCR completion and an onboarding exception. Record missing items, exception reason, approval evidence and follow-up task; do not fabricate a document as received. **Open:** who approves each exception and which items are non-waivable.

Candidate-to-employee conversion must be idempotent and transactional: check duplicate employee identity, create/link one employee, preserve application provenance, initialise job/history records, and issue the existing invitation only after HR joining confirmation. Offer acceptance or the planned joining date alone does not activate access.

## 10. Document autofill

**Confirmed launch scope:** resumes, identity documents and bank documents. All extracted information requires human review before acceptance.

**Proposed workflow:** private upload → validation → queued extraction → reviewable suggestions → authorised reviewer confirms/corrects fields → existing employee/candidate change workflow persists accepted data. Extraction failure leaves manual entry available without silently accepting empty or guessed values.

- Use a provider adapter so the extraction service can change without changing business workflows. Provider, document support, hosting region and retention terms are still open.
- Show the source document beside field suggestions, confidence/missing values and validation errors. Suggestions are not verified identity or verified bank ownership.
- Review authority follows field sensitivity. Generic recruiters may review resume fields; bank/statutory fields require their respective explicit permissions. Reject unauthorised writes even if the browser hides a field.
- Never auto-update employee bank details, pay data or statutory identity from an extraction result. Apply the existing approval/change-request controls.
- Keep raw text, identifiers and bank details out of ordinary logs, queue diagnostics, email, analytics and generic audit diffs. Protect provider requests and responses as sensitive data.
- Use retry/idempotency keys, timeouts, cost/rate controls and per-document provenance. Re-running extraction must not create duplicate employees or overwrite a reviewer’s accepted correction.
- Define supported file types, password-protected/poor-quality handling, matching rules, review queue, retention/deletion and provider acceptance tests before launch.

Because autofill is included in the initial launch, an unavailable provider or unfinished identity/bank review workflow is an unresolved launch dependency. Deferring it later would require an explicit scope change.

## 11. Ticket desk

**Confirmed:** HR receives and assigns every ordinary ticket. Confidential complaints go to HR and Directors, bypassing the reporting manager. The assigned handler closes an ordinary ticket; the requester may reopen it.

**Proposed:** extend existing helpdesk categories, permissions and history. Retain a clear state model such as Raised → Assigned → In Progress → Resolved/Closed, with reopen transitions and reasons. Category names, priorities, escalation timers, response targets and reopening window are configurable. Requester confirmation is not a required close gate under the agreed workflow.

For ordinary tickets, separate the requester’s view, assigned-handler actions and HR’s queue. “All Tickets” means all tickets the viewer is authorised to access, not a company-visible list. Assignment does not automatically grant access to confidential categories.

Keep confidential subjects, attachments and existence out of manager task counts, team dashboards and ordinary socket rooms. Preserve the existing no-self-handling safeguard and define alternate HR/Director handling for complaints involving an otherwise authorised handler. The precise conflict-of-interest/escalation process remains open.

Review the existing automatic-close job against the new handler-closes workflow. Do not keep inherited auto-close behaviour active accidentally; select and document any supported optional auto-close mode explicitly.

## 12. Assets and recoveries

**Confirmed:** HR alone manages inventory and records issues/returns. Employees acknowledge receipt; HR acts as custodian and confirms return and condition. HR proposes any lost/damaged-asset recovery; a Director approves; authorised payroll staff process it.

**Proposed:** maintain Asset, AssetAssignment, EmployeeAcknowledgement, ReturnInspection, Incident and RecoveryApproval histories. Use unique asset tags plus serial/IMEI/SIM identifiers where applicable. Configure categories, condition values and statuses such as available, assigned, repair, lost and retired.

Prevent overlapping active assignments. Reissue only after the prior return/transfer is recorded. Preserve acknowledgement time, actor, issued condition and returned condition. A disputed or missing acknowledgement creates an HR task rather than a fabricated signature.

Recovery is a separate approved financial workflow, not an automatic calculation from inventory status. Bind approval to incident, amount and reason; changes invalidate approval. Link a recovery to exactly one payroll/F&F adjustment and prevent duplicate collection. Approval alone does not mean it has been deducted or settled.

## 13. Employee exits and Phase 7 settlement

### Confirmed responsibilities

| Action | Initial rule |
|---|---|
| Resignation | Employee submits → manager recommends → HR processes → Director approves |
| Company-initiated exit | HR initiates → Director approves before it takes effect |
| Notice/last-working-day change | HR proposes → Director approves |
| Individual exit interview and detailed reason | HR and Directors only |
| Ordinary employee access | Ends after the approved last working day, even if clearance is unfinished |
| Remaining clearance | HR continues processing after access ends |
| Former employee documents | Requested from HR; no former-employee self-service or restricted alumni login |

**Proposed:** model ExitCase, ExitApproval, NoticeChange, ClearanceChecklist, ExitInterview and SettlementReference separately from general employee status. Store date/version changes, return tasks and reasons. Employee “alumni” is a lifecycle view, not permission to log in.

Notice duration, calculation method, recovery/buyout, waiver rules and required documents remain configurable; the PDF’s sample 30 days is not a confirmed policy. Withdrawal of resignation, changes after approval and special-case immediate exits need explicit routes before activation.

Create asset-return, handover and document tasks with named owners. Outstanding clearance must not keep ordinary access active beyond the approved date. Disable login, revoke refresh sessions and close/restrict sockets consistently. Use the approved HR access-end override procedure if one is later configured; no indefinite access by omission.

Call the Phase 7 F&F/off-cycle service for salary, leave encashment, approved notice/asset recoveries and other settlement inputs. Do not implement a second settlement calculator. Each input is traceable, approved and consumed once. Preserve maker/checker, payment/hold state and immutable payroll outputs.

Do not assume all outstanding clearance automatically blocks every payment or document. Define which checklist items are required for each transition and obtain the company’s approved settlement/document-release rules. HR verifies the recipient when supplying documents after access ends.

## 14. Recognition, avatars and directory

**Confirmed recognition:** HR and Directors award positive badges company-wide; managers award within their teams. Corrective nudges are visible only to the employee, reporting manager and HR.

**Proposed:** extend Engage where appropriate, while keeping a persistent BadgeAward lifecycle separate from a feed post. Configure catalogue, issuer limits, expiry, revocation and reason. The PDF’s sample “five per month” and weekly/monthly/permanent durations are not fixed accepted settings.

Do not automatically publish or generate corrective labels from attendance data. Corrective feedback must not appear beside names in directory, public profiles, birthday posts, company dashboards or email digests. The role allowed to issue corrective nudges remains open; positive-award authority does not settle that question. Badges do not alter pay or leave under the agreed scope.

For directory and avatars, use the existing employee identity and Figma-approved presentation. **Proposed defaults from the guide:** corporate email only in the public directory; no private mobile numbers; birthdays show day/month without year; employee selects their photo or an approved catalogue option. Birthday opt-out, photo moderation and exact artwork/catalogue are open configuration/design inputs. Do not copy sample avatar counts as implementation requirements without approved assets.

## 15. Unmute

**Confirmed:** hosts are specifically authorised people from any department. Booking visibility is limited to the employee and selected host. Store scheduling and completion status only; no conversation notes or recordings. Scheduling stays inside the portal initially.

**Proposed:** use HostAuthorisation, AvailabilitySlot and SessionBooking records. Store participants, slot, timezone, booking/cancellation/reschedule timestamps and completion status. Do not add a free-text conversation-topic field, session summary, transcript or AI analysis without a new explicit requirement.

Prevent concurrent bookings for the same host. Make cancellations and host changes explicit. Host-role removal must prevent new bookings and trigger a controlled reassignment/cancellation path for existing ones. Session length and windows are configurable; the PDF’s 20 minutes is an unconfirmed starting reference.

No HR/Director “view all sessions” list, employee-profile session marker, manager task, organisation-wide export or general analytics feed may expose bookings. Participant emails should use minimal, neutral content. Technical audit/access records also need narrow access and limited metadata; avoid accidentally building an administrative booking directory through logs.

The PDF mentions escalation of certain matters. Actual escalation recipients, grounds and process were not defined in this discussion. Do not claim absolute confidentiality beyond the stored-data design or create automatic content-based escalation when no content is stored. Any separately raised complaint uses the authorised complaint process.

## 16. Dashboards, tasks and notifications

**Confirmed:** HR and Directors see company-wide attendance/hiring/turnover dashboards; managers see their teams; employees see their own information. In-app and email are the initial notification channels.

**Proposed metric definitions for review:**

| Metric | Definition to document before use |
|---|---|
| Headcount | Active employment as of a selected date, with clear probation/notice inclusion |
| Present/late/on leave | Existing attendance/leave classification as of a defined workday; show pending/incomplete data |
| Late occasions | Separate all post-10:10 lates, allowance-qualifying occasions and immediate-penalty occasions |
| LOP days | Finalised combined deduction; do not add overlapping reason totals |
| Open hiring | Approved open vacancies; distinguish requisitions from available positions |
| Hiring funnel | Applications per agreed stage/time window; avoid counting one candidate as one application across all roles |
| Turnover | Exits over an explicitly stated headcount denominator and period |
| Early attrition | Configurable tenure threshold; the guide’s three-month example needs confirmation |
| Average tenure | Separate active employees’ current tenure from exited employees’ completed tenure |

Manager dashboard scope does not grant interview scores or detailed rejection reasons. Company dashboards must not reveal Unmute bookings, private nudges, medical evidence, individual exit interviews or salary beyond their specific permissions. Aggregate exit insights must avoid revealing a restricted individual through a tiny group.

Extend the existing source-based tasks inbox. Each item uses the underlying action’s live permission and state; a stale task cannot approve a revoked/changed object. Add due-date/checklist records only where the new workflow actually needs them, rather than copying every source object into a second task database.

Use durable notification events, deduplicated delivery, retries and authorised links. Recheck access when a user opens a notification. Do not email identity/bank documents, salary figures or confidential complaint detail to broad lists. Configure reminder/escalation timing and respect the participant-only Unmute rule. WhatsApp/SMS and external calendars are outside the initial launch.

## 17. Technical integration blueprint

These are **proposed implementation boundaries**, to adapt after Phase 7 acceptance.

| Existing area | How to integrate |
|---|---|
| `backend/src/modules/attendance` and `biometric` | Keep ingestion/day classification authoritative; add versioned lateness evaluation and durable recomputation |
| `backend/src/modules/leave` | Extend catalogue/routing and ledger behaviour; protect evidence separately |
| `backend/src/modules/employee` and `org` | Reuse identity, department and effective-dated reporting relationships; add idempotent joining/lifecycle integration |
| `backend/src/modules/documents` and storage integration | Private uploads, categories, sensitive downloads and accepted-document references |
| `backend/src/modules/helpdesk` | Extend routing/assignment/closure and restricted cases |
| `backend/src/modules/engage` | Reuse positive-recognition presentation where suitable; separate private feedback storage/access |
| `backend/src/modules/tasks` and `notifications` | Add source-backed actions and durable event delivery |
| `backend/src/modules/payroll` | Reuse approved adjustments, attendance reader, locks, output permissions and Phase 7 settlement |
| New recruitment/assets/exits/Unmute/autofill domains | Own their workflow state; reference existing employee/document/payroll IDs |
| `shared` | Typed API contracts, permissions, statuses, policy validation and safe public DTOs |
| `frontend` | Figma-based views over existing services; one authentication/session model and permission-aware navigation |

### Data and workflow rules

- Use database constraints and transactions for one active asset assignment, one candidate conversion, unique application/offer versions, protected policy ranges and idempotent financial adjustments.
- Store approval state with the exact version/content approved. Concurrent edits or changed amounts/dates cannot inherit an old approval.
- Effective-date organisational/policy changes; retain immutable event/history records. Distinguish an event’s business date from when the system received it.
- Use a transactional outbox or equivalent durable mechanism for DB-to-queue handoffs: recomputation, emails, extraction jobs and access revocation must recover after process crashes.
- Keep ordinary audit entries useful without logging tokens, document text, bank fields or conversation content. Log safe object references, actor, action and outcome.
- Reuse current password/invitation/reset/2FA. The PDF’s example PIN is not approval to replace authentication.
- Treat cache invalidation and sockets as data delivery only, never an authorisation source. Recheck scope for room membership/events and revoke stale sessions.
- Maintain backwards-compatible API/database changes until the coordinated release is ready. Feature flags can support staging/internal development but do not imply early company rollout.

### Figma and mobile handoff

Obtain the approved Figma file, desktop/mobile frames, components, branding, interaction states and accessibility expectations. Map each frame to a real endpoint, permission, loading/empty/error state and actionable task.

Cover employee, manager, HR, Director and payroll views; candidate upload/review; mobile interview feedback, asset acknowledgement and exit forms; light/dark states; keyboard access and readable tables. Preserve page deep links where practical or provide redirects. Do not ship sample data, disabled buttons or decorative metrics as completed features.

PWA installation is part of scope, but offline payroll/document access is not implied. **Proposed:** avoid caching private API responses and sensitive downloads in service-worker caches; define session-expiry behaviour and safe notification previews.

## 18. Imports and data migration

**Confirmed:** HR-reviewed spreadsheet imports plus manual entry for recruitment, assets and unfinished exits. Preserve existing employee/payroll history.

**Proposed sequence:**

1. Inventory source files and agree data owners, stable identifiers and the required history window.
2. Provide versioned templates for vacancies/applications, assets/assignments and active exit cases. Never treat sample PDF screenshots as employee data.
3. Upload privately; validate rows, references, duplicates, dates, sensitive columns and approval state in a staging area.
4. Show a dry-run summary: creates, links, updates, rejected rows and conflicts. HR reviews before commit; salary/bank values require their authorised reviewer.
5. Commit in a transaction/bounded batches with an import batch ID, row-level outcomes and idempotency keys. Retrying a batch cannot duplicate assets, candidates, exits or financial recoveries.
6. Reconcile totals and spot-check source-to-portal records. Link to existing employees without changing immutable payroll/attendance history.
7. Retain provenance and safe rollback/compensating actions. An imported “approved” text value cannot invent a Director’s approval; attach authorised evidence or send it through the approval workflow.

Unfinished exits need current stage, approved last working day, access-end state, outstanding assets and settlement references. Do not re-enable former employees during import. Existing asset allocations need either acknowledgement evidence or a visible pending acknowledgement, not a fabricated timestamp.

## 19. Internal implementation order — one production launch

The following work packages are **proposed engineering sequencing**. They do not replace the confirmed single-launch model.

| Package | Deliverable | Dependency / acceptance evidence |
|---|---|---|
| 0. Core closure | Complete Phase 7, review findings, core HR acceptance and baseline commit | Gate A met before Peeps implementation |
| 1. Contracts and design | Figma mapping, capability model, confidentiality matrix, policy/version foundation and event contracts | Approved contracts and role tests; extraction-provider evaluation can proceed here |
| 2. Attendance and leave | Revised lateness, waivers, explanations, new leave configurations/routes and protected evidence | Boundary/replay/LOP tests; no changed finalised history |
| 3. Recruitment and documents | Vacancy/referral/interview/offer/joining workflows, private links and resume/identity/bank autofill | Director gates, sensitive review, idempotent conversion and extraction acceptance |
| 4. Assets and exits | Inventory/acknowledgement, returns/recoveries, exit workflow and Phase 7 settlement link | Director approvals, no duplicate deductions, access expiry despite pending clearance |
| 5. Experience and service workflows | Ticket changes, badges/private nudges, Unmute, directory/avatars, tasks and Figma screens | Restricted-data tests and complete mobile workflows |
| 6. Insights and notifications | Scoped metrics, payroll overview, email/in-app events and operational views | Defined calculations; no confidential payload leaks |
| 7. Migration and release validation | Import rehearsals, end-to-end UAT, production/device checks, training and release/rollback rehearsal | All scope complete; Gate C signed for the coordinated launch |

Validate incrementally in development/staging; final acceptance covers cross-module scenarios across the whole release. Do not defer broken cross-module behaviour until after launch merely because individual screens pass.

No reliable delivery estimate is set here. Estimate after Figma scope, provider choice, final core APIs and acceptance fixtures are available. Track dependencies rather than promising a date from the number of screens.

## 20. Acceptance and regression checklist

The following are **proposed minimum acceptance scenarios**; HR should approve expected results using representative, non-public fixtures.

| ID | Scenario | Required result |
|---|---|---|
| ATT-01 | 10:10, just after 10:10, 10:20, just after 10:20, 10:30, just after 10:30 | Correct boundaries once precision is configured |
| ATT-02 | First through fifth qualifying arrivals in one month | First three allowed; fourth/fifth each 0.5 day LOP |
| ATT-03 | 10:15 lates mixed with 10:35 arrivals | Neither consumes a qualifying allowance; post-10:30 penalties still apply |
| ATT-04 | Late + low hours same day | Higher deduction only; leave balance unchanged |
| ATT-05 | Backdated corrected punch changes earlier occasion | Later open-day results recompute deterministically; closed periods protected |
| ATT-06 | Manager requests waiver; HR rejects/approves | No removal before approval; correct approved reason/audit and allowance treatment |
| ATT-07 | Crash after raw insert before queue enqueue, then duplicate retry | Eventual recomputation without a duplicate punch or lost day |
| LEV-01 | Annual Leave / PL rename and policy display | Same ledger/balance; no duplicate accrual |
| LEV-02 | New leave type missing quota/routing | Visible configuration error; not activated with guessed defaults |
| LEV-03 | Manager reads request, attachment API, export, task and email | Type/dates visible; medical evidence unavailable |
| POL-01 | HR edits policy and Director approves, then draft changes | Approval bound to exact version; historical runs unchanged |
| REC-01 | Vacancy requested but not approved | Cannot open or advertise it as open |
| REC-02 | Referrer searches/opens candidate endpoints | Basic own-referral status only; no scores/pay/rejection details |
| REC-03 | Interviewer requests another round’s feedback | Denied, including via export, aggregation or guessable IDs |
| REC-04 | Offer changed after Director approval | Reapproval required before issue |
| REC-05 | Candidate link expired/revoked or scoped to another candidate | Access/upload denied without exposing other documents |
| REC-06 | Joining documents incomplete; no approved exception | Activation blocked; exception records preserve missing-item truth |
| REC-07 | Offer accepted/planned date passes; HR has not confirmed joining | No active employee portal access |
| REC-08 | HR repeats actual-joining conversion | One employee and one valid activation path |
| OCR-01 | Good, blurred, unsupported and partially readable files in all three classes | Reviewable suggestions/errors; no silent acceptance |
| OCR-02 | Resume reviewer accesses bank/ID results | Sensitive results denied without corresponding authority |
| OCR-03 | Retry extraction after reviewer correction | No duplicate object or overwrite of accepted data |
| TKT-01 | Ordinary ticket submitted/assigned/closed/reopened | HR intake; assigned handler closure; requester reopening works |
| TKT-02 | Manager/listener/export reads confidential ticket | Denied; no leaked subject, count or attachment |
| AST-01 | Asset issue and acknowledgement; attempted overlapping issue | Correct receipt/history; conflicting assignment blocked |
| AST-02 | Lost asset without approved recovery | No payroll deduction |
| AST-03 | Approved recovery retried in payroll/F&F | Exactly one authorised adjustment, traceable to approval |
| EXT-01 | Resignation or company exit without Director approval | Cannot take the approved-exit transition |
| EXT-02 | Last working day changed after approval | HR proposal and Director reapproval required |
| EXT-03 | Last working day passes with unreturned asset | Ordinary access ends; HR clearance remains available |
| EXT-04 | Former employee tries existing session/refresh/socket | No ordinary access; HR supplies requested own documents through the agreed process |
| EXT-05 | Manager opens individual exit-interview detail | Denied; only HR and Directors allowed |
| BAD-01 | Manager awards outside their team | Denied; allowed team awards retain history |
| BAD-02 | Corrective nudge appears in public directory/feed/export | Must never occur |
| UNM-01 | Another host, HR or Director lists someone else’s booking | Denied unless that person is the selected participant |
| UNM-02 | Inspect storage, APIs, queues and audit payloads | Scheduling/completion only; no conversation notes/recordings |
| UNM-03 | Two users reserve the same host slot concurrently | At most one booking succeeds |
| INS-01 | Employee/manager/HR dashboards with identical filters | Own/team/company scopes respectively; other restrictions still apply |
| IMP-01 | Dry-run import, correct errors, commit and retry | Reviewed counts reconcile; no duplicates or fabricated approvals |
| SEC-01 | Token expiry/reconnect, role removal and exit revocation | REST and sockets enforce current authority |
| SEC-02 | Log scan across uploads/extraction/invitations/errors | No secret tokens, raw identifiers, bank details or document text |
| UX-01 | Full workflows on phone, desktop, keyboard and both themes | Approved Figma behaviour, usable validation and no dead-end actions |
| OPS-01 | Worker/scheduler restart, queue outage and email/provider failure | Recoverable jobs, accurate status and no duplicate action |

Add real-device recovery/timezone fixtures, payroll comparison fixtures, notification audience tests and production restore/cutover rehearsals. Keep tests focused on business invariants and failure cases rather than duplicating component implementation.

## 21. Open inputs and decisions before launch

The requirements interview establishes the structure. The following are deliberately unresolved, not silently approved defaults.

| Input | Owner to nominate | Needed by |
|---|---|---|
| Approved Figma URL, frame list, assets and interaction states | Product/design | Detailed UI implementation |
| Director accounts, substitutes and conflict/self-approval handling | Business owner | Approval capability configuration |
| New leave quotas, eligibility, paid/unpaid status, evidence and initial routes | HR with Director approval | Leave activation |
| Lateness edge settings: waiver allowance restoration, precision, partial-day arrangements and mid-month version changes | HR with Director approval | Lateness activation |
| Missing-manager fallback for waiver/resignation/recommendation tasks | HR/business owner | Workflow activation |
| Mandatory joining documents, exception approver and non-waivable items | HR/business owner | Joining activation |
| Extraction provider, supported identity/bank documents, field mapping, retention/hosting and acceptance samples | Technical owner plus authorised data owners | Autofill implementation and launch |
| Who may prepare compensation fields and issue approved offers | Business/payroll owner | Offer workflow activation |
| Candidate/document retention, archive/deletion and reapplication rules | HR/data owner | Recruitment launch |
| Confidential-complaint conflicts and escalation process | HR/Directors | Helpdesk activation |
| Ticket category/assignee lists, reopen window and escalation targets | HR | Helpdesk activation |
| Notice duration, exit withdrawal, clearance/settlement/document-release rules | HR/business owner | Exit activation |
| Corrective-nudge issuers, badge catalogue/limits/durations and revocation | HR/business owner | Recognition activation |
| Unmute hosts, session windows/length and any separately governed escalation process | Business owner | Unmute activation |
| Birthday/avatar preferences and approved media | HR/design | Directory/profile launch |
| Metric definitions, early-attrition threshold and small-group privacy treatment | HR/Directors | Insights acceptance |
| Source spreadsheets, migration history window and reconciliation totals | HR/data owners | Import rehearsal |
| Final production infrastructure, device, payroll samples and operational acceptance | Technical/HR/payroll owners | Company-wide launch |

These do not require another long interview now. Fill them through configuration/design workshops as the corresponding package approaches, and record any change to confirmed scope explicitly.

## 22. Launch record

Use one release checklist containing the exact release commit, applied migrations, approved policy versions, configured capabilities, validated imports, Figma acceptance, extraction-provider acceptance, device evidence, end-to-end UAT results, sensitive-data checks, backup/restore evidence, support ownership and rollback plan.

**Required business outcome:** one coordinated company-wide launch after all agreed integration features are complete. Existing employee, attendance, leave and payroll history remains intact. Directors approve the defined business decisions; sensitive data stays within its agreed audience; every pay-affecting event can be explained and traced.

## Appendix A. Repository evidence links

Links below are pinned to the reviewed main commit, so future edits do not silently change the review evidence.

- [Project specification](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/docs/PROJECT_SPEC.md), [progress ledger](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/docs/PROGRESS.md), [sensitive data](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/docs/SENSITIVE_DATA.md).
- [Phase 2 acceptance](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/docs/plans/PHASE_2_ACCEPTANCE.md), [Phase 5 review](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/docs/plans/PHASE_5_REVIEW.md), [Phase 6 review](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/docs/plans/PHASE_6_REVIEW.md).
- [Attendance ingestion](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/backend/src/modules/biometric/ingestion.ts), [request logging](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/backend/src/app.ts), [frontend socket provider](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/frontend/src/sockets/SocketProvider.tsx).
- [Payroll setup status](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/backend/src/modules/payroll/setup/status.ts), [setup signoffs](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/backend/src/modules/payroll/setup/signoffs.ts), [payroll run service](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/backend/src/modules/payroll/run/service.ts).
- [Existing tasks inbox](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/backend/src/modules/tasks/service.ts), [helpdesk service](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/backend/src/modules/helpdesk/service.ts), [database schema](https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/blob/6bd738600f19cad195d39269b6d676283e45fd5c/backend/prisma/schema.prisma).

**Handoff instruction:** treat this guide as the requirements baseline. First close and obtain HR acceptance for the core including Phase 7. Then reconcile this guide against that accepted commit, resolve each package’s open inputs, implement within the existing architecture, and prove the acceptance scenarios before the single launch.
