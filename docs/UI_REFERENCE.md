# UI Reference — current greytHR screens

A written description of greytHR's current screens, captured because
employees and HR are used to that layout and our portal should feel
familiar: same structure, same navigation, same information on each
screen. This is a **layout/information reference only**.

**Hard constraint:** use our own colours, logo and Ant Design components.
Do **not** copy greytHR branding, logos, illustrations, quotes or text.
Where greytHR uses illustrations, use simple icons or empty-state
components instead. Anywhere below that names a specific greytHR product
plug (e.g. their finance product ad, their product-news feed) is called
out with what we replace it with.

Applies starting with the Phase 0 Vite/AntD shell (routing, layout
skeleton) and fully from Phase 5 (Homepage, dashboards, Engage,
notifications, Document Center, People, Helpdesk, Request Hub, Workflow
Delegates — see `PROJECT_SPEC.md` §12). Don't build screens ahead of their
phase just because the layout is described here.

## General visual style

- Very light grey page background, white cards with thin light borders and
  small rounded corners, lots of whitespace.
- Primary accent is a medium blue (buttons, active menu items, links).
  Positive money values in green. Absent/problem states in soft
  orange/red.
- Small, clean sans-serif typography. Page title at top-left in the
  header.
- Desktop-first layout at 1920px wide, but ours must also work on mobile
  (see spec §13 Definition of Done — responsive on mobile width).

---

## PART 1 — EMPLOYEE PORTAL

### 1.0 Common layout (all employee pages)

**Left sidebar** (~180px wide, white):

- Top: company logo.
- Profile block: round avatar, "Hi \<First name\>", link "View My Info"
  under it, small settings (gear) icon on the right.
- Menu with an icon on each item. Groups have a chevron and expand to
  show sub-items (indented, with a thin vertical line on the left). The
  active item has a light-blue background and a blue bar on the left
  edge.
- Menu items in order:
  - Home
  - Engage
  - My Worklife → Kudos, Feedback
  - To do → Tasks, Review
  - Salary → Payslips, YTD Reports, IT Statement, IT Declaration, Loans
    and Advances, Reimbursement, Proof Of Investment, Salary Revision
  - Leave → Leave Apply, Leave Balances, Leave Calendar, Holiday Calendar
  - Attendance → Attendance Info
  - Document Center
  - People
  - Helpdesk
  - Request Hub
  - Workflow Delegates

**Top header** (inside content area):

- Left: small decorative shape + current page title (e.g. "Home",
  "Payslips", "Leave Balances", "Attendance Info").
- Right: "Quick Links" dropdown, notification bell (red dot badge when
  unread), power/logout icon.

**Footer** (centred, small grey text): build/version number | Privacy
Policy | Terms Of Service.

### 1.1 Home

- Large greeting that changes with time of day ("Good Morning / Afternoon
  / Evening"), with a short motivational quote and author below it (use
  our own quote list). A decorative illustration sits on the right of the
  greeting area (use a simple graphic or leave space).
- A promotional banner strip in the middle (in greytHR it advertises
  their own finance product) — **ours: replace with a company
  announcement banner** (title, short text, optional button), managed by
  HR.
- A grid of cards below:
  1. **Review** — pending approvals for this user (as a manager). Empty
     state: "Nothing to review" with an icon.
  2. **Upcoming Holidays** — next 2–3 holidays: date (e.g. "08 Nov"),
     weekday, holiday name. Arrow icon at top-right links to Holiday
     Calendar.
  3. **Track** — the user's own pending requests (leave, regularization,
     etc.). Empty state: "Nothing new to track".
  4. **Payslip** — latest payroll month (e.g. "Aug 2026"), a donut chart,
     "Paid Days" count (e.g. 19). Below: Gross Pay, Deduction, Net Pay
     with amounts masked as ***** until the user clicks "Show Salary".
     Links: "Download" (PDF) and "Show Salary". Arrow at top-right links
     to Payslips.
  5. **Quick Access** — list of links: Reimbursement Payslip, IT
     Statement, YTD Reports, Loan Statement; with a small tinted note on
     the right explaining quick access.
  6. **IT Declaration** — status message, e.g. "You can submit your
     Income Tax declaration once released."
  7. **POI (Proof of Investment)** — status message, e.g. "You can submit
     your Proof of Investments once released."

### 1.2 Engage (social feed)

- Top card: circular initials avatar, "Hey \<name\>, Ready to dive in?",
  and two action tiles: **Give Kudos** and **Create Polls**.
- Left column **Filters** panel:
  - Activities (radio): All Activities, Kudos, Polls, Posts
  - Search box
  - Collapsible filters: Groups, Location, Department
- Main column: heading "All Activities - All Groups" and "Sort: Newest
  first" dropdown on the right.
