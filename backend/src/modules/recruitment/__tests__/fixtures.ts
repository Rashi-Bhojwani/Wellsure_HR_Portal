import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { app, authHeader, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, cleanupFullTestEmployee, cleanupEmployeeTestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { set, version, type SettingKey } from "../settings";
export { app, prisma, authHeader };
export async function fixture(){
 const org=await createEmployeeTestOrgMasters();
 const director=await createFullTestEmployee(org,{roleCode:"SUPER_ADMIN"});
 const second=await createFullTestEmployee(org,{roleCode:"SUPER_ADMIN"});
 const manager=await createFullTestEmployee(org,{roleCode:"MANAGER"});
 const otherManager=await createFullTestEmployee(org,{roleCode:"MANAGER"});
 const hr=await createFullTestEmployee(org,{roleCode:"HR_ADMIN"});
 const interviewer=await createFullTestEmployee(org,{roleCode:"EMPLOYEE"});
 const employee=await createFullTestEmployee(org,{roleCode:"EMPLOYEE",managerId:manager.employeeId});
 const developer=await createFullTestEmployee(org,{roleCode:"DEVELOPER"});
 const office=await createFullTestEmployee(org,{roleCode:"EMPLOYEE"});
 const people={director,second,manager,otherManager,hr,interviewer,employee,developer,office};type Who=keyof typeof people;
 const tokens={} as Record<Who,string>;for(const who of Object.keys(people) as Who[])tokens[who]=await loginAs(people[who].employeeCode);
 const meta={actorUserId:director.userId};
 const call=(who:Who,method:"get"|"post"|"put",path:string,body:object={})=>request(app)[method]('/api/recruitment'+path).set(...authHeader(tokens[who])).send(body);
 const setting=async(key:SettingKey,value:unknown)=>set(key,{value,version:(await version(key))?.version??0,reason:"DEMO explicit recruitment choice"},meta);
 const grant=async(who:Who,key:string)=>{const p=await prisma.permission.findUniqueOrThrow({where:{key}});await prisma.userPermissionOverride.upsert({where:{userId_permissionId:{userId:people[who].userId,permissionId:p.id}},create:{userId:people[who].userId,permissionId:p.id,effect:"GRANT",reason:"DEMO test grant",createdByUserId:director.userId},update:{effect:"GRANT"}});};
 const hrSwitch=async(state:"ON"|"OFF")=>{const prior=await prisma.hrCapabilitySwitch.findFirst({where:{capability:"MANAGE_RECRUITMENT",subjectKey:hr.userId},orderBy:{effectiveFrom:"desc"}});await prisma.hrCapabilitySwitch.create({data:{capability:"MANAGE_RECRUITMENT",subjectKind:"USER",subjectKey:hr.userId,state,effectiveFrom:new Date(Math.max(Date.now()-1000,(prior?.effectiveFrom.getTime()??0)+1)),reason:"DEMO recruitment switch",createdByUserId:director.userId}});};
 const cleanup=async()=>{
 const ids=Object.values(people).map(p=>p.userId);
 await purgeAppendOnly("HrCapabilitySwitch",{createdByUserId:{in:ids}});
 const candidateIds=(await prisma.candidate.findMany({where:{createdByUserId:{in:ids}},select:{id:true}})).map(r=>r.id);
 const histories=await prisma.recruitmentHistory.findMany({where:{OR:[{actorUserId:{in:ids}},{entityId:{in:candidateIds}}]},select:{id:true}});await deleteWithDependents("RecruitmentHistory",histories.map(r=>r.id));
 for(const [model,rows] of [
 ["Candidate",await prisma.candidate.findMany({where:{createdByUserId:{in:ids}},select:{id:true}})],
 ["RecruitmentPipeline",await prisma.recruitmentPipeline.findMany({where:{changedByUserId:{in:ids}},select:{id:true}})],
 ["RecruitmentSettingVersion",await prisma.recruitmentSettingVersion.findMany({where:{changedByUserId:{in:ids}},select:{id:true}})],
 ] as const)await deleteWithDependents(model,rows.map(r=>r.id));
 for(const p of Object.values(people))await cleanupFullTestEmployee(p.employeeId);
 await cleanupEmployeeTestOrgMasters(org);
 };
 return {org,people,tokens,meta,call,setting,grant,hrSwitch,cleanup};
}
