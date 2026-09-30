import type { Request, Response } from "express";
import * as postsService from "./posts";
import * as kudosService from "./kudos";
import * as pollsService from "./polls";
import * as reactionsService from "./reactions";
import * as commentsService from "./comments";
import * as groupsService from "./groups";
import * as moderationService from "./moderation";
import * as autoPostSettingsService from "./autoPostSettings";
import { searchEmployeesForPicker } from "./employeeSearch";
import type { ActorMeta, EngageViewer } from "./types";

function viewer(req: Request): EngageViewer {
  return { employeeId: req.user!.employeeId, userId: req.user!.userId, permissions: req.user!.permissions };
}

function actorMeta(req: Request): ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}

// ── Feed / posts ──────────────────────────────────────────────────────

export async function listFeed(req: Request, res: Response): Promise<void> {
  const query = req.query as never as postsService.ListFeedQuery;
  res.status(200).json(await postsService.listFeed(query, req.user!.employeeId));
}

export async function getPost(req: Request, res: Response): Promise<void> {
  res.status(200).json(await postsService.getPost(req.params.id as string, req.user!.employeeId));
}

export async function createPost(req: Request, res: Response): Promise<void> {
  res.status(201).json(await postsService.createPost(viewer(req), req.body, actorMeta(req)));
}

export async function searchEmployees(req: Request, res: Response): Promise<void> {
  const { q } = req.query as never as { q: string };
  res.status(200).json({ employees: await searchEmployeesForPicker(q, req.user!.employeeId) });
}

// ── Kudos ─────────────────────────────────────────────────────────────

export async function giveKudos(req: Request, res: Response): Promise<void> {
  res.status(201).json(await kudosService.giveKudos(viewer(req), req.body, actorMeta(req)));
}

// ── Polls ─────────────────────────────────────────────────────────────

export async function createPoll(req: Request, res: Response): Promise<void> {
  res.status(201).json(await pollsService.createPoll(viewer(req), req.body, actorMeta(req)));
}

export async function votePoll(req: Request, res: Response): Promise<void> {
  const { pollOptionId } = req.body as { pollOptionId: string };
  res.status(200).json(await pollsService.votePoll(pollOptionId, viewer(req)));
}

export async function closePoll(req: Request, res: Response): Promise<void> {
  res.status(200).json(await pollsService.closePoll(req.params.id as string, viewer(req), actorMeta(req)));
}

// ── Reactions ─────────────────────────────────────────────────────────

export async function toggleReaction(req: Request, res: Response): Promise<void> {
  const { emoji } = req.body as { emoji: string };
  res.status(200).json(await reactionsService.toggleReaction(req.params.id as string, emoji, viewer(req)));
}

// ── Comments ──────────────────────────────────────────────────────────

export async function listComments(req: Request, res: Response): Promise<void> {
  res.status(200).json({ comments: await commentsService.listComments(req.params.id as string) });
}

export async function addComment(req: Request, res: Response): Promise<void> {
  const { body } = req.body as { body: string };
  res.status(201).json(await commentsService.addComment(req.params.id as string, body, viewer(req)));
}

// ── Groups (self-serve list; engage.groups.manage for CRUD/membership) ──

export async function listActiveGroups(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ groups: await groupsService.listActiveGroups() });
}

export async function listGroups(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ groups: await groupsService.listGroups() });
}

export async function createGroup(req: Request, res: Response): Promise<void> {
  res.status(201).json(await groupsService.createGroup(req.body, actorMeta(req)));
}

export async function updateGroup(req: Request, res: Response): Promise<void> {
  res.status(200).json(await groupsService.updateGroup(req.params.id as string, req.body, actorMeta(req)));
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  res.status(200).json({ members: await groupsService.listMembers(req.params.id as string) });
}

export async function addMember(req: Request, res: Response): Promise<void> {
  await groupsService.addMember(req.params.id as string, req.params.employeeId as string, actorMeta(req));
  res.status(204).send();
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  await groupsService.removeMember(req.params.id as string, req.params.employeeId as string, actorMeta(req));
  res.status(204).send();
}

// ── Moderation (engage.moderate) ─────────────────────────────────────

export async function listPostsForModeration(req: Request, res: Response): Promise<void> {
  const query = req.query as never as { moderated?: "true" | "false"; page: number; pageSize: number };
  const moderated = query.moderated === undefined ? undefined : query.moderated === "true";
  res.status(200).json(await moderationService.listPostsForModeration({ moderated, page: query.page, pageSize: query.pageSize }, req.user!.employeeId));
}

export async function moderatePost(req: Request, res: Response): Promise<void> {
  res.status(200).json(await moderationService.moderatePost(req.params.id as string, viewer(req), actorMeta(req)));
}

export async function unmoderatePost(req: Request, res: Response): Promise<void> {
  res.status(200).json(await moderationService.unmoderatePost(req.params.id as string, viewer(req), actorMeta(req)));
}

// ── Auto-post settings (engage.autopost.manage) ──────────────────────

export async function listAutoPostSettings(_req: Request, res: Response): Promise<void> {
  const [settings, dailyRunHour] = await Promise.all([
    autoPostSettingsService.listAutoPostSettings(),
    autoPostSettingsService.getDailyRunHour(),
  ]);
  res.status(200).json({ settings, dailyRunHour });
}

export async function updateAutoPostSetting(req: Request, res: Response): Promise<void> {
  const kind = req.params.kind as "BIRTHDAY" | "JOINING" | "ANNIVERSARY";
  res.status(200).json(await autoPostSettingsService.updateAutoPostSetting(kind, req.body, actorMeta(req)));
}

export async function updateDailyRunHour(req: Request, res: Response): Promise<void> {
  const { dailyRunHour } = req.body as { dailyRunHour: number };
  res.status(200).json({ dailyRunHour: await autoPostSettingsService.setDailyRunHour(dailyRunHour, actorMeta(req)) });
}
