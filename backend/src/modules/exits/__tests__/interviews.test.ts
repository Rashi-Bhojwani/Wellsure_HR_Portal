import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as realtime from "../../../realtime/emit";
import { decryptField } from "../../../lib/encryption";
import { authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { purgeExpiredInterviews } from "../interviews";
import { app, exitFixture, prisma } from "./fixtures";

describe("exit interviews: relationship confidentiality on every boundary",()=>{
  let f:Awaited<ReturnType<typeof exitFixture>>,caseId:string,interviewId:string;
  const rooms:unknown[]=[];const events:unknown[]=[];
  const marker="DEMO_PRIVATE_INTERVIEW_ANSWER";
  beforeAll(async()=>{
    f=await exitFixture();await f.setting("reasonCategories",[{code:"DEMO",label:"DEMO"}]);const r=await f.submit();const a=await f.post("director",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"});caseId=a.body.caseId;
    vi.spyOn(realtime,"getSocketServer").mockReturnValue({to:(room:unknown)=>{rooms.push(room);return {emit:(...args:unknown[])=>{events.push(args);}};}} as never);
  });
  afterAll(async()=>{vi.restoreAllMocks();await f.cleanup();});
  const schedule=(who:"director"|"hr"|"manager"|"employee"|"other"|"developer",employeeId=f.people.hr.employeeId)=>f.post(who,`/cases/${caseId}/interview`,{interviewerEmployeeId:employeeId,scheduledAt:"2098-04-01T10:00:00+05:30",reason:"DEMO interview assignment"});
  const answer=(who:keyof typeof f.people,answers:Record<string,string>)=>request(app).put(`/api/exits/interviews/${interviewId}/answers`).set(...authHeader(f.tokens[who])).send({answers});
  const allGet=(who:keyof typeof f.people,path:string)=>request(app).get(path).set(...authHeader(f.tokens[who]));
  it("questions are required and only directors can appoint an interviewer",async()=>{
    expect((await schedule("director")).status).toBe(409);
    await f.setting("interviewQuestions",[{id:"DEMO_QUESTION",label:"DEMO question",required:true}]);
    for(const who of ["hr","manager","employee","other"] as const)expect((await schedule(who)).status).toBe(403);
    const r=await schedule("director");expect(r.status).toBe(201);interviewId=r.body.id;
  });
  it("HR is allowed only as the named interviewer, even while its exit-management switch is off",async()=>{
    expect((await f.get("hr",`/interviews/${interviewId}`)).status).toBe(200);
    expect((await f.get("hr",`/cases/${caseId}`)).status).toBe(404);
    await f.hrSwitch("ON");expect((await f.get("hr",`/interviews/${interviewId}`)).status).toBe(200);
    await f.hrSwitch("OFF");
    const r=await schedule("director",f.people.other.employeeId);expect(r.status).toBe(201);
    expect((await f.get("hr",`/interviews/${interviewId}`)).status).toBe(404);
    expect((await f.get("hr","/interviews")).body).toEqual({total:0,items:[]});
    await f.hrSwitch("ON");expect((await f.get("hr",`/interviews/${interviewId}`)).status).toBe(404);await f.hrSwitch("OFF");
    const bell=await allGet("hr","/api/notifications");expect(bell.status).toBe(200);
    expect(bell.body.rows.filter((r:{type:string})=>r.type.startsWith("exits.interview."))).toEqual([]);
    const stale=await prisma.notification.findFirstOrThrow({where:{userId:f.people.hr.userId,type:{startsWith:"exits.interview."}}});
    expect((await request(app).post(`/api/notifications/${stale.id}/read`).set(...authHeader(f.tokens.hr))).status).toBe(404);
  });
  it("manager sees team resignation but no interview, counts, audit, Tasks or general-case fields",async()=>{
    expect((await f.get("manager",`/cases/${caseId}`)).status).toBe(200);
    expect((await f.get("manager",`/interviews/${interviewId}`)).status).toBe(404);
    expect((await f.get("manager","/interviews")).body).toEqual({total:0,items:[]});
    expect(JSON.stringify((await f.get("manager",`/cases/${caseId}`)).body)).not.toMatch(/interview|questions|answers/i);
    const tasks=await allGet("manager","/api/tasks/mine");expect(JSON.stringify(tasks.body)).not.toContain(interviewId);
    const audit=await allGet("developer","/api/audit-logs?entityType=ExitInterview");expect(audit.status).toBe(200);expect(audit.body.total).toBe(0);
  });
  it("answer retention is required; answers are encrypted and only the employee can submit",async()=>{
    expect((await answer("employee",{DEMO_QUESTION:marker})).status).toBe(409);
    await f.setting("interviewRetention",{days:30});
    expect((await answer("other",{DEMO_QUESTION:marker})).status).toBe(403);
    expect((await answer("employee",{})).status).toBe(400);
    const r=await answer("employee",{DEMO_QUESTION:marker});expect(r.status).toBe(200);expect(r.body.answers).toEqual({DEMO_QUESTION:marker});
    const encrypted=await prisma.exitInterview.findUniqueOrThrow({where:{id:interviewId}});expect(Buffer.from(encrypted.answersEncrypted!).toString()).not.toContain(marker);expect(decryptField(encrypted.answersEncrypted!)).toContain(marker);
    expect((await answer("employee",{DEMO_QUESTION:marker})).status).toBe(200);
    expect((await answer("employee",{DEMO_QUESTION:"DEMO changed"})).status).toBe(409);
  });
  it("directors can open answers and each opening writes an audit row; other readers cannot bypass the relationship",async()=>{
    const before=await prisma.auditLog.count({where:{action:"peeps.director.opened",entityType:"ExitInterview",entityId:interviewId}});
    const r=await f.get("second",`/interviews/${interviewId}`);expect(r.status).toBe(200);expect(r.body.answers.DEMO_QUESTION).toBe(marker);
    expect(await prisma.auditLog.count({where:{action:"peeps.director.opened",entityType:"ExitInterview",entityId:interviewId}})).toBe(before+1);
    expect((await f.get("other",`/interviews/${interviewId}`)).body.answers.DEMO_QUESTION).toBe(marker);
    expect((await f.get("hr",`/interviews/${interviewId}`)).status).toBe(404);
    const auditRows=await prisma.auditLog.findMany({where:{entityType:"ExitInterview"}});expect(JSON.stringify(auditRows)).not.toContain(marker);
    const notifications=await prisma.notification.findMany({where:{type:{startsWith:"exits.interview."}}});expect(JSON.stringify(notifications)).not.toContain(marker);
  });
  it("only current relationship user rooms receive interview events; no confidential content is emitted",async()=>{
    expect(rooms.length).toBeGreaterThan(0);
    for(const room of rooms)for(const r of Array.isArray(room)?room:[room])expect(r).toMatch(/^user:/);
    expect(JSON.stringify(rooms)).not.toMatch(/perm:|role:|dept:|org/);
    expect(JSON.stringify(events)).not.toContain(marker);
    expect(JSON.stringify(rooms)).not.toContain(f.people.manager.employeeId);
    expect((await f.post("employee",`/interviews/${interviewId}/complete`)).status).toBe(403);
    expect((await f.post("other",`/interviews/${interviewId}/complete`)).body.status).toBe("COMPLETED");
  });
  it("Developer is forbidden on every interview route, including answers and scheduling",async()=>{
    expect((await f.get("developer","/interviews")).status).toBe(403);
    expect((await f.get("developer",`/interviews/${interviewId}`)).status).toBe(403);
    expect((await answer("developer",{DEMO_QUESTION:marker})).status).toBe(403);
    expect((await f.post("developer",`/interviews/${interviewId}/complete`)).status).toBe(403);
    expect((await schedule("developer")).status).toBe(403);
  });
  it("retention removes ciphertext, retains append-only status history and is safe to retry",async()=>{
    const row=await prisma.exitInterview.findUniqueOrThrow({where:{id:interviewId}});
    expect(await purgeExpiredInterviews(new Date(row.purgeAfter!.getTime()+1))).toEqual({purged:1});
    expect(await purgeExpiredInterviews(new Date(row.purgeAfter!.getTime()+1))).toEqual({purged:0});
    expect((await f.get("employee",`/interviews/${interviewId}`)).body).toMatchObject({status:"PURGED",answers:null});
    const history=await prisma.exitHistory.findMany({where:{entityId:interviewId,event:"STATUS_CHANGED"},orderBy:{at:"asc"}});
    expect(history.map(h=>h.toStatus)).toEqual(["SCHEDULED","SUBMITTED","COMPLETED","PURGED"]);expect(history.every(h=>h.confidential)).toBe(true);
  });
});
