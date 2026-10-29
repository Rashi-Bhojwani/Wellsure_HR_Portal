import type { Request, Response } from "express";
import { listSwitches, requireDirector, setSwitch } from "../../lib/directorAuthority";
import { acknowledgeNotice, listMyNotices, markNoticeSeen } from "../../lib/directorNotices";
import type { DirectorStep } from "@shared/constants/directorAuthority";

const who = (req: Request) => req.user!.userId;

export async function getSwitches(req: Request, res: Response): Promise<void> {
  await requireDirector(who(req), "read the second-director checks");
  res.status(200).json({ switches: await listSwitches() });
}
export async function putSwitch(req: Request, res: Response): Promise<void> {
  const result = await setSwitch(req.params.step as DirectorStep, req.body.requireSecondDirector, { userId: who(req), ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
  res.status(200).json({ ...result, switches: await listSwitches() });
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
