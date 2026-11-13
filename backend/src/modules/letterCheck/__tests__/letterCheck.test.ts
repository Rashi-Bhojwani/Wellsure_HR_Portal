import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { minimalPdf } from "../../../lib/devFixtures";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { app, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// LT-09 (M session block 2): a letter is checked by its PDF; the answer says genuine or not and carries no personal data.
describe("checking a letter", () => {
  let org: TestOrgMasters;
  let employeeId = "";
  let templateId = "";
  let genuinePdf: Buffer;
  const check = (pdf: Buffer) => request(app).post("/api/public/letter-check").attach("file", pdf, "letter.pdf");
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    const e = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    employeeId = e.employeeId;
    const code = `LTCHK_${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, "")}`;
    const tpl = await prisma.letterTemplate.create({ data: { code, name: "Test address proof", versions: { create: { version: 1, bodyHtml: "<p>x</p>", extraFields: [] } } }, include: { versions: true } });
    templateId = tpl.id;
    genuinePdf = Buffer.from(await minimalPdf("Address proof", [`This is to certify ${randomUUID()}`]));
    const letter = await prisma.generatedLetter.create({ data: { employeeId, templateVersionId: tpl.versions[0]!.id, mergeValues: {}, generatedAt: new Date("2026-11-10T06:00:00Z"), generatedByUserId: e.userId, visibleToEmployee: true, status: "GENERATED", pdfSha256: createHash("sha256").update(genuinePdf).digest("hex") } });
    await prisma.letterRequest.create({ data: { batchId: randomUUID(), clientKey: randomUUID(), templateId, employeeId, preparedByUserId: e.userId, status: "ISSUED", issuedByUserId: e.userId, issuedAt: new Date("2026-11-10T06:00:00Z"), serial: "TEST/1", generatedLetterId: letter.id, signatories: { create: [{ position: 1, signatoryEmployeeId: employeeId, status: "SIGNED", signedAt: new Date("2026-11-09T06:00:00Z") }] } } });
  });
  afterAll(async () => {
    await deleteWithDependents("LetterTemplate", [templateId]);
    await cleanupFullTestEmployee(employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the issued PDF is genuine: reference, letter, date and the signature recorded; no name or code of anyone", async () => {
    const res = await check(genuinePdf);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ genuine: true, letter: "Test address proof", issuedOn: "2026-11-10", replacedByALaterLetter: false, signatures: [{ position: 1, signedOn: "2026-11-09" }] });
    expect(res.body.reference).toMatch(/^LTR-/);
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { employeeCode: true } });
    expect(JSON.stringify(res.body)).not.toContain(emp.employeeCode);
    expect(JSON.stringify(res.body)).not.toContain(employeeId);
  });

  it("a changed PDF, any other PDF, or not a PDF is not genuine", async () => {
    const changed = Buffer.concat([genuinePdf, Buffer.from(" ")]);
    expect((await check(changed)).body).toEqual({ genuine: false });
    expect((await check(Buffer.from(await minimalPdf("Other", ["x"])))).body).toEqual({ genuine: false });
    expect((await check(Buffer.from("not a pdf"))).status).toBe(400);
  });
});
