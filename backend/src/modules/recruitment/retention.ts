import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { activeDirectors } from "../../lib/directorAuthority";
import { activeUsersHoldingPermission } from "../../lib/permissions";
import { storageService } from "../../integrations/storage";
import { getSocketServer } from "../../realtime/emit";
import { HttpError } from "../../middleware/errorHandler";
import { context, director, type Actor, type Meta } from "./access";
import { retained } from "./candidates";
export const eraseInput=z.object({requestConfirmed:z.literal(true)}).strict();
async function refresh(candidateId:string){
 const [panels,requests,managers,directors,candidate]=await Promise.all([
 prisma.recruitmentInterviewPanel.findMany({where:{interview:{application:{candidateId}}},select:{employeeId:true}}),
 prisma.jobRequisition.findMany({where:{job:{applications:{some:{candidateId}}}},select:{requesterEmployeeId:true}}),
 activeUsersHoldingPermission("recruitment.manage"),activeDirectors(),prisma.candidate.findUnique({where:{id:candidateId},select:{createdByUserId:true}})]);
 const creator=candidate?await prisma.user.findUnique({where:{id:candidate.createdByUserId},select:{employeeId:true}}):null;
 const ids=[...new Set([...panels.map(p=>p.employeeId),...requests.map(r=>r.requesterEmployeeId),...managers.map(m=>m.employeeId),...directors.map(d=>d.employeeId),...(creator?[creator.employeeId]:[])])];
 if(ids.length)getSocketServer()?.to(ids.map(id=>`user:${id}`)).emit("recruitment.access.changed",{});
}
async function anonymize(id:string,now:Date,onRequest:boolean,meta?:Meta){
 const changed=await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM candidates WHERE id=${id} FOR UPDATE`;const row=await tx.candidate.findUnique({where:{id}});if(!row)throw new HttpError(404,"Candidate not found.","NOT_FOUND");if(row.anonymizedAt||(!onRequest&&retained(row,now)))return false;
 // Delete first while the row is locked. A failed delete rolls back metadata,
 // retaining the key for the next cleanup attempt. APIs already hide expired values.
 if(row.cvStorageKey)await storageService.deleteObject(row.cvStorageKey);
 await tx.candidate.update({where:{id},data:{nameEncrypted:null,emailEncrypted:null,phoneEncrypted:null,nameHash:null,emailHash:null,phoneHash:null,cvStorageKey:null,cvMimeType:null,anonymizedAt:now}});
 await tx.interviewFeedback.updateMany({where:{interview:{application:{candidateId:id}}},data:{answersEncrypted:null,recommendationEncrypted:null}});
 await tx.notification.updateMany({where:{type:{startsWith:'recruitment.'},payload:{path:['candidateId'],equals:id}},data:{body:'Candidate details removed.'}});
 await tx.recruitmentCandidateMail.updateMany({where:{candidateId:id,status:'PENDING'},data:{status:'CANCELLED'}});
 await tx.recruitmentHistory.create({data:{entityType:'Candidate',entityId:id,event:onRequest?'ERASED_ON_REQUEST':'ANONYMIZED_RETENTION',actorUserId:meta?.actorUserId}});
 await writeAuditLogs([{...meta,action:onRequest?'recruitment.candidate.erased':'recruitment.candidate.retention_anonymized',entityType:'Candidate',entityId:id,after:{onRequest}}],tx);return true;
 },{timeout:30000});
 if(changed)await refresh(id);return {id,anonymized:true,changed};
}
export async function eraseCandidate(id:string,actor:Actor,meta:Meta){await context(actor);await director(actor.userId);try{return await anonymize(id,new Date(),true,meta);}catch(error){if(error instanceof HttpError)throw error;logger.warn({candidateId:id,event:'recruitment.erasure.awaiting_retry'},'Candidate erasure awaits retry');throw new HttpError(503,"Candidate erasure could not complete. Retry after storage is available.","ERASURE_INCOMPLETE");}}
export async function purgeExpiredCandidates(now=new Date()){
 let after='',anonymized=0,failed=0;
 for(;;){const rows=await prisma.candidate.findMany({where:{id:{gt:after},anonymizedAt:null,retentionUntil:{lte:now}},orderBy:{id:'asc'},take:100,select:{id:true}});if(!rows.length)break;
 for(const row of rows){try{if((await anonymize(row.id,now,false)).changed)anonymized++;}catch{failed++;logger.warn({candidateId:row.id,event:'recruitment.retention.awaiting_retry'},'Candidate retention cleanup awaits retry');}}
 after=rows[rows.length-1]!.id;
 }return {anonymized,failed};
}
