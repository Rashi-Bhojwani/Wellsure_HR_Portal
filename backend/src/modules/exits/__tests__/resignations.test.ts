import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessDateOf, addCalendarDays } from "../../../lib/businessDate";
import { cancelSeparation } from "../../employee/separations";
import { exitFixture, prisma } from "./fixtures";

describe("resignations: current audience, core separation and retry safety",()=>{
  let f:Awaited<ReturnType<typeof exitFixture>>;
  let id:string, caseId:string;
  beforeAll(async()=>{f=await exitFixture();});
  afterAll(async()=>{await f.cleanup();});
  it("submission refuses missing reason categories; Developer is forbidden",async()=>{
    expect((await f.submit()).status).toBe(409);
    expect((await f.submit("developer")).status).toBe(403);
    expect((await f.submit("employee",{employeeId:f.people.other.employeeId})).status).toBe(400);
    await f.setting("reasonCategories",[{code:"DEMO",label:"DEMO reason"}]);
  });
  it("two identical concurrent submissions return the same single active record",async()=>{
    const key=randomUUID();
    const results=await Promise.all([f.submit("employee",{idempotencyKey:key}),f.submit("employee",{idempotencyKey:key})]);
    expect(results.map(r=>r.status)).toEqual([201,201]);
    expect(results[0]!.body).toEqual(results[1]!.body);id=results[0]!.body.id;
    expect(await prisma.resignation.count({where:{employeeId:f.people.employee.employeeId,active:true}})).toBe(1);
    expect((await f.submit()).status).toBe(409);
    expect((await f.submit("employee",{idempotencyKey:key,reason:"DEMO changed"})).status).toBe(409);
    expect(results[0]!.body).toMatchObject({noticeShortfallDays:null,noticeRuleState:"NOT_SET"});
  });
  it("employees only see their own; manager sees current team but needs an explicit grant to accept",async()=>{
    expect((await f.get("employee",`/resignations/${id}`)).status).toBe(200);
    expect((await f.get("other",`/resignations/${id}`)).status).toBe(404);
    for(const action of ["accept","reject","withdraw"])expect((await f.post("other",`/resignations/${id}/${action}`,action==="accept"?{lastWorkingDay:"2098-04-30"}:{note:"DEMO"})).status).toBe(404);
    expect((await f.get("employee","/resignations")).status).toBe(403);
    expect((await f.get("other","/resignations/mine")).body).toEqual([]);
    expect((await f.get("manager","/resignations")).body.items.map((r:{id:string})=>r.id)).toEqual([id]);
    expect((await f.post("manager",`/resignations/${id}/accept`,{lastWorkingDay:"2098-04-30"})).status).toBe(403);
    await f.grant("manager","exits.accept");
  });
  it("HR is off by default even with an explicit grant; ON and OFF take effect on the next request",async()=>{
    await f.grant("hr","exits.manage");
    expect((await f.get("hr","/resignations")).status).toBe(403);
    expect((await f.get("hr",`/resignations/${id}`)).status).toBe(404);
    await f.hrSwitch("ON");
    expect((await f.get("hr",`/resignations/${id}`)).status).toBe(200);
    await f.hrSwitch("OFF");
    expect((await f.get("hr",`/resignations/${id}`)).status).toBe(404);
  });
  it("unset rejection rule refuses; confirmed false refuses; confirmed true allows a scoped rejection",async()=>{
    expect((await f.post("manager",`/resignations/${id}/reject`,{note:"DEMO"})).status).toBe(409);
    await f.setting("rejectAllowed",{allowed:false});
    expect((await f.post("manager",`/resignations/${id}/reject`,{note:"DEMO"})).status).toBe(409);
    await f.setting("rejectAllowed",{allowed:true});
    const other=await f.submit("other");expect(other.status).toBe(201);
    expect((await f.get("manager",`/resignations/${other.body.id}`)).status).toBe(404);
    expect((await f.post("director",`/resignations/${other.body.id}/reject`,{note:"DEMO"})).body.status).toBe("REJECTED");
  });
  it("concurrent accepts call the unchanged core flow once and return one linked case without a mandatory second director",async()=>{
    const results=await Promise.all([f.post("manager",`/resignations/${id}/accept`,{lastWorkingDay:"2098-04-30"}),f.post("manager",`/resignations/${id}/accept`,{lastWorkingDay:"2098-04-30"})]);
    expect(results.map(r=>r.status)).toEqual([200,200]);expect(results[0]!.body).toEqual(results[1]!.body);
    caseId=results[0]!.body.caseId;
    expect(await prisma.separation.count({where:{employeeId:f.people.employee.employeeId}})).toBe(1);
    expect(await prisma.exitCase.count({where:{resignationId:id}})).toBe(1);
    const core=await prisma.separation.findFirstOrThrow({where:{employeeId:f.people.employee.employeeId}});
    expect(core).toMatchObject({reason:"Accepted resignation",notes:`PEEPS-RESIGNATION:${id}`});
    expect((await f.get("employee",`/cases/${caseId}`)).body).toMatchObject({status:"OPEN",separationStatus:"INITIATED"});
    expect((await f.get("other",`/cases/${caseId}`)).status).toBe(404);
    expect((await f.post("employee",`/resignations/${id}/withdraw`,{note:"DEMO"})).status).toBe(409);
  });
  it("a moved last day is observed once and cancellation closes the case and frees the active slot",async()=>{
    const c=await prisma.exitCase.findUniqueOrThrow({where:{id:caseId}});
    await prisma.separation.update({where:{id:c.separationId},data:{lastWorkingDate:new Date("2098-05-01")}});
    await Promise.all([f.get("director",`/cases/${caseId}`),f.get("employee",`/cases/${caseId}`)]);
    expect(await prisma.exitHistory.count({where:{resignationId:id,event:"LAST_DAY_CHANGED"}})).toBe(1);
    expect((await f.get("employee",`/cases/${caseId}`)).body.lastWorkingDay).toBe("2098-05-01");
    await cancelSeparation(c.separationId,f.meta);
    expect((await f.get("employee",`/cases/${caseId}`)).body).toMatchObject({status:"CLOSED",separationStatus:"CANCELLED"});
    expect((await f.submit()).status).toBe(201);
  });
  it("confirmed notice rules snapshot the exact grade, source and chosen counting basis; no money is returned",async()=>{
    const own=await f.get("employee","/resignations/mine");const active=own.body.find((r:{active:boolean})=>r.active);
    await f.post("employee",`/resignations/${active.id}/withdraw`,{note:"DEMO"});
    await f.setting("noticeRules",[{employmentType:"PERMANENT",gradeId:null,days:5,basis:"CALENDAR_DAYS",countFrom:"NEXT_DAY",sourceNote:"DEMO general"},{employmentType:"PERMANENT",gradeId:f.org.gradeId,days:10,basis:"CALENDAR_DAYS",countFrom:"SUBMISSION_DAY",sourceNote:"DEMO exact grade"}]);
    const r=await f.submit();expect(r.status).toBe(201);
    const submitted=businessDateOf(new Date(r.body.submittedAt));const last=addCalendarDays(submitted,3).toISOString().slice(0,10);
    const accepted=await f.post("director",`/resignations/${r.body.id}/accept`,{lastWorkingDay:last});expect(accepted.status).toBe(200);
    const row=(await f.get("employee",`/resignations/${r.body.id}`)).body;
    expect(row).toMatchObject({noticeShortfallDays:6,noticeRuleState:"CONFIRMED",noticeSourceNote:"DEMO exact grade"});
    await f.setting("noticeRules",[]);
    expect((await f.get("employee",`/resignations/${r.body.id}`)).body.noticeShortfallDays).toBe(6);
    expect(JSON.stringify(row)).not.toMatch(/salary|amount|recovery|bank|payroll/i);
  });
  it("missing-manager submissions wait in the directors queue; all resignation and case routes reject Developer",async()=>{
    const r=await f.submit("other");expect(r.status).toBe(201);
    expect(await prisma.notification.count({where:{userId:f.people.director.userId,type:"exits.no_manager",payload:{path:["resignationId"],equals:r.body.id}}})).toBe(1);
    expect((await f.post("other",`/resignations/${r.body.id}/withdraw`,{note:"DEMO"})).status).toBe(200);
    for(const path of ["/resignations","/resignations/mine",`/resignations/${id}`,`/cases/${caseId}`])expect((await f.get("developer",path)).status).toBe(403);
    for(const action of ["accept","reject","withdraw"])expect((await f.post("developer",`/resignations/${id}/${action}`,action==="accept"?{lastWorkingDay:"2098-04-30"}:{note:"DEMO"})).status).toBe(403);
  });
});
