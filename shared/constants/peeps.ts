import type { PermissionKey } from "./permissions";

// Peeps core (docs/plans/PEEPS_PLAN.md, owner decisions D-28, D-29, D-30): the "Wellsure Office" workspace, its membership capabilities, and the
// director-controlled settings every Peeps module reads. Nothing here is a business value: every setting starts Not set, and a feature whose required
// settings are missing refuses to activate. The only default is the workspace's display name, which the owners chose ("Wellsure Office").

export const DEFAULT_OFFICE_NAME = "Wellsure Office";

/** Held by every active member (and by the directors, who hold every key): opens the workspace. */
export const OFFICE_WORKSPACE_KEY = "office.workspace" satisfies PermissionKey;

/** What a director can switch on or off for each member. Each capability is a set of ordinary permission keys, written as per-person grants. */
export const OFFICE_CAPABILITY_IDS = ["MANAGE_ASSETS", "PREPARE_SETTINGS", "GIVE_BADGES", "SEND_NUDGES"] as const;
export type OfficeCapabilityId = (typeof OFFICE_CAPABILITY_IDS)[number];

export interface OfficeCapability {
  id: OfficeCapabilityId;
  label: string;
  what: string;
  keys: readonly PermissionKey[];
}

export const OFFICE_CAPABILITIES: readonly OfficeCapability[] = [
  { id: "MANAGE_ASSETS", label: "Manage the asset register", what: "Add, issue, take back and transfer assets, and prepare the asset lists (a director confirms them).", keys: ["assets.view", "assets.manage", "assets.settings.manage"] },
  { id: "PREPARE_SETTINGS", label: "Prepare Peeps settings", what: "Enter the working settings (Unmute times, the badge catalogue and limits). A director confirms each one.", keys: ["peeps.settings.manage"] },
  { id: "GIVE_BADGES", label: "Give badges", what: "Give badges to any employee, while the badge settings allow the Wellsure Office to give them.", keys: ["badges.give"] },
  { id: "SEND_NUDGES", label: "Send private nudges", what: "Send a private note to any employee, while the nudge settings allow the Wellsure Office to send them.", keys: ["nudges.send"] },
];

export const officeCapability = (id: string): OfficeCapability | undefined => OFFICE_CAPABILITIES.find((c) => c.id === id);

/** The reason written on every grant the membership creates, so the Roles & Permissions screen says where it came from and a drift check can find them. */
export const OFFICE_GRANT_REASON = "Wellsure Office membership (managed on the Office members screen; do not change here)";

export const OFFICE_CHANGE_KINDS = ["APPOINT", "UPDATE", "REMOVE", "REPLACE"] as const;
export type OfficeChangeKind = (typeof OFFICE_CHANGE_KINDS)[number];

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
  "audience.badges",
  "badges.catalogue",
  "badges.limits",
  "badges.durationDays",
  "badges.revocation",
  "badges.display",
  "audience.nudges",
  "nudges.limits",
  "nudges.revocation",
] as const;
export type PeepsSettingKey = (typeof PEEPS_SETTING_KEYS)[number];

export interface PeepsSettingInfo {
  module: "office" | "assets" | "unmute" | "badges" | "nudges";
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
  "audience.badges": { module: "badges", label: "Who may give badges", what: "Managers (to their own team) and/or Wellsure Office members. Directors always may. HR never.", enteredBy: "DIRECTOR" },
  "badges.catalogue": { module: "badges", label: "Badge catalogue", what: "The badges that can be given.", enteredBy: "OFFICE" },
  "badges.limits": { module: "badges", label: "Badge limits", what: "How many badges one giver may give in a calendar month. Until set, no limit applies.", enteredBy: "OFFICE" },
  "badges.durationDays": { module: "badges", label: "Badge duration", what: "How many days a badge stays on a profile. Until set, badges do not expire.", enteredBy: "OFFICE" },
  "badges.revocation": { module: "badges", label: "Badge revocation", what: "Whether a giver (or a director) may revoke a badge. Until set, nobody can.", enteredBy: "DIRECTOR" },
  "badges.display": { module: "badges", label: "Where badges show", what: "Whether colleagues see a person's badges on their profile and in the directory. Until set, only the recipient sees them.", enteredBy: "DIRECTOR" },
  "audience.nudges": { module: "nudges", label: "Who may send private nudges", what: "Managers (to their own team) and/or Wellsure Office members. Directors always may. HR never.", enteredBy: "DIRECTOR" },
  "nudges.limits": { module: "nudges", label: "Nudge limits", what: "How many nudges one sender may send in a calendar month. Until set, no limit applies.", enteredBy: "DIRECTOR" },
  "nudges.revocation": { module: "nudges", label: "Nudge revocation", what: "Whether a sender (or a director) may withdraw a nudge. Until set, nobody can.", enteredBy: "DIRECTOR" },
};

export const PEEPS_REQUIRED: Record<"unmute" | "badges" | "nudges", readonly PeepsSettingKey[]> = {
  unmute: ["audience.unmute", "unmute.sessionMinutes", "unmute.availability", "unmute.bookingWindowDays", "unmute.minNoticeHours", "unmute.cancellationNoticeHours"],
  badges: ["audience.badges", "badges.catalogue"],
  nudges: ["audience.nudges"],
};

export const GIVER_KINDS = ["MANAGERS", "OFFICE"] as const;
export type GiverKind = (typeof GIVER_KINDS)[number];

export const UNMUTE_BOOKING_STATUSES = ["BOOKED", "CANCELLED", "RESCHEDULED", "COMPLETED", "NOT_HELD"] as const;
export type UnmuteBookingStatus = (typeof UNMUTE_BOOKING_STATUSES)[number];

/** The only thing a Peeps notification ever says about a private item (an Unmute booking, a private nudge). */
export const PRIVATE_NOTICE = { title: "Something is waiting for you", body: "Open Peeps to see it." } as const;
