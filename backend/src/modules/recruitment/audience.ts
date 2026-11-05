import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { context } from "./access";
import { candidateWhere } from "./candidates";
import { requisitionWhere } from "./jobs";
import { feedbackWhere, includeFor, interviewWhere, onPanel } from "./interviews";
import { jobWhere } from "./access";
async function audience(userId?:string){if(!userId)return null;const user=await prisma.user.findUnique({where:{id:userId},select:{employeeId:true,status:true}});if(!user||user.status!=="ACTIVE")return null;const access=await resolveAccess(userId);if(access.roleCodes.includes("DEVELOPER"))return null;return context({userId,employeeId:user.employeeId,...access});}
export async function recruitmentNotificationWhere(userId:string):Promise<Prisma.NotificationWhereInput>{const other={NOT:{type:{startsWith:"recruitment."}}};const c=await audience(userId);if(!c)return other;if(c.isDirector)return {};
 const panels=await prisma.recruitmentInterviewPanel.findMany({where:{employeeId:c.employeeId,active:true,interview:{status:{not:"CANCELLED"}}},select:{interviewId:true}});
 return {OR:[other,...panels.map(p=>({type:{startsWith:"recruitment.interview."},payload:{path:["interviewId"],equals:p.interviewId}}))]};}
export async function recruitmentAuditWhere(userId?:string):Promise<Prisma.AuditLogWhereInput>{const other={NOT:{OR:[{entityType:{startsWith:"Recruitment"}},{entityType:{in:["Candidate","JobRequisition","InterviewFeedback"]}}]}};const c=await audience(userId);if(!c)return other;if(c.isDirector)return {};
 const [candidates,jobs,reqs,interviews]=await Promise.all([
 prisma.candidate.findMany({where:candidateWhere(c),select:{id:true}}),prisma.recruitmentJob.findMany({where:jobWhere(c),select:{id:true}}),prisma.jobRequisition.findMany({where:requisitionWhere(c),select:{id:true}}),prisma.recruitmentInterview.findMany({where:interviewWhere(c),include:includeFor(c)})]);
 const feedbackIds:string[]=[],collections:string[]=[];
 for(const row of interviews){if(!onPanel(row,c.employeeId))continue;const own=feedbackWhere(c,row);const values=await prisma.interviewFeedback.findMany({where:own,select:{id:true}});feedbackIds.push(...values.map(f=>f.id));if(row.feedback.length)collections.push(row.id);}
 return {OR:[other,{entityType:"Candidate",entityId:{in:candidates.map(r=>r.id)}},{entityType:"RecruitmentJob",entityId:{in:jobs.map(r=>r.id)}},{entityType:"JobRequisition",entityId:{in:reqs.map(r=>r.id)}},{entityType:"RecruitmentInterview",entityId:{in:interviews.map(r=>r.id)}},{entityType:"InterviewFeedback",entityId:{in:feedbackIds}},{entityType:"RecruitmentFeedback",entityId:{in:collections}}]};}
