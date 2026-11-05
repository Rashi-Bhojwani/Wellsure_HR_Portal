import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mailService } from "../../../integrations/mail";
import { fixture, prisma } from "./fixtures";
describe("DEMO candidate email: templates and private receipts",()=>{
 let f:Awaited<ReturnType<typeof fixture>>,candidateId:string,applicationId:string,interviewId:string;
 const email=`demo.mail.${randomUUID()}@example.invalid`,marker='DEMO-CANDIDATE-TEMPLATE-BODY';
 const body=(templateId='DEMO_INVITE')=>({templateId,applicationId,interviewId:templateId==='DEMO_INVITE'?interviewId:undefined,idempotencyKey:randomUUID()});
 beforeAll(async()=>{
 f=await fixture();await f.setting('sources',[{code:'DEMO',label:'DEMO'}]);await f.setting('retention',{days:30});
 const c=await f.call('director','post','/candidates',{name:'DEMO PRIVATE MAIL CANDIDATE',email,phone:null,source:'DEMO',consentConfirmed:true,consentRecordedAt:new Date().toISOString()});candidateId=c.body.id;
 const p=await f.call('director','post','/pipelines',{name:'DEMO',stages:[{code:'DEMO',label:'DEMO applied'}],reason:'DEMO'}),j=await f.call('director','post','/jobs',{title:'DEMO position',departmentId:f.org.departmentId,locationId:f.org.locationId,employmentType:'PERMANENT',description:'DEMO',pipelineId:p.body.id});await f.call('director','post',`/jobs/${j.body.id}/state`,{status:'OPEN',reason:'DEMO'});
 const a=await f.call('director','post',`/candidates/${candidateId}/applications`,{jobId:j.body.id});applicationId=a.body.id;
 await f.setting('scorecard',{questions:[{id:'DEMO',label:'DEMO question',required:true}],recommendations:[{code:'DEMO',label:'DEMO choice'}]});
 const i=await f.call('director','post',`/applications/${applicationId}/interviews`,{round:'DEMO round',scheduledAt:'2098-01-01T10:00:00+05:30',panelEmployeeIds:[f.people.interviewer.employeeId],reason:'DEMO'});interviewId=i.body.id;
 });
 afterAll(async()=>{vi.restoreAllMocks();await f.cleanup();});
 it("templates start Not set; only recruiting management may send or read receipts",async()=>{
 expect((await f.call('director','post',`/candidates/${candidateId}/mail`,body())).status).toBe(409);
 for(const who of ['hr','manager','employee','interviewer','developer'] as const){expect((await f.call(who,'post',`/candidates/${candidateId}/mail`,body())).status).toBe(403);expect((await f.call(who,'get',`/candidates/${candidateId}/mails`)).status).toBe(403);}
 });
 it("only reviewed non-personal template tokens are accepted, with no pay or header injection",async()=>{
 for(const template of [{id:'DEMO',kind:'INVITATION',subject:'DEMO',body:'{{candidateEmail}}'},{id:'DEMO',kind:'INVITATION',subject:'DEMO salary',body:'DEMO'},{id:'DEMO',kind:'INVITATION',subject:'DEMO\r\nBcc: demo@example.invalid',body:'DEMO'}])expect((await f.call('director','put','/settings/emailTemplates',{value:[template],version:0,reason:'DEMO'})).status).toBe(400);
 await f.setting('emailTemplates',[{id:'DEMO_INVITE',kind:'INVITATION',subject:'DEMO invitation',body:marker+' {{jobTitle}} {{scheduledAt}} {{round}}'},{id:'DEMO_REJECT',kind:'REJECTION',subject:'DEMO application update',body:marker+' {{jobTitle}}'}]);
 });
 it("mail uses the existing interface with private logging, correct stored recipient and no body in records/audit; retry sends once",async()=>{
 const send=vi.spyOn(mailService,'send').mockResolvedValue({driver:'console',delivered:false,to:email,detail:'DEMO-private-path'}),input=body();
 const r=await f.call('director','post',`/candidates/${candidateId}/mail`,input);expect(r.status).toBe(201);expect(r.body.status).toBe('PREPARED');expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0]![0]).toMatchObject({to:email,sensitive:true,subject:'DEMO invitation'});expect(send.mock.calls[0]![0].text).toContain('DEMO position');expect(send.mock.calls[0]![0].text).not.toContain('DEMO PRIVATE MAIL CANDIDATE');
 const again=await f.call('director','post',`/candidates/${candidateId}/mail`,input);expect(again.body).toEqual(r.body);expect(send).toHaveBeenCalledTimes(1);
 const rows=await prisma.recruitmentCandidateMail.findMany({where:{candidateId}}),audit=await prisma.auditLog.findMany({where:{entityType:'RecruitmentCandidateMail',entityId:r.body.id}});for(const text of [JSON.stringify(rows),JSON.stringify(audit),JSON.stringify(r.body)]){expect(text).not.toContain(email);expect(text).not.toContain(marker);expect(text).not.toContain('DEMO-private-path');}
 expect((await f.call('director','post',`/candidates/${candidateId}/mail`,{...body(),to:'demo.wrong@example.invalid'})).status).toBe(400);send.mockRestore();
 });
 it("provider failures record UNKNOWN without retaining or exposing a private provider error",async()=>{
 const send=vi.spyOn(mailService,'send').mockRejectedValue(new Error('DEMO provider error '+email+' '+marker));const r=await f.call('director','post',`/candidates/${candidateId}/mail`,body());expect(r.status).toBe(201);expect(r.body.status).toBe('UNKNOWN');expect(JSON.stringify(r.body)).not.toContain(email);expect(JSON.stringify(r.body)).not.toContain(marker);send.mockRestore();
 });
 it("HR ON may send and OFF revokes it; rejection mail requires the chosen application decision",async()=>{
 const send=vi.spyOn(mailService,'send').mockResolvedValue({driver:'smtp',delivered:true,to:email,detail:'DEMO provider reference'});await f.hrSwitch('ON');expect((await f.call('hr','post',`/candidates/${candidateId}/mail`,body())).body.status).toBe('SENT');await f.hrSwitch('OFF');expect((await f.call('hr','post',`/candidates/${candidateId}/mail`,body())).status).toBe(403);
 expect((await f.call('director','post',`/candidates/${candidateId}/mail`,body('DEMO_REJECT'))).status).toBe(409);await f.setting('rejectionReasons',[{code:'DEMO',label:'DEMO'}]);await f.call('director','post',`/applications/${applicationId}/decision`,{status:'REJECTED',reasonCategory:'DEMO',version:0});expect((await f.call('director','post',`/candidates/${candidateId}/mail`,body('DEMO_REJECT'))).body.status).toBe('SENT');send.mockRestore();
 });
});
