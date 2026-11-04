import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { addCalendarDays, businessDateOf, setBusinessTodayForTests } from "../../../lib/businessDate";
import { processScheduledSeparations } from "../../employee/separations";
import { authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { exitFixture, prisma, app } from "./fixtures";

describe("exit clearance: explicit owners and live asset gate",()=>{
  let f:Awaited<ReturnType<typeof exitFixture>>,caseId:string,itemId:string,assetItemId:string,assignmentId:string;
  const assetIds:string[]=[];
  beforeAll(async()=>{f=await exitFixture();await f.setting("reasonCategories",[{code:"DEMO",label:"DEMO"}]);const r=await f.submit();const a=await f.post("director",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"});expect(a.status).toBe(200);caseId=a.body.caseId;});
  afterAll(async()=>{setBusinessTodayForTests(null);await deleteWithDependents("Asset",assetIds);await f.cleanup();});
  const newAsset=async()=>{
    const asset=await prisma.asset.create({data:{name:"DEMO returnable asset",categoryCode:"DEMO",statusCode:"DEMO",createdByUserId:f.people.director.userId}});assetIds.push(asset.id);
    return prisma.assetAssignment.create({data:{assetId:asset.id,employeeId:f.people.employee.employeeId,issuedByUserId:f.people.director.userId,issueConditionCode:"DEMO"}});
  };
  it("acceptance works without a template; starting clearance and overdue queries refuse missing settings",async()=>{
    expect((await f.post("director",`/cases/${caseId}/checklist/start`)).status).toBe(409);
    expect((await f.get("director","/clearance/overdue")).status).toBe(409);
    await f.setting("overdueThresholds",{clearanceDays:0});
    expect((await f.get("director","/clearance/overdue")).status).toBe(200);
  });
  it("a confirmed template snapshots required owners and generates active asset-return items",async()=>{
    const a=await newAsset();assignmentId=a.id;
    const t=await f.post("director","/checklist-templates",{name:"DEMO clearance",items:[{code:"DEMO_IT",label:"DEMO IT check",ownerTeam:"IT",ownerEmployeeIds:[f.people.other.employeeId],required:true}],assetOwner:{ownerTeam:"MANAGER",ownerEmployeeIds:[]},reason:"DEMO explicit choices"});expect(t.status).toBe(201);
    const r=await f.post("director",`/cases/${caseId}/checklist/start`);expect(r.status).toBe(200);expect(r.body.items).toHaveLength(2);
    itemId=r.body.items.find((i:{code:string})=>i.code==="DEMO_IT").id;assetItemId=r.body.items.find((i:{assetAssignmentId:string})=>i.assetAssignmentId===a.id).id;
    expect((await f.post("director",`/cases/${caseId}/checklist/start`)).body.items).toHaveLength(2);
    expect((await f.get("employee",`/cases/${caseId}/checklist`)).status).toBe(200);
    expect((await f.get("other",`/cases/${caseId}/checklist`)).status).toBe(404);
    expect((await f.get("other","/clearance/mine")).body.map((i:{id:string})=>i.id)).toEqual([itemId]);
    const tasks=await request(app).get("/api/tasks/mine").set(...authHeader(f.tokens.other));
    expect(tasks.body.filter((t:{type:string})=>t.type==="EXIT_CLEARANCE").map((t:{id:string})=>t.id)).toEqual([itemId]);
  });
  it("owners may complete their item only; a checkbox cannot pretend an asset was returned",async()=>{
    expect((await f.post("employee",`/checklist-items/${itemId}/complete`)).status).toBe(404);
    expect((await f.post("other",`/checklist-items/${itemId}/complete`,{note:"DEMO checked"})).status).toBe(200);
    expect((await f.post("manager",`/checklist-items/${assetItemId}/complete`)).status).toBe(409);
    expect((await f.post("director",`/cases/${caseId}/ready`)).status).toBe(409);
    await expect(prisma.exitCase.update({where:{id:caseId},data:{status:"READY_FOR_SETTLEMENT"}})).rejects.toThrow("EXIT_CLEARANCE_BLOCKED");
    expect((await f.post("manager",`/cases/${caseId}/ready`,{overrideReason:"DEMO"})).status).toBe(403);
  });
  it("HR is absent with the switch off; ON permits running clearance; OFF removes it immediately",async()=>{
    expect((await f.get("hr",`/cases/${caseId}/checklist`)).status).toBe(404);
    await f.hrSwitch("ON");expect((await f.get("hr",`/cases/${caseId}/checklist`)).status).toBe(200);
    expect((await f.post("hr",`/cases/${caseId}/ready`)).status).toBe(409);
    expect((await f.post("hr",`/cases/${caseId}/ready`,{overrideReason:"DEMO"})).status).toBe(403);
    await f.hrSwitch("OFF");expect((await f.get("hr",`/cases/${caseId}/checklist`)).status).toBe(404);
  });
  it("director override needs a reason, is audited and never authorizes a newly assigned asset",async()=>{
    const r=await f.post("director",`/cases/${caseId}/ready`,{overrideReason:"DEMO deliberate waiver"});expect(r.status).toBe(200);expect(r.body.status).toBe("READY_FOR_SETTLEMENT");
    expect(await prisma.auditLog.count({where:{action:"exits.clearance.overridden",entityId:caseId}})).toBe(1);
    await newAsset();
    expect((await f.get("director",`/cases/${caseId}/checklist`)).body.status).toBe("CLEARANCE");
    expect((await f.post("director",`/cases/${caseId}/ready`)).status).toBe(409);
  });
  it("live assets added after checklist generation block readiness; returning every asset and completing required items permits it",async()=>{
    const active=await prisma.assetAssignment.findMany({where:{employeeId:f.people.employee.employeeId,endedAt:null}});
    for(const a of active)await prisma.assetAssignment.update({where:{id:a.id},data:{endedAt:new Date(),endedByUserId:f.people.director.userId,endReason:"RETURNED",returnConditionCode:"DEMO"}});
    expect((await f.post("manager",`/checklist-items/${assetItemId}/complete`)).status).toBe(200);
    const r=await f.post("director",`/cases/${caseId}/ready`);expect(r.status).toBe(200);expect(r.body).toMatchObject({status:"READY_FOR_SETTLEMENT",overrideReason:null,blockers:{assignmentIds:[],requiredItemIds:[]}});
    expect(await prisma.assetAssignment.findUniqueOrThrow({where:{id:assignmentId}})).toMatchObject({endReason:"RETURNED"});
  });
  it("an asset issued after every required item was completed still blocks readiness",async()=>{
    await newAsset();
    expect((await f.get("director",`/cases/${caseId}/checklist`)).body.blockers.requiredItemIds).toEqual([]);
    expect((await f.post("director",`/cases/${caseId}/ready`)).status).toBe(409);
    await expect(prisma.exitCase.update({where:{id:caseId},data:{status:"READY_FOR_SETTLEMENT"}})).rejects.toThrow("EXIT_CLEARANCE_BLOCKED");
  });
  it("an employee cannot read or change another person's clearance, including after receiving a single item",async()=>{
    expect((await f.get("other",`/cases/${caseId}/checklist`)).status).toBe(404);
    for(const action of ["checklist/start","ready"])expect((await f.post("other",`/cases/${caseId}/${action}`)).status).toBe(404);
    expect((await f.get("other","/clearance/overdue")).status).toBe(403);
  });
  it("Developer is forbidden on every checklist route",async()=>{
    for(const path of ["/clearance/mine","/clearance/overdue",`/cases/${caseId}/checklist`])expect((await f.get("developer",path)).status).toBe(403);
    for(const path of [`/cases/${caseId}/checklist/start`,`/cases/${caseId}/ready`,`/checklist-items/${itemId}/complete`])expect((await f.post("developer",path)).status).toBe(403);
  });
  it("approved last day ends access even if clearance is still open",async()=>{
    await newAsset();
    const row=await prisma.exitCase.findUniqueOrThrow({where:{id:caseId},include:{resignation:true}});
    const day=businessDateOf(row.resignation.submittedAt);
    await prisma.separation.update({where:{id:row.separationId},data:{lastWorkingDate:day}});
    setBusinessTodayForTests(addCalendarDays(day,1));
    await processScheduledSeparations();
    expect(await prisma.user.findUniqueOrThrow({where:{id:f.people.employee.userId}})).toMatchObject({status:"DEACTIVATED"});
    expect(await prisma.exitCase.findUniqueOrThrow({where:{id:caseId}})).toMatchObject({status:"CLEARANCE"});
  });
});
