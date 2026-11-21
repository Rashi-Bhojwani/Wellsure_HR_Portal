import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";

// FIX-C3/H5/M7 (independent audit 2026-11-20). The Developer role builds and runs the system: it keeps view and diagnostics only. Beyond removing every write
// permission (shared/constants/sensitiveData.ts, DEVELOPER_WRITE_FORBIDDEN), every state-changing request from someone holding the Developer role (and not a
// director) is refused with 403 at sign-in check time (middleware/authenticate.ts), whatever the route's own gate says, EXCEPT the person's own self-service
// as an ordinary employee listed here: their own account, profile, leave, attendance, requests, notifications, feed and helpdesk tickets. Each entry is the
// person acting on their OWN record; the route's own service still checks that. A route added later is refused for the Developer until it is listed here.
export const DEVELOPER_SELF_SERVICE: ReadonlyArray<{ method: string; path: RegExp; why: string }> = [
  { method: "*", path: /^\/api\/auth\//, why: "their own sign-in, sessions, password and two-step sign-in" },
  { method: "PATCH", path: /^\/api\/employees\/me$/, why: "their own profile (a change waits for HR where the field needs it)" },
  { method: "*", path: /^\/api\/employees\/me\/photo$/, why: "their own photo" },
  { method: "POST", path: /^\/api\/leave\/requests$/, why: "apply for their own leave" },
  { method: "POST", path: /^\/api\/leave\/requests\/[^/]+\/cancel$/, why: "cancel their own leave request" },
  { method: "*", path: /^\/api\/notifications\//, why: "their own notifications and preferences" },
  { method: "POST", path: /^\/api\/engage\/(posts|kudos|polls|polls\/vote)$/, why: "the social feed" },
  { method: "POST", path: /^\/api\/engage\/posts\/[^/]+\/(react|comments|close-poll)$/, why: "the social feed (their own poll)" },
  { method: "POST", path: /^\/api\/documents\/(me|company)\/[^/]+\/download$/, why: "download a company document or their own document" },
  { method: "POST", path: /^\/api\/document-acks\/[^/]+\/acknowledge$/, why: "acknowledge a company document" },
  { method: "POST", path: /^\/api\/helpdesk\/tickets$/, why: "raise a ticket (and the support queue: helpdesk.manage)" },
  { method: "*", path: /^\/api\/helpdesk\/tickets\/[^/]+(\/(messages|reopen|move))?$/, why: "the support queue (helpdesk.manage); sensitive categories stay closed" },
  { method: "POST", path: /^\/api\/helpdesk\/attachments\/[^/]+\/(download|content)$/, why: "a ticket attachment the queue may open" },
  { method: "*", path: /^\/api\/delegations\/mine(\/[^/]+\/revoke)?$/, why: "their own delegation of their own approvals" },
  { method: "*", path: /^\/api\/feedback(\/[^/]+\/(replies|close))?$/, why: "their own feedback" },
  { method: "POST", path: /^\/api\/(overtime|wfh-requests|encashment-requests)\/mine(\/[^/]+\/withdraw)?$/, why: "their own request (decided by someone else)" },
  { method: "POST", path: /^\/api\/attendance\/me\//, why: "their own regularization and remote check-in" },
  { method: "POST", path: /^\/api\/exits\/resignations(\/[^/]+\/withdraw)?$/, why: "their own resignation" },
  { method: "POST", path: /^\/api\/unmute\/bookings(\/[^/]+\/(cancel|reschedule))?$/, why: "their own booking" },
  { method: "POST", path: /^\/api\/nudges$/, why: "send a nudge" },
  { method: "POST", path: /^\/api\/badges$/, why: "give a badge (peer recognition, like kudos)" },
  { method: "POST", path: /^\/api\/assets\/mine\/[^/]+\/acknowledge$/, why: "acknowledge an asset issued to them" },
  { method: "POST", path: /^\/api\/assets\/requests(\/[^/]+\/cancel)?$/, why: "their own asset request (decided by someone else)" },
  { method: "POST", path: /^\/api\/leave-documents\/requests\/[^/]+$/, why: "a document for their own leave request (only the employee attaches, checked in the service)" },
  { method: "*", path: /^\/api\/avatars\/me(\/surprise)?$/, why: "their own avatar" },
  { method: "PUT", path: /^\/api\/employee-extras\/grid-columns\/[^/]+$/, why: "their own grid column choice" },
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** True when this request must be refused because the caller holds the Developer role (and is not a director) and it is a write outside self-service. */
export function developerWriteRefused(roleCodes: readonly string[], method: string, fullPath: string): boolean {
  if (!roleCodes.includes(DEVELOPER_ROLE_CODE) || roleCodes.includes("SUPER_ADMIN")) return false;
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  const path = fullPath.split("?")[0]!.replace(/\/+$/, "");
  return !DEVELOPER_SELF_SERVICE.some((e) => (e.method === "*" || e.method === method.toUpperCase()) && e.path.test(path));
}
