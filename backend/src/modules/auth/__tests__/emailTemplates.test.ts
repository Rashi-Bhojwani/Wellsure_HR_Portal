import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { mailService } from "../../../integrations/mail";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { sendInvitationEmail } from "../emails";
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

// NT-08 (M session): directors edit the wording of the sign-in emails; the link is always added by the code; plain text only; audited.
describe("editable sign-in email wording", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const put = (who: string, body: object) => request(app).put("/api/settings/email-templates").set(...authHeader(t[who]!)).send(body);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["dir", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["emp", undefined], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      t[k] = await loginAs(e.employeeCode);
    }
  });
  afterAll(async () => {
    await put("dir", { key: "INVITATION", text: null });
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("starts from the built-in wording, and only a director may read or change it", async () => {
    const res = await request(app).get("/api/settings/email-templates").set(...authHeader(t.dir!));
    expect(res.status).toBe(200);
    expect(res.body.templates.every((x: { isDefault: boolean }) => x.isDefault)).toBe(true);
    for (const who of ["hr", "emp", "dev"]) {
      expect((await request(app).get("/api/settings/email-templates").set(...authHeader(t[who]!))).status, who).toBe(403);
      expect((await put(who, { key: "WELCOME", text: null })).status, who).toBe(403);
    }
  });

  it("a director's wording is used, escaped, with the link still added by the code; unknown placeholders are refused; audited", async () => {
    expect((await put("dir", { key: "INVITATION", text: { subject: "Hello {{fullName}}", heading: "Join us", body: "Code {{salary}}" } })).status).toBe(400);
    const ok = await put("dir", { key: "INVITATION", text: { subject: "Hello {{fullName}}", heading: "Join us", body: "Your code is {{employeeCode}}.\n\n<script>x</script> Welcome aboard." } });
    expect(ok.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "settings.email_template.updated", entityId: "email.templates.INVITATION" } })).toBeGreaterThan(0);
    const sent: Array<{ subject: string; html?: string }> = [];
    const original = mailService.send.bind(mailService);
    (mailService as { send: typeof mailService.send }).send = async (m) => {
      sent.push(m as { subject: string; html?: string });
      return { status: "SENT", messageId: "test" } as never;
    };
    try {
      await sendInvitationEmail("someone@example.com", "Made Up Person", "T-123", "tok123");
    } finally {
      (mailService as { send: typeof mailService.send }).send = original;
    }
    expect(sent[0]!.subject).toBe("Hello Made Up Person");
    expect(sent[0]!.html).toContain("Your code is T-123.");
    expect(sent[0]!.html).toContain("&lt;script&gt;");
    expect(sent[0]!.html).not.toContain("<script>");
    expect(sent[0]!.html).toContain("/set-password/tok123");
    expect(sent[0]!.html).toContain("valid for 48 hours");
    // Back to the built-in wording.
    const reset = await put("dir", { key: "INVITATION", text: null });
    expect(reset.body.templates.find((x: { key: string }) => x.key === "INVITATION").isDefault).toBe(true);
  });
});
