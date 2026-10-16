import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma";

// The payroll event record: every state change with its actor and, where there is one, the hash. Append-only in the database. Written inside
// the same transaction as the change it describes whenever a transaction client is passed.

export type Db = Prisma.TransactionClient | PrismaClient;

export interface PayrollEventInput {
  subjectType: string;
  subjectId: string;
  type: string;
  actorUserId: string | null;
  payload?: Record<string, unknown>;
}

export async function recordEvent(input: PayrollEventInput, db: Db = prisma): Promise<void> {
  await db.payrollEvent.create({
    data: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      type: input.type,
      actorUserId: input.actorUserId,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/** Who changed the figures of a subject since a moment (the checker may not be any of them). */
export async function figureEditorsSince(subjectType: string, subjectId: string, since: Date, db: Db = prisma): Promise<Set<string>> {
  const rows = await db.payrollEvent.findMany({
    where: { subjectType, subjectId, type: "FIGURES_CHANGED", createdAt: { gt: since }, actorUserId: { not: null } },
    select: { actorUserId: true },
  });
  return new Set(rows.map((r) => r.actorUserId!));
}
