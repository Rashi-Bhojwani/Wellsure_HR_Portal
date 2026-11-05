import { Prisma } from "@prisma/client";
import { z } from "zod";
import { DOCUMENT_MIME_TYPES } from "@shared/constants/peopleDocuments";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { getSocketServer } from "../../realtime/emit";
import { activeUsersHoldingPermission } from "../../lib/permissions";
import { HttpError } from "../../middleware/errorHandler";
import { director, type Meta } from "./access";
export const code=z.string().trim().min(1).max(60).regex(/^[A-Z0-9_]+$/);
const catalogue=z.array(z.object({code,label:z.string().trim().min(1).max(200)}).strict()).min(1).refine(a=>new Set(a.map(i=>i.code)).size===a.length,"Codes must be unique.");
const question=z.object({id:code,label:z.string().trim().min(1).max(500),required:z.boolean()}).strict();
export const SETTING_SCHEMAS={
 officeAudience:z.object({officeManages:z.boolean()}).strict(),
 sources:catalogue,
 rejectionReasons:catalogue,
 approvalRoute:z.object({route:z.enum(["NONE","DIRECTOR"])}).strict(),
 retention:z.object({days:z.number().int().min(1).max(365000)}).strict(),
 scorecard:z.object({questions:z.array(question).min(1).refine(a=>new Set(a.map(q=>q.id)).size===a.length,"Question codes must be unique."),recommendations:catalogue}).strict(),
 cvUploads:z.object({maxMb:z.number().positive().max(25),allowedMimeTypes:z.array(z.enum(Object.keys(DOCUMENT_MIME_TYPES) as [keyof typeof DOCUMENT_MIME_TYPES,...(keyof typeof DOCUMENT_MIME_TYPES)[]])).min(1)}).strict(),
 emailTemplates:z.array(z.object({id:code,kind:z.enum(["INVITATION","REJECTION"]),subject:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(10000)}).strict()).min(1).refine(a=>new Set(a.map(t=>t.id)).size===a.length,"Template ids must be unique.").refine(a=>a.every(t=>![...`${t.subject} ${t.body}`.matchAll(/\{\{(.*?)\}\}/g)].some(m=>!["jobTitle","scheduledAt","round"].includes(m[1]!))),"Use only jobTitle, scheduledAt and round placeholders.").refine(a=>a.every(t=>!/(salary|compensation|\bctc\b|\binr\b|₹|\bbank\b|\baadhaar\b|feedback|recommendation)/i.test(t.subject+' '+t.body)),"Candidate templates cannot carry pay, identity or feedback content."),
} as const;
export type SettingKey=keyof typeof SETTING_SCHEMAS;
export const keySchema=z.enum(Object.keys(SETTING_SCHEMAS) as [SettingKey,...SettingKey[]]);
export const settingInput=z.object({value:z.unknown(),version:z.number().int().min(0),reason:z.string().trim().min(1).max(2000)}).strict();
export const pipelineInput=z.object({name:z.string().trim().min(1).max(150),stages:catalogue,reason:z.string().trim().min(1).max(2000)}).strict();
export const version=(key:SettingKey)=>prisma.recruitmentSettingVersion.findFirst({where:{key},orderBy:{version:"desc"}});
export async function getSetting<K extends SettingKey>(key:K):Promise<z.infer<(typeof SETTING_SCHEMAS)[K]>|null>{const row=await version(key);return row?.value==null?null:SETTING_SCHEMAS[key].parse(row.value) as z.infer<(typeof SETTING_SCHEMAS)[K]>;}
export async function required<K extends SettingKey>(key:K){const value=await getSetting(key);if(value===null)throw new HttpError(409,`Recruitment: ${key} is Not set. A director must choose it first.`,"RECRUITMENT_NOT_SET");return value;}
export async function view(userId:string){await director(userId);return Promise.all(Object.keys(SETTING_SCHEMAS).map(async key=>{const r=await version(key as SettingKey);return {key,state:r?.value==null?"NOT_SET":"CONFIRMED",version:r?.version??0,value:r?.value??null};}));}
export async function set(key:SettingKey,input:z.infer<typeof settingInput>,meta:Meta){
 await director(meta.actorUserId);const value=input.value===null?null:SETTING_SCHEMAS[key].parse(input.value);
 await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.recruitment.setting'),hashtext(${key}))::text`;
 const prior=await tx.recruitmentSettingVersion.findFirst({where:{key},orderBy:{version:"desc"}});if((prior?.version??0)!==input.version)throw new HttpError(409,"This setting changed. Reload before saving.","CONFLICT");
 const row=await tx.recruitmentSettingVersion.create({data:{key,version:input.version+1,value:value===null?Prisma.JsonNull:value,reason:input.reason,changedByUserId:meta.actorUserId}});
 await writeAuditLogs([{...meta,action:"recruitment.setting.confirmed",entityType:"RecruitmentSettingVersion",entityId:row.id,after:{key,version:row.version}}],tx);
 });
 const affected=await activeUsersHoldingPermission("recruitment.view");if(affected.length)getSocketServer()?.to(affected.map(u=>`user:${u.employeeId}`)).emit("recruitment.access.changed",{});
 return view(meta.actorUserId);
}
export async function createPipeline(input:z.infer<typeof pipelineInput>,meta:Meta){await director(meta.actorUserId);return prisma.$transaction(async tx=>{
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.recruitment.pipeline'))::text`;
 const last=await tx.recruitmentPipeline.findFirst({orderBy:{version:"desc"}});
 const row=await tx.recruitmentPipeline.create({data:{name:input.name,version:(last?.version??0)+1,changedByUserId:meta.actorUserId,stages:{create:input.stages.map((s,position)=>({...s,position}))}},include:{stages:{orderBy:{position:"asc"}}}});
 await writeAuditLogs([{...meta,action:"recruitment.pipeline.created",entityType:"RecruitmentPipeline",entityId:row.id,after:{version:row.version}}],tx);return row;
 });}
