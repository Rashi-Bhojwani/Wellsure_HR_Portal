import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storageService } from "../../../integrations/storage";
import { lettersGenerateQueue } from "../../../jobs/lettersQueue";
import { closePdfRenderer, renderPdf } from "../../../lib/pdf/renderer";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  revokePermissions,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { setSetting } from "../../people/__tests__/peopleTestHelpers";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setSwitch } from "../../hrCapabilities/service";
import { processLetterJob, SIGNATORY_NAME_KEY } from "../service";

// Letters (Phase 5 commit D2) against the real database and a real
// Chromium. Letters are legal documents: what's stored must reproduce the
// issued PDF exactly, and nothing issued can ever be replaced.

async function pdfText(pdf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), disableFontFace: true });
  const doc = await task.promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // Runs are joined as laid out: a glyph from another font subset (₹) is
    // its own run but not a separate word; only line ends become spaces.
    parts.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? " " : "") : "")).join(""));
  }
  await task.destroy();
  return parts.join("\n").replace(/\s+/g, " ");
}
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// Most tests here render real PDFs in headless Chromium. A cold browser
// start on a shared CI runner can take longer than vitest's 5 s default on
// its own (CI run #11 failed exactly that way: two render tests timed out,
// green before and after on the same code), so rendering gets an explicit,
// generous budget rather than relying on a fast machine.
describe("Letters", { timeout: 30_000 }, () => {
  let org: TestOrgMasters;
  type Person = { employeeId: string; employeeCode: string; userId: string };
  const people = {} as Record<"director" | "hrAdmin" | "hrExec" | "manager" | "report" | "outsider" | "leaver", Person>;
  const tokens = {} as Record<keyof typeof people, string>;
  const templateIds: string[] = [];
  const letterIds: string[] = [];
  let managerHadGenerate = false;
  let templateId: string;
  let originalSignatory: unknown;

  const as = (who: keyof typeof people) => ({
    get: (path: string) => request(app).get(path).set(...authHeader(tokens[who])),
    post: (path: string, body: object = {}) => request(app).post(path).set(...authHeader(tokens[who])).send(body),
    patch: (path: string, body: object) => request(app).patch(path).set(...authHeader(tokens[who])).send(body),
  });

  async function issue(who: keyof typeof people, employeeId: string, body: object) {
    const res = await as(who).post(`/api/letters/employees/${employeeId}`, body);
    if (res.status === 202) letterIds.push(res.body.id);
    return res;
  }

  beforeAll(async () => {
    // Launch Chromium here, under the 60 s hook budget: a cold launch on a
    // slow CI runner is not something the 30 s issuing test should pay for
    // (CI run 37835475091 timed out at letters.test.ts "issues a letter").
    await renderPdf("<!doctype html><p>warm-up</p>", new Date("2026-01-01T00:00:00Z"));
    org = await createEmployeeTestOrgMasters();
    people.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" }); // Stage 1: HR no longer opens PAY documents (a letter carries CTC), so the director does
    people.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    people.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    people.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    people.report = await createFullTestEmployee(org, { managerId: people.manager.employeeId });
    people.outsider = await createFullTestEmployee(org);
    people.leaver = await createFullTestEmployee(org);
    await prisma.separation.create({
      data: { employeeId: people.leaver.employeeId, lastWorkingDate: new Date("2026-08-31"), reason: "Resigned", status: "COMPLETED", initiatedByUserId: people.hrAdmin.userId },
    });
    for (const key of Object.keys(people) as Array<keyof typeof people>) tokens[key] = await loginAs(people[key].employeeCode);

    const role = await prisma.role.findUnique({ where: { code: "MANAGER" }, include: { permissions: { include: { permission: true } } } });
    managerHadGenerate = role?.permissions.some((p) => p.permission.key === "letters.generate") ?? false;
    originalSignatory = (await prisma.systemSetting.findUnique({ where: { key: SIGNATORY_NAME_KEY } }))?.value;

    const created = await as("hrAdmin").post("/api/letters/templates", {
      code: `TEST_LTR_${Date.now()}`,
      name: "Test Offer",
      bodyHtml: "<p>Ref {{letter.reference}} dated {{letter.date}}</p><p>Dear {{employee.fullName}} ({{employee.code}}), your CTC is <strong>{{extra.ctc}}</strong>.</p><p>{{signatory.name}}, {{signatory.designation}}</p>",
      extraFields: [{ key: "ctc", label: "Annual CTC", type: "currency", required: true }],
    });
    expect(created.status).toBe(201);
    templateId = created.body.id;
    templateIds.push(templateId);
  });

  afterAll(async () => {
    for (const id of letterIds) await lettersGenerateQueue().remove(id).catch(() => undefined);
    if (!managerHadGenerate) await revokePermissions("MANAGER", ["letters.generate"]);
    if (originalSignatory !== undefined) await setSetting(SIGNATORY_NAME_KEY, originalSignatory);
    // Templates first: takes their versions and every letter issued from
    // them (and those letters' documents/files) with them.
    await deleteWithDependents("LetterTemplate", templateIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await closePdfRenderer();
  });

  it("the seeded permission matrix", async () => {
    const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
    const has = (code: string, key: string) => roles.find((r) => r.code === code)?.permissions.some((p) => p.permission.key === key) ?? false;
    expect(["SUPER_ADMIN", "HR_ADMIN"].every((c) => has(c, "letters.template.manage"))).toBe(true);
    expect(["HR_EXECUTIVE", "PAYROLL_ADMIN", "MANAGER", "EMPLOYEE"].some((c) => has(c, "letters.template.manage"))).toBe(false);
    // Issuing a letter is the directors' since the HR hard lock grew (a letter can carry the CTC): no HR role holds it.
    expect(has("SUPER_ADMIN", "letters.generate")).toBe(true);
    expect(["HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "MANAGER", "EMPLOYEE"].some((c) => has(c, "letters.generate"))).toBe(false);
    // ...and the narrow key (letters proven to carry no pay figure) is HR's, as before the lock.
    expect(["HR_ADMIN", "HR_EXECUTIVE"].every((c) => has(c, "letters.issue.nopay"))).toBe(true);
    expect(["PAYROLL_ADMIN", "MANAGER", "EMPLOYEE"].some((c) => has(c, "letters.issue.nopay"))).toBe(false);
  });

  it("route gates: employees and managers are refused; both HR roles are refused a letter that could carry pay; HR_EXECUTIVE can list but not edit templates", async () => {
    expect((await as("outsider").get("/api/letters/templates")).status).toBe(403);
    expect((await as("manager").get("/api/letters/templates")).status).toBe(403);
    expect((await as("outsider").post(`/api/letters/employees/${people.outsider.employeeId}`, { templateId })).status).toBe(403);
    expect((await as("hrExec").get("/api/letters/templates")).status).toBe(200); // the narrow key lists templates (with whether HR may issue each); editing them stays HR Admin's
    expect((await as("hrExec").post(`/api/letters/employees/${people.outsider.employeeId}`, { templateId })).status).toBe(403);
    expect((await as("hrAdmin").post(`/api/letters/employees/${people.outsider.employeeId}`, { templateId })).status).toBe(403);
    expect((await as("director").get("/api/letters/templates")).status).toBe(200);
    expect((await as("hrExec").post("/api/letters/templates", { code: "NOPE", name: "x", bodyHtml: "<p>x</p>" })).status).toBe(403);
    expect((await as("hrExec").post(`/api/letters/templates/${templateId}/versions`, { bodyHtml: "<p>x</p>" })).status).toBe(403);
    expect((await as("hrExec").get("/api/letters/letterhead")).status).toBe(403);
  });

  it("every edit is a new version; earlier versions are untouched; an unchanged save adds nothing; bad placeholders are refused", async () => {
    const v1 = (await as("hrAdmin").get(`/api/letters/templates/${templateId}`)).body.versions[0];
    const saved = await as("hrAdmin").post(`/api/letters/templates/${templateId}/versions`, {
      bodyHtml: "<p>Ref {{letter.reference}} dated {{letter.date}}</p><p>Dear {{employee.fullName}} ({{employee.code}}), your CTC is <strong>{{extra.ctc}}</strong>.</p><p>{{signatory.name}}, {{signatory.designation}}</p><p>Welcome aboard.</p>",
      extraFields: [{ key: "ctc", label: "Annual CTC", type: "currency", required: true }],
    });
    expect(saved.status).toBe(201);
    expect(saved.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(saved.body.versions[1]).toEqual(v1); // version 1 exactly as it was
    expect(await prisma.auditLog.count({ where: { entityId: templateId, action: "letters.template.versioned" } })).toBe(1);

    const again = await as("hrAdmin").post(`/api/letters/templates/${templateId}/versions`, { bodyHtml: saved.body.versions[0].bodyHtml, extraFields: saved.body.versions[0].extraFields });
    expect(again.body.versions).toHaveLength(2);

    const bad = await as("hrAdmin").post(`/api/letters/templates/${templateId}/versions`, { bodyHtml: "<p>{{employee.salary}}</p>" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/Unknown placeholder/);
  });

  // Issuing and reproducing each render a PDF, so they are two tests, each
  // with its own budget (CI runs are several times slower than local ones).
  let issued = { id: "", reference: "", sha: "" };
  it("issues a letter: values, version and timestamp frozen; rendered and filed in Letters; employee notified", async () => {
    const res = await issue("director", people.report.employeeId, { templateId, extraValues: { ctc: "1200000" } });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "QUEUED", templateVersion: 2, visibleToEmployee: true });
    expect(res.body.reference).toMatch(/^LTR-\d{6}$/);
    const queued = await lettersGenerateQueue().getJob(res.body.id);
    expect(queued?.data).toEqual({ letterId: res.body.id });

    expect(await processLetterJob(res.body.id)).toEqual({ status: "GENERATED" });
    const letter = await prisma.generatedLetter.findUniqueOrThrow({ where: { id: res.body.id }, include: { employeeDocument: { include: { category: true } }, templateVersion: true } });
    expect(letter.templateVersion.version).toBe(2);
    expect(letter.employeeDocument?.category.code).toBe("LETTERS");
    expect(letter.employeeDocument?.visibleToEmployee).toBe(true);
    const values = (letter.mergeValues as { values: Record<string, string> }).values;
    expect(values["extra.ctc"]).toBe("₹12,00,000");
    expect(values["letter.reference"]).toBe(res.body.reference);

    const stored = (await storageService.getObject(letter.employeeDocument!.fileKey)).body;
    expect(sha256(stored)).toBe(letter.pdfSha256);
    const text = await pdfText(stored);
    expect(text).toContain(res.body.reference);
    expect(text).toContain("₹12,00,000");
    expect(text).toContain(values["employee.fullName"]!);
    expect(text).toContain("Welcome aboard.");

    const notes = await prisma.notification.findMany({ where: { userId: people.report.userId, type: "document.added" } });
    expect(notes.some((n) => (n.payload as { letterId?: string }).letterId === res.body.id)).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityId: res.body.id, action: "letters.issued" } })).toBe(1);
    issued = { id: res.body.id, reference: res.body.reference, sha: letter.pdfSha256! };
  });

  it("reproduces the issued letter byte-for-byte; a repeated job does nothing", async () => {
    expect(issued.id).not.toBe("");
    // Reproduce: from the stored version + values + timestamp, same bytes.
    // (A director: a letter is a PAY document, which neither HR role can open since Stage 1.)
    expect((await as("hrAdmin").post(`/api/letters/${issued.id}/reproduce`)).status).toBe(403);
    const repro = await as("director").post(`/api/letters/${issued.id}/reproduce`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(repro.status).toBe(200);
    expect(repro.headers["content-type"]).toBe("application/pdf");
    expect(repro.headers["x-letter-reproduction"]).toBe("match");
    expect(sha256(repro.body as Buffer)).toBe(issued.sha);

    // A second run of the same job (retry/duplicate) does nothing.
    expect(await processLetterJob(issued.id)).toEqual({ status: "SKIPPED" });
    expect(await prisma.employeeDocument.count({ where: { generatedLetter: { id: issued.id } } })).toBe(1);
  });

  it("uses the name in force on the letter's date, and an issued letter keeps it after a later rename", async () => {
    // A rename that takes effect tomorrow: today's letter must use today's name.
    const current = await prisma.employeeNameHistory.findFirstOrThrow({ where: { employeeId: people.outsider.employeeId, effectiveTo: null } });
    const tomorrow = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 2));
    await prisma.employeeNameHistory.update({ where: { id: current.id }, data: { effectiveTo: tomorrow } });
    await prisma.employeeNameHistory.create({ data: { employeeId: people.outsider.employeeId, fullName: "Renamed Person", effectiveFrom: tomorrow, createdByUserId: people.hrAdmin.userId } });

    const res = await issue("director", people.outsider.employeeId, { templateId, extraValues: { ctc: "500000" } });
    await processLetterJob(res.body.id);
    const letter = await prisma.generatedLetter.findUniqueOrThrow({ where: { id: res.body.id }, include: { employeeDocument: true } });
    expect((letter.mergeValues as { values: Record<string, string> }).values["employee.fullName"]).toBe(current.fullName);
    const text = await pdfText((await storageService.getObject(letter.employeeDocument!.fileKey)).body);
    expect(text).toContain(current.fullName);
    expect(text).not.toContain("Renamed Person");
  });

  it("data scope: a manager allowed to issue letters can do so for their team, and gets 404 for anyone else", async () => {
    await grantPermissions("MANAGER", ["letters.generate"]);
    const own = await issue("manager", people.report.employeeId, { templateId, extraValues: { ctc: "100" } });
    expect(own.status).toBe(202);
    const other = await issue("manager", people.outsider.employeeId, { templateId, extraValues: { ctc: "100" } });
    expect(other.status).toBe(404);
    const otherList = await as("manager").get(`/api/letters/employees/${people.outsider.employeeId}`);
    expect(otherList.status).toBe(404);
    if (!managerHadGenerate) await revokePermissions("MANAGER", ["letters.generate"]);
  });

  it("refuses up front, without burning a reference: missing required field, no separation, incomplete letterhead", async () => {
    const before = (await prisma.generatedLetter.aggregate({ _max: { number: true } }))._max.number ?? 0;
    const missing = await issue("director", people.report.employeeId, { templateId, extraValues: {} });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/Annual CTC/);

    const experience = await prisma.letterTemplate.findUniqueOrThrow({ where: { code: "EXPERIENCE" } });
    const noSep = await issue("director", people.report.employeeId, { templateId: experience.id });
    expect(noSep.status).toBe(409);
    expect(noSep.body.error.code).toBe("NO_SEPARATION");

    await setSetting(SIGNATORY_NAME_KEY, "");
    const noHead = await issue("director", people.report.employeeId, { templateId, extraValues: { ctc: "1" } });
    expect(noHead.status).toBe(409);
    expect(noHead.body.error.code).toBe("LETTERHEAD_INCOMPLETE");
    await setSetting(SIGNATORY_NAME_KEY, originalSignatory ?? "Test Signatory");

    const ok = await issue("director", people.report.employeeId, { templateId, extraValues: { ctc: "1" } });
    expect(ok.body.reference).toBe(`LTR-${String(before + 1).padStart(6, "0")}`);
  });

  it("all five seeded templates issue and render for a leaver (experience/relieving need the last working day)", async () => {
    const seeded = await prisma.letterTemplate.findMany({ where: { code: { in: ["OFFER", "APPOINTMENT", "EXPERIENCE", "RELIEVING", "ADDRESS_PROOF"] } } });
    expect(seeded).toHaveLength(5);
    for (const t of seeded) {
      const res = await issue("director", people.leaver.employeeId, { templateId: t.id, extraValues: { ctcAnnual: "900000", probationMonths: "3", addressedTo: "The Branch Manager" } });
      expect(res.status, t.code).toBe(202);
      expect(await processLetterJob(res.body.id), t.code).toEqual({ status: "GENERATED" });
      const letter = await prisma.generatedLetter.findUniqueOrThrow({ where: { id: res.body.id }, include: { employeeDocument: true } });
      const text = await pdfText((await storageService.getObject(letter.employeeDocument!.fileKey)).body);
      if (t.code === "EXPERIENCE" || t.code === "RELIEVING") expect(text, t.code).toContain("31 August 2026");
      expect(text, t.code).not.toMatch(/\{\{|\}\}/); // no placeholder printed literally
    }
  });

  it("reissue creates a new letter and document; the original stays exactly as issued", async () => {
    const first = await issue("director", people.report.employeeId, { templateId, extraValues: { ctc: "700000" } });
    await processLetterJob(first.body.id);
    const original = await prisma.generatedLetter.findUniqueOrThrow({ where: { id: first.body.id }, include: { employeeDocument: true } });
    const originalBytes = (await storageService.getObject(original.employeeDocument!.fileKey)).body;

    const re = await as("director").post(`/api/letters/${first.body.id}/reissue`, { extraValues: { ctc: "750000" } });
    expect(re.status).toBe(202);
    letterIds.push(re.body.id);
    expect(re.body.reissueOf).toEqual({ id: first.body.id, reference: first.body.reference });
    expect(re.body.reference).not.toBe(first.body.reference);
    await processLetterJob(re.body.id);

    const after = await prisma.generatedLetter.findUniqueOrThrow({ where: { id: first.body.id }, include: { employeeDocument: true } });
    expect(after).toEqual(original);
    expect((await storageService.getObject(after.employeeDocument!.fileKey)).body.equals(originalBytes)).toBe(true);
    const reissued = await prisma.generatedLetter.findUniqueOrThrow({ where: { id: re.body.id } });
    expect(reissued.employeeDocumentId).not.toBe(original.employeeDocumentId);
    expect((reissued.mergeValues as { values: Record<string, string> }).values["extra.ctc"]).toBe("₹7,50,000");
    expect(await prisma.auditLog.count({ where: { entityId: re.body.id, action: "letters.reissued" } })).toBe(1);
  });

  it("the database itself refuses to rewrite a template version, an issued letter, or a document's file", async () => {
    const letter = await prisma.generatedLetter.findFirstOrThrow({ where: { id: { in: letterIds }, status: "GENERATED" } });
    await expect(prisma.letterTemplateVersion.update({ where: { id: letter.templateVersionId }, data: { bodyHtml: "<p>tampered</p>" } })).rejects.toThrow(/immutable/);
    await expect(prisma.generatedLetter.update({ where: { id: letter.id }, data: { mergeValues: { values: {} } } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.generatedLetter.update({ where: { id: letter.id }, data: { generatedAt: new Date() } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.generatedLetter.update({ where: { id: letter.id }, data: { status: "FAILED" } })).rejects.toThrow(/already GENERATED/);
    await expect(prisma.employeeDocument.update({ where: { id: letter.employeeDocumentId! }, data: { fileKey: "letters/other.pdf" } })).rejects.toThrow(/cannot be replaced/);
    await expect(prisma.employeeDocument.delete({ where: { id: letter.employeeDocumentId! } })).rejects.toThrow();
  });

  it("an issued letter's document keeps its title and category; visibility can still change", async () => {
    const letter = await prisma.generatedLetter.findFirstOrThrow({ where: { id: { in: letterIds }, status: "GENERATED", employeeId: people.report.employeeId } });
    const rename = await as("director").patch(`/api/documents/employee-documents/${letter.employeeDocumentId}`, { title: "Something else" });
    expect(rename.status).toBe(409);
    expect(rename.body.error.code).toBe("LETTER_IMMUTABLE");
    const hide = await as("director").patch(`/api/documents/employee-documents/${letter.employeeDocumentId}`, { visibleToEmployee: false });
    expect(hide.status).toBe(200);
  });

  it("a render failure marks the letter FAILED with a reason and files nothing", async () => {
    const res = await issue("director", people.report.employeeId, { templateId, extraValues: { ctc: "1" } });
    await closePdfRenderer();
    const saved = process.env.CHROMIUM_PATH;
    process.env.CHROMIUM_PATH = "/nonexistent/chromium";
    try {
      expect(await processLetterJob(res.body.id)).toEqual({ status: "FAILED" });
    } finally {
      if (saved === undefined) delete process.env.CHROMIUM_PATH;
      else process.env.CHROMIUM_PATH = saved;
    }
    const failed = await prisma.generatedLetter.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureReason).toMatch(/CHROMIUM_PATH/);
    expect(failed.employeeDocumentId).toBeNull();
  });

  it("the renderer blocks every network request — a page can't make the server fetch anything", async () => {
    let hits = 0;
    const server: Server = createServer((_req, res) => {
      hits += 1;
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/probe.png`;
    try {
      const out = await renderPdf(`<!doctype html><html><head><link rel="stylesheet" href="${url}?css"></head><body><img src="${url}"><p>hi</p></body></html>`, new Date("2026-01-01T00:00:00Z"));
      expect(out.blockedRequests).toEqual(expect.arrayContaining([url, `${url}?css`]));
      expect(hits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("preview renders a draft against an employee and stores nothing", async () => {
    const before = await prisma.generatedLetter.count();
    const res = await as("hrAdmin")
      .post("/api/letters/templates/preview", { bodyHtml: "<p>Hello {{employee.fullName}}</p>", employeeId: people.report.employeeId })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await prisma.generatedLetter.count()).toBe(before);
  });

  // ── HR issues a letter only when the template is proven to carry no pay figure (the narrow key, a director-controlled switch) ──
  describe("letters without pay figures", () => {
    let freeId: string;
    const meta = () => ({ actorUserId: people.director.userId, ipAddress: null, userAgent: null });
    const flip = (state: "ON" | "OFF" | "DEFAULT", who: "hrAdmin" | "hrExec" | "all" = "all") =>
      Promise.all(
        (who === "all" ? (["HR_ADMIN", "HR_EXECUTIVE"] as const) : [who === "hrAdmin" ? "HR_ADMIN" : "HR_EXECUTIVE"]).map((roleCode) =>
          setSwitch({ capability: "ISSUE_LETTERS_NO_PAY", subject: { kind: "ROLE", roleCode }, state, reason: "test" } as never, meta()),
        ),
      );

    beforeAll(async () => {
      const t = await as("director").post("/api/letters/templates", {
        code: `TEST_FREE_${Date.now()}`,
        name: "Employment confirmation",
        bodyHtml: "<p>Ref {{letter.reference}}</p><p>This confirms that {{employee.fullName}} ({{employee.code}}) works with us as {{employee.designation}}. Addressed to {{extra.addressedTo}}.</p><p>{{signatory.name}}</p>",
        extraFields: [{ key: "addressedTo", label: "Addressed to", type: "text", required: false }],
      });
      expect(t.status).toBe(201);
      freeId = t.body.id;
      templateIds.push(freeId);
    });
    afterAll(async () => {
      await purgeAppendOnly("HrCapabilitySwitch", { createdByUserId: people.director.userId });
    });

    it("the template list says, for each template, whether HR may issue it, and why not", async () => {
      const list = (await as("hrAdmin").get("/api/letters/templates")).body as Array<{ id: string; payFree: { ok: boolean; reasons: string[] } }>;
      expect(list.find((t) => t.id === freeId)!.payFree.ok).toBe(true);
      const offer = list.find((t) => t.id === templateId)!; // the test offer letter carries a currency CTC field
      expect(offer.payFree.ok).toBe(false);
      expect(offer.payFree.reasons.join(" ")).toMatch(/currency/);
    });

    it("HR Admin and HR Executive issue a proven pay-free letter; a letter that could carry pay is refused with the reasons, and a director may issue both", async () => {
      for (const who of ["hrAdmin", "hrExec"] as const) {
        expect((await issue(who, people.report.employeeId, { templateId: freeId, extraValues: { addressedTo: "The Branch Manager" } })).status, who).toBe(202);
        const refused = await issue(who, people.report.employeeId, { templateId, extraValues: { ctc: "1200000" } });
        expect([refused.status, refused.body.error.code], who).toEqual([403, "PAY_LETTER_DIRECTOR_ONLY"]);
        expect(refused.body.error.message).toMatch(/director has to issue it/);
      }
      expect((await issue("director", people.report.employeeId, { templateId, extraValues: { ctc: "1200000" } })).status).toBe(202);
      expect((await issue("director", people.report.employeeId, { templateId: freeId, extraValues: {} })).status).toBe(202);
    });

    it("a pay figure typed into a text field of a pay-free letter is refused for HR", async () => {
      for (const bad of ["₹ 5,00,000", "CTC 12 LPA", "salary 40000"]) {
        const r = await issue("hrAdmin", people.report.employeeId, { templateId: freeId, extraValues: { addressedTo: bad } });
        expect([r.status, r.body.error.code], bad).toEqual([403, "PAY_LETTER_DIRECTOR_ONLY"]);
      }
    });

    it("editing a pay-free template into one that mentions pay takes it out of HR's hands at once (the proof is made at issue, from the current version)", async () => {
      const saved = await as("director").post(`/api/letters/templates/${freeId}/versions`, {
        bodyHtml: "<p>Dear {{employee.fullName}}, your salary is revised.</p>",
        extraFields: [],
      });
      expect(saved.status).toBe(201);
      const r = await issue("hrAdmin", people.report.employeeId, { templateId: freeId, extraValues: {} });
      expect([r.status, r.body.error.code]).toEqual([403, "PAY_LETTER_DIRECTOR_ONLY"]);
      await as("director").post(`/api/letters/templates/${freeId}/versions`, {
        bodyHtml: "<p>This confirms that {{employee.fullName}} works with us. Addressed to {{extra.addressedTo}}.</p>",
        extraFields: [{ key: "addressedTo", label: "Addressed to", type: "text", required: false }],
      });
    });

    it("the switch: off closes every letter route for HR, on one named person opens it, and the others never had it", async () => {
      await flip("OFF");
      try {
        for (const who of ["hrAdmin", "hrExec"] as const) {
          expect((await issue(who, people.report.employeeId, { templateId: freeId, extraValues: {} })).status, who).toBe(403);
          expect((await as(who).get(`/api/letters/employees/${people.report.employeeId}`)).status, who).toBe(403);
          expect((await as(who).get("/api/letters/templates")).status, `${who} list: HR_ADMIN keeps template management`).toBe(who === "hrAdmin" ? 200 : 403);
        }
        expect((await issue("director", people.report.employeeId, { templateId: freeId, extraValues: {} })).status).toBe(202);
      } finally {
        await flip("DEFAULT");
      }
      expect((await issue("hrAdmin", people.report.employeeId, { templateId: freeId, extraValues: {} })).status).toBe(202);
    });

    it("an employee and a manager never issue a letter, and nobody below a director reissues or reproduces one", async () => {
      for (const who of ["outsider", "manager"] as const) {
        expect((await issue(who, people.report.employeeId, { templateId: freeId, extraValues: {} })).status, who).toBe(403);
        expect((await as(who).get(`/api/letters/employees/${people.report.employeeId}`)).status, who).toBe(403);
      }
      const mine = await issue("hrAdmin", people.report.employeeId, { templateId: freeId, extraValues: {} });
      for (const who of ["hrAdmin", "hrExec"] as const) {
        expect((await as(who).post(`/api/letters/${mine.body.id}/reissue`, {})).status, who).toBe(403);
        expect((await as(who).post(`/api/letters/${mine.body.id}/reproduce`)).status, who).toBe(403);
      }
    });
  });
});
