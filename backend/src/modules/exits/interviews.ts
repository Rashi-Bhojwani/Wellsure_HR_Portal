import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { encryptField, decryptField } from "../../lib/encryption";
import { writeAuditLogs } from "../../lib/audit";
import { activeDirectors } from "../../lib/directorAuthority";
import { getSocketServer } from "../../realtime/emit";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { auditDirectorOpen } from "../peeps/access";
import { exitContext, requireExitDirector, type ExitActor, type ExitContext, type ExitMeta } from "./access";
import { settingVersion, SETTING_SCHEMAS } from "./settings";
export const scheduleSchema=z.object({interviewerEmployeeId:z.string().min(1),scheduledAt:z.iso.datetime({offset:true}),reason:z.string().trim().min(1).max(2000)}).strict();
export const answersSchema=z.object({answers:z.record(z.string(),z.string().trim().max(20000))}).strict();
const include={exitCase:{include:{resignation:{select:{employeeId:true}}}}} as const;
type Interview=Prisma.ExitInterviewGetPayload<{include:typeof include}>;
export function interviewWhere(c:ExitContext):Prisma.ExitInterviewWhereInput{
  return c.director?{}:{OR:[{interviewerEmployeeId:c.employeeId},{exitCase:{resignation:{employeeId:c.employeeId}}}]};
}
const absent=()=>new HttpError(404,"Exit interview not found.","NOT_FOUND");
async function read(id:string,c:ExitContext){
  const row=await prisma.exitInterview.findFirst({where:{id,AND:[interviewWhere(c)]},include});if(!row)throw absent();return row;
}
const participant=(r:Interview,employeeId:string)=>r.interviewerEmployeeId===employeeId||r.exitCase.resignation.employeeId===employeeId;
async function auditOpen(c:ExitContext,rows:Interview[],meta:ExitMeta){
  await auditDirectorOpen({userId:c.userId,employeeId:c.employeeId,isDirector:c.director,isMember:c.office,capabilities:[],roleCodes:c.roleCodes},{...meta,ipAddress:meta.ipAddress??null,userAgent:meta.userAgent??null},"ExitInterview",rows.map(r=>r.id),id=>participant(rows.find(r=>r.id===id)!,c.employeeId));
}
function view(r:Interview,details=false){
  return {id:r.id,caseId:r.caseId,employeeId:r.exitCase.resignation.employeeId,interviewerEmployeeId:r.interviewerEmployeeId,scheduledAt:r.scheduledAt.toISOString(),status:r.status,answeredAt:r.answeredAt?.toISOString()??null,purgeAfter:r.purgeAfter?.toISOString()??null,...(details&&{questions:SETTING_SCHEMAS.interviewQuestions.parse(r.questions),answers:r.answersEncrypted?JSON.parse(decryptField(r.answersEncrypted)) as Record<string,string>:null})};
}
async function recipients(r:Interview){
  const ids=[r.exitCase.resignation.employeeId,r.interviewerEmployeeId,...(await activeDirectors()).map(d=>d.employeeId)];
  const rows=await prisma.user.findMany({where:{employeeId:{in:ids},status:"ACTIVE",roles:{none:{role:{code:"DEVELOPER"}}}},select:{employeeId:true}});
  return rows.map(u=>u.employeeId);
}
async function changed(id:string,type:string){
  const row=await prisma.exitInterview.findUniqueOrThrow({where:{id},include});
  const current=await recipients(row);
  for(const employeeId of current)await notifyEmployee(employeeId,{type:`exits.interview.${type}`,title:"Private exit interview",body:"Your private exit interview has an update.",link:`/app/exits/interviews/${id}`,payload:{interviewId:id}});
  // Content and identifiers stay in the authenticated HTTP response only.
  if(current.length)getSocketServer()?.to(current.map(employeeId=>`user:${employeeId}`)).emit("exits.interviews.changed",{});
}
export async function schedule(caseId:string,actor:ExitActor,input:z.infer<typeof scheduleSchema>,meta:ExitMeta){
  await exitContext(actor);await requireExitDirector(actor.userId);
  const c=await prisma.exitCase.findUnique({where:{id:caseId},include:{resignation:true}});if(!c)throw new HttpError(404,"Exit case not found.","NOT_FOUND");
  if(c.status==="CLOSED")throw new HttpError(409,"This exit case is closed.","CONFLICT");
  const eligible=await prisma.user.count({where:{employeeId:input.interviewerEmployeeId,status:"ACTIVE",employee:{status:"ACTIVE"},roles:{none:{role:{code:"DEVELOPER"}}}}});
  if(!eligible)throw new HttpError(400,"Choose an active interviewer who can use exits.","VALIDATION_ERROR");
  const questions=await settingVersion("interviewQuestions");
  if(questions?.value==null)throw new HttpError(409,"Exits: interview questions are Not set.","EXITS_NOT_SET");
  const parsed=SETTING_SCHEMAS.interviewQuestions.parse(questions.value);
  const row=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM exit_cases WHERE id=${caseId} FOR UPDATE`;
    if((await tx.exitCase.findUniqueOrThrow({where:{id:caseId}})).status==="CLOSED")throw new HttpError(409,"This exit case is closed.","CONFLICT");
    const prior=await tx.exitInterview.findUnique({where:{caseId}});
    if(prior&&prior.status!=="SCHEDULED")throw new HttpError(409,"Only a scheduled interview may be rescheduled.","CONFLICT");
    const data={interviewerEmployeeId:input.interviewerEmployeeId,scheduledAt:new Date(input.scheduledAt),changedByUserId:actor.userId};
    const made=prior?await tx.exitInterview.update({where:{id:prior.id},data}):await tx.exitInterview.create({data:{caseId,questions:parsed,questionsVersionId:questions.id,...data}});
    await tx.exitHistory.create({data:{resignationId:c.resignationId,entityType:"exit_interviews",entityId:made.id,event:prior?"INTERVIEW_RESCHEDULED":"INTERVIEW_SCHEDULED",actorUserId:actor.userId,confidential:true}});
    await writeAuditLogs([{...meta,action:prior?"exits.interview.rescheduled":"exits.interview.scheduled",entityType:"ExitInterview",entityId:made.id,after:{reason:input.reason}}],tx);
    return {made,previousInterviewer:prior?.interviewerEmployeeId};
  });
  if(row.previousInterviewer&&row.previousInterviewer!==input.interviewerEmployeeId){
    // Empty access refresh only, to discard a formerly authorized screen's cache.
    getSocketServer()?.to(`user:${row.previousInterviewer}`).emit("exits.access.changed",{});
  }
  await changed(row.made.id,"scheduled");return get(row.made.id,actor,meta);
}
export async function list(actor:ExitActor,meta:ExitMeta){
  const c=await exitContext(actor);await purgeExpiredInterviews();
  const rows=await prisma.exitInterview.findMany({where:interviewWhere(c),include,orderBy:{scheduledAt:"desc"}});
  await auditOpen(c,rows,meta);return {total:rows.length,items:rows.map(r=>view(r))};
}
export async function get(id:string,actor:ExitActor,meta:ExitMeta){
  const c=await exitContext(actor);await purgeExpiredInterviews();const row=await read(id,c);await auditOpen(c,[row],meta);return {...view(row,true),canAnswer:row.exitCase.resignation.employeeId===c.employeeId&&row.status==="SCHEDULED",canComplete:(row.interviewerEmployeeId===c.employeeId||c.director)&&row.status==="SUBMITTED"};
}
export async function answer(id:string,actor:ExitActor,answers:Record<string,string>,meta:ExitMeta){
  const c=await exitContext(actor);const row=await read(id,c);if(row.exitCase.resignation.employeeId!==c.employeeId)throw new HttpError(403,"Only the resigning employee may submit these answers.","FORBIDDEN");
  const questions=SETTING_SCHEMAS.interviewQuestions.parse(row.questions);
  if(Object.keys(answers).some(key=>!questions.some(q=>q.id===key))||questions.some(q=>q.required&&!answers[q.id]?.trim()))throw new HttpError(400,"Complete the required questions and use only this interview's questions.","VALIDATION_ERROR");
  const retention=await settingVersion("interviewRetention");if(retention?.value==null)throw new HttpError(409,"Exits: interview answer retention is Not set.","EXITS_NOT_SET");
  const days=SETTING_SCHEMAS.interviewRetention.parse(retention.value).days;
  const canonical=JSON.stringify(Object.fromEntries(questions.map(q=>[q.id,answers[q.id]??""])));
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM exit_interviews WHERE id=${id} FOR UPDATE`;
    const fresh=await tx.exitInterview.findUniqueOrThrow({where:{id}});
    if(fresh.status!=="SCHEDULED"){
      if(fresh.answersEncrypted&&decryptField(fresh.answersEncrypted)===canonical)return;
      throw new HttpError(409,"This interview no longer accepts answers.","CONFLICT");
    }
    const now=new Date();
    await tx.exitInterview.update({where:{id},data:{answersEncrypted:encryptField(canonical),answeredAt:now,purgeAfter:new Date(now.getTime()+days*86400000),retentionVersionId:retention.id,status:"SUBMITTED",changedByUserId:c.userId}});
    await writeAuditLogs([{...meta,action:"exits.interview.answered",entityType:"ExitInterview",entityId:id}],tx);
  });
  await changed(id,"answered");return get(id,actor,meta);
}
export async function complete(id:string,actor:ExitActor,meta:ExitMeta){
  const c=await exitContext(actor);const row=await read(id,c);
  if(row.interviewerEmployeeId!==c.employeeId&&!c.director)throw new HttpError(403,"Only the interviewer or a director may complete this interview.","FORBIDDEN");
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM exit_interviews WHERE id=${id} FOR UPDATE`;
    const fresh=await tx.exitInterview.findUniqueOrThrow({where:{id}});
    if(fresh.interviewerEmployeeId!==c.employeeId&&!c.director)throw absent();
    if(fresh.status==="COMPLETED")return;
    if(fresh.status!=="SUBMITTED")throw new HttpError(409,"Answers are required before completion.","CONFLICT");
    await tx.exitInterview.update({where:{id},data:{status:"COMPLETED",changedByUserId:c.userId}});
    await writeAuditLogs([{...meta,action:"exits.interview.completed",entityType:"ExitInterview",entityId:id}],tx);
  });
  await changed(id,"completed");return get(id,actor,meta);
}
export async function purgeExpiredInterviews(now=new Date()){
  // Only ciphertext is removed. Immutable status history and metadata remain.
  const result=await prisma.$transaction(async tx=>{
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM exit_interviews WHERE answers_encrypted IS NOT NULL AND purge_after<=${now} FOR UPDATE SKIP LOCKED`;
    const changed=await tx.exitInterview.updateMany({where:{id:{in:rows.map(r=>r.id)},answersEncrypted:{not:null},purgeAfter:{lte:now}},data:{answersEncrypted:null,status:"PURGED",changedByUserId:null}});
    await writeAuditLogs(rows.map(r=>({action:"exits.interview.retention_purged",entityType:"ExitInterview",entityId:r.id})),tx);return changed.count;
  });return {purged:result};
}
