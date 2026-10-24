# Wellsure HR Portal — Design System

The visual and interaction rules for every screen in `frontend/`. Extracted from the
approved design boards (step 1 of the UI pass, `ui/design-pass`). Later steps add the
Ant Design mapping (step 3), the shared components' usage notes (step 3) and the
"How to build a new screen" checklist (step 5).

**Status: DRAFT for the user's OK on the tokens.** Nothing in `frontend/` uses these
values yet; step 3 wires them in.

---

## 0. Sources and how the values were taken

| Board | Size | What it shows |
|---|---|---|
| `Wellsure_HR_Portal_Light.png` | 6400 × 32768 | 14 sections, 135 desktop frames, light |
| `Wellsure_HR_Portal_Dark.png` | 6400 × 32768 | the same 135 frames, dark |
| `Wellsure_HR_Portal_Responsive.png` | 18054 × 17402 | the same 135 screens as **phone** frames, light (left half) and dark (right half) |

- The boards live on `main` as `docs/design/Wellsure HR Portal {Light,Dark,Responsive}.png`
  (with spaces). On this branch they are copied, untracked and git-ignored, to
  `docs/design/Wellsure_HR_Portal_{Light,Dark,Responsive}.png`.
- **The third board (Responsive) was not in the brief.** It is the board's own phone
  design, so it is used here for phone layout. Where it disagrees with the four-tab
  rule in `UI_REFERENCE.md` PART 4, PART 4 wins (see §9 Deviations).
- Slices: `docs/design/slices/{light,dark}/<section>/<section>-NN.jpg` (one frame
  each, frame-aligned rather than a blind 1600 × 2000 grid, so no screen is cut in
  half), a labelled `_contact-<section>.jpg` per section, and
  `docs/design/slices/{light,dark}-phone/<section>/m-<section>-NN.jpg` (four phone
  frames per strip). `docs/design/slices/index.json` maps every frame id to its
  pixel box on the board. All slices are JPEG under 400 KB.
- Tools (Python + PIL, run with `python3 -I` from the repo root):
  `docs/design/tools/detect_frames.py` → `slice_boards.py` (slicing),
  `measure_region.py` (flood-fill a region: exact colour + size),
  `sample_text.py` (text ink colour), `measure_type.py` (glyph height → font size),
  `swatches.py` (the proof sheets in `docs/design/compare/step1-tokens-*.jpg`).
- **Scale.** Desktop frames are 1224 × 872 px on the board = a **1440 × 1024 design
  frame at 0.85**. Every desktop size below is already divided by 0.85. Phone frames
  are 1:1 (≈ 375 × 812).
- **Colours are sampled from solid regions** (the most common exact pixel inside a
  flood-filled region), never guessed. Text colours are the median of the darkest
  2.5 % of a glyph box (antialiasing makes single-pixel reads unreliable).
- Frame ids used below (e.g. `employees-01`) are the slice file names.

**Not ours, never copied:** the "HRDashboard / Grove HR / Unpixel" names, the green
"H" logo, stock photos, avatars, placeholder people, emails, phone numbers, the
template's copy, and the Google/Apple sign-in buttons. Our brand is the plain text
mark **"Wellsure HR Portal"**; illustrations are our own SVGs (§6.13).

---

## 1. Colour tokens

Every value has a light and a dark entry. "Board" is what was sampled; "Ours" is the
token. **Where they differ it is only to reach WCAG AA** (text 4.5:1, large text and
non-text UI 3:1) — marked ⚑ and listed in §10 for the user to veto.

### 1.1 Surfaces and lines

| Token | Light board | Light ours | Dark board | Dark ours | Where (frame) |
|---|---|---|---|---|---|
| `bg.page` | `#FAFAFA` | `#FAFAFA` | `#121828` | `#121828` | content area behind cards (`employees-01`) |
| `bg.surface` | `#FFFFFF` | `#FFFFFF` | `#202938` | `#202938` | cards, sidebar, top bar, drawers, modals |
| `bg.subtle` | `#F8F8F8` | `#F8F8F8` | `#303948` | `#303948` | top-bar search, active sub-item pill, theme-toggle track, active page number |
| `bg.tableHeader` | `#FAFAFA` | `#FAFAFA` | `#303948` | `#303948` | table header band (radius, inset in the card) |
| `bg.readonly` | `#F3F4F6`-ish grey fill | `#F3F4F6` | `#303948` | `#303948` | disabled / read-only inputs (`attendance-06`, `recruitment-19`) |
| `bg.overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.5)` | ≈ `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.6)` | behind drawers and modals (page `#FAFAFA` reads `#808080` under it) |
| `border.default` | `#EAEAEA` | `#EAEAEA` | `#2A3343`-ish (card edge barely visible) | `#2C3545` | card edges, dividers, table row lines |
| `border.control` ⚑ | `#F0F0F0` | `#DADDE2` | `#3C4554` | `#4A5363` | input / select / outline-button borders |
| `focus.ring` | green border on focus (`auth-01`) | `accent` 2 px + 2 px offset | same | `accent.textOnDark` 2 px | every focusable element |

