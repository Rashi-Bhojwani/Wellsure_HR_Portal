import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { exitContext, resignationWhere } from "./access";
import { interviewWhere } from "./interviews";
import { itemOwner } from "./clearance";
async function audience(userId?:string){
  if(!userId)return null;
  const user=await prisma.user.findUnique({where:{id:userId},select:{employeeId:true,status:true}});
  if(!user||user.status!=="ACTIVE")return null;
  const access=await resolveAccess(userId);if(access.roleCodes.includes("DEVELOPER"))return null;
  const c=await exitContext({userId,employeeId:user.employeeId,...access});
  const resignations=await prisma.resignation.findMany({where:resignationWhere(c),select:{id:true,exitCase:{select:{id:true}}}});
  const interviews=await prisma.exitInterview.findMany({where:interviewWhere(c),select:{id:true}});
  return {c,resignationIds:resignations.map(r=>r.id),caseIds:resignations.flatMap(r=>r.exitCase?[r.exitCase.id]:[]),interviewIds:interviews.map(i=>i.id)};
}
export async function exitNotificationAudienceWhere(userId:string):Promise<Prisma.NotificationWhereInput>{
  const a=await audience(userId);
  const other={NOT:{type:{startsWith:"exits."}}};
  if(!a)return other;
  const ownerCases:string[]=[];
  if(!a.c.hr||a.c.director||a.c.hrOn){
    const items=await prisma.exitChecklistItem.findMany({where:{exitCase:{status:{not:"CLOSED"}},OR:[{ownerEmployeeIds:{has:a.c.employeeId}},{ownerTeam:"MANAGER",exitCase:{resignation:{employeeId:{in:a.c.teamIds}}}}]},include:{exitCase:{select:{resignation:{select:{employeeId:true}}}}}});
    for(const i of items)if(await itemOwner(a.c,i,i.exitCase.resignation.employeeId))ownerCases.push(i.caseId);
  }
  return {OR:[other,
    ...a.interviewIds.map(id=>({type:{startsWith:"exits.interview."},payload:{path:["interviewId"],equals:id}})),
    ...a.resignationIds.map(id=>({type:{startsWith:"exits.",not:{startsWith:"exits.interview."}},payload:{path:["resignationId"],equals:id}})),
    ...a.caseIds.map(id=>({type:{startsWith:"exits.",not:{startsWith:"exits.interview."}},payload:{path:["caseId"],equals:id}})),
    ...ownerCases.map(id=>({type:"exits.clearance.assigned",payload:{path:["caseId"],equals:id}}))]};
}
export async function exitAuditAudienceWhere(userId?:string):Promise<Prisma.AuditLogWhereInput>{
  const other={NOT:{OR:[{entityType:{startsWith:"Exit"}},{entityType:"Resignation"}]}};
  const a=await audience(userId);if(!a)return other;
  if(a.c.director)return {};
  return {OR:[other,{entityType:"ExitInterview",entityId:{in:a.interviewIds}},{entityType:"Resignation",entityId:{in:a.resignationIds}},{entityType:"ExitCase",entityId:{in:a.caseIds}}]};
}
