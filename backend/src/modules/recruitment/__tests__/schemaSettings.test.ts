import request from "supertest";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { ENCRYPTED_COLUMNS } from "../../../lib/fieldKeyRotation";
import { SETTING_DEFAULTS, SETTING_SCHEMAS, required } from "../settings";
import { fixture, prisma, app } from "./fixtures";
describe("DEMO recruitment foundation",()=>{
 let f:Awaited<ReturnType<typeof fixture>>,pipelineId:string;
 beforeAll(async()=>{f=await fixture();});afterAll(async()=>{await f.cleanup();});
 // Stage 2 (changed test): interview rounds and hiring stages now ship as "Default, change in settings"; every other business
 // setting still starts Not set and refuses, exactly as before.
 it("business settings start Not set (rounds and stages ship as defaults), and every required setting without a default refuses",async()=>{
 const r=await f.call("director","get","/settings");expect(r.status).toBe(200);expect(r.body).toHaveLength(Object.keys(SETTING_SCHEMAS).length);
 for(const s of r.body as Array<{key:string;value:unknown;state:string}>){if(s.key in SETTING_DEFAULTS)expect(s,s.key).toMatchObject({state:"DEFAULT",value:SETTING_DEFAULTS[s.key as keyof typeof SETTING_DEFAULTS]});else expect(s,s.key).toMatchObject({state:"NOT_SET",value:null});}
 const pipelines=(await f.call("director","get","/pipelines")).body as Array<{version:number;isDefault:boolean;changedByUserId:string;stages:Array<{label:string}>}>;
 const def=pipelines.find(p=>p.isDefault)!;expect(def.version).toBe(0);expect(def.stages.map(s=>s.label)).toEqual(["Screening","Interview","Offer","Hired","Not moving forward"]);
 expect(pipelines.filter(p=>p.isDefault)).toHaveLength(1);
 for(const key of Object.keys(SETTING_SCHEMAS) as Array<keyof typeof SETTING_SCHEMAS>){if(key in SETTING_DEFAULTS)await expect(required(key)).resolves.toEqual(SETTING_DEFAULTS[key]);else await expect(required(key)).rejects.toMatchObject({status:409,code:"RECRUITMENT_NOT_SET"});}
 });
 it("a director's choice replaces a default and is audited; clearing it returns to the default",async()=>{
 const chosen=[{code:'DEMO_ROUND',label:'DEMO round'}];
 const v=(await f.call("director","get","/settings")).body.find((s:{key:string})=>s.key==='interviewRounds').version;
 const r=await f.call("director","put","/settings/interviewRounds",{value:chosen,version:v,reason:"DEMO choice"});expect(r.status).toBe(200);
 expect(r.body.find((s:{key:string})=>s.key==='interviewRounds')).toMatchObject({state:"CONFIRMED",value:chosen});
 expect(await prisma.auditLog.count({where:{action:"recruitment.setting.confirmed",actorUserId:f.people.director.userId}})).toBeGreaterThan(0);
 const v2=r.body.find((s:{key:string})=>s.key==='interviewRounds').version;
 expect((await f.call("hr","put","/settings/interviewRounds",{value:chosen,version:v2,reason:"DEMO"})).status).toBe(403);
 });
 it("all foundation routes require sign-in, directors own settings, unrelated employees are refused and Developer always 403",async()=>{
 const cases=[['get','/settings',{}],['put','/settings/retention',{value:{days:30},version:0,reason:"DEMO"}],['get','/pipelines',{}],['post','/pipelines',{name:"DEMO",stages:[{code:"DEMO",label:"DEMO"}],reason:"DEMO"}]] as const;
 for(const [method,path,body] of cases){expect((await request(app)[method]('/api/recruitment'+path).send(body)).status).toBe(401);for(const who of ['employee','otherManager','hr','developer'] as const)expect((await f.call(who,method,path,body)).status,who+path).toBe(403);}
 expect((await request(app).get('/api/recruitment/status')).status).toBe(401);expect((await f.call('developer','get','/status')).status).toBe(403);expect((await f.call('employee','get','/status')).body).toEqual({canManage:false,canRaise:false,canReadRequisitions:false,isDirector:false});
 });
 it("HR is off even with a grant, ON opens only recruiting duties and OFF takes effect on the next request",async()=>{
 await f.grant('hr','recruitment.manage');expect((await f.call('hr','get','/pipelines')).status).toBe(403);await f.hrSwitch('ON');expect((await f.call('hr','get','/pipelines')).status).toBe(200);expect((await f.call('hr','get','/settings')).status).toBe(403);await f.hrSwitch('OFF');expect((await f.call('hr','get','/pipelines')).status).toBe(403);
 });
 it("a single director confirms a version; stale writes and mutation of chosen settings are refused",async()=>{
 await f.setting('retention',{days:45});expect((await required('retention')).days).toBe(45);
 expect((await f.call('director','put','/settings/retention',{value:{days:60},version:0,reason:'DEMO stale'})).status).toBe(409);
 const row=await prisma.recruitmentSettingVersion.findFirstOrThrow({where:{key:'retention'}});await expect(prisma.recruitmentSettingVersion.update({where:{id:row.id},data:{reason:'DEMO overwrite'}})).rejects.toThrow();
 expect(await prisma.auditLog.count({where:{entityType:'RecruitmentSettingVersion',entityId:row.id}})).toBe(1);
 });
 it("pipelines are explicitly chosen immutable versions with unique ordered stage codes",async()=>{
 const made=await f.call('director','post','/pipelines',{name:'DEMO pipeline',stages:[{code:'DEMO_APPLIED',label:'DEMO applied'},{code:'DEMO_REVIEW',label:'DEMO review'}],reason:'DEMO choice'});expect(made.status).toBe(201);pipelineId=made.body.id;expect(made.body.stages.map((s:{position:number})=>s.position)).toEqual([0,1]);
 await expect(prisma.recruitmentPipeline.update({where:{id:pipelineId},data:{name:'DEMO overwrite'}})).rejects.toThrow();
 expect((await f.call('director','post','/pipelines',{name:'DEMO duplicate',stages:[{code:'DEMO',label:'DEMO'},{code:'DEMO',label:'DEMO'}],reason:'DEMO'})).status).toBe(400);
 });
 it("candidate identity and both feedback values are registered for encryption/key rotation",()=>{
 for(const [model,fields] of [['Candidate',['nameEncrypted','emailEncrypted','phoneEncrypted']],['InterviewFeedback',['answersEncrypted','recommendationEncrypted']]] as const)for(const field of fields)expect(ENCRYPTED_COLUMNS).toContainEqual(expect.objectContaining({model,field}));
 });
});
