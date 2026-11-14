import { randomUUID } from "node:crypto";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, seedDemoCompany } from "../../../../scripts/demo/seedDemoCompany";
import { mailService } from "../../../integrations/mail";
import { logger } from "../../../lib/logger";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { setSocketServer } from "../../../realtime/emit";
import { clearRateLimits } from "../../auth/__tests__/authTestHelpers";
import { identityPdf, IDENTITY } from "../../autofill/__tests__/synthetic";
import * as autofill from "../../autofill/service";
import { app } from "../../employee/__tests__/employeeTestHelpers";
import { crawlGets, type Crawled } from "../../payroll/__tests__/sensitiveCrawl";
import { registerPayrollSeams } from "../../payroll/wiring";

// Peeps Stage 4, phase 2: the confidentiality scan, on the demo company (`npm run test:peeps-demo`). Every confidential class has a marker in the
// demo data (or one this file creates: a nudge review request and an autofill extraction). Signed in as each of the thirteen demo people, the
// crawler calls every GET route the API serves (lists, counts, dashboards, search, exports, tasks, notifications) with the confidential records'
// real ids filled in, and the test asserts that each marker reaches only the people allowed to see it. It also asserts that no marker is in any
// log line, any stored notification, any e-mail written, or any socket event emitted, for anyone.

const ALL = ["DEMO001", "DEMO002", "DEMO003", "DEMO004", "DEMO005", "DEMO006", "DEMO007", "DEMO008", "DEMO009", "DEMO010", "DEMO011", "DEMO012", "DEMO013"];
const DIRECTORS = ["DEMO001", "DEMO013"];
type Mark = { name: string; text: string | RegExp; allowed: string[] };

