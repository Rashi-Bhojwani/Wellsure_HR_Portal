import { z } from "zod";
import { getSetting, setSetting } from "../../lib/settings";
import { writeAuditLog } from "../../lib/audit";

// NT-08 (M session): the wording of three sign-in emails, editable by a director (System Settings → Emails). Only the subject, the heading and the
// paragraphs change; the greeting, the link button and its expiry are always added by the code, so an edit can never remove or replace the link.
// Plain text only: every value is HTML-escaped and a blank line starts a new paragraph. Placeholders: {{fullName}}, {{employeeCode}} (invitation).
// The security-change notice is not editable (it is the safeguard against a quiet take-over). Built-in wording is the default ("Default, change in
// settings"); every change is audited.

export const EMAIL_TEMPLATE_KEYS = ["INVITATION", "PASSWORD_RESET", "WELCOME"] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];
export interface EmailText {
  subject: string;
  heading: string;
  body: string;
}
export const SETTING_KEY = "email.templates";

export const DEFAULT_EMAIL_TEXT: Record<EmailTemplateKey, EmailText> = {
  INVITATION: {
    subject: "Welcome to Wellsure HR Portal — set your password",
    heading: "Set your password",
    body: "Your Wellsure HR Portal account has been created. Your Employee Code is {{employeeCode}}.\n\nSet your password to activate your account.",
  },
  PASSWORD_RESET: {
    subject: "Reset your Wellsure HR Portal password",
    heading: "Reset your password",
    body: "We received a request to reset your password. If you didn't request this, you can ignore this email.",
  },
  WELCOME: {
    subject: "Welcome to Wellsure HR Portal",
    heading: "You're all set",
    body: "Your password is set and your account is active. You can now sign in with your Employee Code and password.",
  },
};
export const EMAIL_TEMPLATE_LABEL: Record<EmailTemplateKey, string> = { INVITATION: "Invitation (set your password)", PASSWORD_RESET: "Password reset", WELCOME: "Welcome after the password is set" };
export const PLACEHOLDERS: Record<EmailTemplateKey, string[]> = { INVITATION: ["fullName", "employeeCode"], PASSWORD_RESET: ["fullName"], WELCOME: ["fullName"] };

const textSchema = z.object({ subject: z.string().trim().min(3).max(150), heading: z.string().trim().min(3).max(100), body: z.string().trim().min(3).max(2000) }).strict();
export const updateEmailTemplateSchema = z.object({ key: z.enum(EMAIL_TEMPLATE_KEYS), text: textSchema.nullable() }).strict(); // null = back to the built-in wording

type Stored = Partial<Record<EmailTemplateKey, EmailText>>;

export async function emailText(key: EmailTemplateKey): Promise<EmailText> {
  const stored = await getSetting<Stored>(SETTING_KEY, {});
  return stored[key] ?? DEFAULT_EMAIL_TEXT[key];
}

export async function listEmailTemplates() {
  const stored = await getSetting<Stored>(SETTING_KEY, {});
  return EMAIL_TEMPLATE_KEYS.map((key) => ({ key, label: EMAIL_TEMPLATE_LABEL[key], placeholders: PLACEHOLDERS[key], text: stored[key] ?? DEFAULT_EMAIL_TEXT[key], isDefault: !stored[key], defaultText: DEFAULT_EMAIL_TEXT[key] }));
}

export async function updateEmailTemplate(input: z.infer<typeof updateEmailTemplateSchema>, meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null }) {
  const unknown = input.text ? [...`${input.text.subject} ${input.text.heading} ${input.text.body}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).filter((p) => !PLACEHOLDERS[input.key].includes(p)) : [];
  if (unknown.length) {
    const { HttpError } = await import("../../middleware/errorHandler");
    throw new HttpError(400, `Unknown placeholder(s): ${[...new Set(unknown)].join(", ")}. This email can use: ${PLACEHOLDERS[input.key].join(", ")}.`, "VALIDATION_ERROR");
  }
  const stored = await getSetting<Stored>(SETTING_KEY, {});
  const before = stored[input.key] ?? null;
  const next: Stored = { ...stored };
  if (input.text) next[input.key] = input.text;
  else delete next[input.key];
  await setSetting(SETTING_KEY, next, meta.actorUserId);
  await writeAuditLog({ ...meta, action: "settings.email_template.updated", entityType: "SystemSetting", entityId: `${SETTING_KEY}.${input.key}`, before, after: input.text });
  return listEmailTemplates();
}

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fill = (s: string, values: Record<string, string>) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k: string) => values[k] ?? all);

/** The subject (placeholders filled, plain) and the HTML paragraphs (escaped, then filled with escaped values). */
export function render(text: EmailText, values: Record<string, string>): { subject: string; heading: string; paragraphsHtml: string } {
  const escapedValues = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, escapeHtml(v)]));
  const paragraphs = text.body.split(/\n\s*\n/).map((p) => `<p>${fill(escapeHtml(p.trim()), escapedValues).replace(/\n/g, "<br>")}</p>`);
  return { subject: fill(text.subject, values), heading: fill(escapeHtml(text.heading), escapedValues), paragraphsHtml: paragraphs.join("\n") };
}
