import { prisma } from "./prisma";

// Reads a SystemSetting value, falling back to a hardcoded default when
// the row doesn't exist — the app must never hard-depend on seed data to
// function. See prisma/seed.ts for the seeded Phase 1 defaults and
// docs/PROJECT_SPEC.md §14/CLAUDE.md's "keep configurable" rule.
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : defaultValue;
}
