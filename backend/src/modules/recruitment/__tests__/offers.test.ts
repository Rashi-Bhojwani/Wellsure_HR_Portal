import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import request from "supertest";
import pino from "pino";
import { redis } from "../../../lib/redis";
import { logger } from "../../../lib/logger";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { cleanupFullTestEmployee } from "../../employee/__tests__/employeeTestHelpers";
import { appoint, removeMember } from "../../peeps/__tests__/peepsTestKit";
import { readAcceptedOfferForPayroll } from "../offers";
import { fixture, app, prisma } from "./fixtures";

// C-4B: offers, director-only pay (offer compensation and candidate expected pay), joiner links, conversion and referrals.
// Every fixture value is fictional and labelled DEMO.

const PAY = "4321987.65"; // DEMO figure; must never appear for anyone but a director
const EXPECTED = "3999111.25"; // DEMO figure
const PDF = Buffer.from("%PDF-1.4\n% DEMO joining document\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
type F = Awaited<ReturnType<typeof fixture>>;
type Who = keyof F["people"];
const ALL: Who[] = ["director", "office", "hr", "manager", "employee", "interviewer", "developer"];

describe("DEMO C-4B offers, pay, joining links, conversion and referrals", () => {
  let f: F;
  const converted: string[] = [];
  let jobId = "";
  const clearLimits = async () => { const keys = await redis.keys("ratelimit:joiner:*"); if (keys.length) await redis.del(...keys); };
  const pub = (path: string) => request(app).get(`/api/joining/${path}`);
  const upload = (token: string, type: string, body: Buffer, name: string, mime: string) => request(app).post(`/api/joining/${token}/documents/${type}`).attach("file", body, { filename: name, contentType: mime });

  /** A candidate with an active application on the open DEMO job. */
  async function candidate(label = "DEMO C4B candidate") {
    const c = await f.call("director", "post", "/candidates", { name: label, email: `demo.${randomUUID()}@example.invalid`, phone: null, source: "DEMO", consentConfirmed: true, consentRecordedAt: new Date().toISOString() });
    expect(c.status).toBe(201);
    const a = await f.call("director", "post", `/candidates/${c.body.id}/applications`, { jobId });
    expect(a.status).toBe(201);
    return { candidateId: c.body.id as string, applicationId: a.body.id as string };
  }
  const terms = (applicationId: string) => ({ applicationId, title: "DEMO Analyst", departmentId: f.org.departmentId, locationId: f.org.locationId, reportingManagerId: null, employmentType: "PERMANENT", joiningDate: "2098-06-01" });
  const move = (who: Who, id: string, to: string, version: number, extra: object = {}) => f.call(who, "post", `/offers/${id}/state`, { to, version, ...extra });
  /** Draft → pay → proposed → issued → accepted, as the Office records states and a director issues. */
  async function acceptedOffer(label?: string) {
    const { candidateId, applicationId } = await candidate(label);
    const o = await f.call("office", "post", "/offers", terms(applicationId));
    expect(o.status).toBe(201);
    expect((await f.call("director", "put", `/offers/${o.body.id}/compensation`, { amount: PAY, period: "ANNUAL", version: 0 })).status).toBe(200);
    expect((await move("office", o.body.id, "PROPOSED", 1)).status).toBe(200);
    expect((await move("director", o.body.id, "ISSUED", 2, { letterSentThroughLetters: true, letterReference: "DEMO-LTR-1" })).status).toBe(200);
    expect((await move("office", o.body.id, "ACCEPTED", 3)).status).toBe(200);
    return { candidateId, applicationId, offerId: o.body.id as string };
  }
  async function link(candidateId: string) {
    const r = await f.call("hr", "post", `/candidates/${candidateId}/joiner-links`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; token: string; url: string; expiresAt: string };
  }
  const conversionBody = (code: string) => ({ employeeCode: code, designationId: f.org.designationId, attendanceCapture: "MANUAL", personal: { dateOfBirth: "1990-01-01", gender: "OTHER", personalEmail: `demo.${randomUUID().slice(0, 8)}@gmail.com`, mobile: "9000000000", currentAddress: "DEMO address", permanentAddress: "DEMO address", emergencyContactName: "DEMO contact", emergencyContactPhone: "9000000001", emergencyContactRelation: "DEMO" } });

  beforeAll(async () => {
    f = await fixture();
    await f.setting("sources", [{ code: "DEMO", label: "DEMO" }]);
    await f.setting("retention", { days: 30 });
    await f.setting("officeAudience", { officeManages: true });
    await appoint(f.people.office.employeeId, ["MANAGE_RECRUITMENT"], f.people.director, f.people.second);
    const pipeline = await f.call("director", "post", "/pipelines", { name: "DEMO", stages: [{ code: "DEMO", label: "DEMO applied" }], reason: "DEMO" });
    const job = await f.call("director", "post", "/jobs", { title: "DEMO C4B job", departmentId: f.org.departmentId, locationId: f.org.locationId, employmentType: "PERMANENT", description: "DEMO", pipelineId: pipeline.body.id });
    jobId = job.body.id;
    await f.call("director", "post", `/jobs/${jobId}/state`, { status: "OPEN", reason: "DEMO" });
  });
  beforeEach(clearLimits);
  afterAll(async () => {
    await clearLimits();
    const rows = await prisma.recruitmentConversion.findMany({ where: { employeeId: { in: converted } }, select: { id: true } });
    await deleteWithDependents("RecruitmentConversion", rows.map((r) => r.id));
    for (const e of converted) await cleanupFullTestEmployee(e);
    await removeMember(f.people.office.employeeId, f.people.director, f.people.second);
    await f.cleanup();
  });

  it("every C-4B route: anonymous 401 and Developer 403; the enumeration matches the router source", async () => {
    const { candidateId, offerId } = await acceptedOffer();
    const routes: Array<[method: "get" | "post" | "put", path: string, body: object]> = [
      ["get", "/offer-status", {}], ["get", "/offers", {}], ["post", "/offers", terms("x")], ["get", `/offers/${offerId}`, {}], ["post", `/offers/${offerId}/state`, { to: "PROPOSED", version: 0 }],
      ["get", `/offers/${offerId}/compensation`, {}], ["put", `/offers/${offerId}/compensation`, { amount: "1.00", period: "ANNUAL", version: 0 }],
      ["get", `/candidates/${candidateId}/expected-pay`, {}], ["put", `/candidates/${candidateId}/expected-pay`, { value: null }],
      ["get", `/candidates/${candidateId}/joining`, {}], ["post", `/candidates/${candidateId}/joiner-links`, {}], ["post", "/joiner-links/x/revoke", {}],
      ["post", `/candidates/${candidateId}/joining-exceptions`, { typeCode: "DEMO_ID", reason: "DEMO" }], ["get", "/joining-documents/x/file", {}],
      ["get", `/offers/${offerId}/conversion`, {}], ["post", `/offers/${offerId}/conversion`, conversionBody("X")],
      ["get", "/referrals/status", {}], ["get", "/referrals/jobs", {}], ["get", "/referrals/mine", {}], ["post", "/referrals", { jobId, name: "DEMO", email: null, phone: "+91 90000 00000", consentConfirmed: true }],
      ["get", "/referrals", {}], ["post", "/referrals/x/accept", { source: "DEMO" }], ["post", "/referrals/x/close", {}],
    ];
    const source = readFileSync(new URL("../offerRoutes.ts", import.meta.url), "utf8");
    const signatures = [...source.matchAll(/offerRouter\.(get|post|put)\("([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    const norm = routes.map(([m, p]) => `${m} ${p.replace(/\/(offers|candidates|joiner-links|joining-documents|referrals)\/(?!status|jobs|mine)[^/]+/, "/$1/:id")}`).sort();
    expect(norm).toEqual(signatures);
    for (const [method, path, body] of routes) {
      expect((await request(app)[method]("/api/recruitment" + path).send(body)).status, `${method} ${path} anonymous`).toBe(401);
      expect((await f.call("developer", method, path, body)).status, `${method} ${path} Developer`).toBe(403);
    }
  });

  it("route matrix: employee, manager, HR (onboarding default ON), Office member, non-member and director get the expected statuses", async () => {
    const { candidateId, offerId } = await acceptedOffer();
    const expectations: Array<[string, "get" | "put", string, Partial<Record<Who, number>>]> = [
      ["status", "get", "/offer-status", { director: 200, office: 200, hr: 200, manager: 200, employee: 200, interviewer: 200 }],
      ["list", "get", "/offers", { director: 200, office: 200, hr: 200, manager: 403, employee: 403, interviewer: 403 }],
      ["detail", "get", `/offers/${offerId}`, { director: 200, office: 200, hr: 200, manager: 404, employee: 404, interviewer: 404 }],
      ["pay", "get", `/offers/${offerId}/compensation`, { director: 200, office: 403, hr: 403, manager: 403, employee: 403, interviewer: 403 }],
      ["expected", "get", `/candidates/${candidateId}/expected-pay`, { director: 200, office: 403, hr: 403, manager: 403, employee: 403, interviewer: 403 }],
      ["joining", "get", `/candidates/${candidateId}/joining`, { director: 200, office: 403, hr: 200, manager: 403, employee: 403, interviewer: 403 }],
      ["prefill", "get", `/offers/${offerId}/conversion`, { director: 200, office: 403, hr: 200, manager: 403, employee: 403, interviewer: 403 }],
      ["referral list", "get", "/referrals", { director: 200, office: 200, hr: 403, manager: 403, employee: 403, interviewer: 403 }],
      ["my referrals", "get", "/referrals/mine", { director: 200, office: 200, hr: 200, manager: 200, employee: 200, interviewer: 200 }],
    ];
    for (const [label, method, path, want] of expectations) for (const [who, status] of Object.entries(want)) expect((await f.call(who as Who, method, path)).status, `${label} as ${who}`).toBe(status);
    // Writes: only the Office/directors draft; only directors set pay; employees and managers cannot touch another's records.
    const { applicationId } = await candidate();
    for (const who of ["hr", "manager", "employee", "interviewer"] as Who[]) expect((await f.call(who, "post", "/offers", terms(applicationId))).status, `create as ${who}`).toBe(403);
    for (const who of ["office", "hr", "manager", "employee"] as Who[]) expect((await f.call(who, "put", `/candidates/${candidateId}/expected-pay`, { value: { amount: "1.00", period: "ANNUAL" } })).status, `expected pay write as ${who}`).toBe(403);
    // HR onboarding switched OFF by a director: joining refused on the next request.
    await prisma.hrCapabilitySwitch.create({ data: { capability: "RUN_ONBOARDING", subjectKind: "USER", subjectKey: f.people.hr.userId, state: "OFF", effectiveFrom: new Date(Date.now() - 1000), reason: "DEMO switch", createdByUserId: f.people.director.userId } });
    expect((await f.call("hr", "get", `/candidates/${candidateId}/joining`)).status).toBe(403);
    expect((await f.call("hr", "get", "/offers")).status).toBe(403);
    await prisma.hrCapabilitySwitch.create({ data: { capability: "RUN_ONBOARDING", subjectKind: "USER", subjectKey: f.people.hr.userId, state: "DEFAULT", effectiveFrom: new Date(), reason: "DEMO switch", createdByUserId: f.people.director.userId } });
    expect((await f.call("hr", "get", `/candidates/${candidateId}/joining`)).status).toBe(200);
  });

  it("offer pay and expected pay reach directors only: never in lists, details, counts, audit rows, notifications, logs or other roles' responses", async () => {
    const { candidateId, offerId } = await acceptedOffer("DEMO pay probe");
    expect((await f.call("director", "put", `/candidates/${candidateId}/expected-pay`, { value: { amount: EXPECTED, period: "ANNUAL" } })).status).toBe(200);
    const pay = await f.call("director", "get", `/offers/${offerId}/compensation`);
    expect(pay.body.value).toEqual({ amount: PAY, period: "ANNUAL", currency: "INR" });
    expect((await f.call("director", "get", `/candidates/${candidateId}/expected-pay`)).body.value.amount).toBe(EXPECTED);
    const probes = [PAY, EXPECTED, PAY.replace(".", ""), "4321987", "3999111"];
    const paths = ["/offers", `/offers/${offerId}`, `/candidates/${candidateId}`, "/candidates", `/candidates/${candidateId}/joining`, `/offers/${offerId}/conversion`, `/candidates?q=DEMO%20pay%20probe`, "/offer-status", "/referrals/mine"];
    for (const who of ALL) for (const path of paths) {
      const r = await f.call(who, "get", path);
      const text = JSON.stringify(r.body);
      for (const p of probes) expect(text.includes(p), `${who} ${path} carries pay`).toBe(false);
      if (who !== "director") expect(text.includes('"pay"'), `${who} ${path} carries pay metadata`).toBe(false);
    }
    // Ciphertext only at rest; audit rows and notifications carry no figure.
    const raw = await prisma.$queryRaw<Array<{ t: string }>>`SELECT encode(value_encrypted,'escape') AS t FROM recruitment_offer_compensation WHERE offer_id=${offerId}`;
    expect(raw[0]!.t.includes(PAY)).toBe(false);
    const audits = await prisma.auditLog.findMany({ where: { entityId: { in: [offerId, candidateId] } } });
    expect(audits.some((a) => a.action === "recruitment.offer.compensation.opened")).toBe(true);
    expect(audits.some((a) => a.action === "recruitment.expected_pay.opened")).toBe(true);
    for (const p of probes) expect(JSON.stringify(audits).includes(p)).toBe(false);
    for (const p of probes) expect(await prisma.notification.count({ where: { OR: [{ body: { contains: p } }, { title: { contains: p } }] } })).toBe(0);
    // Free text next to an offer may not carry pay.
    const { applicationId } = await candidate();
    expect((await f.call("office", "post", "/offers", { ...terms(applicationId), title: "DEMO Analyst 45000 per month" })).status).toBe(400);
    // The payroll interface: director-only, audited, read-only.
    await expect(readAcceptedOfferForPayroll(f.people.hr.userId, "none")).rejects.toMatchObject({ status: 403 });
  });

  it("stage 2: no log line written during offer-pay and expected-pay requests carries a pay figure", async () => {
    const { candidateId, offerId } = await acceptedOffer("DEMO log probe");
    const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
    const lines: string[] = [];
    const original = stream.write.bind(stream);
    stream.write = (line: string) => { lines.push(String(line)); return original(line); };
    try {
      expect((await f.call("director", "put", `/candidates/${candidateId}/expected-pay`, { value: { amount: EXPECTED, period: "MONTHLY" } })).status).toBe(200);
      expect((await f.call("director", "get", `/candidates/${candidateId}/expected-pay`)).body.value.amount).toBe(EXPECTED);
      expect((await f.call("director", "get", `/offers/${offerId}/compensation`)).body.value.amount).toBe(PAY);
      for (const who of ["office", "hr", "employee", "developer"] as Who[]) {
        await f.call(who, "get", `/offers/${offerId}/compensation`);
        await f.call(who, "put", `/candidates/${candidateId}/expected-pay`, { value: { amount: EXPECTED, period: "ANNUAL" } });
      }
      const draft = await candidate("DEMO log probe two");
      const o = await f.call("office", "post", "/offers", terms(draft.applicationId));
      expect((await f.call("director", "put", `/offers/${o.body.id}/compensation`, { amount: PAY, period: "ANNUAL", version: 0 })).status).toBe(200);
    } finally {
      stream.write = original;
    }
    expect(lines.length).toBeGreaterThan(5); // the request log really was captured
    for (const p of [PAY, EXPECTED, "4321987", "3999111", PAY.replace(".", ""), EXPECTED.replace(".", "")]) expect(lines.filter((l) => l.includes(p)), `log lines carrying ${p}`).toEqual([]);
  });

  it("states: approval optional (default off), only directors approve/issue, issue needs pay and the letters confirmation, events append-only", async () => {
    const { applicationId } = await candidate();
    const o = await f.call("office", "post", "/offers", terms(applicationId));
    expect((await f.call("office", "post", "/offers", terms(applicationId))).status).toBe(409); // one live offer per application
    expect((await move("office", o.body.id, "PROPOSED", 0)).body.approvalRequired).toBe(false);
    expect((await move("director", o.body.id, "APPROVED", 1)).status).toBe(409); // approval off: no approval step
    expect((await move("office", o.body.id, "ISSUED", 1, { letterSentThroughLetters: true })).status).toBe(403);
    expect((await move("director", o.body.id, "ISSUED", 1, { letterSentThroughLetters: true })).status).toBe(409); // no pay yet
    await f.call("director", "put", `/offers/${o.body.id}/compensation`, { amount: "100.50", period: "MONTHLY", version: 0 });
    expect((await move("director", o.body.id, "ISSUED", 2)).status).toBe(400); // letters flow not confirmed
    expect((await move("director", o.body.id, "ISSUED", 2, { letterSentThroughLetters: true })).status).toBe(200);
    expect((await move("director", o.body.id, "ISSUED", 2, { letterSentThroughLetters: true })).status).toBe(200); // retried request
    expect((await f.call("director", "put", `/offers/${o.body.id}/compensation`, { amount: "1.00", period: "MONTHLY", version: 1 })).status).toBe(409);
    expect((await move("office", o.body.id, "WITHDRAWN", 3)).status).toBe(400); // reason required
    expect((await move("office", o.body.id, "WITHDRAWN", 3, { reason: "DEMO candidate chose another path" })).status).toBe(200);
    await expect(prisma.$executeRaw`UPDATE recruitment_offer_events SET reason='x' WHERE offer_id=${o.body.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM recruitment_offer_events WHERE offer_id=${o.body.id}`).rejects.toThrow();
    // A non-director cannot write pay even directly in the database.
    await expect(prisma.recruitmentOfferCompensation.update({ where: { offerId: o.body.id }, data: { changedByUserId: f.people.office.userId } })).rejects.toThrow(/DIRECTOR_ONLY/);
    // With approval switched on, a proposed offer needs a director's approval before issue.
    await f.setting("offerApproval", { required: true });
    const second = await candidate();
    const p = await f.call("office", "post", "/offers", terms(second.applicationId));
    await f.call("director", "put", `/offers/${p.body.id}/compensation`, { amount: "100.00", period: "MONTHLY", version: 0 });
    expect((await move("office", p.body.id, "PROPOSED", 1)).body.approvalRequired).toBe(true);
    expect((await move("director", p.body.id, "ISSUED", 2, { letterSentThroughLetters: true })).status).toBe(409);
    expect((await move("office", p.body.id, "APPROVED", 2)).status).toBe(403);
    expect((await move("director", p.body.id, "APPROVED", 2)).status).toBe(200);
    await f.setting("offerApproval", { required: false });
  });

  it("joiner links refuse until lifetime and document types are chosen; then reuse, expiry, revocation, wrong type and oversize are refused; a link reveals nothing", async () => {
    const { candidateId } = await acceptedOffer("DEMO link person");
    expect((await f.call("hr", "post", `/candidates/${candidateId}/joiner-links`, {})).body.error.code).toBe("RECRUITMENT_NOT_SET");
    await f.setting("joinerLinkLifetime", { hours: 48 });
    expect((await f.call("hr", "post", `/candidates/${candidateId}/joiner-links`, {})).body.error.code).toBe("RECRUITMENT_NOT_SET");
    await f.setting("joinerDocumentTypes", [{ code: "DEMO_ID", label: "DEMO identity proof", kind: "IDENTITY", allowedMimeTypes: ["application/pdf"], maxMb: 0.001 }, { code: "DEMO_BANK", label: "DEMO bank proof", kind: "BANK", allowedMimeTypes: ["application/pdf", "image/png"], maxMb: 1 }]);
    const l = await link(candidateId);
    expect(l.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await prisma.recruitmentJoinerLink.count({ where: { tokenHash: l.token } })).toBe(0); // only the hash is stored
    const view = await pub(l.token);
    expect(view.status).toBe(200);
    expect(Object.keys(view.body).sort()).toEqual(["documents", "expiresAt"]);
    expect(JSON.stringify(view.body)).not.toMatch(/DEMO link person|DEMO Analyst|DEMO C4B job|example\.invalid/);
    expect((await pub("A".repeat(43))).status).toBe(404);
    expect((await upload(l.token, "DEMO_BANK", PDF, "doc.png", "image/png")).status).toBe(400); // declared type/content mismatch
    expect((await upload(l.token, "DEMO_ID", PNG_HEADER, "id.png", "image/png")).status).toBe(400); // wrong file type
    expect((await upload(l.token, "DEMO_ID", Buffer.concat([PDF, Buffer.alloc(4096)]), "id.pdf", "application/pdf")).status).toBe(400); // oversize
    expect((await upload(l.token, "NOT_LISTED", PDF, "x.pdf", "application/pdf")).status).toBe(404);
    expect((await upload(l.token, "DEMO_ID", PDF.subarray(0, 1000), "id.pdf", "application/pdf")).status).toBe(201);
    expect((await upload(l.token, "DEMO_ID", PDF, "id.pdf", "application/pdf")).status).toBe(409); // same type twice
    expect((await upload(l.token, "DEMO_BANK", PDF, "bank.pdf", "application/pdf")).status).toBe(201);
    expect((await pub(l.token)).status).toBe(410); // spent: no reuse
    // Revocation.
    const second = await acceptedOffer();
    const r = await link(second.candidateId);
    expect((await f.call("hr", "post", `/joiner-links/${r.id}/revoke`, {})).status).toBe(200);
    expect((await pub(r.token)).status).toBe(410);
    // A new link revokes the previous one.
    const a = await link(second.candidateId), b = await link(second.candidateId);
    expect((await pub(a.token)).status).toBe(410);
    expect((await pub(b.token)).status).toBe(200);
    // Expiry.
    await prisma.$executeRaw`UPDATE recruitment_joiner_links SET created_at=now()-interval '3 days', expires_at=now()-interval '1 second' WHERE id=${b.id}`;
    expect((await pub(b.token)).status).toBe(410);
    expect((await upload(b.token, "DEMO_ID", PDF.subarray(0, 1000), "id.pdf", "application/pdf")).status).toBe(410);
    // HR reviews identity and bank documents; each open audited; Office and others cannot.
    const status = await f.call("hr", "get", `/candidates/${candidateId}/joining`);
    expect(status.body.complete).toBe(true);
    const docId = status.body.required[0].uploaded.id;
    expect((await f.call("hr", "get", `/joining-documents/${docId}/file`)).status).toBe(200);
    for (const who of ["office", "manager", "employee"] as Who[]) expect((await f.call(who, "get", `/joining-documents/${docId}/file`)).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: "recruitment.joining_document.opened", entityId: docId } })).toBe(1);
  });

  it("public link is rate-limited per link", async () => {
    const { candidateId } = await acceptedOffer();
    const l = await link(candidateId);
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await pub(l.token)).status;
    expect(last).toBe(429);
  });

  it("exceptions need the director-chosen approver (Not set until chosen); conversion waits for joining checks", async () => {
    const { candidateId, offerId } = await acceptedOffer();
    expect((await f.call("hr", "post", `/offers/${offerId}/conversion`, conversionBody(`DEMOC${Date.now() % 1e6}`))).body.error.code).toBe("JOINING_INCOMPLETE");
    expect((await f.call("hr", "post", `/candidates/${candidateId}/joining-exceptions`, { typeCode: "DEMO_ID", reason: "DEMO later" })).status).toBe(409);
    await f.setting("joiningExceptionApprover", { employeeId: f.people.second.employeeId });
    expect((await f.call("hr", "post", `/candidates/${candidateId}/joining-exceptions`, { typeCode: "DEMO_ID", reason: "DEMO later" })).status).toBe(403);
    expect((await f.call("second", "post", `/candidates/${candidateId}/joining-exceptions`, { typeCode: "DEMO_ID", reason: "DEMO arrives later" })).status).toBe(201);
    expect((await f.call("second", "post", `/candidates/${candidateId}/joining-exceptions`, { typeCode: "DEMO_BANK", reason: "DEMO arrives later" })).body.complete).toBe(true);
    await expect(prisma.$executeRaw`DELETE FROM recruitment_joining_exceptions WHERE candidate_id=${candidateId}`).rejects.toThrow();
  });

  it("conversion: two simultaneous requests and a retry create exactly one employee, non-pay data only", async () => {
    const { candidateId, offerId, applicationId } = await acceptedOffer("DEMO Joiner Person");
    for (const t of ["DEMO_ID", "DEMO_BANK"]) await f.call("second", "post", `/candidates/${candidateId}/joining-exceptions`, { typeCode: t, reason: "DEMO arrives later" });
    const code = `DEMOJ${Date.now() % 1e7}`;
    const before = await prisma.employee.count();
    const [a, b] = await Promise.all([f.call("hr", "post", `/offers/${offerId}/conversion`, conversionBody(code)), f.call("hr", "post", `/offers/${offerId}/conversion`, conversionBody(code))]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.employeeId).toBe(b.body.employeeId);
    converted.push(a.body.employeeId);
    const retry = await f.call("director", "post", `/offers/${offerId}/conversion`, conversionBody(`${code}X`));
    expect([retry.status, retry.body.employeeId]).toEqual([200, a.body.employeeId]);
    expect(await prisma.employee.count()).toBe(before + 1);
    expect(await prisma.recruitmentConversion.count({ where: { candidateId } })).toBe(1);
    expect((await prisma.recruitmentApplication.findUniqueOrThrow({ where: { id: applicationId } })).status).toBe("HIRED");
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: a.body.employeeId }, include: { jobHistory: true, nameHistory: true, bankAccounts: true, statutory: true } });
    expect([employee.employeeCode, employee.dateOfJoining.toISOString().slice(0, 10), employee.nameHistory[0]!.fullName, employee.jobHistory[0]!.departmentId]).toEqual([code, "2098-06-01", "DEMO Joiner Person", f.org.departmentId]);
    expect(employee.bankAccounts).toEqual([]);
    expect(employee.statutory).toBeNull();
    // No pay was copied anywhere about this employee.
    expect(await prisma.employeeSalary.count({ where: { employeeId: a.body.employeeId } })).toBe(0);
    for (const p of [PAY, "4321987"]) expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: { in: [a.body.employeeId, offerId] } } })).includes(p)).toBe(false);
    // Payroll interface returns the offer pay to a director only, audited.
    const read = await readAcceptedOfferForPayroll(f.people.director.userId, a.body.employeeId);
    expect(read?.compensation).toEqual({ amount: PAY, period: "ANNUAL", currency: "INR" });
    expect(await prisma.auditLog.count({ where: { entityId: offerId, action: "recruitment.offer.compensation.opened", actorUserId: f.people.director.userId } })).toBeGreaterThan(0);
  });

  it("stage 2: conversion copies each accepted joining document once into the restricted category, never pay", async () => {
    const { candidateId, offerId } = await acceptedOffer("DEMO Document Joiner");
    const l = await link(candidateId);
    expect((await upload(l.token, "DEMO_ID", PDF.subarray(0, 1000), "id.pdf", "application/pdf")).status).toBe(201);
    expect((await upload(l.token, "DEMO_BANK", PDF, "bank.pdf", "application/pdf")).status).toBe(201);
    const code = `DEMOD${Date.now() % 1e7}`;
    const [a, b] = await Promise.all([f.call("hr", "post", `/offers/${offerId}/conversion`, conversionBody(code)), f.call("hr", "post", `/offers/${offerId}/conversion`, conversionBody(code))]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    converted.push(a.body.employeeId);
    expect((await f.call("hr", "post", `/offers/${offerId}/conversion`, conversionBody(code))).status).toBe(200); // a later retry
    const docs = await prisma.employeeDocument.findMany({ where: { employeeId: a.body.employeeId }, include: { category: true } });
    expect(docs.map((d) => d.title).sort()).toEqual(["DEMO bank proof", "DEMO identity proof"]);
    expect(docs.every((d) => d.category.sensitivity === "STATUTORY" && !d.visibleToEmployee)).toBe(true);
    expect(await prisma.recruitmentConversionDocument.count({ where: { employeeId: a.body.employeeId } })).toBe(2);
    for (const p of [PAY, "4321987"]) expect(JSON.stringify(docs).includes(p)).toBe(false);
    await expect(prisma.$executeRaw`DELETE FROM recruitment_conversion_documents WHERE employee_id=${a.body.employeeId}`).rejects.toThrow();
  });

  it("stage 2: an existing employee code is refused clearly, and two conversions racing for one new code create one employee", async () => {
    const one = await acceptedOffer(), two = await acceptedOffer();
    for (const c of [one, two]) for (const t of ["DEMO_ID", "DEMO_BANK"]) await f.call("second", "post", `/candidates/${c.candidateId}/joining-exceptions`, { typeCode: t, reason: "DEMO arrives later" });
    const taken = await f.call("hr", "post", `/offers/${one.offerId}/conversion`, conversionBody(f.people.employee.employeeCode));
    expect([taken.status, taken.body.error.code]).toEqual([409, "EMPLOYEE_CODE_TAKEN"]);
    expect(taken.body.error.message).toContain("already in use");
    const code = `DEMOR${Date.now() % 1e7}`;
    const before = await prisma.employee.count();
    const results = await Promise.all([f.call("hr", "post", `/offers/${one.offerId}/conversion`, conversionBody(code)), f.call("hr", "post", `/offers/${two.offerId}/conversion`, conversionBody(code))]);
    const won = results.find((r) => r.status === 201)!, lost = results.find((r) => r.status !== 201)!;
    converted.push(won.body.employeeId);
    expect([lost.status, lost.body.error.code]).toEqual([409, "EMPLOYEE_CODE_TAKEN"]);
    expect(await prisma.employee.count()).toBe(before + 1);
    expect(await prisma.employee.count({ where: { employeeCode: code } })).toBe(1);
  });

  it("referrals: off by default, then the referrer sees basic status only", async () => {
    expect((await f.call("employee", "post", "/referrals", { jobId, name: "DEMO referred", email: null, phone: "+91 90000 11111", consentConfirmed: true })).status).toBe(403);
    await f.setting("referrals", { enabled: true });
    const r = await f.call("employee", "post", "/referrals", { jobId, name: "DEMO referred", email: null, phone: "+91 90000 11111", consentConfirmed: true });
    expect(r.status).toBe(201);
    expect((await f.call("employee", "get", "/referrals")).status).toBe(403);
    const mine = await f.call("employee", "get", "/referrals/mine");
    expect(mine.body.items[0]).toEqual({ id: r.body.id, jobTitle: "DEMO C4B job", createdAt: expect.any(String), status: "SUBMITTED" });
    expect((await f.call("interviewer", "get", "/referrals/mine")).body.items).toEqual([]);
    const accepted = await f.call("office", "post", `/referrals/${r.body.id}/accept`, { source: "DEMO" });
    expect(accepted.status).toBe(200);
    await f.call("director", "post", `/candidates/${accepted.body.candidateId}/applications`, { jobId });
    const after = await f.call("employee", "get", "/referrals/mine");
    expect(after.body.items[0].status).toBe("IN_REVIEW");
    expect(Object.keys(after.body.items[0]).sort()).toEqual(["createdAt", "id", "jobTitle", "status"]);
    await f.setting("referrals", { enabled: false });
  });

  it("Stage 4 concurrency: two simultaneous issues record one ISSUED event; two links at once leave one live; one link cannot take the same document twice, even at once", async () => {
    // Offer issue: both calls carry the same version; one issues, the other is the retried request and changes nothing.
    const { candidateId, applicationId } = await candidate("DEMO race offer");
    const o = await f.call("office", "post", "/offers", terms(applicationId));
    expect((await f.call("director", "put", `/offers/${o.body.id}/compensation`, { amount: PAY, period: "ANNUAL", version: 0 })).status).toBe(200);
    expect((await move("office", o.body.id, "PROPOSED", 1)).status).toBe(200);
    const issue = { letterSentThroughLetters: true, letterReference: "DEMO-LTR-RACE" };
    const issued = await Promise.all([move("director", o.body.id, "ISSUED", 2, issue), move("second" as Who, o.body.id, "ISSUED", 2, issue)]);
    expect(issued.map((r) => r.status).sort()).toEqual([200, 200]);
    expect(await prisma.recruitmentOfferEvent.count({ where: { offerId: o.body.id, toState: "ISSUED" } })).toBe(1);
    expect((await prisma.recruitmentOffer.findUniqueOrThrow({ where: { id: o.body.id } })).version).toBe(3);
    expect((await move("office", o.body.id, "ACCEPTED", 3)).status).toBe(200);

    await f.setting("joinerLinkLifetime", { hours: 48 });
    await f.setting("joinerDocumentTypes", [{ code: "DEMO_ID", label: "DEMO identity proof", kind: "IDENTITY", allowedMimeTypes: ["application/pdf"], maxMb: 1 }, { code: "DEMO_BANK", label: "DEMO bank proof", kind: "BANK", allowedMimeTypes: ["application/pdf"], maxMb: 1 }]);
    // Two links created at once: only one is live afterwards.
    const links = await Promise.all([f.call("hr", "post", `/candidates/${candidateId}/joiner-links`, {}), f.call("hr", "post", `/candidates/${candidateId}/joiner-links`, {})]);
    expect(links.map((r) => r.status)).toEqual([201, 201]);
    expect(await prisma.recruitmentJoinerLink.count({ where: { candidateId, revokedAt: null } })).toBe(1);
    const liveId = (await prisma.recruitmentJoinerLink.findFirstOrThrow({ where: { candidateId, revokedAt: null } })).id;
    const token = links.find((r) => r.body.id === liveId)!.body.token as string;
    const stale = links.find((r) => r.body.id !== liveId)!.body.token as string;
    expect((await pub(stale)).status).toBe(410);
    // The same document type sent twice at once: one is stored, the other refused.
    const same = await Promise.all([upload(token, "DEMO_ID", PDF, "id.pdf", "application/pdf"), upload(token, "DEMO_ID", PDF, "id.pdf", "application/pdf")]);
    expect(same.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.recruitmentJoinerDocument.count({ where: { linkId: liveId, typeCode: "DEMO_ID" } })).toBe(1);
    // The last document twice at once: one completes the link, which is then spent for everyone.
    const last = await Promise.all([upload(token, "DEMO_BANK", PDF, "bank.pdf", "application/pdf"), upload(token, "DEMO_BANK", PDF, "bank.pdf", "application/pdf")]);
    expect(last.map((r) => r.status).sort()[0]).toBe(201);
    expect(last.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.recruitmentJoinerDocument.count({ where: { linkId: liveId } })).toBe(2);
    expect((await pub(token)).status).toBe(410);
    expect((await upload(token, "DEMO_ID", PDF, "id.pdf", "application/pdf")).status).toBe(410);
  });
});
