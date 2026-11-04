import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { cleanupTestCategories, createTestCategory, pdf } from "../../documents/__tests__/documentsTestHelpers";
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
import { codeFromFileName } from "../bulk";

// A-9 G4 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 13): bulk documents and photos named by employee number. Made-up people and files only.

type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const TEAM_ROLE = `TEST_A9_BULK_${Date.now()}`;

describe("A-9 G4 — bulk document and photo upload", { timeout: 60_000 }, () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  let general: string;
  let payCat: string;
  let png: Buffer;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const upload = (who: string, path: string, files: Array<[Buffer, string, string?]>, fields: Record<string, string> = {}) => {
    let r = request(app).post(`/api/employee-extras/bulk/${path}`).set(...authHeader(tok[who]!));
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    for (const [buf, name, type] of files) r = r.attach("files", buf, { filename: name, contentType: type ?? (name.endsWith(".pdf") ? "application/pdf" : "image/png") });
    return r;
  };
  const outcome = (body: { rows: Array<{ fileName: string; outcome: string }> }, file: string) => body.rows.find((r) => r.fileName === file)?.outcome;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    general = (await createTestCategory("EMPLOYEE")).id;
    payCat = (await createTestCategory("EMPLOYEE", { sensitivity: "PAY" })).id;
    png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.a = await createFullTestEmployee(org);
    p.b = await createFullTestEmployee(org);
    await prisma.role.create({ data: { code: TEAM_ROLE, name: TEAM_ROLE, dataScope: "TEAM" } });
    await grantPermissions(TEAM_ROLE, ["employee.documents.manage", "employee.documents.view", "employee.edit"]);
    p.lead = await createFullTestEmployee(org, { roleCode: TEAM_ROLE });
    p.report = await createFullTestEmployee(org, { managerId: p.lead.employeeId });
    p.outsider = await createFullTestEmployee(otherOrg);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
  }, 120_000);

  afterAll(async () => {
    await cleanupTestCategories([general, payCat]);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupTestRole(TEAM_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  }, 120_000);

  it("reads the employee number from the file name", () => {
    expect(codeFromFileName("EMP-001.pdf")).toBe("EMP-001");
    expect(codeFromFileName("EMP_001__offer scan.pdf")).toBe("EMP_001");
    expect(codeFromFileName("EMP-001 offer.pdf")).toBeNull();
    expect(codeFromFileName("no-extension")).toBeNull();
    expect(codeFromFileName(".pdf")).toBeNull();
  });

  it("the Developer role, an employee and an unsigned caller are refused; HR cannot file under a PAY category", async () => {
    for (const path of ["documents/preview", "documents", "photos/preview", "photos"]) {
      for (const who of ["dev", "a"]) expect((await upload(who, path, [[pdf(), `${p.a!.employeeCode}.pdf`]], { categoryId: general })).status, `${who} ${path}`).toBe(403);
      expect((await request(app).post(`/api/employee-extras/bulk/${path}`)).status).toBe(401);
    }
    const pay = await upload("hr", "documents/preview", [[pdf(), `${p.a!.employeeCode}.pdf`]], { categoryId: payCat });
    expect([pay.status, pay.body.error.code]).toEqual([403, "CATEGORY_RESTRICTED"]);
  });

  it("documents: a preview names every problem and files nothing; the upload files only the matched ones, each audited, and a second upload files nothing twice", async () => {
    const files: Array<[Buffer, string, string?]> = [
      [pdf(), `${p.a!.employeeCode}__contract.pdf`],
      [pdf(), `${p.b!.employeeCode}.pdf`],
      [pdf(), `${p.b!.employeeCode}.pdf`], // the same name twice for one person
      [pdf(), "NOBODY-999.pdf"],
      [pdf(), "badly named file.pdf"],
      [pdf(), `${p.outsider!.employeeCode}.pdf`], // outside the team viewer's scope (used below)
      [Buffer.from("MZ"), `${p.a!.employeeCode}__tool.exe`, "application/octet-stream"],
    ];
    const before = await prisma.employeeDocument.count({ where: { categoryId: general } });
    const pre = await upload("hr", "documents/preview", files, { categoryId: general });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect([outcome(pre.body, `${p.a!.employeeCode}__contract.pdf`), outcome(pre.body, "NOBODY-999.pdf"), outcome(pre.body, "badly named file.pdf"), outcome(pre.body, `${p.a!.employeeCode}__tool.exe`)]).toEqual(["READY", "UNMATCHED", "BAD_NAME", "WRONG_TYPE"]);
    expect(pre.body.rows.filter((r: { outcome: string }) => r.outcome === "DUPLICATE")).toHaveLength(2);
    expect(await prisma.employeeDocument.count({ where: { categoryId: general } })).toBe(before);

    const done = await upload("hr", "documents", files, { categoryId: general, title: "Scanned contract" });
    expect([done.status, done.body.uploaded]).toEqual([200, 2]); // a, and the outsider (HR sees everyone)
    expect(await prisma.employeeDocument.count({ where: { categoryId: general } })).toBe(before + 2);
    expect(await prisma.auditLog.count({ where: { action: "employee.document.uploaded", entityId: p.a!.employeeId } })).toBeGreaterThan(0);
    const batch = await prisma.auditLog.findFirstOrThrow({ where: { action: "employee.document.bulk_uploaded", actorUserId: p.hr!.userId }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(batch.after)).toContain("UNMATCHED");

    const again = await upload("hr", "documents", files, { categoryId: general });
    expect([again.body.uploaded, outcome(again.body, `${p.a!.employeeCode}__contract.pdf`)]).toEqual([0, "ALREADY_UPLOADED"]);
    expect(await prisma.employeeDocument.count({ where: { categoryId: general } })).toBe(before + 2);
  });

  it("a team-scoped uploader: someone outside their scope reads exactly like a number that does not exist", async () => {
    const res = await upload("lead", "documents/preview", [[pdf(), `${p.outsider!.employeeCode}.pdf`], [pdf(), `${p.report!.employeeCode}.pdf`]], { categoryId: general });
    expect([outcome(res.body, `${p.outsider!.employeeCode}.pdf`), outcome(res.body, `${p.report!.employeeCode}.pdf`)]).toEqual(["UNMATCHED", "READY"]);
    expect(res.body.rows[0].reason).toBe("No employee with that number that you can see.");
  });

  it("photos: through the existing photo path (re-encoded); two for one person are both left out; wrong type is refused", async () => {
    const res = await upload("hr", "photos", [
      [png, `${p.a!.employeeCode}.png`],
      [png, `${p.b!.employeeCode}.png`],
      [png, `${p.b!.employeeCode}__second.png`],
      [pdf(), `${p.a!.employeeCode}__cv.pdf`, "application/pdf"],
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([outcome(res.body, `${p.a!.employeeCode}.png`), outcome(res.body, `${p.b!.employeeCode}.png`), outcome(res.body, `${p.a!.employeeCode}__cv.pdf`)]).toEqual(["UPLOADED", "DUPLICATE", "WRONG_TYPE"]);
    const a = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: p.a!.employeeId } });
    const b = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: p.b!.employeeId } });
    expect(a.photoStorageKey).toMatch(/\.webp$/); // re-encoded by the existing path
    expect(b.photoStorageKey).toBeNull();
  });
});