### 1.2 Text

| Token | Light board | Light ours | Dark board | Dark ours | Contrast (ours) |
|---|---|---|---|---|---|
| `text.primary` (titles, names) | `#121828` / near-black | `#121828` | `#FFFFFF` | `#FFFFFF` | 17.7 / 14.6 |
| `text.body` (values, cells) | `#2C2B31` | `#2C2B31` | `#A7AEB7` (cells) `#E1E8F0` (values) | `#E1E8F0` values, `#A7AEB7` cells | 14.0 / ≥ 6.5 |
| `text.secondary` ⚑ (labels, subtitles, table header) | `#8A8C91` (3.36:1) | `#6B7079` | `#5E6776` (2.56:1) | `#8C95A4` | 4.98 / 4.84 |
| `text.placeholder` ⚑ | `#C1C3C7` (1.76:1) | `#70757D` | `#5E6776` | `#8C95A4` | 4.64 / 4.84 |
| `text.onRaised` (dark table header) | — | — | `#C6CFDE` | `#C6CFDE` | 9.0 on `#303948` |
| `text.inverse` | `#FFFFFF` on navy | `#FFFFFF` | `#121828` on white | `#121828` | 17.7 |

### 1.3 Brand, accent and actions

The board has **two greens** and a **navy**; all three are kept.

| Token | Light board | Light ours | Dark board | Dark ours | Use |
|---|---|---|---|---|---|
| `primary` | `#121828` | `#121828` | `#FFFFFF` | `#FFFFFF` | primary button fill (**inverts in dark: white button, navy text**, `auth-*` dark, `employees-01` dark) |
| `primary.text` | `#FFFFFF` | `#FFFFFF` | `#121828` | `#121828` | label on the primary button |
| `primary.hover` | — | `#252D40` | — | `#E6E9EE` | not on the board (static frames); decided ⚑ |
| `accent` | `#28A174` | `#28A174` | `#28A174` | `#28A174` | checked checkbox/radio/switch, radio-tile border, step squares, bar charts, progress, date-picker selection, chart series 1 (3.26:1 → fine for non-text) |
| `accent.text` ⚑ | `#28A174` (3.26:1) | `#1A7F5A` | `#28A174` (4.49:1) | `#34C08E` | links ("Create Account"), active tab label + underline, "Save & Assign" text link |
| `accent.subtle` | `#EAF6F2` | `#EAF6F2` | `#EAF6F2` | `#1E3B33` ⚑ | range band in the date picker, success chip bg, hover on green items |
| `nav.active` ⚑ | `#0CAD5D` + white text (2.94:1) | `#0A8048` + white text | `#0CAD5D` | `#0A8048` | the sidebar's top-level active pill (with a soft green glow) |
| `edit` | `#2D7AEF` / `#257BF7` | `#1F66D1` ⚑ | same | `#4D8FF5` | blue square "edit" row action |
| `view` | `#24A676` | `#1E8A62` ⚑ | same | `#28A174` | green square "view" row action |
| `danger` | `#ED3838` (delete), `#CA262E` (count badge) | `#D12E2E` ⚑ | same | `#F06A6A` | delete action, error text and border, count badge, "Check Out" button |
| `warning` | `#FFCF25` / `#FED000` | `#FFCF25` (fill) / `#8A6D00` (text) | same | `#E0B300` | warnings, pending |
| `info.bg` / `info.text` | `#ECF3FD` / `#2D7AEF` | `#ECF3FD` / `#1F5FC4` ⚑ | **same light banner on dark** | `#1B2A45` / `#8DB6F7` ⚑ | info banner (`attendance-01`) |

### 1.4 Status chips (never colour-only: chips always carry a word)

Uppercase, 10 px semibold, 6 px radius, tinted background + darker text. In dark mode
the board keeps the **light** chip (light bg, coloured text) on the dark surface; we
keep that, since it reads well and keeps contrast.

| Chip | Board bg | Board text | Ours bg | Ours text | Contrast |
|---|---|---|---|---|---|
| success (ACTIVE, APPROVED, PUBLISHED, PAID) | `#EAF6F2` | `#28A174` | `#EAF6F2` | `#1B7A56` | 4.78 |
| warning (PENDING, ON BOARDING) | `#FFF5D0` | `#DBC571` | `#FFF5D0` | `#8A6D00` | 4.50 |
| purple (PROBATION, info-ish) | `#F1EDFF` | `#9F8BCD` | `#F1EDFF` | `#6A3FD9` | 5.50 |
| danger (ON LEAVE, REJECTED, UNPAID) | `#FCEDEC` | `#BD7477` | `#FCEDEC` | `#C0262D` | 5.19 |
| neutral (DRAFT, DEFAULT, NOT ACTIVE) | `#F3F4F6`-ish | grey | `#F1F2F4` | `#4B5059` | ≥ 7 |
| solid tags (CHECKLIST / UPLOAD / EMPLOYEE INFO, HQ, BEST VALUE) | `#28A174` / `#FF9240` / `#2D7AEF` with white text | | used only where the board uses them; white text needs the darker fills `#1E8A62` / `#B35A12` / `#1F66D1` ⚑ | | ≥ 4.5 |