describe("Peeps confidentiality scan on the demo company", () => {
  const token: Record<string, string> = {};
  const who: Record<string, { employeeId: string; userId: string }> = {};
  const logLines: string[] = [];
  const socketEvents: string[] = [];
  const mails: string[] = [];
  let restoreLog: () => void = () => undefined;
  let logLinesBeforeSearch = 0; // the search test puts markers in URLs itself, and the request log prints the URL
  let marks: Mark[] = [];
  const crawled: Record<string, Crawled[]> = {};

  beforeAll(async () => {
    const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
    const original = stream.write.bind(stream);
    stream.write = (line: string) => { logLines.push(String(line)); return original(line); };
    const send = mailService.send.bind(mailService);
    mailService.send = async (message) => { mails.push(JSON.stringify(message)); return send(message); };
    restoreLog = () => { stream.write = original; mailService.send = send; };
    setSocketServer({ to: (room) => ({ emit: (event: string, ...args: unknown[]) => socketEvents.push(`${String(room)} ${event} ${JSON.stringify(args)}`) }) });

    registerPayrollSeams();
    const demo = await seedDemoCompany();
    for (const l of demo.logins) {
      await clearRateLimits();
      const r = await request(app).post("/api/auth/login").send({ employeeCode: l.code, password: DEMO_PASSWORD });
      if (r.status !== 200) throw new Error(`login ${l.code}: ${r.status}`);
      token[l.code] = r.body.accessToken as string;
    }
    for (const u of await prisma.user.findMany({ where: { employee: { employeeCode: { in: ALL } } }, select: { id: true, employeeId: true, employee: { select: { employeeCode: true } } } })) who[u.employee.employeeCode] = { employeeId: u.employeeId, userId: u.id };

    // Two classes the demo does not carry: a nudge review request (DEMO006 asks about their demo tag) and an autofill extraction (HR reads a
    // synthetic identity document for DEMO009, with a fictional PAN).
    const tag = await prisma.nudgeTagAward.findFirstOrThrow({ where: { recipientEmployeeId: who.DEMO006!.employeeId } });
    expect((await request(app).post(`/api/nudges/${tag.id}/review`).set("Authorization", `Bearer ${token.DEMO006}`).send({})).status).toBe(200);
    const director = async (code: string) => ({ userId: who[code]!.userId, employeeId: who[code]!.employeeId, ...(await resolveAccess(who[code]!.userId)) }) as never;
    await autofill.setSetting("retention", { value: { days: 30 }, version: 0, reason: "DEMO scan" }, await director("DEMO001"), { actorUserId: who.DEMO001!.userId });
    const pdf = await identityPdf();
    const doc = await autofill.upload(await director("DEMO004"), { subjectKind: "EMPLOYEE", subjectId: who.DEMO009!.employeeId, docKind: "IDENTITY" }, { buffer: pdf, originalname: "demo.pdf", mimetype: "application/pdf", size: pdf.length } as Express.Multer.File, { actorUserId: who.DEMO004!.userId }, async () => undefined);
    const extraction = await prisma.autofillExtraction.findFirstOrThrow({ where: { documentId: doc.id } });
    await autofill.runExtraction(extraction.id);
    // A real candidate e-mail (the demo's interview invitation), so the e-mail check has something to read.
    const interview = await prisma.recruitmentInterview.findFirstOrThrow({ where: { status: "SCHEDULED" }, include: { application: true } });
    const sent = await request(app).post(`/api/recruitment/candidates/${interview.application.candidateId}/mail`).set("Authorization", `Bearer ${token.DEMO001}`).send({ applicationId: interview.applicationId, interviewId: interview.id, templateId: "DEMO_INVITE", idempotencyKey: randomUUID() });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);

    const review = await prisma.nudgeTagReviewRequest.findFirstOrThrow({ where: { awardId: tag.id } });
    const booking = await prisma.unmuteBooking.findFirstOrThrow();
    const leaveDoc = await prisma.leaveRequestDocument.findFirstOrThrow();
    const joinerDoc = await prisma.recruitmentJoinerDocument.findFirst({ select: { id: true } });
    marks = [
      { name: "old private note", text: "DEMO-NUDGE-PRIVATE", allowed: ["DEMO006", ...DIRECTORS] },
      { name: "nudge review request", text: review.id, allowed: ["DEMO006", ...DIRECTORS] },
      { name: "exit interview answer", text: "DEMO-C3-PRIVATE-INTERVIEW", allowed: ["DEMO006", "DEMO004", ...DIRECTORS] },
      { name: "interview feedback", text: "DEMO-C4-PRIVATE-FEEDBACK", allowed: ["DEMO011", ...DIRECTORS] },
      { name: "offer pay", text: /7777123|7,777,123|77,77,123/, allowed: DIRECTORS },
      { name: "candidate expected pay", text: /6666123|6,666,123|66,66,123/, allowed: DIRECTORS },
      { name: "Unmute booking", text: booking.id, allowed: ["DEMO006", "DEMO008", ...DIRECTORS] },
      { name: "medical leave reason", text: "DEMO-LEAVE-REASON-PRIVATE", allowed: ["DEMO006", "DEMO004", ...DIRECTORS] },
      { name: "supporting document", text: leaveDoc.id, allowed: ["DEMO006", "DEMO004", ...DIRECTORS] },
      // The demo turns on "the Office runs recruitment" and gives DEMO008 that capability (offersDemoSeed), so DEMO008 manages candidates.
      { name: "candidate personal data", text: /demo\.c4\.candidate@example\.invalid|0000000004/, allowed: ["DEMO008", ...DIRECTORS] },
      { name: "autofill extraction", text: IDENTITY.pan, allowed: ["DEMO004", ...DIRECTORS] },
      ...(joinerDoc ? [{ name: "joiner document", text: joinerDoc.id, allowed: ["DEMO004", ...DIRECTORS] }] : []),
      { name: "asset request note", text: "DEMO-ASSET-REQUEST-NOTE", allowed: ["DEMO007", "DEMO004", ...DIRECTORS] },
    ];

    // The confidential records' ids, for the crawler's path parameters (it tries up to six per parameter per pass; several passes cover the rest).
    const ids = [
      ...(await prisma.recruitmentInterview.findMany({ select: { id: true } })).map((r) => r.id),
      ...(await prisma.recruitmentOffer.findMany({ select: { id: true } })).map((r) => r.id),
      ...(await prisma.candidate.findMany({ select: { id: true } })).map((r) => r.id),
      ...(await prisma.recruitmentApplication.findMany({ select: { id: true } })).map((r) => r.id),
      ...(await prisma.exitInterview.findMany({ select: { id: true } })).map((r) => r.id),
      ...(await prisma.exitCase.findMany({ select: { id: true } })).map((r) => r.id),
      ...(await prisma.resignation.findMany({ select: { id: true } })).map((r) => r.id),
      booking.id, review.id, tag.id, doc.id, leaveDoc.id,
      ...(await prisma.privateNudge.findMany({ select: { id: true } })).map((r) => r.id),
      ...(await prisma.assetRequest.findMany({ select: { id: true } })).map((r) => r.id),
      ...(joinerDoc ? [joinerDoc.id] : []),
    ];
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 6) chunks.push(ids.slice(i, i + 6));
    const employeeIds = ["DEMO006", "DEMO007", "DEMO009", "DEMO011", "DEMO004", "DEMO008"].map((c) => who[c]!.employeeId);
    const base = { employeeId: employeeIds, metric: ["turnover", "tenure", "exit-reasons", "hiring-funnel"], documentId: [leaveDoc.id], requestId: [leaveDoc.leaveRequestId] };
    const peeps = /^GET \/api\/(recruitment|exits|unmute|nudges|badges|autofill|assets|insights|leave-documents|leave-rules|peeps|avatars|joining|helpdesk)/;
    for (const code of ALL) {
      const out: Crawled[] = await crawlGets(app as never, token[code]!, { ...base, id: chunks[0] ?? ["x"] });
      for (const chunk of chunks.slice(1)) out.push(...(await crawlGets(app as never, token[code]!, { ...base, id: chunk }, new RegExp(`^(?!${peeps.source.slice(1)})|^GET /api/(health|ready)`))));
      crawled[code] = out;
    }
    logLinesBeforeSearch = logLines.length;
  });

  afterAll(() => { restoreLog(); setSocketServer(null); });

  it("crawled every GET route as every demo person", () => {
    for (const code of ALL) expect(crawled[code]!.length, code).toBeGreaterThan(400);
  });

  it("each confidential marker reaches only the people allowed to see it, on any list, count, dashboard, search, export or task", () => {
    const seen: string[] = [];
    for (const m of marks) {
      for (const code of ALL) {
        const hits = crawled[code]!.filter((c) => c.status < 300 && (typeof m.text === "string" ? c.text.includes(m.text) : m.text.test(c.text)));
        if (hits.length && !m.allowed.includes(code)) seen.push(`${m.name}: ${code} on ${[...new Set(hits.map((h) => h.route))].slice(0, 6).join(", ")}`);
      }
    }
    expect(seen).toEqual([]);
  });

  it("the allowed people really do see each marker somewhere (the scan is not blind)", () => {
    const blind = marks.filter((m) => !m.allowed.some((code) => crawled[code]!.some((c) => c.status < 300 && (typeof m.text === "string" ? c.text.includes(m.text) : m.text.test(c.text))))).map((m) => m.name);
    expect(blind).toEqual([]);
  });

  it("search finds no confidential text for anyone", async () => {
    for (const code of ALL) {
      for (const q of ["DEMO-NUDGE-PRIVATE", "DEMO-C3-PRIVATE", "DEMO-C4-PRIVATE", "DEMO-LEAVE-REASON", "DEMO-ASSET-REQUEST", "7777123", "6666123", IDENTITY.pan]) {
        for (const url of [`/api/people?search=${encodeURIComponent(q)}`, `/api/engage/employees/search?q=${encodeURIComponent(q)}`, `/api/employees?search=${encodeURIComponent(q)}`]) {
          const r = await request(app).get(url).set("Authorization", `Bearer ${token[code]}`);
          expect(JSON.stringify(r.body).includes(q), `${code} ${url}`).toBe(false);
        }
      }
    }
  });

  it("no marker is in any log line, stored notification, e-mail or socket event", async () => {
    const texts = [
      ["logs", logLines.slice(0, logLinesBeforeSearch).join("\n")],
      ["sockets", socketEvents.join("\n")],
      ["notifications", JSON.stringify(await prisma.notification.findMany({ select: { title: true, body: true, payload: true } }))],
    ] as const;
    const mail = mails.join("\n");
    const leaks: string[] = [];
    for (const m of marks.filter((x) => !["nudge review request", "Unmute booking", "supporting document", "joiner document", "candidate personal data"].includes(x.name))) {
      for (const [where, text] of [...texts, ["e-mail", mail] as const]) {
        const line = text.split("\n").find((l) => (typeof m.text === "string" ? l.includes(m.text) : m.text.test(l)));
        if (line !== undefined) leaks.push(`${m.name} in ${where}: ${line.slice(0, 600)}`);
      }
    }
    expect(leaks).toEqual([]);
    expect(logLines.length).toBeGreaterThan(10); // the captures were live
    expect(mails.length).toBeGreaterThan(0);
  });
});
