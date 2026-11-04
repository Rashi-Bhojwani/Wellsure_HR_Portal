import { z } from "zod";
import type { ExitSettlementInputs } from "@shared/constants/peepsPayrollContract";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { activeDirectors } from "../../lib/directorAuthority";
import { HttpError } from "../../middleware/errorHandler";
import { getLeaveBalancesForEmployee } from "../leave/ledger";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { exitContext, requireExitDirector, type ExitActor, type ExitMeta } from "./access";
import { blockers, blocked, lockCase } from "./clearance";
import { getCase, noticeShortfall, syncCase, tellExit } from "./resignations";
export const closeSchema=z.object({note:z.string().trim().min(1).max(2000)}).strict();
export const letterSchema=z.object({kind:z.enum(["RELIEVING","EXPERIENCE"])}).strict();
export async function settlementInputs(caseId:string,actor:ExitActor):Promise<ExitSettlementInputs>{
  await exitContext(actor);await requireExitDirector(actor.userId);await syncCase(caseId);
  const row=await prisma.exitCase.findUnique({where:{id:caseId},include:{resignation:{include:{employee:{select:{id:true,employeeCode:true}}}},separation:true}});
  if(!row)throw new HttpError(404,"Exit case not found.","NOT_FOUND");
  const balances=await getLeaveBalancesForEmployee(prisma,row.resignation.employeeId,row.separation.lastWorkingDate);
  return {exitCaseId:row.id,employee:row.resignation.employee,lastWorkingDay:row.separation.lastWorkingDate.toISOString().slice(0,10),leaveBalanceDays:[...balances].sort(([a],[b])=>a.localeCompare(b)).map(([leaveTypeId,days])=>({leaveTypeId,days:days.toFixed(2)})),noticeShortfallDays:noticeShortfall(row.resignation,row.separation.lastWorkingDate),noticeRuleState:row.resignation.noticeRule?"CONFIRMED":"NOT_SET",clearanceComplete:!blocked(await blockers(caseId)),clearanceOverrideReason:row.overrideReason,
    // No recovery-intent model exists yet. Do not synthesize a debt from a loss.
    openAssetRecoveryIntentIds:[]};
}
async function closeCase(caseId:string,source:"DIRECTOR"|"SETTLEMENT_CALLBACK",note:string,meta:ExitMeta|{actorUserId:null}){
  await syncCase(caseId);
  const result=await prisma.$transaction(async tx=>{
    await lockCase(tx,caseId);const row=await tx.exitCase.findUnique({where:{id:caseId},include:{resignation:true}});
    if(!row)throw new HttpError(404,"Exit case not found.","NOT_FOUND");
    if(row.status==="CLOSED")return {employeeId:row.resignation.employeeId,changed:false};
    if(row.status!=="READY_FOR_SETTLEMENT")throw new HttpError(409,"Clearance must be ready before closing the case.","EXIT_CLEARANCE_BLOCKED");
    const b=await blockers(caseId,tx);
    if(blocked(b)&&(!row.overrideReason||!row.overrideByUserId||!row.overrideFingerprint||JSON.stringify(JSON.parse(row.overrideFingerprint))!==JSON.stringify(b)))throw new HttpError(409,"The clearance blockers changed. Review clearance again.","EXIT_CLEARANCE_BLOCKED");
    await tx.exitCase.update({where:{id:caseId},data:{status:"CLOSED",closedAt:new Date(),closeNote:note,closureSource:source,changedByUserId:meta.actorUserId}});
    await tx.resignation.update({where:{id:row.resignationId},data:{active:false,changedByUserId:meta.actorUserId}});
    await writeAuditLogs([{...meta,action:source==="DIRECTOR"?"exits.case.closed":"exits.settlement.completed",entityType:"ExitCase",entityId:caseId,after:{note,source}}],tx);
    return {employeeId:row.resignation.employeeId,changed:true};
  });
  if(result.changed)await tellExit(result.employeeId,{type:"exits.closed",title:"Exit case closed",body:"The directors have recorded the case closure.",caseId});
  return {exitCaseId:caseId,status:"CLOSED" as const};
}
export async function close(caseId:string,actor:ExitActor,note:string,meta:ExitMeta){await exitContext(actor);await requireExitDirector(actor.userId);return closeCase(caseId,"DIRECTOR",note,meta);}
/** Future settlement adapter hook. Deliberately not wired to payroll or HTTP. */
export async function onSettlementCompleted(exitCaseId:string){return closeCase(exitCaseId,"SETTLEMENT_CALLBACK","Settlement completion acknowledged by the internal adapter.",{actorUserId:null});}
export async function requestLetter(caseId:string,actor:ExitActor,kind:"RELIEVING"|"EXPERIENCE",meta:ExitMeta){
  const c=await exitContext(actor);const view=await getCase(caseId,actor);
  if(!view.isOwn&&!view.canManage)throw new HttpError(403,"Only the employee or an exit manager may request this letter.","FORBIDDEN");
  const result=await prisma.$transaction(async tx=>{
    await lockCase(tx,caseId);
    const prior=await tx.exitLetterRequest.findUnique({where:{caseId_kind:{caseId,kind}}});if(prior)return {row:prior,created:false};
    const row=await tx.exitLetterRequest.create({data:{caseId,kind,requestedByUserId:c.userId}});
    await writeAuditLogs([{...meta,action:"exits.letter.requested",entityType:"ExitCase",entityId:caseId,after:{kind,requestId:row.id}}],tx);return {row,created:true};
  });
  if(result.created)for(const d of await activeDirectors())await notifyEmployee(d.employeeId,{type:"exits.letter.requested",title:"Exit letter requested",body:"A relieving or experience letter request is waiting for the existing letters flow.",link:`/admin/exits/cases/${caseId}`,payload:{caseId}});
  return {id:result.row.id,caseId,kind:result.row.kind,requestedAt:result.row.requestedAt.toISOString()};
}
export async function letterRequests(caseId:string,actor:ExitActor){await getCase(caseId,actor);return (await prisma.exitLetterRequest.findMany({where:{caseId},orderBy:{requestedAt:"asc"}})).map(r=>({id:r.id,kind:r.kind,requestedAt:r.requestedAt.toISOString()}));}
