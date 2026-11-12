import { changed } from "./signals";
import * as retention from "./retention";
import * as mail from "./mail";
import * as interviews from "./interviews";
import { inForceOn } from "../../lib/effectiveDating";
import * as candidates from "./candidates";
import { memoryUpload } from "../../lib/uploads";
import * as jobs from "./jobs";
import { HttpError } from "../../middleware/errorHandler";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { context, metaOf, requireManagement, requireUser } from "./access";
import * as settings from "./settings";
export const recruitmentRouter=Router();
recruitmentRouter.use(authenticate,requireUser);
export const empty=z.object({}).strict();
export const idSchema=z.object({id:z.string().min(1).max(100)}).strict();
recruitmentRouter.get("/status",validate({query:empty}),async(req,res)=>{const c=await context(req.user!);res.json({canManage:c.manage,canRaise:c.canRaise,canReadRequisitions:c.manage||c.manager,isDirector:c.isDirector});});
recruitmentRouter.get("/settings",validate({query:empty}),async(req,res)=>{res.json(await settings.view(req.user!.userId));});
recruitmentRouter.put("/settings/:key",validate({params:z.object({key:settings.keySchema}),body:settings.settingInput}),async(req,res)=>{res.json(await settings.set(req.params.key as settings.SettingKey,req.body,metaOf(req)));});
recruitmentRouter.get("/pipelines",validate({query:empty}),async(req,res)=>{await requireManagement(req.user!);res.json((await prisma.recruitmentPipeline.findMany({include:{stages:{orderBy:{position:"asc"}}},orderBy:{version:"desc"}})).map(p=>({...p,isDefault:p.version===0&&p.changedByUserId===settings.DEFAULT_PIPELINE_USER})));});
recruitmentRouter.post("/pipelines",validate({body:settings.pipelineInput}),async(req,res)=>{res.status(201).json(await settings.createPipeline(req.body,metaOf(req)));});

recruitmentRouter.get("/requisitions",validate({query:empty}),async(req,res)=>{res.json(await jobs.listRequisitions(req.user!));});
recruitmentRouter.post("/requisitions",validate({body:jobs.requisitionInput}),async(req,res)=>{res.status(201).json(await changed(jobs.createRequisition(req.user!,req.body,metaOf(req)),row=>({requisitionId:row.id})));});
recruitmentRouter.get("/requisitions/:id",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await jobs.getRequisition(req.params.id as string,req.user!));});
recruitmentRouter.post("/requisitions/:id/submit",validate({params:idSchema,body:empty}),async(req,res)=>{res.json(await changed(jobs.submitRequisition(req.params.id as string,req.user!,metaOf(req)),row=>({requisitionId:row.id})));});
recruitmentRouter.post("/requisitions/:id/decision",validate({params:idSchema,body:jobs.decisionInput}),async(req,res)=>{res.json(await changed(jobs.decideRequisition(req.params.id as string,req.user!,req.body,metaOf(req)),row=>({requisitionId:row.id})));});
recruitmentRouter.post("/requisitions/:id/close",validate({params:idSchema,body:z.object({reason:z.string().trim().min(1).max(2000)}).strict()}),async(req,res)=>{res.json(await changed(jobs.closeRequisition(req.params.id as string,req.user!,req.body.reason,metaOf(req)),row=>({requisitionId:row.id})));});
recruitmentRouter.get("/jobs",validate({query:jobs.listInput}),async(req,res)=>{res.json(await jobs.listJobs(req.user!,req.query as never));});
recruitmentRouter.post("/jobs",validate({body:jobs.jobInput}),async(req,res)=>{res.status(201).json(await changed(jobs.createJob(req.user!,req.body,metaOf(req)),row=>({requisitionId:row.requisitionId??undefined})));});
recruitmentRouter.get("/jobs/:id",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await jobs.getJob(req.params.id as string,req.user!));});
recruitmentRouter.post("/jobs/:id/state",validate({params:idSchema,body:jobs.jobStateInput}),async(req,res)=>{res.json(await changed(jobs.changeJob(req.params.id as string,req.user!,req.body,metaOf(req)),row=>({requisitionId:row.requisitionId??undefined})));});
recruitmentRouter.get("/options",validate({query:empty}),async(req,res)=>{const c=await context(req.user!);if(!c.manage&&!c.manager)throw new HttpError(403,"Recruitment options are unavailable.","FORBIDDEN");const [departments,locations]=await Promise.all([prisma.department.findMany({select:{id:true,name:true},orderBy:{name:"asc"}}),prisma.location.findMany({select:{id:true,name:true},orderBy:{name:"asc"}})]);const operational=c.manage?{sources:await settings.getSetting("sources"),rejectionReasons:await settings.getSetting("rejectionReasons"),cvUploads:await settings.getSetting("cvUploads"),emailTemplates:await settings.getSetting("emailTemplates"),scorecardSet:(await settings.getSetting("scorecard"))!==null,retentionSet:(await settings.getSetting("retention"))!==null,interviewRounds:await settings.getSetting("interviewRounds")}:{};res.json({departments,locations,...operational});});

