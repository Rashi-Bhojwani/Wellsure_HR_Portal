import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { ENCRYPTED_COLUMNS } from "../../../lib/fieldKeyRotation";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { requiredSetting, SETTING_SCHEMAS } from "../settings";

describe("exit schema and director settings", () => {
  let org: TestOrgMasters;
  type Person = { userId: string; employeeId: string; employeeCode: string };
  const people = {} as Record<"director"|"hr"|"employee"|"other"|"developer",Person>;
  const tokens = {} as Record<keyof typeof people,string>;
  const settings: string[] = [];
  const templates: string[] = [];
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [key,roleCode] of Object.entries({ director:"SUPER_ADMIN",hr:"HR_ADMIN",employee:"EMPLOYEE",other:"EMPLOYEE",developer:"DEVELOPER" })) {
      const k=key as keyof typeof people;
      people[k]=await createFullTestEmployee(org,{roleCode}); tokens[k]=await loginAs(people[k].employeeCode);
    }
  });
  afterAll(async () => {
    await deleteWithDependents("ExitSettingVersion",settings);
    await deleteWithDependents("ExitChecklistTemplate",templates);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });
  const get=(who:keyof typeof people,path:string)=>request(app).get(`/api/exits${path}`).set(...authHeader(tokens[who]));
  const put=(who:keyof typeof people,key:string,body:object)=>request(app).put(`/api/exits/settings/${key}`).set(...authHeader(tokens[who])).send(body);
  it("every setting starts Not set; each required setting refuses without an invented value",async()=>{
    const result=await get("director","/settings");
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(Object.keys(SETTING_SCHEMAS).length);
    expect(result.body.every((s:{state:string;value:unknown})=>s.state==="NOT_SET"&&s.value===null)).toBe(true);
    for(const key of Object.keys(SETTING_SCHEMAS) as Array<keyof typeof SETTING_SCHEMAS>) await expect(requiredSetting(key)).rejects.toMatchObject({status:409,code:"EXITS_NOT_SET"});
    expect((await get("employee","/status")).body).toMatchObject({submitReady:false,reasonCategories:null});
  });
  it("auth, director permission, employee isolation and Developer 403 cover all foundation routes",async()=>{
    const body={value:{allowed:true},version:0,reason:"DEMO"};
    const template={name:"DEMO",items:[],assetOwner:{ownerTeam:"MANAGER",ownerEmployeeIds:[]},reason:"DEMO"};
    expect((await request(app).get("/api/exits/settings")).status).toBe(401);
    for(const who of ["hr","employee","other","developer"] as const){
      expect((await get(who,"/settings")).status).toBe(403);
      expect((await get(who,"/owners")).status).toBe(403);
      expect((await put(who,"rejectAllowed",body)).status).toBe(403);
      expect((await get(who,"/checklist-templates")).status).toBe(403);
      expect((await request(app).post("/api/exits/checklist-templates").set(...authHeader(tokens[who])).send(template)).status).toBe(403);
    }
    expect((await get("developer","/status")).status).toBe(403);
  });
  it("one director confirms an append-only version; wrong shape/stale version refuse, with no second confirmer",async()=>{
    expect((await put("director","rejectAllowed",{value:{allowed:"yes"},version:0,reason:"DEMO"})).status).toBe(400);
    const result=await put("director","rejectAllowed",{value:{allowed:true},version:0,reason:"DEMO chosen rule"});
    expect(result.status).toBe(200);
    expect(result.body.find((r:{key:string})=>r.key==="rejectAllowed")).toMatchObject({state:"CONFIRMED",version:1,value:{allowed:true}});
    const row=await prisma.exitSettingVersion.findFirstOrThrow({where:{key:"rejectAllowed"}}); settings.push(row.id);
    expect((await put("director","rejectAllowed",{value:{allowed:false},version:0,reason:"DEMO"})).status).toBe(409);
    await expect(prisma.exitSettingVersion.update({where:{id:row.id},data:{reason:"changed"}})).rejects.toThrow();
    await expect(prisma.exitSettingVersion.delete({where:{id:row.id}})).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('TRUNCATE exit_setting_versions')).rejects.toThrow();
    await expect(prisma.exitSettingVersion.create({data:{key:"rejectAllowed",version:2,value:{allowed:true},reason:"DEMO",changedByUserId:people.hr.userId}})).rejects.toThrow("EXITS_DIRECTOR_ONLY");
  });
  it("templates are explicit director choices, immutable, and removable only by schema-driven fixture cleanup",async()=>{
    const result=await request(app).post("/api/exits/checklist-templates").set(...authHeader(tokens.director)).send({name:"DEMO clearance",items:[{code:"DEMO_ITEM",label:"DEMO check",ownerTeam:"ADMIN",ownerEmployeeIds:[people.director.employeeId],required:true}],assetOwner:{ownerTeam:"ADMIN",ownerEmployeeIds:[people.director.employeeId]},reason:"DEMO"});
    expect(result.status).toBe(201); templates.push(result.body.id);
    await expect(prisma.exitChecklistTemplate.update({where:{id:result.body.id},data:{name:"changed"}})).rejects.toThrow();
    expect(ENCRYPTED_COLUMNS).toContainEqual({model:"ExitInterview",delegate:"exitInterview",field:"answersEncrypted"});
  });
  it("unique active resignation is a database rule even for concurrent direct writers; status history is append-only",async()=>{
    const data={employeeId:people.employee.employeeId,requestedLastDay:new Date("2027-01-01"),reasonCategory:"DEMO",reason:"DEMO",requestHash:"DEMO",changedByUserId:people.employee.userId};
    const result=await Promise.allSettled([prisma.resignation.create({data:{...data,idempotencyKey:randomUUID()}}),prisma.resignation.create({data:{...data,idempotencyKey:randomUUID()}})]);
    expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const row=await prisma.resignation.findFirstOrThrow({where:{employeeId:people.employee.employeeId}});
    await prisma.resignation.update({where:{id:row.id},data:{status:"WITHDRAWN",active:false}});
    const history=await prisma.exitHistory.findMany({where:{resignationId:row.id},orderBy:{at:"asc"}});
    expect(history.map(h=>h.toStatus)).toEqual(["SUBMITTED","WITHDRAWN"]);
    await expect(prisma.exitHistory.update({where:{id:history[0]!.id},data:{event:"changed"}})).rejects.toThrow();
  });
});
