import { randomUUID } from "node:crypto";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { settingVersion, setExitSetting, type ExitSettingKey } from "../settings";
export { app, prisma };
export async function exitFixture() {
  const org=await createEmployeeTestOrgMasters();
  const director=await createFullTestEmployee(org,{roleCode:"SUPER_ADMIN"});
  const second=await createFullTestEmployee(org,{roleCode:"SUPER_ADMIN"});
  const manager=await createFullTestEmployee(org,{roleCode:"MANAGER"});
  const employee=await createFullTestEmployee(org,{roleCode:"EMPLOYEE",managerId:manager.employeeId});
  const other=await createFullTestEmployee(org,{roleCode:"EMPLOYEE"});
  const hr=await createFullTestEmployee(org,{roleCode:"HR_ADMIN"});
  const developer=await createFullTestEmployee(org,{roleCode:"DEVELOPER"});
  const people={director,second,manager,employee,other,hr,developer};
  type Who=keyof typeof people;
  const tokens={} as Record<Who,string>;
  for(const who of Object.keys(people) as Who[])tokens[who]=await loginAs(people[who].employeeCode);
  const meta={actorUserId:director.userId};
  const get=(who:Who,path:string)=>request(app).get(`/api/exits${path}`).set(...authHeader(tokens[who]));
  const post=(who:Who,path:string,body:object={})=>request(app).post(`/api/exits${path}`).set(...authHeader(tokens[who])).send(body);
  const setting=async(key:ExitSettingKey,value:unknown)=>setExitSetting(key,{value,version:(await settingVersion(key))?.version??0,reason:"DEMO chosen rule"},meta);
  const submit=(who:Who="employee",extra:object={})=>post(who,"/resignations",{requestedLastDay:"2098-04-30",reasonCategory:"DEMO",reason:"DEMO resignation",idempotencyKey:randomUUID(),...extra});
  const grant=async(who:Who,key:string)=>{
    const perm=await prisma.permission.findUniqueOrThrow({where:{key}});
    await prisma.userPermissionOverride.create({data:{userId:people[who].userId,permissionId:perm.id,effect:"GRANT",reason:"DEMO grant",createdByUserId:director.userId}});
  };
  const hrSwitch=async(state:"ON"|"OFF")=>{
    const previous=await prisma.hrCapabilitySwitch.findFirst({where:{capability:"MANAGE_EXITS",subjectKey:hr.userId},orderBy:{effectiveFrom:"desc"}});
    await prisma.hrCapabilitySwitch.create({data:{capability:"MANAGE_EXITS",subjectKind:"USER",subjectKey:hr.userId,state,effectiveFrom:new Date(Math.max(Date.now()-1000,(previous?.effectiveFrom.getTime()??0)+1)),reason:"DEMO switch",createdByUserId:director.userId}});
  };
  const cleanup=async()=>{
    await purgeAppendOnly("HrCapabilitySwitch",{createdByUserId:director.userId});
    const settings=await prisma.exitSettingVersion.findMany({where:{changedByUserId:director.userId},select:{id:true}});
    const templates=await prisma.exitChecklistTemplate.findMany({where:{changedByUserId:director.userId},select:{id:true}});
    await deleteWithDependents("ExitSettingVersion",settings.map(r=>r.id));
    await deleteWithDependents("ExitChecklistTemplate",templates.map(r=>r.id));
    for(const p of Object.values(people))await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  };
  return {org,people,tokens,meta,get,post,setting,submit,grant,hrSwitch,cleanup};
}
