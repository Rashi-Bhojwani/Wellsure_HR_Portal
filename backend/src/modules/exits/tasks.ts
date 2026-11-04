import type { TaskSource } from "../tasks/service";
import { exitContext, mayAccept, resignationWhere } from "./access";
import { prisma } from "../../lib/prisma";
import { myItems } from "./clearance";
export const exitResignationTasks:TaskSource={type:"EXIT_RESIGNATION",async list(actor,limit){
  if(actor.roleCodes.includes("DEVELOPER"))return [];
  const c=await exitContext(actor);
  const rows=await prisma.resignation.findMany({where:{status:"SUBMITTED",AND:[resignationWhere(c)]},orderBy:{submittedAt:"asc"},select:{id:true,employeeId:true,submittedAt:true}});
  const result=[];for(const r of rows)if(await mayAccept(c,r.employeeId))result.push({type:"EXIT_RESIGNATION" as const,id:r.id,title:"Resignation decision",detail:null,employeeName:null,waitingSince:r.submittedAt.toISOString(),link:`/app/exits?resignation=${r.id}`,adminLink:`/admin/exits?resignation=${r.id}`});return result.slice(0,limit);
}};
export const exitClearanceTasks:TaskSource={type:"EXIT_CLEARANCE",async list(actor,limit){
  if(actor.roleCodes.includes("DEVELOPER"))return [];
  return (await myItems(actor)).slice(0,limit).map(i=>({type:"EXIT_CLEARANCE",id:i.id,title:i.label,detail:i.ownerTeam,employeeName:null,waitingSince:i.waitingSince,link:"/app/exits",adminLink:"/app/exits"}));
}};