recruitmentRouter.get("/candidates",validate({query:candidates.candidateListInput}),async(req,res)=>{res.json(await candidates.listCandidates(req.user!,req.query as never));});
recruitmentRouter.post("/candidates",validate({body:candidates.candidateInput}),async(req,res)=>{res.status(201).json(await changed(candidates.createCandidate(req.user!,req.body,metaOf(req)),row=>({candidateId:row.id})));});
recruitmentRouter.get("/candidates/:id",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await candidates.getCandidate(req.params.id as string,req.user!));});
recruitmentRouter.post("/candidates/:id/cv",async(req,_res,next)=>{await requireManagement(req.user!);next();},validate({params:idSchema}),memoryUpload(25),async(req,res)=>{res.json(await changed(candidates.uploadCv(req.params.id as string,req.user!,req.file,metaOf(req)),row=>({candidateId:row.id})));});
recruitmentRouter.get("/candidates/:id/cv",validate({params:idSchema,query:empty}),async(req,res)=>{const object=await candidates.downloadCv(req.params.id as string,req.user!,metaOf(req));res.setHeader("Content-Type",object.contentType);const extension=({"application/pdf":".pdf","image/jpeg":".jpg","image/png":".png","application/vnd.openxmlformats-officedocument.wordprocessingml.document":".docx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":".xlsx"} as Record<string,string>)[object.contentType]??"";res.setHeader("Content-Disposition",`attachment; filename="candidate-cv${extension}"`);res.setHeader("X-Content-Type-Options","nosniff");res.send(object.body);});
recruitmentRouter.post("/candidates/:id/applications",validate({params:idSchema,body:candidates.applyInput}),async(req,res)=>{res.status(201).json(await changed(candidates.apply(req.params.id as string,req.user!,req.body,metaOf(req)),row=>({candidateId:row.candidateId})));});
recruitmentRouter.get("/applications/:id",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await candidates.getApplication(req.params.id as string,req.user!));});
recruitmentRouter.post("/applications/:id/stage",validate({params:idSchema,body:candidates.moveInput}),async(req,res)=>{res.json(await changed(candidates.move(req.params.id as string,req.user!,req.body,metaOf(req)),row=>({candidateId:row.candidate.id})));});
recruitmentRouter.post("/applications/:id/decision",validate({params:idSchema,body:candidates.endInput}),async(req,res)=>{res.json(await changed(candidates.endApplication(req.params.id as string,req.user!,req.body,metaOf(req)),row=>({candidateId:row.candidate.id})));});

recruitmentRouter.get("/interviews",validate({query:interviews.interviewListInput}),async(req,res)=>{res.json(await interviews.listInterviews(req.user!,req.query as never));});
recruitmentRouter.post("/applications/:id/interviews",validate({params:idSchema,body:interviews.scheduleInput}),async(req,res)=>{res.status(201).json(await interviews.schedule(req.params.id as string,req.user!,req.body,metaOf(req)));});
recruitmentRouter.get("/interviews/:id",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await interviews.getInterview(req.params.id as string,req.user!));});
recruitmentRouter.put("/interviews/:id/schedule",validate({params:idSchema,body:interviews.scheduleInput}),async(req,res)=>{res.json(await interviews.reschedule(req.params.id as string,req.user!,req.body,metaOf(req)));});
recruitmentRouter.get("/interviews/:id/feedback",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await interviews.getFeedback(req.params.id as string,req.user!,metaOf(req)));});
recruitmentRouter.post("/interviews/:id/feedback",validate({params:idSchema,body:interviews.feedbackInput}),async(req,res)=>{res.status(201).json(await interviews.submitFeedback(req.params.id as string,req.user!,req.body,metaOf(req)));});
recruitmentRouter.get("/panel-options",validate({query:z.object({q:z.string().trim().max(100).default("")}).strict()}),async(req,res)=>{await requireManagement(req.user!);const q=req.query.q as string;const rows=await prisma.employee.findMany({where:{status:"ACTIVE",user:{status:"ACTIVE",roles:{none:{role:{code:"DEVELOPER"}}}},OR:[{employeeCode:{contains:q,mode:"insensitive"}},{nameHistory:{some:{...inForceOn(),fullName:{contains:q,mode:"insensitive"}}}}]},select:{id:true,employeeCode:true,nameHistory:{where:inForceOn(),select:{fullName:true}}},take:50,orderBy:{employeeCode:"asc"}});res.json(rows.map(r=>({id:r.id,employeeCode:r.employeeCode,name:r.nameHistory[0]?.fullName??r.employeeCode})));});

recruitmentRouter.get("/candidates/:id/mails",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await mail.listMail(req.params.id as string,req.user!));});
recruitmentRouter.post("/candidates/:id/mail",validate({params:idSchema,body:mail.mailInput}),async(req,res)=>{res.status(201).json(await mail.sendMail(req.params.id as string,req.user!,req.body,metaOf(req)));});

recruitmentRouter.post("/candidates/:id/erase",validate({params:idSchema,body:retention.eraseInput}),async(req,res)=>{res.json(await retention.eraseCandidate(req.params.id as string,req.user!,metaOf(req)));});

recruitmentRouter.get("/jobs/:id/board",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await jobs.board(req.params.id as string,req.user!));});
