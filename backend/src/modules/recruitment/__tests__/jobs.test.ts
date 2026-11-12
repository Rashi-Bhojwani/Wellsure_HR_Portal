import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { DIRECTOR_AUTHORITY_SETTING_KEY } from "@shared/constants/directorAuthority";
import { proposeChoice, confirmChoice } from "../../../lib/directorAuthority";
import { fixture, prisma } from "./fixtures";
describe("DEMO requisitions and jobs",()=>{
 let f:Awaited<ReturnType<typeof fixture>>,reqId:string,jobId:string,pipelineId:string;
 const input=()=>({title:'DEMO role',departmentId:f.org.departmentId,locationId:f.org.locationId,employmentType:'PERMANENT',headcount:1,reason:'DEMO hiring need'});
 const jobInput=()=>({title:'DEMO role',departmentId:f.org.departmentId,locationId:f.org.locationId,employmentType:'PERMANENT',description:'DEMO position description'});
 beforeAll(async()=>{f=await fixture();});afterAll(async()=>{await f.cleanup();});
 it("raising is explicitly grantable to managers; no one may choose another requester or add pay",async()=>{
 expect((await f.call('manager','post','/requisitions',input())).status).toBe(403);await f.grant('manager','recruitment.requisition.raise');
 const r=await f.call('manager','post','/requisitions',input());expect(r.status).toBe(201);reqId=r.body.id;expect(r.body.requesterEmployeeId).toBe(f.people.manager.employeeId);expect(r.body.status).toBe('DRAFT');
 expect((await f.call('manager','post','/requisitions',{...input(),requesterEmployeeId:f.people.otherManager.employeeId})).status).toBe(400);
 expect((await f.call('director','post','/jobs',{...jobInput(),payBand:'DEMO forbidden'})).status).toBe(400);
 for(const who of ['employee','interviewer','otherManager','developer'] as const)expect((await f.call(who,'get',`/requisitions/${reqId}`)).status).toBe(who==='developer'?403:404);
 });
 it("approval route Not set adds no approval; the original requester sees only their requisition",async()=>{
 const r=await f.call('manager','post',`/requisitions/${reqId}/submit`);expect(r.status).toBe(200);expect(r.body.status).toBe('APPROVED');expect(r.body.approvalRoute).toEqual({route:'NONE',second:false});
 expect((await f.call('otherManager','get','/requisitions')).body).toEqual([]);expect((await f.call('manager','get','/requisitions')).body.map((r:{id:string})=>r.id)).toEqual([reqId]);
 });
 it("HR switch acts on the next request; an approved requisition creates one scoped job",async()=>{
 expect((await f.call('hr','post','/jobs',jobInput())).status).toBe(403);await f.hrSwitch('ON');
 const r=await f.call('hr','post','/jobs',{...jobInput(),requisitionId:reqId});expect(r.status).toBe(201);jobId=r.body.id;
 expect((await f.call('hr','post','/jobs',{...jobInput(),requisitionId:reqId})).body.id).toBe(jobId);
 expect((await f.call('manager','get',`/jobs/${jobId}`)).status).toBe(200);expect((await f.call('manager','get','/jobs')).body.total).toBe(1);
 expect((await f.call('otherManager','get',`/jobs/${jobId}`)).status).toBe(404);expect((await f.call('otherManager','get','/jobs')).body.total).toBe(0);
 expect((await f.call('manager','post','/jobs',jobInput())).status).toBe(403);await f.hrSwitch('OFF');expect((await f.call('hr','get',`/jobs/${jobId}`)).status).toBe(404);
 });
 // Stage 2 (changed test): with no pipeline chosen, a job now opens on the shipped default stages (version 0) instead of being
 // refused; a director's own pipeline still replaces it, and history is kept exactly as before.
 it("draft jobs open on the default stages unless a director-chosen pipeline is selected, and state changes keep history",async()=>{
 const opened=await f.call('director','post',`/jobs/${jobId}/state`,{status:'OPEN',reason:'DEMO opening'});expect(opened.body.status).toBe('OPEN');
 expect((await prisma.recruitmentPipeline.findUniqueOrThrow({where:{id:opened.body.pipelineId}})).version).toBe(0);
 expect((await f.call('director','post',`/jobs/${jobId}/state`,{status:'ON_HOLD',reason:'DEMO hold'})).body.status).toBe('ON_HOLD');
 const p=await f.call('director','post','/pipelines',{name:'DEMO pipeline',stages:[{code:'DEMO_APPLIED',label:'DEMO applied'},{code:'DEMO_REVIEW',label:'DEMO review'}],reason:'DEMO chosen'});pipelineId=p.body.id;
 const reopened=await f.call('director','post',`/jobs/${jobId}/state`,{status:'OPEN',pipelineId,reason:'DEMO reopen'});expect(reopened.body.status).toBe('OPEN');expect(reopened.body.pipelineId).toBe(pipelineId);
 expect(await prisma.recruitmentHistory.count({where:{entityId:jobId,event:'STATUS_CHANGED'}})).toBe(4);
 });
 it("a chosen director route needs one director unless its optional second-director check is explicitly on",async()=>{
 await f.setting('approvalRoute',{route:'DIRECTOR'});const r=await f.call('manager','post','/requisitions',input());const id=r.body.id;
 expect((await f.call('manager','post',`/requisitions/${id}/submit`)).body.status).toBe('PENDING');
 expect((await f.call('hr','post',`/requisitions/${id}/decision`,{decision:'APPROVE',reason:'DEMO approval'})).status).toBe(403);
 const decided=await f.call('director','post',`/requisitions/${id}/decision`,{decision:'APPROVE',reason:'DEMO approval'});expect(decided.body.status).toBe('APPROVED');expect(decided.body.waiting).toBe(false);
 const prior=await prisma.systemSetting.findUnique({where:{key:DIRECTOR_AUTHORITY_SETTING_KEY}});
 try{await proposeChoice('RECRUITMENT_REQUISITION','SECOND_DIRECTOR',{userId:f.people.director.userId});await confirmChoice('RECRUITMENT_REQUISITION','SECOND_DIRECTOR',{userId:f.people.second.userId});
 const q=await f.call('manager','post','/requisitions',input());const id2=q.body.id;await f.call('manager','post',`/requisitions/${id2}/submit`);
 const first=await f.call('director','post',`/requisitions/${id2}/decision`,{decision:'APPROVE',reason:'DEMO first'});expect(first.body.waiting).toBe(true);
 expect((await f.call('director','post',`/requisitions/${id2}/decision`,{decision:'APPROVE',reason:'DEMO retry'})).body.waiting).toBe(true);
 expect((await f.call('second','post',`/requisitions/${id2}/decision`,{decision:'APPROVE',reason:'DEMO second'})).body.status).toBe('APPROVED');
 }finally{if(prior)await prisma.systemSetting.update({where:{key:prior.key},data:{value:prior.value??Prisma.JsonNull}});else await prisma.systemSetting.deleteMany({where:{key:DIRECTOR_AUTHORITY_SETTING_KEY}});}
 });
 it("rejection and closure record state history, and a rejected requisition cannot create a job",async()=>{
 const r=await f.call('manager','post','/requisitions',input());const id=r.body.id;await f.call('manager','post',`/requisitions/${id}/submit`);
 expect((await f.call('director','post',`/requisitions/${id}/decision`,{decision:'REJECT',reason:'DEMO not proceeding'})).body.status).toBe('REJECTED');
 expect((await f.call('director','post','/jobs',{...jobInput(),requisitionId:id})).status).toBe(409);
 expect((await f.call('director','post',`/requisitions/${id}/close`,{reason:'DEMO closure'})).body.status).toBe('CLOSED');
 expect((await f.call('director','post',`/jobs/${jobId}/state`,{status:'CLOSED',reason:'DEMO closure'})).body.status).toBe('CLOSED');expect((await f.call('director','post',`/jobs/${jobId}/state`,{status:'OPEN',reason:'DEMO invalid reopen'})).status).toBe(409);
 });
});
