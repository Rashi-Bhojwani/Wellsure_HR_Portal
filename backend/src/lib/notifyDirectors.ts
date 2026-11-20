import { activeDirectors } from "./directorAuthority";
import { notifyEmployee } from "../modules/notifications/notifyEmployee";

// FIX (independent audit 2026-11-20): one in-app notice to every active director, for the two-director confirmations the audit fixes add (a sign-in email
// change, a director role change, a leave change, a director-on-director security action). Notice types under "director." and "security." are not in any
// switch-off category, so a director cannot mute them. Notices carry no pay figure.
export async function notifyDirectors(input: { type: string; title: string; body: string; link?: string | null; payload?: Record<string, unknown> }, opts: { exceptUserId?: string } = {}): Promise<void> {
  for (const d of await activeDirectors()) {
    if (opts.exceptUserId && d.userId === opts.exceptUserId) continue;
    await notifyEmployee(d.employeeId, input);
  }
}