- Feed cards, each with: company logo/avatar, relative time ("a day ago")
  top-right, "Group: Events", an illustration on the left, message text
  on the right, the person's avatar and a bold headline. Footer:
  "Reaction" button (emoji reactions).
- Auto-generated post examples seen:
  - New joiner: "\<Name\> has joined us in the company on 12 Sep 2026.
    Please join us in welcoming our newest team member." Headline:
    "\<Name\> just joined us!"
  - Work anniversary: "Our congratulations to \<name\> on completing 2
    successful year(s)." Headline: "Congratulations, \<name\>!"
  - (Birthdays follow the same pattern.)
- Must update in real time (see spec §8, `engage.post` / `engage.kudos` /
  `engage.reaction` / `engage.birthday` / `engage.joining` /
  `engage.anniversary` events).

### 1.3 Salary → Payslips

- Centred toggle tabs: Payslip | Reimb. Payslip.
- Top-right: download button (blue, icon) and a month selector dropdown
  (e.g. "Aug 2026").
- Three columns:
  - **Earnings** table: header row "Amount in (₹)"; rows e.g. BASIC
    3,432.00, HRA 1,373.00, SPECIAL ALLOWANCE 3,775.00; Total 8,580.00.
  - **Deductions** table: same format; empty state "No Deductions For
    this month"; Total 0.00.
  - **Employee details** panel with an "Info" link: "Net Pay for Aug
    2026", amount in large green text (₹8,580.00), and the amount in
    words ("Rupees Eight Thousand Five Hundred Eighty Only").

### 1.4 Leave → Leave Balances

- Top-right: Apply button (outlined), download button, year selector
  (e.g. 2026).
- One card per leave type in a row. Each card: leave type name top-left,
  "Granted: N" top-right, large balance number in the centre, "Balance"
  label under it.
- Leave types seen: Loss Of Pay, Comp - Off, Work From Home (plus PL / RH
  per spec §5.1).

### 1.5 Attendance → Attendance Info

- Top-right: My Regularizations button.
- Centre-top: exception banner, e.g. "⚠ 20 exception day(s)" with a
  Regularize link.
- Stats cards row: AVG. WORK HRS (08:27, with "-6% From July" in small
  red), AVG. ACTUAL WORK HRS (08:27, same comparison), PENALTY DAYS (0),
  and a "+3 INSIGHTS" link.
- Grid/list view toggle on the right.
- Month calendar (left, ~60% width): "< Prev August 2026 Next >". Columns
  Sun–Sat. Each day cell shows:
  - date number top-left
  - status code in the centre: `P` (present), `A` (absent, red), `A:P`
    (first half absent, second half present), `O` (week-off), `H`
    (holiday)
  - shift code bottom-right ("GEN")
  - small icons top-right: edit/regularize icon, calendar icon (leave
    apply)
  - background colour by status: light green = present, light
    orange/peach = absent/exception, light blue = holiday, white/grey =
    week-off; selected day has an outline
- Day detail panel (right, opens when a day is clicked, "Hide" link):
  - Yellow alert box with the day and exception, e.g. "Half Day Minimum
    Hours — Half day minimum hours is not fulfilled and so, 1 day(s) of
    LOP will be deducted."
  - Shift block: date + weekday, shift name "General Shift(GEN)",
    "Shift: 10:00 to 19:00", attendance scheme name "General Biometrics
    Scheme", and "Processed on 11th Sep at 15:29".
  - Table with columns: First In, Last Out, Late In, Early Out, Total
    Work Hrs, Break Hrs, Actual Work Hrs, Work Hours in Shift Time,
    Shortfall Hrs, Excess Hrs (example: 10:00, 19:00, -, -, 09:00, -,
    09:00, 09:00, 08:59, -).
  - Status Details: Status (e.g. Override), Remarks, Info link.
  - Session Details: Session, Session Timing, First In, Last Out (for
    first half / second half).
- **In our portal this page must update in real time when a new punch
  arrives** (see spec §4.3, `attendance.updated` event).

---

## PART 2 — HR / ADMIN PORTAL

### 2.0 Common layout (all admin pages)

- No left sidebar. Top bar instead:
  - Far left: 3×3 grid icon = app switcher; then company logo.
  - After choosing an app, its name appears as a highlighted pill (e.g.
    "Workforce Management") followed by that app's dropdown menus (e.g.
    "Leave ▾", "Attendance ▾", "Admin Tools ▾").
  - Far right: user avatar, search icon, settings gear with dropdown,
    power/logout icon.
- App switcher panel ("Your Apps"), each with a coloured icon: Homepage,
  Employee, Workforce Management (sub-label "Formerly Leave &
  Attendance"), Assets Management, Tasks, Workflow, Reports, Engage. (We
  also add **Payroll** and **Admin Tools** per spec.)
