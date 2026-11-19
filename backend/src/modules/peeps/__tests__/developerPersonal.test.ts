import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma";
import { app, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { crawlGets, type Crawled } from "../../payroll/__tests__/sensitiveCrawl";
import { clearPeepsSettings, withDirectoryContactFields } from "./peepsTestKit";
import request from "supertest";

// Final merge, meeting point (b): the Developer no longer sees personal email, mobile, addresses, emergency contact, date of birth, gender or blood
// group (employee.personal.view). One employee carries unmistakable fictional values, appears in Peeps data (a badge, a nudge tag, the colleague
// directory with every contact field switched on), and every GET route of the API is called as the Developer with that employee's ids. None of the
// values may come back. The same crawl as HR must find them somewhere, so the scan is not blind.

describe("the Developer sees no personal details anywhere in Peeps (or the rest of the API)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"director" | "hr" | "developer" | "subject" | "colleague", Awaited<ReturnType<typeof createFullTestEmployee>>>;
  const tok = {} as Record<keyof typeof p, string>;
  let undoDirectory: () => Promise<void> = async () => undefined;
  const tag = randomUUID().slice(0, 6);
  const VALUES = {
    personalEmail: `demo.personal.${tag}@gmail.com`,
    mobile: `98${tag.replace(/\D/g, "7").padEnd(6, "7").slice(0, 6)}31`,
    currentAddress: `DEMO-CURRENT-ADDRESS-${tag}`,
    permanentAddress: `DEMO-PERMANENT-ADDRESS-${tag}`,
    emergencyContactName: `DEMO-EMERGENCY-NAME-${tag}`,
    emergencyContactPhone: `97${tag.replace(/\D/g, "3").padEnd(6, "3").slice(0, 6)}53`,
    emergencyContactRelation: `DEMO-RELATION-${tag}`,
    bloodGroup: "AB-",
  };
  const DOB = "1963-03-17"; // shown as a birthday "17 Mar" / "Mar 17" too
  const leaksIn = (crawl: Crawled[]) => {
    const found: string[] = [];
    for (const c of crawl) {
      if (c.status >= 300) continue;
      for (const [k, v] of Object.entries(VALUES)) if (k !== "bloodGroup" && c.text.includes(v)) found.push(`${k} on ${c.route}`);
      if (c.text.includes(DOB) || /\b17 Mar\b|\bMar 17\b|"03-17"/.test(c.text)) found.push(`dateOfBirth on ${c.route}`);
      if (c.text.includes(p.subject.employeeId) && /"bloodGroup":"AB-"/.test(c.text)) found.push(`bloodGroup on ${c.route}`);
    }
    return [...new Set(found)];
  };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    p.subject = await createFullTestEmployee(org);
    p.colleague = await createFullTestEmployee(org);
    await prisma.employeePersonal.update({ where: { employeeId: p.subject.employeeId }, data: { ...VALUES, dateOfBirth: new Date(`${DOB}T00:00:00Z`) } });
    for (const k of Object.keys(p) as (keyof typeof p)[]) tok[k] = await loginAs(p[k].employeeCode);
    undoDirectory = await withDirectoryContactFields(org); // work email, phone and birthday all switched on for colleagues
    // The subject appears in Peeps data: a badge and a nudge tag from a director.
    const badge = await request(app).post("/api/badges").set("Authorization", `Bearer ${tok.director}`).send({ recipientEmployeeId: p.subject.employeeId, badgeCode: "TEAM_PLAYER", message: "DEMO thanks", idempotencyKey: randomUUID() });
    expect(badge.status, JSON.stringify(badge.body)).toBe(201);
    const nudge = await request(app).post("/api/nudges").set("Authorization", `Bearer ${tok.director}`).send({ recipientEmployeeId: p.subject.employeeId, tagCode: "SCROLL_MASTER", idempotencyKey: randomUUID() });
    expect(nudge.status, JSON.stringify(nudge.body)).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await undoDirectory();
    await clearPeepsSettings();
    for (const k of Object.keys(p) as (keyof typeof p)[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("every GET route, as the Developer, with the subject's ids: none of the personal values comes back; HR does see them (the scan is not blind)", async () => {
    const params = { employeeId: [p.subject.employeeId], id: [p.subject.employeeId] };
    const asDeveloper = await crawlGets(app as never, tok.developer, params);
    expect(asDeveloper.length).toBeGreaterThan(300);
    expect(leaksIn(asDeveloper)).toEqual([]);
    const asHr = await crawlGets(app as never, tok.hr, params);
    expect(leaksIn(asHr).some((l) => l.startsWith("personalEmail"))).toBe(true);
  }, 600_000);

  it("the colleague directory with every contact field on: a colleague sees the phone and birthday the directors chose; the Developer sees neither", async () => {
    const search = async (who: "colleague" | "developer") => JSON.stringify((await request(app).get(`/api/people?pageSize=100`).set("Authorization", `Bearer ${tok[who]}`)).body);
    const colleagueView = await search("colleague");
    expect(colleagueView).toContain(p.subject.employeeId);
    const devView = await search("developer");
    for (const v of [VALUES.mobile, VALUES.personalEmail, DOB]) expect(devView).not.toContain(v);
    expect(devView).not.toMatch(/\b17 Mar\b|\bMar 17\b|"03-17"/);
  });

  it("the Developer holds no leave.policy.manage after the merge, and the Peeps leave-rules routes refuse them", async () => {
    const { resolveAccess } = await import("../../../lib/permissions");
    expect((await resolveAccess(p.developer.userId)).permissions.has("leave.policy.manage")).toBe(false);
    expect((await request(app).get("/api/leave-rules").set("Authorization", `Bearer ${tok.developer}`)).status).toBe(403);
    expect((await request(app).get("/api/leave-rules").set("Authorization", `Bearer ${tok.hr}`)).status).toBe(200);
  });
});
