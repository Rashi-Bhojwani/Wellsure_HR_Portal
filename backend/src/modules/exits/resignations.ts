import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { businessDateOf, businessToday } from "../../lib/businessDate";
import { inForceOn } from "../../lib/effectiveDating";
import { activeDirectors, choiceMode } from "../../lib/directorAuthority";
import { recordDirectorNotice, scheduleDelivery } from "../../lib/directorNotices";
import { activeUsersHoldingPermission, resolveAccess } from "../../lib/permissions";
import { HttpError } from "../../middleware/errorHandler";
import { getSocketServer } from "../../realtime/emit";
import { initiateSeparation } from "../employee/separations";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { currentManager, exitContext, managesEmployee, mayAccept, resignationWhere, type ExitActor, type ExitContext, type ExitMeta } from "./access";
import { requiredSetting, settingVersion, SETTING_SCHEMAS } from "./settings";

const day = z.iso.date();
export const submitSchema = z.object({ requestedLastDay: day, reasonCategory: z.string().trim().min(1), reason: z.string().trim().min(1).max(5000), idempotencyKey: z.uuid() }).strict();
export const acceptSchema = z.object({ lastWorkingDay: day, note: z.string().trim().max(2000).optional() }).strict();
export const decisionSchema = z.object({ note: z.string().trim().min(1).max(2000) }).strict();
export const listSchema = z.object({ status: z.enum(["SUBMITTED","ACCEPTED","REJECTED","WITHDRAWN"]).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const absent = () => new HttpError(404, "Resignation not found.", "NOT_FOUND");
const dateOnly = (d: Date) => d.toISOString().slice(0,10);
const employeeSelect = { id:true, employeeCode:true, nameHistory:{where:inForceOn(),select:{fullName:true}} } as const;
const include = { employee:{select:employeeSelect}, exitCase:{include:{separation:true}} } as const;
type Row = Prisma.ResignationGetPayload<{include:typeof include}>;
export type NoticeRule = { days:number; basis:"CALENDAR_DAYS"; countFrom:"SUBMISSION_DAY"|"NEXT_DAY"; sourceNote:string; employmentType:string; gradeId:string|null };
export function noticeShortfall(row: Pick<Row,"submittedAt"|"noticeRule">, lastWorkingDay: Date): number | null {
  if (!row.noticeRule) return null;
  const rule = row.noticeRule as NoticeRule;
  const served = Math.max(0,Math.floor((lastWorkingDay.getTime()-businessDateOf(row.submittedAt).getTime())/86400000)+(rule.countFrom==="SUBMISSION_DAY"?1:0));
  return Math.max(0,rule.days-served);
}
function projection(row: Row) {
  const lastDay = row.exitCase?.separation.lastWorkingDate ?? row.requestedLastDay;
  return { id:row.id, employee:{id:row.employee.id,employeeCode:row.employee.employeeCode,name:row.employee.nameHistory[0]?.fullName??row.employee.employeeCode}, requestedLastDay:dateOnly(row.requestedLastDay), lastWorkingDay:dateOnly(lastDay), reasonCategory:row.reasonCategory, reason:row.reason, status:row.status, active:row.active, submittedAt:row.submittedAt.toISOString(), acceptedAt:row.acceptedAt?.toISOString()??null, decisionNote:row.decisionNote, noticeShortfallDays:noticeShortfall(row,lastDay), noticeRuleState:row.noticeRule?"CONFIRMED":"NOT_SET", noticeSourceNote:row.noticeRule?(row.noticeRule as NoticeRule).sourceNote:null, caseId:row.exitCase?.id??null, caseStatus:row.exitCase?.status??null, separationStatus:row.exitCase?.separation.status??null, approvalWaiting:row.approvalByUserId!==null };
}
async function load(id:string,c:ExitContext) {
  const row=await prisma.resignation.findFirst({where:{id,AND:[resignationWhere(c)]},include});
  if(!row)throw absent();
  return row;
}
export async function syncCase(caseId:string) {
  const c=await prisma.exitCase.findUnique({where:{id:caseId},include:{separation:true}});
  if(!c)return;
  const cancelled=c.separation.status==="CANCELLED"&&c.closureSource!=="CANCELLED_SEPARATION";
  const moved=c.observedLastDay.getTime()!==c.separation.lastWorkingDate.getTime();
  if(!cancelled&&!moved)return;
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.exits.case'),hashtext(${caseId}))::text`;
    const fresh=await tx.exitCase.findUniqueOrThrow({where:{id:caseId},include:{separation:true}});
    const isCancelled=fresh.separation.status==="CANCELLED"&&fresh.closureSource!=="CANCELLED_SEPARATION";
    const isMoved=fresh.observedLastDay.getTime()!==fresh.separation.lastWorkingDate.getTime();
    if(!isCancelled&&!isMoved)return;
    await tx.exitCase.update({where:{id:caseId},data:{observedLastDay:fresh.separation.lastWorkingDate,changedByUserId:null,...(isCancelled&&{status:"CLOSED",closedAt:new Date(),closureSource:"CANCELLED_SEPARATION",closeNote:"The separation was cancelled."})}});
    if(isCancelled)await tx.resignation.update({where:{id:fresh.resignationId},data:{active:false,changedByUserId:null}});
    await tx.exitHistory.create({data:{resignationId:fresh.resignationId,entityType:"exit_cases",entityId:caseId,event:isCancelled?"SEPARATION_CANCELLED":"LAST_DAY_CHANGED",detail:{lastWorkingDay:dateOnly(fresh.separation.lastWorkingDate)}}});
    await writeAuditLogs([{actorUserId:null,action:isCancelled?"exits.separation.cancelled":"exits.last_day.changed",entityType:"ExitCase",entityId:caseId,after:{lastWorkingDay:dateOnly(fresh.separation.lastWorkingDate)}}],tx);
  });
}
async function syncWhere(where:Prisma.ResignationWhereInput) {
  const cases=await prisma.exitCase.findMany({where:{resignation:where},select:{id:true}});
  for(const c of cases)await syncCase(c.id);
}
export async function exitRecipients(employeeId:string) {
  const candidates=await activeUsersHoldingPermission("exits.view");
  const manager=await currentManager(employeeId);
  const own=await prisma.user.findUnique({where:{employeeId},select:{id:true}});
  const ids=new Map(candidates.map(p=>[p.userId,p.employeeId]));
  if(manager)ids.set(manager.userId,manager.employeeId);
  if(own)ids.set(own.id,employeeId);
  const allowed:string[]=[];
  for(const [userId,id]of ids){
    const access=await resolveAccess(userId);
    if(access.roleCodes.includes("DEVELOPER"))continue;
    const c=await exitContext({userId,employeeId:id,...access});
    if(id===employeeId||c.teamIds.includes(employeeId)||await managesEmployee(c,employeeId))allowed.push(id);
  }
  return allowed;
}
export async function tellExit(employeeId:string,input:{type:string;title:string;body:string;caseId?:string;resignationId?:string}) {
  const recipients=await exitRecipients(employeeId);
  for(const id of recipients)await notifyEmployee(id,{type:input.type,title:input.title,body:input.body,link:id===employeeId?"/app/exits":"/admin/exits",payload:{...(input.caseId&&{caseId:input.caseId}),...(input.resignationId&&{resignationId:input.resignationId})}});
  if(recipients.length)getSocketServer()?.to(recipients.map(id=>`user:${id}`)).emit("exits.changed",{});
}
export async function submit(actor:ExitActor,input:z.infer<typeof submitSchema>,meta:ExitMeta) {
  const c=await exitContext(actor);
  const categories=await requiredSetting("reasonCategories");
  if(!categories.some(r=>r.code===input.reasonCategory))throw new HttpError(400,"Choose a configured resignation reason category.","VALIDATION_ERROR");
  const requested=new Date(input.requestedLastDay);
  if(requested<businessToday())throw new HttpError(400,"The requested last day cannot be before today.","VALIDATION_ERROR");
  const employee=await prisma.employee.findUniqueOrThrow({where:{id:c.employeeId},include:{jobHistory:{where:inForceOn(),select:{gradeId:true},take:1}}});
  if(employee.status!=="ACTIVE")throw new HttpError(409,"Only an active employee can submit a resignation.","CONFLICT");
  await syncWhere({employeeId:c.employeeId});
  const hash=createHash("sha256").update(JSON.stringify({requestedLastDay:input.requestedLastDay,reasonCategory:input.reasonCategory,reason:input.reason})).digest("hex");
  const prior=await prisma.resignation.findUnique({where:{employeeId_idempotencyKey:{employeeId:c.employeeId,idempotencyKey:input.idempotencyKey}}});
  if(prior){if(prior.requestHash!==hash)throw new HttpError(409,"This submission key was already used.","CONFLICT");return getResignation(prior.id,actor);}
  const noticeVersion=await settingVersion("noticeRules");
  const rules=noticeVersion?.value==null?null:SETTING_SCHEMAS.noticeRules.parse(noticeVersion.value);
  const gradeId=employee.jobHistory[0]?.gradeId??null;
  const matching=rules?.filter(r=>r.employmentType===employee.employmentType);
  const rule=matching?.find(r=>r.gradeId===gradeId)??matching?.find(r=>r.gradeId===null)??null;
  let row:{id:string};
  try{
    row=await prisma.$transaction(async tx=>{
      const made=await tx.resignation.create({data:{employeeId:c.employeeId,requestedLastDay:requested,reasonCategory:input.reasonCategory,reason:input.reason,idempotencyKey:input.idempotencyKey,requestHash:hash,noticeRule:rule??Prisma.DbNull,noticeRuleVersionId:rule?noticeVersion?.id:null,changedByUserId:c.userId}});
      await writeAuditLogs([{...meta,action:"exits.resignation.submitted",entityType:"Resignation",entityId:made.id,after:{employeeId:c.employeeId,requestedLastDay:input.requestedLastDay}}],tx);
      return made;
    });
  }catch(error){
    if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2034"].includes(error.code)){
      const winner=await prisma.resignation.findUnique({where:{employeeId_idempotencyKey:{employeeId:c.employeeId,idempotencyKey:input.idempotencyKey}}});
      if(winner&&winner.requestHash===hash)return getResignation(winner.id,actor);
      throw new HttpError(409,"You already have an active resignation.","ACTIVE_RESIGNATION");
    }throw error;
  }
  await tellExit(c.employeeId,{type:"exits.submitted",title:"Resignation submitted",body:"A resignation is waiting for an authorized decision.",resignationId:row.id});
  if(!(await currentManager(c.employeeId)))for(const d of await activeDirectors())await notifyEmployee(d.employeeId,{type:"exits.no_manager",title:"Resignation: no manager",body:"A resignation without an active manager is waiting in the directors' queue.",link:"/admin/exits",payload:{resignationId:row.id}});
  return getResignation(row.id,actor);
}
export async function getResignation(id:string,actor:ExitActor) {
  const c=await exitContext(actor);const row=await load(id,c);
  if(row.exitCase)await syncCase(row.exitCase.id);
  return projection(await load(id,c));
}
export async function mine(actor:ExitActor) {
  await exitContext(actor);
  await syncWhere({employeeId:actor.employeeId});
  const rows=await prisma.resignation.findMany({where:{employeeId:actor.employeeId},include,orderBy:{submittedAt:"desc"}});
  return rows.map(projection);
}
export async function list(actor:ExitActor,query:z.infer<typeof listSchema>) {
  const c=await exitContext(actor);
  if(!c.manage&&!c.manager)throw new HttpError(403,"Exit case access is not enabled.","FORBIDDEN");
  const scope=resignationWhere(c);await syncWhere(scope);
  const where={AND:[scope,...(query.status?[{status:query.status}]:[])]};
  const [total,rows]=await Promise.all([prisma.resignation.count({where}),prisma.resignation.findMany({where,include,orderBy:{submittedAt:"desc"},skip:(query.page-1)*query.pageSize,take:query.pageSize})]);
  return {total,items:rows.map(projection),page:query.page,pageSize:query.pageSize};
}
export async function accept(id:string,actor:ExitActor,input:z.infer<typeof acceptSchema>,meta:ExitMeta) {
  const c=await exitContext(actor);const initial=await load(id,c);
  if(!await mayAccept(c,initial.employeeId))throw new HttpError(403,"You cannot accept this resignation.","FORBIDDEN");
  const lastDay=new Date(input.lastWorkingDay);
  if(lastDay<businessDateOf(initial.submittedAt))throw new HttpError(400,"The agreed last day cannot be before submission.","VALIDATION_ERROR");
  const second=await choiceMode("EXIT_APPROVAL")==="SECOND_DIRECTOR";
  let noticeId:string|null=null;
  const result=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.exits.resignation'),hashtext(${id}))::text`;
    const r=await tx.resignation.findUniqueOrThrow({where:{id},include:{exitCase:{include:{separation:true}}}});
    if(r.status==="ACCEPTED"&&r.exitCase)return {caseId:r.exitCase.id,waiting:false,created:false};
    if(r.status!=="SUBMITTED")throw new HttpError(409,"This resignation is no longer waiting for acceptance.","CONFLICT");
    if(second){
      if(!c.director)throw new HttpError(409,"The optional exit approval check is on. A director must decide this request.","DIRECTOR_APPROVAL_REQUIRED");
      if(!r.approvalByUserId){
        await tx.resignation.update({where:{id},data:{approvalByUserId:c.userId,approvalLastDay:lastDay,changedByUserId:c.userId}});
        await tx.exitHistory.create({data:{resignationId:id,entityType:"resignations",entityId:id,event:"OPTIONAL_APPROVAL_REQUESTED",actorUserId:c.userId}});
        noticeId=(await recordDirectorNotice({kind:"ACTION",step:"EXIT_APPROVAL",subjectType:"Resignation",subjectId:id,subjectLabel:"An optional exit approval is waiting for the other director",actorUserId:c.userId},tx)).noticeId;
        return {caseId:null,waiting:true,created:false};
      }
      if(r.approvalByUserId===c.userId)return {caseId:null,waiting:true,created:false};
      if(r.approvalLastDay?.getTime()!==lastDay.getTime())throw new HttpError(409,"The agreed date differs from the pending proposal. Reload it first.","CONFLICT");
    }
    const marker=`PEEPS-RESIGNATION:${id}`;
    // The core writer is deliberately unchanged and owns its transaction.
    // Adopt only this exact operation after an interrupted link, never another separation.
    let separation=await prisma.separation.findFirst({where:{employeeId:r.employeeId,notes:marker},orderBy:{initiatedAt:"asc"}});
    if(!separation)separation=await initiateSeparation(r.employeeId,{lastWorkingDate:input.lastWorkingDay,reason:"Accepted resignation",notes:marker},meta);
    await tx.resignation.update({where:{id},data:{status:"ACCEPTED",acceptedAt:new Date(),acceptedByUserId:c.userId,changedByUserId:c.userId,decisionNote:input.note??null}});
    const exitCase=await tx.exitCase.create({data:{resignationId:id,separationId:separation.id,observedLastDay:separation.lastWorkingDate,changedByUserId:c.userId}});
    await writeAuditLogs([{...meta,action:"exits.resignation.accepted",entityType:"Resignation",entityId:id,after:{caseId:exitCase.id,separationId:separation.id,lastWorkingDay:dateOnly(separation.lastWorkingDate)}}],tx);
    if(c.director)noticeId=(await recordDirectorNotice({kind:"ACTION",step:"EXIT_APPROVAL",subjectType:"ExitCase",subjectId:exitCase.id,subjectLabel:"A resignation was accepted",actorUserId:c.userId,authority:second?"SECOND_DIRECTOR":"DIRECTOR_AUTHORITY"},tx)).noticeId;
    return {caseId:exitCase.id,waiting:false,created:true};
  },{timeout:30000});
  await scheduleDelivery(noticeId);
  if(result.caseId&&result.created){await syncCase(result.caseId);await tellExit(initial.employeeId,{type:"exits.accepted",title:"Resignation accepted",body:"The agreed last day is recorded in your exit case.",caseId:result.caseId});}
  return {caseId:result.caseId,waiting:result.waiting};
}
export async function decide(id:string,actor:ExitActor,kind:"REJECTED"|"WITHDRAWN",note:string,meta:ExitMeta) {
  const c=await exitContext(actor);const row=await load(id,c);
  if(kind==="WITHDRAWN"){if(row.employeeId!==c.employeeId)throw absent();}
  else{
    if(!await mayAccept(c,row.employeeId))throw new HttpError(403,"You cannot reject this resignation.","FORBIDDEN");
    if(!(await requiredSetting("rejectAllowed")).allowed)throw new HttpError(409,"The director's rule does not allow rejecting resignations.","REJECTION_NOT_ALLOWED");
  }
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.exits.resignation'),hashtext(${id}))::text`;
    const changed=await tx.resignation.updateMany({where:{id,status:"SUBMITTED"},data:{status:kind,active:false,decisionNote:note,changedByUserId:c.userId}});
    if(!changed.count)throw new HttpError(409,"Only a submitted resignation can be changed.","CONFLICT");
    await writeAuditLogs([{...meta,action:`exits.resignation.${kind.toLowerCase()}`,entityType:"Resignation",entityId:id,after:{status:kind}}],tx);
  });
  await tellExit(row.employeeId,{type:"exits.decided",title:"Resignation updated",body:`The resignation is ${kind.toLowerCase()}.`,resignationId:id});
  return getResignation(id,actor);
}
export async function getCase(id:string,actor:ExitActor) {
  const c=await exitContext(actor);
  let exitCase=await prisma.exitCase.findFirst({where:{id,resignation:resignationWhere(c)},include:{resignation:{include},separation:true}});
  if(!exitCase)throw new HttpError(404,"Exit case not found.","NOT_FOUND");
  await syncCase(id);
  exitCase=await prisma.exitCase.findUniqueOrThrow({where:{id},include:{resignation:{include},separation:true}});
  return {id:exitCase.id,status:exitCase.status,resignation:projection(exitCase.resignation),lastWorkingDay:dateOnly(exitCase.separation.lastWorkingDate),separationStatus:exitCase.separation.status,canManage:await managesEmployee(c,exitCase.resignation.employeeId),canAccept:await mayAccept(c,exitCase.resignation.employeeId),isOwn:exitCase.resignation.employeeId===c.employeeId,isDirector:c.director};
}
