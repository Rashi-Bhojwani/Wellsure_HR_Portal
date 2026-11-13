import type { PermissionKey } from "./permissions";

// Peeps core (docs/plans/PEEPS_PLAN.md, owner decisions D-28, D-29, D-30): the "Wellsure Office" workspace, its membership capabilities, and the
// director-controlled settings every Peeps module reads. Nothing here is a business value: every setting starts Not set, and a feature whose required
// settings are missing refuses to activate. The only default is the workspace's display name, which the owners chose ("Wellsure Office").

export const DEFAULT_OFFICE_NAME = "Wellsure Office";

/** Held by every active member (and by the directors, who hold every key): opens the workspace. */
export const OFFICE_WORKSPACE_KEY = "office.workspace" satisfies PermissionKey;

/** What a director can switch on or off for each member. Each capability is a set of ordinary permission keys, written as per-person grants. */
// PEEPS-BEGIN exits
export const OFFICE_CAPABILITY_IDS = [
  // PEEPS-BEGIN recruitment
  "MANAGE_RECRUITMENT",
  // PEEPS-END recruitment
  // PEEPS-BEGIN insights
  "VIEW_INSIGHTS",
  // PEEPS-END insights
"MANAGE_EXITS", "MANAGE_ASSETS", "PREPARE_SETTINGS", "GIVE_BADGES", "SEND_NUDGES"] as const;
// PEEPS-END exits
export type OfficeCapabilityId = (typeof OFFICE_CAPABILITY_IDS)[number];

export interface OfficeCapability {
  id: OfficeCapabilityId;
  label: string;
  what: string;
  keys: readonly PermissionKey[];
}

export const OFFICE_CAPABILITIES: readonly OfficeCapability[] = [
  // PEEPS-BEGIN recruitment
  { id: "MANAGE_RECRUITMENT", label: "Manage recruitment", what: "Recruiting duties while a director explicitly opens the Office audience. Feedback stays panel-scoped.", keys: ["recruitment.view", "recruitment.manage", "recruitment.personal.view"] },
  // PEEPS-END recruitment
  // PEEPS-BEGIN insights
  { id: "VIEW_INSIGHTS", label: "View Insights", what: "Aggregate turnover, tenure, exit-reason and hiring-funnel figures with small groups hidden. Never an individual, an exit interview or pay.", keys: ["insights.view"] },
  // PEEPS-END insights
  // PEEPS-BEGIN exits
  { id: "MANAGE_EXITS", label: "Run exits", what: "Work non-pay exits while a director opens the exits audience to the Office. Interview answers remain relationship-scoped.", keys: ["exits.view", "exits.manage", "exits.accept", "exits.checklist.complete"] },
  // PEEPS-END exits
  { id: "MANAGE_ASSETS", label: "Manage the asset register", what: "Add, issue, take back and transfer assets, and prepare the asset lists (a director confirms them).", keys: ["assets.view", "assets.manage", "assets.settings.manage"] },
  { id: "PREPARE_SETTINGS", label: "Prepare Peeps settings", what: "Enter the working settings (Unmute times and the like). A director confirms each one. Badge and nudge settings are the directors' own.", keys: ["peeps.settings.manage"] },
  { id: "GIVE_BADGES", label: "Give badges", what: "No extra reach (Peeps Stage 3): badges follow the reporting line for everyone, members included; only the directors give to anyone.", keys: ["badges.give"] },
  { id: "SEND_NUDGES", label: "Send private nudges", what: "No effect (Peeps Stage 3): private notes are no longer created, and nudge tags are given by the directors only.", keys: ["nudges.send"] },
];

export const officeCapability = (id: string): OfficeCapability | undefined => OFFICE_CAPABILITIES.find((c) => c.id === id);

/** The reason written on every grant the membership creates, so the Roles & Permissions screen says where it came from and a drift check can find them. */
export const OFFICE_GRANT_REASON = "Wellsure Office membership (managed on the Office members screen; do not change here)";

