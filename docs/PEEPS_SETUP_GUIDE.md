# Peeps setup guide (for the owners)

What has to be chosen before each Peeps module works for the real company, who chooses it, what it needs, and in what order;
and every default that ships, so you can review it. Written at the end of Peeps Stage 3 (2026-11-13). The demo company carries
made-up values labelled DEMO for all of these; nothing below is preset for the real company unless it says **Default**.

How a setting changes: a director (or, for some working values, a Wellsure Office member you allowed to prepare settings)
enters a value; a **different** director confirms it; only then is it used. A value waiting for confirmation can be withdrawn
by the person who entered it or by a director. Every entry, confirmation and withdrawal is in the audit log.

- **Not set**: nothing is used; the module (or just that step) refuses and names what is missing.
- **Default, change in settings**: a conventional starting value is in use until a director confirms another.

---

## 1. Order to set things up

1. **Wellsure Office members** (directors). Appoint the people who run the Office and tick what each may do. Who: the two
   directors (one proposes, the other confirms). Needs: the person's name; the capabilities.
2. **Audiences** (directors): `Asset register audience`, `Unmute audience`, the recruitment and exits Office audiences, and
   whether HR runs recruitment (off by default). These decide who can use each module.
3. **Lists and rules each module needs** (sections 2 and 3 below), module by module, in the order you want to switch them on.
4. **Pay-related, statutory and retention values** last, with care: they have no defaults on purpose.

## 2. Settings left Not set (each refuses until chosen)

| Module | Setting | Who sets it | What it needs | Refuses until set |
|---|---|---|---|---|
| Workspace | Wellsure Office members | Directors | People and their capabilities | Nobody is in the Office |
| Assets | Asset categories, statuses, conditions | HR Admin, a director or a member allowed; a director confirms | The three lists (a status says whether an asset in it can be issued) | Adding or issuing assets; **employees' asset requests** |
| Assets | Asset register audience | Directors | Whether Office members also run the register | Office members (HR and directors run it) |
| Unmute | Audience, session length, availability window, booking window, booking notice, cancellation notice | Directors (audience); directors or a member allowed (times) | Yes/no; minutes; days and hours; days; hours; hours | Booking |
| Unmute | Hosts | Directors | The people who host | Booking |
| Directory | Contact fields in the directory | Directors | Which of work email, phone, birthday colleagues see | None shown |
| Leave | Wedding and bereavement leave named on team calendars; menstrual and medical leave named to managers | Directors | Yes/no each | Shown as "Leave" |
| Leave | Every rule of the four new leave types | HR prepares; a different director approves | Quotas, eligibility, counting, documents | The type cannot be applied for |
| Recruitment | Sources, retention, scorecard, rejection reasons, e-mail templates, CV file rules, requisition approval route, Office audience | Directors | Each list or period | The step that needs it |
| Recruitment | Joiner link lifetime, required joiner document types, joining exception approver | Directors | Hours/days; document types; a person or role | Sending joiner links |
| Offers | Offer pay and anything about pay, bank, statutory or tax | Directors only | The values for each offer | That offer |
| Exits | Notice rules, rejection, reason categories, checklist and owners, interview questions, retention, overdue thresholds, Office audience, exit approval | Directors | Each list, rule or period | The exit step that needs it |
| Insights | Reporting window, minimum group size, early-attrition threshold, turnover, tenure, exit-reason and hiring-funnel definitions | Directors | Each value | Insights shows nothing and names the missing setting |
| Autofill | Retention of uploaded documents | Directors | Days | Uploading |
| Helpdesk | The audience of each new category | Directors | Who handles it | That category's tickets |

Lists that could take a conventional default if you want one (they are still Not set; tell us and they will ship as defaults):
asset categories/statuses/conditions, recruitment sources and rejection reasons, exit reason categories and checklist.

## 3. Defaults shipped (Default, change in settings)

| Module | Setting | Default |
|---|---|---|
| Workspace | Workspace name | Wellsure Office |
| Badges | Catalogue (12) | Launch Star (month), Target Crusher (month), On Fire (week), Team Player (month), Quick Learner (month), Mentor (permanent), Lifesaver (week), Idea Spark (month), Star of the Month (month), Culture Champ (permanent), Customer Hero (month), Problem Solver (week) |
| Badges | Limits | 5 badges a calendar month per giver; 1 a month from the same giver to the same person |
| Badges | Repeat to the same person | Allowed (the pair limit still applies) |
| Badges | No manager on record | May give up to the directors |
| Badges | Who gave it and why, in public | Shown (the recipient and the directors always see both) |
| Nudges | Tags | Chai Break Champ, Scroll Master, Snooze Mode, Meeting Marathoner, Coffee Refill Crew, Playlist DJ, Emoji Enthusiast, Desk Plant Parent |
| Nudges | Off-limits words | 35 words about attendance, time, leave, missed work, performance and discipline (late, absent, leave, early, attendance, missed, lazy, performance, warning, sick, overtime …) |
| Recruitment | Hiring stages | Screening, Interview, Offer, Hired, Not moving forward |
| Recruitment | Interview rounds | Screening call, Technical interview, Hiring manager interview, Final interview |
| Recruitment | Offer approval; referrals | Off |
| Recruitment | HR runs onboarding | On |
| Autofill | File types and size | PDF, PNG, JPEG; 10 MB |

Rules that are fixed (not settings): a badge always needs a reason; badges follow the reporting line (down to anyone below,
up to your manager and on to the directors; directors to anyone; never sideways, never yourself); weekly and monthly badges end
when the India-time week (Monday to Sunday) or month ends; a nudge shows for 7 days; only a director gives or removes a nudge;
nudges are never created by the system from attendance, leave, lateness, performance or anything else.

## 4. What changed in Stage 3 that you should know

- The old **private corrective notes** are read-only: the existing ones stay visible to the person they concern and the
  directors (each director open is audited); no new note can be sent. The settings that controlled them were retired.
- The Office "Give badges" widening was retired: Office members give along their own reporting line like everyone else.
- Employees can now **ask for an asset**; HR and the directors approve, decline or mark it fulfilled.
- A pending setting or Office membership change can be **withdrawn** before it is confirmed.
- The other director is notified when a setting or membership change waits for their confirmation.
