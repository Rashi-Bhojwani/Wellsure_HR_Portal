import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { redact } from "./redact";

interface WriteAuditLogInput {
  actorUserId?: string | null;
  // E3: when the actor acted through a workflow delegation — the delegator.
  onBehalfOfUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// The only function allowed to insert an audit_logs row (spec §9: append-
// only, before/after redacted) — no other module calls prisma.auditLog.create
// directly, so redaction can never be skipped.
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      onBehalfOfUserId: input.onBehalfOfUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before === undefined ? undefined : (redact(input.before) as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (redact(input.after) as Prisma.InputJsonValue),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

/**
 * Many audit rows in one statement, one row per thing (never one row standing for a batch), through the same
 * redaction as writeAuditLog. Pass the transaction client to make the rows commit or roll back with the change they describe.
 */
export async function writeAuditLogs(inputs: WriteAuditLogInput[], client: Pick<PrismaClient, "auditLog"> = prisma): Promise<void> {
  if (inputs.length === 0) return;
  await client.auditLog.createMany({
    data: inputs.map((input) => ({
      actorUserId: input.actorUserId ?? null,
      onBehalfOfUserId: input.onBehalfOfUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before === undefined ? undefined : (redact(input.before) as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (redact(input.after) as Prisma.InputJsonValue),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })),
  });
}