- Under the top bar on inner pages: breadcrumb ("Home > Workforce
  Management").
- Right side of the page header on inner pages: Payroll Month selector
  (calendar icon, e.g. "Payroll Month: Aug'26 ▾"), employee filter
  (people icon, "All ▾"), and a history/clock icon.
- A dismissible help strip at the top of many pages (light cyan
  background) explaining the page, with "Hide Help" on the right.

### 2.1 Homepage → Welcome tab

- Centred pill toggle: Welcome | Dashboard.
- Greeting ("Good Afternoon,") with a short tagline, decorative
  illustration on the right.
- **My Favourites**: tiles for shortcuts; a "+" tile to add one; example
  tile "Add Employee" with an icon.
- **My Tasks**: left side shows two big counters — "0 Things to review"
  and "232 Things to monitor". Right side lists task types with counts
  and a Monitor link each:
  - Attendance Regularization — "182 tasks pending for others' review"
  - Leave — "50 tasks pending for others' review"
- **Latest Updates** (right column): list of dated items (date + title).
  In greytHR these are their product news; **ours: HR
  announcements / system updates**.
- Help Links row at the bottom (pill buttons) — **ours: links to our
  internal help docs/policies**.

### 2.2 Homepage → Dashboard tab

- Edit button top-right (to add/remove/rearrange widgets).
- 2×2 grid of chart widgets, each with a blue bold title:
  1. **Years In Service Distribution** — line chart; x-axis buckets <1,
     1-2, 2-3, 3-4, 4-5, 5-6, 6-7, 7-8, 9-10, >10 years; y-axis employee
     count; data labels on points (e.g. 82, 23, 18, 7, 9, 6, 4, 3, 3).
  2. **Additions & Attrition** — subtitle with date range
     ("October-2025 to September-2026"); two-line chart by month (Joined
     in teal, Resigned in red), legend at bottom, data labels.
  3. **Employee Count By Location** — horizontal bar chart; locations
     e.g. B-22 Panchsheel (1), B-22 Panchsheel variant (18),
     SPN-Panchsheel (27), Ajmer (45), C-10 Panchsheel (60). *(Note the
     duplicate/typo location names — our import should detect and let HR
     merge such duplicates; see spec §10 reconciliation report.)*
  4. **Age Distribution** — line chart; buckets <20, 20-25, 25-30, 30-35,
     35-40, >50; data labels.

### 2.3 Workforce Management → Overview page (default landing)

- Help strip explaining the page summarises leave usage patterns.
- Year range selector top-right ("Jan 2026 - Dec 2026").
- Month strip: Jan…Dec 2026 as clickable tiles; selected month
  (Sep 2026) highlighted in solid blue.
- Section band with selected month name ("September 2026").
- **Type of leaves taken** card: donut chart with total in the centre
  ("28.5 Leaves taken"), legend with counts per type: LOP 7.5, COF 00, PL
  18.5, WFH 2.5, RH 00. "Category: All ▾" filter top-right.
- **Total leaves taken this year**: vertical bar chart by month
  (different colour per bar), "Category: All ▾" filter.
- **Number of Employees on Leave for each RH**: chart area with empty
  state "No records found", "Category: All ▾" filter.

### 2.4 Workforce Management → Leave menu

Dropdown items:

- Leave Calendar — org-wide calendar of who is on leave.
- Employee Leave — all leave requests/transactions, search and act on
  them.
- Leave Granter — bulk grant/debit leave.
- Year End Process — close the leave year (our rule: encash remaining
  PL, see spec §5.2).
- Leave Recalculator — recompute balances after policy/data changes.

### 2.5 Workforce Management → Attendance menu

Dropdown items:

- Who Is In? — live board of who's present now.
- Shift Roster — assign shifts.
- Employee Swipes — raw punch log from the machine.
- Attendance Muster — month grid of all employees × days.
- Attendance Info — one employee's calendar (same as employee view, for
  any employee).
- Process Attendance — run attendance processing for a period.
- Attendance Period Finalisation — lock a month for payroll.
- Attendance Exception — list of exception days.
- Manual Override — HR sets a day's status manually.
- Shift Override — change shift for specific dates.

### 2.6 Admin Tools menu

Present in the top bar (items not captured in screenshots). Use the list
in `PROJECT_SPEC.md` §7.8.

---

## PART 3 — What we do differently from greytHR

- **Real-time everywhere**: punches, attendance calendar, Who Is In?,
  task counts, Engage feed, notifications update live without refresh.
  In greytHR, attendance data only arrives when HR triggers a sync,
  usually at month end.
- **Our own branding**, announcement banner instead of product ads, our
  own help links.
- **Mobile-friendly layouts** for every employee page.

---

## PART 4 — EMPLOYEE MOBILE APP

