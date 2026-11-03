import { randomInt } from "node:crypto";
import { Prisma, type AvatarKind } from "@prisma/client";
import catalogue from "@shared/avatars/catalogue.json";
import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "../peeps/types";

// Avatar choices (D-35). A person shows their photo, their initials, or a character or fun pick from the catalogue data file
// (shared/avatars/catalogue.json — the art can be swapped there and in frontend/public/avatars/ without a code change). Only the person chooses their
// own (service + database trigger); nobody chooses for someone else, HR and the directors included (they may still remove an inappropriate photo).
// "Surprise me" picks a random character, once per click (the click's key). Choices are append-only; the latest is in force.

type Entry = { id: string; name: string; file: string };
const CHARACTERS: readonly Entry[] = catalogue.characters;
const FUN: readonly Entry[] = catalogue.fun;

export function catalogueView() {
  return { placeholder: catalogue.placeholder, basePath: catalogue.basePath, characters: CHARACTERS, fun: FUN };
}

const entryFor = (kind: AvatarKind, id: string | null | undefined) => (kind === "CHARACTER" ? CHARACTERS : kind === "FUN" ? FUN : []).find((e) => e.id === id) ?? null;

export interface AvatarView {
  kind: AvatarKind;
  catalogueId: string | null;
  file: string | null; // relative to basePath; null for photo or initials
}

const present = (row: { kind: AvatarKind; catalogueId: string | null } | null): AvatarView => {
  if (!row) return { kind: "PHOTO", catalogueId: null, file: null }; // default: the photo if there is one, else initials (the screens fall back)
  const entry = entryFor(row.kind, row.catalogueId);
  // A choice whose art has since left the catalogue falls back to initials rather than a broken image.
  if ((row.kind === "CHARACTER" || row.kind === "FUN") && !entry) return { kind: "INITIALS", catalogueId: null, file: null };
  return { kind: row.kind, catalogueId: row.catalogueId, file: entry?.file ?? null };
};

export async function currentFor(employeeId: string): Promise<AvatarView> {
  return present(await prisma.employeeAvatarChoice.findFirst({ where: { employeeId }, orderBy: [{ chosenAt: "desc" }, { id: "desc" }] }));
}

export async function chooseOwn(actor: { userId: string; employeeId: string }, input: { kind: AvatarKind; catalogueId?: string }, meta: ActorMeta): Promise<AvatarView> {
  const needsArt = input.kind === "CHARACTER" || input.kind === "FUN";
  if (needsArt && !entryFor(input.kind, input.catalogueId)) throw new HttpError(400, "That avatar is not in the catalogue.", "VALIDATION_ERROR");
  if (!needsArt && input.catalogueId) throw new HttpError(400, "A photo or initials has no catalogue id.", "VALIDATION_ERROR");
  const row = await prisma.employeeAvatarChoice.create({ data: { employeeId: actor.employeeId, kind: input.kind, catalogueId: needsArt ? input.catalogueId! : null, chosenByUserId: actor.userId } });
  await writeAuditLog({ ...meta, action: "peeps.avatar.chosen", entityType: "Employee", entityId: actor.employeeId, after: { kind: row.kind, catalogueId: row.catalogueId } });
  return present(row);
}

/** One random character per click: a repeated key (a double tap, a retry) answers with the choice that key already made. */
export async function surprise(actor: { userId: string; employeeId: string }, idempotencyKey: string, meta: ActorMeta): Promise<AvatarView> {
  const key = { employeeId_idempotencyKey: { employeeId: actor.employeeId, idempotencyKey } };
  const existing = await prisma.employeeAvatarChoice.findUnique({ where: key });
  if (existing) return present(existing);
  const pick = CHARACTERS[randomInt(CHARACTERS.length)]!;
  try {
    const row = await prisma.employeeAvatarChoice.create({ data: { employeeId: actor.employeeId, kind: "CHARACTER", catalogueId: pick.id, idempotencyKey, chosenByUserId: actor.userId } });
    await writeAuditLog({ ...meta, action: "peeps.avatar.chosen", entityType: "Employee", entityId: actor.employeeId, after: { kind: "CHARACTER", catalogueId: pick.id, surprise: true } });
    return present(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return present(await prisma.employeeAvatarChoice.findUniqueOrThrow({ where: key }));
    throw err;
  }
}

/**
 * What every screen needs to draw a person's avatar: for each active employee, their choice and their photo version. Both are already public to
 * signed-in staff (the directory shows the photo version), so this reveals nothing new; the photo bytes still need the photo token.
 */
export async function avatarMap(): Promise<Record<string, { kind: AvatarKind; file: string | null; photoVersion: string | null }>> {
  const people = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, personal: { select: { photoVersion: true } } } });
  const latest = await prisma.$queryRaw<Array<{ employee_id: string; kind: AvatarKind; catalogue_id: string | null }>>`
    SELECT DISTINCT ON (employee_id) employee_id, kind, catalogue_id FROM employee_avatar_choices ORDER BY employee_id, chosen_at DESC, id DESC`;
  const choice = new Map(latest.map((r) => [r.employee_id, present({ kind: r.kind, catalogueId: r.catalogue_id })]));
  const out: Record<string, { kind: AvatarKind; file: string | null; photoVersion: string | null }> = {};
  for (const p of people) {
    const c = choice.get(p.id);
    const photoVersion = p.personal?.photoVersion ?? null;
    if (!c && !photoVersion) continue; // nothing to show but initials
    out[p.id] = { kind: c?.kind ?? "PHOTO", file: c?.file ?? null, photoVersion };
  }
  return out;
}
