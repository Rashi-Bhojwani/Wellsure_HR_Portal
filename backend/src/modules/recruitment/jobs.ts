import { candidateName } from "./candidates";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { choiceMode } from "../../lib/directorAuthority";
import { recordDirectorNotice, scheduleDelivery } from "../../lib/directorNotices";
import { HttpError } from "../../middleware/errorHandler";
import { absent, context, director, jobWhere, requireJob, requireManagement, type Actor, type Context, type Meta } from "./access";
import { getSetting } from "./settings";
const fields={title:z.string().trim().min(1).max(200),departmentId:z.string().min(1),locationId:z.string().min(1),employmentType:z.enum(["PERMANENT","CONTRACT","INTERN","CONSULTANT","PROBATION"])};
export const requisitionInput=z.object({...fields,headcount:z.number().int().min(1).max(2147483647),reason:z.string().trim().min(1).max(5000)}).strict();
export const jobInput=z.object({...fields,description:z.string().trim().min(1).max(20000),requisitionId:z.string().min(1).optional(),pipelineId:z.string().min(1).optional()}).strict();
export const decisionInput=z.object({decision:z.enum(["APPROVE","REJECT"]),reason:z.string().trim().min(1).max(2000)}).strict();
export const jobStateInput=z.object({status:z.enum(["OPEN","ON_HOLD","CLOSED"]),pipelineId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(2000)}).strict();
export const listInput=z.object({status:z.enum(["DRAFT","OPEN","ON_HOLD","CLOSED"]).optional(),page:z.coerce.number().int().min(1).default(1),q:z.string().trim().max(200).default("")}).strict();
const PAGE_SIZE=20;
async function masters(input:{departmentId:string;locationId:string}){const [d,l]=await Promise.all([prisma.department.count({where:{id:input.departmentId}}),prisma.location.count({where:{id:input.locationId}})]);if(!d||!l)throw new HttpError(400,"Choose an existing department and location.","VALIDATION_ERROR");}
export function requisitionWhere(c:Context):Prisma.JobRequisitionWhereInput{if(c.manage)return c.isDirector||c.office?{}:{requester:c.employeeScope};return {requesterEmployeeId:c.manager?c.employeeId:"__unavailable__"};}
export async function getRequisition(id:string,actor:Actor){const c=await context(actor);const row=await prisma.jobRequisition.findFirst({where:{id,AND:[requisitionWhere(c)]}});if(!row)throw absent();return {...row,canSubmit:row.status==="DRAFT"&&row.requesterEmployeeId===c.employeeId&&c.canRaise,canDecide:c.isDirector&&row.status==="PENDING"};}
export async function listRequisitions(actor:Actor){const c=await context(actor);if(!c.manage&&!c.manager)throw new HttpError(403,"Requisitions are unavailable.","FORBIDDEN");return prisma.jobRequisition.findMany({where:requisitionWhere(c),orderBy:{createdAt:"desc"}});}
export async function createRequisition(actor:Actor,input:z.infer<typeof requisitionInput>,meta:Meta){const c=await context(actor);if(!c.canRaise)throw new HttpError(403,"A director must grant permission to raise requisitions.","FORBIDDEN");await masters(input);
 return prisma.$transaction(async tx=>{const row=await tx.jobRequisition.create({data:{...input,requesterEmployeeId:c.employeeId,changedByUserId:c.userId}});await writeAuditLogs([{...meta,action:"recruitment.requisition.created",entityType:"JobRequisition",entityId:row.id}],tx);return row;});}
export async function submitRequisition(id:string,actor:Actor,meta:Meta){const c=await context(actor);const initial=await getRequisition(id,actor);if(initial.requesterEmployeeId!==c.employeeId||!c.canRaise)throw absent();
 const route=await getSetting("approvalRoute");const second=await choiceMode("RECRUITMENT_REQUISITION")==="SECOND_DIRECTOR";
 if(second&&route?.route!=="DIRECTOR")throw new HttpError(409,"Choose the director approval route before using its optional second-director check.","RECRUITMENT_NOT_SET");
 return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM job_requisitions WHERE id=${id} FOR UPDATE`;const fresh=await tx.jobRequisition.findUniqueOrThrow({where:{id}});if(fresh.status!=="DRAFT")return fresh;
 const row=await tx.jobRequisition.update({where:{id},data:{status:route?.route==="DIRECTOR"?"PENDING":"APPROVED",approvalRoute:{route:route?.route??"NONE",second},changedByUserId:c.userId}});
 await writeAuditLogs([{...meta,action:"recruitment.requisition.submitted",entityType:"JobRequisition",entityId:id,after:{status:row.status}}],tx);return row;});}
export async function decideRequisition(id:string,actor:Actor,input:z.infer<typeof decisionInput>,meta:Meta){await context(actor);await director(actor.userId);await getRequisition(id,actor);let noticeId:string|null=null;
 const row=await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM job_requisitions WHERE id=${id} FOR UPDATE`;const r=await tx.jobRequisition.findUniqueOrThrow({where:{id}});if(r.status!=="PENDING")throw new HttpError(409,"Only a pending requisition can be decided.","CONFLICT");const route=r.approvalRoute as {second?:boolean}|null;
 if(input.decision==="APPROVE"&&route?.second){if(!r.approvalByUserId){await tx.jobRequisition.update({where:{id},data:{approvalByUserId:actor.userId,changedByUserId:actor.userId}});noticeId=(await recordDirectorNotice({kind:"ACTION",step:"RECRUITMENT_REQUISITION",subjectType:"JobRequisition",subjectId:id,subjectLabel:"A recruitment requisition awaits the optional other-director decision",actorUserId:actor.userId},tx)).noticeId;return {...r,waiting:true};}if(r.approvalByUserId===actor.userId)return {...r,waiting:true};}
 const changed=await tx.jobRequisition.update({where:{id},data:{status:input.decision==="APPROVE"?"APPROVED":"REJECTED",decisionReason:input.reason,changedByUserId:actor.userId}});
 await writeAuditLogs([{...meta,action:"recruitment.requisition.decided",entityType:"JobRequisition",entityId:id,after:{status:changed.status}}],tx);
 noticeId=(await recordDirectorNotice({kind:"ACTION",step:"RECRUITMENT_REQUISITION",subjectType:"JobRequisition",subjectId:id,subjectLabel:"A recruitment requisition was decided",actorUserId:actor.userId,authority:route?.second?"SECOND_DIRECTOR":"DIRECTOR_AUTHORITY"},tx)).noticeId;
 return {...changed,waiting:false};});await scheduleDelivery(noticeId);return row;}
