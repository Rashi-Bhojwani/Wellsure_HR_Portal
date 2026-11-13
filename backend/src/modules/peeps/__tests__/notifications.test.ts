import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import * as notifyModule from "../../notifications/notifyEmployee";
import { peepsNotify } from "../notify";
import { clearPeepsSettings } from "./peepsTestKit";

// Peeps Stage 3, the notifications and tasks review. (1) An inventory: every Peeps file that notifies, mails, signals a socket or queues a job is
// listed here with what it sends; a new one fails until it is reviewed. (2) For each new Stage 3 event (badge, nudge tag, nudge review, asset request,
// a setting or membership change waiting for a director): one durable notification per event even when repeated, generic words, ids-only payload,
// only the recipient's own room, nothing confidential in the logs, and a link whose screen's API refuses someone else. (3) The helper itself:
// deduplication, retries, and refusal of a non-id payload.

const PEEPS_MODULES = ["recruitment", "insights", "autofill", "recognition", "assets", "peeps", "exits", "unmute", "leaveRules", "avatars", "helpdesk"];
// Reviewed: what each file sends, to whom, with what payload. Existing events keep the tests that already prove their privacy (named here).
const REVIEWED: Record<string, string> = {
  "assets/requests.ts": "assets.request.updated → the requester (generic; ids only; dedupe per request and state) — assetRequests.test.ts",
  "assets/service.ts": "assets.issued/returned/... → the holder (asset id only) — assets.test.ts",
  "avatars/service.ts": "peeps.avatar.removed → the owner (generic) — avatars tests",
  "exits/clearance.ts": "exits.clearance → the item owner (no reasons, no interview) — exits tests",
  "exits/interviews.ts": "exits.interview.* → participants only (\"Private exit interview\", no answers) — exits tests",
  "exits/resignations.ts": "exits.* → the employee, manager and audience (case id only) — exits tests",
  "exits/settings.ts": "exits audience refresh signal (empty payload) — exits tests",
  "exits/settlement.ts": "exits.letter.requested → the directors (generic) — exits tests",
  "helpdesk/categoryVisibility.ts": "audience refresh signal and moved-ticket notices to the new audience only — helpdesk visibility tests",
  "helpdesk/service.ts": "helpdesk ticket notices (Session A's module; Peeps adds the category audience) — helpdesk tests",
  "peeps/notify.ts": "the shared helper (this file's section 3)",
  "peeps/office.ts": "office.membership.waiting → the other directors (generic; change id) — this file",
  "peeps/settings.ts": "peeps.setting.waiting → the other directors (generic; version id) — this file",
  "recognition/badges.ts": "badges.received → the recipient (generic; award id; dedupe) — this file and recognition.test.ts",
  "recognition/nudgeTags.ts": "nudges.received / nudges.reviewed → the receiver (generic; ids; dedupe) — this file and nudgeTags.test.ts",
  "recruitment/interviews.ts": "recruitment.interview.assigned → panel members only (candidate name to the panel, never feedback or pay) — recruitment tests",
  "recruitment/mail.ts": "candidate e-mail, marked sensitive, from recruitment managers only; never pay — recruitment tests",
  "recruitment/retention.ts": "recruitment.access.changed signal (empty payload) to affected users — recruitment tests",
  "recruitment/settings.ts": "recruitment.access.changed signal (empty payload) — recruitment tests",
  "recruitment/signals.ts": "recruitment.changed signal (empty payload) to people allowed to see the candidate — recruitment tests",
  "unmute/service.ts": "peeps.waiting PRIVATE_NOTICE to booker and host only — unmute tests",
};
// Offers, joining links, conversions, joining documents and Insights send no notification at all (signals only, above); autofill queues the
// extraction id only (autofill.test.ts proves no value reaches the queue).

type Who = "director" | "director2" | "manager" | "emp" | "other" | "hr" | "developer";
let seq = 0;
const key = () => `notify-key-${Date.now()}-${(seq += 1)}`;

