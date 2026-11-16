import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { notifyEmployee } from "../notifyEmployee";
import { resetPolicy, setPolicy } from "../../policySettings/__tests__/policyTestHelpers";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// NT-11 (M session): SMS / WhatsApp. Provider Not set: nothing is sent. Once directors choose a provider and notices, a text goes for those notices
// only, carrying the notice's title and never its body. Checked on the local driver's output (.messages/).
const DIR = path.resolve(process.cwd(), ".messages");
async function texts(): Promise<Array<{ channel: string; to: string; body: string; file: string }>> {
  const files = await readdir(DIR).catch(() => [] as string[]);
  return Promise.all(files.map(async (f) => ({ ...JSON.parse(await readFile(path.join(DIR, f), "utf8")), file: f })));
}

describe("text messages", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const MOBILE = "9876512345";
  const SECRET = "Reason: medical, confidential 4242";
  const forPerson = async () => (await texts()).filter((m) => m.to === MOBILE);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["emp", undefined], ["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
    await prisma.employeePersonal.update({ where: { employeeId: e.emp! }, data: { mobile: MOBILE } });
  });
  afterAll(async () => {
    await resetPolicy("policy.textMessages", t.d1!, t.d2!);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("while the provider is Not set (the default) nothing is sent, though the in-app notice is stored", async () => {
    const before = (await forPerson()).length;
    await notifyEmployee(e.emp!, { type: "leave.decided", title: "Your leave was approved", body: SECRET });
    expect((await forPerson()).length).toBe(before);
    expect(await prisma.notification.count({ where: { type: "leave.decided", user: { employeeId: e.emp! } } })).toBe(1);
  });

  it("only directors choose the provider and the notices (HR and the Developer refused); an unknown notice is refused", async () => {
    for (const who of ["hr", "dev", "emp"]) expect((await request(app).post("/api/policy-settings/policy.textMessages/proposals").set(...authHeader(t[who]!)).send({ value: { provider: "SMS", categories: ["LEAVE_DECISION"] }, reason: "Try" })).status, who).toBe(403);
    expect((await request(app).post("/api/policy-settings/policy.textMessages/proposals").set(...authHeader(t.d1!)).send({ value: { provider: "SMS", categories: ["SALARY_SLIP"] }, reason: "Try" })).status).toBe(400);
  });

  it("chosen: a chosen notice goes as a text with its title only, never the body; other notices and provider NONE send nothing", async () => {
    await setPolicy("policy.textMessages", { provider: "SMS", categories: ["LEAVE_DECISION"] }, t.d1!, t.d2!);
    const before = (await forPerson()).length;
    await notifyEmployee(e.emp!, { type: "leave.decided", title: "Your leave was approved", body: SECRET });
    const sent = (await forPerson()).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "SMS", to: MOBILE, body: "Your leave was approved. Open the HR portal for details." });
    expect(JSON.stringify(sent)).not.toContain("4242");
    expect(JSON.stringify(sent)).not.toContain("medical");
    await notifyEmployee(e.emp!, { type: "document.added", title: "New letter", body: "x" });
    expect((await forPerson()).length).toBe(before + 1);
    await setPolicy("policy.textMessages", { provider: "NONE", categories: ["LEAVE_DECISION"] }, t.d1!, t.d2!);
    await notifyEmployee(e.emp!, { type: "leave.decided", title: "Your leave was approved", body: SECRET });
    expect((await forPerson()).length).toBe(before + 1);
  });
});
