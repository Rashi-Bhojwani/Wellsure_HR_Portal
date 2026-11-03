import type { Request, Response } from "express";
import { lettersGenerateQueue } from "../../jobs/lettersQueue";
import type { ActorMeta, EnqueueLetter, LetterViewer } from "./service";
import { listStarters, loadStarter } from "./starters";
import * as wf from "./workflow";

// A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md): the letter workflow's handlers. The rules are in workflow.ts and starters.ts.
const viewer = (req: Request): LetterViewer => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, dataScope: req.user!.dataScope, permissions: req.user!.permissions });
const meta = (req: Request): ActorMeta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const id = (req: Request) => req.params.id as string;
// The same queue and job id as a letter issued directly (jobId = letter id: enqueueing twice is a no-op).
const enqueue: EnqueueLetter = async (letterId) => {
  await lettersGenerateQueue().add("generate", { letterId }, { jobId: letterId, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 1000 });
};

export const listStartersRoute = async (req: Request, res: Response) => void res.json({ starters: await listStarters(viewer(req)) });
export const loadStarterRoute = async (req: Request, res: Response) => void res.status(201).json(await loadStarter(req.params.code as string, viewer(req), meta(req)));
export const listGrantsRoute = async (req: Request, res: Response) => void res.json({ grants: await wf.listGrants(viewer(req)) });
export const createGrantRoute = async (req: Request, res: Response) => {
  const out = await wf.createGrant(req.body, viewer(req), meta(req));
  res.status(out.created ? 201 : 200).json(out);
};
export const revokeGrantRoute = async (req: Request, res: Response) => {
  await wf.revokeGrant(id(req), viewer(req), meta(req));
  res.status(204).send();
};
export const getSerialRoute = async (req: Request, res: Response) => void res.json({ serial: await wf.getSerial(viewer(req)) });
export const setSerialRoute = async (req: Request, res: Response) => void res.json({ serial: await wf.setSerial(req.body, viewer(req), meta(req)) });
export const preparableTemplatesRoute = async (req: Request, res: Response) => void res.json({ templates: await wf.preparableTemplates(viewer(req)) });
export const toSignRoute = async (req: Request, res: Response) => void res.json({ requests: await wf.toSign(viewer(req)) });
export const listRequestsRoute = async (req: Request, res: Response) => void res.json(await wf.listRequests(viewer(req), req.query as unknown as Parameters<typeof wf.listRequests>[1]));
export const prepareRoute = async (req: Request, res: Response) => {
  const out = await wf.prepare(req.body, viewer(req), meta(req));
  res.status(out.created > 0 ? 201 : 200).json(out);
};
export const getRequestRoute = async (req: Request, res: Response) => void res.json(await wf.getRequest(id(req), viewer(req)));
export const updateRequestRoute = async (req: Request, res: Response) => void res.json(await wf.updateRequest(id(req), req.body, viewer(req), meta(req)));
export const signRoute = async (req: Request, res: Response) => void res.json(await wf.sign(id(req), req.body.position, viewer(req), meta(req)));
export const issueRoute = async (req: Request, res: Response) => void res.json(await wf.issue(id(req), viewer(req), meta(req), enqueue));
export const voidRoute = async (req: Request, res: Response) => void res.json(await wf.voidRequest(id(req), req.body.reason, viewer(req), meta(req)));
export const previewRoute = async (req: Request, res: Response) => {
  const pdf = await wf.previewRequest(id(req), viewer(req));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="draft-letter.pdf"`);
  res.status(200).send(pdf);
};
