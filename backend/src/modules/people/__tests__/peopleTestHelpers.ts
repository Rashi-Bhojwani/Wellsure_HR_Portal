import { prisma } from "../../../lib/prisma";
import { PEOPLE_DOCUMENTS_SETTING_KEYS } from "../../../lib/peopleDocumentsSettings";

// Every SystemSetting key is a global singleton shared by the whole test
// run (see the Phase 1 commit D note in docs/PROGRESS.md), so a test that
// changes one must restore exactly what was there — a seeded value or
// nothing — rather than assume and delete.
export async function snapshotPeopleDocumentsSettings(): Promise<() => Promise<void>> {
  const keys = Object.values(PEOPLE_DOCUMENTS_SETTING_KEYS);
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  return async () => {
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    for (const row of rows) {
      await prisma.systemSetting.create({ data: { key: row.key, value: row.value as never, updatedByUserId: null } });
    }
  };
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}
