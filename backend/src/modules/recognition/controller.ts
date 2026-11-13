import type { Request, Response } from "express";
import { actorFor, metaOf } from "../peeps/access";
import * as badges from "./badges";
import * as tags from "./nudgeTags";
import * as notes from "./nudges";

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
  res.status(200).json(await badges.directoryCounts(await actorFor(req), ids));
}
export async function badgeCounts(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.allCounts(await actorFor(req)));
}
export async function recentBadges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.recent(await actorFor(req)));
}
export async function revokeBadge(req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.revoke(await actorFor(req), id(req), req.body, metaOf(req)));
}
export async function allBadges(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await badges.adminAll());
}

export async function nudgeStatus(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.status(await actorFor(req)));
}
export async function nudgeRecipients(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.recipients(await actorFor(req), q(req)));
}
export async function giveNudge(req: Request, res: Response): Promise<void> {
  const out = await tags.give(await actorFor(req), req.body, metaOf(req));
  res.status(out.repeated ? 200 : 201).json(out);
}
export async function myNudges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.mine(await actorFor(req)));
}
export async function personNudges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.forPerson(await actorFor(req), req.params.employeeId as string));
}
export async function nudgeCounts(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.counts(await actorFor(req)));
}
export async function recentNudges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.recent(await actorFor(req)));
}
export async function removeNudge(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.remove(await actorFor(req), id(req), req.body, metaOf(req)));
}
export async function requestNudgeReview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.requestReview(await actorFor(req), id(req), metaOf(req)));
}
export async function decideNudgeReview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.decideReview(await actorFor(req), id(req), req.body, metaOf(req)));
}
export async function allNudges(req: Request, res: Response): Promise<void> {
  res.status(200).json(await tags.adminAll(await actorFor(req)));
}
export async function myNotes(req: Request, res: Response): Promise<void> {
  res.status(200).json(await notes.mine(await actorFor(req)));
}
export async function getNote(req: Request, res: Response): Promise<void> {
  res.status(200).json(await notes.getOne(await actorFor(req), id(req), metaOf(req)));
}
export async function allNotes(req: Request, res: Response): Promise<void> {
  res.status(200).json(await notes.adminAll(await actorFor(req), metaOf(req)));
}
