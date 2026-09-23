import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { redact } from "./redact";

interface WriteAuditLogInput {
  actorUserId?: string | null;
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
