import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { currentManager, exitContext, managesEmployee, resignationWhere, type ExitActor, type ExitContext, type ExitMeta } from "./access";
import { getCase, syncCase, tellExit } from "./resignations";
import { latestTemplate, requiredSetting, templateSchema } from "./settings";
import { notifyEmployee } from "../notifications/notifyEmployee";
export const completeSchema=z.object({note:z.string().trim().max(2000).optional()}).strict();
export const readySchema=z.object({overrideReason:z.string().trim().min(1).max(2000).optional()}).strict();
export type Blockers={started:boolean;requiredItemIds:string[];assignmentIds:string[]};
export async function blockers(caseId:string,db:Prisma.TransactionClient=prisma):Promise<Blockers>{
  const [row]=await db.$queryRaw<{blockers:Blockers}[]>`SELECT peeps_exit_blockers(${caseId}) AS blockers`;
  if(!row?.blockers)throw new HttpError(404,"Exit case not found.","NOT_FOUND");return row.blockers;
}
export const blocked=(b:Blockers)=>!b.started||b.requiredItemIds.length>0||b.assignmentIds.length>0;
export async function lockCase(tx:Prisma.TransactionClient,id:string){await tx.$queryRaw`SELECT id FROM exit_cases WHERE id=${id} FOR UPDATE`;}
export async function requireCaseManager(caseId:string,actor:ExitActor){
  const c=await exitContext(actor);await getCase(caseId,actor);
  const row=await prisma.exitCase.findUniqueOrThrow({where:{id:caseId},include:{resignation:true,separation:true}});
  if(!await managesEmployee(c,row.resignation.employeeId))throw new HttpError(403,"Exit management is not enabled for this person.","FORBIDDEN");
  return {c,row};
}
export async function itemOwner(c:ExitContext,item:{ownerTeam:string;ownerEmployeeIds:string[]},employeeId:string){
  if(c.hr&&!c.director&&!c.hrOn)return false;
  return item.ownerTeam==="MANAGER"?(await currentManager(employeeId))?.employeeId===c.employeeId:item.ownerEmployeeIds.includes(c.employeeId);
}
export async function start(caseId:string,actor:ExitActor,meta:ExitMeta){
  const {row}=await requireCaseManager(caseId,actor);
  const template=await latestTemplate();if(!template)throw new HttpError(409,"Exits: checklist template is Not set. A director must choose it first.","EXITS_NOT_SET");
  const parsed=templateSchema.parse({...template,reason:template.reason});
  await prisma.$transaction(async tx=>{
    await lockCase(tx,caseId);const current=await tx.exitCase.findUniqueOrThrow({where:{id:caseId}});
    if(current.status==="CLOSED")throw new HttpError(409,"This exit case is closed.","CONFLICT");
    if(current.templateId)return;
    const assets=await tx.assetAssignment.findMany({where:{employeeId:row.resignation.employeeId,endedAt:null},include:{asset:true},orderBy:{id:"asc"}});
    await tx.exitChecklistItem.createMany({data:[...parsed.items.map(i=>({caseId,...i})),...assets.map(a=>({caseId,code:`asset:${a.id}`,label:`Return asset #${a.asset.number}: ${a.asset.name}`,required:true,assetAssignmentId:a.id,...parsed.assetOwner}))]});
    await tx.exitCase.update({where:{id:caseId},data:{templateId:template.id,status:"CLEARANCE",changedByUserId:actor.userId}});
    await writeAuditLogs([{...meta,action:"exits.clearance.started",entityType:"ExitCase",entityId:caseId,after:{templateId:template.id}}],tx);
  });
  const items=await prisma.exitChecklistItem.findMany({where:{caseId}});
  const manager=await currentManager(row.resignation.employeeId);
  for(const id of new Set(items.flatMap(i=>i.ownerTeam==="MANAGER"?(manager?[manager.employeeId]:[]):i.ownerEmployeeIds))){
    // Owners get only an item task, never the resignation or interview.
    const user=await prisma.user.findUnique({where:{employeeId:id}});if(!user)continue;
    const {resolveAccess}=await import("../../lib/permissions");const access=await resolveAccess(user.id);
    if(access.roleCodes.includes("DEVELOPER"))continue;
    const c=await exitContext({userId:user.id,employeeId:id,...access});
    if(await itemOwner(c,items.find(i=>i.ownerTeam==="MANAGER"?manager?.employeeId===id:i.ownerEmployeeIds.includes(id))!,row.resignation.employeeId))await notifyEmployee(id,{type:"exits.clearance.assigned",title:"Exit clearance task",body:"A checklist item is waiting for you in Tasks.",link:"/app/exits",payload:{caseId}});
  }
  await tellExit(row.resignation.employeeId,{type:"exits.clearance.started",title:"Clearance started",body:"The exit checklist is ready.",caseId});
  return board(caseId,actor);
}
export async function board(caseId:string,actor:ExitActor){
  const view=await getCase(caseId,actor);const c=await exitContext(actor);
  const row=await prisma.exitCase.findUniqueOrThrow({where:{id:caseId}});
  const items=await prisma.exitChecklistItem.findMany({where:{caseId},orderBy:{createdAt:"asc"}});
  return {caseId,status:row.status,started:row.templateId!==null,overrideReason:row.overrideReason,blockers:await blockers(caseId),items:await Promise.all(items.map(async i=>({id:i.id,code:i.code,label:i.label,ownerTeam:i.ownerTeam,required:i.required,doneAt:i.doneAt?.toISOString()??null,doneByUserId:i.doneByUserId,assetAssignmentId:i.assetAssignmentId,note:i.note,canComplete:row.status!=="CLOSED"&&(view.canManage||await itemOwner(c,i,view.resignation.employee.id))}))) };
}
export async function myItems(actor:ExitActor){
  const c=await exitContext(actor);if(c.hr&&!c.director&&!c.hrOn)return [];
  const rows=await prisma.exitChecklistItem.findMany({where:{doneAt:null,exitCase:{status:{not:"CLOSED"}},OR:[{ownerEmployeeIds:{has:c.employeeId}},{ownerTeam:"MANAGER",exitCase:{resignation:{employeeId:{in:c.teamIds}}}}]},include:{exitCase:{include:{resignation:{select:{employeeId:true}}}}},orderBy:{createdAt:"asc"}});
  const result=[];for(const i of rows){await syncCase(i.caseId);if(await itemOwner(c,i,i.exitCase.resignation.employeeId)&&(await prisma.exitCase.findUniqueOrThrow({where:{id:i.caseId}})).status!=="CLOSED")result.push({id:i.id,caseId:i.caseId,label:i.label,ownerTeam:i.ownerTeam,required:i.required,waitingSince:i.createdAt.toISOString()});}return result;
}
export async function complete(itemId:string,actor:ExitActor,note:string|undefined,meta:ExitMeta){
  const c=await exitContext(actor);
  const item=await prisma.exitChecklistItem.findUnique({where:{id:itemId},include:{exitCase:{include:{resignation:true}}}});
  if(!item||(!await managesEmployee(c,item.exitCase.resignation.employeeId)&&!await itemOwner(c,item,item.exitCase.resignation.employeeId)))throw new HttpError(404,"Checklist item not found.","NOT_FOUND");
  await syncCase(item.caseId);
  await prisma.$transaction(async tx=>{
    await lockCase(tx,item.caseId);const current=await tx.exitChecklistItem.findUniqueOrThrow({where:{id:itemId},include:{exitCase:true}});
    if(current.exitCase.status==="CLOSED")throw new HttpError(409,"This case is closed.","CONFLICT");
    if(current.doneAt)return;
    if(current.assetAssignmentId&&await tx.assetAssignment.count({where:{id:current.assetAssignmentId,endedAt:null}}))throw new HttpError(409,"Return or close the asset assignment in the asset register first.","ASSET_STILL_ASSIGNED");
    await tx.exitChecklistItem.update({where:{id:itemId},data:{doneAt:new Date(),doneByUserId:c.userId,note:note??null}});
    await tx.exitHistory.create({data:{resignationId:item.exitCase.resignationId,entityType:"exit_checklist_items",entityId:itemId,event:"ITEM_COMPLETED",actorUserId:c.userId}});
    await writeAuditLogs([{...meta,action:"exits.item.completed",entityType:"ExitCase",entityId:item.caseId,after:{itemId}}],tx);
  });
  return {id:itemId,done:true};
}
export async function ready(caseId:string,actor:ExitActor,input:z.infer<typeof readySchema>,meta:ExitMeta){
  const {c,row}=await requireCaseManager(caseId,actor);
  if(input.overrideReason&&!c.director)throw new HttpError(403,"Only a director may override clearance.","FORBIDDEN");
  await prisma.$transaction(async tx=>{
    await lockCase(tx,caseId);const current=await tx.exitCase.findUniqueOrThrow({where:{id:caseId}});
    if(current.status==="CLOSED")throw new HttpError(409,"This case is closed.","CONFLICT");
    const b=await blockers(caseId,tx);
    if(blocked(b)&&!input.overrideReason)throw new HttpError(409,"Required checklist items or assigned assets are still open.","EXIT_CLEARANCE_BLOCKED");
    if(!b.started)throw new HttpError(409,"Start clearance with a confirmed checklist template first.","EXITS_NOT_SET");
    await tx.exitCase.update({where:{id:caseId},data:{status:"READY_FOR_SETTLEMENT",changedByUserId:c.userId,...(input.overrideReason?{overrideReason:input.overrideReason,overrideByUserId:c.userId,overrideAt:new Date(),overrideFingerprint:JSON.stringify(b)}:{overrideReason:null,overrideByUserId:null,overrideAt:null,overrideFingerprint:null})}});
    await writeAuditLogs([{...meta,action:input.overrideReason?"exits.clearance.overridden":"exits.clearance.ready",entityType:"ExitCase",entityId:caseId,after:{blockers:b,...(input.overrideReason&&{reason:input.overrideReason})}}],tx);
  });
  await tellExit(row.resignation.employeeId,{type:"exits.clearance.ready",title:"Clearance ready",body:"The exit case is ready for the directors' next step.",caseId});return board(caseId,actor);
}
export async function overdue(actor:ExitActor){
  const c=await exitContext(actor);if(!c.manage)throw new HttpError(403,"Exit management is not enabled.","FORBIDDEN");
  const threshold=await requiredSetting("overdueThresholds");
  const rows=await prisma.exitChecklistItem.findMany({where:{doneAt:null,createdAt:{lte:new Date(Date.now()-threshold.clearanceDays*86400000)},exitCase:{status:"CLEARANCE",resignation:resignationWhere(c)}},select:{id:true,caseId:true,label:true,createdAt:true}});
  return rows.map(i=>({...i,createdAt:i.createdAt.toISOString()}));
}
