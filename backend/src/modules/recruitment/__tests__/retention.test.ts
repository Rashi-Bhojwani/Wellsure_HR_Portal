import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { purgeExpiredCandidates } from "../retention";
import { storageService } from "../../../integrations/storage";
import { fixture, prisma, app, authHeader } from "./fixtures";
import request from "supertest";
const cv=Buffer.from('%PDF-1.4\nDEMO retention CV\n%%EOF');
describe("DEMO candidate retention and requested erasure",()=>{
 let f:Awaited<ReturnType<typeof fixture>>,candidateId:string,secondId:string,interviewId:string,applicationId:string,key:string;
 const email=`demo.retention.${randomUUID()}@example.invalid`,marker='DEMO_PRIVATE_RETENTION_FEEDBACK';
 const create=(contact=email)=>f.call('director','post','/candidates',{name:'DEMO PRIVATE RETENTION CANDIDATE',email:contact,phone:null,source:'DEMO',consentConfirmed:true,consentRecordedAt:new Date().toISOString()});
 const upload=(id:string)=>request(app).post(`/api/recruitment/candidates/${id}/cv`).set(...authHeader(f.tokens.director)).attach('file',cv,{filename:'DEMO-cv.pdf',contentType:'application/pdf'});
 beforeAll(async()=>{
 f=await fixture();await f.setting('sources',[{code:'DEMO',label:'DEMO'}]);await f.setting('retention',{days:30});await f.setting('cvUploads',{maxMb:1,allowedMimeTypes:['application/pdf']});const c=await create();candidateId=c.body.id;await upload(candidateId);
 key=(await prisma.candidate.findUniqueOrThrow({where:{id:candidateId}})).cvStorageKey!;
 const p=await f.call('director','post','/pipelines',{name:'DEMO',stages:[{code:'DEMO',label:'DEMO'}],reason:'DEMO'}),j=await f.call('director','post','/jobs',{title:'DEMO',departmentId:f.org.departmentId,locationId:f.org.locationId,employmentType:'PERMANENT',description:'DEMO',pipelineId:p.body.id});await f.call('director','post',`/jobs/${j.body.id}/state`,{status:'OPEN',reason:'DEMO'});const a=await f.call('director','post',`/candidates/${candidateId}/applications`,{jobId:j.body.id});applicationId=a.body.id;
 await f.setting('scorecard',{questions:[{id:'DEMO',label:'DEMO',required:true}],recommendations:[{code:'DEMO',label:'DEMO'}]});const i=await f.call('director','post',`/applications/${applicationId}/interviews`,{round:'DEMO',scheduledAt:'2098-01-01T10:00:00+05:30',panelEmployeeIds:[f.people.interviewer.employeeId],reason:'DEMO'});interviewId=i.body.id;await f.call('interviewer','post',`/interviews/${interviewId}/feedback`,{answers:{DEMO:marker},recommendation:'DEMO'});
 });afterAll(async()=>{vi.restoreAllMocks();await f.cleanup();});
 it("retention removes all identity/hash/CV/feedback values and notification names, keeping non-personal application counts",async()=>{
 expect(await prisma.recruitmentApplication.count({where:{candidateId}})).toBe(1);const result=await purgeExpiredCandidates(new Date(Date.now()+31*86400000));expect(result).toEqual({anonymized:1,failed:0});
 const row=await prisma.candidate.findUniqueOrThrow({where:{id:candidateId}});expect(row).toMatchObject({nameEncrypted:null,emailEncrypted:null,phoneEncrypted:null,nameHash:null,emailHash:null,phoneHash:null,cvStorageKey:null,cvMimeType:null});expect(row.anonymizedAt).not.toBeNull();await expect(storageService.getObject(key)).rejects.toThrow();
 const feedback=await prisma.interviewFeedback.findMany({where:{interviewId}});expect(feedback).toHaveLength(1);expect(feedback[0]).toMatchObject({answersEncrypted:null,recommendationEncrypted:null});expect(await prisma.recruitmentApplication.count({where:{candidateId}})).toBe(1);
 const notifications=await prisma.notification.findMany({where:{type:'recruitment.interview.assigned',payload:{path:['candidateId'],equals:candidateId}}});expect(notifications.length).toBeGreaterThan(0);expect(JSON.stringify(notifications)).not.toContain('DEMO PRIVATE RETENTION CANDIDATE');
 const read=await f.call('director','get',`/candidates/${candidateId}`);expect(read.body.name).toBe('Candidate details removed');expect(read.body.email).toBeNull();expect((await f.call('interviewer','get',`/interviews/${interviewId}/feedback`)).body.items[0]).toMatchObject({answers:null,recommendation:null,removed:true});
 expect((await f.call('interviewer','get',`/candidates/${candidateId}/cv`)).status).toBe(403);expect((await f.call('interviewer','post',`/interviews/${interviewId}/feedback`,{answers:{DEMO:marker},recommendation:'DEMO'})).status).toBe(404);expect(await purgeExpiredCandidates(new Date(Date.now()+31*86400000))).toEqual({anonymized:0,failed:0});
 });
 it("only a director may erase on request, and a second request is idempotent",async()=>{
 const fresh=await create();expect(fresh.status).toBe(201);secondId=fresh.body.id;await upload(secondId);
 for(const who of ['employee','manager','interviewer','hr','developer'] as const)expect((await f.call(who,'post',`/candidates/${secondId}/erase`,{requestConfirmed:true})).status).toBe(403);
 expect((await f.call('director','post',`/candidates/${secondId}/erase`,{requestConfirmed:false})).status).toBe(400);
 const erased=await f.call('director','post',`/candidates/${secondId}/erase`,{requestConfirmed:true});expect(erased.status).toBe(200);expect(erased.body).toMatchObject({id:secondId,anonymized:true,changed:true});expect((await f.call('director','post',`/candidates/${secondId}/erase`,{requestConfirmed:true})).body.changed).toBe(false);
 expect(await prisma.auditLog.count({where:{entityType:'Candidate',entityId:secondId,action:'recruitment.candidate.erased'}})).toBe(1);
 });
 it("expired values are never returned even when storage cleanup fails, and the retained key lets the next run retry",async()=>{
 const fresh=await create(`demo.retry.${randomUUID()}@example.invalid`);const id=fresh.body.id;await upload(id);const original=await prisma.candidate.findUniqueOrThrow({where:{id}});const now=new Date();await prisma.candidate.update({where:{id},data:{consentRecordedAt:new Date(now.getTime()-2*86400000),retentionUntil:new Date(now.getTime()-86400000)}});
 const remove=vi.spyOn(storageService,'deleteObject').mockRejectedValue(new Error('DEMO storage unavailable'));expect(await purgeExpiredCandidates()).toEqual({anonymized:0,failed:1});const stuck=await prisma.candidate.findUniqueOrThrow({where:{id}});expect(stuck.cvStorageKey).toBe(original.cvStorageKey);expect(stuck.anonymizedAt).toBeNull();
 const read=await f.call('director','get',`/candidates/${id}`);expect(read.body.name).toBe('Candidate details unavailable');expect(read.body).toMatchObject({anonymized:false,expired:true});expect(read.body.email).toBeNull();expect((await f.call('director','get',`/candidates/${id}/cv`)).status).toBe(403);
 remove.mockRestore();expect(await purgeExpiredCandidates()).toEqual({anonymized:1,failed:0});expect((await prisma.candidate.findUniqueOrThrow({where:{id}})).cvStorageKey).toBeNull();
 });
});
