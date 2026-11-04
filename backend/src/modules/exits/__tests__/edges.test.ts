import { seedDemoExits } from "../demoSeed";
import request from "supertest";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { ROUTE_CLASSIFICATION } from "../../managers/__tests__/routeInventory";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIRECTOR_AUTHORITY_SETTING_KEY } from "@shared/constants/directorAuthority";
import { proposeChoice, confirmChoice } from "../../../lib/directorAuthority";
import { businessToday } from "../../../lib/businessDate";
import { updateJob } from "../../employee/service";
import { initiateSeparation } from "../../employee/separations";
import { appoint, removeMember } from "../../peeps/__tests__/peepsTestKit";
import { exitFixture, prisma } from "./fixtures";

describe("exit edge cases after payroll integration",()=>{
  let f:Awaited<ReturnType<typeof exitFixture>>,caseId:string;
  beforeAll(async()=>{f=await exitFixture();await f.setting("reasonCategories",[{code:"DEMO",label:"DEMO"}]);await f.grant("manager","exits.accept");});
  afterAll(async()=>{await f.cleanup();});
  it("acceptance recovers an interrupted core-write link without creating a second separation",async()=>{
    const r=await f.submit();const core=await initiateSeparation(f.people.employee.employeeId,{lastWorkingDate:"2098-04-30",reason:"Accepted resignation",notes:`PEEPS-RESIGNATION:${r.body.id}`},f.meta);
    const a=await f.post("director",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"});expect(a.status).toBe(200);caseId=a.body.caseId;
    expect(await prisma.exitCase.findUniqueOrThrow({where:{id:caseId}})).toMatchObject({separationId:core.id});
    expect(await prisma.separation.count({where:{employeeId:f.people.employee.employeeId}})).toBe(1);
  });
  it("a second director is required only after the optional step was explicitly confirmed",async()=>{
    const prior=await prisma.systemSetting.findUnique({where:{key:DIRECTOR_AUTHORITY_SETTING_KEY}});
    try{
      await proposeChoice("EXIT_APPROVAL","SECOND_DIRECTOR",{userId:f.people.director.userId});await confirmChoice("EXIT_APPROVAL","SECOND_DIRECTOR",{userId:f.people.second.userId});
      const r=await f.submit("other");await f.hrSwitch("ON");
      expect((await f.post("hr",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"})).status).toBe(409);
      const first=await f.post("director",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"});expect(first.body).toEqual({caseId:null,waiting:true});
      expect((await f.post("director",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"})).body).toEqual(first.body);
      const second=await f.post("second",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"});expect(second.status).toBe(200);expect(second.body.waiting).toBe(false);
      expect(await prisma.separation.count({where:{employeeId:f.people.other.employeeId}})).toBe(1);
    }finally{
      if(prior)await prisma.systemSetting.update({where:{key:prior.key},data:{value:prior.value??Prisma.JsonNull}});else await prisma.systemSetting.deleteMany({where:{key:DIRECTOR_AUTHORITY_SETTING_KEY}});
    }
  });
  it("withdrawal and acceptance serialize the same decision; the losing request cannot leave an orphan separation",async()=>{
    const r=await f.submit("hr");expect(r.status).toBe(201);
    const responses=await Promise.all([f.post("director",`/resignations/${r.body.id}/accept`,{lastWorkingDay:"2098-04-30"}),f.post("hr",`/resignations/${r.body.id}/withdraw`,{note:"DEMO withdrawal"})]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const row=await prisma.resignation.findUniqueOrThrow({where:{id:r.body.id}});expect(["ACCEPTED","WITHDRAWN"]).toContain(row.status);
    expect(await prisma.separation.count({where:{employeeId:f.people.hr.employeeId}})).toBe(row.status==="ACCEPTED"?1:0);
  });
  it("Office capability needs its explicit audience and a removal takes effect on the next request",async()=>{
    await appoint(f.people.other.employeeId,["MANAGE_EXITS"],f.people.director,f.people.second);
    expect((await f.get("other",`/cases/${caseId}`)).status).toBe(404);
    await f.setting("officeAudience",{officeManages:true});expect((await f.get("other",`/cases/${caseId}`)).status).toBe(200);
    expect((await f.get("other","/interviews")).body).toEqual({total:0,items:[]});
    await f.setting("officeAudience",{officeManages:false});expect((await f.get("other",`/cases/${caseId}`)).status).toBe(404);
    await f.setting("officeAudience",{officeManages:true});await removeMember(f.people.other.employeeId,f.people.director,f.people.second);
    expect((await f.get("other",`/cases/${caseId}`)).status).toBe(404);
  });
  it("HR switch off also blocks an Office membership from widening general exit management",async()=>{
    await appoint(f.people.hr.employeeId,["MANAGE_EXITS"],f.people.director,f.people.second);await f.hrSwitch("OFF");
    expect((await f.get("hr",`/cases/${caseId}`)).status).toBe(404);
    await f.hrSwitch("ON");expect((await f.get("hr",`/cases/${caseId}`)).status).toBe(200);
    await f.hrSwitch("OFF");expect((await f.get("hr",`/cases/${caseId}`)).status).toBe(404);
  });
  it("a manager loses the prior team's resignation on the very next effective-dated move",async()=>{
    expect((await f.get("manager",`/cases/${caseId}`)).status).toBe(200);
    await updateJob(f.people.employee.employeeId,{reportingManagerId:null,effectiveFrom:businessToday().toISOString().slice(0,10),changeReason:"DEMO current-team move"},f.meta);
    expect((await f.get("manager",`/cases/${caseId}`)).status).toBe(404);
    expect((await f.get("manager","/resignations")).body.items).toEqual([]);
    expect((await f.get("employee",`/cases/${caseId}`)).status).toBe(200);
  });
  it("every registered exit route requires authentication and returns Developer 403",async()=>{
    const routes=Object.keys(ROUTE_CLASSIFICATION).filter(id=>id.includes(" /api/exits"));expect(routes.length).toBeGreaterThan(20);
    for(const route of routes){
      const [method,pattern]=route.split(" ");const path=pattern!.replace(":id","DEMO-unknown-id").replace(":key","rejectAllowed");
      const methodName=method!.toLowerCase() as "get"|"post"|"put";
      expect((await request(app)[methodName](path).send({})).status,route).toBe(401);
      expect((await request(app)[methodName](path).set(...authHeader(f.tokens.developer)).send({})).status,route).toBe(403);
    }
  });
  it("a director may close ready clearance with a note, without a second director",async()=>{
    const row=await prisma.resignation.findFirstOrThrow({where:{employeeId:f.people.other.employeeId,status:"ACCEPTED"},include:{exitCase:true}});const id=row.exitCase!.id;
    expect((await f.post("director","/checklist-templates",{name:"DEMO explicit empty checks",items:[],assetOwner:{ownerTeam:"MANAGER",ownerEmployeeIds:[]},reason:"DEMO template"})).status).toBe(201);
    expect((await f.post("director",`/cases/${id}/checklist/start`)).status).toBe(200);
    expect((await f.post("director",`/cases/${id}/ready`)).status).toBe(200);
    expect((await f.post("director",`/cases/${id}/close`,{note:"DEMO director closure"})).status).toBe(200);
    expect(await prisma.exitCase.findUniqueOrThrow({where:{id}})).toMatchObject({status:"CLOSED",closureSource:"DIRECTOR",closeNote:"DEMO director closure"});
  });
  it("the DEMO hand-off leaves all four prepared leave types off and audits the change",async()=>{
    const prior=await prisma.systemSetting.findUnique({where:{key:"demo.company"}});
    const medical=await prisma.leaveType.findUniqueOrThrow({where:{code:"MEDICAL"}});
    try{
      await prisma.systemSetting.upsert({where:{key:"demo.company"},create:{key:"demo.company",value:true},update:{value:true}});
      // Simulate the earlier demo seed's already-approved medical scenario.
      await prisma.leaveType.update({where:{id:medical.id},data:{isActive:true}});
      await seedDemoExits({DEMO001:f.people.director});
      expect(await prisma.leaveType.count({where:{code:{in:["MENSTRUAL","MEDICAL","WEDDING","BEREAVEMENT"]},isActive:true}})).toBe(0);
      expect(await prisma.auditLog.count({where:{actorUserId:f.people.director.userId,entityId:medical.id,action:"leave.type.update"}})).toBe(1);
    }finally{
      await prisma.leaveType.update({where:{id:medical.id},data:{isActive:medical.isActive}});
      if(prior)await prisma.systemSetting.update({where:{key:prior.key},data:{value:prior.value??Prisma.JsonNull}});else await prisma.systemSetting.deleteMany({where:{key:"demo.company"}});
    }
  });
});