export async function closeRequisition(id:string,actor:Actor,reason:string,meta:Meta){const c=await requireManagement(actor);await getRequisition(id,actor);return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM job_requisitions WHERE id=${id} FOR UPDATE`;const row=await tx.jobRequisition.update({where:{id},data:{status:"CLOSED",decisionReason:reason,changedByUserId:c.userId}});await writeAuditLogs([{...meta,action:"recruitment.requisition.closed",entityType:"JobRequisition",entityId:id}],tx);return row;});}
export async function createJob(actor:Actor,input:z.infer<typeof jobInput>,meta:Meta){const c=await requireManagement(actor);await masters(input);
 return prisma.$transaction(async tx=>{
 if(input.requisitionId){await tx.$queryRaw`SELECT id FROM job_requisitions WHERE id=${input.requisitionId} FOR UPDATE`;const r=await tx.jobRequisition.findFirst({where:{id:input.requisitionId,AND:[requisitionWhere(c)]}});if(!r)throw absent();if(r.status!=="APPROVED")throw new HttpError(409,"The requisition must be approved before creating its job.","CONFLICT");if(Object.keys(fields).some(key=>r[key as keyof typeof fields]!==input[key as keyof typeof fields]))throw new HttpError(400,"Job details must match the approved requisition.","VALIDATION_ERROR");const prior=await tx.recruitmentJob.findUnique({where:{requisitionId:r.id}});if(prior)return prior;}
 if(input.pipelineId&&!await tx.recruitmentPipeline.count({where:{id:input.pipelineId}}))throw new HttpError(400,"Choose a configured pipeline.","VALIDATION_ERROR");
 const row=await tx.recruitmentJob.create({data:{...input,changedByUserId:c.userId}});await writeAuditLogs([{...meta,action:"recruitment.job.created",entityType:"RecruitmentJob",entityId:row.id}],tx);return row;});}
export async function changeJob(id:string,actor:Actor,input:z.infer<typeof jobStateInput>,meta:Meta){const c=await requireManagement(actor);await requireJob(id,c);
 return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM jobs WHERE id=${id} FOR UPDATE`;const row=await tx.recruitmentJob.findUniqueOrThrow({where:{id}});if(row.status===input.status)return row;
 if(row.status==="CLOSED"||(input.status==="ON_HOLD"&&row.status!=="OPEN"))throw new HttpError(409,"This job cannot make that state change.","CONFLICT");
 const pipelineId=input.pipelineId??row.pipelineId;
 if(input.status==="OPEN"){
 if(!pipelineId||!await tx.recruitmentPipeline.count({where:{id:pipelineId,stages:{some:{}}}}))throw new HttpError(409,"Recruitment pipeline is Not set. Choose a director's pipeline before opening.","RECRUITMENT_NOT_SET");
 if(row.pipelineId!==pipelineId&&await tx.recruitmentApplication.count({where:{jobId:id}}))throw new HttpError(409,"A job with applications keeps its selected pipeline.","CONFLICT");}
 const changed=await tx.recruitmentJob.update({where:{id},data:{status:input.status,...(input.status==="OPEN"?{pipelineId}:{}),changedByUserId:c.userId}});await writeAuditLogs([{...meta,action:"recruitment.job.state",entityType:"RecruitmentJob",entityId:id,after:{status:changed.status,reason:input.reason}}],tx);return changed;});}
export async function listJobs(actor:Actor,input:z.infer<typeof listInput>){const c=await context(actor);if(!c.manage&&!c.manager)throw new HttpError(403,"Jobs are unavailable.","FORBIDDEN");const where={AND:[jobWhere(c),...(input.status?[{status:input.status}]:[]),{title:{contains:input.q,mode:"insensitive" as const}}]};const [items,total]=await Promise.all([prisma.recruitmentJob.findMany({where,orderBy:{createdAt:"desc"},skip:(input.page-1)*PAGE_SIZE,take:PAGE_SIZE,include:{_count:{select:{applications:true}}}}),prisma.recruitmentJob.count({where})]);return {items,total,page:input.page,pageSize:PAGE_SIZE};}
export async function getJob(id:string,actor:Actor){const c=await context(actor);const job=await requireJob(id,c);return {...job,canManage:c.manage};}

export async function board(id:string,actor:Actor){const c=await context(actor),job=await requireJob(id,c);const [stages,rows]=await Promise.all([prisma.recruitmentPipelineStage.findMany({where:{pipelineId:job.pipelineId??"__unavailable__"},orderBy:{position:"asc"}}),prisma.recruitmentApplication.findMany({where:{jobId:id},include:{candidate:true},orderBy:{createdAt:"desc"}})]);return {job,stages,canManage:c.manage,items:rows.map(row=>({id:row.id,candidateId:row.candidateId,name:candidateName(row.candidate),stageId:row.stageId,status:row.status,version:row.version}))};}