export const OFFICE_CHANGE_KINDS = ["APPOINT", "UPDATE", "REMOVE", "REPLACE"] as const;
export type OfficeChangeKind = (typeof OFFICE_CHANGE_KINDS)[number];

// ── Directory (Peeps module: avatars and directory) ─────────────────────────
/** The contact fields a director may let colleagues see in the directory (Not set = none). Personal email is never one of them. */
export const DIRECTORY_CONTACT_FIELDS = ["officialEmail", "mobile", "birthday"] as const;
export type DirectoryContactField = (typeof DIRECTORY_CONTACT_FIELDS)[number];
export const DIRECTORY_CONTACT_LABELS: Record<DirectoryContactField, string> = { officialEmail: "Work email", mobile: "Phone", birthday: "Birthday (day and month)" };

// ── Settings ───────────────────────────────────────────────────────────────
// Who may enter each setting: DIRECTOR = a director only; OFFICE = a director or a member with "Prepare Peeps settings". Every setting is confirmed by a
// director who did not enter it. `required` lists the settings a module refuses to work without.

export const PEEPS_SETTING_KEYS = [
  "office.name",
  "audience.assets",
  "audience.unmute",
  "unmute.sessionMinutes",
  "unmute.availability",
  "unmute.bookingWindowDays",
  "unmute.minNoticeHours",
  "unmute.cancellationNoticeHours",
  "badges.catalogue",
  "badges.limits",
  "badges.repeat",
  "badges.noManagerFallback",
  "badges.publicDetails",
  "nudges.catalogue",
  "nudges.offLimitsWords",
  "directory.contactFields",
  "leave.calendarShowsType",
  "leave.showSensitiveTypes",
] as const;
export type PeepsSettingKey = (typeof PEEPS_SETTING_KEYS)[number];

export interface PeepsSettingInfo {
  module: "office" | "assets" | "unmute" | "badges" | "nudges" | "directory" | "leave";
  label: string;
  what: string;
  enteredBy: "DIRECTOR" | "OFFICE";
}

