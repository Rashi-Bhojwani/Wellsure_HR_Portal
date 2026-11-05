import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { decryptField } from "../../lib/encryption";
import { writeAuditLogs } from "../../lib/audit";
import { mailService } from "../../integrations/mail";
import { HttpError } from "../../middleware/errorHandler";
import { absent, requireManagement, type Actor, type Meta } from "./access";
import { readApplication, readCandidate, retained } from "./candidates";
import { SETTING_SCHEMAS, version } from "./settings";
export const mailInput=z.object({applicationId:z.string().min(1),interviewId:z.string().min(1).optional(),templateId:z.string().min(1).max(60),idempotencyKey:z.uuid()}).strict();
const view=(r:Awaited<ReturnType<typeof prisma.recruitmentCandidateMail.findUniqueOrThrow>>)=>({id:r.id,candidateId:r.candidateId,applicationId:r.applicationId,interviewId:r.interviewId,templateId:r.templateId,kind:r.kind,status:r.status,createdAt:r.createdAt.toISOString()});
const html=(text:string)=>'<p>'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>')+'</p>';
export async function listMail(id:string,actor:Actor){const c=await requireManagement(actor);await readCandidate(id,c);return (await prisma.recruitmentCandidateMail.findMany({where:{candidateId:id},orderBy:{createdAt:'desc'}})).map(view);}
export async function sendMail(id:string,actor:Actor,input:z.infer<typeof mailInput>,meta:Meta){const c=await requireManagement(actor),candidate=await readCandidate(id,c);if(!retained(candidate))throw absent();if(!candidate.emailEncrypted)throw new HttpError(409,"This candidate has no email contact recorded.","CONTACT_NOT_SET");
 const setting=await version('emailTemplates');if(setting?.value==null)throw new HttpError(409,"Candidate email templates are Not set.","RECRUITMENT_NOT_SET");const template=SETTING_SCHEMAS.emailTemplates.parse(setting.value).find(t=>t.id===input.templateId);if(!template)throw new HttpError(400,"Choose a director's email template.","VALIDATION_ERROR");
 const application=await readApplication(input.applicationId,c);if(application.candidateId!==id)throw absent();
 let scheduledAt='',round='';
 if(template.kind==='INVITATION'){if(!input.interviewId)throw new HttpError(400,"Choose the scheduled interview for this invitation.","VALIDATION_ERROR");const interview=await prisma.recruitmentInterview.findFirst({where:{id:input.interviewId,applicationId:application.id,status:'SCHEDULED'}});if(!interview||application.status!=='ACTIVE')throw absent();scheduledAt=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(interview.scheduledAt);round=interview.round;}
 else if(application.status!=='REJECTED'||input.interviewId)throw new HttpError(409,"Rejection mail requires the rejected application.","CONFLICT");
 const values:Record<string,string>={jobTitle:application.job.title,scheduledAt,round};const render=(text:string)=>text.replace(/\{\{(.*?)\}\}/g,(_all,key:string)=>values[key]??'');const subject=render(template.subject),body=render(template.body);
 // Validate the finished text too, so a dynamic job/round cannot inject a private token.
 if(!SETTING_SCHEMAS.emailTemplates.safeParse([{...template,subject,body}]).success)throw new HttpError(400,"This message cannot use pay, identity or feedback content.","INVALID_TEMPLATE_CONTENT");
 const key=`${id}:${c.userId}:${input.idempotencyKey}`;
 const check=(row:Awaited<ReturnType<typeof prisma.recruitmentCandidateMail.findUniqueOrThrow>>)=>{if(row.templateId!==input.templateId||row.applicationId!==application.id||row.interviewId!==(input.interviewId??null))throw new HttpError(409,"This send key was already used for a different message.","CONFLICT");return view(row);};
 const prior=await prisma.recruitmentCandidateMail.findUnique({where:{idempotencyKey:key}});if(prior)return check(prior);
 let made:Awaited<ReturnType<typeof prisma.recruitmentCandidateMail.create>>;
 try{made=await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM candidates WHERE id=${id} FOR UPDATE`;if(!retained(await tx.candidate.findUniqueOrThrow({where:{id}})))throw absent();const row=await tx.recruitmentCandidateMail.create({data:{candidateId:id,applicationId:application.id,interviewId:input.interviewId,templateId:template.id,templateVersionId:setting.id,kind:template.kind,status:'PENDING',idempotencyKey:key,sentByUserId:c.userId}});await writeAuditLogs([{...meta,action:'recruitment.mail.requested',entityType:'RecruitmentCandidateMail',entityId:row.id,after:{templateId:template.id}}],tx);return row;});}
 catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')return check(await prisma.recruitmentCandidateMail.findUniqueOrThrow({where:{idempotencyKey:key}}));throw error;}
 let status='UNKNOWN';
 try{const current=await requireManagement(actor),fresh=await readCandidate(id,current);if(!retained(fresh)||!fresh.emailEncrypted)status='CANCELLED';else{
 const claimed=await prisma.recruitmentCandidateMail.updateMany({where:{id:made.id,status:'PENDING'},data:{status:'SENDING'}});if(!claimed.count)return view(await prisma.recruitmentCandidateMail.findUniqueOrThrow({where:{id:made.id}}));
 const receipt=await mailService.send({to:decryptField(fresh.emailEncrypted),subject,text:body,html:html(body),sensitive:true});status=receipt.delivered?'SENT':'PREPARED';}}
 catch(error){status=error instanceof HttpError&&[403,404].includes(error.status)?'CANCELLED':'UNKNOWN';}
 await prisma.$transaction(async tx=>{await tx.recruitmentCandidateMail.updateMany({where:{id:made.id,status:{in:['PENDING','SENDING']}},data:{status}});await writeAuditLogs([{...meta,action:'recruitment.mail.recorded',entityType:'RecruitmentCandidateMail',entityId:made.id,after:{templateId:template.id,status}}],tx);});
 return view(await prisma.recruitmentCandidateMail.findUniqueOrThrow({where:{id:made.id}}));
}
