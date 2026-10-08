import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Reads a SystemSetting value, falling back to a hardcoded default when
// the row doesn't exist — the app must never hard-depend on seed data to
// function. See prisma/seed.ts for the seeded Phase 1 defaults and
// docs/PROJECT_SPEC.md §14/CLAUDE.md's "keep configurable" rule.
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : defaultValue;
}

// Only the System Settings module (spec §7.8) calls this — every other
// module only ever reads settings via getSetting above.
export async function setSetting(key: string, value: unknown, updatedByUserId: string | null): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue, updatedByUserId },
    update: { value: value as Prisma.InputJsonValue, updatedByUserId },
  });
}