export const PEEPS_SETTINGS: Record<PeepsSettingKey, PeepsSettingInfo> = {
  "office.name": { module: "office", label: "Workspace name", what: "What employees see instead of a person's name for the workspace. Until set, it is called Wellsure Office.", enteredBy: "DIRECTOR" },
  "audience.assets": { module: "assets", label: "Asset register audience", what: "HR and the directors manage the register. This decides whether Wellsure Office members (with \"Manage the asset register\") manage it too. Not set: HR and the directors only.", enteredBy: "DIRECTOR" },
  "audience.unmute": { module: "unmute", label: "Unmute audience", what: "Whether employees (HR included, as employees) may book Unmute conversations.", enteredBy: "DIRECTOR" },
  "unmute.sessionMinutes": { module: "unmute", label: "Session length", what: "How long one Unmute conversation lasts, in minutes.", enteredBy: "OFFICE" },
  "unmute.availability": { module: "unmute", label: "Availability window", what: "The days and hours within which hosts may offer slots.", enteredBy: "OFFICE" },
  "unmute.bookingWindowDays": { module: "unmute", label: "Booking window", what: "How many days ahead an employee may book.", enteredBy: "OFFICE" },
  "unmute.minNoticeHours": { module: "unmute", label: "Booking notice", what: "How many hours before a slot it can still be booked.", enteredBy: "OFFICE" },
  "unmute.cancellationNoticeHours": { module: "unmute", label: "Cancellation notice", what: "Up to how many hours before a slot the employee may cancel or reschedule.", enteredBy: "OFFICE" },
  "badges.catalogue": { module: "badges", label: "Badge catalogue", what: "The badges that can be given, each lasting this week, this month or permanently. Directors add, rename and retire badges (a retired badge stays on past awards; a badge already given cannot be deleted, only retired).", enteredBy: "DIRECTOR" },
  "badges.repeat": { module: "badges", label: "Repeat to the same person", what: "Whether one giver may give the same badge again to someone who still holds it from them (the monthly pair limit applies either way).", enteredBy: "DIRECTOR" },
  "badges.noManagerFallback": { module: "badges", label: "No manager on record", what: "For someone who has no manager (and is not a manager or HR Admin, who report to the directors): whether they may give up to the directors.", enteredBy: "DIRECTOR" },
  "badges.publicDetails": { module: "badges", label: "Who gave it and why, in public", what: "Whether profiles, the directory and the home page show who gave a badge and their reason. The recipient and the directors always see both.", enteredBy: "DIRECTOR" },
  "badges.limits": { module: "badges", label: "Badge limits", what: "How many badges one person may give in a calendar month (India time), and how many one giver may give the same person in a month, to stop farming.", enteredBy: "DIRECTOR" },
  "directory.contactFields": { module: "directory", label: "Contact fields in the directory", what: "Which of work email, phone and birthday (day and month) colleagues see in the directory, on top of System Settings → People & Documents. Not set: none. Personal email and every sensitive field never show.", enteredBy: "DIRECTOR" },
  "leave.calendarShowsType": { module: "leave", label: "Wedding and bereavement leave on team calendars", what: "Whether team calendars name wedding and bereavement leave. Not set: they show as \"Leave\". (Menstrual and medical leave follow their own setting.)", enteredBy: "DIRECTOR" },
  "leave.showSensitiveTypes": { module: "leave", label: "Menstrual and medical leave named to managers", what: "Whether managers, team calendars and managers' notifications name menstrual and medical leave. Not set: they see \"Leave\" and the dates. HR and the directors always see the type.", enteredBy: "DIRECTOR" },
  "nudges.catalogue": { module: "nudges", label: "Nudge tags", what: "The light-hearted tags directors may give (each shows for a week). Neutral and good-natured only: a tag name containing an off-limits word is refused. Directors add, rename and retire tags.", enteredBy: "DIRECTOR" },
  "nudges.offLimitsWords": { module: "nudges", label: "Off-limits words for nudge tags", what: "Words no nudge tag name may contain (whole words, any case). A tag that later matches a newly added word can no longer be given.", enteredBy: "DIRECTOR" },
};

export const PEEPS_REQUIRED: Record<"unmute" | "badges" | "nudges", readonly PeepsSettingKey[]> = {
  unmute: ["audience.unmute", "unmute.sessionMinutes", "unmute.availability", "unmute.bookingWindowDays", "unmute.minNoticeHours", "unmute.cancellationNoticeHours"],
  badges: ["badges.catalogue"], // D-36: givers follow the reporting line; the catalogue ships with a default (Stage 3)
  nudges: ["nudges.catalogue"], // Stage 3: public light-hearted tags from the directors; the catalogue ships with a default
};

// ── Shipped defaults (Peeps Stage 3, owner's defaults rule) ──────────────────
// Lists and workflow settings start from conventional values, shown "Default, change in settings"; a director changes them through the normal
// two-director setting (every change audited). Anything about pay, bank, statutory or tax values, retention, link lifetime and the like has no default.

export type BadgeCatalogueEntry = { code: string; label: string; description?: string; duration: BadgeDuration; retired?: boolean };
export type NudgeTagEntry = { code: string; label: string; retired?: boolean };

