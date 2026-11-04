import { prisma } from "../../lib/prisma";
import { inForceOn } from "../../lib/effectiveDating";
import * as settlement from "./settlement";
import * as interviews from "./interviews";
import * as clearance from "./clearance";
import * as flow from "./resignations";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { exitContext, metaOf, requireExitDirector, requireExitUser } from "./access";
import * as settings from "./settings";

export const exitsRouter = Router();
exitsRouter.use(authenticate, requireExitUser);
const empty = z.object({}).strict();
export const idSchema = z.object({ id: z.string().min(1) });
exitsRouter.get("/status", validate({ query: empty }), async (req, res) => {
  const c=await exitContext(req.user!);
  const categories = await settings.getExitSetting("reasonCategories");
  res.json({ submitReady: categories !== null, reasonCategories: categories, canManage:c.manage, canReadTeam:c.manager, isDirector:c.director });
});
exitsRouter.get("/settings", requirePermission("exits.settings.manage"), validate({ query: empty }), async (req, res) => {
  res.json(await settings.settingsView(req.user!.userId));
});
exitsRouter.put("/settings/:key", requirePermission("exits.settings.manage"), validate({ params: z.object({ key: settings.settingKeySchema }), body: settings.settingInputSchema }), async (req, res) => {
  res.json(await settings.setExitSetting(req.params.key as settings.ExitSettingKey, req.body, metaOf(req)));
});
exitsRouter.get("/checklist-templates", requirePermission("exits.settings.manage"), validate({ query: empty }), async (req, res) => {
  await requireExitDirector(req.user!.userId);
  res.json(await settings.latestTemplate());
});
exitsRouter.post("/checklist-templates", requirePermission("exits.settings.manage"), validate({ body: settings.templateSchema }), async (req, res) => {
  res.status(201).json(await settings.createTemplate(req.body, metaOf(req)));
});

exitsRouter.post("/resignations", validate({ body: flow.submitSchema }), async (req,res)=>{res.status(201).json(await flow.submit(req.user!,req.body,metaOf(req)));});
exitsRouter.get("/resignations/mine",validate({query:empty}),async(req,res)=>{res.json(await flow.mine(req.user!));});
exitsRouter.get("/resignations",validate({query:flow.listSchema}),async(req,res)=>{res.json(await flow.list(req.user!,req.query as never));});
exitsRouter.get("/resignations/:id",validate({params:idSchema}),async(req,res)=>{res.json(await flow.getResignation(req.params.id as string,req.user!));});
exitsRouter.post("/resignations/:id/accept",validate({params:idSchema,body:flow.acceptSchema}),async(req,res)=>{res.json(await flow.accept(req.params.id as string,req.user!,req.body,metaOf(req)));});
exitsRouter.post("/resignations/:id/reject",validate({params:idSchema,body:flow.decisionSchema}),async(req,res)=>{res.json(await flow.decide(req.params.id as string,req.user!,"REJECTED",req.body.note,metaOf(req)));});
exitsRouter.post("/resignations/:id/withdraw",validate({params:idSchema,body:flow.decisionSchema}),async(req,res)=>{res.json(await flow.decide(req.params.id as string,req.user!,"WITHDRAWN",req.body.note,metaOf(req)));});
exitsRouter.get("/cases/:id",validate({params:idSchema}),async(req,res)=>{res.json(await flow.getCase(req.params.id as string,req.user!));});

exitsRouter.get("/clearance/mine",validate({query:empty}),async(req,res)=>{res.json(await clearance.myItems(req.user!));});
exitsRouter.get("/clearance/overdue",validate({query:empty}),async(req,res)=>{res.json(await clearance.overdue(req.user!));});
exitsRouter.get("/cases/:id/checklist",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await clearance.board(req.params.id as string,req.user!));});
exitsRouter.post("/cases/:id/checklist/start",validate({params:idSchema,body:empty}),async(req,res)=>{res.json(await clearance.start(req.params.id as string,req.user!,metaOf(req)));});
exitsRouter.post("/checklist-items/:id/complete",validate({params:idSchema,body:clearance.completeSchema}),async(req,res)=>{res.json(await clearance.complete(req.params.id as string,req.user!,req.body.note,metaOf(req)));});
exitsRouter.post("/cases/:id/ready",validate({params:idSchema,body:clearance.readySchema}),async(req,res)=>{res.json(await clearance.ready(req.params.id as string,req.user!,req.body,metaOf(req)));});

exitsRouter.get("/interviews",validate({query:empty}),async(req,res)=>{res.json(await interviews.list(req.user!,metaOf(req)));});
exitsRouter.post("/cases/:id/interview",validate({params:idSchema,body:interviews.scheduleSchema}),async(req,res)=>{res.status(201).json(await interviews.schedule(req.params.id as string,req.user!,req.body,metaOf(req)));});
exitsRouter.get("/interviews/:id",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await interviews.get(req.params.id as string,req.user!,metaOf(req)));});
exitsRouter.put("/interviews/:id/answers",validate({params:idSchema,body:interviews.answersSchema}),async(req,res)=>{res.json(await interviews.answer(req.params.id as string,req.user!,req.body.answers,metaOf(req)));});
exitsRouter.post("/interviews/:id/complete",validate({params:idSchema,body:empty}),async(req,res)=>{res.json(await interviews.complete(req.params.id as string,req.user!,metaOf(req)));});

exitsRouter.get("/cases/:id/settlement-inputs",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await settlement.settlementInputs(req.params.id as string,req.user!));});
exitsRouter.post("/cases/:id/close",validate({params:idSchema,body:settlement.closeSchema}),async(req,res)=>{res.json(await settlement.close(req.params.id as string,req.user!,req.body.note,metaOf(req)));});
exitsRouter.get("/cases/:id/letter-requests",validate({params:idSchema,query:empty}),async(req,res)=>{res.json(await settlement.letterRequests(req.params.id as string,req.user!));});
exitsRouter.post("/cases/:id/letter-requests",validate({params:idSchema,body:settlement.letterSchema}),async(req,res)=>{res.status(201).json(await settlement.requestLetter(req.params.id as string,req.user!,req.body.kind,metaOf(req)));});

exitsRouter.get("/owners",validate({query:z.object({q:z.string().trim().max(100).default("")}).strict()}),async(req,res)=>{
  await requireExitDirector(req.user!.userId);
  const q=req.query.q as string;
  const rows=await prisma.employee.findMany({where:{status:"ACTIVE",user:{status:"ACTIVE",roles:{none:{role:{code:"DEVELOPER"}}}},OR:[{employeeCode:{contains:q,mode:"insensitive"}},{nameHistory:{some:{...inForceOn(),fullName:{contains:q,mode:"insensitive"}}}}]},select:{id:true,employeeCode:true,nameHistory:{where:inForceOn(),select:{fullName:true}}},orderBy:{employeeCode:"asc"},take:50});
  res.json(rows.map(r=>({id:r.id,employeeCode:r.employeeCode,name:r.nameHistory[0]?.fullName??r.employeeCode})));
});
