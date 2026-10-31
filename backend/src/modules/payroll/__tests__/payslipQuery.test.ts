import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { activeDirectors } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, driveToFinal, requestStep, resetSeams, staffWith, type Closing } from "./closeTestHelpers";
import { api, calculateRun, setRules } from "./runTestHelpers";

// Stage 5b, B5: "Raise a query" on a payslip opens a ticket in the Payroll category, which only directors see, with its counts. The employee sees their own ticket and its status.

describe("raising a query on a payslip", () => {
  let world: Closing;
  let runId = "";
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let tok: { a: string; b: string; dev: string; hr: string };
  const slipOf = (n: string) => prisma.payslip.findFirstOrThrow({ where: { runId, employeeId: world.named[n]!.employeeId } });
  const ask = (token: string, id: string, body: object) => request(app).post(`/api/payslips/mine/${id}/query`).set(...authHeader(token)).send(body);
  const get = (token: string, path: string) => request(app).get(`/api/helpdesk${path}`).set(...authHeader(token));
  let ticketId = "";

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    await requestStep(world.tokens.maker, runId, "publish");
    await approve(world, world.tokens.checkerB, runId, "publish");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`)).status).toBe(201);
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    world.userIds.push(dev.userId, hr.userId);
    tok = { a: await loginAs(world.named.a!.employeeCode), b: await loginAs(world.named.b!.employeeCode), dev: await loginAs(dev.employeeCode), hr: await loginAs(hr.employeeCode) };
  }, 900_000);
  afterAll(async () => {
    resetSeams();
    vi.restoreAllMocks();
    const tickets = (await prisma.helpdeskTicket.findMany({ where: { raisedByEmployeeId: { in: Object.values(world.named).map((p) => p.employeeId) } }, select: { id: true } })).map((t) => t.id);
    await deleteWithDependents("HelpdeskTicket", tickets);
    for (const x of [hr, dev]) await cleanupFullTestEmployee(x.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("the employee raises a query on their own payslip: a Payroll ticket, handed to a director, naming the month and no figure", async () => {
    const slip = await slipOf("a");
    expect((await ask(tok.a, slip.id, { message: "x" })).status).toBe(400);
    expect((await ask(tok.a, slip.id, { message: "Why is this month different?", extra: 1 })).status).toBe(400);
    expect((await ask(tok.a, (await slipOf("b")).id, { message: "This is not mine" })).status).toBe(404); // somebody else's payslip does not exist for you
    const r = await ask(tok.a, slip.id, { message: "Why is this month different from last month?" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ticketId = r.body.ticketId;
    const t = await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { category: true, messages: true } });
    expect([t.category.code, t.category.directorsOnly, t.raisedByEmployeeId]).toEqual(["PAYROLL_SALARY", true, world.named.a!.employeeId]);
    expect(t.subject).toContain(slip.cycleLabel);
    expect(t.messages[0]!.body).toBe("Why is this month different from last month?");
    expect(JSON.stringify(t)).not.toContain((slip.content as { totals: { net: string } }).totals.net); // no figure of the payslip is copied in
    expect((await activeDirectors()).map((d) => d.employeeId)).toContain(t.assigneeEmployeeId); // a director, never the person who asked
    expect(await prisma.auditLog.count({ where: { action: "payroll.payslip.query_raised", entityId: slip.id } })).toBe(1);
  });

  it("HR, the Developer role and other employees never see the ticket or its counts; directors do; the employee sees their own and its status", async () => {
    for (const who of [tok.hr, tok.dev, tok.b]) {
      expect([404, 403]).toContain((await get(who, `/tickets/${ticketId}`)).status);
      const mine = await get(who, "/tickets/mine");
      expect((mine.body as Array<{ id: string }>).map((t) => t.id)).not.toContain(ticketId);
    }
    const queueHr = await get(tok.hr, "/queue");
    expect(queueHr.status).toBe(200);
    expect(JSON.stringify(queueHr.body)).not.toContain(ticketId);
    expect(JSON.stringify((await get(tok.dev, "/queue")).body)).not.toContain(ticketId);
    const dirQueue = await get(world.tokens.checkerA, "/queue");
    expect(JSON.stringify(dirQueue.body)).toContain(ticketId);
    // The tasks inbox counts (what HR's To do shows) leave it out too.
    const hrTasks = await request(app).get("/api/tasks").set(...authHeader(tok.hr));
    expect(JSON.stringify(hrTasks.body)).not.toContain(ticketId);
    const own = await get(tok.a, "/tickets/mine");
    const row = (own.body as Array<{ id: string; status: string }>).find((t) => t.id === ticketId);
    expect(row).toMatchObject({ id: ticketId, status: "OPEN" });
    expect((await get(tok.a, `/tickets/${ticketId}`)).status).toBe(200);
  });
});