export const DEFAULT_BADGE_CATALOGUE: BadgeCatalogueEntry[] = [
  { code: "LAUNCH_STAR", label: "Launch Star", description: "Shipped something that mattered.", duration: "MONTH" },
  { code: "TARGET_CRUSHER", label: "Target Crusher", description: "Beat a goal.", duration: "MONTH" },
  { code: "ON_FIRE", label: "On Fire", description: "A week of great work.", duration: "WEEK" },
  { code: "TEAM_PLAYER", label: "Team Player", description: "Made the team better.", duration: "MONTH" },
  { code: "QUICK_LEARNER", label: "Quick Learner", description: "Picked up something new fast.", duration: "MONTH" },
  { code: "MENTOR", label: "Mentor", description: "Helped others grow.", duration: "PERMANENT" },
  { code: "LIFESAVER", label: "Lifesaver", description: "Came to the rescue.", duration: "WEEK" },
  { code: "IDEA_SPARK", label: "Idea Spark", description: "A bright idea.", duration: "MONTH" },
  { code: "STAR_OF_THE_MONTH", label: "Star of the Month", description: "This month's star.", duration: "MONTH" },
  { code: "CULTURE_CHAMP", label: "Culture Champ", description: "Lives our values.", duration: "PERMANENT" },
  { code: "CUSTOMER_HERO", label: "Customer Hero", description: "Went the extra mile for a customer.", duration: "MONTH" },
  { code: "PROBLEM_SOLVER", label: "Problem Solver", description: "Cracked a tough one.", duration: "WEEK" },
];

export const DEFAULT_NUDGE_TAGS: NudgeTagEntry[] = [
  { code: "CHAI_BREAK_CHAMP", label: "Chai Break Champ" },
  { code: "SCROLL_MASTER", label: "Scroll Master" },
  { code: "SNOOZE_MODE", label: "Snooze Mode" },
  { code: "MEETING_MARATHONER", label: "Meeting Marathoner" },
  { code: "COFFEE_REFILL_CREW", label: "Coffee Refill Crew" },
  { code: "PLAYLIST_DJ", label: "Playlist DJ" },
  { code: "EMOJI_ENTHUSIAST", label: "Emoji Enthusiast" },
  { code: "DESK_PLANT_PARENT", label: "Desk Plant Parent" },
];

/** Words no nudge tag may contain: anything about attendance, time, leave, missed work, performance or discipline. Directors extend it. */
export const DEFAULT_NUDGE_OFF_LIMITS_WORDS: string[] = [
  "late", "lateness", "latecomer", "tardy", "absent", "absence", "absentee", "leave", "early", "attendance", "punch", "missed", "miss", "skip",
  "bunk", "lazy", "slow", "slacker", "idle", "performance", "underperformer", "poor", "fail", "failure", "warning", "mistake", "careless",
  "useless", "worst", "loser", "fired", "penalty", "lop", "overtime", "sick",
];

export const PEEPS_SETTING_DEFAULTS: Partial<Record<PeepsSettingKey, unknown>> = {
  "badges.catalogue": DEFAULT_BADGE_CATALOGUE,
  "badges.limits": { perGiverPerMonth: 5, perPairPerMonth: 1 },
  "badges.repeat": { allowed: true },
  "badges.noManagerFallback": { upTo: "DIRECTORS" },
  "badges.publicDetails": { giver: true, reason: true },
  "nudges.catalogue": DEFAULT_NUDGE_TAGS,
  "nudges.offLimitsWords": DEFAULT_NUDGE_OFF_LIMITS_WORDS,
};

/** How long a nudge tag shows: a week from when it was given. */
export const NUDGE_LIFETIME_DAYS = 7;

/** D-36: each catalogue item lasts a calendar week, a calendar month (India time) or until a director revokes it. */
export const BADGE_DURATIONS = ["WEEK", "MONTH", "PERMANENT"] as const;
export type BadgeDuration = (typeof BADGE_DURATIONS)[number];
export const BADGE_DURATION_LABELS: Record<BadgeDuration, string> = { WEEK: "This week", MONTH: "This month", PERMANENT: "Permanent (until revoked)" };

export const UNMUTE_BOOKING_STATUSES = ["BOOKED", "CANCELLED", "RESCHEDULED", "COMPLETED", "NOT_HELD"] as const;
export type UnmuteBookingStatus = (typeof UNMUTE_BOOKING_STATUSES)[number];

/** The only thing a Peeps notification ever says about a private item (an Unmute booking, a private nudge). */
export const PRIVATE_NOTICE = { title: "Something is waiting for you", body: "Open Peeps to see it." } as const;
