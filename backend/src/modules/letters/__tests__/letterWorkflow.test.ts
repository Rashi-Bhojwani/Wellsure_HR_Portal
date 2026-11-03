import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LETTER_STARTERS } from "@shared/constants/letterStarters";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { lettersGenerateQueue } from "../../../jobs/lettersQueue";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { closePdfRenderer, renderPdf } from "../../../lib/pdf/renderer";
import { prisma } from "../../../lib/prisma";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { setSwitch } from "../../hrCapabilities/service";
import { payFreeProof } from "../template";
import { processLetterJob } from "../service";
import { SERIAL_SETTING_KEY } from "../workflow";

// A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, items 11 and 12): the starter gallery, per-template grants, the HR switch, the figure-letter lock,
// signatures, the serial, idempotent prepare and issue, void, scope. Made-up people and wording only.

type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const TEAM_ROLE = `TEST_A9_LTR_${Date.now()}`;

describe("A-9 G3 — letters: starters, grants, prepare, sign, issue, void", { timeout: 60_000 }, () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const templateIds: string[] = [];
  const segIds: string[] = [];
  let freeId: string; // a pay-free starter (confirmation)
  let payId: string; // a pay-carrying starter (offer)
  let serialBefore: unknown;
  const call = (who: string, method: "get" | "post" | "patch" | "put", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);
  const meta = () => ({ actorUserId: p.director!.userId, ipAddress: null, userAgent: null });
  const flip = (state: "ON" | "OFF" | "DEFAULT") => setSwitch({ capability: "ISSUE_LETTERS_NO_PAY", subject: { kind: "ROLE", roleCode: "HR_EXECUTIVE" }, state, reason: "A-9 test" } as never, meta());
  const prep = (who: string, body: object) => call(who, "post", "/api/letters/requests", { clientKey: randomUUID(), extraValues: {}, ...body });

  beforeAll(async () => {
    await renderPdf("<!doctype html><p>warm-up</p>", new Date("2026-01-01T00:00:00Z"));
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    p.emp2 = await createFullTestEmployee(org);
    await prisma.role.create({ data: { code: TEAM_ROLE, name: TEAM_ROLE, dataScope: "TEAM" } });
    await grantPermissions(TEAM_ROLE, ["letters.issue.nopay"]);
    p.lead = await createFullTestEmployee(org, { roleCode: TEAM_ROLE });
    p.report = await createFullTestEmployee(org, { managerId: p.lead.employeeId });
    p.outsider = await createFullTestEmployee(otherOrg);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    serialBefore = (await prisma.systemSetting.findUnique({ where: { key: SERIAL_SETTING_KEY } }))?.value;
    await prisma.systemSetting.deleteMany({ where: { key: SERIAL_SETTING_KEY } });
    // Starters may exist from an earlier local run of this file: start from none.
    const old = await prisma.letterTemplate.findMany({ where: { code: { in: ["STARTER_CONFIRMATION", "STARTER_OFFER"] } }, select: { id: true } });
    await deleteWithDependents("LetterTemplate", old.map((t) => t.id));
  }, 120_000);

  afterAll(async () => {
    const letters = await prisma.letterRequest.findMany({ where: { templateId: { in: templateIds } }, select: { generatedLetterId: true } });
    for (const l of letters) if (l.generatedLetterId) await lettersGenerateQueue().remove(l.generatedLetterId).catch(() => undefined);
    await deleteWithDependents("LetterTemplate", templateIds);
    await deleteWithDependents("EmployeeSegment", segIds);
    await purgeAppendOnly("HrCapabilitySwitch", { createdByUserId: p.director!.userId });
    await prisma.systemSetting.deleteMany({ where: { key: SERIAL_SETTING_KEY } });
    if (serialBefore !== undefined) await prisma.systemSetting.create({ data: { key: SERIAL_SETTING_KEY, value: serialBefore as object } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupTestRole(TEAM_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
    await closePdfRenderer();
  }, 120_000);

  it("the starters' own wording: every pay-free one passes the pay-free check, every pay-carrying one fails it (so it stays the directors')", () => {
    expect(LETTER_STARTERS).toHaveLength(11);
    for (const s of LETTER_STARTERS) expect(payFreeProof(s.bodyHtml, s.extraFields).ok, s.code).toBe(!s.carriesPay);
  });

  it("starters: only a director lists or loads them; loading is audited, arrives switched off, and twice is refused; the Developer and HR are refused", async () => {
    for (const who of ["hr", "dev", "emp"]) {
      expect((await call(who, "get", "/api/letters/starters")).status, who).toBe(403);
      expect((await call(who, "post", "/api/letters/starters/STARTER_OFFER/load")).status, who).toBe(403);
    }
    const list = await call("director", "get", "/api/letters/starters");
    expect(list.body.starters.find((s: { code: string }) => s.code === "STARTER_OFFER")).toMatchObject({ carriesPay: true, directorOnly: true, loaded: false });
    const loaded = await call("director", "post", "/api/letters/starters/STARTER_CONFIRMATION/load");
    expect([loaded.status, loaded.body.isActive]).toEqual([201, false]);
    freeId = loaded.body.id;
    templateIds.push(freeId);
    expect((await call("director", "post", "/api/letters/starters/STARTER_CONFIRMATION/load")).status).toBe(409);
    const pay = await call("director", "post", "/api/letters/starters/STARTER_OFFER/load");
    payId = pay.body.id;
    templateIds.push(payId);
    expect(await prisma.auditLog.count({ where: { action: "letters.starter.loaded", entityId: freeId } })).toBe(1);
    // Disabled until a director switches it on: nobody prepares from it.
    expect((await prep("director", { templateId: freeId, employeeIds: [p.emp!.employeeId], extraValues: { confirmedFrom: "2031-01-01" } })).status).toBe(400);
    for (const id of [freeId, payId]) expect((await call("director", "patch", `/api/letters/templates/${id}`, { isActive: true })).status).toBe(200);
  });

  it("grants: a director's only; never on a letter that can carry pay; HR prepares only what it was granted, and issues only with the issue grant", async () => {
    expect((await call("hr", "post", "/api/letters/grants", { templateId: freeId, action: "PREPARE", roleCode: "HR_EXECUTIVE" })).status).toBe(403);
    const onPay = await call("director", "post", "/api/letters/grants", { templateId: payId, action: "PREPARE", roleCode: "HR_EXECUTIVE" });
    expect([onPay.status, onPay.body.error.code]).toEqual([403, "PAY_LETTER_DIRECTOR_ONLY"]);
    const none = await prep("hr", { templateId: freeId, employeeIds: [p.emp!.employeeId], extraValues: { confirmedFrom: "2031-01-01" } });
    expect([none.status, none.body.error.code]).toEqual([403, "NO_LETTER_GRANT"]);
    const g = await call("director", "post", "/api/letters/grants", { templateId: freeId, action: "PREPARE", roleCode: "HR_EXECUTIVE" });
    expect(g.status).toBe(201);
    expect((await call("director", "post", "/api/letters/grants", { templateId: freeId, action: "PREPARE", roleCode: "HR_EXECUTIVE" })).body).toEqual({ id: g.body.id, created: false });
    expect((await call("hr", "get", "/api/letters/requests/templates")).body.templates.map((t: { id: string; mayIssue: boolean }) => [t.id, t.mayIssue])).toEqual([[freeId, false]]);
    const made = await prep("hr", { templateId: freeId, employeeIds: [p.emp!.employeeId], extraValues: { confirmedFrom: "2031-01-01" } });
    expect(made.status).toBe(201);
    const issued = await call("hr", "post", `/api/letters/requests/${made.body.requests[0].id}/issue`);
    expect([issued.status, issued.body.error.code]).toEqual([403, "NO_LETTER_GRANT"]);
    // HR can never prepare a letter that can carry pay, whatever it holds.
    const pay = await prep("hr", { templateId: payId, employeeIds: [p.emp!.employeeId], extraValues: { acceptBy: "2031-01-01" } });
    expect([pay.status, pay.body.error.code]).toEqual([403, "PAY_LETTER_DIRECTOR_ONLY"]);
  });

  it("a batch: the same submit twice prepares once; signatures before issue; issuing twice issues once; the serial is Not set, then counts up", async () => {
    const clientKey = randomUUID();
    const body = { clientKey, templateId: freeId, employeeIds: [p.emp!.employeeId, p.emp2!.employeeId], extraValues: { confirmedFrom: "2031-02-01" }, remarks: "made-up batch", signatoryEmployeeIds: [p.director!.employeeId] };
    const first = await call("director", "post", "/api/letters/requests", body);
    expect([first.status, first.body.created]).toEqual([201, 2]);
    const again = await call("director", "post", "/api/letters/requests", body);
    expect([again.status, again.body.created, again.body.batchId]).toEqual([200, 0, first.body.batchId]);
    expect(await prisma.letterRequest.count({ where: { batchId: first.body.batchId } })).toBe(2);
    const [a, b] = first.body.requests as Array<{ id: string }>;
    const early = await call("director", "post", `/api/letters/requests/${a!.id}/issue`);
    expect([early.status, early.body.error.code]).toEqual([409, "SIGNATURES_PENDING"]);
    expect((await call("hr", "post", `/api/letters/requests/${a!.id}/sign`, { position: 1 })).status).toBe(404); // not the signatory
    expect((await call("director", "post", `/api/letters/requests/${a!.id}/sign`, { position: 1 })).body.signatories[0].status).toBe("SIGNED");
    const one = await call("director", "post", `/api/letters/requests/${a!.id}/issue`);
    expect([one.status, one.body.status, one.body.serial], JSON.stringify(one.body)).toEqual([200, "ISSUED", null]); // Not set: no serial
    const twice = await call("director", "post", `/api/letters/requests/${a!.id}/issue`);
    expect(twice.body.letter.id).toBe(one.body.letter.id);
    expect(await prisma.letterRequest.count({ where: { id: a!.id, generatedLetterId: { not: null } } })).toBe(1);
    expect((await call("hr", "put", "/api/letters/serial", { prefix: "X-", nextNumber: 1 })).status).toBe(403);
    expect((await call("director", "put", "/api/letters/serial", { prefix: "A9/", nextNumber: 7 })).status).toBe(200);
    await call("director", "post", `/api/letters/requests/${b!.id}/sign`, { position: 1 });
    expect((await call("director", "post", `/api/letters/requests/${b!.id}/issue`)).body.serial).toBe("A9/7");
    expect((await call("director", "get", "/api/letters/serial")).body.serial).toEqual({ prefix: "A9/", nextNumber: 8 });
    expect((await call("director", "get", `/api/letters/requests?status=ISSUED&batchId=${first.body.batchId}`)).body.total).toBe(2);
  });

  it("void: never deleted; a prepared letter by whoever may prepare it; an issued one only by a director, which archives the person's copy and keeps the letter", async () => {
    await call("director", "post", "/api/letters/grants", { templateId: freeId, action: "PREPARE", roleCode: "HR_EXECUTIVE" });
    const hrMade = await prep("hr", { templateId: freeId, employeeIds: [p.emp!.employeeId], extraValues: { confirmedFrom: "2031-03-01" } });
    const id = hrMade.body.requests[0].id as string;
    expect((await call("hr", "post", `/api/letters/requests/${id}/void`, { reason: "x" })).status).toBe(400);
    expect((await call("hr", "post", `/api/letters/requests/${id}/void`, { reason: "wrong date typed" })).body).toMatchObject({ status: "VOID", voidReason: "wrong date typed" });
    expect((await call("hr", "post", `/api/letters/requests/${id}/void`, { reason: "again" })).status).toBe(409);
    expect(await prisma.letterRequest.count({ where: { id } })).toBe(1);

    const d = await prep("director", { templateId: freeId, employeeIds: [p.emp!.employeeId], extraValues: { confirmedFrom: "2031-03-01" } });
    const done = await call("director", "post", `/api/letters/requests/${d.body.requests[0].id}/issue`);
    expect(await processLetterJob(done.body.letter.id)).toEqual({ status: "GENERATED" });
    // HR sees only the templates it was granted; this one it may prepare, so the request is visible, but taking back an issued letter is the directors'.
    const hrVoid = await call("hr", "post", `/api/letters/requests/${done.body.id}/void`, { reason: "should not work" });
    expect([hrVoid.status, hrVoid.body.error.code]).toEqual([403, "DIRECTOR_ONLY"]);
    const v = await call("director", "post", `/api/letters/requests/${done.body.id}/void`, { reason: "issued to the wrong person" });
    expect(v.body.status).toBe("VOID");
    const letter = await prisma.generatedLetter.findUniqueOrThrow({ where: { id: done.body.letter.id }, include: { employeeDocument: true } });
    expect(letter.status).toBe("GENERATED"); // the legal record stays
    expect(letter.employeeDocument?.archivedAt).not.toBeNull(); // the person no longer sees it
  });

  it("scope and visibility: a team-scoped holder reaches only their own people; HR never sees a figure letter's request; an employee and the Developer are refused", async () => {
    await call("director", "post", "/api/letters/grants", { templateId: freeId, action: "PREPARE", roleCode: TEAM_ROLE });
    const out = await prep("lead", { templateId: freeId, employeeIds: [p.outsider!.employeeId], extraValues: { confirmedFrom: "2031-04-01" } });
    expect([out.status, out.body.error?.code]).toEqual([404, "NOT_FOUND"]);
    expect((await prep("lead", { templateId: freeId, employeeIds: [p.report!.employeeId], extraValues: { confirmedFrom: "2031-04-01" } })).status).toBe(201);
    const leadList = await call("lead", "get", "/api/letters/requests?pageSize=200");
    expect(leadList.body.rows.every((r: { employee: { id: string } }) => [p.lead!.employeeId, p.report!.employeeId].includes(r.employee.id))).toBe(true);

    const fig = await prep("director", { templateId: payId, employeeIds: [p.emp!.employeeId], extraValues: { acceptBy: "2031-05-01" } });
    expect(fig.status).toBe(201);
    const figId = fig.body.requests[0].id as string;
    expect((await call("hr", "get", `/api/letters/requests/${figId}`)).status).toBe(404);
    expect((await call("hr", "get", "/api/letters/requests?pageSize=200")).body.rows.map((r: { id: string }) => r.id)).not.toContain(figId);
    expect((await call("hr", "get", `/api/letters/requests/${figId}/preview`)).status).toBe(404);

    for (const who of ["emp", "dev"]) {
      expect((await call(who, "get", "/api/letters/requests")).status, who).toBe(403);
      expect((await call(who, "get", `/api/letters/requests/${figId}`)).status, who).toBe(403);
      expect((await prep(who, { templateId: freeId, employeeIds: [p.emp!.employeeId] })).status, who).toBe(403);
      expect((await call(who, "post", `/api/letters/requests/${figId}/issue`)).status, who).toBe(403);
      expect((await call(who, "post", `/api/letters/requests/${figId}/void`, { reason: "nope nope" })).status, who).toBe(403);
    }
    expect((await call("dev", "get", "/api/letters/requests/to-sign")).status).toBe(403);
    expect((await call("emp", "get", "/api/letters/requests/to-sign")).body.requests).toEqual([]);
  });

  it("a segment as the audience is resolved on the server; switching HR's letters off takes effect on the very next request", async () => {
    const seg = await call("director", "post", "/api/employee-segments", { kind: "LIST", name: `A9 letters ${Date.now()}`, employeeIds: [p.emp!.employeeId, p.emp2!.employeeId] });
    segIds.push(seg.body.id);
    const viaSeg = await prep("director", { templateId: freeId, segmentId: seg.body.id, extraValues: { confirmedFrom: "2031-06-01" } });
    expect([viaSeg.status, viaSeg.body.created]).toEqual([201, 2]);
    expect((await prep("director", { templateId: freeId, segmentId: seg.body.id, employeeIds: [p.emp!.employeeId] })).status).toBe(400); // one or the other

    expect((await call("hr", "get", "/api/letters/requests")).status).toBe(200);
    await flip("OFF");
    try {
      expect((await call("hr", "get", "/api/letters/requests")).status).toBe(403);
      expect((await prep("hr", { templateId: freeId, employeeIds: [p.emp!.employeeId], extraValues: { confirmedFrom: "2031-06-01" } })).status).toBe(403);
    } finally {
      await flip("DEFAULT");
    }
    expect((await call("hr", "get", "/api/letters/requests")).status).toBe(200);
  });
});
