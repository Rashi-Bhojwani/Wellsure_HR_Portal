import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import request from "supertest";
import pino from "pino";
import { logger } from "../../../lib/logger";
import { redis } from "../../../lib/redis";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { appoint, removeMember } from "../../peeps/__tests__/peepsTestKit";
import { fixture, app, prisma } from "../../recruitment/__tests__/fixtures";
import { queueHooks } from "../routes";
import { runExtraction } from "../service";
import * as S from "./synthetic";

// Document autofill (stage 2) with SYNTHETIC documents only (./synthetic.ts). Fixture people are fictional and labelled DEMO.
type F = Awaited<ReturnType<typeof fixture>>;
type Who = keyof F["people"];
const VALUES = [S.BANK.accountNumber, S.BANK.ifsc, S.IDENTITY.pan, S.IDENTITY.aadhaar, "9999 0000 1234", S.RESUME.email, S.BANK.accountHolderName, S.RESUME.fullName];

describe("DEMO document autofill: settings, authority, never auto-save, idempotency, no value leaks, synthetic documents", () => {
  let f: F;
  let candidateId = "";
  const enqueued: unknown[] = [];
  const call = (who: Who, method: "get" | "post" | "put", path: string, body: object = {}) => request(app)[method]("/api/autofill" + path).set("Authorization", `Bearer ${f.tokens[who]}`).send(body);
  const up = (who: Who, fields: Record<string, string>, buf: Buffer, name: string, mime: string) => {
    const r = request(app).post("/api/autofill/documents").set("Authorization", `Bearer ${f.tokens[who]}`);
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r.attach("file", buf, { filename: name, contentType: mime });
  };
  const emp = () => ({ subjectKind: "EMPLOYEE", subjectId: f.people.employee.employeeId });
  const setRetention = async () => {
    const v = (await call("director", "get", "/settings")).body.settings.find((s: { key: string }) => s.key === "retention").version;
    expect((await call("director", "put", "/settings/retention", { value: { days: 30 }, version: v, reason: "DEMO choice" })).status).toBe(200);
  };

  beforeAll(async () => {
    f = await fixture();
    { const keys = await redis.keys("ratelimit:autofill:*"); if (keys.length) await redis.del(...keys); }
    queueHooks.enqueue = async (extractionId: string) => { enqueued.push({ extractionId }); await runExtraction(extractionId); };
    await f.setting("sources", [{ code: "DEMO", label: "DEMO" }]);
    await f.setting("retention", { days: 30 });
    await f.setting("officeAudience", { officeManages: true });
    await appoint(f.people.office.employeeId, ["MANAGE_RECRUITMENT"], f.people.director, f.people.second);
    const c = await f.call("director", "post", "/candidates", { name: "DEMO autofill candidate", email: `demo.${randomUUID()}@example.invalid`, phone: null, source: "DEMO", consentConfirmed: true, consentRecordedAt: new Date().toISOString() });
    candidateId = c.body.id;
  });
  afterAll(async () => {
    const keys = await redis.keys("ratelimit:autofill:*"); if (keys.length) await redis.del(...keys);
    const people = Object.values(f.people).map((p) => p.userId);
    await deleteWithDependents("AutofillDocument", (await prisma.autofillDocument.findMany({ where: { uploadedByUserId: { in: people } }, select: { id: true } })).map((r) => r.id));
    await deleteWithDependents("AutofillSettingVersion", (await prisma.autofillSettingVersion.findMany({ where: { changedByUserId: { in: people } }, select: { id: true } })).map((r) => r.id));
    await removeMember(f.people.office.employeeId, f.people.director, f.people.second);
    await f.cleanup();
  });

  it("every route: anonymous 401 and Developer 403; the enumeration matches the router", async () => {
    const routes: Array<[method: "get" | "post" | "put", path: string, body: object]> = [["get", "/status", {}], ["get", "/settings", {}], ["put", "/settings/retention", { value: { days: 1 }, version: 0, reason: "DEMO" }], ["get", "/documents", {}], ["post", "/documents", {}], ["get", "/documents/x", {}], ["get", "/documents/x/file", {}], ["post", "/documents/x/extract", { idempotencyKey: "DEMO-key-1" }], ["post", "/documents/x/fields/pan/review", { decision: "REJECTED" }], ["post", "/documents/x/apply", {}]];
    const source = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    expect(routes.map(([m, p]) => `${m} ${p.replace("/settings/retention", "/settings/:key").replace(/\/documents\/x/, "/documents/:id").replace("/fields/pan/", "/fields/:field/")}`).sort()).toEqual([...source.matchAll(/autofillRouter\.(get|post|put)\("([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`).sort());
    for (const [m, p, b] of routes) {
      expect((await request(app)[m]("/api/autofill" + p).send(b)).status, `${m} ${p} anonymous`).toBe(401);
      expect((await call("developer", m, p, b)).status, `${m} ${p} Developer`).toBe(403);
    }
  });

  it("uploads refuse while retention is Not set; file types and size ship as defaults", async () => {
    const s = (await call("director", "get", "/settings")).body.settings;
    expect(s.find((x: { key: string }) => x.key === "uploads")).toMatchObject({ state: "DEFAULT", value: { maxMb: 10 } });
    expect(s.find((x: { key: string }) => x.key === "retention")).toMatchObject({ state: "NOT_SET" });
    const r = await up("hr", { ...emp(), docKind: "BANK" }, await S.bankPdf(), "bank.pdf", "application/pdf");
    expect([r.status, r.body.error.code]).toEqual([409, "AUTOFILL_NOT_SET"]);
    expect((await call("hr", "put", "/settings/retention", { value: { days: 30 }, version: 0, reason: "DEMO" })).status).toBe(403);
    await setRetention();
  });

  it("matrix: who may upload which kind", async () => {
    const bank = await S.bankPdf(), resume = await S.resumePdf();
    for (const who of ["employee", "manager", "interviewer"] as Who[]) {
      expect((await up(who, { ...emp(), docKind: "BANK" }, bank, "b.pdf", "application/pdf")).status, `${who} bank`).toBe(403);
      expect((await up(who, { subjectKind: "CANDIDATE", subjectId: candidateId, docKind: "RESUME" }, resume, "r.pdf", "application/pdf")).status, `${who} resume`).toBe(403);
      expect((await call(who, "get", "/documents")).status).toBe(403);
    }
    expect((await up("office", { ...emp(), docKind: "BANK" }, bank, "b.pdf", "application/pdf")).status).toBe(403); // Office: no bank or statutory
    expect((await up("hr", { subjectKind: "CANDIDATE", subjectId: candidateId, docKind: "RESUME" }, resume, "r.pdf", "application/pdf")).status).toBe(403); // HR recruitment is off
    expect((await up("office", { subjectKind: "CANDIDATE", subjectId: candidateId, docKind: "RESUME" }, resume, "r.pdf", "application/pdf")).status).toBe(201);
    expect((await up("hr", { ...emp(), docKind: "BANK" }, bank, "b.pdf", "application/pdf")).status).toBe(201);
    expect((await up("director", { ...emp(), docKind: "IDENTITY" }, await S.identityPdf(), "i.pdf", "application/pdf")).status).toBe(201);
    expect((await up("hr", { subjectKind: "EMPLOYEE", subjectId: f.people.employee.employeeId, docKind: "RESUME" }, resume, "r.pdf", "application/pdf")).status).toBe(400);
  });

  it("extraction suggests values but never saves them; reviewers confirm only fields they are authorised for, even sent directly", async () => {
    const before = await prisma.identityChangeRequest.count({ where: { employeeId: f.people.employee.employeeId } });
    const bankBefore = await prisma.employeeBankAccount.findMany({ where: { employeeId: f.people.employee.employeeId } });
    const r = await up("hr", { ...emp(), docKind: "BANK" }, await S.bankPdf(), "bank.pdf", "application/pdf");
    const doc = (await call("hr", "get", `/documents/${r.body.id}`)).body;
    expect(doc.extraction.status).toBe("DONE");
    expect(Object.fromEntries(doc.fields.map((x: { field: string; suggestion: { value: string } }) => [x.field, x.suggestion.value]))).toEqual(S.BANK);
    expect(doc.notice).toContain("not a verified");
    expect(doc.provenance).toMatchObject({ provider: "LOCAL", runs: 1 });
    // Never auto-saved.
    expect(await prisma.identityChangeRequest.count({ where: { employeeId: f.people.employee.employeeId } })).toBe(before);
    expect(await prisma.employeeBankAccount.findMany({ where: { employeeId: f.people.employee.employeeId } })).toEqual(bankBefore);
    // Office and the director-less roles cannot touch a bank field, even with a hand-made request.
    for (const who of ["office", "employee", "manager"] as Who[]) expect((await call(who, "post", `/documents/${r.body.id}/fields/accountNumber/review`, { decision: "ACCEPTED" })).status, who).toBe(403);
    // HR may not review resume fields (HR recruitment off); Office sees resume values but no bank values.
    const res = await up("office", { subjectKind: "CANDIDATE", subjectId: candidateId, docKind: "RESUME" }, await S.resumePdf(), "r.pdf", "application/pdf");
    expect((await call("hr", "post", `/documents/${res.body.id}/fields/email/review`, { decision: "ACCEPTED" })).status).toBe(403);
    expect((await call("office", "post", `/documents/${res.body.id}/fields/email/review`, { decision: "ACCEPTED" })).status).toBe(200);
    // A reviewer with only part of the authorities sees no value for the rest (director sees all; mixed doc kinds are single-authority).
    expect((await call("office", "get", `/documents/${r.body.id}`)).status).toBe(403);
  });

  it("field authority is per field: a reviewer who may open an identity document still cannot see or confirm its statutory fields", async () => {
    // HR with the statutory-edit key taken away for this person: may still open identity documents (personal details), not PAN/Aadhaar.
    const key = await prisma.permission.findUniqueOrThrow({ where: { key: "employee.statutory.edit" } });
    await prisma.userPermissionOverride.upsert({ where: { userId_permissionId: { userId: f.people.hr.userId, permissionId: key.id } }, create: { userId: f.people.hr.userId, permissionId: key.id, effect: "REVOKE", reason: "DEMO test revoke", createdByUserId: f.people.director.userId }, update: { effect: "REVOKE" } });
    const r = await up("director", { ...emp(), docKind: "IDENTITY" }, await S.identityPdf(), "i.pdf", "application/pdf");
    const got = await call("hr", "get", `/documents/${r.body.id}`);
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    const doc = got.body;
    expect(doc.fields.find((x: { field: string }) => x.field === "nameOnDocument")).toMatchObject({ authorized: true, suggestion: { value: "DEMO Person Alpha" } });
    for (const fld of ["pan", "aadhaar"]) expect(doc.fields.find((x: { field: string }) => x.field === fld)).toMatchObject({ authorized: false, suggestion: null });
    expect(JSON.stringify(doc)).not.toContain(S.IDENTITY.pan);
    expect((await call("hr", "post", `/documents/${r.body.id}/fields/nameOnDocument/review`, { decision: "ACCEPTED" })).status).toBe(200);
    for (const fld of ["pan", "aadhaar"]) expect((await call("hr", "post", `/documents/${r.body.id}/fields/${fld}/review`, { decision: "CORRECTED", value: fld === "pan" ? "DEMOY5678Q" : "999911112222" })).status, fld).toBe(403);
    expect((await call("hr", "post", `/documents/${r.body.id}/apply`, {})).body.error.code).toBe("NOTHING_TO_SAVE"); // the name is never saved
    expect(await prisma.autofillFieldReview.count({ where: { documentId: r.body.id, field: { in: ["pan", "aadhaar"] } } })).toBe(0);
    await prisma.userPermissionOverride.deleteMany({ where: { userId: f.people.hr.userId, permissionId: key.id } });
  });

  it("re-running extraction never overwrites an accepted correction, and two simultaneous extractions create one result", async () => {
    const r = await up("hr", { ...emp(), docKind: "BANK" }, await S.bankPdf(), "bank.pdf", "application/pdf");
    expect((await call("hr", "post", `/documents/${r.body.id}/fields/bankName/review`, { decision: "CORRECTED", value: "DEMO Corrected Bank" })).status).toBe(200);
    const key = `DEMO-${randomUUID()}`;
    expect((await call("hr", "post", `/documents/${r.body.id}/extract`, { idempotencyKey: key })).status).toBe(200);
    expect((await call("hr", "post", `/documents/${r.body.id}/extract`, { idempotencyKey: key })).status).toBe(200); // retried request
    const doc = (await call("hr", "get", `/documents/${r.body.id}`)).body;
    expect(doc.fields.find((x: { field: string }) => x.field === "bankName").review).toMatchObject({ decision: "CORRECTED", value: "DEMO Corrected Bank" });
    expect(doc.provenance.runs).toBe(2);
    const ex = await prisma.autofillExtraction.findUniqueOrThrow({ where: { documentId: r.body.id } });
    await prisma.autofillExtraction.update({ where: { id: ex.id }, data: { status: "QUEUED" } });
    const [a, b] = await Promise.all([runExtraction(ex.id), runExtraction(ex.id)]);
    expect([a.claimed, b.claimed].sort()).toEqual([false, true]);
    expect(await prisma.autofillExtraction.count({ where: { documentId: r.body.id } })).toBe(1);
    expect((await prisma.autofillExtraction.findUniqueOrThrow({ where: { id: ex.id } })).runs).toBe(3);
  });

  it("apply saves through the existing workflow: HR's bank entry waits for a director; a resume updates the candidate", async () => {
    const r = await up("hr", { ...emp(), docKind: "BANK" }, await S.bankPdf(), "bank.pdf", "application/pdf");
    expect((await call("hr", "post", `/documents/${r.body.id}/apply`, {})).body.error.code).toBe("NOTHING_TO_SAVE");
    for (const field of ["accountHolderName", "accountNumber", "ifsc", "bankName"]) expect((await call("hr", "post", `/documents/${r.body.id}/fields/${field}/review`, { decision: "ACCEPTED" })).status).toBe(200);
    expect((await call("hr", "post", `/documents/${r.body.id}/apply`, {})).body.error.code).toBe("INCOMPLETE"); // never a guessed value
    expect((await call("hr", "post", `/documents/${r.body.id}/fields/branchName/review`, { decision: "CORRECTED", value: "DEMO Main Branch" })).status).toBe(200);
    const bankBefore = await prisma.employeeBankAccount.count({ where: { employeeId: f.people.employee.employeeId } });
    const applied = await call("hr", "post", `/documents/${r.body.id}/apply`, {});
    expect(applied.body).toMatchObject({ appliedVia: "HELD_FOR_DIRECTOR" });
    expect(await prisma.identityChangeRequest.count({ where: { employeeId: f.people.employee.employeeId, kind: "BANK", status: "PENDING" } })).toBeGreaterThan(0);
    expect(await prisma.employeeBankAccount.count({ where: { employeeId: f.people.employee.employeeId } })).toBe(bankBefore);
    expect((await call("hr", "post", `/documents/${r.body.id}/apply`, {})).body.alreadyApplied).toBe(true);
    expect((await call("hr", "post", `/documents/${r.body.id}/fields/bankName/review`, { decision: "REJECTED" })).status).toBe(409);
    const res = await up("office", { subjectKind: "CANDIDATE", subjectId: candidateId, docKind: "RESUME" }, await S.resumePdf(), "r.pdf", "application/pdf");
    await call("office", "post", `/documents/${res.body.id}/fields/fullName/review`, { decision: "ACCEPTED" });
    expect((await call("office", "post", `/documents/${res.body.id}/apply`, {})).body.appliedVia).toBe("SAVED");
    expect((await f.call("director", "get", `/candidates/${candidateId}`)).body.name).toBe(S.RESUME.fullName);
  });

  it("no extracted value appears in any log line, queue payload, notification, audit diff, email or candidate search", async () => {
    const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
    const lines: string[] = [];
    const original = stream.write.bind(stream);
    stream.write = (line: string) => { lines.push(String(line)); return original(line); };
    let ids: string[] = [];
    try {
      const a = await up("director", { ...emp(), docKind: "IDENTITY" }, await S.identityPdf(), "i.pdf", "application/pdf");
      const b = await up("hr", { ...emp(), docKind: "BANK" }, await S.bankPdf(), "b.pdf", "application/pdf");
      await call("director", "post", `/documents/${a.body.id}/fields/pan/review`, { decision: "ACCEPTED" });
      await call("hr", "post", `/documents/${b.body.id}/fields/accountNumber/review`, { decision: "ACCEPTED" });
      await call("hr", "get", `/documents/${b.body.id}`);
      await call("hr", "get", `/documents/${b.body.id}/file`);
      ids = [a.body.id, b.body.id];
    } finally { stream.write = original; }
    expect(lines.length).toBeGreaterThan(5);
    for (const v of VALUES) expect(lines.filter((l) => l.includes(v)), `log carries ${v}`).toEqual([]);
    expect(JSON.stringify(enqueued)).not.toMatch(/9999|DEMO0|DEMOX|example\.invalid|DEMO Person/);
    for (const e of enqueued) expect(Object.keys(e as object)).toEqual(["extractionId"]);
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: { in: ids } } }));
    const notes = JSON.stringify(await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 200 }));
    for (const v of VALUES) { expect(audits.includes(v), `audit carries ${v}`).toBe(false); expect(notes.includes(v), `notification carries ${v}`).toBe(false); }
    const raw = await prisma.$queryRaw<Array<{ t: string }>>`SELECT encode(result_encrypted,'escape') AS t FROM autofill_extractions WHERE document_id = ANY(${ids})`;
    for (const r of raw) for (const v of VALUES) expect(r.t.includes(v)).toBe(false); // encrypted at rest
    expect((await f.call("director", "get", `/candidates?q=${encodeURIComponent(S.BANK.accountHolderName)}`)).body.items).toEqual([]);
  });

  it("synthetic edge cases: password-protected, poor quality, no text layer, oversize and wrong type all fall back to manual entry", async () => {
    const cases: Array<[string, Buffer, string, string, string | number]> = [
      ["password", S.passwordPdf(), "p.pdf", "application/pdf", "PASSWORD_PROTECTED"],
      ["noise", await S.noisePng(), "n.png", "image/png", "POOR_QUALITY"],
      ["blank", await S.blankPdf(), "s.pdf", "application/pdf", "POOR_QUALITY"],
      ["oversize", Buffer.concat([await S.bankPdf(), Buffer.alloc(11 * 1024 * 1024)]), "big.pdf", "application/pdf", 400],
      ["wrong type", Buffer.from("DEMO plain text, not a document"), "t.txt", "text/plain", 400],
      ["mislabelled", await S.bankPdf(), "x.png", "image/png", 400],
    ];
    for (const [label, buf, name, mime, want] of cases) {
      const r = await up("hr", { ...emp(), docKind: "BANK" }, buf, name, mime);
      if (typeof want === "number") { expect(r.status, label).toBe(want); continue; }
      expect(r.status, label).toBe(201);
      const d = (await call("hr", "get", `/documents/${r.body.id}`)).body;
      expect([d.extraction.status, d.extraction.failureCode], label).toEqual(["FAILED", want]);
      expect(d.fields.every((x: { suggestion: unknown }) => x.suggestion === null), label).toBe(true); // nothing guessed
      expect((await call("hr", "post", `/documents/${r.body.id}/fields/bankName/review`, { decision: "CORRECTED", value: "DEMO Typed By Hand" })).status, label).toBe(200); // manual entry still works
    }
  });

  it("a clear image is read by the local OCR provider (no document leaves the system)", async () => {
    const png = await S.textPng([`Name: ${S.RESUME.fullName}`, `Email: ${S.RESUME.email}`, `Phone: ${S.RESUME.phone}`]);
    const r = await up("office", { subjectKind: "CANDIDATE", subjectId: candidateId, docKind: "RESUME" }, png, "r.png", "image/png");
    const d = (await call("office", "get", `/documents/${r.body.id}`)).body;
    expect(d.extraction.status).toBe("DONE");
    expect(d.provenance.engine).toBe("tesseract-eng");
    expect(d.fields.find((x: { field: string }) => x.field === "email").suggestion.value).toBe(S.RESUME.email);
  }, 60_000);
});
