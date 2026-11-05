import { randomUUID } from "node:crypto";
import { Prisma, type Candidate } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { encryptField, decryptField } from "../../lib/encryption";
import { blindIndex } from "../../lib/fieldHash";
import { writeAuditLogs } from "../../lib/audit";
import { prepareDocumentUpload, requireFile } from "../../lib/uploads";
import { storageService } from "../../integrations/storage";
import { HttpError } from "../../middleware/errorHandler";
import { absent, context, jobWhere, requireJob, requireManagement, type Actor, type Context, type Meta } from "./access";
import { required, version, SETTING_SCHEMAS } from "./settings";
export const normalizeName=(value:string)=>value.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
export const normalizeEmail=(value:string)=>value.normalize("NFKC").trim().toLowerCase();
export const normalizePhone=(value:string)=>value.replace(/\D/g,"");
export const fingerprint=(value:string)=>blindIndex(value);
const phone=z.string().trim().max(40).refine(value=>/^[+()\d -]+$/.test(value)&&normalizePhone(value).length>=7&&normalizePhone(value).length<=20,"Enter a valid phone number.");
export const candidateInput=z.object({name:z.string().trim().min(1).max(300),email:z.email().max(320).nullable(),phone:phone.nullable(),source:z.string().min(1).max(60),consentConfirmed:z.literal(true),consentRecordedAt:z.iso.datetime({offset:true})}).strict().refine(v=>Boolean(v.email||v.phone),"Enter email or phone.");
export const candidateListInput=z.object({page:z.coerce.number().int().min(1).default(1),q:z.string().trim().max(320).default("")}).strict();
export const applyInput=z.object({jobId:z.string().min(1)}).strict();
export const moveInput=z.object({stageId:z.string().min(1),version:z.number().int().min(0),reason:z.string().trim().max(2000).optional()}).strict();
export const endInput=z.object({status:z.enum(["REJECTED","WITHDRAWN"]),reasonCategory:z.string().min(1).max(60),version:z.number().int().min(0)}).strict();
const PAGE_SIZE=20;
export function applicationWhere(c:Context):Prisma.RecruitmentApplicationWhereInput{
 if(c.manage)return {job:jobWhere(c)};
 return {OR:[...(c.manager?[{job:{requisition:{requesterEmployeeId:c.employeeId}}}]:[]),{interviews:{some:{status:{not:"CANCELLED"},panel:{some:{employeeId:c.employeeId,active:true}}}}}]};
}
export function candidateWhere(c:Context):Prisma.CandidateWhereInput{return c.manage?{}:{applications:{some:applicationWhere(c)}};}
export const retained=(row:Candidate,now=new Date())=>!row.anonymizedAt&&row.retentionUntil>now;
export const candidateName=(row:Candidate)=>retained(row)&&row.nameEncrypted?decryptField(row.nameEncrypted):"Candidate details removed";
export async function readCandidate(id:string,c:Context){const row=await prisma.candidate.findFirst({where:{id,AND:[candidateWhere(c)]}});if(!row)throw absent();return row;}
export async function isAssigned(candidateId:string,employeeId:string){return await prisma.recruitmentInterviewPanel.count({where:{employeeId,active:true,interview:{status:{not:"CANCELLED"},application:{candidateId}}}})>0;}
export async function canReadCv(row:Candidate,c:Context){return retained(row)&&(c.manage||await isAssigned(row.id,c.employeeId));}
function view(row:Candidate,c:Context,readCv=false){const live=retained(row);return {id:row.id,name:candidateName(row),anonymized:!live,createdAt:row.createdAt.toISOString(),canManage:c.manage,...(c.manage?{email:live&&row.emailEncrypted?decryptField(row.emailEncrypted):null,phone:live&&row.phoneEncrypted?decryptField(row.phoneEncrypted):null,source:row.source,consentRecordedAt:row.consentRecordedAt.toISOString(),retentionUntil:row.retentionUntil.toISOString()}:{}),...(readCv?{hasCv:live&&Boolean(row.cvStorageKey),canReadCv:true}:{canReadCv:false})};}
const duplicate=()=>new HttpError(409,"A candidate may already be recorded. Ask the recruiting team to review the existing records.","DUPLICATE_CANDIDATE");
export async function createCandidate(actor:Actor,input:z.infer<typeof candidateInput>,meta:Meta){const c=await requireManagement(actor);
 const sources=await required("sources");if(!sources.some(s=>s.code===input.source))throw new HttpError(400,"Choose a configured candidate source.","VALIDATION_ERROR");
 const retention=await version("retention");if(retention?.value==null)throw new HttpError(409,"Recruitment retention is Not set.","RECRUITMENT_NOT_SET");
 const days=SETTING_SCHEMAS.retention.parse(retention.value).days,consent=new Date(input.consentRecordedAt),until=new Date(consent.getTime()+days*86400000);
 if(consent>new Date()||until<=new Date())throw new HttpError(400,"Consent must already be recorded and its retention period must still be open.","VALIDATION_ERROR");
 const emailHash=input.email?fingerprint(normalizeEmail(input.email)):null,phoneHash=input.phone?fingerprint(normalizePhone(input.phone)):null;
 const where:Prisma.CandidateWhereInput={OR:[...(emailHash?[{emailHash}]:[]),...(phoneHash?[{phoneHash}]:[])]};
 if(await prisma.candidate.count({where}))throw duplicate();
 try{return await prisma.$transaction(async tx=>{const row=await tx.candidate.create({data:{nameEncrypted:encryptField(input.name),nameHash:fingerprint(normalizeName(input.name)),emailEncrypted:input.email?encryptField(input.email):null,emailHash,phoneEncrypted:input.phone?encryptField(input.phone):null,phoneHash,source:input.source,consentRecordedAt:consent,retentionUntil:until,retentionVersionId:retention.id,createdByUserId:c.userId}});await writeAuditLogs([{...meta,action:"recruitment.candidate.created",entityType:"Candidate",entityId:row.id}],tx);return view(row,c);});}
 catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2034"].includes(error.code)){if(await prisma.candidate.count({where}))throw duplicate();throw new HttpError(409,"Candidate creation conflicted. Retry the request.","CONFLICT");}throw error;}
}
export async function listCandidates(actor:Actor,input:z.infer<typeof candidateListInput>){const c=await context(actor);const search=input.q?{OR:[{nameHash:fingerprint(normalizeName(input.q))},...(c.manage?[{emailHash:fingerprint(normalizeEmail(input.q))},{phoneHash:fingerprint(normalizePhone(input.q))}]:[])]}:{};
 const where={AND:[candidateWhere(c),search]};const [rows,total]=await Promise.all([prisma.candidate.findMany({where,orderBy:{createdAt:"desc"},skip:(input.page-1)*PAGE_SIZE,take:PAGE_SIZE}),prisma.candidate.count({where})]);
 return {items:rows.map(row=>view(row,c)),total,page:input.page,pageSize:PAGE_SIZE};}
