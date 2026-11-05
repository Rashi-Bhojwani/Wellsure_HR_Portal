import type { NextFunction, Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { capabilityState, switchRowsFor } from "../../lib/hrCapabilities";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { HttpError } from "../../middleware/errorHandler";
import type { AuthenticatedUser } from "../../middleware/types";
import { memberStateFor } from "../peeps/office";
import { getSetting } from "./settings";
export type Actor=AuthenticatedUser;
export type Meta={actorUserId:string;ipAddress?:string|null;userAgent?:string|null};
export const metaOf=(req:Request):Meta=>({actorUserId:req.user!.userId,ipAddress:req.ip,userAgent:req.headers["user-agent"]});
export const absent=()=>new HttpError(404,"Recruitment record not found.","NOT_FOUND");
export function requireUser(req:Request,_res:Response,next:NextFunction){if(req.user!.roleCodes.includes("DEVELOPER"))return next(new HttpError(403,"Recruitment is unavailable to Developer.","FORBIDDEN"));next();}
export async function director(userId:string){const a=await resolveAccess(userId);if(!a.isSuperAdmin||a.roleCodes.includes("DEVELOPER"))throw new HttpError(403,"Only a director can do this.","FORBIDDEN");}
export async function context(actor:Actor){
 const access=await resolveAccess(actor.userId);if(access.roleCodes.includes("DEVELOPER"))throw new HttpError(403,"Recruitment is unavailable to Developer.","FORBIDDEN");
 const isDirector=access.isSuperAdmin,hr=access.roleCodes.some(r=>(HR_ROLE_CODES as readonly string[]).includes(r));
 const hrOn=hr&&capabilityState(await switchRowsFor(actor.userId,access.roleCodes),"MANAGE_RECRUITMENT",actor.userId,access.roleCodes,new Date())==="ON";
 const member=await memberStateFor(actor.employeeId);
 const office=Boolean((!hr||hrOn)&&member?.capabilities.includes("MANAGE_RECRUITMENT")&&(await getSetting("officeAudience"))?.officeManages);
 const manage=isDirector||office||(hrOn&&access.permissions.has("recruitment.manage"));
 const manager=access.roleCodes.includes("MANAGER")&&(!hr||hrOn);
 const employeeScope=isDirector||office?{}:await buildEmployeeScopeWhere(actor.employeeId,access.dataScope);
 return {...actor,...access,isDirector,hr,hrOn,office,manage,manager,employeeScope,canRaise:isDirector||(manager&&access.permissions.has("recruitment.requisition.raise"))};
}
export type Context=Awaited<ReturnType<typeof context>>;
export function jobWhere(c:Context):Prisma.RecruitmentJobWhereInput{
 if(c.manage&&Object.keys(c.employeeScope).length===0)return {};
 return {OR:[...(c.manage?[{requisition:null},{requisition:{requester:c.employeeScope}}]:[]),...(c.manager?[{requisition:{requesterEmployeeId:c.employeeId}}]:[])]};
}
export async function requireManagement(actor:Actor){const c=await context(actor);if(!c.manage)throw new HttpError(403,"Recruitment management is unavailable.","FORBIDDEN");return c;}
export async function requireJob(id:string,c:Context){const row=await prisma.recruitmentJob.findFirst({where:{id,AND:[jobWhere(c)]}});if(!row)throw absent();return row;}