describe("Peeps notifications and tasks review", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<Who, string>;
  const get = (who: Who, url: string) => request(app).get(url).set(...authHeader(tok[who]));
  const post = (who: Who, url: string, body: object = {}) => request(app).post(url).set(...authHeader(tok[who])).send(body);
  const notesFor = (who: Who, type: string) => prisma.notification.findMany({ where: { userId: p[who].userId, type } });
  const versionIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.emp = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.other = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
  });

  afterAll(async () => {
    setSocketServer(null);
    vi.restoreAllMocks();
    const ids = Object.values(p).map((x) => x.employeeId);
    const reqIds = (await prisma.assetRequest.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await deleteWithDependents("AssetRequest", reqIds);
    const versions = await prisma.assetSettingVersion.findMany({ select: { id: true } });
    await purgeAppendOnly("AuditLog", { entityId: { in: [...versions.map((v) => v.id), ...reqIds, ...versionIds] } });
    await deleteWithDependents("AssetSettingVersion", versions.map((v) => v.id));
    await clearPeepsSettings();
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("inventory: every Peeps file that notifies, mails, signals or queues is reviewed (a new one fails until it is listed)", () => {
    const root = path.resolve(__dirname, "../..");
    const found: string[] = [];
    for (const m of PEEPS_MODULES) {
      const dir = path.join(root, m);
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const full = path.join(d, f);
          if (statSync(full).isDirectory()) { if (f !== "__tests__") walk(full); }
          else if (f.endsWith(".ts") && /notifyEmployee\(|peepsNotify\(|mailService\.send|getSocketServer\(\)|emit[A-Z][A-Za-z]*\(/.test(readFileSync(full, "utf8"))) found.push(path.relative(root, full).split(path.sep).join("/"));
        }
      };
      walk(dir);
    }
    const reviewed = Object.keys(REVIEWED);
    expect(found.sort()).toEqual(reviewed.sort());
  });

  it("badge and nudge tag: one notification each to the recipient's room, generic, ids only; repeating the same request adds none", async () => {
    const events: Array<{ room: string; event: string; args: unknown[] }> = [];
    const fake: RoomEmitter = { to: (room) => ({ emit: (event: string, ...args: unknown[]) => events.push({ room: String(room), event, args }) }) };
    setSocketServer(fake);
    const bk = key();
    const nk = key();
    try {
      for (let i = 0; i < 2; i += 1) {
        await post("manager", "/api/badges", { recipientEmployeeId: p.emp.employeeId, badgeCode: "TEAM_PLAYER", message: "DEMO-NOTIFY-REASON helped", idempotencyKey: bk });
        await post("director", "/api/nudges", { recipientEmployeeId: p.emp.employeeId, tagCode: "SCROLL_MASTER", idempotencyKey: nk });
      }
    } finally {
      setSocketServer(null);
    }
    const badges = await notesFor("emp", "badges.received");
    const tags = await notesFor("emp", "nudges.received");
    expect(badges).toHaveLength(1);
    expect(tags).toHaveLength(1);
    for (const n of [...badges, ...tags]) {
      expect(`${n.title} ${n.body}`).not.toMatch(/DEMO-NOTIFY-REASON|Team Player|Scroll Master/i);
      for (const v of Object.values((n.payload ?? {}) as Record<string, string>)) expect(v).toMatch(/^[A-Za-z0-9:_-]+$/);
    }
    expect(new Set(events.map((e) => e.room))).toEqual(new Set([`user:${p.emp.employeeId}`]));
    expect(JSON.stringify(events)).not.toContain("DEMO-NOTIFY-REASON");
  });

  it("nudge review decided: one notification to the receiver; the directors' task names nobody", async () => {
    const g = await post("director", "/api/nudges", { recipientEmployeeId: p.other.employeeId, tagCode: "SNOOZE_MODE", idempotencyKey: key() });
    await post("other", `/api/nudges/${g.body.id}/review`);
    const task = ((await get("director2", "/api/tasks/mine")).body as Array<{ type: string; employeeName: string | null; title: string; detail: string | null }>).find((t) => t.type === "NUDGE_REVIEW");
    expect(task).toMatchObject({ employeeName: null, detail: null });
    await post("director2", `/api/nudges/${g.body.id}/review/decide`, { outcome: "KEPT" });
    expect(await notesFor("other", "nudges.reviewed")).toHaveLength(1);
  });

  it("asset request updated: one notification per decision; the link's screen shows only the employee's own requests", async () => {
    await post("director", "/api/assets/settings/CATEGORIES", { items: [{ code: "DEMO_LAPTOP", label: "DEMO Laptop" }] });
    await post("director2", "/api/assets/settings/CATEGORIES/confirm", { version: 1 });
    const r = await post("emp", "/api/assets/requests", { categoryCode: "DEMO_LAPTOP", note: "DEMO-NOTIFY-NOTE", idempotencyKey: key() });
    await post("hr", `/api/assets/requests/${r.body.id}/decide`, { outcome: "APPROVED", note: "DEMO-HR-NOTE" });
    const notes = await notesFor("emp", "assets.request.updated");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.link).toBe("/app/my-assets");
    expect(JSON.stringify(notes)).not.toMatch(/DEMO-NOTIFY-NOTE|DEMO-HR-NOTE|Laptop/);
    expect(((await get("other", "/api/assets/requests/mine")).body as Array<{ id: string }>).some((x) => x.id === r.body.id)).toBe(false);
    expect((await get("other", "/api/assets/requests")).status).toBe(403);
  });

  it("a setting or membership change waiting: the other director is told once (not the one who entered it); the link's screen refuses non-directors", async () => {
    const entered = await post("director", "/api/peeps/settings/unmute.sessionMinutes", { value: 30 });
    versionIds.push((await prisma.peepsSettingVersion.findFirstOrThrow({ where: { key: "unmute.sessionMinutes", version: entered.body.pending.version } })).id);
    expect(await notesFor("director2", "peeps.setting.waiting")).toHaveLength(1);
    expect(await notesFor("director", "peeps.setting.waiting")).toHaveLength(0);
    const proposed = await post("director2", "/api/peeps/office/changes", { kind: "APPOINT", employeeId: p.other.employeeId, capabilities: [], reason: "DEMO-PRIVATE-REASON trial" });
    const waiting = await notesFor("director", "office.membership.waiting");
    expect(waiting).toHaveLength(1);
    expect(JSON.stringify(waiting)).not.toContain("DEMO-PRIVATE-REASON");
    await post("director2", `/api/peeps/office/changes/${proposed.body.id}/withdraw`, { reason: "DEMO done" });
    for (const who of ["emp", "hr", "manager", "developer"] as const) {
      expect((await get(who, "/api/peeps/office/members")).status, who).toBe(403);
      expect((await get(who, "/api/peeps/settings")).status, who).toBe(403);
    }
  });

  it("the helper: deduplicates by key, retries a failed delivery, logs only the type on final failure, and refuses a non-id payload", async () => {
    const link = "/app/recognition";
    expect(await peepsNotify(p.hr.employeeId, { type: "peeps.test", title: "Generic", body: "Generic", link }, { dedupeKey: "k1" })).toBe("sent");
    expect(await peepsNotify(p.hr.employeeId, { type: "peeps.test", title: "Generic", body: "Generic", link }, { dedupeKey: "k1" })).toBe("duplicate");
    expect(await notesFor("hr", "peeps.test")).toHaveLength(1);
    const real = notifyModule.notifyEmployee;
    let calls = 0;
    const spy = vi.spyOn(notifyModule, "notifyEmployee").mockImplementation(async (...args) => {
      calls += 1;
      if (calls < 3) throw new Error("DEMO-TRANSIENT");
      return real(...args);
    });
    expect(await peepsNotify(p.hr.employeeId, { type: "peeps.test", title: "Generic", body: "Generic", link }, { dedupeKey: "k2" })).toBe("sent");
    expect(calls).toBe(3);
    spy.mockImplementation(async () => { throw new Error("DEMO-DOWN"); });
    const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
    const lines: string[] = [];
    const original = stream.write.bind(stream);
    stream.write = (line: string) => { lines.push(String(line)); return original(line); };
    try {
      expect(await peepsNotify(p.hr.employeeId, { type: "peeps.test", title: "SECRET-TITLE", body: "SECRET-BODY", link }, { dedupeKey: "k3" })).toBe("failed");
    } finally {
      stream.write = original;
      spy.mockRestore();
    }
    expect(lines.join("\n")).toContain("peeps.notify.failed");
    expect(lines.join("\n")).not.toMatch(/SECRET-TITLE|SECRET-BODY/);
    await expect(peepsNotify(p.hr.employeeId, { type: "peeps.test", title: "x", body: "x", link, payload: { reason: "a free text reason" } })).rejects.toThrow(/must be an id/);
  });
});
