import { Prisma } from "@prisma/client";
import { isPeepsLeaveTypeCode } from "@shared/constants/peepsLeave";
import { HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { getSetting } from "../peeps/settings";
import { documentNeeded } from "./rules";
import { rulesInForce } from "./service";

// What the existing leave code asks of the new leave types (called from PEEPS blocks in modules/leave). Every function is a no-op for the five
// original types, so PL, LOP, COF, WFH and RH behave exactly as before.

type Client = Prisma.TransactionClient | typeof prisma;
type TypeLike = { id: string; code: string };
type ViewerLike = { employeeId: string; roleCodes: string[] };

const NOT_IN_FORCE = "This leave type cannot be applied for yet: its rules are not set and approved for these dates.";
const isHrOrDirector = (v: ViewerLike) => v.roleCodes.includes(SUPER_ADMIN_ROLE_CODE) || v.roleCodes.some((c) => (HR_ROLE_CODES as readonly string[]).includes(c));

function calendarDays(from: Date, to: Date, fromPart: string, toPart: string): Prisma.Decimal {
  const n = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  let d = new Prisma.Decimal(n);
  if (n === 1) return fromPart === "FULL" ? d : new Prisma.Decimal("0.5");
  if (fromPart !== "FULL") d = d.minus("0.5");
  if (toPart !== "FULL") d = d.minus("0.5");
  return d;
}

/**
 * Applying for a new type (before the employee's lock): the rules must be approved and in force for the leave's dates; the employee must be eligible;
 * a raw attachment key is refused (documents go through /api/leave-documents). Returns the days to count: the engine's working days, or calendar days.
 */
export async function peepsApplyDays(
  leaveType: TypeLike,
  input: { employeeId: string; fromDate: Date; toDate: Date; fromDayPart: string; toDayPart: string; attachmentStorageKey?: string | null },
  workingDays: Prisma.Decimal,
): Promise<Prisma.Decimal> {
  if (!isPeepsLeaveTypeCode(leaveType.code)) return workingDays;
  const inForce = await rulesInForce(leaveType.id, input.fromDate);
  if (!inForce) throw new HttpError(409, NOT_IN_FORCE, "LEAVE_RULES_NOT_SET");
  if (input.attachmentStorageKey) throw new HttpError(400, "Attach a supporting document after applying; it is kept apart from other files.", "VALIDATION_ERROR");
  const { rules } = inForce;
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: input.employeeId }, select: { dateOfJoining: true, employmentType: true } });
  const served = Math.floor((input.fromDate.getTime() - employee.dateOfJoining.getTime()) / 86_400_000);
  if (served < rules.eligibility.minServiceDays || !(rules.eligibility.employmentTypes as readonly string[]).includes(employee.employmentType)) {
    throw new HttpError(409, "This employee is not eligible for this leave type under its rules.", "NOT_ELIGIBLE");
  }
  return rules.counting === "CALENDAR_DAYS" ? calendarDays(input.fromDate, input.toDate, input.fromDayPart, input.toDayPart) : workingDays;
}

