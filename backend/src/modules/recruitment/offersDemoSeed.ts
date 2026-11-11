import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { set, type SettingKey } from "./settings";
import { createCandidate, apply } from "./candidates";
import { createOffer, setCompensation, setExpectedPay, transition } from "./offers";

// C-4B DEMO (fictional, labelled, demo company only): an accepted offer for DEMO-C4B-JOINER with DEMO pay, DEMO expected pay on
// the first DEMO candidate, and DEMO joining choices. The joining exception approver and referrals stay as shipped (Not set / off).
export const DEMO_JOINER = "DEMO-C4B-JOINER";
export const DEMO_OFFER_PAY = "7777123.45"; // the sensitive-ui scan fails if any non-director page ever shows it
export const DEMO_EXPECTED_PAY = "6666123.45";
export async function seedDemoOffers(who: Record<string, { employeeId: string; userId: string }>) {
  if ((await prisma.systemSetting.findUnique({ where: { key: "demo.company" } }))?.value !== true) throw new Error("Offers demo requires labelled DEMO company.");
  if (await prisma.recruitmentOffer.count()) return;
  const director = who.DEMO001!, meta = { actorUserId: director.userId };
  const d = { ...director, ...(await resolveAccess(director.userId)) };
  const choose = async (key: SettingKey, value: unknown) => set(key, { value, version: (await prisma.recruitmentSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" } }))?.version ?? 0, reason: "DEMO COMPANY: fictional joining rule" }, meta);
  await choose("joinerLinkLifetime", { hours: 72 });
  await choose("joinerDocumentTypes", [{ code: "DEMO_ID_PROOF", label: "DEMO identity proof", kind: "IDENTITY", allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"], maxMb: 5 }, { code: "DEMO_BANK_PROOF", label: "DEMO bank proof", kind: "BANK", allowedMimeTypes: ["application/pdf"], maxMb: 5 }]);
  const job = await prisma.recruitmentJob.findFirstOrThrow({ where: { status: "OPEN" } });
  const existing = await prisma.candidate.findFirst({ where: { applications: { some: { jobId: job.id } } } });
  if (existing) await setExpectedPay(existing.id, d, { value: { amount: DEMO_EXPECTED_PAY, period: "ANNUAL" } }, meta);
  const c = await createCandidate(d, { name: DEMO_JOINER, email: "demo.c4b.joiner@example.invalid", phone: null, source: "DEMO_INTERNAL", consentConfirmed: true, consentRecordedAt: new Date().toISOString() }, meta);
  const a = await apply(c.id, d, { jobId: job.id }, meta);
  const o = await createOffer(d, { applicationId: a.id, title: "DEMO offered role", departmentId: job.departmentId, locationId: job.locationId, reportingManagerId: who.DEMO009!.employeeId, employmentType: "PERMANENT", joiningDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) }, meta);
  await setCompensation(o.id, d, { amount: DEMO_OFFER_PAY, period: "ANNUAL", version: 0 }, meta);
  await transition(o.id, d, { to: "PROPOSED", version: 1 }, meta);
  await transition(o.id, d, { to: "ISSUED", version: 2, letterSentThroughLetters: true, letterReference: "DEMO-LETTER-1" }, meta);
  await transition(o.id, d, { to: "ACCEPTED", version: 3 }, meta);
}