const applicationInclude={job:{select:{id:true,title:true}},stage:{select:{id:true,label:true,code:true,position:true}}} as const;
export async function getCandidate(id:string,actor:Actor){const c=await context(actor),row=await readCandidate(id,c);const applications=await prisma.recruitmentApplication.findMany({where:{candidateId:id,AND:[applicationWhere(c)]},include:applicationInclude,orderBy:{createdAt:"desc"}});return {...view(row,c,await canReadCv(row,c)),applications};}
export async function apply(id:string,actor:Actor,input:z.infer<typeof applyInput>,meta:Meta){const c=await requireManagement(actor);await readCandidate(id,c);await requireJob(input.jobId,c);
 return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM candidates WHERE id=${id} FOR UPDATE`;const candidate=await tx.candidate.findUniqueOrThrow({where:{id}});if(!retained(candidate))throw absent();await tx.$queryRaw`SELECT id FROM jobs WHERE id=${input.jobId} FOR UPDATE`;
 const job=await tx.recruitmentJob.findUniqueOrThrow({where:{id:input.jobId}});if(job.status!=="OPEN"||!job.pipelineId)throw new HttpError(409,"Only an open job with a pipeline accepts applications.","CONFLICT");
 const prior=await tx.recruitmentApplication.findUnique({where:{candidateId_jobId:{candidateId:id,jobId:job.id}}});if(prior)return prior;
 const first=await tx.recruitmentPipelineStage.findFirst({where:{pipelineId:job.pipelineId},orderBy:{position:"asc"}});if(!first)throw new HttpError(409,"Recruitment pipeline is Not set.","RECRUITMENT_NOT_SET");
 const row=await tx.recruitmentApplication.create({data:{candidateId:id,jobId:job.id,stageId:first.id,changedByUserId:c.userId}});await tx.applicationStageMove.create({data:{applicationId:row.id,toStageId:first.id,version:0,actorUserId:c.userId}});await writeAuditLogs([{...meta,action:"recruitment.application.created",entityType:"RecruitmentApplication",entityId:row.id}],tx);return row;});}
export async function readApplication(id:string,c:Context){const row=await prisma.recruitmentApplication.findFirst({where:{id,AND:[applicationWhere(c)]},include:{candidate:true,job:true,stage:true}});if(!row)throw absent();return row;}
export async function getApplication(id:string,actor:Actor){const c=await context(actor),row=await readApplication(id,c);const moves=await prisma.applicationStageMove.findMany({where:{applicationId:id},orderBy:{version:"asc"}});return {id:row.id,candidate:{id:row.candidate.id,name:candidateName(row.candidate)},job:{id:row.job.id,title:row.job.title},stage:row.stage,status:row.status,version:row.version,reasonCategory:row.reasonCategory,moves,canManage:c.manage};}
export async function move(id:string,actor:Actor,input:z.infer<typeof moveInput>,meta:Meta){const c=await requireManagement(actor);const initial=await readApplication(id,c);
 await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM candidates WHERE id=${initial.candidateId} FOR UPDATE`;if(!retained(await tx.candidate.findUniqueOrThrow({where:{id:initial.candidateId}})))throw absent();await tx.$queryRaw`SELECT id FROM applications WHERE id=${id} FOR UPDATE`;const row=await tx.recruitmentApplication.findUniqueOrThrow({where:{id}});
 if(row.status!=="ACTIVE")throw new HttpError(409,"Only an active application can move stages.","CONFLICT");
 if(row.stageId===input.stageId&&row.version===input.version+1)return;
 if(row.version!==input.version)throw new HttpError(409,"This application changed. Reload before moving it.","CONFLICT");
 const stage=await tx.recruitmentPipelineStage.findFirst({where:{id:input.stageId,pipelineId:initial.job.pipelineId??"__unavailable__"}});if(!stage)throw new HttpError(400,"Choose a stage in this job's pipeline.","VALIDATION_ERROR");if(stage.id===row.stageId)return;
 await tx.applicationStageMove.create({data:{applicationId:id,fromStageId:row.stageId,toStageId:stage.id,version:row.version+1,reason:input.reason,actorUserId:c.userId}});await tx.recruitmentApplication.update({where:{id},data:{stageId:stage.id,version:{increment:1},changedByUserId:c.userId}});await writeAuditLogs([{...meta,action:"recruitment.application.moved",entityType:"RecruitmentApplication",entityId:id,after:{version:row.version+1}}],tx);
 });return getApplication(id,actor);}
