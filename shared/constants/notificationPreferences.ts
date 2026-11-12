// NT-09 (M session): the notification categories a person may switch off for themselves. Everything not listed here is always delivered:
// approvals and decisions, security alerts, payroll, helpdesk replies, a director's confirmations. A muted notice is not stored at all.
export const NOTIFICATION_CATEGORIES = [
  { key: "DOCUMENTS", label: "A document is shared with me", prefixes: ["document.added"] },
  { key: "TEAM_CHANGES", label: "Changes to my reporting line or my team", prefixes: ["team."] },
  { key: "LETTER_ASKS", label: "Someone asks for a letter I can prepare", prefixes: ["letters.ask.created"] },
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];
export const NOTIFICATION_CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((c) => c.key) as NotificationCategory[];

/** The category a notification type belongs to, or null when it can never be switched off. */
export function categoryOfType(type: string): NotificationCategory | null {
  for (const c of NOTIFICATION_CATEGORIES) if (c.prefixes.some((p) => type === p || (p.endsWith(".") && type.startsWith(p)))) return c.key;
  return null;
}
