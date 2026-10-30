import { prisma } from "../../lib/prisma";
import { acknowledge, createAsset, issueAsset } from "./service";
import { confirmSetting, proposeSetting } from "./settings";
import type { AssetViewer } from "./types";

// The demo company's asset register (development only; called from scripts/demo/seedDemoCompany.ts). Every value is made up and labelled DEMO. It goes
// through the real services as the demo's people: the HR Admin enters the three lists, a director who did not enter them confirms them, HR adds and
// issues the assets, and one holder acknowledges receipt. The asset held by DEMO007 carries a marker name that the sensitive-data scan
// (frontend/e2e/sensitive-ui.mjs) checks never reaches another employee's screens.

export const DEMO_ASSET_MARKER = "DEMO-ASSET-HELD-BY-007";

type Who = Record<string, { employeeId: string; userId: string }>;

export async function seedDemoAssets(who: Who): Promise<void> {
  if ((await prisma.assetSettingVersion.count()) > 0) return; // already seeded (or a real register): never touched again
  const meta = (code: string) => ({ actorUserId: who[code]!.userId, ipAddress: null, userAgent: null });
  const viewer = (code: string): AssetViewer => ({ userId: who[code]!.userId, employeeId: who[code]!.employeeId, dataScope: "ALL", permissions: new Set() });

  await proposeSetting("CATEGORIES", { items: [{ code: "DEMO_LAPTOP", label: "DEMO Laptop" }, { code: "DEMO_PHONE", label: "DEMO Phone" }, { code: "DEMO_ID_CARD", label: "DEMO Access card" }], note: "DEMO COMPANY" }, meta("DEMO004"));
  await proposeSetting(
    "STATUSES",
    { items: [{ code: "DEMO_IN_STOCK", label: "DEMO In stock", issuable: true }, { code: "DEMO_IN_REPAIR", label: "DEMO In repair", issuable: false }, { code: "DEMO_RETIRED", label: "DEMO Retired", issuable: false }], note: "DEMO COMPANY" },
    meta("DEMO004"),
  );
  await proposeSetting("CONDITIONS", { items: [{ code: "DEMO_NEW", label: "DEMO New" }, { code: "DEMO_GOOD", label: "DEMO Good" }, { code: "DEMO_DAMAGED", label: "DEMO Damaged" }], note: "DEMO COMPANY" }, meta("DEMO004"));
  for (const kind of ["CATEGORIES", "STATUSES", "CONDITIONS"] as const) await confirmSetting(kind, { version: 1, note: "DEMO COMPANY" }, meta("DEMO001"));

  const hr = viewer("DEMO004");
  const laptop = await createAsset({ name: "DEMO Laptop 01", categoryCode: "DEMO_LAPTOP", statusCode: "DEMO_IN_STOCK", serialNumber: "DEMO-SN-0001", model: "DEMO model" }, hr, meta("DEMO004"));
  const phone = await createAsset({ name: DEMO_ASSET_MARKER, categoryCode: "DEMO_PHONE", statusCode: "DEMO_IN_STOCK", serialNumber: "DEMO-SN-0002" }, hr, meta("DEMO004"));
  await createAsset({ name: "DEMO Spare access card", categoryCode: "DEMO_ID_CARD", statusCode: "DEMO_IN_STOCK" }, hr, meta("DEMO004"));
  await issueAsset(laptop.id, { employeeId: who.DEMO006!.employeeId, conditionCode: "DEMO_NEW", note: "DEMO COMPANY" }, hr, meta("DEMO004"));
  await issueAsset(phone.id, { employeeId: who.DEMO007!.employeeId, conditionCode: "DEMO_GOOD", note: "DEMO COMPANY" }, hr, meta("DEMO004"));
  const mine = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId: laptop.id, endedAt: null } });
  await acknowledge(mine.id, viewer("DEMO006"), meta("DEMO006"));
}