### 1.5 Charts (categorical, fixed slot order, never cycled)

Sampled from the donut and bar charts (`reports-02`, `home-02`, `reports-05`):

| Slot | Board | Use |
|---|---|---|
| 1 | `#28A174` green | primary series, bar charts (bars sit on a full-height `#FAFAFA` / `#303948` track, rounded top, value pill above) |
| 2 | `#FFCF25` yellow | |
| 3 | `#2B7BFA` blue | |
| 4 | `#8D61FC` purple | |
| 5 | `#2CD5BE` teal | |
| 6 | `#FC964B` orange | |

Text on charts uses `text.secondary`; gridlines `border.default`. The existing
`frontend/src/theme/chartPalette.ts` (dataviz-validated palette) is replaced by this
board palette in step 3; adjacent-slot distinctness in both themes is re-checked
there, and every chart keeps a legend with labels and values (never colour-only).

---

## 2. Typography

- **Font: Manrope** (the board's typeface; geometric sans, open licence). Self-hosted
  through the `@fontsource-variable/manrope` npm package in step 3 — no Google Fonts
  or other runtime CDN call. Fallback stack:
  `"Manrope Variable", Manrope, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Numbers in tables and money use `font-variant-numeric: tabular-nums`.
- Measured sizes (cap height ÷ 0.72, design px):

| Token | Size / line height / weight | Board example (measured) |
|---|---|---|
| `display` | 40 / 48 / 700 | onboarding step heading (`auth-10`), marketing panel (not used) |
| `h1` (page title) | 24 / 32 / 700 | "Employees", "Hi, …", "Detail Employee" (24.5) |
| `h1.auth` | 26 / 34 / 700 | "Login first to your account" (26.1) |
| `h2` (card / section title) | 20 / 28 / 600 | "Personal Info", "Turnover Report" (19.6) |
| `h3` (sub-section, drawer group) | 18 / 26 / 600 | "Accrual", "Carry Over" (`time-off-13`) |
| `stat` | 32 / 40 / 700 | stat-card numbers "3,540" (32.7) |
| `body.lg` | 16 / 24 / 500 | buttons, sidebar items, form labels (16.3) |
| `body` | 14 / 22 / 400 | key–value values, paragraphs, inputs (14.7) |
| `table` | 13 / 20 / 400 | table cells (board 12 / 11.4 measured) ⚑ |
| `table.header` | 13 / 18 / 600 | table header (13.1) |
| `caption` | 12 / 16 / 400 | helper text, timestamps, emails under names |
| `chip` | 10 / 14 / 600, uppercase, +0.3 letter-spacing | status chips (9.8) |

Phone uses the same scale except `h1` 22 / 30 and `display` 28 / 36.
The lint check (step 3) bans one-off `font-size` values outside the theme file.

---

## 3. Spacing, radii, shadows, sizes

- **Spacing scale (4 px base):** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
  - Content gutter from sidebar/top bar to cards: **24** (measured 24).
  - Card inner padding: **24** desktop, **16** phone (measured 24 / 16–20).
  - Gap between cards: **24** desktop, **16** phone.
  - Form field gap (label → input 8; field → field 20).
- **Radii** (measured corner insets, AA-corrected):

| Token | px | Used for |
|---|---|---|
| `radius.xs` | 6 | chips, 30 px square row-action buttons, date cells |
| `radius.sm` | 8 | top-bar search, kbd chip, checkbox |
| `radius.md` | 12 | inputs, selects, buttons, nav pill, info banner, dropdown menus, table header band |
| `radius.lg` | 16 | cards, drawers (outer edge), modals, popovers |
| `radius.pill` | 999 | theme-toggle segments, avatar, count badge, view-toggle |

- **Shadows** (cannot be sampled as a single number; estimated from the blur and
  flagged ⚑): cards are **flat** (border only, no shadow). Floating layers:
  `shadow.popover = 0 8px 24px rgba(18,24,40,0.08)`; `shadow.drawer = -8px 0 32px rgba(18,24,40,0.12)`;
  the active nav pill has a green glow `0 8px 20px rgba(12,173,93,0.25)`; the active
  theme segment `0 2px 6px rgba(18,24,40,0.08)`. Dark mode drops shadows to
  `rgba(0,0,0,0.4)` and relies on surface steps.
- **Control heights:**

| Token | px | Board |
|---|---|---|
| `control.lg` | 48 | auth inputs and buttons, drawer fields, page-header buttons (measured 48–52) |
| `control.md` | 40 | filter-bar inputs and selects on dense admin screens ⚑ (board uses 48–52 everywhere) |
| `control.sm` | 32 | 30 px square row actions on the board, pagination squares (34 × 38) |
| phone controls | 48 (buttons), 52 (inputs) | measured 1:1 on the phone frames |

- **Icons:** the board uses 1.5 px outline icons (mail, chat, chevrons, eye, pencil,
  trash, calendar, clock). We keep **`@ant-design/icons` outlined** (already a
  dependency; no new icon library). Sizes 16 (inline), 20 (sidebar, top bar), 24
  (empty states and stat-card icon circles 48 px).
- **Table density:** board rows are **64 px** with a **50 px** header band (rounded,
  inset in the card, light `#FAFAFA` / dark `#303948`), first column a checkbox, then
  avatar + name with the email as a caption. Two densities:
  `comfortable` = 64 (default; matches the board) and `compact` = 44 for grids that
  must show many rows (attendance muster, payroll register, swipes) ⚑.

---

## 4. App shell (desktop ≥ 1280)

From `home-02`, `employees-01`, every section's first frame.

- **Sidebar, 280 px**, `bg.surface`, 1 px `border.default` on the right.
  - Top: text logo mark "Wellsure HR Portal" (ours, no icon from the template) and a
    collapse chevron `«` (collapses to a 72 px icon rail).
  - The first item (Home / Dashboard) is the **solid green pill** (`nav.active`, white
    label + icon right-aligned grid icon, 212 × 52, glow) when active.
  - Other top-level items: outline icon 20 + label 16/600 + chevron for groups.
    Inactive icon grey, label `text.primary`.
  - Expanded group: children indented 20, with a 1 px vertical guide line on the
    left; the **active child is a `bg.subtle` pill** (no green fill), and an active
    top-level group shows its icon in green.
  - Pinned at the bottom: **Help Center** (with a red count badge when there are
    open items, ours: helpdesk tickets awaiting the user), **Settings**, and the
    **Light / Dark segmented toggle** (pill track `bg.subtle`, active segment white
    with shadow in light, `#303948` in dark). Ours adds a third **System** option ⚑.
  - Items come from the existing permission-driven menus
    (`frontend/src/routes/employeeMenu.config.tsx` and the admin menu) — nothing
    appears that the user cannot open.
- **Top bar, 96 px** (measured ≈ 94), `bg.surface`, bottom 1 px border:
  - Left: search field (318 × 48, `bg.subtle`, radius 8) "Search anything…" with a
    `⌘ K` / `Ctrl K` shortcut chip (board shows `⌘ F`; we use K so the browser's own
    find keeps working ⚑).
  - Middle: text links (board: Documents, News, Payslip, Report). Ours: the user's
    Quick Links that already exist (only links the user can open).
  - Right: notification bell with red dot (board's mail icon) opening the
    notification popover; the board's chat icon is **not shown** (no messaging
    backend — "later"); avatar + chevron opening the avatar menu (View My Info,
    Account & security, theme, Sign out).
- **Content:** `bg.page`, 24 px gutter, page header (title `h1` + optional
  `text.secondary` subtitle or breadcrumb, actions on the right) above or inside the
  first card — the board does both; ours: **inside the card** for list pages
  (`employees-01`), **above** for dashboards and detail pages (`attendance-01`,
  `employees-05`).
- The admin portal uses the **same shell** (sidebar instead of greytHR's top-bar app
  switcher). That reverses `UI_REFERENCE.md` §2.0, by the user's instruction that every
  screen follows the board ⚑ (§9).

---

## 5. Responsive rules

| Width | Layout |
|---|---|
| **≥ 1920** | as 1280, content max-width 1600 centred; tables may show more columns |
| **1280 – 1919** (design width 1440) | full sidebar 280 + top bar; cards in 2–4 columns |
| **768 – 1279** (tablet) | sidebar becomes a **left drawer** opened from a hamburger in the top bar; top-bar links collapse into the avatar menu; search becomes an icon that expands; 2-column card grids; drawers 480 px wide |
| **< 768** (phone, designed at **390**) | **bottom tab bar** (four tabs, `UI_REFERENCE.md` PART 4: Home, Action, Explore, Engage) for the employee portal; admin-only users get Home, Action, Explore and Alerts ⚑; no sidebar; top bar = hamburger-free header with page title, bell and avatar (board phone header); single column; **tables become stacked cards** (`DataTable` renders each row as a card: primary field as title, status chip top-right, 2–4 key fields as label/value, row actions as 44 px buttons at the bottom, never hover-only); **drawers and modals become full-screen sheets** sliding up (board phone frames show bottom sheets with Cancel / primary buttons pinned at the bottom, 48 px tall, side by side); filter bars collapse to a "Filter" button opening a bottom sheet (`m-employees-02`); tabs scroll horizontally; key–value grids stack label over value |

- Touch targets ≥ 44 × 44 on phones; safe-area insets respected for the tab bar.
- Every existing workflow must be completable on a 390 px phone (checked per screen
  in steps 4–8).

---

## 6. Component inventory

Each entry: what the board shows → what we build (Ant Design 6 component + shared
wrapper in `frontend/src/ui/` from step 3). Board frames in brackets.

1. **Buttons** [`employees-01`, `auth-01`]. Primary: navy fill, white 16/600 label,
   radius 12, 48 high, optional leading icon (light); white fill, navy label (dark).
   Secondary: white/transparent with `border.control`-dark outline (light: navy 1 px
   border, navy text — the board's "Download" / "Cancel"). Danger: red fill ("Check
   Out", `attendance-02`). Text link: `accent.text`. Disabled: `#E5E7EB` fill, grey
   text (light), `#303948` (dark). Footer button pairs in drawers / sheets are equal
   width.
2. **Inputs** [`auth-01..03`, `employees-03`]. Label above (16/500, red `*` for
   required), 48 high, radius 12, `border.control`, placeholder `text.placeholder`;
   focus = green border; valid = trailing check icon; error = red border + red helper
   with a leading (!) icon; password eye toggle; read-only = `bg.readonly` fill;
   helper text below in `caption`. Upload field = input look with trailing upload
   icon and "Max file size …" helper.
3. **Selects** [`employees-02`]. Same box + chevron; menu radius 12, popover shadow,
   selected item `bg.subtle` + green check; optional menu title ("Change Status").
4. **Date / range picker** [`employees-04`, `time-off-08`]. Popover card titled "Set
   Date", Monday-first grid, selected day solid `accent` square (radius 6), range
   band `accent.subtle` with solid endpoints, Cancel / Save buttons.
5. **Radio tiles / checkbox / switch** [`auth-10..13`, `time-off-03`, `settings-02`].
   Radio tile = bordered 48 px box, selected → green border + green radio. Switch
   on = `accent` with a check in the knob; off = grey track with a "–" knob.
   Checkbox checked = `accent` fill, white tick, radius 4.
6. **Tabs** [`employees-05`]. Text tabs, active = `accent.text` label + 2 px green
   underline; inactive `text.primary`. Settings-style **sub-nav card** on the left
   (icon + label, active = `bg.subtle` pill with green icon) [`settings-01`].
7. **Tables (`DataTable`)** [`employees-01`, `attendance-01`]. Rounded header band,
   sortable headers with up/down glyph, checkbox column, avatar + name + email
   caption, status chip (with a chevron when the chip is itself a status menu),
   row actions as 30 px solid squares (view green, edit blue, delete red) or a blue
   kebab square, expandable rows with a chevron, footer: pagination squares on the
   left ("‹ 1 2 3 … 10 ›", active `bg.subtle`), "Showing 1 to 8 of 50 entries" and a
   "Show 8 ^" page-size picker on the right. Phones: stacked cards (§5).
8. **Status chips** (§1.4).
9. **Stat cards (`StatCard`)** [`home-02`, `attendance-01`]. 48 px circle icon on
   `bg.subtle`, big number (`stat`), delta chip (green ↗ / red ↘ with a tinted bg),
   label below. Compact variant: title + info icon on top, grey value below.
10. **Charts** [`home-02`, `reports-02`, `reports-05`]. Donut with the total in the
    centre and a legend list (dot · label · value); smooth line chart with dot
    legend and a "Last 7 month" date button; bar chart with rounded bars on grey
    tracks, value pill on each bar and a tooltip card. Built on the existing
    `recharts` dependency.
11. **Drawers (`SideDrawer`)** [`employees-03`, `time-off-02..04`, `time-off-13`].
    Right side, `bg.surface`, 420 px (form) / 640 px (wide form), title `h1`
    (optional status chip on the right), body scrolls, **sticky footer** with Cancel
    (outline) + primary, an optional left text action ("Save & Assign Employee").
    Overlay `bg.overlay`. A round collapse handle on the drawer edge is shown on the
    board; ours uses a close button in the header instead (keyboard-reachable) ⚑.
    Phone: full-screen sheet.
12. **Modals (`ConfirmModal`)** [`attendance-02`, `home-05`, `recruitment-12`].
    Centred, radius 16, 480 px; optional illustration on top; title `h2`; info line
    with (i); two equal-width buttons. Success modal: green circle check with small
    confetti marks. Phone: bottom sheet.
13. **Empty states (`EmptyState`)** [`documents-02`, `news-05`, `employees-09`].
    Line illustration (grey outline with green accents, ours, original SVG), title
    20/700, `text.secondary` sentence, optional primary CTA. Variants: empty,
    no-results (after filters), error, forbidden, offline.
14. **Stepper (`StepperLayout`)** [`auth-10..13`, `recruitment-09..11`]. Two forms:
    (a) page stepper — row of square progress dots (green done/current, grey to do)
    + "STEP 2 OF 4" caps label + big heading + content + Go Back / Continue;
    (b) numbered stepper in a drawer — "1 Job Info  2 …" with light-green filled
    circle for the current step.
15. **Toasts (`Toast`)** — not drawn on the board; styled by system: `bg.surface`,
    radius 12, popover shadow, leading status icon in the status colour, 4 s, bottom-
    centre on phones, top-right on desktop; `aria-live="polite"` ⚑.
16. **Skeletons (`Skeletons`)** [`home-01`]. Grey rounded placeholders shaped like
    the final content (circles for icons/avatars, pills for text lines), `bg.subtle`
    on light, `#303948` on dark; shimmer off under reduced motion.
17. **Pagination** — see Tables.
18. **Filter bar (`FilterBar`)** [`employees-01`, `attendance-01`]. Search input
    (trailing search icon) + 1–3 selects / a date range, on one row; phone: a
    "Filter" button (with a filter glyph) + search icon, opening a bottom sheet.
19. **Rich-text toolbar** [`recruitment-06`, `news-03`]. Bordered box radius 12:
    toolbar row (B I U, emoji, link, list, align) then the body. Wraps the existing
    TipTap editor.
20. **Drag-and-drop upload** [`employees-09`, `recruitment-15`]. Dashed-free box
    with illustration, "Drag & Drop here to upload", "Or select file from your
    computer", primary "Upload File". Ant `Upload.Dragger` restyled.
21. **Approval banner (`ApprovalBanner`)** — not on the board as such; styled by
    system from the info banner [`attendance-01`]: tinted bar radius 12, leading
    icon, message, actions on the right (Approve / Reject or a link). Status
    variants info / warning / success / danger. Used for maker-checker states,
    DEMO COMPANY banner keeps its current wording and position ⚑.
22. **Timeline (`Timeline`)** [`recruitment-08` Activity, `employees-07` Job
    Timeline]. Avatar + sentence with bold actors/objects + grey relative time;
    table form for effective-dated history.
23. **Page header (`PageHeader`)**: back chevron (detail pages), title, subtitle or
    breadcrumb ("List Report › Employee Turnover Rate"), actions right; phone:
    actions wrap below the title, full width.
24. **Form section (`FormSection`)** [`employees-06`, `time-off-13`]. Card with title
    + pencil edit icon; key–value grid (grey label left, dark value right, 2 pairs
    per row on desktop); edit mode turns the grid into inputs; group subheads
    (`h3`) in long drawers.
25. **Notification popover** [`notifications-01`]. Card radius 12, title + kebab,
    rows with tinted round icon, title 14/600, truncated description, time, red
    unread dot; full-width primary "Show all notifications".
26. **Profile card** [`employees-05`]. Avatar 84 (ours: initials, no photos in
    fixtures), name, designation, status chip, contact rows with icons,
    department / office / manager rows with chevrons, primary "Action ▾" menu
    button. Sensitive values never appear here.
27. **Directory card / org chart node** [`employees-12`, `employees-13`].
28. **Accordion card** [`payroll-02`, `settings-06`, `checklist-09`]: title + tag +
    switch / amount + chevron.
29. **Progress row** [`checklist-03`]: thin bar coloured by value (red < 30 %,
    yellow < 70 %, green ≥ 70 %) + bold % + "1/10 Completed". Colour is never the
    only signal (the % and count are always shown).
30. **Info hint** [`payroll-04`]: grey (i) + explanatory text to the right of a field.

---

## 7. Motion and interaction

- Route transitions 150–200 ms opacity + 8 px translate; the shell stays mounted.
- Drawers 200 ms slide (transform), modals 150 ms fade + scale 0.98 → 1.
- Animate only `transform` and `opacity`; under `prefers-reduced-motion: reduce`
  all of these become instant.
- Hover states are a convenience only — every action is reachable by click/tap and
  keyboard; row actions are always visible (the board shows them always visible).
- Focus: visible 2 px ring (`focus.ring`), focus trap and restore in drawers and
  modals, Esc closes, `/` or `Ctrl/⌘ K` focuses search.

---

## 8. Accessibility baseline

- WCAG 2.2 AA in both themes: text 4.5:1 (large 3:1), non-text UI 3:1 except where
  §10 asks the user to choose.
- Status always has a word (chips) or an icon + label, never colour alone.
- Every icon-only button has an `aria-label` and a tooltip.
- Sensitive values (salary, bank, PAN, Aadhaar, UAN, ESI) keep the existing masking
  and permission checks; no new component renders them.

---

## 9. Deviations from the board (what we do differently, and why)

1. **Brand:** "Wellsure HR Portal" plain text mark instead of "HRDashboard"; no
   template logo, photos or people; original SVG illustrations.
2. **No social sign-in, no sign-up, no company-creation onboarding.** Our accounts
   are created by HR (spec §3). The board's stepper onboarding pattern is used for
   our own first-login steps (privacy acknowledgement, password change) only.
3. **Phone navigation:** the board's phone frames use a hamburger + header with no
   bottom bar; we follow `UI_REFERENCE.md` PART 4 (four-tab bottom bar) as the brief
   requires, and keep the board's phone header, cards, sheets and button styles.
4. **Phone tables:** the board scrolls tables sideways on phones; we render stacked
   cards (brief requirement).
5. **Admin portal shell:** sidebar + top bar like the board, replacing the
   greytHR-style app switcher described in `UI_REFERENCE.md` §2.0.
6. **Chat icon / Messages, Recruitment, Checklist templates, Subscription, Pay with
   card, Integrations:** no backend → "later", not shown.
7. **AA adjustments** (⚑ rows in §1): darker secondary text, placeholder, link green,
   nav pill green, chip text, info text, edit/delete fills.
8. **Search shortcut** `Ctrl/⌘ K` instead of `⌘ F`.
9. **Third theme option "System"** on the toggle.
10. **Table body 13 px** instead of the board's 12 px.
11. **Board inconsistencies not copied:** the white welcome modal on the dark board
    (we use the dark surface), the invisible "Edit News" title and greyed Cancel on
    the dark board, the "Attendace" typo.

---

## 10. Decisions I made that you may veto (⚑)

| # | Decision | Board | Alternative |
|---|---|---|---|
| D1 | Secondary text `#6B7079` / dark `#8C95A4` | `#8A8C91` / `#5E6776` (fail AA) | keep board values (fails AA) |
| D2 | Placeholder `#70757D` | `#C1C3C7` (1.8:1) | lighter placeholder, e.g. `#9A9EA5` (2.7:1, fails AA) |
| D3 | Link / tab green `#1A7F5A` (dark `#34C08E`); fills keep `#28A174` | `#28A174` everywhere | keep `#28A174` text (3.26:1) |
| D4 | Active nav pill `#0A8048` + white text | `#0CAD5D` + white (2.94:1) | keep `#0CAD5D` with **navy** text (6.0:1, keeps the exact green) |
| D5 | Control border `#DADDE2` (dark `#4A5363`) | `#F0F0F0` / `#3C4554` | strict 3:1 input outline `#8F949C` (visibly heavier than the board) |
| D6 | Edit / view / delete square fills darkened to `#1F66D1` / `#1E8A62` / `#D12E2E` | `#2D7AEF` / `#24A676` / `#ED3838` | keep board fills (icons pass 3:1 already; only matters if text is added) |
| D7 | Two table densities (64 default, 44 compact for muster / payroll / swipes) | 64 only | 64 everywhere |
| D8 | Filter-bar controls 40 px on dense admin screens | 48–52 | 48 everywhere |
| D9 | Theme toggle Light / Dark / System | Light / Dark | Light / Dark only |
| D10 | `Ctrl/⌘ K` search shortcut | `⌘ F` | `⌘ F` |
| D11 | Table cells 13 px | 12 px | 12 px |
| D12 | Drawer close button in the header instead of the edge handle | edge handle | both |
| D13 | Dark info banner tinted dark (`#1B2A45`) | light banner on dark | keep the light banner |
| D14 | Admin-only phone users get an "Alerts" tab instead of "Engage" | — | always the four PART 4 tabs |
| D15 | Shadows (§3) estimated, not sampled | — | — |

---

## 11. Not verified yet (honest list)

- No screen uses these tokens yet; nothing has been rendered. Board-vs-ours
  screenshots start at step 3 (`docs/design/compare/`).
- Font identification (Manrope) is by eye from glyph shapes (single-storey `g`,
  numerals, `y` tail); the board embeds no font metadata.
- Shadow values are estimates (§3).
- Sizes are ± 2 px (antialiasing at the 0.85 board scale).
- The project uses **Ant Design 6** (`antd ^6.6.5`), not 5 as the brief says; the
  ConfigProvider token/algorithm mapping in step 3 targets v6 (same API shape).

---

## 12. Shared components — usage notes

Everything lives in `frontend/src/ui/` (import from `../../ui` — the barrel `index.ts`) and is styled only by `frontend/src/theme/tokens.ts`.

**Tokens in code.**
- Colours: `v.textSecondary`, `v.accentText`, `v.bgSubtle`, `v.danger`, … (CSS variables, follow the theme without a hook; safe in module
  constants). Or `theme.useToken()` for Ant Design's own tokens. **Never** a hex/rgb literal outside `src/theme/` — `npm run lint` fails.
- Type: `fs.chip 10 · xs 11 · sm 12 · table 13 · md 14 · lg 16 · xl 18 · h2 20 · h1 24 · stat 32 · display 40`; weights `fw.*`.
  **Never** `fontSize: 12` — use `fontSize: fs.sm` (lint fails otherwise).
- Spacing `space[1..16]` (4 px steps), radii `radius.xs/sm/md/lg/pill`, control heights `control.*`.
- Charts: `useChartColors(mode)` from `theme/chartPalette` (`mode` from `useThemeMode()`); fixed slot order, always a legend.
- Attendance day colours: `attendanceStatusColor[code]` (CSS variables).

**Page skeleton.** Every page:
```tsx
<PageHeader title="All Employees" subtitle="Manage your employees" actions={<Button type="primary" icon={<PlusOutlined/>}>Add employee</Button>} />
<Stack>                         {/* 24 px rhythm, 16 on phones */}
  <CardGrid min={220}>{stats}</CardGrid>
  <Panel title="Employees" extra={...}>
    <FilterBar onSearch={setSearch} searchPlaceholder="Search employee" filters={<>{selects}</>} activeCount={n} onClear={clear} />
    <DataTable rowKey="id" columns={columns} dataSource={rows} loading={isLoading} error={error} onRetry={refetch}
               pagination={{ current, pageSize, total, onChange }} onRowOpen={(r) => navigate(...)} mobile={{ title, subtitle, status, fields, actions }} />
  </Panel>
</Stack>
```

| Component | Use it for | Notes |
|---|---|---|
| `PageHeader` | the page's h1 | `subtitle` or `breadcrumb` (`[{label,to}]`), `back` (detail pages), `actions` (primary last), `tags`. Actions wrap full-width on phones. |
| `Panel` | every content block (the board's card) | `title`, `subtitle`, `extra`, `onEdit` (pencil), `flush` (no body padding), `tone="subtle"`. Replaces bare `Card`. |
| `Stack`, `CardGrid` | vertical rhythm; responsive card grids | `CardGrid min={280}` = columns at least 280 px wide. |
| `StatCard` | one number with a label | `icon` (48 px circle, `tone`), `delta` (only from figures the API returns), `info`, `onClick`, `variant="compact"`. |
| `StatusChip` | every status | `status="APPROVED"` picks the tone; or `tone` + children. Always a word, never colour alone. |
| `DataTable` | every table | wraps antd `Table`: rounded header band, 64 px rows (`density="compact"` 44 px for dense grids), skeleton on first load, faded old rows while refetching, `error`/`onRetry`, empty state, "Showing x to y of z", phone stacked cards (`mobile` spec, else derived from columns), `onRowOpen` (click + Enter), virtualises unpaginated lists > 100 rows. Use `useQuery({ placeholderData: keepPreviousData })` for paginated queries. |
| `FilterBar` | search + filters above a table | search is debounced 250 ms (pass the setter); on phones filters move into a "Filter" sheet. |
| `SideDrawer` | "Add" / detail forms | right drawer 440 / 640 (`size="wide"`), full-screen sheet on phones; sticky footer Cancel + primary (`onPrimary` or `formId` to submit an antd Form by id), `status` chip, `secondaryAction`. Focus trap, Esc, overlay close. |
| `ConfirmModal` | confirmations, success | `illustration="success"`, `info`, `danger`, `loading`. Bottom sheet on phones. Never close before the server answered for money, approvals or audited actions. |
| `EmptyState` | empty, no results, error, forbidden, offline | `kind`, `title`, `description` (`null` hides), `action`, `onRetry`, `compact`, `illustration`. |
| `QueryState` | wrap a query's content | renders skeleton / forbidden (API 403) / offline / error with retry / empty / children. |
| `Skeletons` | loading shapes | `Skel`, `SkeletonCard`, `SkeletonStats`, `SkeletonTable`, `PageSkeleton` (route fallback). No whole-page spinners. |
| `StepperLayout` | multi-step flows | `variant="dots"` (onboarding) or `"numbered"` (drawer steps); announces "Step 2 of 4". |
| `FormSection`, `KeyValueGrid`, `FormGroupTitle` | profile/detail blocks, read-only label/value grids, sub-heads in long forms | KeyValueGrid stacks on phones. |
| `ApprovalBanner` | maker-checker state, page notices | `tone` info/warning/success/danger, `actions`. |
| `Timeline` | history, audit trails, activity | items `{key, content, time, marker?, tone?}`. |
| `toast` | transient results | `toast.success("Saved")`, `toast.error(apiErrorMessage(err, "…"))`. |
| `InitialsAvatar` | people without photos | tint from the name. `EmployeeAvatar` (components/common) shows the photo when there is one. |
| `Illustration` | our own line art | empty, search, error, forbidden, offline, success, documents, upload, calendar, inbox, chart, people. |
| hooks | `useIsPhone()` (< 768), `useIsCompact()` (< 1280), `useDebouncedValue`, `isForbidden(err)` | |

**Shell** (`frontend/src/layouts/shell/`): `AppShell` (sidebar, top bar with search ⌘/Ctrl K, notification bell, avatar menu, phone tab
bars, route Suspense + 180 ms page transition), `Sidebar`, `CommandPalette`, `ThemeToggle`, `nav.ts` (menu model from the two menu configs).
Pages never render their own app chrome.

**Behaviour rules for every screen.** Loading = skeletons shaped like the content; every query has empty, error and forbidden states;
search debounced; paginated tables keep previous data; optimistic updates only where rollback is already safe (never money, approvals or
audited actions); icon-only buttons have `aria-label` + tooltip; no hover-only actions; touch targets ≥ 44 px on phones (global CSS does
buttons and inputs); sensitive values only where they already appear, for the roles that already see them.

## 13. How to build a new screen

Written in step 5 (the standing rule).
