import { RULE_BY_KEY } from "@shared/constants/payrollRules";
import {
  CONTINUING,
  PACK_CHECKED_ON,
  PACK_RULES,
  PACK_STATE_LABEL,
  PACK_STATE_RULES,
  PACK_TAX_YEARS,
  PACK_VERSION,
  STANDARD_DEFAULT_LABEL,
  entryOn,
  packChangeDates,
  packReviewNeeded,
  type PackEntry,
} from "@shared/constants/statutoryDefaults";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { activeDirectors, requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { behaviourValue } from "../../behaviours/service";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { loadItems, summarise } from "../items";
import { namesOfUsers } from "../names";
import type { RulePin } from "../rules/context";

// The Standard statutory defaults pack (docs/plans/STATUTORY_DEFAULTS_PLAN.md): what the screens show (every standard value, its source, its check date and whether a
// director's value replaces it), the directors' one-time acknowledgement, later reviews, the review reminder and the refusal a run meets until both have acknowledged.
// Directors only: the routes also need payroll.rules.view and refuse the Developer role.

type Actor = { userId: string; ip?: string | null };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DEMO_SETTING = "demo.company";

const entryView = (e: PackEntry) => ({ from: e.from === CONTINUING ? null : e.from, value: e.value, source: e.source, checkedOn: e.checkedOn, verification: e.verification, reviewNeeded: e.verification === "UNVERIFIED", note: e.note });

async function acknowledgements() {
  const rows = await prisma.statutoryPackReview.findMany({ where: { kind: "ACKNOWLEDGED" }, orderBy: { createdAt: "asc" } });
  const directorIds = new Set((await activeDirectors()).map((d) => d.userId));
  return rows.filter((r) => directorIds.has(r.userId));
}

/** Last review: the latest acknowledgement or review by a director, or the day the pack was checked if none is later. */
async function lastReviewedOn(): Promise<string> {
  const last = await prisma.statutoryPackReview.findFirst({ orderBy: { createdAt: "desc" } });
  const reviewed = last ? iso(last.createdAt) : null;
  return reviewed && reviewed > PACK_CHECKED_ON ? reviewed : PACK_CHECKED_ON;
}

/** Why a review is due now (empty when it is not): the interval has passed since the last review, or a pack value's effective date has passed since then. Pure. */
export function reviewDueReasons(input: { today: string; lastReviewed: string; intervalMonths: number }): string[] {
  const out: string[] = [];
  const [y, m, d] = input.lastReviewed.split("-").map(Number) as [number, number, number];
  const due = iso(new Date(Date.UTC(y, m - 1 + input.intervalMonths, d)));
  if (input.today >= due) out.push(`The standard values were last reviewed on ${input.lastReviewed}, more than ${input.intervalMonths} month${input.intervalMonths === 1 ? "" : "s"} ago.`);
  for (const c of packChangeDates()) if (c.from > input.lastReviewed && c.from <= input.today) out.push(`${RULE_BY_KEY[c.key]?.label ?? c.key}: a new value applies from ${c.from}, after the last review.`);
  return out;
}

export async function packStatus(actor: Actor) {
  await requireDirector(actor.userId, "see the standard statutory values");
  const today = iso(businessToday());
  const [acks, last, interval, state, ctcSetting, ruleData, taxData] = await Promise.all([
    acknowledgements(),
    lastReviewedOn(),
    behaviourValue("statutory.reviewIntervalMonths"),
    behaviourValue("statutory.state"),
    behaviourValue("payroll.ctcIncludesEmployerStatutory"),
    loadItems("RULE", Object.keys(PACK_RULES)),
    loadItems("TAX_YEAR", Object.keys(PACK_TAX_YEARS)),
  ]);
  const names = await namesOfUsers(acks.map((a) => a.userId));
  const stateKey = state.value as string;
  const statePack = (PACK_STATE_RULES as Record<string, (typeof PACK_STATE_RULES)["RAJASTHAN"] | undefined>)[stateKey];
  return {
    version: PACK_VERSION,
    checkedOn: PACK_CHECKED_ON,
    label: STANDARD_DEFAULT_LABEL,
    lastReviewedOn: last,
    reviewIntervalMonths: interval.value as number,
    reviewDue: reviewDueReasons({ today, lastReviewed: last, intervalMonths: interval.value as number }),
    acknowledged: acks.length >= 2,
    acknowledgedBy: acks.map((a) => ({ name: names.get(a.userId) ?? "A director", at: a.createdAt.toISOString(), mine: a.userId === actor.userId })),
    reviewNeeded: packReviewNeeded(),
    ctcIncludesEmployerStatutory: ctcSetting.value as boolean,
    rules: Object.entries(PACK_RULES).map(([key, series]) => {
      const s = summarise(ruleData, key);
      const inUse = s.current ? "DIRECTOR" : "STANDARD";
      return { key, label: RULE_BY_KEY[key]?.label ?? key, inUse, today: entryView(entryOn(series, today) ?? series[0]!), series: series.map(entryView) };
    }),
    state: {
      key: stateKey,
      label: PACK_STATE_LABEL[stateKey] ?? stateKey,
      loaded: Boolean(statePack),
      professionalTax: statePack ? entryView(statePack.professionalTax) : null,
      labourWelfareFund: statePack ? entryView(statePack.labourWelfareFund) : null,
      minimumWages: statePack ? entryView(statePack.minimumWages) : null,
      notLoadedText: statePack ? null : "Values for this state have not been loaded.",
    },
    taxYears: Object.entries(PACK_TAX_YEARS).map(([year, t]) => ({ year, inUse: summarise(taxData, year).current ? "DIRECTOR" : "STANDARD", verification: t.verification, unverifiedParts: t.unverifiedParts })),
  };
}

export async function acknowledge(actor: Actor) {
  await requireDirector(actor.userId, "acknowledge the standard statutory values");
  if (await prisma.statutoryPackReview.findFirst({ where: { kind: "ACKNOWLEDGED", userId: actor.userId } })) throw new HttpError(409, "You have already acknowledged the standard values.", "ALREADY_ACKNOWLEDGED");
  try {
    await prisma.statutoryPackReview.create({ data: { kind: "ACKNOWLEDGED", packVersion: PACK_VERSION, userId: actor.userId } });
  } catch {
    throw new HttpError(409, "You have already acknowledged the standard values.", "ALREADY_ACKNOWLEDGED");
  }
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.statutory_pack.acknowledged", entityType: "StatutoryPack", entityId: `v${PACK_VERSION}`, after: { packVersion: PACK_VERSION, checkedOn: PACK_CHECKED_ON } });
  return { acknowledged: (await acknowledgements()).length >= 2 };
}

export async function markReviewed(actor: Actor) {
  await requireDirector(actor.userId, "mark the standard statutory values as reviewed");
  await prisma.statutoryPackReview.create({ data: { kind: "REVIEWED", packVersion: PACK_VERSION, userId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.statutory_pack.reviewed", entityType: "StatutoryPack", entityId: `v${PACK_VERSION}`, after: { packVersion: PACK_VERSION } });
  return { lastReviewedOn: await lastReviewedOn() };
}

/**
 * A run that used any standard value cannot be made real until two different directors have acknowledged the standard values (one time). The demo company is exempt.
 * Called by assertRunIsReal, the first line of submit, approve, finalise, publish and the bank file.
 */
export async function assertPackAcknowledged(pins: readonly RulePin[]): Promise<void> {
  if (!pins.some((p) => p.kind === "PACK")) return;
  const demo = await prisma.systemSetting.findUnique({ where: { key: DEMO_SETTING } });
  if (demo?.value === true) return;
  const acks = await acknowledgements();
  if (acks.length >= 2) return;
  throw new HttpError(
    409,
    `This run uses the standard statutory values, which ${acks.length === 0 ? "neither director has" : "only one director has"} acknowledged yet. Before the first real payroll run each of the two directors clicks "I have reviewed the standard values" (Payroll, Ready for First Run).`,
    "STANDARD_VALUES_NOT_ACKNOWLEDGED",
    { acknowledged: acks.length },
  );
}

/** The review reminder (rides the hourly director-notice sweep): once per cause after the last review, to every director. */
export async function remindStatutoryPackReview(): Promise<{ reminded: number }> {
  const today = iso(businessToday());
  const last = await lastReviewedOn();
  const interval = (await behaviourValue("statutory.reviewIntervalMonths")).value as number;
  const reasons = reviewDueReasons({ today, lastReviewed: last, intervalMonths: interval });
  if (reasons.length === 0) return { reminded: 0 };
  const since = new Date(`${last}T00:00:00Z`);
  let reminded = 0;
  for (const d of await activeDirectors()) {
    for (const reason of reasons) {
      const already = await prisma.notification.findFirst({ where: { userId: d.userId, type: "payroll.statutory_pack.review_due", createdAt: { gte: since }, body: reason }, select: { id: true } });
      if (already) continue;
      await notifyEmployee(d.employeeId, { type: "payroll.statutory_pack.review_due", title: "Review the standard statutory values", body: reason, link: "/admin/payroll/ready" });
      reminded += 1;
    }
  }
  return { reminded };
}

