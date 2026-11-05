import { activeFieldKeys, setActiveFieldKeysForTests } from "../../../lib/fieldKeys";
import { reencryptAll } from "../../../lib/fieldKeyRotation";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as realtime from "../../../realtime/emit";
import { decryptField } from "../../../lib/encryption";
import { listAuditLogs } from "../../auditLog/service";
import { appoint, removeMember } from "../../peeps/__tests__/peepsTestKit";
import { fixture, prisma, app, authHeader } from "./fixtures";
type Event={room:string|string[];event:string;payload:unknown[]};
describe("DEMO recruitment interview confidentiality at every boundary",()=>{
 let f:Awaited<ReturnType<typeof fixture>>,candidateId:string,applicationId:string,interviewId:string;
 const events:Event[]=[],marker='DEMO_PRIVATE_RECRUITMENT_FEEDBACK',answer=(suffix='A')=>({answers:{DEMO_QUESTION:marker+suffix},recommendation:'DEMO_PROGRESS'});
 const schedule=()=>({round:'DEMO technical round',scheduledAt:'2098-04-01T10:00:00+05:30',panelEmployeeIds:[f.people.interviewer.employeeId,f.people.employee.employeeId],reason:'DEMO panel selection'});
 const external=(who:keyof typeof f.people,path:string)=>request(app).get(path).set(...authHeader(f.tokens[who]));
 const audit=(who:keyof typeof f.people)=>listAuditLogs({page:1,pageSize:200},{canSeePayroll:false,userId:f.people[who].userId});
 beforeAll(async()=>{
 f=await fixture();await f.setting('sources',[{code:'DEMO',label:'DEMO source'}]);await f.setting('retention',{days:30});await f.grant('manager','recruitment.requisition.raise');
 const c=await f.call('director','post','/candidates',{name:'DEMO INTERVIEW CANDIDATE',email:`demo.interview.${randomUUID()}@example.invalid`,phone:null,source:'DEMO',consentConfirmed:true,consentRecordedAt:new Date().toISOString()});candidateId=c.body.id;
 const req=await f.call('manager','post','/requisitions',{title:'DEMO role',departmentId:f.org.departmentId,locationId:f.org.locationId,employmentType:'PERMANENT',headcount:1,reason:'DEMO'});await f.call('manager','post',`/requisitions/${req.body.id}/submit`);
 const p=await f.call('director','post','/pipelines',{name:'DEMO',stages:[{code:'DEMO',label:'DEMO applied'}],reason:'DEMO'});
 const j=await f.call('director','post','/jobs',{title:'DEMO role',departmentId:f.org.departmentId,locationId:f.org.locationId,employmentType:'PERMANENT',description:'DEMO',pipelineId:p.body.id,requisitionId:req.body.id});await f.call('director','post',`/jobs/${j.body.id}/state`,{status:'OPEN',reason:'DEMO'});
 const a=await f.call('director','post',`/candidates/${candidateId}/applications`,{jobId:j.body.id});applicationId=a.body.id;
 vi.spyOn(realtime,'getSocketServer').mockReturnValue({to:(room:string|string[])=>({emit:(event:string,...payload:unknown[])=>{events.push({room,event,payload});}})} as never);
 });
 afterAll(async()=>{vi.restoreAllMocks();await f.cleanup();});
 it("a scorecard must be chosen; general employees/managers cannot schedule or enumerate interviews",async()=>{
 expect((await f.call('director','post',`/applications/${applicationId}/interviews`,schedule())).status).toBe(409);
 await f.setting('scorecard',{questions:[{id:'DEMO_QUESTION',label:'DEMO chosen question',required:true}],recommendations:[{code:'DEMO_PROGRESS',label:'DEMO progress'},{code:'DEMO_STOP',label:'DEMO stop'}]});
 for(const who of ['employee','interviewer','manager','otherManager','hr'] as const)expect((await f.call(who,'post',`/applications/${applicationId}/interviews`,schedule())).status).toBe(403);
 const made=await f.call('director','post',`/applications/${applicationId}/interviews`,schedule());expect(made.status).toBe(201);interviewId=made.body.id;
 for(const who of ['manager','otherManager'] as const){expect((await f.call(who,'get',`/interviews/${interviewId}`)).status).toBe(404);expect((await f.call(who,'get','/interviews')).body.total).toBe(0);}
 expect((await f.call('developer','get',`/interviews/${interviewId}`)).status).toBe(403);expect((await f.call('interviewer','get',`/interviews/${interviewId}`)).body.candidate.name).toBe('DEMO INTERVIEW CANDIDATE');
 });
 it("two identical submissions produce one immutable encrypted feedback record and the same visible result",async()=>{
 const r=await Promise.all([f.call('interviewer','post',`/interviews/${interviewId}/feedback`,answer()),f.call('interviewer','post',`/interviews/${interviewId}/feedback`,answer())]);expect(r.map(r=>r.status)).toEqual([201,201]);expect(r[0].body).toEqual(r[1].body);
 const rows=await prisma.interviewFeedback.findMany({where:{interviewId,employeeId:f.people.interviewer.employeeId}});expect(rows).toHaveLength(1);expect(decryptField(rows[0]!.answersEncrypted!)).toContain(marker);expect(decryptField(rows[0]!.recommendationEncrypted!)).toBe('DEMO_PROGRESS');
 expect((await f.call('interviewer','post',`/interviews/${interviewId}/feedback`,answer('different'))).status).toBe(409);await expect(prisma.interviewFeedback.update({where:{id:rows[0]!.id},data:{answersEncrypted:Buffer.from('DEMO overwrite')}})).rejects.toThrow();
 const sent=events.filter(e=>e.event==='recruitment.feedback.changed');expect(sent.length).toBeGreaterThan(0);for(const event of sent)expect([event.room].flat()).not.toContain(`user:${f.people.employee.employeeId}`);
 });
 it("an interviewer sees only own feedback until submitting, then the rest of the current panel; before-submission audit counts also hide others",async()=>{
 const before=await f.call('employee','get',`/interviews/${interviewId}/feedback`);expect(before.status).toBe(200);expect(before.body).toEqual({canReadPanel:false,items:[]});
 expect((await audit('employee')).rows.filter(r=>['InterviewFeedback','RecruitmentFeedback'].includes(r.entityType))).toEqual([]);
 expect((await f.call('employee','post',`/interviews/${interviewId}/feedback`,{answers:{},recommendation:'DEMO_PROGRESS'})).status).toBe(400);
 const after=await f.call('employee','post',`/interviews/${interviewId}/feedback`,answer('B'));expect(after.status).toBe(201);expect(after.body.canReadPanel).toBe(true);expect(after.body.items).toHaveLength(2);
 expect((await audit('employee')).rows.filter(r=>r.entityType==='InterviewFeedback')).toHaveLength(2);
 });
 it("HR management ON exposes scheduling metadata but never feedback; OFF takes effect next request",async()=>{
 expect((await f.call('hr','get',`/interviews/${interviewId}`)).status).toBe(404);await f.hrSwitch('ON');const meta=await f.call('hr','get',`/interviews/${interviewId}`);expect(meta.status).toBe(200);expect(meta.body.canReadFeedback).toBe(false);expect(meta.body.questions).toBeUndefined();expect(meta.body.ownFeedbackSubmitted).toBeUndefined();
 expect((await f.call('hr','get',`/interviews/${interviewId}/feedback`)).status).toBe(404);expect((await f.call('hr','post',`/interviews/${interviewId}/feedback`,answer('HR'))).status).toBe(404);
 expect((await audit('hr')).rows.filter(r=>['InterviewFeedback','RecruitmentFeedback'].includes(r.entityType))).toEqual([]);await f.hrSwitch('OFF');expect((await f.call('hr','get',`/interviews/${interviewId}`)).status).toBe(404);
 });
 it("Office needs its explicit audience and membership, and management never opens feedback",async()=>{
 await appoint(f.people.office.employeeId,['MANAGE_RECRUITMENT'],f.people.director,f.people.second);expect((await f.call('office','get',`/candidates/${candidateId}`)).status).toBe(404);
 await f.setting('officeAudience',{officeManages:true});expect((await f.call('office','get',`/interviews/${interviewId}`)).status).toBe(200);expect((await f.call('office','get',`/interviews/${interviewId}/feedback`)).status).toBe(404);expect((await audit('office')).rows.filter(r=>['InterviewFeedback','RecruitmentFeedback'].includes(r.entityType))).toEqual([]);
 await removeMember(f.people.office.employeeId,f.people.director,f.people.second);expect((await f.call('office','get',`/interviews/${interviewId}`)).status).toBe(404);
 });
 it("directors read every feedback and each opening outside their panel is audited",async()=>{
 const before=await prisma.auditLog.count({where:{entityType:'RecruitmentFeedback',entityId:interviewId,action:'peeps.director.opened'}});const read=await f.call('director','get',`/interviews/${interviewId}/feedback`);expect(read.status).toBe(200);expect(read.body.items).toHaveLength(2);expect(JSON.stringify(read.body)).toContain(marker);expect(await prisma.auditLog.count({where:{entityType:'RecruitmentFeedback',entityId:interviewId,action:'peeps.director.opened'}})).toBe(before+1);
 });
 it("a named HR interviewer participates while management is OFF, without widening to other records",async()=>{
 const changed=await f.call('director','put',`/interviews/${interviewId}/schedule`,{...schedule(),panelEmployeeIds:[...schedule().panelEmployeeIds,f.people.hr.employeeId]});expect(changed.status).toBe(200);
 const meta=await f.call('hr','get',`/interviews/${interviewId}`);expect(meta.status).toBe(200);expect(meta.body.canManage).toBe(false);expect(meta.body.canSubmit).toBe(true);expect((await f.call('hr','get',`/interviews/${interviewId}/feedback`)).body.items).toEqual([]);
 const own=await f.call('hr','post',`/interviews/${interviewId}/feedback`,answer('HR'));expect(own.status).toBe(201);expect(own.body.items).toHaveLength(3);expect((await f.call('hr','get',`/candidates/${candidateId}`)).body.email).toBeUndefined();
 });
 it("former panel members immediately lose feedback, notification counts and mark-read paths; refresh is empty",async()=>{
 const old=await prisma.notification.findFirstOrThrow({where:{userId:f.people.hr.userId,type:'recruitment.interview.assigned'}});
 await f.call('director','put',`/interviews/${interviewId}/schedule`,schedule());
 expect((await f.call('hr','get',`/interviews/${interviewId}`)).status).toBe(404);const bell=await external('hr','/api/notifications');expect(bell.status).toBe(200);expect(bell.body.rows.filter((r:{type:string})=>r.type.startsWith('recruitment.'))).toEqual([]);
 expect((await request(app).post(`/api/notifications/${old.id}/read`).set(...authHeader(f.tokens.hr))).status).toBe(404);
 expect(events.some(e=>e.event==='recruitment.access.changed'&&e.room===`user:${f.people.hr.employeeId}`&&JSON.stringify(e.payload)==='[{}]')).toBe(true);
 const current=await f.call('employee','get',`/interviews/${interviewId}/feedback`);expect(current.body.items).toHaveLength(2);expect(JSON.stringify(current.body)).not.toContain(marker+'HR');
 const director=await f.call('director','get',`/interviews/${interviewId}/feedback`);expect(director.body.items).toHaveLength(3);
 });
 it("feedback is absent from lists, notifications, audit payloads, Tasks and event bodies; all recruitment event rooms are users",async()=>{
 for(const who of Object.keys(f.people) as Array<keyof typeof f.people>){const list=await f.call(who,'get','/interviews');expect(JSON.stringify(list.body)).not.toContain(marker);const tasks=await external(who,'/api/tasks/mine');expect(JSON.stringify(tasks.body)).not.toContain(marker);const bell=await external(who,'/api/notifications');expect(JSON.stringify(bell.body)).not.toContain(marker);}
 const auditRows=await prisma.auditLog.findMany({where:{actorUserId:{in:Object.values(f.people).map(p=>p.userId)}}});expect(JSON.stringify(auditRows)).not.toContain(marker);const notifications=await prisma.notification.findMany({where:{type:{startsWith:'recruitment.'}}});expect(JSON.stringify(notifications)).not.toContain(marker);expect(JSON.stringify(events)).not.toContain(marker);
 for(const e of events.filter(e=>e.event.startsWith('recruitment.')))for(const room of [e.room].flat())expect(room).toMatch(/^user:/);
 });
 it("submitted feedback remains immutable while registered encryption key rotation preserves its answers",async()=>{
 const rows=await prisma.interviewFeedback.findMany({where:{interviewId}}),ids=new Set(rows.map(r=>r.id)),prior=activeFieldKeys(),next=prior.current===250?249:250,keys=new Map(prior.keys);keys.set(next,randomBytes(32));
 try{setActiveFieldKeysForTests({current:next,keys});const rotated=await reencryptAll({apply:true,filter:id=>ids.has(id)});expect(rotated.failed).toEqual([]);expect(rotated.reencrypted).toBe(rows.length*2);const row=await prisma.interviewFeedback.findUniqueOrThrow({where:{id:rows[0]!.id}});expect(decryptField(row.answersEncrypted!)).toContain(marker);}
 finally{setActiveFieldKeysForTests({current:prior.current,keys});const restored=await reencryptAll({apply:true,filter:id=>ids.has(id)});setActiveFieldKeysForTests(prior);expect(restored.failed).toEqual([]);}
 });

});
