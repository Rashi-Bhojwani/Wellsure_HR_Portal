import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { activeUsersHoldingPermission, resolveAccess } from "../../lib/permissions";
import { getSocketServer } from "../../realtime/emit";
import { context } from "./access";
export async function signalRecruitment(scope:{candidateId?:string;requisitionId?:string;access?:boolean}={}){
 const holders=await activeUsersHoldingPermission('recruitment.manage');const managers=await Promise.all(holders.map(async u=>{const c=await context({userId:u.userId,employeeId:u.employeeId,...await resolveAccess(u.userId)});return c.manage?u.employeeId:null;}));
 const related:string[]=[];
 if(scope.requisitionId){const row=await prisma.jobRequisition.findUnique({where:{id:scope.requisitionId},select:{requesterEmployeeId:true}});if(row)related.push(row.requesterEmployeeId);}
 if(scope.candidateId){const [panels,reqs]=await Promise.all([prisma.recruitmentInterviewPanel.findMany({where:{...(scope.access?{}:{active:true}),interview:{...(scope.access?{}:{status:{not:'CANCELLED'}}),application:{candidateId:scope.candidateId}}},select:{employeeId:true}}),prisma.jobRequisition.findMany({where:{job:{applications:{some:{candidateId:scope.candidateId}}}},select:{requesterEmployeeId:true}})]);related.push(...panels.map(p=>p.employeeId),...reqs.map(r=>r.requesterEmployeeId));}
 const ids=[...new Set([...managers.filter((id):id is string=>Boolean(id)),...related])];if(ids.length)getSocketServer()?.to(ids.map(id=>`user:${id}`)).emit(scope.access?'recruitment.access.changed':'recruitment.changed',{});
}
export async function changed<T>(work:Promise<T>,scope:(result:T)=>{candidateId?:string;requisitionId?:string}){const row=await work;try{await signalRecruitment(scope(row));}catch{logger.warn({event:'recruitment.refresh.pending'},'Recruitment refresh could not be delivered');}return row;}
