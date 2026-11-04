import { PEEPS_LEAVE_TYPE_CODES } from "@shared/constants/peepsLeave";
import { updateLeaveType } from "../leave/leaveTypes";
import { randomUUID } from "node:crypto";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { appointManager } from "../managers/service";
import { setOverride } from "../access/service";
import { updateJob } from "../employee/service";
import { setExitSetting, createTemplate } from "./settings";
import { submit, accept } from "./resignations";
import { start } from "./clearance";
import { schedule, answer } from "./interviews";
// Fictional, explicitly chosen DEMO data only. Never fills a real environment's settings.
export const DEMO_EXIT_ANSWER="DEMO-C3-PRIVATE-INTERVIEW";
export async function seedDemoExits(who:Record<string,{employeeId:string;userId:string}>){
  if((await prisma.systemSetting.findUnique({where:{key:"demo.company"}}))?.value!==true)throw new Error("Exit demo requires the labelled DEMO company.");
  // The earlier leave demo creates a historical request. The checkpoint
  // explicitly leaves all four prepared types off, including in the DEMO stack.
  for(const type of await prisma.leaveType.findMany({where:{code:{in:[...PEEPS_LEAVE_TYPE_CODES]},isActive:true},select:{id:true}}))await updateLeaveType(type.id,{isActive:false},{actorUserId:who.DEMO001!.userId});
  if(await prisma.exitSettingVersion.count()||await prisma.resignation.count())return;
  const director=who.DEMO001!,employee=who.DEMO006!,manager=who.DEMO009!;
  const meta={actorUserId:director.userId};
  const actor=async(p:typeof director)=>({userId:p.userId,employeeId:p.employeeId,...await resolveAccess(p.userId)});
  const set=(key:Parameters<typeof setExitSetting>[0],value:unknown)=>setExitSetting(key,{value,version:0,reason:"DEMO COMPANY: fictional chosen exit rule"},meta);
  await set("reasonCategories",[{code:"DEMO_MOVING_ON",label:"DEMO moving on"}]);
  await set("noticeRules",[{employmentType:"PERMANENT",gradeId:null,days:30,basis:"CALENDAR_DAYS",countFrom:"NEXT_DAY",sourceNote:"DEMO rule only; no legal claim"}]);
  await set("rejectAllowed",{allowed:false});await set("officeAudience",{officeManages:false});
  await set("interviewQuestions",[{id:"DEMO_FEEDBACK",label:"DEMO exit feedback question",required:true}]);
  await set("interviewRetention",{days:60});await set("overdueThresholds",{clearanceDays:7});
  const today=businessToday().toISOString().slice(0,10);
  const directorActor=await actor(director);
  if(!(await actor(manager)).roleCodes.includes("MANAGER"))await appointManager(manager.employeeId,{effectiveFrom:today},meta,directorActor);
  await setOverride(manager.employeeId,"exits.accept",{effect:"GRANT",reason:"DEMO COMPANY exit acceptor"},directorActor,meta);
  await updateJob(employee.employeeId,{reportingManagerId:manager.employeeId,effectiveFrom:today,changeReason:"DEMO COMPANY exit team"},meta);
  await createTemplate({name:"DEMO exit clearance",items:[{code:"DEMO_ADMIN",label:"DEMO administrative handover",required:true,ownerTeam:"ADMIN",ownerEmployeeIds:[who.DEMO008!.employeeId]}],assetOwner:{ownerTeam:"MANAGER",ownerEmployeeIds:[]},reason:"DEMO COMPANY explicit owners"},meta);
  const lastDay=addCalendarDays(businessToday(),30).toISOString().slice(0,10);
  const r=await submit(await actor(employee),{requestedLastDay:lastDay,reasonCategory:"DEMO_MOVING_ON",reason:"DEMO-C3-RESIGNATION: fictional resignation",idempotencyKey:randomUUID()},{actorUserId:employee.userId});
  const a=await accept(r.id,await actor(director),{lastWorkingDay:lastDay},meta);if(!a.caseId)throw new Error("DEMO exit acceptance unexpectedly waits.");
  await start(a.caseId,await actor(director),meta);
  const interview=await schedule(a.caseId,await actor(director),{interviewerEmployeeId:who.DEMO004!.employeeId,scheduledAt:addCalendarDays(businessToday(),1).toISOString(),reason:"DEMO COMPANY named interviewer"},meta);
  await answer(interview.id,await actor(employee),{DEMO_FEEDBACK:DEMO_EXIT_ANSWER},{actorUserId:employee.userId});
}
