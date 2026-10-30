import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { closeHrCapabilityQueue } from "../../../jobs/hrCapabilityQueue";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { DATASET_COLUMNS, type ImportDatasetKey } from "../../import/types";
import { setSwitch } from "../service";

// The narrow keys that replaced the wide ones the HR hard lock took (docs/plans/HR_CAPABILITIES.md): sending invitations, importing non-pay employee details. (Letters without pay figures:
// letters.test.ts and payFreeProof.test.ts.) Each is a director-controlled HR switch with the default as before; every route, and every import column, is tried for HR with the switch on,
// off and on for one named person, for an employee, a manager and a director.

type Person = { employeeId: string; employeeCode: string; userId: string };
const NON_PAY: ImportDatasetKey[] = ["org-masters", "employees", "leave-grants"];
const PAY: ImportDatasetKey[] = ["statutory", "bank"];

async function sheet(headers: string[], row?: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("data");
  ws.addRow(headers);
  if (row) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("the narrow keys, as HR switches", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"director" | "hrAdmin" | "hrExec" | "hrNamed" | "manager" | "employee", Person>;
  const tok = {} as Record<keyof typeof p, string>;
  const meta = () => ({ actorUserId: p.director.userId, ipAddress: null, userAgent: null });
  const roleSwitch = (capability: string, state: "ON" | "OFF" | "DEFAULT") =>
    Promise.all((["HR_ADMIN", "HR_EXECUTIVE"] as const).map((roleCode) => setSwitch({ capability, subject: { kind: "ROLE", roleCode }, state, reason: "test" } as never, meta())));
  const get = (who: keyof typeof p, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const post = (who: keyof typeof p, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body);
  const upload = (who: keyof typeof p, dataset: string, buffer: Buffer) => request(app).post(`/api/import/${dataset}/upload`).set(...authHeader(tok[who])).attach("file", buffer, "data.xlsx");
  const batchIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.hrNamed = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.employee = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
  });
  afterEach(async () => {
    await purgeAppendOnly("HrCapabilitySwitch", { createdByUserId: p.director.userId });
  });
  afterAll(async () => {
    for (const id of batchIds) await prisma.importBatch.deleteMany({ where: { id } });
    await closeHrCapabilityQueue();
    for (const k of Object.keys(p) as Array<keyof typeof p>) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("invitations", () => {
    const doors = () => [
      () => get("hrAdmin", "/api/employees/invitations"),
    ];
    const status = async (who: keyof typeof p) => ({
      list: (await get(who, "/api/employees/invitations")).status,
      send: (await post(who, "/api/employees/invitations/send", { employeeIds: [] })).status, // refused on input (400) when let in
      resend: (await post(who, `/api/employees/${p.employee.employeeId}/resend-invite`)).status,
    });
    void doors;

    it("HR holds it as before; a manager and an employee never; a director always", async () => {
      for (const who of ["hrAdmin", "hrExec", "director"] as const) for (const [door, st] of Object.entries(await status(who))) expect(st, `${who} ${door}`).not.toBe(403);
      for (const who of ["manager", "employee"] as const) for (const [door, st] of Object.entries(await status(who))) expect(st, `${who} ${door}`).toBe(403);
    });

    it("switched off for the HR roles it closes all three routes, and the director is unaffected", async () => {
      await roleSwitch("SEND_INVITATIONS", "OFF");
      for (const who of ["hrAdmin", "hrExec", "hrNamed"] as const) for (const [door, st] of Object.entries(await status(who))) expect(st, `${who} ${door}`).toBe(403);
      for (const [door, st] of Object.entries(await status("director"))) expect(st, `director ${door}`).not.toBe(403);
    });

    it("on for one named person puts it back for that person only", async () => {
      await roleSwitch("SEND_INVITATIONS", "OFF");
      await setSwitch({ capability: "SEND_INVITATIONS", subject: { kind: "USER", employeeId: p.hrNamed.employeeId }, state: "ON", reason: "test" } as never, meta());
      for (const [door, st] of Object.entries(await status("hrNamed"))) expect(st, `named ${door}`).not.toBe(403);
      for (const [door, st] of Object.entries(await status("hrExec"))) expect(st, `other ${door}`).toBe(403);
    });
  });

  describe("importing non-pay employee details", () => {
    it("HR may download the template and upload for org masters, employees and leave grants, and for no pay dataset", async () => {
      for (const who of ["hrAdmin", "hrExec"] as const) {
        for (const d of NON_PAY) expect((await get(who, `/api/import/${d}/template`)).status, `${who} ${d} template`).toBe(200);
        for (const d of PAY) expect((await get(who, `/api/import/${d}/template`)).status, `${who} ${d} template`).toBe(403);
        for (const d of PAY) expect((await upload(who, d, await sheet(DATASET_COLUMNS[d]))).status, `${who} ${d} upload`).toBe(403);
        expect((await get(who, "/api/import/reconciliation")).status).not.toBe(403);
      }
      for (const d of [...NON_PAY, ...PAY]) expect((await get("director", `/api/import/${d}/template`)).status, `director ${d}`).toBe(200);
    });

    it("an employee and a manager reach nothing in the Import Center", async () => {
      for (const who of ["employee", "manager"] as const) {
        for (const d of [...NON_PAY, ...PAY]) expect((await get(who, `/api/import/${d}/template`)).status, `${who} ${d}`).toBe(403);
        expect((await get(who, "/api/import/batches")).status).toBe(403);
        expect((await get(who, "/api/import/reconciliation")).status).toBe(403);
      }
    });

    it("every real column of every non-pay dataset is accepted from HR (none is mistaken for a pay column)", async () => {
      for (const d of NON_PAY) {
        for (const col of DATASET_COLUMNS[d]) {
          const r = await upload("hrAdmin", d, await sheet([col]));
          expect(r.body?.error?.code, `${d}.${col}`).not.toBe("PAY_COLUMNS_REFUSED");
          if (r.body?.batchId) batchIds.push(r.body.batchId);
        }
      }
    });

    it("a file with ANY pay, bank or statutory column is refused whole for HR, in every non-pay dataset; the same file from a director is not refused", async () => {
      const payColumns = ["ctc", "CTC", "annualCtc", "salary", "grossSalary", "basicPay", "netPay", "hra", "allowance", "bonus", "pfNumber", "esiNumber", "esi", "pan", "aadhaar", "uan", "accountNumber", "accountHolderName", "ifsc", "bankName", "bank_account", "tdsAmount", "loanAmount", "gratuity", "stipend"];
      for (const d of NON_PAY) {
        for (const col of payColumns) {
          const file = await sheet([DATASET_COLUMNS[d][0]!, col]);
          for (const who of ["hrAdmin", "hrExec"] as const) {
            const r = await upload(who, d, file);
            expect([r.status, r.body.error?.code], `${who} ${d} + ${col}`).toEqual([400, "PAY_COLUMNS_REFUSED"]);
          }
        }
      }
      const withPay = await upload("director", "employees", await sheet(["employeeCode", "ctc"]));
      expect(withPay.body?.error?.code).not.toBe("PAY_COLUMNS_REFUSED"); // the directors' import is as it was: unknown columns are ignored
      if (withPay.body?.batchId) batchIds.push(withPay.body.batchId);
    });

    it("HR cannot see or commit a bank or statutory batch a director uploaded, nor find it in the list", async () => {
      const made = await upload("director", "bank", await sheet(DATASET_COLUMNS.bank, ["X1", "A Name", "9999", "ABCD0123456", "A Bank", "A Branch"]));
      expect(made.status).toBe(201);
      batchIds.push(made.body.batchId);
      for (const who of ["hrAdmin", "hrExec"] as const) {
        expect((await get(who, `/api/import/batches/${made.body.batchId}`)).status, who).toBe(403);
        expect((await get(who, `/api/import/batches/${made.body.batchId}/error-report`)).status, who).toBe(403);
        expect((await post(who, `/api/import/batches/${made.body.batchId}/commit`, { confirmText: "IMPORT BANK DATA" })).status, who).toBe(403);
        expect((await get(who, "/api/import/batches?dataset=bank")).status, who).toBe(403);
        const list = (await get(who, "/api/import/batches")).body.batches as Array<{ dataset: string }>;
        expect(list.some((b) => b.dataset === "bank" || b.dataset === "statutory"), who).toBe(false);
      }
      expect((await get("director", `/api/import/batches/${made.body.batchId}`)).status).toBe(200);
      expect(((await get("director", "/api/import/batches")).body.batches as Array<{ id: string }>).some((b) => b.id === made.body.batchId)).toBe(true);
    });

    it("switched off, every import route closes for HR; on for one named person opens it for that person only; the director is unaffected", async () => {
      await roleSwitch("IMPORT_EMPLOYEE_DETAILS", "OFF");
      for (const who of ["hrAdmin", "hrExec", "hrNamed"] as const) {
        for (const d of NON_PAY) expect((await get(who, `/api/import/${d}/template`)).status, `${who} ${d}`).toBe(403);
        expect((await upload(who, "employees", await sheet(["employeeCode"]))).status, who).toBe(403);
        expect((await get(who, "/api/import/batches")).status, who).toBe(403);
        expect((await get(who, "/api/import/reconciliation")).status, who).toBe(403);
      }
      expect((await get("director", "/api/import/employees/template")).status).toBe(200);
      await setSwitch({ capability: "IMPORT_EMPLOYEE_DETAILS", subject: { kind: "USER", employeeId: p.hrNamed.employeeId }, state: "ON", reason: "test" } as never, meta());
      expect((await get("hrNamed", "/api/import/employees/template")).status).toBe(200);
      expect((await get("hrNamed", "/api/import/bank/template")).status).toBe(403);
      expect((await get("hrExec", "/api/import/employees/template")).status).toBe(403);
    });
  });
});