async function usedDays(client: Client, leaveTypeId: string, employeeId: string, statuses: Array<"PENDING" | "APPROVED">, year: number | null, excludeId?: string): Promise<Prisma.Decimal> {
  const agg = await client.leaveRequest.aggregate({
    _sum: { totalDays: true },
    where: {
      leaveTypeId,
      employeeId,
      status: { in: statuses },
      ...(year === null ? {} : { fromDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  return agg._sum.totalDays ?? new Prisma.Decimal(0);
}

async function assertCap(client: Client, leaveType: TypeLike, employeeId: string, fromDate: Date, totalDays: Prisma.Decimal, statuses: Array<"PENDING" | "APPROVED">, excludeId?: string) {
  const inForce = await rulesInForce(leaveType.id, fromDate, client);
  if (!inForce) throw new HttpError(409, NOT_IN_FORCE, "LEAVE_RULES_NOT_SET");
  const e = inForce.rules.entitlement;
  if (e.kind !== "CAP") return inForce; // a granted balance is checked by the engine's own balance check
  const cap = new Prisma.Decimal(e.days);
  const used = e.period === "PER_REQUEST" ? new Prisma.Decimal(0) : await usedDays(client, leaveType.id, employeeId, statuses, e.period === "PER_CALENDAR_YEAR" ? fromDate.getUTCFullYear() : null, excludeId);
  if (used.plus(totalDays).gt(cap)) throw new HttpError(409, `This would go over the limit for this leave type (${cap.toString()} days ${e.period === "PER_REQUEST" ? "in one request" : e.period === "PER_CALENDAR_YEAR" ? "in a calendar year" : "in the whole employment"}).`, "LEAVE_LIMIT_REACHED");
  return inForce;
}

/** Inside the employee's lock, while applying: the limit, counting requests that are pending or approved. */
export async function assertPeepsApplyLimit(tx: Client, leaveType: TypeLike, employeeId: string, fromDate: Date, totalDays: Prisma.Decimal): Promise<void> {
  if (!isPeepsLeaveTypeCode(leaveType.code)) return;
  await assertCap(tx, leaveType, employeeId, fromDate, totalDays, ["PENDING", "APPROVED"]);
}

/** Inside the lock, while approving: rules still in force, the route (HR only?), the limit against approved requests, and a required document. */
export async function assertPeepsApproval(tx: Client, request: { id: string; employeeId: string; fromDate: Date; totalDays: Prisma.Decimal; leaveType: TypeLike }, viewer: ViewerLike): Promise<void> {
  if (!isPeepsLeaveTypeCode(request.leaveType.code)) return;
  const inForce = await assertCap(tx, request.leaveType, request.employeeId, request.fromDate, request.totalDays, ["APPROVED"], request.id);
  if (inForce.rules.approvalRoute === "HR_ONLY" && !isHrOrDirector(viewer)) throw new HttpError(403, "Only HR decides this leave type.", "HR_ONLY_ROUTE");
  if (documentNeeded(inForce.rules, request.totalDays) && (await tx.leaveRequestDocument.count({ where: { leaveRequestId: request.id } })) === 0) {
    throw new HttpError(409, "A supporting document is needed before this request can be approved.", "DOCUMENT_REQUIRED");
  }
}

/** The existing Leave Types & Policies tool: a new type is switched on, made paid or half-day only by its approved rules. */
export async function assertLeaveTypeEditable(before: TypeLike & { isActive: boolean; isPaid: boolean; allowHalfDay: boolean }, input: { isActive?: boolean; isPaid?: boolean; allowHalfDay?: boolean }): Promise<void> {
  if (!isPeepsLeaveTypeCode(before.code)) return;
  // The edit form may send the flags unchanged with a new name: only a change is refused.
  if ((input.isPaid !== undefined && input.isPaid !== before.isPaid) || (input.allowHalfDay !== undefined && input.allowHalfDay !== before.allowHalfDay)) {
    throw new HttpError(409, "Paid or unpaid and half days are set by this type's approved rules.", "SET_BY_LEAVE_RULES");
  }
  if (input.isActive === true && !before.isActive && !(await rulesInForceOrLater(before.id))) throw new HttpError(409, "This type is switched on when a director approves its rules.", "SET_BY_LEAVE_RULES");
}

async function rulesInForceOrLater(leaveTypeId: string): Promise<boolean> {
  const latest = await prisma.leaveRuleVersion.findFirst({ where: { leaveTypeId }, orderBy: { version: "desc" }, include: { approval: true } });
  return Boolean(latest?.approval);
}

/** The policy row of a new type is written only from its approved rules. */
export function assertPolicyEditable(leaveType: TypeLike): void {
  if (isPeepsLeaveTypeCode(leaveType.code)) throw new HttpError(409, "This type's policy comes from its approved rules (prepare a new version).", "SET_BY_LEAVE_RULES");
}

/** Team calendars: a generic "Leave" for the new types until the directors' setting says to show the type. */
export async function calendarTypeLabeller(): Promise<(code: string) => string> {
  const show = (await getSetting<{ showType: boolean }>("leave.calendarShowsType"))?.showType === true;
  return (code) => (!show && isPeepsLeaveTypeCode(code) ? "LEAVE" : code);
}

/** Leave request responses: the free-text reason of a new-type request is the employee's, HR's and the directors' only. */
export function redactLeaveRows<T>(body: T, viewer: ViewerLike): T {
  if (isHrOrDirector(viewer)) return body;
  const fix = (row: unknown): unknown => {
    if (!row || typeof row !== "object") return row;
    const r = row as Record<string, unknown>;
    if (typeof r.leaveTypeCode === "string" && isPeepsLeaveTypeCode(r.leaveTypeCode) && r.employeeId !== viewer.employeeId && "reason" in r) return { ...r, reason: null };
    return row;
  };
  if (Array.isArray(body)) return body.map(fix) as T;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.rows)) return { ...b, rows: b.rows.map(fix) } as T;
    if (Array.isArray(b.results)) return { ...b, results: b.results.map((x) => (x && typeof x === "object" && "request" in (x as object) ? { ...(x as object), request: fix((x as { request: unknown }).request) } : x)) } as T;
    return fix(body) as T;
  }
  return body;
}
