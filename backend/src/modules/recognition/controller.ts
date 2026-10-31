import type { Request, Response } from "express";
import { actorFor, metaOf } from "../peeps/access";
import * as badges from "./badges";
import * as nudges from "./nudges";

const id = (req: Request) => req.params.id as string;
const q = (req: Request) => (req.query as { q: string }).q;

export async function badgeStatus(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.status(await actorFor(req)));
}
export async function badgeRecipients(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.recipients(await actorFor(req), q(req)));
}
export async function give(req: Request, res: Response): Promise<void> {
  const out = await badges.give(await actorFor(req), req.body, metaOf(req));
  res.status(out.repeated ? 200 : 201).json(out);
}
export async function myBadges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.mine(await actorFor(req)));
}
export async function givenBadges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.given(await actorFor(req)));
}
export async function personBadges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.forPerson(await actorFor(req), req.params.employeeId as string));
}
export async function directoryBadges(req: Request, res: Response): Promise<void> {
  const ids = (req.query as { ids: string }).ids.split(",").filter(Boolean).slice(0, 200);
  res.status(200).json(await badges.directoryCounts(ids));
}
export async function revokeBadge(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.revoke(await actorFor(req), id(req), req.body, metaOf(req)));
}
export async function allBadges(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.adminAll());
}

export async function nudgeStatus(req: Request, res: Response): Promise<void> {
  res.status(200).json(await nudges.status(await actorFor(req)));
}
export async function nudgeRecipients(req: Request, res: Response): Promise<void> {
  res.status(200).json(await nudges.recipients(await actorFor(req), q(req)));
}
export async function send(req: Request, res: Response): Promise<void> {
  const out = await nudges.send(await actorFor(req), req.body, metaOf(req));
  res.status(out.repeated ? 200 : 201).json(out);
}
export async function myNudges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await nudges.mine(await actorFor(req)));
}
export async function sentNudges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await nudges.sent(await actorFor(req)));
}
export async function getNudge(req: Request, res: Response): Promise<void> {
  res.status(200).json(await nudges.getOne(await actorFor(req), id(req), metaOf(req)));
}
export async function revokeNudge(req: Request, res: Response): Promise<void> {
  res.status(200).json(await nudges.revoke(await actorFor(req), id(req), req.body, metaOf(req)));
}
export async function allNudges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await nudges.adminAll(await actorFor(req), metaOf(req)));
}