Written from the four greytHR mobile screenshots in `docs/screenshots/`
(`mobile-action.jpeg`, `mobile-explore-1.jpeg`, `mobile-explore-2.jpeg`,
`mobile-engage.jpeg`). There is no Home-tab screenshot. The same hard
constraint applies: layout and information only. Their illustrations,
colours and wording are not copied; we use our own icons, palette and
copy. The Engage screenshot shows real employees' posts; none of that
content belongs in this repo or the seed.

### 4.0 Frame: a four-tab bottom bar

- **Phones only.** At phone widths the employee portal has **no sidebar
  and no hamburger drawer**. A **bottom tab bar** with four equal tabs,
  each an outline icon over a small label, replaces them:
  1. **Home**
  2. **Action**: a lightning-bolt icon in greytHR
  3. **Explore**: a 2×2-squares grid icon
  4. **Engage**: a broadcast/signal icon
- **Look.** The active tab's icon and label are in the accent blue;
  inactive ones are light grey. The bar is white, fixed to the bottom,
  above the phone's home indicator (safe area).
- **Header.** Each tab's screen has a plain white header with a large
  left-aligned title ("Actions", "Explore", "Engage") on a light-grey page
  background.
- **Inner pages.** Opening something from Action or Explore shows that
  feature's normal page. The bottom bar stays visible, with the tab you
  came from still active.

### 4.1 Action tab: quick actions

- A vertical list of **full-width white rounded cards**. Each has a
  square tinted icon tile on the left and a label on the right. Tapping
  the card opens the feature; there are no chevrons or subtitles.
- **Icon tiles are tinted by area:** lavender for attendance items, pale
  teal for leave, pale peach for salary.
- **greytHR's order:**
  - Apply Regularization
  - Attendance Info
  - Apply Leave
  - Leave Balance
  - Holiday Calendar
  - Payslips
  - YTD Reports
  - IT Statement
  - more below the fold (the list scrolls)
- **Purpose.** These are the handful of things people do most, flattened
  out of their sections.

### 4.2 Explore tab: every section, as cards

- A vertical stack of **large coloured cards**, one per section. Each has
  the section name in large bold type, a one-line description below, and
  an illustration on the right (ours: an icon, never an illustration).
- **Sections with sub-pages** have a **chevron** after the name and
  **expand in place** to list their pages. Single-page sections have no
  chevron and open directly.
- **greytHR's order and descriptions** (paraphrased):

  | Section | Description |
  |---|---|
  | Attendance | manage your attendance |
  | Leave | check and apply for leave |
  | Salary | your salary breakdown |
  | My Worklife | collaborate, learn and grow together |
  | People | personal info and workmates |
  | To Do | review pending items |
  | Helpdesk | request assistance (no chevron) |
  | Documents | check or request documents (no chevron) |

- **Each card has its own pastel background:** lavender, light cyan,
  peach, mint, pink and so on.
- **Purpose.** Explore is the mobile equivalent of the desktop sidebar:
  everything is reachable from here.

### 4.3 Engage tab

- **The same feed as desktop Engage**, single column:
  - filter pills: "Activity: All Activities ›" and "Group: All Groups ›";
  - a "Sort: Newest post ⌄" control;
  - then post cards (author/company avatar, relative time "1 day ago",
    the post text, a media or celebration block, a "React" action).
- **Celebration posts** show a large initials avatar on a tinted band,
  the occasion ("Happy Birthday!") and the person's name.
- **Creating a post** is a floating **"+ Create"** pill button at the
  bottom right, above the tab bar.

### 4.4 Home tab

- No screenshot. Ours shows the existing Employee Home (spec §6),
  single column on a phone.

### 4.5 How we build it (Phase 5 commit G)

- **One source of truth.** The tabs and both tab contents are generated
  from `frontend/src/routes/employeeMenu.config.tsx`: the same file that
  builds the desktop sidebar and the route tree. A menu change shows up
  on mobile automatically.
  - **Explore:** every menu entry except the ones that are themselves
    tabs (Home, Engage). Groups become expandable cards; single pages
    become direct cards. The description comes from the entry's
    `description`.
  - **Action:** the leaves marked `quickAction`, in menu order.
- **Not built yet.** Anything not yet built (`phase`) or depending on
  data that doesn't exist yet (`needs: "attendance" | "payroll"`) is
  **skipped in Action** and shown greyed with **"Coming soon"** in
  Explore. That covers Regularization, Attendance Info, Payslips and the
  Salary pages until Phases 3 and 6.
- **Install.** The portal is installable as a PWA: a manifest, our own
  icons, and a service worker for the app shell. On a phone, a
  dismissible "Install the Wellsure app" prompt appears. iOS Safari has
  no install event, so there it explains *Share → Add to Home Screen*.
