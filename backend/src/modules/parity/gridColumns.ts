import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

// A-9 G1 (item 5): the columns a person chose on a grid, remembered for them only. Which columns may show anything sensitive is the API's decision, not this list's.
export async function getGridColumns(userId: string, gridKey: string): Promise<{ columns: string[] | null }> {
  const row = await prisma.userGridPreference.findUnique({ where: { userId_gridKey: { userId, gridKey } } });
  return { columns: row ? (row.columns as string[]) : null };
}

export async function saveGridColumns(userId: string, gridKey: string, columns: string[]): Promise<{ columns: string[] }> {
  const unique = [...new Set(columns)];
  await prisma.userGridPreference.upsert({
    where: { userId_gridKey: { userId, gridKey } },
    create: { userId, gridKey, columns: unique as Prisma.InputJsonValue },
    update: { columns: unique as Prisma.InputJsonValue },
  });
  return { columns: unique };
}
