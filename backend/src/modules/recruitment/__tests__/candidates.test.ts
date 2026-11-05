import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptField } from "../../../lib/encryption";
import { blindIndex } from "../../../lib/fieldHash";
import { fixture, prisma, app, authHeader } from "./fixtures";
const cv=Buffer.from('%PDF-1.4\nDEMO fictional CV only\n%%EOF');
describe("DEMO candidate identity, scoped applications and CV",()=>{
 let f:Awaited<ReturnType<typeof fixture>>,candidateId:string,applicationId:string,jobId:string,stageId:string;
 const email=`demo.candidate.${randomUUID()}@example.invalid`,phone='000000001001';
 const payload=()=>({name:'DEMO PRIVATE CANDIDATE',email,phone,source:'DEMO',consentConfirmed:true,consentRecordedAt:new Date().toISOString()});
 const upload=(who:keyof typeof f.people,id=candidateId,buffer=cv,type='application/pdf',name='DEMO-cv.pdf')=>request(app).post(`/api/recruitment/candidates/${id}/cv`).set(...authHeader(f.tokens[who])).attach('file',buffer,{contentType:type,filename:name});
 beforeAll(async()=>{f=await fixture();await f.grant('manager','recruitment.requisition.raise');});afterAll(async()=>{await f.cleanup();});
 it("source and retention must be chosen, and recorded consent must be valid",async()=>{
 expect((await f.call('director','post','/candidates',payload())).status).toBe(409);await f.setting('sources',[{code:'DEMO',label:'DEMO source'}]);
 expect((await f.call('director','post','/candidates',payload())).status).toBe(409);await f.setting('retention',{days:30});
 expect((await f.call('director','post','/candidates',{...payload(),consentConfirmed:false})).status).toBe(400);
 expect((await f.call('director','post','/candidates',{...payload(),consentRecordedAt:'2098-01-01T00:00:00Z'})).status).toBe(400);
 expect((await f.call('director','post','/candidates',{...payload(),consentRecordedAt:'2000-01-01T00:00:00Z'})).status).toBe(400);
 });
 it("racing duplicate identities create one encrypted candidate; warnings reveal no other candidate data",async()=>{
 const body=payload(),responses=await Promise.all([f.call('director','post','/candidates',body),f.call('director','post','/candidates',body)]);expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
 const made=responses.find(r=>r.status===201)!,warning=responses.find(r=>r.status===409)!;candidateId=made.body.id;
 expect(warning.body.error.code).toBe('DUPLICATE_CANDIDATE');for(const value of [candidateId,email,body.name,phone])expect(JSON.stringify(warning.body)).not.toContain(value);
 const row=await prisma.candidate.findUniqueOrThrow({where:{id:candidateId}});expect(decryptField(row.nameEncrypted!)).toBe(body.name);expect(decryptField(row.emailEncrypted!)).toBe(email);expect(row.emailHash).toBe(blindIndex(email.toLowerCase()));expect(row.phoneHash).toBe(blindIndex(phone));expect(Buffer.from(row.nameEncrypted!).toString()).not.toContain(body.name);
 expect((await f.call('director','post','/candidates',{...payload(),email:email.toUpperCase()})).body.error.code).toBe('DUPLICATE_CANDIDATE');
 expect((await f.call('director','post','/candidates',{...payload(),email:`demo.other.${randomUUID()}@example.invalid`,phone:'000 000 001 001'})).body.error.code).toBe('DUPLICATE_CANDIDATE');
 });
 it("unrelated employees/managers see no records or counts; HR recruitment OFF refuses and ON opens the recruiting projection",async()=>{
 for(const who of ['employee','otherManager','interviewer','manager','hr'] as const){expect((await f.call(who,'get',`/candidates/${candidateId}`)).status).toBe(404);expect((await f.call(who,'get','/candidates')).body).toMatchObject({total:0,items:[]});}
 expect((await f.call('developer','get','/candidates')).status).toBe(403);await f.hrSwitch('ON');expect((await f.call('hr','get',`/candidates/${candidateId}`)).body.email).toBe(email);await f.hrSwitch('OFF');expect((await f.call('hr','get',`/candidates/${candidateId}`)).status).toBe(404);
 });
 it("applying needs an open job and chosen pipeline; requesting managers get summaries without contacts or CV access",async()=>{
 const req=await f.call('manager','post','/requisitions',{title:'DEMO job',departmentId:f.org.departmentId,locationId:f.org.locationId,employmentType:'PERMANENT',headcount:1,reason:'DEMO request'});await f.call('manager','post',`/requisitions/${req.body.id}/submit`);
 const job=await f.call('director','post','/jobs',{title:'DEMO job',departmentId:f.org.departmentId,locationId:f.org.locationId,employmentType:'PERMANENT',description:'DEMO',requisitionId:req.body.id});jobId=job.body.id;
 expect((await f.call('director','post',`/candidates/${candidateId}/applications`,{jobId})).status).toBe(409);
 const p=await f.call('director','post','/pipelines',{name:'DEMO',stages:[{code:'DEMO_APPLIED',label:'DEMO applied'},{code:'DEMO_REVIEW',label:'DEMO review'},{code:'DEMO_NEXT',label:'DEMO next'}],reason:'DEMO'});stageId=p.body.stages[1].id;
 await f.call('director','post',`/jobs/${jobId}/state`,{status:'OPEN',pipelineId:p.body.id,reason:'DEMO'});
 const applied=await f.call('director','post',`/candidates/${candidateId}/applications`,{jobId});expect(applied.status).toBe(201);applicationId=applied.body.id;expect((await f.call('director','post',`/candidates/${candidateId}/applications`,{jobId})).body.id).toBe(applicationId);
 const manager=await f.call('manager','get',`/candidates/${candidateId}`);expect(manager.status).toBe(200);expect(manager.body.name).toBe('DEMO PRIVATE CANDIDATE');expect(manager.body.email).toBeUndefined();expect(manager.body.phone).toBeUndefined();expect(manager.body.hasCv).toBeUndefined();expect((await f.call('otherManager','get',`/applications/${applicationId}`)).status).toBe(404);
 expect((await f.call('manager','get',`/candidates?q=${encodeURIComponent(email)}`)).body.total).toBe(0);expect((await f.call('manager','get',`/candidates?q=${encodeURIComponent('DEMO PRIVATE CANDIDATE')}`)).body.total).toBe(1);expect((await f.call('otherManager','get',`/candidates?q=${encodeURIComponent(email)}`)).body.total).toBe(0);
 });
 it("concurrent identical stage moves create one append-only move; stale changes conflict",async()=>{
 const body={stageId,version:0,reason:'DEMO stage decision'},r=await Promise.all([f.call('director','post',`/applications/${applicationId}/stage`,body),f.call('director','post',`/applications/${applicationId}/stage`,body)]);expect(r.map(r=>r.status)).toEqual([200,200]);expect(await prisma.applicationStageMove.count({where:{applicationId,version:1}})).toBe(1);
 const move=await prisma.applicationStageMove.findFirstOrThrow({where:{applicationId,version:1}});await expect(prisma.applicationStageMove.update({where:{id:move.id},data:{reason:'DEMO overwrite'}})).rejects.toThrow();
 expect((await f.call('director','post',`/applications/${applicationId}/stage`,{stageId:'DEMO_UNKNOWN',version:0})).status).toBe(409);expect((await f.call('manager','post',`/applications/${applicationId}/stage`,body)).status).toBe(403);
 });
 it("CV upload needs chosen limits and checks type, size and actual bytes",async()=>{
 expect((await upload('director')).status).toBe(409);await f.setting('cvUploads',{maxMb:1,allowedMimeTypes:['application/pdf','image/jpeg']});
 expect((await upload('director',candidateId,Buffer.from('DEMO fake PDF'))).status).toBe(400);
 expect((await upload('director',candidateId,Buffer.alloc(1024*1024+1))).status).toBe(400);
 expect((await upload('director',candidateId,cv,'application/pdf','DEMO-cv.exe')).status).toBe(400);
 expect((await upload('employee')).status).toBe(403);expect((await upload('developer')).status).toBe(403);
 expect((await upload('director')).status).toBe(200);const row=await prisma.candidate.findUniqueOrThrow({where:{id:candidateId}});expect(row.cvStorageKey).toMatch(/^recruitment\/cv\//);expect(row.cvStorageKey).not.toContain('DEMO-cv');
 });
 it("requesting manager cannot read a CV; assigned interviewer can and every outside-team open is audited",async()=>{
 expect((await f.call('manager','get',`/candidates/${candidateId}/cv`)).status).toBe(403);
 await prisma.recruitmentInterview.create({data:{applicationId,round:'DEMO round',scheduledAt:new Date('2098-01-01'),scorecard:{questions:[],recommendations:[]},changedByUserId:f.people.director.userId,panel:{create:{employeeId:f.people.interviewer.employeeId,active:true,assignedByUserId:f.people.director.userId}}}});
 const summary=await f.call('interviewer','get',`/candidates/${candidateId}`);expect(summary.body.name).toBe('DEMO PRIVATE CANDIDATE');expect(summary.body.email).toBeUndefined();expect(summary.body.canReadCv).toBe(true);
 const before=await prisma.auditLog.count({where:{entityType:'Candidate',entityId:candidateId,action:'recruitment.cv.opened'}}),download=await f.call('interviewer','get',`/candidates/${candidateId}/cv`);expect(download.status).toBe(200);expect(download.headers['content-disposition']).toContain('attachment');expect(download.headers.location).toBeUndefined();expect(await prisma.auditLog.count({where:{entityType:'Candidate',entityId:candidateId,action:'recruitment.cv.opened'}})).toBe(before+1);
 await prisma.recruitmentInterviewPanel.updateMany({where:{employeeId:f.people.interviewer.employeeId},data:{active:false}});expect((await f.call('interviewer','get',`/candidates/${candidateId}/cv`)).status).toBe(404);
 });
 it("uploaded images are re-encoded without private metadata",async()=>{
 const image=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'DEMO PRIVATE IMAGE METADATA'}}}).toBuffer();expect((await upload('director',candidateId,image,'image/jpeg','DEMO-cv.jpg')).status).toBe(200);
 const read=await f.call('director','get',`/candidates/${candidateId}/cv`);const metadata=await sharp(read.body as Buffer).metadata();expect(metadata.exif).toBeUndefined();
 });
 it("reject and withdraw need a chosen reason category and preserve an application history",async()=>{
 expect((await f.call('director','post',`/applications/${applicationId}/decision`,{status:'REJECTED',reasonCategory:'DEMO',version:1})).status).toBe(409);await f.setting('rejectionReasons',[{code:'DEMO',label:'DEMO reason'}]);
 const r=await f.call('director','post',`/applications/${applicationId}/decision`,{status:'REJECTED',reasonCategory:'DEMO',version:1});expect(r.body.status).toBe('REJECTED');expect(await prisma.recruitmentHistory.count({where:{entityId:applicationId,toStatus:'REJECTED'}})).toBe(1);
 expect((await f.call('director','post',`/applications/${applicationId}/stage`,{stageId,version:2})).status).toBe(409);
 });
});
