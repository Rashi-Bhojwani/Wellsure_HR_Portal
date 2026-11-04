import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onSettlementCompleted } from "../settlement";
import { exitFixture, prisma } from "./fixtures";

describe("exit settlement facts and letter requests",()=>{
  let f:Awaited<ReturnType<typeof exitFixture>>,caseId:string;
  beforeAll(async()=>{f=await exitFixture();await f.setting("reasonCategories",[{code:"DEMO",label:"DEMO"}]);const r=await f.submit();const a=await f.post("director",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"});expect(a.status).toBe(200);caseId=a.body.caseId;});
  afterAll(async()=>{await f.cleanup();});
  it("hand-off is directors-only even when HR's switch is on; unrelated employee is absent from letter requests",async()=>{
    await f.hrSwitch("ON");
    for(const who of ["employee","other","manager","hr","developer"] as const){
      expect((await f.get(who,`/cases/${caseId}/settlement-inputs`)).status).toBe(403);
      expect((await f.post(who,`/cases/${caseId}/close`,{note:"DEMO close"})).status).toBe(403);
    }
    expect((await f.get("other",`/cases/${caseId}/letter-requests`)).status).toBe(404);
    expect((await f.post("other",`/cases/${caseId}/letter-requests`,{kind:"RELIEVING"})).status).toBe(404);
  });
  it("the hand-off reuses exact ledger balances across leave years, excludes entries after the last day and contains no money",async()=>{
    const type=await prisma.leaveType.findUniqueOrThrow({where:{code:"PL"}});
    for(const [entryDate,leaveYear,days]of [["2025-01-01",2025,"0.10"],["2026-01-01",2026,"0.20"],["2099-01-01",2099,"5.00"]] as const)await prisma.leaveLedger.create({data:{employeeId:f.people.employee.employeeId,leaveTypeId:type.id,leaveYear,entryDate:new Date(entryDate),days,entryType:"GRANT",createdByUserId:f.people.director.userId,remarks:"DEMO"}});
    const r=await f.get("director",`/cases/${caseId}/settlement-inputs`);expect(r.status).toBe(200);
    expect(r.body).toMatchObject({exitCaseId:caseId,employee:{id:f.people.employee.employeeId},lastWorkingDay:"2098-04-30",noticeShortfallDays:null,noticeRuleState:"NOT_SET",clearanceComplete:false,openAssetRecoveryIntentIds:[]});
    expect(r.body.leaveBalanceDays).toEqual([{leaveTypeId:type.id,days:"0.30"}]);
    expect(Object.keys(r.body).sort()).toEqual(["exitCaseId","employee","lastWorkingDay","leaveBalanceDays","noticeShortfallDays","noticeRuleState","clearanceComplete","clearanceOverrideReason","openAssetRecoveryIntentIds"].sort());
    expect(JSON.stringify(r.body)).not.toMatch(/amount|salary|bank|pan|aadhaar|uan|currency|gross|netPay/i);
  });
  it("letter requests are idempotent records and notify directors without issuing a letter",async()=>{
    const before=await prisma.generatedLetter.count();
    const [a,b]=await Promise.all([f.post("employee",`/cases/${caseId}/letter-requests`,{kind:"RELIEVING"}),f.post("employee",`/cases/${caseId}/letter-requests`,{kind:"RELIEVING"})]);
    expect(a.status).toBe(201);expect(a.body).toEqual(b.body);
    expect((await f.get("employee",`/cases/${caseId}/letter-requests`)).body).toHaveLength(1);
    expect(await prisma.generatedLetter.count()).toBe(before);
    expect(await prisma.notification.count({where:{userId:f.people.director.userId,type:"exits.letter.requested"}})).toBe(1);
    expect((await f.get("developer",`/cases/${caseId}/letter-requests`)).status).toBe(403);
    expect((await f.post("developer",`/cases/${caseId}/letter-requests`,{kind:"EXPERIENCE"})).status).toBe(403);
  });
  it("callback and director closure obey clearance; callback is internal, idempotent and writes status history",async()=>{
    await expect(onSettlementCompleted(caseId)).rejects.toMatchObject({status:409});
    expect((await f.post("director",`/cases/${caseId}/close`,{note:"DEMO close"})).status).toBe(409);
    expect((await f.post("director",`/cases/${caseId}/close`,{})).status).toBe(400);
    const t=await f.post("director","/checklist-templates",{name:"DEMO no additional items",items:[],assetOwner:{ownerTeam:"MANAGER",ownerEmployeeIds:[]},reason:"DEMO chosen template"});expect(t.status).toBe(201);
    expect((await f.post("director",`/cases/${caseId}/checklist/start`)).status).toBe(200);
    expect((await f.post("director",`/cases/${caseId}/ready`)).status).toBe(200);
    const result=await onSettlementCompleted(caseId);expect(result).toEqual({exitCaseId:caseId,status:"CLOSED"});
    expect(await onSettlementCompleted(caseId)).toEqual(result);
    expect(await prisma.auditLog.count({where:{action:"exits.settlement.completed",entityId:caseId}})).toBe(1);
    const row=await prisma.exitCase.findUniqueOrThrow({where:{id:caseId}});expect(row.closureSource).toBe("SETTLEMENT_CALLBACK");
    expect((await prisma.exitHistory.findMany({where:{entityId:caseId,event:"STATUS_CHANGED"},orderBy:{at:"asc"}})).map(h=>h.toStatus)).toEqual(["OPEN","CLEARANCE","READY_FOR_SETTLEMENT","CLOSED"]);
  });
});
