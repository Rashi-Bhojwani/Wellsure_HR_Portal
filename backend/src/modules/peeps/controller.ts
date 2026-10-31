import type { Request, Response } from "express";
import { OFFICE_CAPABILITIES, type PeepsSettingKey } from "@shared/constants/peeps";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { actorFor, metaOf } from "./access";
import * as office from "./office";
import * as settings from "./settings";

const key = (req: Request) => req.params.key as PeepsSettingKey;

/** What the caller's own screens need: whether to show the workspace, and what it is called. Self only. */
export async function me(req: Request, res: Response): Promise<void> {
  const a = await actorFor(req);
  res.status(200).json({ isDirector: a.isDirector, isMember: a.isMember, capabilities: a.capabilities, officeName: await settings.officeName(), capabilityCatalog: OFFICE_CAPABILITIES.map(({ id, label, what }) => ({ id, label, what })) });
}

export async function listSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settings.listSettings(await actorFor(req)));
}
export async function enterSetting(req: Request, res: Response): Promise<void> {
  res.status(201).json(await settings.enterSetting(key(req), req.body, await actorFor(req), metaOf(req)));
}
export async function confirmSetting(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settings.confirmSetting(key(req), req.body, await actorFor(req), metaOf(req)));
}

export async function membership(req: Request, res: Response): Promise<void> {
  res.status(200).json(await office.membershipOverview(await actorFor(req)));
}
export async function propose(req: Request, res: Response): Promise<void> {
  res.status(201).json(await office.proposeChange(req.body, await actorFor(req), metaOf(req)));
}
export async function confirm(req: Request, res: Response): Promise<void> {
  res.status(200).json(await office.confirmChange(req.params.id as string, await actorFor(req), metaOf(req)));
}
export async function drift(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await office.officeGrantDrift());
}
/** Active employees, for the director choosing a member (directors see everyone anyway). */
export async function people(req: Request, res: Response): Promise<void> {
  const q = (req.query as { q: string }).q;
  const rows = await prisma.employee.findMany({
    where: { status: "ACTIVE", user: { status: "ACTIVE" }, ...(q ? { OR: [{ employeeCode: { contains: q, mode: "insensitive" } }, { nameHistory: { some: { ...inForceOn(), fullName: { contains: q, mode: "insensitive" } } } }] } : {}) },
    orderBy: { employeeCode: "asc" },
    take: 20,
    select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } },
  });
  res.status(200).json(rows.map((e) => ({ employeeId: e.id, employeeCode: e.employeeCode, name: e.nameHistory[0]?.fullName ?? e.employeeCode })));
}