export async function endApplication(id:string,actor:Actor,input:z.infer<typeof endInput>,meta:Meta){const c=await requireManagement(actor);const initial=await readApplication(id,c);const reasons=await required("rejectionReasons");if(!reasons.some(r=>r.code===input.reasonCategory))throw new HttpError(400,"Choose a configured reason category.","VALIDATION_ERROR");
 await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM candidates WHERE id=${initial.candidateId} FOR UPDATE`;if(!retained(await tx.candidate.findUniqueOrThrow({where:{id:initial.candidateId}})))throw absent();await tx.$queryRaw`SELECT id FROM applications WHERE id=${id} FOR UPDATE`;const row=await tx.recruitmentApplication.findUniqueOrThrow({where:{id}});if(row.status===input.status&&row.reasonCategory===input.reasonCategory)return;if(row.status!=="ACTIVE"||row.version!==input.version)throw new HttpError(409,"This application changed. Reload before deciding.","CONFLICT");await tx.recruitmentApplication.update({where:{id},data:{status:input.status,reasonCategory:input.reasonCategory,version:{increment:1},changedByUserId:c.userId}});await writeAuditLogs([{...meta,action:"recruitment.application.decided",entityType:"RecruitmentApplication",entityId:id,after:{status:input.status,reasonCategory:input.reasonCategory}}],tx);});return getApplication(id,actor);}
export async function uploadCv(id:string,actor:Actor,file:Express.Multer.File|undefined,meta:Meta){const c=await requireManagement(actor);await readCandidate(id,c);const limits=await required("cvUploads");const prepared=await prepareDocumentUpload(requireFile(file),{documentMaxUploadMb:limits.maxMb,documentAllowedMimeTypes:limits.allowedMimeTypes});const key=`recruitment/cv/${id}/${randomUUID()}`;await storageService.putObject(key,prepared.buffer,prepared.mimeType);
 try{await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM candidates WHERE id=${id} FOR UPDATE`;const row=await tx.candidate.findUniqueOrThrow({where:{id}});if(!retained(row))throw absent();if(row.cvStorageKey)await storageService.deleteObject(row.cvStorageKey);await tx.candidate.update({where:{id},data:{cvStorageKey:key,cvMimeType:prepared.mimeType}});await writeAuditLogs([{...meta,action:"recruitment.cv.uploaded",entityType:"Candidate",entityId:id}],tx);});}catch(error){await storageService.deleteObject(key);throw error;}return getCandidate(id,actor);}
export async function downloadCv(id:string,actor:Actor,meta:Meta){const c=await context(actor),row=await readCandidate(id,c);if(!await canReadCv(row,c))throw new HttpError(403,"You cannot open this CV.","FORBIDDEN");if(!row.cvStorageKey)throw absent();
 let object:{body:Buffer;contentType:string};try{object=await storageService.getObject(row.cvStorageKey);}catch{throw absent();}
 const current=await context(actor),fresh=await readCandidate(id,current);if(fresh.cvStorageKey!==row.cvStorageKey||!await canReadCv(fresh,current))throw absent();
 if(!current.manage)await writeAuditLogs([{...meta,action:"recruitment.cv.opened",entityType:"Candidate",entityId:id}]);return object;
}
