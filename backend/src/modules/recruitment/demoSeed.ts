import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { setOverride } from "../access/service";
import { set, createPipeline, type SettingKey } from "./settings";
import { createRequisition, submitRequisition, createJob, changeJob } from "./jobs";
import { createCandidate, apply, uploadCv } from "./candidates";
import { schedule, submitFeedback } from "./interviews";
export const DEMO_CANDIDATE="DEMO-C4-CANDIDATE";
export const DEMO_FEEDBACK="DEMO-C4-PRIVATE-FEEDBACK";
// Explicit fictional DEMO choices only. The normal seed leaves every setting Not set.
export async function seedDemoRecruitment(who:Record<string,{employeeId:string;userId:string}>){
 if((await prisma.systemSetting.findUnique({where:{key:'demo.company'}}))?.value!==true)throw new Error('Recruitment demo requires labelled DEMO company.');
 if(await prisma.recruitmentSettingVersion.count())return;
 const director=who.DEMO001!,manager=who.DEMO009!,meta={actorUserId:director.userId};
 const actor=async(p:typeof director)=>({...p,...await resolveAccess(p.userId)});
 const choose=(key:SettingKey,value:unknown)=>set(key,{value,version:0,reason:'DEMO COMPANY: fictional recruitment rule'},meta);
 await choose('officeAudience',{officeManages:false});await choose('approvalRoute',{route:'NONE'});
 await choose('sources',[{code:'DEMO_INTERNAL',label:'DEMO manually added'}]);await choose('retention',{days:90});
 await choose('rejectionReasons',[{code:'DEMO_ROLE',label:'DEMO role requirement'}]);
 await choose('scorecard',{questions:[{id:'DEMO_QUESTION',label:'DEMO chosen interview question',required:true}],recommendations:[{code:'DEMO_PROGRESS',label:'DEMO progress'},{code:'DEMO_STOP',label:'DEMO stop'}]});
 await choose('cvUploads',{maxMb:2,allowedMimeTypes:['application/pdf']});
 await choose('emailTemplates',[{id:'DEMO_INVITE',kind:'INVITATION',subject:'DEMO interview for {{jobTitle}}',body:'DEMO invitation: {{round}} at {{scheduledAt}}.'},{id:'DEMO_REJECTION',kind:'REJECTION',subject:'DEMO application update',body:'DEMO application for {{jobTitle}} is closed.'}]);
 const pipeline=await createPipeline({name:'DEMO hiring pipeline',stages:[{code:'DEMO_APPLIED',label:'DEMO applied'},{code:'DEMO_INTERVIEW',label:'DEMO interview'}],reason:'DEMO chosen stages'},meta);
 const d=await actor(director);await setOverride(manager.employeeId,'recruitment.requisition.raise',{effect:'GRANT',reason:'DEMO COMPANY hiring requester'},d,meta);
 const org={departmentId:(await prisma.department.findFirstOrThrow()).id,locationId:(await prisma.location.findFirstOrThrow({where:{isActive:true}})).id};
 const m=await actor(manager),req=await createRequisition(m,{...org,title:'DEMO recruitment role',employmentType:'PERMANENT',headcount:1,reason:'DEMO fictional hiring need'},{actorUserId:manager.userId});await submitRequisition(req.id,m,{actorUserId:manager.userId});
 const job=await createJob(d,{...org,title:req.title,employmentType:'PERMANENT',description:'DEMO fictional job with no money fields.',requisitionId:req.id,pipelineId:pipeline.id},meta);await changeJob(job.id,d,{status:'OPEN',reason:'DEMO open job'},meta);
 const candidate=await createCandidate(d,{name:DEMO_CANDIDATE,email:'demo.c4.candidate@example.invalid',phone:'0000000004',source:'DEMO_INTERNAL',consentConfirmed:true,consentRecordedAt:new Date().toISOString()},meta);
 const cv=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% DEMO FICTIONAL CV\n%%EOF');await uploadCv(candidate.id,d,{buffer:cv,originalname:'DEMO.pdf',mimetype:'application/pdf',size:cv.length} as Express.Multer.File,meta);
 const application=await apply(candidate.id,d,{jobId:job.id},meta);
 const interview=await schedule(application.id,d,{round:'DEMO panel round',scheduledAt:new Date(Date.now()+86400000).toISOString(),panelEmployeeIds:[who.DEMO011!.employeeId,who.DEMO004!.employeeId]},meta);
 await submitFeedback(interview.id,await actor(who.DEMO011!),{answers:{DEMO_QUESTION:DEMO_FEEDBACK},recommendation:'DEMO_PROGRESS'},{actorUserId:who.DEMO011!.userId});
}
