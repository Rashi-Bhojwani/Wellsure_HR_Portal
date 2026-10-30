import type { Request, Response } from "express";
import { confirmChoice, listSwitches, proposeChoice, requireDirector } from "../../lib/directorAuthority";
import { acknowledgeNotice, listMyNotices, markNoticeSeen } from "../../lib/directorNotices";
import type { DirectorChoiceMode, DirectorStep } from "@shared/constants/directorAuthority";

const who = (req: Request) => req.user!.userId;

export async function getSwitches(req: Request, res: Response): Promise<void> {
  await requireDirector(who(req), "read the second-director checks");
  res.status(200).json({ switches: await listSwitches(who(req)) });
}
export async function putSwitch(req: Request, res: Response): Promise<void> {
  const result = await proposeChoice(req.params.step as DirectorStep, req.body.mode as DirectorChoiceMode, { userId: who(req), ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
  res.status(200).json({ ...result, switches: await listSwitches(who(req)) });
}
export async function confirmSwitch(req: Request, res: Response): Promise<void> {
  const result = await confirmChoice(req.params.step as DirectorStep, req.body.mode as DirectorChoiceMode, { userId: who(req), ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
  res.status(200).json({ ...result, switches: await listSwitches(who(req)) });
}
export async function getNotices(req: Request, res: Response): Promise<void> {
  res.status(200).json({ notices: await listMyNotices(who(req), (req.query.status as "open" | "all" | undefined) ?? "open") });
}
export async function seenNotice(req: Request, res: Response): Promise<void> {
  await markNoticeSeen(req.params.id as string, who(req));
  res.status(204).send();
}
export async function ackNotice(req: Request, res: Response): Promise<void> {
  await acknowledgeNotice(req.params.id as string, who(req), req.body.note, { ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
  res.status(204).send();
}
